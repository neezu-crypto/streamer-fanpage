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
const VIEWER_VOD_PAGE_SIZE = 60;
const MAX_BROWSER_STATS_CACHE_ITEMS = 800;
try { window.localStorage.removeItem('streamerFanPage.viewerStats.recentStreamers.v1'); } catch (_) {}
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
let vodPagesStreamerId = '';
let subscriptionRefreshToken = 0;
let subscriptionRefreshTimer = 0;
let comparisonSelection = [null, null];
let comparisonSearchRequestSequence = [0, 0];
let pendingComparisonRequest = null;
let comparisonRequestSequence = 0;
let comparisonRunning = false;
let comparisonGateWaiting = false;
let comparisonStatusMessage = '스트리머 2명과 날짜를 선택해 주세요.';
let comparisonStatusIsError = false;
let subscriptionState = {
  loaded: false,
  accountProtected: false,
  isAdmin: false,
  subscribed: false,
  expiresAt: 0,
  pending: false,
  pendingRequestId: '',
  pendingDonorSoopId: '',
  pendingDonationCompletedAt: 0,
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
    status.textContent = state.pendingDonationCompletedAt
      ? '별풍선 후원 알림을 자동 확인하고 있어요.'
      : state.pendingDonorSoopId
        ? '구독 신청이 등록됐어요. 후원 뒤 자동 확인을 시작해 주세요.'
        : '이전 방식의 구독 신청을 운영자가 수동 확인하고 있어요.';
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
    subscriptionRefreshTimer = window.setTimeout(() => refreshSubscriptionStatus(), 10 * 1000);
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

async function refreshSubscriptionStatus({ resumeComparison = true } = {}) {
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
      pendingDonorSoopId: typeof data.pendingDonorSoopId === 'string' ? data.pendingDonorSoopId : '',
      pendingDonationCompletedAt: Number(data.pendingDonationCompletedAt) || 0,
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
    if (pendingComparisonRequest && !subscriptionState.isAdmin && !subscriptionState.subscribed) {
      comparisonGateWaiting = true;
      setComparisonStatus(subscriptionState.accountProtected
        ? subscriptionState.pending
          ? '구독 신청 승인 대기 중이에요. 승인되면 선택한 스트리머와 날짜의 비교 결과가 자동으로 열립니다.'
          : '로그인이 확인됐어요. 별풍선 10개 구독을 신청하면 승인 후 비교 결과가 자동으로 열립니다.'
        : '선택한 스트리머와 날짜는 유지돼요. 새 탭에서 로그인한 뒤 이 화면으로 돌아와 주세요.');
      renderComparisonSelection();
    }
    if ($('viewerSubscriptionDialog').open) renderSubscriptionDialogStatus();
    if (resumeComparison) resumePendingComparisonIfReady();
    return true;
  } catch (error) {
    if (token !== subscriptionRefreshToken) return;
    $('viewerSubscriptionStatus').textContent = viewerStatsErrorMessage(error, '구독 상태를 확인하지 못했어요.');
    $('viewerSubscriptionAction').disabled = false;
    $('viewerSubscriptionAction').textContent = '구독 상태 다시 확인';
    return false;
  }
}

