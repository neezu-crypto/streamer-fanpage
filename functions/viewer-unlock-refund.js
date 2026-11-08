'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { resolveUnlockProduct } = require('./viewer-unlock-policy');
const { refundUnlockAccount } = require('./viewer-unlock-wallet');
const { acquireUnlockFeatureLocks } = require('./viewer-unlock-purchase');

async function transact(ref, callback) {
  let listener;
  await new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); });
  try { return await ref.transaction(callback, undefined, false); }
  finally { ref.off('value', listener); }
}

// 복구 불가능한 미확정 결제 전용. 호출자는 별도로 관리자 인증·사유·감사를 처리한다.
async function refundUnactivatedUnlock({ fanpageDb, walletDb, requestId, now = Date.now() }) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId || '') || !Number.isFinite(now)) throw new Error('invalid-input');
  const opRef = fanpageDb.ref(`viewerStatsUnlockPayments/operations/${requestId}`);
  const token = randomUUID();
  const reserved = await transact(opRef, (current) => {
    if (!current || !['review-required', 'refund-pending', 'refunded'].includes(current.status)) return;
    if (current.status === 'refunded') return current;
    if (Number(current.leaseUntil || 0) > now) return;
    return { ...current, status: 'refund-pending', leaseToken: token, leaseUntil: now + 120000, updatedAt: now };
  });
  if (!reserved.committed) throw new Error('operation-unavailable');
  const op = reserved.snapshot.val();
  if (op.status === 'refunded') return { status: 'refunded', replay: true };
  let release = null;
  try {
    const { uid, featureId, ownershipId, cashAmount } = op;
    const product = resolveUnlockProduct(featureId);
    if (!product || typeof uid !== 'string' || !uid || /[.#$\[\]/]/.test(uid) || !Number.isSafeInteger(cashAmount) || cashAmount <= 0 || ownershipId !== createHash('sha256').update(`${uid}:${featureId}:${requestId}`).digest('hex')) throw new Error('operation-conflict');
    release = await acquireUnlockFeatureLocks(fanpageDb, [uid], featureId, token, now);
    const accountRef = walletDb.ref(`gameSeriesWallet/accounts/${uid}`);
    const account = (await accountRef.get()).val();
    const purchase = account?.viewerStatsUnlockPurchases?.[requestId];
    if (!purchase || purchase.featureId !== featureId || purchase.cashAmount !== cashAmount || !['charged', 'refunded'].includes(purchase.status)) throw new Error('wallet-conflict');
    const lock = account?.viewerStatsUnlockPurchaseLocks?.[featureId];
    if (purchase.status === 'charged' && (lock?.requestId !== requestId || lock.status !== 'charged')) throw new Error('wallet-conflict');
    const ownerRef = fanpageDb.ref(`viewerStatsUnlockTransfers/ownership/${ownershipId}`);
    const owner = await transact(ownerRef, (current) => {
      if (!current) return null;
      if (current.ownerUid !== uid || current.featureId !== featureId || current.requestId !== requestId || !['pending', 'refund-cancelled'].includes(current.status)) return;
      return { ...current, status: 'refund-cancelled' };
    });
    if (!owner.committed) throw new Error('ownership-conflict');
    const indexRef = fanpageDb.ref(`viewerStatsUnlocks/${uid}/${featureId}`);
    const index = await transact(indexRef, (current) => !current || current.ownershipId === ownershipId ? null : current);
    if (!index.committed) throw new Error('index-conflict');
    let change;
    const refunded = await transact(accountRef, (current) => {
      const purchase = current?.viewerStatsUnlockPurchases?.[requestId];
      if (!purchase || purchase.cashAmount !== cashAmount) return;
      change = refundUnlockAccount(current, { requestId, featureId, now });
      return change.error ? undefined : change.account;
    });
    if (!refunded.committed) throw new Error(change?.error || 'wallet-conflict');
    const ledgerRef = walletDb.ref(`gameSeriesWallet/ledger/${uid}/${requestId}_viewerStatsUnlock_refund`);
    const ledger = await transact(ledgerRef, (current) => current
      ? current.requestId === requestId && current.type === 'viewerStatsUnlock_refund' && current.balanceDelta === cashAmount ? current : undefined
      : { requestId, type: 'viewerStatsUnlock_refund', balanceDelta: cashAmount, createdAt: now });
    if (!ledger.committed) throw new Error('refund-ledger-conflict');
    const done = await transact(opRef, (current) => {
      if (!current || current.leaseToken !== token || current.status !== 'refund-pending') return;
      return { ...current, status: 'refunded', refundedAt: now, updatedAt: now };
    });
    if (!done.committed) throw new Error('operation-conflict');
    return { status: 'refunded', replay: change?.replay === true };
  } finally {
    try { if (release) await release(); }
    finally { await transact(opRef, (current) => {
      if (!current || current.leaseToken !== token) return;
      const next = { ...current }; delete next.leaseToken; delete next.leaseUntil; return next;
    }); }
  }
}
module.exports = { refundUnactivatedUnlock };
