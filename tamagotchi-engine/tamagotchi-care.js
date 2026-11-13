'use strict';

// 다마고치 스탯(돌봄) 서버. 설계: docs/다마고치_스탯_설계.md, docs/다마고치_스탯_서버_설계.md
// - 스탯은 서버만 계산한다. 시간 변화는 마지막 값·시각만 저장하고 읽을 때 계산한다(advance).
// - 브라우저는 상호작용 횟수를 묶어 보내고(interact), 서버가 쿨다운·연타 감소·팬 약한 상한·건강 제한을 적용한다.
// - 하트 보석은 펫 공동 금고. 팬별 기록은 UID 해시 키로 유대감(누적)과 오늘 기여량만 보관한다.

const { createHash } = require('node:crypto');

const PETS_ROOT = 'streamerFanPageTamagotchis';
const FANS_ROOT = 'streamerFanPageTamagotchiFans';
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const DAY = 24 * HOUR;
const STAT_KEYS = ['full', 'mood', 'clean', 'fatigue', 'health'];
const MAX_CATCHUP_HOURS = 24 * 60; // 60일 넘게 방치해도 계산량 제한(그 이상은 바닥 상태와 같다)
const GEM_POOL_MAX = 60;
const LOG_MAX = 30;

class TamagotchiCareError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;
// 날짜 경계는 한국 시간 자정
const dayKey = (now) => new Date(now + 9 * HOUR).toISOString().slice(0, 10);
const sha = (text) => createHash('sha256').update(String(text)).digest('hex');
const fanKey = (uid, streamerId) => sha(`tg-fan:${streamerId}:${uid}`).slice(0, 32);

function freshStats(now) {
  return { full: 80, mood: 80, clean: 80, fatigue: 20, health: 100, at: now, sleepAt: 0, hospitalUntil: 0, softUntil: 0, outpatientDay: '', gems: 0, warned: 0, seenAt: 0 };
}

function normalizeStats(raw, now) {
  const base = freshStats(now);
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  for (const k of STAT_KEYS) if (Number.isFinite(Number(raw[k]))) out[k] = clamp(Number(raw[k]));
  for (const k of ['at', 'sleepAt', 'hospitalUntil', 'softUntil', 'gems', 'warned', 'seenAt']) if (Number.isFinite(Number(raw[k]))) out[k] = Number(raw[k]);
  out.outpatientDay = typeof raw.outpatientDay === 'string' ? raw.outpatientDay : '';
  // 달콤 간식 하루 횟수(보석 상점, tamagotchi-wardrobe.js)
  if (typeof raw.snackDay === 'string' && raw.snackDay) { out.snackDay = raw.snackDay; out.snackCount = Math.max(0, Math.floor(Number(raw.snackCount) || 0)); }
  out.gems = clamp(Math.floor(out.gems), 0, GEM_POOL_MAX);
  if (!(out.at > 0) || out.at > now) out.at = now;
  return out;
}

// ---------- 상태 단계(설계 2-2, 8절) ----------
function conditionOf(s, now) {
  if (s.hospitalUntil > now) return 'hospital';
  if (s.health <= 0) return 'down';
  if (s.health < 30) return 'sick';
  if (s.health < 60) return 'low';
  return 'ok';
}
const ALLOWED = { sick: ['pet', 'feed', 'nap', 'talk'], down: ['pet'], hospital: ['pet', 'talk', 'cheer'] };

function discharge(s, at) {
  Object.assign(s, { health: 100, fatigue: 30, mood: 50, full: 50, clean: 50, hospitalUntil: 0, sleepAt: 0, softUntil: at + DAY, warned: 0 });
}

