import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:b58db2970489bf18a3a769',
};
const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider('6Ld0AfAtAAAAABcCio4_5AoiCdrjfM7_4riWiYXR'),
  isTokenAutoRefreshEnabled: true,
});
const auth = getAuth(app);
const database = getDatabase(app);
const functions = getFunctions(app, 'us-central1');
const callViewerStats = httpsCallable(functions, 'streamerFanPageViewerStats');
const callViewerSubscription = httpsCallable(functions, 'streamerFanPageViewerSubscription');
const $ = (id) => document.getElementById(id);

function setupDevbarMarquee() {
  const viewport = $('devbar-viewport');
  const track = $('devbar-track');
  if (!viewport || !track) return;

  function setup() {
    track.classList.remove('auto-scroll');
    track.querySelectorAll('[data-clone]').forEach((element) => element.remove());
    track.style.removeProperty('--viewer-devbar-duration');
    if (track.scrollWidth <= viewport.clientWidth + 4) return;

    const originalWidth = track.scrollWidth;
    Array.from(track.children).forEach((element) => {
      const clone = element.cloneNode(true);
      clone.setAttribute('data-clone', '');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('tabindex', '-1');
      clone.querySelectorAll('a, button').forEach((child) => child.setAttribute('tabindex', '-1'));
      track.appendChild(clone);
    });
    track.style.setProperty('--viewer-devbar-duration', Math.max(originalWidth / 40, 8) + 's');
    track.classList.add('auto-scroll');
  }

  setup();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(setup, 200);
  });
}

async function loadDevbarLinks() {
  const selfGameId = 'streamerFanPage';
  try {
    const snapshot = await get(ref(database, 'devbarLinks'));
    const data = snapshot.val();
    if (!data) return;
    const links = Object.keys(data)
      .filter((id) => id !== selfGameId && data[id] && data[id].url)
      .map((id) => ({ id, ...data[id] }))
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    if (!links.length) return;

    const nav = $('devbar-track');
    if (!nav) return;
    nav.querySelectorAll('a[data-game-id]').forEach((link) => link.remove());
    links.forEach((item) => {
      let url;
      try { url = new URL(item.url, location.href); } catch (_) { return; }
      if (url.protocol !== 'https:') return;
      const link = document.createElement('a');
      link.className = 'dev-game-link';
      link.dataset.gameId = item.id;
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.label || item.name || item.id;
      nav.appendChild(link);
    });
    window.dispatchEvent(new Event('resize'));
  } catch (error) {
    console.error('자매 서비스 링크를 불러오지 못했습니다. 기본 링크를 유지합니다.', error);
  }
}

const MAX_CONCURRENT_STATS_REQUESTS = 3;
const MAX_PERIOD_SCAN_PAGES = 200;
const MAX_BROWSER_STATS_CACHE_ITEMS = 800;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const VIEWER_PEAK_PERIODS = [
  { days: 7, label: '최근 7일' },
  { days: 30, label: '최근 30일' },
  { days: 90, label: '최근 90일' },
  { days: 365, label: '최근 1년' },
];

let searchRequestId = 0;
let activeLoadToken = 0;
let selectedStreamer = null;
let authReady = null;
let nextPage = 1;
let hasMoreVods = false;
let vodTotal = 0;
let activeStatsRequests = 0;
let statsQueue = [];
let statsObserver = null;
let periodScanToken = 0;
let vodPagesByNumber = new Map();
let subscriptionRefreshToken = 0;
let subscriptionRefreshTimer = 0;
let subscriptionState = {
  loaded: false,
  accountProtected: false,
  isAdmin: false,
  subscribed: false,
  expiresAt: 0,
  pending: false,
  pendingRequestId: '',
  lastRequestStatus: '',
};
const viewerStatsMemoryCache = new Map();
const viewerStatsInProgress = new Map();

function waitForAuthRestore() {
  return new Promise((resolve) => {
    let unsubscribe = null;
    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (unsubscribe) unsubscribe();
      resolve(user || null);
    }, () => resolve(null));
  });
}

async function ensureAuth() {
  const restoredUser = await waitForAuthRestore();
  if (restoredUser) return restoredUser;
  return (await signInAnonymously(auth)).user;
}

function getAuthReady() {
  if (!authReady) {
    authReady = ensureAuth().catch((error) => {
      authReady = null;
      throw error;
    });
  }
  return authReady;
}

