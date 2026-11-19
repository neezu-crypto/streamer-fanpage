//  2026-11-20 팬페이지 눈 효과: 서울에 눈이 오는 시간(예보)에만 화면에 눈이 내린다.
//  예보는 Pages 배포 때 올린 static-data/weather/seoul.json 하나만 읽는다(서버·DB 호출 없음, 방문자 정보 외부 전송 없음).
//  규칙: 경과 시간 기준 애니메이션, 모바일 30fps·DPR 2 상한, 탭 숨김 시 정지, 동작 줄이기면 표시 안 함, 클릭을 막지 않음.
//  미리보기: 주소에 ?snow=1(눈) / ?snow=2(함박눈) / ?snow=0(끔)을 붙이면 예보와 상관없이 보인다.
const FORECAST_URL = './static-data/weather/seoul.json';
const OFF_KEY = 'streamerFanPage.snow.off.v1';
const LEVEL_FLAKES = { 1: 70, 2: 160 };

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => !!window.matchMedia?.('(max-width: 760px), (pointer: coarse)').matches;
const userOff = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch (_) { return false; } };
const setUserOff = (off) => { try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch (_) { /* 저장 불가 기기 */ } };

// 한국시간 "YYYY-MM-DDTHH"
function kstHourKey(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 13);
}

function previewLevel() {
  const raw = new URLSearchParams(location.search).get('snow');
  return raw == null ? null : Math.max(0, Math.min(2, Number(raw) || 0));
}

let forecast = null;
let level = 0;
let canvas = null; let ctx = null; let toggle = null;
let flakes = []; let raf = 0; let last = 0; let lastDraw = 0; let hourTimer = 0;

function makeFlake(width, height, fromTop) {
  const r = 1 + Math.random() * (level === 2 ? 3 : 2.2);
  return {
    x: Math.random() * width,
    y: fromTop ? -10 - Math.random() * height * 0.3 : Math.random() * height,
    r,
    speed: 22 + r * 14 + Math.random() * 18, // px/초
    drift: 8 + Math.random() * 16,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.55 + Math.random() * 0.4,
  };
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const target = Math.round(LEVEL_FLAKES[level] * (isMobile() ? 0.55 : 1));
  while (flakes.length < target) flakes.push(makeFlake(innerWidth, innerHeight, false));
  flakes.length = target;
}

function frame(time) {
  raf = requestAnimationFrame(frame);
  if (isMobile() && time - lastDraw < 1000 / 30 - 1) return; // 모바일 30fps 상한
  lastDraw = time;
  const dt = Math.min(0.05, (time - (last || time)) / 1000); last = time;
  const w = innerWidth; const h = innerHeight;
  ctx.clearRect(0, 0, w, h);
  const t = time / 1000;
  //  밝은 디자인(1·3·4)에서도 눈으로 보이게 흰 눈송이 뒤에 옅은 푸른 번짐을 깐다(그림자 효과보다 가볍다).
  for (const f of flakes) {
    f.y += f.speed * dt;
    f.x += Math.sin(t * 0.8 + f.phase) * f.drift * dt;
    if (f.y > h + 8 || f.x < -10 || f.x > w + 10) Object.assign(f, makeFlake(w, h, true));
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = 'rgba(140,165,210,.38)';
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function startAnim() { if (!raf && canvas && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
function stopAnim() { cancelAnimationFrame(raf); raf = 0; }

function show() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'fanpage-snow-layer'; canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');
    document.body.append(canvas);
  }
  canvas.hidden = false; flakes = []; resize(); startAnim();
}

function hide() { stopAnim(); if (canvas) { canvas.hidden = true; ctx.clearRect(0, 0, canvas.width, canvas.height); } }

function renderToggle() {
  if (!level || reducedMotion()) { toggle?.remove(); toggle = null; return; }
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'fanpage-snow-toggle';
    toggle.title = '서울에 눈이 오는 시간에만 내려요 · 날씨: Open-Meteo';
    toggle.addEventListener('click', () => { setUserOff(!userOff()); apply(); });
    document.body.append(toggle);
  }
  const off = userOff();
  toggle.textContent = off ? '❄ 눈 켜기' : '❄ 눈 끄기';
  toggle.setAttribute('aria-pressed', String(!off));
}

function apply() {
  const preview = previewLevel();
  level = preview != null ? preview : Number(forecast?.hours?.[kstHourKey()]) || 0;
  renderToggle();
  if (level && !userOff() && !reducedMotion()) show(); else hide();
}

// 다음 정각에 다시 판단한다(네트워크 없이 같은 예보로 시간대만 바꿈).
function scheduleHourly() {
  clearTimeout(hourTimer);
  const now = Date.now();
  hourTimer = setTimeout(() => { apply(); scheduleHourly(); }, 3600 * 1000 - (now % (3600 * 1000)) + 500);
}

async function init() {
  if (previewLevel() == null) {
    try {
      const response = await fetch(FORECAST_URL, { cache: 'no-cache' });
      forecast = response.ok ? await response.json() : null;
      if (Number(forecast?.schemaVersion) !== 1) forecast = null;
    } catch (_) { forecast = null; }
  }
  apply(); scheduleHourly();
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAnim(); else if (canvas && !canvas.hidden) startAnim(); });
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 200); });
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
}

init();

export { kstHourKey };
