'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VIEWER_STATS_PRIORITY_AGE_STEP_MS,
  VIEWER_STATS_QUEUE_MAX_CONCURRENT,
  VIEWER_STATS_TIER_PRIORITY,
  selectNextViewerStatsCandidate,
  viewerStatsRateLimit,
  viewerStatsPriorityScore,
  viewerStatsTier,
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
