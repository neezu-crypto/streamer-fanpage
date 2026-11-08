'use strict';
const { randomInt, createHmac, timingSafeEqual } = require('node:crypto');
const { resolveUnlockProduct } = require('./viewer-unlock-policy');
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_TTL_MS = 10 * 60 * 1000;
const RECENT_AUTH_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
function makeTransferCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
function digestTransferCode(code, secret) {
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code) || typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('invalid-transfer-code');
  return createHmac('sha256', secret).update('viewer-unlock-transfer:v1:').update(code).digest('hex');
}
function matchesTransferDigest(expected, candidate) {
  if (!/^[a-f0-9]{64}$/.test(expected || '') || !/^[a-f0-9]{64}$/.test(candidate || '')) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'));
}
function isRecentAuthentication(auth, now = Date.now()) {
  const provider = auth?.token?.firebase?.sign_in_provider;
  const time = Number(auth?.token?.auth_time) * 1000;
  return Boolean(auth?.uid && provider && provider !== 'anonymous' && Number.isFinite(time) && time <= now && now - time <= RECENT_AUTH_MS);
}
// 권위 소유권 트랜잭션 안에서만 호출한다. 다른 요청이 변경한 권한을 덮어쓰지 않는다.
function transferOwnership(current, { sourceUid, targetUid, featureId, transferId, now }) {
  if (!current || !resolveUnlockProduct(featureId) || !sourceUid || !targetUid || sourceUid === targetUid || !/^[A-Za-z0-9_-]{16,128}$/.test(transferId || '') || !Number.isFinite(now)) return { error: 'invalid-transfer' };
  if (current.status !== 'active' || current.featureId !== featureId) return { error: 'ownership-conflict' };
  if (current.ownerUid === targetUid && current.lastTransferId === transferId && current.previousOwnerUid === sourceUid) return { ownership: current, replay: true };
  if (current.ownerUid !== sourceUid) return { error: 'ownership-conflict' };
  return { ownership: { ...current, ownerUid: targetUid, previousOwnerUid: sourceUid, lastTransferId: transferId, transferredAt: now, version: (Number(current.version) || 0) + 1 }, replay: false };
}
// 요청 레코드 transaction에서만 사용한다. 실패 횟수도 transaction 결과에 반영한다.
function claimTransferRequest(current, { targetUid, candidateDigest, now }) {
  if (!current || !targetUid || typeof targetUid !== 'string' || /[.#$\[\]/]/.test(targetUid) || typeof current.sourceUid !== 'string' || !current.sourceUid || !Number.isFinite(now) || !Number.isFinite(Number(current.expiresAt))) return { error: 'invalid-request' };
  if (current.sourceUid === targetUid) return { error: 'same-account' };
  if (Number(current.expiresAt) <= now) return { error: 'expired' };
  // 완료 응답이 네트워크에서 유실되어도 같은 수신 계정은 같은 코드로 결과를 재확인할 수 있다.
  // 다른 계정은 완료된 이전을 가로챌 수 없다.
  if (current.status === 'claimed' || current.status === 'completed') return current.targetUid === targetUid ? { request: current, replay: true } : { error: 'already-claimed' };
  if (current.status !== 'pending') return { error: 'not-pending' };
  const attempts = Number(current.attempts ?? 0);
  if (!Number.isSafeInteger(attempts) || attempts < 0) return { error: 'invalid-request' };
  if (attempts >= MAX_CODE_ATTEMPTS) return { error: 'attempt-limit' };
  if (!matchesTransferDigest(current.codeDigest, candidateDigest)) return { request: { ...current, attempts: attempts + 1 }, error: 'invalid-code' };
  return { request: { ...current, targetUid, status: 'claimed', claimedAt: now }, replay: false };
}
module.exports = { CODE_TTL_MS, RECENT_AUTH_MS, MAX_CODE_ATTEMPTS, makeTransferCode, digestTransferCode, matchesTransferDigest, isRecentAuthentication, transferOwnership, claimTransferRequest };
