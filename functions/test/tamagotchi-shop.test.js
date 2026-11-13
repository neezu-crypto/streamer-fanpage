'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const shop = require('../tamagotchi-shop');
const { SPECIES, publicCatalog, getSpecies } = require('../tamagotchi-catalog');

// 경로를 중첩 객체로 보관하는 최소 RTDB 대역.
function database(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial));
  const failures = new Set();
  const walk = (path, create) => {
    const keys = path.split('/').filter(Boolean);
    let node = root;
    for (const key of keys.slice(0, -1)) {
      if (node[key] == null || typeof node[key] !== 'object') { if (!create) return [null, null]; node[key] = {}; }
      node = node[key];
    }
    return [node, keys[keys.length - 1]];
  };
  const read = (path) => { const [node, key] = walk(path, false); const v = node ? node[key] : undefined; return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  const write = (path, value) => { const [node, key] = walk(path, true); if (value === null) delete node[key]; else node[key] = JSON.parse(JSON.stringify(value)); };
  return {
    read, failOnce(path) { failures.add(path); },
    ref(path) {
      return {
        on(_e, cb) { queueMicrotask(cb); }, off() {},
        async get() { const v = read(path); return { val: () => v, exists: () => v !== null }; },
        async transaction(fn) {
          if (failures.has(path)) { failures.delete(path); throw new Error('simulated-failure'); }
          const cur = read(path); const next = fn(cur);
          if (next === undefined) return { committed: false, snapshot: { val: () => cur } };
          write(path, next); return { committed: true, snapshot: { val: () => read(path) } };
        },
        async update(part) { write(path, { ...(read(path) || {}), ...part }); },
        async remove() { write(path, null); },
      };
    },
  };
}

const uid = 'user1';
const streamerId = 'gmyo0o';
const requestId = 'adopt_request_1234567890';
const wallet = (balance) => database({ gameSeriesWallet: { accounts: { [uid]: { balanceCash: balance } } } });
const bal = (w) => w.read(`gameSeriesWallet/accounts/${uid}/balanceCash`);
const onSale = (id) => { const s = getSpecies(id); return s && { ...s, status: 'on-sale' }; };
const base = (db, walletDb, extra = {}) => ({
  db, walletDb, uid, streamerId, speciesId: 'mongsil', color: 'mint', nickname: '', requestId,
  isAdmin: false, stage: 'public', lookup: onSale, now: 20_000_000, ...extra,
});
const pets = (db) => db.read(`streamerFanPageTamagotchis/${streamerId}`) || {};

test('카탈로그: 몽실이 50캐시, 색 4종, 기본 4종, 훈련 8종 각 10캐시', () => {
  const s = SPECIES.mongsil;
  assert.equal(s.adoptCash, 50);
  assert.deepEqual([...s.colors], ['cream', 'pink', 'mint', 'lavender']);
  assert.deepEqual([...s.baseInteractions], ['pet', 'feed', 'groom', 'gem']);
  assert.equal(Object.keys(s.trainable).length, 8);
  assert.ok(Object.values(s.trainable).every((cash) => cash === 10));
  assert.equal(s.status, 'closed');
});

test('공개 카탈로그: 비관리자는 판매 중인 종만, 관리자는 전체(훈련 가격 포함)', () => {
  assert.deepEqual(publicCatalog({ isAdmin: false }), []);
  const admin = publicCatalog({ isAdmin: true });
  assert.equal(admin.length, 1);
  assert.equal(admin[0].adoptCash, 50);
  assert.equal(admin[0].trainable.length, 8);
  assert.ok(!JSON.stringify(admin).includes('uid'));
});

test('분양하면 50캐시가 차감되고 펫과 기본 상호작용이 생긴다', async () => {
  const db = database(); const w = wallet(120);
  const result = await shop.adoptPet(base(db, w));
  assert.equal(result.status, 'adopted');
  assert.equal(result.remainingCash, 70);
  assert.equal(bal(w), 70);
  const [pet] = Object.values(pets(db));
  assert.equal(pet.speciesId, 'mongsil');
  assert.equal(pet.color, 'mint');
  assert.equal(pet.nickname, '몽실이');
  assert.equal(pet.source, 'purchase');
  assert.equal(pet.cashAmount, 50);
  assert.deepEqual(Object.keys(pet.learned).sort(), ['feed', 'gem', 'groom', 'pet']);
  assert.equal(pet.learned.pet.cashAmount, 0);
  assert.equal(w.read(`gameSeriesWallet/ledger/${uid}/${requestId}_fanPageTamagotchi/balanceDelta`), -50);
  assert.equal(db.read(`streamerFanPageTamagotchiOperations/${requestId}/status`), 'activated');
  assert.equal(db.read(`streamerFanPageTamagotchiOperations/${requestId}/kind`), 'adopt');
});