// ---------- 시간 변화: 마지막 계산 시각부터 now까지 1시간(마지막은 남은 분) 단위로 진행 ----------
// 낮잠: 배우지 않아도 피로가 AUTO_SLEEP_AT에 닿으면 스스로 잠든다. 배우면 원할 때 재울 수 있고 회복이 조금 빠르다.
const AUTO_SLEEP_AT = 75;
const NAP_RECOVER = { learned: 5, self: 4 }; // 잠든 동안 분당 피로 감소
// 누군가 돌봄 화면을 보고 있으면(마지막 확인 뒤 WATCH_GRACE_MS 안) 스스로 잠들지 않는다. 보는 사람은 기록하지 않고 시각만 남긴다.
const WATCH_GRACE_MS = 2 * MIN;
const SEEN_WRITE_MS = 30 * 1000; // 상태 조회로 '보는 중' 시각을 남기는 최소 간격
function advance(raw, now, { napLearned = false } = {}) {
  const s = normalizeStats(raw, now);
  let t = s.at;
  let steps = 0;
  while (t < now && steps < MAX_CATCHUP_HOURS + 2) {
    steps += 1;
    if (s.hospitalUntil > t) { // 입원 중: 시간 변화 정지, 시각이 되면 퇴원
      if (s.hospitalUntil > now) { t = now; break; }
      t = s.hospitalUntil; discharge(s, t); continue;
    }
    let dt = Math.min(HOUR, now - t);
    const soft = s.softUntil > t ? 0.5 : 1; // 퇴원 후 24시간 감소 절반
    const asleep = s.sleepAt > 0;
    let dozeOff = false;
    if (!asleep) { // 깨어 있다 기준치에 닿는 시각에서 구간을 끊고 잠든다
      const tired = s.fatigue >= AUTO_SLEEP_AT ? 0 : ((AUTO_SLEEP_AT - s.fatigue) / (3 * soft)) * HOUR;
      const toSleep = Math.max(tired, s.seenAt + WATCH_GRACE_MS - t); // 보는 동안은 미룬다
      if (toSleep < dt) { dt = Math.max(0, Math.ceil(toSleep)); dozeOff = true; }
    }
    const h = dt / HOUR;
    s.full = clamp(s.full - 4 * h * soft * (asleep ? 0.5 : 1));
    s.mood = clamp(s.mood - 2 * h * soft);
    s.clean = clamp(s.clean - 1.5 * h * soft);
    if (asleep) {
      s.fatigue = clamp(s.fatigue - (napLearned ? NAP_RECOVER.learned : NAP_RECOVER.self) * (dt / MIN));
      if (s.fatigue <= 0) s.sleepAt = 0; // 피로 0이면 자동 기상
    } else s.fatigue = clamp(s.fatigue + 3 * h * soft);
    // 건강(설계 2-1): 원인 합산, 아무 원인이 없고 잘 돌봐졌으면 80까지 자연 회복
    let dh = 0;
    if (s.full <= 20) dh -= 2;
    if (s.fatigue >= 80) dh -= 2;
    if (s.clean <= 30) dh -= 1;
    if (s.mood <= 20) dh -= 1;
    if (dh === 0 && s.full >= 50 && s.fatigue <= 50 && s.clean >= 50 && s.health < 80) s.health = Math.min(80, s.health + h);
    else s.health = clamp(s.health + dh * h);
    t += dt;
    if (dozeOff && s.fatigue >= AUTO_SLEEP_AT - 0.01) s.sleepAt = t;
    if (s.health <= 0) { s.health = 0; s.hospitalUntil = t + DAY; s.sleepAt = 0; } // 쓰러짐 → 자동 입원 24시간
  }
  if (t < now) t = now; // 계산량 제한에 걸린 경우
  s.at = now;
  for (const k of STAT_KEYS) s[k] = round1(s[k]);
  return s;
}

