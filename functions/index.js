'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { createHash, randomUUID } = require('node:crypto');
const { parseWeFlabRouletteHtml, parseWeFlabRouletteUrl } = require('./weflab-roulette');

initializeApp();
const db = getDatabase();
const MAX_INTRO_LENGTH = 700;
const RECENT_PAGE_LIMIT = 8;
const FANPAGE_STATS_DAYS = 30;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const SOOP_VOD_PAGE_SIZE = 60;
const FANPAGE_VOD_PAGE_SIZE = 24;
const MAX_LOADED_VIDEO_ITEMS = 500;
const FANPAGE_VOD_COMMENT_PAGE_SIZE = 50;
const FANPAGE_VOD_COMMENT_MAX_LENGTH = 500;
const VOD_REFRESH_LOCK_TTL_MS = 2 * 60 * 1000;
const SOOP_VOD_API = 'https://chapi.sooplive.com/api';
const SOOP_STATION_API = 'https://chapi.sooplive.com/api';
const SOOP_CALENDAR_API = 'https://api-channel.sooplive.com/v1.1/channel';
const CALENDAR_CACHE_TTL_MS = 10 * 60 * 1000;
const CALENDAR_CACHE_FORCE_REFRESH_COOLDOWN_MS = 60 * 1000;
const CALENDAR_CACHE_MAX_RANGES = 24;
const CALENDAR_MAX_EVENTS_PER_DAY = 30;
const FANPAGE_SCHEDULE_MAX_ITEMS = 500;
const FANPAGE_SCHEDULE_TYPES = new Set(['방송', '방송예정', '합방', '휴방', '기타']);
const FANPAGE_GALLERY_PREVIEW_SIZE = 8;
const FANPAGE_GALLERY_CACHE_TTL_MS = 3 * 60 * 1000;
const FANPAGE_GALLERY_CACHE_MAX_ITEMS = 100;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_VIDEO_PAGE_SIZE = 24;
const YOUTUBE_CACHE_TTL_MS = 30 * 60 * 1000;
const YOUTUBE_REFRESH_COOLDOWN_MS = 60 * 1000;
const CAFE_POST_PREVIEW_SIZE = 6;
const CAFE_POST_CACHE_TTL_MS = 5 * 60 * 1000;
const NAVER_CAFE_API_BASE = 'https://apis.naver.com/cafe-web/cafe-boardlist-api/v1';
const WEFLAB_ROULETTE_CACHE_TTL_MS = 60 * 1000;
const WEFLAB_ROULETTE_REFRESH_COOLDOWN_MS = 30 * 1000;
const WEFLAB_ROULETTE_MAX_HTML_BYTES = 2 * 1024 * 1024;
const FANPAGE_UPBO_MAX_TOPICS = 20;
const FANPAGE_UPBO_MAX_ROWS = 50;
const FANPAGE_UPBO_VIEWER_PAGE_SIZE = 100;
const FANPAGE_UPBO_MAX_VIEWER_COUNT = 5000;
const YOUTUBE_DATA_API_KEY = defineSecret('YOUTUBE_DATA_API_KEY');
const GALLERY_PUBLIC_IMAGE_HOST = 'pub-aa5574dbd45e4404b18ab8efaae54e67.r2.dev';
const GALLERY_CATEGORY_LABELS = Object.freeze({
  screenshot: '방송 캡처',
  'ai-art': 'AI 일러스트',
  'fan-art': '팬아트',
  meme: '밈',
  etc: '기타',
});
const fanpageGalleryMemoryCache = new Map();
const youtubeFetchInProgress = new Map();
const cafeFetchInProgress = new Map();
const weflabRouletteFetchInProgress = new Map();

