// 規則單元測試：直接操作 Room，驗證特殊互動
process.env.TIME_SCALE = '0.01';
const assert = require('assert');
const { Room } = require('../game');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setupRoom(roles) {
  const room = new Room('0000', () => {});
  roles.forEach((_, i) => room.addPlayer('P' + (i + 1)));
  room.updateSettings({ autoSetup: false });
  room.settings.wolves = 99; // 之後直接指定角色
  // 用自訂發牌：先正常開始，再覆寫角色
  room.updateSettings({ wolves: 1, seer: false, witch: false, hunter: false, guard: false, gravekeeper: false, wolfKing: false, whiteWolfKing: false });
  room.start(room.hostId);
  room.players.forEach((p, i) => (p.role = roles[i]));
  room.roleSetup = { wolves: roles.filter((r) => /wolf|Wolf/.test(r)).length, villagers: roles.filter((r) => r === 'villager').length,
    seer: roles.includes('seer'), witch: roles.includes('witch'), hunter: roles.includes('hunter'), guard: roles.includes('guard'), gravekeeper: roles.includes('gravekeeper') };
  return room;
}
const P = (room, role) => room.players.find((p) => p.role === role);
const until = async (room, step) => { for (let i = 0; i < 4000 && room.step !== step; i++) await sleep(5); assert.strictEqual(room.step, step); };