function parseSoopId(value) {
  const input = String(value || '').trim();
  if (SOOP_ID_PATTERN.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    if (!['sooplive.com', 'www.sooplive.com', 'play.sooplive.com', 'live.sooplive.com'].includes(hostname)) return '';
    const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    const stationIndex = segments.findIndex((segment) => segment.toLowerCase() === 'station');
    const candidate = stationIndex >= 0 ? segments[stationIndex + 1] : hostname === 'play.sooplive.com' ? segments[0] : '';
    return SOOP_ID_PATTERN.test(candidate || '') ? candidate.toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

function streamerForId(soopId) {
  return {
    id: soopId,
    nickname: soopId,
    soopId,
    avatarUrl: 'https://stimg.sooplive.com/LOGO/' + soopId.slice(0, 2) + '/' + soopId + '/' + soopId + '.jpg',
    soopUrl: 'https://www.sooplive.com/station/' + encodeURIComponent(soopId),
  };
}

function formatClock(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatRetryDuration(value) {
  let seconds = Math.max(1, Math.ceil(Number(value) || 0));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  if (days) return [days + '일', hours ? hours + '시간' : '', minutes ? minutes + '분' : ''].filter(Boolean).join(' ');
  if (hours) return [hours + '시간', minutes ? minutes + '분' : ''].filter(Boolean).join(' ');
  if (minutes) return [minutes + '분', seconds ? seconds + '초' : ''].filter(Boolean).join(' ');
  return seconds + '초';
}

function waitMilliseconds(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function viewerStatsErrorMessage(error, fallback) {
  const message = error && error.message ? error.message : fallback;
  const retryAfterSeconds = Number(error && error.details && error.details.retryAfterSeconds);
  if (error && error.code === 'functions/resource-exhausted'
    && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return message + ' 다시 시도할 수 있을 때까지 약 ' + formatRetryDuration(retryAfterSeconds) + ' 남았어요.';
  }
  return message;
}

function formatSubscriptionDate(value) {
  const timestamp = Number(value) || 0;
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(timestamp));
}

function renderSubscriptionControls() {
  const state = subscriptionState;
  const status = $('viewerSubscriptionStatus');
  const action = $('viewerSubscriptionAction');
  const scan = $('viewerPeriodScanButton');
  if (!state.loaded) {
    status.textContent = '구독 상태를 확인하고 있어요.';
    action.textContent = '구독 상태 확인 중…';
    action.disabled = true;
    scan.textContent = '구독 전용 분석';
    return;
  }
  action.disabled = false;
  if (state.isAdmin) {
    status.textContent = '관리자 권한 · 구독 여부와 관계없이 모든 분석 기능을 이용할 수 있어요.';
    action.textContent = '관리자 전체 권한';
    action.disabled = true;
    scan.textContent = '최근 1년 분석';
  } else if (state.subscribed) {
    status.textContent = '구독 중 · ' + formatSubscriptionDate(state.expiresAt) + '까지 이용할 수 있어요.'
      + (state.pending ? ' 갱신 신청도 확인 중입니다.' : '');
    action.textContent = state.pending ? '신청 상태 보기' : '구독 연장하기';
    scan.textContent = '최근 1년 분석';
  } else if (state.pending) {
    status.textContent = '별풍선 후원 신청을 운영자가 확인하고 있어요.';
    action.textContent = '신청 상태 보기';
    scan.textContent = '구독 전용 분석';
  } else if (!state.accountProtected) {
    status.textContent = '구독 신청은 Google·Kakao 계정 연결 또는 스트리머 인증이 필요해요.';
    action.textContent = '로그인하고 구독하기';
    scan.textContent = '구독 전용 분석';
  } else if (state.lastRequestStatus === 'rejected') {
    status.textContent = '최근 구독 신청이 승인되지 않았어요. 후원자 닉네임을 확인한 뒤 다시 신청할 수 있어요.';
    action.textContent = '다시 구독 신청하기';
    scan.textContent = '구독 전용 분석';
  } else {
    status.textContent = '무료 기능을 이용 중이에요. 구독하면 기간별 최고 순간과 평균 대비 상승폭을 볼 수 있어요.';
    action.textContent = '별풍선 10개로 구독';
    scan.textContent = '구독 전용 분석';
  }
}

function refreshExistingVodCardAccess() {
  const cards = $('viewerVodGrid').querySelectorAll('.viewer-vod-card');
  cards.forEach((card) => {
    if (card.dataset.statsState !== 'ready' && card.dataset.statsState !== 'error') return;
    card.dataset.statsState = 'idle';
    enqueueStats(card, card._vod, card._loadToken);
  });
}

function scheduleSubscriptionStatusRefresh() {
  window.clearTimeout(subscriptionRefreshTimer);
  if (subscriptionState.pending) {
    subscriptionRefreshTimer = window.setTimeout(() => refreshSubscriptionStatus(), 60 * 1000);
    return;
  }
  if (subscriptionState.isAdmin) {
    subscriptionRefreshTimer = window.setTimeout(() => refreshSubscriptionStatus(), 6 * 60 * 60 * 1000);
    return;
  }
  if (!subscriptionState.subscribed || !subscriptionState.expiresAt) return;
  const untilExpiry = Math.max(1000, subscriptionState.expiresAt - Date.now() + 1000);
  subscriptionRefreshTimer = window.setTimeout(
    () => refreshSubscriptionStatus(),
    Math.min(untilExpiry, 6 * 60 * 60 * 1000),
  );
}

async function refreshSubscriptionStatus() {
  const token = ++subscriptionRefreshToken;
  try {
    await getAuthReady();
    const response = await callViewerSubscription({ action: 'status' });
    if (token !== subscriptionRefreshToken) return;
    const previousAccess = subscriptionState.subscribed;
    const data = response.data || {};
    subscriptionState = {
      loaded: true,
      accountProtected: data.accountProtected === true,
      isAdmin: data.isAdmin === true,
      subscribed: data.subscribed === true,
      expiresAt: Number(data.expiresAt) || 0,
      pending: data.pending === true,
      pendingRequestId: typeof data.pendingRequestId === 'string' ? data.pendingRequestId : '',
      lastRequestStatus: typeof data.lastRequestStatus === 'string' ? data.lastRequestStatus : '',
    };
    renderSubscriptionControls();
    scheduleSubscriptionStatusRefresh();
    if (previousAccess !== subscriptionState.subscribed) {
      refreshExistingVodCardAccess();
      if (selectedStreamer) {
        periodScanToken += 1;
        $('viewerPeriodScanButton').disabled = false;
        $('viewerPeriodStatus').textContent = subscriptionState.subscribed
          ? '구독이 확인됐어요. 최근 1년 분석을 시작하면 7일·30일·90일·1년 최고 순간을 찾습니다.'
          : '구독이 만료됐어요. 기간별 최고 시청 순간은 구독 계정에서 이용할 수 있습니다.';
        renderPeriodPeakCards(new Map(), new Map(), false, !subscriptionState.subscribed);
      }
    }
    if ($('viewerSubscriptionDialog').open) renderSubscriptionDialogStatus();
  } catch (error) {
    if (token !== subscriptionRefreshToken) return;
    $('viewerSubscriptionStatus').textContent = viewerStatsErrorMessage(error, '구독 상태를 확인하지 못했어요.');
    $('viewerSubscriptionAction').disabled = false;
    $('viewerSubscriptionAction').textContent = '구독 상태 다시 확인';
  }
}

function renderSubscriptionDialogStatus(message = '') {
  const status = $('viewerSubscriptionDialogStatus');
  const submit = $('viewerSubscriptionSubmit');
  const cancel = $('viewerSubscriptionCancel');
  const loginNote = $('viewerSubscriptionLoginNote');
  const purchaseInfo = $('viewerSubscriptionPurchaseInfo');
  const hasPending = subscriptionState.pending && subscriptionState.pendingRequestId;
  purchaseInfo.classList.toggle('hidden', subscriptionState.isAdmin);
  loginNote.classList.toggle('hidden', subscriptionState.accountProtected);
  submit.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !!hasPending);
  cancel.classList.toggle('hidden', subscriptionState.isAdmin || !hasPending);
  submit.textContent = subscriptionState.subscribed ? '후원 후 30일 연장 신청' : '후원 신청하기';
  if (subscriptionState.isAdmin) {
    status.textContent = '관리자 권한으로 기간별 최고 순간과 평균 대비 상승폭을 포함한 모든 구독 기능을 이용할 수 있어요.';
  } else if (message) {
    status.textContent = message;
  } else if (!subscriptionState.accountProtected) {
    status.textContent = '익명 계정은 구독 권한을 구매할 수 없어요. Google·Kakao 계정 연결 또는 스트리머 인증 후 이용해 주세요.';
  } else if (hasPending) {
    status.textContent = '신청이 접수되어 운영자가 후원을 확인하고 있어요. 확인이 끝나면 이 계정에 30일 이용권이 적용됩니다.';
  } else if (subscriptionState.subscribed) {
    status.textContent = formatSubscriptionDate(subscriptionState.expiresAt) + '까지 구독 중이에요. 미리 갱신해도 남은 기간에 30일이 더해집니다.';
  } else {
    status.textContent = '후원자 닉네임을 확인해 운영자가 수동 승인합니다. 승인 전까지 구독 기능은 잠겨 있어요.';
  }
}

function openSubscriptionDialog() {
  renderSubscriptionDialogStatus();
  const dialog = $('viewerSubscriptionDialog');
  if (!dialog.open) dialog.showModal();
}

function formatVodDate(value) {
  const date = String(value || '').trim().slice(0, 10);
  return date ? date.replaceAll('-', '.') : '날짜 정보 없음';
}

function parseVodTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(' ', 'T');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const timestamp = Date.parse(hasTimezone ? normalized : normalized + '+09:00');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatVodDuration(durationMs) {
  const seconds = Math.floor(Math.max(0, Number(durationMs) || 0) / 1000);
  return seconds ? formatClock(seconds) : '';
}

function playbackUrl(vodId, second) {
  const url = new URL('https://vod.sooplive.com/player/' + encodeURIComponent(String(vodId)));
  if (second !== null && second !== undefined && Number.isFinite(Number(second))) {
    url.searchParams.set('change_second', String(Math.max(0, Math.floor(Number(second)))));
  }
  return url.href;
}

function safeStationUrl(streamer) {
  try {
    const url = new URL(streamer.soopUrl || 'https://www.sooplive.com/station/' + encodeURIComponent(streamer.soopId));
    return url.protocol === 'https:' && url.hostname === 'www.sooplive.com' ? url.href : 'https://www.sooplive.com/station/' + encodeURIComponent(streamer.soopId);
  } catch (_) {
    return 'https://www.sooplive.com/station/' + encodeURIComponent(streamer.soopId);
  }
}

function setSearchHint(message, isError = false) {
  const hint = $('viewerSearchHint');
  hint.textContent = message;
  hint.classList.toggle('is-error', isError);
}

function renderSearchResults(streamers) {
  const results = $('viewerSearchResults');
  results.replaceChildren();
  streamers.forEach((streamer, index) => {
    const button = document.createElement('button');
    button.className = 'viewer-search-result';
    button.type = 'button';
    button.dataset.streamerIndex = String(index);
    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.src = streamer.avatarUrl || '';
    avatar.addEventListener('error', () => { avatar.hidden = true; }, { once: true });
    const copy = document.createElement('span');
    copy.className = 'viewer-search-result-copy';
    const name = document.createElement('strong');
    name.textContent = streamer.nickname || streamer.soopId;
    const id = document.createElement('span');
    id.textContent = 'SOOP ID · ' + streamer.soopId;
    const arrow = document.createElement('span');
    arrow.className = 'viewer-search-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    copy.append(name, id);
    button.append(avatar, copy, arrow);
    results.append(button);
  });
  results.dataset.count = String(streamers.length);
  results._streamers = streamers;
}

function createVodCard(vod, loadToken) {
  const card = document.createElement('article');
  card.className = 'viewer-vod-card';
  card.dataset.vodId = String(vod.id);
  card.dataset.statsState = 'idle';
  const open = document.createElement('a');
  open.className = 'viewer-vod-open';
  open.href = playbackUrl(vod.id, null);
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.setAttribute('aria-label', (vod.title || '다시보기') + ' 재생');
  open.setAttribute('aria-disabled', 'true');
  open.tabIndex = -1;
  open.addEventListener('click', (event) => {
    if (card.dataset.statsState !== 'ready' && card.dataset.statsState !== 'error') event.preventDefault();
  });

  const thumbnail = document.createElement('span');
  thumbnail.className = 'viewer-vod-thumb' + (vod.thumbnailUrl ? '' : ' is-missing');
  if (vod.thumbnailUrl) {
    const image = document.createElement('img');
    image.src = vod.thumbnailUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.remove();
      thumbnail.classList.add('is-missing');
    }, { once: true });
    thumbnail.append(image);
  }
  const duration = formatVodDuration(vod.durationMs);
  if (duration) {
    const durationBadge = document.createElement('span');
    durationBadge.className = 'viewer-vod-duration';
    durationBadge.textContent = duration;
    thumbnail.append(durationBadge);
  }
  const copy = document.createElement('span');
  copy.className = 'viewer-vod-copy';
  const title = document.createElement('strong');
  title.className = 'viewer-vod-title';
  title.textContent = vod.title || '제목 없음';
  const meta = document.createElement('span');
  meta.className = 'viewer-vod-meta';
  const date = document.createElement('span');
  date.textContent = formatVodDate(vod.regDate);
  const views = document.createElement('span');
  views.textContent = '조회 ' + Math.max(0, Number(vod.readCount) || 0).toLocaleString('ko-KR');
  meta.append(date, views);
  copy.append(title, meta);
  open.append(thumbnail, copy);

  const mainAction = document.createElement('a');
  mainAction.className = 'viewer-vod-main-action';
  mainAction.href = playbackUrl(vod.id, null);
  mainAction.target = '_blank';
  mainAction.rel = 'noopener noreferrer';
  mainAction.textContent = '시청자 통계 계산 중…';
  mainAction.setAttribute('aria-disabled', 'true');
  mainAction.tabIndex = -1;
  mainAction.addEventListener('click', (event) => {
    if (card.dataset.statsState !== 'ready' && card.dataset.statsState !== 'error') event.preventDefault();
  });
  const statsActions = document.createElement('div');
  statsActions.className = 'viewer-stat-actions';
  const loading = document.createElement('span');
  loading.className = 'viewer-stat-state';
  loading.textContent = '그래프를 불러오고 있어요.';
  statsActions.append(loading);
  card.append(open, mainAction, statsActions);
  card._vod = vod;
  card._loadToken = loadToken;
  card._openLink = open;
  card._mainAction = mainAction;
  card._statsActions = statsActions;
  return card;
}

