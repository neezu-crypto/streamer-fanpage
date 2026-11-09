const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeVerifySearchQuery, shapeVerifySearchResults, createVerifySearchLimiter, MAX_RESULTS,
} = require('../verification-search');

test('query: trims, lowercases, rejects too long, empties too short', () => {
  assert.equal(normalizeVerifySearchQuery('  Gam  Seu '), 'gam seu');
  assert.equal(normalizeVerifySearchQuery('a'), '');
  assert.equal(normalizeVerifySearchQuery(null), '');
  assert.equal(normalizeVerifySearchQuery('x'.repeat(41)), null);
  assert.equal(normalizeVerifySearchQuery('감스'), '감스');
});

test('results: minimal fields, dedupe by id, exact match first, capped', () => {
  const rows = [
    { nickname: '[감스트]디마', soopId: 'ados777', favoriteCount: 5, avatarUrl: 'u1' },
    { nickname: '감스트', soopId: 'devil0108', favoriteCount: 9, avatarUrl: 'u2' },
    { nickname: '감스트', soopId: 'DEVIL0108', avatarUrl: 'u3' },
    { nickname: '', soopId: 'noname' },
    { nickname: 'bad id', soopId: 'x' },
    { nickname: 'n'.repeat(21), soopId: 'toolong' },
  ];
  const out = shapeVerifySearchResults(rows, '감스트');
  assert.deepEqual(out.map((r) => r.soopId), ['devil0108', 'ados777']);
  assert.deepEqual(Object.keys(out[0]).sort(), ['avatarUrl', 'nickname', 'soopId']);
  const many = Array.from({ length: 30 }, (_, i) => ({ nickname: 'n' + i, soopId: 'id' + i }));
  assert.equal(shapeVerifySearchResults(many, 'n').length, MAX_RESULTS);
  assert.deepEqual(shapeVerifySearchResults(null, 'a'), []);
});

test('limiter: per-uid window and recovery', () => {
  const allow = createVerifySearchLimiter({ windowMs: 1000, maxCalls: 3, maxUids: 2 });
  assert.equal(allow('a', 0).ok, true);
  assert.equal(allow('a', 10).ok, true);
  assert.equal(allow('a', 20).ok, true);
  const blocked = allow('a', 30);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterMs, 970);
  assert.equal(allow('b', 30).ok, true);
  assert.equal(allow('a', 1001).ok, true);
  allow('c', 1002); allow('d', 1003);
  assert.equal(allow('a', 1004).ok, true);
});
