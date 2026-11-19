'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROJECT_ID = 'soop-stock-market';
const DATABASE_URL = 'https://streamer-fanpage-rtdb.firebaseio.com';
const SOURCE_PATH = 'streamerFanPageViewerStatsCache';
const CACHE_SCHEMA_VERSION = 1;
const STATIC_SCHEMA_VERSION = 1;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const VOD_ID_PATTERN = /^\d{1,20}$/;
const RTDB_REQUEST_TIMEOUT_MS = 60 * 1000;
const RTDB_READ_CONCURRENCY = 8;
// 2026-11-19 증분 생성: 지난 공개 파일(Pages)을 출발점으로 삼고, 변경 목록(서버가 분석 완료 때 기록)에 있는 VOD만 읽는다.
const QUEUE_PATH = 'streamerFanPageViewerStatsExportQueue';
const PREVIOUS_BASE_URL = 'https://neezu-crypto.github.io/streamer-fanpage/static-data/viewer-stats/';
const QUEUE_OVERLAP_MS = 60 * 60 * 1000; // 시계 차이·늦게 커밋된 기록을 덮기 위해 지난 위치보다 1시간 앞부터 다시 읽는다
const FULL_REBUILD_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 주 1회 전체 재생성(누락·정리된 목록 보정)
const PREVIOUS_FETCH_CONCURRENCY = 8;
const PREVIOUS_FETCH_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validPoint(point) {
  return point && Number.isFinite(Number(point.second)) && Number(point.second) >= 0
    && Number.isFinite(Number(point.viewers)) && Number(point.viewers) >= 0;
}

// 캐시 기록 하나를 공개 요약으로 바꾼다. 공개 범위가 아니면(미완료·형식 불일치) null.
function publicVodSummary(streamerId, vodId, record) {
  if (!VOD_ID_PATTERN.test(vodId) || !record || record.status !== 'completed'
    || Number(record.schemaVersion) !== CACHE_SCHEMA_VERSION) return null;
  const stats = record.stats;
  if (!stats || String(stats.streamerId || '').trim().toLowerCase() !== streamerId
    || String(stats.vodId || '').trim() !== vodId
    || !validPoint(stats.highest) || !validPoint(stats.lowest)) return null;
  return {
    highest: { second: Number(stats.highest.second), viewers: Number(stats.highest.viewers) },
    lowest: { second: Number(stats.lowest.second), viewers: Number(stats.lowest.viewers) },
    checkedAt: Number(stats.checkedAt) || Number(record.analyzedAt) || 0,
  };
}

function snapshotsFromVodMap(vodMap, generatedAt) {
  const streamers = {};
  let vodCount = 0;
  Object.entries(vodMap).forEach(([streamerId, vods]) => {
    if (!vods || !Object.keys(vods).length) return;
    streamers[streamerId] = { schemaVersion: STATIC_SCHEMA_VERSION, streamerId, generatedAt, vods };
    vodCount += Object.keys(vods).length;
  });
  return { streamers, streamerCount: Object.keys(streamers).length, vodCount, generatedAt };
}

function buildPublicSnapshots(cache, generatedAt = new Date().toISOString()) {
  const vodMap = {};
  Object.entries(cache && typeof cache === 'object' ? cache : {}).forEach(([rawStreamerId, vodRecords]) => {
    const streamerId = String(rawStreamerId || '').trim().toLowerCase();
    if (!SOOP_ID_PATTERN.test(streamerId) || !vodRecords || typeof vodRecords !== 'object') return;
    const vods = {};
    Object.entries(vodRecords).forEach(([rawVodId, record]) => {
      const vodId = String(rawVodId || '').trim();
      const summary = publicVodSummary(streamerId, vodId, record);
      if (summary) vods[vodId] = summary;
    });
    vodMap[streamerId] = vods;
  });
  return snapshotsFromVodMap(vodMap, generatedAt);
}

// 변경 목록 키 "{스트리머}-{VOD}"를 나눈다.
function parseQueueKey(key) {
  const match = /^([a-z0-9]{2,20})-(\d{1,20})$/i.exec(String(key || ''));
  return match ? { streamerId: match[1].toLowerCase(), vodId: match[2] } : null;
}

// 지난 공개 결과 + 변경된 VOD 기록 → 새 결과. changed: [{ streamerId, vodId, record }]
function mergeIncrementalSnapshots(previousVodMap, changed, generatedAt = new Date().toISOString()) {
  const vodMap = {};
  Object.entries(previousVodMap || {}).forEach(([streamerId, vods]) => { vodMap[streamerId] = { ...vods }; });
  changed.forEach(({ streamerId, vodId, record }) => {
    const summary = publicVodSummary(streamerId, vodId, record);
    if (summary) {
      vodMap[streamerId] = vodMap[streamerId] || {};
      vodMap[streamerId][vodId] = summary;
    } else if (vodMap[streamerId] && record == null) {
      delete vodMap[streamerId][vodId]; // 캐시에서 지워진 VOD는 공개 파일에서도 뺀다
    }
  });
  return snapshotsFromVodMap(vodMap, generatedAt);
}