function renderSubscriptionDialogStatus(message = '') {
  const status = $('viewerSubscriptionDialogStatus');
  const submit = $('viewerSubscriptionSubmit');
  const cancel = $('viewerSubscriptionCancel');
  const loginNote = $('viewerSubscriptionLoginNote');
  const purchaseInfo = $('viewerSubscriptionPurchaseInfo');
  const donationStep = $('viewerSubscriptionDonationStep');
  const donationHelp = $('viewerSubscriptionDonationHelp');
  const donationLink = $('viewerSubscriptionDonationLink');
  const donationComplete = $('viewerSubscriptionDonationComplete');
  const hasPending = subscriptionState.pending && subscriptionState.pendingRequestId;
  const autoVerificationReady = !!subscriptionState.pendingDonorSoopId;
  const donationCompleted = subscriptionState.pendingDonationCompletedAt > 0;
  const comparisonContext = !!pendingComparisonRequest;
  $('viewerSubscriptionDialogTitle').textContent = comparisonContext ? '비교 결과 확인' : '고점체크 구독';
  $('viewerSubscriptionDialog').querySelector('.eyebrow').textContent = comparisonContext ? 'RESULT ACCESS' : '30-DAY PASS';
  purchaseInfo.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !!hasPending);
  donationStep.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !hasPending);
  loginNote.classList.toggle('hidden', subscriptionState.isAdmin || subscriptionState.accountProtected);
  submit.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !!hasPending);
  cancel.classList.toggle('hidden', subscriptionState.isAdmin || !hasPending);
  donationLink.classList.toggle('hidden', !autoVerificationReady);
  donationComplete.classList.toggle('hidden', !autoVerificationReady || donationCompleted);
  donationComplete.disabled = false;
  donationComplete.textContent = '후원 완료 · 자동 확인 시작';
  if (!autoVerificationReady) {
    donationHelp.textContent = '이 신청은 자동 확인에 필요한 SOOP 아이디 정보가 없어요. 후원 내역은 관리자가 수동 확인합니다.';
  } else if (donationCompleted) {
    donationHelp.textContent = '후원 완료 신호를 받았어요. 관리자 브라우저가 SOOP 알림을 대조 중이며, 한 신청만 조건에 맞으면 30일 이용권이 자동 적용됩니다. 확인할 수 없으면 관리자가 직접 확인합니다.';
  } else {
    donationHelp.textContent = '신청에 입력한 SOOP 계정으로 별풍선 10개를 후원한 뒤 자동 확인을 시작해 주세요.';
  }
  submit.textContent = subscriptionState.subscribed ? '신청 등록 · 30일 연장' : '구독 신청 등록';
  if (subscriptionState.isAdmin) {
    status.textContent = '관리자 권한으로 기간별 최고 순간과 평균 대비 상승폭을 포함한 모든 구독 기능을 이용할 수 있어요.';
  } else if (message) {
    status.textContent = message;
  } else if (!subscriptionState.accountProtected) {
    status.textContent = comparisonContext
      ? '비교 대상은 유지됩니다. Google·Kakao 로그인 또는 스트리머 인증 후 구독을 신청할 수 있어요.'
      : '익명 계정은 구독 권한을 구매할 수 없어요. Google·Kakao 로그인 또는 스트리머 인증 후 이용해 주세요.';
  } else if (hasPending) {
    if (!autoVerificationReady) {
      status.textContent = '이전 방식으로 접수된 신청입니다. 관리자가 후원 내역을 수동 확인하며, 자동 확인을 원하면 신청을 취소하고 다시 등록해 주세요.';
    } else if (donationCompleted) {
      status.textContent = comparisonContext
        ? '후원 알림 자동 확인 중이에요. 일치하면 선택한 날짜의 비교 결과가 자동으로 열립니다.'
        : '후원 알림을 자동 대조하고 있어요. 확인되면 이 계정에 30일 이용권이 적용됩니다.';
    } else {
      status.textContent = '신청이 등록됐어요. 운영자 방송국에 10개 후원한 뒤 ‘후원 완료 · 자동 확인 시작’을 눌러 주세요.';
    }
  } else if (subscriptionState.subscribed) {
    status.textContent = formatSubscriptionDate(subscriptionState.expiresAt) + '까지 구독 중이에요. 미리 갱신해도 남은 기간에 30일이 더해집니다.';
  } else {
    status.textContent = comparisonContext
      ? '후원자 SOOP 정보를 입력해 신청을 등록하고 후원 완료를 알리면, 후원 알림이 일치할 때 비교 결과가 자동으로 열립니다.'
      : '별풍선 후원 알림이 신청 정보와 일치하면 30일 이용권이 자동 승인됩니다. 확인할 수 없거나 신청이 겹치면 관리자가 수동 확인합니다.';
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

function vodCalendarDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return '';
  return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
}

