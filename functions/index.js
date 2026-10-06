'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
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
const SOOP_CALENDAR_API = 'https://api-channel.sooplive.com/v1.1/channel';
const CALENDAR_CACHE_TTL_MS = 10 * 60 * 1000;
const CALENDAR_CACHE_FORCE_REFRESH_COOLDOWN_MS = 60 * 1000;
const CALENDAR_CACHE_MAX_RANGES = 24;
const CALENDAR_MAX_EVENTS_PER_DAY = 30;
const FANPAGE_SCHEDULE_MAX_ITEMS = 500;
const FANPAGE_SCHEDULE_TYPES = new Set(['방송', '방송예정', '합방', '휴방', '기타']);

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
      || !Array.isArray(profile.contents)
      || profile.contents.length > 8
      || stringFields.some((field) => profile[field].length > ({ birthday: 20, mbti: 8, major: 50, debutDate: 20, fanNickname: 30, fandomName: 30, scheduleText: 120, rouletteUrl: 300 })[field])
      || profile.contents.some((item) => typeof item !== 'string' || item.length > 20)) {
      throw new HttpsError('invalid-argument', '프로필 항목을 확인해 주세요.');
    }
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
    };
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'intro') && !Object.prototype.hasOwnProperty.call(data, 'profile')) {
    throw new HttpsError('invalid-argument', '저장할 내용을 입력해 주세요.');
  }
  await pageRef(targetStreamer.streamer.id).update(updates);
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
