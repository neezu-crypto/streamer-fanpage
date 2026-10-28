'use strict';

const SNAPSHOT_SCHEMA_VERSION = 1;
const ADMIN_STATS_DAYS = 30;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const VIEWER_STATS_USAGE_ACTIONS = Object.freeze(['search', 'vods', 'stats']);
const VIEWER_STATS_TIERS = Object.freeze(['anonymous', 'account', 'subscriber', 'admin']);
const VIEWER_STATS_DATA_METRIC_KEYS = Object.freeze([
  'calls', 'runtimeMs', 'callableCalls', 'callableRuntimeMs', 'workerCalls', 'workerRuntimeMs',
  'requestBytes', 'responseBytes', 'rtdbReadBytes', 'rtdbWriteBytes', 'soopRequestBytes', 'soopResponseBytes',
  'staticExportRuns', 'staticExportReadBytes',
]);
const VIEWER_STATS_COST_RATES = Object.freeze({
  realtimeDatabaseUsdPerGb: 1,
  cloudRunCpuUsdPerVcpuSecond: 0.000024,
  cloudRunMemoryUsdPerGibSecond: 0.0000025,
  cloudRunRequestUsdPerMillion: 0.4,
  functionCpuCount: 1,
  functionMemoryGib: 0.25,
});
const FORBIDDEN_SNAPSHOT_KEYS = new Set([
  'uid', 'uidhash', 'requesteruid', 'requesterkey', 'ip', 'ipaddress', 'visitorhash',
  'jobid', 'requestid', 'searchterm', 'query',
]);
const FANPAGE_METRICS_ROOT = 'streamerFanPageAdminMetrics/v1';

