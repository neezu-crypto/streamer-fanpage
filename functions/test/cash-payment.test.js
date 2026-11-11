'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCashProduct, CashPaymentError } = require('../cash-payment');

// 경로를 중첩 객체로 보관하는 최소 RTDB 대역.
function database(initial = {}) {
  let root = JSON.parse(JSON.stringify(initial));
  const failures = new Set();
  const walk = (path, create) => {
    const keys = path.split('/').filter(Boolean);
    let node = root;
    for (const key of keys.slice(0, -1)) {
      if (node[key] == null || typeof node[key] !== 'object') { if (!create) return [null, null]; node[key] = {}; }
      node = node[key];
    }
    return [node, keys[keys.length - 1]];
  };
  const read = (path) => { const [node, key] = walk(path, false); const v = node ? node[key] : undefined; return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  const write = (path, value) => { const [node, key] = walk(path, true); if (value === null) delete node[key]; else node[key] = JSON.parse(JSON.stringify(value)); };
  return {
    read, failOnce(path) { failures.add(path); },
    ref(path) {
      return {
        on(_e, cb) { queueMicrotask(cb); }, off() {},
        async get() { const v = read(path); return { val: () => v, exists: () => v !== null }; },
        async transaction(fn) {
          if (failures.has(path)) { failures.delete(path); throw new Error('simulated-failure'); }
          const cur = read(path); const next = fn(cur);
          if (next === undefined) return { committed: false, snapshot: { val: () => cur } };
          write(path, next); return { committed: true, snapshot: { val: () => read(path) } };
        },
        async update(part) { write(path, { ...(read(path) || {}), ...part }); },
        async remove() { write(path, null); },
      };
    },
  };
}

const uid = 'user1';
const product = createCashProduct({
  purchasesKey: 'testPurchases', ledgerKind: 'testKind', productId: 'p', opsRoot: 'ops', limitsRoot: 'limits', cooldownMs: 5000,
});
const wallet = (balance) => database({ gameSeriesWallet: { accounts: { [uid]: { balanceCash: balance } } } });
const bal = (w) => w.read(`gameSeriesWallet/accounts/${uid}/balanceCash`);

test('금액을 호출마다 받아 차감하고, 환불은 차감 기록 금액으로 돌려준다', async () => {
  const w = wallet(100);
  await product.debit({ walletDb: w, uid, requestId: 'r1_1234567890123456', fingerprint: 'f', cashAmount: 30, now: 1 });
  assert.equal(bal(w), 70);
  await product.refund({ walletDb: w, uid, requestId: 'r1_1234567890123456', now: 2, reason: 'x' });
  assert.equal(bal(w), 100);
  assert.equal(w.read(`gameSeriesWallet/ledger/${uid}/r1_1234567890123456_testKind_refund/balanceDelta`), 30);
  // 환불을 한 번 더 호출해도 이중 환불은 없다
  await product.refund({ walletDb: w, uid, requestId: 'r1_1234567890123456', now: 3, reason: 'x' });
  assert.equal(bal(w), 100);
});

test('같은 요청 번호에 다른 금액·지문이면 충돌로 거절한다', async () => {
  const w = wallet(100);
  await product.debit({ walletDb: w, uid, requestId: 'r2_1234567890123456', fingerprint: 'f', cashAmount: 30, now: 1 });
  await assert.rejects(product.debit({ walletDb: w, uid, requestId: 'r2_1234567890123456', fingerprint: 'f', cashAmount: 40, now: 2 }), (e) => e.code === 'already-exists');
  await assert.rejects(product.debit({ walletDb: w, uid, requestId: 'r2_1234567890123456', fingerprint: 'g', cashAmount: 30, now: 2 }), (e) => e.code === 'already-exists');
  assert.equal(bal(w), 70);
});

test('금액이 0 이하·비정수면 거절한다', async () => {
  const w = wallet(100); const db = database();
  for (const cashAmount of [0, -5, 1.5, 'x']) {
    await assert.rejects(product.runPurchase({ db, walletDb: w, uid, requestId: 'r3_1234567890123456', opMeta: {}, cashAmount, fingerprint: 'f', activate: async () => ({ activated: true }) }), CashPaymentError);
  }
  assert.equal(bal(w), 100);
});

test('활성화가 거절(activated:false)되면 환불하고 refunded 로 기록한다', async () => {
  const w = wallet(100); const db = database();
  const result = await product.runPurchase({ db, walletDb: w, uid, requestId: 'r4_1234567890123456', opMeta: { kind: 'k' }, cashAmount: 25, fingerprint: 'f', activate: async () => ({ activated: false, failureCode: 'nope' }), now: 10_000_000 });
  assert.equal(result.activated, false);
  assert.equal(bal(w), 100);
  assert.equal(db.read('ops/r4_1234567890123456/status'), 'refunded');
  assert.equal(db.read('ops/r4_1234567890123456/failureCode'), 'nope');
});

test('활성화와 환불이 모두 실패하면 refund-pending 으로 남긴다', async () => {
  const w = wallet(100); const db = database();
  await assert.rejects(product.runPurchase({
    db, walletDb: w, uid, requestId: 'r5_1234567890123456', opMeta: {}, cashAmount: 25, fingerprint: 'f', now: 10_000_000,
    activate: async () => { w.failOnce(`gameSeriesWallet/accounts/${uid}`); throw new Error('boom'); },
  }), (e) => e.code === 'aborted');
  assert.equal(db.read('ops/r5_1234567890123456/status'), 'refund-pending');
  assert.equal(bal(w), 75);
});

test('차감 전 실패는 failed-no-charge 로 남기고 같은 요청으로 이어 갈 수 있다', async () => {
  const w = wallet(10); const db = database();
  const args = { db, walletDb: w, uid, requestId: 'r6_1234567890123456', opMeta: {}, cashAmount: 25, fingerprint: 'f', activate: async () => ({ activated: true }) };
  await assert.rejects(product.runPurchase({ ...args, now: 10_000_000 }), (e) => e.code === 'failed-precondition');
  assert.equal(db.read('ops/r6_1234567890123456/status'), 'failed-no-charge');
  w.ref(`gameSeriesWallet/accounts/${uid}`).update({ balanceCash: 100 });
  const ok = await product.runPurchase({ ...args, now: 10_001_000 });
  assert.equal(ok.activated, true);
  assert.equal(bal(w), 75);
});
