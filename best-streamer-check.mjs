// 베스트 스트리머 도전 현황(팬페이지 라이브 영역 아래). SOOP 공식 기준표(streamer.sooplive.com/star/best,
// 2026-12 신청분부터)로 공개 수치만 계산한 예상치. 서버 호출 없음: 방송 상태 응답의 애청자·누적 방송 시간·베스트 여부를 쓴다.
// 설계: docs/베스트스트리머_기준체크_설계.md

// [점수, 평균 동접, 애청자, 방송 시간(시간)] — 각 값 "이상"이면 그 점수. 어느 것도 못 넘으면 50점.
export const SCORE_TABLE = [
  [100, 1000, 50000, 10000], [98, 750, 40000, 9500], [96, 500, 30000, 9000], [94, 450, 20000, 8500],
  [92, 400, 10000, 8000], [90, 350, 9000, 7500], [88, 300, 8000, 7000], [86, 250, 7000, 6500],
  [84, 200, 6000, 6000], [82, 160, 5600, 5500], [80, 130, 5200, 5000], [78, 100, 4800, 4500],
  [76, 90, 4400, 4000], [74, 80, 4000, 3500], [72, 70, 3600, 3000], [70, 60, 3200, 2600],
  [68, 50, 2800, 2200], [66, 40, 2400, 1800], [64, 30, 2000, 1400], [62, 20, 1500, 1000], [60, 10, 1000, 500],
];
export const PASS_SCORE = 75;
export const BONUS_MAX = 15;
export const WEIGHTS = { viewers: 0.4, fans: 0.4, hours: 0.2 };
const COL = { viewers: 1, fans: 2, hours: 3 };
export const APPLY = { hours: 100, fans: 500, days: 30, education: 5 };
// 최근 3개월 VOD 수(업로드+클립, 1분 초과) → 가산점
export function vodBonus(count) { const c = Number(count); if (!Number.isFinite(c) || c < 1) return 0; return c >= 13 ? 5 : c >= 10 ? 4 : c >= 7 ? 3 : c >= 4 ? 2 : 1; }
export const OFFICIAL_URL = 'https://streamer.sooplive.com/star/best';

export function stepScore(kind, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const row = SCORE_TABLE.find((r) => v >= r[COL[kind]]);
  return row ? row[0] : 50;
}
// 한 단계 위 기준(없으면 null): { score, need }
export function nextStep(kind, value) {
  const cur = stepScore(kind, value);
  const up = [...SCORE_TABLE].reverse().find((r) => r[0] > cur);
  return up ? { score: up[0], need: up[COL[kind]] - Number(value) } : null;
}
// 애청자·방송 시간 점수가 정해졌을 때 75점에 필요한 평균 동접(가산점 bonus 가정). 불가능하면 null.
export function viewersNeeded(fanScore, hourScore, bonus = 0) {
  const base = fanScore * WEIGHTS.fans + hourScore * WEIGHTS.hours + bonus;
  if (50 * WEIGHTS.viewers + base >= PASS_SCORE) return 0;
  const row = [...SCORE_TABLE].reverse().find((r) => r[0] * WEIGHTS.viewers + base >= PASS_SCORE);
  return row ? row[COL.viewers] : null;
}

export function evaluate({ fanCount, totalBroadHours }) {
  const fans = Number.isFinite(fanCount) ? fanCount : null;
  const hours = Number.isFinite(totalBroadHours) ? totalBroadHours : null;
  const fanScore = fans == null ? null : stepScore('fans', fans);
  const hourScore = hours == null ? null : stepScore('hours', hours);
  const ready = fanScore != null && hourScore != null;
  return {
    fans, hours, fanScore, hourScore,
    apply: { fans: fans == null ? null : fans >= APPLY.fans, hours: hours == null ? null : hours >= APPLY.hours },
    viewersNoBonus: ready ? viewersNeeded(fanScore, hourScore, 0) : null,
    viewersFullBonus: ready ? viewersNeeded(fanScore, hourScore, BONUS_MAX) : null,
    nextFans: fans == null ? null : nextStep('fans', fans),
    nextHours: hours == null ? null : nextStep('hours', hours),
  };
}