// ---------- 상호작용 효과(설계 3절) ----------
// gain: 스탯별 변화. perMin/perDay: 쿨다운(넘으면 효과 없음). halfTired: 피로 80↑ 효과 절반. lowCut: 컨디션 저하 시 70%.
const EFFECTS = {
  pet: { gain: { mood: 3 }, bond: 1, perMin: 5 },
  feed: { gain: { full: 8, mood: 1 }, refuse: (s) => s.full >= 95 },
  groom: { gain: { clean: 4, mood: 1 }, refuse: (s) => s.clean >= 100 },
  gem: { gain: { mood: 2 }, bond: 3, perDay: 5 },
  play: { gain: { mood: 5, fatigue: 3, full: -1 }, halfTired: true, lowCut: true },
  bath: { gain: { clean: 6, fatigue: -1 }, refuse: (s) => s.clean >= 90 },
  nap: { gain: {} },
  walk: { gain: {}, lowCut: true },
  talk: { gain: { mood: 1 }, bond: 1, perMin: 6 },
  sing: { gain: { mood: 3 }, bond: 1, perMin: 4 },
  dance: { gain: { mood: 4, fatigue: 2 }, halfTired: true, lowCut: true },
  cheer: { gain: { mood: 2 }, bond: 2, perDay: 10 },
};
const KINDS = Object.keys(EFFECTS);
const POSITIVE = (stat, v) => (stat === 'fatigue' ? v < 0 : v > 0); // 팬 상한은 좋은 방향 기여만 센다

function bondLevel(bond) { // 레벨 L에 필요한 누적: 25·L·(L-1) → 50, 150, 300, …
  let level = 1;
  while (level < 10 && bond >= 25 * (level + 1) * level) level += 1;
  return level;
}

function normalizeFan(raw, today) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const sameDay = f.day === today;
  return {
    bond: Math.max(0, Number(f.bond) || 0),
    day: today,
    contrib: sameDay && f.contrib && typeof f.contrib === 'object' ? { ...f.contrib } : {},
    daily: sameDay && f.daily && typeof f.daily === 'object' ? { ...f.daily } : {},
    gemsToday: sameDay ? Number(f.gemsToday) || 0 : 0,
    gemAt: Number(f.gemAt) || 0, // 마지막 보석 시각(다음 보석까지 GEM_GAP_MS 대기)
    variety: sameDay ? Boolean(f.variety) : false,
    win: f.win && typeof f.win === 'object' ? { ...f.win } : {}, // kind → { m: 분 시작, mc, r: 10초 시작, rc }
    lastAt: Number(f.lastAt) || 0,
  };
}

function softCapFactor(contributed, owner) { // 팬 약한 상한(설계 4절)
  const k = owner ? 1.5 : 1;
  if (contributed >= 80 * k) return 0.25;
  if (contributed >= 40 * k) return 0.5;
  return 1;
}

