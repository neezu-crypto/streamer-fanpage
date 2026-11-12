'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const care = require('../tamagotchi-care');

const H = 3600 * 1000;
const T0 = Date.UTC(2026, 10, 12, 3); // 한국 12:00
const never = () => 1; // 보석이 나오지 않는 난수
const always = () => 0;

// 최소 RTDB 대역(get/set/remove/transaction/push/orderByKey)
function database(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial));
  let seq = 0;
  const parts = (p) => p.split('/').filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n == null ? null : n[k] ?? null), root);
  const write = (p, v) => {
    const keys = parts(p); let n = root;
    for (const k of keys.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    if (v == null) delete n[keys[keys.length - 1]]; else n[keys[keys.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const snap = (v) => ({ val: () => (v == null ? null : JSON.parse(JSON.stringify(v))) });
  const ref = (p) => ({
    get: async () => snap(read(p)),
    set: async (v) => write(p, v),
    remove: async () => write(p, null),
    child: (k) => ref(`${p}/${k}`),
    push: async (v) => { seq += 1; write(`${p}/k${String(seq).padStart(6, '0')}`, v); },
    orderByKey: () => ({ get: async () => snap(read(p)) }),
    transaction: async (fn) => {
      let out = fn(null); // 실제 SDK처럼 빈 캐시로 먼저 호출
      const cur = read(p);
      if (cur != null || out === undefined) out = fn(cur == null ? null : JSON.parse(JSON.stringify(cur)));
      if (out === undefined) return { committed: false, snapshot: snap(cur) };
      write(p, out); return { committed: true, snapshot: snap(out) };
    },
  });
  return { ref, dump: () => root };
}
const petDb = (stats) => database({ streamerFanPageTamagotchis: { s1: { p1: { status: 'active', speciesId: 'mongsil', ...(stats ? { stats } : {}) } } } });

test('시간 변화: 1시간에 배부름 -4, 기분 -2, 청결 -1.5, 피로 +3', () => {
  const s = care.advance({ ...care.freshStats(T0) }, T0 + H);
  assert.equal(s.full, 76); assert.equal(s.mood, 78); assert.equal(s.clean, 78.5); assert.equal(s.fatigue, 23); assert.equal(s.health, 100);
});

test('방치하면 건강이 떨어져 0에서 24시간 입원, 입원 중엔 정지, 퇴원 값', () => {
  let s = care.advance(care.freshStats(T0), T0 + 45 * H);
  assert.equal(care.conditionOf(s, T0 + 45 * H), 'hospital');
  const until = s.hospitalUntil;
  const frozen = care.advance(s, until - H);
  assert.equal(frozen.full, s.full);
  s = care.advance(s, until + 1000);
  assert.equal(s.health, 100); assert.equal(s.fatigue, 30); assert.equal(s.full, 50); assert.equal(s.hospitalUntil, 0);
  assert.ok(s.softUntil > until);
});

test('자연 회복은 80까지만', () => {
  const s = care.advance({ ...care.freshStats(T0), health: 70, full: 100, clean: 100, fatigue: 0, mood: 100 }, T0 + 20 * H);
  assert.ok(s.health <= 80 && s.health > 70);
});

test('낮잠: 분당 피로 -5, 0이 되면 자동 기상', () => {
  const s = care.advance({ ...care.freshStats(T0), fatigue: 50, sleepAt: T0 }, T0 + 20 * 60 * 1000);
  assert.equal(s.fatigue, 0); assert.equal(s.sleepAt, 0);
});

test('쓰다듬기 1분 5회, 10초 연타 감소, 쿨다운 이유', () => {
  const s = { ...care.freshStats(T0), mood: 50 }; const fan = care.normalizeFan(null, care.dayKey(T0));
  const r = [];
  for (let i = 0; i < 6; i += 1) r.push(care.applyOne(s, fan, 'pet', { now: T0 + i, rng: never }));
  assert.deepEqual(r.map((x) => x.applied), [true, true, true, true, true, false]);
  assert.equal(r[5].reason, 'cooldown');
  assert.equal(s.mood, 58.7);
});

test('밥: 배부름 95 이상이면 거절, 상태 제한(아픔에는 놀기 불가)', () => {
  const fan = care.normalizeFan(null, care.dayKey(T0));
  assert.equal(care.applyOne({ ...care.freshStats(T0), full: 96 }, fan, 'feed', { now: T0 }).reason, 'full');
  assert.equal(care.applyOne({ ...care.freshStats(T0), health: 20 }, fan, 'play', { now: T0 }).reason, 'condition');
});

test('팬 약한 상한: 기여 40 이상 50%, 80 이상 25%, 스트리머 1.5배', () => {
  assert.equal(care.softCapFactor(39, false), 1); assert.equal(care.softCapFactor(40, false), 0.5);
  assert.equal(care.softCapFactor(80, false), 0.25); assert.equal(care.softCapFactor(59, true), 1);
});

test('유대감 레벨: 50·150·300 …', () => {
  assert.equal(care.bondLevel(49), 1); assert.equal(care.bondLevel(50), 2); assert.equal(care.bondLevel(150), 3); assert.equal(care.bondLevel(1e6), 10);
});

test('하트 보석: 공동 금고, 팬 하루 3개, 건강 30 미만이면 없음, 금고 60 상한', () => {
  const s = { ...care.freshStats(T0) }; const fan = care.normalizeFan(null, care.dayKey(T0));
  for (let i = 0; i < 10; i += 1) care.applyOne(s, fan, 'talk', { now: T0 + i * 11000, rng: always });
  assert.equal(s.gems, 3); assert.equal(fan.gemsToday, 3);
  const sick = { ...care.freshStats(T0), health: 20 }; const f2 = care.normalizeFan(null, care.dayKey(T0));
  care.applyOne(sick, f2, 'talk', { now: T0, rng: always }); assert.equal(sick.gems, 0);
  const full = { ...care.freshStats(T0), gems: 60 }; const f3 = care.normalizeFan(null, care.dayKey(T0));
  care.applyOne(full, f3, 'talk', { now: T0, rng: always }); assert.equal(full.gems, 60);
});

test('입원 중 병문안은 유대감만, 다른 상호작용은 불가', () => {
  const s = { ...care.freshStats(T0), hospitalUntil: T0 + H, mood: 10 }; const fan = care.normalizeFan(null, care.dayKey(T0));
  assert.equal(care.applyOne(s, fan, 'pet', { now: T0 }).visit, true);
  assert.equal(s.mood, 10); assert.equal(fan.bond, 1);
  assert.equal(care.applyOne(s, fan, 'feed', { now: T0 }).reason, 'condition');
});

test('치료 단가: 외래 3개(하루 1회), 입원 4시간당 1개 최대 6개', () => {
  assert.deepEqual(care.treatmentQuote({ ...care.freshStats(T0), health: 20, gems: 5 }, T0), { kind: 'outpatient', cost: 3, available: true, usedToday: false });
  assert.equal(care.treatmentQuote({ ...care.freshStats(T0), hospitalUntil: T0 + 23 * H }, T0).cost, 6);
  assert.equal(care.treatmentQuote({ ...care.freshStats(T0), hospitalUntil: T0 + 5 * H }, T0).cost, 2);
  assert.equal(care.treatmentQuote(care.freshStats(T0), T0), null);
});

test('interact: 묶음 적용·팬 기록(UID 해시 키)·연속 전송 제한', async () => {
  const db = petDb(care.freshStats(T0));
  const out = await care.interact({ db, uid: 'u1', streamerId: 's1', petId: 'p1', batch: [{ kind: 'feed', n: 2 }], now: T0, rng: never });
  assert.equal(out.result.applied, 2);
  assert.ok(out.stats.full.value > 80);
  const fans = db.dump().streamerFanPageTamagotchiFans.s1.p1;
  assert.equal(Object.keys(fans).length, 1); assert.ok(!JSON.stringify(fans).includes('u1'));
  await assert.rejects(care.interact({ db, uid: 'u1', streamerId: 's1', petId: 'p1', batch: [{ kind: 'pet', n: 1 }], now: T0 + 500 }), { code: 'resource-exhausted' });
  await assert.rejects(care.interact({ db, uid: 'u1', streamerId: 's1', petId: 'p1', batch: [{ kind: 'x', n: 1 }], now: T0 + 5000 }), { code: 'invalid-argument' });
});

test('interact: 처음 상호작용하는 펫은 기본 스탯으로 시작', async () => {
  const db = petDb(null);
  const out = await care.interact({ db, uid: 'u1', streamerId: 's1', petId: 'p1', batch: [{ kind: 'pet', n: 1 }], now: T0, rng: never });
  assert.equal(out.condition, 'ok'); assert.equal(out.stats.mood.value, 83);
});

test('treat: 금고에서 차감·내역(누가 썼는지 없음)·부족하면 거절', async () => {
  const db = petDb({ ...care.freshStats(T0), health: 20, gems: 4 });
  const out = await care.treat({ db, uid: 'u1', streamerId: 's1', petId: 'p1', kind: 'outpatient', now: T0 });
  assert.equal(out.spent, 3); assert.equal(out.gems, 1); assert.equal(out.stats.health.value, 80);
  const log = Object.values(db.dump().streamerFanPageTamagotchis.s1.p1.gemLog);
  assert.deepEqual(log, [{ kind: 'outpatient', gems: 3, at: T0 }]);
  const poor = petDb({ ...care.freshStats(T0), hospitalUntil: T0 + 20 * H, gems: 1 });
  await assert.rejects(care.treat({ db: poor, uid: 'u1', streamerId: 's1', petId: 'p1', kind: 'discharge', now: T0 }), { code: 'failed-precondition' });
  await assert.rejects(care.treat({ db: petDb(null), uid: 'u1', streamerId: 's1', petId: 'p1', kind: 'discharge', now: T0 }), { code: 'failed-precondition' });
});

test('경고 단계: 30·10 아래', () => {
  assert.equal(care.warnLevel({ health: 31 }), 0); assert.equal(care.warnLevel({ health: 29 }), 1); assert.equal(care.warnLevel({ health: 9 }), 2);
});

test('누르고 있기: 초당 25%(4초=1회), 대상 도구만, 1분 횟수에 4초=1회', () => {
  const s = { ...care.freshStats(T0), full: 50 }; const fan = care.normalizeFan(null, care.dayKey(T0));
  assert.equal(care.applyHold(s, fan, 'feed', 4000, { now: T0, rng: never }).applied, true);
  assert.equal(s.full, 58);
  assert.equal(care.applyHold(s, fan, 'pet', 4000, { now: T0, rng: never }).applied, false);
  const t = { ...care.freshStats(T0) }; const f2 = care.normalizeFan(null, care.dayKey(T0));
  care.applyHold(t, f2, 'sing', 20000, { now: T0, rng: never }); // 5회분 → 1분 4회 상한
  assert.equal(f2.win.sing.mc, 4);
  assert.equal(care.applyHold(t, f2, 'sing', 4000, { now: T0 + 1, rng: never }).reason, 'cooldown');
});

test('interact: holdMs 검증·지난 전송 이후 시간으로 상한', async () => {
  assert.throws(() => care.validateBatch([{ kind: 'pet', n: 0, holdMs: 3000 }]), { code: 'invalid-argument' });
  assert.equal(care.validateBatch([{ kind: 'feed', n: 0, holdMs: 99999 }])[0].holdMs, 20000);
  const db = petDb({ ...care.freshStats(T0), full: 20 });
  await care.interact({ db, uid: 'u1', streamerId: 's1', petId: 'p1', batch: [{ kind: 'feed', n: 1 }], now: T0, rng: never });
  const out = await care.interact({ db, uid: 'u1', streamerId: 's1', petId: 'p1', batch: [{ kind: 'feed', n: 0, holdMs: 20000 }], now: T0 + 3000, rng: never });
  // 3초+1초 여유 = 4000ms → 1회분(+8)만 인정
  assert.ok(Math.abs(out.stats.full.value - 36) <= 1);
});

test('hideValues: 숫자 제거, band 유지', () => {
  const out = care.hideValues(care.publicStats(care.freshStats(T0), T0));
  assert.equal(out.stats.full.value, undefined); assert.equal(out.stats.full.band, 'good');
});
