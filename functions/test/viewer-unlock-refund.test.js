'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { refundUnactivatedUnlock } = require('../viewer-unlock-refund');
function db(initial = {}) {
  const data = new Map(Object.entries(initial)); let failing = '';
  return { data, failOnce(path) { failing = path; }, ref(path) { return {
    on(_event, cb) { queueMicrotask(cb); }, off() {}, async get() { return { val: () => data.get(path) || null }; },
    async transaction(fn) { if (failing === path) { failing = ''; throw Error('failure'); } const current = data.get(path) || null; const next = fn(current); if (next === undefined) return { committed: false, snapshot: { val: () => current } }; data.set(path, next); return { committed: true, snapshot: { val: () => next } }; },
  }; } };
}
const uid = 'user', featureId = 'period', requestId = 'refund_request_12345';
const ownershipId = createHash('sha256').update(`${uid}:${featureId}:${requestId}`).digest('hex');
const opPath = `viewerStatsUnlockPayments/operations/${requestId}`;
const ownerPath = `viewerStatsUnlockTransfers/ownership/${ownershipId}`;
const accountPath = `gameSeriesWallet/accounts/${uid}`;
function setup() {
  const fanpageDb = db({ [opPath]: { uid, featureId, requestId, ownershipId, cashAmount: 40, status: 'review-required' }, [ownerPath]: { uid, ownerUid: uid, featureId, requestId, status: 'pending' }, [`viewerStatsUnlocks/${uid}/${featureId}`]: { ownershipId } });
  const walletDb = db({ [accountPath]: { balanceCash: 60, viewerStatsUnlockPurchases: { [requestId]: { featureId, cashAmount: 40, status: 'charged' } }, viewerStatsUnlockPurchaseLocks: { [featureId]: { requestId, status: 'charged' } } } });
  return { fanpageDb, walletDb, requestId, now: 100 };
}
test('미활성 결제만 전액 환불하고 재요청에도 중복 지급하지 않는다', async () => {
  const args = setup(); assert.equal((await refundUnactivatedUnlock(args)).status, 'refunded');
  assert.equal(args.walletDb.data.get(accountPath).balanceCash, 100); assert.equal(args.fanpageDb.data.get(ownerPath).status, 'refund-cancelled');
  assert.equal((await refundUnactivatedUnlock(args)).replay, true); assert.equal(args.walletDb.data.get(accountPath).balanceCash, 100);
});
test('환불 원장 기록에 실패해도 같은 요청의 재시도로 중복 지급 없이 복구한다', async () => {
  const args = setup(); args.walletDb.failOnce(`gameSeriesWallet/ledger/${uid}/${requestId}_viewerStatsUnlock_refund`);
  await assert.rejects(refundUnactivatedUnlock(args)); assert.equal(args.walletDb.data.get(accountPath).balanceCash, 100);
  await refundUnactivatedUnlock(args); assert.equal(args.walletDb.data.get(accountPath).balanceCash, 100);
});
test('활성화된 지갑 기록은 권한을 취소하거나 환불하지 않는다', async () => {
  const args = setup(); args.walletDb.data.get(accountPath).viewerStatsUnlockPurchases[requestId].status = 'activated';
  await assert.rejects(refundUnactivatedUnlock(args), /wallet-conflict/); assert.equal(args.walletDb.data.get(accountPath).balanceCash, 60); assert.equal(args.fanpageDb.data.get(ownerPath).status, 'pending');
});
test('다른 소유자 또는 이미 활성화된 권한을 취소하지 않는다', async () => {
  const args = setup(); args.fanpageDb.data.get(ownerPath).status = 'active';
  await assert.rejects(refundUnactivatedUnlock(args), /ownership-conflict/); assert.equal(args.walletDb.data.get(accountPath).balanceCash, 60);
});
