// PPT 탭(2026-11-23): 팬페이지 정보로 소개 슬라이드를 만들고, 저장·공개·전체화면 발표를 한다.
// 서버 호출: 스트리머 화면에서 탭을 처음 그릴 때 get 1번, 저장 1번(streamerFanPageIntroDeck). 팬은 공개 파일 intro-deck.json만 읽는다.
// 슬라이드 안은 h·p·button 대신 div·span만 써서 디자인 1~5의 공통 글자·버튼 규칙이 닿지 않게 한다.

const TYPE_INFO = {
  cover: { label: '표지', eyebrow: 'HELLO' },
  profile: { label: '프로필', eyebrow: 'PROFILE' },
  games: { label: '플레이한 게임', eyebrow: 'GAMES' },
  competitions: { label: '대회 이력', eyebrow: 'TOURNAMENT' },
  servers: { label: '참여한 서버', eyebrow: 'SERVERS' },
  schedule: { label: '방송 시간', eyebrow: 'SCHEDULE' },
  links: { label: '링크', eyebrow: 'LINKS' },
  closing: { label: '마무리', eyebrow: 'THANK YOU' },
};
const TYPE_ORDER = Object.keys(TYPE_INFO);
const DESIGNS = [
  { id: 'pastel', label: '파스텔', hint: '밝은 분홍·보라 배경' },
  { id: 'midnight', label: '미드나잇', hint: '어두운 남색 배경과 별' },
];
const MAX_SLIDES = 10;
const MAX_ITEMS = 12;
const DEFAULT_ITEMS = 6;
const PROFILE_FIELDS = [
  ['mbti', 'MBTI'], ['birthday', '생일'], ['debutDate', '데뷔'], ['major', '전공·특기'],
  ['fanNickname', '팬 애칭'], ['fandomName', '팬덤'], ['contents', '주요 콘텐츠'],
];
//  정보가 비어 있을 때 어디서 채우는지(버튼 글·팬페이지 위치).
const SOURCE_HINT = {
  profile: { where: '프로필', what: 'MBTI·생일·팬덤 같은 프로필 칸' },
  games: { where: '콘텐츠 탭 › 플레이한 게임', what: '플레이한 게임' },
  competitions: { where: '콘텐츠 탭 › 대회 이력', what: '대회 이력' },
  servers: { where: '콘텐츠 탭 › 참여한 서버', what: '참여한 서버' },
  schedule: { where: '프로필 › 방송 시간', what: '방송 시간' },
  links: { where: '프로필 설정', what: 'YouTube·팬카페 링크' },
};
const FANPAGE_BASE = 'https://neezu-crypto.github.io/streamer-fanpage/';
const decks = new Map(); // streamerId → { loaded, loading, deck, error }

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cut = (value, max) => String(value || '').trim().slice(0, max);
const monthText = (value) => { const m = /^(\d{4})-(\d{2})$/.exec(String(value || '')); return m ? `${Number(m[1])}.${Number(m[2])}` : ''; };
const itemKey = (value, index) => (/^[A-Za-z0-9_-]{1,64}$/.test(String(value || '')) ? String(value) : `i${index}`);

