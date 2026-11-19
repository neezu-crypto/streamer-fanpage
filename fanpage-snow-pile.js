//  2026-11-20 팬페이지 쌓인 눈: 눈 오는 시간에 바깥 섹션 카드·주요 버튼·탭 버튼 윗면에 눈이 쌓이고, 그친 뒤 녹으며 고드름이 맺힌다.
//  fanpage-snow.js가 눈이 있을 때만 불러온다(평소에는 이 파일을 받지 않음). 서버·DB 호출 없음.
//  움직이지 않는 SVG라 매 프레임 다시 그리지 않는다. 요소 크기가 바뀔 때·화면이 다시 그려질 때만 다시 붙인다.
//  일러스트·사진·창(dialog)·빠른 이동 리모컨·일정표 템플릿 그림에는 얹지 않는다. 클릭을 막지 않고 화면 낭독기가 읽지 않는다.
const CARDS = '.content-card, .live-section, .profile-board, .messenger-link-section, .fanpage-tab-nav';
const TARGETS = `${CARDS}, .button-primary, .fanpage-tab-button`;
const EXCLUDE = 'dialog, .fan-quick-remote, .weekly-schedule-preview-frame, .tg-care, [hidden]';
const PILE_CLASS = 'fanpage-snow-pile';
const HOST_CLASS = 'fanpage-snow-host';
const MIN_WIDTH = 56;

let state = null; // { amount, melting, reduced }
let view = null;
let mutationObserver = null; let viewObserver = null; let resizeObserver = null;
let scanTimer = 0; let gradientSeq = 0;
const seeds = new WeakMap();
const drawn = new WeakMap(); // host -> 마지막으로 그린 크기·상태 키

function seedFor(host) {
  if (!seeds.has(host)) seeds.set(host, (Math.random() * 2 ** 31) >>> 0);
  return seeds.get(host);
}

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (rnd, a, b) => a + (b - a) * rnd();

function radiusPx(value, width, height) {
  const first = String(value || '0').trim().split(/\s+/)[0];
  const n = parseFloat(first) || 0;
  const px = first.endsWith('%') ? (n / 100) * width : n;
  return Math.max(0, Math.min(px, height / 2, width / 2));
}

function styleKind() {
  if (view?.classList.contains('fanpage-layout-3')) return 'ink';
  if (view?.classList.contains('fanpage-layout-2')) return 'dark';
  return 'light';
}

function kindOf(host) {
  if (host.matches(CARDS)) return 'card';
  if (host.classList.contains('button-primary')) return 'primary';
  return 'tab';
}

const BASE_THICKNESS = { card: 6.5, primary: 8.5, tab: 5.5 };

// 위쪽이 잘리는 칸(가로 스크롤 탭 줄, overflow:hidden 영역) 안에서는 남은 위 여백만큼만 쌓는다.
function roomAbove(host) {
  const top = host.getBoundingClientRect().top;
  for (let node = host.parentElement; node && node !== document.body; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (/(hidden|clip|auto|scroll)/.test(cs.overflowY) || /(hidden|clip|auto|scroll)/.test(cs.overflowX)) {
      return top - node.getBoundingClientRect().top - (parseFloat(cs.borderTopWidth) || 0);
    }
    if (node === view) break;
  }
  return Infinity;
}

// 카드 윗변에 걸친 테이프 등(디자인 4)은 비워 두고 옆에서부터 깐다.
function cutsFor(host, rect) {
  let cutLeft = 0; let cutRight = rect.width;
  const blockers = [...host.querySelectorAll(':scope > *, .fanpage-binder-tape')].filter((el) => !el.classList.contains(PILE_CLASS));
  for (const el of blockers) {
    // 윗변에 닿거나 걸친 이름표·테이프(PROFILE 탭 등). 윗변 전체를 덮는 머리 칸은 제외.
    const r = el.getBoundingClientRect();
    if (!r.width || r.width > rect.width * 0.6 || r.bottom < rect.top - 2 || r.top > rect.top + 4) continue;
    const l = r.left - rect.left; const rr = r.right - rect.left;
    if (l < rect.width / 2) cutLeft = Math.max(cutLeft, rr + 4); else cutRight = Math.min(cutRight, l - 4);
  }
  return { cutLeft, cutRight };
}

function contour(x, w, rl, rr) {
  if (x < rl) return rl - Math.sqrt(Math.max(0, rl * rl - (rl - x) ** 2));
  if (x > w - rr) return rr - Math.sqrt(Math.max(0, rr * rr - (x - (w - rr)) ** 2));
  return 0;
}

const f2 = (n) => n.toFixed(2);

