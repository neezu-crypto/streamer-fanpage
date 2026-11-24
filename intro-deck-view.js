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
  free: { label: '자유 장', eyebrow: 'STORY' },
};
//  자유 장(2026-11-24)은 여러 장 넣을 수 있어 고정 순서에서 뺀다.
const TYPE_ORDER = Object.keys(TYPE_INFO).filter((type) => type !== 'free');
const MAX_FREE = 4;
const FREE_NOTE_MAX = 400;
const FREE_MAX_IMAGES = 3;
const FREE_LAYOUTS = [
  { id: 'side', label: '사진 오른쪽', hint: '왼쪽 글, 오른쪽 사진' },
  { id: 'top', label: '사진 위', hint: '사진을 위에 나란히, 글은 아래' },
  { id: 'photo', label: '사진 크게', hint: '사진이 화면을 채우고 글은 아래 띠에' },
];
//  면접용(2026-11-24): 크루·동아리 면접에서 쓰는 PPT. 팬용과 따로 저장하고 언제나 나만 보기.
const VARIANT_LABEL = { fan: '팬용', interview: '면접용' };
const FAN_ONLY_PROFILE = new Set(['fanNickname', 'fandomName']);
const slideLabel = (slide) => (slide.type === 'free' ? (cut(slide.title, 20) || '자유 장') : TYPE_INFO[slide.type]?.label || '');
//  디자인(2026-11-24): 무료 2종은 바로, 나머지 8종도 무료지만 미션을 달성하면 열린다.
//  미션 기준은 서버(functions/index.js INTRO_DECK_MISSIONS)와 같다. 화면은 진행도만 보여 주고, 실제 해금은 저장할 때 서버가 정한다.
const DESIGNS = [
  { id: 'pastel', label: '파스텔', hint: '밝은 분홍·보라 배경' },
  { id: 'midnight', label: '미드나잇', hint: '어두운 남색 배경과 별' },
  { id: 'paper', label: '크라프트', hint: '종이 질감과 마스킹테이프', mission: { text: '프로필 칸 5개 채우기', source: 'profile', goal: 5, count: (f) => f.profileCount } },
  { id: 'neon', label: '네온', hint: '어두운 배경에 빛나는 네온', mission: { text: '플레이한 게임 3개 등록', source: 'games', goal: 3, count: (f) => f.gameCount } },
  { id: 'trophy', label: '트로피', hint: '금색 대회 배너', mission: { text: '대회 이력 1개 등록', source: 'competitions', goal: 1, count: (f) => f.competitionCount } },
  { id: 'pixel', label: '픽셀', hint: '레트로 게임 화면', mission: { text: '참여한 서버 1개 등록', source: 'servers', goal: 1, count: (f) => f.serverCount } },
  { id: 'chalk', label: '칠판', hint: '초록 칠판과 분필 글씨', mission: { text: '소개 한 줄과 방송 시간 적기', source: 'schedule', goal: 2, count: (f) => f.introAndSchedule } },
  { id: 'sunset', label: '노을', hint: '주황·보라 노을 그라데이션', mission: { text: 'PPT를 팬에게 공개하기', goal: 1, count: (f) => (f.deckPublic ? 1 : 0) } },
  { id: 'film', label: '필름', hint: '필름 프레임과 흑백 사진 느낌', mission: { text: 'YouTube나 팬카페 링크 넣기', source: 'links', goal: 1, count: (f) => f.extraLinks } },
  { id: 'mono', label: '모노', hint: '흰 배경 굵은 글씨 미니멀', mission: { text: 'PPT 6장 이상으로 저장', goal: 6, count: (f) => f.slideCount } },
];
const FREE_DESIGNS = new Set(['pastel', 'midnight']);
function missionFacts(page, games, deckLike) {
  const p = page.profile || {};
  const filled = (v) => (Array.isArray(v) ? v.length > 0 : String(v || '').trim() !== '');
  return {
    profileCount: ['mbti', 'birthday', 'debutDate', 'major', 'fanNickname', 'fandomName', 'contents'].filter((k) => filled(p[k])).length,
    gameCount: Array.isArray(games) ? games.length : 0,
    competitionCount: Array.isArray(p.competitionHistory) ? p.competitionHistory.length : 0,
    serverCount: Array.isArray(p.serverHistory) ? p.serverHistory.length : 0,
    introAndSchedule: (filled(page.intro) ? 1 : 0) + (filled(p.scheduleText) ? 1 : 0),
    extraLinks: (filled(p.youtubeChannelUrl) || filled(p.cafeUrl)) ? 1 : 0,
    deckPublic: deckLike?.public === true,
    slideCount: deckLike?.slides?.length || 0,
  };
}
// 'free' | 'unlocked'(서버가 연 것) | 'ready'(미션 달성, 저장하면 열림) | 'locked'
function designStatus(design, facts, unlocked) {
  if (FREE_DESIGNS.has(design.id)) return 'free';
  if (unlocked.has(design.id)) return 'unlocked';
  return design.mission.count(facts) >= design.mission.goal ? 'ready' : 'locked';
}
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