// 상호작용 1회 적용. rng는 테스트에서 고정할 수 있다. 결과: { applied, reason?, gem? }
function applyOne(s, fan, kind, { now, owner = false, meters = 0, rng = Math.random }) {
  const eff = EFFECTS[kind];
  if (!eff) return { applied: false, reason: 'unknown' };
  const cond = conditionOf(s, now);
  if (ALLOWED[cond] && !ALLOWED[cond].includes(kind)) return { applied: false, reason: 'condition' };
  if (kind !== 'nap' && s.sleepAt > 0) s.sleepAt = 0; // 다른 상호작용을 하면 깨어난다
  // 쿨다운
  const w = fan.win[kind] || { m: 0, mc: 0, r: 0, rc: 0 };
  if (now - w.m >= MIN) { w.m = now; w.mc = 0; }
  if (now - w.r >= 10 * 1000) { w.r = now; w.rc = 0; }
  if (eff.perMin && w.mc >= eff.perMin) { fan.win[kind] = w; return { applied: false, reason: 'cooldown' }; }
  if (eff.perDay && (fan.daily[kind] || 0) >= eff.perDay) return { applied: false, reason: 'daily' };
  if (eff.refuse && eff.refuse(s)) return { applied: false, reason: 'full' };
  w.mc += 1; w.rc += 1; fan.win[kind] = w;
  fan.daily[kind] = (fan.daily[kind] || 0) + 1;

  // 입원 중 병문안: 유대감만
  if (cond === 'hospital') {
    fan.bond += eff.bond || 1;
    return { applied: true, visit: true };
  }
  if (kind === 'nap') { if (!s.sleepAt) s.sleepAt = now; return { applied: true }; }

  let mult = [1, 0.7, 0.4][Math.min(2, w.rc - 1)]; // 10초 안 연타 감소
  if (eff.halfTired && s.fatigue >= 80) mult *= 0.5;
  if (eff.lowCut && cond === 'low') mult *= 0.7;
  const gain = { ...eff.gain };
  if (kind === 'walk') { // 1회 300m까지, 10m당 기분 +1·피로 +1, 30m당 청결 -1
    const m = clamp(Number(meters) || 0, 0, 300);
    gain.mood = m / 10; gain.fatigue = m / 10; gain.clean = -m / 30;
  }
  for (const [stat, v] of Object.entries(gain)) {
    let delta = v * mult;
    if (POSITIVE(stat, v)) {
      const before = fan.contrib[stat] || 0;
      delta *= softCapFactor(before, owner);
      fan.contrib[stat] = round1(before + Math.abs(delta));
    }
    s[stat] = round1(clamp(s[stat] + delta));
  }
  if (eff.bond) fan.bond += eff.bond;

  // 골고루 보너스: 하루 서로 다른 상호작용 4종 이상
  if (!fan.variety && Object.keys(fan.daily).length >= 4) { fan.variety = true; fan.bond += 5; }

  // 하트 보석(설계 5·9절): 건강 30 이상일 때 확률, 팬당 하루 3개(레벨 7↑ 4개), 금고 60개
  let gem = false;
  const level = bondLevel(fan.bond);
  const dailyCap = level >= 7 ? 4 : 3;
  if (s.health >= 30 && fan.gemsToday < dailyCap && now - fan.gemAt >= GEM_GAP_MS && rng() < 0.03 + 0.002 * (level - 1)) {
    fan.gemsToday += 1; fan.gemAt = now; fan.bond += 2; gem = true;
    if (s.gems < GEM_POOL_MAX) s.gems += 1;
  }
  return { applied: true, gem };
}

// ---------- 누르고 있는 동안의 천천히 변화(3-C 설계 8-1) ----------
// 움직이지 않는 톡 도구만. 초당 1회 효과의 25%(4초 = 1회). 연타 감소 없음, 1분 횟수·보석 확률은 4초를 1회로 센다.
const HOLDABLE = ['feed', 'play', 'talk', 'sing', 'dance'];
// 하트 보석: 한 번 나오면 그 팬은 10분 동안 다음 보석이 나오지 않는다(확률 3%는 그대로)
const GEM_GAP_MS = 10 * MIN;
// 톡 도구 연타 방지: 화면은 한 번 누르면 1초 쉬고, 서버는 지난 전송 이후 흐른 시간(+1초 여유)만큼만 톡을 인정한다.
const TAP_KINDS = ['feed', 'gem', 'play', 'talk', 'sing', 'dance', 'cheer'];
const TAP_GAP_MS = 1000;
const HOLD_UNIT_MS = 4000;
const HOLD_MAX_MS = 20000;
function applyHold(s, fan, kind, holdMs, { now, owner = false, rng = Math.random }) {
  const eff = EFFECTS[kind];
  if (!eff || !HOLDABLE.includes(kind) || !(holdMs > 0)) return { applied: false, reason: 'unknown' };
  const cond = conditionOf(s, now);
  if (ALLOWED[cond] && !ALLOWED[cond].includes(kind)) return { applied: false, reason: 'condition' };
  if (s.sleepAt > 0) s.sleepAt = 0;
  const w = fan.win[kind] || { m: 0, mc: 0, r: 0, rc: 0 };
  if (now - w.m >= MIN) { w.m = now; w.mc = 0; }
  let units = Math.min(holdMs, HOLD_MAX_MS) / HOLD_UNIT_MS;
  if (eff.perMin) units = Math.min(units, Math.max(0, eff.perMin - w.mc));
  if (units <= 0) { fan.win[kind] = w; return { applied: false, reason: 'cooldown' }; }
  if (eff.refuse && eff.refuse(s)) return { applied: false, reason: 'full' };
  w.mc += units; fan.win[kind] = w;
  fan.daily[kind] = (fan.daily[kind] || 0) + units;
  if (cond === 'hospital') { fan.bond += (eff.bond || 1) * units; return { applied: true, visit: true }; }
  let mult = units;
  if (eff.halfTired && s.fatigue >= 80) mult *= 0.5;
  if (eff.lowCut && cond === 'low') mult *= 0.7;
  for (const [stat, v] of Object.entries(eff.gain)) {
    let delta = v * mult;
    if (POSITIVE(stat, v)) {
      const before = fan.contrib[stat] || 0;
      delta *= softCapFactor(before, owner);
      fan.contrib[stat] = round1(before + Math.abs(delta));
    }
    s[stat] = round1(clamp(s[stat] + delta));
  }
  if (eff.bond) fan.bond += eff.bond * units;
  if (!fan.variety && Object.keys(fan.daily).length >= 4) { fan.variety = true; fan.bond += 5; }
  let gem = false;
  const level = bondLevel(fan.bond);
  const dailyCap = level >= 7 ? 4 : 3;
  if (s.health >= 30 && fan.gemsToday < dailyCap && now - fan.gemAt >= GEM_GAP_MS && rng() < (0.03 + 0.002 * (level - 1)) * units) {
    fan.gemsToday += 1; fan.gemAt = now; fan.bond += 2; gem = true;
    if (s.gems < GEM_POOL_MAX) s.gems += 1;
  }
  return { applied: true, gem };
}