function buildSvg({ w, T, rl, rr, rnd, kind, look, melting, cutLeft, cutRight }) {
  const id = `fpsnow${++gradientSeq}`;
  const lip = kind === 'card' ? 3 : 2.6;
  const endX = (r, left) => {
    if (r <= 0) return left ? 0 : w;
    const d = r * 0.18;
    const dx = r - Math.sqrt(Math.max(0, r * r - (r - d) ** 2));
    return left ? dx : w - dx;
  };
  const xs = Math.max(endX(rl, true), cutLeft);
  const xe = Math.min(endX(rr, false), cutRight);
  const hasLeftLip = cutLeft <= 0; const hasRightLip = cutRight >= w;
  const span = xe - xs;
  if (span < 24) return '';
  const ph1 = uniform(rnd, 0, 6); const ph2 = uniform(rnd, 0, 6);
  const fr1 = uniform(rnd, 1.6, 2.6); const fr2 = uniform(rnd, 4.5, 7.5);
  const bumps = Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => [uniform(rnd, 0.2, 0.8), uniform(rnd, 0.08, 0.16), uniform(rnd, 0.15, 0.3)]);
  const ease = (e) => 1 - (1 - Math.min(1, e)) ** 2;
  const thick = (x) => {
    const t = (x - xs) / span;
    const el = (hasLeftLip ? 0.45 : 0) + (1 - (hasLeftLip ? 0.45 : 0)) * ease(t / 0.12);
    const er = (hasRightLip ? 0.45 : 0) + (1 - (hasRightLip ? 0.45 : 0)) * ease((1 - t) / 0.12);
    let lump = 0.9 + 0.06 * Math.sin(t * Math.PI * fr1 + ph1) + 0.04 * Math.sin(t * Math.PI * fr2 + ph2);
    for (const [c, wd, amp] of bumps) lump += amp * Math.exp(-(((t - c) / wd) ** 2));
    return T * Math.min(el, er) * lump;
  };
  const step = span > 300 ? 3 : 1.5;
  const n = Math.max(8, Math.round(span / step));
  const top = [];
  for (let i = 0; i <= n; i += 1) { const x = xs + (span * i) / n; top.push([x, contour(x, w, rl, rr) - thick(x)]); }
  const yL = contour(xs, w, rl, rr); const yR = contour(xe, w, rl, rr);
  const drop = 1.2;
  const d = [];
  if (hasLeftLip) {
    d.push(`M${f2(xs - lip)},${f2(yL + drop)}`, `Q${f2(xs - lip - 0.6)},${f2(top[0][1] + 0.5)} ${f2(top[0][0])},${f2(top[0][1])}`);
  } else d.push(`M${f2(xs)},${f2(yL + 0.4)} L${f2(xs)},${f2(top[0][1])}`);
  for (let i = 1; i < top.length; i += 1) d.push(`L${f2(top[i][0])},${f2(top[i][1])}`);
  if (hasRightLip) {
    d.push(`Q${f2(xe + lip + 0.6)},${f2(top[n][1] + 0.5)} ${f2(xe + lip)},${f2(yR + drop)}`, `Q${f2(xe + 0.5)},${f2(yR + drop + 0.8)} ${f2(xe - 1)},${f2(yR + 0.5)}`);
  } else d.push(`L${f2(xe)},${f2(yR + 0.4)}`);
  for (let i = n; i >= 0; i -= 1) { const x = xs + (span * i) / n; d.push(`L${f2(x)},${f2(contour(x, w, rl, rr) + 0.5)}`); }
  if (hasLeftLip) d.push(`Q${f2(xs - 0.5)},${f2(yL + drop + 0.8)} ${f2(xs - lip)},${f2(yL + drop)}`);
  d.push('Z');

  //  고드름은 녹는 동안에만(처마 끝에서 떨어지는 물이 얼어 맺히는 모습). 바깥쪽이 길고 안쪽이 짧다.
  const icicles = [];
  if (melting) {
    const ends = [];
    if (hasLeftLip) ends.push([xs, yL, -1]);
    if (hasRightLip) ends.push([xe, yR, 1]);
    for (const [ex, ey, sgn] of ends) {
      const count = rnd() < 0.34 ? 1 : 2;
      for (let j = 0; j < count; j += 1) {
        const x = ex + sgn * (lip - 1.6) - sgn * j * uniform(rnd, 3.6, 5);
        const L = (j === 0 ? uniform(rnd, 7, 11) : uniform(rnd, 3.5, 6)) * (w > 300 ? 1.15 : 1) * Math.max(0.5, T / BASE_THICKNESS[kind]);
        const wd = j === 0 ? uniform(rnd, 2.8, 3.4) : uniform(rnd, 2, 2.6);
        icicles.push([x, ey + drop - 1.2, L, wd]);
      }
    }
  }
  const pad = 8;
  const minY = Math.min(...top.map((p) => p[1])) - 2;
  const maxY = Math.max(contour(0, w, rl, rr) + 4, ...icicles.map(([, y0, L]) => y0 + L + 3)) + 3;
  const vw = w + pad * 2; const vh = maxY - minY;

  const looks = {
    light: { cap: 'stroke="rgba(125,150,192,.35)" stroke-width=".5" stroke-linejoin="round"', shadow: 'drop-shadow(0 1.6px 1.6px rgba(85,110,160,.42))', ice: 'stroke="rgba(105,138,190,.6)" stroke-width=".5"', tint: '#cbd9ee' },
    dark: { cap: '', shadow: 'drop-shadow(0 1.5px 1.5px rgba(0,0,0,.35))', ice: 'stroke="rgba(200,220,250,.35)" stroke-width=".4"', tint: '#dfe8f6' },
    ink: { cap: 'stroke="#2f2a2c" stroke-width="1.1" stroke-linejoin="round"', shadow: 'drop-shadow(1.2px 1.6px 0 rgba(47,42,44,.28))', ice: 'stroke="#2f2a2c" stroke-width=".7"', tint: '#cbd9ee' },
  };
  const lk = looks[look];
  const iceSvg = icicles.map(([x, y0, L, wd]) => {
    const body = `M${f2(x - wd / 2)},${f2(y0)} C${f2(x - wd / 2)},${f2(y0 + L * 0.38)} ${f2(x - wd * 0.1)},${f2(y0 + L * 0.8)} ${f2(x)},${f2(y0 + L)} C${f2(x + wd * 0.1)},${f2(y0 + L * 0.8)} ${f2(x + wd / 2)},${f2(y0 + L * 0.38)} ${f2(x + wd / 2)},${f2(y0)} Z`;
    const shine = `M${f2(x - wd * 0.2)},${f2(y0 + 1)} Q${f2(x - wd * 0.16)},${f2(y0 + L * 0.45)} ${f2(x - wd * 0.04)},${f2(y0 + L * 0.72)}`;
    const drip = L > 12 ? `<ellipse cx="${f2(x)}" cy="${f2(y0 + L + 1.8)}" rx=".8" ry="1.1" fill="#b8d1f1" opacity=".85"/>` : '';
    return `<path d="${body}" fill="url(#i${id})" ${lk.ice}/><path d="${shine}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="${f2(Math.max(0.5, wd * 0.14))}" stroke-linecap="round"/>${drip}`;
  }).join('');
  const highlight = 'M' + top.slice(2, -2).map(([x, y]) => `${f2(x)},${f2(y + 0.9)}`).join(' L');
  return {
    minY, pad, vw, vh,
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(vw)}" height="${f2(vh)}" viewBox="${f2(-pad)} ${f2(minY)} ${f2(vw)} ${f2(vh)}" focusable="false">`
      + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f7faff"/><stop offset="1" stop-color="${lk.tint}"/></linearGradient>`
      + `<linearGradient id="i${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f8ff" stop-opacity=".97"/><stop offset=".6" stop-color="#cfe0f6" stop-opacity=".92"/><stop offset="1" stop-color="#a6c3ea" stop-opacity=".85"/></linearGradient></defs>`
      + iceSvg
      + `<path d="${d.join(' ')}" fill="url(#${id})" ${lk.cap} style="filter:${lk.shadow}"/>`
      + (top.length > 6 ? `<path d="${highlight}" fill="none" stroke="rgba(255,255,255,.95)" stroke-width=".9" stroke-linecap="round"/>` : '')
      + '</svg>',
  };
}