function showStatsLinks(card, stats) {
  const highestUrl = playbackUrl(card._vod.id, stats.highest.second);
  const lowestUrl = playbackUrl(card._vod.id, stats.lowest.second);
  card._openLink.href = highestUrl;
  card._openLink.setAttribute('aria-label', (card._vod.title || '다시보기') + ' 최고 시청 순간 재생');
  card._openLink.removeAttribute('aria-disabled');
  card._openLink.tabIndex = 0;
  card._mainAction.href = highestUrl;
  card._mainAction.textContent = '최고 시청 순간 보기 · ' + formatClock(stats.highest.second) + ' ↗';
  card._mainAction.removeAttribute('aria-disabled');
  card._mainAction.tabIndex = 0;
  card._statsActions.replaceChildren();
  const highest = document.createElement('a');
  highest.className = 'viewer-stat-link';
  highest.href = highestUrl;
  highest.target = '_blank';
  highest.rel = 'noopener noreferrer';
  highest.textContent = '최고 ' + Number(stats.highest.viewers).toLocaleString('ko-KR') + '명 · ' + formatClock(stats.highest.second);
  const lowest = document.createElement('a');
  lowest.className = 'viewer-stat-link';
  lowest.href = lowestUrl;
  lowest.target = '_blank';
  lowest.rel = 'noopener noreferrer';
  lowest.textContent = '최저 ' + Number(stats.lowest.viewers).toLocaleString('ko-KR') + '명 · ' + formatClock(stats.lowest.second);
  card._statsActions.append(highest, lowest);
  const uplift = document.createElement('div');
  uplift.className = 'viewer-premium-uplift';
  if (subscriptionState.subscribed && Number.isFinite(Number(stats.averageViewers))) {
    const average = Math.max(0, Number(stats.averageViewers));
    const increase = Math.max(0, Number(stats.highest.viewers) - average);
    const rate = average > 0 ? Math.round((increase / average) * 100) : null;
    const viewersMetric = document.createElement('span');
    const viewersLabel = document.createElement('small');
    viewersLabel.textContent = '평균 대비 순증';
    const viewersValue = document.createElement('strong');
    viewersValue.textContent = '+' + Math.round(increase).toLocaleString('ko-KR') + '명';
    viewersMetric.append(viewersLabel, viewersValue);
    const rateMetric = document.createElement('span');
    const rateLabel = document.createElement('small');
    rateLabel.textContent = '평균 대비 상승률';
    const rateValue = document.createElement('strong');
    rateValue.textContent = rate === null ? '계산 불가' : '+' + rate.toLocaleString('ko-KR') + '%';
    rateMetric.append(rateLabel, rateValue);
    const baseline = document.createElement('small');
    baseline.className = 'viewer-premium-baseline';
    baseline.textContent = '방송 중간 구간 평균 ' + average.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '명 기준';
    uplift.append(viewersMetric, rateMetric, baseline);
  } else {
    const locked = document.createElement('button');
    locked.type = 'button';
    locked.className = 'viewer-premium-locked';
    locked.textContent = '구독 전용 · 평균 대비 상승폭 2종 보기';
    locked.addEventListener('click', openSubscriptionDialog);
    uplift.append(locked);
  }
  card._statsActions.append(uplift);
  card.dataset.statsState = 'ready';
}

