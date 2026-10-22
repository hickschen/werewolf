// 用模擬玩家跑完整局，檢查流程與資訊是否外洩
const { io } = require('socket.io-client');
const URL = 'http://localhost:' + (process.env.PORT || 3999);
const N = Number(process.env.N || 8);
const GAMES = Number(process.env.GAMES || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const errors = [];
const stats = { duel: 0, guard: 0, explode: 0, shoot: 0, grave: 0, guardBlock: 0 };
const WOLF = ['werewolf', 'wolfKing', 'whiteWolfKing'];
const isW = (r) => WOLF.includes(r);
const results = [];

function bot(name) {
  const s = io(URL, { transports: ['websocket'] });
  const b = { s, name, state: null, acted: '' };
  s.on('state', (st) => { b.state = st; check(b, st); act(b); });
  s.on('err', (e) => errors.push(name + ': ' + e));
  s.on('joined', (j) => { b.join = j; });
  s.on('connect', () => { if (b.join) s.emit('resume', b.join, (r) => { if (!r.ok) errors.push('resume failed ' + r.error); }); });
  b.emit = (ev, d) => new Promise((r) => s.emit(ev, d || {}, (res) => { if (res && !res.ok && !/今晚已經|現在不|不能連續|只有白狼王|只能在白天|只有騎士|整局只能|請選擇一位存活/.test(res.error)) errors.push(`${name} ${ev} ${JSON.stringify(d)}: ${res.error}`); r(res); }));
  return b;
}

function check(b, st) {
  if (st.phase === 'ended' || st.phase === 'lobby') return;
  const me = st.players.find((p) => p.id === st.you);
  for (const p of st.players) {
    if (p.id === st.you || !p.role) continue;
    const ok = (isW(me.role) && isW(p.role)) || ['hunter', 'wolfKing', 'whiteWolfKing', 'knight'].includes(p.role);
    if (!ok) errors.push(`LEAK: ${b.name}(${me.role}) sees ${p.name}=${p.role}`);
  }
  for (const m of st.chat) {
    if (m.ch === 'wolf' && !isW(me.role)) errors.push('LEAK wolf chat to ' + b.name);
    if (m.ch === 'dead' && me.alive) errors.push('LEAK dead chat to ' + b.name);
  }
  if (st.wolfVotes && !isW(me.role)) errors.push('LEAK wolfVotes');
  if (st.guard && me.role !== 'guard') errors.push('LEAK guard');
  if (st.grave && me.role !== 'gravekeeper') errors.push('LEAK grave');
  if ('canExplode' in st && me.role !== 'whiteWolfKing') errors.push('LEAK explode');
  if (st.grave) stats.grave = Math.max(stats.grave, st.grave.results.length);
  if (st.witch && me.role !== 'witch') errors.push('LEAK witch');
}

async function act(b) {
  const st = b.state;
  const key = `${st.phase}|${st.step}|${st.speaker}|${st.nightNo}|${st.witch?.done}|${st.seer?.doneTonight}|${st.guard?.tonight}`;
  if (key === b.acted) return;
  b.acted = key;
  await sleep(5 + Math.random() * 30);
  const me = st.players.find((p) => p.id === st.you);
  const others = st.players.filter((p) => p.alive && p.id !== st.you);
  const alive = st.players.filter((p) => p.alive);
  if (Math.random() < 0.3 && st.chatChannel) b.s.emit('chat', { text: 'hi from ' + b.name }, () => {});
  if (st.step === 'shoot' && st.shootTurn) { stats.shoot++; b.emit('act', { type: 'shoot', target: Math.random() < 0.8 ? pick(others).id : null }); }
  if (!me.alive) return;
  if (st.step === 'night_act' && isW(me.role)) {
    // 狼人跟隨隊友的選擇，否則選一個非狼人
    const mateVote = Object.values(st.wolfVotes || {}).find((t) => t);
    const nonWolf = st.players.filter((p) => p.alive && !isW(p.role));
    b.emit('act', { type: 'wolfVote', target: mateVote || pick(nonWolf).id });
  }
  if (st.step === 'night_act' && me.role === 'seer' && !st.seer.doneTonight) b.emit('act', { type: 'seerCheck', target: pick(others).id });
  if (st.step === 'night_witch' && me.role === 'witch' && !st.witch.done) {
    const w = st.witch;
    const r = Math.random();
    if (w.hasSave && w.killed && w.killed !== st.you && r < 0.5) b.emit('act', { type: 'witch', save: true });
    else if (w.hasPoison && r < 0.7) b.emit('act', { type: 'witch', poison: true, target: pick(others).id });
    else b.emit('act', { type: 'witch', skip: true });
  }
  if (st.step === 'night_act' && me.role === 'guard' && st.guard.tonight === undefined) {
    const opts = alive.filter((p) => p.id !== st.guard.last);
    // 偶爾故意違規（連守同一人），應該被拒絕
    if (st.guard.last && Math.random() < 0.2) {
      const r = await b.emit('act', { type: 'guard', target: st.guard.last });
      if (r.ok) errors.push('guard allowed same target twice');
    }
    b.emit('act', { type: 'guard', target: pick(opts).id }); stats.guard++;
  }
  if (st.canDuel && Math.random() < 0.3) { stats.duel++; await b.emit('act', { type: 'duel', target: pick(others).id }); return; }
  if (st.canExplode && st.step === 'discuss' && Math.random() < 0.25) { stats.explode++; await b.emit('act', { type: 'explode', target: pick(others).id }); return; }
  if ((st.step === 'discuss' || st.step === 'lastwords') && st.speaker === st.you) b.emit('act', { type: 'endSpeech' });
  if (st.step === 'vote') b.emit('act', { type: 'vote', target: Math.random() < 0.85 ? pick(alive).id : null });
}

(async () => {
  const bots = [];
  const host = bot('B1'); bots.push(host);
  await new Promise((r) => host.s.on('connect', r));
  await host.emit('create', { name: 'B1' });
  await sleep(100);
  const code = host.state.code;
  for (let i = 2; i <= N; i++) { const b = bot('B' + i); bots.push(b); await new Promise((r) => b.s.on('connect', r)); await b.emit('join', { code, name: 'B' + i }); }
  await sleep(200);
  if (process.env.CUSTOM) {
    await host.emit('settings', { autoSetup: false });
    await host.emit('settings', { wolves: 3, wolfKing: true, whiteWolfKing: true, seer: true, witch: true, hunter: true, guard: true, gravekeeper: true, knight: true });
    await sleep(100);
    console.log('setup', JSON.stringify(host.state.setup));
  }
  for (let g = 0; g < GAMES; g++) {
    await host.emit('start');
    const t0 = Date.now();
    // 中途讓一位玩家斷線重連
    setTimeout(() => { const b = bots[3]; b.s.disconnect(); setTimeout(() => b.s.connect(), 300); }, 400);
    while (host.state.phase !== 'ended') { await sleep(50); if (Date.now() - t0 > 60000) { errors.push('TIMEOUT game ' + g + ' step ' + host.state.step); break; } }
    await sleep(100);
    const roles = host.state.players.map((p) => `${p.seat}${{werewolf:'狼',wolfKing:'狼王',whiteWolfKing:'白狼',villager:'民',seer:'預',witch:'巫',hunter:'獵',guard:'守',gravekeeper:'墓',knight:'騎'}[p.role]}${p.alive ? '' : '†'}`).join(' ');
    results.push(`game ${g + 1}: ${host.state.winner} wins in ${host.state.nightNo} nights (${((Date.now() - t0) / 1000).toFixed(1)}s) ${roles}`);
    // 最後的紀錄
    if (g === 0 && process.env.SHOWLOG) console.log(host.state.log.map((l) => '   ' + l.text).join('\n'));
    // 重連的那位要能回到房間（resume 用 token；這裡直接在同 socket 重連後狀態仍在）
    await host.emit('lobby');
    await sleep(200);
  }
  console.log(results.join('\n'));
  console.log('stats', JSON.stringify(stats));
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 30).join('\n') : 'NO ERRORS');
  process.exit(errors.length ? 1 : 0);
})();
