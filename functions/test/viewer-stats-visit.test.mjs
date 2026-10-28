import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerStatsVisitNotifier } from '../../viewer-stats-visit.mjs';

test('does not call the server for missing or anonymous users', async () => {
  let calls = 0;
  const notify = createViewerStatsVisitNotifier(async () => { calls += 1; });
  assert.equal(await notify(null), false);
  assert.equal(await notify({ uid: 'anon', isAnonymous: true }), false);
  assert.equal(calls, 0);
});

test('calls once for each signed-in UID even if auth state repeats', async () => {
  const calls = [];
  const notify = createViewerStatsVisitNotifier(async () => { calls.push('called'); });
  assert.equal(await notify({ uid: 'verified-uid', isAnonymous: false }), true);
  assert.equal(await notify({ uid: 'verified-uid', isAnonymous: false }), false);
  assert.equal(await notify({ uid: 'another-uid', isAnonymous: false }), true);
  assert.equal(calls.length, 2);
});

test('allows retry after a callable failure and reports the error', async () => {
  let calls = 0;
  const errors = [];
  const notify = createViewerStatsVisitNotifier(async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
  }, (error) => errors.push(error.message));
  assert.equal(await notify({ uid: 'verified-uid', isAnonymous: false }), false);
  assert.equal(await notify({ uid: 'verified-uid', isAnonymous: false }), true);
  assert.deepEqual(errors, ['offline']);
});
