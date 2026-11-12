// 다마고치 방송 오버레이(OBS 등 브라우저 소스). 설계: docs/다마고치_방송_오버레이_설계.md
// URL: overlay.html#t=<토큰>&size=s|m|l&bg=none|room&stats=1&feed=1&sound=0&pos=br
// 토큰 원문은 # 뒤에만 있다(서버 기록·Referer에 남지 않음). 브라우저가 SHA-256으로 공개 경로를 계산해 실시간 구독한다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { SHOP_BASE } from './tamagotchi-care-view.js?v=20261113-tg-overlay1';

const SHOP_V = '?v=20261113-tg-care2';
const app = initializeApp({
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54', authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com', projectId: 'soop-stock-market',
  appId: '1:997788925900:web:b58db2970489bf18a3a769',
}, 'tg-overlay');
const fanDb = getDatabase(app, 'https://streamer-fanpage-rtdb.firebaseio.com');
const callOverlay = httpsCallable(getFunctions(app, 'us-central1'), 'streamerFanPageTamagotchiOverlay');

const REFRESH_MS = 5 * 60 * 1000; // 시간 경과(배고파짐 등) 보정
const REACT_MS = 2600; const REACT_MAX = 4;
const STAT_EMOJI = [['full', '🍚'], ['mood', '😊'], ['clean', '🫧'], ['fatigue', '💤'], ['health', '❤️']];
const BAND_FILL = { good: 90, mid: 55, bad: 20 };
const REACT = {
  pet: ['🤲', '쓰다듬었어요'], feed: ['🍚', '밥을 줬어요'], groom: ['🪮', '털을 빗어 줬어요'], gem: ['💎', '보석을 선물했어요'],
  play: ['⚽', '함께 놀았어요'], bath: ['🛁', '목욕시켜 줬어요'], nap: ['💤', '재워 줬어요'], walk: ['🐾', '산책했어요'],
  talk: ['💬', '말을 걸었어요'], sing: ['🎤', '노래했어요'], dance: ['💃', '춤췄어요'], cheer: ['📣', '응원했어요'],
  outpatient: ['🏥', '치료해 줬어요'], discharge: ['🏥', '퇴원시켜 줬어요'],
};