// 경고 단계: 건강이 30·10 아래로 처음 내려갈 때 한 번씩
function warnLevel(s) { return s.health < 10 ? 2 : s.health < 30 ? 1 : 0; }

// ---------- 치료(설계 8·9절) ----------
function treatmentQuote(s, now) {
  const cond = conditionOf(s, now);
  if (cond === 'hospital') {
    const cost = Math.min(6, Math.max(1, Math.ceil((s.hospitalUntil - now) / (4 * HOUR))));
    return { kind: 'discharge', cost, available: s.gems >= cost };
  }
  if (s.health > 0 && s.health < 30) {
    const usedToday = s.outpatientDay === dayKey(now);
    return { kind: 'outpatient', cost: 3, available: !usedToday && s.gems >= 3, usedToday };
  }
  return null;
}

function applyTreatment(s, kind, now) {
  const quote = treatmentQuote(s, now);
  if (!quote || quote.kind !== kind) throw new TamagotchiCareError('failed-precondition', '지금은 이 치료를 할 수 없어요.');
  if (quote.usedToday) throw new TamagotchiCareError('failed-precondition', '외래 진료는 펫마다 하루 한 번이에요.');
  if (s.gems < quote.cost) throw new TamagotchiCareError('failed-precondition', `하트 보석이 부족해요. (필요 ${quote.cost}개)`);
  s.gems -= quote.cost;
  if (kind === 'outpatient') { s.health = 80; s.outpatientDay = dayKey(now); s.warned = 0; } else discharge(s, now);
  return quote.cost;
}

// ---------- 공개 응답: 숫자 대신 단계(막대·표정)만. 스크린리더용 값은 정수로 ----------
function band(stat, v) {
  const good = stat === 'fatigue' ? 100 - v : v;
  return good >= 60 ? 'good' : good >= 30 ? 'mid' : 'bad';
}
function publicStats(s, now) {
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = { value: Math.round(s[k]), band: band(k, s[k]) };
  return {
    condition: conditionOf(s, now), stats, sleeping: s.sleepAt > 0, gems: s.gems, gemMax: GEM_POOL_MAX,
    hospitalUntil: s.hospitalUntil > now ? s.hospitalUntil : 0, treatment: treatmentQuote(s, now),
  };
}