function showQueueWaitMessage(card, loadToken) {
  if (!card.isConnected || loadToken !== activeLoadToken) return;
  card._mainAction.textContent = '집계 대기 중…';
  card._statsActions.replaceChildren();
  const status = document.createElement('span');
  status.className = 'viewer-stat-state';
  status.setAttribute('role', 'status');
  status.textContent = '현재 이용자가 많아 집계 시간이 길어지고 있습니다. 잠시만 기다려 주세요.';
  card._statsActions.append(status);
}

async function waitForViewerStatsJob(jobId, job) {
  const startedAt = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let delay = 600;
  let waitMessageShown = false;
  while (Date.now() - startedAt < timeoutMs) {
    if (!job.shouldStart()) {
      callViewerStats({ action: 'cancelStatsJob', jobId }).catch(() => {});
      const error = new Error('분석 대상이 변경되었습니다.');
      error.code = 'viewer-stats/cancelled';
      throw error;
    }
    if (!waitMessageShown && Date.now() - startedAt >= 1500) {
      waitMessageShown = true;
      if (typeof job.onWaiting === 'function') job.onWaiting();
    }
    await waitMilliseconds(delay);
    if (!job.shouldStart()) {
      callViewerStats({ action: 'cancelStatsJob', jobId }).catch(() => {});
      const error = new Error('분석 대상이 변경되었습니다.');
      error.code = 'viewer-stats/cancelled';
      throw error;
    }
    const result = await callViewerStats({ action: 'statsResult', jobId });
    const data = result.data || {};
    if (data.status === 'completed') {
      if (!data.stats || !data.stats.highest || !data.stats.lowest) {
        throw new Error('시청자 그래프 응답을 확인하지 못했어요.');
      }
      return data.stats;
    }
    if (data.status === 'failed' || data.status === 'expired') {
      const error = new Error(data.errorMessage || '시청자 그래프를 계산하지 못했어요. 다시 시도해 주세요.');
      error.code = 'functions/unavailable';
      throw error;
    }
    if (data.status === 'cancelled') {
      const error = new Error('분석 대상이 변경되었습니다.');
      error.code = 'viewer-stats/cancelled';
      throw error;
    }
    delay = Math.min(8000, Math.ceil(delay * 1.7));
  }
  callViewerStats({ action: 'cancelStatsJob', jobId }).catch(() => {});
  const error = new Error('집계가 지연되고 있어요. 잠시 후 다시 시도해 주세요.');
  error.code = 'functions/deadline-exceeded';
  throw error;
}

function showStatsError(card, error, loadToken) {
  if (!card.isConnected || loadToken !== activeLoadToken) return;
  card.dataset.statsState = 'error';
  card._mainAction.href = playbackUrl(card._vod.id, null);
  card._mainAction.textContent = 'SOOP에서 다시보기 열기 ↗';
  card._openLink.removeAttribute('aria-disabled');
  card._openLink.tabIndex = 0;
  card._mainAction.removeAttribute('aria-disabled');
  card._mainAction.tabIndex = 0;
  card._statsActions.replaceChildren();
  const message = document.createElement('span');
  message.className = 'viewer-stat-state';
  message.textContent = viewerStatsErrorMessage(error, '유저 수 그래프를 불러오지 못했어요.');
  card._statsActions.append(message);
  const retryableCodes = new Set(['functions/failed-precondition', 'functions/not-found']);
  if (!retryableCodes.has(error && error.code)) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'viewer-stat-retry';
    retry.textContent = '다시 시도';
    retry.addEventListener('click', () => {
      card.dataset.statsState = 'idle';
      card._openLink.setAttribute('aria-disabled', 'true');
      card._openLink.tabIndex = -1;
      card._mainAction.setAttribute('aria-disabled', 'true');
      card._mainAction.tabIndex = -1;
      card._statsActions.replaceChildren();
      const loading = document.createElement('span');
      loading.className = 'viewer-stat-state';
      loading.textContent = '그래프를 다시 불러오고 있어요.';
      card._statsActions.append(loading);
      enqueueStats(card, card._vod, loadToken);
    }, { once: true });
    card._statsActions.append(retry);
  }
}

