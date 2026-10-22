// 自動更新管理員：啟動遊戲伺服器，並定期到 GitHub 檢查新版本
// 有新版本、而且沒有人正在遊戲中時，下載新版並結束程式，讓 Docker 自動重啟成新版本。
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

// 啟動遊戲伺服器（子程序）
let child;
let stopping = false;
function startServer() {
  child = spawn(process.execPath, [path.join(DIR, 'server.js')], {
    cwd: DIR,
    stdio: 'inherit',
    env: { ...process.env, GAME_VERSION: commit },
  });
  child.on('exit', (code) => {
    if (stopping) return;
    log(`遊戲伺服器意外結束（${code}），3 秒後重新啟動`);
    setTimeout(startServer, 3000);
  });
}

async function isBusy() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/busy`, { signal: AbortSignal.timeout(3000) });
    return (await r.json()).busy;
  } catch {
    return false; // 伺服器沒回應，視為不忙
  }
}

let pending = null; // 已發現但還沒套用的新版本
async function check() {
  try {
    git('fetch', '--depth', '1', 'origin', BRANCH);
    const local = git('rev-parse', 'HEAD');
    const remote = git('rev-parse', 'FETCH_HEAD');
    if (local === remote) return;
    const short = remote.slice(0, 7);
    if (await isBusy()) {
      if (pending !== short) log(`發現新版本 ${short}，但有人正在遊戲中，等遊戲結束後再更新`);
      pending = short;
      return;
    }
    log(`更新到新版本 ${short}…`);
    git('reset', '--hard', remote);
    stopping = true;
    child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1500); // 結束後 Docker 會自動重啟，重新安裝套件並載入新版
  } catch (e) {
    log('檢查更新失敗：', (e.stderr || e.message || '').toString().split('\n')[0]);
  }
}

const shutdown = () => { stopping = true; child?.kill('SIGTERM'); setTimeout(() => process.exit(0), 1000); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

log(`目前版本 ${commit}，每 ${INTERVAL / 1000} 秒檢查一次 GitHub`);
startServer();
setInterval(check, INTERVAL);
setTimeout(check, 15000);