function metricCount(value) {
  const count = Math.floor(Number(value) || 0);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function emptyViewerStatsDataMetrics() {
  return Object.fromEntries(VIEWER_STATS_DATA_METRIC_KEYS.map((key) => [key, 0]));
}

function addViewerStatsDataMetrics(target, source) {
  VIEWER_STATS_DATA_METRIC_KEYS.forEach((key) => {
    target[key] = Math.max(0, Number(target[key]) || 0) + Math.max(0, Number(source && source[key]) || 0);
  });
  return target;
}

function sumViewerStatsDailyDataMetrics(days) {
  return (Array.isArray(days) ? days : []).reduce((sum, day) => {
    addViewerStatsDataMetrics(sum, day && day.dataMetrics);
    return sum;
  }, emptyViewerStatsDataMetrics());
}

function viewerStatsCostEstimate(dataMetrics) {
  const metrics = dataMetrics && typeof dataMetrics === 'object' ? dataMetrics : {};
  const runtimeSeconds = Math.max(0, Number(metrics.runtimeMs) || 0) / 1000;
  const realtimeDatabaseGb = Math.max(0, Number(metrics.rtdbReadBytes) || 0) / 1_000_000_000;
  const functionCalls = Math.max(0, Number(metrics.calls) || 0);
  const functionCost = functionCalls * VIEWER_STATS_COST_RATES.cloudRunRequestUsdPerMillion / 1_000_000
    + runtimeSeconds * (VIEWER_STATS_COST_RATES.functionCpuCount * VIEWER_STATS_COST_RATES.cloudRunCpuUsdPerVcpuSecond
      + VIEWER_STATS_COST_RATES.functionMemoryGib * VIEWER_STATS_COST_RATES.cloudRunMemoryUsdPerGibSecond);
  const realtimeDatabaseCost = realtimeDatabaseGb * VIEWER_STATS_COST_RATES.realtimeDatabaseUsdPerGb;
  return { functionCost, realtimeDatabaseCost, totalCost: functionCost + realtimeDatabaseCost };
}

function makeDateKeys(now = Date.now()) {
  const today = new Date(`${fanPageStatsDateKey(now)}T00:00:00Z`);
  return Array.from({ length: ADMIN_STATS_DAYS }, (_, index) =>
    fanPageStatsDateKey(today.getTime() - (ADMIN_STATS_DAYS - index - 1) * 24 * 60 * 60 * 1000));
}

function fanPageStatsDateKey(timestamp = Date.now()) {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isAdminStatsSnapshotStale(snapshot, now = Date.now()) {
  return !Number.isFinite(Number(snapshot && snapshot.generatedAt))
    || Number(now) - Number(snapshot.generatedAt) > 70 * 60 * 1000;
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

function buildAdminStatsSnapshot({
  verified = {},
  fanPageStats = {},
  viewerStatsLimits = {},
  streamerNames = {},
  viewerStatsQueue = {},
}, { dateKeys = makeDateKeys(), generatedAt = Date.now() } = {}) {
  if (!Array.isArray(dateKeys) || dateKeys.length !== ADMIN_STATS_DAYS
    || dateKeys.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('관리자 통계 snapshot은 최근 30일 날짜가 모두 필요합니다.');
  }

  const verifiedById = new Map();
  Object.entries(verified && typeof verified === 'object' ? verified : {}).forEach(([key, record]) => {
    const streamer = publicStreamer(key, record);
    if (streamer) verifiedById.set(streamer.id, streamer);
  });
  const streamerNameById = new Map([...verifiedById.values()].map((streamer) => [streamer.id, streamer.nickname]));
  Object.entries(streamerNames && typeof streamerNames === 'object' ? streamerNames : {}).forEach(([soopId, nickname]) => {
    const normalizedId = String(soopId || '').trim().toLowerCase();
    const normalizedNickname = typeof nickname === 'string' ? nickname.trim().slice(0, 40) : '';
    if (SOOP_ID_PATTERN.test(normalizedId) && normalizedNickname && !streamerNameById.has(normalizedId)) {
      streamerNameById.set(normalizedId, normalizedNickname);
    }
  });

  const statsById = fanPageStats && typeof fanPageStats === 'object' ? fanPageStats : {};
  const streamers = [...verifiedById.values()].map((streamer) => {
    const record = statsById[streamer.id] && typeof statsById[streamer.id] === 'object' ? statsById[streamer.id] : {};
    const dailyRecords = record.daily && typeof record.daily === 'object' ? record.daily : {};
    const daily = dateKeys.map((date) => {
      const day = dailyRecords[date] && typeof dailyRecords[date] === 'object' ? dailyRecords[date] : {};
      return { date, views: metricCount(day.views), uniqueVisitors: metricCount(day.uniqueVisitors) };
    });
    const last7 = daily.slice(-7);
    return {
      ...streamer,
      totalViews: metricCount(record.summary && record.summary.totalViews),
      last7Views: last7.reduce((total, day) => total + day.views, 0),
      last30Views: daily.reduce((total, day) => total + day.views, 0),
      last30DailyUniqueVisitors: daily.reduce((total, day) => total + day.uniqueVisitors, 0),
      daily,
    };
  }).sort((a, b) => b.last30Views - a.last30Views
    || b.totalViews - a.totalViews
    || a.nickname.localeCompare(b.nickname, 'ko'));

  const viewerUsageByDate = {};
  const viewerDataUsageByDate = {};
  const viewerDataUsageByAction = {};
  const searchedStreamerCounts = {};
  const viewerTierUsage = Object.fromEntries(VIEWER_STATS_TIERS
    .map((tier) => [tier, { search: 0, vods: 0, stats: 0, total: 0 }]));
  const viewerQueueMetrics = { enqueued: 0, completed: 0, failed: 0, cancelled: 0, queueWaitMs: 0, cacheHits: 0 };
  const includedDates = new Set(dateKeys);
  Object.values(viewerStatsLimits && typeof viewerStatsLimits === 'object' ? viewerStatsLimits : {}).forEach((record) => {
    const recentUsageByDay = record && typeof record.recentUsageByDay === 'object' ? record.recentUsageByDay : {};
    Object.entries(recentUsageByDay).forEach(([date, actions]) => {
      if (!includedDates.has(date) || !actions || typeof actions !== 'object') return;
      const day = viewerUsageByDate[date] || (viewerUsageByDate[date] = { search: 0, vods: 0, stats: 0 });
      VIEWER_STATS_USAGE_ACTIONS.forEach((action) => { day[action] += metricCount(actions[action]); });
      const tiers = actions.tiers && typeof actions.tiers === 'object' ? actions.tiers : {};
      Object.entries(tiers).forEach(([tier, counts]) => {
        if (!viewerTierUsage[tier] || !counts || typeof counts !== 'object') return;
        VIEWER_STATS_USAGE_ACTIONS.forEach((action) => {
          const count = metricCount(counts[action]);
          viewerTierUsage[tier][action] += count;
          viewerTierUsage[tier].total += count;
        });
      });
      const queueMetrics = actions.queueMetrics && typeof actions.queueMetrics === 'object' ? actions.queueMetrics : {};
      ['enqueued', 'completed', 'failed', 'cancelled', 'queueWaitMs', 'cacheHits'].forEach((key) => {
        viewerQueueMetrics[key] += metricCount(queueMetrics[key]);
      });
      const selectedStreamers = actions.streamers && typeof actions.streamers === 'object' ? actions.streamers : {};
      Object.entries(selectedStreamers).forEach(([rawStreamerId, count]) => {
        const streamerId = String(rawStreamerId || '').trim().toLowerCase();
        if (!SOOP_ID_PATTERN.test(streamerId)) return;
        searchedStreamerCounts[streamerId] = (searchedStreamerCounts[streamerId] || 0) + metricCount(count);
      });
      if (actions.dataMetrics && typeof actions.dataMetrics === 'object') {
        const dailyMetrics = viewerDataUsageByDate[date] || (viewerDataUsageByDate[date] = emptyViewerStatsDataMetrics());
        addViewerStatsDataMetrics(dailyMetrics, actions.dataMetrics);
      }
      const dataByAction = actions.dataByAction && typeof actions.dataByAction === 'object' ? actions.dataByAction : {};
      Object.entries(dataByAction).forEach(([action, metrics]) => {
        if (!metrics || typeof metrics !== 'object') return;
        const actionMetrics = viewerDataUsageByAction[action]
          || (viewerDataUsageByAction[action] = emptyViewerStatsDataMetrics());
        addViewerStatsDataMetrics(actionMetrics, metrics);
      });
    });
  });

  const viewerUsageDaily = dateKeys.map((date) => {
    const day = viewerUsageByDate[date] && typeof viewerUsageByDate[date] === 'object' ? viewerUsageByDate[date] : {};
    const search = metricCount(day.search);
    const vods = metricCount(day.vods);
    const stats = metricCount(day.stats);
    return { date, search, vods, stats, total: search + vods + stats };
  });
  const last7ViewerUsage = viewerUsageDaily.slice(-7);
  const viewerUsageActions = viewerUsageDaily.reduce((totals, day) => ({
    search: totals.search + day.search,
    vods: totals.vods + day.vods,
    stats: totals.stats + day.stats,
  }), { search: 0, vods: 0, stats: 0 });
  const viewerDataUsageDaily = dateKeys.map((date) => ({ date, dataMetrics: viewerDataUsageByDate[date] || null }));
  const viewerDataUsageLast7 = sumViewerStatsDailyDataMetrics(viewerDataUsageDaily.slice(-7));
  const viewerDataUsageLast30 = sumViewerStatsDailyDataMetrics(viewerDataUsageDaily);
  const viewerDataUsageToday = viewerDataUsageDaily.at(-1)?.dataMetrics || emptyViewerStatsDataMetrics();
  const viewerDataUsageStartedAt = viewerDataUsageDaily.find((day) => day.dataMetrics && day.dataMetrics.calls > 0)?.date || null;
  const viewerDataUsageActionTotals = Object.fromEntries(Object.entries(viewerDataUsageByAction));
  const queueByTierSource = viewerStatsQueue && typeof viewerStatsQueue === 'object' ? viewerStatsQueue : {};
  const queuedByTier = Object.fromEntries(VIEWER_STATS_TIERS
    .map((tier) => [tier, Object.keys(queueByTierSource[tier] && typeof queueByTierSource[tier] === 'object'
      ? queueByTierSource[tier] : {}).length]));
  viewerQueueMetrics.queuedNow = Object.values(queuedByTier).reduce((total, count) => total + count, 0);
  viewerQueueMetrics.queuedByTier = queuedByTier;
  const topSearchedEntries = Object.entries(searchedStreamerCounts)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 30);
  const topSearchedStreamers = topSearchedEntries.map(({ id, count }) => ({
    id,
    soopId: id,
    nickname: streamerNameById.get(id) || `@${id}`,
    count,
  })).sort((a, b) => b.count - a.count || a.nickname.localeCompare(b.nickname, 'ko'));

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    sourceWindow: { days: ADMIN_STATS_DAYS, timezone: 'Asia/Seoul' },
    totals: {
      streamerCount: streamers.length,
      totalViews: streamers.reduce((total, streamer) => total + streamer.totalViews, 0),
      last7Views: streamers.reduce((total, streamer) => total + streamer.last7Views, 0),
      last30Views: streamers.reduce((total, streamer) => total + streamer.last30Views, 0),
    },
    viewerStatsUsage: {
      totals: {
        today: viewerUsageDaily.at(-1)?.total || 0,
        last7: last7ViewerUsage.reduce((total, day) => total + day.total, 0),
        last30: viewerUsageDaily.reduce((total, day) => total + day.total, 0),
      },
      actions30: viewerUsageActions,
      tiers30: viewerTierUsage,
      queue30: {
        ...viewerQueueMetrics,
        averageWaitMs: viewerQueueMetrics.completed
          ? Math.round(viewerQueueMetrics.queueWaitMs / viewerQueueMetrics.completed) : 0,
      },
      daily: viewerUsageDaily,
      topSearchedStreamers,
      dataUsage: {
        startedAt: viewerDataUsageStartedAt,
        today: viewerDataUsageToday,
        last7: viewerDataUsageLast7,
        last30: viewerDataUsageLast30,
        daily: viewerDataUsageDaily,
        byAction30: viewerDataUsageActionTotals,
        estimatedCostUsd: {
          today: viewerStatsCostEstimate(viewerDataUsageToday),
          last7: viewerStatsCostEstimate(viewerDataUsageLast7),
          last30: viewerStatsCostEstimate(viewerDataUsageLast30),
        },
      },
    },
    streamers,
  };
  validateAdminStatsSnapshot(snapshot, dateKeys);
  return snapshot;
}

function addAggregateValue(target, source) {
  Object.entries(source && typeof source === 'object' ? source : {}).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[key] = (Number(target[key]) || 0) + Math.max(0, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = addAggregateValue(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    }
  });
  return target;
}

