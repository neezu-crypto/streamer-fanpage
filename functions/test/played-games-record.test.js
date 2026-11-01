'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  disconnectLeagueOfLegendsAccount,
  isLeagueOfLegendsGame,
  isPlayedGameId,
  normalizeOpggRegion,
  normalizeRiotId,
  normalizePlayedGameBestRecord,
  normalizePlayedGameLink,
  parseCustomPlayedGameLink,
  updatePlayedGameBestRecord,
  upsertLeagueOfLegendsAccount,
} = require('../played-games-record');

test('Riot ID와 OP.GG 지역을 안전한 표시 값으로 정리한다', () => {
  assert.equal(normalizeRiotId(' Hide on bush#KR1 '), 'Hide on bush#KR1');
  assert.equal(normalizeRiotId('이름#KR1'), '이름#KR1');
  assert.equal(normalizeRiotId('이름'), null);
  assert.equal(normalizeRiotId('이름#KR1#추가'), null);
  assert.equal(normalizeRiotId('이름#KR1\n'), null);
  assert.equal(normalizeOpggRegion('KR'), 'kr');
  assert.equal(normalizeOpggRegion('unknown'), '');
  assert.equal(isLeagueOfLegendsGame({ name: ' League of Legends ' }), true);
  assert.equal(isLeagueOfLegendsGame({ name: '리그 오브 레전드' }), true);
  assert.equal(isLeagueOfLegendsGame({ name: '다른 게임' }), false);
});

test('League of Legends 계정 추가는 기존 게임 데이터를 보존하고 중복 항목을 만들지 않는다', () => {
  const priorGame = {
    name: 'League of Legends', gameUrl: 'https://example.com/lol', createdAt: 10,
    bestRecord: { type: 'rank', value: '챌린저' }, vods: { '123': { createdAt: 11 } },
  };
  const result = upsertLeagueOfLegendsAccount({ custom_0123456789abcdef0123456789abcdef: priorGame, '12345': { name: '다른 게임' } }, {
    riotId: 'Hide on bush#KR1', opggRegion: 'kr', newAppId: 'custom_fedcba9876543210fedcba9876543210', maxItems: 100, now: 99,
  });
  assert.equal(result.ok, true);
  assert.equal(Object.keys(result.games).length, 2);
  assert.equal(result.appId, 'custom_0123456789abcdef0123456789abcdef');
  assert.deepEqual(result.games[result.appId], {
    ...priorGame, name: '리그 오브 레전드', gameType: 'league-of-legends', riotId: 'Hide on bush#KR1', opggRegion: 'kr',
  });
});

test('League of Legends 최초 추가는 정식 게임 항목을 만들고 저장 상한을 지킨다', () => {
  const result = upsertLeagueOfLegendsAccount({}, {
    riotId: 'Hide on bush#KR1', opggRegion: 'kr', newAppId: 'custom_0123456789abcdef0123456789abcdef', maxItems: 1, now: 42,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.games[result.appId], {
    name: '리그 오브 레전드', gameType: 'league-of-legends',
    gameUrl: 'https://www.leagueoflegends.com/ko-kr/', thumbnailUrl: '', createdAt: 42, vods: {},
    riotId: 'Hide on bush#KR1', opggRegion: 'kr',
  });
  assert.deepEqual(upsertLeagueOfLegendsAccount({ one: { name: '기존 게임' } }, {
    riotId: 'Hide on bush#KR1', opggRegion: 'kr', newAppId: 'custom_fedcba9876543210fedcba9876543210', maxItems: 1,
  }), { ok: false, error: 'full' });
});

test('Riot ID 연결 해제는 연결 정보만 제거하고 최고랭크와 다시보기는 보존한다', () => {
  const game = {
    gameType: 'league-of-legends', name: '리그 오브 레전드', riotId: 'Hide on bush#KR1', opggRegion: 'kr',
    bestRecord: { type: 'rank', value: '챌린저' }, vods: { '123': { createdAt: 11 } },
  };
  assert.deepEqual(disconnectLeagueOfLegendsAccount(game), {
    gameType: 'league-of-legends', name: '리그 오브 레전드',
    bestRecord: game.bestRecord, vods: game.vods,
  });
  assert.equal(disconnectLeagueOfLegendsAccount({ name: '일반 게임' }), null);
});

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
