'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeVideoLibraryCategory,
  normalizeVideoLibraryCursor,
  normalizeVideoLibraryItem,
  parseVideoLibrarySortKey,
  paginateVideoLibraryEntries,
  hasInitialVideoLibraryImport,
  hasVideoLibrarySyncInProgress,
  isInitialVideoLibraryImport,
  isStaleVideoLibrarySync,
  shouldActivateVideoLibraryGeneration,
  VIDEO_LIBRARY_SYNC_STALE_MS,
  videoLibraryTransactionRecord,
  videoLibrarySortKey,
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

test('composite video index keys preserve newest-first order and round-trip the cursor', () => {
  const older = videoLibrarySortKey(99, 'soop_100');
  const newer = videoLibrarySortKey(100, 'youtube_abcdefghijk');
  assert.ok(newer > older);
  assert.deepEqual(parseVideoLibrarySortKey(newer, { itemId: 'youtube_abcdefghijk', sortAt: 100 }), {
    id: 'youtube_abcdefghijk', sortAt: 100,
  });
  assert.deepEqual(parseVideoLibrarySortKey(older), { id: 'soop_100', sortAt: 99 });
  assert.equal(videoLibrarySortKey(100, 'invalid-id'), '');
  assert.equal(parseVideoLibrarySortKey('invalid-key'), null);
});

test('a new channel publishes its first full-sync page while a replacement waits for completion', () => {
  assert.equal(shouldActivateVideoLibraryGeneration({ syncMode: 'full', finished: false, activeSyncId: '' }), true);
  assert.equal(shouldActivateVideoLibraryGeneration({ syncMode: 'full', finished: false, activeSyncId: 'old-generation' }), false);
  assert.equal(shouldActivateVideoLibraryGeneration({ syncMode: 'full', finished: true, activeSyncId: 'old-generation' }), true);
  assert.equal(shouldActivateVideoLibraryGeneration({ syncMode: 'full', finished: false, activeSyncId: 'current-generation', syncId: 'current-generation' }), true);
  assert.equal(shouldActivateVideoLibraryGeneration({ syncMode: 'incremental', finished: false, activeSyncId: 'active-generation' }), false);
});

test('initial imports are detectable for public loading feedback and stop after first publication', () => {
  const initial = { syncStatus: 'syncing', activeSyncId: '' };
  assert.equal(isInitialVideoLibraryImport(initial), true);
  assert.equal(hasInitialVideoLibraryImport({ channelA: initial, channelB: { syncStatus: 'ready' } }), true);
  assert.equal(hasInitialVideoLibraryImport([{ syncStatus: 'ready', activeSyncId: 'generation' }]), false);
  assert.equal(isInitialVideoLibraryImport({ syncStatus: 'syncing', activeSyncId: 'generation' }), false);
});

test('sync-in-progress state remains visible after the first batch is published', () => {
  assert.equal(hasVideoLibrarySyncInProgress({ channelA: { syncStatus: 'syncing', activeSyncId: 'generation' } }), true);
  assert.equal(hasVideoLibrarySyncInProgress([{ syncStatus: 'ready' }]), false);
});

test('stalled sync detection waits three minutes and ignores completed imports', () => {
  const now = 1_800_000_000_000;
  const stalled = { syncStatus: 'syncing', syncStartedAt: now - VIDEO_LIBRARY_SYNC_STALE_MS - 1 };
  const recent = { syncStatus: 'syncing', syncStartedAt: now - VIDEO_LIBRARY_SYNC_STALE_MS + 1 };
  assert.equal(isStaleVideoLibrarySync(stalled, now), true);
  assert.equal(isStaleVideoLibrarySync(recent, now), false);
  assert.equal(isStaleVideoLibrarySync({ ...stalled, syncStatus: 'ready' }, now), false);
});

test('channel transactions can use a fresh server read when their local starting value is empty', () => {
  const seed = { syncId: 'current-sync', syncStatus: 'syncing' };
  assert.equal(videoLibraryTransactionRecord(null, seed, true), seed);
  const serverCurrent = { syncId: 'newer-sync', syncStatus: 'ready' };
  assert.equal(videoLibraryTransactionRecord(serverCurrent, seed, false), serverCurrent);
  assert.equal(videoLibraryTransactionRecord(null, seed, false), null);
  assert.equal(videoLibraryTransactionRecord(null, null, true), null);
});
