'use strict';

// 다마고치 분양소(2단계): 분양 결제, 관리자 테스트 지급·정리, 보유 목록.
// 펫 기록은 서버 전용 경로(`streamerFanPageTamagotchis`)에만 있고 클라이언트는 읽거나 쓰지 못한다.
// 결제는 cash-payment.js 공용 모듈(요청 ID 멱등 차감 → 원장 → 펫 생성, 실패 시 자동 환불)을 쓴다.

const { createHash } = require('node:crypto');
const { createCashProduct, freshTransaction } = require('./cash-payment');
const { getSpecies, speciesOnSale } = require('./tamagotchi-catalog');
const { tamagotchiOpenFor } = require('./tamagotchi-stage');

const PETS_ROOT = 'streamerFanPageTamagotchis';
const OPERATIONS_ROOT = 'streamerFanPageTamagotchiOperations';
const LIMITS_ROOT = 'streamerFanPageTamagotchiLimits';
const WALLET_PURCHASES_KEY = 'fanPageTamagotchiPurchases';
const LEDGER_KIND = 'fanPageTamagotchi';
const PRODUCT_ID = 'tamagotchi';
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const STREAMER_ID_RE = /^[a-z0-9_-]{1,64}$/;
const NICKNAME_MAX = 12;

class TamagotchiShopError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const payment = createCashProduct({
  purchasesKey: WALLET_PURCHASES_KEY,
  ledgerKind: LEDGER_KIND,
  productId: PRODUCT_ID,
  opsRoot: OPERATIONS_ROOT,
  limitsRoot: LIMITS_ROOT,
  cooldownMs: 5000,
  ErrorClass: TamagotchiShopError,
});

function validateStreamerId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!STREAMER_ID_RE.test(id)) throw new TamagotchiShopError('invalid-argument', '팬페이지를 확인해 주세요.');
  return id;
}

function validateRequestId(value) {
  const id = String(value || '');
  if (!REQUEST_ID_RE.test(id)) throw new TamagotchiShopError('invalid-argument', '결제 요청을 다시 시작해 주세요.');
  return id;
}

