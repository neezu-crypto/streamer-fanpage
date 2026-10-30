'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SHARED_DATABASE_URL = 'https://soop-stock-market-default-rtdb.firebaseio.com';
const FANPAGE_DATABASE_URL = 'https://streamer-fanpage-rtdb.firebaseio.com';
const ROOTS = Object.freeze([
  'streamerFanPages',
  'streamerFanPageRecentVisits',
  'streamerFanPageStats',
  'streamerFanPageDailyVisitors',
  'streamerFanPageUpbo',
  'streamerFanPageVods',
  'streamerFanPageVodRefreshLocks',
  'streamerFanPageCalendarCache',
  'streamerFanPageSchedules',
  'streamerFanPageSongbooks',
  'streamerFanPageVideoLibrary',
  'streamerFanPagePlayedGames',
  'streamerFanPageMemories',
  'streamerFanPageRollingPapers',
  'streamerFanPageRollingPaperStickers',
  'streamerFanPageRollingPaperLimits',
  'streamerFanPageCafeCache',
  'streamerFanPageRouletteCache',
  'streamerFanPageYouTubeCache',
  'streamerFanPageVodComments',
  'streamerFanPageCommentProfiles',
  'streamerFanPageEmotes',
  'streamerFanPageDesignFeedback',
  'streamerFanPageDesignFeedbackLimits',
  'streamerFanPageTamagotchiApplications',
  'streamerFanPageTamagotchiProfiles',
  'streamerFanPageSponsorAds',
  'streamerFanPageSponsorRequests',
  'streamerFanPageSponsorPending',
  'streamerFanPageSponsorPlacementClaims',
  'streamerFanPageSponsorLimits',
  'streamerFanPageViewerStatsCache',
  'streamerFanPageViewerPeriodCache',
  'streamerFanPageViewerPeriodLocks',
  'streamerFanPageViewerStatsJobs',
  'streamerFanPageViewerStatsWorkerClaims',
  'streamerFanPageViewerStatsQueue',
  'streamerFanPageViewerStatsLimits',
  'streamerFanPageAdminMetrics',
]);
const REQUEST_TIMEOUT_MS = 120 * 1000;

