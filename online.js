// 啟動伺服器，並用 Cloudflare 免費通道產生一個外網網址，讓不同地方的朋友加入
'use strict';
const fs = require('fs');
const { server } = require('./server');
const PORT = Number(process.env.PORT || 3000);

async function main() {
  let cf;
  try {
    cf = require('cloudflared');
  } catch {
    console.log('  ⚠️ 找不到 cloudflared 套件，請先執行 npm install');
    return;
  }
  if (!fs.existsSync(cf.bin)) {
    console.log('  第一次使用，正在下載 Cloudflare 通道程式（只需要一次）…');
    await cf.install(cf.bin);
  }
  console.log('  正在建立外網連線，請稍候…');
  const t = cf.Tunnel.quick(`http://localhost:${PORT}`);
  let shown = false;
  t.on('url', (url) => {
    if (shown || !/^https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return;
    shown = true;
    console.log('');
    console.log('  ==============================================');
    console.log('  🌐 外網網址（把這個傳給朋友）：');
    console.log(`     ${url}`);
    console.log('  ==============================================');
    console.log('  這個視窗開著，大家就能玩；關掉就斷線。');
    console.log('  ※ 每次重新啟動，網址都會不一樣。');
    console.log('');
  });
  t.on('error', (e) => console.log('  通道錯誤：', e.message));
  t.on('exit', () => {
    console.log('');
    console.log(shown ? '  外網通道已關閉。' : '  ⚠️ 外網通道建立失敗（可能是網路或防火牆擋住）。');
    console.log(`  同一個 Wi-Fi 的人仍然可以用上面的區網網址遊玩。`);
  });
  const stop = () => { try { t.stop(); } catch {} server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

server.on('listening', () => main().catch((e) => console.log('  外網通道啟動失敗：', e.message)));