const n = (v) => Number(v).toLocaleString('ko-KR');
const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('ko-KR');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// state: { fanCount, totalBroadHours, isBest } — 아직 모르면 null 반환(카드 숨김)
export function renderBestStreamerCard(state) {
  if (!state || !Number.isFinite(state.fanCount) || !Number.isFinite(state.totalBroadHours)) return null;
  const box = el('div', 'best-check');
  const head = el('div', 'best-check-head');
  head.append(el('strong', '', state.isBest ? '🏅 베스트 스트리머' : '🏅 베스트 스트리머 도전 현황'));
  const link = el('a', 'best-check-link', '공식 기준 ↗'); link.href = OFFICIAL_URL; link.target = '_blank'; link.rel = 'noopener';
  head.append(link); box.append(head);
  if (state.isBest) { box.append(el('p', 'best-check-note', '지금 SOOP 베스트 스트리머예요.')); return box; }
  const r = evaluate(state);
  const list = el('ul', 'best-check-list');
  const row = (ok, label, value) => { const li = el('li', ok === true ? 'is-ok' : ok === false ? 'is-no' : 'is-unknown'); li.append(el('span', 'best-check-mark', ok === true ? '✓' : ok === false ? '✕' : '?'), el('span', '', label), el('b', '', value)); list.append(li); };
  row(r.apply.fans, '애청자', `${n(r.fans)} / ${n(APPLY.fans)}명 · ${r.fanScore}점`);
  row(r.apply.hours, '누적 방송', `${n(r.hours)} / ${n(APPLY.hours)}시간 · ${r.hourScore}점`);
  row(null, '방송 일수·교육·정지 기록', '본인 확인');
  box.append(list);
  // 확인된 점수(애청자·방송 시간)와 75점까지 부족한 점수, 채우는 방법
  const hasVod = Number.isFinite(state.vodCount);
  const vb = hasVod ? vodBonus(state.vodCount) : 0;
  const base = r.fanScore * WEIGHTS.fans + r.hourScore * WEIGHTS.hours + vb;
  const gap = Math.max(0, PASS_SCORE - base);
  const sum = el('div', 'best-check-sum');
  sum.append(el('p', 'best-check-goal', `확인된 점수 ${fmt(base)}점 · 75점까지 ${fmt(gap)}점 더 필요`));
  sum.append(el('p', 'best-check-next', `애청자 ${r.fanScore}점×40% = ${fmt(r.fanScore * WEIGHTS.fans)} · 방송 시간 ${r.hourScore}점×20% = ${fmt(r.hourScore * WEIGHTS.hours)}${hasVod ? ` · VOD ${n(state.vodCount)}개 가산 +${vb}` : ''} (평균 동접·${hasVod ? '나머지 가산점' : '가산점'}은 빠져 있어요)`));
  box.append(sum);
  const how = el('ul', 'best-check-how');
  const item = (label, text) => { const li = el('li'); li.append(el('b', '', label), el('span', '', text)); how.append(li); };
  // 평균 동접(최대 40점): 가산점 0·5·10·15점일 때 각각 필요한 최근 3개월 평균 동접
  const rest = BONUS_MAX - vb; // 아직 모르는 가산점(VOD를 셌으면 나머지 둘)
  const steps = [...new Set([0, 5, 10].filter((x) => x < rest).concat(rest))];
  const needs = steps.map((bonus) => [bonus, viewersNeeded(r.fanScore, r.hourScore, bonus + vb)]);
  item('평균 동접', needs.map(([bonus, v]) => `${hasVod ? '추가 ' : ''}가산 ${bonus}점이면 ${v == null ? '불가' : v === 0 ? '조건 없음' : `${n(v)}명`}`).join(' · '));
  item('가산점', hasVod
    ? `VOD ${n(state.vodCount)}개 +${vb}${vb < 5 ? ` (13개면 +5)` : ''} · 다시보기 유지율 90% 이상 +5 · 전문 스트리머 +5`
    : '최대 +15점 — VOD 13개 이상 +5 · 다시보기 유지율 90% 이상 +5 · 전문 스트리머 +5 (최근 3개월)');
  const ups = [];
  if (r.nextFans) ups.push(`애청자 +${n(r.nextFans.need)}명이면 +${fmt((r.nextFans.score - r.fanScore) * WEIGHTS.fans)}점`);
  if (r.nextHours) ups.push(`방송 +${n(Math.ceil(r.nextHours.need))}시간이면 +${fmt((r.nextHours.score - r.hourScore) * WEIGHTS.hours)}점`);
  if (ups.length) item('다음 단계', ups.join(' · '));
  box.append(how);
  box.append(el('p', 'best-check-note', 'SOOP 공식 기준표(12월 신청분부터)로 계산한 예상치예요. 평균 동접은 최근 3개월 평균이고, 경고 감점·실제 선발은 SOOP 심사로 정해져요.'));
  return box;
}
