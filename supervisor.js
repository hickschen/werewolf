// 自動更新管理員：啟動遊戲伺服器，並定期到 GitHub 檢查新版本
// 有新版本、而且沒有正在進行的對局時，下載新版並結束程式，讓 Docker 自動重啟成新版本。
// 後台（/admin）可以透過 IPC 要求「立即檢查」或「強制更新」。
'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const BRANCH = process.env.GIT_BRANCH || 'main';
const INTERVAL = Number(process.env.UPDATE_INTERVAL || 180) * 1000; // 預設每 3 分鐘檢查一次

const log = (...a) => console.log(`[${new Date().toLocaleString('zh-TW', { hour12: false })}] [更新]`, ...a);
const git = (...args) => execFileSync('git', args, { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let commit = 'unknown';
try { commit = git('rev-parse', '--short', 'HEAD'); } catch {}

const status = {
  managed: true,
  current: commit,
  latest: null,
  latestMessage: null,
  lastCheck: null,
  pending: false,
  lastError: null,
  interval: INTERVAL / 1000,
  updating: false,
};

let child;
let stopping = false;
const sendStatus = () => { try { child?.connected && child.send({ type: 'status', status }); } catch {} };

function startServer() {
  child = spawn(process.execPath, [path.join(DIR, 'server.js')], {
    cwd: DIR,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, GAME_VERSION: commit },
  });
  child.on('message', (m) => {
    if (m?.type === 'check') check(!!m.force, m.by);
    if (m?.type === 'getStatus') sendStatus();
  });
  child.on('exit', (code) => {
    if (stopping) return;
    log(`遊戲伺服器意外結束（${code}），3 秒後重新啟動`);
    setTimeout(startServer, 3000);
  });
  setTimeout(sendStatus, 1000);
}

async function isBusy() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/busy`, { signal: AbortSignal.timeout(3000) });
    return (await r.json()).busy;
  } catch {
    return false; // 伺服器沒回應，視為不忙
  }
}

let checking = false;
async function check(force = false, by = '') {
  if (checking || status.updating) return;
  checking = true;
  try {
    git('fetch', '--depth', '1', 'origin', BRANCH);
    const local = git('rev-parse', 'HEAD');
    const remote = git('rev-parse', 'FETCH_HEAD');
    status.latest = remote.slice(0, 7);
    try { status.latestMessage = git('log', '-1', '--format=%s', 'FETCH_HEAD'); } catch {}
    status.lastCheck = Date.now();
    status.lastError = null;
    if (local === remote) {
      status.pending = false;
      if (by) log(`${by}：已經是最新版本 ${status.current}`);
      return;
    }
    if (!force && (await isBusy())) {
      if (!status.pending) log(`發現新版本 ${status.latest}，但有對局正在進行，等遊戲結束後再更新`);
      status.pending = true;
      return;
    }
    log(`${force ? `強制更新（${by || '後台'}）` : '更新'}到新版本 ${status.latest}…`);
    status.updating = true;
    sendStatus();
    git('reset', '--hard', remote);
    stopping = true;
    setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => process.exit(0), 1500); // 結束後 Docker 會自動重啟，重新安裝套件並載入新版
    }, 1500);
  } catch (e) {
    status.lastError = (e.stderr || e.message || '').toString().split('\n')[0];
    status.lastCheck = Date.now();
    log('檢查更新失敗：', status.lastError);
  } finally {
    checking = false;
    sendStatus();
  }
}

const shutdown = () => { stopping = true; child?.kill('SIGTERM'); setTimeout(() => process.exit(0), 1000); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

log(`目前版本 ${commit}，每 ${INTERVAL / 1000} 秒檢查一次 GitHub`);
startServer();
setInterval(() => check(), INTERVAL);
setTimeout(() => check(), 15000);