function pumpStatsQueue() {
  while (activeStatsRequests < MAX_CONCURRENT_STATS_REQUESTS && statsQueue.length) {
    const job = statsQueue.shift();
    if (!job.shouldStart()) {
      if (viewerStatsInProgress.get(job.key) === job.promise) viewerStatsInProgress.delete(job.key);
      job.reject(new Error('분석 대상이 변경되었습니다.'));
      continue;
    }
    activeStatsRequests += 1;
    callViewerStats({
      action: 'stats',
      streamerId: job.streamerId,
      vodId: job.vod.id,
      includePremiumMetrics: job.includePremiumMetrics,
    })
      .then(async (result) => {
        const response = result.data || {};
        const stats = response.stats || (response.jobId
          ? await waitForViewerStatsJob(response.jobId, job)
          : null);
        if (!stats || !stats.highest || !stats.lowest) throw new Error('시청자 그래프 응답을 확인하지 못했어요.');
        viewerStatsMemoryCache.set(job.key, stats);
        while (viewerStatsMemoryCache.size > MAX_BROWSER_STATS_CACHE_ITEMS) {
          viewerStatsMemoryCache.delete(viewerStatsMemoryCache.keys().next().value);
        }
        job.resolve(stats);
      })
      .catch((error) => job.reject(error))
      .finally(() => {
        if (viewerStatsInProgress.get(job.key) === job.promise) viewerStatsInProgress.delete(job.key);
        activeStatsRequests = Math.max(0, activeStatsRequests - 1);
        pumpStatsQueue();
      });
  }
}

function loadVodStats(
  vod,
  streamerId,
  shouldStart = () => true,
  includePremiumMetrics = subscriptionState.subscribed,
  onWaiting = null,
) {
  const key = String(streamerId).toLowerCase() + ':' + String(vod.id) + (includePremiumMetrics ? ':premium' : '');
  if (viewerStatsMemoryCache.has(key)) {
    const cached = viewerStatsMemoryCache.get(key);
    viewerStatsMemoryCache.delete(key);
    viewerStatsMemoryCache.set(key, cached);
    return Promise.resolve(cached);
  }
  const inProgress = viewerStatsInProgress.get(key);
  if (inProgress) return inProgress;

  let resolveRequest;
  let rejectRequest;
  const promise = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  viewerStatsInProgress.set(key, promise);
  statsQueue.push({
    key,
    vod,
    streamerId,
    includePremiumMetrics,
    onWaiting,
    promise,
    shouldStart,
    resolve: resolveRequest,
    reject: rejectRequest,
  });
  pumpStatsQueue();
  return promise;
}

function cancelQueuedStatsRequests() {
  const queued = statsQueue;
  statsQueue = [];
  queued.forEach((job) => {
    if (viewerStatsInProgress.get(job.key) === job.promise) viewerStatsInProgress.delete(job.key);
    job.reject(new Error('분석 대상이 변경되었습니다.'));
  });
}

function enqueueStats(card, vod, loadToken) {
  if (!selectedStreamer || card.dataset.statsState !== 'idle') return;
  card.dataset.statsState = 'queued';
  const streamerId = selectedStreamer.soopId;
  const includePremiumMetrics = subscriptionState.subscribed;
  loadVodStats(
    vod,
    streamerId,
    () => card.isConnected && loadToken === activeLoadToken,
    includePremiumMetrics,
    () => showQueueWaitMessage(card, loadToken),
  )
    .then((stats) => {
      if (!card.isConnected || loadToken !== activeLoadToken) return;
      if (includePremiumMetrics !== subscriptionState.subscribed) {
        card.dataset.statsState = 'idle';
        enqueueStats(card, vod, loadToken);
        return;
      }
      showStatsLinks(card, stats);
    })
    .catch(async (error) => {
      if (!card.isConnected || loadToken !== activeLoadToken) return;
      if (includePremiumMetrics && error && error.code === 'functions/permission-denied') {
        await refreshSubscriptionStatus();
        if (subscriptionState.subscribed) return showStatsError(card, error, loadToken);
        card.dataset.statsState = 'idle';
        enqueueStats(card, vod, loadToken);
        return;
      }
      showStatsError(card, error, loadToken);
    });
}

function observeVodCard(card) {
  if (statsObserver) statsObserver.observe(card);
  else enqueueStats(card, card._vod, card._loadToken);
}

function updateVodHeading() {
  const loadedCount = $('viewerVodGrid').children.length;
  $('viewerVodCount').textContent = vodTotal
    ? loadedCount.toLocaleString('ko-KR') + '개 표시 · 전체 ' + vodTotal.toLocaleString('ko-KR') + '개'
    : '등록된 다시보기 없음';
}

async function loadVodPage(loadToken, page) {
  if (!selectedStreamer || loadToken !== activeLoadToken) return;
  $('viewerLoadMore').disabled = true;
  $('viewerLoadMore').textContent = page === 1 ? '다시보기를 불러오는 중…' : '불러오는 중…';
  $('viewerVodStatus').textContent = page === 1 ? 'SOOP 다시보기 목록을 불러오고 있어요.' : '다음 다시보기를 불러오고 있어요.';
  try {
    const result = await callViewerStats({ action: 'vods', streamerId: selectedStreamer.soopId, page });
    if (loadToken !== activeLoadToken) return;
    const payload = result.data || {};
    const vods = Array.isArray(payload.vods) ? payload.vods : [];
    vodTotal = Math.max(0, Number(payload.total) || 0);
    nextPage = Number(payload.page) + 1;
    hasMoreVods = payload.hasMore === true;
    vodPagesByNumber.set(page, { vods, total: vodTotal, hasMore: hasMoreVods });
    if (page === 1 && !vods.length) {
      $('viewerVodStatus').textContent = '이 방송국에 등록된 다시보기가 없어요.';
    } else {
      $('viewerVodStatus').textContent = '다시보기별 유저 수 그래프를 불러오고 있어요. 화면에 가까운 영상부터 분석합니다.';
    }
    const knownIds = new Set([...$('viewerVodGrid').querySelectorAll('[data-vod-id]')].map((card) => card.dataset.vodId));
    vods.forEach((vod) => {
      if (!vod || !/^\d{1,20}$/.test(String(vod.id || '')) || knownIds.has(String(vod.id))) return;
      knownIds.add(String(vod.id));
      const card = createVodCard(vod, loadToken);
      $('viewerVodGrid').append(card);
      observeVodCard(card);
    });
    updateVodHeading();
    $('viewerLoadMore').classList.toggle('hidden', !hasMoreVods);
  } catch (error) {
    if (loadToken !== activeLoadToken) return;
    $('viewerVodStatus').textContent = viewerStatsErrorMessage(error, '다시보기 목록을 불러오지 못했어요.');
  } finally {
    if (loadToken === activeLoadToken) {
      $('viewerLoadMore').disabled = false;
      $('viewerLoadMore').textContent = '더 많은 다시보기 불러오기';
    }
  }
}

