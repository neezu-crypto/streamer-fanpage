// 팬페이지 다마고치 탭: 돌봄 화면(3-C). 펫·도구·소리·무대 배치는 상점 모듈을 그대로 불러 쓰고, 스탯은 서버(Care)가 계산한다.
// 설계: docs/다마고치_3C_팬페이지_돌봄_화면_설계.md
export const SHOP_BASE = 'https://neezu-crypto.github.io/streamer-game-series-shop/';
const SHOP_V = '?v=20261113-tg-walkfix1';
export const SEND_EVERY_MS = 6000; // 서버 전송 간격(화면은 예측값으로 바로 반응)
const REFRESH_MS = 60000; // 다른 팬이 돌본 결과 반영
const BLOCK_DIM_MS = 10000;
const STAT_ORDER = [['full', '배부름'], ['mood', '기분'], ['clean', '청결'], ['fatigue', '피로'], ['health', '건강']];
// 스탯 이모지(링 가운데). 링은 '좋은 정도'로 찬다 → 피로는 쉴수록(피로가 낮을수록) 꽉 찬다
const STAT_EMOJI = { full: '🍚', mood: '😊', clean: '🫧', fatigue: '💤', health: '❤️' };
const BAND_WORD = { good: '좋음', mid: '보통', bad: '나쁨' };
// 예측용 대략적인 효과(서버 EFFECTS와 같은 값, 보정은 응답으로)
export const CARE_HINT = {
  pet: { mood: 3 }, feed: { full: 8, mood: 1 }, groom: { clean: 4, mood: 1 }, gem: { mood: 2 }, play: { mood: 5, fatigue: 3, full: -1 },
  bath: { clean: 6, fatigue: -1 }, nap: {}, walk: {}, talk: { mood: 1 }, sing: { mood: 3 }, dance: { mood: 4, fatigue: 2 }, cheer: { mood: 2 },
};
const HOLD_UNIT_MS = 4000;

