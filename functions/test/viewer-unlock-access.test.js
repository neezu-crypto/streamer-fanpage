'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasViewerUnlock } = require('../viewer-unlock-access');
function makeDb(records) { return { ref(path) { return { async get() { return { val: () => records[path] || null }; } }; } }; }
const id = 'ownership_123456789';
test('조회 인덱스와 실제 소유자가 모두 일치해야 한다', async () => {
 const db = makeDb({ 'viewerStatsUnlocks/user/period': { ownershipId: id }, [`viewerStatsUnlockTransfers/ownership/${id}`]: { ownerUid: 'user', status: 'active', featureId: 'period' } });
 assert.equal(await hasViewerUnlock({ db, uid:'user', featureId:'period', authenticated:true }), true);
 assert.equal(await hasViewerUnlock({ db, uid:'other', featureId:'period', authenticated:true }), false);
});
test('이전된 소유권을 오래된 인덱스로 사용할 수 없다', async () => {
 const db = makeDb({ 'viewerStatsUnlocks/user/period': { ownershipId: id }, [`viewerStatsUnlockTransfers/ownership/${id}`]: { ownerUid: 'other', status: 'active', featureId: 'period' } });
 assert.equal(await hasViewerUnlock({ db, uid:'user', featureId:'period', authenticated:true }), false);
});
