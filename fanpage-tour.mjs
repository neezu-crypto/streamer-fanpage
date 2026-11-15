// 팬페이지 체험형 안내: 실제 화면 요소를 강조하고, 사용자가 직접 눌러 보면 다음 단계로 넘어간다.
// 진행 여부는 이 브라우저(localStorage)에만 저장하고 서버에는 아무것도 보내지 않는다.
const STORE_KEY = 'streamerFanPage.tabTours.v1';
let active = null;

function readDone() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}
export function tourDone(id) { return Boolean(readDone()[id]); }
function markDone(id) {
  try { const done = readDone(); done[id] = Date.now(); localStorage.setItem(STORE_KEY, JSON.stringify(done)); } catch { /* 저장 불가 브라우저는 매번 안내 */ }
}

function waitForElement(resolve, timeoutMs = 4000) {
  return new Promise((done) => {
    const started = performance.now();
    (function poll() {
      const el = resolve();
      if (el && el.isConnected && el.getClientRects().length) return done(el);
      if (performance.now() - started > timeoutMs) return done(null);
      setTimeout(poll, 120);
    })();
  });
}

export function stopTour() {
  if (!active) return;
  active.cleanup();
  active = null;
}

// steps: [{ target: () => Element, text, action?: '눌러 보세요' 문구, waitClick?: true }]
export async function startTour(id, steps, { force = false } = {}) {
  if (!force && tourDone(id)) return;
  stopTour();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const ring = document.createElement('div'); ring.className = 'fp-tour-ring'; ring.setAttribute('aria-hidden', 'true');
  const bubble = document.createElement('div'); bubble.className = 'fp-tour-bubble'; bubble.setAttribute('role', 'dialog'); bubble.setAttribute('aria-live', 'polite');
  const stepLabel = document.createElement('span'); stepLabel.className = 'fp-tour-step';
  const text = document.createElement('p');
  const hint = document.createElement('p'); hint.className = 'fp-tour-hint';
  const actions = document.createElement('div'); actions.className = 'fp-tour-actions';
  const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'button'; skip.textContent = '그만 보기';
  const next = document.createElement('button'); next.type = 'button'; next.className = 'button button-primary';
  actions.append(skip, next); bubble.append(stepLabel, text, hint, actions);
  document.body.append(ring, bubble);

  let index = -1; let target = null; let detachClick = null; let raf = 0; let token = 0;
  const state = { cleanup() {
    token += 1; cancelAnimationFrame(raf); detachClick?.(); target?.classList.remove('fp-tour-target');
    ring.remove(); bubble.remove(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey);
  } };
  active = state;

  function place() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!target?.isConnected) return;
      const r = target.getBoundingClientRect(); const pad = 6;
      Object.assign(ring.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      const bw = Math.min(320, window.innerWidth - 24); const bh = bubble.offsetHeight || 140;
      const below = r.bottom + 14 + bh < window.innerHeight;
      const top = below ? r.bottom + 14 : Math.max(12, r.top - 14 - bh);
      const left = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 12);
      Object.assign(bubble.style, { top: `${top}px`, left: `${left}px`, width: `${bw}px` });
    });
  }
  function finish(completed) { markDone(id); stopTour(); if (completed) document.dispatchEvent(new CustomEvent('fanpage-tour-done', { detail: { id } })); }
  function onKey(event) { if (event.key === 'Escape') finish(false); }

  async function go(nextIndex) {
    const myToken = ++token;
    detachClick?.(); detachClick = null; target?.classList.remove('fp-tour-target');
    if (nextIndex >= steps.length) { finish(true); return; }
    index = nextIndex; const step = steps[index];
    bubble.hidden = true; ring.hidden = true;
    const el = await waitForElement(step.target, step.timeout || 4000);
    if (myToken !== token) return;
    if (!el) { if (step.optional !== false) { go(index + 1); } else finish(false); return; }
    target = el; target.classList.add('fp-tour-target');
    target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    stepLabel.textContent = `${index + 1} / ${steps.length}`;
    text.textContent = step.text;
    hint.textContent = step.waitClick ? `👉 ${step.action || '강조된 버튼을 직접 눌러 보세요.'}` : '';
    hint.hidden = !step.waitClick;
    next.textContent = index === steps.length - 1 ? '다 봤어요' : (step.waitClick ? '건너뛰기' : '다음');
    if (step.waitClick) {
      const onClick = () => setTimeout(() => go(index + 1), 60);
      el.addEventListener('click', onClick, { once: true, capture: true });
      detachClick = () => el.removeEventListener('click', onClick, { capture: true });
    }
    bubble.hidden = false; ring.hidden = false;
    place(); setTimeout(place, 350);
    next.focus({ preventScroll: true });
  }
  next.addEventListener('click', () => go(index + 1));
  skip.addEventListener('click', () => finish(false));
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey);
  go(0);
}

// 탭 머리말에 붙이는 "사용법 다시 보기" 버튼.
export function createTourReplayButton(onClick) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button fp-tour-replay';
  button.textContent = '❔ 사용법'; button.setAttribute('aria-label', '이 탭 사용법 체험하기');
  button.addEventListener('click', onClick);
  return button;
}
