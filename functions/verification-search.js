// 팬페이지 스트리머 인증 모달의 SOOP 검색 보조 로직. Firebase·네트워크에 의존하지 않는다.
'use strict';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 40;
const MAX_RESULTS = 8;
// 인증 신청 서버(requestStreamerVerification)의 닉네임 상한과 같다. 넘는 후보는 신청할 수 없어 목록에서 뺀다.
const MAX_APPLY_NICKNAME_LENGTH = 20;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_CALLS = 20;
const RATE_MAX_TRACKED_UIDS = 2000;

// 반환: 정규화된 검색어. 너무 짧으면 빈 문자열(호출부가 빈 결과로 응답), 너무 길면 null(호출부가 오류 처리).
function normalizeVerifySearchQuery(raw) {
  const query = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (query.length > MAX_QUERY_LENGTH) return null;
  if (query.length < MIN_QUERY_LENGTH) return '';
  return query;
}

// 인증 신청에 필요한 최소 정보만 내려준다. 즐겨찾기 수 등 부가 값은 제외한다.
function shapeVerifySearchResults(streamers, query) {
  const list = Array.isArray(streamers) ? streamers : [];
  const needle = String(query || '').toLocaleLowerCase();
  const rank = (item) => {
    const nick = item.nickname.toLocaleLowerCase();
    const id = item.soopId.toLocaleLowerCase();
    if (id === needle || nick === needle) return 0;
    if (nick.startsWith(needle)) return 1;
    if (id.startsWith(needle)) return 2;
    return 3;
  };
  const seen = new Set();
  return list
    .filter((item) => item && typeof item.nickname === 'string' && typeof item.soopId === 'string'
      && /^[a-z0-9]{2,20}$/i.test(item.soopId) && item.nickname.trim()
      && item.nickname.trim().length <= MAX_APPLY_NICKNAME_LENGTH)
    .map((item) => ({
      soopId: item.soopId,
      nickname: item.nickname.trim(),
      avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : '',
    }))
    .filter((item) => {
      const key = item.soopId.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_RESULTS);
}

// 인스턴스 메모리 기반 계정별 분당 한도. 저장소를 쓰지 않아 별도 보관·삭제 대상이 생기지 않는다.
function createVerifySearchLimiter({ windowMs = RATE_WINDOW_MS, maxCalls = RATE_MAX_CALLS, maxUids = RATE_MAX_TRACKED_UIDS } = {}) {
  const hits = new Map();
  return function allow(uid, now = Date.now()) {
    const key = String(uid || '');
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= maxCalls) {
      hits.set(key, recent);
      return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);
    while (hits.size > maxUids) hits.delete(hits.keys().next().value);
    return { ok: true, retryAfterMs: 0 };
  };
}

module.exports = {
  MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, MAX_RESULTS, RATE_MAX_CALLS,
  normalizeVerifySearchQuery, shapeVerifySearchResults, createVerifySearchLimiter,
};
