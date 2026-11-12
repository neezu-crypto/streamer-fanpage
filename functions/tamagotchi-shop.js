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
      removed.push(petId);
    }
  }
  return { removed: removed.length };
}

// 공개용 펫 목록: UID·요청 ID·결제 내역은 제외한다.
function publicPet(petId, pet, { isAdmin }) {
  const learned = pet && pet.learned && typeof pet.learned === 'object' ? Object.keys(pet.learned) : [];
  const out = {
    petId, speciesId: String(pet.speciesId || ''), color: String(pet.color || ''), nickname: String(pet.nickname || ''),
    adoptedAt: Number(pet.adoptedAt) || 0, learned,
  };
  if (isAdmin && pet.source === 'admin-test') out.test = true;
  return out;
}

async function listPets({ db, streamerId, isAdmin = false, stage = 'closed' }) {
  streamerId = validateStreamerId(streamerId);
  if (!tamagotchiOpenFor(stage, isAdmin)) return { pets: [] };
  const pets = (await db.ref(`${PETS_ROOT}/${streamerId}`).get()).val();
  const list = Object.entries(pets && typeof pets === 'object' ? pets : {})
    .filter(([, pet]) => pet && typeof pet === 'object' && pet.status === 'active')
    .map(([petId, pet]) => publicPet(petId, pet, { isAdmin }))
    .sort((a, b) => a.adoptedAt - b.adoptedAt || a.petId.localeCompare(b.petId));
  return { pets: list };
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
  cashBalance: (walletDb, uid) => payment.balance(walletDb, uid),
};