function subtractAggregateValue(source, live) {
  if (typeof source === 'number') return Math.max(0, source - (Number(live) || 0));
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [
    key,
    value && typeof value === 'object' && !Array.isArray(value)
      ? subtractAggregateValue(value, live && live[key])
      : typeof value === 'number' ? subtractAggregateValue(value, live && live[key]) : value,
  ]));
}

function aggregateViewerStatsLimits(viewerStatsLimits = {}, dateKeys = makeDateKeys()) {
  const daily = Object.fromEntries(dateKeys.map((date) => [date, {
    search: 0,
    vods: 0,
    stats: 0,
    tiers: Object.fromEntries(VIEWER_STATS_TIERS.map((tier) => [tier, { search: 0, vods: 0, stats: 0 }])),
    streamers: {},
    queueMetrics: { enqueued: 0, completed: 0, failed: 0, cancelled: 0, queueWaitMs: 0, cacheHits: 0 },
    dataByAction: {},
  }]));
  const includedDates = new Set(dateKeys);
  Object.values(viewerStatsLimits && typeof viewerStatsLimits === 'object' ? viewerStatsLimits : {}).forEach((record) => {
    const days = record && record.recentUsageByDay && typeof record.recentUsageByDay === 'object'
      ? record.recentUsageByDay
      : {};
    Object.entries(days).forEach(([date, actions]) => {
      if (!includedDates.has(date) || !actions || typeof actions !== 'object') return;
      const target = daily[date];
      VIEWER_STATS_USAGE_ACTIONS.forEach((action) => {
        target[action] += metricCount(actions[action]);
      });
      const tiers = actions.tiers && typeof actions.tiers === 'object' ? actions.tiers : {};
      Object.entries(tiers).forEach(([tier, counts]) => {
        if (!target.tiers[tier] || !counts || typeof counts !== 'object') return;
        VIEWER_STATS_USAGE_ACTIONS.forEach((action) => {
          target.tiers[tier][action] += metricCount(counts[action]);
        });
      });
      const queueMetrics = actions.queueMetrics && typeof actions.queueMetrics === 'object' ? actions.queueMetrics : {};
      Object.keys(target.queueMetrics).forEach((key) => {
        target.queueMetrics[key] += metricCount(queueMetrics[key]);
      });
      const streamers = actions.streamers && typeof actions.streamers === 'object' ? actions.streamers : {};
      Object.entries(streamers).forEach(([rawId, count]) => {
        const id = String(rawId || '').trim().toLowerCase();
        if (SOOP_ID_PATTERN.test(id)) target.streamers[id] = (target.streamers[id] || 0) + metricCount(count);
      });
      if (actions.dataMetrics && typeof actions.dataMetrics === 'object') {
        const metrics = target.dataMetrics || (target.dataMetrics = emptyViewerStatsDataMetrics());
        addViewerStatsDataMetrics(metrics, actions.dataMetrics);
      }
      Object.entries(actions.dataByAction && typeof actions.dataByAction === 'object' ? actions.dataByAction : {})
        .forEach(([action, metrics]) => {
          if (!metrics || typeof metrics !== 'object') return;
          const actionMetrics = target.dataByAction[action]
            || (target.dataByAction[action] = emptyViewerStatsDataMetrics());
          addViewerStatsDataMetrics(actionMetrics, metrics);
        });
    });
  });
  return daily;
}