// ---------- 서버 적용 속도 맞추기(순수 함수: 테스트 대상) ----------
// 서버 applyOne과 같은 규칙: 1분 횟수(perMin), 하루 횟수(perDay), 거절 조건, 10초 안 연타 감소.
// 서버는 묶음을 받은 시각에 세므로 1분 창은 전송 지연(SEND_EVERY_MS)만큼 넉넉히 잡는다.
export const RATE_RULES = {
  pet: { perMin: 5 }, talk: { perMin: 6 }, sing: { perMin: 4 }, gem: { perDay: 5 }, cheer: { perDay: 10 },
  feed: { refuse: (s) => s.full >= 95 }, groom: { refuse: (s) => s.clean >= 100 }, bath: { refuse: (s) => s.clean >= 90 },
};
const REPEAT_MULT = [1, 0.7, 0.4];
export function createRateMirror({ windowMs = 60000 + SEND_EVERY_MS } = {}) {
  const win = new Map(); // kind → { m, mc, r, rc }
  let daily = {}; let dayStamp = '';
  function cur(kind, now) {
    const w = win.get(kind) || { m: 0, mc: 0, r: 0, rc: 0 };
    if (now - w.m >= windowMs) { w.m = now; w.mc = 0; }
    if (now - w.r >= 10000) { w.r = now; w.rc = 0; }
    win.set(kind, w); return w;
  }
  return {
    // 서버가 알려 준 오늘 횟수로 맞춘다(날짜가 바뀌면 새로 받는다)
    syncDaily(serverDaily, day) { if (day !== dayStamp) daily = {}; dayStamp = day; for (const [k, v] of Object.entries(serverDaily || {})) daily[k] = Math.max(daily[k] || 0, Number(v) || 0); },
    // 막을 이유(서버 REASON 코드) 또는 null
    check(kind, units, stats, now) {
      const rule = RATE_RULES[kind]; if (!rule) return null;
      const w = cur(kind, now);
      if (rule.perMin && w.mc + units > rule.perMin + 1e-9) return 'cooldown';
      if (rule.perDay && (daily[kind] || 0) + units > rule.perDay) return 'daily';
      if (rule.refuse && stats && rule.refuse(stats)) return 'full';
      return null;
    },
    // 실제로 보낼 때 센다. 돌려주는 값은 연타 감소를 반영한 효과 배율(누르기는 감소 없음)
    use(kind, units, now, { hold = false } = {}) {
      const w = cur(kind, now);
      w.mc += units; daily[kind] = (daily[kind] || 0) + units;
      if (hold) return units;
      w.rc += 1; return REPEAT_MULT[Math.min(2, w.rc - 1)];
    },
  };
}
const ALLOWED = { sick: ['pet', 'feed', 'nap', 'talk'], down: ['pet'], hospital: ['pet', 'talk', 'cheer'] };
const BLOCK_TEXT = { sick: '아파서 쉬어야 해요. 쓰다듬기·밥주기·낮잠·수다만 할 수 있어요.', down: '쓰러졌어요… 쓰다듬기만 할 수 있어요.', hospital: '입원 중이에요. 병문안(쓰다듬기·수다·응원)만 할 수 있어요.' };
const REASON_TEXT = { full: '지금은 충분해요!', cooldown: '조금 쉬었다가 해 주세요.', daily: '오늘은 여기까지예요.', condition: '지금은 할 수 없어요.', 'not-learned': '아직 배우지 않은 재주예요.', 'too-fast': '조금 천천히 눌러 주세요.' };
// 훈련소(상점 다마고치 마을). 분양 때 배우는 기본 재주 4종은 서버 기록이 없을 때의 기본값
export const TRAIN_URL = `${SHOP_BASE}tamagotchi-world.html#train`;
const BASE_SKILLS = ['pet', 'feed', 'groom', 'gem'];
// 받침 유무로 은/는
function josa(word) { const c = String(word || '').slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는'; }
const PENDING_KEY = 'tgCarePendingTool';

// ---------- 묶어 보내기 큐(순수 함수: 테스트 대상) ----------
// 같은 kind는 합치고 n은 10, holdMs는 20초까지. 넘치면 다음 묶음으로 남긴다. 묶음은 최대 12항목.
export function createQueue() {
  let items = new Map(); // kind → { n, holdMs, meters }
  return {
    add(kind, { n = 0, holdMs = 0, meters = 0 } = {}) {
      const cur = items.get(kind) || { n: 0, holdMs: 0, meters: 0 };
      cur.n += n; cur.holdMs += holdMs; cur.meters = Math.max(cur.meters, meters);
      items.set(kind, cur);
    },
    size() { return items.size; },
    take() {
      const batch = []; const rest = new Map();
      for (const [kind, v] of items) {
        if (batch.length >= 12) { rest.set(kind, v); continue; }
        const n = Math.min(10, v.n); const holdMs = Math.min(20000, Math.round(v.holdMs));
        if (n === 0 && holdMs === 0 && kind !== 'walk' && kind !== 'nap') continue;
        const item = { kind, n: kind === 'walk' || kind === 'nap' ? 1 : n };
        if (holdMs > 0) item.holdMs = holdMs;
        if (kind === 'walk') item.meters = Math.min(300, v.meters);
        batch.push(item);
        const left = { n: v.n - n, holdMs: v.holdMs - holdMs, meters: 0 };
        if (left.n > 0 || left.holdMs > 0) rest.set(kind, left);
      }
      items = rest; return batch;
    },
    putBack(batch) { for (const b of batch) this.add(b.kind, { n: b.n, holdMs: b.holdMs || 0, meters: b.meters || 0 }); },
  };
}

function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }
function loadShopCss() {
  if (document.querySelector('link[data-tg-shop-css]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `${SHOP_BASE}tamagotchi.css${SHOP_V}`; link.dataset.tgShopCss = '1';
  document.head.append(link);
}
let modulesPromise = null;
function loadShopModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import(`${SHOP_BASE}tamagotchi-pet.js${SHOP_V}`), import(`${SHOP_BASE}tamagotchi-tools.js${SHOP_V}`),
      import(`${SHOP_BASE}tamagotchi-sound.js${SHOP_V}`), import(`${SHOP_BASE}tamagotchi-scene.js${SHOP_V}`),
    ]).then(([pet, tools, snd, scene]) => ({ ...pet, ...tools, ...snd, ...scene }))
      .catch((error) => { modulesPromise = null; throw error; });
  }
  return modulesPromise;
}

