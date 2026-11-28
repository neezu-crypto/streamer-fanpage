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
// 직접 입력한 근거로 다시보기 유지율(%) 계산. 30일 지나면 무효.
export const RETENTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export function retentionPercent(state, now = Date.now()) {
  const ret = state && state.retention;
  if (!ret || !(now - Number(ret.at) < RETENTION_TTL_MS)) return null;
  const v = Number(ret.value);
  if (ret.type === 'percent') return Math.min(100, v);
  if (!Number.isFinite(state.replayCount)) return null;
  if (ret.type === 'count') return Math.min(100, (state.replayCount / v) * 100);
  if (ret.type === 'hours') return Math.min(100, ((Number(state.replaySeconds) || 0) / 3600 / v) * 100);
  return null;
}
export function retentionBonus(pct) { return pct == null ? 0 : pct >= 90 ? 5 : pct >= 80 ? 3 : pct >= 70 ? 1 : 0; }

export function renderBestStreamerCard(state, onRefresh = null, onRetention = null) {
  if (!state || !Number.isFinite(state.fanCount) || !Number.isFinite(state.totalBroadHours)) return null;
  const box = el('div', 'best-check');
  const head = el('div', 'best-check-head');
  head.append(el('strong', '', state.isBest ? '🏅 베스트 스트리머' : '🏅 베스트 스트리머 도전 현황'));
  const link = el('a', 'best-check-link', '공식 기준 ↗'); link.href = OFFICIAL_URL; link.target = '_blank'; link.rel = 'noopener';
  const tools = el('div', 'best-check-tools');
  if (onRefresh && !state.isBest) {
    const refresh = el('button', 'best-check-refresh', state.bestLoading ? '계산 중…' : '↻ 다시 계산');
    refresh.type = 'button'; refresh.disabled = !!state.bestLoading;
    refresh.addEventListener('click', () => { refresh.disabled = true; refresh.textContent = '계산 중…'; onRefresh(); });
    tools.append(refresh);
  }
  tools.append(link); head.append(tools); box.append(head);
  if (state.isBest) { box.append(el('p', 'best-check-note', '지금 SOOP 베스트 스트리머예요.')); return box; }
  const r = evaluate(state);
  const sb = state.specialty ? 5 : 0; // 전문 스트리머 뱃지(방송국 공개)
  const retPct = retentionPercent(state);
  const rb = retentionBonus(retPct);
  const vodPts = Number.isFinite(state.vodCount) ? vodBonus(state.vodCount) : 0;
  const vb = vodPts + sb + rb;
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
  const got = [sb ? `${state.specialty} 전문 +5` : '', vodPts ? `VOD +${vodPts}` : '', rb ? `다시보기 유지율 ${Math.round(retPct)}% +${rb}` : ''].filter(Boolean);
  if (got.length) meter.append(el('p', 'best-check-got', `가산점 ${got.join(' · ')}`));
  box.append(meter);
  if (gap <= 0) { box.append(el('p', 'best-check-pass', '🎉 75점 달성!')); return box; }
  // 최적화는 모든 점수(평균 동접·VOD·전문 뱃지)를 계산한 뒤에만 보여 준다.
  if (!Number.isFinite(state.viewerScore) || !Number.isFinite(state.vodCount)) {
    box.append(el('p', 'best-check-need-title', '점수 계산 전이에요 · 스트리머가 팬페이지에 들어오면 계산돼요'));
    return box;
  }
  // 가장 적게 늘려서 75점이 되는 조합: 항목마다 (지금 그대로 | 표의 더 높은 단계)를 모두 시도하고
  // 비용 = 늘려야 하는 배율의 로그 합(애청자 2배 = 시청자 2배 = 방송 시간 2배를 같은 노력으로 본다).
  const rowOf = (kind, score) => SCORE_TABLE.find((t) => t[0] === score);
  const currentValue = {
    viewers: scores.viewers > 50 ? rowOf('viewers', scores.viewers)[COL.viewers] : 5, // 공개하지 않는 동접은 그 점수 구간의 하한
    fans: Math.max(1, r.fans), hours: Math.max(1, r.hours),
  };
  const choices = (kind) => [[scores[kind], 0, null]].concat(SCORE_TABLE.filter((t) => t[0] > scores[kind])
    .map((t) => [t[0], Math.log(t[COL[kind]] / currentValue[kind]), t[COL[kind]]]));
  let best = null;
  for (const [vS, vC, vT] of choices('viewers')) for (const [fS, fC, fT] of choices('fans')) for (const [hS, hC, hT] of choices('hours')) {
    if (total({ viewers: vS, fans: fS, hours: hS }) < PASS_SCORE) continue;
    const cost = vC + fC + hC;
    if (!best || cost < best.cost - 1e-9) best = { cost, picks: [['viewers', vT], ['fans', fT], ['hours', hT]] };
  }
  const labels = { viewers: ['평균 시청자', '명'], fans: ['애청자', '명'], hours: ['방송 시간', '시간'] };
  const current = { viewers: null, fans: r.fans, hours: r.hours };
  const need = el('div', 'best-check-need');
  need.append(el('p', 'best-check-need-title', `${fmt(gap)}점 더 필요해요 · 가장 쉬운 조합`));
  if (best) {
    const list = el('div', 'best-check-options');
    best.picks.filter(([, target]) => target != null).forEach(([kind, target], i) => {
      if (i) list.append(el('span', 'best-check-or', '+'));
      const [label, unit] = labels[kind];
      const chip = el('div', 'best-check-option');
      chip.append(el('span', 'best-check-option-label', label), el('b', '', `${n(target)}${unit}`));
      if (current[kind] != null) chip.append(el('small', '', `+${n(Math.max(0, Math.ceil(target - current[kind])))}${unit}`));
      list.append(chip);
    });
    need.append(list);
  } else need.append(el('p', 'best-check-need-title', '가산점이 필요해요'));
  // 가산점(최대 +15): VOD는 센 값이 있으면 남은 만큼, 유지율·전문 스트리머는 비공개라 받을 수 있는 최대치
  const bonus = [];
  if (vodPts < 5) bonus.push(['VOD 13개', Number.isFinite(state.vodCount) ? `+${n(13 - state.vodCount)}개` : '최근 3개월', 5 - vodPts]);
  if (rb < 5) bonus.push(['다시보기 유지율 90%', retPct != null ? `지금 ${Math.round(retPct)}%` : '', 5 - rb]);
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
  if (onRetention) bonusBox.append(retentionForm(state, retPct, onRetention));
  need.append(bonusBox);
  box.append(need);
  const miss = [r.apply.fans === false ? `애청자 ${n(APPLY.fans)}명` : '', r.apply.hours === false ? `방송 ${n(APPLY.hours)}시간` : ''].filter(Boolean);
  if (miss.length) box.append(el('p', 'best-check-apply', `신청 조건: ${miss.join(' · ')}`));
  return box;
}

