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
const MASK_SCALE = 1 / 8;  // 마스크는 낮은 해상도로 그려 가볍게(확대되며 가장자리가 부드러워짐)
const MASK_FPS = 15;

let layer = null; let mask = null; let mctx = null;
let level = 0; let growTimer = 0; let raf = 0; let lastMask = 0; let dialogObserver = null;
let pointer = null; let lastPoint = null; let dirty = false; let wipedSince = 0;
let maskUrl = ''; let running = false;

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

function resizeMask() {
  if (!mask) return;
  mask.width = Math.max(8, Math.ceil(innerWidth * MASK_SCALE));
  mask.height = Math.max(8, Math.ceil(innerHeight * MASK_SCALE));
  mctx.fillStyle = '#000'; mctx.globalCompositeOperation = 'source-over'; mctx.globalAlpha = 1;
  mctx.fillRect(0, 0, mask.width, mask.height); // 불투명 = 김 있음
  dirty = true;
}

function wipeAt(x, y) {
  const r = (WIPE_DIAMETER / 2) * MASK_SCALE;
  const cx = x * MASK_SCALE; const cy = y * MASK_SCALE;
  const g = mctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  mctx.globalCompositeOperation = 'destination-out'; mctx.globalAlpha = 1;
  mctx.fillStyle = g;
  mctx.beginPath(); mctx.arc(cx, cy, r, 0, Math.PI * 2); mctx.fill();
  mctx.globalCompositeOperation = 'source-over';
}

function onPointerMove(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  pointer = { x: event.clientX, y: event.clientY };
  startLoop();
}

function frame(time) {
  raf = 0;
  if (!running) return;
  if (time - lastMask < 1000 / MASK_FPS) { raf = requestAnimationFrame(frame); return; }
  const dt = lastMask ? Math.min(250, time - lastMask) : 0; lastMask = time;
  // 지난 위치에서 지금 위치까지 이어서 닦는다(빠르게 움직여도 끊기지 않게)
  if (pointer) {
    const from = lastPoint || pointer;
    const dist = Math.hypot(pointer.x - from.x, pointer.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (WIPE_DIAMETER / 4)));
    for (let i = 1; i <= steps; i += 1) wipeAt(from.x + ((pointer.x - from.x) * i) / steps, from.y + ((pointer.y - from.y) * i) / steps);
    lastPoint = pointer; pointer = null; dirty = true; wipedSince = time;
  }
  // 닦은 자리가 다시 낀다(경과 시간 기준)
  if (dt && time - wipedSince < REFOG_MS + 500) {
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = Math.min(1, (dt / REFOG_MS) * 1.6);
    mctx.fillStyle = '#000'; mctx.fillRect(0, 0, mask.width, mask.height);
    mctx.globalAlpha = 1; dirty = true;
  }
  if (dirty) {
    dirty = false;
    mask.toBlob((blob) => {
      if (!blob || !layer) return;
      const url = URL.createObjectURL(blob);
      layer.style.setProperty('-webkit-mask-image', `url(${url})`);
      layer.style.setProperty('mask-image', `url(${url})`);
      if (maskUrl) setTimeout(URL.revokeObjectURL, 200, maskUrl);
      maskUrl = url;
    });
  }
  // 움직임이 멈추고 다시 다 끼면 쉰다(다음 마우스 움직임에 재시작)
  if (time - wipedSince < REFOG_MS + 500) raf = requestAnimationFrame(frame);
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
    mask = document.createElement('canvas'); mctx = mask.getContext('2d');
    document.body.append(layer);
  }
  level = 0; resizeMask(); applyStrength();
  clearInterval(growTimer);
  growTimer = setInterval(() => { if (!document.hidden) { level = Math.min(MAX, level + STEP); applyStrength(); } if (level >= MAX) clearInterval(growTimer); }, STEP_MS);
  addEventListener('pointermove', onPointerMove, { passive: true });
  addEventListener('resize', resizeMask);
  document.addEventListener('focusin', onStateChange); document.addEventListener('focusout', onStateChange);
  document.addEventListener('visibilitychange', onStateChange);
  dialogObserver ??= new MutationObserver(onStateChange); // dialog 열림·닫힘
  dialogObserver.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  startLoop();
}

export function stopFog() {
  running = false;
  clearInterval(growTimer); cancelAnimationFrame(raf); raf = 0;
  removeEventListener('pointermove', onPointerMove); removeEventListener('resize', resizeMask);
  document.removeEventListener('focusin', onStateChange); document.removeEventListener('focusout', onStateChange);
  document.removeEventListener('visibilitychange', onStateChange);
  dialogObserver?.disconnect();
  layer?.remove(); layer = null; mask = null; mctx = null; level = 0; pointer = null; lastPoint = null;
  if (maskUrl) { URL.revokeObjectURL(maskUrl); maskUrl = ''; }
}

// 테스트용: 김 세기를 바로 지정(0~0.25)
export function setFogLevel(value) { level = Math.max(0, Math.min(MAX, Number(value) || 0)); applyStrength(); }
