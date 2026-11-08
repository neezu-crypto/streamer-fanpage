'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextPaidBurstState, WINDOW_MS, BURST_LIMIT } = require('../viewer-unlock-abuse');
test('짧은 구간의 비정상적인 반복만 일시 제한하고 시간이 지나면 다시 허용한다', () => {
  let state = null;
  for (let i = 0; i < BURST_LIMIT; i++) { const result = nextPaidBurstState(state, 100000 + i); assert.equal(result.allowed, true); state = result.state; }
  assert.equal(nextPaidBurstState(state, 100030).allowed, false);
  assert.equal(nextPaidBurstState(state, 100000 + WINDOW_MS).allowed, true);
});
test('잘못된 저장값은 유효한 숫자만 반영한다', () => {
  assert.equal(nextPaidBurstState({ timestamps: [null, '1', Infinity, 99999] }, 100000).state.timestamps.length, 2);
});
