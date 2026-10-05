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
  const snap = await ref.orderByChild('visitedAt').get();
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

function normalizePage(streamer, value) {
  const page = value && typeof value === 'object' ? value : {};
  return {
    streamer,
    intro: typeof page.intro === 'string' ? page.intro.slice(0, MAX_INTRO_LENGTH) : '',
    updatedAt: Number.isFinite(page.updatedAt) ? page.updatedAt : null,
  };
}

exports.streamerFanPageBootstrap = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const verified = await findVerifiedByUid(uid);
  const requestedId = String((request.data && request.data.streamerId) || '').trim().toLowerCase();
  if (verified && requestedId !== verified.streamer.id) {
    return { verifiedStreamer: verified.streamer, redirectTo: verified.streamer.id };
  }
  if (!requestedId) return { verifiedStreamer: verified ? verified.streamer : null, page: null };

  const target = await findVerifiedBySoopId(requestedId);
  if (!target) throw new HttpsError('not-found', '인증된 스트리머 팬페이지를 찾을 수 없습니다.');
  const [pageSnap] = await Promise.all([
    pageRef(target.streamer.id).get(),
    recordRecentVisit(uid, target.streamer.id),
  ]);
  return {
    verifiedStreamer: verified ? verified.streamer : null,
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
  const snap = await db.ref(`streamerFanPageRecentVisits/${uid}`)
    .orderByChild('visitedAt').limitToLast(RECENT_PAGE_LIMIT).get();
  const visits = Object.entries(snap.val() || {})
    .map(([streamerId, value]) => ({ streamerId, visitedAt: Number(value && value.visitedAt) || 0 }))
    .sort((a, b) => b.visitedAt - a.visitedAt);
  const streamers = await Promise.all(visits.map(async (visit) => {
    const record = await findVerifiedBySoopId(visit.streamerId);
    return record ? { ...record.streamer, visitedAt: visit.visitedAt } : null;
  }));
  return { streamers: streamers.filter(Boolean) };
});

exports.streamerFanPageSave = onCall({ maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const verified = await findVerifiedByUid(uid);
  if (!verified) throw new HttpsError('permission-denied', '인증 스트리머만 팬페이지를 수정할 수 있습니다.');
  const intro = request.data && request.data.intro;
  if (typeof intro !== 'string' || intro.length > MAX_INTRO_LENGTH) {
    throw new HttpsError('invalid-argument', `소개는 ${MAX_INTRO_LENGTH}자 이내로 입력해 주세요.`);
  }
  const cleaned = intro.trim();
  await pageRef(verified.streamer.id).set({ intro: cleaned, updatedAt: Date.now() });
  return { page: normalizePage(verified.streamer, { intro: cleaned, updatedAt: Date.now() }) };
});
