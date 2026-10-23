// 狼人殺連線伺服器
'use strict';
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Room } = require('./game');

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

// 首頁：每次都重新取得，並在 css/js 後面加上版本號，避免瀏覽器混用新舊檔案
const VERSION = process.env.GAME_VERSION || String(Date.now());
const fs = require('fs');
function sendIndex(req, res) {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html.replace(/(href|src)="(style\.css|voice\.js|deal\.js|app\.js)"/g, `$1="$2?v=${VERSION}"`)
    .replace('</head>', `  <meta name="game-version" content="${VERSION}" />\n</head>`);
  res.set('Cache-Control', 'no-store').type('html').send(html);
}
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => { if (/\.(js|css)$/.test(file)) res.set('Cache-Control', 'no-cache'); },
}));
app.get('/qr', async (req, res) => {
  try {
    const svg = await QRCode.toString(String(req.query.text || '').slice(0, 300), { type: 'svg', margin: 1 });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(400).end();
  }
});
// 在 NAS（Docker）上搭配 cloudflared 時，自動取得目前的外網網址
let publicUrl = { url: process.env.PUBLIC_URL || null, at: 0 };
app.get('/api/public-url', async (req, res) => {
  const metrics = process.env.TUNNEL_METRICS;
  if (!process.env.PUBLIC_URL && metrics && Date.now() - publicUrl.at > 15000) {
    publicUrl.at = Date.now();
    try {
      const r = await fetch(`${metrics}/quicktunnel`, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      publicUrl.url = j.hostname ? `https://${j.hostname}` : null;
    } catch {
      publicUrl.url = null;
    }
  }
  res.json({ url: publicUrl.url });
});
// 給自動更新用：有真人參與、而且正在進行中的對局才算忙碌（大廳和已結束的房間不會擋住更新）
function activeGames() {
  return [...rooms.values()].filter((r) => !['lobby', 'ended'].includes(r.phase) && r.players.some((p) => p.connected && !p.bot));
}
app.get('/api/busy', (req, res) => res.json({ busy: activeGames().length > 0 }));

// ---------- 後台（只允許內部網路） ----------
function isLocal(req) {
  const h = req.headers;
  // 從 Cloudflare 通道進來的連線會帶這些標頭，一律視為外網
  if (h['cf-connecting-ip'] || h['cf-ray'] || h['x-forwarded-for'] || /trycloudflare\.com$/i.test((h.host || '').split(':')[0])) return false;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^(fc|fd|fe80)/i.test(ip);
}
function localOnly(req, res, next) {
  if (isLocal(req)) return next();
  res.status(403).type('text/plain; charset=utf-8').send('後台只能從家裡的內部網路開啟');
}

let updater = { managed: false };
process.on('message', (m) => { if (m?.type === 'status') updater = m.status; });
const askUpdater = (msg) => { if (process.send) process.send(msg); };
askUpdater({ type: 'getStatus' });

app.get('/admin', localOnly, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/api/status', localOnly, (req, res) => {
  const now = Date.now();
  res.json({
    version: process.env.GAME_VERSION || 'dev',
    startedAt,
    now,
    updater,
    busy: activeGames().length > 0,
    rooms: [...rooms.values()].map((r) => ({
      code: r.code,
      phase: r.phase,
      step: r.step,
      nightNo: r.nightNo,
      lastActive: r.humanSeen || r.lastActive,
      players: r.players.map((p) => ({ name: p.name, seat: p.seat, bot: !!p.bot, connected: p.connected, alive: p.alive, host: p.id === r.hostId })),
      spectators: r.spectators.map((p) => ({ name: p.name, connected: p.connected, host: p.id === r.hostId })),
    })),
  });
});
app.post('/admin/api/check', localOnly, express.json(), (req, res) => {
  if (!updater.managed) return res.status(400).json({ ok: false, error: '目前不是自動更新模式（只有 NAS 上用 docker-compose 啟動時才能更新）' });
  const force = !!req.body?.force;
  askUpdater({ type: 'check', force, by: force ? '後台強制更新' : '後台手動檢查' });
  res.json({ ok: true });
});
const startedAt = Date.now();

app.get('/api/version', (req, res) => res.json({ version: process.env.GAME_VERSION || 'dev', build: VERSION }));
// 語音連線用的 ICE 伺服器（STUN 免費；如需 TURN 可用環境變數設定）
app.get('/api/ice', (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (process.env.TURN_URLS) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map((x) => x.trim()),
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }
  res.json({ iceServers });
});
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const rooms = new Map(); // code -> Room
const sockets = new Map(); // socket.id -> { code, pid }

function newCode() {
  let code;
  do code = String(Math.floor(1000 + Math.random() * 9000));
  while (rooms.has(code));
  return code;
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const [sid, info] of sockets) {
    if (info.code !== room.code) continue;
    const s = io.sockets.sockets.get(sid);
    if (s && room.member(info.pid)) s.emit('state', room.stateFor(info.pid));
  }
}

function bind(socket, room, player) {
  // 同一位玩家只保留最新的連線
  for (const [sid, info] of sockets) {
    if (info.pid === player.id && sid !== socket.id) {
      sockets.delete(sid);
      io.sockets.sockets.get(sid)?.emit('kicked', '你在另一個視窗開啟了遊戲');
    }
  }
  sockets.set(socket.id, { code: room.code, pid: player.id });
  room.setConnected(player.id, true);
  socket.emit('joined', { code: room.code, token: player.token });
  broadcast(room);
}

