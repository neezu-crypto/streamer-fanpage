'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pruneVerifiedStreamerVisitDedup, recordVerifiedStreamerVisit } = require('../verified-streamer-visits');

function makeDatabase({ failPush = false } = {}) {
  const values = new Map();
  const events = [];
  let shouldFailPush = failPush;
  const ref = (path) => ({
    async transaction(update) {
      const current = values.get(path);
      const next = update(current);
      if (next === undefined) return { committed: false };
      values.set(path, next);
      return { committed: true };
    },
    async remove() { values.delete(path); },
    async get() {
      const prefix = path + '/';
      const result = {};
      for (const [key, value] of values) {
        if (!key.startsWith(prefix)) continue;
        const child = key.slice(prefix.length).split('/')[0];
        result[child] = true;
      }
      return { val: () => Object.keys(result).length ? result : null };
    },
    async update(updates) {
      Object.entries(updates).forEach(([key, value]) => {
        const fullPath = path + '/' + key;
        if (value === null) {
          for (const storedKey of [...values.keys()]) {
            if (storedKey === fullPath || storedKey.startsWith(fullPath + '/')) values.delete(storedKey);
          }
        } else values.set(fullPath, value);
      });
    },
    push() {
      return {
        async set(value) {
          if (shouldFailPush) throw new Error('push failed');
          events.push(value);
        },
      };
    },
  });
  return { ref, values, events, setFailPush(value) { shouldFailPush = value; } };
}

const verified = { streamer: { soopId: 'Streamer01', nickname: '인증 스트리머' } };

test('records a verified highpoint visit once per SOOP ID, date, and market', async () => {
  const db = makeDatabase();
  assert.equal(await recordVerifiedStreamerVisit(db, verified, 'viewerStats', '2026-10-28', 1234), true);
  assert.equal(await recordVerifiedStreamerVisit(db, verified, 'viewerStats', '2026-10-28', 5678), false);
  assert.deepEqual(db.events, [{ nickname: '인증 스트리머', soopId: 'streamer01', market: 'viewerStats', visitedAt: 1234 }]);
});

test('keeps fanpage and highpoint visit notifications independent', async () => {
  const db = makeDatabase();
  assert.equal(await recordVerifiedStreamerVisit(db, verified, 'streamerFanPage', '2026-10-28'), true);
  assert.equal(await recordVerifiedStreamerVisit(db, verified, 'viewerStats', '2026-10-28'), true);
  assert.deepEqual(db.events.map((event) => event.market), ['streamerFanPage', 'viewerStats']);
});

test('does not record a malformed SOOP ID', async () => {
  const db = makeDatabase();
  assert.equal(await recordVerifiedStreamerVisit(db, { streamer: { soopId: '../invalid' } }, 'viewerStats', '2026-10-28'), false);
  assert.equal(db.events.length, 0);
});

test('clears dedup state when writing the visit event fails so a later retry can succeed', async () => {
  const db = makeDatabase({ failPush: true });
  await assert.rejects(recordVerifiedStreamerVisit(db, verified, 'viewerStats', '2026-10-28'), /push failed/);
  db.setFailPush(false);
  assert.equal(await recordVerifiedStreamerVisit(db, verified, 'viewerStats', '2026-10-28'), true);
});

test('prunes expired dedup dates for both markets and keeps today', async () => {
  const db = makeDatabase();
  db.values.set('verifiedStreamerVisitDedup/streamerFanPage/2026-10-27/streamer01', true);
  db.values.set('verifiedStreamerVisitDedup/streamerFanPage/2026-10-28/streamer01', true);
  db.values.set('verifiedStreamerVisitDedup/viewerStats/2026-10-27/streamer01', true);
  db.values.set('verifiedStreamerVisitDedup/viewerStats/2026-10-28/streamer01', true);
  await pruneVerifiedStreamerVisitDedup(db, ['streamerFanPage', 'viewerStats'], '2026-10-28');
  assert.deepEqual([...db.values.keys()].sort(), [
    'verifiedStreamerVisitDedup/streamerFanPage/2026-10-28/streamer01',
    'verifiedStreamerVisitDedup/viewerStats/2026-10-28/streamer01',
  ]);
});
