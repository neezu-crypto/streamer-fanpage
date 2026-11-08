'use strict';
const { canAccessUnlock, resolveUnlockProduct } = require('./viewer-unlock-policy');

// 계정별 인덱스는 편의를 위한 정보이며 소유권의 최종 판단에 사용하지 않는다.
async function hasViewerUnlock({ db, uid, featureId, isAdmin = false, authenticated = false }) {
  if (!resolveUnlockProduct(featureId)) return false;
  if (isAdmin === true) return true;
  if (!authenticated || typeof uid !== 'string' || !uid || /[.#$\[\]/]/.test(uid)) return false;
  const index = (await db.ref(`viewerStatsUnlocks/${uid}/${featureId}`).get()).val();
  const ownershipId = typeof index?.ownershipId === 'string' ? index.ownershipId : '';
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(ownershipId)) return false;
  const ownership = (await db.ref(`viewerStatsUnlockTransfers/ownership/${ownershipId}`).get()).val();
  return canAccessUnlock({ authenticated, uid, featureId, ownership });
}
module.exports = { hasViewerUnlock };