// mountCareView: 탭 패널 안에 돌봄 화면을 그린다. 반환값 destroy()로 정리.
export function mountCareView(container, {
  page, callShop, callCare, isAdmin = false, canManage = false, hasAccount = () => false, openLogin = () => {}, openApplication = null, callOverlay = null,
}) {
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = el('div', 'tg-care'); container.replaceChildren(root);
  const status = el('p', 'tg-care-status loading-bar', '다마고치를 불러오고 있어요.'); status.setAttribute('role', 'status');
  root.append(status);
  let destroyed = false; let mods = null; let petApi = null; let toolCtl = null; let scene = null; let sound = null;
  let pets = []; let pet = null; let server = null; let shown = {}; let target = {};
  let sending = false; let sendTimer = 0; let refreshTimer = 0; let animFrame = 0; let lastWarn = 0;
  const queue = createQueue(); const dimmed = new Map(); const rate = createRateMirror();
  const refs = {};

  // ---------- 화면 뼈대 ----------
  function build() {
    root.replaceChildren();
    const head = el('div', 'tg-care-head');
    refs.picker = el('div', 'tg-care-picker'); refs.picker.setAttribute('role', 'radiogroup'); refs.picker.setAttribute('aria-label', '펫 선택');
    refs.name = el('strong', 'tg-care-name');
    refs.bond = el('span', 'tg-care-chip'); refs.gems = el('span', 'tg-care-chip');
    const meta = el('div', 'tg-care-meta'); meta.append(refs.name, refs.bond, refs.gems);
    head.append(refs.picker, meta);
    if (callOverlay && canManage) {
      const tv = el('button', 'tg-care-icon-btn', '📺'); tv.type = 'button'; tv.title = '방송 오버레이'; tv.setAttribute('aria-label', '방송 오버레이');
      tv.addEventListener('click', () => openOverlayDialog()); head.append(tv);
    }
    if (openApplication) {
      const app = el('button', 'tg-care-icon-btn', '✎'); app.type = 'button'; app.title = '다마고치 디자인 신청'; app.setAttribute('aria-label', '다마고치 디자인 신청');
      app.addEventListener('click', () => openApplication()); head.append(app);
    }
    refs.banner = el('p', 'tg-care-banner'); refs.banner.hidden = true; refs.banner.setAttribute('role', 'alert');
    refs.stage = el('section', 'tg-stage tg-care-stage'); refs.stage.setAttribute('aria-label', '다마고치');
    refs.pet = el('div', 'tg-stage-pet');
    refs.hospital = el('p', 'tg-hospital-badge'); refs.hospital.hidden = true;
    refs.sound = el('button', 'tg-sound-btn'); refs.sound.type = 'button';
    refs.bubble = el('p', 'tg-bubble', '도구를 골라 돌봐 주세요'); refs.bubble.setAttribute('role', 'status'); refs.bubble.setAttribute('aria-live', 'polite');
    refs.stage.append(refs.pet, refs.hospital, refs.sound, refs.bubble);
    refs.tools = el('div', 'tg-actions tg-care-tools'); refs.tools.setAttribute('role', 'group'); refs.tools.setAttribute('aria-label', '돌봄 도구');
    refs.stats = el('div', 'tg-care-stats');
    refs.treat = el('div', 'tg-care-treat');
    refs.note = el('p', 'tg-care-note'); refs.note.setAttribute('role', 'status');
    root.append(head, refs.banner, refs.stage, refs.tools, refs.stats, refs.treat, refs.note);
  }

  function empty(text, withShopLink) {
    root.replaceChildren();
    const box = el('div', 'tg-care-empty'); box.append(el('p', '', text));
    if (openApplication) {
      const app = el('button', 'button', '✎ 다마고치 디자인 신청'); app.type = 'button'; app.addEventListener('click', () => openApplication()); box.append(app);
    }
    if (withShopLink) { const a = el('a', 'button button-primary', '분양소 가기 ↗'); a.href = `${SHOP_BASE}tamagotchi.html`; a.target = '_blank'; a.rel = 'noopener'; box.append(a); }
    root.append(box);
  }

  // ---------- 방송 오버레이(📺): 발급·재발급·끄기, 옵션, 미리보기 ----------
  const OVERLAY_PAGE = new URL('overlay.html', location.origin + location.pathname).href;
  function openOverlayDialog() {
    let token = '';
    const dlg = el('dialog', 'tg-overlay-dialog');
    const close = el('button', 'tg-overlay-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', '닫기'); close.addEventListener('click', () => dlg.close());
    const title = el('h3', '', '📺 방송 오버레이');
    const desc = el('p', 'tg-overlay-desc', 'OBS·PRISM 같은 방송 프로그램의 "브라우저 소스"에 아래 주소를 넣으면 방송 화면에 펫이 떠요. 팬이 돌보면 실시간으로 반응해요(누가 했는지는 표시하지 않아요).');
    const state = el('p', 'tg-overlay-state'); state.setAttribute('role', 'status');
    const actions = el('div', 'tg-overlay-actions');
    const make = el('button', 'button button-primary', '주소 만들기'); make.type = 'button';
    const off = el('button', 'button', '오버레이 끄기'); off.type = 'button';
    actions.append(make, off);
    const opts = el('div', 'tg-overlay-opts');
    const sel = (label, key, choices, def) => {
      const lab = el('label', '', label); const s = el('select'); s.dataset.key = key;
      for (const [v, t] of choices) { const o = el('option', '', t); o.value = v; if (v === def) o.selected = true; s.append(o); }
      s.addEventListener('change', updateUrl); lab.append(s); opts.append(lab); return s;
    };
    sel('크기', 'size', [['s', '작게'], ['m', '보통'], ['l', '크게']], 'm');
    sel('배경', 'bg', [['none', '투명'], ['room', '방 그림']], 'none');
    sel('위치', 'pos', [['br', '오른쪽 아래'], ['bl', '왼쪽 아래'], ['tr', '오른쪽 위'], ['tl', '왼쪽 위']], 'br');
    sel('상태 고리', 'stats', [['1', '보이기'], ['0', '숨기기']], '1');
    sel('반응 말풍선', 'feed', [['1', '보이기'], ['0', '숨기기']], '1');
    sel('소리', 'sound', [['0', '끄기'], ['1', '켜기']], '0');
    const urlRow = el('div', 'tg-overlay-url');
    const url = el('input'); url.readOnly = true; url.type = 'text'; url.setAttribute('aria-label', '오버레이 주소');
    const copy = el('button', 'button', '복사'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url.value); state.textContent = '주소를 복사했어요. 다른 사람에게 보여 주지 마세요.'; } catch (_) { url.select(); } });
    urlRow.append(url, copy);
    const warn = el('p', 'tg-overlay-warn', '주소에 비밀 키가 들어 있어요. 방송 화면에 주소가 보이지 않게 해 주세요. 새로 만들면 예전 주소는 바로 꺼져요.');
    const preview = el('iframe', 'tg-overlay-preview'); preview.title = '오버레이 미리보기';
    dlg.append(close, title, desc, state, actions, opts, urlRow, warn, preview);
    container.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    function updateUrl() {
      const q = new URLSearchParams({ t: token });
      opts.querySelectorAll('select').forEach((s) => q.set(s.dataset.key, s.value));
      url.value = token ? `${OVERLAY_PAGE}#${q}` : '';
      urlRow.hidden = !token; warn.hidden = !token; opts.hidden = !token; preview.hidden = !token;
      if (token) preview.src = url.value.replace('#', `?p=${Date.now()}#`);
    }
    async function call(action) {
      const r = (await callOverlay({ action, streamerId: page.streamer.id, petId: pet.petId })).data; return r;
    }
    make.addEventListener('click', async () => {
      if (token || make.dataset.active === '1') { if (!window.confirm('새 주소를 만들면 지금 방송에 쓰는 주소는 바로 꺼져요. 계속할까요?')) return; }
      make.disabled = true;
      try { token = (await call('issue')).token; make.dataset.active = '1'; make.textContent = '새 주소 만들기'; off.hidden = false; state.textContent = '주소를 만들었어요. 이 창을 닫으면 다시 볼 수 없으니 지금 복사해 주세요.'; updateUrl(); }
      catch (error) { state.textContent = error.message || '주소를 만들지 못했어요.'; }
      finally { make.disabled = false; }
    });
    off.addEventListener('click', async () => {
      if (!window.confirm('오버레이를 끌까요? 방송 화면에서 펫이 사라져요.')) return;
      off.disabled = true;
      try { await call('revoke'); token = ''; make.dataset.active = ''; make.textContent = '주소 만들기'; off.hidden = true; state.textContent = '오버레이를 껐어요.'; updateUrl(); }
      catch (error) { state.textContent = error.message || '끄지 못했어요.'; }
      finally { off.disabled = false; }
    });
    updateUrl(); off.hidden = true;
    dlg.showModal();
    call('info').then((r) => {
      if (r.active) { make.dataset.active = '1'; make.textContent = '새 주소 만들기'; off.hidden = false; state.textContent = '오버레이가 켜져 있어요. 주소는 만들 때 한 번만 보여 줘요 — 잃어버렸으면 새로 만들어 주세요.'; }
      else state.textContent = '아직 오버레이 주소가 없어요.';
    }).catch((error) => { state.textContent = error.message || '오버레이 정보를 불러오지 못했어요.'; });
  }

  // ---------- 막대: 예측값 → 서버 값 부드럽게 ----------
  function renderStats() {
    if (!refs.statRows) {
      refs.statRows = {};
      refs.stats.replaceChildren(...STAT_ORDER.map(([key, label]) => {
        const row = el('div', 'tg-care-stat');
        const bar = el('span', 'tg-care-ring'); bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', label);
        bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
        const fill = bar; const face = el('span', 'tg-care-ring-emoji', STAT_EMOJI[key]); face.setAttribute('aria-hidden', 'true'); bar.append(face);
        const name = el('span', 'tg-care-stat-name', label); name.setAttribute('aria-hidden', 'true');
        const num = el('span', 'tg-care-stat-num'); num.hidden = !isAdmin;
        row.append(bar, name, num); refs.statRows[key] = { row, bar, fill, num };
        return row;
      }));
    }
    for (const [key] of STAT_ORDER) {
      const r = refs.statRows[key]; const info = server?.stats?.[key]; if (!info) continue;
      const v = shown[key] ?? 50;
      const good = key === 'fatigue' ? 100 - v : v;
      r.fill.style.setProperty('--p', String(Math.max(0, Math.min(100, good))));
      const level = isAdmin ? (good >= 60 ? 'good' : good >= 30 ? 'mid' : 'bad') : info.band; // 관리자 외에는 서버 단계만
      r.fill.dataset.level = level;
      r.bar.setAttribute('aria-valuenow', String(Math.round(good)));
      r.bar.setAttribute('aria-valuetext', isAdmin && Number.isFinite(info.value) ? `${Math.round(v)}` : BAND_WORD[info.band] || '');
      if (isAdmin) r.num.textContent = String(Math.round(v));
    }
  }
  // 관리자가 아니면 숫자가 없으므로 단계 가운데 값으로 그린다
  const BAND_MID = { good: 80, mid: 45, bad: 15 };
  function serverValue(key) {
    const info = server?.stats?.[key]; if (!info) return 50;
    if (Number.isFinite(info.value)) return info.value;
    const mid = BAND_MID[info.band] ?? 50;
    return key === 'fatigue' ? 100 - mid : mid;
  }
  function tween(ms = 800) {
    cancelAnimationFrame(animFrame);
    const from = { ...shown }; const start = performance.now();
    const step = (t) => {
      const k = reduced ? 1 : Math.min(1, (t - start) / ms); const e = 1 - (1 - k) ** 3;
      for (const [key] of STAT_ORDER) shown[key] = (from[key] ?? target[key]) + ((target[key] ?? 50) - (from[key] ?? target[key] ?? 50)) * e;
      renderStats();
      if (k < 1 && !destroyed) animFrame = requestAnimationFrame(step);
    };
    animFrame = requestAnimationFrame(step);
  }
  function predict(kind, units, mult = units) {
    const hint = CARE_HINT[kind]; if (!hint || server?.condition === 'hospital') return;
    const tired = (target.fatigue ?? 0) >= 80 && (kind === 'play' || kind === 'dance') ? 0.5 : 1;
    for (const [stat, v] of Object.entries(hint)) target[stat] = Math.max(0, Math.min(100, (target[stat] ?? 50) + v * mult * tired));
    tween(reduced ? 0 : 350);
  }

  // ---------- 서버 응답 반영 ----------
  function apply(data) {
    server = data; if (server) server.receivedAt = Date.now();
    if (data?.me?.daily) rate.syncDaily(data.me.daily, data.me.day || '');
    for (const [key] of STAT_ORDER) target[key] = serverValue(key);
    if (!Object.keys(shown).length) shown = { ...target };
    tween(800);
    refs.bond.textContent = `♥ 유대감 Lv.${data.me?.bondLevel || 1}`;
    refs.gems.textContent = `💎 금고 ${data.gems ?? 0}/${data.gemMax ?? 60}`;
    const cond = data.condition || 'ok';
    petApi?.setCondition?.(cond === 'hospital' ? 'hospital' : cond);
    scene?.setHospital(cond === 'hospital');
    if (data.sleeping && !petApi?.isSleeping?.()) petApi?.sleep?.();
    if (!data.sleeping && petApi?.isSleeping?.()) petApi?.wakeUp?.();
    if (cond === 'hospital' && data.hospitalUntil) {
      const h = Math.max(1, Math.ceil((data.hospitalUntil - Date.now()) / 3600000));
      refs.hospital.textContent = `🏥 입원 중 · ${h}시간 뒤 퇴원해요`; refs.hospital.hidden = false;
    } else refs.hospital.hidden = true;
    const sel = toolCtl?.selected?.(); if (sel && (!allowed(sel) || !learned(sel))) toolCtl.clear(); // 상태가 바뀌어 못 쓰게 된 도구는 내려놓는다
    renderTreat(); renderTools(); renderBanner();
  }
  function renderBanner() {
    const cond = server?.condition;
    const nick = pet?.nickname || '다마고치';
    const text = cond === 'hospital' ? `${nick}가 입원했어요. 하트 보석으로 빠르게 퇴원시킬 수 있어요.`
      : cond === 'down' ? `${nick}가 쓰러졌어요!`
        : cond === 'sick' ? `${nick}가 아파요${server.treatment?.available ? ' — 외래 치료 가능' : ''}`
          : lastWarn ? `${nick}의 건강이 떨어지고 있어요. 밥과 휴식을 챙겨 주세요.` : '';
    refs.banner.textContent = text; refs.banner.hidden = !text;
    container.dispatchEvent(new CustomEvent('tg-care-alert', { bubbles: true, detail: { alert: !!text } }));
  }
  function renderTreat() {
    const q = server?.treatment; refs.treat.replaceChildren();
    if (!q) return;
    const label = q.kind === 'outpatient' ? `외래 치료 💎${q.cost}` : `빠른 퇴원 💎${q.cost}`;
    const btn = el('button', 'button button-primary', label); btn.type = 'button';
    btn.disabled = !q.available;
    const why = el('small', 'tg-care-treat-note',
      q.usedToday ? '외래 진료는 하루 한 번이에요.' : !q.available ? `금고의 하트 보석이 부족해요. (${server.gems}/${q.cost})` : '금고의 하트 보석으로 치료해요. 누가 썼는지는 남지 않아요.');
    btn.addEventListener('click', async () => {
      if (!hasAccount()) { remember(null); openLogin(); return; }
      if (!window.confirm(`${label.replace('💎', '하트 보석 ')}개를 써서 치료할까요?`)) return;
      btn.disabled = true;
      try { await flush(); apply((await callCare({ action: 'treat', streamerId: page.streamer.id, petId: pet.petId, kind: q.kind })).data); say('치료했어요! ✦'); }
      catch (error) { say(error.message || '치료하지 못했어요.'); btn.disabled = false; }
    });
    refs.treat.append(btn, why);
  }

  // ---------- 도구 ----------
  function allowed(id) { const a = ALLOWED[server?.condition]; return !a || a.includes(id); }
  // 배운 재주: 서버 상태 응답 → 목록 응답 → 기본 4종 순으로 믿는다
  // 훈련 중(재주당 5분)인 재주: 끝나는 시각이 지나면 화면에서도 바로 풀어 준다(서버도 같은 시각에 허용)
  function trainingEnd(id) {
    const t = (server?.training || pet?.training || {})[id];
    if (!t) return 0;
    const skew = Number(server?.serverNow) > 0 && server.training ? Number(server.serverNow) - (server.receivedAt || Date.now()) : 0;
    return (Number(t.endAt) || 0) - skew;
  }
  function learned(id) {
    const list = Array.isArray(server?.learned) ? server.learned : Array.isArray(pet?.learned) && pet.learned.length ? pet.learned : BASE_SKILLS;
    if (list.includes(id)) return true;
    const end = trainingEnd(id); return end > 0 && end <= Date.now();
  }
  const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  let unlockTimer = 0;
  function showLocked(id) {
    const label = mods.TOOLS[id]?.label || '';
    const end = trainingEnd(id);
    if (end > Date.now()) { say(`${label} 훈련 중이에요 · ${mmss(end - Date.now())} 뒤에 함께할 수 있어요.`); refs.note.replaceChildren(); return; }
    if (canManage) {
      say(`${label}${josa(label)} 아직 배우지 않았어요. 훈련소에서 가르칠 수 있어요.`);
      const a = el('a', 'tg-care-train-link', '🎓 훈련소에서 가르치기 →'); a.href = TRAIN_URL; a.target = '_blank'; a.rel = 'noopener';
      refs.note.replaceChildren(a);
    } else say(`${label}${josa(label)} 아직 배우지 않은 재주예요.`);
  }
  // 도구 버튼은 한 번만 만들고, 이후에는 선택·흐림 표시만 바꾼다
  function renderTools() {
    if (!mods) return;
    if (!refs.toolBtns) {
      refs.toolBtns = new Map();
      refs.tools.replaceChildren(...Object.entries(mods.TOOLS).map(([id, tool]) => {
        const b = el('button', 'tg-action tg-care-tool'); b.type = 'button'; b.dataset.tool = id;
        const img = el('img'); img.src = tool.src; img.alt = ''; img.draggable = false; img.decoding = 'async';
        const lock = el('span', 'tg-care-lock', '🔒'); lock.setAttribute('aria-hidden', 'true'); lock.hidden = true;
        b.append(img, el('span', '', tool.label), lock);
        b.addEventListener('click', () => {
          if (!learned(id)) { toolCtl?.clear(); showLocked(id); return; }
          if (!hasAccount()) { remember(id); openLogin(); return; }
          if (toolCtl.selected() === id) { toolCtl.clear(); return; }
          void flush();
          toolCtl.select(id);
        });
        refs.toolBtns.set(id, b);
        return b;
      }));
    }
    const sel = toolCtl?.selected?.() || ''; const now = Date.now();
    for (const [id, b] of refs.toolBtns) {
      const ok = allowed(id); const has = learned(id);
      const training = !has && trainingEnd(id) > now;
      b.classList.toggle('is-locked', !has); b.classList.toggle('is-training', training);
      const lockEl = b.querySelector('.tg-care-lock'); lockEl.hidden = has; lockEl.textContent = training ? '⏳' : '🔒';
      b.classList.toggle('is-dim', has && (!ok || (dimmed.get(id) || 0) > now)); b.classList.toggle('is-selected', sel === id);
      b.setAttribute('aria-pressed', String(sel === id));
      b.setAttribute('aria-label', has ? mods.TOOLS[id]?.label || id : `${mods.TOOLS[id]?.label || id} (${training ? '훈련 중' : '아직 배우지 않음'})`);
      b.title = training ? '훈련 중이에요' : !has ? '아직 배우지 않은 재주예요' : ok ? '' : BLOCK_TEXT[server?.condition] || '';
    }
    // 가장 먼저 끝나는 훈련 시각에 다시 그려 잠금을 푼다
    clearTimeout(unlockTimer);
    const ends = [...refs.toolBtns.keys()].map(trainingEnd).filter((e) => e > now);
    if (ends.length) unlockTimer = setTimeout(() => { if (!destroyed) renderTools(); }, Math.min(...ends) - now + 300);
  }

  function remember(id) { try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ sid: page.streamer.id, id })); } catch (_) { /* 무시 */ } }
  function resumePending() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      if (!raw || raw.sid !== page.streamer.id || !hasAccount()) return;
      sessionStorage.removeItem(PENDING_KEY);
      if (raw.id && allowed(raw.id) && learned(raw.id)) toolCtl.select(raw.id);
    } catch (_) { /* 무시 */ }
  }
  function say(text) { refs.bubble.textContent = text; }
  function onTool(event) {
    const label = mods.TOOLS[event.tool]?.label || '';
    if (event.type === 'select') { say(`${label} 선택 중 — 펫을 눌러 보세요`); scene?.setBath(event.tool === 'bath'); }
    if (event.type === 'clear') { scene?.setBath(false); say('도구를 골라 돌봐 주세요'); void flush(); }
    if (event.type === 'blocked') say(BLOCK_TEXT[event.condition] || '지금은 할 수 없어요.');
    if (event.type === 'act') {
      const mult = rate.use(event.tool, 1, Date.now());
      if (event.tool === 'nap') queue.add('nap', { n: 1 }); else { queue.add(event.tool, { n: 1 }); predict(event.tool, 1, mult); }
      say(mods.TOOLS[event.tool]?.done || label); schedule();
    }
    if (event.type === 'hold') { rate.use(event.tool, event.ms / HOLD_UNIT_MS, Date.now(), { hold: true }); queue.add(event.tool, { holdMs: event.ms }); predict(event.tool, event.ms / HOLD_UNIT_MS); schedule(); }
    if (event.type === 'limited') say(REASON_TEXT[event.reason] || '지금은 할 수 없어요.');
    if (event.type === 'walk' && event.meters > 0) { lastMeters = event.meters; say(`산책 중… ${event.meters}m 걸었어요`); }
    if (event.type === 'select' || event.type === 'clear') {
      if (event.type === 'clear' && event.tool === 'walk' && lastMeters > 0) { queue.add('walk', { meters: lastMeters }); lastMeters = 0; void flush(); }
      renderTools();
    }
  }
  let lastMeters = 0;

  // ---------- 전송 ----------
  function schedule() { if (!sendTimer) sendTimer = setTimeout(() => { sendTimer = 0; void flush(); }, SEND_EVERY_MS); }
  async function flush() {
    clearTimeout(sendTimer); sendTimer = 0;
    if (sending || !queue.size() || !pet) return;
    const batch = queue.take(); if (!batch.length) return;
    sending = true;
    try {
      const res = (await callCare({ action: 'interact', streamerId: page.streamer.id, petId: pet.petId, batch })).data;
      if (res.warning) lastWarn = res.warning;
      apply(res);
      if (res.result?.gems) say(`하트 보석 +${res.result.gems} 💎`);
      for (const [kind, reason] of Object.entries(res.result?.blocked || {})) {
        dimmed.set(kind, Date.now() + BLOCK_DIM_MS); say(REASON_TEXT[reason] || '지금은 할 수 없어요.');
        setTimeout(() => { if (!destroyed) renderTools(); }, BLOCK_DIM_MS + 50);
      }
      if (Object.keys(res.result?.blocked || {}).length) renderTools();
    } catch (error) {
      if (error.code === 'functions/resource-exhausted') queue.putBack(batch);
      else if (error.code === 'functions/unavailable') { say(error.message || '점검 중이에요.'); toolCtl?.clear(); }
      else if (error.code === 'functions/permission-denied') { openLogin(); }
      else { queue.putBack(batch); refs.note.textContent = '잠시 연결이 불안정해요. 다음에 다시 보낼게요.'; }
    } finally {
      sending = false;
      if (queue.size()) schedule();
    }
  }

  async function refresh() {
    if (!container.isConnected) { api.destroy(); return; } // 다른 팬페이지로 이동함
    if (!onScreen) return; // 다른 탭을 보고 있으면 부르지 않는다(돌아오면 바로 갱신)
    if (!pet || document.hidden || sending || queue.size()) return;
    try { apply((await callCare({ action: 'status', streamerId: page.streamer.id, petId: pet.petId })).data); } catch (_) { /* 다음 주기 */ }
  }
  function onVisibility() { if (document.hidden) void flush(); else void refresh(); }
  function onPageHide() { void flush(); }

  // ---------- 펫 선택 ----------
  async function choose(next) {
    await flush();
    toolCtl?.destroy(); petApi?.destroy(); scene?.destroy();
    refs.toolBtns = null;
    pet = next; shown = {}; target = {}; refs.statRows = null; lastWarn = 0;
    refs.name.textContent = pet.nickname || '이름 없는 다마고치';
    refs.picker.replaceChildren(...(pets.length > 1 ? pets.map((p) => {
      const b = el('button', 'tg-care-pick', p.nickname || p.petId); b.type = 'button'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.petId === pet.petId)); b.addEventListener('click', () => { if (p.petId !== pet.petId) void choose(p); });
      return b;
    }) : []));
    refs.pet.replaceChildren(); refs.pet.style.width = ''; refs.pet.style.transform = '';
    petApi = mods.createMongsil(refs.pet, { color: pet.color || 'cream', reduced });
    scene = mods.createScene({ stage: refs.stage, pet: refs.pet, reduced, maxPetRatio: window.matchMedia('(max-width: 560px)').matches ? 0.56 : Infinity });
    toolCtl = mods.createToolController({ stage: refs.stage, petApi, petEl: refs.pet, ignoreOutside: [refs.tools], reduced, sound, onChange: onTool,
      gate: (kind, units) => rate.check(kind, units, target, Date.now()) });
    refs.stage.classList.add('has-home'); requestAnimationFrame(() => scene.alignHome());
    try {
      apply((await callCare({ action: 'status', streamerId: page.streamer.id, petId: pet.petId })).data);
      resumePending();
    } catch (error) { refs.note.textContent = error.message || '상태를 불러오지 못했어요.'; }
  }

  function renderSoundBtn() { const on = sound.enabled(); refs.sound.textContent = on ? '🔊 소리' : '🔇 소리'; refs.sound.setAttribute('aria-pressed', String(on)); refs.sound.setAttribute('aria-label', on ? '소리 끄기' : '소리 켜기'); }

  (async () => {
    try {
      loadShopCss();
      const [m, list] = await Promise.all([loadShopModules(), callShop({ action: 'pets', streamerId: page.streamer.id })]);
      if (destroyed) return;
      mods = m; pets = Array.isArray(list.data?.pets) ? list.data.pets : [];
      if (!pets.length) { empty('아직 함께하는 다마고치가 없어요.', canManage); return; }
      build();
      sound = mods.createSound(); renderSoundBtn();
      refs.sound.addEventListener('click', () => { sound.setEnabled(!sound.enabled()); renderSoundBtn(); });
      await choose(pets[0]);
      refreshTimer = setInterval(refresh, REFRESH_MS);
      document.addEventListener('visibilitychange', onVisibility); window.addEventListener('pagehide', onPageHide);
      window.addEventListener('resize', onResize);
    } catch (error) {
      if (!destroyed) { status.classList.remove('loading-bar'); status.textContent = error.message || '다마고치를 불러오지 못했어요.'; root.replaceChildren(status); }
    }
  })();
  // 화면에 보일 때만 펫을 그리고 상태를 갱신한다(다른 탭으로 옮기면 멈춤)
  let onScreen = true;
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    const vis = entries.some((e) => e.isIntersecting);
    if (vis === onScreen) return;
    onScreen = vis; petApi?.setPaused?.(!vis);
    if (vis) void refresh(); else { void flush(); toolCtl?.clear(); }
  }) : null;
  io?.observe(root);
  let resizeTimer = 0;
  function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => scene?.relayout(), 200); }

  const api = {
    flush,
    async reload() { if (!pet) return; await flush(); try { apply((await callCare({ action: 'status', streamerId: page.streamer.id, petId: pet.petId })).data); } catch (error) { refs.note.textContent = error.message || ''; } },
    refreshAuth() { if (!toolCtl || destroyed) return; renderTools(); resumePending(); },
    destroy() {
      destroyed = true; clearTimeout(unlockTimer); void flush(); io?.disconnect();
      clearInterval(refreshTimer); clearTimeout(sendTimer); cancelAnimationFrame(animFrame);
      document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('resize', onResize);
      sound?.stopAll(); toolCtl?.destroy(); petApi?.destroy(); scene?.destroy();
    },
  };
  return api;
}
