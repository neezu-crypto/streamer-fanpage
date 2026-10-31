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
test('별빛 템플릿은 인증 스트리머 또는 관리자에게 허용한다', () => {
  assert.equal(mayUseTemplate('default'), true);
  assert.equal(mayUseTemplate('starlight'), false);
  assert.equal(mayUseTemplate('starlight', { expiresAt: Date.now() + 86400000 }), false);
  assert.equal(mayUseTemplate('starlight', { isVerifiedStreamer: true, expiresAt: 0 }), true);
  assert.equal(mayUseTemplate('starlight', { isVerifiedStreamer: true }), true);
  assert.equal(mayUseTemplate('starlight', { isAdmin: true }), true);
  assert.equal(mayUseTemplate('unknown', { isAdmin: true, isVerifiedStreamer: true }), false);
});
