'use strict';
const { resolveUnlockProduct } = require('./viewer-unlock-policy');
const PURCHASE_KEY = 'viewerStatsUnlockPurchases';
const LOCK_KEY = 'viewerStatsUnlockPurchaseLocks';

// RTDB 계정 트랜잭션 안에서만 사용한다. 단가와 UID는 서버에서 확정한다.
function debitUnlockAccount(current, { requestId, featureId, now }) {
  const product = resolveUnlockProduct(featureId);
  if (!product || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId) || !Number.isFinite(now)) return { error: 'invalid' };
  const account = current && typeof current === 'object' ? current : {};
  const purchases = account[PURCHASE_KEY] && typeof account[PURCHASE_KEY] === 'object' ? account[PURCHASE_KEY] : {};
  const locks = account[LOCK_KEY] && typeof account[LOCK_KEY] === 'object' ? account[LOCK_KEY] : {};
  const prior = purchases[requestId];
  if (prior) {
    if (prior.featureId !== featureId || prior.cashAmount !== product.priceCash) return { error: 'request-conflict' };
    if (prior.status === 'refunded') return { error: 'already-refunded' };
    if (!['charged', 'activated'].includes(prior.status) || locks[featureId]?.requestId !== requestId) return { error: 'state-conflict' };
    return { account, replay: true };
  }
  if (locks[featureId]) return { error: 'feature-locked' };
  const balance = Number(account.balanceCash);
  if (!Number.isSafeInteger(balance) || balance < 0) return { error: 'invalid-balance' };
  if (balance < product.priceCash) return { error: 'insufficient' };
  return { account: { ...account, balanceCash: balance - product.priceCash,
    [PURCHASE_KEY]: { ...purchases, [requestId]: { requestId, featureId, cashAmount: product.priceCash, status: 'charged', chargedAt: now } },
    [LOCK_KEY]: { ...locks, [featureId]: { requestId, status: 'charged' } },
  }, replay: false };
}
function refundUnlockAccount(current, { requestId, featureId, now }) {
  const account = current && typeof current === 'object' ? current : {};
  const purchases = account[PURCHASE_KEY] || {};
  const purchase = purchases[requestId];
  const locks = account[LOCK_KEY] || {};
  if (!purchase || purchase.featureId !== featureId || !Number.isSafeInteger(purchase.cashAmount) || purchase.cashAmount <= 0) return { error: 'purchase-mismatch' };
  if (purchase.status === 'refunded') return { account, replay: true };
  if (purchase.status !== 'charged' || locks[featureId]?.requestId !== requestId || locks[featureId]?.status !== 'charged') return { error: 'state-conflict' };
  const balance = Number(account.balanceCash);
  if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(balance + purchase.cashAmount)) return { error: 'invalid-balance' };
  const nextLocks = { ...locks }; delete nextLocks[featureId];
  return { account: { ...account, balanceCash: balance + purchase.cashAmount,
    [PURCHASE_KEY]: { ...purchases, [requestId]: { ...purchase, status: 'refunded', refundedAt: now } },
    [LOCK_KEY]: nextLocks }, replay: false };
}
function clearTransferredUnlockLock(current, { featureId, ownershipId }) {
  if (!resolveUnlockProduct(featureId) || !/^[A-Za-z0-9_-]{16,128}$/.test(ownershipId || '')) return { error: 'invalid' };
  if (!current) return { account: null, replay: true };
  if (typeof current !== 'object') return { error: 'invalid-account' };
  const account = current;
  const locks = account[LOCK_KEY] || {};
  const lock = locks[featureId];
  if (!lock) return { account, replay: true };
  if (lock.status !== 'activated' || lock.ownershipId !== ownershipId) return { error: 'state-conflict' };
  const nextLocks = { ...locks }; delete nextLocks[featureId];
  return { account: { ...account, [LOCK_KEY]: nextLocks }, replay: false };
}
function finalizeUnlockAccount(current, { requestId, featureId, ownershipId, now }) {
  const account = current && typeof current === 'object' ? current : {};
  const purchases = account[PURCHASE_KEY] || {};
  const purchase = purchases[requestId];
  const locks = account[LOCK_KEY] || {};
  if (!purchase || purchase.featureId !== featureId || locks[featureId]?.requestId !== requestId || !/^[A-Za-z0-9_-]{16,128}$/.test(ownershipId)) return { error: 'state-conflict' };
  if (purchase.status === 'activated') return purchase.ownershipId === ownershipId && locks[featureId]?.status === 'activated' ? { account, replay: true } : { error: 'state-conflict' };
  if (purchase.status !== 'charged' || locks[featureId]?.status !== 'charged') return { error: 'state-conflict' };
  return { account: { ...account,
    [PURCHASE_KEY]: { ...purchases, [requestId]: { ...purchase, status: 'activated', ownershipId, activatedAt: now } },
    [LOCK_KEY]: { ...locks, [featureId]: { requestId, status: 'activated', ownershipId } } }, replay: false };
}
module.exports = { debitUnlockAccount, refundUnlockAccount, finalizeUnlockAccount, clearTransferredUnlockLock };
