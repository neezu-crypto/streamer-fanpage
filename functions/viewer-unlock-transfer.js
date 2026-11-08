'use strict';
const { randomUUID } = require('node:crypto');
const { resolveUnlockProduct } = require('./viewer-unlock-policy');
const { transferOwnership } = require('./viewer-unlock-transfer-policy');
const { acquireUnlockFeatureLocks } = require('./viewer-unlock-purchase');
const { clearTransferredUnlockLock } = require('./viewer-unlock-wallet');

async function transaction(ref, callback) {
  let listener;
  await new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); });
  try { return await ref.transaction(callback, undefined, false); }
  finally { ref.off('value', listener); }
}

// 호출자는 이전 요청의 두 계정 재인증·코드·상태를 먼저 서버에서 검증해야 한다.
async function transferViewerUnlockFeature({ db, walletDb, sourceUid, targetUid, featureId, ownershipId, transferId, now = Date.now() }) {
  if (!walletDb || !resolveUnlockProduct(featureId) || !sourceUid || !targetUid || sourceUid === targetUid || [sourceUid, targetUid].some((uid) => typeof uid !== 'string' || /[.#$\[\]/]/.test(uid)) || !/^[A-Za-z0-9_-]{16,128}$/.test(ownershipId || '') || !/^[A-Za-z0-9_-]{16,128}$/.test(transferId || '')) throw new Error('invalid-transfer');
  const release = await acquireUnlockFeatureLocks(db, [sourceUid, targetUid], featureId, randomUUID(), now);
  try {
    const sourceIndex = db.ref(`viewerStatsUnlocks/${sourceUid}/${featureId}`);
    const targetIndex = db.ref(`viewerStatsUnlocks/${targetUid}/${featureId}`);
    const ownershipRef = db.ref(`viewerStatsUnlockTransfers/ownership/${ownershipId}`);
    const clearWalletLock = async () => {
      const ref = walletDb.ref(`gameSeriesWallet/accounts/${sourceUid}`);
      const result = await transaction(ref, (current) => {
        const change = clearTransferredUnlockLock(current, { featureId, ownershipId });
        return change.error ? undefined : change.account;
      });
      if (!result.committed) throw new Error('source-wallet-lock-conflict');
    };
    const [sourceSnap, targetSnap, ownerSnap] = await Promise.all([sourceIndex.get(), targetIndex.get(), ownershipRef.get()]);
    const source = sourceSnap.val(), target = targetSnap.val(), owner = ownerSnap.val();
    const replay = owner?.ownerUid === targetUid && owner?.previousOwnerUid === sourceUid && owner?.lastTransferId === transferId && ['active', 'merged'].includes(owner?.status) && owner?.featureId === featureId;
    if (!replay && (source?.ownershipId !== ownershipId || owner?.ownerUid !== sourceUid || owner?.featureId !== featureId || owner?.status !== 'active')) throw new Error('ownership-conflict');
    const mergeId = target && target.ownershipId !== ownershipId ? target.ownershipId : owner?.mergedInto;
    if (mergeId) {
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(mergeId)) throw new Error('target-index-conflict');
      const existing = (await db.ref(`viewerStatsUnlockTransfers/ownership/${mergeId}`).get()).val();
      if (existing?.ownerUid !== targetUid || existing.status !== 'active' || existing.featureId !== featureId) throw new Error('target-index-conflict');
      const merged = await transaction(ownershipRef, (current) => {
        if (current?.status === 'merged' && current.lastTransferId === transferId && current.mergedInto === mergeId && current.ownerUid === targetUid) return current;
        if (current?.ownerUid !== sourceUid || current?.status !== 'active' || current?.featureId !== featureId) return;
        return { ...current, status: 'merged', ownerUid: targetUid, previousOwnerUid: sourceUid, lastTransferId: transferId, transferredAt: now, mergedInto: mergeId };
      });
      if (!merged.committed) throw new Error('ownership-conflict');
      const cleared = await transaction(sourceIndex, (current) => !current || current.ownershipId === ownershipId ? null : undefined);
      if (!cleared.committed) throw new Error('source-index-conflict');
      await clearWalletLock();
      return { transferred: true, merged: true, replay };
    }
    const moved = await transaction(ownershipRef, (current) => {
      const result = transferOwnership(current, { sourceUid, targetUid, featureId, transferId, now });
      return result.error ? undefined : result.ownership;
    });
    if (!moved.committed) throw new Error('ownership-conflict');
    const targetWritten = await transaction(targetIndex, (current) => {
      if (current && current.ownershipId !== ownershipId) return;
      return { ownershipId };
    });
    if (!targetWritten.committed) throw new Error('target-index-conflict');
    const sourceCleared = await transaction(sourceIndex, (current) => {
      if (!current) return null;
      if (current.ownershipId !== ownershipId) return;
      return null;
    });
    if (!sourceCleared.committed) throw new Error('source-index-conflict');
    await clearWalletLock();
    return { transferred: true, replay };
  } finally { await release(); }
}
module.exports = { transferViewerUnlockFeature };