test('같은 요청을 다시 보내도 펫은 1마리, 차감은 1번', async () => {
  const db = database(); const w = wallet(120);
  const first = await shop.adoptPet(base(db, w));
  const again = await shop.adoptPet(base(db, w, { now: 20_030_000 }));
  assert.equal(again.petId, first.petId);
  assert.equal(Object.keys(pets(db)).length, 1);
  assert.equal(bal(w), 70);
});

test('다른 요청으로 여러 마리를 분양할 수 있다(마리 수 제한 없음)', async () => {
  const db = database(); const w = wallet(200);
  await shop.adoptPet(base(db, w));
  await shop.adoptPet(base(db, w, { requestId: 'adopt_request_second_0001', color: 'pink', nickname: '두번째', now: 20_030_000 }));
  assert.equal(Object.keys(pets(db)).length, 2);
  assert.equal(bal(w), 100);
});

test('잔액 부족이면 차감도 펫도 없다', async () => {
  const db = database(); const w = wallet(49);
  await assert.rejects(shop.adoptPet(base(db, w)), (e) => e.code === 'failed-precondition');
  assert.equal(bal(w), 49);
  assert.deepEqual(pets(db), {});
  assert.equal(db.read(`streamerFanPageTamagotchiOperations/${requestId}/status`), 'failed-no-charge');
});

test('펫 기록 장애는 자동 환불하고 펫을 만들지 않는다', async () => {
  const db = database(); const w = wallet(120);
  db.failOnce(`streamerFanPageTamagotchis/${streamerId}/${shop.petIdFor(requestId)}`);
  await assert.rejects(shop.adoptPet(base(db, w)));
  assert.equal(bal(w), 120);
  assert.deepEqual(pets(db), {});
  assert.equal(w.read(`gameSeriesWallet/ledger/${uid}/${requestId}_fanPageTamagotchi_refund/balanceDelta`), 50);
  assert.equal(db.read(`streamerFanPageTamagotchiOperations/${requestId}/status`), 'refunded');
});

test('공개 단계 게이트: closed/admin 에서 비관리자 분양 거부, 관리자는 허용', async () => {
  for (const stage of ['closed', 'admin']) {
    const db = database(); const w = wallet(120);
    await assert.rejects(shop.adoptPet(base(db, w, { stage })), (e) => e.code === 'failed-precondition');
    assert.equal(bal(w), 120);
  }
  const db = database(); const w = wallet(120);
  const ok = await shop.adoptPet(base(db, w, { stage: 'admin', isAdmin: true }));
  assert.equal(ok.status, 'adopted');
});

test('판매 상태가 on-sale 이 아니면 public 이어도 비관리자는 분양할 수 없다', async () => {
  const db = database(); const w = wallet(120);
  await assert.rejects(shop.adoptPet(base(db, w, { lookup: undefined })), (e) => e.code === 'failed-precondition');
  assert.equal(bal(w), 120);
});

test('입력 검증: 종·색·이름·요청 번호·팬페이지·UID', async () => {
  const db = database(); const w = wallet(120);
  await assert.rejects(shop.adoptPet(base(db, w, { speciesId: 'dragon' })), (e) => e.code === 'invalid-argument');
  await assert.rejects(shop.adoptPet(base(db, w, { color: 'red' })), (e) => e.code === 'invalid-argument');
  await assert.rejects(shop.adoptPet(base(db, w, { nickname: '가'.repeat(13) })), (e) => e.code === 'invalid-argument');
  await assert.rejects(shop.adoptPet(base(db, w, { requestId: 'short' })), (e) => e.code === 'invalid-argument');
  await assert.rejects(shop.adoptPet(base(db, w, { streamerId: '../x' })), (e) => e.code === 'invalid-argument');
  await assert.rejects(shop.adoptPet(base(db, w, { uid: 'a/b' })), (e) => e.code === 'invalid-argument');
  assert.equal(bal(w), 120);
  assert.deepEqual(pets(db), {});
});

