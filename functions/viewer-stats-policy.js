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

function viewerStatsWakeCandidate(jobId, job) {
  if (!job || job.status !== 'queued'
    || !['anonymous', 'account', 'subscriber', 'admin'].includes(job.tier)
    || !/^\d{13}_\d{8}_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(job.queueKey || ''))) {
    return null;
  }
  const createdAt = Number(job.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  return { jobId: String(jobId || ''), queueKey: job.queueKey, tier: job.tier, createdAt };
}

function viewerStatsClaimUpdate(current, fallback, taskId, now, leaseMs) {
  const job = current && typeof current === 'object' ? current : fallback;
  if (!job || typeof job !== 'object' || ['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) {
    return undefined;
  }
  if (Number(job.expiresAt) <= now) {
    return {
      ...job,
      status: 'expired',
      finishedAt: now,
      processingLeaseUntil: null,
      errorMessage: '집계 요청이 만료됐어요. 다시 요청해 주세요.',
    };
  }
  const leaseIsActive = job.status === 'processing' && Number(job.processingLeaseUntil) > now;
  if (leaseIsActive) return undefined;
  return {
    ...job,
    status: 'processing',
    startedAt: job.status === 'processing' ? Number(job.startedAt) || now : now,
    claimedBy: taskId,
    processingLeaseUntil: now + leaseMs,
    attemptCount: Math.max(0, Number(job.attemptCount) || 0) + 1,
  };
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
  viewerStatsClaimUpdate,
  viewerStatsPriorityScore,
  viewerStatsRateLimit,
  viewerStatsTier,
  viewerStatsWakeCandidate,
};
