'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();
const db = getDatabase();
const MAX_INTRO_LENGTH = 700;
const RECENT_PAGE_LIMIT = 8;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;

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
  const [pageSnap] = await Promise.all([
    pageRef(target.streamer.id).get(),
    recordRecentVisit(uid, target.streamer.id),
  ]);
  return {
    verifiedStreamer: verified ? verified.streamer : null,
    isAdmin,
    page: normalizePage(target.streamer, pageSnap.val()),
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
