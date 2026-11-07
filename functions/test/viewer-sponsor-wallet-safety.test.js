'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '../viewer-sponsors.js'), 'utf8');
const start = src.indexOf('async function withFreshValue('), end = src.indexOf('\nasync function activateCampaign', start);
assert.ok(start >= 0 && end > start);
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function setup(initial) {
 const db = structuredClone(initial);
 const ref = path => ({ on(_event, callback) { queueMicrotask(callback); }, off() {}, async transaction(update) { const next = update(db[path] || null); if (next === undefined) return { committed: false, snapshot: { val: () => db[path] || null } }; db[path] = next; return { committed: true, snapshot: { val: () => next } }; } });
 const context = { sharedDb: () => ({ ref }), WALLET_ROOT: 'wallet', WALLET_PURCHASES_KEY: 'purchases', WALLET_LEDGER_KIND: 'viewerSponsorPromotion', nonNegativeInteger: n => Math.max(0, Number(n) || 0), HttpsError };
 const api = vm.runInNewContext(`${src.slice(start,end)}; ({debitCash, refundCash, writeDebitLedger})`, context);
 return { api, db };
}
const args = { uid: 'user', requestId: 'request_123', cashAmount: 10, paymentFingerprint: 'abc', now: 1 };
test('이미 환불한 요청은 다시 차감 또는 활성화하지 않는다', async () => {
 const { api } = setup({ 'wallet/accounts/user': { balanceCash: 20, purchases: { request_123: { status: 'refunded', cashAmount: 10, fingerprint: 'abc' } } } });
 await assert.rejects(api.debitCash(args), e => e.code === 'failed-precondition');
});
test('원래 차감액이 일치하지 않으면 환불하지 않는다', async () => {
 const { api, db } = setup({ 'wallet/accounts/user': { balanceCash: 20, purchases: { request_123: { status: 'charged', cashAmount: 20 } } } });
 await assert.rejects(api.refundCash({ ...args, reason: 'test' }));
 assert.equal(db['wallet/accounts/user'].balanceCash, 20);
});
test('환불 원장이 일치하지 않으면 완료로 간주하지 않는다', async () => {
 const { api } = setup({ 'wallet/accounts/user': { balanceCash: 20, purchases: { request_123: { status: 'refunded', cashAmount: 10 } } }, 'wallet/ledger/user/request_123_viewerSponsorPromotion_refund': { requestId: 'request_123', type: 'other', balanceDelta: 10 } });
 await assert.rejects(api.refundCash({ ...args, reason: 'test' }), e => e.code === 'aborted');
});
