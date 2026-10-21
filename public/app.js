/* 月夜狼人殺：前端 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const ROLE = {
    werewolf: { name: '狼人', icon: '🐺', desc: '每晚和隊友一起選一個人殺掉。白天隱藏身分，想辦法讓好人被投出去。', team: 'wolf' },
    villager: { name: '村民', icon: '🧑‍🌾', desc: '沒有特殊技能，靠發言推理和投票找出狼人。', team: 'good' },
    seer: { name: '預言家', icon: '🔮', desc: '每晚可以查驗一位玩家，知道他是好人還是狼人。', team: 'good' },
    witch: { name: '女巫', icon: '🧪', desc: '有一瓶解藥和一瓶毒藥，各只能用一次；同一晚只能用一瓶，不能救自己。', team: 'good' },
    hunter: { name: '獵人', icon: '🏹', desc: '被狼人殺死或被投票出局時，可以開槍帶走一人（被毒死不能開槍）。', team: 'good' },
  };

  const RULES = `
    <ul>
      <li>遊戲分成「黑夜」和「白天」輪流進行。</li>
      <li><b>黑夜</b>：狼人選一人殺害；預言家查驗一人；女巫決定要不要用藥。</li>
      <li><b>白天</b>：公布昨晚死者，存活玩家依序發言，最後投票放逐一人（平票則無人出局）。</li>
      <li>第一晚死亡的玩家、以及被放逐的玩家，可以留下遺言。</li>
      <li><b>好人勝利</b>：所有狼人出局。</li>
      <li><b>狼人勝利</b>：所有村民出局，或所有神職（預言家、女巫、獵人）出局（屠邊）。</li>
      <li>建議大家同時開 LINE 或 Discord 語音，輪到誰發言就由誰說話。</li>
    </ul>`;

  const STEP_TITLE = {
    reveal: '查看身分',
    night_act: '黑夜',
    night_witch: '黑夜',
    announce: '天亮了',
    hunter: '技能發動',
    lastwords: '遺言',
    discuss: '輪流發言',
    vote: '投票',
    vote_result: '投票結果',
  };

  // ---------- 狀態 ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  let S = null; // 伺服器送來的狀態
  let clockOffset = 0;
  let sel = null; // 目前選取的玩家
  let lastStepKey = '';
  let roleCovered = false;
  let activeTab = 'chat';
  let seenChat = 0;
  let sound = load('ww_sound') === '1';

  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  // ---------- 小工具 ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function emit(ev, data) {
    return new Promise((resolve) => {
      socket.emit(ev, data || {}, (res) => {
        if (res && !res.ok) toast(res.error);
        resolve(res);
      });
    });
  }
  function speak(text) {
    if (!sound || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      u.rate = 0.95;
      speechSynthesis.speak(u);
    } catch {}
  }
  function buzz() { try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch {} }

  const me = () => S.players.find((p) => p.id === S.you);
  const P = (id) => S.players.find((p) => p.id === id);
  const label = (p) => (p ? `${p.seat} 號 ${p.name}` : '');
  const isHost = () => S.hostId === S.you;

  // ---------- 首頁 ----------
  $('#rulesBody').innerHTML = RULES;
  $('#nameInput').value = load('ww_name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) $('#codeInput').value = urlRoom;

  function getName() {
    const n = $('#nameInput').value.trim();
    if (!n) { toast('請先輸入暱稱'); $('#nameInput').focus(); return null; }
    save('ww_name', n);
    return n;
  }

  // ---------- 連線 ----------
  socket.on('connect', () => {
    const code = load('ww_code');
    const token = load('ww_token');
    if (code && token) {
      socket.emit('resume', { code, token }, (res) => {
        if (!res.ok) { save('ww_code', null); save('ww_token', null); showHome(); }
      });
    }
  });
  socket.on('disconnect', () => { if (S) toast('連線中斷，正在重新連線…'); });
  socket.on('joined', ({ code, token }) => {
    save('ww_code', code);
    save('ww_token', token);
    history.replaceState(null, '', `?room=${code}`);
  });
  socket.on('kicked', (msg) => {
    save('ww_code', null); save('ww_token', null);
    S = null;
    showHome();
    toast(msg);
  });
  socket.on('err', toast);
  socket.on('state', (state) => {
    clockOffset = state.now - Date.now();
    const prev = S;
    S = state;
    onStateChange(prev);
    render();
  });

  function showHome() {
    $('#home').classList.remove('hidden');
    $('#game').classList.add('hidden');
    document.body.className = 'theme-night';
  }

  function onStateChange(prev) {
    const key = `${S.phase}|${S.step}|${S.speaker}|${S.nightNo}`;
    if (key === lastStepKey) return;
    lastStepKey = key;
    sel = null;
    const m = me();
    if (prev && prev.step !== S.step && ['reveal', 'night_act', 'announce', 'vote'].includes(S.step)) window.scrollTo({ top: 0, behavior: 'smooth' });
    if (S.step === 'reveal') { roleCovered = false; speak('遊戲開始，請查看你的身分'); }
    if (S.step === 'night_act' && prev?.step !== 'night_act') speak('天黑請閉眼');
    if (S.step === 'announce' && prev?.phase === 'night') speak('天亮了');
    if (S.step === 'vote') speak('請開始投票');
    if (S.phase === 'ended' && prev?.phase !== 'ended') speak(S.winner === 'good' ? '好人陣營獲勝' : '狼人陣營獲勝');
    const myTurn =
      (S.speaker === S.you && (S.step === 'discuss' || S.step === 'lastwords')) ||
      (S.step === 'night_act' && m.alive && ['werewolf', 'seer'].includes(S.role)) ||
      (S.step === 'night_witch' && m.alive && S.role === 'witch' && S.witch && !S.witch.done && (S.witch.hasSave || S.witch.hasPoison)) ||
      (S.step === 'hunter' && S.hunterTurn) ||
      (S.step === 'vote' && m.alive);
    if (myTurn) buzz();
    if (S.speaker === S.you && S.step === 'discuss') speak('輪到你發言了');
  }

  // ---------- 畫面 ----------
  function render() {
    if (!S) return;
    $('#home').classList.add('hidden');
    $('#game').classList.remove('hidden');
    document.body.className = S.phase === 'night' || S.phase === 'lobby' ? 'theme-night' : 'theme-day';
    if (S.phase === 'ended') document.body.className = S.winner === 'wolf' ? 'theme-night' : 'theme-day';

    $('#roomCode').textContent = S.code;
    $('#soundBtn').textContent = sound ? '🔊' : '🔈';
    renderPhase();
    renderBanner();
    renderMyRole();
    renderLobby();
    renderPlayers();
    renderActions();
    renderChat();
    renderLog();
    tick();
  }

  function renderPhase() {
    let t = '';
    if (S.phase === 'lobby') t = '等待玩家加入';
    else if (S.phase === 'ended') t = '遊戲結束';
    else if (S.phase === 'night') t = `第 ${S.nightNo} 夜`;
    else t = `第 ${S.nightNo} 天 · ${STEP_TITLE[S.step] || ''}`;
    if (S.step === 'reveal') t = '查看身分';
    $('#phaseLabel').textContent = t;
  }

  function renderBanner() {
    let h = '', p = '';
    const m = me();
    if (S.phase === 'lobby') {
      h = '大廳';
      p = isHost() ? `人到齊後按「開始遊戲」（${S.minPlayers}–${S.maxPlayers} 人）` : '等待房主開始遊戲…';
    } else if (S.phase === 'ended') {
      h = '';
    } else if (S.step === 'reveal') {
      h = '身分已發放'; p = '記住自己的身分，別讓別人看到喔';
    } else if (S.phase === 'night') {
      h = '🌙 天黑請閉眼';
      p = m.alive ? '有技能的角色請行動，其他人請耐心等待' : '你已經出局，可以在亡者頻道聊天';
    } else if (S.step === 'announce') {
      const last = S.log[S.log.length - 1];
      h = '☀️ 天亮了'; p = last ? last.text : '';
    } else if (S.step === 'hunter') {
      h = '🏹 有人發動技能'; p = '請等待…';
    } else if (S.step === 'discuss' || S.step === 'lastwords') {
      const sp = P(S.speaker);
      h = S.step === 'lastwords' ? `${label(sp)} 留遺言` : `${label(sp)} 發言中`;
      p = S.speaker === S.you ? '輪到你了！說完請按「結束發言」' : '請仔細聆聽';
    } else if (S.step === 'vote') {
      h = '🗳️ 投票放逐'; p = `已投票 ${S.votedCount || 0} / ${S.aliveCount || 0}`;
    } else if (S.step === 'vote_result') {
      const ex = S.lastVote && P(S.lastVote.exiled);
      h = ex ? `${label(ex)} 被放逐` : '沒有人出局'; p = '票數顯示在玩家卡片上';
    }
    $('#banner').innerHTML = h || p ? `<h2>${esc(h)}</h2>${p ? `<p>${esc(p)}</p>` : ''}` : '';
  }

  function renderMyRole() {
    const box = $('#myRole');
    if (!S.role || S.phase === 'lobby') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const r = ROLE[S.role];
    if (S.step === 'reveal') {
      box.className = 'hidden';
      return;
    }
    box.className = `my-role ${r.team === 'wolf' ? 'wolf' : ''} ${roleCovered ? 'covered' : ''} ${me().alive ? '' : 'dead'}`;
    let extra = '';
    if (S.role === 'werewolf') {
      const mates = S.players.filter((p) => p.role === 'werewolf' && p.id !== S.you).map((p) => `${p.seat}號`);
      extra = mates.length ? `　隊友：${mates.join('、')}` : '';
    }
    if (S.role === 'witch' && S.witch) extra = `　解藥 ${S.witch.hasSave ? '✓' : '✗'}　毒藥 ${S.witch.hasPoison ? '✓' : '✗'}`;
    box.innerHTML = `<div class="r-icon">${roleCovered ? '🂠' : r.icon}</div>
      <div><div class="r-name">${esc(r.name)}${me().alive ? '' : '（已出局）'}</div>
      <div class="r-desc">${esc(r.desc)}${esc(extra)}</div></div>`;
    box.title = '點一下可以遮住／顯示身分';
  }

  function renderLobby() {
    const el = $('#lobbyPanel');
    if (S.phase === 'ended') {
      el.innerHTML = `<div class="win ${S.winner}"><h2>${S.winner === 'good' ? '🎉 好人陣營獲勝' : '🐺 狼人陣營獲勝'}</h2>
        <p>所有人的身分已公開</p></div>`;
      return;
    }
    if (S.step === 'reveal') {
      const r = ROLE[S.role];
      let extra = '';
      if (S.role === 'werewolf') {
        const mates = S.players.filter((p) => p.role === 'werewolf' && p.id !== S.you);
        extra = mates.length ? `<p>你的狼隊友：${mates.map((p) => esc(label(p))).join('、')}</p>` : '';
      }
      el.innerHTML = `<div class="reveal-card ${r.team}"><div class="r-icon">${r.icon}</div>
        <div>你的身分是</div><div class="r-name">${r.name}</div><p>${esc(r.desc)}</p>${extra}
        <p class="setup-line">本局配置：${esc(S.setupText)}</p></div>`;
      return;
    }
    if (S.phase !== 'lobby') { el.innerHTML = ''; return; }
    const link = `${location.origin}/?room=${S.code}`;
    const s = S.settings, su = S.setup;
    const sw = (k, on) => `<button class="switch ${on ? 'on' : ''}" data-action="setting" data-key="${k}" data-val="${!on}" aria-label="${k}"></button>`;
    const setupLine = `狼人 ×${su.wolves}${su.seer ? '、預言家' : ''}${su.witch ? '、女巫' : ''}${su.hunter ? '、獵人' : ''}、村民 ×${Math.max(0, su.villagers)}`;
    let settings = '';
    if (isHost()) {
      settings = `<div class="settings"><h3>遊戲設定</h3>
        <div class="setrow"><span>依人數自動配置角色</span>${sw('autoSetup', s.autoSetup)}</div>
        ${s.autoSetup ? '' : `
        <div class="setrow"><span>狼人數量</span><div class="stepper">
          <button data-action="setting" data-key="wolves" data-val="${s.wolves - 1}">−</button><b>${s.wolves}</b>
          <button data-action="setting" data-key="wolves" data-val="${s.wolves + 1}">＋</button></div></div>
        <div class="setrow"><span>預言家</span>${sw('seer', s.seer)}</div>
        <div class="setrow"><span>女巫</span>${sw('witch', s.witch)}</div>
        <div class="setrow"><span>獵人</span>${sw('hunter', s.hunter)}</div>`}
        <div class="setrow"><span>每人發言時間</span>
          <select data-action="speakTime">${[30, 60, 90, 120, 180].map((v) => `<option value="${v}" ${v === s.speakTime ? 'selected' : ''}>${v} 秒</option>`).join('')}</select></div>
        <div class="setrow"><span class="setup-line">${esc(setupLine)}</span></div>
      </div>`;
    } else {
      settings = `<div class="settings"><h3>本局配置</h3><div class="setup-line">${esc(setupLine)}　·　發言 ${s.speakTime} 秒</div></div>`;
    }
    el.innerHTML = `<div class="invite"><div>
        <div class="setup-line">房號</div><div class="big-code">${S.code}</div>
        <button class="btn small" data-action="copy" data-link="${esc(link)}">複製邀請連結</button>
      </div><img alt="掃描加入" src="/qr?text=${encodeURIComponent(link)}"></div>${settings}`;
  }

  function pickMode() {
    // 回傳 { kind, filter(p) } 代表現在可以點選玩家
    const m = me();
    if (!m) return null;
    const aliveOther = (p) => p.alive && p.id !== S.you;
    if (S.step === 'night_act' && m.alive) {
      if (S.role === 'werewolf') return { kind: 'wolf', filter: (p) => p.alive };
      if (S.role === 'seer' && !S.seer?.doneTonight) return { kind: 'seer', filter: aliveOther };
    }
    if (S.step === 'night_witch' && m.alive && S.role === 'witch' && S.witch && !S.witch.done && S.witch.hasPoison) return { kind: 'poison', filter: aliveOther };
    if (S.step === 'hunter' && S.hunterTurn) return { kind: 'hunter', filter: aliveOther };
    if (S.step === 'vote' && m.alive) return { kind: 'vote', filter: (p) => p.alive };
    return null;
  }

  function renderPlayers() {
    const mode = pickMode();
    const seerMap = {};
    (S.seer?.results || []).forEach((r) => (seerMap[r.target] = r.wolf));
    const wolfPicks = {};
    if (S.wolfVotes) for (const [w, t] of Object.entries(S.wolfVotes)) if (t) (wolfPicks[t] = wolfPicks[t] || []).push(P(w)?.seat);
    const tally = S.step === 'vote_result' && S.lastVote ? S.lastVote.tally : null;
    const voteFor = {};
    if (S.step === 'vote_result' && S.lastVote) for (const [v, t] of Object.entries(S.lastVote.votes)) if (t) (voteFor[t] = voteFor[t] || []).push(P(v)?.seat);

    $('#players').innerHTML = S.players.map((p) => {
      const can = mode && mode.filter(p);
      const cls = ['p', p.alive ? '' : 'dead', can ? 'pick' : '', sel === p.id ? 'sel' : '', S.speaker === p.id ? 'speaking' : '', p.id === S.you ? 'me' : ''].join(' ');
      const tags = [];
      if (p.id === S.hostId && S.phase === 'lobby') tags.push('<span class="tag host">房主</span>');
      if (p.id === S.you) tags.push('<span class="tag">你</span>');
      if (!p.connected) tags.push('<span class="tag off">離線</span>');
      if (p.role && (p.id !== S.you || S.phase === 'ended')) tags.push(`<span class="tag ${ROLE[p.role].team === 'wolf' ? 'wolf' : 'good'}">${ROLE[p.role].name}</span>`);
      if (p.id in seerMap && S.phase !== 'ended') tags.push(`<span class="tag ${seerMap[p.id] ? 'wolf' : 'good'}">${seerMap[p.id] ? '查殺' : '金水'}</span>`);
      if (!p.alive) tags.push('<span class="tag">💀 出局</span>');
      if (S.speaker === p.id) tags.push('<span class="tag good">🎤 發言</span>');
      if (voteFor[p.id]) tags.push(`<span class="tag">←${voteFor[p.id].join(',')}</span>`);
      const kick = S.phase === 'lobby' && isHost() && p.id !== S.you ? `<button class="kick" data-action="kick" data-id="${p.id}" title="請出房間">✕</button>` : '';
      const picks = wolfPicks[p.id] ? `<span class="picks">🐺${wolfPicks[p.id].join(',')}</span>` : '';
      const badge = tally && tally[p.id] ? `<span class="votes-badge">${tally[p.id]} 票</span>` : '';
      return `<div class="${cls}" ${can ? `data-action="pick" data-id="${p.id}"` : ''}>
        ${picks}${badge}${kick}
        <div class="seat">${p.seat}</div>
        <div class="name">${esc(p.name)}</div>
        <div class="tags">${tags.join('')}</div></div>`;
    }).join('');
  }

  function box(title, desc, buttons) {
    return `<div class="act-box">${title ? `<h3>${title}</h3>` : ''}${desc ? `<p>${desc}</p>` : ''}${buttons ? `<div class="btn-row">${buttons}</div>` : ''}</div>`;
  }
  const selName = () => (sel ? esc(label(P(sel))) : '');

  function renderActions() {
    const m = me();
    const out = [];
    const hostSkip = isHost() && S.phase !== 'lobby' && S.phase !== 'ended' && !['night_act', 'night_witch'].includes(S.step);

    if (S.phase === 'lobby') {
      if (isHost()) {
        out.push(`<div class="btn-row">
          <button class="btn primary big" data-action="start" ${S.players.length < S.minPlayers ? 'disabled' : ''}>開始遊戲（${S.players.length} 人）</button></div>
          <div class="btn-row"><button class="btn small" data-action="shuffle">隨機排座位</button></div>`);
      }
    } else if (S.phase === 'ended') {
      if (isHost()) out.push(`<button class="btn primary big" data-action="lobby">再來一局</button>`);
      else out.push(box('', '等待房主開始下一局…'));
    } else if (S.step === 'night_act' && m.alive && S.role === 'werewolf') {
      const myPick = S.wolfVotes?.[S.you];
      const status = myPick === undefined ? '尚未決定' : myPick === null ? '你選擇空刀' : `你選了 ${esc(label(P(myPick)))}`;
      out.push(box('🐺 狼人請選擇今晚的目標', `點選玩家後按確認。隊友的選擇會顯示在卡片左上角，大家要選同一人。（${status}）`,
        `<button class="btn danger" data-action="wolf" ${sel ? '' : 'disabled'}>確認擊殺 ${selName()}</button>
         <button class="btn" data-action="wolfNone">今晚空刀</button>`));
    } else if (S.step === 'night_act' && m.alive && S.role === 'seer') {
      const r = S.seer.results.filter((x) => x.night === S.nightNo)[0];
      if (r) out.push(box('🔮 查驗結果', `<span class="result">${esc(label(P(r.target)))} 是 <b class="${r.wolf ? 'wolf' : 'good'}">${r.wolf ? '狼人' : '好人'}</b></span>`));
      else out.push(box('🔮 預言家請查驗一位玩家', '點選一位玩家後按「查驗」', `<button class="btn primary" data-action="seer" ${sel ? '' : 'disabled'}>查驗 ${selName()}</button>`));
    } else if (S.step === 'night_witch' && m.alive && S.role === 'witch' && (S.witch.hasSave || S.witch.hasPoison || S.witch.done)) {
      const w = S.witch;
      if (w.done) out.push(box('🧪 女巫', '你已經做出決定，等待天亮…'));
      else {
        let info;
        if (w.noInfo || !w.hasSave) info = '解藥已用完，你無法得知今晚誰被殺。';
        else if (w.killed) info = `今晚被殺的是：<b>${esc(label(P(w.killed)))}</b>`;
        else info = '今晚是平安夜，沒有人被殺。';
        const canSave = w.hasSave && w.killed && w.killed !== S.you;
        const selfNote = w.hasSave && w.killed === S.you ? '（女巫不能自救）' : '';
        out.push(box('🧪 女巫請決定', `${info}${selfNote}<br>要毒人請先點選玩家。同一晚只能使用一瓶藥。`,
          `${canSave ? `<button class="btn good" data-action="save">使用解藥</button>` : ''}
           ${w.hasPoison ? `<button class="btn danger" data-action="poison" ${sel ? '' : 'disabled'}>毒死 ${selName()}</button>` : ''}
           <button class="btn" data-action="witchSkip">不使用</button>`));
      }
    } else if (S.step === 'reveal') {
      // 身分卡已顯示
    } else if (S.phase === 'night') {
      out.push(box('', m.alive ? '😴 請閉眼，等待天亮…' : '👻 你已出局，請安靜觀戰'));
    } else if (S.step === 'hunter') {
      if (S.hunterTurn) out.push(box('🏹 你是獵人，可以開槍帶走一人', '點選玩家後按「開槍」，或選擇不開槍。',
        `<button class="btn danger" data-action="shoot" ${sel ? '' : 'disabled'}>開槍 ${selName()}</button>
         <button class="btn" data-action="noShoot">不開槍</button>`));
    } else if (S.step === 'discuss' || S.step === 'lastwords') {
      const order = S.speakOrder.map((id) => {
        const p = P(id);
        const idx = S.speakOrder.indexOf(S.speaker);
        const i = S.speakOrder.indexOf(id);
        return `<span class="${id === S.speaker ? 'now' : i < idx ? 'done' : ''}">${p.seat}號</span>`;
      }).join('');
      const mine = S.speaker === S.you;
      out.push(`<div class="act-box">${mine ? `<h3>🎤 輪到你發言</h3><p>用語音或在聊天室說出你的想法。</p>
        <div class="btn-row"><button class="btn primary" data-action="endSpeech">結束發言</button></div>` : '<p>發言順序</p>'}
        <div class="order">${order}</div></div>`);
    } else if (S.step === 'vote' && m.alive) {
      const v = S.myVote;
      const status = v === undefined ? '你還沒投票' : v === null ? '你選擇棄票' : `你投給了 ${esc(label(P(v)))}`;
      out.push(box('🗳️ 投票放逐你懷疑的人', `點選玩家後按「投票」。投票後還可以改。（${status}）`,
        `<button class="btn danger" data-action="vote" ${sel ? '' : 'disabled'}>投給 ${selName()}</button>
         <button class="btn" data-action="abstain">棄票</button>`));
    } else if (S.step === 'vote' && !m.alive) {
      out.push(box('', '出局的玩家不能投票'));
    }

    if (hostSkip) out.push(`<div class="btn-row"><button class="btn small" data-action="skip">⏭ 房主：跳過這個階段</button></div>`);
    $('#actions').innerHTML = out.join('');
  }

  function renderChat() {
    const list = $('#chatList');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const chName = { all: '', wolf: '狼', dead: '亡' };
    list.innerHTML = S.chat.length
      ? S.chat.map((m) => `<div class="msg ch-${m.ch}">${chName[m.ch] ? `<span class="chn">${chName[m.ch]}</span>` : ''}<span class="who">${m.seat}號 ${esc(m.name)}</span>${esc(m.text)}</div>`).join('')
      : '<div class="empty">還沒有訊息</div>';
    if (atBottom) list.scrollTop = list.scrollHeight;

    const ch = S.chatChannel;
    const input = $('#chatInput');
    const tag = { all: '全體', wolf: '狼隊頻道', dead: '亡者頻道' }[ch] || '';
    $('#chatCh').textContent = tag;
    input.disabled = !ch;
    input.placeholder = ch ? '輸入訊息…' : '天黑了，請保持安靜';

    const last = S.chat.length ? S.chat[S.chat.length - 1].id : null;
    if (activeTab === 'chat') seenChat = last;
    $('#unread').classList.toggle('hidden', !last || last === seenChat);
  }

  function renderLog() {
    const list = $('#logList');
    list.innerHTML = S.log.length
      ? S.log.map((l) => `<div class="log-item"><time>${new Date(l.t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</time>${esc(l.text)}</div>`).join('')
      : '<div class="empty">還沒有紀錄</div>';
    list.scrollTop = list.scrollHeight;
  }

  function tick() {
    const el = $('#timer');
    if (!S || !S.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((S.deadline - (Date.now() + clockOffset)) / 1000));
    el.textContent = left + 's';
    el.classList.toggle('urgent', left <= 10);
  }
  setInterval(tick, 250);

  // ---------- 互動 ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) {
      if (e.target.closest('#myRole')) { roleCovered = !roleCovered; renderMyRole(); }
      return;
    }
    const a = t.dataset.action;
    switch (a) {
      case 'create': { const name = getName(); if (name) emit('create', { name }); break; }
      case 'join': {
        const name = getName();
        const code = $('#codeInput').value.trim();
        if (!name) break;
        if (!/^\d{4}$/.test(code)) { toast('請輸入 4 位數房號'); break; }
        emit('join', { code, name });
        break;
      }
      case 'leave':
        if (!confirmLeave()) break;
        await emit('leave');
        save('ww_code', null); save('ww_token', null);
        S = null;
        history.replaceState(null, '', '/');
        showHome();
        break;
      case 'sound':
        sound = !sound;
        save('ww_sound', sound ? '1' : '0');
        t.textContent = sound ? '🔊' : '🔈';
        if (sound) speak('旁白已開啟');
        break;
      case 'copy': {
        const link = t.dataset.link;
        try { await navigator.clipboard.writeText(link); toast('已複製邀請連結'); }
        catch { prompt('複製這個連結傳給朋友：', link); }
        break;
      }
      case 'setting': {
        let v = t.dataset.val;
        if (v === 'true' || v === 'false') v = v === 'true';
        else v = Number(v);
        emit('settings', { [t.dataset.key]: v });
        break;
      }
      case 'kick': emit('kick', { target: t.dataset.id }); break;
      case 'shuffle': emit('shuffleSeats'); break;
      case 'start': emit('start'); break;
      case 'lobby': emit('lobby'); break;
      case 'skip': emit('act', { type: 'skip' }); break;
      case 'pick':
        sel = sel === t.dataset.id ? null : t.dataset.id;
        renderPlayers(); renderActions();
        break;
      case 'wolf': emit('act', { type: 'wolfVote', target: sel }); break;
      case 'wolfNone': emit('act', { type: 'wolfVote', target: null }); break;
      case 'seer': emit('act', { type: 'seerCheck', target: sel }); break;
      case 'save': emit('act', { type: 'witch', save: true }); break;
      case 'poison': emit('act', { type: 'witch', poison: true, target: sel }); break;
      case 'witchSkip': emit('act', { type: 'witch', skip: true }); break;
      case 'shoot': emit('act', { type: 'hunterShoot', target: sel }); break;
      case 'noShoot': emit('act', { type: 'hunterShoot', target: null }); break;
      case 'endSpeech': emit('act', { type: 'endSpeech' }); break;
      case 'vote': emit('act', { type: 'vote', target: sel }); break;
      case 'abstain': emit('act', { type: 'vote', target: null }); break;
    }
  });

  function confirmLeave() {
    if (!S || S.phase === 'lobby' || S.phase === 'ended') return true;
    return confirm('遊戲進行中，確定要離開嗎？');
  }

  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-action="speakTime"]')) emit('settings', { speakTime: Number(e.target.value) });
  });

  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.querySelector('[data-action="join"]').click(); });

  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    const res = await emit('chat', { text });
    if (res?.ok) input.value = '';
  });

  document.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      $('#chatPanel').classList.toggle('hidden', activeTab !== 'chat');
      $('#logPanel').classList.toggle('hidden', activeTab !== 'log');
      if (S) { renderChat(); renderLog(); }
    }),
  );

  // 手機從背景回來時，確保有連線
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !socket.connected) socket.connect(); });
})();