// 스트리머·관리자 입력: 유지율 % · 최근 3개월 방송 횟수 · 최근 3개월 방송 시간 중 하나
const RETENTION_TYPES = [['percent', '유지율', '%'], ['count', '방송 횟수', '회'], ['hours', '방송 시간', '시간']];
function retentionForm(state, retPct, onRetention) {
  const form = el('form', 'best-check-retention');
  const ret = state.retention;
  const expired = ret && !(Date.now() - Number(ret.at) < RETENTION_TTL_MS);
  form.append(el('span', 'best-check-option-label', expired ? '다시보기 유지율 · 30일이 지나 다시 입력해 주세요' : '다시보기 유지율 입력 (최근 3개월)'));
  const row = el('div', 'best-check-retention-row');
  const select = el('select');
  RETENTION_TYPES.forEach(([value, label]) => { const o = el('option', '', label); o.value = value; select.append(o); });
  const input = el('input'); input.type = 'number'; input.inputMode = 'decimal'; input.min = '0'; input.step = '0.1'; input.required = true;
  const unit = el('span', 'best-check-unit');
  const sync = () => { const t = RETENTION_TYPES.find((x) => x[0] === select.value); unit.textContent = t[2]; input.max = select.value === 'percent' ? '100' : select.value === 'count' ? '1000' : '3000'; };
  if (ret && !expired) { select.value = ret.type; input.value = String(ret.value); }
  sync(); select.addEventListener('change', sync);
  const save = el('button', 'best-check-refresh', '저장'); save.type = 'submit';
  row.append(select, input, unit, save);
  form.append(row);
  const msg = el('small', 'best-check-unit', '');
  form.append(msg);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true; msg.textContent = '저장 중…';
    try { await onRetention(select.value, Number(input.value)); }
    catch (error) { msg.textContent = (error && error.message) || '저장하지 못했어요.'; save.disabled = false; }
  });
  return form;
}