// 전체 재생성이 필요한지: 강제 지정, 지난 결과 없음·형식 다름, 위치 정보 없음, 마지막 전체 재생성 7일 경과.
function needsFullRebuild(previousIndex, now = Date.now(), forced = false) {
  if (forced) return 'forced';
  if (!previousIndex || Number(previousIndex.schemaVersion) !== STATIC_SCHEMA_VERSION) return 'no-previous';
  if (!Number.isFinite(Number(previousIndex.queueCursor)) || !Number(previousIndex.queueCursor)) return 'no-cursor';
  if (!(now - Number(previousIndex.fullBuiltAt) < FULL_REBUILD_INTERVAL_MS)) return 'weekly';
  return '';
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const item = items[cursor++]; await worker(item); }
  }));
}

// 지난 공개 파일을 Pages에서 받는다(데이터베이스 비용 없음). 하나라도 실패하면 null → 전체 재생성.
async function fetchPreviousExport(baseUrl = PREVIOUS_BASE_URL, fetchImpl = fetch, retryDelayMs = 1000) {
  //  Pages가 잠깐 503·429를 낼 수 있어 일시 오류와 네트워크 오류는 3번까지 다시 시도한다(2026-11-19 첫 운영 실행에서 503 1건).
  const getJson = async (name) => {
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(new URL(name, baseUrl), { cache: 'no-store', signal: AbortSignal.timeout(RTDB_REQUEST_TIMEOUT_MS) });
      } catch (error) {
        if (attempt >= PREVIOUS_FETCH_ATTEMPTS) throw error;
        await sleep(retryDelayMs * attempt); continue;
      }
      if (response.ok) return response.json();
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= PREVIOUS_FETCH_ATTEMPTS) throw new Error('previous export ' + name + ' ' + response.status);
      await sleep(retryDelayMs * attempt);
    }
  };
  try {
    const index = await getJson('index.json');
    if (!index || Number(index.schemaVersion) !== STATIC_SCHEMA_VERSION || !index.streamers) return null;
    const vodMap = {};
    await runPool(Object.keys(index.streamers).filter((id) => SOOP_ID_PATTERN.test(id)), PREVIOUS_FETCH_CONCURRENCY, async (streamerId) => {
      const payload = await getJson(encodeURIComponent(streamerId) + '.json');
      if (!payload || String(payload.streamerId || '').toLowerCase() !== streamerId || !payload.vods) {
        throw new Error('previous export file mismatch: ' + streamerId);
      }
      vodMap[streamerId] = payload.vods;
    });
    return { index, vodMap };
  } catch (error) {
    console.warn('Could not load the previous public export; falling back to a full rebuild.', error.message);
    return null;
  }
}

async function createRtdbReader() {
  const { applicationDefault } = require('firebase-admin/app');
  const credential = applicationDefault();
  console.log('Requesting a read-only token for the RTDB export.');
  const { access_token: accessToken } = await credential.getAccessToken();
  if (!accessToken) throw new Error('Google Cloud did not return an access token.');

  const reader = { bytes: 0 };
  reader.readJson = async (pathname, query = {}) => {
    const url = new URL(encodeURI(pathname + '.json'), DATABASE_URL + '/');
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RTDB_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + accessToken },
        signal: controller.signal,
      });
      const body = await response.text();
      reader.bytes += Buffer.byteLength(body, 'utf8');
      if (!response.ok) {
        throw new Error('RTDB request failed (' + response.status + '): ' + body.slice(0, 500));
      }
      return body ? JSON.parse(body) : null;
    } finally {
      clearTimeout(timeout);
    }
  };
  return reader;
}

async function readFullCache(readJson) {
  console.log('Listing streamer keys in the persistent VOD stats cache.');
  const streamerKeys = await readJson(SOURCE_PATH, { shallow: 'true' });
  const streamerIds = Object.keys(streamerKeys && typeof streamerKeys === 'object' ? streamerKeys : {})
    .map((streamerId) => String(streamerId).trim().toLowerCase())
    .filter((streamerId) => SOOP_ID_PATTERN.test(streamerId));
  console.log('Found ' + streamerIds.length + ' streamer cache entries; reading them in small batches.');
  const cache = {};
  let completed = 0;
  await runPool(streamerIds, RTDB_READ_CONCURRENCY, async (streamerId) => {
    cache[streamerId] = await readJson(SOURCE_PATH + '/' + encodeURIComponent(streamerId));
    completed += 1;
    if (completed % 25 === 0 || completed === streamerIds.length) {
      console.log('Read ' + completed + ' / ' + streamerIds.length + ' streamer cache entries.');
    }
  });
  return cache;
}

