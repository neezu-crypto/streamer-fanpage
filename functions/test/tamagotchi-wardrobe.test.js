'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('../tamagotchi-wardrobe');
const care = require('../tamagotchi-care');

function database(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial)); let seq = 0;
  const parts = (p) => p.split('/').filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n == null ? null : n[k] ?? null), root);
  const write = (p, v) => { const keys = parts(p); let n = root; for (const k of keys.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; } if (v == null) delete n[keys[keys.length - 1]]; else n[keys[keys.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const snap = (v) => ({ val: () => (v == null ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p) => ({
    get: async () => snap(read(p)), set: async (v) => write(p, v), remove: async () => write(p, null), child: (k) => ref(`${p}/${k}`),
    push: async (v) => { seq += 1; write(`${p}/k${String(seq).padStart(6, '0')}`, v); }, orderByKey: () => ({ get: async () => snap(read(p)) }),
    transaction: async (fn) => { let out = fn(null); const cur = read(p); if (cur != null || out === undefined) out = fn(cur == null ? null : JSON.parse(JSON.stringify(cur))); if (out === undefined) return { committed: false, snapshot: snap(cur) }; write(p, out); return { committed: true, snapshot: snap(out) }; },
  });
  return { ref, dump: () => root };
}
const T = Date.UTC(2026, 10, 14, 3);
const mk = (gems, extra = {}) => database({ streamerFanPageTamagotchis: { s1: { p1: { status: 'active', nickname: 'a', stats: { ...care.freshStats(T), gems, ...extra } } } } });
const pet = (db) => db.dump().streamerFanPageTamagotchis.s1.p1;
const args = { streamerId: 's1', petId: 'p1', now: T };

test('사면 보석이 정확히 줄고 바로 착용, 같은 슬롯은 교체', async () => {
  const db = mk(20);
  await w.buy({ db, ...args, itemId: 'ribbon' });
  assert.equal(pet(db).stats.gems, 17); assert.equal(pet(db).wardrobe.equipped.head, 'ribbon');
  await w.buy({ db, ...args, itemId: 'hat' });
  assert.equal(pet(db).stats.gems, 12); assert.equal(pet(db).wardrobe.equipped.head, 'hat');
  assert.ok(pet(db).wardrobe.owned.ribbon);
  assert.equal(Object.keys(pet(db).gemLog).length, 2);
});
test('보석 부족·중복 구매 거절', async () => {
  const db = mk(4);
  await assert.rejects(w.buy({ db, ...args, itemId: 'hat' }), /보석이 부족/);
  assert.equal(pet(db).stats.gems, 4);
  await w.buy({ db, ...args, itemId: 'ribbon' });
  await assert.rejects(w.buy({ db, ...args, itemId: 'ribbon' }), /이미/);
  await assert.rejects(w.buy({ db, ...args, itemId: 'nope' }), /아이템/);
});
test('입기·벗기는 보유한 것만', async () => {
  const db = mk(20);
  await assert.rejects(w.equip({ db, ...args, slot: 'face', itemId: 'glasses' }), /먼저/);
  await w.buy({ db, ...args, itemId: 'ribbon' });
  await w.equip({ db, ...args, slot: 'head', itemId: '' });
  assert.deepEqual(w.equippedOf(pet(db)), {});
  await assert.rejects(w.equip({ db, ...args, slot: 'face', itemId: 'ribbon' }), /위치/);
  await w.equip({ db, ...args, slot: 'head', itemId: 'ribbon' });
  assert.deepEqual(w.equippedOf(pet(db)), { head: 'ribbon' });
});
test('간식: 하루 3번, 수치 상한, 상태 제한, 유대감 +3', async () => {
  const db = mk(20, { full: 70 });
  for (let i = 0; i < 3; i += 1) await w.snack({ db, uid: 'u1', ...args });
  assert.equal(pet(db).stats.full, 100); assert.equal(pet(db).stats.gems, 14);
  await assert.rejects(w.snack({ db, uid: 'u1', ...args }), /다 줬어요/);
  const fan = Object.values(db.dump().streamerFanPageTamagotchiFans.s1.p1)[0];
  assert.equal(fan.bond, 9);
  await w.snack({ db, uid: 'u1', ...args, now: T + 24 * 3600 * 1000 }); // 다음 날 다시 가능
  const sick = mk(20, { hospitalUntil: T + 3600 * 1000 });
  await assert.rejects(w.snack({ db: sick, ...args }), /먹을 수 없어요/);
});
test('공개 상점 보기: 보유 목록은 관리 권한에만', () => {
  const p = { wardrobe: { owned: { cape: 1 }, equipped: { back: 'cape', head: 'hat' } } };
  const fan = w.shopView(p, {}, T);
  assert.deepEqual(fan.equipped, { back: 'cape' });
  assert.equal('owned' in fan.items[0], false);
  assert.equal(w.shopView(p, {}, T, { manage: true }).items.find((i) => i.id === 'cape').owned, true);
});
