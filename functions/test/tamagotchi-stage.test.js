'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTamagotchiStage, readTamagotchiStage, tamagotchiOpenFor, TAMAGOTCHI_STAGE_PATH } = require('../tamagotchi-stage');

const fakeDb = (value, fail = false) => ({ ref(path) { assert.equal(path, TAMAGOTCHI_STAGE_PATH); return { async get() { if (fail) throw new Error('down'); return { val: () => value }; } }; } });

test('알 수 없는 값·빈 값은 closed로 본다', () => {
  for (const v of [undefined, null, '', 'open', 'PUBLIC ', 3, {}]) {
    assert.equal(normalizeTamagotchiStage(v), v === 'PUBLIC ' ? 'public' : 'closed');
  }
  assert.equal(normalizeTamagotchiStage('admin'), 'admin');
});

test('단계 읽기: 값이 없거나 읽기 실패면 closed', async () => {
  assert.equal(await readTamagotchiStage(fakeDb(null)), 'closed');
  assert.equal(await readTamagotchiStage(fakeDb('public')), 'public');
  assert.equal(await readTamagotchiStage(fakeDb('public', true)), 'closed');
});

test('비관리자는 public에서만, 관리자는 항상 사용 가능', () => {
  assert.equal(tamagotchiOpenFor('closed', false), false);
  assert.equal(tamagotchiOpenFor('admin', false), false);
  assert.equal(tamagotchiOpenFor('public', false), true);
  for (const s of ['closed', 'admin', 'public']) assert.equal(tamagotchiOpenFor(s, true), true);
});
