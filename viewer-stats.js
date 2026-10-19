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
const callSponsorAds = httpsCallable(functions, 'streamerFanPageSponsorAds');
const callAdminSponsorAds = httpsCallable(functions, 'streamerFanPageAdminSponsorAds');
const callSponsorLiveStatus = httpsCallable(functions, 'streamerFanPageLiveStatus');
const VIEWER_SUBSCRIPTION_MONITOR_MS = 60 * 60 * 1000;
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
const MAX_KEYWORD_COMPARE_VODS_PER_STREAMER = 10;
const VIEWER_STATS_EXCLUDED_EDGE_SECONDS = 5 * 60;
const VIEWER_STATS_INSUFFICIENT_WINDOW_CODE = 'insufficient-analysis-window';
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
let vodSortMode = 'date-desc';
let vodSearchKeyword = '';
let vodListRequestToken = 0;
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
let keywordComparisonSelection = [null, null, null, null, null];
let keywordComparisonSearchRequestSequence = [0, 0, 0, 0, 0];
let pendingKeywordComparisonRequest = null;
let keywordComparisonRequestSequence = 0;
let keywordComparisonRunning = false;
let keywordComparisonGateWaiting = false;
let keywordComparisonStatusMessage = '키워드와 스트리머 2명 이상을 선택해 주세요.';
let keywordComparisonStatusIsError = false;
let subscriptionState = {
  loaded: false,
  accountProtected: false,
  isAdmin: false,
  subscribed: false,
  expiresAt: 0,
  pending: false,
  pendingRequestId: '',
  pendingRequestedAt: 0,
  pendingDonorSoopId: '',
  pendingBalloonCost: 33,
  pendingDonationCompletedAt: 0,
  lastRequestStatus: '',
};
const viewerStatsMemoryCache = new Map();
const viewerStatsInProgress = new Map();
const sponsorLiveStatusCache = new Map();
const SPONSOR_PENDING_REQUEST_KEY = 'streamerFanPage.sponsor.pendingRequest.v1';
let sponsorRequestId = '';
let sponsorRequestRecord = null;
let sponsorRequestRail = 'left';
let sponsorProfileRequestId = 0;
let sponsorPollTimer = 0;
let sponsorRequestPreviousFocus = null;

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
  $('viewerPeriodScanButton').textContent = state.loaded && (state.isAdmin || state.subscribed)
    ? '최근 1년 분석'
    : '구독 전용 분석';
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

async function refreshSubscriptionStatus({ resumeComparison = true, resumeKeywordComparison = true } = {}) {
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
      pendingRequestedAt: Number(data.pendingRequestedAt) || 0,
      pendingDonorSoopId: typeof data.pendingDonorSoopId === 'string' ? data.pendingDonorSoopId : '',
      pendingBalloonCost: Number(data.pendingBalloonCost) || 33,
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
          ? `구독 신청 승인 대기 중이에요. ${subscriptionState.pendingBalloonCost}개 후원을 확인하면 선택한 스트리머와 날짜의 비교 결과가 자동으로 열립니다.`
          : '로그인이 확인됐어요. 별풍선 33개 구독을 신청하면 승인 후 비교 결과가 자동으로 열립니다.'
        : '선택한 스트리머와 날짜는 유지돼요. 새 탭에서 로그인한 뒤 이 화면으로 돌아와 주세요.');
      renderComparisonSelection();
    }
    if (pendingKeywordComparisonRequest && !subscriptionState.isAdmin && !subscriptionState.subscribed) {
      keywordComparisonGateWaiting = true;
      setKeywordComparisonStatus(subscriptionState.accountProtected
        ? subscriptionState.pending
          ? `구독 신청 승인 대기 중이에요. ${subscriptionState.pendingBalloonCost}개 후원을 확인하면 선택한 스트리머의 키워드 고점 비교 결과가 자동으로 열립니다.`
          : '로그인이 확인됐어요. 별풍선 33개 구독을 신청하면 승인 후 키워드 고점 비교 결과가 자동으로 열립니다.'
        : '선택한 키워드와 스트리머는 유지돼요. 로그인한 뒤 이 화면으로 돌아와 주세요.');
      renderKeywordComparisonSelection();
    }
    if ($('viewerSubscriptionDialog').open) renderSubscriptionDialogStatus();
    if (resumeComparison) resumePendingComparisonIfReady();
    if (resumeKeywordComparison) resumePendingKeywordComparisonIfReady();
    return true;
  } catch (error) {
    if (token !== subscriptionRefreshToken) return;
    if ($('viewerSubscriptionDialog').open) {
      renderSubscriptionDialogStatus(viewerStatsErrorMessage(error, '구독 상태를 확인하지 못했어요.'));
    }
    return false;
  }
}

function renderSubscriptionDialogStatus(message = '') {
  const status = $('viewerSubscriptionDialogStatus');
  const submit = $('viewerSubscriptionSubmit');
  const cancel = $('viewerSubscriptionCancel');
  const loginNote = $('viewerSubscriptionLoginNote');
  const offer = $('viewerSubscriptionOffer');
  const purchaseInfo = $('viewerSubscriptionPurchaseInfo');
  const donationStep = $('viewerSubscriptionDonationStep');
  const donationHelp = $('viewerSubscriptionDonationHelp');
  const donationLink = $('viewerSubscriptionDonationLink');
  const donationComplete = $('viewerSubscriptionDonationComplete');
  const hasPending = subscriptionState.pending && subscriptionState.pendingRequestId;
  const autoVerificationReady = !!subscriptionState.pendingDonorSoopId;
  const donationCompleted = subscriptionState.pendingDonationCompletedAt > 0;
  const pendingRequestedAt = Number(subscriptionState.pendingRequestedAt) || 0;
  const automaticMonitoringActive = pendingRequestedAt > Date.now() - VIEWER_SUBSCRIPTION_MONITOR_MS &&
    pendingRequestedAt <= Date.now();
  const pendingBalloonCost = Number(subscriptionState.pendingBalloonCost) || 33;
  const keywordComparisonContext = !!pendingKeywordComparisonRequest;
  const comparisonContext = !!pendingComparisonRequest || keywordComparisonContext;
  offer.classList.toggle('hidden', subscriptionState.isAdmin || subscriptionState.subscribed || !!hasPending);
  $('viewerSubscriptionDialogTitle').textContent = comparisonContext
    ? keywordComparisonContext ? '키워드 비교 결과 확인' : '비교 결과 확인'
    : '고점체크 구독';
  $('viewerSubscriptionDialog').querySelector('.eyebrow').textContent = comparisonContext ? 'RESULT ACCESS' : '30-DAY PASS';
  purchaseInfo.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !!hasPending);
  donationStep.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !hasPending);
  loginNote.classList.toggle('hidden', subscriptionState.isAdmin || subscriptionState.accountProtected);
  submit.classList.toggle('hidden', subscriptionState.isAdmin || !subscriptionState.accountProtected || !!hasPending);
  cancel.classList.toggle('hidden', subscriptionState.isAdmin || !hasPending);
  donationLink.classList.toggle('hidden', !autoVerificationReady);
  donationComplete.classList.toggle('hidden', !autoVerificationReady || donationCompleted);
  donationComplete.disabled = false;
  donationComplete.textContent = '후원 완료 알리기 (선택)';
  if (!autoVerificationReady) {
    donationHelp.textContent = '이 신청은 자동 확인에 필요한 SOOP 아이디 정보가 없어요. 후원 내역은 관리자가 수동 확인합니다.';
  } else if (!automaticMonitoringActive) {
    donationHelp.textContent = '신청 후 1시간 자동 감시가 종료됐어요. 신청은 자동 취소되지 않고 관리자 확인 대기 상태로 남습니다. 후원 완료 알리기는 관리자 확인에 참고하도록 선택적으로 전달할 수 있어요.';
  } else if (donationCompleted) {
    donationHelp.textContent = '후원 완료 알림을 전달했어요. 신청 등록 후 1시간 동안 자동 감시하며, 입력한 SOOP 아이디와 별풍선 수량이 유일하게 일치하면 30일 이용권이 자동 적용됩니다.';
  } else {
    donationHelp.textContent = `신청 후 1시간 동안 자동 감시해요. 신청에 입력한 SOOP 계정으로 별풍선 ${pendingBalloonCost}개를 후원해 주세요. 후원 완료 알리기는 선택이며, 누르지 않아도 SOOP 아이디와 수량이 유일하게 일치하면 자동 승인됩니다. 1시간이 지나면 신청은 취소되지 않고 관리자 확인 대기 상태로 남아요.`;
  }
  submit.textContent = subscriptionState.subscribed ? '신청 등록 · 30일 연장' : '구독 신청 등록';
  if (subscriptionState.isAdmin) {
    status.textContent = '관리자 권한으로 기간별 최고 순간과 스트리머 비교를 포함한 모든 분석 기능을 이용할 수 있어요.';
  } else if (message) {
    status.textContent = message;
  } else if (!subscriptionState.accountProtected) {
    status.textContent = comparisonContext
      ? '선택한 비교 조건은 유지됩니다. Google·Kakao 로그인 또는 스트리머 인증 후 구독을 신청할 수 있어요.'
      : '익명 계정은 구독 권한을 구매할 수 없어요. Google·Kakao 로그인 또는 스트리머 인증 후 이용해 주세요.';
  } else if (hasPending) {
    if (!autoVerificationReady) {
      status.textContent = '이전 방식으로 접수된 신청입니다. 관리자가 후원 내역을 수동 확인하며, 자동 확인을 원하면 신청을 취소하고 다시 등록해 주세요.';
    } else if (!automaticMonitoringActive) {
      status.textContent = '신청 후 1시간 자동 감시가 종료됐어요. 신청은 취소되지 않았고 관리자 확인 대기 상태로 남아 있습니다.';
    } else if (donationCompleted) {
      status.textContent = comparisonContext
        ? keywordComparisonContext
          ? '후원 알림 자동 확인 중이에요. 신청한 SOOP 아이디와 수량이 유일하게 일치하면 키워드 고점 비교 결과가 자동으로 열립니다.'
          : '후원 알림 자동 확인 중이에요. 신청한 SOOP 아이디와 수량이 유일하게 일치하면 선택한 날짜의 비교 결과가 자동으로 열립니다.'
        : '후원 알림을 자동 대조하고 있어요. 신청한 SOOP 아이디와 수량이 유일하게 일치하면 이 계정에 30일 이용권이 적용됩니다.';
    } else {
      status.textContent = `신청 등록 후 1시간 동안 자동 감시합니다. 운영자 방송국에 ${pendingBalloonCost}개 후원해 주세요. 완료 알리기는 선택이며, SOOP 아이디와 수량이 유일하게 일치하면 자동 승인됩니다. 1시간이 지나도 신청은 취소되지 않아요.`;
    }
  } else if (subscriptionState.subscribed) {
    status.textContent = formatSubscriptionDate(subscriptionState.expiresAt) + '까지 구독 중이에요. 미리 갱신해도 남은 기간에 30일이 더해집니다.';
  } else {
    status.textContent = comparisonContext
      ? keywordComparisonContext
        ? '후원자 SOOP 정보를 입력해 신청을 등록하면 1시간 자동 감시가 시작돼요. 완료 알리기는 선택이며, 아이디와 수량이 일치하면 키워드 고점 비교 결과가 자동으로 열립니다.'
        : '후원자 SOOP 정보를 입력해 신청을 등록하면 1시간 자동 감시가 시작돼요. 완료 알리기는 선택이며, 아이디와 수량이 일치하면 비교 결과가 자동으로 열립니다.'
      : '신청하면 1시간 자동 감시가 시작됩니다. 입력한 SOOP 아이디와 별풍선 수량이 유일하게 일치하면 30일 이용권이 자동 승인됩니다. 1시간 안에 확인되지 않은 신청은 취소되지 않고 관리자 확인 대기 상태로 남습니다.';
  }
}

