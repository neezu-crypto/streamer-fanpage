//  2026-11-20 팬페이지 김서림: 데스크탑(마우스 기기)에서 눈이 내리는 동안 화면이 3초에 5%씩 흐려져 60초 뒤 최대(글자가 잘 안 읽히는 정도)가 된다.
//  마우스를 움직이면 그 주변 원만큼 유리를 닦은 것처럼 맑아지고, 닦은 자국도 같은 빠르기(60초)로 다시 낀다.
//  fanpage-snow.js가 내리는 눈이 보일 때만 불러온다. 서버·DB 호출 없음, 마우스 위치는 화면 안에서만 쓰고 어디에도 보내지 않는다.
//  창(dialog)이 열려 있거나 입력칸에 글을 쓰는 중, 탭이 숨겨졌을 때는 김을 걷고 멈춘다. 클릭을 막지 않는다.
const STEP_MS = 3000;      // 3초마다
const STEP = 0.05;         // 5%씩(3초 동안 부드럽게 이어서 참, style.css의 @property 전환)
const MAX = 1;             // 60초 뒤 최대(글자가 잘 안 읽히는 정도)
const MAX_BLUR_PX = 7;
const MAX_HAZE = 0.42;     // 하얀 김 불투명도
const WIPE_DIAMETER = 440; // 닦이는 원 지름(px)
const REFOG_MS = 60000;    // 닦은 자리가 다시 최대까지 끼는 데 걸리는 시간(전체 김과 같은 빠르기: 3초에 5%)
const MASK_FPS = 20;
const REFOG_RENDER_MS = 500; // 새로 닦지 않고 다시 끼기만 할 때는 0.5초마다만 마스크를 고친다(60초에 걸친 느린 변화라 티 안 남)
//  닦인 자국 점 개수 상한. 넘치면 오래된 점 둘을 조금 큰 원 하나로 합친다(통째로 버리면 이전 자리가 60초 전에 갑자기 다시 낌).
//  SVG 마스크는 원마다 자기 넓이만 그려 가볍고, CSS 그러데이션(사파리)은 화면 전체 × 점 개수만큼 계산해 무거워 적게 둔다.
const SAFARI = /^((?!chrome|chromium|crios|fxios|android|edg|whale).)*safari/i.test(navigator.userAgent);
const USE_SVG = !SAFARI; // 크롬·엣지·웨일·파이어폭스에서 HTML 요소에 SVG 마스크가 적용되는 것 확인(사파리는 미확인이라 그러데이션)
const MAX_SPOTS = USE_SVG ? 200 : 60;
const SPOT_GAP = WIPE_DIAMETER / 2.6; // 점 사이 간격(px)

//  닦인 자리는 CSS 원형 그러데이션 마스크 여러 장을 곱해서(intersect) 뚫는다.
//  그림 파일(blob) 마스크는 바꿔 끼울 때 불러오는 순간 김 전체가 사라져 깜빡였다(배포 후 발견) → 불러오기가 없는 그러데이션으로 바꿈.
let layer = null;
let level = 0; let growTimer = 0; let raf = 0; let lastMask = 0; let dialogObserver = null;
let pointer = null; let lastPoint = null; let spots = []; let running = false;
let lastRender = 0; let svg = null; let svgMask = null; let svgRect = null; let svgHoles = null;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MASK_ID = 'fanpageFogMask'; const HOLE_ID = 'fanpageFogHole';

//  마스크용 SVG: 흰 사각형(김 있음) 위에 가운데가 검고 가장자리로 투명해지는 원(닦인 자리)을 올린다.
//  크기는 반드시 숫자 px로(100%로 주면 HTML 요소에서 마스크가 통째로 안 먹음).
function ensureSvg() {
  if (svg) return;
  svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
  svg.innerHTML = `<defs><radialGradient id="${HOLE_ID}"><stop offset=".5" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`
    + `<mask id="${MASK_ID}" maskUnits="userSpaceOnUse" x="0" y="0"><rect x="0" y="0" fill="#fff"/><g></g></mask></defs>`;
  svgMask = svg.querySelector('mask'); svgRect = svg.querySelector('rect'); svgHoles = svg.querySelector('g');
  document.body.append(svg);
  sizeSvg();
}

