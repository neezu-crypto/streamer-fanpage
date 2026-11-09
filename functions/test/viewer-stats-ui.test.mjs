import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serviceFromHash, nextTabIndex, hasAnyPaidUnlock, shouldShowAffiliate, mergeSponsorStrip, bugReportStateFromError,
} from '../../viewer-stats-ui.mjs';

const none = { loaded: true, isAdmin: false, features: { period: false, same_day: false, keyword: false } };

test('serviceFromHash: 알 수 없는 값은 무료 탭', () => {
  assert.equal(serviceFromHash('#paid'), 'paid');
  assert.equal(serviceFromHash('bug'), 'bug');
  assert.equal(serviceFromHash('#x'), 'free');
  assert.equal(serviceFromHash(''), 'free');
});

test('nextTabIndex: 화살표 순환과 Home/End', () => {
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('a', 0, 3), null);
  assert.equal(nextTabIndex('Home', 0, 0), null);
});

test('hasAnyPaidUnlock: 하나라도 해금·관리자만 true, 미확인은 false', () => {
  assert.equal(hasAnyPaidUnlock(none), false);
  assert.equal(hasAnyPaidUnlock({ ...none, features: { ...none.features, keyword: true } }), true);
  assert.equal(hasAnyPaidUnlock({ ...none, isAdmin: true }), true);
  assert.equal(hasAnyPaidUnlock({ loaded: false, isAdmin: true, features: { period: true } }), false);
  assert.equal(hasAnyPaidUnlock(null), false);
});

test('shouldShowAffiliate: 인증 전·확인 실패는 숨김, 익명·미해금만 표시', () => {
  const member = { isAnonymous: false };
  assert.equal(shouldShowAffiliate({ authResolved: false, user: null, unlock: none }), false);
  assert.equal(shouldShowAffiliate({ authResolved: true, user: null, unlock: none }), true);
  assert.equal(shouldShowAffiliate({ authResolved: true, user: { isAnonymous: true }, unlock: { loaded: false } }), true);
  assert.equal(shouldShowAffiliate({ authResolved: true, user: member, unlock: { loaded: false } }), false);
  assert.equal(shouldShowAffiliate({ authResolved: true, user: member, unlock: none }), true);
  assert.equal(shouldShowAffiliate({ authResolved: true, user: member, unlock: { ...none, features: { period: true } } }), false);
  assert.equal(shouldShowAffiliate({ authResolved: true, user: member, unlock: { ...none, isAdmin: true } }), false);
});

test('mergeSponsorStrip: 교차 병합, 같은 스트리머 중복 제거, 신청 카드는 마지막 1장', () => {
  const left = [{ kind: 'ad', soopId: 'A' }, { kind: 'ad', soopId: 'b' }, { kind: 'open' }];
  const right = [{ kind: 'ad', soopId: 'a' }, { kind: 'pending' }, { kind: 'open' }];
  const out = mergeSponsorStrip(left, right);
  assert.deepEqual(out.map((i) => i.kind + (i.soopId || '')), ['adA', 'adb', 'pending', 'open']);
  assert.deepEqual(mergeSponsorStrip([], []), []);
  assert.deepEqual(mergeSponsorStrip([{ kind: 'open' }], [{ kind: 'open' }]), [{ kind: 'open' }]);
});

test('bugReportStateFromError: 서버 코드를 화면 상태로 변환', () => {
  assert.equal(bugReportStateFromError('functions/resource-exhausted'), 'rate-limited');
  assert.equal(bugReportStateFromError('already-exists'), 'error-conflict');
  assert.equal(bugReportStateFromError('functions/unauthenticated'), 'login-required');
  assert.equal(bugReportStateFromError('internal'), 'error-retry');
});