// ---------- DB 연결 ----------
const STREAMER_ID_RE = /^[a-z0-9_-]{1,64}$/;
const PET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function validateTarget(streamerId, petId) {
  const sid = typeof streamerId === 'string' ? streamerId.trim().toLowerCase() : '';
  const pid = typeof petId === 'string' ? petId.trim() : '';
  if (!STREAMER_ID_RE.test(sid) || !PET_ID_RE.test(pid)) throw new TamagotchiCareError('invalid-argument', '펫을 확인해 주세요.');
  return { sid, pid };
}
// 묶음: [{ kind, n, meters?, holdMs? }] 최대 12종, 종류당 n 0~10(누르기만 있으면 0), 산책은 1회
function validateBatch(batch) {
  if (!Array.isArray(batch) || !batch.length || batch.length > 12) throw new TamagotchiCareError('invalid-argument', '상호작용 묶음을 확인해 주세요.');
  return batch.map((item) => {
    const kind = String(item && item.kind || '');
    if (!EFFECTS[kind]) throw new TamagotchiCareError('invalid-argument', '상호작용 종류를 확인해 주세요.');
    const holdMs = HOLDABLE.includes(kind) ? clamp(Math.floor(Number(item.holdMs) || 0), 0, HOLD_MAX_MS) : 0;
    const n = kind === 'walk' || kind === 'nap' ? 1 : Math.floor(Number(item.n) || 0);
    if (!(n >= 0 && n <= 10) || (n === 0 && holdMs === 0)) throw new TamagotchiCareError('invalid-argument', '상호작용 횟수를 확인해 주세요.');
    return { kind, n, holdMs, meters: kind === 'walk' ? clamp(Number(item.meters) || 0, 0, 300) : 0 };
  });
}

async function loadActivePet(db, sid, pid) {
  const pet = (await db.ref(`${PETS_ROOT}/${sid}/${pid}`).get()).val();
  if (!pet || pet.status !== 'active') throw new TamagotchiCareError('not-found', '펫을 찾을 수 없어요.');
  return pet;
}

// 배운 상호작용(훈련소). 미리보기에서도 이 파일만 불러 쓰므로 카탈로그를 require하지 않고 기본 4종을 여기 둔다.
const BASE_INTERACTIONS = Object.freeze(['pet', 'feed', 'groom', 'gem']);
// learned[id].learnedAt이 미래면 훈련 중(재주당 5분), 지나면 배운 것. 예약 작업 없이 시간이 지나면 풀린다.
function learnedEntries(pet) { return pet && pet.learned && typeof pet.learned === 'object' ? pet.learned : {}; }
function napOpts(pet, now = Date.now()) { return { napLearned: learnedSet(pet, now).has('nap') }; }
function learnedSet(pet, now = Date.now()) {
  const entries = learnedEntries(pet); const keys = Object.keys(entries);
  if (!keys.length) return new Set(BASE_INTERACTIONS);
  return new Set(keys.filter((id) => !(Number(entries[id] && entries[id].learnedAt) > now)));
}
function trainingMap(pet, now = Date.now()) {
  const out = {}; const entries = learnedEntries(pet);
  for (const [id, v] of Object.entries(entries)) {
    const endAt = Number(v && v.learnedAt) || 0;
    if (endAt > now) out[id] = { startAt: Number(v.trainStartAt) || 0, endAt };
  }
  return out;
}

// 내 오늘 횟수 중 하루 제한이 있는 것만(화면이 서버와 같은 속도로 막도록)
function fanSummary(fan, now) {
  const daily = {};
  for (const [kind, eff] of Object.entries(EFFECTS)) if (eff.perDay) daily[kind] = fan.daily[kind] || 0;
  return { bondLevel: bondLevel(fan.bond), gemsToday: fan.gemsToday, daily, day: dayKey(now) };
}