test('이름 정리: 줄바꿈 제거, 공백 정리, 12자 허용, 빈 값은 종 이름', () => {
  assert.equal(shop.normalizeNickname('  두  부 \n 야 ', 'x'), '두 부 야');
  assert.equal(shop.normalizeNickname('가'.repeat(12), 'x'), '가'.repeat(12));
  assert.equal(shop.normalizeNickname('   ', '몽실이'), '몽실이');
  assert.equal(shop.normalizeNickname(null, '몽실이'), '몽실이');
});

test('다른 계정이 쓴 요청 번호는 재사용할 수 없다', async () => {
  const db = database(); const w = database({ gameSeriesWallet: { accounts: { user1: { balanceCash: 200 }, user2: { balanceCash: 200 } } } });
  await shop.adoptPet(base(db, w));
  await assert.rejects(shop.adoptPet(base(db, w, { uid: 'user2', now: 20_030_000 })), (e) => e.code === 'already-exists');
  assert.equal(w.read('gameSeriesWallet/accounts/user2/balanceCash'), 200);
});

test('짧은 간격의 연속 새 분양 요청은 제한한다', async () => {
  const db = database(); const w = wallet(200);
  await shop.adoptPet(base(db, w));
  await assert.rejects(shop.adoptPet(base(db, w, { requestId: 'adopt_request_second_0001', now: 20_001_000 })), (e) => e.code === 'resource-exhausted');
  assert.equal(bal(w), 150);
});

test('관리자 테스트 지급: 캐시 미사용, 관리자만, 같은 요청은 1마리', async () => {
  const db = database();
  await assert.rejects(shop.adminGrantPet({ db, adminUid: uid, isAdmin: false, streamerId, speciesId: 'mongsil', color: 'cream', requestId }), (e) => e.code === 'permission-denied');
  const first = await shop.adminGrantPet({ db, adminUid: 'admin1', isAdmin: true, streamerId, speciesId: 'mongsil', color: 'cream', nickname: '시험', requestId, now: 1 });
  const again = await shop.adminGrantPet({ db, adminUid: 'admin1', isAdmin: true, streamerId, speciesId: 'mongsil', color: 'cream', nickname: '시험', requestId, now: 2 });
  assert.equal(first.petId, again.petId);
  const [pet] = Object.values(pets(db));
  assert.equal(pet.source, 'admin-test');
  assert.equal(pet.cashAmount, 0);
  assert.equal(Object.keys(pets(db)).length, 1);
});

test('테스트 펫 정리는 admin-test 만 지우고 구매 펫은 남긴다', async () => {
  const db = database(); const w = wallet(120);
  await shop.adoptPet(base(db, w));
  await shop.adminGrantPet({ db, adminUid: 'admin1', isAdmin: true, streamerId, speciesId: 'mongsil', color: 'pink', requestId: 'admin_request_1234567890' });
  assert.equal(Object.keys(pets(db)).length, 2);
  await assert.rejects(shop.adminClearTestPets({ db, isAdmin: false, streamerId }), (e) => e.code === 'permission-denied');
  const cleared = await shop.adminClearTestPets({ db, isAdmin: true, streamerId });
  assert.equal(cleared.removed, 1);
  const left = Object.values(pets(db));
  assert.equal(left.length, 1);
  assert.equal(left[0].source, 'purchase');
});

test('보유 목록: 공개 전 비관리자는 빈 목록, UID·결제 정보는 응답에 없다, 테스트 표시는 관리자에게만', async () => {
  const db = database(); const w = wallet(120);
  await shop.adoptPet(base(db, w));
  await shop.adminGrantPet({ db, adminUid: 'admin1', isAdmin: true, streamerId, speciesId: 'mongsil', color: 'pink', requestId: 'admin_request_1234567890' });
  assert.deepEqual((await shop.listPets({ db, streamerId, isAdmin: false, stage: 'admin' })).pets, []);
  const admin = await shop.listPets({ db, streamerId, isAdmin: true, stage: 'admin' });
  assert.equal(admin.pets.length, 2);
  assert.equal(admin.pets.filter((p) => p.test).length, 1);
  const fan = await shop.listPets({ db, streamerId, isAdmin: false, stage: 'public' });
  assert.equal(fan.pets.length, 2);
  assert.ok(fan.pets.every((p) => p.test === undefined));
  const text = JSON.stringify(fan);
  assert.ok(!/user1|admin1|buyerUidHash|requestId|cashAmount/.test(text));
});

