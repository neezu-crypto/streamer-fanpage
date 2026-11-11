'use strict';

// 디자인 3 이용권(영구제, 통합 캐시 결제).
// 이용권은 UID가 아니라 인증 스트리머 팬페이지(streamerId)에 붙는다. 이용권 기록은
// 서버 전용 경로(`streamerFanPageDesignPasses`)에만 있고 클라이언트는 읽거나 쓰지 못한다.
// 결제는 viewer-sponsors.js와 같은 방식(요청 ID 멱등 차감 → 원장 → 활성화, 실패 시 자동 환불)이다.

const { createHash } = require('node:crypto');
const { createCashProduct, freshTransaction } = require('./cash-payment');

const PRODUCT_ID = 'layout3';
const PRICE_CASH = 100;
const PASS_ROOT = 'streamerFanPageDesignPasses';
const OPERATIONS_ROOT = 'streamerFanPageDesignPassOperations';
const LIMITS_ROOT = 'streamerFanPageDesignPassLimits';
const WALLET_PURCHASES_KEY = 'fanPageDesignPassPurchases';
const LEDGER_KIND = 'fanPageDesignPass';
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const STREAMER_ID_RE = /^[a-z0-9_-]{1,64}$/;
const REQUEST_COOLDOWN_MS = 5000;

class DesignPassError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function validateStreamerId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!STREAMER_ID_RE.test(id)) throw new DesignPassError('invalid-argument', '팬페이지를 확인해 주세요.');
  return id;
}

function validateRequestId(value) {
  const id = String(value || '');
  if (!REQUEST_ID_RE.test(id)) throw new DesignPassError('invalid-argument', '결제 요청을 다시 시작해 주세요.');
  return id;
}

function paymentFingerprint(streamerId) {
  return createHash('sha256').update(JSON.stringify({ product: PRODUCT_ID, streamerId, cashAmount: PRICE_CASH })).digest('hex');
}

function passRef(db, streamerId) { return db.ref(`${PASS_ROOT}/${streamerId}/${PRODUCT_ID}`); }

// 유효한 이용권 기록인지(상태가 active인지)만 판정한다.
function isActivePass(record) {
  return !!record && typeof record === 'object' && record.status === 'active';
}

async function hasDesignPass(db, streamerId) {
  if (!STREAMER_ID_RE.test(String(streamerId || ''))) return false;
  return isActivePass((await passRef(db, streamerId).get()).val());
}

// 유료 디자인(현재는 디자인 3)을 하나라도 가진 팬페이지인지. 주간 방송표 고급 템플릿은 특정 디자인이 아니라
// 유료 디자인 이용권 전체에 묶여 있어, 앞으로 유료 디자인이 늘어도 이 함수 하나로 판정한다.
async function hasPaidDesign(db, streamerId) {
  if (!STREAMER_ID_RE.test(String(streamerId || ''))) return false;
  const passes = (await db.ref(`${PASS_ROOT}/${streamerId}`).get()).val();
  return !!passes && typeof passes === 'object' && Object.values(passes).some(isActivePass);
}

const payment = createCashProduct({
  purchasesKey: WALLET_PURCHASES_KEY,
  ledgerKind: LEDGER_KIND,
  productId: PRODUCT_ID,
  opsRoot: OPERATIONS_ROOT,
  limitsRoot: LIMITS_ROOT,
  cooldownMs: REQUEST_COOLDOWN_MS,
  ErrorClass: DesignPassError,
});

function cashBalance(walletDb, uid) { return payment.balance(walletDb, uid); }

// 구매. 호출자는 uid가 streamerId 팬페이지의 인증 스트리머인지 먼저 확인해야 한다.
async function purchaseDesignPass({ db, walletDb, uid, streamerId, requestId, now = Date.now() }) {
  streamerId = validateStreamerId(streamerId);
  requestId = validateRequestId(requestId);
  if (typeof uid !== 'string' || !uid || /[.#$\[\]/]/.test(uid)) throw new DesignPassError('invalid-argument', '로그인 정보를 확인해 주세요.');

  const existing = (await passRef(db, streamerId).get()).val();
  if (isActivePass(existing)) {
    if (existing.requestId === requestId) return { status: 'activated', alreadyOwned: false, remainingCash: await cashBalance(walletDb, uid) };
    return { status: 'owned', alreadyOwned: true, remainingCash: await cashBalance(walletDb, uid) };
  }

  const result = await payment.runPurchase({
    db, walletDb, uid, requestId, now,
    opMeta: { streamerId },
    cashAmount: PRICE_CASH,
    fingerprint: paymentFingerprint(streamerId),
    messages: {
      refundPending: '결제 후 이용권을 켜지 못했고 환불을 확인 중이에요. 관리자에게 문의해 주세요.',
      refunded: '이용권을 켜지 못해 자동 환불했어요. 다시 시도해 주세요.',
    },
    activate: async () => {
      const grant = await freshTransaction(passRef(db, streamerId), (current) => {
        if (!current) return { status: 'active', source: 'purchase', requestId, cashAmount: PRICE_CASH, purchasedAt: now, buyerUidHash: createHash('sha256').update(uid).digest('hex') };
        if (isActivePass(current) && current.requestId === requestId) return current;
        return;
      });
      const saved = grant.snapshot.val();
      // 동시에 다른 결제/부여가 먼저 이용권을 만들었다면 이번 결제는 환불한다.
      if (!isActivePass(saved) || saved.requestId !== requestId) return { activated: false, failureCode: 'already-owned' };
      return { activated: true };
    },
  });
  if (!result.activated) return { status: 'owned', alreadyOwned: true, remainingCash: result.remainingCash };
  return { status: 'activated', alreadyOwned: false, remainingCash: result.remainingCash };
}

// 관리자 부여/회수. 캐시는 건드리지 않는다(환불은 별도 절차).
async function grantDesignPass({ db, streamerId, adminUid, now = Date.now() }) {
  streamerId = validateStreamerId(streamerId);
  const result = await freshTransaction(passRef(db, streamerId), (current) => {
    if (isActivePass(current)) return current;
    return { status: 'active', source: 'admin', cashAmount: 0, purchasedAt: now, buyerUidHash: createHash('sha256').update(String(adminUid)).digest('hex') };
  });
  return { granted: result.committed, owned: isActivePass(result.snapshot.val()) };
}

async function revokeDesignPass({ db, streamerId }) {
  streamerId = validateStreamerId(streamerId);
  await passRef(db, streamerId).remove();
  return { revoked: true };
}

module.exports = {
  PRODUCT_ID, PRICE_CASH, PASS_ROOT, WALLET_PURCHASES_KEY, DesignPassError,
  hasDesignPass, hasPaidDesign, isActivePass, purchaseDesignPass, grantDesignPass, revokeDesignPass, cashBalance,
  validateStreamerId, validateRequestId,
};
