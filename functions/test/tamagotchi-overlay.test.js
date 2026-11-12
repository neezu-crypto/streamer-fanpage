'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const care = require('../tamagotchi-care');
const ov = require('../tamagotchi-overlay');

const T0 = Date.UTC(2026, 10, 13, 3);
function database(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial));
  const parts = (p) => p.split('/').filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n == null ? null : n[k] ?? null), root);
  const write = (p, v) => {
    const keys = parts(p); let n = root;
    for (const k of keys.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    if (v == null) delete n[keys[keys.length - 1]]; else n[keys[keys.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const snap = (v) => ({ val: () => (v == null ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p) => ({
    get: async () => snap(read(p)), set: async (v) => write(p, v), remove: async () => write(p, null),
    transaction: async (fn) => { const out = fn(read(p)); if (out !== undefined) write(p, out); return { committed: out !== undefined, snapshot: snap(read(p)) }; },
  });
  return { ref, dump: () => root };
}
const petDb = () => database({ [care.PETS_ROOT]: { s1: { p1: { status: 'active', speciesId: 'mongsil', color: 'cream', nickname: '콩떡', stats: care.freshStats(T0) } } } });

test('발급: 토큰 원문은 저장하지 않고 해시 경로에 공개 요약(숫자 없음)', async () => {
  const db = petDb();
  const { token } = await ov.issue({ db, streamerId: 's1', petId: 'p1', now: T0 });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(db.dump()).includes(token));
  const live = db.dump()[ov.LIVE_ROOT][ov.hashToken(token)];
  assert.equal(live.nickname, '콩떡'); assert.equal(live.bands.full, 'good');
  assert.ok(!JSON.stringify(live).includes('"value"'));
});

test('재발급하면 이전 토큰은 무효, 해제하면 모두 삭제', async () => {
  const db = petDb();
  const a = await ov.issue({ db, streamerId: 's1', petId: 'p1', now: T0 });
  const b = await ov.issue({ db, streamerId: 's1', petId: 'p1', now: T0 + 1 });
  await assert.rejects(ov.state({ db, token: a.token, now: T0 + 10000 }), { code: 'not-found' });
  assert.equal((await ov.state({ db, token: b.token, now: T0 + 10000 })).nickname, '콩떡');
  await ov.revoke({ db, streamerId: 's1', petId: 'p1' });
  assert.deepEqual(db.dump()[ov.LIVE_ROOT] || {}, {}); assert.deepEqual(db.dump()[ov.INDEX_ROOT] || {}, {});
  await assert.rejects(ov.state({ db, token: b.token, now: T0 + 20000 }), { code: 'not-found' });
});

test('반응 피드: 종류별 횟수만, 10분 지난 버킷은 정리', async () => {
  const db = petDb();
  const { token } = await ov.issue({ db, streamerId: 's1', petId: 'p1', now: T0 });
  await ov.publish({ db, streamerId: 's1', petId: 'p1', counts: { feed: 2, pet: 1, bogus: 5 }, now: T0 });
  await ov.publish({ db, streamerId: 's1', petId: 'p1', counts: { feed: 1 }, now: T0 + 1000 });
  let live = db.dump()[ov.LIVE_ROOT][ov.hashToken(token)];
  assert.deepEqual(Object.values(live.recent), [{ feed: 3, pet: 1 }]);
  await ov.publish({ db, streamerId: 's1', petId: 'p1', counts: { talk: 1 }, now: T0 + 11 * 60000 });
  live = db.dump()[ov.LIVE_ROOT][ov.hashToken(token)];
  assert.deepEqual(Object.values(live.recent), [{ talk: 1 }]);
});

test('state: 잘못된 토큰 거절, 5초 안 반복은 기존 값', async () => {
  const db = petDb();
  await assert.rejects(ov.state({ db, token: 'short', now: T0 }), { code: 'invalid-argument' });
  const { token } = await ov.issue({ db, streamerId: 's1', petId: 'p1', now: T0 });
  assert.equal((await ov.state({ db, token, now: T0 + 1000 })).at, T0);
  assert.equal((await ov.state({ db, token, now: T0 + 3600000 })).at, T0 + 3600000);
});

test('오버레이가 없으면 publish는 아무것도 안 함', async () => {
  const db = petDb();
  assert.equal(await ov.publish({ db, streamerId: 's1', petId: 'p1', counts: { feed: 1 }, now: T0 }), false);
  assert.equal(db.dump()[ov.LIVE_ROOT], undefined);
});
