'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPlayedGameId,
  normalizePlayedGameBestRecord,
  normalizePlayedGameLink,
  parseCustomPlayedGameLink,
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

test('Steam 외 HTTPS 게임 링크를 안전한 사용자 등록 게임으로 지원한다', () => {
  const link = parseCustomPlayedGameLink('https://www.riotgames.com/ko');
  assert.equal(link, 'https://www.riotgames.com/ko');
  assert.equal(parseCustomPlayedGameLink('http://example.com/game'), null);
  assert.equal(parseCustomPlayedGameLink('https://user:password@example.com/game'), null);
  assert.equal(isPlayedGameId('custom_0123456789abcdef0123456789abcdef'), true);
  assert.equal(isPlayedGameId('custom_bad/id'), false);
  assert.equal(normalizePlayedGameLink(link, 'custom_0123456789abcdef0123456789abcdef'), link);
  assert.equal(normalizePlayedGameLink('', '123456'), 'https://store.steampowered.com/app/123456/');
});