function showViewerModal(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  const isTouchLayout = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  let initialFocus = null;
  if (isTouchLayout) {
    initialFocus = dialog.querySelector('.viewer-subscription-close, .viewer-sponsor-close') || dialog;
    if (initialFocus === dialog) dialog.tabIndex = -1;
    initialFocus.setAttribute('autofocus', '');
  }
  dialog.showModal();
  if (initialFocus) initialFocus.focus({ preventScroll: true });
}

function openSubscriptionDialog() {
  renderSubscriptionDialogStatus();
  const dialog = $('viewerSubscriptionDialog');
  showViewerModal(dialog);
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
    const favorites = document.createElement('span');
    favorites.className = 'viewer-comparison-search-popularity';
    favorites.textContent = Number.isFinite(streamer.favoriteCount)
      ? '즐겨찾기 ' + streamer.favoriteCount.toLocaleString('ko-KR') + '개'
      : '즐겨찾기 수 확인 불가';
    const id = document.createElement('span');
    id.textContent = 'SOOP ID · ' + streamer.soopId;
    copy.append(name, favorites, id);
    const select = document.createElement('span');
    select.className = 'viewer-comparison-search-select';
    select.textContent = (streamerIndex + 1) + '위 · 선택';
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
    const response = await callViewerStats({ action: 'search', query: searchQuery, sortByFavorites: true });
    if (requestId !== comparisonSearchRequestSequence[index]) return;
    const candidates = Array.isArray(response.data && response.data.streamers) ? response.data.streamers.slice() : [];
    const isStationUrl = /^https?:\/\//i.test(cleanQuery) && Boolean(idFromInput);
    if (idFromInput && !candidates.some((item) => String(item.soopId).toLowerCase() === idFromInput)
      && (isStationUrl || candidates.length === 0)) {
      candidates.unshift(streamerForId(idFromInput));
    }
    const exactIdMatches = idFromInput
      ? candidates.filter((item) => String(item.soopId).toLocaleLowerCase() === idFromInput)
      : [];
    if (exactIdMatches.length === 1) {
      selectComparisonStreamer(index, exactIdMatches[0]);
      return;
    }
    if (candidates.length === 1) {
      selectComparisonStreamer(index, candidates[0]);
      return;
    }
    renderComparisonSearchResults(index, candidates);
    const resultMessage = !candidates.length
      ? '검색 결과가 없어요. 다른 이름이나 SOOP 아이디를 입력해 주세요.'
      : response.data && response.data.favoritesSorted
        ? response.data.hasMore
          ? '즐겨찾기 수 기준 상위 3명 · 비교할 스트리머를 선택해 주세요.'
          : '즐겨찾기 수가 많은 순으로 ' + candidates.length.toLocaleString('ko-KR') + '명 · 비교할 스트리머를 선택해 주세요.'
        : '즐겨찾기 순위를 불러오지 못했어요. 아래 결과에서 스트리머를 선택해 주세요.';
    setComparisonPickerStatus(index, resultMessage, !candidates.length);
  } catch (error) {
    if (requestId === comparisonSearchRequestSequence[index]) {
      setComparisonPickerStatus(index, viewerStatsErrorMessage(error, '스트리머 검색에 실패했어요.'), true);
    }
  } finally {
    if (requestId === comparisonSearchRequestSequence[index]) button.disabled = false;
  }
}

function keywordComparisonSelectionKey() {
  return keywordComparisonSelection.map((streamer) => String(streamer && streamer.soopId || '').toLowerCase()).join('|')
    + ':' + String($('viewerKeywordComparisonKeyword').value || '').trim();
}

function isCurrentKeywordComparisonRequest(request) {
  return !!request
    && request.id === keywordComparisonRequestSequence
    && request.selectionKey === keywordComparisonSelectionKey();
}