(async () => {
  // 1. 守衛擋刀
  {
    const r = await setupRoom(['werewolf', 'guard', 'villager', 'villager', 'seer', 'witch']);
    await until(r, 'night_act');
    const v = r.players[2];
    r.act(P(r, 'werewolf').id, { type: 'wolfVote', target: v.id });
    r.act(P(r, 'guard').id, { type: 'guard', target: v.id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'announce');
    assert.ok(v.alive, '守衛應該擋住狼刀');
    console.log('✓ 守衛擋刀');
    // 第二晚不能再守同一人
    await until(r, 'night_act');
    assert.throws(() => r.act(P(r, 'guard').id, { type: 'guard', target: v.id }), /連續/);
    console.log('✓ 守衛不能連守同一人');
  }
  // 2. 同守同救 → 死亡
  {
    const r = await setupRoom(['werewolf', 'guard', 'villager', 'villager', 'seer', 'witch']);
    await until(r, 'night_act');
    const v = r.players[2];
    r.act(P(r, 'werewolf').id, { type: 'wolfVote', target: v.id });
    r.act(P(r, 'guard').id, { type: 'guard', target: v.id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', save: true });
    await until(r, 'announce');
    assert.ok(!v.alive, '同守同救應該死亡');
    console.log('✓ 同守同救會死亡');
  }
  // 3. 守衛擋不住毒；被毒的獵人不能開槍
  {
    const r = await setupRoom(['werewolf', 'guard', 'hunter', 'villager', 'villager', 'witch', 'seer']);
    await until(r, 'night_act');
    const h = P(r, 'hunter');
    r.act(P(r, 'werewolf').id, { type: 'wolfVote', target: null });
    r.act(P(r, 'guard').id, { type: 'guard', target: h.id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', poison: true, target: h.id });
    await until(r, 'announce');
    assert.ok(!h.alive, '守衛擋不住毒');
    for (let i = 0; i < 60; i++) { assert.notStrictEqual(r.step, 'shoot', '被毒的獵人不能開槍'); if (r.step === 'lastwords' || r.step === 'discuss') break; await sleep(5); }
    console.log('✓ 守衛擋不住毒、被毒的獵人不能開槍');
  }
  // 4. 狼王被放逐可以開槍；守墓人隔晚得知狼人陣營；預言家驗狼王是狼
  {
    const r = await setupRoom(['wolfKing', 'werewolf', 'gravekeeper', 'seer', 'villager', 'villager', 'villager', 'witch']);
    await until(r, 'night_act');
    const wk = P(r, 'wolfKing'), sr = P(r, 'seer'), v = r.players[4];
    r.act(wk.id, { type: 'wolfVote', target: null });
    r.act(P(r, 'werewolf').id, { type: 'wolfVote', target: null });
    r.act(sr.id, { type: 'seerCheck', target: wk.id });
    assert.strictEqual(r.seerResults[0].wolf, true);
    console.log('✓ 預言家查驗狼王為狼人');
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'discuss');
    while (r.step === 'discuss') { r.act(r.speaker, { type: 'endSpeech' }); await sleep(2); }
    await until(r, 'vote');
    r.alive().forEach((p) => r.act(p.id, { type: 'vote', target: wk.id }));
    await until(r, 'shoot');
    assert.strictEqual(r.shooterId, wk.id);
    r.act(wk.id, { type: 'shoot', target: v.id });
    await sleep(30);
    assert.ok(!v.alive && r.revealed[wk.id] === 'wolfKing');
    console.log('✓ 狼王被放逐可以開槍並翻牌');
    await until(r, 'night_act');
    const g = r.stateFor(P(r, 'gravekeeper').id).grave.results;
    assert.deepStrictEqual(g.map((x) => [x.target, x.wolf]), [[wk.id, true]]);
    console.log('✓ 守墓人得知被放逐者為狼人陣營');
  }
  // 5. 白狼王自爆：帶走一人、跳過投票直接入夜、守墓人無資訊
  {
    const r = await setupRoom(['whiteWolfKing', 'werewolf', 'gravekeeper', 'seer', 'villager', 'villager', 'villager', 'witch']);
    await until(r, 'night_act');
    const w = P(r, 'whiteWolfKing'), v = r.players[4];
    r.act(w.id, { type: 'wolfVote', target: null });
    r.act(P(r, 'werewolf').id, { type: 'wolfVote', target: null });
    r.act(P(r, 'seer').id, { type: 'seerCheck', target: v.id });
    assert.throws(() => r.act(w.id, { type: 'explode', target: v.id }), /白天/);
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'discuss');
    assert.strictEqual(r.stateFor(w.id).canExplode, true);
    assert.strictEqual(r.stateFor(v.id).canExplode, undefined);
    r.act(w.id, { type: 'explode', target: v.id });
    assert.ok(!w.alive && !v.alive);
    await until(r, 'night_act');
    assert.strictEqual(r.nightNo, 2);
    assert.strictEqual(r.graveResults.length, 0);
    assert.ok(!r.log.some((l) => l.text.includes('開始投票')));
    console.log('✓ 白狼王自爆帶人、直接入夜、不算放逐');
  }
  // 6. 騎士決鬥狼人：狼人出局、直接入夜；被決鬥的狼王可以開槍
  {
    const r = await setupRoom(['knight', 'wolfKing', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'witch']);
    await until(r, 'night_act');
    const k = P(r, 'knight'), wk = P(r, 'wolfKing'), v = r.players[4];
    assert.throws(() => r.act(k.id, { type: 'duel', target: wk.id }), /白天/);
    r.act(wk.id, { type: 'wolfVote', target: null });
    r.act(P(r, 'werewolf').id, { type: 'wolfVote', target: null });
    r.act(P(r, 'seer').id, { type: 'seerCheck', target: k.id });
    assert.strictEqual(r.seerResults[0].wolf, false);
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'discuss');
    assert.strictEqual(r.stateFor(k.id).canDuel, true);
    assert.strictEqual(r.stateFor(v.id).canDuel, undefined);
    r.act(k.id, { type: 'duel', target: wk.id });
    assert.ok(!wk.alive && k.alive && r.revealed[k.id] === 'knight');
    await until(r, 'shoot');
    assert.strictEqual(r.shooterId, wk.id);
    r.act(wk.id, { type: 'shoot', target: v.id });
    await until(r, 'night_act');
    assert.ok(!v.alive);
    assert.ok(!r.log.some((l) => l.text.includes('開始投票')));
    console.log('✓ 騎士決鬥狼王成功：狼王出局可開槍、直接入夜');
  }
  // 7. 騎士決鬥好人：騎士出局、白天繼續投票；整局只能一次
  {
    const r = await setupRoom(['knight', 'werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'witch', 'villager']);
    await until(r, 'night_act');
    const k = P(r, 'knight'), v = r.players[4];
    r.players.filter((p) => p.role === 'werewolf').forEach((w) => r.act(w.id, { type: 'wolfVote', target: null }));
    r.act(P(r, 'seer').id, { type: 'seerCheck', target: v.id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'discuss');
    r.act(k.id, { type: 'duel', target: v.id });
    assert.ok(!k.alive && v.alive);
    assert.throws(() => r.act(k.id, { type: 'duel', target: v.id }), /騎士|一次/);
    while (r.step === 'discuss') { r.act(r.speaker, { type: 'endSpeech' }); await sleep(2); }
    await until(r, 'vote');
    console.log('✓ 騎士決鬥好人失敗：騎士出局、白天繼續投票');
  }
  // 8. 電腦狼隊友會跟隨真人狼人的目標
  {
    const r = await setupRoom(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'witch']);
    r.players[1].bot = true;
    await until(r, 'night_act');
    r.act(r.players[0].id, { type: 'wolfVote', target: r.players[4].id });
    assert.strictEqual(r.wolfVotes[r.players[1].id], r.players[4].id);
    console.log('✓ 電腦狼隊友跟隨真人的選擇');
  }
  // 9. 輪流發言時只有發言者能公開聊天；遺言的死者可以說話；投票時安靜；自由聊天開關
  {
    const r = await setupRoom(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'witch', 'villager']);
    await until(r, 'night_act');
    const v = r.players[3];
    r.players.filter((p) => p.role === 'werewolf').forEach((w) => r.act(w.id, { type: 'wolfVote', target: v.id }));
    r.act(r.players[0].id, { type: 'wolfVote', target: v.id });
    assert.doesNotThrow(() => r.say(r.players[0].id, '狼隊晚上可以聊'));
    assert.throws(() => r.say(r.players[3].id, '好人晚上不能聊'), /天黑/);
    r.act(P(r, 'seer').id, { type: 'seerCheck', target: r.players[0].id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'lastwords');
    assert.strictEqual(r.speaker, v.id);
    assert.ok(!v.alive);
    r.say(v.id, '這是我的遺言');
    assert.strictEqual(r.chat[r.chat.length - 1].ch, 'all');
    const other = r.players.find((p) => p.alive && p.id !== r.speaker);
    assert.throws(() => r.say(other.id, '插嘴'), /輪到/);
    r.act(v.id, { type: 'endSpeech' });
    await until(r, 'discuss');
    const sp = r.get(r.speaker), notSp = r.alive().find((p) => p.id !== r.speaker);
    assert.doesNotThrow(() => r.say(sp.id, '我是好人'));
    assert.throws(() => r.say(notSp.id, '插嘴'), /輪到/);
    r.settings.freeChat = true;
    assert.doesNotThrow(() => r.say(notSp.id, '開了自由聊天就可以'));
    r.settings.freeChat = false;
    while (r.step === 'discuss') { r.act(r.speaker, { type: 'endSpeech' }); await sleep(2); }
    await until(r, 'vote');
    assert.throws(() => r.say(notSp.id, '投票時說話'), /投票中/);
    console.log('✓ 輪流發言時只有發言者能說話、遺言可說、投票時安靜、自由聊天開關有效');
  }
  // 10. 語音權限：狼人夜晚只對狼隊友；出局者白天只能聽；留遺言的死者可以說
  {
    const r = await setupRoom(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'witch', 'villager']);
    r.players.forEach((p) => (p.voiceOn = true));
    await until(r, 'night_act');
    const [w1, w2] = r.players.filter((p) => p.role === 'werewolf');
    const v = r.players[3];
    let vw = r.voiceFor(w1), vv = r.voiceFor(v);
    assert.deepStrictEqual(vw.talkTo, [w2.id]);
    assert.strictEqual(vv.mode, null);
    assert.deepStrictEqual(vv.hearFrom, []);
    [w1, w2].forEach((w) => r.act(w.id, { type: 'wolfVote', target: v.id }));
    r.act(P(r, 'seer').id, { type: 'seerCheck', target: w1.id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'lastwords');
    vv = r.voiceFor(v);
    assert.strictEqual(vv.mode, 'day', '留遺言的死者可以說話');
    assert.strictEqual(vv.talkTo.length, 7);
    r.act(v.id, { type: 'endSpeech' });
    await until(r, 'discuss');
    vv = r.voiceFor(v);
    assert.strictEqual(vv.mode, null, '出局者白天不能說話');
    assert.strictEqual(vv.hearFrom.length, 7, '出局者聽得到存活玩家');
    assert.ok(!r.voiceFor(w1).hearFrom.includes(v.id));
    console.log('✓ 語音權限：狼隊夜聊、出局者只能聽、遺言可說');
  }
  // 11. 旁觀模式
  {
    const r = await setupRoom(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'witch', 'villager']);
    const spec = r.addSpectator('觀眾');
    assert.throws(() => r.addSpectator('觀眾'), /暱稱/);
    await until(r, 'night_act');
    // 看不到身分、不能操作、狼隊頻道看不到
    let st = r.stateFor(spec.id);
    assert.ok(st.spectator && !st.godView);
    assert.ok(st.players.every((p) => p.role === null), '旁觀者預設看不到身分');
    assert.throws(() => r.act(spec.id, { type: 'wolfVote', target: r.players[3].id }), /旁觀/);
    const w = r.players[0];
    r.say(w.id, '狼隊密談');
    assert.ok(!r.stateFor(spec.id).chat.some((m) => m.ch === 'wolf'));
    // 旁觀頻道：玩家看不到
    r.say(spec.id, '旁觀者聊天');
    assert.strictEqual(r.chat[r.chat.length - 1].ch, 'spec');
    assert.ok(r.players.every((p) => !r.stateFor(p.id).chat.some((m) => m.ch === 'spec')), '玩家看不到旁觀頻道');
    // 語音：晚上聽不到狼隊、不能說
    r.players.forEach((p) => (p.voiceOn = true)); spec.voiceOn = true;
    let vs = r.voiceFor(spec);
    assert.strictEqual(vs.mode, null); assert.deepStrictEqual(vs.hearFrom, []);
    assert.ok(!r.voiceFor(w).talkTo.includes(spec.id));
    // 上帝視角
    r.settings.spectatorGodView = true;
    st = r.stateFor(spec.id);
    assert.ok(st.godView && st.players.every((p) => p.role), '上帝視角看得到所有身分');
    assert.ok(st.chat.some((m) => m.ch === 'wolf'), '上帝視角看得到狼隊頻道');
    r.settings.spectatorGodView = false;
    // 旁觀的房主可以跳過白天階段
    r.hostId = spec.id;
    r.players.filter((p) => p.role === 'werewolf').forEach((x) => r.act(x.id, { type: 'wolfVote', target: null }));
    r.act(P(r, 'seer').id, { type: 'seerCheck', target: w.id });
    await until(r, 'night_witch');
    r.act(P(r, 'witch').id, { type: 'witch', skip: true });
    await until(r, 'discuss');
    vs = r.voiceFor(spec);
    assert.strictEqual(vs.mode, null); assert.strictEqual(vs.hearFrom.length, 8, '旁觀者白天聽得到所有存活玩家');
    const sp = r.speaker;
    r.act(spec.id, { type: 'skip' });
    await sleep(5);
    assert.notStrictEqual(r.speaker, sp, '旁觀房主可以跳過發言');
    assert.throws(() => r.setSpectator(spec.id, false), /回到大廳/);
    console.log('✓ 旁觀者：看不到身分、不能操作、旁觀頻道獨立、語音只聽白天、上帝視角、旁觀房主可跳過');
  }
  // 12. 大廳切換玩家／旁觀
  {
    const { Room: R } = require('../game');
    const r = new R('1', () => {});
    const a = r.addPlayer('A'); const b = r.addPlayer('B'); r.addPlayer('C');
    r.setSpectator(b.id, true);
    assert.strictEqual(r.players.length, 2); assert.strictEqual(r.spectators.length, 1);
    assert.deepStrictEqual(r.players.map((p) => p.seat), [1, 2]);
    r.setSpectator(b.id, false);
    assert.strictEqual(r.players.length, 3); assert.strictEqual(b.seat, 3); assert.ok(b.alive && !b.spectator);
    r.setSpectator(a.id, true);
    r.setConnected(a.id, false);
    assert.notStrictEqual(r.hostId, a.id, '房主離線會轉移');
    console.log('✓ 大廳可以在玩家與旁觀之間切換');
  }
  console.log('ALL RULE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