const CLIPPING = /(hidden|clip|auto|scroll)/;
const clipsSelf = (cs) => CLIPPING.test(cs.overflowX) || CLIPPING.test(cs.overflowY);
const visibleColor = (c) => { const m = String(c).match(/[\d.]+/g); return !!m && !/transparent/.test(c) && (m.length < 4 || Number(m[3]) > 0.05); };
// 눈이 얹힐 '보이는 윗면'이 있는지: 배경색·배경 그림·테두리·그림자 중 하나라도 보이면 있다.
function hasSurface(cs) {
  return visibleColor(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none'
    || ((parseFloat(cs.borderTopWidth) || 0) > 0 && visibleColor(cs.borderTopColor));
}
// 탭 줄이 넘침을 자르지 않고(가로 스크롤 아님) 바탕이 보이면 탭 줄 윗면에 얹고, 안의 탭 버튼은 뺀다.
function navTakesSnow(nav) {
  if (!nav || nav.offsetWidth < MIN_WIDTH) return false;
  const cs = getComputedStyle(nav);
  return !clipsSelf(cs) && hasSurface(cs);
}

function eligible(host, cs) {
  if (!host.isConnected || host.closest(EXCLUDE)) return false;
  if (clipsSelf(cs) || !hasSurface(cs)) return false; // 자기 영역 밖을 자르는 요소는 눈이 잘린다
  if (host.classList.contains('fanpage-tab-nav')) return navTakesSnow(host);
  if (host.classList.contains('fanpage-tab-button')) return !navTakesSnow(host.closest('.fanpage-tab-nav'));
  return true;
}

function removePile(host) {
  host.querySelector(`:scope > .${PILE_CLASS}`)?.remove();
  host.classList.remove(HOST_CLASS);
  drawn.delete(host);
}

function draw(host) {
  if (!state || !host.isConnected) { removePile(host); return; }
  const w = host.offsetWidth; const h = host.offsetHeight;
  if (w < MIN_WIDTH || h < 16) { removePile(host); return; }
  const cs = getComputedStyle(host);
  if (!eligible(host, cs)) { removePile(host); return; }
  const kind = kindOf(host);
  const look = styleKind();
  let T = BASE_THICKNESS[kind] * state.amount;
  const room = roomAbove(host);
  if (room !== Infinity) T = Math.min(T, room - 2.5); // 가로 스크롤 탭 줄 등: 칸 안에 들어가는 낮은 눈
  if (T < 1.4) { removePile(host); return; }
  const rect = host.getBoundingClientRect();
  const { cutLeft, cutRight } = kind === 'card' ? cutsFor(host, rect) : { cutLeft: 0, cutRight: w };
  const key = [w, h, T.toFixed(2), look, state.melting, cs.borderTopLeftRadius, cs.borderTopRightRadius, cutLeft, cutRight].join('|');
  const existing = host.querySelector(`:scope > .${PILE_CLASS}`);
  if (existing && drawn.get(host) === key) return;
  const rl = radiusPx(cs.borderTopLeftRadius, w, h); const rr = radiusPx(cs.borderTopRightRadius, w, h);
  const svg = buildSvg({ w, T, rl, rr, rnd: rng(seedFor(host)), kind, look, melting: state.melting, cutLeft, cutRight });
  if (!svg) { removePile(host); return; }
  const pile = existing || document.createElement('span');
  pile.className = PILE_CLASS;
  pile.setAttribute('aria-hidden', 'true');
  const bl = parseFloat(cs.borderLeftWidth) || 0; const bt = parseFloat(cs.borderTopWidth) || 0;
  const set = (prop, value) => pile.style.setProperty(prop, value, 'important');
  set('left', `${-svg.pad - bl}px`); set('top', `${svg.minY - bt}px`);
  set('width', `${svg.vw}px`); set('height', `${svg.vh}px`);
  pile.innerHTML = svg.markup;
  if (!existing) {
    if (cs.position === 'static') host.classList.add(HOST_CLASS);
    if (!state.reduced) pile.classList.add('is-growing');
    host.append(pile);
  }
  drawn.set(host, key);
}

function scan() {
  scanTimer = 0;
  if (!state || !view) return;
  for (const host of view.querySelectorAll(TARGETS)) {
    resizeObserver.observe(host); // 숨은 탭의 카드가 보이게 되면 크기 변화로 다시 그린다
    draw(host);
  }
}

function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(scan, 150); }

