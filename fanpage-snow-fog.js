//  2026-11-20 팬페이지 김서림: 데스크탑(마우스 기기)에서 눈이 내리는 동안 화면이 4초에 1%씩 흐려져 100초 뒤 최대(글자가 잘 안 읽히는 정도)가 된다.
//  마우스를 움직이면 그 주변 원만큼 유리를 닦은 것처럼 맑아지고, 닦은 자국은 몇 초에 걸쳐 다시 낀다.
//  fanpage-snow.js가 내리는 눈이 보일 때만 불러온다. 서버·DB 호출 없음, 마우스 위치는 화면 안에서만 쓰고 어디에도 보내지 않는다.
//  창(dialog)이 열려 있거나 입력칸에 글을 쓰는 중, 탭이 숨겨졌을 때는 김을 걷고 멈춘다. 클릭을 막지 않는다.
const STEP_MS = 4000;      // 4초마다
const STEP = 0.01;         // 1%씩
const MAX = 0.25;          // 최대 25% → 김 세기 1.0(글자가 잘 안 읽히는 정도)
const MAX_BLUR_PX = 7;
const MAX_HAZE = 0.42;     // 하얀 김 불투명도
const WIPE_DIAMETER = 220; // 닦이는 원 지름(px)
const REFOG_MS = 6000;     // 닦은 자리가 다시 끼는 데 걸리는 시간
const MASK_FPS = 30;
const MAX_SPOTS = 40;      // 닦인 자국 점 개수 상한(오래된 것부터 버림)

//  닦인 자리는 CSS 원형 그러데이션 마스크 여러 장을 곱해서(intersect) 뚫는다.
//  그림 파일(blob) 마스크는 바꿔 끼울 때 불러오는 순간 김 전체가 사라져 깜빡였다(배포 후 발견) → 불러오기가 없는 그러데이션으로 바꿈.
let layer = null;
let level = 0; let growTimer = 0; let raf = 0; let lastMask = 0; let dialogObserver = null;
let pointer = null; let lastPoint = null; let spots = []; let running = false;

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
  const last = spots[spots.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) < WIPE_DIAMETER / 5) { last.t = time; return; }
  spots.push({ x, y, t: time });
  if (spots.length > MAX_SPOTS) spots.shift();
}

function onPointerMove(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  pointer = { x: event.clientX, y: event.clientY };
  startLoop();
}

function renderMask(time) {
  spots = spots.filter((p) => time - p.t < REFOG_MS);
  if (!spots.length) {
    layer.style.removeProperty('-webkit-mask-image'); layer.style.removeProperty('mask-image');
    return;
  }
  const r = WIPE_DIAMETER / 2;
  const layers = spots.map((p) => {
    const fog = Math.min(1, (time - p.t) / REFOG_MS); // 0 = 막 닦음, 1 = 다시 다 낌
    const a = (fog * fog).toFixed(3); // 처음엔 천천히, 나중에 빨리 낌
    return `radial-gradient(circle ${r}px at ${p.x.toFixed(0)}px ${p.y.toFixed(0)}px, rgba(0,0,0,${a}) ${(r * 0.4).toFixed(0)}px, #000 ${r}px)`;
  }).join(',');
  layer.style.setProperty('-webkit-mask-image', layers);
  layer.style.setProperty('mask-image', layers);
  layer.style.setProperty('-webkit-mask-composite', spots.map(() => 'source-in').join(','));
  layer.style.setProperty('mask-composite', spots.map(() => 'intersect').join(','));
}

function frame(time) {
  raf = 0;
  if (!running || !layer) return;
  if (time - lastMask < 1000 / MASK_FPS - 1) { raf = requestAnimationFrame(frame); return; }
  lastMask = time;
  // 지난 위치에서 지금 위치까지 이어서 닦는다(빠르게 움직여도 끊기지 않게)
  if (pointer) {
    const from = lastPoint || pointer;
    const dist = Math.hypot(pointer.x - from.x, pointer.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (WIPE_DIAMETER / 4)));
    for (let i = 1; i <= steps; i += 1) addSpot(from.x + ((pointer.x - from.x) * i) / steps, from.y + ((pointer.y - from.y) * i) / steps, time);
    lastPoint = pointer; pointer = null;
  }
  renderMask(time);
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
  clearInterval(growTimer);
  growTimer = setInterval(() => { if (!document.hidden) { level = Math.min(MAX, level + STEP); applyStrength(); } if (level >= MAX) clearInterval(growTimer); }, STEP_MS);
  addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('focusin', onStateChange); document.addEventListener('focusout', onStateChange);
  document.addEventListener('visibilitychange', onStateChange);
  dialogObserver ??= new MutationObserver(onStateChange); // dialog 열림·닫힘
  dialogObserver.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  startLoop();
}

export function stopFog() {
  running = false;
  clearInterval(growTimer); cancelAnimationFrame(raf); raf = 0;
  removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('focusin', onStateChange); document.removeEventListener('focusout', onStateChange);
  document.removeEventListener('visibilitychange', onStateChange);
  dialogObserver?.disconnect();
  layer?.remove(); layer = null; level = 0; pointer = null; lastPoint = null; spots = [];
}

// 테스트용: 김 세기를 바로 지정(0~0.25)
export function setFogLevel(value) { level = Math.max(0, Math.min(MAX, Number(value) || 0)); applyStrength(); }
