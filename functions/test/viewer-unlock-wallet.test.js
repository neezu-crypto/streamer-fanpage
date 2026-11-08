'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { debitUnlockAccount, refundUnlockAccount } = require('../viewer-unlock-wallet');
const a={requestId:'request_1234567890',featureId:'period',now:100};
test('캐시 차감은 서버 단가를 사용하고 같은 요청은 재차감하지 않는다',()=>{ const first=debitUnlockAccount({balanceCash:100},a);assert.equal(first.account.balanceCash,60);const again=debitUnlockAccount(first.account,a);assert.equal(again.account.balanceCash,60);assert.equal(again.replay,true); });
test('다른 요청으로 같은 기능을 중복 구매하지 않는다',()=>{const first=debitUnlockAccount({balanceCash:100},a);assert.equal(debitUnlockAccount(first.account,{...a,requestId:'request_0987654321'}).error,'feature-locked');});
test('잔액 부족 또는 변조된 금액은 차감하지 않는다',()=>{assert.equal(debitUnlockAccount({balanceCash:39},a).error,'insufficient');assert.equal(debitUnlockAccount({balanceCash:NaN},a).error,'invalid-balance');});
test('차감된 요청만 한 번 환불하고 잠금을 해제한다',()=>{const first=debitUnlockAccount({balanceCash:100},a);const result=refundUnlockAccount(first.account,a);assert.equal(result.account.balanceCash,100);assert.equal(refundUnlockAccount(result.account,a).account.balanceCash,100);assert.equal(refundUnlockAccount(first.account,{...a,featureId:'keyword'}).error,'purchase-mismatch');});
test('해금 확정 후에는 환불 경로로 중복 지급할 수 없다',()=>{
 const {finalizeUnlockAccount}=require('../viewer-unlock-wallet');
 const charged=debitUnlockAccount({balanceCash:100},a).account;
 const activated=finalizeUnlockAccount(charged,{...a,ownershipId:'ownership_123456789'});
 assert.equal(activated.account.viewerStatsUnlockPurchases[a.requestId].status,'activated');
 assert.equal(refundUnlockAccount(activated.account,a).error,'state-conflict');
 assert.equal(finalizeUnlockAccount(activated.account,{...a,ownershipId:'ownership_123456789'}).replay,true);
 assert.equal(finalizeUnlockAccount(activated.account,{...a,ownershipId:'ownership_987654321'}).error,'state-conflict');
});