function validateUid(uid) {
  if (typeof uid !== 'string' || !uid || /[.#$\[\]/]/.test(uid)) throw new TamagotchiShopError('invalid-argument', '로그인 정보를 확인해 주세요.');
  return uid;
}

// 이름: 제어문자·줄바꿈 제거, 공백 정리, 1~12자. 비우면 종 이름. 금지어 필터는 두지 않는다(결정 사항).
function normalizeNickname(value, fallback) {
  const text = (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (Array.from(text).length > NICKNAME_MAX) throw new TamagotchiShopError('invalid-argument', `이름은 ${NICKNAME_MAX}자 이하로 입력해 주세요.`);
  return text;
}

function resolveSpecies(speciesId, color, { isAdmin, lookup = getSpecies }) {
  const species = lookup(speciesId);
  if (!species) throw new TamagotchiShopError('invalid-argument', '분양할 종류를 확인해 주세요.');
  if (!species.colors.includes(color)) throw new TamagotchiShopError('invalid-argument', '색을 확인해 주세요.');
  if (!isAdmin && !speciesOnSale(species)) throw new TamagotchiShopError('failed-precondition', '지금은 분양하지 않는 종류예요.');
  return species;
}

function assertOpen(stage, isAdmin) {
  if (!tamagotchiOpenFor(stage, isAdmin)) throw new TamagotchiShopError('failed-precondition', '다마고치 분양소를 준비하고 있어요. 곧 만나요!');
}

// 같은 요청 ID는 항상 같은 펫 ID가 되어, 재시도해도 펫이 두 마리 생기지 않는다.
function petIdFor(requestId) {
  return `p_${createHash('sha256').update(`tamagotchi-pet:${requestId}`).digest('hex').slice(0, 20)}`;
}

function sha(value) { return createHash('sha256').update(String(value)).digest('hex'); }

function adoptFingerprint({ streamerId, speciesId, color, cashAmount }) {
  return sha(JSON.stringify({ product: PRODUCT_ID, kind: 'adopt', streamerId, speciesId, color, cashAmount }));
}

function baseLearned(species, requestId, now) {
  const learned = {};
  species.baseInteractions.forEach((id) => { learned[id] = { learnedAt: now, requestId, cashAmount: 0 }; });
  return learned;
}

function petRef(db, streamerId, petId) { return db.ref(`${PETS_ROOT}/${streamerId}/${petId}`); }

// 같은 요청으로 이미 만든 펫이면 그대로 인정, 다른 요청이 같은 자리를 차지했다면 거절.
async function createPet({ db, streamerId, petId, record }) {
  const result = await freshTransaction(petRef(db, streamerId, petId), (current) => {
    if (!current) return record;
    if (current.requestId === record.requestId) return current;
    return;
  });
  const saved = result.snapshot.val();
  return !!saved && saved.requestId === record.requestId;
}

async function adoptPet({
  db, walletDb, uid, streamerId, speciesId, color, nickname, requestId, isAdmin = false, stage = 'closed', now = Date.now(), lookup,
}) {
  validateUid(uid);
  streamerId = validateStreamerId(streamerId);
  requestId = validateRequestId(requestId);
  assertOpen(stage, isAdmin);
  const species = resolveSpecies(speciesId, color, { isAdmin, lookup });
  const name = normalizeNickname(nickname, species.name);
  const petId = petIdFor(requestId);
  const cashAmount = species.adoptCash;

  const result = await payment.runPurchase({
    db, walletDb, uid, requestId, now,
    opMeta: { kind: 'adopt', streamerId, petId },
    cashAmount,
    fingerprint: adoptFingerprint({ streamerId, speciesId: species.id, color, cashAmount }),
    messages: {
      refundPending: '결제 후 분양을 마치지 못했고 환불을 확인 중이에요. 관리자에게 문의해 주세요.',
      refunded: '분양을 마치지 못해 자동 환불했어요. 다시 시도해 주세요.',
    },
    activate: async () => {
      const ok = await createPet({
        db, streamerId, petId,
        record: {
          speciesId: species.id, color, nickname: name, adoptedAt: now, source: 'purchase', requestId, cashAmount,
          buyerUidHash: sha(uid), learned: baseLearned(species, requestId, now), status: 'active',
        },
      });
      return ok ? { activated: true } : { activated: false, failureCode: 'pet-conflict' };
    },
  });
  if (!result.activated) throw new TamagotchiShopError('aborted', '분양을 마치지 못해 자동 환불했어요. 다시 시도해 주세요.');
  return { status: 'adopted', petId, remainingCash: result.remainingCash };
}

// 개발 검수용 테스트 지급. 캐시를 쓰지 않고 source를 'admin-test'로 남긴다.
async function adminGrantPet({ db, adminUid, isAdmin, streamerId, speciesId, color, nickname, requestId, now = Date.now() }) {
  if (isAdmin !== true) throw new TamagotchiShopError('permission-denied', '관리자만 사용할 수 있습니다.');
  validateUid(adminUid);
  streamerId = validateStreamerId(streamerId);
  requestId = validateRequestId(requestId);
  const species = resolveSpecies(speciesId, color, { isAdmin: true });
  const name = normalizeNickname(nickname, species.name);
  const petId = petIdFor(requestId);
  const ok = await createPet({
    db, streamerId, petId,
    record: {
      speciesId: species.id, color, nickname: name, adoptedAt: now, source: 'admin-test', requestId, cashAmount: 0,
      buyerUidHash: sha(adminUid), learned: baseLearned(species, requestId, now), status: 'active',
    },
  });
  if (!ok) throw new TamagotchiShopError('already-exists', '같은 요청 번호가 다른 펫에 사용됐어요. 다시 시도해 주세요.');
  return { status: 'granted', petId };
}

// ---------- 훈련소(3-B): 마리별로 상호작용을 배운다(상호작용당 카탈로그 가격, 환불 없음) ----------
const TRAIN_MAX = 8;
const TRAIN_MS = 5 * 60 * 1000; // 재주당 훈련 시간. 여러 개면 차례로(앞 훈련이 끝나면 다음).
const { learnedSet, trainingMap } = require('./tamagotchi-care');

// 지금 쓸 수 있는(훈련이 끝난) 재주
function petLearnedIds(pet, now = Date.now()) { return [...learnedSet(pet, now)]; }
// 훈련 중인 것까지 포함한 재주(중복 결제 방지용)
function petKnownIds(pet) {
  const species = getSpecies(pet && pet.speciesId);
  const learned = pet && pet.learned && typeof pet.learned === 'object' ? Object.keys(pet.learned) : [];
  return learned.length ? learned : (species ? [...species.baseInteractions] : []);
}

// 고른 상호작용 검증: 카탈로그의 trainable만, 중복 없이 1~8개. 정렬해서 돌려준다(요청 지문 고정).
function validateTrainItems(species, value) {
  const list = Array.isArray(value) ? value.map((v) => String(v || '')) : [];
  const unique = [...new Set(list)].sort();
  if (!unique.length || unique.length > TRAIN_MAX || unique.length !== list.length) {
    throw new TamagotchiShopError('invalid-argument', '배울 상호작용을 다시 골라 주세요.');
  }
  for (const id of unique) {
    if (!Object.prototype.hasOwnProperty.call(species.trainable, id)) throw new TamagotchiShopError('invalid-argument', '배울 수 없는 상호작용이 있어요.');
  }
  return unique;
}

async function loadTrainPet(db, streamerId, petId) {
  if (typeof petId !== 'string' || !/^p_[0-9a-f]{20}$/.test(petId)) throw new TamagotchiShopError('invalid-argument', '다마고치를 확인해 주세요.');
  const pet = (await petRef(db, streamerId, petId).get()).val();
  if (!pet || pet.status !== 'active') throw new TamagotchiShopError('not-found', '다마고치를 찾을 수 없어요.');
  const species = getSpecies(pet.speciesId);
  if (!species) throw new TamagotchiShopError('failed-precondition', '이 다마고치는 훈련할 수 없어요.');
  return { pet, species };
}

// 펫 learned에 원자적으로 추가. 같은 요청의 재시도는 그대로 인정, 다른 요청으로 이미 배운 것이 있으면 실패(→ 자동 환불).
async function addLearned({ db, streamerId, petId, items, species, requestId, now, source }) {
  let conflict = false;
  const result = await freshTransaction(petRef(db, streamerId, petId), (current) => {
    conflict = false;
    if (!current || current.status !== 'active') { conflict = true; return; }
    const learned = { ...(current.learned && typeof current.learned === 'object' ? current.learned : {}) };
    if (!Object.keys(learned).length) species.baseInteractions.forEach((id) => { learned[id] = { learnedAt: Number(current.adoptedAt) || now, requestId: String(current.requestId || ''), cashAmount: 0 }; });
    // 진행 중인 훈련이 있으면 그 뒤에 이어서 줄을 선다.
    let cursor = Math.max(now, ...Object.values(learned).map((v) => Number(v && v.learnedAt) || 0));
    for (const id of items) {
      if (learned[id]) { if (learned[id].requestId !== requestId) { conflict = true; return; } continue; }
      learned[id] = { trainStartAt: cursor, learnedAt: cursor + TRAIN_MS, requestId, cashAmount: source === 'admin-test' ? 0 : species.trainable[id], ...(source ? { source } : {}) };
      cursor += TRAIN_MS;
    }
    return { ...current, learned };
  });
  if (conflict || !result.committed) return null;
  return result.snapshot.val();
}

function trainFingerprint({ streamerId, petId, items, cashAmount }) {
  return sha(JSON.stringify({ product: PRODUCT_ID, kind: 'train', streamerId, petId, items, cashAmount }));
}

async function trainPet({ db, walletDb, uid, streamerId, petId, interactions, requestId, isAdmin = false, stage = 'closed', now = Date.now() }) {
  validateUid(uid);
  streamerId = validateStreamerId(streamerId);
  requestId = validateRequestId(requestId);
  assertOpen(stage, isAdmin);
  const { pet, species } = await loadTrainPet(db, streamerId, petId);
  const items = validateTrainItems(species, interactions);
  const already = items.filter((id) => petKnownIds(pet).includes(id));
  // 같은 요청의 재시도(이미 이 요청으로 배운 것)는 결제 모듈이 멱등 처리하므로 여기서 막지 않는다.
  const learnedByOther = already.filter((id) => !(pet.learned && pet.learned[id] && pet.learned[id].requestId === requestId));
  if (learnedByOther.length) {
    const err = new TamagotchiShopError('already-exists', '이미 배웠거나 훈련 중인 상호작용이 있어요. 다시 골라 주세요.'); err.details = { learned: learnedByOther }; throw err;
  }
  const cashAmount = items.reduce((sum, id) => sum + species.trainable[id], 0);
  let petAfter = null;
  const result = await payment.runPurchase({
    db, walletDb, uid, requestId, now,
    opMeta: { kind: 'train', streamerId, petId, items: items.join(',') },
    cashAmount,
    fingerprint: trainFingerprint({ streamerId, petId, items, cashAmount }),
    messages: {
      refundPending: '결제 후 훈련을 마치지 못했고 환불을 확인 중이에요. 관리자에게 문의해 주세요.',
      refunded: '훈련을 마치지 못해 자동 환불했어요. 다시 시도해 주세요.',
    },
    activate: async () => {
      petAfter = await addLearned({ db, streamerId, petId, items, species, requestId, now });
      return petAfter ? { activated: true } : { activated: false, failureCode: 'learn-conflict' };
    },
  });
  if (!result.activated) throw new TamagotchiShopError('aborted', '훈련을 마치지 못해 자동 환불했어요. 다시 시도해 주세요.');
  // 멱등 재시도(활성화 생략)면 저장된 펫을 다시 읽는다.
  const saved = petAfter || (await petRef(db, streamerId, petId).get()).val();
  return { status: 'trained', petId, items, learned: petLearnedIds(saved, now), training: trainingMap(saved, now), serverNow: now, remainingCash: result.remainingCash };
}

// 관리자 테스트 훈련: 캐시 없이, 관리자 테스트 펫에만.
async function adminTrainPet({ db, isAdmin, streamerId, petId, interactions, requestId, now = Date.now() }) {
  if (isAdmin !== true) throw new TamagotchiShopError('permission-denied', '관리자만 사용할 수 있습니다.');
  streamerId = validateStreamerId(streamerId);
  requestId = validateRequestId(requestId);
  const { pet, species } = await loadTrainPet(db, streamerId, petId);
  if (pet.source !== 'admin-test') throw new TamagotchiShopError('permission-denied', '테스트 다마고치에만 테스트 훈련을 할 수 있어요.');
  const items = validateTrainItems(species, interactions).filter((id) => !petKnownIds(pet).includes(id));
  if (!items.length) return { status: 'trained', petId, items: [], learned: petLearnedIds(pet, now), training: trainingMap(pet, now), serverNow: now };
  const saved = await addLearned({ db, streamerId, petId, items, species, requestId, now, source: 'admin-test' });
  if (!saved) throw new TamagotchiShopError('aborted', '테스트 훈련을 마치지 못했어요. 다시 시도해 주세요.');
  return { status: 'trained', petId, items, learned: petLearnedIds(saved, now), training: trainingMap(saved, now), serverNow: now };
}

// 판매 개시 전 정리: admin-test 펫만 지운다. 구매 펫은 건드리지 않는다.
async function adminClearTestPets({ db, isAdmin, streamerId }) {
  if (isAdmin !== true) throw new TamagotchiShopError('permission-denied', '관리자만 사용할 수 있습니다.');
  streamerId = validateStreamerId(streamerId);
  const pets = (await db.ref(`${PETS_ROOT}/${streamerId}`).get()).val();
  const removed = [];
  for (const [petId, pet] of Object.entries(pets && typeof pets === 'object' ? pets : {})) {
    if (pet && pet.source === 'admin-test') {
      await petRef(db, streamerId, petId).remove();
      await db.ref(`streamerFanPageTamagotchiFans/${streamerId}/${petId}`).remove(); // 돌봄 팬 기록도 함께 정리
      await require('./tamagotchi-overlay').removeForPet(db, streamerId, petId); // 방송 오버레이도 정리
      removed.push(petId);
    }
  }
  return { removed: removed.length };
}

// 공개용 펫 목록: UID·요청 ID·결제 내역은 제외한다.
function publicPet(petId, pet, { isAdmin, now = Date.now() }) {
  const out = {
    petId, speciesId: String(pet.speciesId || ''), color: String(pet.color || ''), nickname: String(pet.nickname || ''),
    adoptedAt: Number(pet.adoptedAt) || 0, learned: petLearnedIds(pet, now), training: trainingMap(pet, now),
    wear: require('./tamagotchi-wardrobe').equippedOf(pet), // 보석 상점 꾸미기(착용 중인 것만)
  };
  if (isAdmin && pet.source === 'admin-test') out.test = true;
  return out;
}

async function listPets({ db, streamerId, isAdmin = false, stage = 'closed', now = Date.now() }) {
  streamerId = validateStreamerId(streamerId);
  if (!tamagotchiOpenFor(stage, isAdmin)) return { pets: [] };
  const pets = (await db.ref(`${PETS_ROOT}/${streamerId}`).get()).val();
  const list = Object.entries(pets && typeof pets === 'object' ? pets : {})
    .filter(([, pet]) => pet && typeof pet === 'object' && pet.status === 'active')
    .map(([petId, pet]) => publicPet(petId, pet, { isAdmin, now }))
    .sort((a, b) => a.adoptedAt - b.adoptedAt || a.petId.localeCompare(b.petId));
  return { pets: list, serverNow: now };
}

// 카탈로그 응답에 싣는 호출자 정보. 본인의 인증 스트리머 공개 정보(id·닉네임)만 담고 UID는 넣지 않는다.
function buildViewer({ isAdmin, verified }) {
  const streamer = verified && verified.streamer && STREAMER_ID_RE.test(String(verified.streamer.id || ''))
    ? { id: String(verified.streamer.id), nickname: String(verified.streamer.nickname || '').slice(0, 40) }
    : null;
  return { isAdmin: isAdmin === true, isVerifiedStreamer: !!streamer, streamer };
}

module.exports = {
  buildViewer, PETS_ROOT, OPERATIONS_ROOT, LIMITS_ROOT, WALLET_PURCHASES_KEY, LEDGER_KIND, TamagotchiShopError,
  petIdFor, normalizeNickname, adoptPet, adminGrantPet, adminClearTestPets, listPets, validateStreamerId,
  trainPet, adminTrainPet, petLearnedIds, petKnownIds, validateTrainItems, TRAIN_MAX, TRAIN_MS,
  cashBalance: (walletDb, uid) => payment.balance(walletDb, uid),
};
