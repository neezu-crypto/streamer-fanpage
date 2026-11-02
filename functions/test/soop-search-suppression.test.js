const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSuppressedSoopSearchQuery,
  isSuppressedSoopSearchResult,
} = require('../soopSearchSuppression');

test('SOOP search suppresses the requested nickname and its station ID', () => {
  assert.equal(isSuppressedSoopSearchQuery('나리$'), true);
  assert.equal(isSuppressedSoopSearchQuery(' 나리 ＄ '), true);
  assert.equal(isSuppressedSoopSearchQuery('NAAARY'), true);
  assert.equal(isSuppressedSoopSearchQuery('나리'), false);
});

test('SOOP API results are suppressed by nickname or station ID, including partial searches', () => {
  assert.equal(isSuppressedSoopSearchResult({ id: 'naaary', nickname: '다른 표기' }), true);
  assert.equal(isSuppressedSoopSearchResult({ soopId: 'otherid', nickname: '나리$' }), true);
  assert.equal(isSuppressedSoopSearchResult({ id: 'otherid', nickname: '나리' }), false);
});
