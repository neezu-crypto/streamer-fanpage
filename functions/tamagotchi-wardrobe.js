'use strict';
// 다마고치 보석 상점·꾸미기(설계: docs/다마고치_보석상점_꾸미기_설계.md)
// - 펫 공동 금고(stats.gems)로 꾸미기(펫마다 영구)·달콤 간식(소모품)을 산다.
// - 보석 차감과 보유 추가는 펫 기록 하나의 트랜잭션에서 같이 처리한다. 누가 샀는지는 저장하지 않는다.
const care = require('./tamagotchi-care');

const ITEMS = Object.freeze({
  ribbon: Object.freeze({ id: 'ribbon', name: '리본', slot: 'head', price: 3 }),
  hat: Object.freeze({ id: 'hat', name: '작은 모자', slot: 'head', price: 5 }),
  necklace: Object.freeze({ id: 'necklace', name: '별 목걸이', slot: 'neck', price: 5 }),
  glasses: Object.freeze({ id: 'glasses', name: '동그란 안경', slot: 'face', price: 8 }),
  cape: Object.freeze({ id: 'cape', name: '망토', slot: 'back', price: 10 }),
});
const SLOTS = Object.freeze(['head', 'face', 'neck', 'back']);
const SNACK = Object.freeze({ price: 2, perDay: 3, full: 50, mood: 10, bond: 3 });
const ITEM_RE = /^[a-z]{1,20}$/;

const Err = care.TamagotchiCareError;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function normalizeWardrobe(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const owned = {}; const equipped = {};
  for (const [id, at] of Object.entries(w.owned && typeof w.owned === 'object' ? w.owned : {})) if (has(ITEMS, id)) owned[id] = Number(at) || 1;
  for (const [slot, id] of Object.entries(w.equipped && typeof w.equipped === 'object' ? w.equipped : {})) {
    if (SLOTS.includes(slot) && has(ITEMS, id) && owned[id] && ITEMS[id].slot === slot) equipped[slot] = id;
  }
  return { owned, equipped };
}
// 공개용: 착용 중인 것만
function equippedOf(pet) { return normalizeWardrobe(pet && pet.wardrobe).equipped; }

function snackLeft(stats, now) {
  const s = stats || {};
  return s.snackDay === care.dayKey(now) ? Math.max(0, SNACK.perDay - (Number(s.snackCount) || 0)) : SNACK.perDay;
}

// status 응답에 붙일 상점 정보. 보유 목록은 manage(주인·관리자)에게만.
function shopView(pet, stats, now, { manage = false } = {}) {
  const w = normalizeWardrobe(pet && pet.wardrobe);
  const items = Object.values(ITEMS).map((it) => ({
    id: it.id, name: it.name, slot: it.slot, price: it.price,
    equipped: w.equipped[it.slot] === it.id, ...(manage ? { owned: !!w.owned[it.id] } : {}),
  }));
  return { items, equipped: w.equipped, manage, snack: { price: SNACK.price, perDay: SNACK.perDay, leftToday: snackLeft(stats, now) } };
}

function validateItem(itemId) {
  const id = typeof itemId === 'string' ? itemId : '';
  if (!ITEM_RE.test(id) || !has(ITEMS, id)) throw new Err('invalid-argument', '아이템을 확인해 주세요.');
  return ITEMS[id];
}

// 펫 기록 트랜잭션. mutate(pet, stats)는 실패 시 Err를 던진다.
async function petTransaction(db, sid, pid, now, mutate) {
  let failure = null; let petInfo = null;
  const tx = await db.ref(`${care.PETS_ROOT}/${sid}/${pid}`).transaction((raw) => {
    failure = null;
    if (raw === null) return null;
    if (!raw || raw.status !== 'active') { failure = new Err('not-found', '펫을 찾을 수 없어요.'); return; }
    const pet = { ...raw };
    const s = care.advance(raw.stats, now, care.napOpts(raw, now)); s.seenAt = now;
    try { mutate(pet, s); } catch (error) { failure = error; return; }
    pet.stats = s; petInfo = pet;
    return pet;
  });
  if (failure) throw failure;
  if (!tx.committed) throw new Err('aborted', '잠시 후 다시 시도해 주세요.');
  if (!tx.snapshot.val()) throw new Err('not-found', '펫을 찾을 수 없어요.');
  return tx.snapshot.val() || petInfo;
}

