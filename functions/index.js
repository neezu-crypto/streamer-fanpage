'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();
const db = getDatabase();
const MAX_INTRO_LENGTH = 700;
const RECENT_PAGE_LIMIT = 8;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const SOOP_VOD_PAGE_SIZE = 60;
const MAX_SOOP_VOD_PAGES = 100;
const SOOP_VOD_API = 'https://chapi.sooplive.com/api';

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

async function fetchAllSoopVods(soopId) {
  const first = await fetchSoopVodPage(soopId, 1);
  const pageCount = Math.ceil(first.total / SOOP_VOD_PAGE_SIZE);
  if (pageCount > MAX_SOOP_VOD_PAGES) {
    throw new HttpsError('resource-exhausted', '다시보기 목록이 너무 커서 한 번에 갱신할 수 없습니다.');
  }
  const rows = first.rows.slice();
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await fetchSoopVodPage(soopId, page);
    if (result.total !== first.total) {
      throw new HttpsError('aborted', '갱신 중 SOOP 목록이 변경됐습니다. 다시 시도해 주세요.');
    }
    rows.push(...result.rows);
  }
  if (rows.length !== first.total) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 전체 목록을 가져오지 못해 기존 목록을 유지했습니다.');
  }
  const byId = new Map();
  rows.forEach((row) => {
    const vod = normalizeSoopVod(row);
    if (vod) byId.set(vod.id, vod);
  });
  if (byId.size !== first.total) {
    throw new HttpsError('unavailable', 'SOOP 다시보기 항목 일부를 읽지 못해 기존 목록을 유지했습니다.');
  }
  return [...byId.values()].sort((a, b) => String(b.regDate).localeCompare(String(a.regDate)) || Number(b.id) - Number(a.id));
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
  const [pageSnap, vodSnap] = await Promise.all([
    pageRef(target.streamer.id).get(),
    vodListRef(target.streamer.id).get(),
    recordRecentVisit(uid, target.streamer.id),
  ]);
  return {
    verifiedStreamer: verified ? verified.streamer : null,
    isAdmin,
    page: { ...normalizePage(target.streamer, pageSnap.val()), vods: normalizeVodCache(vodSnap.val()) },
  };
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

exports.streamerFanPageVodRefresh = onCall({ maxInstances: 10, timeoutSeconds: 180, memory: '512MiB' }, async (request) => {
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

  const vods = await fetchAllSoopVods(targetStreamer.streamer.soopId);
  const refreshedAt = Date.now();
  const items = Object.fromEntries(vods.map((vod) => [vod.id, vod]));
  const cache = { items, total: vods.length, refreshedAt };
  await vodListRef(targetStreamer.streamer.id).set(cache);
  return { vods: normalizeVodCache(cache) };
});
