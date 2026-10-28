'use strict';

const { execFileSync } = require('node:child_process');
const {
  buildAdminStatsProjectionSeed,
  buildAdminStatsSnapshot,
  buildAdminStatsSnapshotFromProjection,
  makeDateKeys,
  validateAdminStatsSnapshot,
} = require('./admin-stats-snapshot');

const DATABASE_URL = 'https://soop-stock-market-default-rtdb.firebaseio.com';
const ROOT = 'streamerFanPageAdminMetrics/v1';
const REQUEST_TIMEOUT_MS = 60 * 1000;

function googleAccessToken() {
  const token = execFileSync('gcloud', ['auth', 'print-access-token', '--project', 'soop-stock-market'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!token) throw new Error('gcloud에서 Google OAuth access token을 얻지 못했습니다.');
  return token;
}

async function readPaths(accessToken, paths) {
  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    const response = await fetch(new URL(encodeURI(`${path}.json`), `${DATABASE_URL}/`), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`RTDB 읽기에 실패했습니다 (${response.status}).`);
    return [key, body ? JSON.parse(body) || {} : {}];
  }));
  return Object.fromEntries(entries);
}

async function readSources(accessToken) {
  return readPaths(accessToken, {
    verified: 'streamerVerifications',
    fanPageStats: 'streamerFanPageStats',
    viewerStatsLimits: 'streamerFanPageViewerStatsLimits',
    streamerNames: 'streamerNames',
    viewerStatsQueue: 'streamerFanPageViewerStatsQueue',
  });
}

async function readLiveProjection(accessToken) {
  const live = await readPaths(accessToken, {
    rosterLive: `${ROOT}/fanpage/rosterLive`,
    fanPageStats: `${ROOT}/fanpage/statsLive`,
    viewerStatsDaily: `${ROOT}/viewerStats/dailyLive`,
    queueNow: `${ROOT}/viewerStats/queueLive`,
  });
  return live;
}

function projectionSnapshot(seed, live, dateKeys) {
  return buildAdminStatsSnapshotFromProjection({
    rosterBaseline: seed.fanpage.roster,
    rosterLive: live.rosterLive,
    namesBaseline: seed.fanpage.names,
    fanPageBaseline: seed.fanpage.baseline,
    fanPageLive: live.fanPageStats,
    viewerStatsBaseline: seed.viewerStats.baseline,
    viewerStatsLive: live.viewerStatsDaily,
    queueBaseline: seed.viewerStats.queueBaseline,
    queueLive: live.queueNow,
  }, { dateKeys, generatedAt: seed.generatedAt });
}

function comparableSnapshot(snapshot) {
  const { generatedAt, ...rest } = snapshot;
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  };
  return JSON.stringify(sortKeys(rest));
}

async function seedProjection(accessToken = googleAccessToken(), { now = Date.now() } = {}) {
  const dateKeys = makeDateKeys(now);
  const [sources, live] = await Promise.all([readSources(accessToken), readLiveProjection(accessToken)]);
  const seed = buildAdminStatsProjectionSeed(sources, live, { dateKeys });
  const updates = {
    [`${ROOT}/metadata`]: { schemaVersion: 1, seededAt: now, dateWindow: { from: dateKeys[0], through: dateKeys.at(-1) } },
    [`${ROOT}/fanpage/rosterBaseline`]: seed.fanpage.roster,
    [`${ROOT}/fanpage/namesBaseline`]: seed.fanpage.names,
    [`${ROOT}/fanpage/statsBaseline`]: seed.fanpage.baseline,
    [`${ROOT}/viewerStats/dailyBaseline`]: seed.viewerStats.baseline,
    [`${ROOT}/viewerStats/queueBaseline`]: seed.viewerStats.queueBaseline,
  };
  const updateResponse = await fetch(`${DATABASE_URL}/.json`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!updateResponse.ok) throw new Error(`RTDB projection 초기화에 실패했습니다 (${updateResponse.status}).`);

  const [verifySources, verifyLive] = await Promise.all([readSources(accessToken), readLiveProjection(accessToken)]);
  const sourceSnapshot = buildAdminStatsSnapshot(verifySources, { dateKeys, generatedAt: now });
  const seededSnapshot = projectionSnapshot(seed, verifyLive, dateKeys);
  validateAdminStatsSnapshot(sourceSnapshot, dateKeys);
  validateAdminStatsSnapshot(seededSnapshot, dateKeys);
  const matches = comparableSnapshot(sourceSnapshot) === comparableSnapshot(seededSnapshot);
  const report = {
    matches,
    dateWindow: { from: dateKeys[0], through: dateKeys.at(-1) },
    streamerCount: sourceSnapshot.streamers.length,
    sourceBytes: Buffer.byteLength(JSON.stringify(verifySources), 'utf8'),
  };
  console.log(JSON.stringify(report));
  if (!matches) throw new Error('프로젝션과 원본 집계가 일치하지 않습니다. 활동이 적을 때 다시 backfill 하세요.');
  return report;
}

async function main() {
  await seedProjection(googleAccessToken());
}

if (require.main === module) {
  main().catch((error) => {
    console.error('관리자 집계 projection 초기화 실패:', error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main, projectionSnapshot, readLiveProjection, readSources, seedProjection };