// 보석 사용 내역(치료와 같은 gemLog, 누가 썼는지 없음). 최근 30건만.
async function logSpend(db, sid, pid, kind, gems, now) {
  const logRef = db.ref(`${care.PETS_ROOT}/${sid}/${pid}/gemLog`);
  await logRef.push({ kind, gems, at: now });
  const keys = Object.keys((await logRef.orderByKey().get()).val() || {});
  if (keys.length > 30) await Promise.all(keys.slice(0, keys.length - 30).map((k) => logRef.child(k).remove()));
}

async function buy({ db, streamerId, petId, itemId, now = Date.now() }) {
  const { sid, pid } = care.validateTarget(streamerId, petId);
  const item = validateItem(itemId);
  const pet = await petTransaction(db, sid, pid, now, (p, s) => {
    const w = normalizeWardrobe(p.wardrobe);
    if (w.owned[item.id]) throw new Err('already-exists', '이미 가지고 있어요.');
    if (s.gems < item.price) throw new Err('failed-precondition', `하트 보석이 부족해요. (필요 ${item.price}개)`);
    s.gems -= item.price;
    w.owned[item.id] = now; w.equipped[item.slot] = item.id; // 사면서 바로 입는다(같은 슬롯 것은 벗겨짐)
    p.wardrobe = w;
  });
  await logSpend(db, sid, pid, `wear:${item.id}`, item.price, now);
  return { pet, spent: item.price };
}

async function equip({ db, streamerId, petId, slot, itemId, now = Date.now() }) {
  const { sid, pid } = care.validateTarget(streamerId, petId);
  if (!SLOTS.includes(slot)) throw new Err('invalid-argument', '착용 위치를 확인해 주세요.');
  const item = itemId ? validateItem(itemId) : null;
  if (item && item.slot !== slot) throw new Err('invalid-argument', '착용 위치를 확인해 주세요.');
  const pet = await petTransaction(db, sid, pid, now, (p) => {
    const w = normalizeWardrobe(p.wardrobe);
    if (item && !w.owned[item.id]) throw new Err('failed-precondition', '먼저 상점에서 사 주세요.');
    if (item) w.equipped[slot] = item.id; else delete w.equipped[slot];
    p.wardrobe = w;
  });
  return { pet };
}

async function snack({ db, uid, streamerId, petId, now = Date.now() }) {
  const { sid, pid } = care.validateTarget(streamerId, petId);
  const pet = await petTransaction(db, sid, pid, now, (p, s) => {
    const cond = care.conditionOf(s, now);
    if (cond === 'hospital' || cond === 'down' || s.sleepAt > 0) throw new Err('failed-precondition', '지금은 간식을 먹을 수 없어요.');
    if (snackLeft(s, now) <= 0) throw new Err('resource-exhausted', `오늘 간식은 다 줬어요. (하루 ${SNACK.perDay}번)`);
    if (s.gems < SNACK.price) throw new Err('failed-precondition', `하트 보석이 부족해요. (필요 ${SNACK.price}개)`);
    s.gems -= SNACK.price;
    s.full = Math.min(100, s.full + SNACK.full); s.mood = Math.min(100, s.mood + SNACK.mood);
    if (s.snackDay !== care.dayKey(now)) { s.snackDay = care.dayKey(now); s.snackCount = 0; }
    s.snackCount = (Number(s.snackCount) || 0) + 1;
  });
  await logSpend(db, sid, pid, 'snack', SNACK.price, now);
  if (uid) {
    const fanRef = db.ref(`${care.FANS_ROOT}/${sid}/${pid}/${care.fanKey(uid, sid)}`);
    await fanRef.transaction((raw) => { const f = care.normalizeFan(raw, care.dayKey(now)); f.bond += SNACK.bond; return f; });
  }
  return { pet, spent: SNACK.price };
}

module.exports = { ITEMS, SLOTS, SNACK, normalizeWardrobe, equippedOf, snackLeft, shopView, buy, equip, snack };