function requireAuth(request) {
  if (!request.auth || typeof request.auth.uid !== 'string') {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

async function hasProtectedAccount(request, uid = requireAuth(request)) {
  const signInProvider = request.auth && request.auth.token
    && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
  if (signInProvider && signInProvider !== 'anonymous') return true;

  const [kakaoLinked, verified, admin] = await Promise.all([
    db.ref(`users/${uid}/kakaoLinked`).get(),
    findVerifiedByUid(uid),
    isAdminUid(uid),
  ]);
  return kakaoLinked.val() === true || !!verified || admin;
}

async function requireProtectedCommentProfileAuth(request) {
  const uid = requireAuth(request);
  if (!await hasProtectedAccount(request, uid)) {
    throw new HttpsError('failed-precondition', '댓글 프로필을 저장하고 댓글을 쓰려면 Google·카카오 로그인 또는 스트리머 인증을 완료해 주세요.');
  }
  return uid;
}

function publicStreamer(key, record) {
  if (!record || typeof record.nickname !== 'string' || typeof record.soopId !== 'string') return null;
  const soopId = record.soopId.trim();
  if (!SOOP_ID_PATTERN.test(soopId)) return null;
  return {
    id: soopId.toLowerCase(),
    nickname: record.nickname.trim().slice(0, 40),
    soopId,
    avatarUrl: `https://stimg.sooplive.com/LOGO/${soopId.slice(0, 2)}/${soopId}/${soopId}.jpg`,
    soopUrl: `https://www.sooplive.com/station/${encodeURIComponent(soopId)}`,
  };
}

async function findVerifiedByUid(uid) {
  const snap = await db.ref('streamerVerifications')
    .orderByChild('uid').equalTo(uid).limitToFirst(1).get();
  if (!snap.exists()) return null;
  const [key, record] = Object.entries(snap.val())[0];
  const streamer = publicStreamer(key, record);
  return streamer ? { key, streamer, record } : null;
}

async function isAdminUid(uid) {
  const snap = await db.ref(`adminCenter/adminUids/${uid}`).get();
  return snap.val() === true;
}

async function findVerifiedBySoopId(soopId) {
  const normalized = String(soopId || '').trim().toLowerCase();
  if (!SOOP_ID_PATTERN.test(normalized)) return null;
  const snap = await db.ref('streamerVerifications')
    .orderByChild('soopId').equalTo(normalized).limitToFirst(1).get();
  if (!snap.exists()) return null;
  const [key, record] = Object.entries(snap.val())[0];
  const streamer = publicStreamer(key, record);
  return streamer ? { key, streamer, record } : null;
}

async function recordRecentVisit(uid, streamerId) {
  const ref = db.ref(`streamerFanPageRecentVisits/${uid}`);
  await ref.child(streamerId).set({ visitedAt: Date.now() });
  // 방문 이력은 최대 8개만 유지하므로 규칙 변경이 필요한 RTDB 정렬 쿼리 대신
  // Admin SDK로 작은 목록을 읽고 서버에서 정렬한다.
  const snap = await ref.get();
  const visits = Object.entries(snap.val() || {})
    .sort((a, b) => (Number(a[1] && a[1].visitedAt) || 0) - (Number(b[1] && b[1].visitedAt) || 0));
  if (visits.length > RECENT_PAGE_LIMIT) {
    const updates = {};
    visits.slice(0, visits.length - RECENT_PAGE_LIMIT).forEach(([id]) => { updates[id] = null; });
    await ref.update(updates);
  }
}

function fanPageStatsDateKey(timestamp = Date.now()) {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function metricCount(value) {
  const count = Math.floor(Number(value) || 0);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

async function pruneFanPageDailyStats(streamerId, today) {
  const cutoffDate = new Date(`${today}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - (FANPAGE_STATS_DAYS - 1));
  const cutoff = fanPageStatsDateKey(cutoffDate.getTime());
  const datesRef = db.ref(`streamerFanPageStats/${streamerId}/dailyVisitorDates`);
  const dates = (await datesRef.get()).val() || {};
  const expiredDates = Object.keys(dates).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoff);
  if (!expiredDates.length) return;

  const updates = {};
  for (const date of expiredDates) {
    updates[`streamerFanPageStats/${streamerId}/daily/${date}`] = null;
    updates[`streamerFanPageStats/${streamerId}/dailyVisitorDates/${date}`] = null;
    updates[`streamerFanPageDailyVisitors/${streamerId}/${date}`] = null;
  }
  await db.ref().update(updates);
}

async function recordFanPageView(uid, streamerId) {
  const now = Date.now();
  const date = fanPageStatsDateKey(now);
  const visitorHash = createHash('sha256').update(`${streamerId}:${uid}`).digest('hex');
  const statsRef = db.ref(`streamerFanPageStats/${streamerId}`);
  const dailyRef = statsRef.child(`daily/${date}`);
  const markerRef = db.ref(`streamerFanPageDailyVisitors/${streamerId}/${date}/${visitorHash}`);
  const [visitorResult] = await Promise.all([
    markerRef.transaction((current) => current === true ? undefined : true),
    statsRef.child(`dailyVisitorDates/${date}`).set(true),
  ]);

  await Promise.all([
    statsRef.child('summary/totalViews').transaction((current) => metricCount(current) + 1),
    dailyRef.transaction((current) => {
      const record = current && typeof current === 'object' ? current : {};
      return {
        views: metricCount(record.views) + 1,
        uniqueVisitors: metricCount(record.uniqueVisitors) + (visitorResult.committed ? 1 : 0),
      };
    }),
  ]);
  await pruneFanPageDailyStats(streamerId, date);
}

function pageRef(streamerId) {
  return db.ref(`streamerFanPages/${streamerId}`);
}

function upboRootRef(streamerId) {
  return db.ref(`streamerFanPageUpbo/${streamerId}`);
}

function validUpboId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function upboText(value, maxLength, required = false) {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', '업보 정리의 텍스트 항목을 확인해 주세요.');
  const text = value.trim();
  if (text.length > maxLength || (required && !text)) {
    throw new HttpsError('invalid-argument', '업보 정리의 입력 길이 또는 필수 항목을 확인해 주세요.');
  }
  return text;
}

function upboCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000_000) {
    throw new HttpsError('invalid-argument', '후원 개수는 0 이상 10억 이하의 정수로 입력해 주세요.');
  }
  return count;
}

function normalizeUpboRows(value, rowType) {
  if (!Array.isArray(value) || value.length > FANPAGE_UPBO_MAX_ROWS) {
    throw new HttpsError('invalid-argument', '주제별 공약과 보상은 각각 50개까지 등록할 수 있습니다.');
  }
  const ids = new Set();
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new HttpsError('invalid-argument', '공약 또는 보상 항목을 확인해 주세요.');
    }
    const id = typeof row.id === 'string' && row.id ? row.id : randomUUID();
    if (!validUpboId(id) || ids.has(id)) throw new HttpsError('invalid-argument', '공약 또는 보상 ID가 올바르지 않습니다.');
    ids.add(id);
    const normalized = {
      id,
      donationCount: upboCount(row.donationCount),
      reward: upboText(row.reward, 300, true),
    };
    if (rowType === 'promise') normalized.achieved = row.achieved === true;
    return normalized;
  });
}

function validateUpboTopic(value, existingMeta = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '업보 주제 내용을 확인해 주세요.');
  }
  const id = typeof value.id === 'string' && value.id ? value.id : randomUUID();
  if (!validUpboId(id)) throw new HttpsError('invalid-argument', '업보 주제 ID가 올바르지 않습니다.');
  return {
    id,
    title: upboText(value.title, 60, true),
    description: upboText(value.description || '', 300),
    promises: normalizeUpboRows(value.promises || [], 'promise'),
    rewardTiers: normalizeUpboRows(value.rewardTiers || [], 'reward'),
    createdAt: Number(existingMeta.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function normalizeStoredUpboTopic(id, value) {
  if (!validUpboId(id) || !value || typeof value !== 'object' || typeof value.title !== 'string') return null;
  const rows = (source, rowType) => Object.values(source && typeof source === 'object' ? source : {})
    .filter((row) => row && typeof row === 'object' && validUpboId(row.id))
    .slice(0, FANPAGE_UPBO_MAX_ROWS)
    .map((row) => ({
      id: row.id,
      donationCount: metricCount(row.donationCount),
      reward: typeof row.reward === 'string' ? row.reward.slice(0, 300) : '',
      ...(rowType === 'promise' ? { achieved: row.achieved === true } : {}),
    }))
    .filter((row) => row.reward);
  return {
    id,
    title: value.title.slice(0, 60),
    description: typeof value.description === 'string' ? value.description.slice(0, 300) : '',
    promises: rows(value.promises, 'promise'),
    rewardTiers: rows(value.rewardTiers, 'reward'),
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
  };
}

function normalizeStoredUpboViewer(id, value) {
  if (!validUpboId(id) || !value || typeof value !== 'object' || typeof value.nickname !== 'string') return null;
  return {
    id,
    nickname: value.nickname.slice(0, 40),
    rank: typeof value.rank === 'string' ? value.rank.slice(0, 30) : '',
    donationCount: metricCount(value.donationCount),
    history: typeof value.history === 'string' ? value.history.slice(0, 300) : '',
    reward: typeof value.reward === 'string' ? value.reward.slice(0, 300) : '',
    request: typeof value.request === 'string' ? value.request.slice(0, 300) : '',
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
  };
}

function validateUpboViewer(value, existing = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '시청자 후원 기록을 확인해 주세요.');
  }
  const id = typeof value.id === 'string' && value.id ? value.id : '';
  if (id && !validUpboId(id)) throw new HttpsError('invalid-argument', '시청자 기록 ID가 올바르지 않습니다.');
  return {
    id,
    nickname: upboText(value.nickname, 40, true),
    rank: upboText(value.rank || '', 30),
    donationCount: upboCount(value.donationCount),
    history: upboText(value.history || '', 300),
    reward: upboText(value.reward || '', 300),
    request: upboText(value.request || '', 300),
    createdAt: Number(existing && existing.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function normalizeStreamerName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

function findStockForStreamer(streamer, stockNames) {
  const targetName = normalizeStreamerName(streamer && streamer.nickname);
  if (!targetName || !stockNames || typeof stockNames !== 'object') return null;

  const entries = Object.entries(stockNames)
    .filter(([id, name]) => /^[A-Za-z0-9_-]{1,128}$/.test(id) && typeof name === 'string' && name.trim())
    .map(([id, name]) => ({ id, name: name.trim() }));
  const exactMatches = entries.filter((entry) => normalizeStreamerName(entry.name) === targetName);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  // 주식시장에서는 크루 종목을 `[크루명] 닉네임`으로 표시하기도 한다.
  const crewMatches = entries.filter((entry) => {
    const withoutCrew = entry.name.replace(/^\[[^\]]{1,60}\]\s*/, '');
    return withoutCrew !== entry.name && normalizeStreamerName(withoutCrew) === targetName;
  });
  return crewMatches.length === 1 ? crewMatches[0] : null;
}

function isSafeGalleryStreamerId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isGalleryPublicUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === GALLERY_PUBLIC_IMAGE_HOST;
  } catch (_) {
    return false;
  }
}

async function findGalleryStreamerIds(target) {
  const verifiedUid = target.record && typeof target.record.uid === 'string' ? target.record.uid : '';
  if (verifiedUid) {
    const linkedSnap = await db.ref(`gallery/streamerAccountLinks/${verifiedUid}`).get();
    const linkedId = linkedSnap.val() && linkedSnap.val().streamerId;
    if (isSafeGalleryStreamerId(linkedId)) return [linkedId];
  }

  // 갤러리 계정 연결이 아직 없는 스트리머는 갤러리 업로드가 사용하는
  // streamerNames의 실제 이름을 기준으로 찾아 표기명 차이로 인한 오탐을 줄인다.
  const namesSnap = await db.ref('streamerNames').get();
  const expectedName = normalizeStreamerName(target.streamer.nickname);
  if (!expectedName) return [];
  const names = namesSnap.val() || {};
  const matches = [...new Set(Object.entries(names)
    .filter(([id, name]) => isSafeGalleryStreamerId(id) && normalizeStreamerName(name) === expectedName)
    .map(([id]) => id))];
  // 이름만으로 둘 이상의 방송국이 매칭되면 잘못된 갤러리를 섞지 않도록 노출하지 않는다.
  return matches.length === 1 ? matches : [];
}

async function readStreamerGallery(target) {
  const cacheKey = target.streamer.id;
  const cached = fanpageGalleryMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FANPAGE_GALLERY_CACHE_TTL_MS) return cached.result;

  const galleryStreamerIds = await findGalleryStreamerIds(target);
  if (!galleryStreamerIds.length) {
    const result = { linked: false, totalCount: 0, items: [], fetchedAt: Date.now() };
    fanpageGalleryMemoryCache.set(cacheKey, { fetchedAt: Date.now(), result });
    return result;
  }

  // Gallery는 streamerId 인덱스로 이미 관련 이미지들을 조회한다. 팬페이지도 같은
  // 공개 미러(imagesPublic)를 사용하고, UID가 포함된 내부 images 노드는 읽지 않는다.
  const snapshots = await Promise.all(galleryStreamerIds.map((galleryStreamerId) => db.ref('gallery/imagesPublic')
    .orderByChild('streamerId').equalTo(galleryStreamerId).get()));
  const uniqueImages = new Map();
  snapshots.forEach((snapshot) => {
    Object.entries(snapshot.val() || {}).forEach(([id, value]) => {
      if (!value) return;
      uniqueImages.set(id, {
        id,
        category: Object.hasOwn(GALLERY_CATEGORY_LABELS, value.category) ? value.category : 'etc',
        createdAt: Number(value.createdAt) || 0,
        thumbUrl: isGalleryPublicUrl(value.thumbUrl) ? value.thumbUrl : '',
      });
    });
  });

  const ordered = [...uniqueImages.values()].sort((a, b) => b.createdAt - a.createdAt);
  const previewById = new Map(ordered.filter((item) => item.thumbUrl).slice(0, FANPAGE_GALLERY_PREVIEW_SIZE).map((item) => [item.id, item]));
  ['fan-art', 'screenshot'].forEach((category) => {
    ordered.filter((item) => item.thumbUrl && item.category === category)
      .slice(0, FANPAGE_GALLERY_PREVIEW_SIZE)
      .forEach((item) => previewById.set(item.id, item));
  });
  const previewItems = [...previewById.values()].sort((a, b) => b.createdAt - a.createdAt);
  const stats = await Promise.all(previewItems.map((item) => db.ref(`gallery/imageStats/${item.id}`).get()));
  const items = previewItems.map((item, index) => {
    const value = stats[index].val() || {};
    return {
      ...item,
      categoryLabel: GALLERY_CATEGORY_LABELS[item.category],
      likeCount: Math.max(0, Number(value.likeCount) || 0),
      commentCount: Math.max(0, Number(value.commentCount) || 0),
    };
  });
  const result = { linked: true, totalCount: uniqueImages.size, previewSize: FANPAGE_GALLERY_PREVIEW_SIZE, items, fetchedAt: Date.now() };
  fanpageGalleryMemoryCache.set(cacheKey, { fetchedAt: Date.now(), result });
  while (fanpageGalleryMemoryCache.size > FANPAGE_GALLERY_CACHE_MAX_ITEMS) {
    fanpageGalleryMemoryCache.delete(fanpageGalleryMemoryCache.keys().next().value);
  }
  return result;
}

function vodListRef(streamerId) {
  return db.ref(`streamerFanPageVods/${streamerId}`);
}

function vodRefreshLockRef(streamerId) {
  return db.ref(`streamerFanPageVodRefreshLocks/${streamerId}`);
}

function vodItemKey(index) {
  return String(index).padStart(16, '0');
}

function normalizeSoopVod(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.title_no || row.id || '').trim();
  if (!/^\d{1,20}$/.test(id)) return null;
  const titleValue = typeof row.title_name === 'string' ? row.title_name : row.title;
  const title = typeof titleValue === 'string' ? titleValue.trim().slice(0, 300) : '';
  const regDateValue = typeof row.reg_date === 'string' ? row.reg_date : row.regDate;
  const regDate = typeof regDateValue === 'string' ? regDateValue.trim().slice(0, 25) : '';
  const counts = row.count && typeof row.count === 'object' ? row.count : {};
  const ucc = row.ucc && typeof row.ucc === 'object' ? row.ucc : {};
  const rawThumbnail = typeof ucc.thumb === 'string' ? ucc.thumb : row.thumbnailUrl;
  let thumbnailUrl = '';
  if (typeof rawThumbnail === 'string' && rawThumbnail.trim()) {
    try {
      const thumbnailValue = rawThumbnail.trim();
      const thumbnail = new URL(thumbnailValue.startsWith('//') ? `https:${thumbnailValue}` : thumbnailValue);
      if (thumbnail.protocol === 'https:' && thumbnail.hostname === 'videoimg.sooplive.com') {
        thumbnailUrl = thumbnail.href;
      }
    } catch (_) {
      // 썸네일이 없거나 형식이 예상과 다르면 이미지만 생략한다.
    }
  }
  return {
    id,
    title: title || '제목 없음',
    regDate,
    readCount: Math.max(0, Math.floor(Number(counts.read_cnt ?? row.readCount) || 0)),
    durationMs: Math.max(0, Math.floor(Number(ucc.total_file_duration ?? row.durationMs) || 0)),
    thumbnailUrl,
    url: `https://vod.sooplive.com/player/${id}`,
  };
}

function normalizeVodCache(value) {
  const cache = value && typeof value === 'object' ? value : {};
  const sourceItems = cache.items && typeof cache.items === 'object' ? cache.items : {};
  const items = Object.values(sourceItems).map(normalizeSoopVod).filter(Boolean)
    .sort((a, b) => String(b.regDate).localeCompare(String(a.regDate)) || Number(b.id) - Number(a.id));
  return {
    items,
    total: Math.max(0, Math.floor(Number(cache.total) || items.length)),
    refreshedAt: Number.isFinite(cache.refreshedAt) ? cache.refreshedAt : null,
  };
}

async function readVodPage(streamerId, offset = 0, requestedGeneration = '') {
  const safeOffset = Math.min(MAX_LOADED_VIDEO_ITEMS, Math.max(0, Math.floor(Number(offset) || 0)));
  const listRef = vodListRef(streamerId);
  const [activeSnap, previousSnap] = await Promise.all([
    listRef.child('activeGeneration').get(),
    listRef.child('previousGeneration').get(),
  ]);
  const activeGeneration = activeSnap.val();
  const previousGeneration = previousSnap.val();

  if (typeof activeGeneration === 'string' && activeGeneration) {
    const generation = requestedGeneration || activeGeneration;
    if (generation !== activeGeneration && generation !== previousGeneration) {
      throw new HttpsError('aborted', '다시보기 목록이 갱신됐습니다. 페이지를 새로 불러와 주세요.');
    }
    const generationRef = listRef.child('generations').child(generation);
    const pageSize = Math.min(FANPAGE_VOD_PAGE_SIZE, MAX_LOADED_VIDEO_ITEMS - safeOffset);
    const [metadataSnap, itemsSnap] = await Promise.all([
      generationRef.child('metadata').get(),
      pageSize
        ? generationRef.child('items').orderByKey().startAt(vodItemKey(safeOffset)).limitToFirst(pageSize).get()
        : Promise.resolve(null),
    ]);
    const metadata = metadataSnap.val() || {};
    const total = Math.max(0, Math.floor(Number(metadata.total) || 0));
    const storedTotal = Math.max(0, Math.floor(Number(metadata.loadedTotal ?? metadata.total) || 0));
    const available = Math.min(total, storedTotal, MAX_LOADED_VIDEO_ITEMS);
    const items = [];
    if (itemsSnap) {
      itemsSnap.forEach((child) => {
        const vod = normalizeSoopVod(child.val());
        if (vod) items.push(vod);
      });
    }
    return {
      items,
      total,
      available,
      refreshedAt: Number.isFinite(metadata.refreshedAt) ? metadata.refreshedAt : null,
      generation,
      offset: safeOffset,
      nextOffset: safeOffset + items.length,
      hasMore: safeOffset + items.length < available,
    };
  }

  if (requestedGeneration && requestedGeneration !== 'legacy') {
    throw new HttpsError('aborted', '다시보기 목록이 갱신됐습니다. 페이지를 새로 불러와 주세요.');
  }
  // 최초 세대 전환 전까지 기존 캐시 형식도 읽어 점진적으로 호환한다.
  const cache = normalizeVodCache((await listRef.get()).val());
  const available = Math.min(cache.total, MAX_LOADED_VIDEO_ITEMS);
  const items = cache.items.slice(safeOffset, Math.min(safeOffset + FANPAGE_VOD_PAGE_SIZE, available));
  return {
    ...cache,
    items,
    available,
    generation: 'legacy',
    offset: safeOffset,
    nextOffset: safeOffset + items.length,
    hasMore: safeOffset + items.length < available,
  };
}

async function isFanpageVodInCache(streamerId, vodId) {
  const listRef = vodListRef(streamerId);
  const [activeSnap, previousSnap] = await Promise.all([
    listRef.child('activeGeneration').get(),
    listRef.child('previousGeneration').get(),
  ]);
  const generations = [...new Set([activeSnap.val(), previousSnap.val()].filter((value) => typeof value === 'string' && value))];
  if (!generations.length) {
    const cache = normalizeVodCache((await listRef.get()).val());
    return cache.items.slice(0, MAX_LOADED_VIDEO_ITEMS).some((vod) => vod.id === vodId);
  }

  for (const generation of generations) {
    const metadata = (await listRef.child('generations').child(generation).child('metadata').get()).val() || {};
    const total = Math.min(MAX_LOADED_VIDEO_ITEMS,
      Math.max(0, Math.floor(Number(metadata.loadedTotal ?? metadata.total) || 0)));
    if (!total) continue;
    const items = await listRef.child('generations').child(generation).child('items')
      .orderByKey().limitToFirst(total).get();
    let found = false;
    items.forEach((child) => {
      if (normalizeSoopVod(child.val())?.id === vodId) found = true;
    });
    if (found) return true;
  }
  return false;
}

function calendarCacheRootRef(streamerId) {
  return db.ref(`streamerFanPageCalendarCache/${streamerId}`);
}

function calendarCacheRef(streamerId, cacheKey) {
  return calendarCacheRootRef(streamerId).child(cacheKey);
}

function fanPageSchedulesRef(streamerId) {
  return db.ref(`streamerFanPageSchedules/${streamerId}`);
}

function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calendarVisibleRange(view, year, month, day) {
  let start;
  if (view === 'month') {
    start = new Date(Date.UTC(year, month - 1, 1));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  } else start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (view === 'month' ? 41 : 6));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function readFanPageSchedules(streamerId, startDate, endDate) {
  const snap = await fanPageSchedulesRef(streamerId).get();
  return Object.entries(snap.val() || {}).flatMap(([id, record]) => {
    if (!record || typeof record !== 'object' || !isValidCalendarDate(record.date)
      || record.date < startDate || record.date > endDate) return [];
    const title = typeof record.title === 'string' ? record.title.trim().slice(0, 200) : '';
    if (!title) return [];
    const time = typeof record.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.time)
      ? record.time
      : '';
    const typeName = FANPAGE_SCHEDULE_TYPES.has(record.typeName) ? record.typeName : '기타';
    return [{
      id,
      date: record.date,
      source: 'fanpage',
      type: 0,
      typeName,
      title,
      time,
    }];
  });
}

function mergeCalendarDays(soopDays, fanPageEvents, startDate, endDate) {
  const daysByDate = new Map();
  for (const day of soopDays) {
    if (day.date < startDate || day.date > endDate) continue;
    const events = daysByDate.get(day.date) || [];
    events.push(...(day.events || []).map((event) => ({ ...event, source: 'soop' })));
    daysByDate.set(day.date, events);
  }
  for (const event of fanPageEvents) {
    if (event.date < startDate || event.date > endDate) continue;
    const events = daysByDate.get(event.date) || [];
    events.push(event);
    daysByDate.set(event.date, events);
  }
  return [...daysByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, events]) => ({
      date,
      events: events.sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'ko')),
    }));
}

