'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CASH_PER_DAY, MAX_DAYS, __test } = require('../viewer-sponsors');

test('오늘의 후원 스트리머 결제는 하루 10캐시와 30일 상한을 사용한다', () => {
  assert.equal(CASH_PER_DAY, 10);
  assert.equal(MAX_DAYS, 30);
});

test('SOOP 아이디와 공개 카드 응답을 안전하게 정리한다', () => {
  assert.equal(__test.normalizeSoopId('  OIGUU5252 '), 'oiguu5252');
  assert.equal(__test.profileImageUrl('oiguu5252'), 'https://stimg.sooplive.com/LOGO/oi/oiguu5252/oiguu5252.jpg');
  const publicCard = __test.toPublicCampaign({
    nickname: '온이유_', soopId: 'OIGUU5252', rail: 'right', startsAt: 10, expiresAt: 20,
  }, 'payment_0000000001');
  assert.deepEqual(publicCard, {
    campaignId: 'payment_0000000001', nickname: '온이유_', soopId: 'oiguu5252',
    avatarUrl: 'https://stimg.sooplive.com/LOGO/oi/oiguu5252/oiguu5252.jpg',
    stationUrl: 'https://www.sooplive.com/station/oiguu5252', rail: 'right', startsAt: 10, expiresAt: 20,
  });
});

test('결제 요청 번호는 충분히 긴 안전한 값만 허용한다', () => {
  assert.equal(__test.validateRequestId('cash_promotion_20261108').length, 23);
  assert.throws(() => __test.validateRequestId('too-short'), /결제 요청/);
  assert.throws(() => __test.validateRequestId('../../unsafe-request-id-000'), /결제 요청/);
});

test('활성·미만료 캠페인만 공개 목록에 남긴다', () => {
  const now = 1000;
  const campaigns = __test.cleanCampaigns({
    active: { status: 'active', expiresAt: 1001 },
    expired: { status: 'active', expiresAt: 1000 },
    pending: { status: 'pending', expiresAt: 5000 },
  }, now);
  assert.deepEqual(campaigns, [{ campaignId: 'active', status: 'active', expiresAt: 1001 }]);
});
