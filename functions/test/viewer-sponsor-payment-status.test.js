'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../viewer-sponsors.js'), 'utf8');
const start = source.indexOf("  if (action === 'payment-status') {");
const end = source.indexOf("\n  if (action !== 'purchase')", start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function run(data, uid = 'user') {
  const db = { ref(path) { return { async get() { return { val: () => data[path] || null }; } }; } };
  const context = { uid, data: { requestId: 'request_123456789' }, action: 'payment-status', db,
    sharedDb: () => db, RESULTS_PATH: 'results', WALLET_ROOT: 'wallet', WALLET_PURCHASES_KEY: 'purchases',
    CAMPAIGNS_PATH: 'campaigns', CLAIMS_PATH: 'claims', OPERATIONS_PATH: 'operations', validateRequestId: (id) => id,
    createHash: crypto.createHash, HttpsError, getCashStatus: async () => ({ balanceCash: 20 }) };
  return vm.runInNewContext(`(async () => { ${block} })()`, context);
}
test('본인 결제 완료와 미확정 상태를 구분한다', async () => {
  const requestId = 'request_123456789';
  const result = await run({ [`results/${requestId}`]: { requesterUid: 'user', status: 'activated', nickname: '테스트', soopId: 'test1', days: 1, cashAmount: 10, expiresAt: 100 } });
  assert.equal(result.status, 'activated');
  assert.equal(result.remainingCash, 20);
  assert.equal((await run({})).status, 'unknown');
  assert.equal((await run({ [`wallet/accounts/user/purchases/${requestId}`]: { status: 'charged' } })).status, 'pending');
});
test('다른 사용자의 결제 결과 접근을 차단한다', async () => {
  await assert.rejects(run({ 'results/request_123456789': { requesterUid: 'other', status: 'activated' } }), (error) => error.code === 'permission-denied');
});
test('환불 원장이 미확정이면 완료로 표시하지 않는다', async () => {
  const id = 'request_123456789';
  const purchase = { status: 'refunded' };
  assert.equal((await run({ [`results/${id}`]: { requesterUid: 'user', status: 'refund-pending' }, [`wallet/accounts/user/purchases/${id}`]: purchase })).status, 'refund-pending');
  assert.equal((await run({ [`wallet/accounts/user/purchases/${id}`]: purchase })).status, 'pending');
  assert.equal((await run({ [`operations/${id}`]: { requesterUid: 'user', status: 'failed-no-charge' } })).status, 'failed-no-charge');
});
test('결제 결과가 누락돼도 본인 캠페인과 슬롯이 모두 활성일 때 복구한다', async () => {
  const requestId = 'request_123456789';
  const uidHash = crypto.createHash('sha256').update('user').digest('hex');
  const result = await run({ [`wallet/accounts/user/purchases/${requestId}`]: { status: 'charged' },
    [`campaigns/${requestId}`]: { status: 'active', requesterUidHash: uidHash, soopId: 'test1', nickname: '테스트', days: 1, cashCost: 10, expiresAt: 100 },
    'claims/test1': { status: 'active', campaignId: requestId } });
  assert.equal(result.status, 'activated');
});