function publicRoster(verified = {}) {
  const roster = {};
  Object.entries(verified && typeof verified === 'object' ? verified : {}).forEach(([key, record]) => {
    const streamer = publicStreamer(key, record);
    if (streamer) roster[streamer.id] = streamer;
  });
  return roster;
}

function buildAdminStatsProjectionSeed(sources, liveProjection = {}, { dateKeys = makeDateKeys() } = {}) {
  if (!Array.isArray(dateKeys) || dateKeys.length !== ADMIN_STATS_DAYS) {
    throw new Error('projection 초기화에는 최근 30일 날짜가 필요합니다.');
  }
  const roster = publicRoster(sources.verified);
  const names = {};
  Object.entries(sources.streamerNames || {}).forEach(([id, value]) => {
    const normalizedId = String(id || '').trim().toLowerCase();
    const nickname = typeof value === 'string' ? value.trim().slice(0, 40) : '';
    if (SOOP_ID_PATTERN.test(normalizedId) && nickname) names[normalizedId] = nickname;
  });

  const fanPageBaseline = {};
  const liveFanPages = liveProjection.fanPageStats || {};
  Object.entries(roster).forEach(([id]) => {
    const source = sources.fanPageStats && sources.fanPageStats[id] || {};
    const live = liveFanPages[id] || {};
    const sourceDaily = source.daily && typeof source.daily === 'object' ? source.daily : {};
    const liveDaily = live.daily && typeof live.daily === 'object' ? live.daily : {};
    fanPageBaseline[id] = {
      summary: { totalViews: subtractAggregateValue(metricCount(source.summary && source.summary.totalViews), live.summary && live.summary.totalViews) },
      daily: Object.fromEntries(dateKeys.map((date) => [date, {
        views: subtractAggregateValue(metricCount(sourceDaily[date] && sourceDaily[date].views), liveDaily[date] && liveDaily[date].views),
        uniqueVisitors: subtractAggregateValue(metricCount(sourceDaily[date] && sourceDaily[date].uniqueVisitors), liveDaily[date] && liveDaily[date].uniqueVisitors),
      }])),
    };
  });

  const rawViewerDaily = aggregateViewerStatsLimits(sources.viewerStatsLimits, dateKeys);
  const liveViewerDaily = liveProjection.viewerStatsDaily || {};
  const viewerStatsBaseline = Object.fromEntries(dateKeys.map((date) => [
    date,
    subtractAggregateValue(rawViewerDaily[date], liveViewerDaily[date]),
  ]));
  const rawQueue = sources.viewerStatsQueue && typeof sources.viewerStatsQueue === 'object' ? sources.viewerStatsQueue : {};
  const liveQueue = liveProjection.queueNow || {};
  const queueBaseline = Object.fromEntries(VIEWER_STATS_TIERS.map((tier) => [
    tier,
    subtractAggregateValue(Object.keys(rawQueue[tier] && typeof rawQueue[tier] === 'object' ? rawQueue[tier] : {}).length, liveQueue[tier]),
  ]));

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    fanpage: { roster, names, baseline: fanPageBaseline },
    viewerStats: { baseline: viewerStatsBaseline, queueBaseline },
  };
}