function setKeywordComparisonStatus(message, isError = false) {
  keywordComparisonStatusMessage = message;
  keywordComparisonStatusIsError = isError;
  const status = $('viewerKeywordComparisonStatus');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function setKeywordPickerStatus(index, message, isError = false) {
  const status = $('viewerKeywordPickerStatus' + index);
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function invalidateKeywordComparisonResult() {
  keywordComparisonRequestSequence += 1;
  pendingKeywordComparisonRequest = null;
  keywordComparisonRunning = false;
  keywordComparisonGateWaiting = false;
  $('viewerKeywordComparisonResults').replaceChildren();
  $('viewerKeywordComparisonResults').classList.add('hidden');
}

function renderKeywordComparisonSelection() {
  const selectedCount = keywordComparisonSelection.filter(Boolean).length;
  const keywordInput = $('viewerKeywordComparisonKeyword');
  keywordInput.disabled = keywordComparisonRunning;
  keywordComparisonSelection.forEach((streamer, index) => {
    const search = $('viewerKeywordSearch' + index);
    const searchButton = $('viewerKeywordSearchButton' + index);
    const results = $('viewerKeywordSearchResults' + index);
    const selected = $('viewerKeywordSelected' + index);
    const picker = search.closest('.viewer-keyword-picker');
    const slotDisabled = keywordComparisonRunning || (!streamer && selectedCount >= 5);
    search.disabled = slotDisabled;
    searchButton.disabled = slotDisabled || searchButton.dataset.searching === 'true';
    picker.classList.toggle('is-selected', !!streamer);
    selected.replaceChildren();
    selected.classList.toggle('hidden', !streamer);
    if (streamer) {
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
      remove.dataset.keywordRemove = String(index);
      remove.setAttribute('aria-label', (index + 1) + '번 스트리머 선택 해제');
      remove.textContent = '×';
      remove.disabled = keywordComparisonRunning;
      selected.append(avatar, copy, remove);
    }
    if (slotDisabled && !streamer) results.replaceChildren();
  });
  const keyword = String(keywordInput.value || '').trim();
  $('viewerKeywordComparisonCount').textContent = selectedCount + ' / 5명 선택';
  $('viewerKeywordComparisonClear').disabled = (selectedCount === 0 && !keyword) || keywordComparisonRunning;
  $('viewerKeywordComparisonRun').disabled = selectedCount < 2 || selectedCount > 5 || !keyword
    || keywordComparisonRunning || keywordComparisonGateWaiting;
  $('viewerKeywordComparisonRun').textContent = keywordComparisonRunning
    ? '고점 분석 중…'
    : keywordComparisonGateWaiting
      ? '로그인·구독 확인 후 자동 진행'
      : '고점 비교';
  $('viewerKeywordComparisonStatus').textContent = keywordComparisonStatusMessage;
  $('viewerKeywordComparisonStatus').classList.toggle('is-error', keywordComparisonStatusIsError);
}

function renderKeywordComparisonSearchResults(index, streamers) {
  const results = $('viewerKeywordSearchResults' + index);
  results.replaceChildren();
  streamers.forEach((streamer, streamerIndex) => {
    const button = document.createElement('button');
    button.className = 'viewer-comparison-search-result';
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.dataset.keywordStreamerIndex = String(streamerIndex);
    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.src = streamer.avatarUrl || '';
    avatar.addEventListener('error', () => { avatar.hidden = true; }, { once: true });
    const copy = document.createElement('span');
    copy.className = 'viewer-comparison-search-copy';
    const name = document.createElement('strong');
    name.textContent = streamer.nickname || streamer.soopId;
    const favorites = document.createElement('span');
    favorites.className = 'viewer-comparison-search-popularity';
    favorites.textContent = Number.isFinite(streamer.favoriteCount)
      ? '즐겨찾기 ' + streamer.favoriteCount.toLocaleString('ko-KR') + '개'
      : '즐겨찾기 수 확인 불가';
    const id = document.createElement('span');
    id.textContent = 'SOOP ID · ' + streamer.soopId;
    copy.append(name, favorites, id);
    const select = document.createElement('span');
    select.className = 'viewer-comparison-search-select';
    select.textContent = (streamerIndex + 1) + '위 · 선택';
    button.append(avatar, copy, select);
    results.append(button);
  });
  results._streamers = streamers;
}

function selectKeywordComparisonStreamer(index, streamer) {
  const soopId = String(streamer && streamer.soopId || '').trim().toLowerCase();
  if (!SOOP_ID_PATTERN.test(soopId)) {
    setKeywordPickerStatus(index, 'SOOP ID를 확인하지 못했어요. 다른 검색어를 입력해 주세요.', true);
    return;
  }
  const duplicate = keywordComparisonSelection.findIndex((selected, selectedIndex) => selectedIndex !== index
    && selected && String(selected.soopId).toLowerCase() === soopId);
  if (duplicate >= 0) {
    setKeywordPickerStatus(index, '이미 선택한 스트리머예요. 다른 스트리머를 골라 주세요.', true);
    return;
  }
  keywordComparisonSelection[index] = { ...streamer, soopId };
  $('viewerKeywordSearch' + index).value = '';
  $('viewerKeywordSearchResults' + index).replaceChildren();
  $('viewerKeywordSearchResults' + index)._streamers = [];
  invalidateKeywordComparisonResult();
  setKeywordPickerStatus(index, '선택됐어요.');
  const count = keywordComparisonSelection.filter(Boolean).length;
  setKeywordComparisonStatus(count >= 2 && $('viewerKeywordComparisonKeyword').value.trim()
    ? '비교할 준비가 됐어요. 최신 키워드 다시보기에서 각 스트리머의 최고 시청자를 찾습니다.'
    : '키워드와 스트리머 2명 이상을 선택해 주세요.');
  renderKeywordComparisonSelection();
}

function clearKeywordComparisonStreamer(index) {
  keywordComparisonSearchRequestSequence[index] += 1;
  keywordComparisonSelection[index] = null;
  $('viewerKeywordSearchResults' + index).replaceChildren();
  $('viewerKeywordSearchResults' + index)._streamers = [];
  invalidateKeywordComparisonResult();
  setKeywordPickerStatus(index, index < 2 ? '닉네임이나 SOOP ID를 검색하세요.' : '선택 사항이에요.');
  setKeywordComparisonStatus(keywordComparisonSelection.filter(Boolean).length >= 2 && $('viewerKeywordComparisonKeyword').value.trim()
    ? '비교할 준비가 됐어요. 다시 고점 비교를 눌러 주세요.'
    : '키워드와 스트리머 2명 이상을 선택해 주세요.');
  renderKeywordComparisonSelection();
}

async function searchKeywordComparisonStreamer(index, query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    setKeywordPickerStatus(index, '닉네임, SOOP 아이디 또는 방송국 주소를 입력해 주세요.', true);
    return;
  }
  const requestId = ++keywordComparisonSearchRequestSequence[index];
  const button = $('viewerKeywordSearchButton' + index);
  const idFromInput = parseSoopId(cleanQuery);
  const searchQuery = idFromInput || cleanQuery;
  button.dataset.searching = 'true';
  button.disabled = true;
  setKeywordPickerStatus(index, '스트리머를 찾고 있어요…');
  renderKeywordComparisonSearchResults(index, []);
  try {
    await getAuthReady();
    const response = await callViewerStats({ action: 'search', query: searchQuery, sortByFavorites: true });
    if (requestId !== keywordComparisonSearchRequestSequence[index]) return;
    const candidates = Array.isArray(response.data && response.data.streamers) ? response.data.streamers.slice() : [];
    const isStationUrl = /^https?:\/\//i.test(cleanQuery) && Boolean(idFromInput);
    if (idFromInput && !candidates.some((item) => String(item.soopId).toLowerCase() === idFromInput)
      && (isStationUrl || candidates.length === 0)) {
      candidates.unshift(streamerForId(idFromInput));
    }
    const exactIdMatches = idFromInput
      ? candidates.filter((item) => String(item.soopId).toLowerCase() === idFromInput)
      : [];
    if (exactIdMatches.length === 1) {
      selectKeywordComparisonStreamer(index, exactIdMatches[0]);
      return;
    }
    if (candidates.length === 1) {
      selectKeywordComparisonStreamer(index, candidates[0]);
      return;
    }
    renderKeywordComparisonSearchResults(index, candidates);
    const resultMessage = !candidates.length
      ? '검색 결과가 없어요. 다른 이름이나 SOOP 아이디를 입력해 주세요.'
      : response.data && response.data.favoritesSorted
        ? response.data.hasMore
          ? '즐겨찾기 수 기준 상위 3명 · 비교할 스트리머를 선택해 주세요.'
          : '즐겨찾기 수가 많은 순으로 ' + candidates.length.toLocaleString('ko-KR') + '명 · 비교할 스트리머를 선택해 주세요.'
        : '즐겨찾기 순위를 불러오지 못했어요. 아래 결과에서 스트리머를 선택해 주세요.';
    setKeywordPickerStatus(index, resultMessage, !candidates.length);
  } catch (error) {
    if (requestId === keywordComparisonSearchRequestSequence[index]) {
      setKeywordPickerStatus(index, viewerStatsErrorMessage(error, '스트리머 검색에 실패했어요.'), true);
    }
  } finally {
    if (requestId === keywordComparisonSearchRequestSequence[index]) {
      button.dataset.searching = 'false';
      renderKeywordComparisonSelection();
    }
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

function sortLoadedVodCards() {
  const grid = $('viewerVodGrid');
  if (!grid) return;
  const cards = [...grid.querySelectorAll('.viewer-vod-card')].map((card, index) => ({ card, index }));
  const dateOf = ({ card }) => parseVodTimestamp(card._vod && card._vod.regDate);
  const compareDate = (a, b, ascending = false) => {
    const dateA = dateOf(a);
    const dateB = dateOf(b);
    if (Boolean(dateA) !== Boolean(dateB)) return dateA ? -1 : 1;
    const difference = dateA - dateB;
    return (ascending ? difference : -difference) || a.index - b.index;
  };
  cards.sort((a, b) => {
    if (vodSortMode === 'peak-desc' || vodSortMode === 'peak-asc') {
      const peakA = Number(a.card._peakViewers);
      const peakB = Number(b.card._peakViewers);
      const hasPeakA = Number.isFinite(peakA);
      const hasPeakB = Number.isFinite(peakB);
      if (hasPeakA !== hasPeakB) return hasPeakA ? -1 : 1;
      if (hasPeakA && peakA !== peakB) {
        return vodSortMode === 'peak-desc' ? peakB - peakA : peakA - peakB;
      }
      return compareDate(a, b);
    }

    return compareDate(a, b, vodSortMode === 'date-asc');
  });
  cards.forEach(({ card }) => grid.append(card));
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
  card._peakViewers = Number(stats.highest && stats.highest.viewers);
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
  card.dataset.statsState = 'ready';
  if (vodSortMode === 'peak-desc' || vodSortMode === 'peak-asc') sortLoadedVodCards();
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
      error.code = data.errorCode === VIEWER_STATS_INSUFFICIENT_WINDOW_CODE
        ? 'viewer-stats/insufficient-analysis-window'
        : 'functions/unavailable';
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
  const retryableCodes = new Set([
    'functions/failed-precondition',
    'functions/not-found',
    'viewer-stats/insufficient-analysis-window',
  ]);
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
  includePremiumMetrics = false,
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
  const excludedShortVods = vods.filter((vod) => {
    const durationMs = Number(vod && vod.durationMs);
    return Number.isFinite(durationMs) && durationMs > 0
      && Math.floor(durationMs / 1000) <= VIEWER_STATS_EXCLUDED_EDGE_SECONDS * 2;
  });
  const analyzableVods = vods.filter((vod) => !excludedShortVods.includes(vod));
  if (!analyzableVods.length) {
    throw new Error((streamer.nickname || streamer.soopId) + '의 당일 다시보기는 모두 10분 이하라 시작·종료 5분을 제외한 비교 구간이 없어요.');
  }
  let cursor = 0;
  let completed = 0;
  let best = null;
  let failure = null;
  let excludedShortVodCount = excludedShortVods.length;
  let dynamicallyExcludedShortVodCount = 0;
  const updateComparisonProgress = () => {
    const analyzableCount = analyzableVods.length - dynamicallyExcludedShortVodCount;
    const excludedNote = excludedShortVodCount
      ? ' · 10분 이하 ' + excludedShortVodCount.toLocaleString('ko-KR') + '개 제외'
      : '';
    setComparisonPickerStatus(index, (streamer.nickname || streamer.soopId) + ' · '
      + completed.toLocaleString('ko-KR') + ' / ' + analyzableCount.toLocaleString('ko-KR')
      + '개 분석 완료' + excludedNote);
  };
  updateComparisonProgress();
  const worker = async () => {
    while (isCurrentComparisonRequest(request) && !failure && cursor < analyzableVods.length) {
      const vod = analyzableVods[cursor++];
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
        updateComparisonProgress();
      } catch (error) {
        if (!isCurrentComparisonRequest(request)) return;
        if (error && error.code === 'viewer-stats/insufficient-analysis-window') {
          dynamicallyExcludedShortVodCount += 1;
          excludedShortVodCount += 1;
          updateComparisonProgress();
          continue;
        }
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_STATS_REQUESTS, analyzableVods.length) }, () => worker()));
  if (!isCurrentComparisonRequest(request)) return null;
  if (failure) {
    const analyzableCount = analyzableVods.length - dynamicallyExcludedShortVodCount;
    throw new Error((streamer.nickname || streamer.soopId) + '의 당일 비교 대상 다시보기 '
      + analyzableCount.toLocaleString('ko-KR') + '개 중 일부 통계를 불러오지 못해 비교를 완료하지 못했어요. '
      + (failure.message || '잠시 후 다시 시도해 주세요.'));
  }
  if (!best) {
    if (excludedShortVodCount >= vods.length) {
      throw new Error((streamer.nickname || streamer.soopId) + '의 당일 다시보기는 모두 10분 이하라 시작·종료 5분을 제외한 비교 구간이 없어요.');
    }
    throw new Error((streamer.nickname || streamer.soopId) + '의 당일 다시보기 통계가 없어요.');
  }
  return {
    streamer,
    vod: best.vod,
    stats: best.stats,
    vodCount: completed,
    excludedShortVodCount,
  };
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
    const { streamer, vod, stats, vodCount, excludedShortVodCount } = result;
    const peak = peaks[index];
    const average = Math.max(0, Number(stats.averageViewers) || 0);
    const uplift = Math.round(peak - average);
    const upliftRate = average > 0 ? Math.round((uplift / average) * 100) : null;
    const card = document.createElement('article');
    card.className = 'viewer-comparison-result-card';
    const thumbnail = document.createElement('a');
    thumbnail.className = 'viewer-comparison-result-thumb' + (vod.thumbnailUrl ? '' : ' is-missing');
    thumbnail.href = playbackUrl(vod.id, stats.highest.second);
    thumbnail.target = '_blank';
    thumbnail.rel = 'noopener noreferrer';
    thumbnail.setAttribute('aria-label', (vod.title || '다시보기') + ' 고점부터 재생');
    if (vod.thumbnailUrl) {
      const image = document.createElement('img');
      image.src = vod.thumbnailUrl;
      image.alt = (vod.title || '다시보기') + ' 썸네일';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        image.remove();
        thumbnail.classList.add('is-missing');
      }, { once: true });
      thumbnail.append(image);
    }
    const body = document.createElement('div');
    body.className = 'viewer-comparison-result-body';
    const name = document.createElement('h4');
    name.textContent = streamer.nickname || streamer.soopId;
    const vodTitle = document.createElement('p');
    vodTitle.className = 'viewer-comparison-result-vod';
    vodTitle.textContent = vod.title || '제목 없음';
    const vodMeta = document.createElement('p');
    vodMeta.className = 'viewer-comparison-result-vod-meta';
    vodMeta.textContent = '당일 다시보기 ' + vodCount.toLocaleString('ko-KR') + '개 분석'
      + (excludedShortVodCount ? ' · 10분 이하 ' + excludedShortVodCount.toLocaleString('ko-KR') + '개 제외' : '')
      + ' 중 최고 고점';
    const metrics = document.createElement('div');
    metrics.className = 'viewer-comparison-result-metrics';
    metrics.append(
      comparisonMetric('최고 시청자', peak.toLocaleString('ko-KR') + '명', true),
      comparisonMetric('방송 평균', average.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '명'),
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
    body.append(name, vodTitle, vodMeta, metrics, bar, play);
    card.append(thumbnail, body);
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
    setComparisonStatus('비교 결과를 불러왔어요. 각 스트리머의 당일 최고 시청자 수와 평균 대비 상승률을 확인할 수 있습니다.');
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

function keywordComparisonSlotIndex(streamer) {
  return keywordComparisonSelection.findIndex((selected) => selected
    && String(selected.soopId).toLowerCase() === String(streamer && streamer.soopId || '').toLowerCase());
}

async function findKeywordComparisonVods(streamer, request) {
  if (!isCurrentKeywordComparisonRequest(request)) return null;
  const slotIndex = keywordComparisonSlotIndex(streamer);
  if (slotIndex >= 0) setKeywordPickerStatus(slotIndex, (streamer.nickname || streamer.soopId) + ' · 키워드 다시보기 검색 중…');
  const response = await callViewerStats({
    action: 'vods',
    streamerId: streamer.soopId,
    page: 1,
    keyword: request.keyword,
  });
  if (!isCurrentKeywordComparisonRequest(request)) return null;
  const data = response.data || {};
  const vods = Array.isArray(data.vods) ? data.vods : [];
  const totalMatches = Math.max(0, Number(data.total) || 0);
  if (!vods.length) {
    throw new Error((streamer.nickname || streamer.soopId) + '의 다시보기에서 “' + request.keyword + '” 키워드 검색 결과가 없어요.');
  }
  const selectedVods = vods.slice(0, MAX_KEYWORD_COMPARE_VODS_PER_STREAMER);
  if (slotIndex >= 0) {
    setKeywordPickerStatus(slotIndex, (streamer.nickname || streamer.soopId) + ' · 검색 결과 '
      + totalMatches.toLocaleString('ko-KR') + '개 중 최신 ' + selectedVods.length.toLocaleString('ko-KR') + '개 분석 예정');
  }
  return { streamer, vods: selectedVods, totalMatches };
}

async function analyzeKeywordComparisonVods(request, vodGroups) {
  const resultsByStreamer = new Map();
  const tasks = [];
  vodGroups.forEach((group) => {
    const excludedShortVodCount = group.vods.filter((vod) => {
      const durationMs = Number(vod && vod.durationMs);
      return Number.isFinite(durationMs) && durationMs > 0
        && Math.floor(durationMs / 1000) <= VIEWER_STATS_EXCLUDED_EDGE_SECONDS * 2;
    }).length;
    resultsByStreamer.set(String(group.streamer.soopId).toLowerCase(), {
      ...group,
      best: null,
      completed: 0,
      excludedShortVodCount,
    });
    group.vods.forEach((vod) => {
      const durationMs = Number(vod && vod.durationMs);
      if (Number.isFinite(durationMs) && durationMs > 0
        && Math.floor(durationMs / 1000) <= VIEWER_STATS_EXCLUDED_EDGE_SECONDS * 2) return;
      tasks.push({ streamer: group.streamer, vod });
    });
  });
  if (!tasks.length) throw new Error('키워드에 맞는 다시보기가 모두 10분 이하라 분석할 수 없어요.');

  let cursor = 0;
  let finished = 0;
  let failure = null;
  const updateProgress = () => {
    vodGroups.forEach((group) => {
      const slotIndex = keywordComparisonSlotIndex(group.streamer);
      const result = resultsByStreamer.get(String(group.streamer.soopId).toLowerCase());
      if (slotIndex < 0 || !result) return;
      setKeywordPickerStatus(slotIndex, (group.streamer.nickname || group.streamer.soopId) + ' · '
        + result.completed.toLocaleString('ko-KR') + ' / ' + group.vods.length.toLocaleString('ko-KR')
        + '개 분석 완료' + (result.excludedShortVodCount ? ' · 10분 이하 '
          + result.excludedShortVodCount.toLocaleString('ko-KR') + '개 제외' : ''));
    });
    setKeywordComparisonStatus('키워드 다시보기 ' + finished.toLocaleString('ko-KR') + ' / '
      + tasks.length.toLocaleString('ko-KR') + '개 분석 중 · 최대 3개씩 처리합니다.');
  };
  updateProgress();
  const worker = async () => {
    while (isCurrentKeywordComparisonRequest(request) && !failure && cursor < tasks.length) {
      const task = tasks[cursor++];
      const result = resultsByStreamer.get(String(task.streamer.soopId).toLowerCase());
      try {
        const stats = await loadVodStats(
          task.vod,
          task.streamer.soopId,
          () => isCurrentKeywordComparisonRequest(request),
          true,
          () => setKeywordComparisonStatus('현재 이용자가 많아 집계 시간이 길어지고 있습니다. 키워드 고점 분석을 계속 진행하고 있어요.'),
        );
        if (!isCurrentKeywordComparisonRequest(request)) return;
        const peak = Number(stats.highest && stats.highest.viewers);
        const second = Number(stats.highest && stats.highest.second);
        if (!Number.isFinite(peak) || !Number.isFinite(second)) {
          throw new Error((task.vod.title || '다시보기') + '의 최고 시청자 통계를 확인할 수 없어요.');
        }
        if (!result.best || peak > Number(result.best.stats.highest.viewers)) result.best = { vod: task.vod, stats };
        result.completed += 1;
        finished += 1;
        updateProgress();
      } catch (error) {
        if (!isCurrentKeywordComparisonRequest(request)) return;
        if (error && error.code === 'viewer-stats/insufficient-analysis-window') {
          result.excludedShortVodCount += 1;
          finished += 1;
          updateProgress();
          continue;
        }
        failure = { streamer: task.streamer, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_STATS_REQUESTS, tasks.length) }, () => worker()));
  if (!isCurrentKeywordComparisonRequest(request)) return null;
  if (failure) {
    const name = failure.streamer.nickname || failure.streamer.soopId;
    throw new Error(name + '의 키워드 다시보기 통계를 모두 불러오지 못했어요. '
      + (failure.error && failure.error.message || '잠시 후 다시 시도해 주세요.'));
  }
  const results = [];
  for (const group of vodGroups) {
    const item = resultsByStreamer.get(String(group.streamer.soopId).toLowerCase());
    if (!item.best) {
      throw new Error((group.streamer.nickname || group.streamer.soopId)
        + '의 검색 결과에서 분석 가능한 다시보기를 찾지 못했어요. 10분 초과 영상을 확인해 주세요.');
    }
    results.push({
      streamer: item.streamer,
      vod: item.best.vod,
      stats: item.best.stats,
      totalMatches: item.totalMatches,
      analyzedCount: item.completed,
      excludedShortVodCount: item.excludedShortVodCount,
    });
  }
  return results;
}

function renderKeywordComparisonResults(request, comparisons) {
  const results = $('viewerKeywordComparisonResults');
  results.replaceChildren();
  const ordered = comparisons.slice().sort((a, b) => Number(b.stats.highest.viewers) - Number(a.stats.highest.viewers));
  const peaks = ordered.map((result) => Math.max(0, Number(result.stats.highest.viewers) || 0));
  const maxPeak = Math.max(1, ...peaks);
  const winner = ordered[0];
  const runnerUpPeak = peaks.length > 1 ? peaks[1] : 0;
  const summary = document.createElement('div');
  summary.className = 'viewer-comparison-summary';
  const summaryText = document.createElement('span');
  summaryText.textContent = '“' + request.keyword + '” 검색 결과 중 고점이 가장 높은 스트리머';
  const summaryValue = document.createElement('strong');
  summaryValue.textContent = (winner.streamer.nickname || winner.streamer.soopId) + ' · '
    + Number(winner.stats.highest.viewers).toLocaleString('ko-KR') + '명'
    + (peaks.length > 1 ? ' · 다음 순위보다 +' + Math.max(0, peaks[0] - runnerUpPeak).toLocaleString('ko-KR') + '명' : '');
  summary.append(summaryText, summaryValue);

  const heading = document.createElement('div');
  heading.className = 'viewer-comparison-results-heading';
  const title = document.createElement('h3');
  title.textContent = '키워드 다시보기 최고 시청자 비교';
  const meta = document.createElement('span');
  meta.textContent = '“' + request.keyword + '” · ' + comparisons.length + '명 · 시작/종료 전 5분 제외';
  heading.append(title, meta);

  const grid = document.createElement('div');
  grid.className = 'viewer-keyword-result-grid';
  ordered.forEach((result, index) => {
    const { streamer, vod, stats, totalMatches, analyzedCount, excludedShortVodCount } = result;
    const peak = Math.max(0, Number(stats.highest.viewers) || 0);
    const card = document.createElement('article');
    card.className = 'viewer-comparison-result-card viewer-keyword-result-card' + (index === 0 ? ' is-leading' : '');
    const thumbnail = document.createElement('a');
    thumbnail.className = 'viewer-comparison-result-thumb' + (vod.thumbnailUrl ? '' : ' is-missing');
    thumbnail.href = playbackUrl(vod.id, stats.highest.second);
    thumbnail.target = '_blank';
    thumbnail.rel = 'noopener noreferrer';
    thumbnail.setAttribute('aria-label', (vod.title || '다시보기') + ' 고점부터 재생');
    if (vod.thumbnailUrl) {
      const image = document.createElement('img');
      image.src = vod.thumbnailUrl;
      image.alt = (vod.title || '다시보기') + ' 썸네일';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        image.remove();
        thumbnail.classList.add('is-missing');
      }, { once: true });
      thumbnail.append(image);
    }
    const body = document.createElement('div');
    body.className = 'viewer-comparison-result-body';
    const name = document.createElement('h4');
    name.textContent = (index + 1) + '위 · ' + (streamer.nickname || streamer.soopId);
    const vodTitle = document.createElement('p');
    vodTitle.className = 'viewer-comparison-result-vod';
    vodTitle.textContent = vod.title || '제목 없음';
    const vodMeta = document.createElement('p');
    vodMeta.className = 'viewer-comparison-result-vod-meta';
    vodMeta.textContent = '방송일 ' + formatVodDate(vod.regDate) + ' · 검색 결과 ' + totalMatches.toLocaleString('ko-KR')
      + '개 중 최신 ' + analyzedCount.toLocaleString('ko-KR') + '개 분석'
      + (excludedShortVodCount ? ' · 10분 이하 ' + excludedShortVodCount.toLocaleString('ko-KR') + '개 제외' : '');
    const metrics = document.createElement('div');
    metrics.className = 'viewer-comparison-result-metrics viewer-keyword-result-metrics';
    metrics.append(
      comparisonMetric('최고 시청자', peak.toLocaleString('ko-KR') + '명', true),
      comparisonMetric('고점 시각', formatClock(stats.highest.second)),
      comparisonMetric('분석한 다시보기', analyzedCount.toLocaleString('ko-KR') + '개'),
    );
    const bar = document.createElement('div');
    bar.className = 'viewer-comparison-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', '선택한 스트리머 중 최고 시청자 수 비율 ' + Math.round((peak / maxPeak) * 100) + '%');
    const fill = document.createElement('span');
    fill.style.setProperty('--comparison-bar', Math.max(3, Math.round((peak / maxPeak) * 100)) + '%');
    bar.append(fill);
    const play = document.createElement('a');
    play.className = 'viewer-comparison-play';
    play.href = playbackUrl(vod.id, stats.highest.second);
    play.target = '_blank';
    play.rel = 'noopener noreferrer';
    play.textContent = '고점 ' + formatClock(stats.highest.second) + ' · ' + peak.toLocaleString('ko-KR') + '명부터 재생 ↗';
    body.append(name, vodTitle, vodMeta, metrics, bar, play);
    card.append(thumbnail, body);
    grid.append(card);
  });
  results.append(heading, summary, grid);
  results.classList.remove('hidden');
}