async function readStatus({ db, uid, streamerId, petId, now = Date.now() }) {
  const { sid, pid } = validateTarget(streamerId, petId);
  const pet = await loadActivePet(db, sid, pid);
  let s = advance(pet.stats, now, napOpts(pet, now));
  if (now - s.seenAt >= SEEN_WRITE_MS) { // 보는 중 표시: 지금까지의 변화를 저장하고 시각을 남긴다(30초에 한 번)
    const tx = await db.ref(`${PETS_ROOT}/${sid}/${pid}/stats`).transaction((raw) => {
      if (raw === null) return null;
      const next = advance(raw, now, napOpts(pet, now)); next.seenAt = now; return next;
    });
    if (tx.committed && tx.snapshot.val()) s = normalizeStats(tx.snapshot.val(), now);
  }
  const out = publicStats(s, now);
  out.learned = [...learnedSet(pet, now)]; out.training = trainingMap(pet, now); out.serverNow = now;
  if (uid) {
    const fan = normalizeFan((await db.ref(`${FANS_ROOT}/${sid}/${pid}/${fanKey(uid, sid)}`).get()).val(), dayKey(now));
    out.me = fanSummary(fan, now);
  }
  return out;
}

async function interact({ db, uid, streamerId, petId, batch, owner = false, now = Date.now(), rng = Math.random }) {
  const { sid, pid } = validateTarget(streamerId, petId);
  const items = validateBatch(batch);
  const petInfo = await loadActivePet(db, sid, pid);
  const learned = learnedSet(petInfo, now);
  const fanRef = db.ref(`${FANS_ROOT}/${sid}/${pid}/${fanKey(uid, sid)}`);
  const fanBefore = normalizeFan((await fanRef.get()).val(), dayKey(now));
  if (now - fanBefore.lastAt < 1500) throw new TamagotchiCareError('resource-exhausted', '조금 천천히 보내 주세요.');
  // 누른 시간 합계는 지난 전송 이후 흐른 시간(+1초 여유)을 넘을 수 없다
  const holdBudget = Math.min(HOLD_MAX_MS, fanBefore.lastAt ? now - fanBefore.lastAt + 1000 : HOLD_MAX_MS);
  let holdLeft = holdBudget;
  for (const item of items) { const use = Math.min(item.holdMs, holdLeft); item.holdMs = use; holdLeft -= use; }
  let tapLeft = fanBefore.lastAt ? Math.min(10, Math.floor((now - fanBefore.lastAt + 1000) / TAP_GAP_MS)) : 10;
  const tooFast = {};
  for (const item of items) {
    if (!TAP_KINDS.includes(item.kind)) continue;
    const use = Math.min(item.n, tapLeft); if (use < item.n) tooFast[item.kind] = true;
    item.n = use; tapLeft -= use;
  }
  let fan = null; let results = null; let warning = 0;
  const statsRef = db.ref(`${PETS_ROOT}/${sid}/${pid}/stats`);
  const tx = await statsRef.transaction((raw) => {
    const s = advance(raw, now, { napLearned: learned.has('nap') }); s.seenAt = now;
    fan = normalizeFan(JSON.parse(JSON.stringify(fanBefore)), dayKey(now));
    results = { applied: 0, gems: 0, blocked: {} };
    for (const kind of Object.keys(tooFast)) results.blocked[kind] = 'too-fast';
    for (const item of items) {
      if (!learned.has(item.kind)) { results.blocked[item.kind] = 'not-learned'; continue; } // 훈련소에서 배우지 않은 재주
      for (let i = 0; i < item.n; i += 1) {
        const r = applyOne(s, fan, item.kind, { now, owner, meters: item.meters, rng });
        if (r.applied) results.applied += 1; else results.blocked[item.kind] = r.reason;
        if (r.gem) results.gems += 1;
      }
      if (item.holdMs > 0) {
        const r = applyHold(s, fan, item.kind, item.holdMs, { now, owner, rng });
        if (r.applied) results.applied += 1; else results.blocked[item.kind] = r.reason;
        if (r.gem) results.gems += 1;
      }
    }
    const level = warnLevel(s);
    warning = level > (s.warned || 0) ? level : 0;
    s.warned = level === 0 ? 0 : Math.max(s.warned || 0, level);
    return s;
  });
  if (!tx.committed) throw new TamagotchiCareError('aborted', '잠시 후 다시 시도해 주세요.');
  fan.lastAt = now;
  await fanRef.set(fan);
  const s = tx.snapshot.val();
  const out = { ...publicStats(s, now), learned: [...learned], training: trainingMap(petInfo, now), serverNow: now, result: results, warning, me: fanSummary(fan, now) };
  // 오버레이 갱신용(응답에는 싣지 않음): 이름·색만, 스탯은 방금 계산한 값
  Object.defineProperty(out, 'pet', { value: { ...petInfo, stats: s }, enumerable: false });
  return out;
}

