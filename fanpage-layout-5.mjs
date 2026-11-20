//  디자인 5 · 이불 덮어주기 (2026-11-20)
//  천장에서 내려다본 침대에 고정 일러스트 인물이 자고 있고, 탭마다 이불(같은 그림을 탭 색으로 물들임)이 한 장씩 덮인다.
//  탭 내용은 이불 위에 얹혀 이불 안에서 스크롤된다. 탭 끝에서 화면 높이 10%만큼 더 내리면(백래시) 다음 이불을 덮고,
//  탭 맨 위에서 10% 더 올리면 걷는다. 이불이 쌓일수록 인물 그림이 땀 단계로 바뀐다(1장 평온 … 4장 이상 땀3).
//  규칙: 움직임은 CSS 전환(경과 시간 기준)만 쓰고 계속 도는 그리기는 없다. 동작 줄이기면 전환 없이 바로 바뀐다.
//  화면에 맞는 그림만 받는다(PC/모바일). 보이는 이불 층수 상한 = 탭 수 ÷ 2.
const ASSET = './assets/design5/';
const TINTS = ['#ffd3df', '#cfe3ff', '#d4f2e0', '#fff0c2', '#e5d8ff', '#ffe0cc', '#d6f3f5', '#f6d9ef'];
const CHIN = { pc: 0.235, m: 0.27 };   // 인물 그림 높이 대비 턱 위치 — 이불 윗단이 여기서 멈춘다
const HEM = 57 / 1024;                  // 이불 그림에서 윗단이 시작하는 높이
const STRIP = 14;                       // 아래 깔린 이불 끝단이 보이는 두께(px)
const PEEK = 0.10;                      // 첫 화면에 올라와 있는 이불 높이(화면 대비)
const BACKLASH = 0.10;                  // 탭을 넘기기 전 더 밀어야 하는 거리(화면 대비)
const MOBILE = '(max-width: 760px)';

let cleanup = null;

export function teardownFanpageBlanket() { cleanup?.(); cleanup = null; }

