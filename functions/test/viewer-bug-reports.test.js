'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { submitBugReport } = require('../viewer-bug-reports');
function mockDb() {
 const records = new Map();
 return { records, ref(path) { return { async get() { return { val: () => records.get(path) || null }; }, on(_event, callback) { queueMicrotask(() => callback({ val: () => records.get(path) || null })); }, off() {}, async transaction(update) { const current = records.get(path) || null; const next = update(current); if (next === undefined) return { committed: false, snapshot: { val: () => current } }; records.set(path, next); return { committed: true, snapshot: { val: () => next } }; } }; } };
}
const request = { uid: 'test-user', requestId: 'request_1234567890', title: '테스트', content: '테스트 제보 내용입니다', now: 1000000000000 };
test('제보와 제한 기록은 같은 요청으로 다시 접수해도 한 건이다', async () => { const db = mockDb(); const one = await submitBugReport({db,...request}); const two = await submitBugReport({db,...request}); assert.equal(one.reportId,two.reportId); assert.equal([...db.records.keys()].filter(p=>p.startsWith('viewerStatsBugReports/')).length,1); });
test('동일 요청 번호를 다른 본문에 재사용할 수 없다', async () => { const db = mockDb(); await submitBugReport({db,...request}); await assert.rejects(submitBugReport({db,...request,content:'다른 오류 내용입니다'})); });
test('서로 다른 제보도 직후 제출은 제한한다', async () => { const db = mockDb(); await submitBugReport({db,...request}); await assert.rejects(submitBugReport({db,...request,requestId:'request_1234567891',content:'다른 오류 내용입니다',now:request.now+1000})); });
test('기록이 생성되지 않은 만료 예약은 제한을 재검증한 뒤 복구한다', async () => {
 const db=mockDb(); const crypto=require('node:crypto'); const subject=crypto.createHash('sha256').update(request.uid).digest('hex');
 const {contentDigest}=require('../viewer-bug-report-policy'); const fingerprint=crypto.createHash('sha256').update(JSON.stringify([request.title.trim(),request.content.trim()])).digest('hex');
 db.records.set(`viewerStatsBugReportLimits/${subject}`,{requests:{[request.requestId]:{digest:contentDigest(request.content),fingerprint,status:'reserved',createdAt:request.now-700000,leaseUntil:request.now-100000}}});
 const result=await submitBugReport({db,...request}); assert.equal(result.submitted,true);
});
test('관리자가 삭제한 제보는 같은 요청으로 복원할 수 없다', async () => {
 const db=mockDb(); const result=await submitBugReport({db,...request}); db.records.set(`viewerStatsBugReports/${result.reportId}`,{status:'deleted',deletedAt:request.now});
 await assert.rejects(submitBugReport({db,...request}));
});
test('접수 상태는 본인 요청만 확인하고 본문은 반환하지 않는다',async()=>{const {bugReportStatus}=require('../viewer-bug-reports');const db=mockDb();const saved=await submitBugReport({db,...request});const status=await bugReportStatus({db,uid:request.uid,requestId:request.requestId});assert.equal(status.status,'submitted');assert.equal(status.reportId,saved.reportId);assert.equal(status.content,undefined);assert.equal((await bugReportStatus({db,uid:'other',requestId:request.requestId})).status,'unknown')});
test('저장 후 제한 기록 확정이 끊기면 접수 상태 조회가 예약을 확정한다',async()=>{
 const {bugReportStatus}=require('../viewer-bug-reports');const {createHash}=require('node:crypto');const db=mockDb();await submitBugReport({db,...request});
 const key='viewerStatsBugReportLimits/'+createHash('sha256').update(request.uid).digest('hex');const state=db.records.get(key);state.requests[request.requestId].status='reserved';db.records.set(key,state);
 assert.equal((await bugReportStatus({db,uid:request.uid,requestId:request.requestId})).status,'submitted');
 assert.equal(db.records.get(key).requests[request.requestId].status,'committed');
});
test('제보와 예약의 지문이 다르면 제한 기록을 임의로 확정하지 않는다',async()=>{
 const {bugReportStatus}=require('../viewer-bug-reports');const {createHash}=require('node:crypto');const db=mockDb();await submitBugReport({db,...request});
 const key='viewerStatsBugReportLimits/'+createHash('sha256').update(request.uid).digest('hex');const state=db.records.get(key);state.requests[request.requestId].status='reserved';state.requests[request.requestId].fingerprint='mismatch';db.records.set(key,state);
 await assert.rejects(bugReportStatus({db,uid:request.uid,requestId:request.requestId}));assert.equal(db.records.get(key).requests[request.requestId].status,'reserved');
});
test('확정 전 제보가 관리자에 의해 삭제돼도 접수 제한은 복구된다',async()=>{
 const {bugReportStatus}=require('../viewer-bug-reports');const {createHash}=require('node:crypto');const db=mockDb();const report=await submitBugReport({db,...request});
 const key='viewerStatsBugReportLimits/'+createHash('sha256').update(request.uid).digest('hex');const state=db.records.get(key);state.requests[request.requestId].status='reserved';db.records.set(key,state);
 db.records.set('viewerStatsBugReports/'+report.reportId,{status:'deleted',deletedAt:request.now});
 assert.equal((await bugReportStatus({db,uid:request.uid,requestId:request.requestId})).status,'submitted');assert.equal(db.records.get(key).requests[request.requestId].status,'committed');
});