async function saveCalendarCache(streamerId, cacheKey, days, fetchedAt) {
  const rootRef = calendarCacheRootRef(streamerId);
  await rootRef.child(cacheKey).set({ days, fetchedAt });
  const cached = (await rootRef.get()).val() || {};
  const keepKeys = new Set(Object.entries(cached)
    .filter(([, value]) => value && Array.isArray(value.days))
    .sort((a, b) => (Number(b[1].fetchedAt) || 0) - (Number(a[1].fetchedAt) || 0))
    .slice(0, CALENDAR_CACHE_MAX_RANGES)
    .map(([key]) => key));
  const updates = {};
  Object.keys(cached).forEach((key) => {
    if (!keepKeys.has(key)) updates[key] = null;
  });
  if (Object.keys(updates).length) await rootRef.update(updates);
}

function normalizeSoopCalendar(payload) {
  if (!payload || !Array.isArray(payload.days)) return null;
  const days = [];
  for (const day of payload.days.slice(0, 45)) {
    const date = typeof day?.date === 'string' ? day.date : '';
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) continue;
    const events = Array.isArray(day.events) ? day.events.slice(0, CALENDAR_MAX_EVENTS_PER_DAY).map((event) => {
      if (!event || typeof event !== 'object') return null;
      const time = typeof event.eventTime === 'string' && /^\d{2}:\d{2}$/.test(event.eventTime)
        ? event.eventTime
        : '';
      return {
        type: Number.isSafeInteger(Number(event.calendarType)) && Number(event.calendarType) >= 1 && Number(event.calendarType) <= 5
          ? Number(event.calendarType)
          : 0,
        typeName: typeof event.calendarTypeName === 'string' ? event.calendarTypeName.trim().slice(0, 20) : '',
        title: typeof event.title === 'string' ? event.title.trim().slice(0, 200) : '',
        time,
      };
    }).filter((event) => event && (event.title || event.typeName)) : [];
    events.sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'ko'));
    days.push({ date, events });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchSoopCalendar(soopId, view, year, month, day) {
  const url = new URL(`${SOOP_CALENDAR_API}/${encodeURIComponent(soopId)}/calendar`);
  url.search = new URLSearchParams({
    view,
    year: String(year),
    month: String(month),
    day: String(day),
    userId: soopId,
  }).toString();
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        referer: `https://www.sooplive.com/station/${encodeURIComponent(soopId)}/calendar`,
        'user-agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error('SOOP calendar API request failed:', error);
    throw new HttpsError('unavailable', 'SOOP 방송 일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    console.error(`SOOP calendar API returned HTTP ${response.status} for ${soopId}`);
    throw new HttpsError('unavailable', 'SOOP 방송 일정 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new HttpsError('unavailable', 'SOOP 방송 일정 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  const days = normalizeSoopCalendar(payload);
  if (!days) {
    throw new HttpsError('unavailable', 'SOOP 방송 일정 응답 형식이 바뀌어 일정을 불러오지 못했습니다.');
  }
  return days;
}

async function fetchSoopLiveStatus(soopId) {
  const url = `${SOOP_STATION_API}/${encodeURIComponent(soopId)}/station`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        origin: 'https://www.sooplive.com',
        referer: `https://www.sooplive.com/station/${encodeURIComponent(soopId)}`,
        'user-agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error(`SOOP live status request failed for ${soopId}:`, error);
    throw new HttpsError('unavailable', 'SOOP 방송 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    console.error(`SOOP station API returned HTTP ${response.status} for ${soopId}`);
    throw new HttpsError('unavailable', 'SOOP 방송 상태 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new HttpsError('unavailable', 'SOOP 방송 상태 응답을 읽지 못했습니다.');
  }
  const stationId = payload && payload.station && payload.station.user_id;
  if (typeof stationId !== 'string' || stationId.toLowerCase() !== soopId.toLowerCase()) {
    throw new HttpsError('unavailable', 'SOOP 방송 상태 응답 형식을 확인하지 못했습니다.');
  }

  const broad = payload.broad && typeof payload.broad === 'object' ? payload.broad : null;
  if (!broad) return { isLive: false, checkedAt: Date.now() };
  const broadcastId = String(broad.broad_no || '').trim();
  if (!/^\d{1,20}$/.test(broadcastId) || broadcastId === '0') {
    throw new HttpsError('unavailable', 'SOOP 라이브 썸네일 정보를 확인하지 못했습니다.');
  }

  const checkedAt = Date.now();
  return {
    isLive: true,
    title: typeof broad.broad_title === 'string' ? broad.broad_title.trim().slice(0, 200) : '',
    viewerCount: Math.max(0, Math.floor(Number(broad.current_sum_viewer) || 0)),
    broadcastId,
    streamUrl: `https://play.sooplive.com/${encodeURIComponent(soopId)}/${encodeURIComponent(broadcastId)}`,
    thumbnailUrl: `https://liveimg.sooplive.com/m/${encodeURIComponent(broadcastId)}?t=${checkedAt}`,
    checkedAt,
  };
}

async function fetchSoopVodPage(soopId, page) {
  const url = new URL(`${SOOP_VOD_API}/${encodeURIComponent(soopId)}/vods/review`);
  url.search = new URLSearchParams({
    keyword: '',
    orderby: 'reg_date',
    page: String(page),
    field: 'title,contents,user_nick,user_id',
    per_page: String(SOOP_VOD_PAGE_SIZE),
    start_date: '',
    end_date: '',
  }).toString();
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    console.error('SOOP VOD API request failed:', error);
    throw new HttpsError('unavailable', 'SOOP 다시보기 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    console.error(`SOOP VOD API returned HTTP ${response.status} for page ${page}`);
    throw new HttpsError('unavailable', 'SOOP 다시보기 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!payload || !Array.isArray(payload.data) || !payload.meta || !Number.isFinite(Number(payload.meta.total))) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 응답 형식이 바뀌어 목록을 갱신하지 못했습니다.');
  }
  return { rows: payload.data, total: Math.max(0, Math.floor(Number(payload.meta.total))) };
}

function normalizeFetchedVodPage(rows, total, page, seenIds) {
  const expectedRows = Math.max(0, Math.min(SOOP_VOD_PAGE_SIZE, total - ((page - 1) * SOOP_VOD_PAGE_SIZE)));
  if (rows.length < expectedRows) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 전체 목록을 가져오지 못해 기존 목록을 유지했습니다.');
  }
  const vods = rows.slice(0, expectedRows).map((row) => normalizeSoopVod(row));
  if (vods.some((vod) => !vod)) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 항목 일부를 읽지 못해 기존 목록을 유지했습니다.');
  }
  for (const vod of vods) {
    if (seenIds.has(vod.id)) {
      throw new HttpsError('aborted', '갱신 중 SOOP 목록이 변경되어 중복 항목이 발견됐습니다. 다시 시도해 주세요.');
    }
    seenIds.add(vod.id);
  }
  return vods.sort((a, b) => String(b.regDate).localeCompare(String(a.regDate)) || Number(b.id) - Number(a.id));
}

async function acquireVodRefreshLock(streamerId) {
  const token = randomUUID();
  const lockRef = vodRefreshLockRef(streamerId);
  const startedAt = Date.now();
  const result = await lockRef.transaction((current) => {
    if (current && Number(current.expiresAt) > Date.now()) return;
    return { token, startedAt, expiresAt: Date.now() + VOD_REFRESH_LOCK_TTL_MS };
  });
  if (!result.committed || !result.snapshot.val() || result.snapshot.val().token !== token) {
    const current = result.snapshot.val();
    return {
      acquired: false,
      retryAfterMs: Math.max(0, (Number(current && current.expiresAt) || Date.now()) - Date.now()),
    };
  }
  return { acquired: true, token, lockRef };
}

async function renewVodRefreshLock(lockRef, token) {
  const result = await lockRef.transaction((current) => {
    const now = Date.now();
    if (current && current.token !== token && Number(current.expiresAt) > now) return;
    const startedAt = current && current.token === token && Number(current.startedAt)
      ? Number(current.startedAt)
      : now;
    return { token, startedAt, expiresAt: now + VOD_REFRESH_LOCK_TTL_MS };
  });
  if (!result.committed || !result.snapshot.val() || result.snapshot.val().token !== token) {
    const current = result.snapshot.val();
    throw new HttpsError('aborted', '다른 갱신 작업이 진행 중입니다.', {
      reason: 'vod-refresh-in-progress',
      retryAfterMs: Math.max(0, (Number(current && current.expiresAt) || Date.now()) - Date.now()),
    });
  }
}

async function stageAndPublishSoopVods(soopId, streamerId, lockToken, lockRef) {
  const listRef = vodListRef(streamerId);
  const [activeSnap, previousSnap, pendingSnap] = await Promise.all([
    listRef.child('activeGeneration').get(),
    listRef.child('previousGeneration').get(),
    listRef.child('pendingGeneration').get(),
  ]);
  const oldActive = activeSnap.val();
  const oldPrevious = previousSnap.val();
  const oldPending = pendingSnap.val();
  if (oldPending && oldPending !== oldActive && oldPending !== oldPrevious) {
    await listRef.child('generations').child(oldPending).remove();
  }

  const generation = randomUUID();
  const generationRef = listRef.child('generations').child(generation);
  await listRef.child('pendingGeneration').set(generation);
  let published = false;
  try {
    const first = await fetchSoopVodPage(soopId, 1);
    const loadedTotal = Math.min(first.total, MAX_LOADED_VIDEO_ITEMS);
    const pageCount = Math.ceil(loadedTotal / SOOP_VOD_PAGE_SIZE);
    const seenIds = new Set();
    const firstVods = normalizeFetchedVodPage(first.rows, loadedTotal, 1, seenIds);
    if (firstVods.length) {
      await generationRef.child('items').update(Object.fromEntries(
        firstVods.map((vod, index) => [vodItemKey(index), vod]),
      ));
    }

    const fetchBatchSize = 4;
    for (let firstPage = 2; firstPage <= pageCount; firstPage += fetchBatchSize) {
      await renewVodRefreshLock(lockRef, lockToken);
      const pages = Array.from(
        { length: Math.min(fetchBatchSize, pageCount - firstPage + 1) },
        (_, index) => firstPage + index,
      );
      const results = await Promise.all(pages.map((page) => fetchSoopVodPage(soopId, page)));
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const result = results[index];
        if (result.total !== first.total) {
          throw new HttpsError('aborted', '갱신 중 SOOP 목록이 변경됐습니다. 다시 시도해 주세요.');
        }
        const vods = normalizeFetchedVodPage(result.rows, loadedTotal, page, seenIds);
        if (vods.length) {
          const startIndex = (page - 1) * SOOP_VOD_PAGE_SIZE;
          await generationRef.child('items').update(Object.fromEntries(
            vods.map((vod, itemIndex) => [vodItemKey(startIndex + itemIndex), vod]),
          ));
        }
      }
    }

    if (seenIds.size !== loadedTotal) {
      throw new HttpsError('unavailable', 'SOOP 다시보기 전체 목록을 가져오지 못해 기존 목록을 유지했습니다.');
    }
    const refreshedAt = Date.now();
    await generationRef.child('metadata').set({ total: first.total, loadedTotal, refreshedAt });
    await renewVodRefreshLock(lockRef, lockToken);
    await listRef.update({
      activeGeneration: generation,
      previousGeneration: oldActive || null,
      pendingGeneration: null,
      items: null,
      total: null,
      refreshedAt: null,
    });
    published = true;
    if (oldPrevious && oldPrevious !== oldActive && oldPrevious !== generation) {
      await listRef.child('generations').child(oldPrevious).remove().catch((error) => {
        console.warn('Could not remove the retired SOOP VOD generation:', error);
      });
    }
    return await readVodPage(streamerId, 0, generation);
  } catch (error) {
    if (!published) {
      let generationRemoved = false;
      await generationRef.remove().then(() => { generationRemoved = true; }).catch((cleanupError) => {
        console.warn('Could not remove the incomplete SOOP VOD generation:', cleanupError);
      });
      const pending = generationRemoved
        ? await listRef.child('pendingGeneration').get().catch(() => null)
        : null;
      if (pending && pending.val() === generation) {
        await listRef.child('pendingGeneration').remove().catch(() => undefined);
      }
    }
    throw error;
  }
}

function cleanHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

function parseYouTubeChannelUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname)
      || parsed.username || parsed.password) return null;
    const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, '');
    const handleMatch = /^\/@([^/]+)(?:\/(?:videos|featured|playlists|streams|shorts))?$/u.exec(pathname);
    if (handleMatch && /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,29}$/u.test(handleMatch[1])) {
      const handle = handleMatch[1];
      return { type: 'handle', value: handle, url: `https://www.youtube.com/@${handle}` };
    }
    const channelMatch = /^\/channel\/(UC[A-Za-z0-9_-]{20,30})(?:\/(?:videos|featured|playlists|streams|shorts))?$/i.exec(pathname);
    if (channelMatch) {
      const channelId = channelMatch[1];
      return { type: 'channel', value: channelId, url: `https://www.youtube.com/channel/${channelId}` };
    }
    const userMatch = /^\/user\/([A-Za-z0-9._-]{1,100})(?:\/(?:videos|featured|playlists|streams|shorts))?$/i.exec(pathname);
    if (userMatch) {
      const username = userMatch[1];
      return { type: 'username', value: username, url: `https://www.youtube.com/user/${encodeURIComponent(username)}` };
    }
    return null;
  } catch (_) {
    return null;
  }
}

function parseNaverCafeUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !['cafe.naver.com', 'm.cafe.naver.com', 'www.cafe.naver.com'].includes(parsed.hostname)
      || parsed.username || parsed.password) return null;
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, '');
    const cafeIdMatch = /^\/ca-fe\/cafes\/(\d+)$/i.exec(path);
    if (cafeIdMatch) {
      return { type: 'id', value: cafeIdMatch[1], url: `https://cafe.naver.com/ca-fe/cafes/${cafeIdMatch[1]}` };
    }
    const slugMatch = /^\/([a-z0-9_-]{2,40})$/i.exec(path);
    if (!slugMatch) return null;
    const slug = slugMatch[1];
    return { type: 'slug', value: slug, url: `https://cafe.naver.com/${slug}` };
  } catch (_) {
    return null;
  }
}

function parseOgqEmoticonUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'ogqmarket.sooplive.com'
      || parsed.username || parsed.password || parsed.port) return null;
    const match = /^\/emoticon\/([A-Za-z0-9_-]{8,64})\/?$/.exec(parsed.pathname);
    if (!match) return null;
    return { id: match[1], url: `https://ogqmarket.sooplive.com/emoticon/${match[1]}` };
  } catch (_) {
    return null;
  }
}

function cafeCacheRef(streamerId) {
  return db.ref(`streamerFanPageCafeCache/${streamerId}`);
}

function normalizeCafePost(item, cafeId) {
  if (!item || typeof item !== 'object') return null;
  const articleId = Math.floor(Number(item.articleId));
  const title = typeof item.subject === 'string' ? item.subject.trim().slice(0, 200) : '';
  const writer = item.writerInfo && typeof item.writerInfo.nickName === 'string'
    ? item.writerInfo.nickName.trim().slice(0, 50) : '';
  const writeDate = Number(item.writeDateTimestamp);
  if (!Number.isSafeInteger(articleId) || articleId < 1 || !title || !writer || !Number.isFinite(writeDate)
    || item.openArticle !== true || item.blindArticle === true) return null;
  return {
    articleId,
    title,
    writer,
    writeDate: writeDate < 1e12 ? writeDate * 1000 : writeDate,
    commentCount: Math.max(0, Math.floor(Number(item.commentCount) || 0)),
    url: `https://cafe.naver.com/ca-fe/cafes/${cafeId}/articles/${articleId}`,
  };
}

function normalizeCafeCache(value, cafeUrl) {
  const cache = value && typeof value === 'object' ? value : {};
  if (cache.sourceUrl && cache.sourceUrl !== cafeUrl) {
    return { linked: true, cafeUrl, cafeId: '', cafeListUrl: cafeUrl, items: [], totalCount: 0, fetchedAt: null };
  }
  const cafeId = /^\d{4,16}$/.test(String(cache.cafeId || '')) ? String(cache.cafeId) : '';
  const items = cafeId && Array.isArray(cache.items)
    ? cache.items.map((item) => normalizeCafePost({
      articleId: item && item.articleId,
      subject: item && item.title,
      writerInfo: { nickName: item && item.writer },
      writeDateTimestamp: item && item.writeDate,
      commentCount: item && item.commentCount,
      openArticle: true,
    }, cafeId)).filter(Boolean).slice(0, CAFE_POST_PREVIEW_SIZE)
    : [];
  return {
    linked: true,
    cafeUrl,
    cafeId,
    cafeListUrl: cafeId ? `https://cafe.naver.com/f-e/cafes/${cafeId}/menus/0?viewType=L` : cafeUrl,
    items,
    totalCount: Math.max(items.length, Math.floor(Number(cache.totalCount) || 0)),
    fetchedAt: Number.isFinite(Number(cache.fetchedAt)) ? Number(cache.fetchedAt) : null,
  };
}