function renderPeriodPeakCards(peaks, vodCounts, isScanning, isLocked = !subscriptionState.subscribed) {
  const grid = $('viewerPeriodGrid');
  grid.replaceChildren();
  VIEWER_PEAK_PERIODS.forEach((period) => {
    const card = document.createElement('article');
    card.className = 'viewer-period-card';
    const label = document.createElement('strong');
    label.textContent = period.label;
    card.append(label);

    const peak = peaks.get(period.days);
    if (peak) {
      const count = document.createElement('span');
      count.className = 'viewer-period-peak-count';
      count.textContent = Number(peak.viewers).toLocaleString('ko-KR') + '명';
      const meta = document.createElement('span');
      meta.className = 'viewer-period-peak-meta';
      meta.textContent = formatVodDate(peak.vod.regDate) + ' · ' + formatClock(peak.second);
      const link = document.createElement('a');
      link.className = 'viewer-period-peak-link';
      link.href = playbackUrl(peak.vod.id, peak.second);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = peak.vod.title || '다시보기에서 재생';
      link.setAttribute('aria-label', period.label + ' 최고 ' + count.textContent + ' · ' + meta.textContent + ' · ' + link.textContent + ' 재생');
      card.append(count, meta, link);
    } else {
      const empty = document.createElement('span');
      empty.className = 'viewer-period-empty';
      const vodCount = Number(vodCounts.get(period.days)) || 0;
      empty.textContent = isScanning
        ? '분석 중…'
        : isLocked ? '구독 후 확인 가능'
        : !vodCounts.has(period.days) ? '분석 전'
          : vodCount > 0 ? '통계 확인 가능한 순간 없음' : '기간 내 다시보기 없음';
      card.append(empty);
    }
    grid.append(card);
  });
}

function isCurrentPeriodScan(scanToken, loadToken) {
  return scanToken === periodScanToken && loadToken === activeLoadToken && !!selectedStreamer && subscriptionState.subscribed;
}

async function fetchRecentYearVods(scanToken, loadToken, yearCutoff) {
  const streamerId = selectedStreamer.soopId;
  const vods = [];
  const seenIds = new Set();
  let reachedYearCutoff = false;
  let pageLimitReached = false;

  for (let page = 1; page <= MAX_PERIOD_SCAN_PAGES; page += 1) {
    if (!isCurrentPeriodScan(scanToken, loadToken)) return null;
    let pageData = vodPagesByNumber.get(page);
    if (!pageData) {
      const result = await callViewerStats({ action: 'vods', streamerId, page });
      if (!isCurrentPeriodScan(scanToken, loadToken)) return null;
      const payload = result.data || {};
      const rows = Array.isArray(payload.vods) ? payload.vods : [];
      pageData = {
        vods: rows,
        total: Math.max(0, Number(payload.total) || 0),
        hasMore: payload.hasMore === true,
      };
      vodPagesByNumber.set(page, pageData);
    }

    let oldestTimestamp = 0;
    pageData.vods.forEach((vod) => {
      const timestamp = parseVodTimestamp(vod && vod.regDate);
      if (!timestamp) return;
      if (!oldestTimestamp || timestamp < oldestTimestamp) oldestTimestamp = timestamp;
      if (timestamp >= yearCutoff && vod && /^\d{1,20}$/.test(String(vod.id || '')) && !seenIds.has(String(vod.id))) {
        seenIds.add(String(vod.id));
        vods.push({ vod, timestamp });
      }
    });

    $('viewerPeriodStatus').textContent = '최근 1년 다시보기 목록 확인 중 · ' + Math.min(page * 60, pageData.total).toLocaleString('ko-KR') + '개 확인';
    if (oldestTimestamp && oldestTimestamp < yearCutoff) {
      reachedYearCutoff = true;
      break;
    }
    if (!pageData.hasMore) break;
    if (page === MAX_PERIOD_SCAN_PAGES) pageLimitReached = true;
  }

  return { vods, pageLimitReached, reachedYearCutoff };
}

