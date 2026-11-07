'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../viewer-sponsors.js'), 'utf8');
const start = source.indexOf('async function reconcileViewerSponsorPayments()');
const end = source.indexOf('\nmodule.exports', start);
assert.ok(start >= 0 && end > start);
async function run(initial) {
  const records = structuredClone(initial);
  const ref = (path) => ({ async get() { return { val: () => records[path] || null }; }, async update(value) { records[path] = { ...(records[path] || {}), ...value }; }, async set(value) { records[path] = value; } });
  const context = { fanpageDb: () => ({ ref }), sharedDb: () => ({ ref }), OPERATIONS_PATH: 'operations', RESULTS_PATH: 'results', CAMPAIGNS_PATH: 'campaigns', CLAIMS_PATH: 'claims', WALLET_ROOT: 'wallet', WALLET_PURCHASES_KEY: 'purchases', createHash, console,
    releasePlacement: async (_db, soopId, requestId) => { if (records[`claims/${soopId}`]?.requestId === requestId) delete records[`claims/${soopId}`]; } };
  await vm.runInNewContext(`${source.slice(start, end)}; reconcileViewerSponsorPayments()`, context);
  return records;
}
const operation = { requesterUid: 'user', soopId: 'test1', cashAmount: 10, status: 'processing', leaseUntil: 1 };
test('차감 없는 중단 요청은 재신청할 수 있게 처리한다', async () => {
  const records = await run({ operations: { req: operation }, 'operations/req': operation });
  assert.equal(records['operations/req'].status, 'failed-no-charge');
});
test('차감 후 캠페인이 없으면 자동 지급 대신 관리자 검토를 남긴다', async () => {
  const records = await run({ operations: { req: operation }, 'operations/req': operation, 'wallet/accounts/user/purchases/req': { status: 'charged' } });
  assert.equal(records['results/req'].status, 'refund-pending');
  assert.equal(records['operations/req'].status, 'refund-pending');
});
test('정상 캠페인과 슬롯이 확인되면 누락된 결과를 복원한다', async () => {
  const owner = createHash('sha256').update('user').digest('hex');
  const records = await run({ operations: { req: operation }, 'operations/req': operation, 'wallet/accounts/user/purchases/req': { status: 'charged' }, 'campaigns/req': { status: 'active', requesterUidHash: owner, nickname: '팬', soopId: 'test1', cashCost: 10 }, 'claims/test1': { status: 'active', campaignId: 'req' } });
  assert.equal(records['results/req'].status, 'activated');
});
test('처리 기한이 지나지 않은 결제는 건드리지 않는다', async () => {
  const current = { ...operation, leaseUntil: Date.now() + 60000 };
  const records = await run({ operations: { req: current }, 'operations/req': current });
  assert.equal(records['operations/req'].status, 'processing');
});
