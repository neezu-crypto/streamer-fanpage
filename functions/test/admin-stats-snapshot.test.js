'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAdminStatsProjectionSeed,
  buildAdminStatsSnapshot,
  buildAdminStatsSnapshotFromProjection,
  isAdminStatsSnapshotStale,
  validateAdminStatsSnapshot,
} = require('../admin-stats-snapshot');

const dates = Array.from({ length: 30 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);

test('builds complete 30-day fanpage and high-point usage snapshots without private identifiers', () => {
  const snapshot = buildAdminStatsSnapshot({
    verified: { streamerUid: { nickname: '스트리머', soopId: 'streamer01' } },
    fanPageStats: {
      streamer01: {
        summary: { totalViews: 140 },
        daily: { '2026-10-30': { views: 12, uniqueVisitors: 8 } },
      },
    },
    viewerStatsLimits: {
      abcdef: {
        recentUsageByDay: {
          '2026-10-30': {
            search: 2,
            stats: 3,
            tiers: { account: { search: 2, stats: 3 } },
            streamers: { streamer01: 4 },
            queueMetrics: { enqueued: 1, completed: 1, queueWaitMs: 2500 },
            dataMetrics: { calls: 2, runtimeMs: 1000, rtdbReadBytes: 800 },
            dataByAction: { stats: { calls: 2, runtimeMs: 1000, rtdbReadBytes: 800 } },
          },
        },
      },
    },
    streamerNames: { streamer01: '스트리머' },
    viewerStatsQueue: { account: { one: true } },
  }, { dateKeys: dates, generatedAt: 1793333333000 });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.sourceWindow.days, 30);
  assert.equal(snapshot.totals.streamerCount, 1);
  assert.equal(snapshot.totals.totalViews, 140);
  assert.equal(snapshot.totals.last30Views, 12);
  assert.equal(snapshot.streamers[0].last30DailyUniqueVisitors, 8);
  assert.equal(snapshot.viewerStatsUsage.totals.last30, 5);
  assert.equal(snapshot.viewerStatsUsage.tiers30.account.total, 5);
  assert.equal(snapshot.viewerStatsUsage.queue30.averageWaitMs, 2500);
  assert.equal(snapshot.viewerStatsUsage.queue30.queuedNow, 1);
  assert.equal(snapshot.viewerStatsUsage.topSearchedStreamers[0].nickname, '스트리머');
  assert.equal(snapshot.viewerStatsUsage.dataUsage.today.rtdbReadBytes, 800);
  assert.equal(JSON.stringify(snapshot).includes('abcdef'), false);
  assert.equal(JSON.stringify(snapshot).includes('streamerUid'), false);
  assert.equal(validateAdminStatsSnapshot(snapshot, dates), true);
});

test('rejects malformed date windows and sensitive identifiers before upload', () => {
  const snapshot = buildAdminStatsSnapshot({}, { dateKeys: dates, generatedAt: 1793333333000 });
  assert.throws(() => validateAdminStatsSnapshot(snapshot, dates.slice(1)), /구조|날짜/);
  assert.throws(() => validateAdminStatsSnapshot({
    ...snapshot,
    viewerStatsUsage: { ...snapshot.viewerStatsUsage, leakedUidHash: 'should-not-export' },
  }, dates), /민감 필드/);
  assert.throws(() => validateAdminStatsSnapshot({
    ...snapshot,
    totals: { ...snapshot.totals, last30Views: -1 },
  }, dates), /범위|합계/);
});

test('marks the private snapshot stale only after the 70-minute refresh window', () => {
  const now = 1_800_000_000_000;
  assert.equal(isAdminStatsSnapshotStale({ generatedAt: now - 70 * 60 * 1000 }, now), false);
  assert.equal(isAdminStatsSnapshotStale({ generatedAt: now - 70 * 60 * 1000 - 1 }, now), true);
  assert.equal(isAdminStatsSnapshotStale({}, now), true);
});

test('one-time projection seed subtracts live writes and reconstructs the legacy totals', () => {
  const sources = {
    verified: { privateUid: { nickname: '스트리머', soopId: 'streamer01', uid: 'must-not-copy' } },
    fanPageStats: {
      streamer01: {
        summary: { totalViews: 140 },
        daily: { '2026-10-30': { views: 12, uniqueVisitors: 8 } },
      },
    },
    viewerStatsLimits: {
      privateUidHash: {
        recentUsageByDay: {
          '2026-10-30': {
            search: 2,
            stats: 3,
            tiers: { account: { search: 2, stats: 3 } },
            streamers: { streamer01: 4 },
            queueMetrics: { enqueued: 2, completed: 1, queueWaitMs: 2500 },
            dataMetrics: { calls: 2, runtimeMs: 1000, rtdbReadBytes: 800 },
            dataByAction: { stats: { calls: 2, runtimeMs: 1000, rtdbReadBytes: 800 } },
          },
        },
      },
    },
    streamerNames: { streamer01: '스트리머' },
    viewerStatsQueue: { account: { one: true, two: true } },
  };
  const live = {
    fanPageStats: { streamer01: { summary: { totalViews: 3 }, daily: { '2026-10-30': { views: 1, uniqueVisitors: 1 } } } },
    viewerStatsDaily: {
      '2026-10-30': {
        search: 1,
        tiers: { account: { search: 1 } },
        streamers: { streamer01: 2 },
        queueMetrics: { enqueued: 1 },
        dataMetrics: { calls: 1, runtimeMs: 500, rtdbReadBytes: 200 },
        dataByAction: { stats: { calls: 1, runtimeMs: 500, rtdbReadBytes: 200 } },
      },
    },
    queueNow: { account: 1 },
  };
  const seed = buildAdminStatsProjectionSeed(sources, live, { dateKeys: dates });
  const snapshot = buildAdminStatsSnapshotFromProjection({
    rosterBaseline: seed.fanpage.roster,
    namesBaseline: seed.fanpage.names,
    fanPageBaseline: seed.fanpage.baseline,
    fanPageLive: live.fanPageStats,
    viewerStatsBaseline: seed.viewerStats.baseline,
    viewerStatsLive: live.viewerStatsDaily,
    queueBaseline: seed.viewerStats.queueBaseline,
    queueLive: live.queueNow,
  }, { dateKeys: dates, generatedAt: 1793333333000 });
  const expected = buildAdminStatsSnapshot(sources, { dateKeys: dates, generatedAt: 1793333333000 });

  assert.deepEqual(snapshot, expected);
  assert.equal(JSON.stringify(seed).includes('privateUid'), false);
  assert.equal(JSON.stringify(seed).includes('privateUidHash'), false);
});
