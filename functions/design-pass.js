'use strict';

// 디자인 3 이용권(영구제, 통합 캐시 결제).
// 이용권은 UID가 아니라 인증 스트리머 팬페이지(streamerId)에 붙는다. 이용권 기록은
// 서버 전용 경로(`streamerFanPageDesignPasses`)에만 있고 클라이언트는 읽거나 쓰지 못한다.
// 결제는 viewer-sponsors.js와 같은 방식(요청 ID 멱등 차감 → 원장 → 활성화, 실패 시 자동 환불)이다.

const { createHash } = require('node:crypto');

const PRODUCT_ID = 'layout3';
const PRICE_CASH = 100;
const PASS_ROOT = 'streamerFanPageDesignPasses';
const OPERATIONS_ROOT = 'streamerFanPageDesignPassOperations';
const LIMITS_ROOT = 'streamerFanPageDesignPassLimits';
const WALLET_ROOT = 'gameSeriesWallet';
const WALLET_PURCHASES_KEY = 'fanPageDesignPassPurchases';
const LEDGER_KIND = 'fanPageDesignPass';
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const STREAMER_ID_RE = /^[a-z0-9_-]{1,64}$/;
const REQUEST_COOLDOWN_MS = 5000;

class DesignPassError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
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

async function freshTransaction(ref, update) {
  let listener;
  await new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); });
  try { return await ref.transaction(update, undefined, false); }
  finally { ref.off('value', listener); }
}

// 통합 캐시 차감. 같은 요청 ID로 다시 호출하면 이미 차감된 결제를 그대로 인정한다.
async function debitCash({ walletDb, uid, requestId, streamerId, now }) {
  const accountRef = walletDb.ref(`${WALLET_ROOT}/accounts/${uid}`);
  const fingerprint = paymentFingerprint(streamerId);
  let insufficient = false;
  let conflict = false;
  let previous = null;
  const result = await freshTransaction(accountRef, (current) => {
    insufficient = false; conflict = false; previous = null;
    const account = current && typeof current === 'object' ? current : {};
    const purchases = account[WALLET_PURCHASES_KEY] && typeof account[WALLET_PURCHASES_KEY] === 'object' ? account[WALLET_PURCHASES_KEY] : {};
    previous = purchases[requestId] || null;
    if (previous) {
      conflict = previous.fingerprint !== fingerprint || Number(previous.cashAmount) !== PRICE_CASH;
      return account;
    }
    const balance = nonNegativeInteger(account.balanceCash);
    if (balance < PRICE_CASH) { insufficient = true; return; }
    return {
      ...account,
      balanceCash: balance - PRICE_CASH,
      [WALLET_PURCHASES_KEY]: {
        ...purchases,
        [requestId]: { requestId, product: LEDGER_KIND, productId: PRODUCT_ID, cashAmount: PRICE_CASH, fingerprint, status: 'charged', chargedAt: now },
      },
    };
  });
  if (conflict) throw new DesignPassError('already-exists', '같은 결제 번호가 다른 내용에 사용됐어요. 다시 시도해 주세요.');
  if (previous && previous.status !== 'charged') throw new DesignPassError('failed-precondition', '이미 환불 처리된 결제 요청이에요. 다시 결제해 주세요.');
  if (insufficient) throw new DesignPassError('failed-precondition', `통합 캐시가 부족해요. 필요 ${PRICE_CASH}캐시입니다.`);
  if (!result.committed && !previous) throw new DesignPassError('aborted', '통합 캐시 차감에 실패했어요. 다시 시도해 주세요.');
  const account = result.snapshot.val() || {};
  return { alreadyCharged: !!previous, remainingCash: nonNegativeInteger(account.balanceCash) };
}

async function writeLedger({ walletDb, uid, requestId, now, refund = false }) {
  const type = refund ? `${LEDGER_KIND}_refund` : LEDGER_KIND;
  const delta = refund ? PRICE_CASH : -PRICE_CASH;
  const ref = walletDb.ref(`${WALLET_ROOT}/ledger/${uid}/${requestId}_${type}`);
  const result = await freshTransaction(ref, (current) => {
    if (current) return current.requestId === requestId && current.type === type && Number(current.balanceDelta) === delta ? current : undefined;
    return { requestId, type, balanceDelta: delta, createdAt: now };
  });
  if (!result.committed) throw new DesignPassError('aborted', '결제 원장을 대조하지 못했어요. 관리자에게 문의해 주세요.');
}