async function runPeriodPeakScan() {
  if (!selectedStreamer) return;
  const streamerId = selectedStreamer.soopId;
  const loadToken = activeLoadToken;
  try {
    const access = await callViewerSubscription({ action: 'periodAccess' });
    if (!selectedStreamer || loadToken !== activeLoadToken || selectedStreamer.soopId !== streamerId) return;
    const previouslySubscribed = subscriptionState.subscribed;
    subscriptionState.isAdmin = access.data && access.data.isAdmin === true;
    if (subscriptionState.isAdmin) subscriptionState.accountProtected = true;
    subscriptionState.subscribed = true;
    subscriptionState.expiresAt = Number(access.data && access.data.expiresAt) || subscriptionState.expiresAt;
    subscriptionState.loaded = true;
    renderSubscriptionControls();
    scheduleSubscriptionStatusRefresh();
    if (!previouslySubscribed) refreshExistingVodCardAccess();
  } catch (error) {
    await refreshSubscriptionStatus();
    if (!selectedStreamer || loadToken !== activeLoadToken || selectedStreamer.soopId !== streamerId) return;
    $('viewerPeriodStatus').textContent = '기간별 최고 시청 순간은 구독 계정에서 이용할 수 있어요.';
    $('viewerPeriodStatus').classList.remove('is-error');
    renderPeriodPeakCards(new Map(), new Map(), false, true);
    openSubscriptionDialog();
    return;
  }
  const scanToken = ++periodScanToken;
  const scanStartedAt = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoffByDays = new Map(VIEWER_PEAK_PERIODS.map((period) => [period.days, scanStartedAt - period.days * dayMs]));
  const yearCutoff = cutoffByDays.get(365);
  const peaks = new Map(VIEWER_PEAK_PERIODS.map((period) => [period.days, null]));
  const vodCounts = new Map(VIEWER_PEAK_PERIODS.map((period) => [period.days, 0]));

  $('viewerPeriodScanButton').disabled = true;
  $('viewerPeriodScanButton').textContent = '분석 중…';
  $('viewerPeriodStatus').classList.remove('is-error');
  $('viewerPeriodStatus').textContent = '최근 1년 다시보기 목록을 확인하고 있어요.';
  renderPeriodPeakCards(peaks, vodCounts, true);

  try {
    const scanData = await fetchRecentYearVods(scanToken, loadToken, yearCutoff);
    if (!scanData || !isCurrentPeriodScan(scanToken, loadToken)) return;
    const { vods, pageLimitReached } = scanData;
    VIEWER_PEAK_PERIODS.forEach((period) => {
      const cutoff = cutoffByDays.get(period.days);
      vodCounts.set(period.days, vods.filter((item) => item.timestamp >= cutoff).length);
    });
    renderPeriodPeakCards(peaks, vodCounts, true);

    if (!vods.length) {
      $('viewerPeriodStatus').textContent = '최근 1년 안에 분석할 다시보기가 없습니다.';
      renderPeriodPeakCards(peaks, vodCounts, false);
      return;
    }

    let cursor = 0;
    let completed = 0;
    let failed = 0;
    let succeeded = 0;
    let rateLimitMessage = '';
    let hasUnrenderedPeak = false;
    const worker = async () => {
      while (isCurrentPeriodScan(scanToken, loadToken) && !rateLimitMessage && cursor < vods.length) {
        const item = vods[cursor];
        cursor += 1;
        try {
          const stats = await loadVodStats(
            item.vod,
            streamerId,
            () => isCurrentPeriodScan(scanToken, loadToken),
            true,
            () => {
              $('viewerPeriodStatus').textContent = '현재 이용자가 많아 집계 시간이 길어지고 있습니다. 분석을 계속 진행하고 있어요.';
            },
          );
          if (!isCurrentPeriodScan(scanToken, loadToken)) return;
          const peakViewers = Number(stats.highest.viewers);
          const peakSecond = Number(stats.highest.second);
          if (Number.isFinite(peakViewers) && peakViewers >= 0 && Number.isFinite(peakSecond) && peakSecond >= 0) {
            succeeded += 1;
            VIEWER_PEAK_PERIODS.forEach((period) => {
              if (item.timestamp < cutoffByDays.get(period.days)) return;
              const currentPeak = peaks.get(period.days);
              if (!currentPeak || peakViewers > currentPeak.viewers) {
                peaks.set(period.days, {
                  vod: item.vod,
                  viewers: peakViewers,
                  second: peakSecond,
                  timestamp: item.timestamp,
                });
                hasUnrenderedPeak = true;
              }
            });
          } else {
            failed += 1;
          }
        } catch (error) {
          if (!isCurrentPeriodScan(scanToken, loadToken)) return;
          if (error && error.code === 'functions/resource-exhausted') {
            rateLimitMessage = viewerStatsErrorMessage(error, '요청 한도에 도달했어요.');
            cursor = vods.length;
          } else {
            failed += 1;
          }
        }
        completed += 1;
        $('viewerPeriodStatus').textContent = '최근 1년 다시보기 분석 중 · ' + completed.toLocaleString('ko-KR') + '/' + vods.length.toLocaleString('ko-KR') + '개 완료';
        if (hasUnrenderedPeak) {
          renderPeriodPeakCards(peaks, vodCounts, true);
          hasUnrenderedPeak = false;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, vods.length) }, () => worker()));
    if (!isCurrentPeriodScan(scanToken, loadToken)) return;
    renderPeriodPeakCards(peaks, vodCounts, false);
    const suffix = failed ? ' · 통계 미제공/오류 ' + failed.toLocaleString('ko-KR') + '개 제외' : '';
    const limitMessage = pageLimitReached ? ' · 다시보기 페이지 상한까지 확인해 일부가 빠질 수 있어요.' : '';
    const quotaMessage = rateLimitMessage
      ? ' · ' + rateLimitMessage + ' 미분석 ' + Math.max(0, vods.length - completed).toLocaleString('ko-KR') + '개'
      : '';
    $('viewerPeriodStatus').textContent = '최근 1년 다시보기 ' + vods.length.toLocaleString('ko-KR') + '개 중 ' + succeeded.toLocaleString('ko-KR') + '개 분석 완료' + suffix + limitMessage + quotaMessage;
  } catch (error) {
    if (!isCurrentPeriodScan(scanToken, loadToken)) return;
    $('viewerPeriodStatus').classList.add('is-error');
    $('viewerPeriodStatus').textContent = viewerStatsErrorMessage(error, '기간별 다시보기를 불러오지 못했어요. 다시 시도해 주세요.');
  } finally {
    if (isCurrentPeriodScan(scanToken, loadToken)) {
      $('viewerPeriodScanButton').disabled = false;
      $('viewerPeriodScanButton').textContent = '다시 분석';
    }
  }
}

async function selectStreamer(streamer) {
  activeLoadToken += 1;
  const loadToken = activeLoadToken;
  periodScanToken += 1;
  cancelQueuedStatsRequests();
  vodPagesByNumber = new Map();
  selectedStreamer = streamer;
  nextPage = 1;
  hasMoreVods = false;
  vodTotal = 0;
  if (statsObserver) statsObserver.disconnect();
  $('viewerVodGrid').replaceChildren();
  $('viewerLoadMore').classList.add('hidden');
  $('viewerPeriodScanButton').disabled = false;
  $('viewerPeriodScanButton').textContent = subscriptionState.subscribed ? '최근 1년 분석' : '구독 전용 분석';
  $('viewerPeriodStatus').textContent = subscriptionState.subscribed
    ? '최근 1년 다시보기를 분석해 7일·30일·90일·1년 최고 순간을 찾습니다.'
    : '기간별 최고 시청 순간은 구독 기능이에요. 별풍선 10개로 30일 동안 이용할 수 있습니다.';
  $('viewerPeriodStatus').classList.remove('is-error');
  renderPeriodPeakCards(new Map(), new Map(), false);
  $('viewerResults').classList.remove('hidden');
  $('viewerEmpty').classList.add('hidden');
  $('viewerStreamerName').textContent = streamer.nickname || streamer.soopId;
  $('viewerStreamerId').textContent = 'SOOP ID · ' + streamer.soopId;
  $('viewerStationLink').href = safeStationUrl(streamer);
  const avatar = $('viewerStreamerAvatar');
  avatar.hidden = true;
  avatar.removeAttribute('src');
  if (streamer.avatarUrl) {
    avatar.src = streamer.avatarUrl;
    avatar.hidden = false;
    avatar.addEventListener('error', () => { avatar.hidden = true; }, { once: true });
  }
  setSearchHint((streamer.nickname || streamer.soopId) + '의 다시보기를 불러옵니다. 카드나 최고·최저 링크를 누르면 해당 시점부터 재생됩니다.');
  updateVodHeading();
  if ('IntersectionObserver' in window) {
    statsObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        statsObserver.unobserve(entry.target);
        enqueueStats(entry.target, entry.target._vod, entry.target._loadToken);
      });
    }, { rootMargin: '480px 0px' });
  } else {
    statsObserver = null;
  }
  await loadVodPage(loadToken, 1);
}

