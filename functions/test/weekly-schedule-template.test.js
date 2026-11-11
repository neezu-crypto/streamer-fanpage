'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTemplate, mayUseTemplate, isPremiumTemplate } = require('../weekly-schedule-template');
const { hasPaidDesign } = require('../design-pass');

test('기본 템플릿은 누구나, 고급 템플릿은 유료 디자인 이용권이 있는 인증 스트리머와 관리자만', () => {
  assert.equal(mayUseTemplate('default'), true);
  assert.equal(mayUseTemplate('starlight'), false);
  assert.equal(mayUseTemplate('starlight', { isVerifiedStreamer: true }), false);
  assert.equal(mayUseTemplate('starlight', { hasPaidDesign: true }), false); // 인증 스트리머 본인이 아니면 불가
  assert.equal(mayUseTemplate('starlight', { isVerifiedStreamer: true, hasPaidDesign: true }), true);
  assert.equal(mayUseTemplate('starlight', { isAdmin: true }), true);
});

test('알 수 없는 템플릿은 거절하고 모든 비기본 템플릿은 고급으로 취급한다', () => {
  assert.equal(resolveTemplate('nope', 'default'), null);
  assert.equal(resolveTemplate(undefined, 'starlight'), 'starlight');
  assert.equal(isPremiumTemplate('default'), false);
  assert.equal(isPremiumTemplate('starlight'), true);
  assert.equal(mayUseTemplate('nope', { isAdmin: true }), false);
});

test('유료 디자인 판정은 특정 디자인이 아니라 활성 이용권 하나라도 있으면 참', async () => {
  const mk = (value) => ({ ref: () => ({ get: async () => ({ val: () => value }) }) });
  assert.equal(await hasPaidDesign(mk(null), 'gmyo0o'), false);
  assert.equal(await hasPaidDesign(mk({ layout3: { status: 'active' } }), 'gmyo0o'), true);
  assert.equal(await hasPaidDesign(mk({ layoutX: { status: 'active' } }), 'gmyo0o'), true);
  assert.equal(await hasPaidDesign(mk({ layout3: { status: 'refunded' } }), 'gmyo0o'), false);
  assert.equal(await hasPaidDesign(mk({ layout3: { status: 'active' } }), '../x'), false);
});

test('서버 유료 템플릿 목록이 클라이언트 레지스트리와 일치한다', async () => {
  const assert = require('node:assert/strict');
  const { PREMIUM_TEMPLATES } = require('../weekly-schedule-template');
  const registry = await import('../../weekly-schedule-templates.mjs');
  assert.deepEqual([...PREMIUM_TEMPLATES].sort(), [...registry.WEEKLY_PREMIUM_TEMPLATE_IDS].sort());
});