function showKeywordComparisonError(error) {
  const results = $('viewerKeywordComparisonResults');
  results.replaceChildren();
  const message = document.createElement('p');
  message.className = 'viewer-comparison-error';
  message.textContent = viewerStatsErrorMessage(error, '키워드 비교를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.');
  results.append(message);
  results.classList.remove('hidden');
}

async function loadKeywordComparisonResults(request) {
  if (!isCurrentKeywordComparisonRequest(request)) return;
  keywordComparisonRunning = true;
  keywordComparisonGateWaiting = false;
  setKeywordComparisonStatus('각 스트리머의 최신 키워드 다시보기에서 고점 통계를 확인하고 있어요.');
  renderKeywordComparisonSelection();
  if ($('viewerSubscriptionDialog').open) $('viewerSubscriptionDialog').close();
  const results = $('viewerKeywordComparisonResults');
  results.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'viewer-keyword-comparison-loading';
  loading.textContent = '키워드 검색 결과를 찾고 최고 시청자를 계산하는 중…';
  results.append(loading);
  results.classList.remove('hidden');
  try {
    const groups = await Promise.all(request.streamers.map((streamer) => findKeywordComparisonVods(streamer, request)));
    if (!isCurrentKeywordComparisonRequest(request)) return;
    const comparisons = await analyzeKeywordComparisonVods(request, groups);
    if (!isCurrentKeywordComparisonRequest(request)) return;
    renderKeywordComparisonResults(request, comparisons);
    pendingKeywordComparisonRequest = null;
    setKeywordComparisonStatus('비교가 끝났어요. 검색 결과마다 최신 10개까지 분석한 뒤 최고 고점 순으로 표시합니다.');
  } catch (error) {
    if (!isCurrentKeywordComparisonRequest(request)) return;
    if (error && error.code === 'functions/permission-denied') {
      pendingKeywordComparisonRequest = request;
      keywordComparisonRunning = false;
      keywordComparisonGateWaiting = true;
      const refreshed = await refreshSubscriptionStatus({ resumeComparison: false, resumeKeywordComparison: false });
      if (!isCurrentKeywordComparisonRequest(request)) return;
      if (refreshed && !subscriptionState.isAdmin && !subscriptionState.subscribed) {
        setKeywordComparisonStatus('구독을 확인하지 못했어요. 선택한 키워드와 스트리머는 유지됩니다.');
        renderKeywordComparisonSelection();
        openSubscriptionDialog();
        return;
      }
      pendingKeywordComparisonRequest = null;
      keywordComparisonGateWaiting = false;
      showKeywordComparisonError(new Error('서버에서 구독 권한을 확인하지 못했어요. 상태를 새로고침한 뒤 다시 시도해 주세요.'));
      setKeywordComparisonStatus('구독 권한 확인에 실패했어요. 잠시 후 다시 시도해 주세요.', true);
      return;
    }
    pendingKeywordComparisonRequest = null;
    showKeywordComparisonError(error);
    setKeywordComparisonStatus(viewerStatsErrorMessage(error, '비교 통계를 모두 불러오지 못했어요. 선택한 조건을 유지해 다시 시도할 수 있습니다.'), true);
  } finally {
    if (request.id === keywordComparisonRequestSequence) {
      keywordComparisonRunning = false;
      renderKeywordComparisonSelection();
    }
  }
}

