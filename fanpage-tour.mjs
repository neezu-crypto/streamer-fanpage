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

//  quietMs: 대상이 없을 때, 화면(DOM)이 quietMs 동안 바뀌지 않으면 더 그려질 게 없다고 보고 일찍 포기한다.
//  (사용법 다시 보기: 다 그려진 화면에서 없는 대상을 오래 기다리지 않고, 아직 불러오는 중이면 끝까지 기다린다.)
function waitForElement(resolve, timeoutMs = 4000, { quietMs = 0 } = {}) {
  return new Promise((done) => {
    const started = performance.now();
    let lastChange = started;
    const mo = quietMs && typeof MutationObserver === 'function'
      ? new MutationObserver(() => { lastChange = performance.now(); }) : null;
    mo?.observe(document.body, { childList: true, subtree: true });
    const end = (value) => { mo?.disconnect(); done(value); };
    (function poll() {
      const el = resolve();
      if (el && el.isConnected && el.getClientRects().length) return end(el);
      const now = performance.now();
      if (now - started > timeoutMs) return end(null);
      if (mo && now - lastChange > quietMs) return end(null);
      setTimeout(poll, 120);
    })();
  });
}

function inView(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}
// 대상이 화면에 (절반 이상 또는 화면 높이의 40% 이상) 들어올 때까지 기다린다. 대상이 사라지거나 취소되면 false.
function waitUntilVisible(el, cancelled) {
  return new Promise((resolve) => {
    if (typeof IntersectionObserver !== 'function') { resolve(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); clearInterval(poll); resolve(true); }
    }, { threshold: 0.5 });
    io.observe(el);
    const poll = setInterval(() => { if (cancelled() || !el.isConnected) { io.disconnect(); clearInterval(poll); resolve(false); } }, 300);
  });
}

export function stopTour() {
  if (!active) return;
  active.cleanup();
  active = null;
}

// steps: [{ target: () => Element, text, action?: '눌러 보세요' 문구, waitClick?: true }]
export async function startTour(id, steps, { force = false, noScroll = false } = {}) {
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

  let index = -1; let shownAny = false; let target = null; let detachClick = null; let raf = 0; let token = 0;
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
  function finish(completed) { if (shownAny || !noScroll) markDone(id); stopTour(); if (completed) document.dispatchEvent(new CustomEvent('fanpage-tour-done', { detail: { id } })); }
  function onKey(event) { if (event.key === 'Escape') finish(false); }

  async function go(nextIndex) {
    const myToken = ++token;
    detachClick?.(); detachClick = null; target?.classList.remove('fp-tour-target');
    if (nextIndex >= steps.length) { finish(true); return; }
    index = nextIndex; const step = steps[index];
    bubble.hidden = true; ring.hidden = true;
    //  사용법 버튼으로 다시 볼 때: 화면이 다 그려졌으면 없는 대상(예: 모바일에서 숨는 편집 버튼)을 0.6초만 기다리고,
    //  탭 데이터를 아직 불러오는 중(화면이 계속 바뀜)이면 원래 시간만큼 기다린다.
    const el = await waitForElement(step.target, step.timeout || 4000, { quietMs: force ? 600 : 0 });
    if (myToken !== token) return;
    if (!el) { if (step.optional !== false) { go(index + 1); } else finish(false); return; }
    //  noScroll(자동으로 뜬 안내): 화면을 끌어당기지 않는다. 대상이 화면 밖이면 사용자가 스크롤해
    //  대상이 화면에 들어올 때까지 기다렸다가 그때 보여 준다(그 사이 말풍선은 숨김).
    if (noScroll && !inView(el)) {
      const seen = await waitUntilVisible(el, () => myToken !== token);
      if (myToken !== token) return;
      if (!seen) { go(index + 1); return; }
    }
    target = el; shownAny = true; target.classList.add('fp-tour-target');
    if (!noScroll) target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
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
