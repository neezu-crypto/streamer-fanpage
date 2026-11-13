// 다마고치 돌봄 미리보기(?tgpreview=1, 관리자 전용). 운영 DB에 아무것도 쓰지 않는다.
// 서버 엔진 사본(tamagotchi-engine/, 원본은 비공개 functions/tamagotchi-care.js — 서버를 고치면 함께 복사)을 불러와 브라우저 메모리 DB 위에서 돌린다 → 계산 규칙이 서버와 같다.
const ENGINE_URL = 'tamagotchi-engine/tamagotchi-care.js?v=20261114-split1';
const WARDROBE_URL = 'tamagotchi-engine/tamagotchi-wardrobe.js?v=20261114-split1';
const UID = 'preview-admin';
const PET_ID = 'preview-mongsil';
const ALL_SKILLS = ['pet', 'feed', 'groom', 'gem', 'play', 'bath', 'nap', 'walk', 'talk', 'sing', 'dance', 'cheer'];

async function loadEngine(url = ENGINE_URL, deps = {}) {
  const src = await (await fetch(url, { cache: 'no-store' })).text();
  // node:crypto 대역: 미리보기에서는 팬 키가 겹치지만 않으면 되므로 간단한 해시로 충분하다
  const crypto = { createHash: () => ({ t: '', update(x) { this.t += x; return this; }, digest() { let h = 2166136261; for (const c of this.t) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0').repeat(8); } }) };
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(module, module.exports, (name) => { if (name === 'node:crypto' || name === 'crypto') return crypto; if (deps[name]) return deps[name]; throw new Error(`미리보기에서 지원하지 않는 모듈: ${name}`); });
  return module.exports;
}

// 메모리 RTDB(get/set/remove/transaction/push/orderByKey/child)
function memoryDb(initial) {
  let root = JSON.parse(JSON.stringify(initial)); let seq = 0;
  const parts = (p) => p.split('/').filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n == null ? null : n[k] ?? null), root);
  const write = (p, v) => {
    const keys = parts(p); let n = root;
    for (const k of keys.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    if (v == null) delete n[keys[keys.length - 1]]; else n[keys[keys.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const snap = (v) => ({ val: () => (v == null ? null : JSON.parse(JSON.stringify(v))), exists: () => v != null });
  const ref = (p) => ({
    get: async () => snap(read(p)), set: async (v) => write(p, v), remove: async () => write(p, null),
    child: (k) => ref(`${p}/${k}`),
    push: async (v) => { seq += 1; write(`${p}/k${String(seq).padStart(6, '0')}`, v); },
    orderByKey: () => ({ get: async () => snap(read(p)) }),
    transaction: async (fn) => {
      const cur = read(p); const out = fn(cur == null ? null : JSON.parse(JSON.stringify(cur)));
      if (out === undefined) return { committed: false, snapshot: snap(cur) };
      write(p, out); return { committed: true, snapshot: snap(out) };
    },
  });
  return { ref, read, write };
}

export async function createCarePreview(page) {
  const care = await loadEngine();
  const wardrobe = await loadEngine(WARDROBE_URL, { './tamagotchi-care': care });
  const sid = page.streamer.id;
  const db = memoryDb({ [care.PETS_ROOT]: { [sid]: { [PET_ID]: { status: 'active', speciesId: 'mongsil', color: 'cream', nickname: '미리보기 몽실이', adoptedAt: Date.now() } } } });
  const statsPath = `${care.PETS_ROOT}/${sid}/${PET_ID}/stats`;
  const wrap = async (fn) => {
    try { return { data: await fn() }; } catch (error) {
      const e = new Error(error.message || '미리보기 오류'); e.code = `functions/${error.code || 'internal'}`; throw e;
    }
  };
  const callShop = (data) => wrap(async () => {
    if (data.action !== 'pets') throw Object.assign(new Error('미리보기에서는 목록만 지원해요.'), { code: 'invalid-argument' });
    const pet = db.read(`${care.PETS_ROOT}/${sid}/${PET_ID}`);
    return { pets: [{ petId: PET_ID, speciesId: pet.speciesId, color: pet.color, nickname: pet.nickname, wear: wardrobe.equippedOf(pet), adoptedAt: pet.adoptedAt, learned: [...care.learnedSet(pet, Date.now())], training: care.trainingMap(pet, Date.now()), test: true }], serverNow: Date.now() };
  });
  const callCare = (data) => wrap(async () => {
    const base = { db, uid: UID, streamerId: sid, petId: data.petId };
    const withShop = (out) => { const p = db.read(`${care.PETS_ROOT}/${sid}/${PET_ID}`); out.shop = wardrobe.shopView(p, p.stats, Date.now(), { manage: true }); return out; };
    if (data.action === 'status') return withShop(await care.readStatus(base));
    if (data.action === 'buy') { await wardrobe.buy({ ...base, itemId: data.itemId }); return withShop(await care.readStatus(base)); }
    if (data.action === 'equip') { await wardrobe.equip({ ...base, slot: data.slot, itemId: data.itemId }); return withShop(await care.readStatus(base)); }
    if (data.action === 'snack') { await wardrobe.snack(base); return withShop(await care.readStatus(base)); }
    if (data.action === 'interact') return care.interact({ ...base, batch: data.batch, owner: true });
    if (data.action === 'treat') return care.treat({ ...base, kind: data.kind });
    throw Object.assign(new Error('요청 종류를 확인해 주세요.'), { code: 'invalid-argument' });
  });

  // ---------- 관리자 조작판 ----------
  const SCENARIOS = {
    ok: { full: 80, mood: 85, clean: 75, fatigue: 30, health: 95 },
    low: { full: 45, mood: 40, clean: 50, fatigue: 70, health: 50 },
    sick: { full: 15, mood: 20, clean: 25, fatigue: 85, health: 20 },
    down: { full: 5, mood: 10, clean: 10, fatigue: 95, health: 0.5 },
  };
  function current() { return care.advance(db.read(statsPath), Date.now(), care.napOpts(db.read(`${care.PETS_ROOT}/${sid}/${PET_ID}`) || {}, Date.now())); }
  function save(s) { db.write(statsPath, s); }
  function panel(onChange) {
    const box = document.createElement('div'); box.className = 'tg-preview-panel';
    const title = document.createElement('p'); title.className = 'tg-preview-ribbon'; title.textContent = '미리보기 · 저장되지 않음(관리자 전용) — 새로고침하면 처음으로 돌아가요';
    const row = document.createElement('div'); row.className = 'tg-preview-buttons';
    const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'button'; b.textContent = label; b.addEventListener('click', () => { fn(); onChange(); }); row.append(b); };
    add('건강', () => save({ ...current(), ...SCENARIOS.ok, hospitalUntil: 0, sleepAt: 0, warned: 0 }));
    add('컨디션 저하', () => save({ ...current(), ...SCENARIOS.low, hospitalUntil: 0 }));
    add('아픔', () => save({ ...current(), ...SCENARIOS.sick, hospitalUntil: 0, outpatientDay: '' }));
    add('쓰러짐→입원', () => save({ ...current(), ...SCENARIOS.down, at: Date.now() - 3600 * 1000 }));
    add('입원 1시간 남김', () => { const s = current(); if (s.hospitalUntil > Date.now()) save({ ...s, hospitalUntil: Date.now() + 3600 * 1000 }); });
    add('+1시간', () => { const s = db.read(statsPath) || care.freshStats(Date.now()); save({ ...s, at: (s.at || Date.now()) - 3600 * 1000, ...(s.hospitalUntil ? { hospitalUntil: s.hospitalUntil - 3600 * 1000 } : {}), ...(s.sleepAt ? { sleepAt: s.sleepAt - 3600 * 1000 } : {}) }); });
    add('+1일', () => { const s = db.read(statsPath) || care.freshStats(Date.now()); const d = 86400 * 1000; save({ ...s, at: (s.at || Date.now()) - d, ...(s.hospitalUntil ? { hospitalUntil: s.hospitalUntil - d } : {}), ...(s.sleepAt ? { sleepAt: s.sleepAt - d } : {}) }); });
    add('💎 금고 채우기', () => save({ ...current(), gems: care.GEM_POOL_MAX }));
    add('팬 기록 초기화', () => db.write(`${care.FANS_ROOT}/${sid}/${PET_ID}`, null));
    // 훈련소: 배운 재주 전환(기본 4종 ↔ 12종 전부)
    add('🎓 훈련 전부', () => db.write(`${care.PETS_ROOT}/${sid}/${PET_ID}/learned`, Object.fromEntries(ALL_SKILLS.map((k) => [k, { learnedAt: Date.now() }]))));
    // 실제 서버처럼 기본 4종을 먼저 채우고 춤만 1분 훈련 중으로 둔다
    add('⏳ 춤 훈련(1분)', () => db.write(`${care.PETS_ROOT}/${sid}/${PET_ID}/learned`, {
      ...Object.fromEntries(care.BASE_INTERACTIONS.map((k) => [k, { learnedAt: 1 }])),
      dance: { trainStartAt: Date.now(), learnedAt: Date.now() + 60_000 },
    }));
    add('🎓 기본만', () => db.write(`${care.PETS_ROOT}/${sid}/${PET_ID}/learned`, Object.fromEntries(care.BASE_INTERACTIONS.map((k) => [k, { learnedAt: Date.now() }]))));
    box.append(title, row);
    return box;
  }
  return { callShop, callCare, panel };
}
