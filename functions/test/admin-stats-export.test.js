'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SOURCE_PATHS, uploadSnapshot } = require('../export-admin-stats');

test('scheduled exporter reads only the server-side reporting projection', () => {
  assert.ok(Object.keys(SOURCE_PATHS).includes('metadata'));
  assert.ok(Object.values(SOURCE_PATHS).length >= 8);
  assert.ok(Object.values(SOURCE_PATHS).every((path) => path.startsWith('streamerFanPageAdminMetrics/v1/')));
  assert.equal(Object.values(SOURCE_PATHS).some((path) => [
    'streamerVerifications',
    'streamerFanPageStats',
    'streamerFanPageViewerStatsLimits',
    'streamerFanPageViewerStatsQueue',
  ].includes(path)), false);
});

test('creates the first private snapshot with a no-overwrite generation precondition', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ generation: '10' });
  };
  try {
    const result = await uploadSnapshot('token', 'private-bucket', { schemaVersion: 1 });
    assert.equal(result.generation, '10');
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).searchParams.get('ifGenerationMatch'), '0');
    assert.equal(calls[0].options.method, 'POST');
  } finally {
    global.fetch = originalFetch;
  }
});

test('replaces the existing snapshot only against its observed generation', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return new Response('', { status: 412 });
    if (calls.length === 2) return Response.json({ generation: '22' });
    return Response.json({ generation: '23' });
  };
  try {
    const result = await uploadSnapshot('token', 'private-bucket', { schemaVersion: 1 });
    assert.equal(result.generation, '23');
    assert.equal(calls.length, 3);
    assert.equal(new URL(calls[0].url).searchParams.get('ifGenerationMatch'), '0');
    assert.equal(new URL(calls[2].url).searchParams.get('ifGenerationMatch'), '22');
  } finally {
    global.fetch = originalFetch;
  }
});

test('keeps the previous object untouched when snapshot upload fails', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response('storage unavailable', { status: 503 });
  };
  try {
    await assert.rejects(uploadSnapshot('token', 'private-bucket', { schemaVersion: 1 }), /503/);
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
