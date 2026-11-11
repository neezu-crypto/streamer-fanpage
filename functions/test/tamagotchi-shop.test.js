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
