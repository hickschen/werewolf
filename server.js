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

app.use(express.static(path.join(__dirname, 'public')));
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
// 給自動更新用：有人正在遊戲中（或最近 30 分鐘內有動靜的房間）就算忙碌
app.get('/api/busy', (req, res) => {
  const now = Date.now();
  const busy = [...rooms.values()].some((r) =>
    r.players.some((p) => p.connected) && (!['lobby', 'ended'].includes(r.phase) || now - r.lastActive < 30 * 60 * 1000));
  res.json({ busy });
});
app.get('/api/version', (req, res) => res.json({ version: process.env.GAME_VERSION || 'dev' }));
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
    if (s && room.get(info.pid)) s.emit('state', room.stateFor(info.pid));
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
    if (!room || !room.get(info.pid)) throw new Error('你不在房間裡');
    return { room, pid: info.pid };
  };

  socket.on('create', handle(({ name }) => {
    const room = new Room(newCode(), broadcast);
    const p = room.addPlayer(name);
    rooms.set(room.code, room);
    room.updateSettings({});
    bind(socket, room, p);
  }));

  socket.on('join', handle(({ code, name }) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) throw new Error('找不到這個房間');
    const p = room.addPlayer(name);
    bind(socket, room, p);
  }));

  socket.on('resume', handle(({ code, token }) => {
    const room = rooms.get(String(code || ''));
    const p = room && room.players.find((q) => q.token === token);
    if (!p) throw new Error('原本的房間已經不存在');
    bind(socket, room, p);
  }));

  socket.on('leave', handle(() => {
    const { room, pid } = ctx();
    sockets.delete(socket.id);
    if (room.phase === 'lobby') room.removePlayer(pid);
    else room.setConnected(pid, false);
    if (!room.players.length) rooms.delete(room.code);
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
    const anyone = room.players.some((p) => p.connected);
    if ((!anyone && now - room.lastActive > 30 * 60 * 1000) || now - room.lastActive > 6 * 3600 * 1000) {
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
