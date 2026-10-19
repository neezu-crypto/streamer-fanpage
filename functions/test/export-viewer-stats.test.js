'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildPublicSnapshots, writeSnapshots } = require('../export-viewer-stats');

function completedRecord(streamerId, vodId, extra = {}) {
  return {
    status: 'completed',
    schemaVersion: 1,
    analyzedAt: 1750000000000,
    stats: {
      streamerId,
      vodId,
      highest: { second: 600, viewers: 1800 },
      lowest: { second: 900, viewers: 20 },
      averageViewers: 500,
      checkedAt: 1750000000000,
      ...extra,
    },
  };
}

test('exports only completed, valid public peak summaries and omits premium averages', () => {
  const output = buildPublicSnapshots({
    hwt1014: {
      '1234567890': completedRecord('hwt1014', '1234567890'),
      '1234567891': { ...completedRecord('hwt1014', '1234567891'), status: 'processing' },
      '1234567892': completedRecord('other', '1234567892'),
    },
    'invalid/id': { '1234567893': completedRecord('invalid/id', '1234567893') },
  }, '2026-10-19T00:00:00.000Z');

  assert.equal(output.streamerCount, 1);
  assert.equal(output.vodCount, 1);
  assert.deepEqual(output.streamers.hwt1014.vods['1234567890'], {
    highest: { second: 600, viewers: 1800 },
    lowest: { second: 900, viewers: 20 },
    checkedAt: 1750000000000,
  });
  assert.equal(JSON.stringify(output).includes('averageViewers'), false);
});

test('writes per-streamer files and replaces stale exports', async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanpage-viewer-export-'));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const outputDirectory = path.join(temporaryDirectory, 'static-data', 'viewer-stats');
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, 'stale.json'), '{}');

  const snapshots = buildPublicSnapshots({
    hwt1014: { '1234567890': completedRecord('hwt1014', '1234567890') },
  }, '2026-10-19T00:00:00.000Z');
  await writeSnapshots(outputDirectory, snapshots);

  const files = (await fs.readdir(outputDirectory)).sort();
  assert.deepEqual(files, ['hwt1014.json', 'index.json']);
  const streamer = JSON.parse(await fs.readFile(path.join(outputDirectory, 'hwt1014.json'), 'utf8'));
  assert.equal(streamer.streamerId, 'hwt1014');
  assert.equal(streamer.vods['1234567890'].highest.viewers, 1800);
});