function accessToken() {
  const token = execFileSync('gcloud', ['auth', 'print-access-token', '--project', 'soop-stock-market'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!token) throw new Error('Google Cloud 인증 토큰을 가져오지 못했습니다.');
  return token;
}

async function readPath(baseUrl, token, path) {
  const url = new URL(encodeURI(`${path}.json`), `${baseUrl}/`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} 읽기 실패 (${response.status}): ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : null;
}

async function writePath(token, path, value) {
  const url = new URL(encodeURI(`${path}.json`), `${FANPAGE_DATABASE_URL}/`);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} 쓰기 실패 (${response.status}): ${body.slice(0, 400)}`);
}

async function patchPath(token, root, updates) {
  const entries = Object.entries(updates);
  const chunkSize = 250;
  for (let offset = 0; offset < entries.length; offset += chunkSize) {
    const chunk = Object.fromEntries(entries.slice(offset, offset + chunkSize));
    const url = new URL(encodeURI(`${root}.json`), `${FANPAGE_DATABASE_URL}/`);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${root} 병합 실패 (${response.status}): ${body.slice(0, 400)}`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function nodeCount(value) {
  if (!value || typeof value !== 'object') return value === null || value === undefined ? 0 : 1;
  return Object.entries(value).reduce((count, [key, child]) => count + 1 + (key === '.value' ? 0 : nodeCount(child)), 0);
}

const MISSING = Symbol('missing');

function asStoredValue(value) {
  return value === null || value === undefined ? MISSING : value;
}

function getChild(value, key) {
  return value !== MISSING && value && typeof value === 'object' && Object.hasOwn(value, key)
    ? value[key]
    : MISSING;
}

function isRecord(value) {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left, right) {
  if (left === MISSING || right === MISSING) return left === right;
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function encodePath(parts) {
  return parts.map(String).join('/');
}

function collectSafeReconciliation(baseSource, baseTarget, currentSource, currentTarget) {
  const updates = {};
  let sourceOnlyChanges = 0;
  let conflicts = 0;

  function visit(baseSourceValue, baseTargetValue, sourceValue, targetValue, parts) {
    if (sameValue(baseSourceValue, sourceValue)) return;
    if (sameValue(baseTargetValue, targetValue)) {
      updates[encodePath(parts)] = sourceValue === MISSING ? null : sourceValue;
      sourceOnlyChanges += 1;
      return;
    }

    if ((isRecord(sourceValue) || sourceValue === MISSING) &&
        (isRecord(targetValue) || targetValue === MISSING) &&
        (isRecord(baseSourceValue) || baseSourceValue === MISSING) &&
        (isRecord(baseTargetValue) || baseTargetValue === MISSING)) {
      const keys = new Set();
      for (const value of [baseSourceValue, baseTargetValue, sourceValue, targetValue]) {
        if (isRecord(value)) Object.keys(value).forEach((key) => keys.add(key));
      }
      for (const key of keys) {
        visit(
          getChild(baseSourceValue, key),
          getChild(baseTargetValue, key),
          getChild(sourceValue, key),
          getChild(targetValue, key),
          [...parts, key],
        );
      }
      return;
    }

    conflicts += 1;
  }

  visit(asStoredValue(baseSource), asStoredValue(baseTarget), asStoredValue(currentSource),
    asStoredValue(currentTarget), []);
  return { updates, sourceOnlyChanges, conflicts };
}

async function snapshotBeforeCutover(token) {
  const baseline = { createdAt: new Date().toISOString(), roots: {} };
  for (const root of ROOTS) {
    const sourceValue = await readPath(SHARED_DATABASE_URL, token, root);
    await writePath(token, root, sourceValue);
    // Store the exact snapshot copied to the new database. Writes to the legacy DB
    // after this read are reconciled after function cutover.
    baseline.roots[root] = { source: sourceValue, target: sourceValue };
    console.log(`전환 기준 복사 완료: ${root} (${nodeCount(sourceValue)} 노드)`);
  }
  const filePath = path.join(os.tmpdir(), `streamer-fanpage-cutover-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(baseline));
  console.log(`전환 기준 스냅샷 저장: ${filePath}`);
  return filePath;
}

async function reconcileAfterCutover(token, baselineFile) {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const roots = baseline && baseline.roots;
  if (!roots || ROOTS.some((root) => !Object.hasOwn(roots, root))) {
    throw new Error('전환 기준 스냅샷에 필요한 DB 경로가 모두 들어 있지 않습니다.');
  }

  const report = [];
  for (const root of ROOTS) {
    const [sourceValue, targetValue] = await Promise.all([
      readPath(SHARED_DATABASE_URL, token, root),
      readPath(FANPAGE_DATABASE_URL, token, root),
    ]);
    const result = collectSafeReconciliation(
      roots[root].source,
      roots[root].target,
      sourceValue,
      targetValue,
    );
    const paths = Object.keys(result.updates);
    if (paths.length === 1 && paths[0] === '') {
      await writePath(token, root, result.updates['']);
    } else if (paths.length) {
      await patchPath(token, root, result.updates);
    }
    report.push({ root, updates: paths.length, conflicts: result.conflicts });
  }

  report.filter((row) => row.updates || row.conflicts).forEach((row) => {
    console.log(`${row.root}\t복구 경로 ${row.updates}개\t새 DB 변경과 충돌 ${row.conflicts}개`);
  });
  console.log(`전환 후 대조 완료: ${ROOTS.length}개 루트, 기준 ${baseline.createdAt}`);
}

async function main() {
  const mode = process.argv[2] || '--dry-run';
  if (mode === '--reconcile-after-cutover') {
    if (!process.argv[3]) throw new Error('--reconcile-after-cutover에는 전환 기준 스냅샷 경로가 필요합니다.');
    await reconcileAfterCutover(accessToken(), process.argv[3]);
    return;
  }
  if (!['--dry-run', '--apply', '--refresh-before-cutover', '--verify', '--snapshot-before-cutover'].includes(mode)) {
    throw new Error('사용법: node migrate-to-dedicated-database.js [--dry-run|--apply|--refresh-before-cutover|--verify|--snapshot-before-cutover|--reconcile-after-cutover <snapshot>]');
  }
  const token = accessToken();
  if (mode === '--snapshot-before-cutover') {
    await snapshotBeforeCutover(token);
    return;
  }
  const rows = [];

  for (const root of ROOTS) {
    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      readPath(SHARED_DATABASE_URL, token, root),
      readPath(FANPAGE_DATABASE_URL, token, root),
    ]);
    const sourceValue = sourceSnapshot;
    const targetValue = targetSnapshot;
    const sourceJson = JSON.stringify(sourceValue);
    const exactMatch = JSON.stringify(stableJson(sourceValue)) === JSON.stringify(stableJson(targetValue));
    rows.push({ root, sourceValue, targetExists: targetValue !== null, exactMatch,
      bytes: Buffer.byteLength(sourceJson || 'null', 'utf8'), nodes: nodeCount(sourceValue) });
  }

  if (mode === '--dry-run') {
    rows.forEach(({ root, targetExists, exactMatch, bytes, nodes }) => {
      console.log(`${root}\t${targetExists ? (exactMatch ? '이미 일치' : '대상 충돌') : '복사 대상'}\t${nodes} 노드\t${bytes} bytes`);
    });
    const conflicts = rows.filter((row) => row.targetExists && !row.exactMatch);
    if (conflicts.length) throw new Error(`대상 DB에 충돌 데이터가 있어 중단했습니다: ${conflicts.map((row) => row.root).join(', ')}`);
    return;
  }

  if (mode === '--verify') {
    const mismatches = rows.filter((row) => !row.exactMatch).map((row) => row.root);
    if (mismatches.length) throw new Error(`검증 불일치: ${mismatches.join(', ')}`);
    console.log(`검증 완료: ${ROOTS.length}개 루트가 공유 DB와 일치합니다.`);
    return;
  }

  const conflicts = rows.filter((row) => row.targetExists && !row.exactMatch);
  if (mode !== '--refresh-before-cutover' && conflicts.length) {
    throw new Error(`대상 DB에 서로 다른 데이터가 있어 쓰기 전에 중단했습니다: ${conflicts.map((row) => row.root).join(', ')}`);
  }

  if (mode === '--apply' || mode === '--refresh-before-cutover') {
    for (const row of rows) {
      if (mode === '--apply' && row.targetExists) continue;
      if (row.sourceValue === null) {
        if (mode === '--refresh-before-cutover' && row.targetExists) await writePath(token, row.root, null);
        continue;
      }
      await writePath(token, row.root, row.sourceValue);
      console.log(`${mode === '--apply' ? '복사' : '원본 기준 갱신'} 완료: ${row.root} (${row.nodes} 노드, ${row.bytes} bytes)`);
    }
  }

  const mismatches = [];
  for (const root of ROOTS) {
    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      readPath(SHARED_DATABASE_URL, token, root),
      readPath(FANPAGE_DATABASE_URL, token, root),
    ]);
    if (JSON.stringify(stableJson(sourceSnapshot)) !== JSON.stringify(stableJson(targetSnapshot))) {
      mismatches.push(root);
    }
  }
  if (mismatches.length) throw new Error(`검증 불일치: ${mismatches.join(', ')}`);
  console.log(`검증 완료: ${ROOTS.length}개 루트가 공유 DB와 일치합니다.`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