function buildAdminStatsSnapshotFromProjection({
  rosterBaseline = {},
  rosterLive = {},
  namesBaseline = {},
  fanPageBaseline = {},
  fanPageLive = {},
  viewerStatsBaseline = {},
  viewerStatsLive = {},
  queueBaseline = {},
  queueLive = {},
} = {}, { dateKeys = makeDateKeys(), generatedAt = Date.now() } = {}) {
  const roster = { ...rosterBaseline };
  Object.entries(rosterLive || {}).forEach(([id, value]) => {
    if (value && value.active === false) delete roster[id];
    else if (value && typeof value === 'object') roster[id] = { ...value, id };
  });
  const names = { ...(namesBaseline || {}) };
  const verified = Object.fromEntries(Object.entries(roster).map(([id, streamer]) => [id, {
    nickname: streamer.nickname,
    soopId: streamer.soopId || id,
  }]));
  const fanPageStats = {};
  Object.keys(roster).forEach((id) => {
    fanPageStats[id] = addAggregateValue(
      addAggregateValue({}, fanPageBaseline && fanPageBaseline[id]),
      fanPageLive && fanPageLive[id],
    );
  });
  const viewerDaily = {};
  dateKeys.forEach((date) => {
    viewerDaily[date] = addAggregateValue(
      addAggregateValue({}, viewerStatsBaseline && viewerStatsBaseline[date]),
      viewerStatsLive && viewerStatsLive[date],
    );
  });
  const viewerStatsLimits = { adminProjection: { recentUsageByDay: viewerDaily } };
  const viewerStatsQueue = {};
  VIEWER_STATS_TIERS.forEach((tier) => {
    const count = Math.max(0, (Number(queueBaseline && queueBaseline[tier]) || 0)
      + (Number(queueLive && queueLive[tier]) || 0));
    if (count) viewerStatsQueue[tier] = Object.fromEntries(Array.from({ length: count }, (_, index) => [`queued-${index}`, true]));
  });
  const snapshot = buildAdminStatsSnapshot({
    verified,
    fanPageStats,
    viewerStatsLimits,
    streamerNames: names,
    viewerStatsQueue,
  }, { dateKeys, generatedAt });
  validateAdminStatsSnapshot(snapshot, dateKeys);
  return snapshot;
}

