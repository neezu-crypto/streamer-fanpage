'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { randomUUID } = require('node:crypto');

initializeApp();
const db = getDatabase();
const MAX_INTRO_LENGTH = 700;
const RECENT_PAGE_LIMIT = 8;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const SOOP_VOD_PAGE_SIZE = 60;
const FANPAGE_VOD_PAGE_SIZE = 24;
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

function requireAuth(request) {
  if (!request.auth || typeof request.auth.uid !== 'string') {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
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

function pageRef(streamerId) {
  return db.ref(`streamerFanPages/${streamerId}`);
}

function normalizeStreamerName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
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
    const [metadataSnap, itemsSnap] = await Promise.all([
      generationRef.child('metadata').get(),
      generationRef.child('items').orderByKey().startAt(vodItemKey(offset)).limitToFirst(FANPAGE_VOD_PAGE_SIZE).get(),
    ]);
    const metadata = metadataSnap.val() || {};
    const items = [];
    itemsSnap.forEach((child) => {
      const vod = normalizeSoopVod(child.val());
      if (vod) items.push(vod);
    });
    const total = Math.max(0, Math.floor(Number(metadata.total) || 0));
    return {
      items,
      total,
      refreshedAt: Number.isFinite(metadata.refreshedAt) ? metadata.refreshedAt : null,
      generation,
      offset,
      nextOffset: offset + items.length,
      hasMore: offset + items.length < total,
    };
  }

  if (requestedGeneration && requestedGeneration !== 'legacy') {
    throw new HttpsError('aborted', '다시보기 목록이 갱신됐습니다. 페이지를 새로 불러와 주세요.');
  }
  // 최초 세대 전환 전까지 기존 캐시 형식도 읽어 점진적으로 호환한다.
  const cache = normalizeVodCache((await listRef.get()).val());
  const items = cache.items.slice(offset, offset + FANPAGE_VOD_PAGE_SIZE);
  return {
    ...cache,
    items,
    generation: 'legacy',
    offset,
    nextOffset: offset + items.length,
    hasMore: offset + items.length < cache.total,
  };
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
  if (rows.length !== expectedRows) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 전체 목록을 가져오지 못해 기존 목록을 유지했습니다.');
  }
  const vods = rows.map((row) => normalizeSoopVod(row));
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
    const pageCount = Math.ceil(first.total / SOOP_VOD_PAGE_SIZE);
    const seenIds = new Set();
    const firstVods = normalizeFetchedVodPage(first.rows, first.total, 1, seenIds);
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
        const vods = normalizeFetchedVodPage(result.rows, first.total, page, seenIds);
        if (vods.length) {
          const startIndex = (page - 1) * SOOP_VOD_PAGE_SIZE;
          await generationRef.child('items').update(Object.fromEntries(
            vods.map((vod, itemIndex) => [vodItemKey(startIndex + itemIndex), vod]),
          ));
        }
      }
    }

    if (seenIds.size !== first.total) {
      throw new HttpsError('unavailable', 'SOOP 다시보기 전체 목록을 가져오지 못해 기존 목록을 유지했습니다.');
    }
    const refreshedAt = Date.now();
    await generationRef.child('metadata').set({ total: first.total, refreshedAt });
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
  const items = Array.isArray(cache.items) ? cache.items.map(normalizeYouTubeVideo).filter(Boolean).slice(0, YOUTUBE_VIDEO_PAGE_SIZE) : [];
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
    maxResults: YOUTUBE_VIDEO_PAGE_SIZE,
  }, apiKey);
  const items = Array.isArray(uploads.items) ? uploads.items.map(normalizeYouTubeVideo).filter(Boolean) : [];
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
  };
  return {
    streamer,
    intro: typeof page.intro === 'string' ? page.intro.slice(0, MAX_INTRO_LENGTH) : '',
    profile,
    updatedAt: Number.isFinite(page.updatedAt) ? page.updatedAt : null,
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
  const [pageSnap, vods] = await Promise.all([
    pageRef(target.streamer.id).get(),
    readVodPage(target.streamer.id),
    recordRecentVisit(uid, target.streamer.id),
  ]);
  return {
    verifiedStreamer: verified ? verified.streamer : null,
    isAdmin,
    page: { ...normalizePage(target.streamer, pageSnap.val()), vods },
  };
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
      || !Array.isArray(profile.contents)
      || profile.contents.length > 8
      || stringFields.some((field) => profile[field].length > ({ birthday: 20, mbti: 8, major: 50, debutDate: 20, fanNickname: 30, fandomName: 30, scheduleText: 120, rouletteUrl: 300 })[field])
      || (typeof profile.youtubeChannelUrl === 'string' && profile.youtubeChannelUrl.length > 300)
      || profile.contents.some((item) => typeof item !== 'string' || item.length > 20)) {
      throw new HttpsError('invalid-argument', '프로필 항목을 확인해 주세요.');
    }
    const hasYouTubeUrl = Object.prototype.hasOwnProperty.call(profile, 'youtubeChannelUrl');
    const previousProfile = (await pageRef(targetStreamer.streamer.id).child('profile').get()).val() || {};
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
    };
    clearYouTubeCache = hasYouTubeUrl;
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'intro') && !Object.prototype.hasOwnProperty.call(data, 'profile')) {
    throw new HttpsError('invalid-argument', '저장할 내용을 입력해 주세요.');
  }
  await pageRef(targetStreamer.streamer.id).update(updates);
  if (clearYouTubeCache) {
    await youtubeCacheRef(targetStreamer.streamer.id).remove();
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
