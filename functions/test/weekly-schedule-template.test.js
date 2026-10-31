'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTemplate, mayUseTemplate } = require('../weekly-schedule-template');
test('기존 일정과 오래된 클라이언트의 템플릿을 보존한다', () => {
  assert.equal(resolveTemplate(undefined, null), 'default');
  assert.equal(resolveTemplate(undefined, 'starlight'), 'starlight');
  assert.equal(resolveTemplate('default', 'starlight'), 'default');
  assert.equal(resolveTemplate('unknown', null), null);
});
test('전용 템플릿은 유효한 구독 또는 관리자에게만 허용한다', () => {
  assert.equal(mayUseTemplate('default', { now: 100 }), true);
  assert.equal(mayUseTemplate('starlight', { now: 100, expiresAt: 101 }), true);
  assert.equal(mayUseTemplate('starlight', { now: 100, expiresAt: 100 }), false);
  assert.equal(mayUseTemplate('starlight', { now: 100, expiresAt: 0 }), false);
  assert.equal(mayUseTemplate('starlight', { now: 100, isAdmin: true }), true);
  assert.equal(mayUseTemplate('unknown', { now: 100, isAdmin: true }), false);
});