async function runSearch(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    setSearchHint('닉네임, SOOP 아이디 또는 방송국 주소를 입력해 주세요.');
    return;
  }
  const requestId = ++searchRequestId;
  const idFromInput = parseSoopId(cleanQuery);
  const searchQuery = idFromInput || cleanQuery;
  setSearchHint('스트리머를 찾고 있어요…');
  $('viewerSearchButton').disabled = true;
  renderSearchResults([]);
  try {
    await getAuthReady();
    const response = await callViewerStats({ action: 'search', query: searchQuery });
    if (requestId !== searchRequestId) return;
    const streamers = Array.isArray(response.data && response.data.streamers) ? response.data.streamers : [];
    const candidates = streamers.slice();
    const isStationUrl = /^https?:\/\//i.test(cleanQuery) && Boolean(idFromInput);
    if (idFromInput && !candidates.some((item) => String(item.soopId).toLowerCase() === idFromInput)
      && (isStationUrl || candidates.length === 0)) {
      candidates.unshift(streamerForId(idFromInput));
    }
    const exactMatches = candidates.filter((item) => String(item.soopId).toLowerCase() === searchQuery.toLowerCase()
      || String(item.nickname).toLocaleLowerCase() === searchQuery.toLocaleLowerCase());
    if (exactMatches.length === 1) {
      renderSearchResults(candidates);
      await selectStreamer(exactMatches[0]);
      return;
    }
    if (candidates.length === 1) {
      renderSearchResults(candidates);
      await selectStreamer(candidates[0]);
      return;
    }
    renderSearchResults(candidates);
    if (candidates.length) {
      setSearchHint('검색 결과 ' + candidates.length.toLocaleString('ko-KR') + '명 · 분석할 스트리머를 선택해 주세요.');
    } else {
      setSearchHint('검색 결과가 없어요. 다른 이름을 입력하거나 SOOP 방송국 아이디·주소를 사용해 주세요.', true);
    }
  } catch (error) {
    if (requestId === searchRequestId) setSearchHint(viewerStatsErrorMessage(error, '스트리머 검색에 실패했어요.'), true);
  } finally {
    if (requestId === searchRequestId) $('viewerSearchButton').disabled = false;
  }
}

$('viewerSearchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch($('viewerSearchInput').value);
});

$('viewerSearchResults').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-streamer-index]');
  if (!button) return;
  const streamers = $('viewerSearchResults')._streamers || [];
  const streamer = streamers[Number(button.dataset.streamerIndex)];
  if (streamer) selectStreamer(streamer);
});

$('viewerLoadMore').addEventListener('click', () => {
  if (hasMoreVods && selectedStreamer) loadVodPage(activeLoadToken, nextPage);
});

$('viewerPeriodScanButton').addEventListener('click', runPeriodPeakScan);

$('viewerSubscriptionAction').addEventListener('click', async () => {
  if (!subscriptionState.loaded) await refreshSubscriptionStatus();
  openSubscriptionDialog();
});

$('viewerSubscriptionRefresh').addEventListener('click', refreshSubscriptionStatus);
$('viewerSubscriptionClose').addEventListener('click', () => $('viewerSubscriptionDialog').close());
$('viewerSubscriptionCloseBottom').addEventListener('click', () => $('viewerSubscriptionDialog').close());
$('viewerSubscriptionDialog').addEventListener('click', (event) => {
  if (event.target === $('viewerSubscriptionDialog')) $('viewerSubscriptionDialog').close();
});
$('viewerSubscriptionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (subscriptionState.isAdmin) {
    renderSubscriptionDialogStatus();
    return;
  }
  if (!subscriptionState.accountProtected) {
    renderSubscriptionDialogStatus('로그인 후 구독 신청을 할 수 있어요. 새 탭에서 로그인한 뒤 상태를 새로고침해 주세요.');
    return;
  }
  const nickname = $('viewerSubscriptionNickname').value.trim();
  if (!nickname || !$('viewerSubscriptionNickname').reportValidity()) return;
  const submit = $('viewerSubscriptionSubmit');
  submit.disabled = true;
  renderSubscriptionDialogStatus('신청을 접수하고 있어요.');
  try {
    const response = await callViewerSubscription({ action: 'request', nickname });
    const result = response.data || {};
    await refreshSubscriptionStatus();
    renderSubscriptionDialogStatus(result.action === 'already-pending'
      ? '이미 확인 대기 중인 신청이 있어요. 별풍선 10개 후원 여부를 운영자가 확인 중입니다.'
      : '신청이 접수됐어요. 별풍선 후원을 확인한 뒤 이 계정에 30일 이용권을 적용합니다.');
    if (result.action === 'pending' || result.action === 'already-pending') {
      $('viewerSubscriptionNickname').value = '';
    }
  } catch (error) {
    renderSubscriptionDialogStatus(viewerStatsErrorMessage(error, '구독 신청을 접수하지 못했어요.'));
  } finally {
    submit.disabled = false;
    renderSubscriptionDialogStatus();
  }
});

$('viewerSubscriptionCancel').addEventListener('click', async () => {
  if (!subscriptionState.pendingRequestId || !confirm('구독 신청을 취소할까요?')) return;
  const cancel = $('viewerSubscriptionCancel');
  cancel.disabled = true;
  try {
    await callViewerSubscription({ action: 'cancel', requestId: subscriptionState.pendingRequestId });
    await refreshSubscriptionStatus();
    renderSubscriptionDialogStatus('신청을 취소했어요. 후원 후 다시 신청할 수 있습니다.');
  } catch (error) {
    renderSubscriptionDialogStatus(viewerStatsErrorMessage(error, '신청을 취소하지 못했어요.'));
  } finally {
    cancel.disabled = false;
    renderSubscriptionDialogStatus();
  }
});

let observedAuthIdentity = '';
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  const identity = user.uid + ':' + String(user.isAnonymous);
  if (identity === observedAuthIdentity) return;
  observedAuthIdentity = identity;
  refreshSubscriptionStatus();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshSubscriptionStatus();
});

setupDevbarMarquee();
loadDevbarLinks();
getAuthReady().catch((error) => setSearchHint(viewerStatsErrorMessage(error, '통계 연결을 시작하지 못했어요.'), true));