function setComparisonStatus(message, isError = false) {
  comparisonStatusMessage = message;
  comparisonStatusIsError = isError;
  const status = $('viewerComparisonStatus');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function comparisonSelectionKey() {
  return comparisonSelection.map((streamer) => String(streamer && streamer.soopId || '').toLowerCase()).join('|')
    + ':' + String($('viewerComparisonDate').value || '');
}

function setComparisonPickerStatus(index, message, isError = false) {
  const status = $('viewerComparisonPickerStatus' + index);
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function renderComparisonSearchResults(index, streamers) {
  const results = $('viewerComparisonSearchResults' + index);
  results.replaceChildren();
  streamers.forEach((streamer, streamerIndex) => {
    const button = document.createElement('button');
    button.className = 'viewer-comparison-search-result';
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.dataset.comparisonSlot = String(index);
    button.dataset.comparisonStreamerIndex = String(streamerIndex);
    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.src = streamer.avatarUrl || '';
    avatar.addEventListener('error', () => { avatar.hidden = true; }, { once: true });
    const copy = document.createElement('span');
    copy.className = 'viewer-comparison-search-copy';
    const name = document.createElement('strong');
    name.textContent = streamer.nickname || streamer.soopId;
    const id = document.createElement('span');
    id.textContent = 'SOOP ID · ' + streamer.soopId;
    copy.append(name, id);
    const select = document.createElement('span');
    select.className = 'viewer-comparison-search-select';
    select.textContent = '선택';
    button.append(avatar, copy, select);
    results.append(button);
  });
  results._streamers = streamers;
}

function renderComparisonSelection() {
  comparisonSelection.forEach((streamer, index) => {
    const selected = $('viewerComparisonSelected' + index);
    selected.replaceChildren();
    selected.classList.toggle('hidden', !streamer);
    if (!streamer) return;
    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.src = streamer.avatarUrl || '';
    avatar.addEventListener('error', () => { avatar.hidden = true; }, { once: true });
    const copy = document.createElement('span');
    copy.className = 'viewer-comparison-selected-copy';
    const name = document.createElement('strong');
    name.textContent = streamer.nickname || streamer.soopId;
    const id = document.createElement('span');
    id.textContent = 'SOOP ID · ' + streamer.soopId;
    copy.append(name, id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'viewer-comparison-remove';
    remove.dataset.comparisonRemove = String(index);
    remove.setAttribute('aria-label', (index + 1) + '번 스트리머 선택 변경');
    remove.textContent = '변경';
    selected.append(avatar, copy, remove);
  });
  const selectedCount = comparisonSelection.filter(Boolean).length;
  const hasDate = Boolean($('viewerComparisonDate').value);
  $('viewerComparisonCount').textContent = selectedCount + ' / 2명 선택';
  $('viewerComparisonClear').disabled = (selectedCount === 0 && !hasDate) || comparisonRunning;
  $('viewerComparisonRun').disabled = selectedCount !== 2 || !hasDate || comparisonRunning || comparisonGateWaiting;
  $('viewerComparisonRun').textContent = comparisonRunning
    ? '비교 결과 불러오는 중…'
    : comparisonGateWaiting
      ? '로그인·구독 확인 후 자동 진행'
      : '비교 결과 확인';
  $('viewerComparisonStatus').textContent = comparisonStatusMessage;
  $('viewerComparisonStatus').classList.toggle('is-error', comparisonStatusIsError);
}

function invalidateComparisonResult() {
  comparisonRequestSequence += 1;
  pendingComparisonRequest = null;
  comparisonRunning = false;
  comparisonGateWaiting = false;
  $('viewerComparisonResults').replaceChildren();
  $('viewerComparisonResults').classList.add('hidden');
}

function selectComparisonStreamer(index, streamer) {
  const soopId = String(streamer && streamer.soopId || '').trim().toLowerCase();
  if (!SOOP_ID_PATTERN.test(soopId)) {
    setComparisonPickerStatus(index, 'SOOP ID를 확인하지 못했어요. 다른 검색어를 입력해 주세요.', true);
    return;
  }
  const other = comparisonSelection[index === 0 ? 1 : 0];
  if (other && String(other.soopId).toLowerCase() === soopId) {
    setComparisonPickerStatus(index, '같은 스트리머는 두 번 선택할 수 없어요.', true);
    return;
  }
  comparisonSelection[index] = { ...streamer, soopId };
  $('viewerComparisonSearch' + index).value = '';
  $('viewerComparisonSearchResults' + index).replaceChildren();
  $('viewerComparisonSearchResults' + index)._streamers = [];
  invalidateComparisonResult();
  setComparisonPickerStatus(index, '선택됐어요.');
  setComparisonStatus(comparisonSelection.every(Boolean) && $('viewerComparisonDate').value
    ? '비교할 준비가 됐어요. 선택한 날짜의 다시보기를 자동으로 찾아요.'
    : '스트리머 2명과 날짜를 선택해 주세요.');
  renderComparisonSelection();
}

function clearComparisonStreamer(index) {
  comparisonSearchRequestSequence[index] += 1;
  comparisonSelection[index] = null;
  $('viewerComparisonSearchResults' + index).replaceChildren();
  $('viewerComparisonSearchResults' + index)._streamers = [];
  invalidateComparisonResult();
  setComparisonPickerStatus(index, '닉네임이나 SOOP ID를 검색하세요.');
  setComparisonStatus('스트리머 2명과 날짜를 선택해 주세요.');
  renderComparisonSelection();
}

async function searchComparisonStreamer(index, query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    setComparisonPickerStatus(index, '닉네임, SOOP 아이디 또는 방송국 주소를 입력해 주세요.', true);
    return;
  }
  const requestId = ++comparisonSearchRequestSequence[index];
  const button = $('viewerComparisonSearchButton' + index);
  const idFromInput = parseSoopId(cleanQuery);
  const searchQuery = idFromInput || cleanQuery;
  button.disabled = true;
  setComparisonPickerStatus(index, '스트리머를 찾고 있어요…');
  renderComparisonSearchResults(index, []);
  try {
    await getAuthReady();
    const response = await callViewerStats({ action: 'search', query: searchQuery });
    if (requestId !== comparisonSearchRequestSequence[index]) return;
    const candidates = Array.isArray(response.data && response.data.streamers) ? response.data.streamers.slice() : [];
    const isStationUrl = /^https?:\/\//i.test(cleanQuery) && Boolean(idFromInput);
    if (idFromInput && !candidates.some((item) => String(item.soopId).toLowerCase() === idFromInput)
      && (isStationUrl || candidates.length === 0)) {
      candidates.unshift(streamerForId(idFromInput));
    }
    const normalizedQuery = searchQuery.toLocaleLowerCase();
    const exactMatches = candidates.filter((item) => String(item.soopId).toLocaleLowerCase() === normalizedQuery
      || String(item.nickname).toLocaleLowerCase() === normalizedQuery);
    if (exactMatches.length === 1) {
      selectComparisonStreamer(index, exactMatches[0]);
      return;
    }
    if (candidates.length === 1) {
      selectComparisonStreamer(index, candidates[0]);
      return;
    }
    renderComparisonSearchResults(index, candidates);
    setComparisonPickerStatus(index, candidates.length
      ? '검색 결과 ' + candidates.length.toLocaleString('ko-KR') + '명 · 비교할 스트리머를 선택해 주세요.'
      : '검색 결과가 없어요. 다른 이름이나 SOOP 아이디를 입력해 주세요.', !candidates.length);
  } catch (error) {
    if (requestId === comparisonSearchRequestSequence[index]) {
      setComparisonPickerStatus(index, viewerStatsErrorMessage(error, '스트리머 검색에 실패했어요.'), true);
    }
  } finally {
    if (requestId === comparisonSearchRequestSequence[index]) button.disabled = false;
  }
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

function isCurrentComparisonRequest(request) {
  return !!request
    && request.id === comparisonRequestSequence
    && comparisonSelection.length === 2
    && comparisonSelection.every(Boolean)
    && request.selectionKey === comparisonSelectionKey();
}

function comparisonMetric(label, value, isPeak = false) {
  const metric = document.createElement('div');
  metric.className = 'viewer-comparison-result-metric' + (isPeak ? ' is-peak' : '');
  const name = document.createElement('span');
  name.textContent = label;
  const amount = document.createElement('strong');
  amount.textContent = value;
  metric.append(name, amount);
  return metric;
}

async function findComparisonVodsOnDate(streamer, date, request, index) {
  const streamerId = String(streamer.soopId || '').trim().toLowerCase();
  const pageCache = new Map();
  const getPage = async (page) => {
    if (pageCache.has(page)) return pageCache.get(page);
    if (streamerId === vodPagesStreamerId && vodPagesByNumber.has(page)) {
      const cached = vodPagesByNumber.get(page);
      const normalized = { vods: cached.vods, total: cached.total, hasMore: cached.hasMore };
      pageCache.set(page, normalized);
      return normalized;
    }
    if (!isCurrentComparisonRequest(request)) return null;
    const response = await callViewerStats({ action: 'vods', streamerId, page });
    if (!isCurrentComparisonRequest(request)) return null;
    const payload = response.data || {};
    const pageData = {
      vods: Array.isArray(payload.vods) ? payload.vods : [],
      total: Math.max(0, Number(payload.total) || 0),
      hasMore: payload.hasMore === true,
    };
    pageCache.set(page, pageData);
    return pageData;
  };
  const dateRange = (vods) => {
    const dates = vods.map((vod) => vodCalendarDate(vod && vod.regDate)).filter(Boolean).sort();
    return dates.length ? { oldest: dates[0], newest: dates[dates.length - 1] } : { oldest: '', newest: '' };
  };
  const firstPage = await getPage(1);
  if (!firstPage || !isCurrentComparisonRequest(request)) return null;
  if (!firstPage.total || !firstPage.vods.length) return [];
  const pageCount = Math.ceil(firstPage.total / VIEWER_VOD_PAGE_SIZE);
  const searchablePageCount = Math.min(MAX_PERIOD_SCAN_PAGES, pageCount);
  let low = 1;
  let high = searchablePageCount;
  let targetPage = 0;

  while (low <= high) {
    if (!isCurrentComparisonRequest(request)) return null;
    const page = Math.floor((low + high) / 2);
    setComparisonPickerStatus(index, (streamer.nickname || streamerId) + ' · 날짜가 같은 다시보기 찾는 중… ' + page + '페이지');
    const pageData = await getPage(page);
    if (!pageData || !isCurrentComparisonRequest(request)) return null;
    const range = dateRange(pageData.vods);
    if (!range.oldest || !range.newest) {
      targetPage = page;
      break;
    }
    if (date > range.newest) {
      high = page - 1;
    } else if (date < range.oldest) {
      low = page + 1;
    } else {
      targetPage = page;
      break;
    }
  }

  if (!targetPage) {
    if (pageCount > searchablePageCount && low > searchablePageCount) {
      throw new Error((streamer.nickname || streamerId) + '의 다시보기가 너무 많아 최근 12,000개까지만 날짜를 찾을 수 있어요.');
    }
    return [];
  }

  const matches = [];
  const seen = new Set();
  const addMatches = (pageData) => {
    pageData.vods.forEach((vod) => {
      const vodId = String(vod && vod.id || '');
      if (vodCalendarDate(vod && vod.regDate) === date && /^\d{1,20}$/.test(vodId) && !seen.has(vodId)) {
        seen.add(vodId);
        matches.push(vod);
      }
    });
  };
  const centerPage = await getPage(targetPage);
  if (!centerPage || !isCurrentComparisonRequest(request)) return null;
  addMatches(centerPage);

  for (let page = targetPage - 1; page >= 1; page -= 1) {
    if (!isCurrentComparisonRequest(request)) return null;
    const pageData = await getPage(page);
    if (!pageData || !isCurrentComparisonRequest(request)) return null;
    const range = dateRange(pageData.vods);
    if (!range.oldest || range.oldest > date) break;
    addMatches(pageData);
    if (range.newest > date) break;
  }
  for (let page = targetPage + 1; page <= searchablePageCount; page += 1) {
    if (!isCurrentComparisonRequest(request)) return null;
    const pageData = await getPage(page);
    if (!pageData || !isCurrentComparisonRequest(request)) return null;
    const range = dateRange(pageData.vods);
    if (!range.newest || range.newest < date) break;
    addMatches(pageData);
    if (range.newest > date) break;
  }
  return matches;
}

async function analyzeComparisonStreamer(streamer, vods, request, index) {
  if (!vods.length) {
    throw new Error((streamer.nickname || streamer.soopId) + '의 ' + formatVodDate(request.date) + ' 다시보기를 찾지 못했어요.');
  }
  let cursor = 0;
  let completed = 0;
  let best = null;
  let failure = null;
  const worker = async () => {
    while (isCurrentComparisonRequest(request) && !failure && cursor < vods.length) {
      const vod = vods[cursor++];
      try {
        const stats = await loadVodStats(
          vod,
          streamer.soopId,
          () => isCurrentComparisonRequest(request),
          true,
          () => setComparisonStatus('현재 이용자가 많아 집계 시간이 길어지고 있습니다. 날짜별 다시보기를 계속 확인하고 있어요.'),
        );
        if (!isCurrentComparisonRequest(request)) return;
        const peak = Number(stats.highest && stats.highest.viewers);
        const second = Number(stats.highest && stats.highest.second);
        const average = Number(stats.averageViewers);
        if (!Number.isFinite(peak) || !Number.isFinite(second) || !Number.isFinite(average)) {
          throw new Error((vod.title || '다시보기') + '의 비교 통계를 확인할 수 없어요.');
        }
        if (!best || peak > Number(best.stats.highest.viewers)) best = { vod, stats };
        completed += 1;
        setComparisonPickerStatus(index, (streamer.nickname || streamer.soopId) + ' · ' + completed.toLocaleString('ko-KR') + ' / ' + vods.length.toLocaleString('ko-KR') + '개 분석 완료');
      } catch (error) {
        if (!isCurrentComparisonRequest(request)) return;
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_STATS_REQUESTS, vods.length) }, () => worker()));
  if (!isCurrentComparisonRequest(request)) return null;
  if (failure) {
    throw new Error((streamer.nickname || streamer.soopId) + '의 당일 다시보기 ' + vods.length.toLocaleString('ko-KR') + '개 중 일부 통계를 불러오지 못해 비교를 완료하지 못했어요. ' + (failure.message || '잠시 후 다시 시도해 주세요.'));
  }
  if (!best) throw new Error((streamer.nickname || streamer.soopId) + '의 당일 다시보기 통계가 없어요.');
  return { streamer, vod: best.vod, stats: best.stats, vodCount: vods.length };
}

function renderComparisonResults(request, comparisons) {
  const results = $('viewerComparisonResults');
  results.replaceChildren();
  const peaks = comparisons.map((result) => Math.max(0, Number(result.stats.highest.viewers) || 0));
  const maxPeak = Math.max(1, ...peaks);
  const difference = Math.abs(peaks[0] - peaks[1]);
  const summary = document.createElement('div');
  summary.className = 'viewer-comparison-summary';
  const summaryText = document.createElement('span');
  if (peaks[0] === peaks[1]) {
    summaryText.textContent = '두 스트리머의 당일 최고 시청자 수가 같아요.';
  } else {
    const leader = comparisons[peaks[0] > peaks[1] ? 0 : 1];
    summaryText.textContent = leader.streamer.nickname + '의 당일 고점이 더 높아요.';
  }
  const summaryValue = document.createElement('strong');
  summaryValue.textContent = (peaks[0] === peaks[1] ? '' : '+') + difference.toLocaleString('ko-KR') + '명';
  summary.append(summaryText, summaryValue);

  const heading = document.createElement('div');
  heading.className = 'viewer-comparison-results-heading';
  const title = document.createElement('h3');
  title.textContent = '같은 날짜 고점 비교';
  const date = document.createElement('span');
  date.textContent = formatVodDate(request.date) + ' · 방송 시작/종료 전 5분 제외';
  heading.append(title, date);

  const grid = document.createElement('div');
  grid.className = 'viewer-comparison-result-grid';
  comparisons.forEach((result, index) => {
    const { streamer, vod, stats, vodCount } = result;
    const peak = peaks[index];
    const average = Math.max(0, Number(stats.averageViewers) || 0);
    const uplift = Math.round(peak - average);
    const upliftRate = average > 0 ? Math.round((uplift / average) * 100) : null;
    const card = document.createElement('article');
    card.className = 'viewer-comparison-result-card';
    const name = document.createElement('h4');
    name.textContent = streamer.nickname || streamer.soopId;
    const vodTitle = document.createElement('p');
    vodTitle.className = 'viewer-comparison-result-vod';
    vodTitle.textContent = vod.title || '제목 없음';
    const vodMeta = document.createElement('p');
    vodMeta.className = 'viewer-comparison-result-vod-meta';
    vodMeta.textContent = '당일 다시보기 ' + vodCount.toLocaleString('ko-KR') + '개 중 최고 고점';
    const metrics = document.createElement('div');
    metrics.className = 'viewer-comparison-result-metrics';
    metrics.append(
      comparisonMetric('최고 시청자', peak.toLocaleString('ko-KR') + '명', true),
      comparisonMetric('방송 평균', average.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '명'),
      comparisonMetric('평균 대비 순증', (uplift >= 0 ? '+' : '−') + Math.abs(uplift).toLocaleString('ko-KR') + '명'),
      comparisonMetric('평균 대비 상승률', upliftRate === null ? '계산 불가' : (upliftRate >= 0 ? '+' : '−') + Math.abs(upliftRate).toLocaleString('ko-KR') + '%'),
    );
    const bar = document.createElement('div');
    bar.className = 'viewer-comparison-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', '두 스트리머 중 최고 시청자 수 비율 ' + Math.round((peak / maxPeak) * 100) + '%');
    const fill = document.createElement('span');
    fill.style.setProperty('--comparison-bar', Math.max(3, Math.round((peak / maxPeak) * 100)) + '%');
    bar.append(fill);
    const play = document.createElement('a');
    play.className = 'viewer-comparison-play';
    play.href = playbackUrl(vod.id, stats.highest.second);
    play.target = '_blank';
    play.rel = 'noopener noreferrer';
    play.textContent = '고점 ' + formatClock(stats.highest.second) + ' · ' + peak.toLocaleString('ko-KR') + '명부터 재생 ↗';
    card.append(name, vodTitle, vodMeta, metrics, bar, play);
    grid.append(card);
  });
  results.append(heading, summary, grid);
  results.classList.remove('hidden');
}

function showComparisonError(error, request) {
  const results = $('viewerComparisonResults');
  results.replaceChildren();
  const message = document.createElement('p');
  message.className = 'viewer-comparison-error';
  message.textContent = viewerStatsErrorMessage(error, '비교 통계를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  results.append(message);
  results.classList.remove('hidden');
  setComparisonStatus('비교 통계를 모두 불러오지 못했어요. 선택한 스트리머와 날짜는 유지되어 다시 시도할 수 있습니다.', true);
  if (request) pendingComparisonRequest = null;
}

async function loadComparisonResults(request) {
  if (!isCurrentComparisonRequest(request)) return;
  comparisonRunning = true;
  comparisonGateWaiting = false;
  setComparisonStatus('선택한 날짜의 두 스트리머 다시보기와 프리미엄 통계를 확인하고 있어요. 혼잡하면 집계 시간이 길어질 수 있습니다.');
  renderComparisonSelection();
  if ($('viewerSubscriptionDialog').open) $('viewerSubscriptionDialog').close();
  const results = $('viewerComparisonResults');
  results.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'viewer-comparison-status';
  loading.textContent = '날짜가 같은 다시보기를 찾고 최고 순간과 평균 시청자를 확인하는 중…';
  results.append(loading);
  results.classList.remove('hidden');
  try {
    const vodLists = await Promise.all(request.streamers.map((streamer, index) => findComparisonVodsOnDate(streamer, request.date, request, index)));
    if (!isCurrentComparisonRequest(request)) return;
    if (vodLists.some((vods) => !vods || !vods.length)) {
      const emptyIndex = vodLists.findIndex((vods) => !vods || !vods.length);
      const streamer = request.streamers[emptyIndex];
      throw new Error((streamer.nickname || streamer.soopId) + '의 ' + formatVodDate(request.date) + ' 다시보기를 찾지 못했어요.');
    }
    setComparisonStatus('날짜별 다시보기를 찾았어요. 각 스트리머의 당일 최고 고점을 비교합니다.');
    const comparisons = await Promise.all(request.streamers.map((streamer, index) =>
      analyzeComparisonStreamer(streamer, vodLists[index], request, index)));
    if (!isCurrentComparisonRequest(request)) return;
    renderComparisonResults(request, comparisons);
    pendingComparisonRequest = null;
    setComparisonStatus('비교 결과를 불러왔어요. 각 스트리머의 당일 최고 시청자 수와 평균 대비 상승폭을 확인할 수 있습니다.');
  } catch (error) {
    if (!isCurrentComparisonRequest(request)) return;
    if (error && error.code === 'functions/permission-denied') {
      pendingComparisonRequest = request;
      comparisonRunning = false;
      comparisonGateWaiting = true;
      await refreshSubscriptionStatus({ resumeComparison: false });
      if (!isCurrentComparisonRequest(request)) return;
      if (!subscriptionState.isAdmin && !subscriptionState.subscribed) {
        setComparisonStatus('구독 승인이 만료되었거나 확인이 필요해요. 선택한 스트리머와 날짜는 유지됩니다.');
        renderComparisonSelection();
        renderSubscriptionDialogStatus();
        openSubscriptionDialog();
        return;
      }
      pendingComparisonRequest = null;
      comparisonGateWaiting = false;
    }
    showComparisonError(error, request);
  } finally {
    if (request.id === comparisonRequestSequence) {
      comparisonRunning = false;
      renderComparisonSelection();
    }
  }
}

function resumePendingComparisonIfReady() {
  const request = pendingComparisonRequest;
  if (!request || comparisonRunning || (!subscriptionState.isAdmin && !subscriptionState.subscribed)) return;
  if (!isCurrentComparisonRequest(request)) {
    pendingComparisonRequest = null;
    comparisonGateWaiting = false;
    renderComparisonSelection();
    return;
  }
  comparisonGateWaiting = false;
  comparisonRunning = true;
  void loadComparisonResults(request);
}

async function runComparison() {
  if (!comparisonSelection.every(Boolean) || comparisonRunning || comparisonGateWaiting) return;
  if (! $('viewerComparisonDate').value) {
    setComparisonStatus('비교할 날짜를 선택해 주세요.', true);
    renderComparisonSelection();
    return;
  }
  if (comparisonSelection[0].soopId.toLowerCase() === comparisonSelection[1].soopId.toLowerCase()) {
    setComparisonStatus('서로 다른 스트리머 두 명을 선택해 주세요.', true);
    renderComparisonSelection();
    return;
  }
  invalidateComparisonResult();
  const request = {
    id: comparisonRequestSequence,
    streamers: comparisonSelection.slice(),
    date: $('viewerComparisonDate').value,
    selectionKey: comparisonSelectionKey(),
  };
  pendingComparisonRequest = request;
  comparisonRunning = true;
  setComparisonStatus('비교 결과를 열 수 있는 계정인지 안전하게 확인하고 있어요.');
  renderComparisonSelection();
  try {
    await getAuthReady();
    const response = await callViewerSubscription({ action: 'periodAccess' });
    if (!isCurrentComparisonRequest(request)) return;
    const access = response.data || {};
    subscriptionState.isAdmin = access.isAdmin === true;
    subscriptionState.accountProtected = subscriptionState.accountProtected || subscriptionState.isAdmin;
    subscriptionState.subscribed = true;
    subscriptionState.expiresAt = Number(access.expiresAt) || subscriptionState.expiresAt;
    subscriptionState.loaded = true;
    renderSubscriptionControls();
    scheduleSubscriptionStatusRefresh();
    comparisonRunning = false;
    resumePendingComparisonIfReady();
  } catch (error) {
    if (!isCurrentComparisonRequest(request)) return;
    if (!error || error.code !== 'functions/permission-denied') {
      pendingComparisonRequest = null;
      comparisonRunning = false;
      comparisonGateWaiting = false;
      setComparisonStatus(viewerStatsErrorMessage(error, '비교 권한을 확인하지 못했어요. 다시 시도해 주세요.'), true);
      renderComparisonSelection();
      return;
    }
    const refreshed = await refreshSubscriptionStatus({ resumeComparison: false });
    if (!isCurrentComparisonRequest(request)) return;
    if (!refreshed) {
      pendingComparisonRequest = null;
      comparisonRunning = false;
      comparisonGateWaiting = false;
      setComparisonStatus('로그인·구독 상태를 확인하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.', true);
      renderComparisonSelection();
      return;
    }
    if (subscriptionState.isAdmin || subscriptionState.subscribed) {
      comparisonRunning = false;
      resumePendingComparisonIfReady();
      return;
    }
    comparisonRunning = false;
    comparisonGateWaiting = true;
    setComparisonStatus(subscriptionState.accountProtected
      ? subscriptionState.pending
        ? '구독 신청 승인 대기 중이에요. 승인되면 선택한 스트리머와 날짜의 비교 결과가 자동으로 열립니다.'
        : '선택한 스트리머와 날짜는 유지됩니다. 로그인 계정에 구독을 신청하고 승인을 기다려 주세요.'
      : '선택한 스트리머와 날짜는 유지됩니다. 로그인한 뒤 구독 신청을 진행해 주세요.');
    renderComparisonSelection();
    renderSubscriptionDialogStatus();
    openSubscriptionDialog();
  }
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

function showSharedPeriodPeakResult(data) {
  if (!data || data.status !== 'completed') return false;
  const peaks = new Map();
  const vodCounts = new Map();
  VIEWER_PEAK_PERIODS.forEach((period) => {
    const peak = data.periods && data.periods[String(period.days)];
    if (peak && peak.vod) {
      peaks.set(period.days, {
        vod: peak.vod,
        viewers: Number(peak.viewers) || 0,
        second: Number(peak.second) || 0,
        timestamp: Number(peak.timestamp) || parseVodTimestamp(peak.vod.regDate),
      });
    }
    vodCounts.set(period.days, Number(data.vodCounts && data.vodCounts[String(period.days)]) || 0);
  });
  renderPeriodPeakCards(peaks, vodCounts, false);
  const sourceLabel = data.cacheHit ? '공용 캐시 결과' : '공용 분석 결과';
  const generatedAt = formatSubscriptionDate(data.generatedAt);
  $('viewerPeriodStatus').textContent = sourceLabel + ' · ' + (generatedAt ? generatedAt + ' 갱신' : '최신 결과');
  $('viewerPeriodStatus').classList.remove('is-error');
  $('viewerPeriodScanButton').dataset.hasResult = 'true';
  return true;
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

async function runPeriodPeakScan({ forceRefresh = false } = {}) {
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
    try {
      const sharedResult = await callViewerStats({
        action: 'periodPeaks',
        streamerId,
        mode: forceRefresh ? 'build' : 'lookup',
        forceRefresh,
      });
      if (!isCurrentPeriodScan(scanToken, loadToken)) return;
      if (sharedResult.data && sharedResult.data.catalogChanged === true) vodPagesByNumber.clear();
      if (showSharedPeriodPeakResult(sharedResult.data || {})) return;
    } catch (cacheError) {
      if (cacheError && ['functions/resource-exhausted', 'functions/permission-denied'].includes(cacheError.code)) {
        throw cacheError;
      }
      console.warn('기간별 공용 결과를 확인하지 못해 개별 통계 캐시로 분석을 이어갑니다.', cacheError);
    }

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
    if (!failed && !pageLimitReached && !rateLimitMessage) {
      try {
        const sharedResult = await callViewerStats({ action: 'periodPeaks', streamerId, mode: 'build' });
        if (!isCurrentPeriodScan(scanToken, loadToken)) return;
        showSharedPeriodPeakResult(sharedResult.data || {});
      } catch (cacheError) {
        console.warn('기간별 공용 결과를 저장하지 못했어요. 이번 분석 결과는 화면에 유지합니다.', cacheError);
      }
    }
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
  vodPagesStreamerId = String(streamer.soopId || '').toLowerCase();
  selectedStreamer = streamer;
  $('viewerPeriodScanButton').dataset.hasResult = 'false';
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

[0, 1].forEach((index) => {
  $('viewerComparisonSearchForm' + index).addEventListener('submit', (event) => {
    event.preventDefault();
    searchComparisonStreamer(index, $('viewerComparisonSearch' + index).value);
  });
  $('viewerComparisonSearch' + index).addEventListener('input', () => {
    comparisonSearchRequestSequence[index] += 1;
    $('viewerComparisonSearchButton' + index).disabled = false;
    $('viewerComparisonSearchResults' + index).replaceChildren();
    $('viewerComparisonSearchResults' + index)._streamers = [];
    if (comparisonSelection[index]) clearComparisonStreamer(index);
  });
  $('viewerComparisonSearchResults' + index).addEventListener('click', (event) => {
    const button = event.target.closest('button[data-comparison-streamer-index]');
    if (!button) return;
    const streamers = $('viewerComparisonSearchResults' + index)._streamers || [];
    const streamer = streamers[Number(button.dataset.comparisonStreamerIndex)];
    if (streamer) selectComparisonStreamer(index, streamer);
  });
  $('viewerComparisonSelected' + index).addEventListener('click', (event) => {
    const button = event.target.closest('button[data-comparison-remove]');
    if (button) clearComparisonStreamer(Number(button.dataset.comparisonRemove));
  });
});

$('viewerComparisonDate').addEventListener('change', () => {
  invalidateComparisonResult();
  setComparisonStatus(comparisonSelection.every(Boolean)
    ? '날짜가 바뀌었어요. 이 날짜의 다시보기를 찾아 비교할 수 있습니다.'
    : '스트리머 2명과 날짜를 선택해 주세요.');
  renderComparisonSelection();
});

$('viewerComparisonRun').addEventListener('click', runComparison);
$('viewerComparisonClear').addEventListener('click', () => {
  if (comparisonRunning) return;
  comparisonSelection = [null, null];
  comparisonSearchRequestSequence = [comparisonSearchRequestSequence[0] + 1, comparisonSearchRequestSequence[1] + 1];
  [0, 1].forEach((index) => {
    $('viewerComparisonSearch' + index).value = '';
    $('viewerComparisonSearchButton' + index).disabled = false;
    $('viewerComparisonSearchResults' + index).replaceChildren();
    $('viewerComparisonSearchResults' + index)._streamers = [];
    setComparisonPickerStatus(index, '닉네임이나 SOOP ID를 검색하세요.');
  });
  $('viewerComparisonDate').value = '';
  invalidateComparisonResult();
  setComparisonStatus('스트리머 2명과 날짜를 선택해 주세요.');
  renderComparisonSelection();
});

const comparisonTodayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const comparisonToday = Object.fromEntries(comparisonTodayParts.map((part) => [part.type, part.value]));
$('viewerComparisonDate').max = comparisonToday.year + '-' + comparisonToday.month + '-' + comparisonToday.day;
renderComparisonSelection();

$('viewerPeriodScanButton').addEventListener('click', () => {
  runPeriodPeakScan({ forceRefresh: $('viewerPeriodScanButton').dataset.hasResult === 'true' });
});

$('viewerSubscriptionAction').addEventListener('click', async () => {
  if (!subscriptionState.loaded) await refreshSubscriptionStatus();
  openSubscriptionDialog();
});

$('viewerSubscriptionRefresh').addEventListener('click', refreshSubscriptionStatus);
$('viewerSubscriptionLoginCheck').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = '로그인 상태 확인 중…';
  const refreshed = await refreshSubscriptionStatus();
  if (!refreshed) renderSubscriptionDialogStatus('로그인 정보를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  button.disabled = false;
  button.textContent = '로그인 상태 확인';
  renderSubscriptionDialogStatus();
});
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
  const donorSoopId = $('viewerSubscriptionSoopId').value.trim().toLowerCase();
  if (!donorSoopId || !$('viewerSubscriptionSoopId').reportValidity()) return;
  const submit = $('viewerSubscriptionSubmit');
  submit.disabled = true;
  renderSubscriptionDialogStatus('신청을 등록하고 있어요.');
  try {
    const response = await callViewerSubscription({ action: 'request', nickname, donorSoopId });
    const result = response.data || {};
    await refreshSubscriptionStatus();
    renderSubscriptionDialogStatus(result.action === 'already-pending'
      ? '이미 대기 중인 신청이 있어요. 현재 신청 정보를 확인해 주세요.'
      : '신청을 등록했어요. 이제 운영자 방송국에 10개 후원한 뒤 자동 확인을 시작해 주세요.');
    if (result.action === 'pending' || result.action === 'already-pending') {
      $('viewerSubscriptionNickname').value = '';
      $('viewerSubscriptionSoopId').value = '';
    }
  } catch (error) {
    renderSubscriptionDialogStatus(viewerStatsErrorMessage(error, '구독 신청을 접수하지 못했어요.'));
  } finally {
    submit.disabled = false;
    renderSubscriptionDialogStatus();
  }
});

$('viewerSubscriptionDonationComplete').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!subscriptionState.pendingRequestId || !subscriptionState.pendingDonorSoopId || subscriptionState.pendingDonationCompletedAt) return;
  button.disabled = true;
  button.textContent = '자동 확인을 시작하고 있어요…';
  try {
    await callViewerSubscription({ action: 'donationComplete', requestId: subscriptionState.pendingRequestId });
    await refreshSubscriptionStatus();
    renderSubscriptionDialogStatus('후원 완료 신호를 받았어요. 알림이 일치하면 자동 승인됩니다.');
  } catch (error) {
    renderSubscriptionDialogStatus(viewerStatsErrorMessage(error, '자동 확인을 시작하지 못했어요. 신청 상태를 새로고침해 주세요.'));
  } finally {
    button.disabled = false;
    renderSubscriptionDialogStatus();
  }
});

$('viewerSubscriptionCancel').addEventListener('click', async () => {
  const cancelMessage = subscriptionState.pendingDonationCompletedAt
    ? '이미 후원 완료를 알린 신청입니다. 취소하면 자동 확인과 30일 이용권 발급이 진행되지 않습니다. 취소할까요?'
    : '구독 신청을 취소할까요?';
  if (!subscriptionState.pendingRequestId || !confirm(cancelMessage)) return;
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
renderComparisonSelection();
loadDevbarLinks();
getAuthReady().catch((error) => setSearchHint(viewerStatsErrorMessage(error, '통계 연결을 시작하지 못했어요.'), true));