function resumePendingKeywordComparisonIfReady() {
  const request = pendingKeywordComparisonRequest;
  if (!request || keywordComparisonRunning || (!subscriptionState.isAdmin && !subscriptionState.subscribed)) return;
  if (!isCurrentKeywordComparisonRequest(request)) {
    pendingKeywordComparisonRequest = null;
    keywordComparisonGateWaiting = false;
    renderKeywordComparisonSelection();
    return;
  }
  keywordComparisonGateWaiting = false;
  keywordComparisonRunning = true;
  void loadKeywordComparisonResults(request);
}

async function runKeywordComparison() {
  const keyword = String($('viewerKeywordComparisonKeyword').value || '').trim();
  const streamers = keywordComparisonSelection.filter(Boolean);
  if (!keyword) {
    setKeywordComparisonStatus('다시보기 키워드를 입력해 주세요.', true);
    renderKeywordComparisonSelection();
    return;
  }
  if (streamers.length < 2 || streamers.length > 5) {
    setKeywordComparisonStatus('비교할 스트리머를 2~5명 선택해 주세요.', true);
    renderKeywordComparisonSelection();
    return;
  }
  const uniqueIds = new Set(streamers.map((streamer) => String(streamer.soopId).toLowerCase()));
  if (uniqueIds.size !== streamers.length) {
    setKeywordComparisonStatus('서로 다른 스트리머를 선택해 주세요.', true);
    renderKeywordComparisonSelection();
    return;
  }
  invalidateKeywordComparisonResult();
  const request = {
    id: keywordComparisonRequestSequence,
    keyword,
    streamers,
    selectionKey: keywordComparisonSelectionKey(),
  };
  pendingKeywordComparisonRequest = request;
  keywordComparisonRunning = true;
  setKeywordComparisonStatus('비교 결과를 열 수 있는 계정인지 확인하고 있어요.');
  renderKeywordComparisonSelection();
  try {
    await getAuthReady();
    const response = await callViewerSubscription({ action: 'periodAccess' });
    if (!isCurrentKeywordComparisonRequest(request)) return;
    const access = response.data || {};
    subscriptionState.isAdmin = access.isAdmin === true;
    subscriptionState.accountProtected = subscriptionState.accountProtected || subscriptionState.isAdmin;
    subscriptionState.subscribed = true;
    subscriptionState.expiresAt = Number(access.expiresAt) || subscriptionState.expiresAt;
    subscriptionState.loaded = true;
    renderSubscriptionControls();
    scheduleSubscriptionStatusRefresh();
    keywordComparisonRunning = false;
    resumePendingKeywordComparisonIfReady();
  } catch (error) {
    if (!isCurrentKeywordComparisonRequest(request)) return;
    if (!error || error.code !== 'functions/permission-denied') {
      pendingKeywordComparisonRequest = null;
      keywordComparisonRunning = false;
      keywordComparisonGateWaiting = false;
      setKeywordComparisonStatus(viewerStatsErrorMessage(error, '구독 권한을 확인하지 못했어요. 다시 시도해 주세요.'), true);
      renderKeywordComparisonSelection();
      return;
    }
    const refreshed = await refreshSubscriptionStatus({ resumeComparison: false, resumeKeywordComparison: false });
    if (!isCurrentKeywordComparisonRequest(request)) return;
    if (!refreshed) {
      pendingKeywordComparisonRequest = null;
      keywordComparisonRunning = false;
      keywordComparisonGateWaiting = false;
      setKeywordComparisonStatus('로그인·구독 상태를 확인하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.', true);
      renderKeywordComparisonSelection();
      return;
    }
    if (subscriptionState.isAdmin || subscriptionState.subscribed) {
      keywordComparisonRunning = false;
      resumePendingKeywordComparisonIfReady();
      return;
    }
    keywordComparisonRunning = false;
    keywordComparisonGateWaiting = true;
    setKeywordComparisonStatus(subscriptionState.accountProtected
      ? subscriptionState.pending
        ? '구독 신청 승인 대기 중이에요. 승인되면 키워드 고점 비교 결과가 자동으로 열립니다.'
        : '선택한 키워드와 스트리머는 유지됩니다. 로그인 계정에 구독을 신청해 주세요.'
      : '선택한 키워드와 스트리머는 유지됩니다. 로그인한 뒤 구독 신청을 진행해 주세요.');
    renderKeywordComparisonSelection();
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
  const includePremiumMetrics = false;
  loadVodStats(
    vod,
    streamerId,
    () => card.isConnected && loadToken === activeLoadToken,
    includePremiumMetrics,
    () => showQueueWaitMessage(card, loadToken),
  )
    .then((stats) => {
      if (!card.isConnected || loadToken !== activeLoadToken) return;
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
    ? loadedCount.toLocaleString('ko-KR') + '개 표시 · ' + (vodSearchKeyword ? '검색 결과 ' : '전체 ') + vodTotal.toLocaleString('ko-KR') + '개'
    : vodSearchKeyword ? '검색 결과 0개' : '등록된 다시보기 없음';
}

async function loadVodPage(loadToken, page) {
  const requestToken = vodListRequestToken;
  const keyword = vodSearchKeyword;
  if (!selectedStreamer || loadToken !== activeLoadToken) return;
  $('viewerLoadMore').disabled = true;
  $('viewerLoadMore').textContent = page === 1 ? '다시보기를 불러오는 중…' : '불러오는 중…';
  $('viewerVodStatus').textContent = keyword
    ? (page === 1 ? '키워드 검색 결과를 불러오고 있어요.' : '다음 검색 결과를 불러오고 있어요.')
    : (page === 1 ? 'SOOP 다시보기 목록을 불러오고 있어요.' : '다음 다시보기를 불러오고 있어요.');
  try {
    const result = await callViewerStats({ action: 'vods', streamerId: selectedStreamer.soopId, page, keyword });
    if (loadToken !== activeLoadToken || requestToken !== vodListRequestToken || keyword !== vodSearchKeyword) return;
    const payload = result.data || {};
    const vods = Array.isArray(payload.vods) ? payload.vods : [];
    vodTotal = Math.max(0, Number(payload.total) || 0);
    nextPage = Number(payload.page) + 1;
    hasMoreVods = payload.hasMore === true;
    if (!keyword) vodPagesByNumber.set(page, { vods, total: vodTotal, hasMore: hasMoreVods });
    if (page === 1 && !vods.length) {
      $('viewerVodStatus').textContent = keyword
        ? '“' + keyword + '” 검색 결과가 없어요.'
        : '이 방송국에 등록된 다시보기가 없어요.';
    } else {
      $('viewerVodStatus').textContent = keyword
        ? '“' + keyword + '” 검색 결과 ' + vodTotal.toLocaleString('ko-KR') + '개 · 화면에 가까운 영상부터 분석합니다.'
        : '다시보기별 유저 수 그래프를 불러오고 있어요. 화면에 가까운 영상부터 분석합니다.';
    }
    const knownIds = new Set([...$('viewerVodGrid').querySelectorAll('[data-vod-id]')].map((card) => card.dataset.vodId));
    vods.forEach((vod) => {
      if (!vod || !/^\d{1,20}$/.test(String(vod.id || '')) || knownIds.has(String(vod.id))) return;
      knownIds.add(String(vod.id));
      const card = createVodCard(vod, loadToken);
      $('viewerVodGrid').append(card);
      observeVodCard(card);
    });
    sortLoadedVodCards();
    updateVodHeading();
    $('viewerLoadMore').classList.toggle('hidden', !hasMoreVods);
  } catch (error) {
    if (loadToken !== activeLoadToken || requestToken !== vodListRequestToken || keyword !== vodSearchKeyword) return;
    $('viewerVodStatus').textContent = viewerStatsErrorMessage(error, '다시보기 목록을 불러오지 못했어요.');
  } finally {
    if (loadToken === activeLoadToken && requestToken === vodListRequestToken && keyword === vodSearchKeyword) {
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
            false,
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
  vodListRequestToken += 1;
  periodScanToken += 1;
  cancelQueuedStatsRequests();
  vodPagesByNumber = new Map();
  vodPagesStreamerId = String(streamer.soopId || '').toLowerCase();
  selectedStreamer = streamer;
  vodSearchKeyword = '';
  $('viewerVodSearchInput').value = '';
  $('viewerVodSearchButton').disabled = false;
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
    : '분석 버튼을 누르면 구독 안내를 확인할 수 있습니다.';
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

$('viewerVodSearchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedStreamer) return;
  vodSearchKeyword = $('viewerVodSearchInput').value.trim();
  vodListRequestToken += 1;
  const requestToken = vodListRequestToken;
  cancelQueuedStatsRequests();
  if (statsObserver) statsObserver.disconnect();
  $('viewerVodGrid').replaceChildren();
  vodTotal = 0;
  nextPage = 1;
  hasMoreVods = false;
  $('viewerLoadMore').classList.add('hidden');
  $('viewerLoadMore').disabled = false;
  updateVodHeading();
  $('viewerVodSearchButton').disabled = true;
  try {
    await loadVodPage(activeLoadToken, 1);
  } finally {
    if (requestToken === vodListRequestToken) $('viewerVodSearchButton').disabled = false;
  }
});

$('viewerVodSort').addEventListener('change', (event) => {
  vodSortMode = event.target.value;
  sortLoadedVodCards();
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

for (let index = 0; index < 5; index += 1) {
  $('viewerKeywordSearchForm' + index).addEventListener('submit', (event) => {
    event.preventDefault();
    searchKeywordComparisonStreamer(index, $('viewerKeywordSearch' + index).value);
  });
  $('viewerKeywordSearch' + index).addEventListener('input', () => {
    keywordComparisonSearchRequestSequence[index] += 1;
    $('viewerKeywordSearchButton' + index).dataset.searching = 'false';
    $('viewerKeywordSearchResults' + index).replaceChildren();
    $('viewerKeywordSearchResults' + index)._streamers = [];
    if (keywordComparisonSelection[index]) clearKeywordComparisonStreamer(index);
    else renderKeywordComparisonSelection();
  });
  $('viewerKeywordSearchResults' + index).addEventListener('click', (event) => {
    const button = event.target.closest('button[data-keyword-streamer-index]');
    if (!button) return;
    const streamers = $('viewerKeywordSearchResults' + index)._streamers || [];
    const streamer = streamers[Number(button.dataset.keywordStreamerIndex)];
    if (streamer) selectKeywordComparisonStreamer(index, streamer);
  });
  $('viewerKeywordSelected' + index).addEventListener('click', (event) => {
    const button = event.target.closest('button[data-keyword-remove]');
    if (button) clearKeywordComparisonStreamer(Number(button.dataset.keywordRemove));
  });
}

$('viewerKeywordComparisonKeyword').addEventListener('input', () => {
  invalidateKeywordComparisonResult();
  setKeywordComparisonStatus(keywordComparisonSelection.filter(Boolean).length >= 2
    ? '키워드가 바뀌었어요. 다시 고점 비교를 눌러 주세요.'
    : '키워드와 스트리머 2명 이상을 선택해 주세요.');
  renderKeywordComparisonSelection();
});

$('viewerKeywordComparisonRun').addEventListener('click', runKeywordComparison);
$('viewerKeywordComparisonClear').addEventListener('click', () => {
  if (keywordComparisonRunning) return;
  keywordComparisonSelection = [null, null, null, null, null];
  keywordComparisonSearchRequestSequence = keywordComparisonSearchRequestSequence.map((value) => value + 1);
  for (let index = 0; index < 5; index += 1) {
    $('viewerKeywordSearch' + index).value = '';
    $('viewerKeywordSearchButton' + index).dataset.searching = 'false';
    $('viewerKeywordSearchResults' + index).replaceChildren();
    $('viewerKeywordSearchResults' + index)._streamers = [];
    setKeywordPickerStatus(index, index < 2 ? '닉네임이나 SOOP ID를 검색하세요.' : '선택 사항이에요.');
  }
  $('viewerKeywordComparisonKeyword').value = '';
  invalidateKeywordComparisonResult();
  setKeywordComparisonStatus('키워드와 스트리머 2명 이상을 선택해 주세요.');
  renderKeywordComparisonSelection();
});
renderKeywordComparisonSelection();

$('viewerPeriodScanButton').addEventListener('click', () => {
  runPeriodPeakScan({ forceRefresh: $('viewerPeriodScanButton').dataset.hasResult === 'true' });
});

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
      : '신청을 등록했어요. 1시간 자동 감시가 시작됐습니다. 운영자 방송국에 33개를 후원해 주세요.');
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
  button.textContent = '후원 완료 시각을 알리고 있어요…';
  try {
    await callViewerSubscription({ action: 'donationComplete', requestId: subscriptionState.pendingRequestId });
    await refreshSubscriptionStatus();
    renderSubscriptionDialogStatus('후원 완료 알림을 전달했어요. 자동 감시는 신청 후 1시간까지이며, 이후 미확인 신청은 관리자 확인 대기 상태로 남습니다.');
  } catch (error) {
    renderSubscriptionDialogStatus(viewerStatsErrorMessage(error, '후원 완료 알림을 전달하지 못했어요. 자동 감시는 신청 후 1시간 동안 진행됩니다.'));
  } finally {
    button.disabled = false;
    renderSubscriptionDialogStatus();
  }
});

$('viewerSubscriptionCancel').addEventListener('click', async () => {
  const cancelMessage = subscriptionState.pendingDonationCompletedAt
    ? '이미 후원 완료를 알린 신청입니다. 취소하면 후원 감시와 자동 승인이 중단됩니다. 취소할까요?'
    : '구독 신청을 취소하면 후원 감시와 자동 승인이 중단됩니다. 이미 후원했다면 취소하지 말고 신청 상태를 확인해 주세요. 취소할까요?';
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

function setSponsorHint(id, message, isError = false) {
  const hint = $(id);
  if (!hint) return;
  hint.textContent = message;
  hint.classList.toggle('is-error', isError);
}

function makeSponsorTitle() {
  const title = document.createElement('p');
  title.className = 'viewer-sponsor-rail-title';
  title.textContent = '오늘의 후원 스트리머';
  return title;
}

function makeSponsorOpenCard(rail) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'viewer-sponsor-card viewer-sponsor-card-open';
  button.dataset.sponsorRail = rail;
  button.setAttribute('aria-label', '스트리머 홍보하기');
  const icon = document.createElement('span');
  icon.className = 'viewer-sponsor-open-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '+';
  const copy = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = '스트리머 홍보하기';
  copy.append(name);
  button.append(icon, copy);
  button.addEventListener('click', () => openSponsorRequest(button));
  return button;
}

function makeSponsorPendingSlot() {
  const card = document.createElement('div');
  card.className = 'viewer-sponsor-card viewer-sponsor-card-pending';
  const icon = document.createElement('span');
  icon.className = 'viewer-sponsor-open-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '…';
  const copy = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = '신청 확인 중';
  const note = document.createElement('small');
  note.textContent = '후원 내역 확인 대기';
  copy.append(name, note);
  card.append(icon, copy);
  return card;
}

function makeSponsorLivePreview() {
  const preview = document.createElement('span');
  preview.className = 'viewer-sponsor-live-preview';
  preview.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span');
  thumb.className = 'viewer-sponsor-live-preview-thumb';
  thumb.textContent = '방송 상태를 확인합니다';
  const image = document.createElement('img');
  image.alt = '';
  image.hidden = true;
  const label = document.createElement('span');
  label.className = 'viewer-sponsor-live-preview-label';
  label.textContent = 'LIVE';
  label.hidden = true;
  thumb.append(image, label);
  preview.append(thumb);
  return { preview, thumb, image, label };
}

function loadSponsorLivePreview(card, previewParts) {
  if (card.dataset.liveState) return;
  const soopId = card.dataset.soopId;
  if (!soopId) return;
  card.dataset.liveState = 'loading';
  previewParts.thumb.firstChild.textContent = '방송 상태를 확인합니다';
  let statusPromise = sponsorLiveStatusCache.get(soopId);
  if (!statusPromise) {
    statusPromise = callSponsorLiveStatus({ streamerId: soopId }).then((response) => response.data || {});
    sponsorLiveStatusCache.set(soopId, statusPromise);
  }
  statusPromise.then((status) => {
    if (status.isLive && status.thumbnailUrl) {
      previewParts.thumb.firstChild.textContent = '';
      previewParts.image.src = status.thumbnailUrl;
      previewParts.image.hidden = false;
      previewParts.label.hidden = false;
      card.dataset.liveState = 'loaded';
    } else {
      previewParts.thumb.firstChild.textContent = '현재 방송 중이 아닙니다';
      card.dataset.liveState = 'offline';
    }
  }).catch(() => {
    sponsorLiveStatusCache.delete(soopId);
    previewParts.thumb.firstChild.textContent = '라이브 정보를 불러오지 못했습니다';
    card.dataset.liveState = 'error';
  });
}

function makeSponsorAdCard(ad, rail) {
  const card = document.createElement('a');
  card.className = 'viewer-sponsor-card';
  card.href = ad.stationUrl;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.dataset.soopId = ad.soopId;
  card.setAttribute('aria-label', `${ad.nickname} 방송국 새 탭에서 열기`);
  const image = document.createElement('img');
  image.src = ad.avatarUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    image.hidden = true;
    fallback.hidden = false;
  }, { once: true });
  const fallback = document.createElement('span');
  fallback.className = 'viewer-sponsor-avatar-fallback';
  fallback.textContent = String(ad.nickname || '?').slice(0, 1);
  fallback.hidden = true;
  const nickname = document.createElement('strong');
  nickname.textContent = ad.nickname;
  const previewParts = makeSponsorLivePreview();
  card.append(image, fallback, nickname, previewParts.preview);
  const requestPreview = () => loadSponsorLivePreview(card, previewParts);
  card.addEventListener('mouseenter', requestPreview, { once: true });
  card.addEventListener('focus', requestPreview, { once: true });
  card.dataset.rail = rail;
  return card;
}

function distributeSponsorAds(ads) {
  const sorted = (Array.isArray(ads) ? ads : []).slice()
    .sort((a, b) => Number(b.expiresAt) - Number(a.expiresAt));
  const hasRail = sorted.some((ad) => ad.rail === 'left' || ad.rail === 'right');
  if (hasRail) {
    return {
      left: sorted.filter((ad) => ad.rail === 'left').slice(0, 5),
      right: sorted.filter((ad) => ad.rail === 'right').slice(0, 5),
    };
  }
  return {
    left: sorted.filter((_, index) => index % 2 === 0).slice(0, 5),
    right: sorted.filter((_, index) => index % 2 === 1).slice(0, 5),
  };
}

function renderSponsorRails(ads, pendingByRail = { left: 0, right: 0 }) {
  const rails = distributeSponsorAds(ads);
  const pending = {
    left: Math.max(0, Math.min(5, Number(pendingByRail.left) || 0)),
    right: Math.max(0, Math.min(5, Number(pendingByRail.right) || 0)),
  };
  const mobileItems = { left: [], right: [] };
  for (const [side, elementId] of [['left', 'sponsorRailLeft'], ['right', 'sponsorRailRight']]) {
    const rail = $(elementId);
    if (!rail) continue;
    rail.replaceChildren(makeSponsorTitle());
    rails[side].forEach((ad) => {
      const card = makeSponsorAdCard(ad, side);
      rail.append(card);
      mobileItems[side].push(makeSponsorAdCard(ad, side));
    });
    for (let index = 0; index < pending[side]; index += 1) {
      rail.append(makeSponsorPendingSlot());
      mobileItems[side].push(makeSponsorPendingSlot());
    }
    if (rails[side].length + pending[side] < 5) {
      rail.append(makeSponsorOpenCard(side));
      mobileItems[side].push(makeSponsorOpenCard(side));
    }
  }

  const mobile = $('sponsorRailMobile');
  if (!mobile) return;
  mobile.replaceChildren(makeSponsorTitle());
  const max = Math.max(mobileItems.left.length, mobileItems.right.length);
  for (let index = 0; index < max; index += 1) {
    if (mobileItems.left[index]) mobile.append(mobileItems.left[index]);
    if (mobileItems.right[index]) mobile.append(mobileItems.right[index]);
  }
}

function sponsorDate(timestamp) {
  if (!timestamp) return '확인 대기';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

async function loadAdminSponsorRequests() {
  const list = $('sponsorAdminRequests');
  if (!list) return;
  $('sponsorAdminStatus').textContent = '신청 목록을 불러오는 중…';
  try {
    const response = await callAdminSponsorAds({ action: 'list' });
    const requests = response.data && Array.isArray(response.data.requests) ? response.data.requests : [];
    list.replaceChildren();
    if (!requests.length) {
      $('sponsorAdminStatus').textContent = '검토할 홍보 신청이 없습니다.';
      return;
    }
    $('sponsorAdminStatus').textContent = `${requests.length}건의 대기 신청 · 후원 완료를 표시한 신청만 승인할 수 있습니다.`;
    requests.forEach((request) => {
      const item = document.createElement('article');
      item.className = 'viewer-sponsor-request-item';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = `${request.nickname} · ${request.soopId}`;
      const meta = document.createElement('span');
      meta.textContent = `후원 계정 ${request.donorSoopId} · ${request.days}일 / ${Number(request.balloonCost).toLocaleString('ko-KR')}개 · 신청 ${sponsorDate(request.requestedAt)} · ${request.donationCompletedAt ? `후원 완료 ${sponsorDate(request.donationCompletedAt)}` : '후원 완료 표시 전'}`;
      details.append(name, meta);
      const actions = document.createElement('div');
      actions.className = 'viewer-sponsor-request-actions';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'button';
      reject.textContent = '반려';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'button button-primary';
      approve.textContent = '후원 확인 · 승인';
      approve.disabled = !request.donationCompletedAt;
      const process = async (action, button) => {
        button.disabled = true;
        $('sponsorAdminStatus').textContent = '신청을 처리하고 있어요.';
        try {
          await callAdminSponsorAds({ action, requestId: request.requestId });
          await refreshSponsorAds();
        } catch (error) {
          const failureMessage = viewerStatsErrorMessage(error, '신청을 처리하지 못했습니다.');
          await loadAdminSponsorRequests();
          $('sponsorAdminStatus').textContent = failureMessage;
          button.disabled = false;
        }
      };
      reject.addEventListener('click', () => process('reject', reject));
      approve.addEventListener('click', () => process('approve', approve));
      actions.append(reject, approve);
      item.append(details, actions);
      list.append(item);
    });
  } catch (error) {
    $('sponsorAdminStatus').textContent = viewerStatsErrorMessage(error, '홍보 신청 목록을 불러오지 못했습니다.');
  }
}

async function refreshSponsorAds() {
  try {
    await getAuthReady();
    const response = await callSponsorAds({ action: 'list' });
    const data = response.data || {};
    renderSponsorRails(data.ads || [], data.pendingByRail || { left: 0, right: 0 });
    $('sponsorAdminPanel').classList.toggle('hidden', data.isAdmin !== true);
    if (data.isAdmin === true) await loadAdminSponsorRequests();
  } catch (error) {
    console.error('오늘의 후원 스트리머를 불러오지 못했습니다.', error);
    renderSponsorRails([]);
  }
}

function getSavedSponsorRequestId() {
  try { return localStorage.getItem(SPONSOR_PENDING_REQUEST_KEY) || ''; } catch (_) { return ''; }
}

function setSavedSponsorRequestId(requestId) {
  try {
    if (requestId) localStorage.setItem(SPONSOR_PENDING_REQUEST_KEY, requestId);
    else localStorage.removeItem(SPONSOR_PENDING_REQUEST_KEY);
  } catch (_) {}
}

function showSponsorDonationStep(record) {
  sponsorRequestRecord = record;
  $('sponsorRequestFields').classList.add('hidden');
  $('sponsorDonationStep').classList.remove('hidden');
  $('sponsorRequestTitle').textContent = '후원 신청 확인';
  $('sponsorRequestIntro').textContent = '신청 후 1시간 동안 후원자 SOOP 아이디와 별풍선 수량을 자동 대조합니다. 두 정보가 유일하게 일치하면 후원 완료 알리기 버튼 없이도 홍보 신청이 자동 승인됩니다.';
  const summary = $('sponsorDonationSummary');
  summary.replaceChildren();
  const rows = [
    ['홍보 스트리머', `${record.nickname} · ${record.soopId}`],
    ['후원 계정', record.donorSoopId],
    ['노출 기간', `${record.days}일`],
    ['필요 별풍선', `${Number(record.balloonCost).toLocaleString('ko-KR')}개`],
  ];
  rows.forEach(([label, value]) => {
    const cell = document.createElement('div');
    const caption = document.createElement('span');
    caption.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    cell.append(caption, strong);
    summary.append(cell);
  });
  const completed = Number(record.donationCompletedAt) > 0;
  const requestedAt = Number(record.requestedAt) || 0;
  const watchActive = requestedAt > 0 && requestedAt <= Date.now() && Date.now() - requestedAt < 60 * 60 * 1000;
  $('sponsorDonationComplete').classList.toggle('hidden', completed);
  $('sponsorRequestWithdraw').classList.toggle('hidden', completed);
  $('sponsorDonationLink').classList.toggle('hidden', completed);
  $('sponsorRequestDone').classList.toggle('hidden', false);
  $('sponsorDonationStatus').textContent = watchActive
    ? `운영자 방송국에 별풍선 ${Number(record.balloonCost).toLocaleString('ko-KR')}개를 후원해 주세요. 신청 후 1시간 동안 후원자 아이디와 수량이 유일하게 일치하면 ${completed ? '자동 승인됩니다. 완료 알림 시각은 자동 대조 조건이 아닙니다.' : '완료 알리기 버튼 없이 자동 승인됩니다.'} 일치가 모호하면 운영자가 확인하며, 완료 알리기는 선택입니다.`
    : `신청 후 1시간 자동 감시가 종료됐습니다. 신청은 취소되지 않았으며 자동 승인은 더 이상 진행되지 않습니다. ${completed ? '후원 완료 알림이 접수되어 운영자 수동 확인 대기 상태입니다.' : '후원 완료 알리기를 선택적으로 눌러 운영자 수동 확인을 요청할 수 있습니다. 알리지 않은 신청은 7일 후 만료됩니다.'}`;
  $('sponsorRequestStatus').textContent = '';
  startSponsorStatusPolling();
}

function closeSponsorDialog() {
  const dialog = $('sponsorRequestDialog');
  if (dialog.open) dialog.close();
  window.clearInterval(sponsorPollTimer);
  sponsorPollTimer = 0;
  if (sponsorRequestPreviousFocus && document.contains(sponsorRequestPreviousFocus)) sponsorRequestPreviousFocus.focus();
}

async function refreshSponsorRequestStatus() {
  if (!sponsorRequestId) return;
  try {
    const response = await callSponsorAds({ action: 'status', requestId: sponsorRequestId });
    const data = response.data || {};
    if (data.status === 'pending') {
      sponsorRequestRecord = { ...data, requestId: sponsorRequestId };
      if ($('sponsorRequestDialog').open) showSponsorDonationStep(sponsorRequestRecord);
      return;
    }
    if (data.status === 'processing') {
      if ($('sponsorRequestDialog').open) $('sponsorDonationStatus').textContent = '후원 내역을 확인해 홍보 카드를 승인 처리하고 있습니다.';
      return;
    }
    window.clearInterval(sponsorPollTimer);
    sponsorPollTimer = 0;
    if (data.status === 'approved') {
      setSavedSponsorRequestId('');
      if ($('sponsorRequestDialog').open) {
        $('sponsorDonationLink').classList.add('hidden');
        $('sponsorDonationComplete').classList.add('hidden');
        $('sponsorRequestWithdraw').classList.add('hidden');
        $('sponsorRequestDone').classList.remove('hidden');
        $('sponsorDonationStatus').textContent = `신청이 승인됐어요. ${sponsorDate(data.expiresAt)}까지 후원 스트리머 카드에 표시됩니다.`;
      }
      await refreshSponsorAds();
      return;
    }
    setSavedSponsorRequestId('');
    sponsorRequestId = '';
    if ($('sponsorRequestDialog').open) {
      $('sponsorDonationStep').classList.add('hidden');
      $('sponsorRequestFields').classList.remove('hidden');
      $('sponsorRequestTitle').textContent = '스트리머 홍보 신청';
      $('sponsorRequestIntro').textContent = '홍보할 스트리머와 후원 계정, 노출 기간을 입력하세요.';
      const messages = { rejected: '신청이 반려되었습니다. 입력 정보를 확인한 뒤 다시 신청할 수 있어요.', expired: '후원 완료 전 신청이 만료되었습니다. 다시 신청해 주세요.', cancelled: '신청이 취소되었습니다.' };
      $('sponsorRequestStatus').textContent = messages[data.status] || '신청 상태가 변경되었습니다.';
    }
  } catch (error) {
    if ($('sponsorRequestDialog').open) $('sponsorDonationStatus').textContent = viewerStatsErrorMessage(error, '신청 상태를 확인하지 못했습니다.');
  }
}

function startSponsorStatusPolling() {
  window.clearInterval(sponsorPollTimer);
  if (!sponsorRequestId || !$('sponsorRequestDialog').open) return;
  sponsorPollTimer = window.setInterval(refreshSponsorRequestStatus, 20000);
}

async function openSponsorRequest(button) {
  sponsorRequestPreviousFocus = button;
  sponsorRequestRail = button.dataset.sponsorRail === 'right' ? 'right' : 'left';
  sponsorRequestId = getSavedSponsorRequestId();
  $('sponsorRequestStatus').textContent = '';
  showViewerModal($('sponsorRequestDialog'));
  if (sponsorRequestId) {
    await refreshSponsorRequestStatus();
    if (sponsorRequestId && !sponsorRequestRecord) {
      $('sponsorRequestFields').classList.remove('hidden');
      $('sponsorDonationStep').classList.add('hidden');
    }
  } else {
    $('sponsorRequestFields').classList.remove('hidden');
    $('sponsorDonationStep').classList.add('hidden');
    $('sponsorRequestTitle').textContent = '스트리머 홍보 신청';
    $('sponsorRequestIntro').textContent = '홍보할 스트리머와 후원 계정, 노출 기간을 입력하세요.';
    $('sponsorRequestForm').reset();
    updateSponsorPrice();
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) {
      window.setTimeout(() => $('sponsorRequestNickname').focus(), 0);
    }
  }
}

function updateSponsorPrice() {
  const days = Number.parseInt($('sponsorRequestDays').value, 10);
  const valid = Number.isInteger(days) && days >= 1 && days <= 30;
  $('sponsorRequestCostLabel').textContent = valid ? `${days}일 × 10개` : '기간을 확인해 주세요';
  $('sponsorRequestTotal').textContent = valid ? `${(days * 10).toLocaleString('ko-KR')}개` : '—';
}

$('sponsorRequestForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const nickname = $('sponsorRequestNickname').value.trim();
  const soopId = $('sponsorRequestSoopId').value.trim().toLowerCase();
  const donorSoopId = $('sponsorRequestDonorId').value.trim().toLowerCase();
  const days = Number.parseInt($('sponsorRequestDays').value, 10);
  let firstInvalid = null;
  $('sponsorNicknameError').textContent = '';
  $('sponsorSoopIdMessage').textContent = '홍보 중이거나 신청 확인 중인 스트리머는 중복 신청할 수 없어요.';
  $('sponsorSoopIdMessage').classList.remove('is-error');
  $('sponsorDonorIdError').textContent = '';
  $('sponsorDaysError').textContent = '하루 별풍선 10개 · 최대 30일';
  document.querySelectorAll('#sponsorRequestForm input').forEach((input) => input.removeAttribute('aria-invalid'));
  if (!nickname || nickname.length > 40) {
    $('sponsorNicknameError').textContent = '스트리머 닉네임을 입력해 주세요.';
    firstInvalid ||= $('sponsorRequestNickname');
  }
  if (!/^[a-z0-9]{2,20}$/.test(soopId)) {
    $('sponsorSoopIdMessage').textContent = 'SOOP 아이디를 영문 소문자와 숫자 2~20자로 입력해 주세요.';
    $('sponsorSoopIdMessage').classList.add('is-error');
    firstInvalid ||= $('sponsorRequestSoopId');
  }
  if (!/^[a-z0-9]{2,20}$/.test(donorSoopId)) {
    $('sponsorDonorIdError').textContent = '후원 계정의 SOOP 아이디를 확인해 주세요.';
    firstInvalid ||= $('sponsorRequestDonorId');
  }
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    $('sponsorDaysError').textContent = '홍보 기간은 1~30일로 선택해 주세요.';
    firstInvalid ||= $('sponsorRequestDays');
  }
  if (firstInvalid) {
    firstInvalid.setAttribute('aria-invalid', 'true');
    firstInvalid.focus();
    return;
  }
  const submit = $('sponsorRequestSubmit');
  submit.disabled = true;
  setSponsorHint('sponsorRequestStatus', '신청을 등록하고 있어요.');
  try {
    await getAuthReady();
    const response = await callSponsorAds({ action: 'submit', nickname, soopId, donorSoopId, days, rail: sponsorRequestRail });
    const data = response.data || {};
    sponsorRequestId = String(data.requestId || '');
    sponsorRequestRecord = { requestId: sponsorRequestId, requestedAt: Number(data.requestedAt) || Date.now(), nickname, soopId, donorSoopId, days, balloonCost: Number(data.balloonCost) || days * 10, status: 'pending', donationCompletedAt: 0 };
    setSavedSponsorRequestId(sponsorRequestId);
    showSponsorDonationStep(sponsorRequestRecord);
  } catch (error) {
    const message = viewerStatsErrorMessage(error, '신청을 접수하지 못했습니다.');
    const duplicate = String(error && error.code || '').endsWith('already-exists')
      || message.includes('이미 홍보 중')
      || message.includes('이미 확인 중');
    if (duplicate) {
      $('sponsorSoopIdMessage').textContent = message;
      $('sponsorSoopIdMessage').classList.add('is-error');
      setSponsorHint('sponsorRequestStatus', '');
    } else {
      setSponsorHint('sponsorRequestStatus', message, true);
    }
  } finally {
    submit.disabled = false;
  }
});

$('sponsorRequestSoopId').addEventListener('input', () => {
  const soopId = $('sponsorRequestSoopId').value.trim().toLowerCase();
  const hint = $('sponsorSoopIdMessage');
  hint.textContent = '홍보 중이거나 신청 확인 중인 스트리머는 중복 신청할 수 없어요.';
  hint.classList.remove('is-error');
  const image = $('sponsorRequestProfileImage');
  const profile = $('sponsorRequestProfile');
  const request = ++sponsorProfileRequestId;
  if (!/^[a-z0-9]{2,20}$/.test(soopId)) {
    profile.classList.add('hidden');
    image.removeAttribute('src');
    $('sponsorRequestProfileStatus').textContent = '';
    return;
  }
  profile.classList.remove('hidden');
  $('sponsorRequestProfileStatus').textContent = 'SOOP 프로필을 확인 중…';
  image.onload = () => {
    if (request === sponsorProfileRequestId) $('sponsorRequestProfileStatus').textContent = '입력한 SOOP 프로필';
  };
  image.onerror = () => {
    if (request === sponsorProfileRequestId) $('sponsorRequestProfileStatus').textContent = '프로필을 불러오지 못했어요. 아이디를 확인해 주세요.';
  };
  image.src = `https://stimg.sooplive.com/LOGO/${soopId.slice(0, 2)}/${soopId}/${soopId}.jpg`;
});
$('sponsorRequestDays').addEventListener('input', updateSponsorPrice);
$('sponsorRequestClose').addEventListener('click', closeSponsorDialog);
$('sponsorRequestCancel').addEventListener('click', closeSponsorDialog);
$('sponsorRequestDone').addEventListener('click', closeSponsorDialog);
$('sponsorRequestDialog').addEventListener('click', (event) => {
  if (event.target === $('sponsorRequestDialog')) closeSponsorDialog();
});
$('sponsorRequestDialog').addEventListener('close', () => {
  window.clearInterval(sponsorPollTimer);
  sponsorPollTimer = 0;
});
$('sponsorDonationComplete').addEventListener('click', async () => {
  if (!sponsorRequestId) return;
  const button = $('sponsorDonationComplete');
  button.disabled = true;
  try {
    const response = await callSponsorAds({ action: 'donationComplete', requestId: sponsorRequestId });
    const result = response.data || {};
    if (result.status === 'approved' || result.status === 'processing') {
      await refreshSponsorRequestStatus();
      return;
    }
    if (sponsorRequestRecord) sponsorRequestRecord.donationCompletedAt = Date.now();
    $('sponsorDonationStatus').textContent = '후원 완료 알림을 전달했어요. 자동 감시는 신청 후 1시간까지이며, 자동 확인되지 않으면 운영자가 수동으로 확인합니다.';
    showSponsorDonationStep(sponsorRequestRecord);
  } catch (error) {
    $('sponsorDonationStatus').textContent = viewerStatsErrorMessage(error, '후원 완료를 접수하지 못했습니다.');
    button.disabled = false;
  }
});
$('sponsorRequestWithdraw').addEventListener('click', async () => {
  if (!sponsorRequestId || !confirm('홍보 신청을 취소할까요?')) return;
  const button = $('sponsorRequestWithdraw');
  button.disabled = true;
  try {
    await callSponsorAds({ action: 'cancel', requestId: sponsorRequestId });
    setSavedSponsorRequestId('');
    sponsorRequestId = '';
    sponsorRequestRecord = null;
    $('sponsorDonationStep').classList.add('hidden');
    $('sponsorRequestFields').classList.remove('hidden');
    $('sponsorRequestTitle').textContent = '스트리머 홍보 신청';
    setSponsorHint('sponsorRequestStatus', '신청을 취소했습니다.');
  } catch (error) {
    $('sponsorDonationStatus').textContent = viewerStatsErrorMessage(error, '신청을 취소하지 못했습니다.');
  } finally {
    button.disabled = false;
  }
});
$('sponsorAdminRefresh').addEventListener('click', loadAdminSponsorRequests);

let sponsorLoadedForUid = '';
onAuthStateChanged(auth, (user) => {
  if (!user || sponsorLoadedForUid === user.uid) return;
  sponsorLoadedForUid = user.uid;
  refreshSponsorAds();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshSponsorAds();
    if ($('sponsorRequestDialog').open && sponsorRequestId) refreshSponsorRequestStatus();
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
getAuthReady().then(() => {
  sponsorRequestId = getSavedSponsorRequestId();
  if (sponsorRequestId) refreshSponsorRequestStatus();
}).catch((error) => setSearchHint(viewerStatsErrorMessage(error, '통계 연결을 시작하지 못했어요.'), true));
