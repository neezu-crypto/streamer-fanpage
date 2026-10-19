'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROJECT_ID = 'soop-stock-market';
const DATABASE_URL = 'https://soop-stock-market-default-rtdb.firebaseio.com';
const SOURCE_PATH = 'streamerFanPageViewerStatsCache';
const CACHE_SCHEMA_VERSION = 1;
const STATIC_SCHEMA_VERSION = 1;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const VOD_ID_PATTERN = /^\d{1,20}$/;

function validPoint(point) {
  return point && Number.isFinite(Number(point.second)) && Number(point.second) >= 0
    && Number.isFinite(Number(point.viewers)) && Number(point.viewers) >= 0;
}

function buildPublicSnapshots(cache, generatedAt = new Date().toISOString()) {
  const streamers = {};
  let vodCount = 0;

  Object.entries(cache && typeof cache === 'object' ? cache : {}).forEach(([rawStreamerId, vodRecords]) => {
    const streamerId = String(rawStreamerId || '').trim().toLowerCase();
    if (!SOOP_ID_PATTERN.test(streamerId) || !vodRecords || typeof vodRecords !== 'object') return;
    const vods = {};

    Object.entries(vodRecords).forEach(([rawVodId, record]) => {
      const vodId = String(rawVodId || '').trim();
      if (!VOD_ID_PATTERN.test(vodId) || !record || record.status !== 'completed'
        || Number(record.schemaVersion) !== CACHE_SCHEMA_VERSION) return;
      const stats = record.stats;
      if (!stats || String(stats.streamerId || '').trim().toLowerCase() !== streamerId
        || String(stats.vodId || '').trim() !== vodId
        || !validPoint(stats.highest) || !validPoint(stats.lowest)) return;

      vods[vodId] = {
        highest: {
          second: Number(stats.highest.second),
          viewers: Number(stats.highest.viewers),
        },
        lowest: {
          second: Number(stats.lowest.second),
          viewers: Number(stats.lowest.viewers),
        },
        checkedAt: Number(stats.checkedAt) || Number(record.analyzedAt) || 0,
      };
    });

    if (Object.keys(vods).length) {
      streamers[streamerId] = {
        schemaVersion: STATIC_SCHEMA_VERSION,
        streamerId,
        generatedAt,
        vods,
      };
      vodCount += Object.keys(vods).length;
    }
  });

  return { streamers, streamerCount: Object.keys(streamers).length, vodCount, generatedAt };
}

async function readPersistentCache() {
  if (process.env.VIEWER_STATS_EXPORT_INPUT) {
    const input = await fs.readFile(process.env.VIEWER_STATS_EXPORT_INPUT, 'utf8');
    return JSON.parse(input);
  }

  const { applicationDefault, initializeApp } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');
  const app = initializeApp({
    credential: applicationDefault(),
    databaseURL: DATABASE_URL,
    projectId: PROJECT_ID,
  }, 'viewer-stats-static-export');
  const snapshot = await getDatabase(app).ref(SOURCE_PATH).get();
  return snapshot.val() || {};
}

async function writeSnapshots(outputDirectory, snapshots) {
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
  const cache = await readPersistentCache();
  const snapshots = buildPublicSnapshots(cache);
  const outputDirectory = process.env.VIEWER_STATS_EXPORT_DIR
    || path.resolve(__dirname, '..', 'static-data', 'viewer-stats');
  await writeSnapshots(outputDirectory, snapshots);
  console.log('Exported ' + snapshots.vodCount + ' public VOD summaries for '
    + snapshots.streamerCount + ' streamers to ' + path.resolve(outputDirectory));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Could not export VOD viewer stats:', error);
    process.exitCode = 1;
  });
}

module.exports = { buildPublicSnapshots, writeSnapshots };