// 지난 위치(1시간 겹침) 이후 변경 목록만 값 순서로 읽고, 그 VOD 기록만 하나씩 읽는다.
async function readChangedRecords(readJson, queueCursor) {
  const since = Math.max(0, Number(queueCursor) - QUEUE_OVERLAP_MS);
  const queue = await readJson(QUEUE_PATH, { orderBy: '"$value"', startAt: String(since) }) || {};
  let nextCursor = Number(queueCursor) || 0;
  const targets = [];
  Object.entries(queue).forEach(([key, value]) => {
    const parsed = parseQueueKey(key);
    if (!parsed) return;
    targets.push(parsed);
    if (Number(value) > nextCursor) nextCursor = Number(value);
  });
  console.log('Found ' + targets.length + ' changed VOD(s) since ' + new Date(since).toISOString() + '.');
  const changed = [];
  await runPool(targets, RTDB_READ_CONCURRENCY, async ({ streamerId, vodId }) => {
    const record = await readJson(SOURCE_PATH + '/' + encodeURIComponent(streamerId) + '/' + encodeURIComponent(vodId));
    changed.push({ streamerId, vodId, record });
  });
  return { changed, nextCursor };
}

async function writeSnapshots(outputDirectory, snapshots, exportMeta = {}) {
  const outputPath = path.resolve(outputDirectory);
  const parentDirectory = path.dirname(outputPath);
  const temporaryPath = outputPath + '.tmp-' + process.pid;
  await fs.mkdir(parentDirectory, { recursive: true });
  await fs.rm(temporaryPath, { recursive: true, force: true });
  await fs.mkdir(temporaryPath, { recursive: true });

  try {
    for (const [streamerId, payload] of Object.entries(snapshots.streamers)) {
      await fs.writeFile(
        path.join(temporaryPath, streamerId + '.json'),
        JSON.stringify(payload),
      );
    }
    const counts = Object.fromEntries(Object.entries(snapshots.streamers)
      .map(([streamerId, payload]) => [streamerId, Object.keys(payload.vods).length]));
    await fs.writeFile(path.join(temporaryPath, 'index.json'), JSON.stringify({
      schemaVersion: STATIC_SCHEMA_VERSION,
      generatedAt: snapshots.generatedAt,
      streamerCount: snapshots.streamerCount,
      vodCount: snapshots.vodCount,
      // 증분 생성 위치(서버 시각 ms)와 마지막 전체 재생성 시각. 공개해도 되는 시각 값만 담는다.
      queueCursor: Number(exportMeta.queueCursor) || 0,
      fullBuiltAt: Number(exportMeta.fullBuiltAt) || 0,
      streamers: counts,
    }));
    await fs.rm(outputPath, { recursive: true, force: true });
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const outputDirectory = process.env.VIEWER_STATS_EXPORT_DIR
    || path.resolve(__dirname, '..', 'static-data', 'viewer-stats');
  let snapshots; let exportMeta; let rtdbReadBytes = 0; let mode;
  if (process.env.VIEWER_STATS_EXPORT_INPUT) {
    const cache = JSON.parse(await fs.readFile(process.env.VIEWER_STATS_EXPORT_INPUT, 'utf8'));
    snapshots = buildPublicSnapshots(cache); exportMeta = { queueCursor: 0, fullBuiltAt: 0 }; mode = 'local-input';
  } else {
    const startedAt = Date.now();
    const forced = /^(1|true|full)$/i.test(String(process.env.VIEWER_STATS_EXPORT_FULL || '').trim());
    const previous = forced ? null : await fetchPreviousExport(process.env.VIEWER_STATS_EXPORT_PREVIOUS_URL || PREVIOUS_BASE_URL);
    const fullReason = needsFullRebuild(previous && previous.index, startedAt, forced);
    const reader = await createRtdbReader();
    if (fullReason) {
      console.log('Full rebuild (' + fullReason + ').');
      snapshots = buildPublicSnapshots(await readFullCache(reader.readJson));
      // 전체 읽기 시작 시각을 위치로 삼는다(겹침 1시간이 그 사이 기록을 덮는다).
      exportMeta = { queueCursor: startedAt, fullBuiltAt: startedAt }; mode = 'full:' + fullReason;
    } else {
      const { changed, nextCursor } = await readChangedRecords(reader.readJson, previous.index.queueCursor);
      snapshots = mergeIncrementalSnapshots(previous.vodMap, changed);
      exportMeta = { queueCursor: nextCursor, fullBuiltAt: previous.index.fullBuiltAt }; mode = 'incremental:' + changed.length;
    }
    rtdbReadBytes = reader.bytes;
  }
  await writeSnapshots(outputDirectory, snapshots, exportMeta);
  const reportUrl = String(process.env.VIEWER_STATS_USAGE_REPORT_URL || '').trim();
  const reportToken = String(process.env.VIEWER_STATS_USAGE_REPORT_TOKEN || '').trim();
  if (reportUrl || reportToken) {
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
      signal: AbortSignal.timeout(RTDB_REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error('Could not report static export usage (' + response.status + '): ' + body.slice(0, 500));
    }
  }
  console.log('Mode ' + mode + '. Exported ' + snapshots.vodCount + ' public VOD summaries for '
    + snapshots.streamerCount + ' streamers to ' + path.resolve(outputDirectory)
    + '; RTDB response payload ' + rtdbReadBytes + ' bytes.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Could not export VOD viewer stats:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPublicSnapshots, writeSnapshots, publicVodSummary, mergeIncrementalSnapshots, needsFullRebuild,
  parseQueueKey, fetchPreviousExport, readChangedRecords,
};