function sizeSvg() {
  if (!svgMask) return;
  const w = String(Math.ceil(innerWidth)); const h = String(Math.ceil(innerHeight));
  for (const el of [svgMask, svgRect]) { el.setAttribute('width', w); el.setAttribute('height', h); }
}

const desktop = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches && innerWidth > 760;

function blocked() {
  if (document.hidden || document.querySelector('dialog[open]')) return true;
  const el = document.activeElement;
  return !!el && (el.matches?.('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select') || el.isContentEditable);
}

function applyStrength() {
  if (!layer) return;
  const s = blocked() ? 0 : Math.min(1, level / MAX);
  layer.style.setProperty('--fog-blur', `${(s * MAX_BLUR_PX).toFixed(2)}px`);
  layer.style.setProperty('--fog-haze', (s * MAX_HAZE).toFixed(3));
  layer.style.opacity = s > 0 ? '1' : '0';
}

function addSpot(x, y, time) {
  //  60초 동안 자국이 남아 점이 많이 쌓이므로, 이미 닦인 점 가까이를 다시 지나면 새 점 대신 그 점을 새로 닦은 것으로 한다
  for (let i = spots.length - 1; i >= 0; i -= 1) {
    const p = spots[i];
    if (Math.hypot(p.x - x, p.y - y) < SPOT_GAP * 0.6) { p.t = time; if (i !== spots.length - 1) { spots.splice(i, 1); spots.push(p); } return; }
  }
  const last = spots[spots.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) < SPOT_GAP) { last.t = time; return; }
  spots.push({ x, y, t: time, r: WIPE_DIAMETER / 2 });
  if (spots.length > MAX_SPOTS) {
    // 오래된 절반의 이웃한 두 점을 가운데의 조금 큰 원 하나로 합친다(덮는 자리는 비슷, 점 수는 줄어듦)
    const half = Math.floor(spots.length / 2);
    const merged = [];
    for (let i = 0; i < half; i += 2) {
      const a = spots[i]; const b = spots[i + 1];
      if (!b || i + 1 >= half) { merged.push(a); continue; }
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      merged.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: Math.max(a.t, b.t), r: Math.min(WIPE_DIAMETER * 1.2, Math.max(a.r, b.r) + gap / 2) });
    }
    spots = merged.concat(spots.slice(half));
  }
}

function onPointerMove(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  pointer = { x: event.clientX, y: event.clientY };
  startLoop();
}

function renderMask(time) {
  spots = spots.filter((p) => time - p.t < REFOG_MS);
  if (USE_SVG) { renderSvgMask(time); return; }
  if (!spots.length) {
    layer.style.removeProperty('-webkit-mask-image'); layer.style.removeProperty('mask-image');
    return;
  }
  const layers = spots.map((p) => {
    const { r } = p;
    const fog = Math.min(1, (time - p.t) / REFOG_MS); // 0 = 막 닦음, 1 = 다시 다 낌
    const a = fog.toFixed(3); // 일정한 빠르기로 다시 낌(3초에 5%)
    return `radial-gradient(circle ${r}px at ${p.x.toFixed(0)}px ${p.y.toFixed(0)}px, rgba(0,0,0,${a}) ${(r * 0.5).toFixed(0)}px, #000 ${r}px)`;
  }).join(',');
  layer.style.setProperty('-webkit-mask-image', layers);
  layer.style.setProperty('mask-image', layers);
  layer.style.setProperty('-webkit-mask-composite', spots.map(() => 'source-in').join(','));
  layer.style.setProperty('mask-composite', spots.map(() => 'intersect').join(','));
}

