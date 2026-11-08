'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contentDigest, checkBugReportLimit, kstDay } = require('../viewer-bug-report-policy');
const now = Date.parse('2026-11-08T10:00:00+09:00');
const digest = contentDigest('문제 발생');
const check = (state, id, hash = digest, time = now) => checkBugReportLimit(state, { now: time, digest: hash, requestId: id }).reason;
test('동일 내용의 공백 차이는 중복으로 판정한다', () => { assert.equal(digest, contentDigest(' 문제   발생 ')); assert.equal(check({ requests: { a: { digest, createdAt: now - 120000, status: 'committed' } } }, 'b'), 'duplicate'); });
test('다른 내용도 1분 이내 제한하고 하루 다섯 건까지 허용한다', () => {
 assert.equal(check({ requests: { a: { digest: 'other', createdAt: now - 1000, status: 'committed' } } }, 'b'), 'cooldown');
 const requests = Object.fromEntries(Array.from({length:5}, (_,i)=>[String(i),{digest:String(i),createdAt:now-(i+1)*120000,status:'committed'}]));
 assert.equal(check({requests}, 'new'), 'daily-limit');
});
test('같은 요청 재시도와 요청 식별자 충돌을 구분한다', () => { const requests = { a: { digest, createdAt: now, status: 'committed' } }; assert.equal(check({requests}, 'a'), 'replay'); assert.equal(check({requests}, 'a','other'), 'request-conflict'); });
test('일일 기준은 한국 시간 자정이다', () => { assert.equal(kstDay(Date.parse('2026-11-07T15:00:00Z')), '2026-11-08'); });
test('처리 중 예약은 동시 제출을 막고 만료 후에는 제한하지 않는다', () => {
 const requests = { a: { digest: 'other', createdAt: now - 1000, status: 'reserved', leaseUntil: now + 10000 } };
 assert.equal(check({requests}, 'b'), 'cooldown');
 requests.a.leaseUntil = now - 1;
 assert.equal(check({requests}, 'b'), 'allowed');
});
