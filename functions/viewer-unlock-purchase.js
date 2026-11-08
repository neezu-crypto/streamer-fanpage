'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { resolveUnlockProduct } = require('./viewer-unlock-policy');
const { debitUnlockAccount, finalizeUnlockAccount } = require('./viewer-unlock-wallet');
const { hasViewerUnlock } = require('./viewer-unlock-access');

// 별도 DB 사이에 원자 트랜잭션은 없다. 각 단계는 요청 ID로 멱등 재실행한다.
async function freshTransaction(ref, update) {
  let listener;
  await new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); });
  try { return await ref.transaction(update, undefined, false); }
  finally { ref.off('value', listener); }
}
// 구매와 권한 이전이 동일 계정·기능에 동시에 작용하지 않도록 공통 경로를 사용한다.
async function acquireUnlockFeatureLocks(db, uids, featureId, token, now) {
  if (!resolveUnlockProduct(featureId) || !Array.isArray(uids) || !uids.length || uids.some((uid) => typeof uid !== 'string' || !uid || /[.#$\[\]/]/.test(uid)) || !token || !Number.isFinite(now)) throw new Error('invalid-lock');
  const refs = [...new Set(uids)].sort().map((uid) => db.ref(`viewerStatsUnlockTransfers/featureLocks/${uid}/${featureId}`));
  const held = [];
  const release = async () => {
    for (const ref of held.slice().reverse()) await freshTransaction(ref, (current) => current?.token === token ? null : undefined);
  };
  try {
    for (const ref of refs) {
      const result = await freshTransaction(ref, (current) => {
        if (current && current.token !== token && Number(current.leaseUntil) > now) return;
        return { token, leaseUntil: now + 120000 };
      });
      if (!result.committed) throw new Error('feature-busy');
      held.push(ref);
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
async function purchaseViewerUnlock({ fanpageDb, walletDb, uid, featureId, requestId, now = Date.now() }) {
  const product = resolveUnlockProduct(featureId);
  if (!product || typeof uid !== 'string' || !uid || /[.#$\[\]/]/.test(uid) || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('invalid-input');
  const opRef = fanpageDb.ref(`viewerStatsUnlockPayments/operations/${requestId}`);
  const ownerId = createHash('sha256').update(`${uid}:${featureId}:${requestId}`).digest('hex');
  const leaseToken = randomUUID();
  let reservationError = '';
  const op = await freshTransaction(opRef, (current) => {
    reservationError = '';
    if (current && (current.uid !== uid || current.featureId !== featureId)) { reservationError = 'request-conflict'; return; }
    if (current?.status === 'activated') return current;
    if (current && current.status !== 'processing') { reservationError = 'operation-final'; return; }
    if (current?.leaseUntil > now) { reservationError = 'operation-busy'; return; }
    return { ...(current || { uid, featureId, requestId, cashAmount: product.priceCash, ownershipId: ownerId, status: 'processing', createdAt: now }), leaseToken, leaseUntil: now + 120000 };
  });
  if (!op.committed) throw new Error(reservationError || 'request-conflict');
  const operation = op.snapshot.val();
  if (operation.cashAmount !== product.priceCash || operation.ownershipId !== ownerId || operation.status === 'refunded') throw new Error('operation-conflict');
  if (operation.status === 'activated') return { status: 'activated', alreadyOwned: false };
  let releaseFeatureLocks = null;
  try {
  releaseFeatureLocks = await acquireUnlockFeatureLocks(fanpageDb, [uid], featureId, leaseToken, now);
  const userIndexRef = fanpageDb.ref(`viewerStatsUnlockPayments/byUser/${uid}/${requestId}`);
  const userIndex = await freshTransaction(userIndexRef, (current) => {
    if (current) return current.featureId === featureId && current.requestId === requestId ? current : undefined;
    return { requestId, featureId, createdAt: operation.createdAt };
  });
  if (!userIndex.committed) throw new Error('user-index-conflict');
  // 관리자 화면의 최신 결제순 조회용 인덱스다. 원본 결제 레코드가 권위 데이터다.
  const createdKey = `${String(operation.createdAt).padStart(13, '0')}_${requestId}`;
  const createdIndexRef = fanpageDb.ref(`viewerStatsUnlockPayments/byCreated/${createdKey}`);
  const createdIndex = await freshTransaction(createdIndexRef, (current) => {
    if (current) return current.requestId === requestId ? current : undefined;
    return { requestId, uid, featureId, createdAt: operation.createdAt };
  });
  if (!createdIndex.committed) throw new Error('created-index-conflict');
  if (await hasViewerUnlock({ db: fanpageDb, uid, featureId, authenticated: true })) {
    if (operation.status === 'activated') return { status: 'activated', alreadyOwned: false };
    const existing = (await fanpageDb.ref(`viewerStatsUnlockTransfers/ownership/${ownerId}`).get()).val();
    if (existing?.ownerUid === uid && existing.featureId === featureId && existing.requestId === requestId && existing.status === 'active') {
      await opRef.update({ status: 'activated', updatedAt: now });
      return { status: 'activated', alreadyOwned: false };
    }
    await opRef.update({ status: 'no-charge', failureCode: 'already-owned', updatedAt: now });
    throw new Error('already-owned');
  }
  const accountRef = walletDb.ref(`gameSeriesWallet/accounts/${uid}`);
  let debit;
  const charged = await freshTransaction(accountRef, (current) => {
    debit = debitUnlockAccount(current, { requestId, featureId, now });
    return debit.error ? undefined : debit.account;
  });
  if (!charged.committed) {
    if (['insufficient', 'invalid-balance', 'feature-locked'].includes(debit?.error)) await opRef.update({ status: 'no-charge', failureCode: debit.error, updatedAt: now });
    throw new Error(debit?.error || 'wallet-unavailable');
  }
  const ledgerRef = walletDb.ref(`gameSeriesWallet/ledger/${uid}/${requestId}_viewerStatsUnlock`);
  const ledger = await freshTransaction(ledgerRef, (current) => {
    if (current) return current.requestId === requestId && current.type === 'viewerStatsUnlock' && current.balanceDelta === -product.priceCash ? current : undefined;
    return { requestId, type: 'viewerStatsUnlock', balanceDelta: -product.priceCash, createdAt: now };
  });
  if (!ledger.committed) throw new Error('ledger-conflict');
  const ownershipRef = fanpageDb.ref(`viewerStatsUnlockTransfers/ownership/${ownerId}`);
  const ownership = await freshTransaction(ownershipRef, (current) => {
    if (current) return current.ownerUid === uid && current.featureId === featureId && current.requestId === requestId ? current : undefined;
    return { ownerUid: uid, featureId, requestId, status: 'pending', createdAt: now };
  });
  if (!ownership.committed) throw new Error('ownership-conflict');
  const indexRef = fanpageDb.ref(`viewerStatsUnlocks/${uid}/${featureId}`);
  const index = await freshTransaction(indexRef, (current) => {
    if (current && current.ownershipId !== ownerId) return;
    return { ownershipId: ownerId };
  });
  if (!index.committed) throw new Error('index-conflict');
  let finalized;
  const wallet = await freshTransaction(accountRef, (current) => {
    finalized = finalizeUnlockAccount(current, { requestId, featureId, ownershipId: ownerId, now });
    return finalized.error ? undefined : finalized.account;
  });
  if (!wallet.committed) throw new Error(finalized?.error || 'wallet-finalize-failed');
  const active = await freshTransaction(ownershipRef, (current) => {
    if (!current || current.ownerUid !== uid || current.featureId !== featureId || current.requestId !== requestId || !['pending', 'active'].includes(current.status)) return;
    return { ...current, status: 'active', activatedAt: current.activatedAt || now };
  });
  if (!active.committed) throw new Error('ownership-activation-conflict');
  await opRef.update({ status: 'activated', updatedAt: now });
  return { status: 'activated', alreadyOwned: false };
  } finally {
    try { if (releaseFeatureLocks) await releaseFeatureLocks(); }
    finally {
      await freshTransaction(opRef, (current) => {
        if (!current || current.leaseToken !== leaseToken) return;
        const next = { ...current }; delete next.leaseToken; delete next.leaseUntil; return next;
      });
    }
  }
}
async function reconcileViewerUnlockPayments({ fanpageDb, walletDb, now = Date.now(), limit = 100 }) {
  const snapshot = await fanpageDb.ref('viewerStatsUnlockPayments/operations').get();
  const entries = Object.entries(snapshot.val() || {}).filter(([, op]) => op?.status === 'processing' && Number(op.createdAt) <= now - 5 * 60000 && Number(op.leaseUntil || 0) <= now && Number(op.nextRetryAt || 0) <= now).slice(0, Math.max(0, Math.min(100, limit)));
  let recovered = 0, review = 0;
  for (const [requestId, operation] of entries) {
    try {
      await purchaseViewerUnlock({ fanpageDb, walletDb, uid: operation.uid, featureId: operation.featureId, requestId, now });
      recovered++;
    } catch (error) {
      const code = String(error?.message || 'unknown');
      if (['operation-busy', 'feature-busy', 'operation-final'].includes(code)) continue;
      const ref = fanpageDb.ref(`viewerStatsUnlockPayments/operations/${requestId}`);
      const result = await freshTransaction(ref, (current) => {
        if (!current || current.status !== 'processing' || Number(current.leaseUntil || 0) > now) return;
        const attempts = Math.max(0, Number(current.reconcileAttempts) || 0) + 1;
        return { ...current, reconcileAttempts: attempts, lastFailureCode: code.slice(0, 80), updatedAt: now, nextRetryAt: now + 15 * 60000, status: attempts >= 5 ? 'review-required' : 'processing' };
      });
      if (result.committed && result.snapshot.val()?.status === 'review-required') review++;
    }
  }
  return { checked: entries.length, recovered, review };
}
module.exports = { purchaseViewerUnlock, acquireUnlockFeatureLocks, reconcileViewerUnlockPayments };
