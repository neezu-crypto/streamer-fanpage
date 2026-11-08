'use strict';
const FEATURES = Object.freeze({ period: 40, same_day: 40, keyword: 40 });
function resolveUnlockProduct(featureId) {
  if (typeof featureId !== 'string' || !Object.hasOwn(FEATURES, featureId)) return null;
  return { featureId, priceCash: FEATURES[featureId] };
}
function canAccessUnlock({ admin, authenticated, uid, featureId, ownership }) {
  if (!resolveUnlockProduct(featureId)) return false;
  if (admin === true) return true;
  return authenticated === true && typeof uid === 'string' && uid.length > 0 && ownership?.ownerUid === uid && ownership?.status === 'active' && ownership?.featureId === featureId;
}
module.exports = { FEATURES, resolveUnlockProduct, canAccessUnlock };
