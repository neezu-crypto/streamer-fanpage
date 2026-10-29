'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePlayedGameBestRecord,
  updatePlayedGameBestRecord,
} = require('../played-games-record');

test('최고기록과 최고랭크를 공개 표시용 형태로 정리한다', () => {
  assert.deepEqual(normalizePlayedGameBestRecord({ type: 'rank', value: ' 다이아몬드 2 ', updatedAt: 123 }), {
    type: 'rank', value: '다이아몬드 2',
  });
  assert.deepEqual(normalizePlayedGameBestRecord({ type: 'record', value: '12,500점' }), {
    type: 'record', value: '12,500점',
  });
  assert.equal(normalizePlayedGameBestRecord({ type: 'other', value: '값' }), null);
  assert.equal(normalizePlayedGameBestRecord({ type: 'rank', value: '   ' }), null);
});

test('게임 최고기록을 저장하거나 지워도 게임과 다시보기 정보는 유지한다', () => {
  const game = { name: '게임', vods: { '123': { createdAt: 1 } }, createdAt: 2 };
  assert.deepEqual(updatePlayedGameBestRecord(game, { type: 'record', value: '12,500점' }, 99), {
    ...game, bestRecord: { type: 'record', value: '12,500점', updatedAt: 99 },
  });
  assert.deepEqual(updatePlayedGameBestRecord({ ...game, bestRecord: { type: 'rank', value: '골드' } }, null), game);
  assert.equal(updatePlayedGameBestRecord(null, { type: 'rank', value: '골드' }), null);
});
