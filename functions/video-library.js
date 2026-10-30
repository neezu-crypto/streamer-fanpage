'use strict';

const VIDEO_LIBRARY_CATEGORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_LIBRARY_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,30}$/i;
const VIDEO_LIBRARY_ITEM_ID_PATTERN = /^(?:youtube_[A-Za-z0-9_-]{11}|soop_\d{1,20})$/;
const VIDEO_LIBRARY_TITLE_MAX_LENGTH = 120;
const VIDEO_LIBRARY_SYNC_STALE_MS = 3 * 60 * 1000;

function normalizeVideoLibraryCategory(id, value) {
  if (!VIDEO_LIBRARY_CATEGORY_ID_PATTERN.test(String(id || '')) || !value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? value.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!name || Array.from(name).length > 32 || /[\x00-\x1F\x7F]/.test(name)) return null;
  return {
    id,
    name,
    sortOrder: Math.max(0, Math.floor(Number(value.sortOrder) || 0)),
    createdAt: Math.max(0, Number(value.createdAt) || 0),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0),
  };
}

function normalizeVideoLibraryItem(id, value, source = {}) {
  if (!VIDEO_LIBRARY_ITEM_ID_PATTERN.test(String(id || '')) || !value || typeof value !== 'object') return null;
  const platform = String(value.platform || '');
  const videoId = String(value.videoId || '');
  if (platform === 'youtube' && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  if (platform === 'soop' && !/^\d{1,20}$/.test(videoId)) return null;
  if (!['youtube', 'soop'].includes(platform)) return null;
  const title = typeof value.title === 'string' ? value.title.normalize('NFC').trim().slice(0, VIDEO_LIBRARY_TITLE_MAX_LENGTH) : '';
  const publishedAt = typeof value.publishedAt === 'string' ? value.publishedAt.slice(0, 32) : '';
  const parsedPublishedAt = Date.parse(publishedAt);
  const sortAt = Number(value.sortAt) || (Number.isFinite(parsedPublishedAt) ? parsedPublishedAt : Number(value.createdAt) || 0);
  const url = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://vod.sooplive.co.kr/player/${videoId}`;
  return {
    id,
    videoId,
    platform,
    title: title || '제목 없음',
    thumbnailUrl: typeof value.thumbnailUrl === 'string' ? value.thumbnailUrl : '',
    publishedAt,
    sortAt,
    url,
    categoryId: String(source.categoryId || value.categoryId || ''),
    sourceType: source.sourceType === 'channel' ? 'channel' : 'manual',
    channelId: source.sourceType === 'channel' ? String(source.channelId || '') : '',
    channelTitle: source.sourceType === 'channel' ? String(source.channelTitle || '') : '',
  };
}

function compareVideoLibraryItems(left, right) {
  return right.sortAt - left.sortAt || (right.id < left.id ? -1 : right.id > left.id ? 1 : 0);
}

function isBeforeVideoLibraryCursor(item, cursor) {
  if (!cursor) return true;
  return item.sortAt < cursor.sortAt || (item.sortAt === cursor.sortAt && item.id < cursor.id);
}

function videoLibrarySortKey(sortAt, id) {
  const timestamp = Math.max(0, Math.floor(Number(sortAt) || 0));
  const itemId = String(id || '');
  if (!VIDEO_LIBRARY_ITEM_ID_PATTERN.test(itemId)) return '';
  return `${String(timestamp).padStart(16, '0')}_${itemId}`;
}

function parseVideoLibrarySortKey(key, value = {}) {
  const normalizedKey = String(key || '');
  const separator = normalizedKey.indexOf('_');
  if (separator < 1) return null;
  const id = String(value.itemId || normalizedKey.slice(separator + 1));
  const sortAt = Math.max(0, Number(value.sortAt) || Number(normalizedKey.slice(0, separator)) || 0);
  if (!VIDEO_LIBRARY_ITEM_ID_PATTERN.test(id)) return null;
  return { id, sortAt };
}

function isInitialVideoLibraryImport(channel) {
  return !!channel && typeof channel === 'object'
    && channel.syncStatus === 'syncing' && !String(channel.activeSyncId || '');
}

function hasInitialVideoLibraryImport(channels) {
  const entries = Array.isArray(channels) ? channels : Object.values(channels || {});
  return entries.some(isInitialVideoLibraryImport);
}

function hasVideoLibrarySyncInProgress(channels) {
  const entries = Array.isArray(channels) ? channels : Object.values(channels || {});
  return entries.some((channel) => !!channel && typeof channel === 'object' && channel.syncStatus === 'syncing');
}

function shouldActivateVideoLibraryGeneration({ syncMode, finished, activeSyncId, syncId }) {
  const activeId = String(activeSyncId || '');
  const currentId = String(syncId || '');
  return syncMode !== 'incremental' && (finished === true || !activeId || (!!currentId && activeId === currentId));
}

function videoLibraryTransactionRecord(current, seed, allowSeed) {
  if (current && typeof current === 'object') return current;
  return allowSeed && seed && typeof seed === 'object' ? seed : null;
}

function isStaleVideoLibrarySync(channel, now = Date.now()) {
  if (!channel || typeof channel !== 'object' || channel.syncStatus !== 'syncing') return false;
  const lastProgressAt = Math.max(Number(channel.syncStartedAt) || 0, Number(channel.updatedAt) || 0);
  return lastProgressAt > 0 && now - lastProgressAt >= VIDEO_LIBRARY_SYNC_STALE_MS;
}

function paginateVideoLibraryEntries(sources, cursor, limit = 24) {
  const deduplicated = new Map();
  for (const item of sources.flat()) {
    if (!item || !isBeforeVideoLibraryCursor(item, cursor)) continue;
    const existing = deduplicated.get(item.id);
    if (!existing || (existing.sourceType === 'channel' && item.sourceType === 'manual')) {
      deduplicated.set(item.id, item);
    }
  }
  const ordered = [...deduplicated.values()].sort(compareVideoLibraryItems);
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(limit) || 24)));
  const items = ordered.slice(0, pageSize);
  const last = items[items.length - 1];
  return {
    items,
    hasMore: ordered.length > pageSize,
    nextCursor: ordered.length > pageSize && last ? { sortAt: last.sortAt, id: last.id } : null,
  };
}

function normalizeVideoLibraryCursor(value) {
  if (!value || typeof value !== 'object') return null;
  const sortAt = Number(value.sortAt);
  const id = String(value.id || '');
  return Number.isFinite(sortAt) && sortAt >= 0 && VIDEO_LIBRARY_ITEM_ID_PATTERN.test(id) ? { sortAt, id } : null;
}

module.exports = {
  VIDEO_LIBRARY_CATEGORY_ID_PATTERN,
  VIDEO_LIBRARY_CHANNEL_ID_PATTERN,
  VIDEO_LIBRARY_ITEM_ID_PATTERN,
  VIDEO_LIBRARY_TITLE_MAX_LENGTH,
  VIDEO_LIBRARY_SYNC_STALE_MS,
  hasInitialVideoLibraryImport,
  hasVideoLibrarySyncInProgress,
  isInitialVideoLibraryImport,
  isStaleVideoLibrarySync,
  normalizeVideoLibraryCategory,
  normalizeVideoLibraryCursor,
  normalizeVideoLibraryItem,
  parseVideoLibrarySortKey,
  paginateVideoLibraryEntries,
  shouldActivateVideoLibraryGeneration,
  videoLibraryTransactionRecord,
  videoLibrarySortKey,
};