async function refundCash({ walletDb, uid, requestId, now, reason }) {
  const accountRef = walletDb.ref(`${WALLET_ROOT}/accounts/${uid}`);
  let outcome = null;
  const result = await freshTransaction(accountRef, (current) => {
    outcome = null;
    const account = current && typeof current === 'object' ? current : {};
    const purchases = account[WALLET_PURCHASES_KEY] && typeof account[WALLET_PURCHASES_KEY] === 'object' ? account[WALLET_PURCHASES_KEY] : {};
    const purchase = purchases[requestId];
    if (!purchase || Number(purchase.cashAmount) !== PRICE_CASH || !['charged', 'refunded'].includes(purchase.status)) return;
    if (purchase.status === 'refunded') { outcome = { alreadyRefunded: true }; return account; }
    outcome = { alreadyRefunded: false };
    return {
      ...account,
      balanceCash: nonNegativeInteger(account.balanceCash) + PRICE_CASH,
      [WALLET_PURCHASES_KEY]: { ...purchases, [requestId]: { ...purchase, status: 'refunded', refundedAt: now, refundReason: reason } },
    };
  });
  if (!outcome && !result.committed) throw new DesignPassError('aborted', '자동 환불을 완료하지 못했어요. 관리자에게 문의해 주세요.');
  await writeLedger({ walletDb, uid, requestId, now, refund: true });
  return outcome || { alreadyRefunded: true };
}

async function cashBalance(walletDb, uid) {
  const value = (await walletDb.ref(`${WALLET_ROOT}/accounts/${uid}/balanceCash`).get()).val();
  return nonNegativeInteger(value);
}

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

  const opRef = db.ref(`${OPERATIONS_ROOT}/${requestId}`);
  // 새 결제 요청만 연속 호출을 제한한다. 같은 요청 번호의 재시도(네트워크 끊김 복구)는 막지 않는다.
  if (!(await opRef.get()).val()) {
    const limit = await freshTransaction(db.ref(`${LIMITS_ROOT}/${uid}`), (current) => {
      if (now - (Number(current && current.lastRequestedAt) || 0) < REQUEST_COOLDOWN_MS) return;
      return { lastRequestedAt: now };
    });
    if (!limit.committed) throw new DesignPassError('resource-exhausted', '잠시 후 다시 시도해 주세요.');
  }
  let opError = '';
  const op = await freshTransaction(opRef, (current) => {
    opError = '';
    if (!current) return { uid, streamerId, requestId, cashAmount: PRICE_CASH, status: 'processing', createdAt: now };
    if (current.uid !== uid || current.streamerId !== streamerId) { opError = 'conflict'; return; }
    if (current.status === 'refunded') { opError = 'refunded'; return; }
    return current;
  });
  if (!op.committed) {
    throw new DesignPassError('already-exists', opError === 'refunded'
      ? '이전 결제는 자동 환불됐어요. 다시 결제해 주세요.' : '같은 결제 번호가 다른 내용에 사용됐어요. 다시 시도해 주세요.');
  }
  if (op.snapshot.val().status === 'failed-no-charge') {
    await opRef.update({ status: 'processing', updatedAt: now });
  }

  let charged = false;
  try {
    const debit = await debitCash({ walletDb, uid, requestId, streamerId, now });
    charged = true;
    await writeLedger({ walletDb, uid, requestId, now });
    const grant = await freshTransaction(passRef(db, streamerId), (current) => {
      if (!current) return { status: 'active', source: 'purchase', requestId, cashAmount: PRICE_CASH, purchasedAt: now, buyerUidHash: createHash('sha256').update(uid).digest('hex') };
      if (isActivePass(current) && current.requestId === requestId) return current;
      return;
    });
    const saved = grant.snapshot.val();
    if (!isActivePass(saved) || saved.requestId !== requestId) {
      // 동시에 다른 결제/부여가 먼저 이용권을 만들었다. 이번 결제는 환불한다.
      await refundCash({ walletDb, uid, requestId, now, reason: 'already-owned' });
      await opRef.update({ status: 'refunded', failureCode: 'already-owned', updatedAt: now });
      return { status: 'owned', alreadyOwned: true, remainingCash: await cashBalance(walletDb, uid) };
    }
    await opRef.update({ status: 'activated', updatedAt: now });
    return { status: 'activated', alreadyOwned: false, remainingCash: debit.remainingCash };
  } catch (error) {
    if (!charged) {
      await opRef.update({ status: 'failed-no-charge', failureCode: String(error && error.code || 'error').slice(0, 40), updatedAt: now }).catch(() => {});
      throw error;
    }
    try {
      await refundCash({ walletDb, uid, requestId, now, reason: 'activation-failed' });
      await opRef.update({ status: 'refunded', failureCode: 'activation-failed', updatedAt: now });
    } catch (refundError) {
      await opRef.update({ status: 'refund-pending', updatedAt: now }).catch(() => {});
      throw new DesignPassError('aborted', '결제 후 이용권을 켜지 못했고 환불을 확인 중이에요. 관리자에게 문의해 주세요.');
    }
    throw new DesignPassError('aborted', '이용권을 켜지 못해 자동 환불했어요. 다시 시도해 주세요.');
  }
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