function params() {
  const p = new URLSearchParams(location.hash.slice(1));
  const pick = (k, ok, d) => (ok.includes(p.get(k)) ? p.get(k) : d);
  return {
    token: p.get('t') || '', size: pick('size', ['s', 'm', 'l'], 'm'), bg: pick('bg', ['none', 'room'], 'none'),
    stats: p.get('stats') !== '0', feed: p.get('feed') !== '0', sound: p.get('sound') === '1', pos: pick('pos', ['bl', 'br', 'tl', 'tr'], 'br'),
  };
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function main() {
  const opt = params();
  const root = document.getElementById('tgo');
  const demo = new URLSearchParams(location.hash.slice(1)).get('demo') === '1'; // 토큰 없이 모양만 보는 체험(서버 연결 없음)
  if (!demo && !/^[A-Za-z0-9_-]{43}$/.test(opt.token)) return; // 방송 화면에는 오류를 띄우지 않는다
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.className = `tgo pos-${opt.pos} size-${opt.size}${opt.stats ? '' : ' hide-stats'}`;
  const hash = demo ? '' : await sha256Hex(`tg-overlay:${opt.token}`);

  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `${SHOP_BASE}tamagotchi.css${SHOP_V}`; document.head.append(css);
  const [{ createMongsil }, { TOOLS }, { createSound }, { createScene }] = await Promise.all([
    import(`${SHOP_BASE}tamagotchi-pet.js${SHOP_V}`), import(`${SHOP_BASE}tamagotchi-tools.js${SHOP_V}`),
    import(`${SHOP_BASE}tamagotchi-sound.js${SHOP_V}`), import(`${SHOP_BASE}tamagotchi-scene.js${SHOP_V}`),
  ]);

  const stage = el('div', `tgo-stage${opt.bg === 'room' ? ' tg-stage has-home' : ''}`);
  const petEl = el('div', `tgo-pet${opt.bg === 'room' ? ' tg-stage-pet' : ''}`);
  const bubble = el('div', 'tgo-bubble'); bubble.setAttribute('role', 'status');
  const badge = el('div', 'tgo-badge'); badge.hidden = true;
  // 도구 효과용 요소(상점 CSS 재사용): 목욕 물줄기·김 서림
  const water = el('div', 'tg-water tgo-water'); water.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  const steam = el('div', 'tg-steam'); steam.setAttribute('aria-hidden', 'true');
  stage.append(steam, petEl, water, bubble, badge);
  const info = el('div', 'tgo-info'); const name = el('span', 'tgo-name'); const gems = el('span', 'tgo-gems'); info.append(name, gems);
  const stats = el('div', 'tgo-stats');
  const rings = {};
  for (const [k, e] of STAT_EMOJI) { const r = el('span', 'tgo-ring'); r.append(el('span', '', e)); stats.append(r); rings[k] = r; }
  root.append(stage, info, stats);

  let pet = null; let scene = null; let color = '';
  const sound = opt.sound ? createSound() : null;
  const seen = new Map(); let primed = false; const queue = []; let playing = false;

  function ensurePet(c) {
    if (pet && c === color) return;
    pet?.destroy(); petEl.replaceChildren(); color = c;
    pet = createMongsil(petEl, { color: c || 'cream', reduced });
    if (opt.bg === 'room') { scene = createScene({ stage, pet: petEl, reduced }); requestAnimationFrame(() => scene.alignHome()); }
  }
  function render(live) {
    ensurePet(live.color);
    root.hidden = false;
    name.textContent = live.nickname || '다마고치';
    gems.textContent = `💎 ${live.gems ?? 0}/${live.gemMax ?? 60}`;
    for (const [k] of STAT_EMOJI) { const b = live.bands?.[k] || 'mid'; rings[k].dataset.band = b; rings[k].style.setProperty('--p', String(BAND_FILL[b] ?? 50)); }
    const cond = live.condition || 'ok';
    pet.setCondition?.(cond);
    scene?.setHospital(cond === 'hospital');
    if (live.sleeping && !pet.isSleeping?.()) pet.sleep?.();
    if (!live.sleeping && pet.isSleeping?.()) pet.wakeUp?.();
    if (cond === 'hospital' && live.hospitalUntil) {
      badge.textContent = `🏥 ${Math.max(1, Math.ceil((live.hospitalUntil - Date.now()) / 3600000))}시간 뒤 퇴원`; badge.hidden = false;
    } else badge.hidden = true;
    collect(live.recent || {});
  }
  // 새로 늘어난 횟수만 반응으로(처음 불러올 때 이미 있던 기록은 건너뜀)
  function collect(recent) {
    const totals = new Map();
    for (const bucket of Object.values(recent)) for (const [k, n] of Object.entries(bucket || {})) totals.set(k, (totals.get(k) || 0) + (Number(n) || 0));
    for (const [k, n] of totals) {
      const before = seen.get(k) || 0;
      if (primed && opt.feed && n > before && REACT[k]) queue.push([k, n - before]);
      seen.set(k, n);
    }
    for (const k of [...seen.keys()]) if (!totals.has(k)) seen.delete(k); // 10분 지나 사라진 기록
    primed = true;
    while (queue.length > REACT_MAX) queue.shift();
    if (!playing) next();
  }
  // 도구와 함께 나오던 효과를 반응 2.2초 동안 재현(파티클·거품·물줄기·김·하트 자국·공 쫓기)
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  function bodyPoint(fx, fy) { const r = pet.bodyRect(); return [r.left + r.width * fx, r.top + r.height * fy]; }
  function effects(kind) {
    const tool = TOOLS[kind] || {};
    if (tool.fx) for (const ms of [0, 700, 1400]) later(ms, () => pet.fx?.(tool.fx));
    if (tool.holdFx) for (const ms of [350, 1050, 1750]) later(ms, () => pet.fx?.(tool.holdFx));
    if (kind === 'bath') {
      for (const ms of [0, 400, 800, 1200, 1600]) later(ms, () => pet.foam?.());
      const r = pet.bodyRect(); const s = stage.getBoundingClientRect();
      water.style.left = `${r.left - s.left + r.width * 0.62}px`; water.style.top = `${r.top - s.top - r.height * 0.08}px`;
      water.classList.add('is-on'); later(2200, () => water.classList.remove('is-on'));
      steam.classList.add('is-on'); steam.style.transition = 'opacity 1s ease'; steam.style.opacity = '0.55';
      later(2200, () => { steam.style.transition = 'opacity 5s ease'; steam.style.opacity = '0'; later(5100, () => steam.classList.remove('is-on')); });
    }
    if (kind === 'gem') { // 하트 보석 자국: 몸 위를 지나가듯 하트를 남긴다
      [[0.2, 0.35], [0.35, 0.3], [0.5, 0.28], [0.65, 0.3], [0.8, 0.35]].forEach(([x, y], i) => later(i * 160, () => pet.heartAt?.(...bodyPoint(x, y))));
    }
    if (kind === 'play') { // 공 쫓기: 좌우로 몸을 기울였다가 돌아온다
      const r = pet.bodyRect();
      later(0, () => pet.chase?.(r.left - r.width * 0.6, r.top + r.height * 0.5, 60));
      later(700, () => pet.chase?.(r.right + r.width * 0.6, r.top + r.height * 0.5, 60));
      later(1400, () => pet.chase?.(r.left - r.width * 0.3, r.top + r.height * 0.4, 40));
      later(2100, () => pet.chase?.());
    }
  }
  function next() {
    const item = queue.shift(); if (!item) { playing = false; bubble.classList.remove('is-on'); return; }
    playing = true;
    const [kind, n] = item; const [emoji, text] = REACT[kind];
    bubble.textContent = `${emoji} 팬이 ${text}${n > 1 ? ` ×${n}` : ''}`; bubble.classList.add('is-on');
    const preset = TOOLS[kind]?.preset;
    if (preset && pet && !pet.isSleeping?.()) { pet.play?.(preset, { seconds: 2.2 }); effects(kind); }
    if (sound) { if (['pet', 'feed', 'groom', 'bath', 'sing', 'dance', 'cheer'].includes(kind)) sound.keep(kind, 2000); else sound.once(kind === 'gem' ? 'gem' : kind, 600); }
    setTimeout(next, REACT_MS);
  }

  if (demo) {
    const live = { nickname: '체험 몽실이', color: 'cream', condition: 'ok', bands: { full: 'good', mood: 'good', clean: 'mid', fatigue: 'good', health: 'good' }, sleeping: false, hospitalUntil: 0, gems: 12, gemMax: 60, recent: {} };
    render(live);
    const kinds = ['feed', 'pet', 'dance', 'talk', 'cheer', 'sing'];
    let i = 0;
    setInterval(() => { const k = kinds[i % kinds.length]; i += 1; live.recent = { ...live.recent, 1: { ...(live.recent[1] || {}), [k]: ((live.recent[1] || {})[k] || 0) + 1 + (i % 3) } }; render(live); }, 4000);
    return;
  }
  onValue(ref(fanDb, `streamerFanPageTamagotchiOverlayLive/${hash}`), (snap) => {
    const live = snap.val();
    if (!live) { root.hidden = true; return; } // 해제·재발급되면 조용히 숨는다
    render(live);
  }, () => { root.hidden = true; });

  const refresh = () => callOverlay({ action: 'state', token: opt.token }).catch(() => {});
  setTimeout(refresh, 3000);
  setInterval(refresh, REFRESH_MS);
}
main().catch(() => { /* 방송 화면에는 오류를 띄우지 않는다 */ });