export function setupFanpageBlanket(view, { tabNav, head = [], panels, initialIndex = -1, onCurrent, onPrefetch }) {
  teardownFanpageBlanket();
  if (!panels.length) return null;
  const mq = window.matchMedia(MOBILE);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // 장면(침대·인물)은 화면에 고정된 배경 층이다.
  const scene = document.createElement('div'); scene.className = 'fanpage-blanket-scene'; scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `<picture><source media="${MOBILE}" srcset="${ASSET}bed-m.webp"><img class="fanpage-blanket-bed" src="${ASSET}bed-pc.webp" alt="" decoding="async"></picture><div class="fanpage-blanket-person"></div>`;
  const person = scene.querySelector('.fanpage-blanket-person');
  const hint = document.createElement('button'); hint.type = 'button'; hint.className = 'fanpage-blanket-hint';
  hint.innerHTML = '<span aria-hidden="true">⬇️</span> 스크롤해 이불 덮어주기';
  const stack = document.createElement('div'); stack.className = 'fanpage-blanket-stack';
  panels[0].before(scene); scene.after(stack); stack.after(hint);

  const quilts = panels.map((panel, index) => {
    const quilt = document.createElement('section'); quilt.className = 'fanpage-blanket-quilt';
    quilt.style.setProperty('--quilt-tint', TINTS[index % TINTS.length]);
    const body = document.createElement('div'); body.className = 'fanpage-blanket-body';
    const paper = document.createElement('div'); paper.className = 'fanpage-blanket-paper';
    if (index === 0) head.filter(Boolean).forEach((el) => paper.append(el)); // 대문·관리 상자는 첫 이불 위
    panel.hidden = false; panel.classList.add('fanpage-blanket-page');
    paper.append(panel);
    const next = document.createElement('p'); next.className = 'fanpage-blanket-next';
    next.textContent = index < panels.length - 1 ? '⬇ 끝에서 조금 더 내리면 다음 이불을 덮어요' : '모든 이불을 덮었어요 💤';
    paper.append(next); body.append(paper); quilt.append(body); stack.append(quilt);
    return quilt;
  });

  let stage = 0, pull = 0, releaseTimer = 0, lockedUntil = 0, kind = '', current = -1;
  const lim = Math.max(1, Math.floor(panels.length / 2));
  const prefetched = new Set();
  const prefetch = (i) => { if (i >= 0 && i < panels.length && !prefetched.has(i)) { prefetched.add(i); onPrefetch?.(i); } };

  function loadPerson() {
    const k = mq.matches ? 'm' : 'pc'; if (k === kind) return; kind = k;
    person.innerHTML = [0, 1, 2, 3].map((i) => `<img src="${ASSET}person-${k}-${i}.webp" alt="" decoding="async">`).join('');
  }
  let coverTop = 0;
  function fit() {
    loadPerson();
    const W = window.innerWidth, H = window.innerHeight;
    const imgH = W * 1024 / 1536, hem = imgH * HEM;
    coverTop = Math.round(H * CHIN[kind]);
    stack.style.setProperty('--quilt-hemoff', `${-hem}px`);
    stack.style.setProperty('--quilt-imgend', `${imgH - hem - 2}px`);
    stack.style.setProperty('--quilt-pad', '6px'); // 본문이 이불 윗단 바로 아래까지 올라오게
    layout();
  }
  // 탭 내용을 이불 위에 얹고, 지금 이불에 탭 바를 옮겨 단다.
  function setCurrent(index) {
    if (index === current) return;
    current = index;
    if (tabNav) quilts[index].querySelector('.fanpage-blanket-paper').prepend(tabNav);
    onCurrent?.(index);
  }
  function layout() {
    const H = window.innerHeight;
    const shown = Math.min(Math.max(stage - 1, 0), lim);
    quilts.forEach((quilt, i) => {
      const covered = i < stage, mine = i === stage - 1, below = stage - 1 - i;
      const top = covered ? coverTop + (shown - Math.min(below, shown)) * STRIP : coverTop + Math.min(stage, lim) * STRIP;
      const peek = stage === 0 && i === 0 ? PEEK * H : 0;
      const fullH = H - top;
      let y = covered ? 0 : (peek ? fullH - peek : H);
      if (i === stage && pull > 0) y -= pull;
      if (mine && pull < 0) y = -pull;
      quilt.style.top = `${top}px`; quilt.style.zIndex = String(i + 1);
      //  멈춰 있으면 transform을 비워 둔다(이불 안 고정 위치 요소가 화면 기준으로 그대로 동작하게).
      quilt.style.transform = y ? `translate3d(0,${y.toFixed(1)}px,0)` : '';
      quilt.style.transition = pull || reduceMotion.matches ? 'none' : '';
      quilt.style.visibility = covered && below > lim ? 'hidden' : '';
      quilt.classList.toggle('is-peeking', !!peek);
      quilt.classList.toggle('is-current', mine);
      quilt.inert = !mine;
    });
    hint.hidden = stage !== 0;
    const level = Math.min(3, Math.max(0, stage - 1)); // 이불 1장=평온 … 4장 이상=땀3
    [...person.children].forEach((img, i) => img.classList.toggle('is-on', i === level));
  }
  function go(next) {
    stage = Math.max(0, Math.min(panels.length, next)); pull = 0;
    const index = Math.max(0, stage - 1);
    setCurrent(index); prefetch(index); prefetch(index + 1);
    layout();
  }
  const bodyOf = () => (stage ? quilts[stage - 1].querySelector('.fanpage-blanket-body') : null);
  const atBottom = (el) => !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  const atTop = (el) => !el || el.scrollTop <= 1;
  const threshold = () => window.innerHeight * BACKLASH;
  function addPull(dy) {
    pull += dy;
    if (pull >= threshold() && stage < panels.length) { go(stage + 1); lockedUntil = performance.now() + 650; return; }
    if (pull <= -threshold() && stage > 0) { go(stage - 1); lockedUntil = performance.now() + 650; return; }
    pull = Math.max(-threshold(), Math.min(threshold(), pull)); layout();
    clearTimeout(releaseTimer); releaseTimer = setTimeout(() => { pull = 0; layout(); }, 220);
  }
  const blocked = (target) => !!document.querySelector('dialog[open]') || !!target?.closest?.('dialog, .topbar, input, textarea, select, [contenteditable="true"]');
  // 가로로 스크롤되는 칸(탭 바·썸네일 줄) 안에서 세로로 넘는 동작은 이불 넘김으로 본다.
  function handle(dy, target) {
    if (performance.now() < lockedUntil) return true;
    if (blocked(target)) return false;
    const el = bodyOf();
    if (dy > 0 && stage < panels.length && atBottom(el)) { addPull(dy); return true; }
    if (dy < 0 && stage > 0 && atTop(el)) { addPull(dy); return true; }
    if (pull) { pull = 0; layout(); }
    return false;
  }
  const onWheel = (event) => { if (handle(event.deltaY * 0.5, event.target)) event.preventDefault(); };
  let touchY = null;
  const onTouchStart = (event) => { touchY = event.touches[0].clientY; };
  const onTouchMove = (event) => {
    if (touchY == null) return;
    const y = event.touches[0].clientY, dy = touchY - y; touchY = y;
    if (handle(dy, event.target) && event.cancelable) event.preventDefault();
  };
  const onTouchEnd = () => { touchY = null; };
  const onKey = (event) => {
    if (blocked(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    const el = bodyOf();
    if ((event.key === 'PageDown' || event.key === ' ') && atBottom(el) && stage < panels.length) { event.preventDefault(); go(stage + 1); }
    else if (event.key === 'PageUp' && atTop(el) && stage > 0) { event.preventDefault(); go(stage - 1); }
  };
  hint.addEventListener('click', () => go(1));
  quilts[0].addEventListener('click', () => { if (stage === 0) go(1); });
  // 키보드로 다른 이불 안 칸에 들어가면 그 이불을 덮는다(포커스는 현재 이불 안만 가능하지만 안전하게).
  const onFocusIn = (event) => {
    const quilt = event.target.closest?.('.fanpage-blanket-quilt');
    const index = quilts.indexOf(quilt);
    if (index >= 0 && index !== stage - 1) go(index + 1);
  };
  let resizeTimer = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 120); };
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  stack.addEventListener('focusin', onFocusIn);
  mq.addEventListener?.('change', fit);

  function goTo(index) { if (index >= 0 && index < panels.length) go(index + 1); }
  function reveal(element) {
    const quilt = element?.closest?.('.fanpage-blanket-quilt');
    const index = quilts.indexOf(quilt);
    if (index < 0) return false;
    go(index + 1);
    const body = quilt.querySelector('.fanpage-blanket-body');
    const inner = element.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTo({ top: Math.max(0, inner - 16), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    return true;
  }
  fit();
  go(initialIndex > 0 ? initialIndex + 1 : 0);
  const api = { goTo, reveal, fit, indexOf: (panel) => panels.indexOf(panel), stage: () => stage };
  view._binder = api;
  cleanup = () => {
    window.removeEventListener('wheel', onWheel); window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove); window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
    mq.removeEventListener?.('change', fit);
    clearTimeout(releaseTimer); clearTimeout(resizeTimer);
    if (view._binder === api) view._binder = null;
  };
  return api;
}
