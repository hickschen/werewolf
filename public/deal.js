/* 月夜狼人殺：開局洗牌、發牌、翻牌動畫 */
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current = null; // 正在播放的動畫

  // 合成一個短促的「唰」發牌聲（不需要音效檔）
  let actx = null;
  function swish(volume = 0.25) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const len = Math.floor(actx.sampleRate * 0.09);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = actx.createBufferSource();
      src.buffer = buf;
      const f = actx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400;
      const g = actx.createGain();
      g.gain.value = volume;
      src.connect(f).connect(g).connect(actx.destination);
      src.start();
    } catch {}
  }

  function cardHtml(front = '') {
    return `<div class="dk-inner"><div class="dk-face dk-back"><span>🐺</span></div><div class="dk-face dk-front">${front}</div></div>`;
  }

  /**
   * opts: { players:[{id,seat,name}], you, spectator, role:{name,icon,team,desc}, mates:[label], sound, onClose }
   */
  async function play(opts) {
    close(true);
    const token = {};
    current = token;
    const alive = () => current === token;
    const n = opts.players.length;

    const el = document.createElement('div');
    el.className = 'deal';
    el.innerHTML = `<div class="deal-box">
        <div class="deal-title">🃏 洗牌中…</div>
        <div class="deal-stage"><div class="deal-felt"></div></div>
        <div class="deal-hint"></div>
        <div class="deal-btns"><button class="btn small deal-skip">跳過動畫</button></div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const stage = el.querySelector('.deal-stage');
    const title = el.querySelector('.deal-title');
    const hint = el.querySelector('.deal-hint');
    const btns = el.querySelector('.deal-btns');
    el.querySelector('.deal-skip').onclick = () => finish();

    const W = stage.clientWidth;
    const cw = Math.max(30, Math.min(56, Math.floor(W / (n > 12 ? 9 : 7)))); // 牌的寬度，人越多越小
    stage.style.setProperty('--cw', cw + 'px');
    const R = W / 2 - cw * (n <= 12 ? 1.9 : 1.3); // 外圈留空間給名牌
    const seatPos = (i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, deg: (a * 180) / Math.PI + 90 };
    };

    // 座位名牌
    opts.players.forEach((p, i) => {
      const s = seatPos(i);
      const tag = document.createElement('div');
      tag.className = 'deal-seat' + (p.id === opts.you ? ' me' : '');
      const off = cw * (n <= 12 ? 1.25 : 0.95);
      const ang = Math.atan2(s.y, s.x);
      // 名牌放在牌的外側，並限制在畫面內
      const lim = W / 2 - 26;
      const lx = Math.max(-lim, Math.min(lim, s.x + Math.cos(ang) * off));
      const ly = Math.max(-W / 2 + 8, Math.min(W / 2 - 8, s.y + Math.sin(ang) * off));
      tag.style.transform = `translate(calc(-50% + ${lx}px), calc(-50% + ${ly}px))`;
      tag.innerHTML = `<b>${p.seat}</b>${n <= 12 ? esc(p.name).slice(0, 4) : ''}`;
      stage.appendChild(tag);
    });

    // ---------- 1. 洗牌 ----------
    const stack = [];
    const stackN = Math.min(n, 12);
    for (let i = 0; i < stackN; i++) {
      const c = document.createElement('div');
      c.className = 'dk';
      c.innerHTML = cardHtml();
      c.style.transform = `translate(-50%, -50%) translate(${i * 0.6}px, ${-i * 0.6}px)`;
      stage.appendChild(c);
      stack.push(c);
    }
    if (!reduced()) {
      for (let round = 0; round < 3 && alive(); round++) {
        const anims = stack.map((c, i) => {
          const left = i % 2 === 0;
          const dx = (left ? -1 : 1) * cw * 0.9;
          return c.animate([
            { transform: `translate(-50%, -50%) translate(${i * 0.6}px, ${-i * 0.6}px) rotate(0deg)` },
            { transform: `translate(-50%, -50%) translate(${dx}px, ${-i * 1.2}px) rotate(${left ? -8 : 8}deg)`, offset: 0.45 },
            { transform: `translate(-50%, -50%) translate(${(stackN - i) * 0.6}px, ${-(stackN - i) * 0.6}px) rotate(0deg)` },
          ], { duration: 620, delay: i * 18, easing: 'ease-in-out' }).finished;
        });
        if (opts.sound) setTimeout(() => swish(0.18), 250);
        await Promise.all(anims).catch(() => {});
      }
    }
    if (!alive()) return;

    // ---------- 2. 發牌 ----------
    title.textContent = '🃏 發牌中…';
    stack.forEach((c) => c.remove());
    const deck = document.createElement('div');
    deck.className = 'dk deck';
    deck.innerHTML = cardHtml();
    stage.appendChild(deck);
    let mine = null;
    const step = reduced() ? 0 : Math.max(60, Math.min(140, 1800 / n));
    const dealt = opts.players.map((p, i) => {
      const s = seatPos(i);
      const c = document.createElement('div');
      c.className = 'dk' + (p.id === opts.you ? ' mine' : '');
      c.innerHTML = cardHtml();
      c.style.transform = `translate(-50%, -50%) translate(${s.x}px, ${s.y}px) rotate(${s.deg}deg)`;
      c.style.opacity = '0';
      stage.appendChild(c);
      if (p.id === opts.you) mine = { el: c, s };
      return { c, s };
    });
    for (let i = 0; i < dealt.length && alive(); i++) {
      const { c, s } = dealt[i];
      c.style.opacity = '1';
      if (!reduced()) {
        c.animate([
          { transform: 'translate(-50%, -50%) translate(0px, 0px) rotate(0deg)', opacity: 1 },
          { transform: `translate(-50%, -50%) translate(${s.x}px, ${s.y}px) rotate(${s.deg + 360}deg)`, opacity: 1 },
        ], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' });
        if (opts.sound) swish(0.22);
        await sleep(step);
      }
    }
    deck.remove();
    await sleep(reduced() ? 0 : 500);
    if (!alive()) return;

    // ---------- 3. 翻牌 ----------
    if (opts.spectator || !mine || !opts.role) {
      title.textContent = '🃏 發牌完成';
      hint.textContent = opts.spectator ? '👀 你正在旁觀，身分已經發給每位玩家了' : '';
      btns.innerHTML = '<button class="btn primary deal-ok">開始觀戰</button>';
      btns.querySelector('.deal-ok').onclick = () => finish();
      setTimeout(() => alive() && finish(), 2500);
      return;
    }
    title.textContent = '🃏 這是你的身分牌';
    hint.textContent = '點一下翻開（別讓旁邊的人看到喔）';
    const r = opts.role;
    const big = mine.el;
    big.classList.add('flipcard', r.team);
    big.querySelector('.dk-front').innerHTML = `<div class="dk-icon">${r.icon}</div><div class="dk-name">${esc(r.name)}</div>`;
    const scale = Math.min(3.2, (W * 0.42) / cw);
    const to = `translate(-50%, -50%) translate(0px, 0px) rotate(0deg) scale(${scale})`;
    big.style.zIndex = 5;
    if (!reduced()) {
      await big.animate([{ transform: big.style.transform }, { transform: to }], { duration: 500, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
    }
    // 動畫結束後換成真正的大尺寸（而不是放大），文字和圖示才會清晰
    big.style.setProperty('--cw', Math.round(cw * scale) + 'px');
    big.style.transform = 'translate(-50%, -50%)';
    big.getAnimations().forEach((a) => a.cancel());
    stage.classList.add('focus');

    let flipped = false;
    const flip = () => {
      if (flipped || !alive()) return;
      flipped = true;
      big.classList.add('flipped');
      if (opts.sound) swish(0.3);
      title.textContent = r.team === 'wolf' ? '🐺 你是狼人陣營' : '😇 你是好人陣營';
      hint.innerHTML = `<b>${esc(r.name)}</b>：${esc(r.desc)}${opts.mates?.length ? `<br>你的狼隊友：${opts.mates.map(esc).join('、')}` : ''}`;
      btns.innerHTML = '<button class="btn primary deal-ok">記住了，開始遊戲</button>';
      btns.querySelector('.deal-ok').onclick = () => finish();
    };
    big.addEventListener('click', flip);
    big.style.cursor = 'pointer';
    setTimeout(flip, 4000); // 沒點的話自動翻開
  }

  function finish() {
    close(false);
  }

  function close(instant) {
    current = null;
    document.querySelectorAll('.deal').forEach((el) => {
      if (instant) return el.remove();
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    });
  }

  window.DealAnim = { play, close, isOpen: () => !!document.querySelector('.deal') };
})();