function validateAdminStatsSnapshot(snapshot, expectedDateKeys) {
  if (!snapshot || snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    || !Number.isFinite(Number(snapshot.generatedAt))
    || snapshot.sourceWindow?.days !== ADMIN_STATS_DAYS
    || !Array.isArray(snapshot.streamers)
    || !Array.isArray(snapshot.viewerStatsUsage?.daily)
    || snapshot.viewerStatsUsage.daily.length !== ADMIN_STATS_DAYS
    || !Array.isArray(snapshot.viewerStatsUsage?.dataUsage?.daily)
    || snapshot.viewerStatsUsage.dataUsage.daily.length !== ADMIN_STATS_DAYS) {
    throw new Error('관리자 통계 snapshot 구조가 올바르지 않습니다.');
  }
  const actualDates = snapshot.viewerStatsUsage.daily.map((day) => day && day.date);
  const actualDataDates = snapshot.viewerStatsUsage.dataUsage.daily.map((day) => day && day.date);
  const datesAreValid = actualDates.every((date, index) => /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
    && (index === 0 || Date.parse(`${date}T00:00:00Z`) - Date.parse(`${actualDates[index - 1]}T00:00:00Z`) === 86400000));
  if (!datesAreValid || actualDates.some((date, index) => actualDataDates[index] !== date)
    || (Array.isArray(expectedDateKeys) && expectedDateKeys.some((date, index) => actualDates[index] !== date))) {
    throw new Error('관리자 통계 snapshot 날짜 범위가 올바르지 않습니다.');
  }
  const inspect = (value, path = 'snapshot') => {
    if (!value || typeof value !== 'object') return;
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_SNAPSHOT_KEYS.has(normalizedKey)
        || /(uid|uidhash|ipaddress|visitorhash|jobid|requestid|searchterm)/i.test(normalizedKey)) {
        throw new Error(`관리자 통계 snapshot에 민감 필드가 포함되어 있습니다: ${path}.${key}`);
      }
      if (typeof child === 'number' && (!Number.isFinite(child) || child < 0 || child > Number.MAX_SAFE_INTEGER)) {
        throw new Error(`관리자 통계 snapshot에 범위를 벗어난 수치가 있습니다: ${path}.${key}`);
      }
      inspect(child, `${path}.${key}`);
    });
  };
  inspect(snapshot);
  const requiredTotals = ['streamerCount', 'totalViews', 'last7Views', 'last30Views'];
  if (requiredTotals.some((key) => !Number.isSafeInteger(snapshot.totals && snapshot.totals[key]) || snapshot.totals[key] < 0)) {
    throw new Error('관리자 통계 snapshot 합계 수치가 올바르지 않습니다.');
  }
  if (snapshot.streamers.some((streamer) => !streamer || typeof streamer.id !== 'string'
    || typeof streamer.soopId !== 'string' || typeof streamer.nickname !== 'string'
    || !Array.isArray(streamer.daily) || streamer.daily.length !== ADMIN_STATS_DAYS)) {
    throw new Error('관리자 통계 snapshot 스트리머 자료가 올바르지 않습니다.');
  }
  if (snapshot.viewerStatsUsage.daily.some((day, index) => !day || day.date !== actualDates[index]
    || ['search', 'vods', 'stats', 'total'].some((key) => !Number.isSafeInteger(day[key]) || day[key] < 0))) {
    throw new Error('관리자 통계 snapshot 일별 수치가 올바르지 않습니다.');
  }
  return true;
}

module.exports = {
  ADMIN_STATS_DAYS,
  FANPAGE_METRICS_ROOT,
  SNAPSHOT_SCHEMA_VERSION,
  buildAdminStatsSnapshot,
  buildAdminStatsProjectionSeed,
  buildAdminStatsSnapshotFromProjection,
  fanPageStatsDateKey,
  aggregateViewerStatsLimits,
  makeDateKeys,
  isAdminStatsSnapshotStale,
  validateAdminStatsSnapshot,
};
