'use strict';

const VIEWER_STATS_WORKER_FUNCTION = 'streamerFanPageViewerStatsWorker';
const VIEWER_STATS_QUEUE_PATH = 'streamerFanPageViewerStatsQueue';
const VIEWER_STATS_QUEUE_MAX_CONCURRENT = 16;
const VIEWER_STATS_QUEUE_MAX_PER_SECOND = 16;
const VIEWER_STATS_QUEUE_MAX_INSTANCES = 16;
const VIEWER_STATS_PRIORITY_AGE_STEP_MS = 60 * 1000;
const VIEWER_STATS_TIER_PRIORITY = Object.freeze({
  anonymous: 0,
  account: 1,
  subscriber: 2,
  admin: 3,
});

const VIEWER_STATS_RATE_LIMITS = Object.freeze({
  anonymous: Object.freeze({
    search: Object.freeze({ perMinute: 5, perDay: 40 }),
    vods: Object.freeze({ perMinute: 12, perDay: 80 }),
    stats: Object.freeze({ perMinute: 120, perDay: 600 }),
  }),
  account: Object.freeze({
    search: Object.freeze({ perMinute: 10, perDay: 100 }),
    vods: Object.freeze({ perMinute: 30, perDay: 200 }),
    stats: Object.freeze({ perMinute: 300, perDay: 1500 }),
  }),
  subscriber: Object.freeze({
    search: Object.freeze({ perMinute: 20, perDay: 200 }),
    vods: Object.freeze({ perMinute: 60, perDay: 500 }),
    stats: Object.freeze({ perMinute: 600, perDay: 3000 }),
  }),
  admin: Object.freeze({}),
});

function viewerStatsTier(auth, access = {}) {
  if (access.isAdmin === true) return 'admin';
  if (access.isSubscribed === true) return 'subscriber';
  if (access.isProtectedAccount === true) return 'account';
  const signInProvider = auth && auth.token && auth.token.firebase
    ? String(auth.token.firebase.sign_in_provider || '')
    : '';
  return signInProvider === 'anonymous' ? 'anonymous' : 'account';
}

function viewerStatsRateLimit(tier, action) {
  const limits = VIEWER_STATS_RATE_LIMITS[tier] || VIEWER_STATS_RATE_LIMITS.account;
  return limits[action] || null;
}

function viewerStatsPriorityScore(tier, createdAt, now = Date.now()) {
  const base = Number(VIEWER_STATS_TIER_PRIORITY[tier]);
  const basePriority = Number.isFinite(base) ? base : VIEWER_STATS_TIER_PRIORITY.anonymous;
  const waited = Math.max(0, Number(now) - (Number(createdAt) || Number(now)));
  const agedPriority = basePriority + Math.floor(waited / VIEWER_STATS_PRIORITY_AGE_STEP_MS);
  return Math.min(VIEWER_STATS_TIER_PRIORITY.admin, agedPriority);
}

function selectNextViewerStatsCandidate(candidates, now = Date.now()) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .filter((candidate) => candidate && Number.isFinite(Number(candidate.createdAt)))
    .sort((a, b) => viewerStatsPriorityScore(b.tier, b.createdAt, now)
      - viewerStatsPriorityScore(a.tier, a.createdAt, now)
      || Number(a.createdAt) - Number(b.createdAt))[0] || null;
}

module.exports = {
  VIEWER_STATS_PRIORITY_AGE_STEP_MS,
  VIEWER_STATS_QUEUE_MAX_CONCURRENT,
  VIEWER_STATS_QUEUE_MAX_INSTANCES,
  VIEWER_STATS_QUEUE_MAX_PER_SECOND,
  VIEWER_STATS_QUEUE_PATH,
  VIEWER_STATS_TIER_PRIORITY,
  VIEWER_STATS_WORKER_FUNCTION,
  selectNextViewerStatsCandidate,
  viewerStatsPriorityScore,
  viewerStatsRateLimit,
  viewerStatsTier,
};
