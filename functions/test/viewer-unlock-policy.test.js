'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUnlockProduct, canAccessUnlock } = require('../viewer-unlock-policy');
test('서버 상품은 세 기능만 40캐시로 정의한다', () => { for (const id of ['period','same_day','keyword']) assert.equal(resolveUnlockProduct(id).priceCash,40); assert.equal(resolveUnlockProduct('__proto__'),null); });
test('기능별 권한을 분리하고 비로그인은 허용하지 않는다', () => { const ownership={status:'active',featureId:'period',ownerUid:'user'}; assert.equal(canAccessUnlock({authenticated:true,uid:'user',featureId:'period',ownership}),true); assert.equal(canAccessUnlock({authenticated:true,uid:'user',featureId:'keyword',ownership}),false); assert.equal(canAccessUnlock({authenticated:false,uid:'user',featureId:'period',ownership}),false); });
test('관리자는 등록된 기능만 사용한다', () => { assert.equal(canAccessUnlock({admin:true,featureId:'keyword'}),true); assert.equal(canAccessUnlock({admin:true,featureId:'unknown'}),false); });

test('다른 계정의 해금 권한은 사용하지 못한다', () => { assert.equal(canAccessUnlock({authenticated:true,uid:'other',featureId:'period',ownership:{ownerUid:'user',status:'active',featureId:'period'}}),false); });
