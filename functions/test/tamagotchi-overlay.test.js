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

test('댓글 UP: 고른 게시글을 새로고침할 때만 오버레이에 반영, 고른 항목만 공개', async () => {
  const db = petDb();
  const { token } = await ov.issue({ db, streamerId: 's1', petId: 'p1', now: T0 });
  const live = () => db.dump()[ov.LIVE_ROOT][ov.hashToken(token)];
  const comments = [{ likes: 3, rank: 9, total: 40 }, { likes: 120, rank: 3, total: 40 }];
  // 아무것도 고르지 않았으면 저장하지 않는다
  assert.equal(await ov.saveCommentUp({ db, streamerId: 's1', id: 'st_1', comments, now: T0 }), false);
  assert.equal(live().commentUp, undefined);
  await db.ref(`${ov.COMMENT_UP_ROOT}/s1`).set({ id: 'st_1', showRank: true, showUp: false });
  // 다른 게시글 새로고침은 반영하지 않는다
  assert.equal(await ov.saveCommentUp({ db, streamerId: 's1', id: 'st_2', comments, now: T0 }), false);
  assert.equal(await ov.saveCommentUp({ db, streamerId: 's1', id: 'st_1', comments, now: T0 + 5 }), true);
  assert.deepEqual(live().commentUp, { checkedAt: T0 + 5, found: true, rank: 3, total: 40 }); // UP은 끈 상태라 없음
  // 이후 돌봄 공개 갱신에도 유지
  await ov.publish({ db, streamerId: 's1', petId: 'p1', counts: { feed: 1 }, now: T0 + 10 });
  assert.equal(live().commentUp.rank, 3);
  assert.ok(!JSON.stringify(live()).includes('st_1')); // 게시글 식별자는 공개하지 않음
  // 댓글이 없으면 found:false, 숫자 없음
  await ov.saveCommentUp({ db, streamerId: 's1', id: 'st_1', comments: [], now: T0 + 20 });
  assert.deepEqual(live().commentUp, { checkedAt: T0 + 20, found: false });
  // 표시를 끄면 지운다
  await db.ref(`${ov.COMMENT_UP_ROOT}/s1`).remove(); await ov.publishCommentUp(db, 's1');
  assert.equal(live().commentUp, undefined);
});

test('댓글 UP 공개 요약: 확인 전이거나 표시 항목이 없으면 싣지 않음', () => {
  assert.equal(ov.commentUpPublic({ id: 'a_1', showRank: true, showUp: true }), null);
  assert.equal(ov.commentUpPublic({ id: 'a_1', showRank: false, showUp: false, checkedAt: 1, found: true }), null);
  assert.deepEqual(ov.commentUpPublic({ id: 'a_1', showRank: false, showUp: true, checkedAt: 1, found: true, likes: 7, rank: 2, total: 5 }), { checkedAt: 1, found: true, up: 7 });
});