async function treat({ db, uid, streamerId, petId, kind, now = Date.now() }) {
  const { sid, pid } = validateTarget(streamerId, petId);
  if (kind !== 'outpatient' && kind !== 'discharge') throw new TamagotchiCareError('invalid-argument', '치료 종류를 확인해 주세요.');
  const petInfo = await loadActivePet(db, sid, pid);
  let cost = 0; let failure = null;
  const tx = await db.ref(`${PETS_ROOT}/${sid}/${pid}/stats`).transaction((raw) => {
    failure = null;
    if (raw === null) return null; // 캐시가 비어 있는 첫 시도: 서버 값으로 다시 호출된다(실제로 없으면 아래에서 거절)
    const s = advance(raw, now, napOpts(petInfo, now)); s.seenAt = now;
    try { cost = applyTreatment(s, kind, now); } catch (error) { failure = error; return; }
    return s;
  });
  if (failure) throw failure;
  if (!tx.committed) throw new TamagotchiCareError('aborted', '잠시 후 다시 시도해 주세요.');
  if (!tx.snapshot.val()) throw new TamagotchiCareError('failed-precondition', '지금은 이 치료를 할 수 없어요.');
  // 사용 내역은 공개(누가 썼는지는 남기지 않음). 최근 30건만 유지.
  const logRef = db.ref(`${PETS_ROOT}/${sid}/${pid}/gemLog`);
  await logRef.push({ kind, gems: cost, at: now });
  const log = (await logRef.orderByKey().get()).val() || {};
  const keys = Object.keys(log);
  if (keys.length > LOG_MAX) await Promise.all(keys.slice(0, keys.length - LOG_MAX).map((k) => logRef.child(k).remove()));
  // 누른 팬 유대감 +5
  const fanRef = db.ref(`${FANS_ROOT}/${sid}/${pid}/${fanKey(uid, sid)}`);
  await fanRef.transaction((raw) => { const f = normalizeFan(raw, dayKey(now)); f.bond += 5; return f; });
  return { ...publicStats(tx.snapshot.val(), now), learned: [...learnedSet(petInfo, now)], training: trainingMap(petInfo, now), serverNow: now, spent: cost };
}

// 관리자가 아니면 스탯 숫자를 지우고 단계(band)만 남긴다(3-C 결정: 숫자는 관리자만)
function hideValues(out) {
  if (out && out.stats) for (const k of Object.keys(out.stats)) delete out.stats[k].value;
  return out;
}

// 펫 정리 시 팬 기록도 함께 지운다(관리자 테스트 펫 정리 등).
async function removeFanRecords(db, streamerId, petId) {
  const { sid, pid } = validateTarget(streamerId, petId);
  await db.ref(`${FANS_ROOT}/${sid}/${pid}`).remove();
}

module.exports = {
  BASE_INTERACTIONS, learnedSet, napOpts, AUTO_SLEEP_AT, NAP_RECOVER, WATCH_GRACE_MS, SEEN_WRITE_MS, GEM_GAP_MS, trainingMap, TAP_GAP_MS, TAP_KINDS,
  TamagotchiCareError, PETS_ROOT, FANS_ROOT, EFFECTS, KINDS, ALLOWED, GEM_POOL_MAX,
  HOLDABLE, HOLD_UNIT_MS, HOLD_MAX_MS, hideValues, applyHold,
  freshStats, advance, conditionOf, applyOne, normalizeFan, bondLevel, softCapFactor, warnLevel,
  treatmentQuote, applyTreatment, publicStats, validateBatch, dayKey, fanKey,
  readStatus, interact, treat, removeFanRecords, validateTarget, loadActivePet,
};
