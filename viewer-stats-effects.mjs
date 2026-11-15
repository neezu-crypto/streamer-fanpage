// 고점체크 분석 완료 연출: 숫자 올리기·순위 시상대·기간 도장·카드 핀 배지·그래프 미리보기.
// 모두 경과 시간 기준(requestAnimationFrame + CSS 애니메이션)이라 주사율과 상관없이 같은 속도로 끝난다(1.5초 이내).
// 동작 줄이기 설정이거나 탭이 숨겨져 있으면 움직임 없이 최종 강조 상태만 바로 보여 준다.

const reduceMedia = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export function effectsReduced() {
  return Boolean((reduceMedia && reduceMedia.matches) || (typeof document !== 'undefined' && document.hidden));
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const counters = new WeakMap();

// el의 숫자를 0 → to로 올린다. 끝나면 원래 문구(finalText)로 정확히 맞춘다.
export function countUp(el, to, { ms = 700, delay = 0, format = (n) => Math.round(n).toLocaleString('ko-KR'), finalText } = {}) {
  if (!el) return;
  const target = Math.max(0, Number(to) || 0);
  const done = finalText ?? format(target);
  cancelAnimationFrame(counters.get(el) || 0);
  if (effectsReduced() || !target) { el.textContent = done; return; }
  el.textContent = format(0);
  const start = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    el.textContent = t >= 1 ? done : format(target * easeOut(t));
    if (t < 1) counters.set(el, requestAnimationFrame(step));
  };
  counters.set(el, requestAnimationFrame(step));
}

function restartClass(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

// ② 순위 시상대: 카드가 차례로 올라오고 1위 왕관, 1~3위 금·은·동 테두리가 한 번 반짝인다.
// cards는 순위 순서. tie=true면 왕관 없이 등장 연출만 한다.
export function celebrateRanking(cards, { tie = false, medals = 3 } = {}) {
  const list = (cards || []).filter(Boolean);
  if (!list.length) return;
  const reduced = effectsReduced();
  list.forEach((card, index) => {
    card.classList.add('vs-fx-card');
    card.style.setProperty('--vs-fx-delay', `${index * 90}ms`);
    if (!tie && index < medals) card.classList.add(['vs-fx-gold', 'vs-fx-silver', 'vs-fx-bronze'][index]);
    if (!tie && index === 0 && !card.querySelector('.vs-fx-crown')) {
      const crown = document.createElement('span');
      crown.className = 'vs-fx-crown'; crown.setAttribute('aria-hidden', 'true'); crown.textContent = '👑';
      card.append(crown);
    }
    if (!reduced) restartClass(card, 'vs-fx-rise');
  });
  if (reduced) list.forEach((card) => card.classList.add('vs-fx-settled'));
  else setTimeout(() => list.forEach((card) => card.classList.add('vs-fx-settled')), 120 + list.length * 90 + 300);
}

// ③ 기간별: 카드가 차례로 뒤집히고 bestIndex 카드에 "최고 기록" 도장.
export function celebratePeriods(cards, bestIndex) {
  const list = (cards || []).filter(Boolean);
  if (!list.length) return;
  const reduced = effectsReduced();
  list.forEach((card, index) => {
    card.classList.add('vs-fx-period');
    card.style.setProperty('--vs-fx-delay', `${index * 100}ms`);
    if (!reduced) restartClass(card, 'vs-fx-flip');
  });
  const best = list[bestIndex];
  if (!best) return;
  if (!best.querySelector('.vs-fx-stamp')) {
    const stamp = document.createElement('span');
    stamp.className = 'vs-fx-stamp'; stamp.textContent = '🏆 최고 기록';
    best.append(stamp);
  }
  const settle = () => best.classList.add('vs-fx-best');
  if (reduced) settle(); else setTimeout(settle, list.length * 100 + 450);
}

// ① 다시보기 카드: 최고 수치를 올리고 📍 배지를 튀어나오게 한다.
export function celebrateVodCard(card, { peakEl, peak, finalText } = {}) {
  if (!card) return;
  if (peakEl) countUp(peakEl, peak, { ms: 650, finalText });
  card.classList.add('vs-fx-vod');
  if (!effectsReduced()) restartClass(card, 'vs-fx-vod-pop');
}

// ④ 그래프 미리보기: curve.points(최대 60)를 SVG로 그리고 peakIndex에 핀을 꽂는다.
const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientSeq = 0;
export function drawPeakCurve(container, curve) {
  if (!container || !curve || !Array.isArray(curve.points) || curve.points.length < 2) return;
  const W = 300; const H = 96; const top = 16; const bottom = 6;
  const max = Math.max(1, ...curve.points);
  const pts = curve.points.map((value, index) => [index / (curve.points.length - 1) * W, H - bottom - (value / max) * (H - top - bottom)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const id = `vsFxGrad${++gradientSeq}`;
  container.replaceChildren();
  const wrap = document.createElement('div'); wrap.className = 'vs-fx-curve';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#486bd6" stop-opacity=".25"/><stop offset="1" stop-color="#486bd6" stop-opacity="0"/></linearGradient></defs>`;
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('class', 'vs-fx-curve-area'); area.setAttribute('fill', `url(#${id})`); area.setAttribute('d', `${d} L${W} ${H} L0 ${H} Z`);
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('class', 'vs-fx-curve-line'); line.setAttribute('d', d);
  svg.append(area, line);
  const pin = document.createElement('span'); pin.className = 'vs-fx-pin'; pin.setAttribute('aria-hidden', 'true'); pin.textContent = '📍';
  const ring1 = document.createElement('span'); ring1.className = 'vs-fx-ring'; ring1.setAttribute('aria-hidden', 'true');
  const ring2 = ring1.cloneNode(); ring2.classList.add('is-late');
  const peakIndex = Math.min(Math.max(0, curve.peakIndex | 0), pts.length - 1);
  const [px, py] = pts[peakIndex];
  [pin, ring1, ring2].forEach((el) => { el.style.left = `${(px / W) * 100}%`; el.style.top = `${(py / H) * 100}%`; });
  wrap.append(svg, ring1, ring2, pin);
  container.append(wrap);
  if (effectsReduced()) { wrap.classList.add('is-drawn'); return; }
  const length = line.getTotalLength();
  line.style.strokeDasharray = `${length}`; line.style.strokeDashoffset = `${length}`;
  void line.getBoundingClientRect();
  line.style.transition = 'stroke-dashoffset 550ms ease-out'; line.style.strokeDashoffset = '0';
  setTimeout(() => wrap.classList.add('is-drawn'), 550 * (peakIndex / pts.length) + 80);
}