function renderSvgMask(time) {
  ensureSvg();
  const holes = svgHoles.children;
  while (holes.length > spots.length) holes[holes.length - 1].remove();
  while (holes.length < spots.length) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('fill', `url(#${HOLE_ID})`);
    svgHoles.append(c);
  }
  spots.forEach((p, i) => {
    const fog = Math.min(1, (time - p.t) / REFOG_MS);
    const c = holes[i];
    c.setAttribute('cx', p.x.toFixed(0)); c.setAttribute('cy', p.y.toFixed(0)); c.setAttribute('r', p.r.toFixed(0));
    c.setAttribute('opacity', (1 - fog).toFixed(3)); // 일정한 빠르기로 다시 낌(3초에 5%)
  });
  if (!layer.style.getPropertyValue('mask-image')) {
    layer.style.setProperty('-webkit-mask-image', `url(#${MASK_ID})`);
    layer.style.setProperty('mask-image', `url(#${MASK_ID})`);
  }
}

function frame(time) {
  raf = 0;
  if (!running || !layer) return;
  if (time - lastMask < 1000 / MASK_FPS - 1) { raf = requestAnimationFrame(frame); return; }
  lastMask = time;
  // 지난 위치에서 지금 위치까지 이어서 닦는다(빠르게 움직여도 끊기지 않게)
  const moved = !!pointer;
  if (pointer) {
    const from = lastPoint || pointer;
    const dist = Math.hypot(pointer.x - from.x, pointer.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / SPOT_GAP));
    for (let i = 1; i <= steps; i += 1) addSpot(from.x + ((pointer.x - from.x) * i) / steps, from.y + ((pointer.y - from.y) * i) / steps, time);
    lastPoint = pointer; pointer = null;
  }
  if (moved || time - lastRender >= REFOG_RENDER_MS) { renderMask(time); lastRender = time; }
  else if (spots.some((p) => time - p.t >= REFOG_MS)) { renderMask(time); lastRender = time; } // 다 낀 자국은 바로 정리
  // 다 다시 끼면 쉰다(다음 마우스 움직임에 재시작)
  if (spots.length) raf = requestAnimationFrame(frame);
  else lastPoint = null;
}

function startLoop() { if (running && !raf) { lastMask = 0; raf = requestAnimationFrame(frame); } }

function onStateChange() { applyStrength(); }

export function startFog() {
  if (running) return;
  if (!desktop()) return;
  running = true;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fanpage-fog-layer'; layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  level = 0; spots = []; applyStrength();
  // 첫 닦기 때 마스크 준비로 한 번 멈칫하던 것(약 0.37초)을 김이 0%인 시작 시점에 미리 치른다
  if (USE_SVG) renderSvgMask(performance.now());
  clearInterval(growTimer);
  growTimer = setInterval(() => { if (!document.hidden) { level = Math.min(MAX, level + STEP); applyStrength(); } if (level >= MAX) clearInterval(growTimer); }, STEP_MS);
  addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('focusin', onStateChange); document.addEventListener('focusout', onStateChange);
  document.addEventListener('visibilitychange', onStateChange);
  addEventListener('resize', sizeSvg);
  dialogObserver ??= new MutationObserver(onStateChange); // dialog 열림·닫힘
  dialogObserver.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  startLoop();
}

export function stopFog() {
  running = false;
  clearInterval(growTimer); cancelAnimationFrame(raf); raf = 0;
  removeEventListener('pointermove', onPointerMove); removeEventListener('resize', sizeSvg);
  document.removeEventListener('focusin', onStateChange); document.removeEventListener('focusout', onStateChange);
  document.removeEventListener('visibilitychange', onStateChange);
  dialogObserver?.disconnect();
  layer?.remove(); layer = null; level = 0; pointer = null; lastPoint = null; spots = [];
  svg?.remove(); svg = null; svgMask = null; svgRect = null; svgHoles = null;
}

// 테스트용: 김 세기를 바로 지정(0~1)
export function setFogLevel(value) { level = Math.max(0, Math.min(MAX, Number(value) || 0)); applyStrength(); }
