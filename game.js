// 狼人殺遊戲引擎：一個 Room 就是一間房間，伺服器擔任法官
'use strict';
const crypto = require('crypto');

const SCALE = Number(process.env.TIME_SCALE || 1); // 測試時可把時間縮短

const ROLES = {
  werewolf: { name: '狼人', team: 'wolf' },
  wolfKing: { name: '狼王', team: 'wolf' },
  whiteWolfKing: { name: '白狼王', team: 'wolf' },
  villager: { name: '村民', team: 'good', kind: 'villager' },
  seer: { name: '預言家', team: 'good', kind: 'god' },
  witch: { name: '女巫', team: 'good', kind: 'god' },
  hunter: { name: '獵人', team: 'good', kind: 'god' },
  guard: { name: '守衛', team: 'good', kind: 'god' },
  gravekeeper: { name: '守墓人', team: 'good', kind: 'god' },
};
const GODS = ['seer', 'witch', 'hunter', 'guard', 'gravekeeper'];
const SPECIAL_WOLVES = ['wolfKing', 'whiteWolfKing'];
const SHOOTERS = ['hunter', 'wolfKing']; // 死亡時可以開槍（被毒死除外）

const isWolf = (role) => ROLES[role]?.team === 'wolf';

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 20;

// 依人數自動配置（4–20 人）
function defaultSetup(n) {
  const wolves = n <= 5 ? 1 : n <= 7 ? 2 : n <= 10 ? 3 : n <= 14 ? 4 : n <= 17 ? 5 : 6;
  return {
    wolves,
    wolfKing: n === 9 || n === 11 || n >= 14,
    whiteWolfKing: n === 10 || n >= 12,
    seer: true,
    witch: true,
    hunter: n >= 7,
    guard: n >= 10,
    gravekeeper: n >= 13,
  };
}

