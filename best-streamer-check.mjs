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
  const sb = state.specialty ? 5 : 0; // 전문 스트리머 뱃지(방송국 공개)
  const vb = (Number.isFinite(state.vodCount) ? vodBonus(state.vodCount) : 0) + sb;
  const vodPts = vb - sb;
  // 평균 동접 점수를 아직 모르면 최저점(50)으로 둔다 — 누구나 받는 점수라 현재 점수가 부풀지 않는다.
  const scores = { viewers: Number.isFinite(state.viewerScore) ? state.viewerScore : 50, fans: r.fanScore, hours: r.hourScore };
  const total = (sc) => sc.viewers * WEIGHTS.viewers + sc.fans * WEIGHTS.fans + sc.hours * WEIGHTS.hours + vb;
  const score = total(scores);
  const gap = Math.max(0, PASS_SCORE - score);
  const pct = Math.min(100, (score / PASS_SCORE) * 100);
  const meter = el('div', 'best-check-meter');
  const now = el('div', 'best-check-score'); now.append(el('b', '', fmt(score)), el('span', '', ' / 75점'));
  const bar = el('div', 'best-check-bar'); const fill = el('i'); fill.style.width = `${pct}%`; bar.append(fill);
  meter.append(now, bar);
  const got = [sb ? `${state.specialty} 전문 +5` : '', vodPts ? `VOD +${vodPts}` : ''].filter(Boolean);
  if (got.length) meter.append(el('p', 'best-check-got', `가산점 ${got.join(' · ')}`));
  box.append(meter);
  if (gap <= 0) { box.append(el('p', 'best-check-pass', '🎉 75점 달성!')); return box; }
  // 한 항목만 올려서 75점이 되는 값(다른 항목은 그대로)
  const current = { viewers: null, fans: r.fans, hours: r.hours };
  const options = [];
  for (const [kind, label, unit] of [['viewers', '평균 시청자', '명'], ['fans', '애청자', '명'], ['hours', '방송 시간', '시간']]) {
    const row = [...SCORE_TABLE].reverse().find((t) => t[0] > scores[kind] && total({ ...scores, [kind]: t[0] }) >= PASS_SCORE);
    if (!row) continue;
    const target = row[COL[kind]];
    const plus = current[kind] == null ? null : Math.max(0, Math.ceil(target - current[kind]));
    options.push([label, `${n(target)}${unit}`, plus == null ? '' : `+${n(plus)}${unit}`]);
  }
  const need = el('div', 'best-check-need');
  need.append(el('p', 'best-check-need-title', `${fmt(gap)}점 더 필요해요`));
  if (options.length) {
    const list = el('div', 'best-check-options');
    options.forEach(([label, value, plus], i) => {
      if (i) list.append(el('span', 'best-check-or', '또는'));
      const chip = el('div', 'best-check-option');
      chip.append(el('span', 'best-check-option-label', label), el('b', '', value));
      if (plus) chip.append(el('small', '', plus));
      list.append(chip);
    });
    need.append(list);
  } else need.append(el('p', 'best-check-need-title', '한 항목만으로는 어려워요'));
  // 가산점(최대 +15): VOD는 센 값이 있으면 남은 만큼, 유지율·전문 스트리머는 비공개라 받을 수 있는 최대치
  const bonus = [];
  if (vodPts < 5) bonus.push(['VOD 13개', Number.isFinite(state.vodCount) ? `+${n(13 - state.vodCount)}개` : '최근 3개월', 5 - vodPts]);
  bonus.push(['다시보기 유지율 90%', '', 5]);
  if (!sb) bonus.push(['전문 스트리머', '뱃지', 5]);
  const bonusBox = el('div', 'best-check-bonus');
  bonusBox.append(el('p', 'best-check-need-title', '가산점으로 채우기'));
  const bonusList = el('div', 'best-check-options');
  bonus.forEach(([label, sub, pts]) => {
    const chip = el('div', `best-check-option is-bonus${pts >= gap ? ' is-enough' : ''}`);
    chip.append(el('span', 'best-check-option-label', label), el('b', '', `+${pts}점`));
    if (sub) chip.append(el('small', '', sub));
    bonusList.append(chip);
  });
  bonusBox.append(bonusList);
  need.append(bonusBox);
  box.append(need);
  const miss = [r.apply.fans === false ? `애청자 ${n(APPLY.fans)}명` : '', r.apply.hours === false ? `방송 ${n(APPLY.hours)}시간` : ''].filter(Boolean);
  if (miss.length) box.append(el('p', 'best-check-apply', `신청 조건: ${miss.join(' · ')}`));
  return box;
}