io.on('connection', (socket) => {
  const handle = (fn) => (data, ack) => {
    try {
      fn(data || {});
      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) {
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
      else socket.emit('err', e.message);
    }
  };
  const ctx = () => {
    const info = sockets.get(socket.id);
    const room = info && rooms.get(info.code);
    if (!room || !room.member(info.pid)) throw new Error('你不在房間裡');
    room.humanSeen = Date.now();
    return { room, pid: info.pid };
  };

  socket.on('create', handle(({ name }) => {
    const room = new Room(newCode(), broadcast);
    const p = room.addPlayer(name);
    rooms.set(room.code, room);
    room.updateSettings({});
    bind(socket, room, p);
  }));

  socket.on('join', handle(({ code, name, spectator }) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) throw new Error('找不到這個房間');
    // 選擇旁觀，或遊戲已經開始，就以旁觀者身分加入
    const p = spectator || room.phase !== 'lobby' ? room.addSpectator(name) : room.addPlayer(name);
    bind(socket, room, p);
    if (p.spectator && !spectator) socket.emit('err', '遊戲已經開始，你目前是旁觀者');
  }));

  socket.on('spectate', handle(({ on }) => {
    const { room, pid } = ctx();
    room.setSpectator(pid, !!on);
    broadcast(room);
  }));

  socket.on('resume', handle(({ code, token }) => {
    const room = rooms.get(String(code || ''));
    const p = room && [...room.players, ...room.spectators].find((q) => q.token === token);
    if (!p) throw new Error('原本的房間已經不存在');
    bind(socket, room, p);
  }));

  socket.on('leave', handle(() => {
    const { room, pid } = ctx();
    sockets.delete(socket.id);
    if (room.phase === 'lobby' || room.spectator(pid)) room.removePlayer(pid);
    else room.setConnected(pid, false);
    if (!room.players.length && !room.spectators.length) rooms.delete(room.code);
    else broadcast(room);
  }));

  socket.on('chat', handle(({ text }) => {
    const { room, pid } = ctx();
    room.say(pid, text);
    broadcast(room);
  }));

  socket.on('settings', handle((patch) => {
    const { room, pid } = ctx();
    if (pid !== room.hostId) throw new Error('只有房主可以調整設定');
    room.updateSettings(patch);
    broadcast(room);
  }));

  socket.on('kick', handle(({ target }) => {
    const { room, pid } = ctx();
    if (pid !== room.hostId) throw new Error('只有房主可以踢人');
    if (room.phase !== 'lobby') throw new Error('遊戲中不能踢人');
    if (target === pid) return;
    for (const [sid, info] of sockets) {
      if (info.pid === target) {
        sockets.delete(sid);
        io.sockets.sockets.get(sid)?.emit('kicked', '你被房主請出房間');
      }
    }
    room.removePlayer(target);
    broadcast(room);
  }));

  socket.on('addBots', handle(({ count }) => {
    const { room, pid } = ctx();
    if (pid !== room.hostId) throw new Error('只有房主可以加入電腦玩家');
    const n = Math.max(1, Math.min(19, Number(count) | 0 || 1));
    for (let i = 0; i < n; i++) room.addBot();
    broadcast(room);
  }));

  socket.on('removeBots', handle(() => {
    const { room, pid } = ctx();
    if (pid !== room.hostId) throw new Error('只有房主可以移除電腦玩家');
    room.removeBots();
    broadcast(room);
  }));

  socket.on('shuffleSeats', handle(() => {
    const { room, pid } = ctx();
    if (pid !== room.hostId || room.phase !== 'lobby') throw new Error('只有房主可以在大廳調整座位');
    room.players.sort(() => Math.random() - 0.5);
    room.reseat();
    room.sys('座位已重新隨機排列');
    broadcast(room);
  }));

  socket.on('start', handle(() => {
    const { room, pid } = ctx();
    room.start(pid);
  }));

  socket.on('lobby', handle(() => {
    const { room, pid } = ctx();
    room.backToLobby(pid);
    broadcast(room);
  }));

  socket.on('act', handle((a) => {
    const { room, pid } = ctx();
    room.act(pid, a);
    broadcast(room);
  }));

  // ---------- 語音 ----------
  socket.on('voice', handle(({ on }) => {
    const { room, pid } = ctx();
    room.member(pid).voiceOn = !!on;
    broadcast(room);
  }));

  // WebRTC 訊號轉送：只在同一個房間、都已加入語音的玩家之間轉送
  socket.on('rtc', ({ to, data } = {}) => {
    const info = sockets.get(socket.id);
    const room = info && rooms.get(info.code);
    const from = room && room.member(info.pid);
    const target = room && room.member(to);
    if (!from?.voiceOn || !target?.voiceOn || !data) return;
    for (const [sid, i] of sockets) {
      if (i.pid === to && i.code === room.code) io.sockets.sockets.get(sid)?.emit('rtc', { from: from.id, data });
    }
  });

  socket.on('disconnect', () => {
    const info = sockets.get(socket.id);
    sockets.delete(socket.id);
    const room = info && rooms.get(info.code);
    if (!room) return;
    const stillHere = [...sockets.values()].some((i) => i.pid === info.pid);
    if (!stillHere) room.setConnected(info.pid, false);
    broadcast(room);
  });
});

// 清掉閒置太久的房間
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.humans().some((p) => p.connected);
    const seen = room.humanSeen || room.lastActive;
    if ((!anyone && now - seen > 30 * 60 * 1000) || now - seen > 6 * 3600 * 1000) {
      room.gameId++;
      clearTimeout(room._timer);
      rooms.delete(code);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('');
  console.log('  🐺 狼人殺伺服器已啟動');
  console.log(`  本機開啟：  http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  同一個 Wi-Fi 的手機：http://${ip}:${PORT}`));
  console.log('');
});

module.exports = { server, rooms };