// ---------- 팬페이지 정보 → 고를 수 있는 항목 ----------
function sourceItems(page, games) {
  const p = page.profile || {};
  const nickname = page.streamer?.nickname || '스트리머';
  const profile = PROFILE_FIELDS.map(([key, label]) => {
    const raw = key === 'contents' ? (Array.isArray(p.contents) ? p.contents.join(', ') : '') : p[key];
    return { key, label, value: cut(raw, 120) };
  }).filter((item) => item.value);
  const gameItems = (Array.isArray(games) ? games : []).map((game, index) => {
    const record = game?.bestRecord && typeof game.bestRecord.value === 'string' ? game.bestRecord.value : '';
    return { key: itemKey(game?.id, index), label: cut(game?.name || '게임', 40), value: cut(record ? `${game.bestRecord.type === 'rank' ? '최고랭크' : '최고기록'} ${record}` : '', 120) };
  });
  const competitions = (Array.isArray(p.competitionHistory) ? p.competitionHistory : []).map((entry, index) => ({
    key: itemKey(entry?.id, index), label: cut(entry?.eventName, 40),
    value: cut([monthText(entry?.date), entry?.category, entry?.result].filter(Boolean).join(' · '), 120),
  })).filter((item) => item.label);
  const servers = (Array.isArray(p.serverHistory) ? p.serverHistory : []).map((entry, index) => {
    const start = monthText(entry?.startDate); const end = monthText(entry?.endDate);
    const period = start ? `${start} ~ ${end || '진행 중'}` : (end ? `~ ${end}` : '');
    return { key: itemKey(entry?.id, index), label: cut(entry?.serverName, 40), value: cut([entry?.game, entry?.role, period].filter(Boolean).join(' · '), 120) };
  }).filter((item) => item.label);
  const links = [
    { key: 'soop', label: 'SOOP 방송국', value: page.streamer?.soopUrl || '' },
    { key: 'fanpage', label: '팬페이지', value: `${FANPAGE_BASE}#/p/${encodeURIComponent(page.streamer?.id || '')}` },
    { key: 'youtube', label: 'YouTube', value: p.youtubeChannelUrl || '' },
    { key: 'cafe', label: '팬카페', value: p.cafeUrl || '' },
  ].filter((item) => item.value).map((item) => ({ ...item, value: cut(String(item.value).replace(/^https?:\/\/(www\.)?/, ''), 120) }));
  return {
    cover: { items: [], title: nickname, subtitle: p.fandomName ? `팬덤 ${cut(p.fandomName, 30)}` : 'SOOP 스트리머', note: cut(page.intro, 200) },
    profile: { items: profile, title: `${nickname} 프로필`, subtitle: '', note: '' },
    games: { items: gameItems, title: '플레이한 게임', subtitle: '', note: '' },
    competitions: { items: competitions, title: '대회 이력', subtitle: '', note: '' },
    servers: { items: servers, title: '참여한 서버', subtitle: '', note: '' },
    schedule: { items: [], title: '방송 시간', subtitle: '', note: cut(p.scheduleText, 200) },
    links: { items: links, title: '여기서 만나요', subtitle: '', note: '' },
    closing: { items: [], title: '감사합니다', subtitle: `${nickname} 많이 사랑해 주세요`, note: '' },
  };
}

const slideHasData = (type, src) => Boolean(src.items.length || src.note || ['cover', 'closing'].includes(type));
// 저장본(있으면)과 지금 정보로 편집 상태를 만든다.
function editorStateFrom(page, games, deck) {
  const source = sourceItems(page, games);
  const saved = new Map((deck?.slides || []).map((slide) => [slide.type, slide]));
  const picks = new Set(Array.isArray(deck?.picks) ? deck.picks : []);
  const order = [...(deck?.slides || []).map((slide) => slide.type).filter((type) => TYPE_INFO[type]), ...TYPE_ORDER.filter((type) => !saved.has(type))];
  const slides = order.map((type) => {
    const src = source[type]; const old = saved.get(type);
    const hasData = slideHasData(type, src);
    const shown = deck ? src.items.filter((item) => picks.has(`${type}:${item.key}`)).map((item) => item.key)
      : src.items.slice(0, DEFAULT_ITEMS).map((item) => item.key);
    return {
      type, on: deck ? saved.has(type) : Boolean(hasData),
      title: old?.title || src.title, subtitle: old ? old.subtitle : src.subtitle, note: old ? old.note : src.note,
      items: src.items, shown: new Set(shown), hasData,
    };
  });
  return { design: deck?.design || 'pastel', public: deck ? deck.public === true : false, slides };
}

function deckFromEditor(state) {
  const on = state.slides.filter((slide) => slide.on).slice(0, MAX_SLIDES);
  return {
    design: state.design,
    public: state.public,
    slides: on.map((slide) => ({
      type: slide.type, title: cut(slide.title, 40), subtitle: cut(slide.subtitle, 80), note: cut(slide.note, 200),
      items: slide.items.filter((item) => slide.shown.has(item.key)).slice(0, MAX_ITEMS).map((item) => ({ label: item.label, value: item.value })),
    })),
    picks: on.flatMap((slide) => slide.items.filter((item) => slide.shown.has(item.key)).map((item) => `${slide.type}:${item.key}`)).slice(0, 200),
  };
}