async function resolveNaverCafeId(cafe) {
  if (cafe.type === 'id') return cafe.value;
  let response;
  try {
    response = await fetch(cafe.url, {
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (compatible; StreamerFanPage/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {
    throw new HttpsError('unavailable', '네이버 카페에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok || !['cafe.naver.com', 'm.cafe.naver.com', 'www.cafe.naver.com'].includes(new URL(response.url).hostname)) {
    throw new HttpsError('unavailable', '네이버 카페 주소를 확인할 수 없어요.');
  }
  const html = await response.text();
  const match = /g_sClubId\s*=\s*["'](\d{4,16})["']/.exec(html)
    || /["'](?:cafeId|clubid)["']\s*:\s*["']?(\d{4,16})/i.exec(html);
  if (!match) throw new HttpsError('not-found', '네이버 카페를 찾을 수 없어요. 공개 카페 주소인지 확인해 주세요.');
  return match[1];
}

async function fetchNaverCafePosts(cafe) {
  const cafeId = await resolveNaverCafeId(cafe);
  const url = new URL(`${NAVER_CAFE_API_BASE}/cafes/${cafeId}/menus/0/articles`);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(CAFE_POST_PREVIEW_SIZE));
  url.searchParams.set('viewType', 'L');
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        origin: 'https://cafe.naver.com',
        referer: cafe.url,
        'user-agent': 'Mozilla/5.0 (compatible; StreamerFanPage/1.0)',
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {
    throw new HttpsError('unavailable', '네이버 카페 글 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    console.warn(`Naver Cafe board list returned HTTP ${response.status}`);
    throw new HttpsError('unavailable', '네이버 카페 글 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new HttpsError('unavailable', '네이버 카페 글 목록 응답을 읽지 못했어요.');
  }
  if (!payload || !payload.result || !Array.isArray(payload.result.articleList)) {
    throw new HttpsError('unavailable', '네이버 카페 글 목록 형식이 바뀌었어요. 잠시 후 다시 시도해 주세요.');
  }
  const result = payload && payload.result && typeof payload.result === 'object' ? payload.result : {};
  const rows = Array.isArray(result.articleList) ? result.articleList : [];
  const items = rows.map((row) => normalizeCafePost(row && row.item, cafeId)).filter(Boolean).slice(0, CAFE_POST_PREVIEW_SIZE);
  const totalCount = Math.max(items.length, Math.floor(Number(result.pageInfo && result.pageInfo.totalArticleCount) || 0));
  return {
    linked: true,
    cafeUrl: cafe.url,
    cafeId,
    cafeListUrl: `https://cafe.naver.com/f-e/cafes/${cafeId}/menus/0?viewType=L`,
    items,
    totalCount,
    fetchedAt: Date.now(),
  };
}

function weflabRouletteCacheRef(streamerId) {
  return db.ref(`streamerFanPageRouletteCache/${streamerId}`);
}

function normalizeWeFlabRouletteData(value, sourceUrl) {
  if (!value || typeof value !== 'object' || (value.sourceUrl && value.sourceUrl !== sourceUrl)) return null;
  let remainingItems = 500;
  const groups = [];
  for (const group of Array.isArray(value.groups) ? value.groups.slice(0, 50) : []) {
    if (!group || typeof group !== 'object' || remainingItems <= 0) continue;
    const items = (Array.isArray(group.items) ? group.items : []).slice(0, remainingItems).map((item) => {
      if (!item || typeof item !== 'object') return null;
      const type = typeof item.type === 'string' ? item.type.trim().slice(0, 40) : '';
      const label = typeof item.value === 'string' ? item.value.trim().slice(0, 180) : '';
      const probability = item.probability === null || item.probability === undefined ? NaN : Number(item.probability);
      if (!type && !label) return null;
      return {
        type: type || '룰렛',
        value: label || '이름 없음',
        probability: Number.isFinite(probability) && probability >= 0 && probability <= 100 ? probability : null,
      };
    }).filter(Boolean);
    if (!items.length) continue;
    remainingItems -= items.length;
    const counts = (Array.isArray(group.counts) ? group.counts : []).slice(0, 12).map((count) => {
      if (!count || typeof count !== 'object') return null;
      const min = Math.floor(Number(count.min));
      const max = Math.floor(Number(count.max));
      if (!Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(max) || max < min) return null;
      return {
        platform: typeof count.platform === 'string' ? count.platform.slice(0, 30) : '',
        min,
        max,
      };
    }).filter(Boolean);
    groups.push({ index: groups.length, counts, items });
  }
  if (!groups.length) return null;
  return {
    linked: true,
    streamerName: typeof value.streamerName === 'string' ? value.streamerName.slice(0, 60) : '',
    sourceUpdatedAt: typeof value.sourceUpdatedAt === 'string' ? value.sourceUpdatedAt.slice(0, 80) : '',
    groups,
    itemCount: groups.reduce((total, group) => total + group.items.length, 0),
    fetchedAt: value.fetchedAt !== null && value.fetchedAt !== undefined && Number.isFinite(Number(value.fetchedAt))
      ? Number(value.fetchedAt)
      : null,
  };
}

async function readLimitedResponseText(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpsError('resource-exhausted', '위플랩 공개 페이지가 너무 커서 표시할 수 없어요.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let result = '';
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpsError('resource-exhausted', '위플랩 공개 페이지가 너무 커서 표시할 수 없어요.');
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchWeFlabRoulette(sourceUrl) {
  let response = null;
  let requestUrl = sourceUrl;
  const redirectStatuses = new Set([301, 302, 303, 307, 308]);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(requestUrl, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (compatible; StreamerFanPage/1.0)',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
    } catch (_) {
      throw new HttpsError('unavailable', '위플랩 룰렛 페이지에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    if (!redirectStatuses.has(response.status)) break;
    const location = response.headers.get('location');
    let nextUrl;
    try {
      nextUrl = location ? parseWeFlabRouletteUrl(new URL(location, requestUrl).href) : null;
    } catch (_) {
      nextUrl = null;
    }
    if (!nextUrl) {
      throw new HttpsError('unavailable', '위플랩 공유 페이지가 안전한 주소로 연결되지 않았어요.');
    }
    requestUrl = nextUrl;
    response = null;
  }
  if (!response || !response.ok || parseWeFlabRouletteUrl(response.url) !== sourceUrl) {
    console.warn(`WeFlab roulette page returned HTTP ${response ? response.status : 'no response'}.`);
    throw new HttpsError('unavailable', '위플랩 공개 페이지에 연결할 수 없어요. 링크를 확인해 주세요.');
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new HttpsError('unavailable', '위플랩 룰렛 페이지 응답 형식이 올바르지 않아요.');
  }
  const html = await readLimitedResponseText(response, WEFLAB_ROULETTE_MAX_HTML_BYTES);
  const parsed = parseWeFlabRouletteHtml(html);
  if (!parsed) {
    throw new HttpsError('unavailable', '위플랩 룰렛 항목을 읽지 못했어요. 페이지 구조가 바뀌었을 수 있습니다.');
  }
  return normalizeWeFlabRouletteData({ ...parsed, fetchedAt: Date.now() }, sourceUrl);
}

function youtubeCacheRef(streamerId) {
  return db.ref(`streamerFanPageYouTubeCache/${streamerId}`);
}

async function fetchYouTubeJson(resource, parameters, apiKey) {
  const url = new URL(`${YOUTUBE_API_BASE}/${resource}`);
  Object.entries({ ...parameters, key: apiKey }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {
    throw new HttpsError('unavailable', 'YouTube 영상 목록에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    console.warn(`YouTube Data API ${resource} returned HTTP ${response.status}`);
    throw new HttpsError('unavailable', 'YouTube 영상 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new HttpsError('unavailable', 'YouTube 영상 목록 응답을 읽지 못했어요.');
  }
  if (payload && payload.error) {
    const errorCode = String(payload.error.errors?.[0]?.reason || payload.error.status || 'apiError');
    console.warn(`YouTube Data API ${resource} returned ${errorCode}`);
    throw new HttpsError('unavailable', 'YouTube 영상 목록을 불러오지 못했어요. 채널 주소와 API 설정을 확인해 주세요.');
  }
  return payload;
}

function normalizeYouTubeVideo(item) {
  if (!item || typeof item !== 'object') return null;
  const snippet = item && item.snippet && typeof item.snippet === 'object' ? item.snippet : {};
  const contentDetails = item && item.contentDetails && typeof item.contentDetails === 'object' ? item.contentDetails : {};
  const videoId = String(contentDetails.videoId || (snippet.resourceId && snippet.resourceId.videoId) || item.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const thumbnails = snippet.thumbnails && typeof snippet.thumbnails === 'object' ? snippet.thumbnails : {};
  const thumbnail = thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default;
  let thumbnailUrl = '';
  const rawThumbnailUrl = thumbnail && typeof thumbnail.url === 'string'
    ? thumbnail.url
    : typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : '';
  if (rawThumbnailUrl) {
    try {
      const parsed = new URL(rawThumbnailUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === 'i.ytimg.com') thumbnailUrl = parsed.href;
    } catch (_) {
      // 썸네일 주소가 예상과 다르면 이미지만 생략한다.
    }
  }
  return {
    id: videoId,
    title: typeof snippet.title === 'string' ? snippet.title.trim().slice(0, 300)
      : typeof item.title === 'string' ? item.title.trim().slice(0, 300) : '제목 없음',
    publishedAt: typeof snippet.publishedAt === 'string' ? snippet.publishedAt.slice(0, 32)
      : typeof item.publishedAt === 'string' ? item.publishedAt.slice(0, 32) : '',
    thumbnailUrl,
  };
}

function normalizeYouTubeCache(value, channelUrl) {
  const cache = value && typeof value === 'object' ? value : {};
  if (cache.sourceUrl && cache.sourceUrl !== channelUrl) {
    return { linked: true, channelTitle: '', channelUrl, totalCount: 0, items: [], fetchedAt: null };
  }
  const items = Array.isArray(cache.items)
    ? cache.items.map(normalizeYouTubeVideo).filter(Boolean).slice(0, MAX_LOADED_VIDEO_ITEMS)
    : [];
  return {
    linked: true,
    channelTitle: typeof cache.channelTitle === 'string' ? cache.channelTitle.slice(0, 100) : '',
    channelUrl,
    totalCount: Math.max(items.length, Math.floor(Number(cache.totalCount) || 0)),
    items,
    fetchedAt: Number.isFinite(Number(cache.fetchedAt)) ? Number(cache.fetchedAt) : null,
  };
}

async function fetchYouTubeUploads(channelUrl, apiKey) {
  const channel = parseYouTubeChannelUrl(channelUrl);
  if (!channel) throw new HttpsError('failed-precondition', 'YouTube 채널 주소 형식을 확인해 주세요.');
  const channelFilter = channel.type === 'handle'
    ? { forHandle: channel.value }
    : channel.type === 'username' ? { forUsername: channel.value } : { id: channel.value };
  const channelPayload = await fetchYouTubeJson('channels', {
    part: 'snippet,contentDetails',
    ...channelFilter,
  }, apiKey);
  const channelItem = Array.isArray(channelPayload.items) ? channelPayload.items[0] : null;
  const channelId = String(channelItem && channelItem.id || '');
  const uploadsPlaylistId = String(channelItem && channelItem.contentDetails
    && channelItem.contentDetails.relatedPlaylists && channelItem.contentDetails.relatedPlaylists.uploads || '');
  if (!/^UC[A-Za-z0-9_-]{20,30}$/i.test(channelId) || !uploadsPlaylistId) {
    throw new HttpsError('not-found', 'YouTube 채널을 찾을 수 없어요. 링크를 확인해 주세요.');
  }
  const uploads = await fetchYouTubeJson('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: Math.min(YOUTUBE_VIDEO_PAGE_SIZE, MAX_LOADED_VIDEO_ITEMS),
  }, apiKey);
  const items = Array.isArray(uploads.items)
    ? uploads.items.map(normalizeYouTubeVideo).filter(Boolean).slice(0, MAX_LOADED_VIDEO_ITEMS)
    : [];
  return {
    linked: true,
    channelTitle: typeof channelItem.snippet?.title === 'string' ? channelItem.snippet.title.slice(0, 100) : '',
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    sourceUrl: channel.url,
    totalCount: Math.max(items.length, Math.floor(Number(uploads.pageInfo?.totalResults) || 0)),
    items,
    fetchedAt: Date.now(),
  };
}

function normalizePage(streamer, value) {
  const page = value && typeof value === 'object' ? value : {};
  const sourceProfile = page.profile && typeof page.profile === 'object' ? page.profile : {};
  const profile = {
    birthday: typeof sourceProfile.birthday === 'string' ? sourceProfile.birthday.slice(0, 20) : '',
    mbti: typeof sourceProfile.mbti === 'string' ? sourceProfile.mbti.slice(0, 8) : '',
    major: typeof sourceProfile.major === 'string' ? sourceProfile.major.slice(0, 50) : '',
    debutDate: typeof sourceProfile.debutDate === 'string' ? sourceProfile.debutDate.slice(0, 20) : '',
    fanNickname: typeof sourceProfile.fanNickname === 'string' ? sourceProfile.fanNickname.slice(0, 30) : '',
    fandomName: typeof sourceProfile.fandomName === 'string' ? sourceProfile.fandomName.slice(0, 30) : '',
    contents: Array.isArray(sourceProfile.contents)
      ? sourceProfile.contents.filter((item) => typeof item === 'string').slice(0, 8).map((item) => item.slice(0, 20))
      : [],
    scheduleText: typeof sourceProfile.scheduleText === 'string' ? sourceProfile.scheduleText.slice(0, 120) : '',
    rouletteUrl: cleanHttpsUrl(sourceProfile.rouletteUrl),
    youtubeChannelUrl: parseYouTubeChannelUrl(sourceProfile.youtubeChannelUrl)?.url || '',
    cafeUrl: parseNaverCafeUrl(sourceProfile.cafeUrl)?.url || '',
    ogqEmoticonUrl: parseOgqEmoticonUrl(sourceProfile.ogqEmoticonUrl)?.url || '',
  };
  return {
    streamer,
    intro: typeof page.intro === 'string' ? page.intro.slice(0, MAX_INTRO_LENGTH) : '',
    profile,
    updatedAt: Number.isFinite(page.updatedAt) ? page.updatedAt : null,
  };
}

function fanPageVodCommentsRef(streamerId, vodId) {
  return db.ref(`streamerFanPageVodComments/${streamerId}/${vodId}`);
}

function avatarUrlForSoopId(soopId) {
  if (!soopId) return '';
  return `https://stimg.sooplive.com/LOGO/${soopId.slice(0, 2)}/${soopId}/${soopId}.jpg`;
}

function normalizeFanpageCommentProfile(value) {
  if (!value || typeof value !== 'object') return null;
  const nickname = typeof value.nickname === 'string' ? value.nickname.trim().slice(0, 12) : '';
  if (!nickname || /[<>\x00-\x1F\x7F]/.test(nickname)) return null;
  const rawSoopId = typeof value.soopId === 'string' ? value.soopId.trim().toLowerCase() : '';
  const soopId = SOOP_ID_PATTERN.test(rawSoopId) ? rawSoopId : '';
  let avatarUrl = soopId ? avatarUrlForSoopId(soopId) : '';
  if (!avatarUrl && typeof value.avatarUrl === 'string') {
    try {
      const parsed = new URL(value.avatarUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === 'stimg.sooplive.com') avatarUrl = parsed.href;
    } catch (_) { /* Ignore malformed or untrusted profile image URLs. */ }
  }
  return { nickname, soopId, avatarUrl };
}

async function resolveFanpageCommentProfile(uid) {
  const paths = [
    ['streamerFanPageCommentProfiles', `streamerFanPageCommentProfiles/${uid}`],
    ['bettingMarket', `bettingMarket/profiles/${uid}`],
    ['gallery', `gallery/profiles/${uid}`],
  ];
  for (const [source, path] of paths) {
    const snapshot = await db.ref(path).get();
    const profile = normalizeFanpageCommentProfile(snapshot.val());
    if (profile) return { ...profile, source };
  }
  return null;
}

async function fetchSoopVodInfoForComments(vodId) {
  let response;
  try {
    response = await fetch('https://api.m.sooplive.com/station/video/a/view', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded',
        referer: `https://vod.sooplive.com/player/${vodId}`,
        'user-agent': 'Mozilla/5.0',
      },
      body: new URLSearchParams({ nTitleNo: vodId, nApiLevel: '11', nPlaylistIdx: '0' }).toString(),
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    console.warn(`SOOP VOD metadata request failed for ${vodId}:`, error);
    return null;
  }
  if (!response.ok) return null;
  try {
    const payload = await response.json();
    return payload && payload.result === 1 && payload.data && typeof payload.data === 'object'
      ? payload.data
      : null;
  } catch (_) {
    return null;
  }
}

function normalizeSoopVodComment(row) {
  if (!row || typeof row !== 'object' || !/^\d{1,20}$/.test(String(row.p_comment_no || ''))) return null;
  const rawProfileUrl = typeof row.user_profile === 'string' ? row.user_profile.trim() : '';
  let avatarUrl = '';
  if (rawProfileUrl) {
    try {
      const parsed = new URL(rawProfileUrl.startsWith('//') ? `https:${rawProfileUrl}` : rawProfileUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === 'stimg.sooplive.com') avatarUrl = parsed.href;
    } catch (_) { /* Optional avatar. */ }
  }
  return {
    id: String(row.p_comment_no),
    nickname: typeof row.user_nick === 'string' ? row.user_nick.trim().slice(0, 50) : '',
    soopId: typeof row.user_id === 'string' ? row.user_id.trim().slice(0, 30) : '',
    avatarUrl,
    content: typeof row.comment === 'string' ? row.comment.slice(0, 2000) : '',
    createdAt: typeof row.reg_date === 'string' ? row.reg_date.slice(0, 30) : '',
    replyCount: Math.max(0, Math.floor(Number(row.c_comment_cnt) || 0)),
  };
}

async function fetchSoopVodCommentPage(vodId, vodInfo, pageNo, lastNo) {
  const body = new URLSearchParams({
    nStationNo: String(vodInfo.station_no),
    nBbsNo: String(vodInfo.bbs_no),
    nTitleNo: vodId,
    bj_id: String(vodInfo.bj_id),
    nPageNo: String(pageNo),
    nOrderNo: '1',
    nBoardType: String(vodInfo.board_type ?? 105),
    szAction: 'get',
    nVod: '1',
    nLastNo: String(lastNo),
  });
  let response;
  try {
    response = await fetch('https://stbbs.sooplive.com/api/bbs_memo_action.php', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ko',
        'content-type': 'application/x-www-form-urlencoded',
        referer: `https://vod.sooplive.com/player/${vodId}`,
        'user-agent': 'Mozilla/5.0',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    console.warn(`SOOP VOD comments request failed for ${vodId}:`, error);
    return null;
  }
  if (!response.ok) return null;
  try {
    const payload = await response.json();
    const channel = payload && payload.CHANNEL;
    const success = channel && [channel.RESULT, channel.result].some((value) => value === 1 || String(value) === '1');
    if (!success) return null;
    const data = channel.DATA && typeof channel.DATA === 'object' ? channel.DATA : {};
    return {
      items: Array.isArray(data.list_data) ? data.list_data.map(normalizeSoopVodComment).filter(Boolean) : [],
      totalCount: Math.max(0, Math.floor(Number(data.total_cnt ?? payload.TOTAL_CNT) || 0)),
      hasMore: data.has_more === true,
    };
  } catch (_) {
    return null;
  }
}

function normalizeFanpageVodComment(value, id) {
  if (!value || typeof value !== 'object') return null;
  const profile = normalizeFanpageCommentProfile(value);
  const content = typeof value.content === 'string' ? value.content.trim().slice(0, FANPAGE_VOD_COMMENT_MAX_LENGTH) : '';
  const createdAt = Number(value.createdAt);
  if (!profile || !content || !Number.isFinite(createdAt)) return null;
  return {
    id,
    uid: typeof value.uid === 'string' ? value.uid : '',
    ...profile,
    content,
    createdAt,
  };
}

exports.streamerFanPageBootstrap = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
  const requestedId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
  if (verified && !isAdmin && requestedId !== verified.streamer.id) {
    return { verifiedStreamer: verified.streamer, isAdmin, redirectTo: verified.streamer.id };
  }
  if (!requestedId) return { verifiedStreamer: verified ? verified.streamer : null, isAdmin, page: null };

  const target = await findVerifiedBySoopId(requestedId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  const [pageSnap, vods, stockNamesSnap] = await Promise.all([
    pageRef(target.streamer.id).get(),
    readVodPage(target.streamer.id),
    db.ref('streamerNames').get(),
    recordRecentVisit(uid, target.streamer.id),
    ...(!isAdmin && (!verified || verified.streamer.id !== target.streamer.id)
      ? [recordFanPageView(uid, target.streamer.id).catch((error) => {
        console.warn('Could not record the fanpage view:', error);
      })]
      : []),
  ]);
  const stock = findStockForStreamer(target.streamer, stockNamesSnap.val());
  return {
    verifiedStreamer: verified ? verified.streamer : null,
    isAdmin,
    page: { ...normalizePage(target.streamer, pageSnap.val()), vods, stock },
  };
});

exports.streamerFanPageRoulette = onCall({ maxInstances: 20 }, async (request) => {
  requireAuth(request);
  const streamerId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');

  const configuredUrl = (await pageRef(target.streamer.id).child('profile/rouletteUrl').get()).val();
  const sourceUrl = parseWeFlabRouletteUrl(configuredUrl);
  if (!sourceUrl) {
    return {
      roulette: { linked: false, streamerName: '', sourceUpdatedAt: '', groups: [], itemCount: 0, fetchedAt: null },
      stale: false,
    };
  }

  const cacheRef = weflabRouletteCacheRef(target.streamer.id);
  const cached = normalizeWeFlabRouletteData((await cacheRef.get()).val(), sourceUrl);
  const cacheAge = cached && cached.fetchedAt ? Math.max(0, Date.now() - cached.fetchedAt) : Infinity;
  const forceRefresh = request.data && request.data.forceRefresh === true;
  if (cached && !forceRefresh && cacheAge < WEFLAB_ROULETTE_CACHE_TTL_MS) {
    return { roulette: cached, stale: false, refreshCoolingDown: false };
  }
  if (cached && forceRefresh && cacheAge < WEFLAB_ROULETTE_REFRESH_COOLDOWN_MS) {
    return { roulette: cached, stale: false, refreshCoolingDown: true };
  }

  const requestKey = `${target.streamer.id}:${sourceUrl}`;
  const inProgress = weflabRouletteFetchInProgress.get(requestKey);
  if (inProgress) return await inProgress;

  const task = (async () => {
    try {
      const fresh = await fetchWeFlabRoulette(sourceUrl);
      try {
        await cacheRef.set({ ...fresh, sourceUrl });
      } catch (cacheError) {
        console.warn(`Could not cache WeFlab roulette data for ${target.streamer.id}:`, cacheError);
      }
      return { roulette: fresh, stale: false, refreshCoolingDown: false };
    } catch (error) {
      if (cached && cached.itemCount > 0) {
        console.warn(`Serving stale WeFlab roulette cache for ${target.streamer.id}:`, error);
        return { roulette: cached, stale: true, refreshCoolingDown: false };
      }
      if (error instanceof HttpsError) throw error;
      console.error(`WeFlab roulette fetch failed for ${target.streamer.id}:`, error);
      throw new HttpsError('unavailable', '위플랩 룰렛 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  })();
  weflabRouletteFetchInProgress.set(requestKey, task);
  try {
    return await task;
  } finally {
    if (weflabRouletteFetchInProgress.get(requestKey) === task) weflabRouletteFetchInProgress.delete(requestKey);
  }
});

exports.streamerFanPageYouTubeVideos = onCall({ secrets: [YOUTUBE_DATA_API_KEY], maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const forceRefresh = data.forceRefresh === true;
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');

  if (forceRefresh) {
    const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
    if (!isAdmin && (!verified || verified.streamer.id !== target.streamer.id)) {
      throw new HttpsError('permission-denied', '인증 스트리머 또는 관리자만 YouTube 목록을 갱신할 수 있습니다.');
    }
  }

  const pageSnap = await pageRef(target.streamer.id).child('profile/youtubeChannelUrl').get();
  const channel = parseYouTubeChannelUrl(pageSnap.val());
  if (!channel) {
    return { youtube: { linked: false, channelTitle: '', channelUrl: '', totalCount: 0, items: [], fetchedAt: null } };
  }

  const cacheRef = youtubeCacheRef(target.streamer.id);
  const cached = normalizeYouTubeCache((await cacheRef.get()).val(), channel.url);
  const cacheAge = cached.fetchedAt ? Math.max(0, Date.now() - cached.fetchedAt) : Infinity;
  if (cached.fetchedAt && !forceRefresh && cacheAge < YOUTUBE_CACHE_TTL_MS) {
    return { youtube: cached, stale: false };
  }
  if (cached.fetchedAt && forceRefresh && cacheAge < YOUTUBE_REFRESH_COOLDOWN_MS) {
    return { youtube: cached, stale: false, refreshCoolingDown: true };
  }

  const inProgress = youtubeFetchInProgress.get(target.streamer.id);
  if (inProgress) return { youtube: await inProgress, stale: false };

  const task = (async () => {
    try {
      const fresh = await fetchYouTubeUploads(channel.url, YOUTUBE_DATA_API_KEY.value());
      await cacheRef.set(fresh);
      return fresh;
    } catch (error) {
      if (cached.fetchedAt) {
        console.warn(`Serving stale YouTube upload cache for ${target.streamer.id}.`);
        return { ...cached, stale: true };
      }
      throw error;
    }
  })();
  youtubeFetchInProgress.set(target.streamer.id, task);
  try {
    const youtube = await task;
    return { youtube, stale: youtube.stale === true, refreshCoolingDown: false };
  } finally {
    if (youtubeFetchInProgress.get(target.streamer.id) === task) youtubeFetchInProgress.delete(target.streamer.id);
  }
});

exports.streamerFanPageCafePosts = onCall({ maxInstances: 20 }, async (request) => {
  requireAuth(request);
  const streamerId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  const cafeUrl = parseNaverCafeUrl((await pageRef(target.streamer.id).child('profile/cafeUrl').get()).val());
  if (!cafeUrl) {
    return { cafe: { linked: false, cafeUrl: '', cafeListUrl: '', cafeId: '', items: [], totalCount: 0, fetchedAt: null }, stale: false };
  }

  const cacheRef = cafeCacheRef(target.streamer.id);
  const cached = normalizeCafeCache((await cacheRef.get()).val(), cafeUrl.url);
  const cacheAge = cached.fetchedAt ? Math.max(0, Date.now() - cached.fetchedAt) : Infinity;
  if (cached.fetchedAt && cacheAge < CAFE_POST_CACHE_TTL_MS) return { cafe: cached, stale: false };

  const inProgress = cafeFetchInProgress.get(target.streamer.id);
  if (inProgress) return await inProgress;

  const task = (async () => {
    try {
      const fresh = await fetchNaverCafePosts(cafeUrl);
      await cacheRef.set({ ...fresh, sourceUrl: cafeUrl.url });
      return { cafe: fresh, stale: false };
    } catch (error) {
      if (cached.fetchedAt && cached.items.length) {
        console.warn(`Serving stale Naver Cafe post cache for ${target.streamer.id}.`);
        return { cafe: cached, stale: true };
      }
      if (error instanceof HttpsError) throw error;
      console.error(`Naver Cafe post preview failed for ${target.streamer.id}:`, error);
      throw new HttpsError('unavailable', '네이버 카페 글 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  })();
  cafeFetchInProgress.set(target.streamer.id, task);
  try {
    return await task;
  } finally {
    if (cafeFetchInProgress.get(target.streamer.id) === task) cafeFetchInProgress.delete(target.streamer.id);
  }
});

exports.streamerFanPageVodPage = onCall({ maxInstances: 30 }, async (request) => {
  requireAuth(request);
  const data = request.data || {};
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const offset = Number(data.offset);
  const generation = typeof data.generation === 'string' ? data.generation : '';
  const validGeneration = !generation || generation === 'legacy'
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generation);
  if (!streamerId || !Number.isSafeInteger(offset) || offset < 0 || !validGeneration) {
    throw new HttpsError('invalid-argument', '다시보기 페이지 요청을 확인해 주세요.');
  }
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  return { vods: await readVodPage(target.streamer.id, offset, generation) };
});

exports.streamerFanPageCommentProfileSave = onCall({ maxInstances: 20 }, async (request) => {
  const uid = await requireProtectedCommentProfileAuth(request);
  const data = request.data || {};
  const nickname = typeof data.nickname === 'string' ? data.nickname.trim() : '';
  const soopId = typeof data.soopId === 'string' ? data.soopId.trim().toLowerCase() : '';
  if (!nickname || nickname.length > 12 || /[<>\x00-\x1F\x7F]/.test(nickname)) {
    throw new HttpsError('invalid-argument', '닉네임은 사용할 수 없는 문자 없이 1~12자로 입력해 주세요.');
  }
  if (soopId && !SOOP_ID_PATTERN.test(soopId)) {
    throw new HttpsError('invalid-argument', 'SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.');
  }
  const profile = { nickname, soopId, avatarUrl: avatarUrlForSoopId(soopId), updatedAt: Date.now() };
  await db.ref(`streamerFanPageCommentProfiles/${uid}`).set(profile);
  return { profile: { nickname, soopId, avatarUrl: profile.avatarUrl } };
});

exports.streamerFanPageVodComments = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const vodId = String(data.vodId || '').trim();
  const pageNo = Number(data.soopPageNo || 1);
  const lastNo = Number(data.soopLastNo || 0);
  if (!streamerId || !/^\d{1,20}$/.test(vodId)
    || !Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > 1000
    || !Number.isSafeInteger(lastNo) || lastNo < 0) {
    throw new HttpsError('invalid-argument', 'VOD 댓글 요청을 확인해 주세요.');
  }
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');

  const [vodInfo, canUseCommentProfile, fanpageSnapshot, verified, isAdmin] = await Promise.all([
    fetchSoopVodInfoForComments(vodId),
    hasProtectedAccount(request, uid),
    fanPageVodCommentsRef(target.streamer.id, vodId).orderByKey()
      .limitToLast(FANPAGE_VOD_COMMENT_PAGE_SIZE + 1).get(),
    findVerifiedByUid(uid),
    isAdminUid(uid),
  ]);
  const profile = canUseCommentProfile ? await resolveFanpageCommentProfile(uid) : null;

  const relatedVod = !!(vodInfo && typeof vodInfo.bj_id === 'string'
    && vodInfo.bj_id.toLowerCase() === target.streamer.soopId.toLowerCase());
  const cachedVod = !vodInfo && await isFanpageVodInCache(target.streamer.id, vodId);
  if ((vodInfo && !relatedVod) || (!vodInfo && !cachedVod)) {
    throw new HttpsError('not-found', '이 VOD는 해당 스트리머의 다시보기가 아닙니다.');
  }

  let soop = {
    available: !!(vodInfo && vodInfo.comment_yn !== 0 && String(vodInfo.comment_yn) !== '0'),
    totalCount: Math.max(0, Math.floor(Number(vodInfo && vodInfo.memo_cnt) || 0)),
    items: [],
    hasMore: false,
    nextPageNo: pageNo,
    nextLastNo: lastNo,
    error: vodInfo ? '' : 'SOOP 댓글 서버에 연결할 수 없어 팬페이지 댓글만 표시하고 있어요.',
  };
  if (soop.available) {
    const page = await fetchSoopVodCommentPage(vodId, vodInfo, pageNo, lastNo);
    if (!page) {
      soop = { ...soop, available: false, error: 'SOOP 댓글을 불러오지 못했어요.' };
    } else {
      const lastCommentNo = page.items.length ? Number(page.items[page.items.length - 1].id) : lastNo;
      soop = {
        ...soop,
        totalCount: Math.max(soop.totalCount, page.totalCount),
        items: page.items,
        hasMore: page.hasMore && page.items.length > 0,
        nextPageNo: pageNo + 1,
        nextLastNo: Number.isSafeInteger(lastCommentNo) ? lastCommentNo : lastNo,
      };
    }
  }

  const fanpageEntries = Object.entries(fanpageSnapshot.val() || {})
    .map(([id, value]) => normalizeFanpageVodComment(value, id))
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const fanpageHasMore = fanpageEntries.length > FANPAGE_VOD_COMMENT_PAGE_SIZE;
  const fanpageComments = fanpageEntries.slice(-FANPAGE_VOD_COMMENT_PAGE_SIZE);
  const canDelete = isAdmin || !!(verified && verified.streamer.id === target.streamer.id);

  return {
    streamerId: target.streamer.id,
    vodId,
    profile,
    canDelete,
    soop,
    fanpage: {
      items: fanpageComments,
      hasMore: fanpageHasMore,
      countLabel: `${fanpageComments.length}${fanpageHasMore ? '+' : ''}`,
    },
  };
});

exports.streamerFanPageVodCommentAdd = onCall({ maxInstances: 20 }, async (request) => {
  const uid = await requireProtectedCommentProfileAuth(request);
  const data = request.data || {};
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const vodId = String(data.vodId || '').trim();
  const content = typeof data.content === 'string' ? data.content.trim() : '';
  if (!streamerId || !/^\d{1,20}$/.test(vodId) || !content || content.length > FANPAGE_VOD_COMMENT_MAX_LENGTH
    || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(content)) {
    throw new HttpsError('invalid-argument', `댓글은 비어 있지 않게 ${FANPAGE_VOD_COMMENT_MAX_LENGTH}자 이하로 입력해 주세요.`);
  }
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  const [vodInfo, profile] = await Promise.all([
    fetchSoopVodInfoForComments(vodId),
    resolveFanpageCommentProfile(uid),
  ]);
  const relatedVod = !!(vodInfo && typeof vodInfo.bj_id === 'string'
    && vodInfo.bj_id.toLowerCase() === target.streamer.soopId.toLowerCase());
  const cachedVod = !vodInfo && await isFanpageVodInCache(target.streamer.id, vodId);
  if ((vodInfo && !relatedVod) || (!vodInfo && !cachedVod)) {
    throw new HttpsError('not-found', '이 VOD는 해당 스트리머의 다시보기가 아닙니다.');
  }
  if (!profile) {
    throw new HttpsError('failed-precondition', '댓글을 쓰려면 먼저 댓글 프로필을 저장해 주세요.');
  }

  const createdAt = Date.now();
  const id = `${String(createdAt).padStart(13, '0')}_${randomUUID()}`;
  const comment = {
    uid,
    nickname: profile.nickname,
    soopId: profile.soopId,
    avatarUrl: profile.avatarUrl,
    content,
    createdAt,
  };
  await fanPageVodCommentsRef(target.streamer.id, vodId).child(id).set(comment);
  return { comment: { id, ...comment } };
});

exports.streamerFanPageVodCommentDelete = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const vodId = String(data.vodId || '').trim();
  const commentId = typeof data.commentId === 'string' ? data.commentId.trim() : '';
  if (!streamerId || !/^\d{1,20}$/.test(vodId)
    || !/^(?:\d{13}_)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commentId)) {
    throw new HttpsError('invalid-argument', '삭제할 댓글 정보를 확인해 주세요.');
  }
  const [target, verified, isAdmin] = await Promise.all([
    findVerifiedBySoopId(streamerId),
    findVerifiedByUid(uid),
    isAdminUid(uid),
  ]);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  if (!isAdmin && (!verified || verified.streamer.id !== target.streamer.id)) {
    throw new HttpsError('permission-denied', '관리자와 해당 팬페이지의 인증 스트리머만 댓글을 삭제할 수 있습니다.');
  }
  const commentRef = fanPageVodCommentsRef(target.streamer.id, vodId).child(commentId);
  const commentSnapshot = await commentRef.get();
  if (!commentSnapshot.exists()) throw new HttpsError('not-found', '팬페이지 댓글을 찾을 수 없습니다.');
  await commentRef.remove();
  return { deleted: true, commentId };
});

exports.streamerFanPageLiveStatus = onCall({ maxInstances: 20 }, async (request) => {
  requireAuth(request);
  const streamerId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  return await fetchSoopLiveStatus(target.streamer.soopId);
});

exports.streamerFanPageGallery = onCall({ maxInstances: 20 }, async (request) => {
  requireAuth(request);
  const streamerId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  return await readStreamerGallery(target);
});

exports.streamerFanPageCalendar = onCall({ maxInstances: 20 }, async (request) => {
  requireAuth(request);
  const data = request.data || {};
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const view = data.view === 'week' ? 'week' : data.view === 'month' ? 'month' : '';
  const year = Number(data.year);
  const month = Number(data.month);
  const requestedDay = Number(data.day);
  const currentYear = new Date().getUTCFullYear();
  if (!streamerId || !view || !Number.isInteger(year) || year < currentYear - 2 || year > currentYear + 2
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) {
    throw new HttpsError('invalid-argument', '캘린더 요청을 확인해 주세요.');
  }
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');

  const calendarDate = new Date(Date.UTC(year, month - 1, requestedDay));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() + 1 !== month
    || calendarDate.getUTCDate() !== requestedDay || (view === 'week' && calendarDate.getUTCDay() !== 0)) {
    throw new HttpsError('invalid-argument', '캘린더 날짜를 확인해 주세요.');
  }
  const day = view === 'month' ? 1 : requestedDay;
  const cacheKey = view === 'month'
    ? `month-${year}-${String(month).padStart(2, '0')}`
    : `week-${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const cacheRef = calendarCacheRef(target.streamer.id, cacheKey);
  const cached = (await cacheRef.get()).val();
  const now = Date.now();
  const hasCachedDays = cached && Array.isArray(cached.days) && Number.isFinite(Number(cached.fetchedAt));
  const cacheAge = hasCachedDays ? Math.max(0, now - Number(cached.fetchedAt)) : Infinity;
  const forceRefreshCoolingDown = data.forceRefresh && cacheAge < CALENDAR_CACHE_FORCE_REFRESH_COOLDOWN_MS;
  let soopDays = null;
  let fetchedAt = null;
  let stale = false;
  if (hasCachedDays && cacheAge < CALENDAR_CACHE_TTL_MS && (!data.forceRefresh || forceRefreshCoolingDown)) {
    soopDays = cached.days;
    fetchedAt = Number(cached.fetchedAt);
  } else {
    try {
      soopDays = await fetchSoopCalendar(target.streamer.soopId, view, year, month, day);
      fetchedAt = Date.now();
      try {
        await saveCalendarCache(target.streamer.id, cacheKey, soopDays, fetchedAt);
      } catch (cacheError) {
        console.warn(`Could not cache SOOP calendar for ${target.streamer.id}:`, cacheError);
      }
    } catch (error) {
      if (!hasCachedDays) throw error;
      console.warn(`Serving stale SOOP calendar cache for ${target.streamer.id}:`, error);
      soopDays = cached.days;
      fetchedAt = Number(cached.fetchedAt);
      stale = true;
    }
  }
  const visibleRange = calendarVisibleRange(view, year, month, day);
  const fanPageEvents = await readFanPageSchedules(target.streamer.id, visibleRange.startDate, visibleRange.endDate);
  return {
    view,
    year,
    month,
    day,
    days: mergeCalendarDays(soopDays || [], fanPageEvents, visibleRange.startDate, visibleRange.endDate),
    fetchedAt,
    stale,
  };
});

exports.streamerFanPageScheduleAdd = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
  const data = request.data || {};
  let target;
  if (isAdmin) {
    const streamerId = String(data.streamerId || '').trim().toLowerCase();
    if (!streamerId) throw new HttpsError('invalid-argument', '일정을 추가할 팬페이지를 지정해 주세요.');
    target = await findVerifiedBySoopId(streamerId);
  } else {
    if (!verified) throw new HttpsError('permission-denied', '인증 스트리머만 팬페이지 일정을 추가할 수 있습니다.');
    const requestedId = String(data.streamerId || '').trim().toLowerCase();
    if (requestedId && requestedId !== verified.streamer.id) {
      throw new HttpsError('permission-denied', '본인 팬페이지에만 일정을 추가할 수 있습니다.');
    }
    target = verified;
  }
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');

  const date = typeof data.date === 'string' ? data.date : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const time = typeof data.time === 'string' ? data.time.trim() : '';
  const typeName = typeof data.typeName === 'string' ? data.typeName.trim() : '';
  const dateYear = Number(date.slice(0, 4));
  const currentYear = new Date().getUTCFullYear();
  if (!isValidCalendarDate(date) || dateYear < currentYear - 2 || dateYear > currentYear + 2
    || (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    || !title || title.length > 200 || !FANPAGE_SCHEDULE_TYPES.has(typeName)) {
    throw new HttpsError('invalid-argument', '날짜, 시간, 일정 이름을 확인해 주세요.');
  }

  const schedulesRef = fanPageSchedulesRef(target.streamer.id);
  const id = randomUUID();
  const event = { date, time, title, typeName, createdAt: Date.now() };
  const result = await schedulesRef.transaction((current) => {
    const schedules = current && typeof current === 'object' ? current : {};
    if (Object.keys(schedules).length >= FANPAGE_SCHEDULE_MAX_ITEMS) return;
    return { ...schedules, [id]: event };
  });
  if (!result.committed) {
    throw new HttpsError('resource-exhausted', `팬페이지 일정은 최대 ${FANPAGE_SCHEDULE_MAX_ITEMS}개까지 등록할 수 있습니다.`);
  }
  return { event: { id, ...event, source: 'fanpage', type: 0 } };
});

exports.streamerFanPageScheduleDelete = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
  const data = request.data || {};
  const requestedId = String(data.streamerId || '').trim().toLowerCase();
  const eventId = typeof data.eventId === 'string' ? data.eventId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    throw new HttpsError('invalid-argument', '삭제할 일정을 확인해 주세요.');
  }

  let target;
  if (isAdmin) {
    if (!requestedId) throw new HttpsError('invalid-argument', '일정을 삭제할 팬페이지를 지정해 주세요.');
    target = await findVerifiedBySoopId(requestedId);
  } else {
    if (!verified) throw new HttpsError('permission-denied', '인증 스트리머만 팬페이지 일정을 삭제할 수 있습니다.');
    if (requestedId !== verified.streamer.id) {
      throw new HttpsError('permission-denied', '본인 팬페이지의 일정만 삭제할 수 있습니다.');
    }
    target = verified;
  }
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');

  const result = await fanPageSchedulesRef(target.streamer.id).child(eventId)
    .transaction((current) => current ? null : undefined);
  if (!result.committed) throw new HttpsError('not-found', '팬페이지 일정을 찾을 수 없습니다.');
  return { deleted: true, eventId };
});

exports.streamerFanPageSearch = onCall({ maxInstances: 20 }, async (request) => {
  requireAuth(request);
  const query = String((request.data && request.data.query) || '').trim().toLocaleLowerCase();
  if (query.length > 40) throw new HttpsError('invalid-argument', '검색어가 너무 깁니다.');
  if (query.length < 1) return { streamers: [] };
  const snap = await db.ref('streamerVerifications').get();
  const byId = new Map();
  Object.entries(snap.val() || {}).forEach(([key, record]) => {
    const streamer = publicStreamer(key, record);
    if (!streamer) return;
    if (streamer.nickname.toLocaleLowerCase().includes(query) || streamer.soopId.toLocaleLowerCase().includes(query)) {
      byId.set(streamer.id, streamer);
    }
  });
  const streamers = [...byId.values()]
    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'))
    .slice(0, 30);
  return { streamers };
});

exports.streamerFanPageRecent = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const snap = await db.ref(`streamerFanPageRecentVisits/${uid}`).get();
  const visits = Object.entries(snap.val() || {})
    .map(([streamerId, value]) => ({ streamerId, visitedAt: Number(value && value.visitedAt) || 0 }))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, RECENT_PAGE_LIMIT);
  const streamers = await Promise.all(visits.map(async (visit) => {
    const record = await findVerifiedBySoopId(visit.streamerId);
    return record ? { ...record.streamer, visitedAt: visit.visitedAt } : null;
  }));
  return { streamers: streamers.filter(Boolean) };
});

exports.streamerFanPageAdminStats = onCall({ maxInstances: 10 }, async (request) => {
  const uid = requireAuth(request);
  if (!await isAdminUid(uid)) {
    throw new HttpsError('permission-denied', '관리자만 팬페이지 통계를 볼 수 있습니다.');
  }

  const [verifiedSnap, statsSnap] = await Promise.all([
    db.ref('streamerVerifications').get(),
    db.ref('streamerFanPageStats').get(),
  ]);
  const verifiedById = new Map();
  Object.entries(verifiedSnap.val() || {}).forEach(([key, record]) => {
    const streamer = publicStreamer(key, record);
    if (streamer) verifiedById.set(streamer.id, streamer);
  });

  const today = new Date(`${fanPageStatsDateKey()}T00:00:00Z`);
  const dateKeys = Array.from({ length: FANPAGE_STATS_DAYS }, (_, index) =>
    fanPageStatsDateKey(today.getTime() - (FANPAGE_STATS_DAYS - index - 1) * 24 * 60 * 60 * 1000));
  const statsById = statsSnap.val() || {};
  const streamers = [...verifiedById.values()].map((streamer) => {
    const record = statsById[streamer.id] && typeof statsById[streamer.id] === 'object'
      ? statsById[streamer.id]
      : {};
    const dailyRecords = record.daily && typeof record.daily === 'object' ? record.daily : {};
    const daily = dateKeys.map((date) => {
      const day = dailyRecords[date] && typeof dailyRecords[date] === 'object' ? dailyRecords[date] : {};
      return {
        date,
        views: metricCount(day.views),
        uniqueVisitors: metricCount(day.uniqueVisitors),
      };
    });
    const last7 = daily.slice(-7);
    return {
      ...streamer,
      totalViews: metricCount(record.summary && record.summary.totalViews),
      last7Views: last7.reduce((total, day) => total + day.views, 0),
      last30Views: daily.reduce((total, day) => total + day.views, 0),
      last30DailyUniqueVisitors: daily.reduce((total, day) => total + day.uniqueVisitors, 0),
      daily,
    };
  }).sort((a, b) => b.last30Views - a.last30Views
    || b.totalViews - a.totalViews
    || a.nickname.localeCompare(b.nickname, 'ko'));

  return {
    generatedAt: Date.now(),
    totals: {
      streamerCount: streamers.length,
      totalViews: streamers.reduce((total, streamer) => total + streamer.totalViews, 0),
      last7Views: streamers.reduce((total, streamer) => total + streamer.last7Views, 0),
      last30Views: streamers.reduce((total, streamer) => total + streamer.last30Views, 0),
    },
    streamers,
  };
});

exports.streamerFanPageUpbo = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const action = typeof data.action === 'string' ? data.action : 'listTopics';
  const streamerId = String(data.streamerId || '').trim().toLowerCase();
  const target = await findVerifiedBySoopId(streamerId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
  const canManage = isAdmin || !!(verified && verified.streamer.id === target.streamer.id);
  const rootRef = upboRootRef(target.streamer.id);
  const topicsRef = rootRef.child('topics');

  if (action === 'listTopics') {
    const snapshot = await topicsRef.get();
    const topics = Object.entries(snapshot.val() || {})
      .map(([id, value]) => normalizeStoredUpboTopic(id, value))
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt || a.title.localeCompare(b.title, 'ko'))
      .slice(0, FANPAGE_UPBO_MAX_TOPICS)
      .map((topic) => ({ ...topic, viewerCount: metricCount((snapshot.val() || {})[topic.id]?.viewerCount) }));
    return { topics, canManage };
  }

  const topicId = String(data.topicId || '').trim();
  if (!validUpboId(topicId)) throw new HttpsError('invalid-argument', '업보 주제를 확인해 주세요.');
  const topicRef = topicsRef.child(topicId);
  const topicSnapshot = await topicRef.get();

  if (action === 'loadTopic') {
    if (!topicSnapshot.exists()) throw new HttpsError('not-found', '업보 주제를 찾을 수 없습니다.');
    const topic = normalizeStoredUpboTopic(topicId, topicSnapshot.val());
    if (!topic) throw new HttpsError('failed-precondition', '업보 주제 데이터를 읽을 수 없습니다.');
    const viewersRef = rootRef.child('viewers').child(topicId);
    const cursor = typeof data.cursor === 'string' && validUpboId(data.cursor) ? data.cursor : '';
    let query = viewersRef.orderByKey();
    if (cursor) query = query.startAt(cursor);
    const viewerSnapshot = await query.limitToFirst(FANPAGE_UPBO_VIEWER_PAGE_SIZE + 1 + (cursor ? 1 : 0)).get();
    const viewers = [];
    viewerSnapshot.forEach((child) => {
      if (cursor && child.key <= cursor) return false;
      const viewer = normalizeStoredUpboViewer(child.key, child.val());
      if (viewer) viewers.push(viewer);
      return viewers.length >= FANPAGE_UPBO_VIEWER_PAGE_SIZE + 1;
    });
    const hasMore = viewers.length > FANPAGE_UPBO_VIEWER_PAGE_SIZE;
    const pageViewers = viewers.slice(0, FANPAGE_UPBO_VIEWER_PAGE_SIZE);
    return {
      topic,
      viewers: pageViewers,
      hasMore,
      nextCursor: hasMore && pageViewers.length ? pageViewers[pageViewers.length - 1].id : '',
      viewerCount: metricCount(topicSnapshot.val().viewerCount),
      canManage,
    };
  }

  if (!canManage) throw new HttpsError('permission-denied', '업보 정리는 해당 스트리머와 관리자만 수정할 수 있습니다.');

  if (action === 'saveTopic') {
    const existing = topicSnapshot.val() || {};
    if (!topicSnapshot.exists() && Object.keys((await topicsRef.get()).val() || {}).length >= FANPAGE_UPBO_MAX_TOPICS) {
      throw new HttpsError('resource-exhausted', `업보 주제는 ${FANPAGE_UPBO_MAX_TOPICS}개까지 만들 수 있습니다.`);
    }
    const topic = validateUpboTopic(data.topic, existing);
    if (topic.id !== topicId) throw new HttpsError('invalid-argument', '주제 ID가 요청과 일치하지 않습니다.');
    await topicRef.update({
      id: topic.id,
      title: topic.title,
      description: topic.description,
      promises: topic.promises,
      rewardTiers: topic.rewardTiers,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
    });
    return { topic, canManage };
  }

  if (action === 'deleteTopic') {
    if (!topicSnapshot.exists()) throw new HttpsError('not-found', '삭제할 업보 주제를 찾을 수 없습니다.');
    await rootRef.update({
      [`topics/${topicId}`]: null,
      [`viewers/${topicId}`]: null,
    });
    return { deleted: true, canManage };
  }

  if (action === 'saveViewer') {
    if (!topicSnapshot.exists()) throw new HttpsError('not-found', '업보 주제를 찾을 수 없습니다.');
    const input = data.viewer;
    const viewerId = input && typeof input.id === 'string' && input.id ? input.id : '';
    const viewersRef = rootRef.child('viewers').child(topicId);
    const viewerRef = viewerId ? viewersRef.child(viewerId) : null;
    const existingViewer = viewerRef ? (await viewerRef.get()).val() : null;
    if (viewerId && (!validUpboId(viewerId) || !existingViewer)) {
      throw new HttpsError('not-found', '수정할 시청자 기록을 찾을 수 없습니다.');
    }
    const viewer = validateUpboViewer(input, existingViewer);
    if (viewerId && viewer.id !== viewerId) throw new HttpsError('invalid-argument', '시청자 기록 ID가 요청과 일치하지 않습니다.');
    let savedId = viewerId;
    if (!savedId) {
      const countRef = topicRef.child('viewerCount');
      const countTransaction = await countRef.transaction((current) => {
        const count = metricCount(current);
        return count >= FANPAGE_UPBO_MAX_VIEWER_COUNT ? undefined : count + 1;
      });
      if (!countTransaction.committed) {
        throw new HttpsError('resource-exhausted', `주제별 시청자는 ${FANPAGE_UPBO_MAX_VIEWER_COUNT.toLocaleString('ko-KR')}명까지 등록할 수 있습니다.`);
      }
      const reverseTime = String(Number.MAX_SAFE_INTEGER - Date.now()).padStart(16, '0');
      savedId = `${reverseTime}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    }
    const savedViewer = { ...viewer, id: savedId };
    delete savedViewer.id;
    try {
      await viewersRef.child(savedId).set(savedViewer);
    } catch (error) {
      if (!viewerId) await topicRef.child('viewerCount').transaction((current) => Math.max(0, metricCount(current) - 1));
      throw error;
    }
    const viewerCount = metricCount((await topicRef.child('viewerCount').get()).val());
    return { viewer: { ...savedViewer, id: savedId }, viewerCount, canManage };
  }

  if (action === 'deleteViewer') {
    if (!topicSnapshot.exists()) throw new HttpsError('not-found', '업보 주제를 찾을 수 없습니다.');
    const viewerId = String(data.viewerId || '').trim();
    if (!validUpboId(viewerId)) throw new HttpsError('invalid-argument', '시청자 기록을 확인해 주세요.');
    const viewerRef = rootRef.child('viewers').child(topicId).child(viewerId);
    const deletion = await viewerRef.transaction((current) => current ? null : undefined);
    if (!deletion.committed) throw new HttpsError('not-found', '삭제할 시청자 기록을 찾을 수 없습니다.');
    await topicRef.child('viewerCount').transaction((current) => Math.max(0, metricCount(current) - 1));
    return { deleted: true, canManage };
  }

  throw new HttpsError('invalid-argument', '업보 정리 요청을 확인해 주세요.');
});

exports.streamerFanPageSave = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
  const data = request.data || {};
  let targetStreamer;
  if (isAdmin) {
    const targetId = String(data.streamerId || '').trim().toLowerCase();
    if (!targetId) throw new HttpsError('invalid-argument', '수정할 팬페이지를 지정해 주세요.');
    targetStreamer = await findVerifiedBySoopId(targetId);
    if (!targetStreamer) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  } else {
    if (!verified) throw new HttpsError('permission-denied', '인증 스트리머 또는 관리자만 팬페이지를 수정할 수 있습니다.');
    targetStreamer = verified;
  }
  const updates = { updatedAt: Date.now() };
  let clearYouTubeCache = false;
  let clearCafeCache = false;
  let clearRouletteCache = false;
  if (Object.prototype.hasOwnProperty.call(data, 'intro')) {
    if (typeof data.intro !== 'string' || data.intro.length > MAX_INTRO_LENGTH) {
      throw new HttpsError('invalid-argument', `소개는 ${MAX_INTRO_LENGTH}자 이내로 입력해 주세요.`);
    }
    updates.intro = data.intro.trim();
  }
  if (Object.prototype.hasOwnProperty.call(data, 'profile')) {
    const profile = data.profile;
    const stringFields = ['birthday', 'mbti', 'major', 'debutDate', 'fanNickname', 'fandomName', 'scheduleText', 'rouletteUrl'];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)
      || stringFields.some((field) => typeof profile[field] !== 'string')
      || (Object.prototype.hasOwnProperty.call(profile, 'youtubeChannelUrl') && typeof profile.youtubeChannelUrl !== 'string')
      || (Object.prototype.hasOwnProperty.call(profile, 'cafeUrl') && typeof profile.cafeUrl !== 'string')
      || (Object.prototype.hasOwnProperty.call(profile, 'ogqEmoticonUrl') && typeof profile.ogqEmoticonUrl !== 'string')
      || !Array.isArray(profile.contents)
      || profile.contents.length > 8
      || stringFields.some((field) => profile[field].length > ({ birthday: 20, mbti: 8, major: 50, debutDate: 20, fanNickname: 30, fandomName: 30, scheduleText: 120, rouletteUrl: 300 })[field])
      || (typeof profile.youtubeChannelUrl === 'string' && profile.youtubeChannelUrl.length > 300)
      || (typeof profile.cafeUrl === 'string' && profile.cafeUrl.length > 300)
      || (typeof profile.ogqEmoticonUrl === 'string' && profile.ogqEmoticonUrl.length > 300)
      || profile.contents.some((item) => typeof item !== 'string' || item.length > 20)) {
      throw new HttpsError('invalid-argument', '프로필 항목을 확인해 주세요.');
    }
    const hasYouTubeUrl = Object.prototype.hasOwnProperty.call(profile, 'youtubeChannelUrl');
    const previousProfile = (await pageRef(targetStreamer.streamer.id).child('profile').get()).val() || {};
    const previousRouletteUrl = parseWeFlabRouletteUrl(previousProfile.rouletteUrl) || '';
    let rouletteUrl = profile.rouletteUrl.trim();
    if (rouletteUrl) {
      try {
        const parsed = new URL(rouletteUrl);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) throw new Error('invalid url');
        rouletteUrl = parsed.href;
      } catch (_) {
        throw new HttpsError('invalid-argument', '룰렛 링크는 https 주소로 입력해 주세요.');
      }
    }
    const youtubeChannelUrlInput = hasYouTubeUrl
      ? profile.youtubeChannelUrl.trim()
      : String(previousProfile.youtubeChannelUrl || '').trim();
    const youtubeChannel = youtubeChannelUrlInput ? parseYouTubeChannelUrl(youtubeChannelUrlInput) : null;
    if (youtubeChannelUrlInput && !youtubeChannel) {
      throw new HttpsError('invalid-argument', 'YouTube 채널 링크는 @핸들이나 채널 ID 주소로 입력해 주세요.');
    }
    const cafeUrlInput = Object.prototype.hasOwnProperty.call(profile, 'cafeUrl')
      ? profile.cafeUrl.trim()
      : String(previousProfile.cafeUrl || '').trim();
    const cafe = cafeUrlInput ? parseNaverCafeUrl(cafeUrlInput) : null;
    if (cafeUrlInput && !cafe) {
      throw new HttpsError('invalid-argument', '네이버 카페 링크는 카페 홈 또는 전체글보기 주소로 입력해 주세요.');
    }
    const ogqUrlInput = Object.prototype.hasOwnProperty.call(profile, 'ogqEmoticonUrl')
      ? profile.ogqEmoticonUrl.trim()
      : String(previousProfile.ogqEmoticonUrl || '').trim();
    const ogqEmoticon = ogqUrlInput ? parseOgqEmoticonUrl(ogqUrlInput) : null;
    if (ogqUrlInput && !ogqEmoticon) {
      throw new HttpsError('invalid-argument', 'SOOP OGQ 이모티콘 상품 주소를 입력해 주세요.');
    }
    const previousCafeUrl = parseNaverCafeUrl(previousProfile.cafeUrl)?.url || '';
    clearRouletteCache = previousRouletteUrl !== (parseWeFlabRouletteUrl(rouletteUrl) || '');
    updates.profile = {
      birthday: profile.birthday.trim(),
      mbti: profile.mbti.trim().toUpperCase(),
      major: profile.major.trim(),
      debutDate: profile.debutDate.trim(),
      fanNickname: profile.fanNickname.trim(),
      fandomName: profile.fandomName.trim(),
      contents: profile.contents.map((item) => item.trim()).filter(Boolean),
      scheduleText: profile.scheduleText.trim(),
      rouletteUrl,
      youtubeChannelUrl: youtubeChannel ? youtubeChannel.url : '',
      cafeUrl: cafe ? cafe.url : '',
      ogqEmoticonUrl: ogqEmoticon ? ogqEmoticon.url : '',
    };
    clearYouTubeCache = hasYouTubeUrl;
    clearCafeCache = Object.prototype.hasOwnProperty.call(profile, 'cafeUrl') && previousCafeUrl !== (cafe ? cafe.url : '');
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'intro') && !Object.prototype.hasOwnProperty.call(data, 'profile')) {
    throw new HttpsError('invalid-argument', '저장할 내용을 입력해 주세요.');
  }
  await pageRef(targetStreamer.streamer.id).update(updates);
  if (clearYouTubeCache) {
    await youtubeCacheRef(targetStreamer.streamer.id).remove();
  }
  if (clearCafeCache) {
    await cafeCacheRef(targetStreamer.streamer.id).remove();
  }
  if (clearRouletteCache) {
    await weflabRouletteCacheRef(targetStreamer.streamer.id).remove();
  }
  const saved = await pageRef(targetStreamer.streamer.id).get();
  return { page: normalizePage(targetStreamer.streamer, saved.val()) };
});

exports.streamerFanPageVodRefresh = onCall({ maxInstances: 10, timeoutSeconds: 3600, memory: '1GiB' }, async (request) => {
  const uid = requireAuth(request);
  const [verified, isAdmin] = await Promise.all([findVerifiedByUid(uid), isAdminUid(uid)]);
  let targetStreamer;
  if (isAdmin) {
    const targetId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
    if (!targetId) throw new HttpsError('invalid-argument', '갱신할 팬페이지를 지정해 주세요.');
    targetStreamer = await findVerifiedBySoopId(targetId);
    if (!targetStreamer) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  } else {
    if (!verified) throw new HttpsError('permission-denied', '인증 스트리머 또는 관리자만 다시보기 목록을 갱신할 수 있습니다.');
    targetStreamer = verified;
  }

  const lock = await acquireVodRefreshLock(targetStreamer.streamer.id);
  if (!lock.acquired) {
    return { inProgress: true, retryAfterMs: lock.retryAfterMs };
  }
  const { token, lockRef } = lock;
  try {
    try {
      const vods = await stageAndPublishSoopVods(
        targetStreamer.streamer.soopId,
        targetStreamer.streamer.id,
        token,
        lockRef,
      );
      return { vods };
    } catch (error) {
      if (error instanceof HttpsError && error.details && error.details.reason === 'vod-refresh-in-progress') {
        return { inProgress: true, retryAfterMs: error.details.retryAfterMs };
      }
      throw error;
    }
  } finally {
    await lockRef.transaction((current) => (current && current.token === token ? null : undefined)).catch((error) => {
      console.warn('Could not release the SOOP VOD refresh lock:', error);
    });
  }
});