// ---------- 최근 30일 방송 시간(2026-11-24) ----------
// SOOP 다시보기 목록(팬페이지 다시보기 칸이 이미 받아 둔 것)의 영상 길이를 더한다. 실제 생방송 시간과는
// 다를 수 있다(다시보기를 지웠거나 저장하지 않은 방송은 빠짐). 저장할 때 값이 PPT에 고정된다.
const DAY_MS = 24 * 60 * 60 * 1000;
const AIR_LABELS = { total: '최근 30일 방송 합계', avg: '방송한 날 평균' };
const vodTime = (regDate) => { const t = Date.parse(String(regDate || '').trim().replace(' ', 'T') + '+09:00'); return Number.isFinite(t) ? t : NaN; };
const hoursText = (ms) => { const m = Math.round(ms / 60000); const h = Math.floor(m / 60); return h ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`; };
export function airtimeStats(vods, now = Date.now()) {
  const items = Array.isArray(vods?.items) ? vods.items : [];
  const since = now - 30 * DAY_MS;
  let total = 0; const days = new Set(); let oldest = Infinity;
  items.forEach((vod) => {
    const t = vodTime(vod?.regDate); if (!Number.isFinite(t)) return;
    oldest = Math.min(oldest, t);
    const ms = Number(vod?.durationMs) || 0;
    if (t < since || t > now + DAY_MS || ms <= 0) return;
    total += ms;
    days.add(new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
  });
  if (!total) return null;
  return { totalMs: total, days: days.size, avgMs: total / days.size, complete: oldest < since || vods?.hasMore !== true, refreshedAt: Number(vods?.refreshedAt) || null };
}
function airtimeItems(page) {
  const stats = airtimeStats(page.vods);
  if (!stats) return [];
  const about = stats.complete ? '' : '약 ';
  return [
    { key: 'air30total', label: AIR_LABELS.total, value: `${about}${hoursText(stats.totalMs)}` },
    { key: 'air30avg', label: AIR_LABELS.avg, value: `${about}${hoursText(stats.avgMs)} (${stats.days}일 방송)` },
  ];
}
const isAirItem = (item) => item?.label === AIR_LABELS.total || item?.label === AIR_LABELS.avg;

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
    schedule: { items: airtimeItems(page), title: '방송 시간', subtitle: '', note: cut(p.scheduleText, 200) },
    links: { items: links, title: '여기서 만나요', subtitle: '', note: '' },
    closing: { items: [], title: '감사합니다', subtitle: `${nickname} 많이 사랑해 주세요`, note: '' },
  };
}

const slideHasData = (type, src) => Boolean(src.items.length || src.note || ['cover', 'closing'].includes(type));
// 저장본(있으면)과 지금 정보로 편집 상태를 만든다.
let freeSeq = 0;
const newFreeSlide = (init = {}) => ({
  type: 'free', key: `free${++freeSeq}`, on: true, title: init.title || '', subtitle: init.subtitle || '', note: init.note || '',
  images: (Array.isArray(init.images) ? init.images : []).filter((img) => img && img.id && img.url).slice(0, FREE_MAX_IMAGES).map((img) => ({ id: img.id, url: img.url })),
  layout: FREE_LAYOUTS.some((l) => l.id === init.layout) ? init.layout : 'side',
  placeholder: init.placeholder || '', items: [], shown: new Set(), hasData: true,
});
//  면접용 처음 틀: 지원 동기·목표 자유 장이 들어가고, 팬 전용 항목(팬 애칭·팬덤)과 프로필 장은 빠진다.
const INTERVIEW_TEMPLATE = ['cover', 'free:motive', 'games', 'competitions', 'servers', 'free:goal', 'schedule', 'links', 'closing'];
const INTERVIEW_FREE = {
  motive: { title: '지원 동기', placeholder: '왜 이 크루·동아리에 들어오고 싶은지 적어 주세요.' },
  goal: { title: '들어가서 하고 싶은 것', placeholder: '함께하고 싶은 콘텐츠, 맡고 싶은 역할, 목표를 적어 주세요.' },
};

// 저장본(있으면)과 지금 정보로 편집 상태를 만든다. variant: 'fan' | 'interview'
function editorStateFrom(page, games, deck, variant = 'fan') {
  const source = sourceItems(page, games);
  const interview = variant === 'interview';
  if (interview) {
    source.cover = { ...source.cover, subtitle: '지원자 소개' };
    source.schedule = { ...source.schedule, title: '활동 가능 시간' };
    source.closing = { ...source.closing, title: '잘 부탁드립니다', subtitle: '함께하고 싶어요' };
  }
  const saved = new Map((deck?.slides || []).filter((slide) => slide.type !== 'free').map((slide) => [slide.type, slide]));
  const picks = new Set(Array.isArray(deck?.picks) ? deck.picks : []);
  const fixedSlide = (type) => {
    const src = source[type]; const old = saved.get(type);
    const hasData = slideHasData(type, src);
    const defaults = src.items.filter((item) => !(interview && type === 'profile' && FAN_ONLY_PROFILE.has(item.key))).slice(0, DEFAULT_ITEMS);
    const shown = deck ? src.items.filter((item) => picks.has(`${type}:${item.key}`)).map((item) => item.key) : defaults.map((item) => item.key);
    return {
      type, key: type, on: deck ? saved.has(type) : Boolean(hasData) && !(interview && type === 'profile'),
      title: old?.title || src.title, subtitle: old ? old.subtitle : src.subtitle, note: old ? old.note : src.note,
      items: src.items, shown: new Set(shown), hasData,
    };
  };
  let slides;
  if (deck) {
    slides = (deck.slides || []).map((slide) => (slide.type === 'free' ? newFreeSlide(slide) : TYPE_INFO[slide.type] ? fixedSlide(slide.type) : null)).filter(Boolean);
    TYPE_ORDER.filter((type) => !saved.has(type)).forEach((type) => slides.push(fixedSlide(type)));
  } else if (interview) {
    slides = INTERVIEW_TEMPLATE.map((entry) => (entry.startsWith('free:') ? newFreeSlide(INTERVIEW_FREE[entry.slice(5)]) : fixedSlide(entry)));
    TYPE_ORDER.filter((type) => !INTERVIEW_TEMPLATE.includes(type)).forEach((type) => { const slide = fixedSlide(type); slide.on = false; slides.push(slide); });
  } else {
    slides = TYPE_ORDER.map(fixedSlide);
  }
  return { variant, design: deck?.design || 'pastel', public: !interview && deck ? deck.public === true : false, slides };
}

function deckFromEditor(state) {
  const on = state.slides.filter((slide) => slide.on).slice(0, MAX_SLIDES);
  return {
    design: state.design,
    public: state.public,
    slides: on.map((slide) => (slide.type === 'free'
      ? { type: 'free', title: cut(slide.title, 40), subtitle: cut(slide.subtitle, 80), note: cut(slide.note, FREE_NOTE_MAX), items: [], layout: slide.layout || 'side', ...(slide.images?.length ? { images: slide.images.slice(0, FREE_MAX_IMAGES).map((img) => ({ id: img.id, url: img.url })) } : {}) }
      : {
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
    //  방송 시간 통계는 날마다 바뀌어 저장본과 늘 달라지므로 비교에서 뺀다.
    const keep = (items) => JSON.stringify((items || []).filter((item) => !isAirItem(item)));
    return !now || keep(slide.items) !== keep(now.items);
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
//  자유 장 글 강조: **굵게**, 줄 앞 "- "는 목록. HTML은 쓰지 않고 글자 노드로만 만든다.
function richLine(text) {
  const line = el('span', 'intro-slide-line');
  String(text).split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) line.append(el('span', 'intro-slide-strong', part.slice(2, -2)));
    else line.append(document.createTextNode(part));
  });
  return line;
}
function richNote(note) {
  const box = el('div', 'intro-slide-note is-rich');
  let list = null;
  String(note).split('\n').forEach((raw) => {
    const bullet = /^\s*[-•]\s+(.*)$/.exec(raw);
    if (bullet) {
      if (!list) { list = el('div', 'intro-slide-bullets'); box.append(list); }
      const item = el('div', 'intro-slide-bullet'); item.append(richLine(bullet[1])); list.append(item);
    } else {
      list = null;
      if (raw.trim()) box.append(richLine(raw)); else box.append(el('span', 'intro-slide-gap'));
    }
  });
  return box;
}
const plainNote = (note) => String(note || '').replace(/\*\*([^*]+)\*\*/g, '$1');

function renderSlide(slide, design, page, index, total) {
  const photos = slide.type === 'free' && Array.isArray(slide.images) ? slide.images.filter((img) => img?.url).slice(0, FREE_MAX_IMAGES) : [];
  const box = el('div', `intro-slide intro-slide-${design} intro-slide-${slide.type}${photos.length ? ` has-photo intro-slide-layout-${slide.layout || 'side'}` : ''}`);
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
  if (photos.length) {
    //  자유 장 사진: 내 공개 갤러리 썸네일(서버가 저장할 때 확인). 최대 3장.
    const wall = el('div', `intro-slide-photos is-n${photos.length}`);
    photos.forEach((img) => {
      const photo = el('img', 'intro-slide-photo');
      photo.alt = ''; photo.decoding = 'async'; photo.loading = 'lazy'; photo.referrerPolicy = 'no-referrer'; photo.draggable = false;
      photo.src = img.url;
      photo.addEventListener('error', () => photo.remove(), { once: true });
      wall.append(photo);
    });
    box.append(wall);
  }
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
  if (slide.note) panel.append(slide.type === 'free' ? richNote(slide.note) : el('div', 'intro-slide-note', slide.note));
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
    if (slide.note) li.append(el('p', '', plainNote(slide.note)));
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
  if (deck.slides.some((s) => s.type === 'links')) setTimeout(loadQr, 0); //  넘겨 보기에서도 링크 장 전에 미리 불러 둔다
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

// 발표 중 마우스 포인터: 디자인마다 다른 아기자기한 그림(통통한 화살표+얼굴·반짝이).
// 화면 왼쪽 절반에서는 왼쪽(이전 장), 오른쪽 절반에서는 오른쪽(다음 장)을 가리킨다.
// 그림은 오른쪽을 가리키게 그리고(끝점 x=41.6, y=22), 왼쪽은 좌우를 뒤집어 쓴다.
const CHUBBY = 'M6 15.5H24V9.6Q24 6.8 26.3 8.5L40.3 19.6Q42 22 40.3 24.4L26.3 35.5Q24 37.2 24 34.4V28.5H6Q3 28.5 3 25.5V18.5Q3 15.5 6 15.5Z';
const sparkle = (x, y, r, c) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${c}"/>`;
const cuteFace = (eye, blush, cx = 30.5, cy = 22) => `<circle cx="${cx - 2.6}" cy="${cy - 1.4}" r="1.35" fill="${eye}"/><circle cx="${cx + 2.6}" cy="${cy - 1.4}" r="1.35" fill="${eye}"/><path d="M${cx - 1.4} ${cy + 1.4}Q${cx} ${cy + 2.9} ${cx + 1.4} ${cy + 1.4}" fill="none" stroke="${eye}" stroke-width="1.1" stroke-linecap="round"/><circle cx="${cx - 4.6}" cy="${cy + 1.6}" r="1.4" fill="${blush}" opacity=".7"/><circle cx="${cx + 4.6}" cy="${cy + 1.6}" r="1.4" fill="${blush}" opacity=".7"/>`;
const chubby = (fill, stroke, extra = '') => `<path d="${CHUBBY}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round"${extra}/>`;
const PRESENT_CURSOR_ART = {
  pastel: chubby('#ffc4de', '#8a4a9e') + '<path d="M5.5 18.5H21" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>' + cuteFace('#5a2a6b', '#ff7fb0') + '<path d="M11 26.2C8.2 24.2 8.2 21.2 10 21.2C10.8 21.2 11 22 11 22C11 22 11.2 21.2 12 21.2C13.8 21.2 13.8 24.2 11 26.2Z" fill="#fff"/>' + sparkle(8, 8, 4, '#fff1a8') + sparkle(15, 4.5, 2.4, '#fff'),
  midnight: '<g stroke="#9fb4ff" stroke-linecap="round" stroke-dasharray="0.1 4" stroke-width="2.6"><path d="M17 17L3 14"/><path d="M16 22H1"/><path d="M17 27L3 30"/></g>' + `<path d="M41.5 22.0 L34.5 25.3 L33.6 32.9 L28.3 27.3 L20.7 28.8 L24.4 22.0 L20.7 15.2 L28.3 16.7 L33.6 11.1 L34.5 18.7Z" fill="#ffe58a" stroke="#2a2f6b" stroke-width="2" stroke-linejoin="round"/>` + '<path d="M26.3 20.3q1.3 1.1 2.6 0M31.4 20.3q1.3 1.1 2.6 0" fill="none" stroke="#2a2f6b" stroke-width="1.1" stroke-linecap="round"/><path d="M28.8 24q1.4 1.3 2.8 0" fill="none" stroke="#2a2f6b" stroke-width="1.1" stroke-linecap="round"/><circle cx="25.6" cy="23.6" r="1.2" fill="#ff9db8" opacity=".75"/><circle cx="34.6" cy="23.6" r="1.2" fill="#ff9db8" opacity=".75"/>' + sparkle(7, 7, 3, '#fff') + sparkle(9, 37, 2.2, '#ffe58a'),
  paper: '<path d="M2 33Q8 29 6 35Q4 40 11 37" fill="none" stroke="#b5652d" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2.2"/><path d="M41.5 22L4 9L13.5 22Z" fill="#fffaf0" stroke="#3b2f22" stroke-width="1.8" stroke-linejoin="round"/><path d="M41.5 22L13.5 22L9 34Z" fill="#f1dfbf" stroke="#3b2f22" stroke-width="1.8" stroke-linejoin="round"/><path d="M20.5 16.6C18.3 15 18.6 12.6 20.2 12.9C20.9 13 21 13.7 21 13.7C21 13.7 21.4 13.1 22.1 13.2C23.7 13.5 23.2 15.9 20.5 16.6Z" fill="#ff8fab" stroke="#3b2f22" stroke-width=".7"/>' + sparkle(36, 9, 3, '#f7d26b'),
  neon: chubby('#1a0f33', '#ff4fd8', ' filter="url(#g)"') + cuteFace('#00e5ff', '#ff4fd8') + sparkle(9, 8, 3.6, '#00e5ff') + sparkle(38, 37, 2.6, '#ff4fd8') + sparkle(15, 38, 1.8, '#fff'),
  trophy: chubby('#ffd15c', '#8a6214') + '<path d="M5.5 18.5H21" stroke="#fff7d6" stroke-width="1.6" stroke-linecap="round"/>' + cuteFace('#5a3e08', '#ff9d5c') + '<path d="M7 13.5L8 6.5L11 10L13 5L15 10L18 6.5L19 13.5Z" fill="#ffe08a" stroke="#8a6214" stroke-width="1.5" stroke-linejoin="round"/><circle cx="13" cy="5" r="1.2" fill="#ff6b8a"/>' + sparkle(36, 7, 3, '#fff'),
  pixel: '<path d="M4 15H22V6H24V8H26V10H28V12H30V14H32V16H34V18H36V20H38V24H36V26H34V28H32V30H30V32H28V34H26V36H24V38H22V29H4Z" fill="#ffd6ec" stroke="#1b2a6b" stroke-width="2" shape-rendering="crispEdges"/><g fill="#1b2a6b" shape-rendering="crispEdges"><rect x="26" y="18" width="2" height="2"/><rect x="31" y="18" width="2" height="2"/><rect x="28" y="23" width="3" height="1.4"/></g><g fill="#ff7fb0" shape-rendering="crispEdges"><rect x="24" y="22" width="2" height="1.4"/><rect x="33" y="22" width="2" height="1.4"/></g><g fill="#ff4f8b" shape-rendering="crispEdges"><rect x="6" y="5" width="2" height="2"/><rect x="10" y="5" width="2" height="2"/><rect x="4" y="7" width="10" height="2"/><rect x="6" y="9" width="6" height="2"/><rect x="8" y="11" width="2" height="2"/></g><rect x="6" y="19" width="2" height="2" fill="#fff" shape-rendering="crispEdges"/>',
  chalk: chubby('#2f5240', '#f2f5ee', ' stroke-dasharray="5 1.4"') + cuteFace('#f2f5ee', '#ffb3c8') + '<path d="M8 6l1 2.4 2.6.3-2 1.7.6 2.6L8 11.6 5.8 13l.6-2.6-2-1.7L7 8.4Z" fill="none" stroke="#ffe59a" stroke-width="1" stroke-linejoin="round"/><g fill="#f2f5ee"><circle cx="13" cy="36" r=".9"/><circle cx="17" cy="38.5" r=".7"/><circle cx="9" cy="39" r=".6"/></g>',
  sunset: '<defs><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#c25b8c"/><stop offset=".55" stop-color="#f08a5d"/><stop offset="1" stop-color="#ffc27a"/></linearGradient></defs>' + chubby('url(#s)', '#4a2f72') + cuteFace('#4a2f72', '#ffe0b0') + '<g stroke="#ffb35c" stroke-width="1.4" stroke-linecap="round"><path d="M9 2.5V4.3M9 13.7v1.8M2.5 9h1.8M13.7 9h1.8M4.4 4.4l1.3 1.3M12.3 12.3l1.3 1.3M4.4 13.6l1.3-1.3M12.3 5.7l1.3-1.3"/></g><circle cx="9" cy="9" r="3.6" fill="#ffd58a" stroke="#4a2f72" stroke-width="1.1"/>',
  film: chubby('#262626', '#f1f1f1') + '<g fill="#f1f1f1"><rect x="6" y="17" width="2.6" height="2" rx=".6"/><rect x="11" y="17" width="2.6" height="2" rx=".6"/><rect x="16" y="17" width="2.6" height="2" rx=".6"/><rect x="6" y="25" width="2.6" height="2" rx=".6"/><rect x="11" y="25" width="2.6" height="2" rx=".6"/><rect x="16" y="25" width="2.6" height="2" rx=".6"/></g>' + cuteFace('#ffe9b8', '#e0b46a') + sparkle(9, 8, 3.4, '#e0b46a') + sparkle(16, 5, 1.8, '#fff'),
  mono: chubby('#fff', '#111') + cuteFace('#111', '#c8c8c8') + sparkle(9, 8, 3.4, '#111') + sparkle(16, 4.5, 1.8, '#111'),
};
function presentCursor(design, left) {
  const art = PRESENT_CURSOR_ART[design] || PRESENT_CURSOR_ART.pastel;
  const glow = '<filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="1.3" flood-color="#ff4fd8"/></filter>';
  const flip = left ? ' transform="translate(44 0) scale(-1 1)"' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">${glow}<g${flip}>${art}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${left ? 2 : 41} 22, ${left ? 'w-resize' : 'e-resize'}`;
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
  //  링크 장이 있으면 발표를 시작할 때 QR 도구를 미리 불러와, 처음 보는 휴대폰·느린 망에서도 링크 장이 빈 채로 뜨지 않게 한다.
  if (deck.slides.some((s) => s.type === 'links')) loadQr();
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
    show(index + (event.clientX < rect.left + rect.width / 2 ? -1 : 1));
  });
  attachSwipe(holder, (dir) => show(index + dir));
  //  발표 중에는 글자 선택·사진 끌기를 막는다(클릭·스와이프 넘기기는 그대로).
  overlay.addEventListener('dragstart', (event) => event.preventDefault());
  overlay.addEventListener('selectstart', (event) => event.preventDefault());
  const cursorNext = presentCursor(deck.design, false);
  const cursorBack = presentCursor(deck.design, true);
  holder.style.cursor = cursorNext;
  holder.addEventListener('mousemove', (event) => {
    const rect = holder.getBoundingClientRect();
    const want = event.clientX < rect.left + rect.width / 2 ? cursorBack : cursorNext;
    if (holder.style.cursor !== want) holder.style.cursor = want;
  });
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
function openEditor(page, deps, deck, onSaved, variant = 'fan', sharedUnlocked = []) {
  const games = deps.playedGames(page);
  const state = editorStateFrom(page, games, deck, variant);
  const interview = variant === 'interview';
  const dialog = el('dialog', 'account-dialog intro-editor-dialog');
  dialog.setAttribute('aria-labelledby', 'introEditorTitle');
  const form = el('form', 'account-dialog-card intro-editor');
  const head = el('div', 'profile-editor-heading');
  const title = el('h2', '', `${interview ? '면접용 ' : ''}${deck ? 'PPT 고치기' : 'PPT 만들기'}`); title.id = 'introEditorTitle';
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

  //  미션 디자인은 팬용·면접용이 함께 쓴다(서버도 두 저장본을 합쳐 판정).
  const unlocked = new Set([...(Array.isArray(deck?.unlocked) ? deck.unlocked : []), ...sharedUnlocked]);
  const designRow = el('div', 'intro-editor-designs');
  designRow.setAttribute('role', 'radiogroup'); designRow.setAttribute('aria-label', '디자인');
  const designNote = el('div', 'intro-editor-design-note');
  function renderDesigns() {
    const facts = missionFacts(page, games, { public: true, slides: state.slides.filter((x) => x.on) });
    facts.deckPublic = state.public || deck?.public === true;
    designRow.replaceChildren();
    DESIGNS.forEach((design) => {
      const status = designStatus(design, facts, unlocked);
      const b = el('button', `button intro-editor-design is-${status}`); b.type = 'button';
      b.dataset.design = design.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.design === design.id));
      b.append(el('span', 'intro-editor-design-swatch intro-swatch-' + design.id), el('span', '', design.label));
      if (status === 'locked') b.append(el('span', 'intro-editor-design-lock', '🔒'));
      if (status === 'ready') b.append(el('span', 'intro-editor-design-lock', '✨'));
      const m = design.mission;
      b.title = status === 'locked' ? `${design.label} · ${design.hint}\n🔒 미션: ${m.text} (${Math.min(m.count(facts), m.goal)}/${m.goal}) · 미리보기는 할 수 있어요`
        : status === 'ready' ? `${design.label} · ${design.hint}\n✨ 미션 달성! 저장하면 열려요`
          : `${design.label} 디자인 · ${design.hint}`;
      b.addEventListener('click', () => { state.design = design.id; refresh(); });
      designRow.append(b);
    });
    //  고른 디자인이 잠겨 있으면 미션과 채우러 가기를 보여 준다.
    const picked = DESIGNS.find((d) => d.id === state.design);
    const status = designStatus(picked, facts, unlocked);
    designNote.replaceChildren();
    designNote.className = `intro-editor-design-note is-${status}`;
    if (status === 'locked') {
      const m = picked.mission;
      designNote.append(el('span', '', `🔒 ${picked.label}: ${m.text} (${Math.min(m.count(facts), m.goal)}/${m.goal}) 미션을 달성하면 저장할 수 있어요. 지금은 미리보기만 돼요.`));
      if (m.source && SOURCE_HINT[m.source] && deps.goToSource) {
        const go = el('button', 'button intro-editor-fill', `${SOURCE_HINT[m.source].where}에서 채우기 →`); go.type = 'button';
        go.title = '이 창을 닫고 팬페이지의 그 칸으로 이동해요';
        go.addEventListener('click', () => { dialog.close(); deps.goToSource(m.source); });
        designNote.append(go);
      }
    } else if (status === 'ready') {
      designNote.append(el('span', '', `✨ ${picked.label} 미션을 달성했어요. 저장하면 이 디자인이 열려요.`));
    } else {
      const done = DESIGNS.filter((d) => !FREE_DESIGNS.has(d.id) && unlocked.has(d.id)).length;
      designNote.append(el('span', '', `미션 디자인 ${done}/${DESIGNS.length - FREE_DESIGNS.size}개 열림 · 🔒 디자인은 미션을 달성하면 무료로 열려요.`));
    }
    return status;
  }

  const list = el('ol', 'intro-editor-slides');
  const onCount = () => state.slides.filter((slide) => slide.on).length;
  function renderList() {
    list.replaceChildren();
    state.slides.forEach((slide, i) => {
      const li = el('li', `intro-editor-slide${i === current ? ' is-current' : ''}${slide.on ? '' : ' is-off'}`);
      const check = el('input'); check.type = 'checkbox'; check.checked = slide.on;
      check.title = slide.on ? '이 장을 빼요' : '이 장을 넣어요';
      check.setAttribute('aria-label', `${slideLabel(slide)} 장 넣기`);
      check.disabled = !slide.on && onCount() >= MAX_SLIDES;
      check.addEventListener('change', () => { slide.on = check.checked; current = i; refresh(); });
      const pick = el('button', `intro-editor-slide-name${slide.type === 'free' ? ' is-free' : ''}`, slide.type === 'free' ? `✍ ${slideLabel(slide)}` : slideLabel(slide)); pick.type = 'button';
      pick.title = `${slideLabel(slide)} 장을 미리 보고 고쳐요`;
      pick.append(el('span', 'intro-editor-slide-go', '고치기 ›'));
      pick.addEventListener('click', () => { current = i; refresh(); if (window.matchMedia('(max-width: 760px)').matches) previewBox.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
      const up = el('button', 'intro-editor-move', '↑'); up.type = 'button'; up.title = '앞으로'; up.setAttribute('aria-label', `${slideLabel(slide)} 앞으로`);
      const down = el('button', 'intro-editor-move', '↓'); down.type = 'button'; down.title = '뒤로'; down.setAttribute('aria-label', `${slideLabel(slide)} 뒤로`);
      up.disabled = i === 0; down.disabled = i === state.slides.length - 1;
      const move = (d) => { const [s] = state.slides.splice(i, 1); state.slides.splice(i + d, 0, s); current = i + d; refresh(); };
      up.addEventListener('click', () => move(-1)); down.addEventListener('click', () => move(1));
      let tag = null;
      if (slide.type === 'free' && !String(slide.note || '').trim() && !slide.images.length) { tag = el('span', 'intro-editor-slide-tag is-empty', '글 비어 있음'); tag.title = '하고 싶은 말을 적거나 사진을 넣어 주세요'; }
      else if (!slide.hasData) { tag = el('span', 'intro-editor-slide-tag is-empty', '정보 없음'); tag.title = `팬페이지에 ${SOURCE_HINT[slide.type]?.what || '정보'}을 먼저 채우면 이 장을 만들 수 있어요`; }
      else if (slide.items.length) { tag = el('span', 'intro-editor-slide-tag', `항목 ${slide.shown.size}/${slide.items.length}`); tag.title = `팬페이지 항목 ${slide.items.length}개 중 ${slide.shown.size}개를 보여 줘요`; }
      li.append(check, pick, ...(tag ? [tag] : []), up, down);
      list.append(li);
    });
    const freeCount = state.slides.filter((slide) => slide.type === 'free').length;
    addFree.disabled = freeCount >= MAX_FREE || onCount() >= MAX_SLIDES;
    addFree.title = freeCount >= MAX_FREE ? `자유 장은 ${MAX_FREE}장까지 넣을 수 있어요` : onCount() >= MAX_SLIDES ? `장은 최대 ${MAX_SLIDES}장이에요. 다른 장을 빼고 넣어 주세요` : '제목·글·사진을 직접 넣는 장을 추가해요';
  }
  const addFree = el('button', 'button intro-editor-add-free', `＋ 자유 장 추가 (최대 ${MAX_FREE}장)`); addFree.type = 'button';
  addFree.addEventListener('click', () => {
    const at = Math.min(current + 1, state.slides.length);
    state.slides.splice(at, 0, newFreeSlide({ title: '' }));
    current = at; refresh();
  });
  //  자유 장: 제목·부제목·하고 싶은 말(최대 400자)·사진 1장(내 공개 갤러리에서 고르기)·장 지우기.
  const gallery = { items: [], loading: false, error: '', hasMore: false, nextOffset: 0, open: false };
  const uploadState = { busy: false, message: '' };
  function renderFreeDetail(slide) {
    detail.append(textField('제목', 'title', 40), textField('부제목', 'subtitle', 80), textField(`하고 싶은 말 (최대 ${FREE_NOTE_MAX}자)`, 'note', FREE_NOTE_MAX, true),
      el('small', 'intro-editor-help', '✨ **두 별표** 사이 글은 굵게, 줄 앞에 "- "를 쓰면 목록이 돼요.'));
    const photoBox = el('div', 'intro-editor-photo');
    photoBox.append(el('strong', 'intro-editor-label', `사진 (선택, 최대 ${FREE_MAX_IMAGES}장)`));
    if (slide.images.length) {
      const strip = el('div', 'intro-editor-photo-strip');
      slide.images.forEach((img, i) => {
        const cell = el('div', 'intro-editor-photo-cell');
        const thumb = el('img', 'intro-editor-photo-thumb'); thumb.alt = `${i + 1}번째 사진`; thumb.referrerPolicy = 'no-referrer'; thumb.src = img.url;
        const remove = el('button', 'button intro-editor-photo-remove', '빼기'); remove.type = 'button'; remove.title = `${i + 1}번째 사진을 빼요`;
        remove.addEventListener('click', () => { slide.images.splice(i, 1); refresh(); });
        cell.append(thumb, remove); strip.append(cell);
      });
      photoBox.append(strip);
      const layouts = el('div', 'intro-editor-layouts');
      layouts.setAttribute('role', 'radiogroup'); layouts.setAttribute('aria-label', '사진 배치');
      FREE_LAYOUTS.forEach((layout) => {
        const b = el('button', `button intro-editor-layout${slide.layout === layout.id ? ' is-active' : ''}`, layout.label); b.type = 'button';
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(slide.layout === layout.id)); b.title = layout.hint;
        b.addEventListener('click', () => { slide.layout = layout.id; refresh(); });
        layouts.append(b);
      });
      photoBox.append(el('small', 'intro-editor-help', '사진 배치'), layouts);
    }
    const full = slide.images.length >= FREE_MAX_IMAGES;
    const buttons = el('div', 'intro-editor-photo-actions');
    if (deps.loadGallery) {
      const pickPhoto = el('button', 'button', '갤러리에서 고르기'); pickPhoto.type = 'button'; pickPhoto.disabled = full;
      pickPhoto.title = full ? `사진은 ${FREE_MAX_IMAGES}장까지예요` : '내 팬페이지 갤러리에 공개된 사진 중에서 골라요';
      pickPhoto.addEventListener('click', () => { gallery.open = !gallery.open; if (gallery.open && !gallery.items.length) loadGalleryPage(false); else renderDetail(); });
      buttons.append(pickPhoto);
    }
    if (deps.uploadGalleryImage) {
      const file = el('input'); file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp,image/gif'; file.hidden = true;
      const upload = el('button', 'button', uploadState.busy ? '올리는 중…' : '내 컴퓨터에서 올리기'); upload.type = 'button'; upload.disabled = full || uploadState.busy;
      upload.title = '사진을 내 팬페이지 갤러리(공개)에 올리고 이 장에 넣어요';
      upload.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const picked = file.files?.[0]; if (!picked) return;
        uploadState.busy = true; uploadState.message = '갤러리에 올리는 중…'; renderDetail();
        try {
          const image = await deps.uploadGalleryImage(picked, (message) => { uploadState.message = message; if (dialog.open) renderDetail(); });
          if (slide.images.length < FREE_MAX_IMAGES && !slide.images.some((img) => img.id === image.id)) slide.images.push(image);
          gallery.items = [{ id: image.id, thumbUrl: image.url, categoryLabel: '기타' }, ...gallery.items.filter((item) => item.id !== image.id)];
          uploadState.message = '갤러리에 올리고 이 장에 넣었어요.';
        } catch (error) {
          uploadState.message = error?.message || '사진을 올리지 못했어요.';
        } finally { uploadState.busy = false; if (dialog.open) refresh(); }
      });
      buttons.append(upload, file);
    }
    photoBox.append(buttons);
    if (uploadState.message) photoBox.append(el('small', 'intro-editor-help', uploadState.message));
    if (gallery.open && !full) photoBox.append(galleryGrid(slide));
    photoBox.append(el('small', 'intro-editor-help', '사진은 내 팬페이지 갤러리 사진만 써요. 직접 올린 사진도 갤러리에 공개로 올라가고, 슬라이드에는 갤러리 미리보기 크기(긴 변 480px)로 들어가요.'));
    const removeSlide = el('button', 'button intro-editor-remove-free', '이 자유 장 지우기'); removeSlide.type = 'button';
    removeSlide.title = '이 장을 PPT에서 지워요(저장해야 반영돼요)';
    removeSlide.addEventListener('click', () => { state.slides.splice(current, 1); current = Math.max(0, Math.min(current, state.slides.length - 1)); refresh(); });
    detail.append(photoBox, removeSlide);
  }
  function galleryGrid(slide) {
    const wrap = el('div', 'intro-editor-gallery');
    if (gallery.loading && !gallery.items.length) { wrap.append(el('p', 'intro-editor-help', '갤러리를 불러오고 있어요…')); return wrap; }
    if (gallery.error) wrap.append(el('p', 'intro-editor-help is-warning', gallery.error));
    const grid = el('div', 'intro-editor-gallery-grid');
    gallery.items.forEach((item) => {
      const picked = slide.images.some((img) => img.id === item.id);
      const b = el('button', `intro-editor-gallery-item${picked ? ' is-picked' : ''}`); b.type = 'button'; b.setAttribute('aria-pressed', String(picked));
      b.title = `${item.categoryLabel || '사진'} 사진 고르기`; b.setAttribute('aria-label', `${item.categoryLabel || '사진'} 사진 고르기`);
      const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = item.thumbUrl;
      b.append(img);
      b.addEventListener('click', () => {
        const at = slide.images.findIndex((img) => img.id === item.id);
        if (at >= 0) slide.images.splice(at, 1);
        else if (slide.images.length < FREE_MAX_IMAGES) slide.images.push({ id: item.id, url: item.thumbUrl });
        if (slide.images.length >= FREE_MAX_IMAGES) gallery.open = false;
        refresh();
      });
      grid.append(b);
    });
    wrap.append(grid);
    if (gallery.hasMore) {
      const more = el('button', 'button', gallery.loading ? '불러오는 중…' : '사진 더 보기'); more.type = 'button'; more.disabled = gallery.loading;
      more.addEventListener('click', () => loadGalleryPage(true));
      wrap.append(more);
    }
    return wrap;
  }
  async function loadGalleryPage(append) {
    if (gallery.loading) return;
    gallery.loading = true; gallery.error = ''; renderDetail();
    try {
      const result = await deps.loadGallery(append ? gallery.nextOffset : 0);
      const items = Array.isArray(result?.items) ? result.items.filter((item) => item && item.id && item.thumbUrl) : [];
      gallery.items = append ? [...gallery.items, ...items] : items;
      gallery.nextOffset = Number(result?.nextOffset) || gallery.items.length;
      gallery.hasMore = result?.hasMore === true;
      if (!gallery.items.length) gallery.error = result?.linked === false ? '연결된 갤러리를 찾지 못했어요.' : '갤러리에 공개된 사진이 아직 없어요.';
    } catch (error) {
      gallery.error = error?.message || '갤러리를 불러오지 못했어요.';
    } finally { gallery.loading = false; if (dialog.open) renderDetail(); }
  }
  function textField(labelText, key, max, multiline = false) {
    const slide = state.slides[current];
    const label = el('label', 'profile-editor-field', labelText);
    const input = el(multiline ? 'textarea' : 'input');
    if (multiline) input.rows = 3; else input.type = 'text';
    input.maxLength = max; input.value = slide[key] || '';
    if (key === 'note' && slide.placeholder) input.placeholder = slide.placeholder;
    if (key === 'title') input.addEventListener('input', () => renderList());
    input.addEventListener('input', () => { slide[key] = input.value; renderPreview(); });
    label.append(input);
    return label;
  }
  function renderDetail() {
    const slide = state.slides[current];
    detail.replaceChildren(el('strong', 'intro-editor-detail-title', /장$/.test(slideLabel(slide)) ? slideLabel(slide) : `${slideLabel(slide)} 장`));
    if (slide.type === 'free') { renderFreeDetail(slide); return; }
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
    if (slide.type === 'schedule') {
      const stats = airtimeStats(page.vods);
      const age = stats?.refreshedAt ? Math.floor((Date.now() - stats.refreshedAt) / DAY_MS) : null;
      detail.append(el('p', `intro-editor-help${stats && (age >= 3 || !stats.complete) ? ' is-warning' : ''}`, !stats
        ? '최근 30일 방송 시간은 팬페이지 다시보기 목록으로 계산해요. 다시보기 목록을 갱신하면 항목이 생겨요.'
        : `최근 30일 방송 시간은 SOOP 다시보기 길이를 더한 값이에요(지우거나 저장 안 한 방송은 빠져요).${age >= 3 ? ` 다시보기 목록을 ${age}일 전에 갱신했어요. 최신으로 하려면 다시보기 칸에서 목록을 갱신해 주세요.` : ''}${stats.complete ? '' : ' 다시보기를 다 불러오지 못해 "약"으로 표시했어요.'} 저장할 때 값이 고정돼요.`));
    }
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
    renderDesigns();
    renderList(); renderDetail(); renderPreview();
    countNote.textContent = `${onCount()}장 / 최대 ${MAX_SLIDES}장`;
  }

  const countNote = el('span', 'intro-editor-count');
  side.append(el('strong', 'intro-editor-label', '디자인'), designRow, designNote, el('strong', 'intro-editor-label', '넣을 장과 순서'), el('small', 'intro-editor-guide', '☑ 체크로 넣고 빼요 · 이름을 누르면 미리보기와 글 고치기가 열려요 · ↑↓로 순서'), list, addFree, countNote);
  const main = el('div', 'intro-editor-main');
  main.append(previewBox, detail);
  body.append(side, main);

  const status = el('p', 'intro-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const footer = el('div', 'profile-editor-footer intro-editor-footer');
  const hint = el('small', '', interview ? '면접용 PPT는 언제나 나만 볼 수 있어요. 면접에서는 "전체화면 발표"로 화면 공유해 주세요. 팬용 PPT와는 따로 저장돼요.'
    : state.public ? '지금 팬에게 공개 중이에요. 저장하면 팬 화면도 바로 바뀌어요.' : '"나만 보기"는 나에게만 보여요. 팬에게 보여 주려면 "저장하고 팬에게 공개"를 눌러 주세요.');
  const actions = el('div', 'profile-editor-footer-actions');
  const cancel = el('button', 'button', '취소'); cancel.type = 'button'; cancel.title = '저장하지 않고 닫아요';
  cancel.addEventListener('click', () => dialog.close());
  const privateSave = el('button', 'button', state.public ? '공개 끄고 저장' : '나만 보기로 저장'); privateSave.type = 'submit'; privateSave.value = 'private';
  privateSave.title = state.public ? '팬에게서 PPT 탭을 숨기고 저장해요' : '팬에게는 보이지 않게 저장해요. 나중에 공개할 수 있어요';
  const save = el('button', 'button button-primary', state.public ? '저장 (공개 유지)' : '저장하고 팬에게 공개'); save.type = 'submit'; save.value = 'public';
  save.title = '저장하고 팬페이지에 PPT 탭을 보여 줘요';
  const saveLabels = new Map([[privateSave, privateSave.textContent], [save, save.textContent]]);
  if (interview) { privateSave.hidden = true; save.textContent = '저장 (나만 보기)'; save.title = '면접용 PPT를 저장해요. 팬에게는 보이지 않아요'; saveLabels.set(save, save.textContent); }
  actions.append(cancel, privateSave, save); footer.append(hint, actions);
  form.append(head, body, status, footer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const clicked = event.submitter === privateSave ? privateSave : save;
    state.public = !interview && clicked === save;
    const emptyFree = state.slides.find((slide) => slide.on && slide.type === 'free' && !String(slide.title || '').trim() && !String(slide.subtitle || '').trim() && !String(slide.note || '').trim() && !slide.images.length);
    if (emptyFree) { current = state.slides.indexOf(emptyFree); refresh(); status.textContent = '비어 있는 자유 장이 있어요. 글이나 사진을 넣거나 지워 주세요.'; status.classList.add('is-error'); return; }
    const next = deckFromEditor(state);
    status.textContent = ''; status.classList.remove('is-error');
    if (!next.slides.length) { status.textContent = '넣을 장을 하나 이상 골라 주세요.'; status.classList.add('is-error'); return; }
    if (renderDesigns() === 'locked') { status.textContent = '고른 디자인이 아직 잠겨 있어요. 미션을 달성하거나 다른 디자인을 골라 주세요.'; status.classList.add('is-error'); return; }
    save.disabled = true; privateSave.disabled = true; clicked.textContent = '저장 중…'; clicked.setAttribute('aria-busy', 'true');
    try {
      const result = await deps.call({ action: 'save', streamerId: page.streamer.id, variant, deck: next });
      dialog.close();
      const opened = (result.data.deck?.unlocked || []).filter((d) => !unlocked.has(d));
      onSaved(result.data.deck);
      if (opened.length) setTimeout(() => deps.toast(`🎉 새 디자인이 열렸어요: ${opened.map((d) => DESIGNS.find((x) => x.id === d)?.label || d).join(', ')}`), 1800);
      deps.toast(interview ? '면접용 PPT를 저장했어요. 나만 볼 수 있어요.' : next.public ? 'PPT를 저장하고 팬에게 공개했어요.' : 'PPT를 저장했어요. "나만 보기"라 팬에게는 아직 보이지 않아요.');
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
  if (!entry) { entry = { loaded: false, loading: false, deck: null, interviewDeck: null, variant: 'fan', error: '', waiters: new Set() }; decks.set(id, entry); }
  if (!canEdit) entry.variant = 'fan';
  const currentDeck = () => (entry.variant === 'interview' ? entry.interviewDeck : entry.deck);
  const unlockedOf = (deck) => (Array.isArray(deck?.unlocked) ? deck.unlocked : []);

  const draw = () => {
    const head = el('div', 'intro-deck-head');
    const copy = el('div');
    copy.append(el('p', 'eyebrow', 'PRESENTATION'), el('h2', '', 'PPT'));
    head.append(copy);
    const tools = el('div', 'intro-deck-tools');
    const interview = entry.variant === 'interview';
    const deckNow = currentDeck();
    if (canEdit && entry.loaded) {
      if (deckNow) {
        const isPublic = !interview && deckNow.public;
        const badge = el('span', `intro-deck-public-badge${isPublic ? ' is-public' : ''}`, isPublic ? '팬에게 공개 중' : '나만 보기');
        badge.title = interview ? '면접용 PPT는 나만 볼 수 있어요' : isPublic ? '팬도 PPT 탭에서 볼 수 있어요' : '아직 팬에게는 PPT 탭이 보이지 않아요';
        tools.append(badge);
      }
      const edit = el('button', 'button button-primary intro-deck-edit', `${interview ? '면접용 ' : ''}${deckNow ? 'PPT 고치기' : 'PPT 만들기'}`); edit.type = 'button';
      edit.title = interview ? '지원 동기·목표 장이 들어간 면접용 틀로 슬라이드를 고르고 고쳐요' : '팬페이지 정보로 슬라이드를 고르고 고쳐요';
      edit.addEventListener('click', async () => {
        const variant = entry.variant;
        //  방송 시간 통계용: 다시보기가 최근 30일을 다 덮지 못하면 몇 쪽 더 받아 온다(편집 창을 열 때만).
        if (deps.ensureRecentVods && !edit.disabled) {
          edit.disabled = true; const label = edit.textContent; edit.textContent = '불러오는 중…';
          try { await deps.ensureRecentVods(page, Date.now() - 30 * DAY_MS); } catch { /* 통계만 빠지고 편집은 연다 */ }
          edit.disabled = false; edit.textContent = label;
        }
        const other = variant === 'interview' ? entry.deck : entry.interviewDeck;
        openEditor(page, deps, currentDeck(), (deck) => {
          if (variant === 'interview') entry.interviewDeck = deck;
          else { entry.deck = deck; deps.onPublicChange(deck.public === true); }
          section.replaceChildren(); draw();
        }, variant, unlockedOf(other));
      });
      tools.append(edit);
    }
    head.append(tools);
    section.replaceChildren(head);
    if (canEdit && entry.loaded) {
      //  팬용·면접용 전환(스트리머 본인만). 팬은 팬용 공개본만 본다.
      const switcher = el('div', 'intro-deck-variants');
      switcher.setAttribute('role', 'tablist'); switcher.setAttribute('aria-label', 'PPT 종류');
      ['fan', 'interview'].forEach((variant) => {
        const b = el('button', `intro-deck-variant${entry.variant === variant ? ' is-active' : ''}`, `${VARIANT_LABEL[variant]} PPT`); b.type = 'button';
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(entry.variant === variant));
        b.title = variant === 'interview' ? '크루·동아리 면접에서 화면 공유로 쓰는 PPT예요. 나만 볼 수 있어요' : '팬에게 공개할 수 있는 소개 PPT예요';
        b.addEventListener('click', () => { if (entry.variant === variant) return; entry.variant = variant; section.replaceChildren(); draw(); });
        switcher.append(b);
      });
      section.append(switcher);
    }
    if (!entry.loaded) {
      section.append(el('div', 'loading-card loading-bar intro-deck-loading', entry.error || 'PPT를 불러오고 있어요…'));
      return;
    }
    if (deckNow && deckNow.slides?.length) {
      if (canEdit && interview) section.append(el('p', 'intro-deck-notice', '🔒 면접용 PPT는 나만 볼 수 있어요. 면접에서는 "⛶ 전체화면 발표"를 눌러 화면 공유해 주세요.'));
      else if (canEdit && !deckNow.public) section.append(el('p', 'intro-deck-notice', '🔒 "나만 보기"로 저장돼 있어요. 팬에게 보여 주려면 "PPT 고치기" › "저장하고 팬에게 공개"를 눌러 주세요.'));
      if (canEdit && deckIsStale(page, deps.playedGames(page), deckNow)) {
        const stale = el('div', 'intro-deck-notice is-stale');
        stale.append(el('span', '', '✏️ 저장한 뒤 팬페이지 정보가 바뀌었어요. 슬라이드는 저장할 때 내용 그대로라, 다시 저장해야 새 정보가 들어가요.'));
        const again = el('button', 'button', '새 정보로 고치기'); again.type = 'button';
        again.title = '편집 창을 열어 새 정보를 확인하고 저장해요';
        again.addEventListener('click', () => section.querySelector('.intro-deck-edit')?.click());
        stale.append(again);
        section.append(stale);
      }
      section.append(createViewer(deckNow, page), renderTextList(deckNow));
      return;
    }
    if (canEdit) {
      const state = editorStateFrom(page, deps.playedGames(page), null, entry.variant);
      //  견본에는 글이 빈 자유 장을 넣지 않는다(편집 창에서 채우면 들어간다).
      const sample = deckFromEditor({ ...state, slides: state.slides.filter((slide) => slide.type !== 'free') });
      const missing = state.slides.filter((slide) => slide.type !== 'free' && !slide.hasData).map((slide) => TYPE_INFO[slide.type].label);
      section.append(el('p', 'intro-deck-empty', interview
        ? '아직 면접용 PPT가 없어요. "면접용 PPT 만들기"를 누르면 지원 동기·하고 싶은 것 장이 들어간 면접용 틀이 열려요. 팬 애칭·팬덤 같은 팬 전용 항목은 빠져 있어요. 아래는 팬페이지 정보로 만든 견본이에요.'
        : '아직 만든 PPT가 없어요. 아래는 팬페이지에 적어 둔 정보로 자동으로 만든 견본이에요. "PPT 만들기"를 눌러 장을 고르고 저장하면 팬에게 보여 줄 수 있어요.'));
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
      ? deps.call({ action: 'get', streamerId: id }).then((result) => { entry.interviewDeck = result.data.interviewDeck || null; return result.data.deck || null; })
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