const ownNode = (node) => node.nodeType === 1 && (node.classList?.contains(PILE_CLASS) || node.closest?.(`.${PILE_CLASS}`));

function start() {
  view = document.getElementById('fanPageView');
  if (!view) return false;
  resizeObserver ??= new ResizeObserver((entries) => { if (state) for (const e of entries) draw(e.target); });
  mutationObserver ??= new MutationObserver((records) => {
    // 자기가 붙인 눈 그림 변화는 무시(무한 반복 방지). 탭 선택·숨김 변경은 바탕이 바뀔 수 있어 다시 본다.
    if (records.some((r) => r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some((n) => !ownNode(n)))) scheduleScan();
  });
  viewObserver ??= new MutationObserver(() => { for (const pile of view.querySelectorAll(`.${PILE_CLASS}`)) drawn.delete(pile.parentElement); scheduleScan(); });
  mutationObserver.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'] });
  viewObserver.observe(view, { attributes: true, attributeFilter: ['class'] });
  return true;
}

export function renderPile(next) {
  const changed = !state || state.amount !== next.amount || state.melting !== next.melting;
  state = { ...next };
  if (!view && !start()) return;
  if (changed) for (const pile of view.querySelectorAll(`.${PILE_CLASS}`)) drawn.delete(pile.parentElement);
  scan();
}

export function clearPile() {
  state = null;
  clearTimeout(scanTimer); scanTimer = 0;
  mutationObserver?.disconnect(); viewObserver?.disconnect(); resizeObserver?.disconnect();
  for (const pile of document.querySelectorAll(`.${PILE_CLASS}`)) { pile.parentElement?.classList.remove(HOST_CLASS); pile.remove(); }
  view = null;
}
