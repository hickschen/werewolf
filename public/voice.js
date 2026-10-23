/* 月夜狼人殺：語音（WebRTC 點對點）
 * 每兩位加入語音的玩家之間建立一條連線。誰可以對誰說話由伺服器決定（state.voice.talkTo / hearFrom），
 * 不該被聽到時，送出的聲音直接關閉（在說話者這端就擋掉）。
 */
(() => {
  'use strict';
  const V = {
    joined: false,
    muted: false,
    mic: null, // 麥克風 MediaStream
    micError: null,
    peers: new Map(), // peerId -> { pc, initiator, track, audio, pending }
    state: null,
    ice: null,
    ctx: null,
    meters: new Map(), // id -> { analyser, data }
    speaking: new Set(),
  };
  let socket = null;
  let onChange = () => {};
  let onSpeaking = () => {};

  const send = (to, data) => socket.emit('rtc', { to, data });

  V.supported = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  V.secure = () => window.isSecureContext;

  V.init = (s, changeCb, speakingCb) => {
    socket = s;
    onChange = changeCb || onChange;
    onSpeaking = speakingCb || onSpeaking;
    socket.on('rtc', (m) => handleSignal(m).catch((e) => console.warn('[voice]', e)));
    // 斷線重連後自動回到語音
    socket.on('connect', () => { if (V.joined) { closeAll(); socket.emit('voice', { on: true }, () => {}); } });
  };

  V.join = async () => {
    if (!V.secure()) throw new Error('insecure');
    if (!V.supported()) throw new Error('unsupported');
    try {
      V.ice = (await (await fetch('/api/ice')).json()).iceServers;
    } catch {
      V.ice = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    V.micError = null;
    try {
      V.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      V.mic = null;
      V.micError = e.name || 'error';
    }
    try {
      V.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (V.ctx.state === 'suspended') await V.ctx.resume();
    } catch { V.ctx = null; }
    if (V.mic) meter('me', V.mic);
    V.joined = true;
    V.muted = false;
    socket.emit('voice', { on: true }, () => {});
    startMeterLoop();
    onChange();
  };

  V.leave = () => {
    V.joined = false;
    closeAll();
    V.mic?.getTracks().forEach((t) => t.stop());
    V.mic = null;
    try { V.ctx?.close(); } catch {}
    V.ctx = null;
    V.meters.clear();
    V.speaking.clear();
    socket.emit('voice', { on: false }, () => {});
    onSpeaking(V.speaking);
    onChange();
  };

  V.toggleMute = () => {
    V.muted = !V.muted;
    applyPolicy();
    onChange();
  };

  // 每次收到新的遊戲狀態就呼叫
  V.update = (S) => {
    V.state = S;
    if (!V.joined || !S?.voice) return;
    const members = new Set(S.voice.members);
    if (!members.has(S.you)) return; // 伺服器還沒登記我加入語音
    // 由 id 較小的一方主動發起連線，避免雙方同時發起
    for (const id of members) {
      if (id === S.you) continue;
      if (S.you < id && !V.peers.has(id)) offerTo(id);
    }
    for (const id of [...V.peers.keys()]) if (!members.has(id)) closePeer(id);
    applyPolicy();
  };

  function newPeer(id, initiator) {
    closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: V.ice || [] });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const track = V.mic ? V.mic.getAudioTracks()[0].clone() : null;
    const peer = { pc, initiator, track, audio, pending: [] };
    V.peers.set(id, peer);

    pc.onicecandidate = (e) => { if (e.candidate) send(id, { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {});
      meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        closePeer(id);
        if (initiator && V.joined) setTimeout(() => V.update(V.state), 1500); // 重新連線
      }
    };
    return peer;
  }

  async function offerTo(id) {
    const peer = newPeer(id, true);
    const t = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (peer.track) await t.sender.replaceTrack(peer.track);
    applyPolicy();
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    send(id, { desc: peer.pc.localDescription.toJSON ? peer.pc.localDescription.toJSON() : peer.pc.localDescription });
  }

  async function handleSignal({ from, data }) {
    if (!V.joined || !data) return;
    if (data.desc?.type === 'offer') {
      const peer = newPeer(from, false);
      const pc = peer.pc;
      await pc.setRemoteDescription(data.desc);
      const t = pc.getTransceivers()[0];
      if (t) {
        t.direction = 'sendrecv';
        if (peer.track) await t.sender.replaceTrack(peer.track);
      }
      applyPolicy();
      await pc.setLocalDescription(await pc.createAnswer());
      send(from, { desc: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
      flush(peer);
    } else if (data.desc?.type === 'answer') {
      const peer = V.peers.get(from);
      if (peer && peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription(data.desc);
        flush(peer);
      }
    } else if (data.candidate) {
      const peer = V.peers.get(from);
      if (!peer) return;
      if (peer.pc.remoteDescription) peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  }

  function flush(peer) {
    for (const c of peer.pending.splice(0)) peer.pc.addIceCandidate(c).catch(() => {});
  }

  function closePeer(id) {
    const p = V.peers.get(id);
    if (!p) return;
    V.peers.delete(id);
    try { p.pc.close(); } catch {}
    p.track?.stop();
    p.audio.srcObject = null;
    p.audio.remove();
    V.meters.delete(id);
  }
  function closeAll() { for (const id of [...V.peers.keys()]) closePeer(id); }

  // 依伺服器的規則開關聲音：送出端關掉不該送的，接收端也靜音不該聽的
  function applyPolicy() {
    const v = V.state?.voice;
    if (!v) return;
    for (const [id, p] of V.peers) {
      if (p.track) p.track.enabled = v.talkTo.includes(id) && !V.muted;
      p.audio.muted = !v.hearFrom.includes(id);
    }
  }

  V.canTalk = () => !!V.state?.voice?.mode && !!V.mic;

  // ---------- 說話指示燈 ----------
  function meter(id, stream) {
    if (!V.ctx) return;
    try {
      const src = V.ctx.createMediaStreamSource(stream);
      const analyser = V.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      V.meters.set(id, { analyser, data: new Uint8Array(analyser.fftSize) });
    } catch {}
  }

  let loop = null;
  function startMeterLoop() {
    if (loop) return;
    loop = setInterval(() => {
      if (!V.joined) { clearInterval(loop); loop = null; return; }
      const v = V.state?.voice;
      const now = new Set();
      for (const [id, m] of V.meters) {
        m.analyser.getByteTimeDomainData(m.data);
        let sum = 0;
        for (const x of m.data) sum += (x - 128) * (x - 128);
        const rms = Math.sqrt(sum / m.data.length);
        const audible = id === 'me' ? !!v?.mode && !V.muted : !!v?.hearFrom.includes(id);
        if (rms > 6 && audible) now.add(id === 'me' ? V.state.you : id);
      }
      const changed = now.size !== V.speaking.size || [...now].some((x) => !V.speaking.has(x));
      V.speaking = now;
      if (changed) onSpeaking(now);
    }, 150);
  }

  window.Voice = V;
})();
