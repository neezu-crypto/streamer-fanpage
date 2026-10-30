'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeVideoLibraryCategory,
  normalizeVideoLibraryCursor,
  normalizeVideoLibraryItem,
  paginateVideoLibraryEntries,
} = require('../video-library');

const categoryId = '123e4567-e89b-42d3-a456-426614174000';

test('video library categories normalize whitespace and reject invalid names or IDs', () => {
  assert.deepEqual(normalizeVideoLibraryCategory(categoryId, { name: '  방송   클립  ', createdAt: 10 }), {
    id: categoryId, name: '방송 클립', sortOrder: 0, createdAt: 10, updatedAt: 0,
  });
  assert.equal(normalizeVideoLibraryCategory('bad-id', { name: '게임' }), null);
  assert.equal(normalizeVideoLibraryCategory(categoryId, { name: ' '.repeat(3) }), null);
  assert.equal(normalizeVideoLibraryCategory(categoryId, { name: 'a'.repeat(33) }), null);
});

test('manual and channel videos normalize to safe platform links and metadata', () => {
  const manual = normalizeVideoLibraryItem('youtube_dQw4w9WgXcQ', {
    platform: 'youtube', videoId: 'dQw4w9WgXcQ', title: '  영상 제목  ', publishedAt: '2026-10-30T00:00:00Z',
  }, { sourceType: 'manual', categoryId });
  const channel = normalizeVideoLibraryItem('soop_123456', {
    platform: 'soop', videoId: '123456', title: 'SOOP 다시보기', createdAt: 100,
  }, { sourceType: 'channel', channelId: 'UC123', channelTitle: '채널' });

  assert.equal(manual.title, '영상 제목');
  assert.equal(manual.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(manual.categoryId, categoryId);
  assert.equal(channel.url, 'https://vod.sooplive.co.kr/player/123456');
  assert.equal(channel.channelTitle, '채널');
  assert.equal(normalizeVideoLibraryItem('youtube_invalid', { platform: 'youtube', videoId: 'invalid' }), null);
});

test('video library pagination sorts newest first, deduplicates sources, and advances a stable cursor', () => {
  const manual = [
    { id: 'youtube_abcdefghijk', sortAt: 300, sourceType: 'manual', title: '수정 제목' },
    { id: 'soop_100', sortAt: 200, sourceType: 'manual' },
  ];
  const channel = [
    { id: 'youtube_abcdefghijk', sortAt: 300, sourceType: 'channel', title: '채널 제목' },
    { id: 'youtube_lmnopqrstuv', sortAt: 100, sourceType: 'channel' },
  ];

  const first = paginateVideoLibraryEntries([manual, channel], null, 2);
  assert.deepEqual(first.items.map((item) => item.id), ['youtube_abcdefghijk', 'soop_100']);
  assert.equal(first.items[0].sourceType, 'manual');
  assert.equal(first.hasMore, true);
  const second = paginateVideoLibraryEntries([manual, channel], first.nextCursor, 2);
  assert.deepEqual(second.items.map((item) => item.id), ['youtube_lmnopqrstuv']);
  assert.equal(second.hasMore, false);
});

test('video library cursors reject malformed positions', () => {
  assert.deepEqual(normalizeVideoLibraryCursor({ sortAt: 123, id: 'soop_123' }), { sortAt: 123, id: 'soop_123' });
  assert.equal(normalizeVideoLibraryCursor({ sortAt: -1, id: 'soop_123' }), null);
  assert.equal(normalizeVideoLibraryCursor({ sortAt: 123, id: 'bad' }), null);
});