// 저장본의 항목 글이 지금 팬페이지 정보와 다른지(저장 뒤 정보를 고쳤는지). 게임 목록을 아직 못 불러왔으면 게임 장은 비교하지 않는다.
function deckIsStale(page, games, deck) {
  if (!deck?.slides?.length) return false;
  const fresh = deckFromEditor(editorStateFrom(page, games, deck));
  const gamesKnown = Array.isArray(games) && games.length > 0;
  return deck.slides.some((slide, i) => {
    if (slide.type === 'games' && !gamesKnown) return false;
    const now = fresh.slides[i];
    return !now || JSON.stringify(slide.items || []) !== JSON.stringify(now.items || []);
  });
}

// 링크 장 QR(2026-11-24): 발표 화면에서 시청자가 휴대폰으로 찍어 바로 들어가게 링크마다 QR을 그린다.
// 브라우저에서만 그린다(외부 QR 사이트·서버 호출 없음). QR 모듈은 링크 장을 처음 그릴 때만 불러온다.
let qrModule = null;
const loadQr = () => (qrModule ||= import('./comment-up-qr.mjs?v=20261122-qr2'));
const linkUrl = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);
function fillQr(holder, value, label) {
  loadQr().then(({ qrSvg }) => {
    if (!holder.isConnected && !holder.parentNode) return;
    holder.replaceChildren(qrSvg(linkUrl(value), { title: `${label} QR 코드` }));
  }).catch(() => holder.remove());
}

