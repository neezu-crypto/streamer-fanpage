'use strict';
// 다마고치 방송 오버레이(설계: docs/다마고치_방송_오버레이_설계.md)
// - 스트리머가 발급한 비밀 토큰(원문은 URL # 뒤에만)으로 펫 상태를 읽기 전용으로 본다.
// - 서버는 토큰의 SHA-256만 저장한다. 공개 요약은 LIVE_ROOT/{tokenHash}에 쓰고, 규칙에서 그 단일 경로만 읽기를 연다.
// - 누가 돌봤는지는 저장하지 않는다(종류별 횟수만, 1분 단위·10분 보관).
const { createHash, randomBytes } = require('node:crypto');
const care = require('./tamagotchi-care');

const OVERLAY_ROOT = 'streamerFanPageTamagotchiOverlay'; // {sid}/{pid}: { tokenHash, createdAt } (서버 전용)
const INDEX_ROOT = 'streamerFanPageTamagotchiOverlayIndex'; // {tokenHash}: { sid, pid } (서버 전용)
const LIVE_ROOT = 'streamerFanPageTamagotchiOverlayLive'; // {tokenHash}: 공개 요약(규칙: 단일 경로 읽기만)
const RECENT_KEEP_MIN = 10;
const STATE_MIN_GAP_MS = 5000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

class TamagotchiOverlayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const hashToken = (token) => createHash('sha256').update(`tg-overlay:${token}`).digest('hex');
const minuteKey = (at) => String(Math.floor(at / 60000));

function summary(pet, stats, now) {
  const pub = care.publicStats(stats, now);
  const bands = {};
  for (const [k, v] of Object.entries(pub.stats)) bands[k] = v.band;
  return {
    nickname: String(pet.nickname || '').slice(0, 30), color: String(pet.color || 'cream'), speciesId: String(pet.speciesId || 'mongsil'),
    condition: pub.condition, bands, sleeping: pub.sleeping, hospitalUntil: pub.hospitalUntil, gems: pub.gems, gemMax: pub.gemMax, at: now,
  };
}
function pruneRecent(recent, now) {
  const out = {}; const min = Math.floor(now / 60000) - RECENT_KEEP_MIN;
  for (const [k, v] of Object.entries(recent && typeof recent === 'object' ? recent : {})) if (Number(k) > min && v && typeof v === 'object') out[k] = v;
  return out;
}

async function readPet(db, sid, pid) {
  const pet = (await db.ref(`${care.PETS_ROOT}/${sid}/${pid}`).get()).val();
  if (!pet || pet.status !== 'active') throw new TamagotchiOverlayError('not-found', '펫을 찾을 수 없어요.');
  return pet;
}

// 발급(재발급하면 이전 URL은 즉시 무효). 토큰 원문은 응답으로 한 번만 돌려준다.
async function issue({ db, streamerId, petId, now = Date.now() }) {
  const pet = await readPet(db, streamerId, petId);
  const ref = db.ref(`${OVERLAY_ROOT}/${streamerId}/${petId}`);
  const prev = (await ref.get()).val();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  if (prev && prev.tokenHash) await Promise.all([db.ref(`${LIVE_ROOT}/${prev.tokenHash}`).remove(), db.ref(`${INDEX_ROOT}/${prev.tokenHash}`).remove()]);
  await ref.set({ tokenHash, createdAt: now });
  await db.ref(`${INDEX_ROOT}/${tokenHash}`).set({ sid: streamerId, pid: petId });
  await db.ref(`${LIVE_ROOT}/${tokenHash}`).set({ ...summary(pet, care.advance(pet.stats, now), now), recent: {} });
  return { token, createdAt: now };
}

async function revoke({ db, streamerId, petId }) {
  const ref = db.ref(`${OVERLAY_ROOT}/${streamerId}/${petId}`);
  const prev = (await ref.get()).val();
  if (prev && prev.tokenHash) await Promise.all([db.ref(`${LIVE_ROOT}/${prev.tokenHash}`).remove(), db.ref(`${INDEX_ROOT}/${prev.tokenHash}`).remove()]);
  await ref.remove();
  return { ok: true };
}

async function info({ db, streamerId, petId }) {
  const cur = (await db.ref(`${OVERLAY_ROOT}/${streamerId}/${petId}`).get()).val();
  return { active: !!(cur && cur.tokenHash), createdAt: cur ? Number(cur.createdAt) || 0 : 0 };
}

// 상호작용·치료 뒤 공개 요약 갱신(오버레이가 없으면 아무것도 하지 않음). counts: { kind: n }
async function publish({ db, streamerId, petId, stats, counts = null, pet: knownPet = null, now = Date.now() }) {
  const cur = (await db.ref(`${OVERLAY_ROOT}/${streamerId}/${petId}`).get()).val();
  if (!cur || !cur.tokenHash) return false;
  const pet = knownPet || await readPet(db, streamerId, petId); // 돌봄 처리에서 이미 읽은 펫 정보가 있으면 다시 읽지 않는다
  const liveRef = db.ref(`${LIVE_ROOT}/${cur.tokenHash}`);
  const base = summary(pet, care.advance(stats || pet.stats, now), now);
  await liveRef.transaction((raw) => {
    const recent = pruneRecent(raw && raw.recent, now);
    if (counts) {
      const key = minuteKey(now); const bucket = { ...(recent[key] || {}) };
      for (const [kind, n] of Object.entries(counts)) if ((care.EFFECTS[kind] || kind === 'outpatient' || kind === 'discharge') && n > 0) bucket[kind] = (bucket[kind] || 0) + Math.min(50, Math.round(n));
      recent[key] = bucket;
    }
    return { ...base, recent };
  });
  return true;
}

// 오버레이가 시간 경과를 반영하려고 가끔 부른다(로그인 없음). 같은 토큰은 5초에 1회.
async function state({ db, token, now = Date.now() }) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new TamagotchiOverlayError('invalid-argument', '오버레이 주소를 확인해 주세요.');
  const tokenHash = hashToken(token);
  const live = (await db.ref(`${LIVE_ROOT}/${tokenHash}`).get()).val();
  if (!live) throw new TamagotchiOverlayError('not-found', '오버레이 주소가 바뀌었거나 꺼져 있어요.');
  if (now - (Number(live.at) || 0) < STATE_MIN_GAP_MS) return { tokenHash, ...live };
  const at = (await db.ref(`${INDEX_ROOT}/${tokenHash}`).get()).val();
  if (at && at.sid && at.pid) {
    await publish({ db, streamerId: at.sid, petId: at.pid, now });
    return { tokenHash, ...((await db.ref(`${LIVE_ROOT}/${tokenHash}`).get()).val() || live) };
  }
  throw new TamagotchiOverlayError('not-found', '오버레이 주소가 바뀌었거나 꺼져 있어요.');
}

// 펫 정리 시 오버레이도 정리
async function removeForPet(db, streamerId, petId) { await revoke({ db, streamerId, petId }); }

module.exports = { OVERLAY_ROOT, INDEX_ROOT, LIVE_ROOT, TamagotchiOverlayError, hashToken, summary, pruneRecent, issue, revoke, info, publish, state, removeForPet };
