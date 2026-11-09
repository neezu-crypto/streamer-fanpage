// 고점체크 화면의 순수 판정 로직. DOM·Firebase에 의존하지 않아 node --test로 검증한다.

export const VIEWER_SERVICES = ['free', 'paid', 'bug'];

export function serviceFromHash(hash) {
  const name = String(hash || '').replace(/^#/, '');
  return VIEWER_SERVICES.includes(name) ? name : 'free';
}

// WAI-ARIA 탭 키보드 규칙: ←/→ 순환, Home/End. 해당하지 않는 키는 null.
export function nextTabIndex(key, current, count) {
  if (!Number.isInteger(count) || count < 1) return null;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

// 기능 하나라도 해금했거나 관리자면 true. 해금 상태를 아직 모르면 false.
export function hasAnyPaidUnlock(unlock) {
  if (!unlock || unlock.loaded !== true) return false;
  if (unlock.isAdmin === true) return true;
  return Object.values(unlock.features || {}).some((value) => value === true);
}

// 제휴 카드 노출 판정.
// - 인증 복원 전: 표시하지 않는다(로그인 사용자의 깜빡임 방지).
// - 익명·미로그인: 표시.
// - 로그인 계정: 해금 상태를 확인한 뒤, 하나도 해금하지 않은 경우만 표시.
//   확인에 실패해 상태를 모르면 표시하지 않는다.
export function shouldShowAffiliate({ authResolved, user, unlock }) {
  if (!authResolved) return false;
  if (!user || user.isAnonymous) return true;
  if (!unlock || unlock.loaded !== true) return false;
  return !hasAnyPaidUnlock(unlock);
}

// 모바일 후원 스트립: 좌·우 레일 항목을 번갈아 합치되 같은 스트리머는 한 번만 둔다.
// 신청(open) 카드는 스트립 전체에서 마지막에 한 장만 둔다.
// 항목 형태: { kind: 'ad'|'pending'|'open', soopId?: string }
export function mergeSponsorStrip(left, right) {
  const out = [];
  const seen = new Set();
  let hasOpen = false;
  const max = Math.max(left.length, right.length);
  const push = (item) => {
    if (!item) return;
    if (item.kind === 'open') { hasOpen = true; return; }
    if (item.kind === 'ad') {
      const id = String(item.soopId || '').toLowerCase();
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
    }
    out.push(item);
  };
  for (let i = 0; i < max; i += 1) { push(left[i]); push(right[i]); }
  if (hasOpen) out.push({ kind: 'open' });
  return out;
}

// 버그 제보 서버 오류 → 화면 상태. 문구는 호출부가 결정한다.
export function bugReportStateFromError(code) {
  const value = String(code || '').replace(/^functions\//, '');
  if (value === 'resource-exhausted') return 'rate-limited';
  if (value === 'already-exists') return 'error-conflict';
  if (value === 'unauthenticated') return 'login-required';
  return 'error-retry';
}
