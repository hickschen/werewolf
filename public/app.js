/* 月夜狼人殺：前端 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s) || DUMMY;
  // 找不到元素時用的替身，避免整個畫面因為一個元素不存在而壞掉
  const DUMMY = { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, set innerHTML(v) {}, get innerHTML() { return ''; },
    set textContent(v) {}, get textContent() { return ''; }, style: {}, dataset: {}, addEventListener() {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0, value: '' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const ROLE = {
    werewolf: { name: '狼人', icon: '🐺', team: 'wolf', desc: '每晚和隊友一起選一個人殺掉。白天隱藏身分，想辦法讓好人被投出去。' },
    wolfKing: { name: '狼王', icon: '👑', team: 'wolf', desc: '和狼人一起殺人。被殺死或被放逐時可以開槍帶走一人（被毒死不能開槍）。' },
    whiteWolfKing: { name: '白狼王', icon: '💥', team: 'wolf', desc: '和狼人一起殺人。白天發言或投票時可以自爆，帶走一名玩家，當天直接進入黑夜。' },
    villager: { name: '村民', icon: '🧑‍🌾', team: 'good', desc: '沒有特殊技能，靠發言推理和投票找出狼人。' },
    seer: { name: '預言家', icon: '🔮', team: 'good', desc: '每晚可以查驗一位玩家，知道他是好人還是狼人。' },
    witch: { name: '女巫', icon: '🧪', team: 'good', desc: '有一瓶解藥和一瓶毒藥，各只能用一次；同一晚只能用一瓶，不能救自己。' },
    hunter: { name: '獵人', icon: '🏹', team: 'good', desc: '被狼人殺死或被投票出局時，可以開槍帶走一人（被毒死不能開槍）。' },
    guard: { name: '守衛', icon: '🛡️', team: 'good', desc: '每晚守護一人不被狼人殺害，可以守自己，但不能連續兩晚守同一人。' },
    gravekeeper: { name: '守墓人', icon: '🪦', team: 'good', desc: '每晚會得知前一天被投票放逐的人是好人還是狼人。' },
    knight: { name: '騎士', icon: '⚔️', team: 'good', desc: '白天發言階段可以和一人決鬥（整局一次）：對方是狼人就出局並直接入夜；對方是好人則騎士以死謝罪。' },
  };
  const isWolfRole = (r) => ROLE[r]?.team === 'wolf';
  const ROLE_ORDER = ['werewolf', 'wolfKing', 'whiteWolfKing', 'villager', 'seer', 'witch', 'hunter', 'guard', 'gravekeeper', 'knight'];
  const GOD_KEYS = ['seer', 'witch', 'hunter', 'guard', 'gravekeeper', 'knight'];

  // 與伺服器相同的自動配置規則（只用來顯示規則頁的表格）
  function autoSetup(n) {
    const wolves = n <= 5 ? 1 : n <= 7 ? 2 : n <= 10 ? 3 : n <= 14 ? 4 : n <= 17 ? 5 : 6;
    const s = { wolfKing: n === 9 || n === 11 || n >= 14, whiteWolfKing: n === 10 || n >= 12, seer: true, witch: true,
      hunter: n >= 7, guard: n >= 10, gravekeeper: n >= 13, knight: n >= 15 };
    const plain = wolves - (s.wolfKing ? 1 : 0) - (s.whiteWolfKing ? 1 : 0);
    const gods = GOD_KEYS.filter((k) => s[k]);
    const villagers = n - wolves - gods.length;
    return [s.wolfKing && '狼王', s.whiteWolfKing && '白狼王', plain > 0 && `狼人 ×${plain}`,
      ...gods.map((k) => ROLE[k].name), villagers > 0 && `村民 ×${villagers}`].filter(Boolean).join('、');
  }
  function autoTable() {
    const rows = [];
    for (let n = 4; n <= 20; n++) {
      const t = autoSetup(n);
      rows.push({ n, t });
    }
    return rows.map((r) => `<tr><td>${r.n}</td><td>${esc(r.t)}</td></tr>`).join('');
  }

  function rulesHtml(setupText) {
    const roleCard = (k) => {
      const r = ROLE[k];
      return `<div class="rule-role ${r.team}"><div class="rr-icon">${r.icon}</div><div><b>${r.name}</b>
        <span class="tag ${r.team === 'wolf' ? 'wolf' : 'good'}">${r.team === 'wolf' ? '狼人陣營' : ['villager'].includes(k) ? '好人・平民' : '好人・神職'}</span>
        <p>${r.desc}</p></div></div>`;
    };
    return `
      ${setupText ? `<div class="rule-now">本局配置：${esc(setupText)}</div>` : ''}
      <h3>遊戲流程</h3>
      <ol>
        <li><b>發身分</b>：每個人只知道自己的身分，狼人會知道隊友是誰。</li>
        <li><b>黑夜</b>：狼人一起選一人殺害；預言家查驗一人；守衛守護一人；接著女巫決定要不要用藥。守墓人會得知昨天被放逐者的陣營。</li>
        <li><b>天亮</b>：公布昨晚死亡的玩家（不公布死因）。</li>
        <li><b>發言</b>：存活玩家依座位輪流發言。</li>
        <li><b>投票</b>：每人投一票放逐一人，可以棄票；最高票者出局，平票則無人出局。</li>
        <li>回到黑夜，重複直到分出勝負。</li>
      </ol>
      <h3>勝負條件（屠邊）</h3>
      <ul>
        <li>🎉 <b>好人勝利</b>：所有狼人陣營（含狼王、白狼王）都出局。</li>
        <li>🐺 <b>狼人勝利</b>：所有村民出局，<b>或</b>所有神職（預言家、女巫、獵人、守衛、守墓人、騎士）出局。</li>
      </ul>
      <h3>角色</h3>
      <div class="rule-roles">${ROLE_ORDER.map(roleCard).join('')}</div>
      <h3>細節規則</h3>
      <ul>
        <li><b>同守同救</b>：守衛守護的人同時被女巫救，這個人反而會死亡。</li>
        <li>守衛只能擋狼人的刀，擋不住女巫的毒藥。</li>
        <li>女巫的解藥用掉之後，就不會再知道每晚誰被殺。</li>
        <li>獵人、狼王被毒死時不能開槍；開槍後會公開身分。被開槍帶走的獵人或狼王也可以再開槍。</li>
        <li>白狼王自爆後不投票，直接進入黑夜；自爆不算被放逐，守墓人不會得到資訊。</li>
        <li>預言家查驗狼王、白狼王，結果都是「狼人」。</li>
        <li><b>騎士決鬥</b>只能在白天發言階段使用，整局一次。決鬥成功（對方是狼人）時當天不投票，直接進入黑夜；決鬥失敗則騎士出局，白天繼續。被決鬥的狼王可以開槍。</li>
        <li>第一晚死亡的玩家，以及白天被放逐的玩家，可以留遺言。</li>
        <li>出局的玩家不能再發言或投票，只能在「亡者頻道」聊天。</li>
        <li><b>語音</b>（需要 https 網址）：大廳和白天所有存活玩家都能說話；晚上只有狼人能說，而且只有狼隊友聽得到；出局的人只能聽，輪到留遺言時可以說話。</li>
      </ul>
      <h3>依人數自動配置</h3>
      <table class="rule-table"><tr><th>人數</th><th>配置</th></tr>
        ${autoTable()}
      </table>
      <p class="setup-line">房主可以關掉「依人數自動配置」，自己選擇角色。</p>
      <h3>小提醒</h3>
      <ul><li>建議大家同時開 LINE 或 Discord 語音，輪到誰發言就由誰說話。</li>
      <li>點一下自己的身分卡可以遮住身分，避免旁人偷看。</li></ul>`;
  }

  const STEP_TITLE = {
    reveal: '查看身分',
    night_act: '黑夜',
    night_witch: '黑夜',
    announce: '天亮了',
    shoot: '技能發動',
    lastwords: '遺言',
    discuss: '輪流發言',
    vote: '投票',
    vote_result: '投票結果',
  };

  // 語音模組載入失敗時的替身，遊戲照常可以玩
  const Voice = window.Voice || { joined: false, muted: false, speaking: new Set(), peers: new Map(), mic: null,
    init() {}, update() {}, secure: () => false, supported: () => false, join: async () => { throw new Error('unsupported'); }, leave() {}, toggleMute() {} };

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
  let publicUrl = null; // NAS 外網網址（如果有）
  fetch('/api/public-url').then((r) => r.json()).then((j) => { publicUrl = j.url; if (S) render(); }).catch(() => {});

  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  // ---------- 小工具 ----------
  function toast(msg) {
    const t = $('#toast');
    t.classList.remove('info');
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

  const me = () => S.players.find((p) => p.id === S.you) || S.self;
  const P = (id) => S.players.find((p) => p.id === id);
  const label = (p) => (p ? `${p.seat} 號 ${p.name}` : '');
  const isHost = () => S.hostId === S.you;

  // ---------- 首頁 ----------
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
    if (Voice.joined) Voice.leave();
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
    Voice.update(S);
  });

  // ---------- 語音 ----------
  Voice.init(socket, () => renderVoiceBar(), (set) => markSpeaking(set));

  function markSpeaking(set) {
    document.querySelectorAll('.p[data-pid]').forEach((el) => el.classList.toggle('talking', set.has(el.dataset.pid)));
  }

  function voiceStatus() {
    const v = S.voice || {};
    const m = me();
    if (S.phase === 'lobby' || S.phase === 'ended') return ['🎙️', '大家都可以說話'];
    if (S.phase === 'night') return v.mode === 'wolf' ? ['🐺', '狼隊語音：只有狼隊友聽得到你'] : ['🌙', '天黑了，麥克風已關閉'];
    if (S.spectator) return ['👀', '旁觀中：只能聽白天的討論'];
    if (v.mode && !m.alive) return ['🎤', '留遺言中，大家都聽得到你'];
    if (v.mode) return ['☀️', '白天：存活玩家都可以說話'];
    return ['👻', '你已出局，只能聽'];
  }

  function renderVoiceBar() {
    const el = $('#voiceBar');
    if (!S) { el.innerHTML = ''; return; }
    if (!Voice.joined) {
      const insecure = !Voice.secure();
      const alt = publicUrl && publicUrl !== location.origin ? `${publicUrl}/?room=${S.code}` : '';
      el.innerHTML = `<div class="vb-row"><span class="vb-icon">🎧</span>
        <span class="vb-text">${insecure ? '語音需要 https 網址才能使用' : '語音聊天（建議戴耳機）'}</span>
        ${insecure ? (alt ? `<a class="btn small" href="${esc(alt)}">改用 https 網址</a>` : '') : '<button class="btn small primary" data-action="voiceJoin">加入語音</button>'}</div>`;
      return;
    }
    const [icon, text] = voiceStatus();
    const v = S.voice || {};
    const talkable = !!v.mode && !!Voice.mic;
    const listeners = (v.hearFrom || []).length;
    el.innerHTML = `<div class="vb-row joined ${talkable && !Voice.muted ? 'live' : ''}"><span class="vb-icon">${icon}</span>
      <span class="vb-text">${esc(text)}${Voice.micError ? '（沒有麥克風權限，只能聽）' : ''}<small>語音中 ${(v.members || []).length} 人</small></span>
      <span class="vb-btns">${talkable ? `<button class="btn small ${Voice.muted ? 'danger' : ''}" data-action="voiceMute">${Voice.muted ? '🔇 已靜音' : '🎙️ 靜音'}</button>` : ''}
      <button class="btn small" data-action="voiceLeave">離開</button></span></div>`;
  }

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
      (S.step === 'night_act' && m.alive && (isWolfRole(S.role) || ['seer', 'guard'].includes(S.role))) ||
      (S.step === 'night_witch' && m.alive && S.role === 'witch' && S.witch && !S.witch.done && (S.witch.hasSave || S.witch.hasPoison)) ||
      (S.step === 'shoot' && S.shootTurn) ||
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
    // 每個區塊各自繪製，其中一塊出錯也不影響其他區塊（例如身分卡）
    for (const f of [renderPhase, renderBanner, renderSetupBar, renderVoiceBar, renderMyRole, renderLobby, renderPlayers, renderActions, renderChat, renderLog, tick]) {
      try { f(); } catch (e) { console.error('[render]', f.name, e); }
    }
  }

  // 伺服器更新版本後，自動重新整理頁面，確保大家用的是同一版
  const PAGE_BUILD = document.querySelector('meta[name="game-version"]')?.content || null;
  async function checkBuild() {
    if (!PAGE_BUILD) return;
    try {
      const j = await (await fetch('/api/version', { cache: 'no-store' })).json();
      if (j.build && j.build !== PAGE_BUILD) location.reload();
    } catch {}
  }
  socket.on('connect', checkBuild);

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
      p = S.spectator ? '👀 旁觀中，玩家正在夜晚行動' : m.alive ? '有技能的角色請行動，其他人請耐心等待' : '你已經出局，可以在亡者頻道聊天';
    } else if (S.step === 'announce') {
      const last = S.log[S.log.length - 1];
      h = '☀️ 天亮了'; p = last ? last.text : '';
    } else if (S.step === 'shoot') {
      h = '🔫 有人發動技能'; p = '請等待…';
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

  // 本局角色一覽（只顯示配置，不顯示存活狀況）
  function renderSetupBar() {
    const el = $('#setupBar');
    const su = S.setup;
    if (S.phase === 'lobby' || !su) { el.classList.add('hidden'); return; }
    const plain = su.wolves - (su.wolfKing ? 1 : 0) - (su.whiteWolfKing ? 1 : 0);
    const items = [];
    if (su.wolfKing) items.push(['wolfKing', 1]);
    if (su.whiteWolfKing) items.push(['whiteWolfKing', 1]);
    if (plain > 0) items.push(['werewolf', plain]);
    GOD_KEYS.forEach((k) => su[k] && items.push([k, 1]));
    if (su.villagers > 0) items.push(['villager', su.villagers]);
    el.classList.remove('hidden');
    el.innerHTML = `<span class="sb-title">本局角色 <small>${S.players.length} 人</small></span>` + items.map(([k, n]) =>
      `<button class="sb-chip ${ROLE[k].team}" data-action="roleInfo" data-role="${k}" title="${esc(ROLE[k].desc)}">
        <span>${ROLE[k].icon}</span>${ROLE[k].name}${n > 1 ? `<b>×${n}</b>` : ''}</button>`).join('');
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
    if (isWolfRole(S.role)) {
      const mates = S.players.filter((p) => isWolfRole(p.role) && p.id !== S.you).map((p) => `${p.seat}號${p.role !== 'werewolf' ? '(' + ROLE[p.role].name + ')' : ''}`);
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
    if (S.step === 'reveal' && S.spectator) {
      el.innerHTML = `<div class="reveal-card"><div class="r-icon">👀</div><div class="r-name">旁觀中</div>
        <p>身分已經發給玩家了${S.godView ? '，你可以在卡片上看到所有人的身分（上帝視角）' : ''}。</p>
        <p class="setup-line">本局配置：${esc(S.setupText)}</p></div>`;
      return;
    }
    if (S.step === 'reveal') {
      const r = ROLE[S.role];
      let extra = '';
      if (isWolfRole(S.role)) {
        const mates = S.players.filter((p) => isWolfRole(p.role) && p.id !== S.you);
        extra = mates.length ? `<p>你的狼隊友：${mates.map((p) => esc(label(p)) + (p.role !== 'werewolf' ? `（${ROLE[p.role].name}）` : '')).join('、')}</p>` : '';
      }
      el.innerHTML = `<div class="reveal-card ${r.team}"><div class="r-icon">${r.icon}</div>
        <div>你的身分是</div><div class="r-name">${r.name}</div><p>${esc(r.desc)}</p>${extra}
        <p class="setup-line">本局配置：${esc(S.setupText)}</p></div>`;
      return;
    }
    if (S.phase !== 'lobby') { el.innerHTML = ''; return; }
    const base = publicUrl && publicUrl !== location.origin ? publicUrl : location.origin;
    const link = `${base}/?room=${S.code}`;
    const netNote = publicUrl && publicUrl !== location.origin
      ? `<div class="setup-line">🌐 外網網址：${esc(publicUrl)}（邀請連結已自動使用這個網址）</div>` : '';
    const s = S.settings, su = S.setup;
    const sw = (k, on) => `<button class="switch ${on ? 'on' : ''}" data-action="setting" data-key="${k}" data-val="${!on}" aria-label="${k}"></button>`;
    const plainWolves = su.wolves - (su.wolfKing ? 1 : 0) - (su.whiteWolfKing ? 1 : 0);
    const setupLine = [su.wolfKing && '狼王', su.whiteWolfKing && '白狼王', plainWolves > 0 && `狼人 ×${plainWolves}`,
      ...GOD_KEYS.filter((k) => su[k]).map((k) => ROLE[k].name),
      `村民 ×${Math.max(0, su.villagers)}`].filter(Boolean).join('、') + (su.villagers < 0 ? '（角色比玩家多，請減少角色）' : '');
    let settings = '';
    if (isHost()) {
      settings = `<div class="settings"><h3>遊戲設定</h3>
        <div class="setrow"><span>依人數自動配置角色</span>${sw('autoSetup', s.autoSetup)}</div>
        ${s.autoSetup ? '' : `
        <div class="setrow"><span>狼人總數<small>（含狼王、白狼王）</small></span><div class="stepper">
          <button data-action="setting" data-key="wolves" data-val="${s.wolves - 1}">−</button><b>${s.wolves}</b>
          <button data-action="setting" data-key="wolves" data-val="${s.wolves + 1}">＋</button></div></div>
        ${['wolfKing', 'whiteWolfKing', ...GOD_KEYS].map((k) =>
          `<div class="setrow"><span>${ROLE[k].icon} ${ROLE[k].name}</span>${sw(k, s[k])}</div>`).join('')}`}
        <div class="setrow"><span>白天自由聊天<small>（關閉時只有輪到的人能打字）</small></span>${sw('freeChat', !!s.freeChat)}</div>
        <div class="setrow"><span>旁觀者上帝視角<small>（可看到所有身分、狼隊與亡者頻道）</small></span>${sw('spectatorGodView', !!s.spectatorGodView)}</div>
        <div class="setrow"><span>每人發言時間</span>
          <select data-action="speakTime">${[30, 60, 90, 120, 180].map((v) => `<option value="${v}" ${v === s.speakTime ? 'selected' : ''}>${v} 秒</option>`).join('')}</select></div>
        <div class="setrow"><span class="setup-line">${esc(setupLine)}</span></div>
      </div>`;
    } else {
      settings = `<div class="settings"><h3>本局配置</h3><div class="setup-line">${esc(setupLine)}　·　發言 ${s.speakTime} 秒</div></div>`;
    }
    el.innerHTML = `<div class="invite"><div>
        <div class="setup-line">房號</div><div class="big-code">${S.code}</div>
        <button class="btn small" data-action="copy" data-link="${esc(link)}">複製邀請連結</button>${netNote}
      </div><img alt="掃描加入" src="/qr?text=${encodeURIComponent(link)}"></div>${settings}`;
  }

  function pickMode() {
    // 回傳 { kind, filter(p) } 代表現在可以點選玩家
    const m = me();
    if (!m) return null;
    const aliveOther = (p) => p.alive && p.id !== S.you;
    if (S.step === 'night_act' && m.alive) {
      if (isWolfRole(S.role)) return { kind: 'wolf', filter: (p) => p.alive };
      if (S.role === 'seer' && !S.seer?.doneTonight) return { kind: 'seer', filter: aliveOther };
      if (S.role === 'guard' && S.guard && S.guard.tonight === undefined) return { kind: 'guard', filter: (p) => p.alive && p.id !== S.guard.last };
    }
    if (S.step === 'night_witch' && m.alive && S.role === 'witch' && S.witch && !S.witch.done && S.witch.hasPoison) return { kind: 'poison', filter: aliveOther };
    if (S.step === 'shoot' && S.shootTurn) return { kind: 'shoot', filter: aliveOther };
    if (S.canExplode && S.step === 'discuss') return { kind: 'explode', filter: aliveOther };
    if (S.canDuel) return { kind: 'duel', filter: aliveOther };
    if (S.step === 'vote' && m.alive) return { kind: 'vote', filter: (p) => p.alive };
    return null;
  }

  function renderPlayers() {
    const mode = pickMode();
    const seerMap = {};
    (S.seer?.results || []).forEach((r) => (seerMap[r.target] = r.wolf));
    const graveMap = {};
    (S.grave?.results || []).forEach((r) => (graveMap[r.target] = r.wolf));
    const wolfPicks = {};
    if (S.wolfVotes) for (const [w, t] of Object.entries(S.wolfVotes)) if (t) (wolfPicks[t] = wolfPicks[t] || []).push(P(w)?.seat);
    const tally = S.step === 'vote_result' && S.lastVote ? S.lastVote.tally : null;
    const voteFor = {};
    if (S.step === 'vote_result' && S.lastVote) for (const [v, t] of Object.entries(S.lastVote.votes)) if (t) (voteFor[t] = voteFor[t] || []).push(P(v)?.seat);

    const specs = S.spectators || [];
    $('#specList').innerHTML = specs.length ? `<span class="sb-title">👀 旁觀者（${specs.length}）</span>` + specs.map((q) =>
      `<span class="spec ${q.connected ? '' : 'off'}">${esc(q.name)}${q.id === S.you ? '（你）' : ''}${q.id === S.hostId ? ' 👑' : ''}${q.voice ? ' 🎧' : ''}${
        S.phase === 'lobby' && isHost() && q.id !== S.you ? ` <button class="kick-inline" data-action="kick" data-id="${q.id}" title="請出房間">✕</button>` : ''}</span>`).join('') : '';
    $('#players').innerHTML = S.players.map((p) => {
      const can = mode && mode.filter(p);
      const cls = ['p', p.alive ? '' : 'dead', can ? 'pick' : '', sel === p.id ? 'sel' : '', S.speaker === p.id ? 'speaking' : '', p.id === S.you ? 'me' : ''].join(' ');
      const tags = [];
      if (p.id === S.hostId && S.phase === 'lobby') tags.push('<span class="tag host">房主</span>');
      if (p.id === S.you) tags.push('<span class="tag">你</span>');
      if (p.bot) tags.push('<span class="tag">🤖 電腦</span>');
      if (p.voice) tags.push('<span class="tag">🎧</span>');
      if (!p.connected) tags.push('<span class="tag off">離線</span>');
      if (p.role && (p.id !== S.you || S.phase === 'ended')) tags.push(`<span class="tag ${ROLE[p.role].team === 'wolf' ? 'wolf' : 'good'}">${ROLE[p.role].name}</span>`);
      if (p.id in seerMap && S.phase !== 'ended') tags.push(`<span class="tag ${seerMap[p.id] ? 'wolf' : 'good'}">${seerMap[p.id] ? '查殺' : '金水'}</span>`);
      if (p.id in graveMap && S.phase !== 'ended') tags.push(`<span class="tag ${graveMap[p.id] ? 'wolf' : 'good'}">🪦${graveMap[p.id] ? '狼人' : '好人'}</span>`);
      if (S.guard?.tonight && S.guard.tonight === p.id && S.phase === 'night') tags.push('<span class="tag good">🛡️ 守護</span>');
      if (!p.alive) tags.push('<span class="tag">💀 出局</span>');
      if (S.speaker === p.id) tags.push('<span class="tag good">🎤 發言</span>');
      if (voteFor[p.id]) tags.push(`<span class="tag">←${voteFor[p.id].join(',')}</span>`);
      const kick = S.phase === 'lobby' && isHost() && p.id !== S.you ? `<button class="kick" data-action="kick" data-id="${p.id}" title="請出房間">✕</button>` : '';
      const picks = wolfPicks[p.id] ? `<span class="picks">🐺${wolfPicks[p.id].join(',')}</span>` : '';
      const badge = tally && tally[p.id] ? `<span class="votes-badge">${tally[p.id]} 票</span>` : '';
      return `<div class="${cls}${Voice.speaking.has(p.id) ? ' talking' : ''}" data-pid="${p.id}" ${can ? `data-action="pick" data-id="${p.id}"` : ''}>
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
      out.push(`<div class="btn-row">${S.spectator
        ? `<button class="btn small good" data-action="spectate" data-on="0">🎮 加入遊戲</button><span class="setup-line" style="align-self:center">你目前是旁觀者</span>`
        : `<button class="btn small" data-action="spectate" data-on="1">👀 改為旁觀</button>`}</div>`);
      if (isHost()) {
        out.push(`<div class="btn-row">
          <button class="btn primary big" data-action="start" ${S.players.length < S.minPlayers ? 'disabled' : ''}>開始遊戲（${S.players.length} 人）</button></div>
          <div class="btn-row">
            <button class="btn small" data-action="addBots" data-count="1" ${S.players.length >= S.maxPlayers ? 'disabled' : ''}>🤖 ＋1 電腦玩家</button>
            <button class="btn small" data-action="fillBots" ${S.players.length >= 6 ? 'disabled' : ''}>🤖 補到 6 人</button>
            ${S.players.some((p) => p.bot) ? '<button class="btn small" data-action="removeBots">移除所有電腦</button>' : ''}
            <button class="btn small" data-action="shuffle">隨機排座位</button></div>
          <p class="setup-line">人不夠時可以加入電腦玩家測試，電腦會自動行動和投票。</p>`);
      }
    } else if (S.phase === 'ended') {
      if (isHost()) out.push(`<button class="btn primary big" data-action="lobby">再來一局</button>`);
      else out.push(box('', '等待房主開始下一局…'));
    } else if (S.spectator) {
      out.push(box('👀 你正在旁觀', S.godView
        ? '上帝視角已開啟：你看得到所有人的身分、狼隊頻道和亡者頻道。請不要在場外透露給玩家喔！'
        : '你看得到公開的資訊，可以在「旁觀頻道」和其他旁觀者聊天，場上玩家看不到。'));
    } else if (S.step === 'night_act' && m.alive && isWolfRole(S.role)) {
      const myPick = S.wolfVotes?.[S.you];
      const status = myPick === undefined ? '尚未決定' : myPick === null ? '你選擇空刀' : `你選了 ${esc(label(P(myPick)))}`;
      out.push(box('🐺 狼人請選擇今晚的目標', `點選玩家後按確認。隊友的選擇會顯示在卡片左上角，大家要選同一人。（${status}）`,
        `<button class="btn danger" data-action="wolf" ${sel ? '' : 'disabled'}>確認擊殺 ${selName()}</button>
         <button class="btn" data-action="wolfNone">今晚空刀</button>`));
    } else if (S.step === 'night_act' && m.alive && S.role === 'seer') {
      const r = S.seer.results.filter((x) => x.night === S.nightNo)[0];
      if (r) out.push(box('🔮 查驗結果', `<span class="result">${esc(label(P(r.target)))} 是 <b class="${r.wolf ? 'wolf' : 'good'}">${r.wolf ? '狼人' : '好人'}</b></span>`));
      else out.push(box('🔮 預言家請查驗一位玩家', '點選一位玩家後按「查驗」', `<button class="btn primary" data-action="seer" ${sel ? '' : 'disabled'}>查驗 ${selName()}</button>`));
    } else if (S.step === 'night_act' && m.alive && S.role === 'guard') {
      const g = S.guard;
      if (g.tonight !== undefined) out.push(box('🛡️ 守衛', g.tonight ? `今晚你守護了 <b>${esc(label(P(g.tonight)))}</b>，等待天亮…` : '今晚你選擇不守護任何人。'));
      else out.push(box('🛡️ 守衛請選擇今晚要守護的人', `可以守護自己，但不能連續兩晚守同一人${g.last ? `（昨晚守護 ${esc(label(P(g.last)))}）` : ''}。`,
        `<button class="btn good" data-action="guard" ${sel ? '' : 'disabled'}>守護 ${selName()}</button>
         <button class="btn" data-action="guardNone">今晚不守</button>`));
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
    } else if (S.phase === 'night' && m.alive && S.role === 'gravekeeper') {
      const r = (S.grave?.results || []).find((x) => x.night === S.nightNo);
      out.push(box('🪦 守墓人', S.nightNo === 1 ? '第一晚還沒有人被放逐。請閉眼，等待天亮…'
        : r ? `昨天被放逐的 ${esc(label(P(r.target)))} 是 <b class="${r.wolf ? 'wolf' : 'good'}">${r.wolf ? '狼人陣營' : '好人陣營'}</b>`
        : '昨天沒有人被放逐，今晚沒有資訊。'));
    } else if (S.phase === 'night') {
      out.push(box('', m.alive ? '😴 請閉眼，等待天亮…' : '👻 你已出局，請安靜觀戰'));
    } else if (S.step === 'shoot') {
      if (S.shootTurn) out.push(box(`🔫 你是${ROLE[S.role].name}，可以開槍帶走一人`, '點選玩家後按「開槍」，或選擇不開槍。開槍後會公開你的身分。',
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

    if (S.canDuel) {
      out.push(box('⚔️ 騎士決鬥', `點選一位玩家後按「決鬥」。對方是狼人就出局並直接入夜；是好人則你出局。整局只能用一次。${sel ? `（目前選擇：${selName()}）` : ''}`,
        `<button class="btn danger" data-action="duel" ${sel ? '' : 'disabled'}>翻牌決鬥 ${selName()}</button>`));
    }
    if (S.canExplode) {
      out.push(box('💥 白狼王自爆', `點選一位玩家後按「自爆」，你會出局並帶走他，今天直接進入黑夜。${sel ? `（目前選擇：${selName()}）` : ''}`,
        `<button class="btn danger" data-action="explode" ${sel ? '' : 'disabled'}>自爆並帶走 ${selName()}</button>`));
    }
    if (hostSkip) out.push(`<div class="btn-row"><button class="btn small" data-action="skip">⏭ 房主：跳過這個階段</button></div>`);
    $('#actions').innerHTML = out.join('');
  }

  function renderChat() {
    const list = $('#chatList');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const chName = { all: '', wolf: '狼', dead: '亡', spec: '觀' };
    list.innerHTML = S.chat.length
      ? S.chat.map((m) => `<div class="msg ch-${m.ch}">${chName[m.ch] ? `<span class="chn">${chName[m.ch]}</span>` : ''}<span class="who">${m.seat}號 ${esc(m.name)}</span>${esc(m.text)}</div>`).join('')
      : '<div class="empty">還沒有訊息</div>';
    if (atBottom) list.scrollTop = list.scrollHeight;

    const ch = S.chatChannel;
    const input = $('#chatInput');
    const tag = { all: '全體', wolf: '狼隊頻道', dead: '亡者頻道', spec: '旁觀頻道' }[ch] || '';
    $('#chatCh').textContent = tag;
    input.disabled = !ch;
    input.placeholder = ch ? (ch === 'all' && S.speaker === S.you ? '輪到你發言，輸入訊息…' : '輸入訊息…') : (S.chatBlocked || '現在不能發言');

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
        emit('join', { code, name, spectator: t.dataset.spectator === '1' });
        break;
      }
      case 'spectate': emit('spectate', { on: t.dataset.on === '1' }); break;
      case 'leave':
        if (!confirmLeave()) break;
        if (Voice.joined) Voice.leave();
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
      case 'addBots': emit('addBots', { count: Number(t.dataset.count) || 1 }); break;
      case 'fillBots': emit('addBots', { count: 6 - S.players.length }); break;
      case 'removeBots': emit('removeBots'); break;
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
      case 'shoot': emit('act', { type: 'shoot', target: sel }); break;
      case 'noShoot': emit('act', { type: 'shoot', target: null }); break;
      case 'guard': emit('act', { type: 'guard', target: sel }); break;
      case 'guardNone': emit('act', { type: 'guard', target: null }); break;
      case 'explode':
        if (!sel) { toast('請先點選要帶走的玩家'); break; }
        if (confirm(`確定要自爆並帶走 ${label(P(sel))} 嗎？你會出局，今天直接進入黑夜。`)) emit('act', { type: 'explode', target: sel });
        break;
      case 'duel':
        if (!sel) { toast('請先點選要決鬥的玩家'); break; }
        if (confirm(`確定要翻牌決鬥 ${label(P(sel))} 嗎？整局只能用一次。`)) emit('act', { type: 'duel', target: sel });
        break;
      case 'roleInfo': {
        const r = ROLE[t.dataset.role];
        if (r) showRoleInfo(r);
        break;
      }
      case 'voiceJoin':
        try {
          t.disabled = true;
          await Voice.join();
          toast(Voice.micError ? '沒有取得麥克風權限，你只能聽' : '已加入語音');
        } catch (e) {
          toast(e.message === 'insecure' ? '語音需要 https 網址，請改用外網網址' : '這個瀏覽器不支援語音');
          renderVoiceBar();
        }
        break;
      case 'voiceMute': Voice.toggleMute(); break;
      case 'voiceLeave': Voice.leave(); break;
      case 'rules': openRules(); break;
      case 'closeRules': $('#rulesPage').classList.add('hidden'); break;
      case 'endSpeech': emit('act', { type: 'endSpeech' }); break;
      case 'vote': emit('act', { type: 'vote', target: sel }); break;
      case 'abstain': emit('act', { type: 'vote', target: null }); break;
    }
  });

  let gameVersion = '';
  fetch('/api/version').then((r) => r.json()).then((j) => (gameVersion = j.version)).catch(() => {});
  function showRoleInfo(r) {
    const t = $('#toast');
    t.classList.add('info');
    t.innerHTML = `<b>${r.icon} ${esc(r.name)}</b>（${r.team === 'wolf' ? '狼人陣營' : '好人陣營'}）<br>${esc(r.desc)}`;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 5000);
  }

  function openRules() {
    $('#rulesBody').innerHTML = rulesHtml(S?.setupText) + (gameVersion ? `<p class="setup-line" style="text-align:center;margin-top:24px">版本 ${esc(gameVersion)}</p>` : '');
    $('#rulesPage').classList.remove('hidden');
    $('#rulesPage').scrollTop = 0;
  }

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
