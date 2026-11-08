'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../viewer-sponsors.js'),'utf8');
const helper=src.slice(src.indexOf('async function withFreshValue('),src.indexOf('\nasync function debitCash('));
const activate=src.slice(src.indexOf('async function activateCampaign('),src.indexOf('\nasync function listLegacyAds('));
class HttpsError extends Error { constructor(code,message){super(message);this.code=code;} }
function setup(claim){
 const state={claim, campaign:null}; let synced=false;
 const db={ref(path){return path.startsWith('campaigns/')?{async transaction(fn){const next=fn(state.campaign);if(next!==undefined)state.campaign=next;return {committed:next!==undefined,snapshot:{val:()=>state.campaign}};}}:{on(_event,cb){synced=true;queueMicrotask(cb)},off(){},async transaction(fn){const next=fn(synced?state.claim:null);if(next!==undefined)state.claim=next;return {committed:next!==undefined,snapshot:{val:()=>state.claim}};}}}};
 const run=vm.runInNewContext(`${helper}\n${activate}\nactivateCampaign`,{CAMPAIGNS_PATH:'campaigns',CLAIMS_PATH:'claims',HttpsError,Date});return {state,run,db};
}
test('초기 캐시가 없어도 예약을 동기화한 뒤 활성화',async()=>{const {state,run,db}=setup({requestId:'req',status:'reserving',expiresAt:Date.now()+60000});await run({db,campaign:{soopId:'test',paymentRequestId:'req',status:'active',expiresAt:Date.now()+86400000},requestId:'req',now:Date.now()});assert.equal(state.claim.status,'active');});
test('다른 요청의 슬롯은 활성화하지 않음',async()=>{const {run,db}=setup({requestId:'other',status:'reserving',expiresAt:Date.now()+60000});await assert.rejects(run({db,campaign:{soopId:'test',paymentRequestId:'req',status:'active'},requestId:'req',now:Date.now()}),e=>e.code==='aborted');});
test('만료된 예약은 활성화하지 않음',async()=>{const {run,db}=setup({requestId:'req',status:'reserving',expiresAt:Date.now()-1});await assert.rejects(run({db,campaign:{soopId:'test',paymentRequestId:'req',status:'active'},requestId:'req',now:Date.now()}),e=>e.code==='aborted');});
