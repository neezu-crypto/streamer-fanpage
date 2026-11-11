'use strict';

// 통합 캐시 결제 공용 모듈(요청 ID 멱등 차감 → 원장 → 상품 활성화, 실패 시 자동 환불).
// design-pass.js(디자인 3 이용권)의 검증된 흐름을 상품별 설정으로 일반화한 것이다.
// 상품마다 경로 키·원장 종류·작업 경로만 다르고, 저장 형태는 기존 이용권 기록과 같다.

const WALLET_ROOT = 'gameSeriesWallet';

class CashPaymentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

async function freshTransaction(ref, update) {
  let listener;
  await new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); });
  try { return await ref.transaction(update, undefined, false); }
  finally { ref.off('value', listener); }
}

function validUid(uid) {
  return typeof uid === 'string' && !!uid && !/[.#$\[\]/]/.test(uid);
}

// purchasesKey: 지갑 계정 아래 차감 기록 키, ledgerKind: 원장 종류, opsRoot/limitsRoot: 팬페이지 DB 작업·제한 경로.
function createCashProduct({
  purchasesKey, ledgerKind, productId, opsRoot, limitsRoot, cooldownMs = 5000, ErrorClass = CashPaymentError,
}) {
  const fail = (code, message) => new ErrorClass(code, message);

  // 통합 캐시 차감. 같은 요청 ID로 다시 호출하면 이미 차감된 결제를 그대로 인정한다.
  async function debit({ walletDb, uid, requestId, fingerprint, cashAmount, now }) {
    const amount = positiveInteger(cashAmount);
    if (!amount) throw fail('invalid-argument', '결제 금액을 확인해 주세요.');
    const accountRef = walletDb.ref(`${WALLET_ROOT}/accounts/${uid}`);
    let insufficient = false;
    let conflict = false;
    let previous = null;
    const result = await freshTransaction(accountRef, (current) => {
      insufficient = false; conflict = false; previous = null;
      const account = current && typeof current === 'object' ? current : {};
      const purchases = account[purchasesKey] && typeof account[purchasesKey] === 'object' ? account[purchasesKey] : {};
      previous = purchases[requestId] || null;
      if (previous) {
        conflict = previous.fingerprint !== fingerprint || Number(previous.cashAmount) !== amount;
        return account;
      }
      const balance = nonNegativeInteger(account.balanceCash);
      if (balance < amount) { insufficient = true; return; }
      return {
        ...account,
        balanceCash: balance - amount,
        [purchasesKey]: {
          ...purchases,
          [requestId]: { requestId, product: ledgerKind, productId, cashAmount: amount, fingerprint, status: 'charged', chargedAt: now },
        },
      };
    });
    if (conflict) throw fail('already-exists', '같은 결제 번호가 다른 내용에 사용됐어요. 다시 시도해 주세요.');
    if (previous && previous.status !== 'charged') throw fail('failed-precondition', '이미 환불 처리된 결제 요청이에요. 다시 결제해 주세요.');
    if (insufficient) throw fail('failed-precondition', `통합 캐시가 부족해요. 필요 ${amount}캐시입니다.`);
    if (!result.committed && !previous) throw fail('aborted', '통합 캐시 차감에 실패했어요. 다시 시도해 주세요.');
    const account = result.snapshot.val() || {};
    return { alreadyCharged: !!previous, remainingCash: nonNegativeInteger(account.balanceCash) };
  }

  async function writeLedger({ walletDb, uid, requestId, cashAmount, now, refund = false }) {
    const amount = positiveInteger(cashAmount);
    const type = refund ? `${ledgerKind}_refund` : ledgerKind;
    const delta = refund ? amount : -amount;
    const ref = walletDb.ref(`${WALLET_ROOT}/ledger/${uid}/${requestId}_${type}`);
    const result = await freshTransaction(ref, (current) => {
      if (current) return current.requestId === requestId && current.type === type && Number(current.balanceDelta) === delta ? current : undefined;
      return { requestId, type, balanceDelta: delta, createdAt: now };
    });
    if (!result.committed) throw fail('aborted', '결제 원장을 대조하지 못했어요. 관리자에게 문의해 주세요.');
  }

  // 환불은 차감 기록에 남은 금액을 기준으로 돌려준다(가격이 나중에 바뀌어도 같은 금액).
  async function refund({ walletDb, uid, requestId, now, reason }) {
    const accountRef = walletDb.ref(`${WALLET_ROOT}/accounts/${uid}`);
    let outcome = null;
    let amount = 0;
    const result = await freshTransaction(accountRef, (current) => {
      outcome = null; amount = 0;
      const account = current && typeof current === 'object' ? current : {};
      const purchases = account[purchasesKey] && typeof account[purchasesKey] === 'object' ? account[purchasesKey] : {};
      const purchase = purchases[requestId];
      if (!purchase || !positiveInteger(purchase.cashAmount) || !['charged', 'refunded'].includes(purchase.status)) return;
      amount = positiveInteger(purchase.cashAmount);
      if (purchase.status === 'refunded') { outcome = { alreadyRefunded: true }; return account; }
      outcome = { alreadyRefunded: false };
      return {
        ...account,
        balanceCash: nonNegativeInteger(account.balanceCash) + amount,
        [purchasesKey]: { ...purchases, [requestId]: { ...purchase, status: 'refunded', refundedAt: now, refundReason: reason } },
      };
    });
    if (!outcome && !result.committed) throw fail('aborted', '자동 환불을 완료하지 못했어요. 관리자에게 문의해 주세요.');
    await writeLedger({ walletDb, uid, requestId, cashAmount: amount, now, refund: true });
    return outcome || { alreadyRefunded: true };
  }

  async function balance(walletDb, uid) {
    return nonNegativeInteger((await walletDb.ref(`${WALLET_ROOT}/accounts/${uid}/balanceCash`).get()).val());
  }

  // 결제 전체 흐름. opMeta는 작업 기록에 함께 저장하고 같은 요청 ID 재사용 시 일치 여부를 대조한다.
  // activate()는 상품을 켜고 { activated: true, ...data } 또는 { activated: false, failureCode }를 돌려준다.
  // activated가 false면 이번 결제는 환불한다. activate가 던지면 자동 환불한다.
  async function runPurchase({ db, walletDb, uid, requestId, opMeta, cashAmount, fingerprint, activate, now = Date.now(), messages = {} }) {
    if (!validUid(uid)) throw fail('invalid-argument', '로그인 정보를 확인해 주세요.');
    const amount = positiveInteger(cashAmount);
    if (!amount) throw fail('invalid-argument', '결제 금액을 확인해 주세요.');
    const metaKeys = Object.keys(opMeta || {});
    const opRef = db.ref(`${opsRoot}/${requestId}`);
    // 새 결제 요청만 연속 호출을 제한한다. 같은 요청 번호의 재시도(네트워크 끊김 복구)는 막지 않는다.
    if (!(await opRef.get()).val()) {
      const limit = await freshTransaction(db.ref(`${limitsRoot}/${uid}`), (current) => {
        if (now - (Number(current && current.lastRequestedAt) || 0) < cooldownMs) return;
        return { lastRequestedAt: now };
      });
      if (!limit.committed) throw fail('resource-exhausted', '잠시 후 다시 시도해 주세요.');
    }
    let opError = '';
    const op = await freshTransaction(opRef, (current) => {
      opError = '';
      if (!current) return { uid, ...opMeta, requestId, cashAmount: amount, status: 'processing', createdAt: now };
      if (current.uid !== uid || metaKeys.some((key) => current[key] !== opMeta[key])) { opError = 'conflict'; return; }
      if (current.status === 'refunded') { opError = 'refunded'; return; }
      return current;
    });
    if (!op.committed) {
      throw fail('already-exists', opError === 'refunded'
        ? '이전 결제는 자동 환불됐어요. 다시 결제해 주세요.' : '같은 결제 번호가 다른 내용에 사용됐어요. 다시 시도해 주세요.');
    }
    if (op.snapshot.val().status === 'failed-no-charge') {
      await opRef.update({ status: 'processing', updatedAt: now });
    }

    let charged = false;
    try {
      const paid = await debit({ walletDb, uid, requestId, fingerprint, cashAmount: amount, now });
      charged = true;
      await writeLedger({ walletDb, uid, requestId, cashAmount: amount, now });
      const outcome = await activate();
      if (!outcome || outcome.activated !== true) {
        const failureCode = String(outcome && outcome.failureCode || 'not-activated').slice(0, 40);
        await refund({ walletDb, uid, requestId, now, reason: failureCode });
        await opRef.update({ status: 'refunded', failureCode, updatedAt: now });
        return { activated: false, failureCode, remainingCash: await balance(walletDb, uid), data: outcome || {} };
      }
      await opRef.update({ status: 'activated', updatedAt: now });
      return { activated: true, remainingCash: paid.remainingCash, data: outcome };
    } catch (error) {
      if (!charged) {
        await opRef.update({ status: 'failed-no-charge', failureCode: String(error && error.code || 'error').slice(0, 40), updatedAt: now }).catch(() => {});
        throw error;
      }
      try {
        await refund({ walletDb, uid, requestId, now, reason: 'activation-failed' });
        await opRef.update({ status: 'refunded', failureCode: 'activation-failed', updatedAt: now });
      } catch (refundError) {
        await opRef.update({ status: 'refund-pending', updatedAt: now }).catch(() => {});
        throw fail('aborted', messages.refundPending || '결제 후 상품을 켜지 못했고 환불을 확인 중이에요. 관리자에게 문의해 주세요.');
      }
      throw fail('aborted', messages.refunded || '상품을 켜지 못해 자동 환불했어요. 다시 시도해 주세요.');
    }
  }

  return { debit, refund, writeLedger, balance, runPurchase };
}

module.exports = { CashPaymentError, createCashProduct, freshTransaction, nonNegativeInteger };
