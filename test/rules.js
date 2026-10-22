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
  console.log('ALL RULE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
