'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRICE_CASH, purchaseDesignPass, hasDesignPass, grantDesignPass, revokeDesignPass, cashBalance, DesignPassError,
} = require('../design-pass');

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
const streamerId = 'gmyo0o';
const requestId = 'request_1234567890';
const wallet = (balance) => database({ gameSeriesWallet: { accounts: { [uid]: { balanceCash: balance } } } });
const bal = (w) => w.read(`gameSeriesWallet/accounts/${uid}/balanceCash`);
const base = (db, walletDb, extra = {}) => ({ db, walletDb, uid, streamerId, requestId, now: 10_000_000, ...extra });

test('가격은 100캐시이고 구매하면 이용권이 켜진다', async () => {
  assert.equal(PRICE_CASH, 100);
  const db = database(); const w = wallet(250);
  const result = await purchaseDesignPass(base(db, w));
  assert.equal(result.status, 'activated');
  assert.equal(result.remainingCash, 150);
  assert.equal(bal(w), 150);
  assert.equal(await hasDesignPass(db, streamerId), true);
  assert.equal(db.read(`streamerFanPageDesignPasses/${streamerId}/layout3/source`), 'purchase');
});

test('같은 요청을 다시 보내도 캐시를 한 번만 차감한다', async () => {
  const db = database(); const w = wallet(250);
  await purchaseDesignPass(base(db, w));
  const again = await purchaseDesignPass(base(db, w, { now: 10_020_000 }));
  assert.equal(again.status, 'activated');
  assert.equal(bal(w), 150);
});

test('이미 이용권이 있으면 다른 요청으로도 차감하지 않는다', async () => {
  const db = database(); const w = wallet(250);
  await purchaseDesignPass(base(db, w));
  const second = await purchaseDesignPass(base(db, w, { requestId: 'other_request_12345', now: 10_020_000 }));
  assert.equal(second.status, 'owned');
  assert.equal(second.alreadyOwned, true);
  assert.equal(bal(w), 150);
});

test('잔액이 부족하면 차감하지 않고 이용권도 만들지 않는다', async () => {
  const db = database(); const w = wallet(99);
  await assert.rejects(purchaseDesignPass(base(db, w)), (e) => e instanceof DesignPassError && e.code === 'failed-precondition');
  assert.equal(bal(w), 99);
  assert.equal(await hasDesignPass(db, streamerId), false);
  assert.equal(db.read(`streamerFanPageDesignPassOperations/${requestId}/status`), 'failed-no-charge');
});

test('차감 후 원장 장애는 같은 요청 재시도로 이어 가며 중복 차감하지 않는다', async () => {
  const db = database(); const w = wallet(250);
  w.failOnce(`gameSeriesWallet/ledger/${uid}/${requestId}_fanPageDesignPass`);
  await assert.rejects(purchaseDesignPass(base(db, w)));
  // 원장 단계 실패 → 자동 환불
  assert.equal(bal(w), 250);
  assert.equal(db.read(`streamerFanPageDesignPassOperations/${requestId}/status`), 'refunded');
  // 같은 요청 번호는 환불 후 재사용 금지, 새 요청으로 정상 결제
  await assert.rejects(purchaseDesignPass(base(db, w, { now: 10_020_000 })));
  const retry = await purchaseDesignPass(base(db, w, { requestId: 'fresh_request_123456', now: 10_020_000 }));
  assert.equal(retry.status, 'activated');
  assert.equal(bal(w), 150);
});

test('이용권 기록 장애도 자동 환불하고 이용권을 만들지 않는다', async () => {
  const db = database(); const w = wallet(250);
  db.failOnce(`streamerFanPageDesignPasses/${streamerId}/layout3`);
  await assert.rejects(purchaseDesignPass(base(db, w)));
  assert.equal(bal(w), 250);
  assert.equal(await hasDesignPass(db, streamerId), false);
  assert.equal(w.read(`gameSeriesWallet/ledger/${uid}/${requestId}_fanPageDesignPass_refund/balanceDelta`), 100);
});

test('다른 계정은 기존 요청 번호를 재사용할 수 없다', async () => {
  const db = database(); const w = database({ gameSeriesWallet: { accounts: { user1: { balanceCash: 250 }, user2: { balanceCash: 250 } } } });
  await purchaseDesignPass(base(db, w, { requestId: 'shared_request_12345' }));
  await assert.rejects(purchaseDesignPass(base(db, w, { uid: 'user2', streamerId: 'other9', requestId: 'shared_request_12345', now: 10_020_000 })), (e) => e.code === 'already-exists');
  assert.equal(w.read('gameSeriesWallet/accounts/user2/balanceCash'), 250);
});

test('입력 검증: 요청 번호·팬페이지 ID·UID', async () => {
  const db = database(); const w = wallet(250);
  await assert.rejects(purchaseDesignPass(base(db, w, { requestId: 'short' })));
  await assert.rejects(purchaseDesignPass(base(db, w, { streamerId: '../x' })));
  await assert.rejects(purchaseDesignPass(base(db, w, { uid: 'a/b' })));
  assert.equal(bal(w), 250);
});

test('짧은 간격의 연속 구매 요청은 제한한다', async () => {
  const db = database(); const w = wallet(250);
  await assert.rejects(purchaseDesignPass(base(db, w, { requestId: 'req_first_1234567890', streamerId: 'a1' })).then(() => purchaseDesignPass(base(db, w, { requestId: 'req_second_123456789', streamerId: 'b2', now: 10_001_500 }))), (e) => e.code === 'resource-exhausted');
});

test('관리자 부여는 캐시를 건드리지 않고 회수하면 이용권이 사라진다', async () => {
  const db = database();
  assert.equal((await grantDesignPass({ db, streamerId, adminUid: 'admin' })).owned, true);
  assert.equal(db.read(`streamerFanPageDesignPasses/${streamerId}/layout3/cashAmount`), 0);
  assert.equal(await hasDesignPass(db, streamerId), true);
  await revokeDesignPass({ db, streamerId });
  assert.equal(await hasDesignPass(db, streamerId), false);
});

test('캐시 조회는 음수·비정상 값을 0으로 본다', async () => {
  assert.equal(await cashBalance(database({ gameSeriesWallet: { accounts: { [uid]: { balanceCash: -5 } } } }), uid), 0);
  assert.equal(await cashBalance(wallet(77), uid), 77);
});
