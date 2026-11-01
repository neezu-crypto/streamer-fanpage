'use strict';

const VIDEO_LIBRARY_CATEGORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_LIBRARY_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,30}$/i;
const VIDEO_LIBRARY_ITEM_ID_PATTERN = /^(?:youtube_[A-Za-z0-9_-]{11}|soop_\d{1,20}|cinety_(?:39|41|43)_\d{1,20})$/;
const VIDEO_LIBRARY_TITLE_MAX_LENGTH = 120;
const VIDEO_LIBRARY_SYNC_STALE_MS = 3 * 60 * 1000;
const CINETY_CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'cinety-43', categoryNo: 43, name: '시네티 · 애니메이션' }),
  Object.freeze({ id: 'cinety-39', categoryNo: 39, name: '시네티 · 영화' }),
  Object.freeze({ id: 'cinety-41', categoryNo: 41, name: '시네티 · 드라마' }),
]);
const CINETY_CATEGORY_ID_PATTERN = /^cinety-(?:39|41|43)$/;

function isCinetyCategoryId(value) {
  return CINETY_CATEGORY_ID_PATTERN.test(String(value || ''));
}

function normalizeCinetyCategory(id, value = {}) {
  const definition = CINETY_CATEGORY_DEFINITIONS.find((category) => category.id === String(id || ''));
  if (!definition) return null;
  const categoryValue = value && typeof value === 'object' ? value : {};
  return {
    ...definition,
    sourceType: 'cinety',
    itemCount: Math.max(0, Math.floor(Number(categoryValue.itemCount) || 0)),
    fetchedAt: Math.max(0, Number(categoryValue.fetchedAt) || 0),
  };
}

function normalizeCinetyTitleTranslation(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return typeof value.ko_KR === 'string' ? value.ko_KR.trim() : '';
  }
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed.ko_KR === 'string' ? parsed.ko_KR.trim() : '';
  } catch (_) {
    return '';
  }
}

function normalizeCinetyCatalogItem(categoryId, value, index = 0) {
  const category = CINETY_CATEGORY_DEFINITIONS.find((item) => item.id === String(categoryId || ''));
  if (!category || !value || typeof value !== 'object') return null;
  const contentNo = String(value.contentNo || value.content_no || value.videoId || '').trim();
  if (!/^\d{1,20}$/.test(contentNo)) return null;
  const originalTitle = typeof value.originalTitle === 'string' ? value.originalTitle.trim()
    : typeof value.title === 'string' ? value.title.trim() : '';
  const translatedTitle = normalizeCinetyTitleTranslation(value.translation_title);
  const title = (translatedTitle || (typeof value.title === 'string' ? value.title.trim() : originalTitle))
    .normalize('NFC').replace(/\s+/g, ' ').slice(0, VIDEO_LIBRARY_TITLE_MAX_LENGTH);
  if (!title) return null;
  let thumbnailUrl = typeof value.thumbnailUrl === 'string' ? value.thumbnailUrl.trim()
    : typeof value.thumb_pc_url === 'string' ? value.thumb_pc_url.trim() : '';
  if (thumbnailUrl.startsWith('//')) thumbnailUrl = `https:${thumbnailUrl}`;
  try {
    const parsed = new URL(thumbnailUrl);
    if (parsed.protocol !== 'https:' || !/(^|\.)sooplive\.com$/i.test(parsed.hostname)
      || parsed.username || parsed.password) thumbnailUrl = '';
    else thumbnailUrl = parsed.href;
  } catch (_) {
    thumbnailUrl = '';
  }
  const sortAt = Math.max(0, Number(value.sortAt) || Number(contentNo) || 0);
  return {
    id: `cinety_${category.categoryNo}_${contentNo}`,
    contentNo,
    videoId: contentNo,
    platform: 'cinety',
    title,
    originalTitle: (originalTitle || title).normalize('NFC').slice(0, VIDEO_LIBRARY_TITLE_MAX_LENGTH),
    thumbnailUrl,
    publishedAt: '',
    sortAt: sortAt || Math.max(0, 1_000_000_000_000 - Math.max(0, Number(index) || 0)),
    categoryId: category.id,
    categoryName: category.name,
    sourceType: 'cinety',
    isUnavailable: String(value.isUnavailable ?? value.is_short ?? '') === '2'
      || value.isUnavailable === true,
  };
}

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
  if (platform === 'cinety' && (!/^\d{1,20}$/.test(videoId)
    || !new RegExp(`^cinety_(?:39|41|43)_${videoId}$`).test(String(id || '')))) return null;
  if (!['youtube', 'soop', 'cinety'].includes(platform)) return null;
  const title = typeof value.title === 'string' ? value.title.normalize('NFC').trim().slice(0, VIDEO_LIBRARY_TITLE_MAX_LENGTH) : '';
  const publishedAt = typeof value.publishedAt === 'string' ? value.publishedAt.slice(0, 32) : '';
  const parsedPublishedAt = Date.parse(publishedAt);
  const sortAt = Number(value.sortAt) || (Number.isFinite(parsedPublishedAt) ? parsedPublishedAt : Number(value.createdAt) || 0);
  const url = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : platform === 'soop' ? `https://vod.sooplive.co.kr/player/${videoId}`
      : `https://cinety.sooplive.com/content/detail/${videoId}`;
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
    categoryName: source.sourceType === 'cinety' ? String(source.categoryName || value.categoryName || '') : '',
    originalTitle: platform === 'cinety'
      ? (typeof value.originalTitle === 'string' ? value.originalTitle.slice(0, VIDEO_LIBRARY_TITLE_MAX_LENGTH) : '') : '',
    isUnavailable: platform === 'cinety' && value.isUnavailable === true,
    sourceType: source.sourceType === 'channel' ? 'channel'
      : source.sourceType === 'cinety' || platform === 'cinety' ? 'cinety' : 'manual',
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

function normalizeVideoLibrarySearchQuery(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

function matchesVideoLibrarySearch(item, query) {
  const normalizedQuery = normalizeVideoLibrarySearchQuery(query);
  if (!normalizedQuery || !item || typeof item !== 'object') return false;
  const searchable = [item.title, item.originalTitle, item.categoryName, item.channelTitle, item.platform, item.videoId]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .normalize('NFC')
    .toLocaleLowerCase('ko-KR');
  return searchable.includes(normalizedQuery);
}

module.exports = {
  CINETY_CATEGORY_DEFINITIONS,
  CINETY_CATEGORY_ID_PATTERN,
  VIDEO_LIBRARY_CATEGORY_ID_PATTERN,
  VIDEO_LIBRARY_CHANNEL_ID_PATTERN,
  VIDEO_LIBRARY_ITEM_ID_PATTERN,
  VIDEO_LIBRARY_TITLE_MAX_LENGTH,
  VIDEO_LIBRARY_SYNC_STALE_MS,
  hasInitialVideoLibraryImport,
  hasVideoLibrarySyncInProgress,
  isInitialVideoLibraryImport,
  isBeforeVideoLibraryCursor,
  isStaleVideoLibrarySync,
  normalizeVideoLibraryCategory,
  normalizeCinetyCategory,
  normalizeCinetyCatalogItem,
  isCinetyCategoryId,
  normalizeVideoLibraryCursor,
  normalizeVideoLibraryItem,
  normalizeVideoLibrarySearchQuery,
  matchesVideoLibrarySearch,
  parseVideoLibrarySortKey,
  paginateVideoLibraryEntries,
  shouldActivateVideoLibraryGeneration,
  videoLibraryTransactionRecord,
  videoLibrarySortKey,
};
