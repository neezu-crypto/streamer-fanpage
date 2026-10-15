'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VIEWER_STATS_PRIORITY_AGE_STEP_MS,
  VIEWER_STATS_QUEUE_MAX_CONCURRENT,
  VIEWER_STATS_TIER_PRIORITY,
  selectNextViewerStatsCandidate,
  viewerStatsRateLimit,
  viewerStatsClaimUpdate,
  viewerStatsPriorityScore,
  viewerStatsTier,
  viewerStatsWakeCandidate,
} = require('../viewer-stats-policy');

test('anonymous auth is classified as the lowest-priority tier', () => {
  assert.equal(viewerStatsTier({ token: { firebase: { sign_in_provider: 'anonymous' } } }), 'anonymous');
});

test('linked accounts, subscribers, and admins receive progressively higher tiers', () => {
  const account = { token: { firebase: { sign_in_provider: 'google.com' } } };
  assert.equal(viewerStatsTier(account), 'account');
  assert.equal(viewerStatsTier(account, { isSubscribed: true }), 'subscriber');
  assert.equal(viewerStatsTier(account, { isAdmin: true, isSubscribed: true }), 'admin');
  assert.equal(viewerStatsTier(
    { token: { firebase: { sign_in_provider: 'anonymous' } } },
    { isProtectedAccount: true },
  ), 'account');
});

test('higher access tiers receive at least the anonymous request allowance', () => {
  for (const action of ['search', 'vods', 'stats']) {
    assert.ok(viewerStatsRateLimit('account', action).perDay >= viewerStatsRateLimit('anonymous', action).perDay);
    assert.ok(viewerStatsRateLimit('subscriber', action).perDay >= viewerStatsRateLimit('account', action).perDay);
  }
  assert.equal(viewerStatsRateLimit('admin', 'stats'), null);
});

test('anonymous allowances are deliberately lower than linked and subscribed accounts', () => {
  for (const action of ['search', 'vods', 'stats']) {
    assert.ok(viewerStatsRateLimit('anonymous', action).perMinute < viewerStatsRateLimit('account', action).perMinute);
    assert.ok(viewerStatsRateLimit('account', action).perMinute < viewerStatsRateLimit('subscriber', action).perMinute);
    assert.ok(viewerStatsRateLimit('anonymous', action).perDay < viewerStatsRateLimit('account', action).perDay);
    assert.ok(viewerStatsRateLimit('account', action).perDay < viewerStatsRateLimit('subscriber', action).perDay);
  }
});

test('queue selects subscriber work before newer anonymous work', () => {
  const now = 1000000;
  const selected = selectNextViewerStatsCandidate([
    { id: 'anon', tier: 'anonymous', createdAt: now - 1000 },
    { id: 'subscriber', tier: 'subscriber', createdAt: now },
  ], now);
  assert.equal(selected.id, 'subscriber');
  assert.equal(VIEWER_STATS_QUEUE_MAX_CONCURRENT, 16);
});

test('admin and subscriber work rank above account and anonymous work while each tier remains FIFO', () => {
  const now = 1000000;
  const selected = selectNextViewerStatsCandidate([
    { id: 'account-new', tier: 'account', createdAt: now },
    { id: 'account-old', tier: 'account', createdAt: now - 100 },
    { id: 'admin-new', tier: 'admin', createdAt: now },
    { id: 'subscriber-new', tier: 'subscriber', createdAt: now },
  ], now);
  assert.equal(selected.id, 'admin-new');
  const sameTierSelected = selectNextViewerStatsCandidate([
    { id: 'account-new', tier: 'account', createdAt: now },
    { id: 'account-old', tier: 'account', createdAt: now - 100 },
  ], now);
  assert.equal(sameTierSelected.id, 'account-old');
});

test('anonymous work gains priority with age so it cannot wait forever', () => {
  const now = 1000000;
  assert.equal(
    viewerStatsPriorityScore('anonymous', now - (2 * VIEWER_STATS_PRIORITY_AGE_STEP_MS), now),
    VIEWER_STATS_TIER_PRIORITY.subscriber,
  );
  const selected = selectNextViewerStatsCandidate([
    { id: 'anon-old', tier: 'anonymous', createdAt: now - (3 * VIEWER_STATS_PRIORITY_AGE_STEP_MS) },
    { id: 'subscriber-new', tier: 'subscriber', createdAt: now - 1000 },
  ], now);
  assert.equal(selected.id, 'anon-old');
});

test('task wake-up can reconstruct a missing queue index for a valid queued job', () => {
  const jobId = '20261016_0cb41825-dd79-4770-95bc-d2c70998bafe';
  const job = {
    status: 'queued',
    tier: 'anonymous',
    queueKey: '1792085088298_20261016_0cb41825-dd79-4770-95bc-d2c70998bafe',
    createdAt: 1792085088298,
  };
  assert.deepEqual(viewerStatsWakeCandidate(jobId, job), {
    jobId,
    tier: 'anonymous',
    queueKey: job.queueKey,
    createdAt: job.createdAt,
  });
  assert.equal(viewerStatsWakeCandidate(jobId, { ...job, status: 'completed' }), null);
  assert.equal(viewerStatsWakeCandidate(jobId, { ...job, queueKey: 'invalid' }), null);
});

test('worker claim can seed the transaction from a freshly read job when its local value is empty', () => {
  const now = 1000000;
  const knownJob = {
    status: 'queued',
    createdAt: now - 100,
    expiresAt: now + 10000,
    tier: 'anonymous',
  };
  const claimed = viewerStatsClaimUpdate(null, knownJob, 'task-1', now, 180000);
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.claimedBy, 'task-1');
  assert.equal(claimed.processingLeaseUntil, now + 180000);
  assert.equal(claimed.attemptCount, 1);
  assert.equal(viewerStatsClaimUpdate({
    ...knownJob,
    status: 'processing',
    claimedBy: 'task-2',
    processingLeaseUntil: now + 5000,
  }, knownJob, 'task-1', now, 180000), undefined);
});