const id = () => crypto.randomBytes(6).toString('hex');
const token = () => crypto.randomBytes(16).toString('hex');
const shuffle = (a) => {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

class Room {
  constructor(code, notify) {
    this.code = code;
    this.notify = notify; // (room) => 推送最新狀態給所有人
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby'; // lobby | night | day | ended
    this.step = null;
    this.deadline = null;
    this.gameId = 0;
    this.settings = { autoSetup: true, speakTime: 90, ...defaultSetup(6) };
    this.log = [];
    this.chat = [];
    this.lastActive = Date.now();
    this.resetGameState();
  }

  resetGameState() {
    this.nightNo = 0;
    this.wolfVotes = {};
    this.wolfTarget = null;
    this.seerResults = [];
    this.seerDoneTonight = false;
    this.witchSave = true;
    this.witchPoison = true;
    this.witchTonight = null; // {save:true} | {poison:id} | {skip:true}
    this.guardTarget = undefined; // undefined = 還沒決定，null = 空守
    this.guardLast = null;
    this.graveResults = [];
    this.lastExiled = null; // 前一天被放逐的人（給守墓人）
    this.shooterId = null;
    this.shot = undefined;
    this.speaker = null;
    this.speakOrder = [];
    this.votes = {};
    this.lastVote = null;
    this.exploded = null; // 白狼王自爆 {by, target}
    this.winner = null;
    this.revealed = {}; // 公開翻牌的身分
    this.lastNightDeaths = [];
  }

  // ---------- 玩家管理 ----------
  get(pid) { return this.players.find((p) => p.id === pid); }
  alive() { return this.players.filter((p) => p.alive); }
  aliveRole(role) { return this.players.filter((p) => p.alive && p.role === role); }
  aliveWolves() { return this.players.filter((p) => p.alive && isWolf(p.role)); }
  label(p) { return `${p.seat} 號 ${p.name}`; }

  addPlayer(name) {
    if (this.phase !== 'lobby') throw new Error('遊戲已經開始，無法加入');
    if (this.players.length >= MAX_PLAYERS) throw new Error(`房間已滿（最多 ${MAX_PLAYERS} 人）`);
    const clean = String(name || '').trim().slice(0, 12);
    if (!clean) throw new Error('請輸入暱稱');
    if (this.players.some((p) => p.name === clean)) throw new Error('這個暱稱已經有人用了');
    const p = { id: id(), token: token(), name: clean, seat: 0, connected: true, alive: true, role: null };
    this.players.push(p);
    this.reseat();
    if (!this.hostId) this.hostId = p.id;
    this.sys(`${clean} 加入了房間`);
    return p;
  }

  removePlayer(pid) {
    const p = this.get(pid);
    if (!p) return;
    this.players = this.players.filter((q) => q.id !== pid);
    this.reseat();
    if (this.hostId === pid) this.hostId = (this.players.find((q) => q.connected) || this.players[0] || {}).id || null;
    this.sys(`${p.name} 離開了房間`);
  }

  reseat() { this.players.forEach((p, i) => (p.seat = i + 1)); }

  setConnected(pid, on) {
    const p = this.get(pid);
    if (!p) return;
    p.connected = on;
    if (!on && this.hostId === pid) {
      const next = this.players.find((q) => q.connected);
      if (next) this.hostId = next.id;
    }
    if (on && !this.get(this.hostId)?.connected) this.hostId = pid;
  }

  setup() {
    const n = this.players.length;
    const s = this.settings.autoSetup ? defaultSetup(n) : this.settings;
    const out = { wolves: s.wolves };
    for (const k of [...SPECIAL_WOLVES, ...GODS]) out[k] = !!s[k];
    const gods = GODS.filter((k) => out[k]).length;
    out.villagers = n - s.wolves - gods;
    return out;
  }

  updateSettings(patch) {
    if (this.phase !== 'lobby') return;
    const s = this.settings;
    if ('autoSetup' in patch) {
      s.autoSetup = !!patch.autoSetup;
      if (!s.autoSetup) Object.assign(s, defaultSetup(this.players.length));
    }
    if ('wolves' in patch) s.wolves = Math.max(1, Math.min(9, Number(patch.wolves) | 0));
    for (const k of [...SPECIAL_WOLVES, ...GODS]) if (k in patch) s[k] = !!patch[k];
    // 特殊狼人也算在狼人總數裡
    const specials = SPECIAL_WOLVES.filter((k) => s[k]).length;
    if (specials > s.wolves) s.wolves = specials;
    if ('speakTime' in patch) s.speakTime = Math.max(20, Math.min(300, Number(patch.speakTime) | 0));
  }

  // ---------- 訊息 ----------
  sys(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 200) this.log.shift();
  }

  say(pid, text) {
    const p = this.get(pid);
    text = String(text || '').trim().slice(0, 200);
    if (!p || !text) return;
    const ch = this.chatChannel(p);
    if (!ch) throw new Error(this.phase === 'night' ? '天黑了，請保持安靜' : '現在不能發言');
    this.chat.push({ id: id(), ch, from: p.id, name: p.name, seat: p.seat, text, t: Date.now() });
    if (this.chat.length > 300) this.chat.shift();
  }

  chatChannel(p) {
    if (this.phase === 'lobby' || this.phase === 'ended') return 'all';
    if (!p.alive) return 'dead';
    if (this.phase === 'night') return isWolf(p.role) ? 'wolf' : null;
    return 'all';
  }

  canSee(p, msg) {
    if (msg.ch === 'all') return true;
    if (msg.ch === 'wolf') return isWolf(p.role) || this.phase === 'ended';
    if (msg.ch === 'dead') return !p.alive || this.phase === 'ended';
    return false;
  }

  // ---------- 流程控制 ----------
  runStep(step, seconds, minSeconds = 0) {
    clearTimeout(this._timer);
    clearTimeout(this._earlyTimer);
    this.step = step;
    const ms = seconds * 1000 * SCALE;
    this.stepStart = Date.now();
    this.minEnd = this.stepStart + minSeconds * 1000 * SCALE;
    this.deadline = this.stepStart + ms;
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._timer = setTimeout(() => this.endStep(), ms);
      this.notify(this);
    });
  }

  endStep() {
    clearTimeout(this._timer);
    clearTimeout(this._earlyTimer);
    const r = this._resolve;
    this._resolve = null;
    if (r) r();
  }

  // 所有人都完成了，但不早於最短時間（避免從時間長短推敲出身分）
  finishWhenAllowed() {
    const wait = this.minEnd - Date.now();
    if (wait <= 0) return this.endStep();
    clearTimeout(this._earlyTimer);
    this._earlyTimer = setTimeout(() => this.endStep(), wait);
  }

  stale(gid) { return gid !== this.gameId || this.phase === 'ended'; }

  start(byId) {
    if (byId !== this.hostId) throw new Error('只有房主可以開始遊戲');
    if (this.phase !== 'lobby') throw new Error('遊戲已經開始');
    const n = this.players.length;
    if (n < MIN_PLAYERS) throw new Error(`至少需要 ${MIN_PLAYERS} 位玩家`);
    const s = this.setup();
    if (s.villagers < 0) throw new Error('角色數量比玩家還多，請調整配置');
    if (s.wolves * 2 >= n) throw new Error('狼人太多了，請減少狼人數量');
    const deck = [];
    for (const k of SPECIAL_WOLVES) if (s[k]) deck.push(k);
    while (deck.length < s.wolves) deck.push('werewolf');
    for (const k of GODS) if (s[k]) deck.push(k);
    while (deck.length < n) deck.push('villager');
    const roles = shuffle(deck);
    this.resetGameState();
    this.roleSetup = s;
    this.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
    this.log = [];
    this.chat = [];
    this.gameId++;
    this.phase = 'night';
    this.sys(`遊戲開始！本局配置：${this.setupText()}`);
    this.loop(this.gameId).catch((e) => console.error('game loop error', e));
  }

  setupText() {
    const s = this.roleSetup || this.setup();
    const plain = s.wolves - SPECIAL_WOLVES.filter((k) => s[k]).length;
    const parts = [];
    if (s.wolfKing) parts.push('狼王');
    if (s.whiteWolfKing) parts.push('白狼王');
    if (plain > 0) parts.push(`狼人 ×${plain}`);
    for (const k of GODS) if (s[k]) parts.push(ROLES[k].name);
    if (s.villagers > 0) parts.push(`村民 ×${s.villagers}`);
    return parts.join('、');
  }

  async loop(gid) {
    await this.runStep('reveal', 10); // 看身分
    if (this.stale(gid)) return;
    while (true) {
      await this.night(gid);
      if (this.stale(gid)) return;
      await this.day(gid);
      if (this.stale(gid)) return;
    }
  }

  async night(gid) {
    this.phase = 'night';
    this.nightNo++;
    this.wolfVotes = {};
    this.wolfTarget = null;
    this.seerDoneTonight = false;
    this.witchTonight = null;
    this.guardTarget = undefined;
    this.lastVote = null;
    this.speaker = null;
    this.exploded = null;
    // 守墓人得知昨天被放逐者的陣營
    if (this.lastExiled && this.aliveRole('gravekeeper').length) {
      const p = this.get(this.lastExiled);
      this.graveResults.push({ night: this.nightNo, target: p.id, wolf: isWolf(p.role) });
    }
    this.lastExiled = null;
    this.sys(`🌙 第 ${this.nightNo} 夜，天黑請閉眼`);

    await this.runStep('night_act', 45, 12);
    if (this.stale(gid)) return;
    this.wolfTarget = this.resolveWolfVotes();
    this.guardLast = this.guardTarget || null;

    const witch = this.aliveRole('witch')[0];
    if (witch && (this.witchSave || this.witchPoison)) await this.runStep('night_witch', 25, 5);
    else await this.runStep('night_witch', rand(5, 9)); // 女巫不在也要等，免得洩漏
    if (this.stale(gid)) return;

    const deaths = [];
    const t = this.wolfTarget;
    if (t) {
      const saved = !!this.witchTonight?.save;
      const guarded = this.guardTarget === t;
      // 守衛擋刀；女巫救人；同守同救則死亡
      if (saved === guarded) deaths.push({ id: t, cause: 'wolf' });
    }
    const poison = this.witchTonight?.poison;
    if (poison) {
      const d = deaths.find((x) => x.id === poison);
      if (d) d.cause = 'poison'; // 被毒的獵人、狼王不能開槍
      else deaths.push({ id: poison, cause: 'poison' });
    }
    deaths.forEach((d) => (this.get(d.id).alive = false));
    this.lastNightDeaths = shuffle(deaths);
  }

  resolveWolfVotes() {
    const tally = {};
    for (const [wid, t] of Object.entries(this.wolfVotes)) {
      const w = this.get(wid);
      if (!w?.alive || !t || !this.get(t)?.alive) continue;
      tally[t] = (tally[t] || 0) + 1;
    }
    const entries = Object.entries(tally);
    if (!entries.length) return null;
    const max = Math.max(...entries.map((e) => e[1]));
    const top = entries.filter((e) => e[1] === max).map((e) => e[0]);
    return top[crypto.randomInt(top.length)];
  }

  async day(gid) {
    this.phase = 'day';
    const deaths = this.lastNightDeaths;
    if (deaths.length) this.sys(`☀️ 天亮了。昨晚 ${deaths.map((d) => this.label(this.get(d.id))).join('、')} 死亡`);
    else this.sys('☀️ 天亮了。昨晚是平安夜');
    await this.runStep('announce', 6);
    if (this.stale(gid) || this.checkWin()) return;

    if (!(await this.deathSkills(deaths, gid))) return;

    if (this.nightNo === 1 && deaths.length) {
      await this.speeches(deaths.map((d) => d.id), 'lastwords', gid);
      if (this.stale(gid)) return;
    }

    // 從死者的下一位（或隨機一位）開始輪流發言
    const alive = this.alive();
    const startSeat = deaths.length ? this.get(deaths[0].id).seat : alive[crypto.randomInt(alive.length)].seat - 1;
    const N = this.players.length;
    const key = (p) => (((p.seat - startSeat - 1) % N) + N) % N;
    const order = [...alive].sort((a, b) => key(a) - key(b));
    this.sys('開始輪流發言');
    await this.speeches(order.map((p) => p.id), 'discuss', gid);
    if (this.stale(gid)) return;
    if (this.exploded) return this.afterExplode(gid);

    this.votes = {};
    this.sys('🗳️ 開始投票');
    await this.runStep('vote', 30);
    if (this.stale(gid)) return;
    if (this.exploded) return this.afterExplode(gid);
    const exiled = this.tallyVotes();
    await this.runStep('vote_result', 7);
    if (this.stale(gid)) return;

    if (exiled) {
      exiled.alive = false;
      this.lastExiled = exiled.id;
      if (this.checkWin()) return;
      if (!(await this.deathSkills([{ id: exiled.id, cause: 'vote' }], gid))) return;
      await this.speeches([exiled.id], 'lastwords', gid);
    }
  }

  // 白狼王自爆後：直接進入黑夜
  async afterExplode(gid) {
    const { target } = this.exploded;
    this.speaker = null;
    this.speakOrder = [];
    await this.runStep('announce', 6);
    if (this.stale(gid) || this.checkWin()) return;
    if (target) await this.deathSkills([{ id: target, cause: 'whiteWolf' }], gid);
  }

  // 處理死亡技能（獵人、狼王開槍），可以連鎖。回傳 false 表示遊戲結束
  async deathSkills(deaths, gid) {
    for (const d of deaths) {
      const p = this.get(d.id);
      if (!SHOOTERS.includes(p.role) || d.cause === 'poison') continue;
      const target = await this.shootTurn(p, gid);
      if (this.stale(gid) || this.checkWin()) return false;
      if (target && !(await this.deathSkills([{ id: target, cause: 'shot' }], gid))) return false;
    }
    return !this.stale(gid);
  }

  async shootTurn(shooter, gid) {
    this.shooterId = shooter.id;
    this.shot = undefined;
    await this.runStep('shoot', 20);
    this.shooterId = null;
    if (this.stale(gid)) return null;
    const t = this.shot && this.get(this.shot);
    if (t && t.alive) {
      t.alive = false;
      this.revealed[shooter.id] = shooter.role;
      this.sys(`🔫 ${this.label(shooter)} 是${ROLES[shooter.role].name}，開槍帶走了 ${this.label(t)}`);
      await this.runStep('announce', 5);
      return t.id;
    }
    this.sys(`${this.label(shooter)} 沒有發動技能`);
    return null;
  }

  tallyVotes() {
    const tally = {};
    const lines = [];
    for (const p of this.alive()) {
      const t = this.votes[p.id];
      if (t && this.get(t)?.alive) tally[t] = (tally[t] || 0) + 1;
    }
    const entries = Object.entries(tally);
    let exiled = null;
    if (entries.length) {
      const max = Math.max(...entries.map((e) => e[1]));
      const top = entries.filter((e) => e[1] === max);
      if (top.length === 1) exiled = this.get(top[0][0]);
    }
    for (const p of this.alive()) {
      const t = this.get(this.votes[p.id]);
      lines.push(`${p.seat}號→${t ? t.seat + '號' : '棄票'}`);
    }
    this.lastVote = {
      votes: Object.fromEntries(this.alive().map((p) => [p.id, this.votes[p.id] || null])),
      tally,
      exiled: exiled?.id || null,
    };
    this.sys(`投票結果：${lines.join('，')}`);
    this.sys(exiled ? `${this.label(exiled)} 被放逐出局` : entries.length ? '平票，今天沒有人出局' : '全員棄票，今天沒有人出局');
    return exiled;
  }

  async speeches(ids, kind, gid) {
    this.speakOrder = ids.slice();
    for (const pid of ids) {
      const p = this.get(pid);
      if (!p) continue;
      if (kind === 'discuss' && !p.alive) continue;
      this.speaker = pid;
      await this.runStep(kind, this.settings.speakTime);
      if (this.stale(gid) || this.exploded) break;
    }
    this.speaker = null;
    this.speakOrder = [];
  }

  checkWin() {
    const alive = this.alive();
    const wolves = alive.filter((p) => isWolf(p.role)).length;
    const villagers = alive.filter((p) => p.role === 'villager').length;
    const gods = alive.filter((p) => ROLES[p.role].kind === 'god').length;
    const s = this.roleSetup;
    const godsTotal = GODS.filter((k) => s[k]).length;
    let winner = null;
    if (wolves === 0) winner = 'good';
    else if ((s.villagers > 0 && villagers === 0) || (godsTotal > 0 && gods === 0)) winner = 'wolf';
    if (!winner) return false;
    this.endGame(winner);
    return true;
  }

  endGame(winner) {
    this.winner = winner;
    this.phase = 'ended';
    this.step = null;
    this.deadline = null;
    this.speaker = null;
    this.shooterId = null;
    clearTimeout(this._timer);
    clearTimeout(this._earlyTimer);
    this._resolve = null;
    this.sys(winner === 'good' ? '🎉 好人陣營獲勝！' : '🐺 狼人陣營獲勝！');
    this.notify(this);
  }

  backToLobby(byId) {
    if (byId !== this.hostId) throw new Error('只有房主可以操作');
    this.gameId++;
    clearTimeout(this._timer);
    clearTimeout(this._earlyTimer);
    this._resolve = null;
    this.phase = 'lobby';
    this.step = null;
    this.deadline = null;
    this.players.forEach((p) => { p.role = null; p.alive = true; });
    // 離線的人在回到大廳時移除
    this.players = this.players.filter((p) => p.connected);
    this.reseat();
    this.resetGameState();
    this.log = [];
    this.sys('回到大廳');
  }

  // ---------- 玩家操作 ----------
  act(pid, a) {
    const p = this.get(pid);
    if (!p) throw new Error('找不到玩家');
    const target = a.target ? this.get(a.target) : null;
    const isHost = pid === this.hostId;

    switch (a.type) {
      case 'skip':
        if (!isHost) throw new Error('只有房主可以跳過');
        if (this.phase === 'lobby' || this.phase === 'ended') return;
        if (this.step === 'night_act' || this.step === 'night_witch') throw new Error('夜晚無法跳過');
        return this.endStep();

      case 'wolfVote':
        if (this.step !== 'night_act' || !p.alive || !isWolf(p.role)) throw new Error('你不能這樣做');
        if (target && !target.alive) throw new Error('目標已經死亡');
        this.wolfVotes[p.id] = target ? target.id : null;
        return this.checkNightDone();

      case 'seerCheck': {
        this.need(p, 'night_act', 'seer');
        if (this.seerDoneTonight) throw new Error('今晚已經查驗過了');
        if (!target || !target.alive || target.id === p.id) throw new Error('請選擇一位存活的其他玩家');
        this.seerDoneTonight = true;
        this.seerResults.push({ night: this.nightNo, target: target.id, wolf: isWolf(target.role) });
        return this.checkNightDone();
      }

      case 'guard': {
        this.need(p, 'night_act', 'guard');
        if (this.guardTarget !== undefined) throw new Error('今晚已經守護過了');
        if (target && !target.alive) throw new Error('請選擇一位存活的玩家');
        if (target && target.id === this.guardLast) throw new Error('不能連續兩晚守護同一個人');
        this.guardTarget = target ? target.id : null;
        return this.checkNightDone();
      }

      case 'witch': {
        this.need(p, 'night_witch', 'witch');
        if (this.witchTonight) throw new Error('今晚已經行動過了');
        if (a.save) {
          if (!this.witchSave) throw new Error('解藥已經用掉了');
          if (!this.wolfTarget) throw new Error('今晚沒有人被殺');
          if (this.wolfTarget === p.id) throw new Error('女巫不能自救');
          this.witchSave = false;
          this.witchTonight = { save: true };
        } else if (a.poison) {
          if (!this.witchPoison) throw new Error('毒藥已經用掉了');
          if (!target || !target.alive || target.id === p.id) throw new Error('請選擇要毒的玩家');
          this.witchPoison = false;
          this.witchTonight = { poison: target.id };
        } else {
          this.witchTonight = { skip: true };
        }
        return this.finishWhenAllowed();
      }

      case 'shoot':
        if (this.step !== 'shoot' || this.shooterId !== p.id) throw new Error('現在不是你開槍的時候');
        if (target && (!target.alive || target.id === p.id)) throw new Error('請選擇一位存活的玩家');
        this.shot = target ? target.id : null;
        return this.endStep();

      case 'explode': {
        if (p.role !== 'whiteWolfKing' || !p.alive) throw new Error('只有白狼王可以自爆');
        if (this.phase !== 'day' || !['discuss', 'vote'].includes(this.step) || this.exploded) throw new Error('只能在白天發言或投票時自爆');
        if (!target || !target.alive || target.id === p.id) throw new Error('請選擇要帶走的玩家');
        p.alive = false;
        target.alive = false;
        this.revealed[p.id] = 'whiteWolfKing';
        this.exploded = { by: p.id, target: target.id };
        this.sys(`💥 ${this.label(p)} 是白狼王，自爆並帶走了 ${this.label(target)}！今天直接進入黑夜`);
        return this.endStep();
      }

      case 'endSpeech':
        if ((this.step !== 'discuss' && this.step !== 'lastwords') || this.speaker !== p.id) throw new Error('現在不是你發言');
        return this.endStep();

      case 'vote':
        if (this.step !== 'vote') throw new Error('現在不是投票時間');
        if (!p.alive) throw new Error('死亡玩家不能投票');
        if (target && !target.alive) throw new Error('只能投給存活的玩家');
        this.votes[p.id] = target ? target.id : null;
        if (this.alive().every((q) => q.id in this.votes)) this.endStep();
        return;

      default:
        throw new Error('未知的操作');
    }
  }

  need(p, step, role) {
    if (this.step !== step) throw new Error('現在不能這樣做');
    if (!p.alive || p.role !== role) throw new Error('你不能這樣做');
  }

  checkNightDone() {
    const picks = this.aliveWolves().map((w) => this.wolfVotes[w.id]);
    const wolvesDone = picks.every((t) => t !== undefined) && new Set(picks).size === 1;
    const seerDone = this.aliveRole('seer').length === 0 || this.seerDoneTonight;
    const guardDone = this.aliveRole('guard').length === 0 || this.guardTarget !== undefined;
    if (wolvesDone && seerDone && guardDone) this.finishWhenAllowed();
  }

  // ---------- 每位玩家看到的畫面 ----------
  stateFor(pid) {
    const me = this.get(pid);
    const ended = this.phase === 'ended';
    const meWolf = isWolf(me.role);
    const players = this.players.map((q) => {
      let role = null;
      if (ended || q.id === me.id || (meWolf && isWolf(q.role))) role = q.role;
      else if (this.revealed[q.id]) role = this.revealed[q.id];
      return { id: q.id, name: q.name, seat: q.seat, alive: q.alive, connected: q.connected, role };
    });

    const s = {
      code: this.code,
      you: me.id,
      hostId: this.hostId,
      phase: this.phase,
      step: this.step,
      deadline: this.deadline,
      now: Date.now(),
      nightNo: this.nightNo,
      settings: this.settings,
      setup: this.phase === 'lobby' ? this.setup() : this.roleSetup,
      setupText: this.phase === 'lobby' ? null : this.setupText(),
      players,
      role: me.role,
      alive: me.alive,
      speaker: this.speaker,
      speakOrder: this.speakOrder,
      log: this.log.slice(-60),
      chat: this.chat.filter((m) => this.canSee(me, m)).slice(-100),
      chatChannel: this.chatChannel(me),
      winner: this.winner,
      lastVote: this.lastVote,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };

    if (this.step === 'vote') {
      s.myVote = pid in this.votes ? this.votes[pid] : undefined;
      s.votedCount = Object.keys(this.votes).length;
      s.aliveCount = this.alive().length;
    }
    if (meWolf && this.step === 'night_act') s.wolfVotes = this.wolfVotes;
    if (me.role === 'seer') s.seer = { results: this.seerResults, doneTonight: this.seerDoneTonight };
    if (me.role === 'gravekeeper') s.grave = { results: this.graveResults };
    if (me.role === 'guard') s.guard = { last: this.guardLast, tonight: this.guardTarget };
    if (me.role === 'witch') {
      s.witch = { hasSave: this.witchSave, hasPoison: this.witchPoison, done: !!this.witchTonight };
      if (this.step === 'night_witch' && this.witchSave) s.witch.killed = this.wolfTarget;
      if (this.step === 'night_witch' && !this.witchSave && !this.witchTonight) s.witch.noInfo = true;
    }
    if (me.role === 'whiteWolfKing') s.canExplode = me.alive && this.phase === 'day' && ['discuss', 'vote'].includes(this.step) && !this.exploded;
    if (this.step === 'shoot') s.shootTurn = this.shooterId === pid;
    return s;
  }
}

module.exports = { Room, ROLES, defaultSetup, MIN_PLAYERS, MAX_PLAYERS };