test('카탈로그 호출자 정보: 인증 스트리머는 id·닉네임만, 그 외는 null, UID 미포함', () => {
  const v = shop.buildViewer({ isAdmin: false, verified: { uid: 'secret-uid', streamer: { id: 'gmyo0o', nickname: '그묘', soopId: 'gmyo0o' } } });
  assert.deepEqual(v, { isAdmin: false, isVerifiedStreamer: true, streamer: { id: 'gmyo0o', nickname: '그묘' } });
  assert.ok(!JSON.stringify(v).includes('secret-uid'));
  assert.deepEqual(shop.buildViewer({ isAdmin: true, verified: null }), { isAdmin: true, isVerifiedStreamer: false, streamer: null });
  assert.equal(shop.buildViewer({ isAdmin: false, verified: { streamer: { id: '../x' } } }).streamer, null);
});

// ---------- 훈련소(3-B) ----------
async function adopted(balance = 200) {
  const db = database(); const w = wallet(balance);
  const r = await shop.adoptPet(base(db, w));
  return { db, w, petId: r.petId };
}
const trainArgs = (db, w, petId, extra = {}) => ({
  db, walletDb: w, uid, streamerId, petId, interactions: ['walk', 'play'], requestId: 'train_request_123456789',
  isAdmin: false, stage: 'public', now: 30_000_000, ...extra,
});

test('훈련: 고른 개수×10캐시 차감, learned에 추가, 응답은 정렬된 목록', async () => {
  const { db, w, petId } = await adopted(200);
  const r = await shop.trainPet(trainArgs(db, w, petId));
  assert.equal(r.status, 'trained');
  assert.deepEqual(r.items, ['play', 'walk']);
  assert.equal(bal(w), 200 - 50 - 20);
  const learned = pets(db)[petId].learned;
  assert.ok(learned.walk && learned.play && learned.pet);
  assert.equal(learned.walk.cashAmount, 10);
  assert.equal(r.remainingCash, 130);
});

test('훈련: 같은 요청 번호 재시도는 다시 차감하지 않는다', async () => {
  const { db, w, petId } = await adopted(200);
  await shop.trainPet(trainArgs(db, w, petId));
  const again = await shop.trainPet(trainArgs(db, w, petId, { now: 30_010_000 }));
  assert.equal(again.status, 'trained');
  assert.equal(bal(w), 130);
});

test('훈련: 이미 배운 것(다른 요청)·기본 상호작용·없는 id·중복·빈 목록은 결제 전에 거절', async () => {
  const { db, w, petId } = await adopted(200);
  await shop.trainPet(trainArgs(db, w, petId));
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { interactions: ['walk', 'sing'], requestId: 'train_request_other_0001', now: 30_020_000 })), (e) => e.code === 'already-exists' && e.details.learned.includes('walk'));
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { interactions: ['feed'], requestId: 'train_request_other_0002', now: 30_030_000 })), { code: 'invalid-argument' });
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { interactions: ['fly'], requestId: 'train_request_other_0003', now: 30_040_000 })), { code: 'invalid-argument' });
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { interactions: ['sing', 'sing'], requestId: 'train_request_other_0004', now: 30_050_000 })), { code: 'invalid-argument' });
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { interactions: [], requestId: 'train_request_other_0005', now: 30_060_000 })), { code: 'invalid-argument' });
  assert.equal(bal(w), 130);
});

test('훈련: 캐시 부족이면 차감·학습 없음', async () => {
  const { db, w, petId } = await adopted(60);
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId)));
  assert.equal(bal(w), 10);
  assert.equal(pets(db)[petId].learned.walk, undefined);
});

test('훈련: 결제 사이 다른 요청이 먼저 배웠으면 자동 환불', async () => {
  const { db, w, petId } = await adopted(200);
  const real = db.ref.bind(db);
  // 결제 직후(learned 트랜잭션 직전) 다른 요청이 walk를 배운 상황을 흉내 낸다
  db.ref = (path) => {
    const r = real(path);
    if (path === `streamerFanPageTamagotchis/${streamerId}/${petId}`) {
      return { ...r, transaction: async (fn) => { const cur = db.read(path); cur.learned.walk = { requestId: 'someone_else', learnedAt: 1, cashAmount: 10 }; return real(path).transaction(() => fn(cur)); } };
    }
    return r;
  };
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId)), { code: 'aborted' });
  db.ref = real;
  assert.equal(bal(w), 150);
});

test('훈련: 공개 전 단계에서는 비관리자 거절, 없는 펫 거절', async () => {
  const { db, w, petId } = await adopted(200);
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { stage: 'closed' })), { code: 'failed-precondition' });
  await assert.rejects(shop.trainPet(trainArgs(db, w, 'p_0123456789abcdef0123')), { code: 'not-found' });
  await assert.rejects(shop.trainPet(trainArgs(db, w, '../x')), { code: 'invalid-argument' });
});

