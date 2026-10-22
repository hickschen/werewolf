// 1 位真人 + 電腦玩家跑完整局（真人什麼都不做，全靠電腦和計時推進）
const { io } = require('socket.io-client');
const URL = 'http://localhost:' + (process.env.PORT || 3999);
const BOTS = Number(process.env.BOTS || 11);
const GAMES = Number(process.env.GAMES || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const s = io(URL, { transports: ['websocket'] });
  let st; s.on('state', (x) => (st = x));
  await new Promise((r) => s.on('connect', r));
  const emit = (ev, d) => new Promise((r) => s.emit(ev, d || {}, r));
  await emit('create', { name: '真人' });
  const res = await emit('addBots', { count: BOTS });
  await sleep(100);
  console.log('players:', st.players.length, 'bots:', st.players.filter((p) => p.bot).length, res.ok);
  for (let g = 0; g < GAMES; g++) {
    await emit('start');
    const t0 = Date.now();
    while (st.phase !== 'ended' && Date.now() - t0 < 120000) await sleep(50);
    const chats = st.chat.filter((m) => m.from !== st.you).length;
    const roles = st.players.map((p) => `${p.seat}${{werewolf:'狼',wolfKing:'狼王',whiteWolfKing:'白狼',villager:'民',seer:'預',witch:'巫',hunter:'獵',guard:'守',gravekeeper:'墓',knight:'騎'}[p.role]}${p.alive ? '' : '†'}`).join(' ');
    console.log(`game ${g + 1}: ${st.phase === 'ended' ? st.winner + ' wins' : 'TIMEOUT'} night ${st.nightNo}, ${((Date.now() - t0) / 1000).toFixed(1)}s, bot chats ${chats} | ${roles}`);
    if (g === 0) console.log(st.log.filter((l) => /查驗|開槍|決鬥|自爆|投票結果|死亡|平安/.test(l.text)).slice(0, 8).map((l) => '   ' + l.text).join('\n'));
    await emit('lobby'); await sleep(100);
  }
  const busy = await (await fetch(URL + '/api/busy')).json();
  console.log('busy while human connected in lobby:', busy.busy);
  s.disconnect(); await sleep(300);
  console.log('busy after human left:', (await (await fetch(URL + '/api/busy')).json()).busy);
  process.exit(0);
})();
