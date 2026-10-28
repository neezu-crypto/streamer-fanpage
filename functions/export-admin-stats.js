'use strict';

const { applicationDefault } = require('firebase-admin/app');
const { buildAdminStatsSnapshotFromProjection, makeDateKeys } = require('./admin-stats-snapshot');

const PROJECT_ID = 'soop-stock-market';
const DATABASE_URL = 'https://soop-stock-market-default-rtdb.firebaseio.com';
const DEFAULT_BUCKET = 'soop-stock-market-fanpage-admin-stats';
const OBJECT_NAME = 'admin-stats/v1/latest.json';
const REQUEST_TIMEOUT_MS = 60 * 1000;
const SOURCE_PATHS = Object.freeze({
  metadata: 'streamerFanPageAdminMetrics/v1/metadata',
  rosterBaseline: 'streamerFanPageAdminMetrics/v1/fanpage/rosterBaseline',
  rosterLive: 'streamerFanPageAdminMetrics/v1/fanpage/rosterLive',
  namesBaseline: 'streamerFanPageAdminMetrics/v1/fanpage/namesBaseline',
  fanPageBaseline: 'streamerFanPageAdminMetrics/v1/fanpage/statsBaseline',
  fanPageLive: 'streamerFanPageAdminMetrics/v1/fanpage/statsLive',
  viewerStatsBaseline: 'streamerFanPageAdminMetrics/v1/viewerStats/dailyBaseline',
  viewerStatsLive: 'streamerFanPageAdminMetrics/v1/viewerStats/dailyLive',
  queueBaseline: 'streamerFanPageAdminMetrics/v1/viewerStats/queueBaseline',
  queueLive: 'streamerFanPageAdminMetrics/v1/viewerStats/queueLive',
});

async function googleAccessToken() {
  const credential = applicationDefault();
  const token = await credential.getAccessToken();
  if (!token || !token.access_token) throw new Error('Google Cloud did not return an access token.');
  return token.access_token;
}

async function readAdminStatsProjection(accessToken) {
  let rtdbReadBytes = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const entries = await Promise.all(Object.entries(SOURCE_PATHS).map(async ([key, pathname]) => {
      const url = new URL(encodeURI(pathname + '.json'), DATABASE_URL + '/');
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + accessToken },
        signal: controller.signal,
      });
      const body = await response.text();
      rtdbReadBytes += Buffer.byteLength(body, 'utf8');
      if (!response.ok) throw new Error(`RTDB read failed for ${pathname} (${response.status}): ${body.slice(0, 400)}`);
      return [key, body ? JSON.parse(body) : null];
    }));
    return { sources: Object.fromEntries(entries), rtdbReadBytes };
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadSnapshot(accessToken, bucket, snapshot) {
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', OBJECT_NAME);
  url.searchParams.set('ifGenerationMatch', '0');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
    },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 412) {
    // The latest object already exists. Replace it with a generation precondition so concurrent
    // exporters cannot silently overwrite one another; retry once against the observed generation.
    const current = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(OBJECT_NAME)}`, {
      headers: { Authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!current.ok) throw new Error(`Could not read current snapshot metadata (${current.status}).`);
    const metadata = await current.json();
    const replaceUrl = new URL(url);
    replaceUrl.searchParams.set('ifGenerationMatch', String(metadata.generation));
    const replaceResponse = await fetch(replaceUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
      },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!replaceResponse.ok) {
      const body = await replaceResponse.text();
      throw new Error(`Could not replace admin stats snapshot (${replaceResponse.status}): ${body.slice(0, 500)}`);
    }
    return replaceResponse.json();
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not upload admin stats snapshot (${response.status}): ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function reportExportUsage(rtdbReadBytes) {
  const reportUrl = String(process.env.VIEWER_STATS_USAGE_REPORT_URL || '').trim();
  const reportToken = String(process.env.VIEWER_STATS_USAGE_REPORT_TOKEN || '').trim();
  if (!reportUrl && !reportToken) return;
  if (!reportUrl || !reportToken) {
    throw new Error('Both VIEWER_STATS_USAGE_REPORT_URL and VIEWER_STATS_USAGE_REPORT_TOKEN are required.');
  }
  const response = await fetch(reportUrl, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + reportToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ rtdbReadBytes }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Could not report admin snapshot export usage (${response.status}): ${body.slice(0, 500)}`);
}

async function main() {
  const accessToken = await googleAccessToken();
  const { sources, rtdbReadBytes } = await readAdminStatsProjection(accessToken);
  if (Number(sources.metadata && sources.metadata.schemaVersion) !== 1
    || !Number.isFinite(Number(sources.metadata && sources.metadata.seededAt))) {
    throw new Error('관리자 집계 projection이 초기화되지 않았습니다. 마지막 스냅샷은 유지합니다.');
  }
  const snapshot = buildAdminStatsSnapshotFromProjection(sources, { dateKeys: makeDateKeys(), generatedAt: Date.now() });
  const bucket = String(process.env.FANPAGE_ADMIN_STATS_BUCKET || DEFAULT_BUCKET).trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) throw new Error('Private snapshot bucket name is invalid.');
  const metadata = await uploadSnapshot(accessToken, bucket, snapshot);
  await reportExportUsage(rtdbReadBytes);
  console.log(JSON.stringify({
    project: PROJECT_ID,
    bucket,
    object: OBJECT_NAME,
    generation: metadata.generation || null,
    generatedAt: snapshot.generatedAt,
    streamerCount: snapshot.streamers.length,
    rtdbReadBytes,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Could not export private fanpage admin stats:', error);
    process.exitCode = 1;
  });
}

module.exports = { SOURCE_PATHS, buildAdminStatsSnapshotFromProjection, main, readAdminStatsProjection, uploadSnapshot };