test('관리자 테스트 훈련: 테스트 펫만, 캐시 없이, 이미 배운 것은 건너뜀', async () => {
  const db = database();
  const g = await shop.adminGrantPet({ db, adminUid: 'admin1', isAdmin: true, streamerId, speciesId: 'mongsil', color: 'cream', nickname: '', requestId: 'grant_request_123456789' });
  const r = await shop.adminTrainPet({ db, isAdmin: true, streamerId, petId: g.petId, interactions: ['bath', 'nap'], requestId: 'admintrain_req_12345678' });
  assert.deepEqual(r.items, ['bath', 'nap']);
  assert.equal(pets(db)[g.petId].learned.bath.source, 'admin-test');
  const again = await shop.adminTrainPet({ db, isAdmin: true, streamerId, petId: g.petId, interactions: ['bath'], requestId: 'admintrain_req_99999999' });
  assert.deepEqual(again.items, []);
  await assert.rejects(shop.adminTrainPet({ db, isAdmin: false, streamerId, petId: g.petId, interactions: ['bath'], requestId: 'admintrain_req_12345678' }), { code: 'permission-denied' });
  const { db: db2, petId } = await adopted(200);
  await assert.rejects(shop.adminTrainPet({ db: db2, isAdmin: true, streamerId, petId, interactions: ['bath'], requestId: 'admintrain_req_12345678' }), { code: 'permission-denied' });
});

test('목록: learned 기록이 없는 예전 펫은 기본 4종으로 보인다', async () => {
  const db = database({ streamerFanPageTamagotchis: { [streamerId]: { p_0123456789abcdef0123: { status: 'active', speciesId: 'mongsil', color: 'cream', nickname: 'a', adoptedAt: 1 } } } });
  const { pets: list } = await shop.listPets({ db, streamerId, isAdmin: true, stage: 'closed' });
  assert.deepEqual(list[0].learned, ['pet', 'feed', 'groom', 'gem']);
});

test('훈련 시간: 재주당 5분씩 차례로, 끝나기 전엔 training, 끝나면 learned', async () => {
  const { db, w, petId } = await adopted(200);
  const t0 = 30_000_000; const M = shop.TRAIN_MS;
  const r = await shop.trainPet(trainArgs(db, w, petId));
  assert.equal(M, 5 * 60 * 1000);
  assert.deepEqual(r.training, { play: { startAt: t0, endAt: t0 + M }, walk: { startAt: t0 + M, endAt: t0 + 2 * M } });
  assert.ok(!r.learned.includes('play') && r.learned.includes('pet'));
  const mid = await shop.listPets({ db, streamerId, isAdmin: false, stage: 'public', now: t0 + M });
  assert.ok(mid.pets[0].learned.includes('play') && !mid.pets[0].learned.includes('walk'));
  assert.deepEqual(Object.keys(mid.pets[0].training), ['walk']);
  const done = await shop.listPets({ db, streamerId, isAdmin: false, stage: 'public', now: t0 + 2 * M });
  assert.ok(done.pets[0].learned.includes('walk'));
  assert.deepEqual(done.pets[0].training, {});
  // 훈련 중인 재주는 다시 살 수 없고, 새 훈련은 진행 중인 훈련 뒤에 줄을 선다
  await assert.rejects(shop.trainPet(trainArgs(db, w, petId, { interactions: ['walk'], requestId: 'train_request_other_0010', now: t0 + 1000 })), (e) => e.code === 'already-exists');
  const q = await shop.trainPet(trainArgs(db, w, petId, { interactions: ['sing'], requestId: 'train_request_other_0011', now: t0 + 10_000 }));
  assert.deepEqual(q.training.sing, { startAt: t0 + 2 * M, endAt: t0 + 3 * M });
});

test('돌봄: 훈련 중인 재주는 끝날 때까지 not-learned로 막힌다', () => {
  const care = require('../tamagotchi-care');
  const pet = { learned: { pet: { learnedAt: 1 }, dance: { trainStartAt: 100, learnedAt: 400 } } };
  assert.ok(!care.learnedSet(pet, 399).has('dance'));
  assert.ok(care.learnedSet(pet, 400).has('dance'));
  assert.deepEqual(care.trainingMap(pet, 399), { dance: { startAt: 100, endAt: 400 } });
  assert.deepEqual(care.trainingMap(pet, 400), {});
});