// ---------- 슬라이드 그리기(16:9, 글자 크기는 슬라이드 폭 기준 cqw) ----------
function renderSlide(slide, design, page, index, total) {
  const box = el('div', `intro-slide intro-slide-${design} intro-slide-${slide.type}`);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${index + 1}번째 장: ${slide.title || TYPE_INFO[slide.type]?.label || ''}`);
  box.append(el('div', 'intro-slide-bg'));
  const panel = el('div', 'intro-slide-panel');
  if (slide.type === 'cover') {
    const avatar = el('img', 'intro-slide-avatar');
    avatar.alt = ''; avatar.decoding = 'async'; avatar.loading = 'lazy';
    avatar.referrerPolicy = 'no-referrer';
    avatar.src = page.streamer?.avatarUrl || '';
    avatar.addEventListener('error', () => avatar.remove(), { once: true });
    panel.append(avatar);
  }
  panel.append(el('div', 'intro-slide-eyebrow', TYPE_INFO[slide.type]?.eyebrow || ''), el('div', 'intro-slide-title', slide.title || ''));
  if (slide.subtitle) panel.append(el('div', 'intro-slide-subtitle', slide.subtitle));
  if (slide.type === 'links' && slide.items?.length) {
    const list = el('div', `intro-slide-items is-qr is-qr-${Math.min(slide.items.length, 4)}`);
    slide.items.slice(0, 4).forEach((item) => {
      const card = el('div', 'intro-slide-item intro-slide-qr-card');
      const holder = el('div', 'intro-slide-qr');
      if (item.value) fillQr(holder, item.value, item.label);
      card.append(holder, el('span', 'intro-slide-item-label', item.label));
      if (item.value) card.append(el('span', 'intro-slide-item-value', item.value));
      list.append(card);
    });
    panel.append(list);
  } else if (slide.items?.length) {
    const list = el('div', `intro-slide-items${slide.items.length > 6 ? ' is-dense' : ''}`);
    slide.items.forEach((item) => {
      const card = el('div', 'intro-slide-item');
      card.append(el('span', 'intro-slide-item-label', item.label));
      if (item.value) card.append(el('span', 'intro-slide-item-value', item.value));
      list.append(card);
    });
    panel.append(list);
  }
  if (slide.note) panel.append(el('div', 'intro-slide-note', slide.note));
  box.append(panel, el('span', 'intro-slide-page', `${index + 1} / ${total}`));
  return box;
}

// 화면 낭독기·작은 화면용 글 목록.
function renderTextList(deck) {
  const details = el('details', 'intro-deck-text');
  details.append(el('summary', '', '슬라이드 내용을 글로 보기'));
  const list = el('ol', 'intro-deck-text-list');
  deck.slides.forEach((slide) => {
    const li = el('li');
    li.append(el('strong', '', slide.title || TYPE_INFO[slide.type]?.label || ''));
    if (slide.subtitle) li.append(el('span', '', ` · ${slide.subtitle}`));
    if (slide.items?.length) {
      const ul = el('ul');
      slide.items.forEach((item) => ul.append(el('li', '', [item.label, item.value].filter(Boolean).join(': '))));
      li.append(ul);
    }
    if (slide.note) li.append(el('p', '', slide.note));
    list.append(li);
  });
  details.append(list);
  return details;
}

// ---------- 넘겨 보기 ----------
function createViewer(deck, page, { sample = false } = {}) {
  const wrap = el('div', `intro-deck-viewer${sample ? ' is-sample' : ''}`);
  const stage = el('div', 'intro-deck-stage');
  stage.tabIndex = 0;
  stage.setAttribute('aria-roledescription', '슬라이드');
  stage.setAttribute('aria-label', 'PPT. 왼쪽·오른쪽 방향키로 넘겨요.');
  const counter = el('span', 'intro-deck-counter');
  counter.setAttribute('aria-live', 'polite');
  const prev = el('button', 'button intro-deck-nav', '‹'); prev.type = 'button';
  prev.title = '이전 장'; prev.setAttribute('aria-label', '이전 장');
  const next = el('button', 'button intro-deck-nav', '›'); next.type = 'button';
  next.title = '다음 장'; next.setAttribute('aria-label', '다음 장');
  const present = el('button', 'button button-primary intro-deck-present-open', '⛶ 전체화면 발표'); present.type = 'button';
  present.title = '화면을 꽉 채워 발표해요. ←/→·스페이스로 넘기고 Esc로 끝내요.';
  let index = 0;
  const total = deck.slides.length;
  const show = (i) => {
    index = Math.max(0, Math.min(total - 1, i));
    stage.replaceChildren(renderSlide(deck.slides[index], deck.design, page, index, total));
    if (sample) stage.append(el('span', 'intro-deck-sample-badge', '견본'));
    counter.textContent = `${index + 1} / ${total}`;
    prev.disabled = index === 0; next.disabled = index === total - 1;
  };
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  stage.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
  });
  attachSwipe(stage, (dir) => show(index + dir));
  present.addEventListener('click', () => openPresentation(deck, page, index));
  const bar = el('div', 'intro-deck-bar');
  bar.append(prev, counter, next, present);
  wrap.append(stage, bar);
  show(0);
  return wrap;
}

// 슬라이드 위 가로 스와이프만 넘김으로 쓴다(세로 스크롤은 그대로).
function attachSwipe(target, onSwipe) {
  let start = null;
  target.addEventListener('touchstart', (event) => { const t = event.touches[0]; start = t ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
  target.addEventListener('touchend', (event) => {
    const t = event.changedTouches[0]; if (!start || !t) return;
    const dx = t.clientX - start.x; const dy = t.clientY - start.y; start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------- 전체화면 발표 ----------
// 아이폰 Safari는 일반 요소 전체화면을 지원하지 않아 화면을 덮는 고정 창으로 대신한다.
function openPresentation(deck, page, startIndex = 0) {
  const overlay = el('div', 'intro-present');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'PPT 발표');
  overlay.tabIndex = -1;
  const holder = el('div', 'intro-present-holder');
  const close = el('button', 'intro-present-close', '✕'); close.type = 'button';
  close.title = '발표 끝내기 (Esc)'; close.setAttribute('aria-label', '발표 끝내기');
  const hint = el('div', 'intro-present-rotate', '휴대폰을 가로로 돌리면 더 크게 보여요');
  overlay.append(holder, close, hint);
  let index = startIndex;
  const total = deck.slides.length;
  const show = (i) => {
    index = Math.max(0, Math.min(total - 1, i));
    const slide = renderSlide(deck.slides[index], deck.design, page, index, total);
    if (!reducedMotion()) slide.classList.add('is-entering');
    holder.replaceChildren(slide);
  };
  const end = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (document.fullscreenElement === overlay) document.exitFullscreen?.().catch(() => {});
    overlay.remove();
    document.documentElement.classList.remove('intro-present-open');
  };
  const onKey = (event) => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); show(index + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) { event.preventDefault(); show(index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); show(0); }
    else if (event.key === 'End') { event.preventDefault(); show(total - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); end(); }
  };
  const onFullscreenChange = () => { if (!document.fullscreenElement && overlay.isConnected && overlay.dataset.fs === '1') end(); };
  holder.addEventListener('click', (event) => {
    const rect = holder.getBoundingClientRect();
    show(index + (event.clientX < rect.left + rect.width * 0.3 ? -1 : 1));
  });
  attachSwipe(holder, (dir) => show(index + dir));
  close.addEventListener('click', end);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.body.append(overlay);
  document.documentElement.classList.add('intro-present-open');
  show(index);
  overlay.focus();
  if (overlay.requestFullscreen && document.fullscreenEnabled) {
    overlay.requestFullscreen().then(() => { overlay.dataset.fs = '1'; }).catch(() => {});
  }
}

// ---------- 편집 창 ----------
function openEditor(page, deps, deck, onSaved) {
  const games = deps.playedGames(page);
  const state = editorStateFrom(page, games, deck);
  const dialog = el('dialog', 'account-dialog intro-editor-dialog');
  dialog.setAttribute('aria-labelledby', 'introEditorTitle');
  const form = el('form', 'account-dialog-card intro-editor');
  const head = el('div', 'profile-editor-heading');
  const title = el('h2', '', deck ? 'PPT 고치기' : 'PPT 만들기'); title.id = 'introEditorTitle';
  const close = el('button', 'button profile-settings-close', '×'); close.type = 'button';
  close.title = '창 닫기'; close.setAttribute('aria-label', 'PPT 창 닫기');
  close.addEventListener('click', () => dialog.close());
  head.append(title, close);

  const body = el('div', 'intro-editor-body');
  const side = el('div', 'intro-editor-side');
  const previewBox = el('div', 'intro-editor-preview');
  const detail = el('div', 'intro-editor-detail');
  let current = state.slides.findIndex((slide) => slide.on);
  if (current < 0) current = 0;

  const designRow = el('div', 'intro-editor-designs');
  designRow.setAttribute('role', 'radiogroup'); designRow.setAttribute('aria-label', '디자인');
  DESIGNS.forEach((design) => {
    const b = el('button', 'button intro-editor-design', design.label); b.type = 'button';
    b.title = `${design.label} 디자인 · ${design.hint}`;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { state.design = design.id; refresh(); });
    b.dataset.design = design.id;
    designRow.append(b);
  });

  const list = el('ol', 'intro-editor-slides');
  const onCount = () => state.slides.filter((slide) => slide.on).length;
  function renderList() {
    list.replaceChildren();
    state.slides.forEach((slide, i) => {
      const li = el('li', `intro-editor-slide${i === current ? ' is-current' : ''}${slide.on ? '' : ' is-off'}`);
      const check = el('input'); check.type = 'checkbox'; check.checked = slide.on;
      check.title = slide.on ? '이 장을 빼요' : '이 장을 넣어요';
      check.setAttribute('aria-label', `${TYPE_INFO[slide.type].label} 장 넣기`);
      check.disabled = !slide.on && onCount() >= MAX_SLIDES;
      check.addEventListener('change', () => { slide.on = check.checked; current = i; refresh(); });
      const pick = el('button', 'intro-editor-slide-name', TYPE_INFO[slide.type].label); pick.type = 'button';
      pick.title = `${TYPE_INFO[slide.type].label} 장을 미리 보고 고쳐요`;
      pick.append(el('span', 'intro-editor-slide-go', '고치기 ›'));
      pick.addEventListener('click', () => { current = i; refresh(); if (window.matchMedia('(max-width: 760px)').matches) previewBox.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
      const up = el('button', 'intro-editor-move', '↑'); up.type = 'button'; up.title = '앞으로'; up.setAttribute('aria-label', `${TYPE_INFO[slide.type].label} 앞으로`);
      const down = el('button', 'intro-editor-move', '↓'); down.type = 'button'; down.title = '뒤로'; down.setAttribute('aria-label', `${TYPE_INFO[slide.type].label} 뒤로`);
      up.disabled = i === 0; down.disabled = i === state.slides.length - 1;
      const move = (d) => { const [s] = state.slides.splice(i, 1); state.slides.splice(i + d, 0, s); current = i + d; refresh(); };
      up.addEventListener('click', () => move(-1)); down.addEventListener('click', () => move(1));
      let tag = null;
      if (!slide.hasData) { tag = el('span', 'intro-editor-slide-tag is-empty', '정보 없음'); tag.title = `팬페이지에 ${SOURCE_HINT[slide.type]?.what || '정보'}을 먼저 채우면 이 장을 만들 수 있어요`; }
      else if (slide.items.length) { tag = el('span', 'intro-editor-slide-tag', `항목 ${slide.shown.size}/${slide.items.length}`); tag.title = `팬페이지 항목 ${slide.items.length}개 중 ${slide.shown.size}개를 보여 줘요`; }
      li.append(check, pick, ...(tag ? [tag] : []), up, down);
      list.append(li);
    });
  }
  function textField(labelText, key, max, multiline = false) {
    const slide = state.slides[current];
    const label = el('label', 'profile-editor-field', labelText);
    const input = el(multiline ? 'textarea' : 'input');
    if (multiline) input.rows = 3; else input.type = 'text';
    input.maxLength = max; input.value = slide[key] || '';
    input.addEventListener('input', () => { slide[key] = input.value; renderPreview(); });
    label.append(input);
    return label;
  }
  function renderDetail() {
    const slide = state.slides[current];
    detail.replaceChildren(el('strong', 'intro-editor-detail-title', `${TYPE_INFO[slide.type].label} 장`));
    const fillButton = () => {
      const hint = SOURCE_HINT[slide.type];
      if (!hint || !deps.goToSource) return null;
      const go = el('button', 'button intro-editor-fill', `${hint.where}에서 채우기 →`); go.type = 'button';
      go.title = '이 창을 닫고 팬페이지의 그 칸으로 이동해요. 채운 뒤 다시 "PPT 만들기"를 눌러 주세요.';
      go.addEventListener('click', () => { dialog.close(); deps.goToSource(slide.type); });
      return go;
    };
    if (!slide.hasData) {
      detail.append(el('p', 'intro-editor-help is-warning', `팬페이지에 아직 ${SOURCE_HINT[slide.type]?.what || '정보'}이 없어서 이 장은 비어 있어요. 먼저 채우면 여기 자동으로 들어와요.`));
      const go = fillButton(); if (go) detail.append(go);
      if (!slide.on) return;
    } else if (!slide.on) {
      const add = el('button', 'button intro-editor-fill', '＋ 이 장 넣기'); add.type = 'button';
      add.title = '이 장을 PPT에 넣어요';
      add.disabled = onCount() >= MAX_SLIDES;
      add.addEventListener('click', () => { slide.on = true; refresh(); });
      detail.append(el('p', 'intro-editor-help', '지금은 빠져 있는 장이에요.'), add);
      return;
    }
    detail.append(textField('제목', 'title', 40), textField('부제목', 'subtitle', 80), textField('하고 싶은 말', 'note', 200, true));
    if (slide.type === 'links') detail.append(el('p', 'intro-editor-help', '링크 장은 QR이 먼저예요. 링크가 많을 때 하고 싶은 말이 길면 슬라이드에서 잘릴 수 있어요(전체 글은 "글로 보기"에 나와요).'));
    if (slide.items.length) {
      const box = el('fieldset', 'intro-editor-items');
      box.append(el('legend', '', `이 장에 보여 줄 항목 (최대 ${MAX_ITEMS}개)`));
      slide.items.forEach((item) => {
        const label = el('label', 'intro-editor-item');
        const check = el('input'); check.type = 'checkbox'; check.checked = slide.shown.has(item.key);
        check.disabled = !check.checked && slide.shown.size >= MAX_ITEMS;
        check.addEventListener('change', () => { if (check.checked) slide.shown.add(item.key); else slide.shown.delete(item.key); refresh(); });
        label.title = item.value || item.label;
        label.append(check, el('span', '', item.value ? `${item.label} · ${item.value}` : item.label));
        box.append(label);
      });
      detail.append(box);
    }
  }
  function renderPreview() {
    const slide = state.slides[current];
    const preview = deckFromEditor({ ...state, slides: [{ ...slide, on: true }] }).slides[0];
    const onSlides = state.slides.filter((s) => s.on);
    const at = Math.max(0, onSlides.indexOf(slide));
    previewBox.replaceChildren(renderSlide(preview, state.design, page, at, Math.max(onSlides.length, 1)));
    if (!slide.on) previewBox.append(el('span', 'intro-deck-sample-badge', '빠진 장'));
  }
  function refresh() {
    designRow.querySelectorAll('[data-design]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.design === state.design)));
    renderList(); renderDetail(); renderPreview();
    countNote.textContent = `${onCount()}장 / 최대 ${MAX_SLIDES}장`;
  }

  const countNote = el('span', 'intro-editor-count');
  side.append(el('strong', 'intro-editor-label', '디자인'), designRow, el('strong', 'intro-editor-label', '넣을 장과 순서'), el('small', 'intro-editor-guide', '☑ 체크로 넣고 빼요 · 이름을 누르면 미리보기와 글 고치기가 열려요 · ↑↓로 순서'), list, countNote);
  const main = el('div', 'intro-editor-main');
  main.append(previewBox, detail);
  body.append(side, main);

  const status = el('p', 'intro-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const footer = el('div', 'profile-editor-footer intro-editor-footer');
  const hint = el('small', '', state.public ? '지금 팬에게 공개 중이에요. 저장하면 팬 화면도 바로 바뀌어요.' : '"나만 보기"는 나에게만 보여요. 팬에게 보여 주려면 "저장하고 팬에게 공개"를 눌러 주세요.');
  const actions = el('div', 'profile-editor-footer-actions');
  const cancel = el('button', 'button', '취소'); cancel.type = 'button'; cancel.title = '저장하지 않고 닫아요';
  cancel.addEventListener('click', () => dialog.close());
  const privateSave = el('button', 'button', state.public ? '공개 끄고 저장' : '나만 보기로 저장'); privateSave.type = 'submit'; privateSave.value = 'private';
  privateSave.title = state.public ? '팬에게서 PPT 탭을 숨기고 저장해요' : '팬에게는 보이지 않게 저장해요. 나중에 공개할 수 있어요';
  const save = el('button', 'button button-primary', state.public ? '저장 (공개 유지)' : '저장하고 팬에게 공개'); save.type = 'submit'; save.value = 'public';
  save.title = '저장하고 팬페이지에 PPT 탭을 보여 줘요';
  const saveLabels = new Map([[privateSave, privateSave.textContent], [save, save.textContent]]);
  actions.append(cancel, privateSave, save); footer.append(hint, actions);
  form.append(head, body, status, footer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const clicked = event.submitter === privateSave ? privateSave : save;
    state.public = clicked === save;
    const next = deckFromEditor(state);
    status.textContent = ''; status.classList.remove('is-error');
    if (!next.slides.length) { status.textContent = '넣을 장을 하나 이상 골라 주세요.'; status.classList.add('is-error'); return; }
    save.disabled = true; privateSave.disabled = true; clicked.textContent = '저장 중…'; clicked.setAttribute('aria-busy', 'true');
    try {
      const result = await deps.call({ action: 'save', streamerId: page.streamer.id, deck: next });
      dialog.close();
      onSaved(result.data.deck);
      deps.toast(next.public ? 'PPT를 저장하고 팬에게 공개했어요.' : 'PPT를 저장했어요. "나만 보기"라 팬에게는 아직 보이지 않아요.');
    } catch (error) {
      status.textContent = error.message || 'PPT를 저장하지 못했어요.'; status.classList.add('is-error');
    } finally {
      if (save.isConnected) saveLabels.forEach((text, button) => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = text; });
    }
  });
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  deps.showModal(dialog);
  refresh();
}

// ---------- 탭 내용 ----------
export function renderIntroDeckSection(page, deps) {
  const section = el('section', 'intro-deck-section content-card');
  section.id = 'introDeckSection';
  const id = page.streamer.id;
  const canEdit = page.isOwner === true;
  let entry = decks.get(id);
  if (!entry) { entry = { loaded: false, loading: false, deck: null, error: '', waiters: new Set() }; decks.set(id, entry); }

  const draw = () => {
    const head = el('div', 'intro-deck-head');
    const copy = el('div');
    copy.append(el('p', 'eyebrow', 'PRESENTATION'), el('h2', '', 'PPT'));
    head.append(copy);
    const tools = el('div', 'intro-deck-tools');
    if (canEdit && entry.loaded) {
      if (entry.deck) {
        const badge = el('span', `intro-deck-public-badge${entry.deck.public ? ' is-public' : ''}`, entry.deck.public ? '팬에게 공개 중' : '나만 보기');
        badge.title = entry.deck.public ? '팬도 PPT 탭에서 볼 수 있어요' : '아직 팬에게는 PPT 탭이 보이지 않아요';
        tools.append(badge);
      }
      const edit = el('button', 'button button-primary intro-deck-edit', entry.deck ? 'PPT 고치기' : 'PPT 만들기'); edit.type = 'button';
      edit.title = '팬페이지 정보로 슬라이드를 고르고 고쳐요';
      edit.addEventListener('click', () => openEditor(page, deps, entry.deck, (deck) => {
        entry.deck = deck;
        deps.onPublicChange(deck.public === true);
        section.replaceChildren(); draw();
      }));
      tools.append(edit);
    }
    head.append(tools);
    section.replaceChildren(head);
    if (!entry.loaded) {
      section.append(el('div', 'loading-card loading-bar intro-deck-loading', entry.error || 'PPT를 불러오고 있어요…'));
      return;
    }
    if (entry.deck && entry.deck.slides?.length) {
      if (canEdit && !entry.deck.public) section.append(el('p', 'intro-deck-notice', '🔒 "나만 보기"로 저장돼 있어요. 팬에게 보여 주려면 "PPT 고치기" › "저장하고 팬에게 공개"를 눌러 주세요.'));
      if (canEdit && deckIsStale(page, deps.playedGames(page), entry.deck)) {
        const stale = el('div', 'intro-deck-notice is-stale');
        stale.append(el('span', '', '✏️ 저장한 뒤 팬페이지 정보가 바뀌었어요. 슬라이드는 저장할 때 내용 그대로라, 다시 저장해야 새 정보가 들어가요.'));
        const again = el('button', 'button', '새 정보로 고치기'); again.type = 'button';
        again.title = '편집 창을 열어 새 정보를 확인하고 저장해요';
        again.addEventListener('click', () => section.querySelector('.intro-deck-edit')?.click());
        stale.append(again);
        section.append(stale);
      }
      section.append(createViewer(entry.deck, page), renderTextList(entry.deck));
      return;
    }
    if (canEdit) {
      const sample = deckFromEditor(editorStateFrom(page, deps.playedGames(page), null));
      const state = editorStateFrom(page, deps.playedGames(page), null);
      const missing = state.slides.filter((slide) => !slide.hasData).map((slide) => TYPE_INFO[slide.type].label);
      section.append(el('p', 'intro-deck-empty', '아직 만든 PPT가 없어요. 아래는 팬페이지에 적어 둔 정보로 자동으로 만든 견본이에요. "PPT 만들기"를 눌러 장을 고르고 저장하면 팬에게 보여 줄 수 있어요.'));
      if (missing.length) section.append(el('p', 'intro-deck-notice', `💡 ${missing.join('·')} 정보가 아직 없어 견본에서 빠졌어요. 팬페이지에 채우면 장이 늘어나요.`));
      if (sample.slides.length) section.append(createViewer(sample, page, { sample: true }));
    } else {
      section.append(el('p', 'intro-deck-empty', '아직 공개된 PPT가 없어요.'));
    }
  };

  if (!entry.loaded) entry.waiters.add(() => draw());
  if (!entry.loaded && !entry.loading) {
    entry.loading = true;
    const load = canEdit
      ? deps.call({ action: 'get', streamerId: id }).then((result) => result.data.deck || null)
      : deps.loadPublicFile(id, 'intro-deck', 365 * 24 * 60 * 60 * 1000).then((file) => file?.deck || null);
    load.then((deck) => { entry.deck = deck; entry.loaded = true; })
      .catch((error) => { entry.error = error?.message || 'PPT를 불러오지 못했어요.'; entry.loaded = true; })
      .finally(() => { entry.loading = false; entry.waiters.forEach((fn) => fn()); entry.waiters.clear(); });
  }
  draw();
  return section;
}

// 저장 후 팬 화면이 예전 파일을 다시 쓰지 않게 캐시를 비운다(다른 페이지로 갈 때).
export function forgetIntroDeck(streamerId) { decks.delete(streamerId); }
