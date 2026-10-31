import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithPopup, signInWithCustomToken, linkWithPopup, signOut, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { getDatabase, ref, get, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { drainRollingPaperStickerMoveQueue } from './rolling-paper-sticker-moves.mjs?v=20261030-sticker-drag-queue';

const firebaseConfig = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:b58db2970489bf18a3a769'
};
// 다른 시리즈 앱과 같은 origin·apiKey·기본 Firebase 앱 세션을 공유해 기존 UID를 이어받는다.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app, 'us-central1');
function authenticatedCallable(name, options) {
  const callable = httpsCallable(functions, name, options);
  return (data, callOptions) => ensureAuthReady().then(() => callable(data, callOptions));
}
const callBootstrap = httpsCallable(functions, 'streamerFanPageBootstrap');
const callSearch = authenticatedCallable('streamerFanPageSearch');
const callRecent = authenticatedCallable('streamerFanPageRecent');
const callAdminStats = authenticatedCallable('streamerFanPageAdminStats');
const callDesignFeedback = authenticatedCallable('streamerFanPageDesignFeedback');
const callAdminViewerSubscriptionRequests = authenticatedCallable('streamerFanPageAdminViewerSubscriptionRequests');
const callSave = authenticatedCallable('streamerFanPageSave');
const callSongbook = authenticatedCallable('streamerFanPageSongbook');
const callPlayedGames = authenticatedCallable('streamerFanPagePlayedGames');
const callMemories = authenticatedCallable('streamerFanPageMemories');
const callVideoLibrary = authenticatedCallable('streamerFanPageVideoLibrary');
const callTamagotchiApplications = authenticatedCallable('streamerFanPageTamagotchiApplications');
const callRollingPaper = authenticatedCallable('streamerFanPageRollingPaper');
const callVodPage = authenticatedCallable('streamerFanPageVodPage');
const callVodComments = authenticatedCallable('streamerFanPageVodComments');
const callVodCommentAdd = authenticatedCallable('streamerFanPageVodCommentAdd');
const callVodCommentDelete = authenticatedCallable('streamerFanPageVodCommentDelete');
const callCommentProfileSave = authenticatedCallable('streamerFanPageCommentProfileSave');
const callVodRefresh = authenticatedCallable('streamerFanPageVodRefresh', { timeout: 3600000 });
const callCalendar = authenticatedCallable('streamerFanPageCalendar');
const callWeeklySchedule = authenticatedCallable('streamerFanPageWeeklySchedule');
const callLiveStatus = authenticatedCallable('streamerFanPageLiveStatus');
const callGalleryUploadTarget = authenticatedCallable('streamerFanPageGallery');
const callGalleryUploadPrepare = authenticatedCallable('requestImageUpload');
const callGalleryImageRegister = authenticatedCallable('registerImage');
const callGallery = authenticatedCallable('streamerFanPageGallery');
const callScheduleAdd = authenticatedCallable('streamerFanPageScheduleAdd');
const callScheduleDelete = authenticatedCallable('streamerFanPageScheduleDelete');
const callYouTubeVideos = authenticatedCallable('streamerFanPageYouTubeVideos');
const callCafePosts = authenticatedCallable('streamerFanPageCafePosts');
const callRoulette = authenticatedCallable('streamerFanPageRoulette');
const callUpbo = authenticatedCallable('streamerFanPageUpbo');
// 로그인 연결은 시리즈의 공유 Firebase Functions callable을 사용한다.
const callLinkGoogle = authenticatedCallable('linkGoogleAccount');
const callLinkKakao = authenticatedCallable('linkKakaoAccount');
const callStreamerVerification = authenticatedCallable('requestStreamerVerification');
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
const KAKAO_LINKED_UID_KEY = 'streamerFanPage.kakaoLinkedUid';
const LOGIN_ASSIST_SESSION_KEY = 'streamerFanPage.loginAssistTab';
const LOGIN_ASSIST_QUERY = new URLSearchParams(location.search).get('login') === '1';
let loginAssistTab = (() => {
  try {
    if (LOGIN_ASSIST_QUERY) sessionStorage.setItem(LOGIN_ASSIST_SESSION_KEY, '1');
    return LOGIN_ASSIST_QUERY || sessionStorage.getItem(LOGIN_ASSIST_SESSION_KEY) === '1';
  } catch (_) {
    return LOGIN_ASSIST_QUERY;
  }
})();
let loginAssistCloseStarted = false;
const MAX_LOADED_VIDEO_ITEMS = 500;
const MAX_BANNER_IMAGE_ITEMS = 20;
const MAX_UPBO_ITEMS = 100;
const DEFAULT_FANPAGE_LAYOUT = 1;
const KAKAO_JAVASCRIPT_KEY = 'ed4f01d6903ca41d5dc0ab32b6ae143c';
let kakaoSdkPromise = null;
let authReadyPromise = null;
const BUTTON_CLICK_SOUND_STORAGE_KEY = 'streamerFanPage.buttonClickVolume';
const DEFAULT_BUTTON_CLICK_VOLUME = 20;
const YOUTUBE_PLAYER_VOLUME_STORAGE_KEY = 'streamerFanPage.youtubePlayerVolume';
const DEFAULT_YOUTUBE_PLAYER_VOLUME = 50;
const buttonClickAudio = new Audio(new URL('./assets/sounds/button-click.mp3', import.meta.url).href);
const modalOpenAudio = new Audio(new URL('./assets/sounds/modal-open.mp3', import.meta.url).href);
const saveButtonAudio = new Audio(new URL('./assets/sounds/save-button.mp3', import.meta.url).href);
const catPawCloseAudio = new Audio(new URL('./assets/sounds/cat-paw-close.mp3', import.meta.url).href);
const catPawCloseArtwork = new Image();
catPawCloseArtwork.src = new URL('./assets/fanpage-kawaii/cat-paw-close.svg', import.meta.url).href;
let youtubeIframeApiPromise = null;
let youtubePlayer = null;
let youtubePlayerGeneration = 0;
function readYouTubePlayerVolume() {
  try {
    const stored = localStorage.getItem(YOUTUBE_PLAYER_VOLUME_STORAGE_KEY);
    if (stored === null) return DEFAULT_YOUTUBE_PLAYER_VOLUME;
    const volume = Number(stored);
    return Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : DEFAULT_YOUTUBE_PLAYER_VOLUME;
  } catch (_) {
    return DEFAULT_YOUTUBE_PLAYER_VOLUME;
  }
}
function setYouTubePlayerVolume(value) {
  const volume = Number(value);
  youtubeVolumeLevel = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : DEFAULT_YOUTUBE_PLAYER_VOLUME;
  try { localStorage.setItem(YOUTUBE_PLAYER_VOLUME_STORAGE_KEY, String(youtubeVolumeLevel)); } catch (_) { /* volume still applies for this visit */ }
  return youtubeVolumeLevel;
}
let youtubeVolumeLevel = readYouTubePlayerVolume();
let youtubeLastAudibleVolume = youtubeVolumeLevel > 0 ? youtubeVolumeLevel : DEFAULT_YOUTUBE_PLAYER_VOLUME;
buttonClickAudio.preload = 'auto';
modalOpenAudio.preload = 'auto';
saveButtonAudio.preload = 'auto';
catPawCloseAudio.preload = 'auto';
function readButtonClickVolume() {
  try {
    const stored = localStorage.getItem(BUTTON_CLICK_SOUND_STORAGE_KEY);
    if (stored === null) return DEFAULT_BUTTON_CLICK_VOLUME;
    const volume = Number(stored);
    return Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : DEFAULT_BUTTON_CLICK_VOLUME;
  } catch (_) {
    return DEFAULT_BUTTON_CLICK_VOLUME;
  }
}
let buttonClickVolume = readButtonClickVolume();
let uiAudioContext = null;
const uiAudioGainNodes = new WeakMap();
function setButtonClickVolume(value) {
  const volume = Number(value);
  buttonClickVolume = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : DEFAULT_BUTTON_CLICK_VOLUME;
  try { localStorage.setItem(BUTTON_CLICK_SOUND_STORAGE_KEY, String(buttonClickVolume)); } catch (_) { /* volume still applies for this visit */ }
  return buttonClickVolume;
}
let modalOpenGeneration = 0;
let activePointerSoundActivation = null;
let pendingPointerSoundActivation = null;
let lastCalendarPointerPress = null;
function playUiSound(audio, volumeOffsetPercent = 0, startOffsetSeconds = 0, volumeMultiplier = 1) {
  if (buttonClickVolume <= 0) return;
  const volumePercent = Math.max(0, (buttonClickVolume + volumeOffsetPercent) * volumeMultiplier);
  let gainNode = uiAudioGainNodes.get(audio);
  if (volumePercent > 100 || gainNode) {
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!uiAudioContext && AudioContextConstructor) uiAudioContext = new AudioContextConstructor();
      if (uiAudioContext) {
        if (!gainNode) {
          const sourceNode = uiAudioContext.createMediaElementSource(audio);
          gainNode = uiAudioContext.createGain();
          sourceNode.connect(gainNode);
          gainNode.connect(uiAudioContext.destination);
          uiAudioGainNodes.set(audio, gainNode);
        }
        audio.volume = 1;
        gainNode.gain.value = volumePercent / 100;
        if (uiAudioContext.state === 'suspended') uiAudioContext.resume().catch(() => {});
      } else {
        audio.volume = Math.min(1, volumePercent / 100);
      }
    } catch (_) {
      audio.volume = Math.min(1, volumePercent / 100);
    }
  } else {
    audio.volume = volumePercent / 100;
  }
  audio.currentTime = startOffsetSeconds;
  const playback = audio.play();
  if (playback && typeof playback.catch === 'function') playback.catch(() => {});
}
function showFanPageModal(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  const isTouchLayout = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  if (isTouchLayout) {
    const initialFocus = dialog.querySelector(
      '.profile-settings-close, #closeLoginChoices, #closeStreamerVerification, #cancelAccountSwitch, #closeLoginAssistTab',
    ) || dialog;
    if (initialFocus === dialog) dialog.tabIndex = -1;
    initialFocus.setAttribute('autofocus', '');
  }
  dialog.showModal();
  if (isTouchLayout) {
    const initialFocus = dialog.querySelector(
      '.profile-settings-close, #closeLoginChoices, #closeStreamerVerification, #cancelAccountSwitch, #closeLoginAssistTab',
    ) || dialog;
    initialFocus.focus({ preventScroll: true });
  }
  modalOpenGeneration += 1;
  if (activePointerSoundActivation?.soundType !== 'modal') playUiSound(modalOpenAudio);
}
function preserveLoginAssistTabForReload() {
  if (!loginAssistTab) return;
  try { sessionStorage.setItem(LOGIN_ASSIST_SESSION_KEY, '1'); } catch (_) { /* URL에도 로그인 탭 의도를 남긴다. */ }
  const loginUrl = new URL(location.href);
  loginUrl.searchParams.set('login', '1');
  history.replaceState(null, '', loginUrl.href);
}
function completeLoginAssistTab() {
  if (!loginAssistTab || loginAssistCloseStarted) return;
  loginAssistCloseStarted = true;
  loginAssistTab = false;
  try { sessionStorage.removeItem(LOGIN_ASSIST_SESSION_KEY); } catch (_) {}
  window.close();
  window.setTimeout(() => {
    if (!window.closed) showFanPageModal($('loginAssistCompleteDialog'));
  }, 250);
}
window.streamerFanPageOpenLoginModal = () => showFanPageModal($('loginChoiceDialog'));

function publishFanpageEmoteContext(page) {
  const context = {
    streamerId: page && page.streamer ? String(page.streamer.id || '').trim().toLowerCase() : '',
    isStreamerOwner: !!(page && page.isStreamerOwner),
    decorations: page && Array.isArray(page.decorations) ? page.decorations : [],
  };
  window.__streamerFanPageEmotes = context;
  window.__gameSeriesEmoteRoomId = context.streamerId || 'public';
  window.dispatchEvent(new CustomEvent('game-series-emote-room-change', {
    detail: { roomId: context.streamerId || 'public' },
  }));
  window.dispatchEvent(new CustomEvent('streamer-fanpage-emotes-context-change', { detail: context }));
}

window.addEventListener('streamer-fanpage-emotes-updated', (event) => {
  if (currentPage?.streamer.id === event.detail?.streamerId) {
    currentPage.decorations = Array.isArray(event.detail.decorations) ? event.detail.decorations : [];
  }
});
window.addEventListener('streamer-fanpage-emotes-error', (event) => {
  showToast(event.detail?.message || '스티커를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
});

function isSaveOrCompleteButton(button) {
  return /저장|완료|save|done|complete/i.test([
    button.textContent || '', button.getAttribute('aria-label') || '', button.title || '',
  ].join(' '));
}
function isCompleteButton(button) {
  return /완료|done|complete/i.test([
    button.textContent || '', button.getAttribute('aria-label') || '', button.title || '',
  ].join(' '));
}
function isCatPawCloseButton(button) {
  return button.classList.contains('profile-settings-close')
    && document.body.matches('.fanpage-layout-one-active, .fanpage-home-kawaii-active');
}
function getUiSoundTarget(target) {
  return target instanceof Element ? target.closest('button, [role="button"]') : null;
}
function isModalOpenTrigger(button) {
  const directTriggers = [
    '#profileSettingsButton', '#openAdminStats', '#openLoginOptions', '#openDesignFeedback',
    '#openStreamerVerification', '.search-empty-verify', '.fan-quick-sound-settings',
    '.upbo-add-topic', '.upbo-add-item-inline', '.competition-history-add',
    '.calendar-add-button', '.vod-card', '.upbo-image-zoomable',
  ].join(',');
  if (button.matches(directTriggers)) return true;
  const label = (button.textContent || '').trim();
  if (button.closest('.upbo-row-actions') && /^(수정|검토·등록)$/.test(label)) return true;
  if (button.closest('.competition-history-item-actions') && label === '수정') return true;
  if (button.closest('.vod-comment-profile-editor') && label === '로그인 / 인증') return true;
  if (button.closest('.vod-comment-profile-actions') && /프로필 저장/.test(label) && !canSaveCommentProfile()) return true;
  return false;
}
function playButtonPressSound(button, { calendarDoublePress = false } = {}) {
  if (isCatPawCloseButton(button)) {
    playUiSound(catPawCloseAudio, 0, 0.05);
  } else if (calendarDoublePress || isModalOpenTrigger(button)) {
    playUiSound(modalOpenAudio);
  } else if (isCompleteButton(button)) {
    playUiSound(saveButtonAudio, 10, 0, 2);
  } else {
    playUiSound(isSaveOrCompleteButton(button) ? saveButtonAudio : buttonClickAudio);
  }
}
document.addEventListener('pointerdown', (event) => {
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const button = getUiSoundTarget(event.target);
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('data-no-click-sound')) return;
  const now = performance.now();
  const isCalendarDay = button.classList.contains('calendar-day-can-add');
  const calendarDoublePress = isCalendarDay
    && lastCalendarPointerPress?.button === button
    && now - lastCalendarPointerPress.time < 650;
  lastCalendarPointerPress = isCalendarDay ? { button, time: now } : null;
  const activation = {
    button,
    soundType: calendarDoublePress || isModalOpenTrigger(button) ? 'modal' : 'button',
    calendarDoublePress,
    time: now,
  };
  pendingPointerSoundActivation = activation;
  playButtonPressSound(button, { calendarDoublePress });
  window.setTimeout(() => {
    if (pendingPointerSoundActivation === activation) pendingPointerSoundActivation = null;
    if (activePointerSoundActivation === activation) activePointerSoundActivation = null;
  }, 60000);
}, true);
document.addEventListener('pointercancel', (event) => {
  const button = getUiSoundTarget(event.target);
  if (pendingPointerSoundActivation?.button === button) pendingPointerSoundActivation = null;
  if (activePointerSoundActivation?.button === button) activePointerSoundActivation = null;
}, true);
document.addEventListener('dblclick', (event) => {
  const button = getUiSoundTarget(event.target);
  const activation = activePointerSoundActivation;
  if (activation?.calendarDoublePress && activation.button === button) {
    queueMicrotask(() => {
      if (activePointerSoundActivation === activation) activePointerSoundActivation = null;
    });
  }
}, true);
document.addEventListener('click', (event) => {
  const button = getUiSoundTarget(event.target);
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('data-no-click-sound')) return;
  if (event.detail > 0) {
    const activation = pendingPointerSoundActivation;
    if (activation?.button === button && performance.now() - activation.time < 60000) {
      activePointerSoundActivation = activation;
      pendingPointerSoundActivation = null;
      // Keep the second calendar press active through the browser's following dblclick event.
      window.setTimeout(() => {
        if (activePointerSoundActivation === activation) activePointerSoundActivation = null;
      }, activation.calendarDoublePress ? 800 : 0);
    } else {
      activePointerSoundActivation = null;
      const openGeneration = modalOpenGeneration;
      queueMicrotask(() => {
        if (modalOpenGeneration === openGeneration) playButtonPressSound(button);
      });
    }
    return;
  }
  const openGeneration = modalOpenGeneration;
  queueMicrotask(() => {
    if (modalOpenGeneration !== openGeneration) return;
    playButtonPressSound(button);
  });
}, true);
const PROFILE_QUICK_EDIT_FIELDS = {
  birthday: { label: '생일', maxLength: 20, placeholder: '예: 02.11' },
  mbti: { label: 'MBTI', maxLength: 8, placeholder: '예: INFJ' },
  major: { label: '전공', maxLength: 50, placeholder: '전공을 입력해 주세요.' },
  debutDate: { label: '데뷔일', maxLength: 20, placeholder: '예: 2026. 07. 15' },
  fanNickname: { label: '팬닉', maxLength: 30, placeholder: '팬닉을 입력해 주세요.' },
  fandomName: { label: '팬덤명', maxLength: 30, placeholder: '팬덤명을 입력해 주세요.' },
  contents: { label: '콘텐츠', maxLength: 160, placeholder: '쉼표로 구분해 입력해 주세요.' },
  scheduleText: { label: '방송 시간', maxLength: 120, multiline: true, placeholder: '방송 시간을 입력해 주세요.' },
  intro: { label: 'ABOUT 문구', maxLength: 700, multiline: true, placeholder: '소개 문구를 입력해 주세요.' },
};
const $ = (id) => document.getElementById(id);
let currentPage = null;
let searchTimer = 0;
let toastTimer = 0;
let liveStatusTimer = 0;
let stockPriceUnsubscribe = null;
let stockPriceSparklineRequest = 0;
let fanPageQuickNavCleanup = null;
let verifiedStreamerUid = '';
let verifiedStreamerProfile = null;
let verifiedStreamerProfileUid = '';
let isAdminUser = false;
let adminStatsLoading = false;
let adminStatsData = null;
let adminViewerSubscriptionsLoading = false;
let adminDesignFeedbackLoading = false;
let adminTamagotchiApplicationsLoading = false;
let adminTamagotchiApplications = [];
let verifiedStatusUnsubscribe = null;
let switchApprovalUnsubscribe = null;
let switchHandoffInProgress = false;
const vodRefreshesInProgress = new Set();
const vodPageLoadsInProgress = new Set();
let vodCommentState = null;
let vodCommentRequestId = 0;
const calendarStates = new Map();
const weeklyScheduleGraphicStates = new Map();
const liveStatusStates = new Map();
const youtubeStates = new Map();
const cafeStates = new Map();
const rouletteStates = new Map();
const upboStates = new Map();
const rollingPaperStates = new Map();
const fanPageMemoryStates = new Map();
const videoLibraryStates = new Map();
const tamagotchiApplicationStates = new Map();
const fanPageContentStates = new Map();

function ensureKakaoSdk() {
  if (window.Kakao) {
    if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JAVASCRIPT_KEY);
    return Promise.resolve(window.Kakao);
  }
  if (!kakaoSdkPromise) {
    kakaoSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://developers.kakao.com/sdk/js/kakao.js';
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        if (!window.Kakao) return reject(new Error('카카오 SDK를 초기화하지 못했어요.'));
        if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JAVASCRIPT_KEY);
        resolve(window.Kakao);
      };
      script.onerror = () => reject(new Error('카카오 로그인을 불러오지 못했어요.'));
      document.head.append(script);
    }).catch((error) => {
      kakaoSdkPromise = null;
      throw error;
    });
  }
  return kakaoSdkPromise;
}

// admin-center가 관리하는 공개 devbarLinks를 표시한다. 읽기 실패나 빈 노드에는
// HTML에 둔 기본 링크를 유지하고, 이 페이지 자신은 항상 제외한다.
async function loadDevbarLinks() {
  const selfGameId = 'streamerFanPage';
  try {
    const snapshot = await get(ref(db, 'devbarLinks'));
    const data = snapshot.val();
    if (!data) return;
    const links = Object.keys(data)
      .filter((id) => id !== selfGameId && data[id] && data[id].url)
      .map((id) => ({ id, ...data[id] }))
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    if (!links.length) return;
    const nav = $('devbarLinks');
    if (!nav) return;
    nav.querySelectorAll('a[data-game-id]').forEach((link) => link.remove());
    for (const item of links) {
      const url = new URL(item.url, location.href);
      if (url.protocol !== 'https:') continue;
      const link = document.createElement('a');
      link.dataset.gameId = item.id;
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.label || item.name || item.id;
      nav.appendChild(link);
    }
  } catch (error) {
    console.error('자매 서비스 링크를 불러오지 못했습니다. 기본 링크를 유지합니다.', error);
  }
}
loadDevbarLinks();

function renderAuthControls() {
  const user = auth.currentUser;
  const googleLinked = !!(user && user.providerData.some((provider) => provider.providerId === 'google.com'));
  const kakaoLinked = !!(user && localStorage.getItem(KAKAO_LINKED_UID_KEY) === user.uid);
  const streamerVerified = !!(user && verifiedStreamerUid === user.uid);
  $('accountStatus').textContent = !user
    ? '로그인 확인 중'
    : streamerVerified
      ? '스트리머 인증됨'
      : user.isAnonymous && !kakaoLinked
      ? '게스트 이용 중'
      : googleLinked
        ? 'Google 계정 연결됨'
        : '카카오 계정 연결됨';
  $('openAdminStats').classList.toggle('hidden', !isAdminUser);
  $('openLoginOptions').classList.toggle('hidden', !!(user && (!user.isAnonymous || kakaoLinked || streamerVerified)));
  $('choiceGoogleLogin').classList.toggle('hidden', googleLinked);
  $('choiceGoogleLogin').textContent = user && !user.isAnonymous ? 'Google 계정 연결' : 'Google로 로그인';
  $('choiceKakaoLogin').classList.toggle('hidden', kakaoLinked);
  $('choiceKakaoLogin').textContent = user && !user.isAnonymous ? '카카오 계정 연결' : '카카오로 로그인';
  $('logoutButton').classList.toggle('hidden', !user || (user.isAnonymous && !kakaoLinked && !streamerVerified));
  updateDesignFeedbackEligibility();
}

function hasRecognizedFanpageAccount(user = auth.currentUser) {
  if (!user) return false;
  const googleLinked = user.providerData.some((provider) => provider.providerId === 'google.com');
  const kakaoLinked = localStorage.getItem(KAKAO_LINKED_UID_KEY) === user.uid;
  return !user.isAnonymous || googleLinked || kakaoLinked || verifiedStreamerUid === user.uid;
}

function updateDesignFeedbackEligibility() {
  const submit = $('submitDesignFeedback');
  if (!submit) return;
  const user = auth.currentUser;
  const verified = !!(user && verifiedStreamerUid === user.uid);
  const profile = verified && verifiedStreamerProfileUid === user.uid ? verifiedStreamerProfile : null;
  const eligible = verified && !!profile;
  submit.disabled = !eligible;
  const profileCard = $('designFeedbackSenderProfile');
  profileCard.classList.toggle('hidden', !eligible);
  if (eligible) {
    const avatar = $('designFeedbackSenderAvatar');
    const avatarUrl = String(profile.avatarUrl || '');
    if (avatar.dataset.profileUrl !== avatarUrl) {
      avatar.dataset.profileUrl = avatarUrl;
      avatar.classList.remove('avatar-fallback');
      setImage(avatar, avatarUrl, profile.nickname || profile.soopId || '스트리머');
    }
    $('designFeedbackSenderName').textContent = profile.nickname || '이름 없음';
    $('designFeedbackSenderSoopId').textContent = `@${profile.soopId || profile.id || ''}`;
  }
  const status = $('designFeedbackStatus');
  if (status && $('designFeedbackDialog').open) {
    if (!verified) {
      status.textContent = '스트리머 인증을 완료한 계정만 문의를 보낼 수 있어요.';
    } else if (!profile) {
      status.textContent = '인증 프로필을 불러오고 있어요. 잠시 후 다시 시도해 주세요.';
    } else if (
      status.textContent === '스트리머 인증을 완료한 계정만 문의를 보낼 수 있어요.'
      || status.textContent === '인증 프로필을 불러오고 있어요. 잠시 후 다시 시도해 주세요.'
    ) {
      status.textContent = '';
    }
  }
}

function canSaveCommentProfile(user = auth.currentUser) {
  if (!user) return false;
  return !user.isAnonymous
    || localStorage.getItem(KAKAO_LINKED_UID_KEY) === user.uid
    || verifiedStreamerUid === user.uid
    || isAdminUser;
}

async function handleFanpageStreamerSwitchApproval(uid, requestId) {
  if (!requestId || switchHandoffInProgress || auth.currentUser?.uid !== uid) return;
  const lockKey = 'soop.streamerVerificationSwitch.' + requestId;
  try {
    const lastAttemptAt = Number(localStorage.getItem(lockKey) || 0);
    if (lastAttemptAt && Date.now() - lastAttemptAt < 20000) return;
    localStorage.setItem(lockKey, String(Date.now()));
  } catch (_) { /* Private browsing may disable localStorage. */ }
  switchHandoffInProgress = true;
  try {
    const response = await callStreamerVerification({ checkOnly: true, switchRequestId: requestId });
    if (response.data?.action !== 'switch' || auth.currentUser?.uid !== uid) {
      try { localStorage.removeItem(lockKey); } catch (_) {}
      switchHandoffInProgress = false;
      return;
    }
    await signInWithCustomToken(auth, response.data.customToken);
    preserveLoginAssistTabForReload();
    location.reload();
  } catch (error) {
    try { localStorage.removeItem(lockKey); } catch (_) {}
    switchHandoffInProgress = false;
    console.error('승인된 스트리머 계정 자동 전환 실패:', error);
  }
}

onAuthStateChanged(auth, (user) => {
  if (verifiedStatusUnsubscribe) { verifiedStatusUnsubscribe(); verifiedStatusUnsubscribe = null; }
  if (switchApprovalUnsubscribe) { switchApprovalUnsubscribe(); switchApprovalUnsubscribe = null; }
  verifiedStreamerUid = '';
  verifiedStreamerProfile = null;
  verifiedStreamerProfileUid = '';
  switchHandoffInProgress = false;
  renderAuthControls();
  if (!user) return;

  let hasInitialVerifiedValue = false;
  let previousVerifiedValue = false;
  verifiedStatusUnsubscribe = onValue(ref(db, `users/${user.uid}/streamerVerified`), (snapshot) => {
    if (auth.currentUser?.uid !== user.uid) return;
    const verified = snapshot.val() === true;
    verifiedStreamerUid = verified ? user.uid : '';
    if (!verified) {
      verifiedStreamerProfile = null;
      verifiedStreamerProfileUid = '';
    }
    renderAuthControls();
    if (vodCommentState) renderVodCommentsContents();
    if (hasInitialVerifiedValue && previousVerifiedValue !== verified) {
      if (verified) {
        $('verificationStatus').textContent = '✅ 관리자가 승인했어요. 인증 상태가 새로고침 없이 반영됐습니다. 본인 팬페이지로 이동할게요.';
        $('verificationNote').hidden = true;
        if ($('streamerVerifyDialog').open) $('streamerVerifyDialog').close();
        showToast('스트리머 인증이 승인됐어요.');
      }
      completeLoginAssistTab();
      if ($('siteShell').classList.contains('is-ready')) loadApp();
    }
    previousVerifiedValue = verified;
    hasInitialVerifiedValue = true;
  }, (error) => console.error('스트리머 인증 상태 구독 실패:', error));

  switchApprovalUnsubscribe = onValue(ref(db, `users/${user.uid}/streamerVerificationSwitchApproval`), (snapshot) => {
    const requestId = snapshot.val() && snapshot.val().requestId;
    if (requestId) handleFanpageStreamerSwitchApproval(user.uid, String(requestId));
  }, (error) => console.error('계정 전환 승인 신호 구독 실패:', error));
  if (vodCommentState) renderVodCommentsContents();
});

function confirmAccountSwitch() {
  const dialog = $('accountSwitchDialog');
  return new Promise((resolve) => {
    const cancelEscape = (event) => { event.preventDefault(); finish(false); };
    const finish = (confirmed) => {
      dialog.close();
      dialog.removeEventListener('cancel', cancelEscape);
      $('cancelAccountSwitch').onclick = null;
      $('confirmAccountSwitch').onclick = null;
      resolve(confirmed);
    };
    dialog.addEventListener('cancel', cancelEscape);
    $('cancelAccountSwitch').onclick = () => finish(false);
    $('confirmAccountSwitch').onclick = () => finish(true);
    showFanPageModal(dialog);
  });
}

function isPopupCancelled(error) {
  return error && ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code);
}

async function loginWithGoogle() {
  const button = $('choiceGoogleLogin');
  button.disabled = true;
  try {
    if (!auth.currentUser) await waitForAuthRestore();
    await linkWithPopup(auth.currentUser, googleProvider);
    await callLinkGoogle();
    showToast('Google 계정을 연결했어요.');
    completeLoginAssistTab();
  } catch (error) {
    if (error && error.code === 'auth/credential-already-in-use') {
      if (!(await confirmAccountSwitch())) return;
      try {
        await signInWithPopup(auth, googleProvider);
        await callLinkGoogle();
        preserveLoginAssistTabForReload();
        location.reload();
      } catch (switchError) {
        if (!isPopupCancelled(switchError)) showToast(switchError.message || 'Google 계정 전환에 실패했어요.');
      }
    } else if (error && error.code === 'auth/provider-already-linked') {
      showToast('이미 Google 계정이 연결되어 있어요.');
    } else if (!isPopupCancelled(error)) {
      console.error('Google login failed:', error);
      showToast(error.message || 'Google 로그인에 실패했어요.');
    }
  } finally { button.disabled = false; }
}

async function loginWithKakao() {
  const button = $('choiceKakaoLogin');
  button.disabled = true;
  let kakao;
  try {
    kakao = await ensureKakaoSdk();
    if (!kakao.isInitialized()) throw new Error('카카오 로그인을 초기화하지 못했어요.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message || '카카오 로그인을 불러오지 못했어요.');
    return;
  }
  kakao.Auth.login({
    success: async (authObj) => {
      try {
        const result = await callLinkKakao({ kakaoAccessToken: authObj.access_token });
        const action = result.data && result.data.action;
        if (action === 'switch') {
          if (!(await confirmAccountSwitch())) return;
          const signedIn = await signInWithCustomToken(auth, result.data.customToken);
          localStorage.setItem(KAKAO_LINKED_UID_KEY, signedIn.user.uid);
          preserveLoginAssistTabForReload();
          location.reload();
          return;
        }
        if (auth.currentUser && (action === 'linked' || action === 'already-linked')) {
          localStorage.setItem(KAKAO_LINKED_UID_KEY, auth.currentUser.uid);
          completeLoginAssistTab();
        }
        renderAuthControls();
        if (vodCommentState) renderVodCommentsContents();
        showToast(action === 'already-linked' ? '이미 카카오 계정이 연결되어 있어요.' : '카카오 계정을 연결했어요.');
      } catch (error) {
        console.error('Kakao login failed:', error);
        showToast(error.message || '카카오 로그인에 실패했어요.');
      } finally { button.disabled = false; }
    },
    fail: (error) => {
      button.disabled = false;
      if (!error || error.error !== 'access_denied') showToast('카카오 로그인이 취소되었거나 실패했어요.');
    }
  });
}

async function logout() {
  $('logoutButton').disabled = true;
  try {
    await signOut(auth);
    localStorage.removeItem(KAKAO_LINKED_UID_KEY);
    location.reload();
  } catch (error) {
    showToast(error.message || '로그아웃하지 못했어요.');
    $('logoutButton').disabled = false;
  }
}

function routeId() {
  const match = location.hash.match(/^#\/p\/([a-z0-9_]{2,20})$/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : '';
}
function waitForAuthRestore() {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, (error) => {
      unsubscribe();
      reject(error);
    });
  });
}
function ensureAuthReady() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!authReadyPromise) {
    authReadyPromise = waitForAuthRestore()
      .then((user) => user || signInAnonymously(auth).then((credential) => credential.user))
      .catch((error) => {
        authReadyPromise = null;
        throw error;
      });
  }
  return authReadyPromise;
}
function goHome() { location.hash = '#/'; }
function goPage(id) { location.hash = `#/p/${encodeURIComponent(id)}`; }
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}
function setImage(img, url, nickname) {
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.src = url || '';
  img.alt = `${nickname} 프로필`;
  img.addEventListener('error', () => { img.src = ''; img.classList.add('avatar-fallback'); }, { once: true });
}
function streamerCard(streamer, recent = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = recent ? 'recent-card' : 'streamer-card';
  button.addEventListener('click', () => goPage(streamer.id));
  const img = document.createElement('img');
  img.className = 'avatar';
  setImage(img, streamer.avatarUrl, streamer.nickname);
  const copy = document.createElement('span');
  copy.className = 'streamer-card-copy';
  const name = document.createElement('strong');
  name.textContent = streamer.nickname;
  const handle = document.createElement('span');
  handle.textContent = `@${streamer.soopId}`;
  copy.append(name, handle);
  button.append(img, copy);
  if (!recent) {
    const arrow = document.createElement('span');
    arrow.className = 'card-arrow';
    arrow.textContent = '↗';
    button.append(arrow);
  }
  return button;
}
function renderList(container, items, recent = false, emptyText = '검색 결과가 없어요.') {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = recent ? 'empty-state' : 'search-empty';
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  items.forEach((item) => container.append(streamerCard(item, recent)));
}
function renderRegisteredStreamers(streamers) {
  const section = $('registeredStreamersSection');
  const grid = $('registeredStreamersGrid');
  const count = $('registeredStreamersCount');
  const toggle = $('registeredStreamersToggle');
  const unique = new Map();
  (Array.isArray(streamers) ? streamers : []).forEach((streamer) => {
    if (streamer && typeof streamer.id === 'string' && !unique.has(streamer.id)) unique.set(streamer.id, streamer);
  });
  const items = [...unique.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  section.classList.toggle('hidden', !items.length);
  count.textContent = `전체 ${items.length.toLocaleString('ko-KR')}명`;
  let expanded = false;
  toggle.classList.toggle('hidden', items.length <= 8);
  toggle.onclick = () => {
    expanded = !expanded;
    renderCards();
  };
  function renderCards() {
    const visibleItems = expanded ? items : items.slice(0, 8);
    grid.replaceChildren(...visibleItems.map((streamer) => streamerCard(streamer, true)));
    toggle.textContent = expanded ? '접기' : `전체 보기 (${items.length})`;
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  renderCards();
}
function formatStatCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('ko-KR');
}
function renderAdminStatsList(streamers) {
  const container = $('adminStatsList');
  const query = $('adminStatsSearch').value.trim().toLocaleLowerCase('ko-KR');
  const allStreamers = Array.isArray(streamers) ? streamers : [];
  const filtered = allStreamers.filter((streamer) =>
    !query || streamer.nickname.toLocaleLowerCase('ko-KR').includes(query)
      || streamer.soopId.toLocaleLowerCase().includes(query));
  container.replaceChildren();
  $('adminStatsStreamerCount').textContent = query
    ? `${filtered.length.toLocaleString('ko-KR')} / ${allStreamers.length.toLocaleString('ko-KR')}명`
    : `${filtered.length.toLocaleString('ko-KR')}명`;
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state admin-stats-empty';
    empty.textContent = query ? '검색 결과가 없어요.' : '집계할 인증 스트리머가 없어요.';
    container.append(empty);
    return;
  }

  for (const streamer of filtered) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'admin-stat-card';
    card.setAttribute('aria-label', `${streamer.nickname} 팬페이지 열기`);
    card.addEventListener('click', () => {
      $('adminStatsDialog').close();
      if (routeId() !== streamer.id) goPage(streamer.id);
    });

    const identity = document.createElement('span'); identity.className = 'admin-stat-identity';
    const avatar = document.createElement('img'); avatar.className = 'avatar';
    setImage(avatar, streamer.avatarUrl, streamer.nickname);
    const name = document.createElement('span'); name.className = 'admin-stat-name';
    const nickname = document.createElement('strong'); nickname.textContent = streamer.nickname;
    const soopId = document.createElement('small'); soopId.textContent = `@${streamer.soopId}`;
    name.append(nickname, soopId); identity.append(avatar, name);

    const metrics = document.createElement('span'); metrics.className = 'admin-stat-metrics';
    [
      ['누적 조회', streamer.totalViews],
      ['최근 7일', streamer.last7Views],
      ['최근 30일', streamer.last30Views],
      ['최근 30일 순방문', streamer.last30DailyUniqueVisitors],
    ].forEach(([label, value]) => {
      const metric = document.createElement('span'); metric.className = 'admin-stat-metric';
      const metricLabel = document.createElement('small'); metricLabel.textContent = label;
      const metricValue = document.createElement('strong'); metricValue.textContent = formatStatCount(value);
      metric.append(metricLabel, metricValue); metrics.append(metric);
    });

    const chart = document.createElement('span');
    chart.className = 'admin-stat-sparkline';
    chart.setAttribute('aria-label', '최근 30일 하루별 조회 추이');
    const daily = Array.isArray(streamer.daily) ? streamer.daily : [];
    const maxViews = Math.max(0, ...daily.map((day) => Number(day.views) || 0));
    daily.forEach((day) => {
      const bar = document.createElement('span');
      const views = Math.max(0, Number(day.views) || 0);
      bar.style.height = `${maxViews ? Math.max(5, views / maxViews * 100) : 5}%`;
      bar.title = `${day.date}: 조회 ${formatStatCount(views)}회 · 순방문 ${formatStatCount(day.uniqueVisitors)}명`;
      chart.append(bar);
    });
    card.append(identity, metrics, chart);
    container.append(card);
  }
}
function renderAdminStats(data) {
  const totals = data && data.totals ? data.totals : {};
  $('adminStatsSummary').replaceChildren();
  [
    ['인증 스트리머', `${formatStatCount(totals.streamerCount)}명`],
    ['누적 조회', `${formatStatCount(totals.totalViews)}회`],
    ['최근 7일 조회', `${formatStatCount(totals.last7Views)}회`],
    ['최근 30일 조회', `${formatStatCount(totals.last30Views)}회`],
  ].forEach(([label, value]) => {
    const tile = document.createElement('div'); tile.className = 'admin-stats-tile';
    const title = document.createElement('span'); title.textContent = label;
    const count = document.createElement('strong'); count.textContent = value;
    tile.append(title, count); $('adminStatsSummary').append(tile);
  });
  renderViewerStatsUsage(data && data.viewerStatsUsage);
  renderAdminStatsList(data && data.streamers);
}
function formatViewerStatsBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
function formatViewerStatsEstimatedUsd(value) {
  const amount = Math.max(0, Number(value) || 0);
  return amount > 0 && amount < 0.0001 ? '<$0.0001' : `~$${amount.toFixed(4)}`;
}
let latestViewerStatsAdminUsage = null;
function renderViewerStatsUsage(usage) {
  const safeUsage = usage && typeof usage === 'object' ? usage : {};
  latestViewerStatsAdminUsage = safeUsage;
  const rangeSelect = $('viewerStatsAdminDataRange');
  const selectedRange = ['today', 'last7', 'last30'].includes(rangeSelect.value) ? rangeSelect.value : 'last30';
  const selectedRangeLabel = { today: '오늘', last7: '최근 7일', last30: '최근 30일' }[selectedRange];
  const totals = safeUsage.totals && typeof safeUsage.totals === 'object' ? safeUsage.totals : {};
  const summary = $('viewerStatsAdminSummary');
  summary.replaceChildren();
  [
    ['오늘 요청', totals.today],
    ['최근 7일', totals.last7],
    ['최근 30일', totals.last30],
  ].forEach(([label, value]) => {
    const tile = document.createElement('div'); tile.className = 'admin-viewer-usage-tile';
    const title = document.createElement('span'); title.textContent = label;
    const count = document.createElement('strong'); count.textContent = `${formatStatCount(value)}회`;
    tile.append(title, count); summary.append(tile);
  });

  const chart = $('viewerStatsAdminChart');
  chart.replaceChildren();
  const daily = Array.isArray(safeUsage.daily) ? safeUsage.daily : [];
  const maxRequests = Math.max(0, ...daily.map((day) => Number(day && day.total) || 0));
  daily.forEach((day) => {
    const total = Math.max(0, Number(day && day.total) || 0);
    const bar = document.createElement('span');
    bar.setAttribute('aria-hidden', 'true');
    bar.title = `${day.date} · 요청 ${formatStatCount(total)}회`;
    bar.style.height = `${maxRequests ? Math.max(5, total / maxRequests * 100) : 3}%`;
    chart.append(bar);
  });

  const actions = safeUsage.actions30 && typeof safeUsage.actions30 === 'object' ? safeUsage.actions30 : {};
  const actionContainer = $('viewerStatsAdminActions');
  actionContainer.replaceChildren();
  [
    ['스트리머 검색', actions.search],
    ['다시보기 목록', actions.vods],
    ['시청자 그래프 분석', actions.stats],
  ].forEach(([label, value]) => {
    const row = document.createElement('div'); row.className = 'admin-viewer-usage-action';
    const title = document.createElement('span'); title.textContent = label;
    const count = document.createElement('strong'); count.textContent = `${formatStatCount(value)}회`;
    row.append(title, count); actionContainer.append(row);
  });

  const dataUsage = safeUsage.dataUsage && typeof safeUsage.dataUsage === 'object' ? safeUsage.dataUsage : {};
  const todayData = dataUsage.today && typeof dataUsage.today === 'object' ? dataUsage.today : {};
  const last7Data = dataUsage.last7 && typeof dataUsage.last7 === 'object' ? dataUsage.last7 : {};
  const last30Data = dataUsage.last30 && typeof dataUsage.last30 === 'object' ? dataUsage.last30 : {};
  const dataByRange = { today: todayData, last7: last7Data, last30: last30Data };
  const selectedData = dataByRange[selectedRange];
  const dataSummary = $('viewerStatsAdminDataSummary');
  dataSummary.replaceChildren();
  [
    ['RTDB 읽기 payload', 'rtdbReadBytes'],
    ['RTDB 쓰기 payload', 'rtdbWriteBytes'],
    ['SOOP API 요청 payload', 'soopRequestBytes'],
    ['SOOP API 응답 payload', 'soopResponseBytes'],
    ['고점체크 응답 payload', 'responseBytes'],
    ['고점체크 요청 payload', 'requestBytes'],
    ['서버 함수 호출', 'calls'],
    ['함수 실행', 'runtimeMs'],
    ['정적 생성 RTDB 읽기', 'staticExportReadBytes'],
    ['정적 파일 생성', 'staticExportRuns'],
  ].forEach(([label, key]) => {
    const tile = document.createElement('div'); tile.className = 'admin-viewer-data-tile';
    const title = document.createElement('span'); title.textContent = label;
    const value = document.createElement('strong');
    const formattedValue = (source) => {
      if (key === 'calls') return `${formatStatCount(source[key])}회`;
      if (key === 'staticExportRuns') return `${formatStatCount(source[key])}회`;
      if (key.endsWith('Ms')) return `${((Number(source[key]) || 0) / 1000 / 60).toFixed(1)}분`;
      return formatViewerStatsBytes(source[key]);
    };
    value.textContent = formattedValue(selectedData);
    const detail = document.createElement('small');
    const otherRanges = selectedRange === 'today'
      ? [['7일', last7Data], ['30일', last30Data]]
      : selectedRange === 'last7'
        ? [['오늘', todayData], ['30일', last30Data]]
        : [['오늘', todayData], ['7일', last7Data]];
    detail.textContent = `${otherRanges[0][0]} ${formattedValue(otherRanges[0][1])} · ${otherRanges[1][0]} ${formattedValue(otherRanges[1][1])}`;
    tile.append(title, value, detail); dataSummary.append(tile);
  });

  const costs = dataUsage.estimatedCostUsd && typeof dataUsage.estimatedCostUsd === 'object'
    ? dataUsage.estimatedCostUsd
    : {};
  const selectedCost = costs[selectedRange] && typeof costs[selectedRange] === 'object' ? costs[selectedRange] : {};
  const costSummary = $('viewerStatsAdminCostSummary');
  costSummary.replaceChildren();
  [
    ['RTDB 다운로드 추정', selectedCost.realtimeDatabaseCost],
    ['Cloud Functions 실행 추정', selectedCost.functionCost],
    ['합계 추정', selectedCost.totalCost],
  ].forEach(([label, amount], index) => {
    const row = document.createElement('div'); row.className = `admin-viewer-data-cost${index === 2 ? ' total' : ''}`;
    const title = document.createElement('span'); title.textContent = label;
    const value = document.createElement('strong'); value.textContent = formatViewerStatsEstimatedUsd(amount);
    row.append(title, value); costSummary.append(row);
  });
  $('viewerStatsAdminDataNote').textContent = dataUsage.startedAt
    ? `${selectedRangeLabel} 데이터 · 계측 시작 ${dataUsage.startedAt} · payload 기준(프로토콜 overhead 제외), 무료 한도·할인 차감 전 USD 추정치입니다. 인터넷 송신·Cloud Tasks·RTDB 저장 비용은 제외합니다. 브라우저의 SOOP 직접 조회와 GitHub Pages 전송은 포함되지 않습니다.`
    : '데이터·비용 계측은 배포 후부터 시작합니다. 최근 30일 요청 건수는 기존 기록을 표시합니다.';

  const tierContainer = $('viewerStatsAdminTiers');
  tierContainer.replaceChildren();
  const tiers = safeUsage.tiers30 && typeof safeUsage.tiers30 === 'object' ? safeUsage.tiers30 : {};
  [
    ['익명', tiers.anonymous],
    ['로그인', tiers.account],
    ['구독', tiers.subscriber],
    ['관리자', tiers.admin],
  ].forEach(([label, counts]) => {
    const tile = document.createElement('div'); tile.className = 'admin-viewer-usage-tier';
    const title = document.createElement('span'); title.textContent = label;
    const count = document.createElement('strong'); count.textContent = `${formatStatCount(counts && counts.total)}회`;
    tile.append(title, count); tierContainer.append(tile);
  });

  const queueContainer = $('viewerStatsAdminQueue');
  queueContainer.replaceChildren();
  const queue = safeUsage.queue30 && typeof safeUsage.queue30 === 'object' ? safeUsage.queue30 : {};
  const queuedByTier = queue.queuedByTier && typeof queue.queuedByTier === 'object' ? queue.queuedByTier : {};
  [
    ['현재 대기', `${formatStatCount(queue.queuedNow)}건`],
    ['등급별 대기', `익명 ${formatStatCount(queuedByTier.anonymous)} · 로그인 ${formatStatCount(queuedByTier.account)} · 구독 ${formatStatCount(queuedByTier.subscriber)} · 관리자 ${formatStatCount(queuedByTier.admin)}`],
    ['대기열 등록', `${formatStatCount(queue.enqueued)}건`],
    ['완료', `${formatStatCount(queue.completed)}건`],
    ['평균 대기', queue.averageWaitMs ? `${(Number(queue.averageWaitMs) / 1000).toFixed(1)}초` : '0초'],
    ['실패', `${formatStatCount(queue.failed)}건`],
    ['취소', `${formatStatCount(queue.cancelled)}건`],
    ['캐시 적중', `${formatStatCount(queue.cacheHits)}회`],
  ].forEach(([label, value]) => {
    const row = document.createElement('div'); row.className = 'admin-viewer-usage-action';
    const title = document.createElement('span'); title.textContent = label;
    const count = document.createElement('strong'); count.textContent = value;
    row.append(title, count); queueContainer.append(row);
  });

  const streamerList = $('viewerStatsAdminStreamerList');
  streamerList.replaceChildren();
  const topStreamers = Array.isArray(safeUsage.topSearchedStreamers) ? safeUsage.topSearchedStreamers : [];
  if (!topStreamers.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-viewer-usage-streamers-empty';
    empty.textContent = '아직 집계된 스트리머 선택이 없어요.';
    streamerList.append(empty);
    return;
  }
  topStreamers.forEach((streamer, index) => {
    const row = document.createElement('div'); row.className = 'admin-viewer-usage-streamer';
    const rank = document.createElement('span'); rank.className = 'admin-viewer-usage-streamer-rank';
    rank.textContent = String(index + 1);
    const identity = document.createElement('span'); identity.className = 'admin-viewer-usage-streamer-identity';
    const soopId = String(streamer.soopId || streamer.id || '').trim();
    const nickname = String(streamer.nickname || soopId).trim();
    const name = document.createElement('strong'); name.textContent = nickname || soopId;
    identity.append(name);
    if (soopId && nickname.toLocaleLowerCase() !== soopId.toLocaleLowerCase()
      && nickname !== `@${soopId}`) {
      const id = document.createElement('small'); id.textContent = `@${soopId}`;
      identity.append(id);
    }
    const count = document.createElement('strong');
    count.className = 'admin-viewer-usage-streamer-count';
    count.textContent = `${formatStatCount(streamer.count)}회`;
    row.append(rank, identity, count); streamerList.append(row);
  });
}
function renderAdminViewerSubscriptionRequests(requests, truncated = false) {
  const container = $('viewerSubscriptionAdminList');
  container.replaceChildren();
  const rows = Array.isArray(requests) ? requests : [];
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-viewer-subscription-empty';
    empty.textContent = '확인 대기 중인 구독 신청이 없습니다.';
    container.append(empty);
  }
  rows.forEach((request) => {
    const row = document.createElement('article');
    row.className = 'admin-viewer-subscription-row';
    const identity = document.createElement('div');
    identity.className = 'admin-viewer-subscription-identity';
    const soopId = String(request.soopId || request.donorSoopId || '').trim();
    const isCommentCodeRequest = request.verificationMethod === 'subscriber-comment-code';
    const nickname = document.createElement('strong');
    nickname.textContent = request.nickname || (soopId ? '닉네임 미확인' : '닉네임 없음');
    const soopIdLabel = document.createElement('small');
    soopIdLabel.textContent = soopId
      ? `${isCommentCodeRequest ? '구독 인증 SOOP 아이디' : '후원 SOOP 아이디'} · @${soopId}`
      : isCommentCodeRequest ? '구독 인증 SOOP 아이디 확인 필요' : 'SOOP 아이디 미입력 · 기존 후원 신청';
    const account = document.createElement('small');
    const uid = String(request.requesterUid || '');
    account.textContent = '계정 UID · ' + (uid.length > 8 ? '…' + uid.slice(-8) : uid);
    const donationStatus = document.createElement('small');
    donationStatus.textContent = isCommentCodeRequest
      ? '구독자 댓글 코드 인증 · SOOP 구독 상태 확인 대기'
      : request.verificationSource === 'soop-donation-notification'
      ? '과거 SOOP 후원 알림 자동 확인 기록'
      : request.donationCompletedAt
        ? '후원 완료 신호 · ' + new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(request.donationCompletedAt))
        : soopId ? '후원 완료 표시 전 · 관리자 수동 확인 대기' : '후원 정보 없음 · 관리자 수동 확인';
    const requestedAt = document.createElement('small');
    requestedAt.textContent = request.requestedAt
      ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(request.requestedAt))
      : '신청 시각 없음';
    identity.append(nickname, soopIdLabel, donationStatus, account, requestedAt);

    const actions = document.createElement('div');
    actions.className = 'admin-viewer-subscription-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'button button-primary';
    approve.dataset.subscriptionAction = 'approve';
    approve.dataset.requestId = request.requestId;
    const processingAge = Date.now() - (Number(request.processingAt) || 0);
    const processingActive = request.status === 'processing' && processingAge < 2 * 60 * 1000;
    approve.disabled = processingActive;
    approve.textContent = processingActive ? '승인 처리 중…' : request.status === 'processing' ? '승인 재개' : isCommentCodeRequest ? '구독 인증 확인 · 승인' : '후원 확인 · 30일 승인';
    actions.append(approve);
    if (request.status === 'pending') {
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'button';
      reject.dataset.subscriptionAction = 'reject';
      reject.dataset.requestId = request.requestId;
      reject.textContent = '거절';
      actions.append(reject);
    }
    row.append(identity, actions);
    container.append(row);
  });
  $('viewerSubscriptionAdminStatus').textContent = rows.length
    ? `${formatStatCount(rows.length)}건 대기 중${truncated ? ' · 200건까지만 표시' : ''}. 구독 인증 또는 후원 정보와 SOOP 아이디를 확인한 뒤 처리해 주세요.`
    : '현재 확인 대기 중인 신청이 없습니다.';
}
async function loadAdminViewerSubscriptionRequests() {
  if (!isAdminUser || adminViewerSubscriptionsLoading) return;
  adminViewerSubscriptionsLoading = true;
  $('refreshViewerSubscriptionRequests').disabled = true;
  $('viewerSubscriptionAdminStatus').textContent = '구독 신청을 불러오고 있어요.';
  try {
    const result = await callAdminViewerSubscriptionRequests({ action: 'list' });
    if (!isAdminUser) return;
    renderAdminViewerSubscriptionRequests(result.data && result.data.requests, result.data && result.data.truncated);
  } catch (error) {
    $('viewerSubscriptionAdminStatus').textContent = error.message || '구독 신청을 불러오지 못했어요.';
  } finally {
    adminViewerSubscriptionsLoading = false;
    $('refreshViewerSubscriptionRequests').disabled = false;
  }
}
async function loadAdminStats() {
  if (!isAdminUser || adminStatsLoading) return;
  adminStatsLoading = true;
  $('refreshAdminStats').disabled = true;
  $('refreshAdminStats').textContent = '불러오는 중…';
  $('adminStatsStatus').textContent = '관리자 통계를 불러오고 있어요.';
  try {
    const result = await callAdminStats();
    if (!isAdminUser) return;
    adminStatsData = result.data;
    renderAdminStats(adminStatsData);
    await loadAdminViewerSubscriptionRequests();
    const generatedAt = Number(adminStatsData.generatedAt);
    const generatedAtLabel = Number.isFinite(generatedAt)
      ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(generatedAt))
      : '';
    $('adminStatsStatus').textContent = generatedAtLabel
      ? `최근 집계 ${generatedAtLabel} · 최근 30일 기준${adminStatsData.snapshotStale ? ' · 집계 갱신 지연' : ''}`
      : '최근 30일 기준 집계예요.';
  } catch (error) {
    $('adminStatsStatus').textContent = error.message || '통계를 불러오지 못했어요.';
  } finally {
    adminStatsLoading = false;
    $('refreshAdminStats').disabled = false;
    $('refreshAdminStats').textContent = '↻ 스냅샷 다시 불러오기';
  }
}
function renderAdminDesignFeedback(items) {
  const container = $('adminDesignFeedbackList');
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-design-feedback-empty';
    empty.textContent = '접수된 디자인 문의나 건의가 없어요.';
    container.append(empty);
    return;
  }
  const categories = { design: '디자인 변경 문의', suggestion: '기능 건의', bug: '오류 제보', other: '기타' };
  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = `admin-design-feedback-item${item.status === 'resolved' ? ' is-resolved' : ''}`;
    const heading = document.createElement('div'); heading.className = 'admin-design-feedback-item-heading';
    const title = document.createElement('strong'); title.textContent = item.title || '(제목 없음)';
    const category = document.createElement('span'); category.className = 'admin-design-feedback-category';
    category.textContent = categories[item.category] || '기타';
    heading.append(title, category);
    const content = document.createElement('p'); content.className = 'admin-design-feedback-content'; content.textContent = item.content || '';
    const page = item.streamerNickname
      ? `${item.streamerNickname} 팬페이지${item.streamerId ? ` (@${item.streamerId})` : ''}`
      : '사이트 전체';
    const sender = String(item.senderUid || '');
    const verification = item.senderVerification && typeof item.senderVerification === 'object'
      ? item.senderVerification
      : {};
    const verifiedNickname = String(verification.nickname || '').trim();
    const verifiedSoopId = String(verification.soopId || '').trim();
    const verifiedAt = Number(verification.verifiedAt) || 0;
    const verifiedIdentity = verifiedNickname
      ? `${verifiedNickname}${verifiedSoopId ? ` (@${verifiedSoopId})` : ''}`
      : '확인 불가';
    const meta = document.createElement('p'); meta.className = 'admin-design-feedback-meta';
    meta.textContent = `${item.status === 'resolved' ? '처리 완료 · ' : ''}${page} · 인증 제출자 ${verifiedIdentity}${verifiedAt ? ` · 인증일 ${formatCommentDate(verifiedAt)}` : ''} · ${formatCommentDate(item.createdAt)} · UID ${sender ? `${sender.slice(0, 8)}…` : '확인 불가'}`;
    const actions = document.createElement('div'); actions.className = 'admin-design-feedback-item-actions';
    const statusButton = document.createElement('button'); statusButton.type = 'button'; statusButton.className = 'button';
    statusButton.dataset.designFeedbackAction = 'status'; statusButton.dataset.feedbackId = item.id;
    statusButton.dataset.feedbackStatus = item.status === 'resolved' ? 'open' : 'resolved';
    statusButton.textContent = item.status === 'resolved' ? '미처리로 변경' : '처리 완료';
    const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.className = 'button';
    deleteButton.dataset.designFeedbackAction = 'delete'; deleteButton.dataset.feedbackId = item.id;
    deleteButton.textContent = '삭제';
    actions.append(statusButton, deleteButton);
    article.append(heading, content, meta, actions);
    container.append(article);
  });
}
async function loadAdminDesignFeedback() {
  if (!isAdminUser || adminDesignFeedbackLoading) return;
  adminDesignFeedbackLoading = true;
  $('refreshDesignFeedback').disabled = true;
  $('refreshDesignFeedback').textContent = '불러오는 중…';
  $('adminDesignFeedbackStatus').textContent = '접수된 건의를 불러오고 있어요.';
  try {
    const result = await callDesignFeedback({ action: 'list' });
    if (!isAdminUser) return;
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    renderAdminDesignFeedback(items);
    $('adminDesignFeedbackStatus').textContent = `최근 접수 ${items.length.toLocaleString('ko-KR')}건 · 최대 100건 표시`;
  } catch (error) {
    $('adminDesignFeedbackStatus').textContent = error.message || '건의를 불러오지 못했어요.';
  } finally {
    adminDesignFeedbackLoading = false;
    $('refreshDesignFeedback').disabled = false;
    $('refreshDesignFeedback').textContent = '↻ 건의 새로고침';
  }
}
function renderAdminTamagotchiApplications() {
  const container = $('adminTamagotchiApplicationList');
  if (!container) return;
  container.replaceChildren();
  const filter = $('adminTamagotchiApplicationFilter')?.value || 'all';
  const items = adminTamagotchiApplications.filter((item) => filter === 'all' || item.status === filter);
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'admin-tamagotchi-empty';
    empty.textContent = filter === 'pending' ? '검토 대기 중인 신청서가 없어요.' : '표시할 신청서가 없어요.';
    container.append(empty); return;
  }
  const statusLabels = { pending: '검토 대기', approved: '승인', rejected: '보완 요청' };
  items.forEach((item) => {
    const article = document.createElement('article'); article.className = `admin-tamagotchi-item is-${item.status}`;
    const heading = document.createElement('div'); heading.className = 'admin-tamagotchi-item-heading';
    const title = document.createElement('strong'); title.textContent = item.characterName || '(캐릭터 이름 없음)';
    const status = document.createElement('span'); status.className = 'admin-tamagotchi-status'; status.textContent = statusLabels[item.status] || '확인 필요';
    const badges = document.createElement('div'); badges.className = 'admin-tamagotchi-item-badges';
    const requestMode = document.createElement('span'); requestMode.className = 'admin-tamagotchi-mode';
    requestMode.textContent = item.requestMode === 'delegate' ? '개발자 자율 제작' : '기존 신청양식';
    badges.append(requestMode, status);
    heading.append(title, badges);
    const streamer = document.createElement('p'); streamer.className = 'admin-tamagotchi-streamer';
    streamer.textContent = `${item.streamerNickname || '알 수 없는 스트리머'}${item.streamerSoopId ? ` (@${item.streamerSoopId})` : ''} · 신청 ${formatCommentDate(item.createdAt)}`;
    const concept = document.createElement('p'); concept.className = 'admin-tamagotchi-concept'; concept.textContent = item.visualConcept || '';
    const interactions = document.createElement('div'); interactions.className = 'tamagotchi-tag-list';
    (Array.isArray(item.interactionPreferences) ? item.interactionPreferences : []).forEach((key) => {
      const option = TAMAGOTCHI_INTERACTIONS.find(([interactionKey]) => interactionKey === key);
      if (!option) return;
      const tag = document.createElement('span'); tag.textContent = option[1]; interactions.append(tag);
    });
    article.append(heading, streamer, concept, interactions);
    if (item.referenceImageUrl) {
      const reference = document.createElement('a'); reference.className = 'admin-tamagotchi-reference';
      reference.href = item.referenceImageUrl; reference.target = '_blank'; reference.rel = 'noopener noreferrer';
      reference.textContent = '참고 이미지 열기 ↗'; article.append(reference);
    }
    if (item.notes) {
      const notes = document.createElement('p'); notes.className = 'admin-tamagotchi-notes';
      const label = document.createElement('strong'); label.textContent = '추가 요청';
      const text = document.createElement('span'); text.textContent = item.notes;
      notes.append(label, text); article.append(notes);
    }
    if (item.reviewNote) {
      const reviewNote = document.createElement('p'); reviewNote.className = 'admin-tamagotchi-review-note';
      reviewNote.textContent = `검토 메모: ${item.reviewNote}`; article.append(reviewNote);
    }
    if (item.status === 'pending') {
      const actions = document.createElement('div'); actions.className = 'admin-tamagotchi-actions';
      [['approve', '승인'], ['reject', '보완 요청']].forEach(([action, label]) => {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `button${action === 'approve' ? ' button-primary' : ''}`;
        button.dataset.tamagotchiAction = action; button.dataset.streamerId = item.streamerId; button.dataset.applicationId = item.id;
        button.textContent = label; actions.append(button);
      });
      article.append(actions);
    }
    container.append(article);
  });
}
async function loadAdminTamagotchiApplications() {
  if (!isAdminUser || adminTamagotchiApplicationsLoading) return;
  adminTamagotchiApplicationsLoading = true;
  const refresh = $('refreshTamagotchiApplications');
  if (refresh) { refresh.disabled = true; refresh.textContent = '불러오는 중…'; }
  $('adminTamagotchiApplicationStatus').textContent = '신청서를 불러오고 있어요.';
  try {
    const result = await callTamagotchiApplications({ action: 'list' });
    if (!isAdminUser) return;
    adminTamagotchiApplications = Array.isArray(result.data?.items) ? result.data.items : [];
    renderAdminTamagotchiApplications();
    const pending = adminTamagotchiApplications.filter((item) => item.status === 'pending').length;
    $('adminTamagotchiApplicationStatus').textContent = `최근 신청 ${adminTamagotchiApplications.length}건 · 검토 대기 ${pending}건 · 최대 100건 표시`;
  } catch (error) {
    $('adminTamagotchiApplicationStatus').textContent = error.message || '신청서를 불러오지 못했어요.';
  } finally {
    adminTamagotchiApplicationsLoading = false;
    if (refresh) { refresh.disabled = false; refresh.textContent = '↻ 신청 새로고침'; }
  }
}
function openTamagotchiAdminFromDeepLink() {
  if (!isAdminUser || new URLSearchParams(location.search).get('admin') !== 'tamagotchi') return false;
  const currentUrl = new URL(location.href);
  currentUrl.searchParams.delete('admin');
  history.replaceState(null, '', currentUrl.href);
  showFanPageModal($('adminStatsDialog'));
  loadAdminTamagotchiApplications();
  return true;
}
async function waitForPageAssets() {
  const images = [...document.querySelectorAll('#mainContent img')]
    .filter((image) => image.loading !== 'lazy' && image.getBoundingClientRect().top < window.innerHeight);
  const criticalAssets = [
    ...(document.fonts && document.fonts.ready ? [document.fonts.ready.catch(() => undefined)] : []),
    catPawCloseArtwork.decode().catch(() => undefined),
    ...images.map((image) => image.decode().catch(() => undefined)),
  ];
  let timeoutId;
  await Promise.race([
    Promise.all(criticalAssets),
    new Promise((resolve) => { timeoutId = window.setTimeout(resolve, 1800); }),
  ]);
  window.clearTimeout(timeoutId);
}
function setVisibleView(page) {
  if (!page && fanPageQuickNavCleanup) {
    fanPageQuickNavCleanup();
    fanPageQuickNavCleanup = null;
  }
  if (!page && liveStatusTimer) {
    window.clearInterval(liveStatusTimer);
    liveStatusTimer = 0;
  }
  if (!page && stockPriceUnsubscribe) {
    stockPriceUnsubscribe();
    stockPriceUnsubscribe = null;
  }
  if (!page) stockPriceSparklineRequest += 1;
  if (!page) publishFanpageEmoteContext(null);
  document.querySelector('.topbar').classList.remove('topbar-with-banner', 'topbar-account-banner-hidden');
  $('siteShell').classList.remove('has-bottom-banner');
  document.body.classList.remove('fanpage-bottom-banner-active');
  $('mainContent').classList.toggle('has-fanpage-view', !!page);
  const usesKawaiiLayout = !!page && page.profile?.layoutDesign !== 2;
  const usesKawaiiHome = !page;
  $('mainContent').classList.toggle('has-fanpage-layout-one', usesKawaiiLayout);
  $('mainContent').classList.toggle('has-fanpage-home-kawaii', usesKawaiiHome);
  document.body.classList.toggle('fanpage-layout-one-active', usesKawaiiLayout);
  document.body.classList.toggle('fanpage-home-kawaii-active', usesKawaiiHome);
  document.body.classList.toggle('fanpage-theme-sora-active', !!page && String(page.streamer.id || '').toLowerCase() === 'yuhatty');
  $('homeView').classList.toggle('hidden', !!page);
  $('fanPageView').classList.toggle('hidden', !page);
  $('devbar').classList.toggle('hidden', !!page);
  $('brandEyebrow').classList.toggle('hidden', !!page);
  const pageName = page ? `${page.streamer.nickname} 팬페이지` : '스트리머 팬페이지';
  $('brandTitle').textContent = pageName;
  document.title = pageName;
  if (page) renderFanPage(page);
}
function upboStateFor(streamerId) {
  if (!upboStates.has(streamerId)) {
    upboStates.set(streamerId, {
      loaded: false, loadingTopics: false, loadingTopic: false, saving: false,
      error: '', topics: [], canManage: false, activeTopicId: '', topic: null,
      viewers: [], viewerCount: 0, hasMore: false, nextCursor: '',
      topicsRequestId: 0, topicRequestId: 0,
      boardLoaded: false, loadingBoard: false, loadingMoreRecords: false, loadingMorePending: false,
      submitting: false, items: [], pending: [], records: [],
      requestDraft: { nickname: '', lines: [], activeLineId: '' },
      pendingHasMore: false, pendingNextCursor: '', recordsHasMore: false, recordsNextCursor: '',
      boardRequestId: 0,
    });
  }
  return upboStates.get(streamerId);
}

function createUpboId() {
  return window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function upboButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = `button ${className || ''}`.trim(); button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function formatUpboCount(value) {
  return `${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('ko-KR')}개`;
}

function renderUpboRangeTable(rows, kind, page, topic, state) {
  const wrapper = document.createElement('div'); wrapper.className = `upbo-range-table upbo-${kind}-table`;
  const header = document.createElement('div'); header.className = `upbo-range-head upbo-${kind}-grid`;
  const countHeading = document.createElement('strong'); countHeading.textContent = '누적 후원';
  const rewardHeading = document.createElement('strong'); rewardHeading.textContent = kind === 'promise' ? '공약' : '보상';
  header.append(countHeading, rewardHeading);
  const statusHeading = document.createElement('strong'); statusHeading.textContent = '달성'; header.append(statusHeading);
  wrapper.append(header);
  rows.forEach((row) => {
    const line = document.createElement('div'); line.className = `upbo-range-row upbo-${kind}-grid`;
    const count = document.createElement('strong'); count.className = 'upbo-range-count'; count.textContent = formatUpboCount(row.donationCount);
    const reward = document.createElement('span'); reward.className = 'upbo-range-reward'; reward.textContent = row.reward;
    line.append(count, reward);
    const status = document.createElement('span'); status.className = `upbo-achievement${row.achieved ? ' is-achieved' : ''}`;
    if (state.canManage) {
      const label = document.createElement('label'); label.className = 'upbo-achievement-control';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = row.achieved === true;
      checkbox.disabled = state.saving;
      checkbox.setAttribute('aria-label', `${row.reward} 달성 여부`);
      checkbox.addEventListener('change', () => {
        checkbox.disabled = true;
        updateUpboRowAchievement(page, topic, kind, row.id, checkbox.checked);
      });
      const text = document.createElement('span'); text.textContent = row.achieved ? '달성' : '진행 중';
      label.append(checkbox, text); status.append(label);
    } else {
      status.textContent = row.achieved ? '✓ 달성' : '진행 중';
    }
    line.append(status);
    wrapper.append(line);
  });
  return wrapper;
}

async function updateUpboRowAchievement(page, topic, kind, rowId, achieved) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving) return;
  const sourceTopic = state.topic && state.topic.id === topic.id ? state.topic : topic;
  const updateRows = (rows, targetKind) => rows.map((row) => ({
    ...row,
    achieved: targetKind === kind && row.id === rowId ? achieved : row.achieved === true,
  }));
  const previousTopic = state.topic;
  const topicIndex = state.topics.findIndex((item) => item.id === sourceTopic.id);
  const previousListTopic = topicIndex >= 0 ? state.topics[topicIndex] : null;
  const optimisticTopic = {
    ...sourceTopic,
    promises: updateRows(sourceTopic.promises || [], 'promise'),
    rewardTiers: updateRows(sourceTopic.rewardTiers || [], 'reward'),
  };
  state.topic = optimisticTopic;
  if (topicIndex >= 0) state.topics[topicIndex] = { ...state.topics[topicIndex], ...optimisticTopic };
  state.saving = true;
  refreshUpboSection(page.streamer.id);
  try {
    const result = (await callUpbo({
      action: 'saveTopic', streamerId: page.streamer.id, topicId: sourceTopic.id,
      topic: {
        id: sourceTopic.id,
        title: sourceTopic.title,
        description: sourceTopic.description || '',
        promises: optimisticTopic.promises,
        rewardTiers: optimisticTopic.rewardTiers,
      },
    })).data;
    const savedTopic = { ...result.topic, viewerCount: sourceTopic.viewerCount || state.viewerCount || 0 };
    state.topic = savedTopic;
    if (topicIndex >= 0) state.topics[topicIndex] = { ...state.topics[topicIndex], ...savedTopic };
    showToast(achieved ? '항목을 달성 완료로 표시했어요.' : '달성 표시를 해제했어요.');
  } catch (error) {
    state.topic = previousTopic;
    if (topicIndex >= 0 && previousListTopic) state.topics[topicIndex] = previousListTopic;
    showToast(error.message || '달성 상태를 저장하지 못했어요.');
  } finally {
    state.saving = false;
    refreshUpboSection(page.streamer.id);
  }
}

function renderUpboSection(page) {
  const state = upboStateFor(page.streamer.id);
  const section = document.createElement('section'); section.id = 'upboSection'; section.className = 'content-card upbo-section';
  const heading = document.createElement('div'); heading.className = 'upbo-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'SUPPORT REWARDS';
  const title = document.createElement('h2'); title.textContent = '업보 정리';
  const subtitle = document.createElement('p'); subtitle.className = 'upbo-subtitle'; subtitle.textContent = '원하는 항목과 수량을 신청하면 스트리머가 확인 후 등록해요.';
  copy.append(eyebrow, title, subtitle);
  const actions = document.createElement('div'); actions.className = 'upbo-heading-actions';
  const refresh = upboButton(state.loadingBoard ? '불러오는 중…' : '↻ 새로고침', 'upbo-refresh-button', () => loadUpboBoard(page.streamer.id));
  refresh.disabled = state.loadingBoard || state.loadingMorePending || state.loadingMoreRecords || state.saving;
  actions.append(refresh);
  if (state.canManage) {
    const addItem = upboButton('+ 신청 항목 추가', 'button-primary upbo-add-topic', () => openUpboItemEditor(page));
    addItem.disabled = state.saving; actions.append(addItem);
  }
  heading.append(copy, actions); section.append(heading);

  if (!state.boardLoaded || state.loadingBoard) {
    const status = document.createElement('p'); status.className = 'upbo-status'; status.textContent = '업보 정리를 불러오고 있어요.';
    section.append(status); return section;
  }
  if (state.error && !state.items.length && !state.records.length && !state.pending.length) {
    const status = document.createElement('p'); status.className = 'upbo-status is-error'; status.textContent = state.error;
    section.append(status); return section;
  }
  if (state.error) {
    const error = document.createElement('p'); error.className = 'upbo-status is-error'; error.textContent = state.error; section.append(error);
  }
  section.append(renderUpboRequestForm(page, state));
  if (state.canManage) section.append(renderUpboItemManager(page, state), renderUpboPendingQueue(page, state));
  section.append(renderUpboRecords(page, state));
  return section;
}

function formatUpboDateTime(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0
    ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : '';
}

function renderUpboRequestForm(page, state) {
  const panel = document.createElement('section'); panel.className = 'upbo-subsection upbo-request-panel';
  const heading = document.createElement('div'); heading.className = 'upbo-subsection-heading';
  const title = document.createElement('h4'); title.textContent = '업보 항목 신청';
  heading.append(title); panel.append(heading);
  const items = state.items.filter((item) => item.active);
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'upbo-inline-empty';
    if (state.canManage) {
      empty.textContent = '신청 항목을 추가하면 팬들이 여기서 신청할 수 있어요.';
    } else {
      empty.classList.add('upbo-request-empty');
      const message = document.createElement('span'); message.textContent = '아직 신청할 수 있는 항목이 없어요.';
      const hint = document.createElement('span'); hint.className = 'upbo-request-empty-hint';
      hint.textContent = '스트리머에게 신청 항목을 추가해 달라고 요청해 보세요.';
      empty.append(message, hint);
    }
    panel.append(empty); return panel;
  }
  const draft = state.requestDraft || (state.requestDraft = { nickname: '', lines: [], activeLineId: '' });
  const form = document.createElement('form'); form.className = 'upbo-request-form'; form.autocomplete = 'off';
  const nickname = upboEditorField('닉네임', 'input', { type: 'text', maxlength: 40, required: true, placeholder: '방송에서 사용하는 닉네임' });
  nickname.field.autocomplete = 'off'; nickname.field.value = draft.nickname;
  nickname.field.addEventListener('input', () => { draft.nickname = nickname.field.value; });

  const availablePanel = document.createElement('div'); availablePanel.className = 'upbo-choice-panel';
  const availableHeading = document.createElement('h5'); availableHeading.textContent = '신청할 항목을 선택해 주세요';
  const availableGrid = document.createElement('div'); availableGrid.className = 'upbo-choice-grid';
  items.forEach((entry) => {
    const selectedCount = draft.lines.filter((line) => line.itemId === entry.id).length;
    const imageUrl = normalizeUpboImageUrl(entry.imageUrl);
    const option = document.createElement('div'); option.className = 'upbo-choice-option';
    const button = document.createElement('button'); button.type = 'button';
    button.className = `button upbo-choice-item${imageUrl ? ' has-image' : ''}${selectedCount ? ' is-selected' : ''}`;
    let suppressLongPressClick = false;
    button.addEventListener('click', () => {
      if (suppressLongPressClick) { suppressLongPressClick = false; return; }
      if (draft.lines.length >= MAX_UPBO_ITEMS) {
        showToast(`한 번에 최대 ${MAX_UPBO_ITEMS}개 항목까지 신청할 수 있어요.`);
        return;
      }
      const line = { lineId: createUpboId(), itemId: entry.id, itemName: entry.name, quantity: 1, requestNotes: '' };
      draft.lines.push(line);
      draft.activeLineId = line.lineId;
      refreshUpboSection(page.streamer.id);
    });
    button.setAttribute('aria-label', `${entry.name} 항목 담기${selectedCount ? `, 현재 ${selectedCount}개 선택됨` : ''}`);
    const preview = document.createElement('div'); preview.className = 'upbo-choice-preview';
    preview.id = `upbo-preview-${entry.id}`; preview.setAttribute('role', 'tooltip');
    button.setAttribute('aria-describedby', preview.id);
    if (imageUrl) {
      const previewImage = document.createElement('img'); previewImage.className = 'upbo-choice-preview-image';
      previewImage.src = imageUrl; previewImage.alt = ''; previewImage.loading = 'lazy';
      previewImage.decoding = 'async'; previewImage.referrerPolicy = 'no-referrer';
      preview.append(previewImage);
    }
    const previewCopy = document.createElement('div'); previewCopy.className = 'upbo-choice-preview-copy';
    const previewTitle = document.createElement('strong'); previewTitle.textContent = entry.name;
    const previewDescription = document.createElement('p');
    previewDescription.textContent = entry.description || '등록된 설명이 없어요.';
    previewCopy.append(previewTitle, previewDescription); preview.append(previewCopy);
    const placePreview = () => {
      const bounds = button.getBoundingClientRect();
      const previewHeight = preview.getBoundingClientRect().height;
      option.classList.toggle('preview-align-right', bounds.left + bounds.width / 2 > window.innerWidth / 2);
      option.classList.toggle('preview-below', bounds.top < previewHeight + 16);
    };
    button.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') placePreview(); });
    button.addEventListener('focus', placePreview);
    let longPressTimer = 0;
    const hideLongPressPreview = () => {
      window.clearTimeout(longPressTimer); longPressTimer = 0;
      option.classList.remove('is-preview-open');
    };
    const resetLongPress = () => {
      hideLongPressPreview();
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      suppressLongPressClick = false;
      window.clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(() => {
        placePreview();
        option.classList.add('is-preview-open');
        suppressLongPressClick = true;
      }, 450);
    });
    button.addEventListener('pointerup', () => {
      hideLongPressPreview();
    });
    button.addEventListener('pointercancel', () => {
      resetLongPress();
      suppressLongPressClick = false;
    });
    button.addEventListener('pointerleave', resetLongPress);
    button.addEventListener('contextmenu', (event) => {
      if (suppressLongPressClick) event.preventDefault();
    });
    if (imageUrl) {
      const image = document.createElement('img'); image.className = 'upbo-choice-image';
      image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      button.append(image);
    }
    const copy = document.createElement('span'); copy.className = 'upbo-choice-copy';
    const name = document.createElement('strong'); name.textContent = entry.name;
    const description = document.createElement('small');
    description.textContent = selectedCount
      ? `${selectedCount}개 담김 · 눌러서 더 담기`
      : entry.description || '눌러서 담기';
    copy.append(name, description);
    const mark = document.createElement('span'); mark.className = 'upbo-choice-mark'; mark.textContent = '+';
    button.append(copy, mark); option.append(button, preview); availableGrid.append(option);
  });
  availablePanel.append(availableHeading, availableGrid);

  const cartPanel = document.createElement('div'); cartPanel.className = 'upbo-cart-panel';
  const cartHeading = document.createElement('div'); cartHeading.className = 'upbo-cart-heading';
  const cartTitle = document.createElement('h5'); cartTitle.textContent = '선택한 항목';
  const cartCount = document.createElement('span'); cartCount.className = 'upbo-viewer-total'; cartCount.textContent = `${draft.lines.length}개`;
  cartHeading.append(cartTitle, cartCount); cartPanel.append(cartHeading);
  if (!draft.lines.length) {
    const cartEmpty = document.createElement('p'); cartEmpty.className = 'upbo-inline-empty';
    cartEmpty.textContent = '항목을 누르면 여기에 담겨요.'; cartPanel.append(cartEmpty);
  } else {
    const cartList = document.createElement('div'); cartList.className = 'upbo-cart-list';
    draft.lines.forEach((line) => {
      if (!line.lineId) line.lineId = createUpboId();
      const card = document.createElement('div');
      const expanded = draft.activeLineId === line.lineId;
      card.className = `upbo-cart-item${expanded ? ' is-expanded' : ''}`;
      const item = items.find((candidate) => candidate.id === line.itemId);
      const cardHeading = document.createElement('div'); cardHeading.className = 'upbo-cart-item-heading';
      const toggle = upboButton('', 'upbo-cart-item-toggle', () => {
        draft.activeLineId = expanded ? '' : line.lineId;
        refreshUpboSection(page.streamer.id);
      });
      toggle.setAttribute('aria-expanded', String(expanded));
      const name = document.createElement('strong'); name.textContent = item ? item.name : line.itemName;
      const summary = document.createElement('span'); summary.className = 'upbo-cart-quantity-summary';
      summary.textContent = line.quantity > 0 ? `× ${Number(line.quantity).toLocaleString('ko-KR')}` : '수량 입력';
      toggle.append(name, summary);
      const remove = upboButton('×', 'upbo-cart-remove', () => {
        draft.lines = draft.lines.filter((candidate) => candidate.lineId !== line.lineId);
        if (draft.activeLineId === line.lineId) draft.activeLineId = '';
        refreshUpboSection(page.streamer.id);
      });
      remove.setAttribute('aria-label', `${line.itemName} 선택 해제`);
      cardHeading.append(toggle, remove); card.append(cardHeading);
      if (expanded) {
        const controls = document.createElement('div'); controls.className = 'upbo-cart-controls';
        const quantityLabel = document.createElement('label'); quantityLabel.className = 'upbo-cart-quantity-label';
        quantityLabel.append(document.createTextNode('수량'));
        const quantityControl = document.createElement('div'); quantityControl.className = 'upbo-cart-quantity-control';
        const quantityInput = document.createElement('input'); quantityInput.type = 'number';
        quantityInput.className = 'upbo-cart-quantity-input'; quantityInput.min = '1'; quantityInput.max = '1000000';
        quantityInput.step = '1'; quantityInput.required = true; quantityInput.value = line.quantity > 0 ? String(line.quantity) : '1';
        quantityInput.inputMode = 'numeric'; quantityInput.setAttribute('aria-label', `${line.itemName} 수량`);
        function updateQuantitySummary() {
          summary.textContent = line.quantity > 0 ? `× ${Number(line.quantity).toLocaleString('ko-KR')}` : '수량 입력';
        }
        const decrease = upboButton('−', 'upbo-cart-quantity-step', () => {
          const value = Math.max(1, (Number(line.quantity) || 1) - 1);
          line.quantity = value; quantityInput.value = String(value); updateQuantitySummary();
        });
        decrease.setAttribute('aria-label', `${line.itemName} 수량 줄이기`);
        const increase = upboButton('+', 'upbo-cart-quantity-step', () => {
          const value = Math.min(1000000, (Number(line.quantity) || 0) + 1);
          line.quantity = value; quantityInput.value = String(value); updateQuantitySummary();
        });
        increase.setAttribute('aria-label', `${line.itemName} 수량 늘리기`);
        quantityInput.addEventListener('input', () => {
          const value = Number(quantityInput.value);
          line.quantity = Number.isSafeInteger(value) && value >= 1 && value <= 1000000 ? value : 0;
          updateQuantitySummary();
        });
        quantityInput.addEventListener('change', () => {
          if (!quantityInput.value || line.quantity < 1) {
            line.quantity = 1; quantityInput.value = '1'; updateQuantitySummary();
          }
        });
        quantityControl.append(decrease, quantityInput, increase);
        quantityLabel.append(quantityControl);
        const requestNotes = upboEditorField('요청사항 (선택)', 'textarea', { maxlength: 500, rows: 3, placeholder: '스트리머에게 전달할 내용을 적어 주세요.' });
        requestNotes.field.classList.add('upbo-cart-request-notes');
        requestNotes.field.value = line.requestNotes || '';
        requestNotes.field.addEventListener('input', () => { line.requestNotes = requestNotes.field.value; });
        controls.append(quantityLabel, requestNotes.label); card.append(controls);
      }
      cartList.append(card);
    });
    cartPanel.append(cartList);
  }

  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button button-primary upbo-request-submit';
  submit.textContent = state.submitting ? '신청 중…' : `선택 ${draft.lines.length}개 신청 보내기`;
  submit.disabled = state.submitting || !draft.lines.length;
  const note = document.createElement('p'); note.className = 'upbo-request-note';
  note.textContent = '선택한 각 항목은 스트리머 검토 목록에 따로 표시되며, 승인된 항목만 공개 기록에 등록됩니다.';
  form.append(nickname.label, availablePanel, cartPanel, submit, note);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || state.submitting) return;
    state.submitting = true; submit.disabled = true; submit.textContent = '신청 중…';
    form.querySelectorAll('button, input, textarea').forEach((control) => { control.disabled = true; });
    try {
      const submittedCount = draft.lines.length;
      await callUpbo({
        action: 'submitRequests', streamerId: page.streamer.id,
        nickname: nickname.field.value.trim(),
        items: draft.lines.map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity), requestNotes: line.requestNotes || '' })),
      });
      state.requestDraft = { nickname: '', lines: [], activeLineId: '' };
      showToast(`${submittedCount}개 항목 신청을 보냈어요. 스트리머 확인 후 등록됩니다.`);
      await loadUpboBoard(page.streamer.id);
    } catch (error) {
      showToast(error.message || '신청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      state.submitting = false;
      refreshUpboSection(page.streamer.id);
    }
  });
  panel.append(form); return panel;
}

function renderUpboItemManager(page, state) {
  const panel = document.createElement('section'); panel.className = 'upbo-subsection upbo-item-manager';
  const heading = document.createElement('div'); heading.className = 'upbo-subsection-heading upbo-manager-heading';
  const headingCopy = document.createElement('div'); headingCopy.className = 'upbo-manager-heading-copy';
  const title = document.createElement('h4'); title.textContent = '신청 가능한 항목';
  const count = document.createElement('span'); count.className = 'upbo-viewer-total'; count.textContent = `${state.items.length} / 100`;
  headingCopy.append(title, count);
  const actions = document.createElement('div'); actions.className = 'upbo-manager-actions';
  const addItem = upboButton('+ 항목 추가', 'button-primary upbo-small-button upbo-add-item-inline', () => openUpboItemEditor(page));
  addItem.disabled = state.saving || state.items.length >= MAX_UPBO_ITEMS;
  const hasRouletteLink = !!String(page.profile && page.profile.rouletteUrl || '').trim();
  const importItems = upboButton(
    state.saving ? '불러오는 중…' : '위플랩 항목 가져오기',
    'upbo-small-button upbo-import-roulette-items',
    () => importUpboRouletteItems(page),
  );
  importItems.disabled = state.saving || !hasRouletteLink || state.items.length >= MAX_UPBO_ITEMS;
  importItems.title = !hasRouletteLink
    ? '프로필 설정에 위플랩 공개 룰렛 링크를 먼저 등록해 주세요.'
    : state.items.length >= MAX_UPBO_ITEMS ? '신청 항목은 최대 100개까지 등록할 수 있어요.' : '';
  actions.append(importItems, addItem);
  heading.append(headingCopy, actions); panel.append(heading);
  const importNote = document.createElement('p'); importNote.className = 'upbo-import-note';
  importNote.textContent = hasRouletteLink
    ? '프로필에 등록된 위플랩 공개 링크 한 개에서 항목 이름만 가져와요. 확률과 종류는 이름에 포함하지 않고, 중복 항목은 건너뜁니다.'
    : '자동으로 가져오려면 프로필 설정의 룰렛 확률에 위플랩 공개 링크 한 개를 등록해 주세요.';
  panel.append(importNote);
  if (!state.items.length) {
    const empty = document.createElement('p'); empty.className = 'upbo-inline-empty'; empty.textContent = '아직 항목이 없어요. 위플랩 항목 가져오기 또는 항목 추가 버튼으로 등록해 주세요.';
    panel.append(empty); return panel;
  }
  const list = document.createElement('div'); list.className = 'upbo-item-list';
  state.items.forEach((item) => {
    const row = document.createElement('article'); row.className = 'upbo-item-row';
    const imageUrl = normalizeUpboImageUrl(item.imageUrl);
    if (imageUrl) {
      const imageTrigger = document.createElement('button'); imageTrigger.type = 'button';
      imageTrigger.className = 'upbo-item-image-trigger'; imageTrigger.setAttribute('aria-label', `${item.name} 이미지 크게 보기`);
      const image = document.createElement('img'); image.className = 'upbo-item-image';
      image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      imageTrigger.append(image);
      imageTrigger.addEventListener('click', () => openUpboImagePreview(imageUrl, `${item.name} 이미지`));
      row.append(imageTrigger);
    }
    const copy = document.createElement('div'); copy.className = 'upbo-item-copy';
    const name = document.createElement('strong'); name.textContent = item.name;
    const description = document.createElement('span'); description.textContent = item.description || '설명 없음';
    copy.append(name, description);
    const actions = document.createElement('div'); actions.className = 'upbo-row-actions';
    actions.append(
      upboButton('수정', 'upbo-small-button', () => openUpboItemEditor(page, item)),
      upboButton('삭제', 'upbo-small-button upbo-danger-button', () => deleteUpboItem(page, item)),
    );
    row.append(copy, actions); list.append(row);
  });
  panel.append(list); return panel;
}

function normalizeUpboImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : '';
  } catch (_) { return ''; }
}

function openUpboImagePreview(imageUrl, titleText) {
  const normalizedUrl = normalizeUpboImageUrl(imageUrl);
  if (!normalizedUrl) return;
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog upbo-image-preview-dialog';
  const card = document.createElement('div'); card.className = 'account-dialog-card upbo-image-preview-card';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading upbo-image-preview-heading';
  const title = document.createElement('h2'); title.textContent = titleText || '업보 항목 이미지';
  const close = upboButton('×', 'profile-settings-close', () => dialog.close());
  close.setAttribute('aria-label', '이미지 미리보기 닫기');
  heading.append(title, close);
  const stage = document.createElement('div'); stage.className = 'upbo-image-preview-stage';
  const image = document.createElement('img'); image.src = normalizedUrl; image.alt = titleText || '업보 항목 이미지';
  image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
  stage.append(image); card.append(heading, stage); dialog.append(card);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); showFanPageModal(dialog); close.focus();
}

function bindUpboPreviewZoom(image, getUrl, getTitle) {
  image.classList.add('upbo-image-zoomable');
  image.setAttribute('role', 'button'); image.tabIndex = 0;
  image.setAttribute('aria-label', `${getTitle()} 크게 보기`);
  const open = () => {
    if (!image.hidden) openUpboImagePreview(getUrl(), getTitle());
  };
  image.addEventListener('click', open);
  image.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); open();
  });
}

function renderUpboPendingQueue(page, state) {
  const panel = document.createElement('section'); panel.className = 'upbo-subsection upbo-pending-panel';
  const heading = document.createElement('div'); heading.className = 'upbo-subsection-heading';
  const title = document.createElement('h4'); title.textContent = '팬 신청 검토';
  const count = document.createElement('span'); count.className = 'upbo-viewer-total'; count.textContent = `${state.pending.length}${state.pendingHasMore ? '+' : ''}건 대기 중`;
  heading.append(title, count); panel.append(heading);
  if (!state.pending.length) {
    const empty = document.createElement('p'); empty.className = 'upbo-inline-empty'; empty.textContent = '검토할 신청이 없어요.';
    panel.append(empty); return panel;
  }
  const list = document.createElement('div'); list.className = 'upbo-pending-list';
  state.pending.forEach((request) => {
    const row = document.createElement('article'); row.className = 'upbo-pending-row';
    const copy = document.createElement('div'); copy.className = 'upbo-pending-copy';
    const groupSummary = request.requestGroupSize > 1 ? ` · 함께 신청 ${request.requestGroupSize}개 항목` : '';
    const summary = document.createElement('strong'); summary.textContent = `${request.nickname} · ${request.itemName} × ${request.quantity.toLocaleString('ko-KR')}${groupSummary}`;
    const submitted = document.createElement('span'); submitted.textContent = `신청 ${formatUpboDateTime(request.submittedAt)}`;
    copy.append(summary, submitted);
    if (request.requestNotes) {
      const requestNotes = document.createElement('small'); requestNotes.className = 'upbo-pending-request-notes';
      requestNotes.textContent = `요청사항: ${request.requestNotes}`; copy.append(requestNotes);
    }
    const actions = document.createElement('div'); actions.className = 'upbo-row-actions';
    actions.append(
      upboButton('검토·등록', 'button-primary upbo-small-button', () => openUpboSubmissionEditor(page, request)),
      upboButton('반려', 'upbo-small-button upbo-danger-button', () => deleteUpboSubmission(page, request)),
    );
    row.append(copy, actions); list.append(row);
  });
  panel.append(list);
  if (state.pendingHasMore) {
    const more = upboButton(state.loadingMorePending ? '불러오는 중…' : '이전 신청 더 보기', 'upbo-more-button', () => loadMoreUpboPending(page.streamer.id));
    more.disabled = state.loadingMorePending; panel.append(more);
  }
  return panel;
}

function renderUpboRecords(page, state) {
  const panel = document.createElement('section'); panel.className = 'upbo-subsection upbo-records-panel';
  const heading = document.createElement('div'); heading.className = 'upbo-subsection-heading';
  const title = document.createElement('h4'); title.textContent = '등록된 업보 기록';
  const count = document.createElement('span'); count.className = 'upbo-viewer-total'; count.textContent = `${state.records.length}${state.recordsHasMore ? '+' : ''}건`;
  heading.append(title, count); panel.append(heading);
  if (!state.records.length) {
    const empty = document.createElement('p'); empty.className = 'upbo-inline-empty'; empty.textContent = '아직 승인되어 등록된 업보가 없어요.';
    panel.append(empty); return panel;
  }
  const list = document.createElement('div'); list.className = 'upbo-record-list';
  state.records.forEach((record) => {
    const row = document.createElement('article'); row.className = 'upbo-record-row';
    const copy = document.createElement('div'); copy.className = 'upbo-record-copy';
    const name = document.createElement('strong'); name.textContent = record.nickname;
    const detail = document.createElement('span'); detail.textContent = `${record.itemName} · ${record.quantity.toLocaleString('ko-KR')}개`;
    const date = document.createElement('small'); date.textContent = `등록 ${formatUpboDateTime(record.approvedAt)}`;
    copy.append(name, detail, date);
    row.append(copy);
    if (state.canManage) {
      const actions = document.createElement('div'); actions.className = 'upbo-row-actions';
      actions.append(
        upboButton('수정', 'upbo-small-button', () => openUpboSubmissionEditor(page, record, true)),
        upboButton('삭제', 'upbo-small-button upbo-danger-button', () => deleteUpboRecord(page, record)),
      );
      row.append(actions);
    }
    list.append(row);
  });
  panel.append(list);
  if (state.recordsHasMore) {
    const more = upboButton(state.loadingMoreRecords ? '불러오는 중…' : '이전 기록 더 보기', 'upbo-more-button', () => loadMoreUpboRecords(page.streamer.id));
    more.disabled = state.loadingMoreRecords; panel.append(more);
  }
  return panel;
}

function refreshUpboSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('upboSection');
  if (section) section.replaceWith(renderUpboSection(currentPage));
}

async function loadUpboBoard(streamerId, pageType = 'initial') {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const state = upboStateFor(streamerId);
  if (state.loadingBoard || state.loadingMoreRecords || state.loadingMorePending) return;
  if (pageType === 'records' && (state.loadingMoreRecords || !state.recordsHasMore)) return;
  if (pageType === 'pending' && (state.loadingMorePending || !state.pendingHasMore)) return;
  const requestId = ++state.boardRequestId;
  state.error = '';
  if (pageType === 'initial') { state.loadingBoard = true; state.error = ''; }
  if (pageType === 'records') state.loadingMoreRecords = true;
  if (pageType === 'pending') state.loadingMorePending = true;
  refreshUpboSection(streamerId);
  try {
    const result = (await callUpbo({
      action: 'loadBoard', streamerId,
      recordCursor: pageType === 'records' ? state.recordsNextCursor : '',
      pendingCursor: pageType === 'pending' ? state.pendingNextCursor : '',
    })).data;
    if (!currentPage || currentPage.streamer.id !== streamerId || requestId !== state.boardRequestId) return;
    state.canManage = result.canManage === true;
    if (pageType === 'initial') {
      state.items = Array.isArray(result.items) ? result.items : [];
      state.records = Array.isArray(result.records) ? result.records : [];
      state.recordsHasMore = result.recordsHasMore === true;
      state.recordsNextCursor = result.recordsNextCursor || '';
      state.pending = Array.isArray(result.pending) ? result.pending : [];
      state.pendingHasMore = result.pendingHasMore === true;
      state.pendingNextCursor = result.pendingNextCursor || '';
      state.boardLoaded = true;
    } else if (pageType === 'records') {
      state.records = [...state.records, ...(result.records || [])];
      state.recordsHasMore = result.recordsHasMore === true;
      state.recordsNextCursor = result.recordsNextCursor || '';
    } else {
      state.pending = [...state.pending, ...(result.pending || [])];
      state.pendingHasMore = result.pendingHasMore === true;
      state.pendingNextCursor = result.pendingNextCursor || '';
    }
  } catch (error) {
    if (!currentPage || currentPage.streamer.id !== streamerId || requestId !== state.boardRequestId) return;
    state.boardLoaded = true;
    state.error = error.message || '업보 정리를 불러오지 못했어요.';
  } finally {
    if (requestId === state.boardRequestId) {
      state.loadingBoard = false;
      state.loadingMoreRecords = false;
      state.loadingMorePending = false;
      if (currentPage && currentPage.streamer.id === streamerId) refreshUpboSection(streamerId);
    }
  }
}

function loadMoreUpboRecords(streamerId) { return loadUpboBoard(streamerId, 'records'); }
function loadMoreUpboPending(streamerId) { return loadUpboBoard(streamerId, 'pending'); }

async function importUpboRouletteItems(page) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving) return;
  if (!String(page.profile && page.profile.rouletteUrl || '').trim()) {
    showToast('프로필 설정에 위플랩 공개 룰렛 링크를 먼저 등록해 주세요.');
    return;
  }
  if (state.items.length >= MAX_UPBO_ITEMS) {
    showToast('신청 항목은 최대 100개까지 등록할 수 있어요.');
    return;
  }
  state.saving = true;
  refreshUpboSection(page.streamer.id);
  try {
    const result = (await callUpbo({ action: 'importRouletteItems', streamerId: page.streamer.id })).data;
    state.items = Array.isArray(result.items) ? result.items : state.items;
    const details = [`${Number(result.addedCount) || 0}개 추가`];
    if (result.duplicateCount) details.push(`중복 ${result.duplicateCount}개 제외`);
    if (result.invalidNameCount) details.push(`이름 확인 필요 ${result.invalidNameCount}개 제외`);
    if (result.limitSkippedCount) details.push(`최대 항목 수로 ${result.limitSkippedCount}개 미추가`);
    showToast(`위플랩 룰렛 항목을 가져왔어요. ${details.join(' · ')}`);
  } catch (error) {
    showToast(error.message || '위플랩 룰렛 항목을 가져오지 못했어요.');
  } finally {
    state.saving = false;
    refreshUpboSection(page.streamer.id);
  }
}

function openUpboItemEditor(page, existingItem = null) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving) return;
  if (!existingItem && state.items.length >= MAX_UPBO_ITEMS) {
    showToast('신청 항목은 최대 100개까지 등록할 수 있어요.'); return;
  }
  const isBatch = !existingItem;
  const remainingSlots = Math.max(0, MAX_UPBO_ITEMS - state.items.length);
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog upbo-editor-dialog';
  const form = document.createElement('form'); form.className = 'account-dialog-card upbo-editor-form';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading';
  const title = document.createElement('h2'); title.textContent = existingItem ? '신청 항목 수정' : '신청 항목 빠른 추가';
  const close = upboButton('×', 'profile-settings-close', () => dialog.close()); close.setAttribute('aria-label', '항목 편집 닫기');
  heading.append(title, close);
  const name = upboEditorField(
    isBatch ? '항목 이름 (쉼표로 구분)' : '항목 이름',
    isBatch ? 'textarea' : 'input',
    isBatch
      ? { maxlength: MAX_UPBO_ITEMS * 62, rows: 2, required: true, placeholder: '예: 체키 방셀, 편지 방셀, 팬미팅' }
      : { type: 'text', maxlength: 60, required: true, value: existingItem.name, placeholder: '예: 체키 방셀' },
  );
  if (isBatch) name.field.classList.add('upbo-item-batch-names');
  let description = null;
  let imageUrl = null;
  let preview = null;
  let previewImage = null;
  let previewStatus = null;
  const batchRows = isBatch ? document.createElement('div') : null;
  const batchStatus = isBatch ? document.createElement('p') : null;
  const drafts = [];
  let batchNameCount = 0;
  let save = null;

  const setPreview = (rawValue, image, status, placeholder = null) => {
    const raw = String(rawValue || '').trim();
    const url = normalizeUpboImageUrl(raw);
    if (image.dataset.previewUrl !== url) image.hidden = true;
    if (!raw) {
      image.removeAttribute('src'); image.dataset.previewUrl = 'none';
      if (placeholder) { placeholder.hidden = false; placeholder.textContent = '미리보기'; }
      status.textContent = '이미지 주소를 입력하면 미리보기가 표시됩니다.';
      return;
    }
    if (!url) {
      image.removeAttribute('src'); image.dataset.previewUrl = 'invalid';
      if (placeholder) { placeholder.hidden = false; placeholder.textContent = '미리보기'; }
      status.textContent = 'HTTPS 이미지 주소를 입력해 주세요.';
      return;
    }
    if (placeholder) placeholder.hidden = true;
    status.textContent = '미리보기를 불러오는 중…';
    image.dataset.previewUrl = url;
    image.src = url;
  };

  if (isBatch) {
    batchRows.className = 'upbo-item-batch-list';
    batchStatus.className = 'upbo-item-batch-status';
  } else {
    description = upboEditorField('설명 (선택)', 'textarea', { maxlength: 160, rows: 2, placeholder: '팬에게 안내할 내용을 적어 주세요.' });
    description.field.value = existingItem.description || '';
    imageUrl = upboEditorField('이미지 주소 (선택)', 'input', { type: 'url', maxlength: 2048, value: existingItem.imageUrl || '', placeholder: 'https://이미지주소' });
    imageUrl.field.autocomplete = 'off';
    preview = document.createElement('div'); preview.className = 'upbo-item-preview'; preview.hidden = true;
    previewImage = document.createElement('img'); previewImage.alt = ''; previewImage.decoding = 'async'; previewImage.referrerPolicy = 'no-referrer'; previewImage.hidden = true;
    previewStatus = document.createElement('span'); previewStatus.className = 'upbo-item-preview-status';
    preview.append(previewImage, previewStatus);
    previewImage.addEventListener('load', () => {
      if (previewImage.dataset.previewUrl !== normalizeUpboImageUrl(imageUrl.field.value)) return;
      previewImage.hidden = false; previewStatus.textContent = '미리보기';
    });
    previewImage.addEventListener('error', () => {
      if (previewImage.dataset.previewUrl !== normalizeUpboImageUrl(imageUrl.field.value)) return;
      previewImage.hidden = true; previewStatus.textContent = '이미지를 불러오지 못했어요. 주소와 공개 설정을 확인해 주세요.';
    });
    bindUpboPreviewZoom(previewImage, () => imageUrl.field.value, () => `${name.field.value.trim() || existingItem.name} 이미지`);
    const updatePreview = () => {
      const raw = imageUrl.field.value.trim();
      if (!raw) { preview.hidden = true; previewImage.removeAttribute('src'); previewImage.dataset.previewUrl = 'none'; previewStatus.textContent = ''; return; }
      preview.hidden = false;
      setPreview(raw, previewImage, previewStatus);
    };
    imageUrl.field.addEventListener('input', updatePreview);
    updatePreview();
  }

  const updateBatchStatus = () => {
    if (!isBatch || !batchStatus || !save) return;
    const hasTooMany = batchNameCount > remainingSlots || batchNameCount > MAX_UPBO_ITEMS;
    const hasLongName = drafts.some((draft) => draft.name.length > 60);
    const hasInvalidImageUrl = drafts.some((draft) => draft.imageUrl && !normalizeUpboImageUrl(draft.imageUrl));
    save.disabled = !batchNameCount || hasTooMany || hasLongName || hasInvalidImageUrl;
    batchStatus.classList.toggle('is-error', hasTooMany || hasLongName || hasInvalidImageUrl);
    if (!batchNameCount) batchStatus.textContent = '항목 이름을 쉼표로 구분해 입력하면 항목별 이미지 주소를 설정할 수 있어요.';
    else if (hasTooMany) batchStatus.textContent = `현재 ${remainingSlots}개까지 추가할 수 있어요. 항목 이름을 줄여 주세요.`;
    else if (hasLongName) batchStatus.textContent = '항목 이름은 각각 60자까지 입력할 수 있어요.';
    else if (hasInvalidImageUrl) batchStatus.textContent = '미리보기 주소는 HTTPS 이미지 주소로 입력해 주세요.';
    else batchStatus.textContent = `${batchNameCount}개 항목을 한 번에 추가합니다. 이미지 주소는 각 항목에 따로 입력할 수 있어요.`;
  };

  const renderBatchRows = () => {
    if (!isBatch) return;
    const parsedNames = name.field.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    batchNameCount = parsedNames.length;
    const visibleNames = parsedNames.slice(0, Math.min(MAX_UPBO_ITEMS, remainingSlots + 1));
    const previous = drafts.splice(0, drafts.length);
    const used = new Set();
    const next = visibleNames.map((value, index) => {
      const key = value.toLocaleLowerCase('ko-KR');
      let previousIndex = previous.findIndex((draft, draftIndex) => !used.has(draftIndex) && draft.name.toLocaleLowerCase('ko-KR') === key);
      if (previousIndex < 0 && previous[index] && !used.has(index)) previousIndex = index;
      if (previousIndex >= 0) used.add(previousIndex);
      return { id: previousIndex >= 0 ? previous[previousIndex].id : createUpboId(), name: value, imageUrl: previousIndex >= 0 ? previous[previousIndex].imageUrl : '' };
    });
    drafts.push(...next);
    batchRows.replaceChildren();
    drafts.forEach((draft, index) => {
      const row = document.createElement('div'); row.className = 'upbo-item-batch-row';
      const copy = document.createElement('div'); copy.className = 'upbo-item-batch-copy';
      const itemNumber = document.createElement('span'); itemNumber.className = 'upbo-item-batch-number'; itemNumber.textContent = `항목 ${index + 1}`;
      const itemName = document.createElement('strong'); itemName.className = 'upbo-item-batch-name'; itemName.textContent = draft.name;
      copy.append(itemNumber, itemName);
      const imageField = upboEditorField('이미지 주소 (선택)', 'input', { type: 'url', maxlength: 2048, value: draft.imageUrl, placeholder: 'https://이미지주소' });
      imageField.field.autocomplete = 'off'; imageField.label.classList.add('upbo-item-batch-image-field');
      const previewBox = document.createElement('div'); previewBox.className = 'upbo-item-batch-preview';
      const itemImage = document.createElement('img'); itemImage.alt = ''; itemImage.decoding = 'async'; itemImage.referrerPolicy = 'no-referrer'; itemImage.hidden = true;
      const placeholder = document.createElement('span'); placeholder.textContent = '미리보기';
      const itemPreviewStatus = document.createElement('small'); itemPreviewStatus.className = 'upbo-item-batch-preview-status';
      previewBox.append(itemImage, placeholder);
      const imageCell = document.createElement('div'); imageCell.className = 'upbo-item-batch-image-cell';
      imageCell.append(imageField.label, itemPreviewStatus);
      row.append(copy, imageCell, previewBox);
      itemImage.addEventListener('load', () => {
        if (itemImage.dataset.previewUrl !== normalizeUpboImageUrl(imageField.field.value)) return;
        itemImage.hidden = false; placeholder.hidden = true; itemPreviewStatus.textContent = '미리보기';
      });
      itemImage.addEventListener('error', () => {
        if (itemImage.dataset.previewUrl !== normalizeUpboImageUrl(imageField.field.value)) return;
        itemImage.hidden = true; placeholder.hidden = false; placeholder.textContent = '불러오기 실패';
        itemPreviewStatus.textContent = '주소를 확인해 주세요.';
      });
      bindUpboPreviewZoom(itemImage, () => imageField.field.value, () => `${draft.name} 이미지`);
      imageField.field.addEventListener('input', () => {
        draft.imageUrl = imageField.field.value.trim();
        setPreview(draft.imageUrl, itemImage, itemPreviewStatus, placeholder);
        updateBatchStatus();
      });
      if (draft.imageUrl) setPreview(draft.imageUrl, itemImage, itemPreviewStatus, placeholder);
      batchRows.append(row);
    });
    updateBatchStatus();
  };
  if (isBatch) name.field.addEventListener('input', renderBatchRows);

  const note = document.createElement('p'); note.className = 'upbo-editor-note';
  note.textContent = isBatch
    ? '쉼표로 항목 이름을 나누어 한 번에 추가할 수 있어요. 각 항목에 HTTPS 이미지 주소를 넣으면 작은 미리보기와 함께 저장됩니다.'
    : '이미지 주소를 입력하면 미리보기가 표시됩니다. 등록된 항목은 팬 신청서에 표시됩니다.';
  const footer = document.createElement('div'); footer.className = 'profile-editor-footer upbo-editor-footer';
  const hint = document.createElement('small'); hint.textContent = isBatch ? `현재 ${remainingSlots}개까지 추가 가능 · 최대 ${MAX_UPBO_ITEMS}개` : `신청 항목은 최대 ${MAX_UPBO_ITEMS}개까지 등록할 수 있어요.`;
  const actions = document.createElement('div'); actions.className = 'profile-editor-footer-actions';
  const cancel = upboButton('취소', '', () => dialog.close());
  save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = existingItem ? '수정 저장' : '항목 추가';
  actions.append(cancel, save); footer.append(hint, actions);
  form.append(heading, name.label);
  if (isBatch) form.append(batchStatus, batchRows);
  else form.append(description.label, imageUrl.label, preview);
  form.append(note, footer);
  if (isBatch) renderBatchRows();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || save.disabled) return;
    save.disabled = true; save.textContent = '저장 중…'; state.saving = true;
    try {
      if (isBatch) {
        await callUpbo({
          action: 'saveItems', streamerId: page.streamer.id,
          items: drafts.map((draft) => ({ id: draft.id, name: draft.name, imageUrl: draft.imageUrl, description: '' })),
        });
      } else {
        await callUpbo({
          action: 'saveItem', streamerId: page.streamer.id,
          itemId: existingItem.id, name: name.field.value.trim(), description: description.field.value.trim(),
          imageUrl: imageUrl.field.value.trim(),
        });
      }
      dialog.close();
      await loadUpboBoard(page.streamer.id);
      showToast(existingItem ? '신청 항목을 수정했어요.' : `${drafts.length}개 신청 항목을 추가했어요.`);
    } catch (error) {
      showToast(error.message || '신청 항목을 저장하지 못했어요.');
    } finally {
      state.saving = false; save.disabled = false; save.textContent = existingItem ? '수정 저장' : '항목 추가';
      refreshUpboSection(page.streamer.id);
    }
  });
  dialog.append(form); dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); showFanPageModal(dialog);
  if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) name.field.focus();
}

async function deleteUpboItem(page, item) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving || !confirm(`“${item.name}” 항목을 삭제할까요? 기존 신청과 확정 기록은 보관됩니다.`)) return;
  state.saving = true; refreshUpboSection(page.streamer.id);
  try {
    await callUpbo({ action: 'deleteItem', streamerId: page.streamer.id, itemId: item.id });
    await loadUpboBoard(page.streamer.id);
    showToast('신청 항목을 삭제했어요.');
  } catch (error) {
    showToast(error.message || '신청 항목을 삭제하지 못했어요.');
  } finally { state.saving = false; refreshUpboSection(page.streamer.id); }
}

function openUpboSubmissionEditor(page, entry, isRecord = false) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving) return;
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog upbo-editor-dialog';
  const form = document.createElement('form'); form.className = 'account-dialog-card upbo-editor-form';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading';
  const title = document.createElement('h2'); title.textContent = isRecord ? '확정 기록 수정' : '신청 검토 및 등록';
  const close = upboButton('×', 'profile-settings-close', () => dialog.close()); close.setAttribute('aria-label', '신청 검토 닫기');
  heading.append(title, close);
  const nickname = upboEditorField('닉네임', 'input', { type: 'text', maxlength: 40, required: true, value: entry.nickname, autocomplete: 'off' });
  const item = upboEditorField('항목', 'select');
  const choices = [...state.items];
  if (!choices.some((candidate) => candidate.id === entry.itemId)) {
    choices.push({ id: entry.itemId, name: entry.itemName, description: '기존 신청 항목', active: false });
  }
  choices.forEach((candidate) => {
    const option = document.createElement('option'); option.value = candidate.id;
    option.textContent = `${candidate.name}${candidate.active ? '' : ' (기존 항목)'}`;
    item.field.append(option);
  });
  item.field.value = entry.itemId;
  const quantity = upboEditorField('수량', 'input', { type: 'number', min: 1, max: 1000000, step: 1, required: true, value: entry.quantity });
  quantity.field.inputMode = 'numeric';
  const note = document.createElement('p'); note.className = 'upbo-editor-note';
  note.textContent = isRecord
    ? '수정 내용은 공개된 확정 기록에 반영됩니다.'
    : entry.requestNotes
      ? `팬 요청사항: ${entry.requestNotes}`
      : '팬 요청사항이 없습니다. 승인하면 팬페이지의 공개 업보 기록에 등록됩니다.';
  const footer = document.createElement('div'); footer.className = 'profile-editor-footer upbo-editor-footer';
  const hint = document.createElement('small'); hint.textContent = isRecord ? '공개 기록 수정' : `신청 시각 ${formatUpboDateTime(entry.submittedAt)}`;
  const actions = document.createElement('div'); actions.className = 'profile-editor-footer-actions';
  const cancel = upboButton('취소', '', () => dialog.close());
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = isRecord ? '수정 저장' : '승인 후 등록';
  actions.append(cancel, save); footer.append(hint, actions); form.append(heading, nickname.label, item.label, quantity.label, note, footer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || save.disabled) return;
    save.disabled = true; save.textContent = isRecord ? '저장 중…' : '등록 중…'; state.saving = true;
    try {
      if (isRecord) {
        await callUpbo({
          action: 'saveRecord', streamerId: page.streamer.id, recordId: entry.id,
          nickname: nickname.field.value.trim(), itemId: item.field.value, quantity: Number(quantity.field.value),
        });
      } else {
        await callUpbo({
          action: 'approveRequest', streamerId: page.streamer.id, requestId: entry.id,
          nickname: nickname.field.value.trim(), itemId: item.field.value, quantity: Number(quantity.field.value),
        });
      }
      dialog.close();
      await loadUpboBoard(page.streamer.id);
      showToast(isRecord ? '확정 기록을 수정했어요.' : '신청을 승인해 공개 기록에 등록했어요.');
    } catch (error) {
      showToast(error.message || '업보 기록을 저장하지 못했어요.');
    } finally {
      state.saving = false; save.disabled = false;
      refreshUpboSection(page.streamer.id);
    }
  });
  dialog.append(form); dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); showFanPageModal(dialog);
}

async function deleteUpboSubmission(page, entry) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving || !confirm(`“${entry.nickname} · ${entry.itemName} × ${entry.quantity}” 신청을 반려할까요?`)) return;
  state.saving = true; refreshUpboSection(page.streamer.id);
  try {
    await callUpbo({ action: 'deleteRequest', streamerId: page.streamer.id, requestId: entry.id });
    await loadUpboBoard(page.streamer.id); showToast('신청을 반려했어요.');
  } catch (error) { showToast(error.message || '신청을 반려하지 못했어요.'); }
  finally { state.saving = false; refreshUpboSection(page.streamer.id); }
}

async function deleteUpboRecord(page, entry) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving || !confirm(`“${entry.nickname} · ${entry.itemName}” 확정 기록을 삭제할까요?`)) return;
  state.saving = true; refreshUpboSection(page.streamer.id);
  try {
    await callUpbo({ action: 'deleteRecord', streamerId: page.streamer.id, recordId: entry.id });
    await loadUpboBoard(page.streamer.id); showToast('확정 기록을 삭제했어요.');
  } catch (error) { showToast(error.message || '확정 기록을 삭제하지 못했어요.'); }
  finally { state.saving = false; refreshUpboSection(page.streamer.id); }
}

async function loadUpboTopics(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const state = upboStateFor(streamerId);
  const requestId = ++state.topicsRequestId;
  state.loadingTopics = true; state.error = ''; refreshUpboSection(streamerId);
  try {
    const result = (await callUpbo({ action: 'listTopics', streamerId })).data;
    if (!currentPage || currentPage.streamer.id !== streamerId || requestId !== state.topicsRequestId) return;
    state.topics = Array.isArray(result.topics) ? result.topics : [];
    state.canManage = result.canManage === true; state.loaded = true;
    if (!state.topics.some((topic) => topic.id === state.activeTopicId)) state.activeTopicId = state.topics[0]?.id || '';
    state.topic = null; state.viewers = []; state.hasMore = false; state.nextCursor = '';
    state.viewerCount = state.topics.find((topic) => topic.id === state.activeTopicId)?.viewerCount || 0;
    state.loadingTopics = false; refreshUpboSection(streamerId);
    if (state.activeTopicId) await loadUpboTopic(streamerId, state.activeTopicId);
  } catch (error) {
    if (!currentPage || currentPage.streamer.id !== streamerId || requestId !== state.topicsRequestId) return;
    state.loadingTopics = false; state.loaded = true; state.error = error.message || '업보 정리를 불러오지 못했어요.';
    refreshUpboSection(streamerId);
  }
}

async function loadUpboTopic(streamerId, topicId, cursor = '') {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const state = upboStateFor(streamerId);
  const requestId = ++state.topicRequestId;
  state.loadingTopic = true; state.error = '';
  if (!cursor) { state.viewers = []; state.nextCursor = ''; state.hasMore = false; }
  refreshUpboSection(streamerId);
  try {
    const result = (await callUpbo({ action: 'loadTopic', streamerId, topicId, cursor })).data;
    if (!currentPage || currentPage.streamer.id !== streamerId || requestId !== state.topicRequestId || topicId !== state.activeTopicId) return;
    state.topic = result.topic; state.canManage = result.canManage === true;
    state.viewerCount = Number(result.viewerCount) || 0;
    state.viewers = cursor ? [...state.viewers, ...(result.viewers || [])] : (result.viewers || []);
    state.hasMore = result.hasMore === true; state.nextCursor = result.nextCursor || '';
  } catch (error) {
    if (!currentPage || currentPage.streamer.id !== streamerId || requestId !== state.topicRequestId) return;
    state.error = error.message || '시청자 기록을 불러오지 못했어요.';
  } finally {
    if (currentPage && currentPage.streamer.id === streamerId && requestId === state.topicRequestId) {
      state.loadingTopic = false; refreshUpboSection(streamerId);
    }
  }
}

function loadMoreUpboViewers(streamerId) {
  const state = upboStateFor(streamerId);
  if (state.loadingTopic || !state.hasMore || !state.nextCursor || !state.activeTopicId) return;
  loadUpboTopic(streamerId, state.activeTopicId, state.nextCursor);
}

function upboEditorField(labelText, tagName, attributes = {}) {
  const label = document.createElement('label'); label.className = 'profile-editor-field'; label.append(document.createTextNode(labelText));
  const field = document.createElement(tagName);
  Object.entries(attributes).forEach(([key, value]) => field.setAttribute(key, String(value)));
  label.append(field); return { label, field };
}

function appendUpboRangeEditorRow(container, kind, value = {}) {
  const row = document.createElement('div'); row.className = 'upbo-editor-row'; row.dataset.id = value.id || createUpboId();
  const count = upboEditorField('누적 후원 개수', 'input', { type: 'number', min: 0, max: 1000000000, step: 1, required: true, value: value.donationCount ?? 0 });
  count.field.className = 'upbo-editor-count';
  const reward = upboEditorField(kind === 'promise' ? '공약 내용' : '보상 내용', 'input', { type: 'text', maxlength: 300, required: true, value: value.reward || '', placeholder: kind === 'promise' ? '예: 공포게임 2시간' : '예: 체키 방셀' });
  reward.field.className = 'upbo-editor-reward';
  row.append(count.label, reward.label);
  const achieved = document.createElement('label'); achieved.className = 'upbo-editor-check';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = value.achieved === true;
  const text = document.createElement('span'); text.textContent = '달성'; achieved.append(checkbox, text); row.append(achieved);
  const remove = upboButton('삭제', 'upbo-small-button upbo-danger-button', () => row.remove());
  row.append(remove); container.append(row);
}

function collectUpboRangeEditorRows(container, kind) {
  return [...container.querySelectorAll('.upbo-editor-row')].map((row) => ({
    id: row.dataset.id,
    donationCount: Number(row.querySelector('.upbo-editor-count').value),
    reward: row.querySelector('.upbo-editor-reward').value.trim(),
    achieved: row.querySelector('input[type="checkbox"]').checked,
  }));
}

function openUpboTopicEditor(page, existingTopic = null) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving) return;
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog upbo-editor-dialog';
  const form = document.createElement('form'); form.className = 'account-dialog-card upbo-editor-form';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading';
  const title = document.createElement('h2'); title.textContent = existingTopic ? '업보 주제 설정' : '업보 주제 추가';
  const close = upboButton('×', 'profile-settings-close', () => dialog.close()); close.setAttribute('aria-label', '주제 설정 닫기');
  heading.append(title, close);
  const titleField = upboEditorField('주제 이름', 'input', { type: 'text', maxlength: 60, required: true, value: existingTopic?.title || '', placeholder: '예: 2026 누적 후원 기록' });
  const descriptionField = upboEditorField('설명', 'textarea', { maxlength: 300, rows: 2, placeholder: '주제와 기록 기준을 소개해 주세요.' });
  descriptionField.field.value = existingTopic?.description || '';
  form.append(heading, titleField.label, descriptionField.label);

  const promiseSection = document.createElement('section'); promiseSection.className = 'upbo-editor-section';
  const promiseHeading = document.createElement('div'); promiseHeading.className = 'upbo-editor-section-heading';
  const promiseTitle = document.createElement('h3'); promiseTitle.textContent = '후원 총 누적 공약';
  const addPromise = upboButton('+ 공약 추가', 'upbo-small-button', () => appendUpboRangeEditorRow(promiseRows, 'promise'));
  promiseHeading.append(promiseTitle, addPromise);
  const promiseRows = document.createElement('div'); promiseRows.className = 'upbo-editor-rows';
  (existingTopic?.promises || []).forEach((row) => appendUpboRangeEditorRow(promiseRows, 'promise', row));
  promiseSection.append(promiseHeading, promiseRows);

  const rewardSection = document.createElement('section'); rewardSection.className = 'upbo-editor-section';
  const rewardHeading = document.createElement('div'); rewardHeading.className = 'upbo-editor-section-heading';
  const rewardTitle = document.createElement('h3'); rewardTitle.textContent = '개인 누적 후원 보상';
  const addReward = upboButton('+ 보상 구간 추가', 'upbo-small-button', () => appendUpboRangeEditorRow(rewardRows, 'reward'));
  rewardHeading.append(rewardTitle, addReward);
  const rewardRows = document.createElement('div'); rewardRows.className = 'upbo-editor-rows';
  (existingTopic?.rewardTiers || []).forEach((row) => appendUpboRangeEditorRow(rewardRows, 'reward', row));
  rewardSection.append(rewardHeading, rewardRows);
  form.append(promiseSection, rewardSection);

  const note = document.createElement('p'); note.className = 'upbo-editor-note'; note.textContent = '공개로 저장되며, 달성 여부는 스트리머가 직접 관리합니다.';
  const footer = document.createElement('div'); footer.className = 'profile-editor-footer upbo-editor-footer';
  const hint = document.createElement('small'); hint.textContent = '주제는 최대 20개, 구간은 종류별 50개까지 저장할 수 있어요.';
  const actions = document.createElement('div'); actions.className = 'profile-editor-footer-actions';
  const cancel = upboButton('취소', '', () => dialog.close());
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = '저장';
  actions.append(cancel, save); footer.append(hint, actions); form.append(note, footer); dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || save.disabled) return;
    save.disabled = true; save.textContent = '저장 중…'; state.saving = true;
    try {
      const topicId = existingTopic?.id || createUpboId();
      const payload = {
        id: topicId, title: titleField.field.value.trim(), description: descriptionField.field.value.trim(),
        promises: collectUpboRangeEditorRows(promiseRows, 'promise'),
        rewardTiers: collectUpboRangeEditorRows(rewardRows, 'reward'),
      };
      const result = (await callUpbo({ action: 'saveTopic', streamerId: page.streamer.id, topicId, topic: payload })).data;
      const savedTopic = { ...result.topic, viewerCount: existingTopic?.viewerCount || 0 };
      const index = state.topics.findIndex((topic) => topic.id === savedTopic.id);
      if (index < 0) state.topics.push(savedTopic); else state.topics[index] = savedTopic;
      state.topics.sort((a, b) => a.createdAt - b.createdAt || a.title.localeCompare(b.title, 'ko'));
      state.activeTopicId = savedTopic.id; state.topic = savedTopic; state.canManage = result.canManage === true;
      dialog.close(); await loadUpboTopic(page.streamer.id, savedTopic.id); showToast('업보 주제를 저장했어요.');
    } catch (error) {
      showToast(error.message || '업보 주제를 저장하지 못했어요.');
    } finally {
      state.saving = false; save.disabled = false; save.textContent = '저장'; refreshUpboSection(page.streamer.id);
    }
  });
  document.body.append(dialog); showFanPageModal(dialog);
}

function openUpboViewerEditor(page, topic, existingViewer = null) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving) return;
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog upbo-editor-dialog';
  const form = document.createElement('form'); form.className = 'account-dialog-card upbo-editor-form';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading';
  const title = document.createElement('h2'); title.textContent = existingViewer ? '시청자 기록 수정' : '시청자 추가';
  const close = upboButton('×', 'profile-settings-close', () => dialog.close()); close.setAttribute('aria-label', '시청자 편집 닫기');
  heading.append(title, close);
  const grid = document.createElement('div'); grid.className = 'upbo-viewer-editor-grid';
  const nickname = upboEditorField('닉네임', 'input', { type: 'text', maxlength: 40, required: true, value: existingViewer?.nickname || '', placeholder: '시청자 닉네임' });
  const rank = upboEditorField('랭크 / 구분', 'input', { type: 'text', maxlength: 30, value: existingViewer?.rank || '', placeholder: '예: 전설 RANK' });
  const count = upboEditorField('누적 후원 개수', 'input', { type: 'number', min: 0, max: 1000000000, step: 1, required: true, value: existingViewer?.donationCount ?? 0 });
  const history = upboEditorField('후원 내역', 'textarea', { maxlength: 300, rows: 3, placeholder: '예: 체키 3회, 편지 방셀' }); history.field.value = existingViewer?.history || '';
  const reward = upboEditorField('보상 내역', 'textarea', { maxlength: 300, rows: 3, placeholder: '시청자가 받은 보상을 정리해 주세요.' }); reward.field.value = existingViewer?.reward || '';
  const request = upboEditorField('요청사항', 'textarea', { maxlength: 300, rows: 2, placeholder: '전달할 요청이나 참고사항' }); request.field.value = existingViewer?.request || '';
  grid.append(nickname.label, rank.label, count.label, history.label, reward.label, request.label);
  const note = document.createElement('p'); note.className = 'upbo-editor-note'; note.textContent = '시청자 닉네임과 기록은 이 팬페이지 방문자에게 공개됩니다.';
  const footer = document.createElement('div'); footer.className = 'profile-editor-footer upbo-editor-footer';
  const hint = document.createElement('small'); hint.textContent = '수정 내용은 서버 데이터베이스에 저장됩니다.';
  const actions = document.createElement('div'); actions.className = 'profile-editor-footer-actions';
  const cancel = upboButton('취소', '', () => dialog.close());
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = existingViewer ? '기록 저장' : '시청자 추가';
  actions.append(cancel, save); footer.append(hint, actions);
  form.append(heading, grid, note, footer); dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || save.disabled) return;
    save.disabled = true; save.textContent = '저장 중…'; state.saving = true;
    try {
      const viewer = {
        ...(existingViewer ? { id: existingViewer.id } : {}), nickname: nickname.field.value.trim(), rank: rank.field.value.trim(),
        donationCount: Number(count.field.value), history: history.field.value.trim(), reward: reward.field.value.trim(), request: request.field.value.trim(),
      };
      const result = (await callUpbo({ action: 'saveViewer', streamerId: page.streamer.id, topicId: topic.id, viewer })).data;
      const isNewViewer = !existingViewer;
      const loadedPageWasFull = state.viewers.length >= 100;
      const index = state.viewers.findIndex((item) => item.id === result.viewer.id);
      if (index < 0) state.viewers.unshift(result.viewer); else state.viewers[index] = result.viewer;
      state.viewers = state.viewers.slice(0, 100); state.viewerCount = Number(result.viewerCount) || state.viewerCount + (existingViewer ? 0 : 1);
      if (isNewViewer && loadedPageWasFull && state.hasMore) state.nextCursor = state.viewers.at(-1)?.id || state.nextCursor;
      state.canManage = result.canManage === true;
      dialog.close(); showToast(existingViewer ? '시청자 기록을 수정했어요.' : '시청자를 추가했어요.');
    } catch (error) {
      showToast(error.message || '시청자 기록을 저장하지 못했어요.');
    } finally {
      state.saving = false; save.disabled = false; refreshUpboSection(page.streamer.id);
    }
  });
  document.body.append(dialog); showFanPageModal(dialog);
}

async function deleteUpboViewer(page, topicId, viewer) {
  const state = upboStateFor(page.streamer.id);
  if (!state.canManage || state.saving || !confirm(`${viewer.nickname}님의 후원 기록을 삭제할까요?`)) return;
  state.saving = true; refreshUpboSection(page.streamer.id);
  try {
    await callUpbo({ action: 'deleteViewer', streamerId: page.streamer.id, topicId, viewerId: viewer.id });
    state.viewers = state.viewers.filter((item) => item.id !== viewer.id);
    state.viewerCount = Math.max(0, state.viewerCount - 1); showToast('시청자 기록을 삭제했어요.');
  } catch (error) {
    showToast(error.message || '시청자 기록을 삭제하지 못했어요.');
  } finally { state.saving = false; refreshUpboSection(page.streamer.id); }
}

async function deleteUpboTopic(page, topicId) {
  const state = upboStateFor(page.streamer.id);
  const topic = state.topics.find((item) => item.id === topicId);
  if (!state.canManage || state.saving || !topic || !confirm(`“${topic.title}” 주제와 시청자 기록을 모두 삭제할까요?`)) return;
  state.saving = true; refreshUpboSection(page.streamer.id);
  try {
    await callUpbo({ action: 'deleteTopic', streamerId: page.streamer.id, topicId });
    state.topics = state.topics.filter((item) => item.id !== topicId);
    state.activeTopicId = state.topics[0]?.id || ''; state.topic = null; state.viewers = [];
    state.viewerCount = state.topics[0]?.viewerCount || 0; state.hasMore = false; state.nextCursor = '';
    showToast('업보 주제를 삭제했어요.');
    if (state.activeTopicId) await loadUpboTopic(page.streamer.id, state.activeTopicId);
  } catch (error) {
    showToast(error.message || '업보 주제를 삭제하지 못했어요.');
  } finally { state.saving = false; refreshUpboSection(page.streamer.id); }
}

function profileQuickEditValue(page, field) {
  if (field === 'intro') return String(page.intro || '');
  if (field === 'contents') return Array.isArray(page.profile?.contents) ? page.profile.contents.join(', ') : '';
  return String(page.profile?.[field] || '');
}

function profileQuickEditDisplayValue(page, field) {
  if (field === 'contents') return Array.isArray(page.profile?.contents) ? page.profile.contents.join(' · ') : '';
  return profileQuickEditValue(page, field);
}

function setProfileQuickEditText(target, page, field) {
  const value = profileQuickEditDisplayValue(page, field);
  const valueElement = target.querySelector('.profile-field-value');
  if (valueElement) {
    valueElement.textContent = value || (field === 'intro' ? '소개 문구를 추가해 보세요.' : '미등록');
  }
  const fieldLabel = PROFILE_QUICK_EDIT_FIELDS[field].label;
  target.setAttribute('aria-label', `${fieldLabel}: ${value || '미등록'}. 클릭하여 수정`);
}

function attachProfileQuickEdit(target, page, field) {
  if (!page.isOwner) return;
  target.type = 'button';
  target.classList.add('profile-editable');
  target.title = '클릭하여 수정';
  setProfileQuickEditText(target, page, field);
  target.addEventListener('click', () => openProfileQuickEdit(page, field, target));
}

function openProfileQuickEdit(page, field, target) {
  const definition = PROFILE_QUICK_EDIT_FIELDS[field];
  if (!page.isOwner || !definition || !target.isConnected) return;
  const form = document.createElement('form');
  form.className = 'profile-inline-editor';
  const editor = definition.multiline ? document.createElement('textarea') : document.createElement('input');
  if (!definition.multiline) editor.type = 'text';
  editor.maxLength = definition.maxLength;
  editor.value = profileQuickEditValue(page, field);
  editor.placeholder = definition.placeholder;
  editor.autocomplete = 'off';
  editor.setAttribute('aria-label', `${definition.label} 수정`);
  if (definition.multiline) editor.rows = field === 'intro' ? 4 : 3;
  const actions = document.createElement('div'); actions.className = 'profile-inline-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소';
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = '저장';
  const status = document.createElement('small'); status.className = 'profile-inline-editor-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  actions.append(cancel, save); form.append(editor, actions, status);

  cancel.addEventListener('click', () => {
    form.replaceWith(target);
    target.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    let value = editor.value.trim();
    if (field === 'contents') {
      value = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (value.length > 8 || value.some((item) => item.length > 20)) {
        status.textContent = '콘텐츠는 최대 8개, 항목마다 20자까지 입력할 수 있어요.';
        return;
      }
    }
    save.disabled = true; cancel.disabled = true; save.textContent = '저장 중…';
    status.textContent = '';
    try {
      const payload = { streamerId: page.streamer.id };
      if (field === 'intro') payload.intro = value;
      else payload.profile = profileForLinkSave(page.profile, field, value);
      const result = await callSave(payload);
      if (!currentPage || currentPage.streamer.id !== page.streamer.id) {
        form.remove();
        return;
      }
      currentPage.intro = result.data.page.intro;
      currentPage.profile = result.data.page.profile;
      page.intro = currentPage.intro;
      page.profile = currentPage.profile;
      setProfileQuickEditText(target, page, field);
      const settingsDialog = $('profileSettingsDialog');
      const settingsInput = settingsDialog?.querySelector(`[name="${field}"]`);
      if (settingsInput) {
        settingsInput.value = field === 'contents'
          ? (page.profile.contents || []).join(', ')
          : (field === 'intro' ? page.intro : (page.profile[field] || ''));
      }
      form.replaceWith(target);
      showToast('수정 내용을 저장했어요.');
    } catch (error) {
      status.textContent = error.message || '수정 내용을 저장하지 못했어요.';
      save.disabled = false; cancel.disabled = false; save.textContent = '저장';
    }
  });

  target.replaceWith(form);
  editor.focus();
  if (editor instanceof HTMLInputElement) editor.select();
}

function renderKawaiiWelcome(page, onSectionNavigate = (sectionId) => {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}) {
  const hero = document.createElement('section');
  hero.className = 'fanpage-kawaii-hero';
  hero.setAttribute('aria-labelledby', 'kawaiiWelcomeTitle');
  const copy = document.createElement('div'); copy.className = 'fanpage-kawaii-copy';
  const eyebrow = document.createElement('p'); eyebrow.className = 'fanpage-kawaii-eyebrow';
  eyebrow.textContent = 'A COZY LITTLE CORNER FOR FANS';
  const title = document.createElement('h1'); title.id = 'kawaiiWelcomeTitle';
  title.append(document.createTextNode(`오늘도 ${page.streamer.nickname}와`), document.createElement('br'));
  const titleAccent = document.createElement('span'); titleAccent.textContent = '같이 놀아요!'; title.append(titleAccent);
  const description = document.createElement('p'); description.className = 'fanpage-kawaii-description';
  description.textContent = '방송 일정과 다시보기, 팬들의 추억을 한곳에서 만나 보세요.';
  const actions = document.createElement('div'); actions.className = 'fanpage-kawaii-actions';
  const galleryButton = document.createElement('button'); galleryButton.type = 'button';
  galleryButton.className = 'button button-primary'; galleryButton.textContent = '팬 갤러리 둘러보기 ↓';
  galleryButton.addEventListener('click', () => {
    onSectionNavigate('fanGallerySection');
  });
  const scheduleButton = document.createElement('button'); scheduleButton.type = 'button';
  scheduleButton.className = 'button'; scheduleButton.textContent = '방송 일정 보기';
  scheduleButton.addEventListener('click', () => {
    onSectionNavigate('calendarSection');
  });
  actions.append(galleryButton, scheduleButton); copy.append(eyebrow, title, description, actions);

  const mascotWrap = document.createElement('div'); mascotWrap.className = 'fanpage-kawaii-mascot-wrap';
  const halo = document.createElement('span'); halo.className = 'fanpage-kawaii-mascot-halo'; halo.setAttribute('aria-hidden', 'true');
  const mascot = document.createElement('button'); mascot.type = 'button'; mascot.className = 'fanpage-kawaii-mascot';
  mascot.setAttribute('aria-label', '달토끼 캐릭터 표정 바꾸기'); mascot.setAttribute('aria-pressed', 'false');
  const idle = document.createElement('img'); idle.className = 'fanpage-kawaii-mascot-idle';
  idle.src = 'assets/fanpage-kawaii/moon-bunny-idle.png'; idle.alt = '별 머리핀을 한 작은 크림색 달토끼';
  idle.loading = 'lazy'; idle.decoding = 'async';
  const wink = document.createElement('img'); wink.className = 'fanpage-kawaii-mascot-wink';
  wink.src = 'assets/fanpage-kawaii/moon-bunny-wink.png'; wink.alt = ''; wink.setAttribute('aria-hidden', 'true');
  wink.loading = 'lazy'; wink.decoding = 'async';
  mascot.append(idle, wink);
  const setMascotMood = (isWinking) => {
    mascot.classList.toggle('is-winking', isWinking);
    mascot.setAttribute('aria-pressed', String(isWinking));
  };
  mascot.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') setMascotMood(true); });
  mascot.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') setMascotMood(false); });
  mascot.addEventListener('focus', () => setMascotMood(true));
  mascot.addEventListener('blur', () => setMascotMood(false));
  mascot.addEventListener('click', () => {
    const hasHover = window.matchMedia('(hover: hover)').matches;
    setMascotMood(hasHover || !mascot.classList.contains('is-winking'));
  });
  mascotWrap.append(halo, mascot);
  const sparkles = document.createElement('span'); sparkles.className = 'fanpage-kawaii-sparkles';
  sparkles.setAttribute('aria-hidden', 'true'); sparkles.textContent = '✦  ✧  ♡';
  hero.append(copy, mascotWrap, sparkles);
  return hero;
}

function createCompetitionHistoryId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
  return `event-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatCompetitionHistoryDate(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return match ? `${Number(match[1])}년 ${Number(match[2])}월` : '';
}

function rollingPaperStateFor(streamerId) {
  let state = rollingPaperStates.get(streamerId);
  if (!state) {
    state = {
      topics: [], topicsLoaded: false, topicsLoading: false, topicError: '', showTopicForm: false, creatingTopic: false,
      activeTopicId: '', composeTopicId: '', entriesByTopic: new Map(), loadedTopicIds: new Set(), loadingTopicId: '',
      entryError: '', canDelete: false, canManageTopics: false, submitting: false,
      galleryItems: null, galleryLoading: false, galleryError: '', galleryOpen: false, galleryHasMore: false,
      galleryNextOffset: 0, galleryTotalCount: 0, selectedGalleryImage: null,
      stickers: [], stickersLoaded: false, stickersLoading: false, stickerError: '', ownStickerId: '',
      canPlaceSticker: false, canManageStickers: false, stickerChoices: [], stickerPaletteOpen: false,
      selectedStickerEmoji: '', stickerPlacing: false, stickerActionMenuOpen: false,
      showHiddenStickers: false, selectedStickerMenuId: '', movingStickerId: '', draggingStickerId: '',
      stickerMoveOriginal: null,
      savingSticker: false, stickerMoveQueue: new Map(), stickerMovePromise: null,
    };
    rollingPaperStates.set(streamerId, state);
  }
  return state;
}

function renderRollingPaperSection(page) {
  const streamerId = page.streamer.id;
  const state = rollingPaperStateFor(streamerId);
  const activeTopic = state.topics.find((topic) => topic.id === state.activeTopicId);
  const entries = state.entriesByTopic.get(state.activeTopicId) || [];
  const totalCount = state.topics.reduce((sum, topic) => sum + (Number(topic.count) || 0), 0);

  const section = document.createElement('section');
  section.className = 'rolling-paper-section content-card';
  section.id = 'rollingPaperSection';

  const heading = document.createElement('div'); heading.className = 'rolling-paper-heading';
  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'ROLLING PAPER';
  const title = document.createElement('h2'); title.textContent = activeTopic?.title || '롤링페이퍼';
  const subtitle = document.createElement('p'); subtitle.className = 'rolling-paper-subtitle';
  subtitle.textContent = activeTopic
    ? page.isStreamerOwner
      ? '팬들이 남긴 응원 메시지를 확인해 보세요.'
      : '닉네임은 선택 사항이에요. 비워 두면 익명으로 표시돼요.'
    : page.isStreamerOwner
      ? '주제를 선택해 팬들이 남긴 응원 메시지를 확인해 보세요.'
      : state.composeTopicId
        ? '카드 안에 바로 마음을 적어 등록해 보세요.'
        : '주제를 선택해 카드 안에서 응원 메시지를 남겨 보세요.';
  headingCopy.append(eyebrow, title, subtitle);
  const actions = document.createElement('div'); actions.className = 'rolling-paper-heading-actions';
  const count = document.createElement('span'); count.className = 'rolling-paper-count';
  count.textContent = `${(activeTopic ? Number(activeTopic.count) || 0 : totalCount).toLocaleString('ko-KR')}개`;
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'button rolling-paper-refresh';
  const loading = activeTopic ? state.loadingTopicId === activeTopic.id : state.topicsLoading;
  refresh.textContent = loading ? '불러오는 중…' : '↻ 새로고침';
  refresh.disabled = loading;
  refresh.addEventListener('click', () => {
    const tasks = [loadRollingPaperStickers(page, true)];
    tasks.push(activeTopic ? loadRollingPaperEntries(page, activeTopic.id, true) : loadRollingPaperTopics(page, true));
    void Promise.all(tasks);
  });
  actions.append(count);
  if (activeTopic && !page.isStreamerOwner) {
    const composerOpen = state.composeTopicId === activeTopic.id;
    const composeToggle = document.createElement('button'); composeToggle.type = 'button';
    composeToggle.className = 'button button-primary rolling-paper-topic-compose';
    composeToggle.textContent = composerOpen ? '작성 닫기' : '메시지 남기기';
    composeToggle.setAttribute('aria-expanded', String(composerOpen));
    composeToggle.addEventListener('click', () => {
      state.composeTopicId = composerOpen ? '' : activeTopic.id;
      state.entryError = '';
      state.selectedGalleryImage = null;
      refreshRollingPaperSection(streamerId);
      if (!composerOpen) requestAnimationFrame(() => $('rollingPaperSection')?.querySelector('textarea[name="message"]')?.focus({ preventScroll: true }));
    });
    actions.append(composeToggle);
  }
  if (activeTopic && activeTopic.id !== 'general' && page.isOwner && state.canManageTopics) {
    const deleteTopic = document.createElement('button'); deleteTopic.type = 'button';
    deleteTopic.className = 'button rolling-paper-topic-delete'; deleteTopic.textContent = '주제 삭제';
    deleteTopic.addEventListener('click', () => deleteRollingPaperTopic(page, activeTopic, deleteTopic));
    actions.append(deleteTopic);
  }
  actions.append(refresh);
  heading.append(headingCopy, actions);
  section.append(heading);
  section.append(renderRollingPaperStickerBoard(page, state));
  if (!state.stickersLoaded && !state.stickersLoading && !state.stickerError) void loadRollingPaperStickers(page);

  if (!activeTopic) {
    const status = document.createElement('p'); status.className = 'rolling-paper-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const loadingTopics = state.topicsLoading || (!state.topicsLoaded && !state.topicError);
    if (loadingTopics) status.textContent = '롤링페이퍼 주제를 불러오고 있어요.';
    else if (state.topicError) { status.textContent = state.topicError; status.classList.add('is-error'); }
    if (loadingTopics || state.topicError) section.append(status);
    const grid = document.createElement('div'); grid.className = 'rolling-paper-topic-grid';
    if (state.topicsLoaded && !state.topicsLoading && !state.topicError && !state.topics.length) {
      const empty = document.createElement('p'); empty.className = 'rolling-paper-empty';
      empty.textContent = '아직 주제가 없어요.'; grid.append(empty);
    }
    state.topics.forEach((topic, index) => {
      const isComposing = state.composeTopicId === topic.id;
      const card = document.createElement('article'); card.className = 'rolling-paper-topic-card';
      card.classList.toggle('is-composing', isComposing);
      const decoration = document.createElement('span'); decoration.className = 'rolling-paper-topic-decoration';
      decoration.setAttribute('aria-hidden', 'true'); decoration.textContent = ['✦', '♡', '✿'][index % 3];
      const topicTitle = document.createElement('strong'); topicTitle.className = 'rolling-paper-topic-title'; topicTitle.textContent = topic.title;
      const topicCount = document.createElement('span'); topicCount.className = 'rolling-paper-topic-count';
      topicCount.textContent = `메시지 ${Number(topic.count || 0).toLocaleString('ko-KR')}개`;
      const cardHeading = document.createElement('div'); cardHeading.className = 'rolling-paper-topic-card-heading';
      cardHeading.append(decoration, topicTitle, topicCount);
      const cardActions = document.createElement('div'); cardActions.className = 'rolling-paper-topic-card-actions';
      if (!page.isStreamerOwner) {
        const composeToggle = document.createElement('button'); composeToggle.type = 'button';
        composeToggle.className = 'button button-primary rolling-paper-topic-compose';
        composeToggle.textContent = isComposing ? '작성 닫기' : '메시지 바로 남기기';
        composeToggle.setAttribute('aria-expanded', String(isComposing));
        composeToggle.addEventListener('click', () => {
          state.composeTopicId = isComposing ? '' : topic.id;
          state.entryError = '';
          state.selectedGalleryImage = null;
          refreshRollingPaperSection(streamerId);
          if (!isComposing) requestAnimationFrame(() => $('rollingPaperSection')?.querySelector('textarea[name="message"]')?.focus({ preventScroll: true }));
        });
        cardActions.append(composeToggle);
      }
      if (topic.id !== 'general' && page.isOwner && state.canManageTopics) {
        const deleteTopic = document.createElement('button'); deleteTopic.type = 'button';
        deleteTopic.className = 'button rolling-paper-topic-delete'; deleteTopic.textContent = '주제 삭제';
        deleteTopic.addEventListener('click', () => deleteRollingPaperTopic(page, topic, deleteTopic));
        cardActions.append(deleteTopic);
      }
      const viewEntries = document.createElement('button'); viewEntries.type = 'button';
      viewEntries.className = 'button rolling-paper-topic-view'; viewEntries.textContent = '메시지 보기';
      viewEntries.setAttribute('aria-label', '받은 메시지 보기');
      viewEntries.addEventListener('click', () => {
        state.activeTopicId = topic.id;
        state.composeTopicId = '';
        state.entryError = '';
        state.selectedGalleryImage = null;
        state.galleryOpen = false;
        refreshRollingPaperSection(streamerId);
        void loadRollingPaperEntries(page, topic.id);
      });
      cardActions.append(viewEntries);
      card.append(cardHeading, cardActions);
      if (isComposing && !page.isStreamerOwner) {
        card.append(createRollingPaperComposer(page, topic.id, cardActions));
        if (state.entryError) {
          const composerError = document.createElement('p'); composerError.className = 'rolling-paper-status is-error';
          composerError.setAttribute('role', 'status'); composerError.textContent = state.entryError; card.append(composerError);
        }
      }
      grid.append(card);
    });
    if (page.isOwner) {
      const addCard = document.createElement('article');
      addCard.className = 'rolling-paper-topic-card rolling-paper-topic-add-card';
      if (state.showTopicForm) {
        addCard.classList.add('is-topic-form-open');
        const addTitle = document.createElement('strong');
        addTitle.className = 'rolling-paper-topic-title'; addTitle.textContent = '새 주제 만들기';
        const topicForm = document.createElement('form'); topicForm.className = 'rolling-paper-topic-form rolling-paper-topic-add-form';
        const topicTitle = document.createElement('input'); topicTitle.id = 'rollingPaperTopicTitle'; topicTitle.name = 'title';
        topicTitle.type = 'text'; topicTitle.maxLength = 32; topicTitle.required = true;
        topicTitle.placeholder = '예: 100일 롤링페이퍼, 생일 축하'; topicTitle.setAttribute('aria-label', '새 롤링페이퍼 주제');
        topicTitle.disabled = state.creatingTopic;
        const formActions = document.createElement('div'); formActions.className = 'rolling-paper-topic-add-form-actions';
        const topicSubmit = document.createElement('button'); topicSubmit.type = 'submit';
        topicSubmit.className = 'button button-primary'; topicSubmit.textContent = state.creatingTopic ? '만드는 중…' : '주제 페이지 만들기';
        topicSubmit.disabled = state.creatingTopic;
        const cancelTopic = document.createElement('button'); cancelTopic.type = 'button';
        cancelTopic.className = 'button rolling-paper-topic-add-cancel'; cancelTopic.textContent = '취소';
        cancelTopic.disabled = state.creatingTopic;
        cancelTopic.addEventListener('click', () => {
          state.showTopicForm = false; state.topicError = '';
          refreshRollingPaperSection(streamerId);
        });
        formActions.append(topicSubmit, cancelTopic);
        topicForm.append(topicTitle, formActions);
        topicForm.addEventListener('submit', (event) => {
          event.preventDefault();
          if (topicForm.reportValidity() && !topicSubmit.disabled) createRollingPaperTopic(page, topicTitle, topicSubmit);
        });
        addCard.append(addTitle, topicForm);
      } else {
        const addTopic = document.createElement('button'); addTopic.type = 'button';
        addTopic.className = 'button button-primary rolling-paper-topic-add-card-button'; addTopic.textContent = '+ 주제 추가';
        addTopic.setAttribute('aria-label', '새 롤링페이퍼 주제 추가');
        addTopic.addEventListener('click', () => {
          state.showTopicForm = true; state.topicError = '';
          refreshRollingPaperSection(streamerId);
          requestAnimationFrame(() => $('rollingPaperTopicTitle')?.focus());
        });
        addCard.append(addTopic);
      }
      grid.append(addCard);
    }
    section.append(grid);
    return section;
  }

  const back = document.createElement('button'); back.type = 'button'; back.className = 'button rolling-paper-back';
  back.textContent = '← 주제 목록'; back.addEventListener('click', () => {
    state.activeTopicId = '';
    state.entryError = '';
    refreshRollingPaperSection(streamerId);
  });
  section.insertBefore(back, heading);

  if (!page.isStreamerOwner && state.composeTopicId === activeTopic.id) {
    section.append(createRollingPaperComposer(page, activeTopic.id, null, true));
  }

  const status = document.createElement('p'); status.className = 'rolling-paper-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  if (state.loadingTopicId === activeTopic.id) status.textContent = '롤링페이퍼를 불러오고 있어요.';
  else if (state.entryError) { status.textContent = state.entryError; status.classList.add('is-error'); }
  if (state.loadingTopicId === activeTopic.id || state.entryError) section.append(status);

  const list = document.createElement('div'); list.className = 'rolling-paper-list';
  if (state.loadingTopicId !== activeTopic.id && !state.entryError && !entries.length) {
    const empty = document.createElement('p'); empty.className = 'rolling-paper-empty';
    empty.textContent = page.isStreamerOwner ? '아직 메시지가 없어요.' : '아직 메시지가 없어요. 첫 번째로 마음을 남겨 보세요.'; list.append(empty);
  } else if (state.loadingTopicId !== activeTopic.id && entries.length) {
    entries.forEach((entry) => {
      const item = document.createElement('article'); item.className = 'rolling-paper-entry';
      const itemHeading = document.createElement('div'); itemHeading.className = 'rolling-paper-entry-heading';
      const author = document.createElement('strong'); author.className = 'rolling-paper-entry-author';
      author.textContent = `✦ ${entry.nickname || '익명'}`;
      const date = document.createElement('time'); date.className = 'rolling-paper-entry-date';
      date.dateTime = new Date(entry.createdAt).toISOString();
      date.textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(entry.createdAt);
      itemHeading.append(author, date);
      if (state.canDelete) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button rolling-paper-delete';
        remove.textContent = '삭제'; remove.setAttribute('aria-label', '롤링페이퍼 메시지 삭제');
        remove.addEventListener('click', () => deleteRollingPaperEntry(page, activeTopic.id, entry, remove)); itemHeading.append(remove);
      }
      if (entry.galleryImage?.url) {
        const galleryImage = document.createElement('img'); galleryImage.className = 'rolling-paper-entry-image';
        galleryImage.src = entry.galleryImage.url; galleryImage.alt = '스트리머 갤러리에서 선택한 이미지';
        galleryImage.loading = 'lazy'; item.append(galleryImage);
      }
      item.append(itemHeading);
      if (entry.content) {
        const content = document.createElement('p'); content.className = 'rolling-paper-entry-content'; content.textContent = entry.content; item.append(content);
      }
      list.append(item);
    });
  }
  section.append(list);
  if (!state.loadedTopicIds.has(activeTopic.id) && state.loadingTopicId !== activeTopic.id) void loadRollingPaperEntries(page, activeTopic.id);
  return section;
}

function rollingPaperStickerHiddenKey(streamerId) {
  return `streamerFanPageRollingPaperStickersHidden:${streamerId}`;
}

function rollingPaperStickersAreHidden(streamerId) {
  try { return localStorage.getItem(rollingPaperStickerHiddenKey(streamerId)) === '1'; } catch (_) { return false; }
}

function rollingPaperHiddenStickerIds(streamerId) {
  try {
    const value = JSON.parse(localStorage.getItem(`streamerFanPageRollingPaperHiddenStickerIds:${streamerId}`) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 250) : []);
  } catch (_) { return new Set(); }
}

function saveRollingPaperHiddenStickerIds(streamerId, ids) {
  try { localStorage.setItem(`streamerFanPageRollingPaperHiddenStickerIds:${streamerId}`, JSON.stringify([...ids].slice(0, 250))); } catch (_) { /* Keep the board usable when browser storage is unavailable. */ }
}

function rollingPaperStickerPosition(board, clientX, clientY) {
  const bounds = board.getBoundingClientRect();
  const x = Math.max(4, Math.min(96, ((clientX - bounds.left) / Math.max(1, bounds.width)) * 100));
  const y = Math.max(4, Math.min(96, ((clientY - bounds.top) / Math.max(1, bounds.height)) * 100));
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function cancelRollingPaperStickerMove(page, stickerId) {
  const state = rollingPaperStateFor(page.streamer.id);
  const original = state.stickerMoveOriginal;
  const sticker = state.stickers.find((item) => item.id === stickerId);
  if (original && original.id === stickerId && sticker) {
    sticker.x = original.x; sticker.y = original.y;
  }
  state.stickerMoveOriginal = null;
  state.movingStickerId = ''; state.draggingStickerId = '';
  refreshRollingPaperSection(page.streamer.id);
}

function renderRollingPaperStickerBoard(page, state) {
  const streamerId = page.streamer.id;
  const section = document.createElement('section'); section.className = 'rolling-paper-sticker-panel';
  const toolbar = document.createElement('div'); toolbar.className = 'rolling-paper-sticker-toolbar';
  const summary = document.createElement('div'); summary.className = 'rolling-paper-sticker-summary';
  const title = document.createElement('strong'); title.textContent = '응원 스티커';
  const count = document.createElement('span');
  count.textContent = state.stickersLoading && !state.stickersLoaded ? '불러오는 중' : `${state.stickers.length}개`;
  summary.append(title, count); toolbar.append(summary);
  const hidden = rollingPaperStickersAreHidden(streamerId);
  const storedHiddenStickerIds = rollingPaperHiddenStickerIds(streamerId);
  const availableStickerIds = new Set(state.stickers.map((sticker) => sticker.id));
  const hiddenStickerIds = new Set([...storedHiddenStickerIds].filter((id) => availableStickerIds.has(id)));
  if (state.stickerPlacing) {
    const placementHint = document.createElement('p'); placementHint.className = 'rolling-paper-sticker-hint is-floating';
    placementHint.textContent = `${state.selectedStickerEmoji} 붙일 위치를 화면에서 누르세요. 취소는 오른쪽 스티커 버튼에서 할 수 있어요.`;
    section.append(placementHint);
  } else if (state.movingStickerId) {
    const moveHint = document.createElement('p'); moveHint.className = 'rolling-paper-sticker-hint is-floating';
    moveHint.textContent = '노란 테두리 스티커를 드래그하세요. 취소하려면 Esc를 누르세요.';
    section.append(moveHint);
  } else if (state.showHiddenStickers && hiddenStickerIds.size) {
    const restoreHint = document.createElement('p'); restoreHint.className = 'rolling-paper-sticker-hint is-floating';
    restoreHint.textContent = '흐리게 표시된 숨김 스티커를 누르고 “다시 표시”를 선택하세요.';
    section.append(restoreHint);
  }
  if (state.stickerError) {
    const error = document.createElement('p'); error.className = 'rolling-paper-sticker-hint is-error'; error.textContent = state.stickerError;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button rolling-paper-sticker-action';
    retry.textContent = '다시 불러오기'; retry.disabled = state.stickersLoading;
    retry.addEventListener('click', () => { void loadRollingPaperStickers(page, true); });
    section.append(error, retry);
  }

  const board = document.createElement('div'); board.className = 'rolling-paper-sticker-board';
  board.setAttribute('role', 'group'); board.setAttribute('aria-label', '응원 스티커 보드');
  board.classList.toggle('is-hidden', hidden);
  board.classList.toggle('is-placing', state.stickerPlacing);
  if (!hidden) {
    const liveBoardBounds = $('rollingPaperSection')?.querySelector('.rolling-paper-sticker-board')?.getBoundingClientRect();
    state.stickers.forEach((sticker) => {
      const hiddenForViewer = hiddenStickerIds.has(sticker.id);
      if (hiddenForViewer && !state.showHiddenStickers) return;
      const item = document.createElement('div'); item.className = 'rolling-paper-sticker';
      const canMove = state.canManageStickers && state.movingStickerId === sticker.id;
      const menuOpen = state.selectedStickerMenuId === sticker.id;
      item.classList.toggle('is-movable', canMove);
      item.classList.toggle('is-menu-open', menuOpen);
      item.classList.toggle('is-viewer-hidden', hiddenForViewer);
      item.classList.toggle('is-own', sticker.id === state.ownStickerId);
      item.classList.toggle('is-dragging', sticker.id === state.draggingStickerId);
      item.dataset.stickerId = sticker.id;
      item.style.left = `${sticker.x}%`; item.style.top = `${sticker.y}%`;
      const menuCenterX = liveBoardBounds ? liveBoardBounds.left + liveBoardBounds.width * sticker.x / 100 : window.innerWidth / 2;
      const menuCenterY = liveBoardBounds ? liveBoardBounds.top + liveBoardBounds.height * sticker.y / 100 : window.innerHeight / 2;
      const menuWidth = Math.max(120, Math.min(190, window.innerWidth - 28));
      const menuActionCount = 1 + (state.canManageStickers ? 1 : 0)
        + (state.canManageStickers || sticker.id === state.ownStickerId ? 1 : 0);
      const menuHeight = menuActionCount * 43 + 14;
      item.dataset.menuSide = menuCenterX + 28 + menuWidth > window.innerWidth - 8 ? 'left' : 'right';
      const menuWouldOverflowBottom = menuCenterY + 35 + menuHeight > window.innerHeight - 8;
      const menuWouldOverflowTop = menuCenterY - 35 - menuHeight < 8;
      item.dataset.menuVertical = menuWouldOverflowBottom && !menuWouldOverflowTop ? 'above' : 'below';
      const trigger = document.createElement('button'); trigger.type = 'button';
      trigger.className = 'rolling-paper-sticker-trigger'; trigger.textContent = sticker.emoji;
      trigger.setAttribute('aria-label', `${sticker.emoji} 응원 스티커 메뉴 열기${sticker.id === state.ownStickerId ? ', 내가 붙인 스티커' : ''}${hiddenForViewer ? ', 내 화면에서 숨김' : ''}`);
      trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', String(menuOpen));
      trigger.title = canMove ? '드래그해 위치를 옮기세요. 취소하려면 Esc를 누르세요.' : '스티커 작업 보기';
      item.append(trigger);
      const contextMenu = document.createElement('div'); contextMenu.className = 'rolling-paper-sticker-context-menu';
      contextMenu.setAttribute('role', 'menu'); contextMenu.setAttribute('aria-label', '스티커 작업');
      contextMenu.hidden = !menuOpen;
      const addContextAction = (label, action, primary = false) => {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `rolling-paper-sticker-context-action${primary ? ' is-primary' : ''}`;
        button.setAttribute('role', 'menuitem'); button.textContent = label;
        button.disabled = state.savingSticker;
        button.addEventListener('click', (event) => { event.stopPropagation(); action(button); });
        contextMenu.append(button);
      };
      addContextAction(hiddenForViewer ? '다시 표시' : '내 화면에서 숨기기', () => {
        const updated = rollingPaperHiddenStickerIds(streamerId);
        if (hiddenForViewer) updated.delete(sticker.id); else updated.add(sticker.id);
        saveRollingPaperHiddenStickerIds(streamerId, updated);
        state.selectedStickerMenuId = '';
        if (hiddenForViewer && !updated.size) state.showHiddenStickers = false;
        refreshRollingPaperSection(streamerId);
      });
      if (state.canManageStickers) {
        if (canMove) {
          addContextAction('이동 취소', () => cancelRollingPaperStickerMove(page, sticker.id));
        } else {
          addContextAction('위치 옮기기', () => {
            state.movingStickerId = sticker.id;
            state.stickerMoveOriginal = { id: sticker.id, x: sticker.x, y: sticker.y };
            state.selectedStickerMenuId = ''; state.showHiddenStickers = false;
            refreshRollingPaperSection(streamerId);
          }, true);
        }
      }
      if (state.canManageStickers || sticker.id === state.ownStickerId) {
        addContextAction(sticker.id === state.ownStickerId ? '내 스티커 떼기' : '스티커 삭제', (button) => {
          state.selectedStickerMenuId = '';
          void deleteRollingPaperStickerFromBoard(page, sticker.id, button);
        });
      }
      item.append(contextMenu);
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.stickerPlacing && !state.savingSticker) {
          const position = rollingPaperStickerPosition(board, event.clientX, event.clientY);
          state.selectedStickerMenuId = '';
          void addRollingPaperStickerToBoard(page, state.selectedStickerEmoji, position);
          return;
        }
        if (state.draggingStickerId === sticker.id || trigger.dataset.dragMoved === '1') {
          trigger.dataset.dragMoved = '0'; return;
        }
        state.selectedStickerMenuId = menuOpen ? '' : sticker.id;
        state.stickerActionMenuOpen = false;
        refreshRollingPaperSection(streamerId);
      });
      if (canMove) {
        trigger.addEventListener('pointerdown', (event) => {
          if (state.savingSticker && !state.stickerMovePromise) return;
          event.preventDefault();
          try { trigger.setPointerCapture(event.pointerId); } catch (_) { /* pointer capture may not be available */ }
          state.draggingStickerId = sticker.id;
          trigger.dataset.pointerId = String(event.pointerId);
          trigger.dataset.dragMoved = '0';
          item.classList.add('is-dragging');
        });
        trigger.addEventListener('pointermove', (event) => {
          if (state.draggingStickerId !== sticker.id || trigger.dataset.pointerId !== String(event.pointerId)) return;
          const position = rollingPaperStickerPosition(board, event.clientX, event.clientY);
          if (Math.abs(position.x - sticker.x) + Math.abs(position.y - sticker.y) > 0.2) trigger.dataset.dragMoved = '1';
          sticker.x = position.x; sticker.y = position.y;
          item.style.left = `${position.x}%`; item.style.top = `${position.y}%`;
        });
        const finishDrag = (event) => {
          if (state.draggingStickerId !== sticker.id || trigger.dataset.pointerId !== String(event.pointerId)) return;
          if (event.type === 'pointerup') {
            const bounds = board.getBoundingClientRect();
            const droppedInside = event.clientX >= bounds.left && event.clientX <= bounds.right
              && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
            if (!droppedInside) {
              try { if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId); } catch (_) { /* capture may already be released */ }
              cancelRollingPaperStickerMove(page, sticker.id);
              return;
            }
            const position = rollingPaperStickerPosition(board, event.clientX, event.clientY);
            if (Math.abs(position.x - sticker.x) + Math.abs(position.y - sticker.y) > 0.2) trigger.dataset.dragMoved = '1';
            sticker.x = position.x; sticker.y = position.y;
            item.style.left = `${position.x}%`; item.style.top = `${position.y}%`;
          } else {
            try { if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId); } catch (_) { /* capture may already be released */ }
            cancelRollingPaperStickerMove(page, sticker.id);
            return;
          }
          const moved = trigger.dataset.dragMoved === '1';
          state.draggingStickerId = '';
          try { if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId); } catch (_) { /* capture may already be released */ }
          item.classList.remove('is-dragging');
          if (moved) void moveRollingPaperStickerOnBoard(page, sticker, item);
          else cancelRollingPaperStickerMove(page, sticker.id);
        };
        trigger.addEventListener('pointerup', finishDrag);
        trigger.addEventListener('pointercancel', finishDrag);
        trigger.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault(); cancelRollingPaperStickerMove(page, sticker.id); return;
          }
          if (state.savingSticker && !state.stickerMovePromise) return;
          const step = event.shiftKey ? 5 : 1;
          const next = { x: sticker.x, y: sticker.y };
          if (event.key === 'ArrowLeft') next.x -= step;
          else if (event.key === 'ArrowRight') next.x += step;
          else if (event.key === 'ArrowUp') next.y -= step;
          else if (event.key === 'ArrowDown') next.y += step;
          else return;
          event.preventDefault();
          if (!state.stickerMoveOriginal) state.stickerMoveOriginal = { id: sticker.id, x: sticker.x, y: sticker.y };
          sticker.x = Math.max(4, Math.min(96, next.x)); sticker.y = Math.max(4, Math.min(96, next.y));
          void moveRollingPaperStickerOnBoard(page, sticker, item);
        });
      }
      board.append(item);
    });
  }
  board.addEventListener('click', (event) => {
    if (!state.stickerPlacing || state.savingSticker) return;
    if (event.target.closest('.rolling-paper-sticker')) return;
    const position = rollingPaperStickerPosition(board, event.clientX, event.clientY);
    void addRollingPaperStickerToBoard(page, state.selectedStickerEmoji, position);
  });
  section.append(board);
  return section;
}

async function loadRollingPaperStickers(page, force = false) {
  const streamerId = page.streamer.id;
  const state = rollingPaperStateFor(streamerId);
  if (state.stickersLoading || (state.stickersLoaded && !force)) return;
  state.stickersLoading = true; state.stickerError = '';
  refreshRollingPaperSection(streamerId);
  try {
    const result = (await callRollingPaper({ action: 'list-stickers', streamerId })).data;
    state.stickers = Array.isArray(result.stickers) ? result.stickers : [];
    state.ownStickerId = typeof result.ownStickerId === 'string' ? result.ownStickerId : '';
    state.canPlaceSticker = result.canPlace === true;
    state.canManageStickers = result.canManage === true;
    state.stickerChoices = Array.isArray(result.stickerChoices) ? result.stickerChoices : [];
    state.stickersLoaded = true;
  } catch (error) {
    state.stickerError = error.message || '응원 스티커를 불러오지 못했어요.';
  } finally {
    state.stickersLoading = false;
    refreshRollingPaperSection(streamerId);
  }
}

async function addRollingPaperStickerToBoard(page, emoji, position) {
  const state = rollingPaperStateFor(page.streamer.id);
  if (state.savingSticker || !state.canPlaceSticker || !emoji) return;
  state.savingSticker = true; state.stickerError = '';
  refreshRollingPaperSection(page.streamer.id);
  try {
    const result = (await callRollingPaper({ action: 'add-sticker', streamerId: page.streamer.id, emoji, ...position })).data;
    state.stickers = Array.isArray(result.stickers) ? result.stickers : state.stickers;
    state.ownStickerId = result.ownStickerId || '';
    state.canPlaceSticker = result.canPlace === true;
    state.stickerPlacing = false; state.selectedStickerEmoji = ''; state.stickerPaletteOpen = false;
    state.stickersLoaded = true;
    showToast('응원 스티커를 붙였어요.');
  } catch (error) {
    state.stickerError = error.message || '스티커를 붙이지 못했어요.';
  } finally {
    state.savingSticker = false;
    refreshRollingPaperSection(page.streamer.id);
  }
}

async function moveRollingPaperStickerOnBoard(page, sticker, item) {
  const state = rollingPaperStateFor(page.streamer.id);
  if (!state.canManageStickers || (state.savingSticker && !state.stickerMovePromise)) return;
  state.stickerMoveQueue.set(sticker.id, { x: sticker.x, y: sticker.y });
  if (state.stickerMovePromise) return state.stickerMovePromise;

  state.savingSticker = true; state.stickerError = '';
  state.stickerMovePromise = (async () => {
    let latestResult = null;
    let reloadAfterFailure = false;
    let failureMessage = '';
    try {
      latestResult = await drainRollingPaperStickerMoveQueue(state.stickerMoveQueue, async (stickerId, position) => {
        const response = (await callRollingPaper({
          action: 'move-sticker', streamerId: page.streamer.id, stickerId, ...position,
        })).data;
        if (Array.isArray(response.stickers)) latestResult = response;
        return response;
      });
      state.stickers = Array.isArray(latestResult?.stickers) ? latestResult.stickers : state.stickers;
      showToast('스티커 위치를 옮겼어요.');
    } catch (error) {
      state.stickerMoveQueue.clear();
      failureMessage = error.message || '스티커를 옮기지 못했어요.';
      state.stickerError = failureMessage;
      reloadAfterFailure = true;
    } finally {
      state.savingSticker = false;
      state.stickerMovePromise = null;
      state.movingStickerId = '';
      state.stickerMoveOriginal = null;
      if (item) item.classList.remove('is-dragging');
      refreshRollingPaperSection(page.streamer.id);
      if (reloadAfterFailure) {
        void loadRollingPaperStickers(page, true).then(() => {
          state.stickerError = failureMessage;
          refreshRollingPaperSection(page.streamer.id);
        });
      }
    }
  })();
  refreshRollingPaperSection(page.streamer.id);
  return state.stickerMovePromise;
}

async function deleteRollingPaperStickerFromBoard(page, stickerId, button) {
  const state = rollingPaperStateFor(page.streamer.id);
  if (state.savingSticker || !confirm('이 스티커를 롤링페이퍼에서 뗄까요?')) return;
  state.savingSticker = true; state.stickerError = '';
  if (button) button.disabled = true;
  try {
    const result = (await callRollingPaper({ action: 'delete-sticker', streamerId: page.streamer.id, stickerId })).data;
    state.stickers = Array.isArray(result.stickers) ? result.stickers : [];
    state.ownStickerId = result.ownStickerId || '';
    state.canPlaceSticker = result.canPlace === true;
    showToast('스티커를 뗐어요.');
  } catch (error) {
    state.stickerError = error.message || '스티커를 떼지 못했어요.';
  } finally {
    state.savingSticker = false;
    refreshRollingPaperSection(page.streamer.id);
  }
}

function createRollingPaperComposer(page, topicId, imageActionSlot = null, isDetail = false) {
  const streamerId = page.streamer.id;
  const state = rollingPaperStateFor(streamerId);
  const form = document.createElement('form'); form.className = `rolling-paper-form${isDetail ? ' rolling-paper-form-detail' : ''}`;
  form.classList.toggle('has-gallery-picker', isDetail && state.galleryOpen);
  const galleryActions = document.createElement('div'); galleryActions.className = 'rolling-paper-image-actions';
  const chooseImage = document.createElement('button'); chooseImage.type = 'button';
  chooseImage.className = 'button rolling-paper-image-picker-toggle';
  chooseImage.textContent = state.galleryOpen ? '갤러리 닫기' : '▧ 갤러리 첨부';
  chooseImage.setAttribute('aria-label', state.galleryOpen ? '갤러리 닫기' : '갤러리 이미지 넣기');
  chooseImage.disabled = state.submitting;
  chooseImage.addEventListener('click', () => {
    state.galleryOpen = !state.galleryOpen;
    refreshRollingPaperSection(streamerId);
    if (state.galleryOpen && !state.galleryItems && !state.galleryLoading) void loadRollingPaperGallery(page);
  });
  if (imageActionSlot) imageActionSlot.append(chooseImage);
  else galleryActions.append(chooseImage);
  if (state.selectedGalleryImage) {
    const selected = document.createElement('div'); selected.className = 'rolling-paper-selected-image';
    const preview = document.createElement('img'); preview.src = state.selectedGalleryImage.thumbUrl; preview.alt = '선택한 갤러리 이미지';
    const selectedLabel = document.createElement('span'); selectedLabel.textContent = '이미지를 메시지에 함께 올려요.';
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'button'; clear.textContent = '제거';
    clear.addEventListener('click', () => { state.selectedGalleryImage = null; refreshRollingPaperSection(streamerId); });
    selected.append(preview, selectedLabel, clear); form.append(selected);
  }
  if (!imageActionSlot) form.append(galleryActions);

  if (state.galleryOpen) {
    const picker = document.createElement('div'); picker.className = 'rolling-paper-gallery-picker';
    if (state.galleryLoading && !state.galleryItems?.length) {
      const pickerStatus = document.createElement('p'); pickerStatus.className = 'rolling-paper-status';
      pickerStatus.textContent = '갤러리 이미지를 불러오고 있어요.'; picker.append(pickerStatus);
    }
    if (state.galleryError) {
      const pickerError = document.createElement('p'); pickerError.className = 'rolling-paper-status is-error'; pickerError.textContent = state.galleryError;
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button'; retry.textContent = '다시 불러오기';
      retry.addEventListener('click', () => loadRollingPaperGallery(page, !!state.galleryItems?.length)); picker.append(pickerError, retry);
    } else if (!state.galleryItems?.length && !state.galleryLoading) {
      const emptyGallery = document.createElement('p'); emptyGallery.className = 'rolling-paper-status';
      emptyGallery.textContent = '선택할 수 있는 공개 갤러리 이미지가 없어요.'; picker.append(emptyGallery);
    }
    if (state.galleryItems?.length) {
      const galleryGrid = document.createElement('div'); galleryGrid.className = 'rolling-paper-gallery-grid';
      state.galleryItems.forEach((image) => {
        const imageButton = document.createElement('button'); imageButton.type = 'button'; imageButton.className = 'rolling-paper-gallery-image';
        const isSelected = state.selectedGalleryImage?.id === image.id;
        imageButton.classList.toggle('is-selected', isSelected); imageButton.setAttribute('aria-pressed', String(isSelected));
        imageButton.setAttribute('aria-label', `${image.categoryLabel || '갤러리'} 이미지 선택`);
        const thumbnail = document.createElement('img'); thumbnail.src = image.thumbUrl; thumbnail.alt = ''; thumbnail.loading = 'lazy';
        imageButton.append(thumbnail);
        imageButton.addEventListener('click', () => {
          state.selectedGalleryImage = { id: image.id, thumbUrl: image.thumbUrl };
          state.galleryOpen = false;
          refreshRollingPaperSection(streamerId);
        });
        galleryGrid.append(imageButton);
      });
      picker.append(galleryGrid);
    }
    if (state.galleryHasMore && !state.galleryError) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'button rolling-paper-gallery-more';
      const remaining = Math.max(0, state.galleryTotalCount - (state.galleryItems?.length || 0));
      more.textContent = state.galleryLoading ? '불러오는 중…' : `갤러리 이미지 더 보기 (${remaining.toLocaleString('ko-KR')}개 남음)`;
      more.disabled = state.galleryLoading;
      more.addEventListener('click', () => loadRollingPaperGallery(page, true)); picker.append(more);
    }
    form.append(picker);
  }

  const nicknameInput = document.createElement('input'); nicknameInput.type = 'text'; nicknameInput.name = 'nickname';
  nicknameInput.className = 'rolling-paper-nickname'; nicknameInput.maxLength = 20;
  nicknameInput.placeholder = '닉네임 (선택 · 비워 두면 익명)'; nicknameInput.setAttribute('aria-label', '닉네임 (선택)');
  nicknameInput.autocomplete = 'off'; nicknameInput.disabled = state.submitting;
  const textarea = document.createElement('textarea'); textarea.name = 'message'; textarea.maxLength = 300;
  textarea.rows = 3; textarea.setAttribute('aria-label', '롤링페이퍼 메시지');
  textarea.placeholder = state.selectedGalleryImage ? '이미지와 함께 전할 말을 적어 주세요. (선택)' : '응원이나 전하고 싶은 마음을 적어 주세요.';
  textarea.disabled = state.submitting;
  textarea.addEventListener('input', () => resizeRollingPaperTextarea(textarea));
  const formFooter = document.createElement('div'); formFooter.className = 'rolling-paper-form-footer';
  const note = document.createElement('small'); note.className = 'rolling-paper-note';
  note.textContent = '닉네임은 입력하면 공개되고, 비워 두면 익명으로 표시돼요. 글은 최대 300자, 하루 최대 5개까지 남길 수 있어요.';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button button-primary';
  submit.textContent = state.submitting ? '등록 중…' : '메시지 남기기'; submit.disabled = state.submitting;
  formFooter.append(note, submit); form.append(nicknameInput, textarea, formFooter);
  resizeRollingPaperTextarea(textarea);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!textarea.value.trim() && !state.selectedGalleryImage) {
      textarea.setCustomValidity('메시지를 적거나 갤러리 이미지를 선택해 주세요.');
      textarea.reportValidity(); textarea.addEventListener('input', () => textarea.setCustomValidity(''), { once: true });
      return;
    }
    if (!submit.disabled) addRollingPaperEntry(page, nicknameInput, textarea, submit, topicId);
  });
  return form;
}

function resizeRollingPaperTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(textarea.scrollHeight, 88)}px`;
}

async function loadRollingPaperTopics(page, force = false) {
  const streamerId = page.streamer.id;
  const state = rollingPaperStateFor(streamerId);
  if (state.topicsLoading || (state.topicsLoaded && !force)) return;
  state.topicsLoading = true; state.topicError = '';
  refreshRollingPaperSection(streamerId);
  try {
    const result = (await callRollingPaper({ action: 'list-topics', streamerId })).data;
    state.topics = Array.isArray(result.topics) ? result.topics : [];
    state.canDelete = result.canDelete === true;
    state.canManageTopics = result.canManageTopics === true;
    state.topicsLoaded = true;
  } catch (error) {
    state.topicError = error.message || '롤링페이퍼 주제를 불러오지 못했어요.';
  } finally {
    state.topicsLoading = false;
    rollingPaperStates.set(streamerId, state);
    refreshRollingPaperSection(streamerId);
  }
}

async function loadRollingPaperEntries(page, topicId, force = false) {
  const streamerId = page.streamer.id;
  const state = rollingPaperStateFor(streamerId);
  if (state.loadingTopicId || (state.loadedTopicIds.has(topicId) && !force)) return;
  state.loadingTopicId = topicId; state.entryError = '';
  refreshRollingPaperSection(streamerId);
  try {
    const result = (await callRollingPaper({ action: 'list', streamerId, topicId })).data;
    state.entriesByTopic.set(topicId, Array.isArray(result.items) ? result.items : []);
    state.loadedTopicIds.add(topicId);
    state.topics = Array.isArray(result.topics) ? result.topics : state.topics;
    state.canDelete = result.canDelete === true;
  } catch (error) {
    state.entryError = error.message || '롤링페이퍼를 불러오지 못했어요.';
  } finally {
    state.loadingTopicId = '';
    rollingPaperStates.set(streamerId, state);
    refreshRollingPaperSection(streamerId);
  }
}

async function createRollingPaperTopic(page, input, button) {
  const state = rollingPaperStateFor(page.streamer.id);
  const title = input.value.replace(/\s+/g, ' ').trim();
  if (!title || state.creatingTopic) return;
  state.creatingTopic = true; state.topicError = '';
  button.disabled = true; button.textContent = '만드는 중…'; input.disabled = true;
  try {
    const result = (await callRollingPaper({ action: 'create-topic', streamerId: page.streamer.id, title })).data;
    state.topics = Array.isArray(result.topics) ? result.topics : state.topics;
    state.canManageTopics = result.canManageTopics === true;
    state.canDelete = result.canDelete === true;
    state.topicsLoaded = true; state.showTopicForm = false; state.creatingTopic = false;
    if (result.topic?.id) {
      state.activeTopicId = '';
      state.composeTopicId = result.topic.id;
      state.loadedTopicIds.delete(result.topic.id);
    }
    refreshRollingPaperSection(page.streamer.id);
    if (result.topic?.id) requestAnimationFrame(() => $('rollingPaperSection')?.querySelector('textarea[name="message"]')?.focus({ preventScroll: true }));
    showToast('새 롤링페이퍼 페이지를 만들었어요.');
  } catch (error) {
    state.creatingTopic = false; state.topicError = error.message || '주제를 만들지 못했어요.';
    refreshRollingPaperSection(page.streamer.id);
  }
}

async function loadRollingPaperGallery(page, append = false) {
  const state = rollingPaperStateFor(page.streamer.id);
  if (state.galleryLoading) return;
  state.galleryLoading = true; state.galleryError = '';
  refreshRollingPaperSection(page.streamer.id);
  try {
    const offset = append ? state.galleryNextOffset : 0;
    const result = (await callGallery({ streamerId: page.streamer.id, view: 'rolling-paper-picker', offset })).data;
    const nextItems = Array.isArray(result.items) ? result.items.filter((item) => item && item.id && item.thumbUrl) : [];
    state.galleryItems = append ? [...(state.galleryItems || []), ...nextItems] : nextItems;
    state.galleryNextOffset = Number(result.nextOffset) || state.galleryItems.length;
    state.galleryTotalCount = Number(result.totalCount) || state.galleryItems.length;
    state.galleryHasMore = result.hasMore === true;
    if (!state.galleryItems.length) state.galleryError = result.linked === false ? '연결된 스트리머 갤러리를 찾지 못했어요.' : '';
  } catch (error) {
    state.galleryError = error.message || '갤러리 이미지를 불러오지 못했어요.';
  } finally {
    state.galleryLoading = false;
    refreshRollingPaperSection(page.streamer.id);
  }
}

async function addRollingPaperEntry(page, nicknameInput, textarea, button, topicId = '') {
  const streamerId = page.streamer.id;
  const state = rollingPaperStateFor(streamerId);
  topicId = topicId || state.activeTopicId;
  const content = textarea.value.trim();
  if ((!content && !state.selectedGalleryImage) || state.submitting || !topicId) return;
  const nickname = nicknameInput.value.trim();
  state.submitting = true; state.entryError = '';
  button.disabled = true; button.textContent = '등록 중…'; nicknameInput.disabled = true; textarea.disabled = true;
  try {
    const galleryImage = state.selectedGalleryImage
      ? { id: state.selectedGalleryImage.id, url: state.selectedGalleryImage.thumbUrl }
      : null;
    const result = (await callRollingPaper({ action: 'add', streamerId, topicId, nickname, content, galleryImage })).data;
    state.entriesByTopic.set(topicId, Array.isArray(result.items) ? result.items : []);
    state.loadedTopicIds.add(topicId);
    state.topics = Array.isArray(result.topics) ? result.topics : state.topics;
    state.canDelete = result.canDelete === true; state.submitting = false; state.selectedGalleryImage = null; state.entryError = '';
    state.activeTopicId = topicId; state.composeTopicId = ''; state.galleryOpen = false;
    nicknameInput.value = ''; textarea.value = '';
    refreshRollingPaperSection(streamerId);
    showToast('메시지를 롤링페이퍼에 남겼어요.');
  } catch (error) {
    state.submitting = false; state.entryError = error.message || '메시지를 등록하지 못했어요.';
    refreshRollingPaperSection(streamerId);
  }
}

async function deleteRollingPaperEntry(page, topicId, entry, button) {
  const state = rollingPaperStateFor(page.streamer.id);
  if (!state.canDelete || button.disabled || !window.confirm('이 롤링페이퍼 메시지를 삭제할까요?')) return;
  button.disabled = true; button.textContent = '삭제 중…';
  try {
    const result = (await callRollingPaper({ action: 'delete', streamerId: page.streamer.id, topicId, entryId: entry.id })).data;
    state.entriesByTopic.set(topicId, Array.isArray(result.items) ? result.items : []);
    state.loadedTopicIds.add(topicId);
    state.topics = Array.isArray(result.topics) ? result.topics : state.topics;
    state.canDelete = result.canDelete === true;
    refreshRollingPaperSection(page.streamer.id);
    showToast('롤링페이퍼 메시지를 삭제했어요.');
  } catch (error) {
    showToast(error.message || '메시지를 삭제하지 못했어요.');
    button.disabled = false; button.textContent = '삭제';
  }
}

async function deleteRollingPaperTopic(page, topic, button) {
  const state = rollingPaperStateFor(page.streamer.id);
  if (!page.isOwner || !state.canManageTopics || button.disabled
    || !window.confirm(`“${topic.title}” 주제와 그 안의 메시지를 모두 삭제할까요? 삭제 후에는 복구할 수 없어요.`)) return;
  button.disabled = true; button.textContent = '삭제 중…';
  try {
    const result = (await callRollingPaper({ action: 'delete-topic', streamerId: page.streamer.id, topicId: topic.id })).data;
    state.topics = Array.isArray(result.topics) ? result.topics : state.topics.filter((item) => item.id !== topic.id);
    state.topicsLoaded = true;
    state.entriesByTopic.delete(topic.id);
    state.loadedTopicIds.delete(topic.id);
    if (state.activeTopicId === topic.id) state.activeTopicId = '';
    if (state.composeTopicId === topic.id) state.composeTopicId = '';
    state.selectedGalleryImage = null; state.galleryOpen = false; state.entryError = '';
    state.canDelete = result.canDelete === true;
    state.canManageTopics = result.canManageTopics === true;
    refreshRollingPaperSection(page.streamer.id);
    showToast('롤링페이퍼 주제와 메시지를 삭제했어요.');
  } catch (error) {
    showToast(error.message || '주제를 삭제하지 못했어요.');
    button.disabled = false; button.textContent = '주제 삭제';
  }
}

function refreshRollingPaperSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('rollingPaperSection');
  if (!section) return;
  const previousTextarea = section.querySelector('textarea[name="message"]');
  const previousNickname = section.querySelector('input[name="nickname"]');
  const previousTopicInput = section.querySelector('input[name="title"]');
  const keepTextareaFocus = document.activeElement === previousTextarea;
  const keepNicknameFocus = document.activeElement === previousNickname;
  const keepTopicInputFocus = document.activeElement === previousTopicInput;
  const nextSection = renderRollingPaperSection(currentPage);
  const nextTextarea = nextSection.querySelector('textarea[name="message"]');
  const nextNickname = nextSection.querySelector('input[name="nickname"]');
  const nextTopicInput = nextSection.querySelector('input[name="title"]');
  if (previousTextarea && nextTextarea) {
    nextTextarea.value = previousTextarea.value;
    resizeRollingPaperTextarea(nextTextarea);
    if (keepTextareaFocus) nextTextarea.focus({ preventScroll: true });
  }
  if (previousNickname && nextNickname) {
    nextNickname.value = previousNickname.value;
    if (keepNicknameFocus) nextNickname.focus({ preventScroll: true });
  }
  if (previousTopicInput && nextTopicInput) {
    nextTopicInput.value = previousTopicInput.value;
    if (keepTopicInputFocus) nextTopicInput.focus({ preventScroll: true });
  }
  section.replaceWith(nextSection);
  $('fanPageView')?._syncRollingPaperStickerQuickTools?.();
}

function renderCompetitionHistorySection(page) {
  const section = document.createElement('section');
  section.className = 'competition-history-section content-card';
  section.id = 'competitionHistorySection';

  const heading = document.createElement('div'); heading.className = 'competition-history-heading';
  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'TOURNAMENT RECORD';
  const title = document.createElement('h2'); title.textContent = '대회 이력';
  const subtitle = document.createElement('p'); subtitle.className = 'competition-history-subtitle';
  subtitle.textContent = '함께한 대회와 소중한 성과';
  headingCopy.append(eyebrow, title, subtitle);
  const headingActions = document.createElement('div'); headingActions.className = 'competition-history-heading-actions';
  const count = document.createElement('span'); count.className = 'competition-history-count';
  const add = page.isOwner ? document.createElement('button') : null;
  if (add) {
    add.type = 'button'; add.className = 'button button-primary competition-history-add';
    add.textContent = '+ 대회 이력 추가';
    add.addEventListener('click', () => openCompetitionHistoryDialog(page));
  }
  headingActions.append(count);
  if (add) headingActions.append(add);
  heading.append(headingCopy, headingActions);

  const list = document.createElement('div'); list.className = 'competition-history-list';
  const entries = (Array.isArray(page.profile?.competitionHistory) ? page.profile.competitionHistory : [])
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.eventName === 'string')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.eventName.localeCompare(b.eventName, 'ko'));
  count.textContent = `${entries.length}개`;
  if (add) {
    add.disabled = entries.length >= 30;
    if (add.disabled) add.title = '대회 이력은 최대 30개까지 등록할 수 있어요.';
  }

  if (!entries.length) {
    const empty = document.createElement('p'); empty.className = 'competition-history-empty';
    empty.textContent = page.isOwner ? '대회 이력을 추가해 팬들과 성과를 나눠 보세요.' : '아직 공개된 대회 이력이 없어요.';
    list.append(empty);
  } else {
    entries.forEach((entry) => {
      const item = document.createElement('article'); item.className = 'competition-history-item';
      const itemHeading = document.createElement('div'); itemHeading.className = 'competition-history-item-heading';
      const copy = document.createElement('div'); copy.className = 'competition-history-item-copy';
      const eventName = document.createElement('h3'); eventName.textContent = entry.eventName;
      const meta = document.createElement('div'); meta.className = 'competition-history-meta';
      const dateText = formatCompetitionHistoryDate(entry.date);
      if (dateText) {
        const date = document.createElement('span'); date.className = 'competition-history-date'; date.textContent = dateText; meta.append(date);
      }
      if (entry.category) {
        const category = document.createElement('span'); category.className = 'competition-history-category'; category.textContent = entry.category; meta.append(category);
      }
      copy.append(eventName);
      if (meta.childElementCount) copy.append(meta);
      itemHeading.append(copy);
      if (entry.result) {
        const result = document.createElement('span'); result.className = 'competition-history-result'; result.textContent = entry.result;
        itemHeading.append(result);
      }
      item.append(itemHeading);
      if (entry.description) {
        const description = document.createElement('p'); description.className = 'competition-history-description';
        description.textContent = entry.description; item.append(description);
      }
      const footer = document.createElement('div'); footer.className = 'competition-history-item-footer';
      if (entry.link) {
        const link = document.createElement('a'); link.className = 'competition-history-link';
        link.href = entry.link; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '대회 정보 보기 ↗';
        footer.append(link);
      }
      if (page.isOwner) {
        const actions = document.createElement('div'); actions.className = 'competition-history-item-actions';
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button'; edit.textContent = '수정';
        edit.addEventListener('click', () => openCompetitionHistoryDialog(page, entry));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button competition-history-delete'; remove.textContent = '삭제';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`“${entry.eventName}” 대회 이력을 삭제할까요?`)) return;
          remove.disabled = true; remove.textContent = '삭제 중…';
          try {
            const nextEntries = entries.filter((candidate) => candidate.id !== entry.id);
            await saveCompetitionHistory(page, nextEntries, '대회 이력을 삭제했어요.');
          } catch (error) {
            showToast(error.message || '대회 이력을 삭제하지 못했어요.');
            remove.disabled = false; remove.textContent = '삭제';
          }
        });
        actions.append(edit, remove); footer.append(actions);
      }
      if (footer.childElementCount) item.append(footer);
      list.append(item);
    });
  }
  section.append(heading, list);
  return section;
}

function openCompetitionHistoryDialog(page, existingEntry = null) {
  if (!page.isOwner) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'account-dialog competition-history-dialog';
  dialog.setAttribute('aria-labelledby', 'competitionHistoryEditorTitle');
  const form = document.createElement('form'); form.className = 'account-dialog-card competition-history-form';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading';
  const title = document.createElement('h2'); title.id = 'competitionHistoryEditorTitle';
  title.textContent = existingEntry ? '대회 이력 수정' : '대회 이력 추가';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close';
  close.setAttribute('aria-label', '대회 이력 창 닫기'); close.textContent = '×'; close.addEventListener('click', () => dialog.close());
  const isTouchLayout = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  if (isTouchLayout) close.autofocus = true;
  heading.append(title, close);

  const fields = document.createElement('div'); fields.className = 'competition-history-form-grid';
  const makeField = (labelText, name, options = {}) => {
    const label = document.createElement('label'); label.className = `profile-editor-field${options.wide ? ' competition-history-field-wide' : ''}`;
    label.textContent = labelText;
    const input = options.multiline ? document.createElement('textarea') : document.createElement('input');
    input.name = name; input.maxLength = options.maxLength || 100;
    if (options.multiline) { input.rows = 4; input.placeholder = options.placeholder || ''; }
    else { input.type = options.type || 'text'; input.placeholder = options.placeholder || ''; }
    if (options.required) input.required = true;
    input.value = String(existingEntry?.[name] || '');
    label.append(input);
    return label;
  };
  const eventName = makeField('대회명', 'eventName', { required: true, maxLength: 100, placeholder: '예: SOOP 스트리머 리그' });
  const date = makeField('시기', 'date', { type: 'month' });
  const category = makeField('종목 / 대회 종류', 'category', { maxLength: 50, placeholder: '예: 리그 오브 레전드' });
  const result = makeField('성과', 'result', { maxLength: 80, placeholder: '예: 우승, 4강, 참가' });
  const description = makeField('설명', 'description', { multiline: true, wide: true, maxLength: 500, placeholder: '대회에서의 활약이나 팬들에게 전하고 싶은 내용을 적어 주세요.' });
  const link = makeField('대회 정보 링크 (선택)', 'link', { type: 'url', wide: true, maxLength: 500, placeholder: 'https://example.com' });
  fields.append(eventName, date, category, result, description, link);

  const note = document.createElement('p'); note.className = 'competition-history-note';
  note.textContent = '대회 이력은 팬페이지에 공개되며 최대 30개까지 등록할 수 있어요.';
  const status = document.createElement('p'); status.className = 'competition-history-form-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const footer = document.createElement('div'); footer.className = 'profile-editor-footer competition-history-form-footer';
  const hint = document.createElement('small'); hint.textContent = '서버에 안전하게 저장됩니다.';
  const actions = document.createElement('div'); actions.className = 'profile-editor-footer-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소';
  cancel.addEventListener('click', () => dialog.close());
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary competition-history-save';
  save.textContent = existingEntry ? '변경 저장' : '대회 이력 추가';
  actions.append(cancel, save); footer.append(hint, actions);
  form.append(heading, fields, note, status, footer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || save.disabled) return;
    const entry = {
      id: existingEntry?.id || createCompetitionHistoryId(),
      eventName: eventName.querySelector('input').value.trim(),
      date: date.querySelector('input').value,
      category: category.querySelector('input').value.trim(),
      result: result.querySelector('input').value.trim(),
      description: description.querySelector('textarea').value.trim(),
      link: link.querySelector('input').value.trim(),
    };
    const currentEntries = Array.isArray(page.profile?.competitionHistory) ? page.profile.competitionHistory : [];
    const nextEntries = existingEntry
      ? currentEntries.map((candidate) => candidate.id === existingEntry.id ? entry : candidate)
      : [entry, ...currentEntries];
    save.disabled = true; save.textContent = '저장 중…'; save.setAttribute('aria-busy', 'true');
    status.textContent = ''; status.classList.remove('is-error');
    try {
      await saveCompetitionHistory(page, nextEntries);
      dialog.close();
    } catch (error) {
      status.textContent = error.message || '대회 이력을 저장하지 못했어요.';
      status.classList.add('is-error');
    } finally {
      if (save.isConnected) {
        save.disabled = false; save.removeAttribute('aria-busy');
        save.textContent = existingEntry ? '변경 저장' : '대회 이력 추가';
      }
    }
  });
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  showFanPageModal(dialog);
  if (!isTouchLayout) eventName.querySelector('input').focus();
}

async function saveCompetitionHistory(page, entries, successMessage = '대회 이력을 저장했어요.') {
  const result = await callSave({
    streamerId: page.streamer.id,
    profile: profileForLinkSave(page.profile, 'competitionHistory', entries),
  });
  const isCurrentPage = currentPage?.streamer.id === page.streamer.id;
  if (isCurrentPage) {
    currentPage.profile = result.data.page.profile;
    renderFanPage(currentPage);
  } else {
    page.profile = result.data.page.profile;
  }
  showToast(successMessage);
}

function renderAffiliatePromoCard() {
  const productUrl = 'https://bitl.bz/4aO8WU';
  const imageUrl = 'https://sitem.ssgcdn.com/49/33/50/item/1000815503349_i1_1200.jpg';
  const card = document.createElement('article');
  card.className = 'affiliate-promo-card';
  card.setAttribute('aria-label', '먼작귀 목쿠션 제휴 상품');

  const adLabel = document.createElement('p');
  adLabel.className = 'affiliate-promo-ad-label';
  adLabel.textContent = '광고 · 제휴';

  const layout = document.createElement('div');
  layout.className = 'affiliate-promo-layout';

  const imageLink = document.createElement('a');
  imageLink.className = 'affiliate-promo-image-link';
  imageLink.href = productUrl;
  imageLink.target = '_blank';
  imageLink.rel = 'noopener noreferrer';
  imageLink.setAttribute('aria-label', '먼작귀 목쿠션 상품 페이지를 새 탭에서 열기');
  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = '먼작귀 목쿠션 상품';
  image.loading = 'lazy';
  image.decoding = 'async';
  imageLink.append(image);

  const details = document.createElement('div');
  details.className = 'affiliate-promo-details';
  const brand = document.createElement('p');
  brand.className = 'affiliate-promo-brand';
  brand.textContent = 'CHIikAWA PICK';
  const title = document.createElement('h3');
  title.className = 'affiliate-promo-title';
  title.textContent = '먼작귀 목쿠션';
  const description = document.createElement('p');
  description.className = 'affiliate-promo-description';
  description.textContent = '상품 상세 정보와 판매 옵션은 상품 페이지에서 확인해 보세요.';
  const button = document.createElement('a');
  button.className = 'affiliate-promo-button';
  button.href = productUrl;
  button.target = '_blank';
  button.rel = 'noopener noreferrer';
  button.textContent = '상품 보러가기 ↗';
  details.append(brand, title, description, button);
  layout.append(imageLink, details);

  const disclosure = document.createElement('p');
  disclosure.className = 'affiliate-promo-disclosure';
  disclosure.textContent = '이 링크를 통해 구매하면 팬페이지 운영자가 수수료를 받을 수 있습니다.';
  card.append(adLabel, layout, disclosure);
  return card;
}

const TAMAGOTCHI_INTERACTIONS = [
  ['pet', '쓰다듬기', '캐릭터를 누르거나 쓰다듬으면 표정·반응이 바뀌어요.'],
  ['feed', '먹이 주기', '간식이나 음식을 주고 캐릭터의 반응을 볼 수 있어요.'],
  ['play', '놀아주기', '간단한 놀이를 함께하고 친밀도를 쌓아요.'],
  ['talk', '인사와 대화', '인사하거나 말을 걸면 짧은 대사로 답해요.'],
  ['live', '방송 반응', '방송 시작·종료나 방송 상태에 맞춰 반응해요.'],
  ['idle', '휴식과 수면', '잠시 자리를 비우거나 쉬는 모습을 보여줘요.'],
  ['sound', '소리 효과', '상호작용에 맞는 짧은 효과음을 재생해요.'],
];

function tamagotchiApplicationStateFor(streamerId) {
  const key = String(streamerId || '').trim().toLowerCase();
  let state = tamagotchiApplicationStates.get(key);
  if (!state) {
    state = { loaded: false, loading: false, saving: false, formOpen: false, application: null, profile: null, error: '' };
    tamagotchiApplicationStates.set(key, state);
  }
  return state;
}

function renderTamagotchiApplicationForm(page, state, onChange) {
  const form = document.createElement('form');
  form.className = 'tamagotchi-application-form';
  const heading = document.createElement('h3');
  heading.textContent = state.application ? '신청 내용 수정' : '다마고치 디자인 신청';
  const intro = document.createElement('p');
  intro.className = 'tamagotchi-form-intro';
  intro.textContent = '신청 방식을 선택해 주세요. 신청 내용은 관리자 검토를 위해 서버에 저장됩니다.';

  const requestModeFieldset = document.createElement('fieldset');
  requestModeFieldset.className = 'tamagotchi-request-modes';
  const requestModeLegend = document.createElement('legend'); requestModeLegend.textContent = '신청 방식';
  const requestModeOptions = document.createElement('div'); requestModeOptions.className = 'tamagotchi-request-mode-options';
  const delegatedModeNote = document.createElement('p'); delegatedModeNote.className = 'tamagotchi-delegated-note';
  delegatedModeNote.textContent = '디자인과 상호작용을 모두 개발자가 정해요. 추가 입력 없이 이 선택만으로 신청할 수 있어요.';
  const initialRequestMode = state.application?.requestMode === 'delegate' ? 'delegate' : 'custom';
  const requestModeInputs = [];
  [
    ['custom', '기존 신청양식', '캐릭터 이름, 디자인, 상호작용을 직접 정해요.'],
    ['delegate', '그냥 알아서 만들어 주세요.', '디자인과 상호작용 모두 개발자에게 맡겨요.'],
  ].forEach(([value, titleText, descriptionText]) => {
    const option = document.createElement('label'); option.className = 'tamagotchi-request-mode-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'requestMode'; input.value = value;
    input.checked = initialRequestMode === value;
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = titleText;
    const description = document.createElement('small'); description.textContent = descriptionText;
    copy.append(title, description); option.append(input, copy); requestModeOptions.append(option);
    requestModeInputs.push(input);
  });
  requestModeFieldset.append(requestModeLegend, requestModeOptions);

  const characterLabel = document.createElement('label');
  characterLabel.className = 'tamagotchi-field';
  characterLabel.textContent = '캐릭터 이름';
  const characterInput = document.createElement('input');
  characterInput.name = 'characterName'; characterInput.type = 'text'; characterInput.required = true;
  characterInput.maxLength = 24; characterInput.minLength = 2; characterInput.autocomplete = 'off';
  characterInput.placeholder = '예: 유하띠의 작은 구름 친구';
  characterInput.value = state.application?.characterName || '';
  characterLabel.append(characterInput);

  const designLabel = document.createElement('label');
  designLabel.className = 'tamagotchi-field';
  designLabel.textContent = '원하는 디자인';
  const designInput = document.createElement('textarea');
  designInput.name = 'visualConcept'; designInput.required = true; designInput.minLength = 10;
  designInput.maxLength = 800; designInput.rows = 4;
  designInput.placeholder = '외형, 성격, 의상, 표정, 색상처럼 캐릭터를 만들 때 필요한 특징을 적어 주세요.';
  designInput.value = state.application?.visualConcept || '';
  designLabel.append(designInput);

  const customDesignFields = document.createElement('div');
  customDesignFields.className = 'tamagotchi-custom-design-fields';
  customDesignFields.append(characterLabel, designLabel);

  const interactions = document.createElement('fieldset');
  interactions.className = 'tamagotchi-interactions';
  const legend = document.createElement('legend'); legend.textContent = '원하는 상호작용 (하나 이상 선택)';
  const interactionGrid = document.createElement('div'); interactionGrid.className = 'tamagotchi-interaction-options';
  const selectedInteractions = new Set(Array.isArray(state.application?.interactionPreferences) ? state.application.interactionPreferences : []);
  TAMAGOTCHI_INTERACTIONS.forEach(([key, label, description]) => {
    const option = document.createElement('label'); option.className = 'tamagotchi-interaction-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'interactionPreferences'; checkbox.value = key;
    checkbox.checked = selectedInteractions.has(key);
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = label;
    const detail = document.createElement('small'); detail.textContent = description;
    copy.append(title, detail); option.append(checkbox, copy); interactionGrid.append(option);
  });
  interactions.append(legend, interactionGrid);
  customDesignFields.append(interactions);

  const referenceLabel = document.createElement('label');
  referenceLabel.className = 'tamagotchi-field';
  referenceLabel.textContent = '참고 이미지 링크 (선택)';
  const referenceInput = document.createElement('input');
  referenceInput.name = 'referenceImageUrl'; referenceInput.type = 'url'; referenceInput.maxLength = 500;
  referenceInput.placeholder = 'https://'; referenceInput.value = state.application?.referenceImageUrl || '';
  referenceLabel.append(referenceInput);

  const notesLabel = document.createElement('label');
  notesLabel.className = 'tamagotchi-field';
  const notesTitle = document.createElement('span'); notesTitle.textContent = '추가 요청 (선택)';
  const notesInput = document.createElement('textarea');
  notesInput.name = 'notes'; notesInput.maxLength = 1000; notesInput.rows = 3;
  notesInput.placeholder = '움직임이나 대사 등 더 전달하고 싶은 내용을 적어 주세요.';
  notesInput.value = state.application?.notes || '';
  notesLabel.append(notesTitle, notesInput);
  customDesignFields.append(referenceLabel, notesLabel);

  const syncRequestMode = () => {
    const mode = requestModeInputs.find((input) => input.checked)?.value || 'custom';
    const isCustom = mode === 'custom';
    customDesignFields.hidden = !isCustom;
    delegatedModeNote.hidden = isCustom;
    characterInput.required = isCustom;
    designInput.required = isCustom;
    requestModeInputs.forEach((input) => input.closest('.tamagotchi-request-mode-option')?.classList.toggle('is-selected', input.checked));
  };
  requestModeInputs.forEach((input) => input.addEventListener('change', syncRequestMode));
  syncRequestMode();

  const status = document.createElement('p'); status.className = 'tamagotchi-form-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'tamagotchi-form-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '닫기';
  cancel.addEventListener('click', () => { state.formOpen = false; onChange(); });
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button button-primary';
  submit.textContent = state.application ? '수정해 재신청' : '신청서 보내기';
  actions.append(cancel, submit);
  form.append(heading, intro, requestModeFieldset, delegatedModeNote, customDesignFields, status, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || state.saving) return;
    const requestMode = requestModeInputs.find((input) => input.checked)?.value || 'custom';
    const interactionPreferences = requestMode === 'custom'
      ? [...form.querySelectorAll('input[name="interactionPreferences"]:checked')].map((input) => input.value)
      : [];
    if (requestMode === 'custom' && !interactionPreferences.length) {
      status.textContent = '상호작용을 하나 이상 선택해 주세요.';
      status.classList.add('is-error');
      return;
    }
    state.saving = true; submit.disabled = true; submit.textContent = '신청서를 저장하고 있어요…';
    status.classList.remove('is-error'); status.textContent = '신청서를 안전하게 저장하고 있어요.';
    try {
      await callTamagotchiApplications({
        action: 'submit',
        streamerId: page.streamer.id,
        application: {
          requestMode,
          characterName: requestMode === 'custom' ? characterInput.value.trim() : '',
          visualConcept: requestMode === 'custom' ? designInput.value.trim() : '',
          interactionPreferences,
          referenceImageUrl: requestMode === 'custom' ? referenceInput.value.trim() : '',
          notes: requestMode === 'custom' ? notesInput.value.trim() : '',
        },
      });
      state.saving = false;
      state.formOpen = false;
      await loadTamagotchiApplication(page, page._tamagotchiSection, true);
      showToast('다마고치 신청서를 접수했어요.');
    } catch (error) {
      state.saving = false;
      status.textContent = error.message || '신청서를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
      status.classList.add('is-error');
      submit.disabled = false; submit.textContent = state.application ? '수정해 재신청' : '신청서 보내기';
    }
  });
  return form;
}

function renderTamagotchiApplication(page, section) {
  const state = tamagotchiApplicationStateFor(page.streamer.id);
  const content = section.querySelector('.tamagotchi-section-content');
  content.replaceChildren();
  const rerender = () => renderTamagotchiApplication(page, section);
  if (state.loading || !state.loaded) {
    const message = document.createElement('p'); message.className = 'tamagotchi-state-message';
    message.textContent = '다마고치 신청 상태를 확인하고 있어요.'; content.append(message); return;
  }
  if (state.error) {
    const message = document.createElement('p'); message.className = 'tamagotchi-state-message is-error'; message.textContent = state.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button'; retry.textContent = '다시 불러오기';
    retry.addEventListener('click', () => loadTamagotchiApplication(page, section, true));
    content.append(message, retry); return;
  }

  const profile = state.profile;
  const application = state.application;
  const isOwner = page.isStreamerOwner === true;
  if (profile) {
    const approved = document.createElement('article'); approved.className = 'tamagotchi-approved-card';
    const symbol = document.createElement('span'); symbol.className = 'tamagotchi-placeholder-symbol'; symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = '✦';
    const title = document.createElement('h3'); title.textContent = profile.characterName || '다마고치 디자인';
    const status = document.createElement('p'); status.className = 'tamagotchi-approved-status'; status.textContent = '디자인 신청이 승인되었어요 · 캐릭터를 준비하고 있어요.';
    const description = document.createElement('p'); description.className = 'tamagotchi-approved-description'; description.textContent = profile.visualConcept || '';
    const interactions = document.createElement('div'); interactions.className = 'tamagotchi-tag-list';
    (Array.isArray(profile.interactionPreferences) ? profile.interactionPreferences : []).forEach((key) => {
      const match = TAMAGOTCHI_INTERACTIONS.find(([interactionKey]) => interactionKey === key);
      if (!match) return;
      const tag = document.createElement('span'); tag.textContent = match[1]; interactions.append(tag);
    });
    approved.append(symbol, status, title, description, interactions); content.append(approved);
    return;
  } else if (!isOwner) {
    const empty = document.createElement('div'); empty.className = 'tamagotchi-empty-state';
    const symbol = document.createElement('span'); symbol.className = 'tamagotchi-placeholder-symbol'; symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = '✦';
    const message = document.createElement('p'); message.textContent = '아직 다마고치가 없어요. 스트리머가 디자인과 상호작용을 신청하면 이곳에서 만날 수 있어요.';
    empty.append(symbol, message); content.append(empty); return;
  }

  if (application?.status === 'pending') {
    const status = document.createElement('div'); status.className = 'tamagotchi-application-status is-pending';
    const title = document.createElement('strong'); title.textContent = '신청서를 검토하고 있어요';
    const requestModeLabel = application.requestMode === 'delegate' ? '개발자 자율 제작' : '기존 신청양식';
    const detail = document.createElement('span'); detail.textContent = `${requestModeLabel} · 신청 캐릭터: ${application.characterName || '이름 미정'} · ${formatCommentDate(application.createdAt)}`;
    status.append(title, detail); content.append(status); return;
  }
  if (application?.status === 'rejected') {
    const status = document.createElement('div'); status.className = 'tamagotchi-application-status is-rejected';
    const title = document.createElement('strong'); title.textContent = '신청 내용을 조금 더 다듬어 주세요';
    const detail = document.createElement('span'); detail.textContent = application.reviewNote || '관리자가 검토한 뒤 재신청을 요청했어요.';
    status.append(title, detail); content.append(status);
  }
  if (state.formOpen) {
    content.append(renderTamagotchiApplicationForm(page, state, rerender));
    return;
  }
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'button button-primary tamagotchi-apply-button';
  apply.textContent = application?.status === 'rejected' ? '신청 내용 수정하기' : '내 다마고치 디자인 신청';
  apply.addEventListener('click', () => { state.formOpen = true; rerender(); }); content.append(apply);
}

async function loadTamagotchiApplication(page, section, force = false) {
  if (!page || !section) return;
  const state = tamagotchiApplicationStateFor(page.streamer.id);
  if (state.loading || (state.loaded && !force)) return;
  state.loading = true; state.error = '';
  renderTamagotchiApplication(page, section);
  try {
    const result = await callTamagotchiApplications({ action: 'status', streamerId: page.streamer.id });
    if (currentPage?.streamer.id !== page.streamer.id) return;
    state.application = result.data?.application || null;
    state.profile = result.data?.profile || null;
    state.loaded = true;
  } catch (error) {
    state.error = error.message || '다마고치 정보를 불러오지 못했어요.';
  } finally {
    state.loading = false;
    if (currentPage?.streamer.id === page.streamer.id) renderTamagotchiApplication(page, section);
  }
}

function renderTamagotchiSection(page) {
  const section = document.createElement('section'); section.className = 'tamagotchi-section content-card';
  section.id = 'tamagotchiSection';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'STREAMER TAMAGOTCHI';
  const title = document.createElement('h2'); title.textContent = '다마고치';
  const description = document.createElement('p'); description.className = 'tamagotchi-section-description';
  description.textContent = '스트리머마다 다른 모습과 상호작용을 가진 다마고치를 준비하고 있어요.';
  const content = document.createElement('div'); content.className = 'tamagotchi-section-content';
  section.append(eyebrow, title, description, content);
  page._tamagotchiSection = section;
  renderTamagotchiApplication(page, section);
  return section;
}

function renderFanPage(page, options = {}) {
  if (liveStatusTimer) window.clearInterval(liveStatusTimer);
  liveStatusTimer = 0;
  if (fanPageQuickNavCleanup) {
    fanPageQuickNavCleanup();
    fanPageQuickNavCleanup = null;
  }
  if (stockPriceUnsubscribe) {
    stockPriceUnsubscribe();
    stockPriceUnsubscribe = null;
  }
  $('calendarSection')?._cleanupWeeklyScheduleViewport?.();
  stockPriceSparklineRequest += 1;
  currentPage = page;
  publishFanpageEmoteContext(page);
  const view = $('fanPageView');
  const streamerIdForTabs = String(page.streamer.id || '').trim().toLowerCase();
  const previousTabStreamerId = view.dataset.fanpageTabStreamerId || '';
  const preferredTab = previousTabStreamerId === streamerIdForTabs ? view.dataset.fanpageActiveTab : 'home';
  view.dataset.fanpageTabStreamerId = streamerIdForTabs;
  view.classList.remove('has-top-banner', 'has-bottom-banner', 'fanpage-layout-1', 'fanpage-layout-2');
  view.classList.remove('has-account-top-banner');
  document.querySelector('.topbar').classList.remove('topbar-with-banner', 'topbar-account-banner-hidden');
  $('siteShell').classList.remove('has-bottom-banner');
  document.body.classList.remove('fanpage-bottom-banner-active');
  const layoutDesign = page.profile?.layoutDesign === 2 ? 2 : DEFAULT_FANPAGE_LAYOUT;
  const usesKawaiiLayout = layoutDesign === 1;
  $('mainContent').classList.toggle('has-fanpage-layout-one', usesKawaiiLayout);
  $('mainContent').classList.remove('has-fanpage-home-kawaii');
  document.body.classList.toggle('fanpage-layout-one-active', usesKawaiiLayout);
  document.body.classList.toggle('fanpage-theme-sora-active', String(page.streamer.id || '').toLowerCase() === 'yuhatty');
  document.body.classList.remove('fanpage-home-kawaii-active');
  view.classList.add(`fanpage-layout-${layoutDesign}`);
  view.classList.toggle('fanpage-theme-sora', String(page.streamer.id || '').toLowerCase() === 'yuhatty');
  view.replaceChildren();
  const back = document.createElement('a');
  back.href = '#/';
  back.className = 'back-link';
  back.innerHTML = '<span aria-hidden="true">←</span> 스트리머 검색으로';
  const profile = page.profile || {};
  const section = document.createElement('section');
  section.className = 'profile-board';
  section.id = 'profileBoard';
  const label = document.createElement('div');
  label.className = 'profile-tab';
  label.textContent = 'PROFILE';
  const identity = document.createElement('div');
  identity.className = 'profile-identity';
  const avatar = document.createElement('img');
  avatar.className = 'profile-avatar';
  setImage(avatar, page.streamer.avatarUrl, page.streamer.nickname);
  avatar.loading = 'eager';
  avatar.fetchPriority = 'high';
  const identityCopy = document.createElement('div');
  const name = document.createElement('h1');
  name.className = 'profile-name';
  name.textContent = page.streamer.nickname;
  const handle = document.createElement('p');
  handle.className = 'profile-handle';
  handle.textContent = `@${page.streamer.soopId}`;
  const verified = document.createElement('span');
  verified.className = 'verified-tag';
  verified.textContent = '✓ 인증 스트리머';
  identityCopy.append(name, handle, verified);
  identity.append(avatar, identityCopy);

  const facts = document.createElement('div');
  facts.className = 'profile-facts';
  const factRows = [
    ['birthday', '생일', profile.birthday], ['mbti', 'MBTI', profile.mbti],
    ['major', '전공', profile.major], ['debutDate', '데뷔', profile.debutDate],
  ];
  factRows.forEach(([field, labelText, value]) => {
    const row = document.createElement(page.isOwner ? 'button' : 'div'); row.className = 'profile-fact';
    const term = document.createElement('span'); term.textContent = labelText;
    const description = document.createElement('strong'); description.className = 'profile-field-value'; description.textContent = value || '미등록';
    row.append(term, description); attachProfileQuickEdit(row, page, field); facts.append(row);
  });

  let about = null;
  if (page.intro || page.isOwner) {
    about = document.createElement(page.isOwner ? 'button' : 'div'); about.className = 'profile-about';
    const aboutLabel = document.createElement('strong'); aboutLabel.textContent = 'ABOUT';
    const aboutText = document.createElement('span'); aboutText.className = 'profile-field-value'; aboutText.textContent = page.intro || '소개 문구를 추가해 보세요.';
    about.append(aboutLabel, aboutText);
    attachProfileQuickEdit(about, page, 'intro');
  }

  const details = document.createElement('div'); details.className = 'profile-details';
  const detailRows = [
    ['fanNickname', '팬닉', profile.fanNickname], ['fandomName', '팬덤명', profile.fandomName],
    ['contents', '콘텐츠', Array.isArray(profile.contents) ? profile.contents.join(' · ') : ''], ['scheduleText', '방송 시간', profile.scheduleText],
  ];
  detailRows.forEach(([field, labelText, value]) => {
    const item = document.createElement(page.isOwner ? 'button' : 'div'); item.className = 'profile-detail';
    const term = document.createElement('span'); term.className = 'profile-detail-label'; term.textContent = labelText;
    const description = document.createElement('span'); description.className = 'profile-detail-value profile-field-value'; description.textContent = value || '미등록';
    item.append(term, description); attachProfileQuickEdit(item, page, field); details.append(item);
  });
  const stockCard = renderStreamerStockPrice(page);

  const actions = document.createElement('div'); actions.className = 'profile-actions';
  actions.id = 'profileActions';
  const soop = document.createElement('a');
  soop.className = 'button'; soop.href = page.streamer.soopUrl; soop.target = '_blank';
  soop.rel = 'noopener noreferrer'; soop.textContent = 'SOOP 방송국 ↗';
  actions.append(soop);
  if (profile.rouletteUrl) {
    const roulette = document.createElement('a');
    roulette.id = 'profileRouletteLink';
    roulette.className = 'button button-primary'; roulette.href = profile.rouletteUrl;
    roulette.target = '_blank'; roulette.rel = 'noopener noreferrer'; roulette.textContent = '룰렛 확률 ↗';
    actions.append(roulette);
  }
  if (page.isOwner) {
    const edit = document.createElement('button'); edit.id = 'profileSettingsButton'; edit.type = 'button'; edit.className = 'button'; edit.textContent = '⚙ 설정';
    edit.addEventListener('click', () => showFanPageModal($('profileSettingsDialog')));
    actions.append(edit);
  }
  section.append(label, identity, facts);
  if (about) section.append(about);
  section.append(details, stockCard, actions);
  const topBanner = renderBannerSection(page, 'top');
  if (topBanner) {
    const topbar = document.querySelector('.topbar');
    topbar.classList.add('topbar-with-banner');
    view.classList.add('has-top-banner');
    if (page.isStreamerOwner || hasRecognizedFanpageAccount() || auth.currentUser?.isAnonymous) {
      topbar.classList.add('topbar-account-banner-hidden');
      view.classList.add('has-account-top-banner');
    }
    view.append(topBanner);
  }
  if (!page.isOwner) view.append(back);
  function navigateToFanPageSection(sectionId) {
    const target = document.getElementById(sectionId);
    const tabPanel = target?.closest('.fanpage-tab-panel');
    if (tabPanel && tabPanel.hidden) view._selectFanPageTab?.(tabPanel.dataset.fanpageTabPanel);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  if (layoutDesign === 1) view.append(renderKawaiiWelcome(page, navigateToFanPageSection));
  view.append(section);
  let fanCharacterCard = null;
  if (String(page.streamer.id || '').toLowerCase() === 'yuhatty') {
    const character = document.createElement('section');
    character.className = 'fan-character-card';
    character.setAttribute('aria-label', '유하띠 팬 캐릭터');
    const characterCopy = document.createElement('div');
    characterCopy.className = 'fan-character-copy';
    const characterEyebrow = document.createElement('p');
    characterEyebrow.className = 'eyebrow';
    characterEyebrow.textContent = 'YUHATTI FAN CHARACTER';
    const characterTitle = document.createElement('h2');
    characterTitle.textContent = '유하띠 팬 캐릭터';
    characterCopy.append(characterEyebrow, characterTitle);
    const characterImage = document.createElement('img');
    characterImage.className = 'fan-character-image';
    characterImage.src = 'https://stimg.sooplive.com/NORMAL_BBS/9/24898419/45496758cfde40ffd.gif';
    characterImage.alt = '유하띠 팬 캐릭터';
    characterImage.loading = 'lazy';
    characterImage.decoding = 'async';
    character.append(characterCopy, characterImage);
    fanCharacterCard = character;
  }
  let featuredPair = null;
  if (fanCharacterCard) {
    featuredPair = document.createElement('div');
    featuredPair.className = 'fan-character-ogq-pair';
    featuredPair.append(fanCharacterCard, renderOgqSection(page, true));
  }
  const upboSection = renderUpboSection(page);
  const rouletteSection = renderRouletteSection(page);
  const messengerSection = renderMessengerSection(page);
  const liveSection = renderLiveSection(page);
  const vodSection = renderVodSection(page);
  const youtubeSection = renderYouTubeSection(page);
  const songbookSection = renderSongbookSection(page);
  const playedGamesSection = renderPlayedGamesSection(page);
  const ogqSection = fanCharacterCard ? null : renderOgqSection(page);
  const cafeSection = renderCafeSection(page);
  const calendarSection = renderCalendarSection(page);
  const gallerySection = renderGallerySection(page);
  const rollingPaperSection = renderRollingPaperSection(page);
  const memoriesSection = renderMemoriesSection(page);
  const competitionHistorySection = renderCompetitionHistorySection(page);
  const tamagotchiSection = renderTamagotchiSection(page);
  const videoLibrarySection = renderVideoLibrarySection(page);
  const tabDefinitions = [
    { key: 'home', label: '홈', eyebrow: 'YOUR HOME', title: '방송과 최신 소식', description: '방송 상태와 일정, 최근 다시보기를 모아 보여드려요.' },
    { key: 'activity', label: '팬 활동', eyebrow: 'FAN ACTIVITY', title: '팬들과 함께하는 공간', description: '팬 참여와 소통, 함께 만든 추억을 둘러보세요.' },
    { key: 'content', label: '콘텐츠', eyebrow: 'STREAMER CONTENTS', title: '다시보기와 활동 기록', description: '영상, 대회 이력, 플레이한 게임을 모아봤어요.' },
    { key: 'video-library', label: '즐겨찾기', eyebrow: 'FAVORITES', title: '즐겨찾기', description: '스트리머가 라이브에서 자주 시청하는 영상을 모았습니다.' },
    { key: 'rolling-paper', label: '롤링페이퍼', eyebrow: 'ROLLING PAPER', title: '주제별 롤링페이퍼', description: '기념일과 특별한 순간마다 응원 메시지를 남겨 보세요.' },
    { key: 'memories', label: '기억의 순간', eyebrow: 'MEMORY MOMENTS', title: '기억의 순간', description: '100일·200일 방송처럼 오래 간직하고 싶은 기념 다시보기를 모아봤어요.' },
    { key: 'tamagotchi', label: '다마고치', eyebrow: 'STREAMER TAMAGOTCHI', title: '다마고치', description: '스트리머의 개성을 담은 캐릭터와 원하는 상호작용을 신청해 보세요.' },
  ];
  const tabNav = document.createElement('div');
  tabNav.className = 'fanpage-tab-nav';
  tabNav.id = 'fanpageTabNav';
  tabNav.setAttribute('role', 'tablist');
  tabNav.setAttribute('aria-label', `${page.streamer.nickname} 팬페이지 메뉴`);
  const tabButtons = new Map();
  tabDefinitions.forEach((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fanpage-tab-button';
    button.id = `fanpageTab-${tab.key}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `fanpagePanel-${tab.key}`);
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.textContent = tab.label;
    button.addEventListener('click', () => selectFanPageTab(tab.key));
    button.addEventListener('keydown', (event) => {
      const currentIndex = tabDefinitions.findIndex((item) => item.key === tab.key);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabDefinitions.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex + tabDefinitions.length - 1) % tabDefinitions.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabDefinitions.length - 1;
      else return;
      event.preventDefault();
      selectFanPageTab(tabDefinitions[nextIndex].key, true);
    });
    tabButtons.set(tab.key, button);
    tabNav.append(button);
  });
  function createFanPageColumnStacks(className, leftSections, rightSections) {
    const columns = document.createElement('div');
    columns.className = `fanpage-tab-columns ${className}`;
    [leftSections, rightSections].forEach((sections, index) => {
      const column = document.createElement('div');
      column.className = `fanpage-tab-column fanpage-tab-column-${index + 1}`;
      sections.filter(Boolean).forEach((sectionElement) => column.append(sectionElement));
      columns.append(column);
    });
    return columns;
  }
  function createFanPageTabPanel(tab, sections) {
    const panel = document.createElement('section');
    panel.className = 'fanpage-tab-panel';
    panel.id = `fanpagePanel-${tab.key}`;
    panel.dataset.fanpageTabPanel = tab.key;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `fanpageTab-${tab.key}`);
    panel.tabIndex = 0;
    const heading = document.createElement('header');
    heading.className = 'fanpage-tab-panel-heading';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = tab.eyebrow;
    const title = document.createElement('h2');
    title.textContent = tab.title;
    const description = document.createElement('p');
    description.textContent = tab.description;
    heading.append(eyebrow, title, description);
    const grid = document.createElement('div');
    grid.className = 'fanpage-tab-panel-grid';
    sections.filter(Boolean).forEach((sectionElement) => grid.append(sectionElement));
    panel.append(heading, grid);
    return panel;
  }
  const homePanel = createFanPageTabPanel(tabDefinitions[0], layoutDesign === 1 ? [] : [liveSection, calendarSection, vodSection]);
  if (layoutDesign === 1) {
    const homeColumns = document.createElement('div');
    homeColumns.className = 'fanpage-home-columns';
    const mainColumn = document.createElement('div');
    mainColumn.className = 'fanpage-home-main-column';
    const sideColumn = document.createElement('div');
    sideColumn.className = 'fanpage-home-side-column';
    mainColumn.append(liveSection, vodSection);
    sideColumn.append(calendarSection, renderAffiliatePromoCard());
    homeColumns.append(mainColumn, sideColumn);
    homePanel.querySelector('.fanpage-tab-panel-grid').append(homeColumns);
  }
  const tabPanels = new Map([
    ['home', homePanel],
    ['activity', createFanPageTabPanel(tabDefinitions[1], layoutDesign === 1
      ? [featuredPair, createFanPageColumnStacks('fanpage-activity-columns', [upboSection, messengerSection], [rouletteSection]), gallerySection, fanCharacterCard ? null : ogqSection]
      : [featuredPair, upboSection, rouletteSection, messengerSection, gallerySection, fanCharacterCard ? null : ogqSection])],
    ['content', createFanPageTabPanel(tabDefinitions[2], layoutDesign === 1
      ? [
        createFanPageColumnStacks('fanpage-content-columns fanpage-content-overview-columns', [youtubeSection], [songbookSection, cafeSection]),
        createFanPageColumnStacks('fanpage-content-columns fanpage-game-history-columns', [playedGamesSection], [competitionHistorySection]),
      ]
      : [youtubeSection, songbookSection, playedGamesSection, cafeSection, competitionHistorySection])],
    ['video-library', createFanPageTabPanel(tabDefinitions[3], [videoLibrarySection])],
    ['rolling-paper', createFanPageTabPanel(tabDefinitions[4], [rollingPaperSection])],
    ['memories', createFanPageTabPanel(tabDefinitions[5], [memoriesSection])],
    ['tamagotchi', createFanPageTabPanel(tabDefinitions[6], [tamagotchiSection])],
  ]);
  function selectFanPageTab(tabKey, moveFocus = false) {
    if (!tabPanels.has(tabKey)) return;
    const previousTabKey = view.dataset.fanpageActiveTab;
    if (tabKey === 'rolling-paper' && previousTabKey !== 'rolling-paper') {
      const rollingPaperState = rollingPaperStateFor(page.streamer.id);
      rollingPaperState.activeTopicId = '';
      refreshRollingPaperSection(page.streamer.id);
    }
    view.dataset.fanpageActiveTab = tabKey;
    if (tabKey !== 'rolling-paper') {
      const stickerState = rollingPaperStateFor(page.streamer.id);
      stickerState.stickerActionMenuOpen = false; stickerState.selectedStickerMenuId = '';
      stickerState.stickerPaletteOpen = false; stickerState.stickerPlacing = false;
      stickerState.selectedStickerEmoji = '';
      if (stickerState.movingStickerId && !stickerState.savingSticker) {
        const original = stickerState.stickerMoveOriginal;
        const sticker = stickerState.stickers.find((item) => item.id === stickerState.movingStickerId);
        if (original && sticker && original.id === sticker.id) { sticker.x = original.x; sticker.y = original.y; }
        stickerState.stickerMoveOriginal = null; stickerState.movingStickerId = ''; stickerState.draggingStickerId = '';
      }
    }
    tabDefinitions.forEach((tab) => {
      const selected = tab.key === tabKey;
      const button = tabButtons.get(tab.key);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      tabPanels.get(tab.key).hidden = !selected;
    });
    view._syncRollingPaperStickerQuickTools?.();
    if (tabKey === 'activity') {
      gallerySection.loadGallery?.();
      const upboState = upboStateFor(page.streamer.id);
      if (!upboState.boardLoaded || upboState.error) loadUpboBoard(page.streamer.id);
    }
    if (tabKey === 'content') loadFanPageContent(page);
    if (tabKey === 'video-library') {
      const videoLibraryState = videoLibraryStateFor(page.streamer.id);
      if (!videoLibraryState.loaded || videoLibraryState.error || videoLibraryState.isSyncing) {
        void loadVideoLibrary(page, { refresh: videoLibraryState.loaded && videoLibraryState.isSyncing });
      }
    }
    if (tabKey === 'rolling-paper') {
      const rollingPaperState = rollingPaperStateFor(page.streamer.id);
      if (!rollingPaperState.topicsLoaded || rollingPaperState.topicError) {
        void loadRollingPaperTopics(page);
      }
    }
    if (tabKey === 'memories') loadFanPageMemories(page);
    if (tabKey === 'tamagotchi') loadTamagotchiApplication(page, tamagotchiSection);
    if (moveFocus) tabButtons.get(tabKey)?.focus();
  }
  view._selectFanPageTab = selectFanPageTab;
  view.append(tabNav, ...tabPanels.values());
  selectFanPageTab(tabPanels.has(preferredTab) ? preferredTab : 'home');
  const bottomBanner = renderBannerSection(page, 'bottom');
  if (bottomBanner) {
    view.classList.add('has-bottom-banner');
    $('siteShell').classList.add('has-bottom-banner');
    document.body.classList.add('fanpage-bottom-banner-active');
    view.append(bottomBanner);
  }
  if (page.isOwner || isAdminUser) view.append(renderWeeklyScheduleDialog(page));
  view.append(renderVodPlayerDialog());
  if (youtubeSection) view.append(renderYouTubePlayerDialog());
  fanPageQuickNavCleanup = createFanPageQuickRemote(view);
  loadLiveStatus(page.streamer.id);
  liveStatusTimer = window.setInterval(() => loadLiveStatus(page.streamer.id), 60 * 1000);

  if (page.isOwner && options.preservedSettingsDialog) {
    view.append(options.preservedSettingsDialog);
    if (options.reopenSettingsDialog) options.preservedSettingsDialog.showModal();
  } else if (page.isOwner) {
    const editorDialog = document.createElement('dialog');
    editorDialog.id = 'profileSettingsDialog'; editorDialog.className = 'account-dialog profile-settings-dialog';
    const committedLayoutDesign = layoutDesign;
    let layoutPreviewChanged = false;
    let ignoredPreviewCloseEvents = 0;
    let profileSettingsSaved = false;
    editorDialog.addEventListener('close', () => {
      if (ignoredPreviewCloseEvents > 0) {
        ignoredPreviewCloseEvents -= 1;
        return;
      }
      if (profileSettingsSaved || !layoutPreviewChanged) return;
      currentPage.profile = { ...(currentPage.profile || {}), layoutDesign: committedLayoutDesign };
      layoutPreviewChanged = false;
      renderFanPage(currentPage);
    });
    const editor = document.createElement('div'); editor.className = 'account-dialog-card profile-editor';
    const headingRow = document.createElement('div'); headingRow.className = 'profile-editor-heading';
    const heading = document.createElement('h2'); heading.textContent = '팬페이지 설정';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close'; close.setAttribute('aria-label', '설정 닫기'); close.textContent = '×';
    close.addEventListener('click', () => editorDialog.close());
    headingRow.append(heading, close); editor.append(headingRow);
    const layoutChoice = document.createElement('fieldset'); layoutChoice.className = 'profile-layout-choice';
    const layoutLegend = document.createElement('legend'); layoutLegend.textContent = '페이지 레이아웃';
    const layoutOptions = document.createElement('div'); layoutOptions.className = 'profile-layout-options';
    [
      [1, '디자인 1 · 파스텔 만화풍', '포근한 파스텔 컬러와 캐릭터가 있는 새 기본 디자인'],
      [2, '디자인 2 · 기존 팬페이지', '현재 사용하던 어두운 톤의 팬페이지 레이아웃'],
    ].forEach(([value, titleText, descriptionText]) => {
      const option = document.createElement('label'); option.className = 'profile-layout-option';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'layoutDesign'; radio.value = String(value);
      radio.checked = layoutDesign === value;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const selectedLayout = Number(radio.value);
        const activeLayout = currentPage.profile?.layoutDesign === 2 ? 2 : DEFAULT_FANPAGE_LAYOUT;
        if (selectedLayout === activeLayout) return;
        currentPage.profile = { ...(currentPage.profile || {}), layoutDesign: selectedLayout };
        layoutPreviewChanged = selectedLayout !== committedLayoutDesign;
        const dialogScrollTop = editorDialog.scrollTop;
        if (editorDialog.open) {
          ignoredPreviewCloseEvents += 1;
          editorDialog.close();
        }
        renderFanPage(currentPage, {
          preservedSettingsDialog: editorDialog,
          reopenSettingsDialog: true,
        });
        editorDialog.scrollTop = dialogScrollTop;
        radio.focus({ preventScroll: true });
      });
      const copy = document.createElement('span'); copy.className = 'profile-layout-option-copy';
      const optionTitle = document.createElement('strong'); optionTitle.textContent = titleText;
      const optionDescription = document.createElement('small'); optionDescription.textContent = descriptionText;
      copy.append(optionTitle, optionDescription); option.append(radio, copy); layoutOptions.append(option);
    });
    layoutChoice.append(layoutLegend, layoutOptions); editor.append(layoutChoice);
    const fields = [
      ['birthday', '생일', 20], ['mbti', 'MBTI', 8], ['major', '전공', 50], ['debutDate', '데뷔일', 20],
      ['fanNickname', '팬닉', 30], ['fandomName', '팬덤명', 30], ['contents', '콘텐츠 (쉼표로 구분)', 160],
      ['scheduleText', '방송 시간', 120], ['rouletteUrl', '룰렛 확률 링크', 300],
      ['youtubeChannelUrl', 'YouTube 채널 링크', 300],
      ['cafeUrl', '네이버 카페 주소', 300],
      ['ogqEmoticonUrl', 'OGQ 이모티콘 링크', 300],
    ];
    const inputMap = {};
    const bannerEditors = {};
    const grid = document.createElement('div'); grid.className = 'profile-editor-grid';
    fields.forEach(([key, labelText, maxLength]) => {
      const wrapper = document.createElement('label'); wrapper.className = 'profile-editor-field'; wrapper.textContent = labelText;
      const input = key === 'scheduleText' ? document.createElement('textarea') : document.createElement('input');
      input.name = key; input.maxLength = maxLength;
      if (key === 'rouletteUrl' || key === 'youtubeChannelUrl' || key === 'cafeUrl' || key === 'ogqEmoticonUrl') { input.type = 'url'; input.placeholder = 'https://'; }
      input.value = key === 'contents' ? (profile.contents || []).join(', ') : (profile[key] || '');
      wrapper.append(input);
      if (key === 'rouletteUrl') {
        const hint = document.createElement('small');
        hint.className = 'profile-editor-hint';
        hint.textContent = '위플랩 공개 룰렛 설정을 팬페이지 디자인으로 표시하고, 페이지 방문 시 최신 데이터를 불러옵니다.';
        wrapper.append(hint);
      }
      if (key === 'youtubeChannelUrl') {
        const hint = document.createElement('small');
        hint.className = 'profile-editor-hint';
        hint.textContent = 'https://www.youtube.com/@핸들 또는 /channel/채널ID 링크를 입력하면 최신 영상 영역이 표시됩니다.';
        wrapper.append(hint);
      }
      if (key === 'cafeUrl') {
        const hint = document.createElement('small');
        hint.className = 'profile-editor-hint';
        hint.textContent = '공개 글 6개의 제목·작성자·날짜·댓글 수만 표시하고, 글을 누르면 네이버 카페에서 열립니다.';
        wrapper.append(hint);
      }
      if (key === 'ogqEmoticonUrl') {
        const hint = document.createElement('small');
        hint.className = 'profile-editor-hint';
        hint.textContent = '공개 SOOP OGQ 이모티콘 상품 주소를 등록하면 대표 이미지 미리보기를 표시합니다.';
        wrapper.append(hint);
      }
      grid.append(wrapper); inputMap[key] = input;
    });
    bannerEditors.topBannerImageUrls = createBannerSettingsEditor(
      'topBannerImageUrls', '상단 배너 이미지', profile.topBannerImageUrls || [],
    );
    const bottomBannerLayoutField = document.createElement('label');
    bottomBannerLayoutField.className = 'profile-editor-field profile-editor-wide banner-settings-layout-field';
    bottomBannerLayoutField.textContent = '하단 배너 배치 방식';
    const bottomBannerLayout = document.createElement('select');
    bottomBannerLayout.name = 'bottomBannerLayout';
    [
      ['stacked', '기존 방식 · 이미지 세로 배치'],
      ['grid-2x3', '2×3 배치 · 2열 × 3행'],
    ].forEach(([value, labelText]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = labelText;
      bottomBannerLayout.append(option);
    });
    bottomBannerLayout.value = profile.bottomBannerLayout === 'grid-2x3' ? 'grid-2x3' : 'stacked';
    bottomBannerLayoutField.append(bottomBannerLayout);
    bannerEditors.bottomBannerImageUrls = createBannerSettingsEditor(
      'bottomBannerImageUrls', '하단 배너 이미지', profile.bottomBannerImageUrls || [], { layoutSelect: bottomBannerLayout },
    );
    grid.append(bannerEditors.topBannerImageUrls.element, bottomBannerLayoutField, bannerEditors.bottomBannerImageUrls.element);
    const introLabel = document.createElement('label'); introLabel.className = 'profile-editor-field profile-editor-wide'; introLabel.textContent = 'ABOUT 문구';
    const introInput = document.createElement('textarea'); introInput.name = 'intro'; introInput.maxLength = 700; introInput.value = page.intro || '';
    introLabel.append(introInput); grid.append(introLabel);
    const footer = document.createElement('div'); footer.className = 'edit-footer profile-editor-footer';
    const note = document.createElement('small'); note.textContent = '수정 내용은 서버에 저장됩니다.';
    const footerActions = document.createElement('div'); footerActions.className = 'profile-editor-footer-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소';
    cancel.addEventListener('click', () => editorDialog.close());
    const save = document.createElement('button'); save.type = 'button'; save.className = 'button button-primary profile-editor-save'; save.textContent = '프로필 저장';
    save.addEventListener('click', async () => {
      save.disabled = true;
      save.classList.add('is-loading');
      save.setAttribute('aria-busy', 'true');
      save.textContent = '저장 중…';
      try {
        const value = (key) => inputMap[key].value.trim();
        const readBannerUrls = (editor) => [...new Set(editor.values().map(normalizeBannerImageUrl).filter(Boolean))];
        const topBannerImageUrls = readBannerUrls(bannerEditors.topBannerImageUrls);
        const bottomBannerImageUrls = readBannerUrls(bannerEditors.bottomBannerImageUrls);
        const result = await callSave({
          streamerId: currentPage.streamer.id,
          intro: introInput.value,
          profile: {
            birthday: value('birthday'), mbti: value('mbti'), major: value('major'), debutDate: value('debutDate'),
            fanNickname: value('fanNickname'), fandomName: value('fandomName'),
            contents: value('contents').split(',').map((item) => item.trim()).filter(Boolean),
            scheduleText: value('scheduleText'), rouletteUrl: value('rouletteUrl'),
            youtubeChannelUrl: value('youtubeChannelUrl'), cafeUrl: value('cafeUrl'), ogqEmoticonUrl: value('ogqEmoticonUrl'),
            layoutDesign: Number(editor.querySelector('input[name="layoutDesign"]:checked')?.value || DEFAULT_FANPAGE_LAYOUT),
            topBannerImageUrls, bottomBannerImageUrls,
            bottomBannerLayout: bottomBannerLayout.value === 'grid-2x3' ? 'grid-2x3' : 'stacked',
            competitionHistory: Array.isArray(currentPage.profile?.competitionHistory) ? currentPage.profile.competitionHistory : [],
          },
        });
        currentPage.intro = result.data.page.intro;
        currentPage.profile = result.data.page.profile;
        profileSettingsSaved = true;
        layoutPreviewChanged = false;
        youtubeStates.delete(currentPage.streamer.id);
        cafeStates.delete(currentPage.streamer.id);
        rouletteStates.delete(currentPage.streamer.id);
        editorDialog.close();
        renderFanPage(currentPage);
        showToast('프로필을 저장했어요.');
      } catch (error) { showToast(error.message || '저장하지 못했어요.'); }
      finally {
        if (save.isConnected) {
          save.disabled = false;
          save.classList.remove('is-loading');
          save.removeAttribute('aria-busy');
          save.textContent = '프로필 저장';
        }
      }
    });
    footerActions.append(cancel, save);
    footer.append(note, footerActions); editor.append(grid, footer); editorDialog.append(editor);
    view.append(editorDialog);
  }
}

function createFanPageQuickRemote(view) {
  const sectionLabels = [
    ['fan-banner-top', '상단 배너'], ['profile-board', '프로필'],
    ['fan-character-ogq-pair', '팬 캐릭터·OGQ'], ['upbo-section', '업보 정리'],
    ['roulette-section', '룰렛 확률'], ['messenger-link-section', '메신저'],
    ['live-section', '방송 상태'], ['vod-section', '다시보기'],
    ['youtube-section', 'YouTube'], ['songbook-section', '노래책'], ['played-games-section', '플레이한 게임'],
    ['ogq-section', 'OGQ 이모티콘'], ['cafe-section', '네이버 카페'],
    ['calendar-section', '방송 일정'], ['fan-gallery-section', '팬 갤러리'],
    ['fan-banner-bottom', '하단 배너'],
  ];
  const candidates = [...view.children].flatMap((element) => {
    if (element.classList.contains('fanpage-tab-nav')) return [];
    if (element.classList.contains('fanpage-tab-panel')) {
      const flattenSectionGroups = (section) => {
        if (section.matches('.fanpage-home-columns, .fanpage-home-main-column, .fanpage-home-side-column, .fanpage-tab-columns, .fanpage-tab-column')) {
          return [...section.children].flatMap(flattenSectionGroups);
        }
        return [section];
      };
      return [...element.querySelectorAll(':scope > .fanpage-tab-panel-grid > *')].flatMap(flattenSectionGroups);
    }
    return [element];
  });
  const sections = candidates
    .filter((element) => element.tagName !== 'DIALOG' && !element.classList.contains('back-link'))
    .map((element, index) => {
      const label = sectionLabels.find(([className]) => element.classList.contains(className))?.[1]
        || element.querySelector('h1, h2, h3')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 18)
        || `영역 ${index + 1}`;
      if (!element.id) element.id = `fanpage-quick-section-${index + 1}`;
      return { id: element.id, label };
    });
  if (!sections.length) return null;

  const remote = document.createElement('aside'); remote.className = 'fan-quick-remote';
  remote.setAttribute('aria-label', '팬페이지 빠른 이동 리모콘');
  const toggle = document.createElement('button'); toggle.type = 'button';
  toggle.className = 'fan-quick-toggle'; toggle.setAttribute('aria-label', '빠른 이동 리모콘 열기');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h9M5 17h14"/><circle cx="17" cy="12" r="2"/></svg>';
  const mobileActions = document.createElement('div'); mobileActions.className = 'fan-quick-mobile-actions';
  const panel = document.createElement('div'); panel.className = 'fan-quick-panel'; panel.id = 'fanQuickPanel'; panel.hidden = true;
  const header = document.createElement('div'); header.className = 'fan-quick-header';
  const title = document.createElement('strong'); title.textContent = '빠른 이동';
  const soundSettingsButton = document.createElement('button'); soundSettingsButton.type = 'button';
  soundSettingsButton.className = 'fan-quick-sound-settings';
  soundSettingsButton.setAttribute('aria-label', '효과음 볼륨 설정');
  soundSettingsButton.title = '효과음 볼륨 설정';
  soundSettingsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11"/></svg>';
  const fullscreenButton = document.createElement('button'); fullscreenButton.type = 'button';
  fullscreenButton.className = 'fan-quick-fullscreen';
  fullscreenButton.setAttribute('aria-label', '전체 화면 보기');
  fullscreenButton.title = '전체 화면 보기';
  fullscreenButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/></svg>';
  const stickerControl = document.createElement('div'); stickerControl.className = 'fan-quick-sticker-control';
  stickerControl.hidden = true;
  const stickerButton = document.createElement('button'); stickerButton.type = 'button';
  stickerButton.className = 'fan-quick-sticker-button'; stickerButton.textContent = '✨';
  stickerButton.setAttribute('aria-label', '응원 스티커 도구 열기'); stickerButton.setAttribute('aria-expanded', 'false');
  stickerButton.setAttribute('aria-controls', 'fanQuickStickerMenu');
  const stickerMenu = document.createElement('div'); stickerMenu.id = 'fanQuickStickerMenu';
  stickerMenu.className = 'fan-quick-sticker-menu'; stickerMenu.hidden = true;
  stickerControl.append(stickerButton, stickerMenu);
  const syncStickerTools = () => {
    const isRollingPaperTab = view.dataset.fanpageActiveTab === 'rolling-paper';
    stickerControl.hidden = !isRollingPaperTab;
    const stickerState = currentPage ? rollingPaperStateFor(currentPage.streamer.id) : null;
    if (!stickerState || !isRollingPaperTab) {
      stickerMenu.hidden = true; stickerButton.setAttribute('aria-expanded', 'false');
      stickerMenu.replaceChildren(); return;
    }
    const open = stickerState.stickerActionMenuOpen;
    stickerMenu.hidden = !open; stickerButton.setAttribute('aria-expanded', String(open));
    stickerButton.classList.toggle('is-active', open || stickerState.stickerPlacing || !!stickerState.movingStickerId);
    stickerButton.setAttribute('aria-label', stickerState.stickerPlacing
      ? '스티커 붙이는 중: 취소 또는 도구 열기' : stickerState.movingStickerId
        ? '스티커 이동 중: 취소 또는 도구 열기' : open ? '응원 스티커 도구 닫기' : '응원 스티커 도구 열기');
    if (!open) { stickerMenu.replaceChildren(); return; }

    const header = document.createElement('div'); header.className = 'fan-quick-sticker-menu-heading';
    const menuTitle = document.createElement('strong'); menuTitle.textContent = '응원 스티커';
    const menuCount = document.createElement('span');
    menuCount.textContent = stickerState.stickersLoading && !stickerState.stickersLoaded
      ? '불러오는 중' : `${stickerState.stickers.length}개`;
    header.append(menuTitle, menuCount); stickerMenu.replaceChildren(header);
    const addAction = (label, handler, primary = false, disabled = false) => {
      const action = document.createElement('button'); action.type = 'button';
      action.className = `fan-quick-sticker-action${primary ? ' is-primary' : ''}`;
      action.textContent = label; action.disabled = disabled || stickerState.savingSticker;
      action.addEventListener('click', handler); stickerMenu.append(action); return action;
    };
    const addNote = (text, isError = false) => {
      const note = document.createElement('p'); note.className = `fan-quick-sticker-note${isError ? ' is-error' : ''}`;
      note.textContent = text; stickerMenu.append(note);
    };
    if (stickerState.stickersLoading && !stickerState.stickersLoaded) {
      addNote('스티커 목록을 불러오고 있어요.');
    } else if (stickerState.stickerPaletteOpen && stickerState.canPlaceSticker) {
      addNote('붙일 스티커를 골라 주세요.');
      const palette = document.createElement('div'); palette.className = 'fan-quick-sticker-palette';
      stickerState.stickerChoices.forEach((emoji) => {
        const choice = document.createElement('button'); choice.type = 'button';
        choice.className = 'fan-quick-sticker-choice'; choice.textContent = emoji;
        choice.setAttribute('aria-label', `${emoji} 스티커 선택`);
        choice.addEventListener('click', () => {
          try { localStorage.setItem(rollingPaperStickerHiddenKey(currentPage.streamer.id), '0'); } catch (_) { /* The visible board still works without storage. */ }
          stickerState.showHiddenStickers = false; stickerState.selectedStickerMenuId = '';
          stickerState.selectedStickerEmoji = emoji; stickerState.stickerPlacing = true;
          stickerState.stickerPaletteOpen = false; stickerState.stickerActionMenuOpen = false;
          refreshRollingPaperSection(currentPage.streamer.id);
        });
        palette.append(choice);
      });
      stickerMenu.append(palette);
      addAction('취소', () => { stickerState.stickerPaletteOpen = false; syncStickerTools(); });
    } else if (stickerState.stickerPlacing) {
      addNote(`${stickerState.selectedStickerEmoji} 붙일 위치를 화면에서 누르세요.`);
      addAction('붙이기 취소', () => {
        stickerState.stickerPlacing = false; stickerState.selectedStickerEmoji = '';
        stickerState.stickerActionMenuOpen = false; refreshRollingPaperSection(currentPage.streamer.id);
      });
    } else if (stickerState.movingStickerId && stickerState.canManageStickers) {
      addNote('노란 테두리 스티커를 드래그해 위치를 옮기세요.');
      addAction('이동 취소', () => cancelRollingPaperStickerMove(currentPage, stickerState.movingStickerId));
    } else {
      if (stickerState.canPlaceSticker && !stickerState.ownStickerId) {
        addAction('＋ 스티커 붙이기', () => {
          stickerState.stickerActionMenuOpen = true; stickerState.stickerPaletteOpen = true;
          stickerState.selectedStickerMenuId = ''; stickerState.movingStickerId = '';
          refreshRollingPaperSection(currentPage.streamer.id);
        }, true);
      } else if (!hasRecognizedFanpageAccount() && !stickerState.ownStickerId && stickerState.stickersLoaded) {
        addAction('로그인하고 스티커 붙이기', () => {
          stickerState.stickerActionMenuOpen = false; syncStickerTools(); showFanPageModal($('loginChoiceDialog'));
        }, true);
      } else if (stickerState.ownStickerId) {
        addNote('이 계정은 스티커를 하나 붙였어요.');
      } else if (!stickerState.stickers.length) {
        addNote('아직 붙은 스티커가 없어요.');
      }
      if (stickerState.stickers.length) {
        const hiddenAll = rollingPaperStickersAreHidden(currentPage.streamer.id);
        addAction(hiddenAll ? '모든 스티커 보이기' : '모든 스티커 숨기기', () => {
          try { localStorage.setItem(rollingPaperStickerHiddenKey(currentPage.streamer.id), hiddenAll ? '0' : '1'); } catch (_) { /* Keep the current board usable if storage is unavailable. */ }
          stickerState.stickerPlacing = false; stickerState.selectedStickerEmoji = '';
          stickerState.showHiddenStickers = false; stickerState.selectedStickerMenuId = '';
          stickerState.stickerActionMenuOpen = false; refreshRollingPaperSection(currentPage.streamer.id);
        });
      }
      const hiddenIds = rollingPaperHiddenStickerIds(currentPage.streamer.id);
      const available = new Set(stickerState.stickers.map((item) => item.id));
      const hiddenCount = [...hiddenIds].filter((id) => available.has(id)).length;
      if (hiddenCount) {
        addAction(stickerState.showHiddenStickers ? '숨김 스티커 감추기' : `숨긴 스티커 보기 ${hiddenCount}개`, () => {
          stickerState.showHiddenStickers = !stickerState.showHiddenStickers;
          stickerState.stickerPlacing = false; stickerState.selectedStickerEmoji = '';
          stickerState.stickerPaletteOpen = false; stickerState.selectedStickerMenuId = '';
          stickerState.stickerActionMenuOpen = false; refreshRollingPaperSection(currentPage.streamer.id);
        });
        addAction('숨김 모두 해제', () => {
          saveRollingPaperHiddenStickerIds(currentPage.streamer.id, new Set());
          stickerState.showHiddenStickers = false; stickerState.selectedStickerMenuId = '';
          stickerState.stickerActionMenuOpen = false; refreshRollingPaperSection(currentPage.streamer.id);
        });
      }
    }
    if (stickerState.stickerError) addNote(stickerState.stickerError, true);
    if (stickerState.savingSticker) addNote('저장 중이에요. 잠시만 기다려 주세요.');
    if (stickerState.stickerError && !stickerState.savingSticker) {
      addAction('다시 불러오기', () => { void loadRollingPaperStickers(currentPage, true); });
    }
  };
  stickerButton.addEventListener('click', () => {
    if (!currentPage) return;
    const stickerState = rollingPaperStateFor(currentPage.streamer.id);
    stickerState.stickerActionMenuOpen = !stickerState.stickerActionMenuOpen;
    if (stickerState.stickerActionMenuOpen) stickerState.selectedStickerMenuId = '';
    syncStickerTools();
  });
  const onStickerToolsOutsidePointer = (event) => {
    if (!currentPage) return;
    const stickerState = rollingPaperStateFor(currentPage.streamer.id);
    if (stickerState.selectedStickerMenuId && !event.target.closest?.('.rolling-paper-sticker')) {
      stickerState.selectedStickerMenuId = '';
      requestAnimationFrame(() => refreshRollingPaperSection(currentPage?.streamer.id));
    }
    if (stickerControl.contains(event.target) || !stickerState.stickerActionMenuOpen) return;
    stickerState.stickerActionMenuOpen = false; syncStickerTools();
  };
  const onStickerToolsKeydown = (event) => {
    if (event.key !== 'Escape' || !currentPage) return;
    const stickerState = rollingPaperStateFor(currentPage.streamer.id);
    if (stickerState.movingStickerId && !stickerState.savingSticker) {
      stickerState.stickerActionMenuOpen = false;
      cancelRollingPaperStickerMove(currentPage, stickerState.movingStickerId);
      stickerButton.focus({ preventScroll: true });
      return;
    }
    if (stickerState.stickerPlacing && !stickerState.savingSticker) {
      stickerState.stickerPlacing = false; stickerState.selectedStickerEmoji = '';
      stickerState.stickerPaletteOpen = false; stickerState.stickerActionMenuOpen = false;
      refreshRollingPaperSection(currentPage.streamer.id);
      stickerButton.focus({ preventScroll: true });
      return;
    }
    const closeStickerAction = stickerState.stickerActionMenuOpen;
    if (!closeStickerAction && !stickerState.selectedStickerMenuId) return;
    stickerState.stickerActionMenuOpen = false; stickerState.selectedStickerMenuId = '';
    refreshRollingPaperSection(currentPage.streamer.id); stickerButton.focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', onStickerToolsOutsidePointer);
  document.addEventListener('keydown', onStickerToolsKeydown);
  const close = document.createElement('button'); close.type = 'button'; close.className = 'fan-quick-close';
  close.setAttribute('aria-label', '빠른 이동 리모콘 닫기'); close.textContent = '×';
  header.append(title, soundSettingsButton, close);
  const soundDialog = document.createElement('dialog');
  soundDialog.className = 'account-dialog fan-sound-settings-dialog';
  soundDialog.setAttribute('aria-labelledby', 'fanSoundSettingsTitle');
  const soundCard = document.createElement('section'); soundCard.className = 'account-dialog-card fan-sound-settings-card';
  const soundHeading = document.createElement('div'); soundHeading.className = 'fan-sound-settings-heading';
  const soundTitle = document.createElement('h2'); soundTitle.id = 'fanSoundSettingsTitle'; soundTitle.textContent = '효과음 설정';
  const soundClose = document.createElement('button'); soundClose.type = 'button'; soundClose.className = 'button profile-settings-close';
  soundClose.setAttribute('aria-label', '효과음 설정 닫기'); soundClose.textContent = '×';
  soundClose.addEventListener('click', () => soundDialog.close());
  soundHeading.append(soundTitle, soundClose);
  const soundDescription = document.createElement('p'); soundDescription.className = 'fan-sound-settings-description';
  soundDescription.textContent = '버튼 누름음, 저장음, 모달 열림음, 발바닥 닫기음의 크기를 함께 조절해요. 0%로 끌 수 있고, 이 브라우저에 저장돼요.';
  const soundVolumeRow = document.createElement('div'); soundVolumeRow.className = 'fan-sound-volume-row';
  const soundVolumeLabel = document.createElement('label'); soundVolumeLabel.htmlFor = 'fanButtonClickVolume';
  soundVolumeLabel.textContent = '효과음 볼륨';
  const soundVolumeValue = document.createElement('output'); soundVolumeValue.className = 'fan-sound-volume-value';
  soundVolumeValue.htmlFor = 'fanButtonClickVolume';
  const soundVolume = document.createElement('input'); soundVolume.type = 'range';
  soundVolume.id = 'fanButtonClickVolume'; soundVolume.className = 'fan-sound-volume-range';
  soundVolume.min = '0'; soundVolume.max = '100'; soundVolume.step = '5';
  soundVolume.value = String(buttonClickVolume);
  soundVolume.setAttribute('aria-label', '버튼 누름, 저장, 모달 열림 및 발바닥 닫기 효과음 볼륨');
  soundVolumeValue.textContent = `${buttonClickVolume}%`;
  soundVolume.addEventListener('input', () => {
    const volume = setButtonClickVolume(soundVolume.value);
    soundVolumeValue.textContent = `${volume}%`;
  });
  soundVolumeRow.append(soundVolumeLabel, soundVolumeValue);
  const soundActions = document.createElement('div'); soundActions.className = 'fan-sound-settings-actions';
  const soundReset = document.createElement('button'); soundReset.type = 'button'; soundReset.className = 'button'; soundReset.textContent = '기본값 20%';
  soundReset.addEventListener('click', () => {
    soundVolume.value = String(setButtonClickVolume(DEFAULT_BUTTON_CLICK_VOLUME));
    soundVolumeValue.textContent = `${buttonClickVolume}%`;
  });
  const soundDone = document.createElement('button'); soundDone.type = 'button'; soundDone.className = 'button button-primary'; soundDone.textContent = '완료';
  soundDone.addEventListener('click', () => soundDialog.close());
  soundActions.append(soundReset, soundDone);
  soundCard.append(soundHeading, soundDescription, soundVolumeRow, soundVolume, soundActions);
  soundDialog.append(soundCard);
  soundSettingsButton.addEventListener('click', () => showFanPageModal(soundDialog));
  const body = document.createElement('div'); body.className = 'fan-quick-body';
  const nav = document.createElement('nav'); nav.className = 'fan-quick-links'; nav.setAttribute('aria-label', '팬페이지 영역');
  const navButtons = sections.map((section, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'fan-quick-link';
    const number = document.createElement('span'); number.className = 'fan-quick-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span'); label.className = 'fan-quick-label'; label.textContent = section.label;
    button.append(number, label);
    button.addEventListener('click', () => {
      const target = document.getElementById(section.id);
      const tabPanel = target?.closest('.fanpage-tab-panel');
      if (tabPanel && tabPanel.hidden) view._selectFanPageTab?.(tabPanel.dataset.fanpageTabPanel);
      window.requestAnimationFrame(() => {
        document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      if (!window.matchMedia('(min-width: 1500px)').matches) setExpanded(false);
    });
    nav.append(button);
    return button;
  });
  const scrubber = document.createElement('div'); scrubber.className = 'fan-quick-scrubber';
  scrubber.tabIndex = 0; scrubber.setAttribute('role', 'slider'); scrubber.setAttribute('aria-label', '페이지 빠른 스크롤');
  scrubber.setAttribute('aria-orientation', 'vertical'); scrubber.setAttribute('aria-valuemin', '0');
  scrubber.setAttribute('aria-valuemax', '100'); scrubber.setAttribute('aria-valuenow', '0');
  scrubber.setAttribute('aria-valuetext', '페이지 맨 위');
  const rail = document.createElement('span'); rail.className = 'fan-quick-scroll-rail';
  const thumb = document.createElement('span'); thumb.className = 'fan-quick-scroll-thumb';
  scrubber.append(rail, thumb); body.append(nav, scrubber); panel.append(header, body);
  soundDialog.id = 'fanSoundSettingsDialog';
  toggle.setAttribute('aria-controls', panel.id);
  mobileActions.append(stickerControl, toggle, fullscreenButton);
  remote.append(mobileActions, panel); view.append(remote, soundDialog);
  view._syncRollingPaperStickerQuickTools = syncStickerTools;
  syncStickerTools();

  let expanded = false;
  let scrollFrame = 0;
  let dragging = false;
  let remoteDrag = null;
  let resizeObserver = null;
  let emoteLauncherObserver = null;
  const positionStorageKey = 'streamerFanPage.quickRemotePosition';
  const isDesktop = () => window.matchMedia('(min-width: 1500px)').matches;
  function currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
  }
  function syncFullscreenButton() {
    const isFullscreen = !!currentFullscreenElement();
    const label = isFullscreen ? '전체 화면 종료' : '전체 화면 보기';
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.setAttribute('aria-pressed', String(isFullscreen));
    fullscreenButton.title = label;
  }
  async function toggleFullscreen() {
    const fullscreenElement = currentFullscreenElement();
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
    if (fullscreenElement) {
      if (typeof exitFullscreen !== 'function') {
        showToast('이 브라우저에서는 전체 화면을 종료할 수 없어요.');
        return;
      }
      try { await exitFullscreen.call(document); }
      catch (_) { showToast('전체 화면을 종료하지 못했어요.'); }
      return;
    }
    const root = document.documentElement;
    const requestFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
    if (typeof requestFullscreen !== 'function') {
      showToast('현재 브라우저는 페이지 전체 화면을 지원하지 않아요.');
      return;
    }
    try { await requestFullscreen.call(root); }
    catch (_) { showToast('전체 화면을 시작하지 못했어요. 브라우저의 화면 전환 기능을 확인해 주세요.'); }
  }
  function syncEmoteLauncherPosition() {
    const launcher = document.getElementById('game-series-emote-launcher');
    if (!launcher) return;
    if (isDesktop()) {
      if (launcher.parentElement !== remote) remote.insertBefore(launcher, panel);
      launcher.classList.add('fanpage-emote-remote-attached');
    } else {
      if (launcher.parentElement !== document.body) document.body.append(launcher);
      launcher.classList.remove('fanpage-emote-remote-attached');
    }
  }
  function positionRemote(left, top) {
    const bounds = remote.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - bounds.width - 8);
    const maxTop = Math.max(8, window.innerHeight - bounds.height - 8);
    remote.style.right = 'auto';
    remote.style.transform = 'none';
    remote.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
    remote.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
  }
  function restoreDesktopPosition() {
    if (!isDesktop()) {
      remote.style.left = '';
      remote.style.top = '';
      remote.style.right = '';
      remote.style.transform = '';
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(positionStorageKey) || 'null');
      if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
        remote.style.left = '';
        remote.style.top = '';
        remote.style.right = '';
        remote.style.transform = '';
        return;
      }
      const bounds = remote.getBoundingClientRect();
      const spanX = Math.max(0, window.innerWidth - bounds.width - 16);
      const spanY = Math.max(0, window.innerHeight - bounds.height - 16);
      positionRemote(8 + saved.x * spanX, 8 + saved.y * spanY);
    } catch (_) {
      remote.style.left = '';
      remote.style.top = '';
      remote.style.right = '';
      remote.style.transform = '';
    }
  }
  function startRemoteDrag(event) {
    if (!isDesktop() || event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    const bounds = remote.getBoundingClientRect();
    remoteDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: bounds.left, top: bounds.top, moved: false };
    remote.classList.add('is-dragging');
    positionRemote(bounds.left, bounds.top);
    try { header.setPointerCapture(event.pointerId); } catch (_) { /* capture may be unavailable */ }
  }
  function moveRemoteDrag(event) {
    if (!remoteDrag || event.pointerId !== remoteDrag.pointerId) return;
    const deltaX = event.clientX - remoteDrag.startX;
    const deltaY = event.clientY - remoteDrag.startY;
    if (!remoteDrag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    remoteDrag.moved = true;
    event.preventDefault();
    positionRemote(remoteDrag.left + deltaX, remoteDrag.top + deltaY);
  }
  function finishRemoteDrag(event) {
    if (!remoteDrag || (event.pointerId !== undefined && event.pointerId !== remoteDrag.pointerId)) return;
    const moved = remoteDrag.moved;
    remoteDrag = null;
    remote.classList.remove('is-dragging');
    if (!moved) return;
    const bounds = remote.getBoundingClientRect();
    const maxLeft = Math.max(1, window.innerWidth - bounds.width - 16);
    const maxTop = Math.max(1, window.innerHeight - bounds.height - 16);
    try {
      localStorage.setItem(positionStorageKey, JSON.stringify({
        x: Math.max(0, Math.min(1, (bounds.left - 8) / maxLeft)),
        y: Math.max(0, Math.min(1, (bounds.top - 8) / maxTop)),
      }));
    } catch (_) { /* position remains usable for this page even when storage is unavailable */ }
  }
  function setExpanded(value) {
    expanded = !!value;
    panel.hidden = isDesktop() ? false : !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? '빠른 이동 리모콘 닫기' : '빠른 이동 리모콘 열기');
    if (!expanded && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    scheduleUpdate();
  }
  function syncDeviceMode() {
    const desktop = isDesktop();
    toggle.hidden = desktop;
    if (desktop) panel.hidden = false;
    else panel.hidden = !expanded;
    syncEmoteLauncherPosition();
    if (!remoteDrag) restoreDesktopPosition();
    scheduleUpdate();
  }
  function scrollToProgress(clientY) {
    const bounds = scrubber.getBoundingClientRect();
    const thumbHeight = thumb.getBoundingClientRect().height;
    const travel = Math.max(1, bounds.height - thumbHeight - 8);
    const progress = Math.max(0, Math.min(1, (clientY - bounds.top - 4 - thumbHeight / 2) / travel));
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, progress * maxScroll);
  }
  function updateRemote() {
    scrollFrame = 0;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const progress = maxScroll ? Math.max(0, Math.min(1, window.scrollY / maxScroll)) : 0;
    const travel = Math.max(0, scrubber.clientHeight - thumb.offsetHeight - 8);
    thumb.style.transform = `translateY(${travel * progress}px)`;
    scrubber.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    scrubber.setAttribute('aria-valuetext', `${Math.round(progress * 100)}% 내려옴`);
    const marker = window.scrollY + window.innerHeight * 0.4;
    let activeIndex = 0;
    sections.forEach((section, index) => {
      const target = document.getElementById(section.id);
      if (target?.closest('.fanpage-tab-panel')?.hidden) return;
      if (target && target.getBoundingClientRect().top + window.scrollY <= marker) activeIndex = index;
    });
    navButtons.forEach((button, index) => {
      if (index === activeIndex) {
        button.classList.add('is-active'); button.setAttribute('aria-current', 'location');
      } else {
        button.classList.remove('is-active'); button.removeAttribute('aria-current');
      }
    });
  }
  function scheduleUpdate() {
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateRemote);
  }
  function handleScrubberPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault(); dragging = true;
    try { scrubber.setPointerCapture(event.pointerId); } catch (_) { /* capture may be unavailable */ }
    scrollToProgress(event.clientY);
  }
  function handleScrubberPointerMove(event) {
    if (dragging) { event.preventDefault(); scrollToProgress(event.clientY); }
  }
  function endScrubberDrag() { dragging = false; }
  function handleScrubberKeydown(event) {
    const step = event.shiftKey || event.key === 'PageDown' || event.key === 'PageUp' ? 0.16 : 0.035;
    if (event.key === 'Home') { event.preventDefault(); window.scrollTo(0, 0); }
    else if (event.key === 'End') { event.preventDefault(); window.scrollTo(0, document.documentElement.scrollHeight); }
    else if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); window.scrollBy(0, window.innerHeight * step); }
    else if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); window.scrollBy(0, -window.innerHeight * step); }
  }
  const onScroll = () => scheduleUpdate();
  const onResize = () => {
    if (remoteDrag && !isDesktop()) {
      const pointerId = remoteDrag.pointerId;
      remote.classList.remove('is-dragging');
      remoteDrag = null;
      try { if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId); } catch (_) { /* capture may already be released */ }
    }
    syncDeviceMode();
  };
  toggle.addEventListener('click', () => setExpanded(!expanded));
  fullscreenButton.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
  syncFullscreenButton();
  close.addEventListener('click', () => setExpanded(false));
  header.addEventListener('pointerdown', startRemoteDrag);
  header.addEventListener('pointermove', moveRemoteDrag);
  header.addEventListener('pointerup', finishRemoteDrag);
  header.addEventListener('pointercancel', finishRemoteDrag);
  header.addEventListener('lostpointercapture', finishRemoteDrag);
  scrubber.addEventListener('pointerdown', handleScrubberPointerDown);
  scrubber.addEventListener('pointermove', handleScrubberPointerMove);
  scrubber.addEventListener('pointerup', endScrubberDrag);
  scrubber.addEventListener('pointercancel', endScrubberDrag);
  scrubber.addEventListener('lostpointercapture', endScrubberDrag);
  scrubber.addEventListener('keydown', handleScrubberKeydown);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(view);
  }
  if (typeof MutationObserver === 'function') {
    emoteLauncherObserver = new MutationObserver(syncEmoteLauncherPosition);
    emoteLauncherObserver.observe(document.body, { childList: true });
  }
  syncDeviceMode();
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', syncFullscreenButton);
    document.removeEventListener('webkitfullscreenchange', syncFullscreenButton);
    document.removeEventListener('pointerdown', onStickerToolsOutsidePointer);
    document.removeEventListener('keydown', onStickerToolsKeydown);
    fullscreenButton.removeEventListener('click', toggleFullscreen);
    header.removeEventListener('pointerdown', startRemoteDrag);
    header.removeEventListener('pointermove', moveRemoteDrag);
    header.removeEventListener('pointerup', finishRemoteDrag);
    header.removeEventListener('pointercancel', finishRemoteDrag);
    header.removeEventListener('lostpointercapture', finishRemoteDrag);
    if (emoteLauncherObserver) emoteLauncherObserver.disconnect();
    const emoteLauncher = document.getElementById('game-series-emote-launcher');
    if (emoteLauncher && emoteLauncher.parentElement === remote) {
      document.body.append(emoteLauncher);
      emoteLauncher.classList.remove('fanpage-emote-remote-attached');
    }
    if (view._selectFanPageTab) delete view._selectFanPageTab;
    if (view._syncRollingPaperStickerQuickTools) delete view._syncRollingPaperStickerQuickTools;
    if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    if (resizeObserver) resizeObserver.disconnect();
  };
}

function refreshProfileRouletteAction(page) {
  const actions = $('profileActions');
  if (!actions) return;
  actions.querySelector('#profileRouletteLink')?.remove();
  const url = String(page.profile && page.profile.rouletteUrl || '').trim();
  if (!url) return;
  const link = document.createElement('a');
  link.id = 'profileRouletteLink'; link.className = 'button button-primary';
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = '룰렛 확률 ↗';
  const settings = $('profileSettingsButton');
  actions.insertBefore(link, settings || null);
}

function normalizeBannerImageUrl(value) {
  const link = String(value || '').trim();
  if (!link) return '';
  if (link.length > 2048) throw new Error('배너 이미지 주소는 2,048자 이내로 입력해 주세요.');
  let parsed;
  try { parsed = new URL(link); } catch (_) { throw new Error('배너 이미지 주소를 확인해 주세요.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('HTTPS 이미지 주소를 입력해 주세요.');
  }
  return parsed.href;
}

function createBannerSettingsEditor(field, labelText, sourceUrls, options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'profile-editor-field profile-editor-wide banner-settings-editor';
  const heading = document.createElement('div'); heading.className = 'banner-settings-heading';
  const label = document.createElement('strong'); label.textContent = labelText;
  const add = document.createElement('button'); add.type = 'button'; add.className = 'button banner-settings-add'; add.textContent = '+ 이미지 추가';
  heading.append(label, add);
  const rows = document.createElement('div'); rows.className = 'banner-settings-rows';
  const note = document.createElement('small'); note.className = 'profile-editor-hint';
  const urls = Array.isArray(sourceUrls) ? sourceUrls.filter((url) => typeof url === 'string').slice(0, MAX_BANNER_IMAGE_ITEMS) : [];
  const gridLimit = 6;
  const updateLayout = () => {
    const useGrid = options.layoutSelect?.value === 'grid-2x3';
    [...rows.children].forEach((row, index) => { row.hidden = useGrid && index >= gridLimit; });
    add.disabled = rows.children.length >= (useGrid ? gridLimit : MAX_BANNER_IMAGE_ITEMS);
    note.textContent = useGrid
      ? `2×3 배치는 위에서부터 최대 ${gridLimit}장만 표시해요. 기존에 추가한 나머지 이미지는 기존 방식으로 바꾸면 다시 표시됩니다.`
      : `배너 규격은 약 2045×298px이며, 상단·하단 각각 최대 ${MAX_BANNER_IMAGE_ITEMS}개까지 등록할 수 있어요.`;
  };
  const addRow = (value = '', isExisting = false) => {
    const maxRows = options.layoutSelect?.value === 'grid-2x3' ? gridLimit : MAX_BANNER_IMAGE_ITEMS;
    if (!isExisting && rows.children.length >= maxRows) return;
    const row = document.createElement('div'); row.className = 'banner-settings-row';
    const input = document.createElement('input'); input.type = 'url'; input.maxLength = 2048;
    input.placeholder = 'https://이미지주소'; input.value = value; input.autocomplete = 'url'; input.setAttribute('aria-label', `${labelText} 이미지 주소`);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button banner-settings-remove';
    remove.textContent = '삭제'; remove.setAttribute('aria-label', `${labelText} 주소 삭제`);
    remove.addEventListener('click', () => { row.remove(); updateLayout(); });
    row.append(input, remove); rows.append(row);
    updateLayout();
  };
  urls.forEach((url) => addRow(url, true));
  add.addEventListener('click', () => addRow());
  if (options.layoutSelect) {
    options.layoutSelect.addEventListener('change', updateLayout);
  }
  updateLayout();
  wrapper.append(heading, rows, note);
  return {
    element: wrapper,
    values() { return [...rows.querySelectorAll('input')].map((input) => input.value.trim()).filter(Boolean); },
  };
}

function renderBannerSection(page, position) {
  const isTop = position === 'top';
  const field = isTop ? 'topBannerImageUrls' : 'bottomBannerImageUrls';
  const useGridLayout = !isTop && page.profile?.bottomBannerLayout === 'grid-2x3';
  const storedUrls = page.profile && page.profile[field];
  const urls = Array.isArray(storedUrls) ? storedUrls.map((url) => {
    try { return normalizeBannerImageUrl(url); } catch (_) { return ''; }
  }).filter(Boolean).slice(0, useGridLayout ? 6 : MAX_BANNER_IMAGE_ITEMS) : [];
  if (!urls.length) return null;

  const section = document.createElement('section');
  section.className = `fan-banner-section fan-banner-${position}${useGridLayout ? ' fan-banner-bottom-grid-2x3' : ''}`;
  section.id = `${position}BannerSection`;
  section.setAttribute('aria-label', `${page.streamer.nickname} ${isTop ? '상단' : '하단'} 배너`);
  const list = document.createElement('div'); list.className = `fan-banner-list${useGridLayout ? ' fan-banner-list-grid-2x3' : ''}`;
  urls.forEach((url, index) => {
    const image = document.createElement('img'); image.className = 'fan-banner-image';
    image.src = url; image.alt = `${page.streamer.nickname} ${isTop ? '상단' : '하단'} 배너 ${index + 1}`;
    image.loading = isTop && index === 0 ? 'eager' : 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    list.append(image);
  });
  section.append(list);
  return section;
}

function profileForLinkSave(source, field, value) {
  const profile = source || {};
  const saved = {
    birthday: String(profile.birthday || ''), mbti: String(profile.mbti || ''),
    major: String(profile.major || ''), debutDate: String(profile.debutDate || ''),
    fanNickname: String(profile.fanNickname || ''), fandomName: String(profile.fandomName || ''),
    contents: Array.isArray(profile.contents) ? profile.contents.filter((item) => typeof item === 'string').slice(0, 8) : [],
    scheduleText: String(profile.scheduleText || ''), rouletteUrl: String(profile.rouletteUrl || ''),
    ogqEmoticonUrl: String(profile.ogqEmoticonUrl || ''),
    layoutDesign: profile.layoutDesign === 2 ? 2 : DEFAULT_FANPAGE_LAYOUT,
    topBannerImageUrls: Array.isArray(profile.topBannerImageUrls) ? profile.topBannerImageUrls.filter((item) => typeof item === 'string').slice(0, MAX_BANNER_IMAGE_ITEMS) : [],
    bottomBannerImageUrls: Array.isArray(profile.bottomBannerImageUrls) ? profile.bottomBannerImageUrls.filter((item) => typeof item === 'string').slice(0, MAX_BANNER_IMAGE_ITEMS) : [],
    bottomBannerLayout: profile.bottomBannerLayout === 'grid-2x3' ? 'grid-2x3' : 'stacked',
    competitionHistory: Array.isArray(profile.competitionHistory) ? profile.competitionHistory.slice(0, 30) : [],
  };
  saved[field] = value;
  return saved;
}

function normalizeProfileLink(field, value) {
  const link = String(value || '').trim();
  if (!link) return '';
  let parsed;
  try { parsed = new URL(link); } catch (_) { throw new Error('링크 주소를 확인해 주세요.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('HTTPS 링크를 입력해 주세요.');
  }
  if (field === 'rouletteUrl') {
    if (!['weflab.com', 'www.weflab.com'].includes(parsed.hostname) || parsed.port
      || !/^\/user\/[A-Za-z0-9_-]{4,128}\/?$/.test(parsed.pathname)) {
      throw new Error('위플랩 공개 룰렛 사용자 링크를 입력해 주세요.');
    }
    return `https://weflab.com${parsed.pathname.replace(/\/$/, '')}`;
  }
  if (field === 'ogqEmoticonUrl') {
    if (parsed.hostname !== 'ogqmarket.sooplive.com' || parsed.port
      || !/^\/emoticon\/[A-Za-z0-9_-]{8,64}\/?$/.test(parsed.pathname)) {
      throw new Error('SOOP OGQ 이모티콘 상품 주소를 입력해 주세요.');
    }
    return `https://ogqmarket.sooplive.com${parsed.pathname.replace(/\/$/, '')}`;
  }
  return parsed.href;
}

function createProfileLinkEditor(page, field, options) {
  const hasLink = options.hasLink === undefined ? !!options.value : options.hasLink;
  const form = document.createElement('form');
  form.className = 'profile-link-editor';
  if (hasLink) form.classList.add('hidden');
  const label = document.createElement('label');
  label.textContent = options.label;
  const input = document.createElement('input');
  input.type = 'url'; input.name = field; input.maxLength = 300;
  input.placeholder = options.placeholder; input.value = options.value || '';
  input.autocomplete = 'url'; input.setAttribute('aria-label', options.label);
  const save = document.createElement('button');
  save.type = 'submit'; save.className = 'button button-primary';
  save.textContent = '링크 저장';
  const note = document.createElement('small');
  note.className = 'profile-link-editor-note'; note.textContent = options.note;
  const status = document.createElement('p');
  status.className = 'profile-link-editor-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  form.append(label, input, save, note, status);

  let toggleButton = null;
  if (hasLink) {
    toggleButton = document.createElement('button');
    toggleButton.type = 'button'; toggleButton.className = 'button profile-link-edit-button';
    toggleButton.textContent = '링크 수정';
    toggleButton.addEventListener('click', () => {
      const opening = form.classList.contains('hidden');
      form.classList.toggle('hidden', !opening);
      if (opening) input.focus();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!page.isOwner || save.disabled) return;
    if (!input.checkValidity()) { input.reportValidity(); return; }
    let value;
    try { value = normalizeProfileLink(field, input.value); }
    catch (error) { status.textContent = error.message; status.classList.add('is-error'); input.focus(); return; }
    save.disabled = true; save.textContent = '저장 중…';
    status.textContent = ''; status.classList.remove('is-error');
    try {
      const result = await callSave({
        streamerId: page.streamer.id,
        profile: profileForLinkSave(page.profile, field, value),
      });
      if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
      currentPage.profile = result.data.page.profile;
      page.profile = currentPage.profile;
      const settingsInput = document.querySelector(`#profileSettingsDialog [name="${field}"]`);
      if (settingsInput) settingsInput.value = currentPage.profile[field] || '';
      if (field === 'rouletteUrl') {
        refreshProfileRouletteAction(currentPage);
        rouletteStates.delete(page.streamer.id);
        refreshRouletteSection(page.streamer.id);
      } else if (field === 'youtubeChannelUrl') {
        youtubeStates.delete(page.streamer.id);
        refreshYouTubeSection(page.streamer.id);
        if (value) loadYouTubeVideos(page.streamer.id);
      } else if (field === 'cafeUrl') {
        cafeStates.delete(page.streamer.id);
        refreshCafeSection(page.streamer.id);
        if (value) loadCafePosts(page.streamer.id);
      } else if (field === 'ogqEmoticonUrl') {
        refreshOgqSection(page.streamer.id);
      }
      showToast('링크를 저장했어요.');
    } catch (error) {
      status.textContent = error.message || '링크를 저장하지 못했어요.';
      status.classList.add('is-error');
    } finally {
      save.disabled = false; save.textContent = '링크 저장';
    }
  });

  return { element: form, toggleButton };
}

function renderRouletteSection(page) {
  const profile = page.profile || {};
  const configuredUrl = String(profile.rouletteUrl || '').trim();
  let rouletteUrl;
  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol !== 'https:'
      || !['weflab.com', 'www.weflab.com'].includes(parsed.hostname)
      || !/^\/user\/[A-Za-z0-9_-]{4,128}\/?$/.test(parsed.pathname)
      || parsed.username || parsed.password || parsed.port) throw new Error('invalid WeFlab URL');
    rouletteUrl = `https://weflab.com${parsed.pathname.replace(/\/$/, '')}`;
  } catch (_) {
    rouletteUrl = '';
  }

  const section = document.createElement('section');
  section.className = 'content-card roulette-section';
  section.id = 'rouletteSection';
  section.dataset.streamerId = page.streamer.id;
  const heading = document.createElement('div');
  heading.className = 'roulette-heading';
  const copy = document.createElement('div');
  copy.className = 'roulette-heading-copy';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'WEFLAB ROULETTE';
  const title = document.createElement('h2');
  title.textContent = '룰렛 확률';
  const description = document.createElement('p');
  description.className = 'roulette-description';
  description.textContent = `${page.streamer.nickname}님의 공개 룰렛 확률을 팬페이지 디자인으로 표시합니다.`;
  copy.append(eyebrow, title, description);

  const controls = document.createElement('div');
  controls.className = 'roulette-controls';
  const editor = page.isOwner ? createProfileLinkEditor(page, 'rouletteUrl', {
    label: '위플랩 공개 룰렛 링크', placeholder: 'https://weflab.com/user/아이디',
    note: '공개 룰렛 사용자 페이지 링크를 입력하면 확률표를 불러옵니다.',
    value: configuredUrl, hasLink: !!rouletteUrl,
  }) : null;
  if (rouletteUrl) {
    const openLink = document.createElement('a');
    openLink.className = 'button roulette-open-link';
    openLink.href = rouletteUrl;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.textContent = '위플랩에서 열기 ↗';
    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'button roulette-refresh-button';
    refreshButton.textContent = '↻ 목록 새로고침';
    refreshButton.addEventListener('click', () => loadRouletteData(section, page.streamer.id, true));
    controls.append(openLink, refreshButton);
  }
  if (editor && editor.toggleButton) controls.append(editor.toggleButton);
  heading.append(copy, controls);

  if (!rouletteUrl) {
    const empty = document.createElement('p');
    empty.className = 'profile-link-empty-state';
    empty.textContent = '룰렛 링크가 아직 등록되지 않았어요.';
    section.append(heading, empty);
    if (editor) section.append(editor.element);
    return section;
  }

  const status = document.createElement('p');
  status.className = 'roulette-status';
  status.setAttribute('aria-live', 'polite');
  const viewport = document.createElement('div');
  viewport.className = 'roulette-list-viewport';
  const list = document.createElement('div');
  list.className = 'roulette-groups';
  viewport.append(list);

  const note = document.createElement('p');
  note.className = 'roulette-scroll-note';
  note.textContent = '위플랩에서 공개한 항목과 확률을 팬페이지에 맞춰 표시합니다.';
  section.append(heading, status, viewport, note);
  if (editor) section.append(editor.element);
  renderRouletteData(section, rouletteStates.get(page.streamer.id) || { loading: true });
  loadRouletteData(section, page.streamer.id, false);
  return section;
}

function refreshRouletteSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('rouletteSection');
  if (!section) return;
  section.replaceWith(renderRouletteSection(currentPage));
}

function formatRouletteDateTime(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === '') return '';
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function rouletteCountLabel(count) {
  const min = Number(count.min);
  const max = Number(count.max);
  const range = min === max ? min.toLocaleString('ko-KR') : `${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')}`;
  const platformNames = {
    afreeca: 'SOOP', soopg: 'SOOP G', naver: '치지직', youtube: 'YouTube',
    twitch: 'Twitch', cime: '씨미', flextv: '플렉스TV', extdona: '외부후원',
  };
  const platform = platformNames[count.platform] || '';
  return `${platform ? `${platform} ` : ''}${range}개`;
}

function renderRouletteData(section, state) {
  const status = section.querySelector('.roulette-status');
  const list = section.querySelector('.roulette-groups');
  const refreshButton = section.querySelector('.roulette-refresh-button');
  if (!status || !list || !refreshButton) return;

  refreshButton.disabled = !!state.loading;
  refreshButton.textContent = state.loading ? '↻ 불러오는 중…' : '↻ 목록 새로고침';
  list.replaceChildren();

  const roulette = state.data;
  if (roulette && roulette.linked && Array.isArray(roulette.groups) && roulette.groups.length) {
    const sourceDate = roulette.sourceUpdatedAt ? `위플랩 설정 수정 ${roulette.sourceUpdatedAt}` : '';
    const fetchedDate = formatRouletteDateTime(roulette.fetchedAt);
    const freshness = fetchedDate ? `팬페이지 확인 ${fetchedDate}` : '';
    const staleCopy = state.stale ? '위플랩 연결이 원활하지 않아 최근 저장된 데이터를 표시 중 · ' : '';
    const cooldownCopy = state.refreshCoolingDown ? '최근에 새로 확인했어요 · ' : '';
    status.textContent = `${staleCopy}${cooldownCopy}${[sourceDate, freshness].filter(Boolean).join('　·　')}`;

    roulette.groups.forEach((group, index) => {
      const groupElement = document.createElement('section');
      groupElement.className = 'roulette-group';
      const groupHeading = document.createElement('div');
      groupHeading.className = 'roulette-group-heading';
      const countLabels = (Array.isArray(group.counts) ? group.counts : []).map(rouletteCountLabel);
      const count = document.createElement('strong');
      count.className = 'roulette-donation-count';
      count.textContent = countLabels.length ? countLabels.join(' · ') : `룰렛 설정 ${index + 1}`;
      const itemCount = document.createElement('span');
      itemCount.className = 'roulette-item-count';
      itemCount.textContent = `${group.items.length.toLocaleString('ko-KR')}개 항목`;
      groupHeading.append(count, itemCount);

      const items = document.createElement('div');
      items.className = 'roulette-items';
      group.items.forEach((item) => {
        const row = document.createElement('article');
        row.className = 'roulette-item';
        const itemCopy = document.createElement('div');
        itemCopy.className = 'roulette-item-copy';
        const type = document.createElement('span');
        type.className = 'roulette-item-type';
        type.textContent = item.type || '룰렛';
        const value = document.createElement('strong');
        value.className = 'roulette-item-value';
        value.textContent = item.value || '이름 없음';
        itemCopy.append(type, value);

        const odds = document.createElement('div');
        odds.className = 'roulette-item-odds';
        const probability = document.createElement('strong');
        probability.className = 'roulette-item-probability';
        const percent = item.probability === null || item.probability === undefined ? NaN : Number(item.probability);
        probability.textContent = Number.isFinite(percent) ? `${percent.toLocaleString('ko-KR')}%` : '미등록';
        const meter = document.createElement('span');
        meter.className = 'roulette-item-meter';
        const meterFill = document.createElement('span');
        meterFill.className = 'roulette-item-meter-fill';
        meterFill.style.width = `${Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0}%`;
        meter.append(meterFill);
        odds.append(probability, meter);
        row.append(itemCopy, odds);
        items.append(row);
      });
      groupElement.append(groupHeading, items);
      list.append(groupElement);
    });
    return;
  }

  if (state.loading) {
    status.textContent = '위플랩에서 최신 룰렛 데이터를 확인하고 있어요.';
    const loading = document.createElement('p');
    loading.className = 'roulette-empty';
    loading.textContent = '룰렛 항목을 불러오는 중…';
    list.append(loading);
    return;
  }
  status.textContent = '';
  const empty = document.createElement('p');
  empty.className = 'roulette-empty';
  empty.textContent = state.error || '공개된 룰렛 설정을 불러오지 못했어요. 위플랩에서 원본을 확인해 주세요.';
  list.append(empty);
}

async function loadRouletteData(section, streamerId, forceRefresh) {
  const previous = rouletteStates.get(streamerId) || {};
  const state = { ...previous, loading: true, error: '', refreshCoolingDown: false };
  rouletteStates.set(streamerId, state);
  renderRouletteData(section, state);
  try {
    const response = await callRoulette({ streamerId, forceRefresh });
    state.data = response.data.roulette || null;
    state.stale = response.data.stale === true;
    state.refreshCoolingDown = response.data.refreshCoolingDown === true;
  } catch (error) {
    state.stale = !!state.data;
    state.error = error && error.code === 'functions/unauthenticated'
      ? '로그인 정보를 확인한 후 다시 시도해 주세요.'
      : (error && typeof error.message === 'string' && error.message !== 'internal'
        ? error.message
        : '위플랩 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    state.loading = false;
    rouletteStates.set(streamerId, state);
    if (section.isConnected) renderRouletteData(section, state);
  }
}

function renderStreamerStockPrice(page) {
  const stock = page.stock && typeof page.stock.id === 'string' ? page.stock : null;
  const module = document.createElement('div');
  module.className = 'profile-stock-module';
  const link = document.createElement('a');
  link.className = 'profile-stock-card';
  link.href = stock
    ? `https://neezu-crypto.github.io/soop-stock-market/index.html?stockId=${encodeURIComponent(stock.id)}`
    : 'https://neezu-crypto.github.io/soop-stock-market/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${page.streamer.nickname} 주가, 스트리머 주식시장 바로가기`);

  const copy = document.createElement('span'); copy.className = 'profile-stock-copy';
  const eyebrow = document.createElement('span'); eyebrow.className = 'profile-stock-eyebrow';
  eyebrow.textContent = 'STREAMER STOCK';
  const title = document.createElement('strong');
  title.textContent = page.isStreamerOwner ? '현재 내 주가' : '현재 주가';
  const meta = document.createElement('span'); meta.className = 'profile-stock-meta';
  meta.textContent = stock ? `${stock.name} · 출처: 스트리머 주식시장` : '종목 정보를 찾을 수 없어요 · 출처: 스트리머 주식시장';
  copy.append(eyebrow, title, meta);

  const chart = document.createElement('span'); chart.className = 'profile-stock-chart';
  chart.setAttribute('aria-label', '최근 주가 흐름');
  const price = document.createElement('strong'); price.className = 'profile-stock-price';
  price.textContent = stock ? '불러오는 중…' : '종목 미등록';
  const change = document.createElement('span'); change.className = 'profile-stock-change';
  change.textContent = stock ? '0.00%' : '';
  const quote = document.createElement('span'); quote.className = 'profile-stock-quote';
  quote.append(price, change);
  const arrow = document.createElement('span'); arrow.className = 'profile-stock-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
  link.append(copy, chart, quote, arrow);

  if (stock) {
    const requestId = stockPriceSparklineRequest;
    let latestPrice = null;
    let history = [];
    let pendingTicks = [];
    let historySeeded = false;

    const recordPrice = (value) => {
      if (!history.length || history[history.length - 1] !== value) {
        history.push(value);
        if (history.length > 20) history.shift();
      }
    };
    const drawQuote = () => {
      const points = history.length >= 2
        ? history.slice(-20)
        : latestPrice === null ? [] : [latestPrice, latestPrice];
      if (points.length) {
        const min = Math.min(...points);
        const max = Math.max(...points);
        const range = max - min || 1;
        const coordinates = points.map((value, index) => {
          const x = points.length === 1 ? 2 : 2 + (index / (points.length - 1)) * 96;
          const y = 32 - ((value - min) / range) * 28;
          return `${x},${y}`;
        }).join(' ');
        const isUp = points[points.length - 1] >= points[0];
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 36');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('profile-stock-sparkline');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('points', coordinates);
        line.classList.add('profile-stock-sparkline-line', isUp ? 'is-up' : 'is-down');
        svg.append(line);
        chart.replaceChildren(svg);
        chart.classList.toggle('is-up', isUp);
        chart.classList.toggle('is-down', !isUp);
      }

      if (latestPrice !== null) price.textContent = `${latestPrice.toLocaleString('ko-KR')}원`;
      const baseline = history.length >= 2 ? history[0] : latestPrice;
      const latest = history.length >= 2 ? history[history.length - 1] : latestPrice;
      const percent = baseline > 0 && latest !== null ? ((latest - baseline) / baseline) * 100 : 0;
      const isUp = percent >= 0;
      change.textContent = `${isUp ? '+' : ''}${percent.toFixed(2)}%`;
      change.classList.toggle('is-up', isUp);
      change.classList.toggle('is-down', !isUp);
    };

    stockPriceUnsubscribe = onValue(ref(db, `stocksPublic/${stock.id}`), (snapshot) => {
      const value = snapshot.val();
      const currentPrice = Number(value && value.price);
      if (!snapshot.exists() || !value || value.price === null || value.price === '' || !Number.isFinite(currentPrice)) {
        price.textContent = '주가를 불러올 수 없어요';
        change.textContent = '';
        chart.replaceChildren();
        return;
      }
      latestPrice = currentPrice;
      if (historySeeded) recordPrice(currentPrice);
      else if (!pendingTicks.length || pendingTicks[pendingTicks.length - 1] !== currentPrice) {
        pendingTicks.push(currentPrice);
        if (pendingTicks.length > 20) pendingTicks.shift();
      }
      drawQuote();
      if (typeof value.name === 'string' && value.name.trim()) {
        meta.textContent = `${value.name.trim()} · 출처: 스트리머 주식시장`;
      }
    }, () => {
      price.textContent = '주가를 불러올 수 없어요';
      change.textContent = '';
      chart.replaceChildren();
    });

    get(ref(db, `sparklines/${stock.id}`)).then((snapshot) => {
      if (requestId !== stockPriceSparklineRequest) return;
      const saved = snapshot.val();
      history = Array.isArray(saved)
        ? saved.map(Number).filter((item) => Number.isFinite(item) && item > 0).slice(-20)
        : [];
      pendingTicks.forEach(recordPrice);
      pendingTicks = [];
      if (latestPrice !== null) recordPrice(latestPrice);
      historySeeded = true;
      drawQuote();
    }).catch(() => {
      if (requestId !== stockPriceSparklineRequest) return;
      historySeeded = true;
      pendingTicks.forEach(recordPrice);
      pendingTicks = [];
      if (latestPrice !== null) recordPrice(latestPrice);
      drawQuote();
    });
  } else {
    link.classList.add('is-unavailable');
    chart.hidden = true;
    change.hidden = true;
  }
  const attendance = document.createElement('a');
  attendance.className = 'button profile-stock-attendance';
  attendance.href = 'https://neezu-crypto.github.io/soop-stock-market/';
  attendance.target = '_blank';
  attendance.rel = 'noopener noreferrer';
  attendance.setAttribute('aria-label', '스트리머 주식시장에서 출석체크하고 게임머니 받기');
  const gift = document.createElement('span'); gift.className = 'profile-stock-attendance-gift';
  gift.setAttribute('aria-hidden', 'true'); gift.textContent = '🎁';
  const attendanceCopy = document.createElement('span'); attendanceCopy.className = 'profile-stock-attendance-copy';
  const attendanceLineOne = document.createElement('span'); attendanceLineOne.textContent = '출석체크하고';
  const attendanceLineTwo = document.createElement('span'); attendanceLineTwo.textContent = '게임머니 받기';
  attendanceCopy.append(attendanceLineOne, attendanceLineTwo);
  const attendanceArrow = document.createElement('span'); attendanceArrow.className = 'profile-stock-attendance-arrow';
  attendanceArrow.setAttribute('aria-hidden', 'true'); attendanceArrow.textContent = '↗';
  attendance.append(gift, attendanceCopy, attendanceArrow);
  module.append(link, attendance);
  return module;
}

function renderMessengerSection(page) {
  const soopId = String(page.streamer && page.streamer.soopId || '').trim();
  if (!/^[a-z0-9]{2,20}$/i.test(soopId)) return null;
  const isStreamerOwner = page.isStreamerOwner === true;

  const section = document.createElement('section');
  section.className = 'messenger-link-section';
  section.setAttribute('aria-labelledby', 'messengerLinkTitle');

  const copy = document.createElement('div');
  copy.className = 'messenger-link-copy';
  const icon = document.createElement('span');
  icon.className = 'messenger-link-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3.2A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01"/></svg>';

  const text = document.createElement('div');
  text.className = 'messenger-link-text';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'STREAMER MESSENGER';
  const title = document.createElement('h2');
  title.id = 'messengerLinkTitle';
  title.textContent = isStreamerOwner ? '내 메신저 채팅방' : '스트리머와 채팅하기';
  const description = document.createElement('p');
  description.className = 'messenger-link-description';
  description.textContent = isStreamerOwner
    ? '채팅방에서 팬들과 대화를 이어가 보세요.'
    : '팬들과 대화를 이어가 보세요.';
  const note = document.createElement('p');
  note.className = 'messenger-link-note';
  note.textContent = isStreamerOwner
    ? '채팅방이 없다면 메신저에서 먼저 만들어 주세요.'
    : '참여 가능 여부와 권한은 메신저에서 확인합니다.';
  text.append(eyebrow, title, description, note);
  copy.append(icon, text);

  const messengerUrl = new URL('https://neezu-crypto.github.io/streamer-messenger/');
  messengerUrl.searchParams.set('streamer', soopId.toLowerCase());
  const link = document.createElement('a');
  link.className = 'button button-primary messenger-link-button';
  link.href = messengerUrl.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = isStreamerOwner ? '메신저 관리 ↗' : '메신저 입장 ↗';

  section.append(copy, link);
  return section;
}

function formatVodDuration(durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) return '';
  const seconds = Math.floor(duration / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function liveStatusStateFor(streamerId) {
  if (!liveStatusStates.has(streamerId)) {
    liveStatusStates.set(streamerId, {
      hasLoaded: false, loading: false, error: '', isLive: false,
      title: '', viewerCount: 0, broadcastId: '', streamUrl: '', thumbnailUrl: '',
    });
  }
  return liveStatusStates.get(streamerId);
}

function renderLiveSection(page) {
  const state = liveStatusStateFor(page.streamer.id);
  const section = document.createElement('section'); section.id = 'liveSection'; section.className = 'live-section';
  const heading = document.createElement('div'); heading.className = 'live-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'LIVE SHORTCUT';
  const title = document.createElement('h2'); title.textContent = '라이브 바로가기';
  const subtitle = document.createElement('p'); subtitle.className = 'live-subtitle'; subtitle.textContent = '방송 중이면 미리보기 썸네일에서 바로 입장할 수 있어요.';
  copy.append(eyebrow, title, subtitle);
  const refresh = document.createElement('button'); refresh.type = 'button';
  refresh.className = 'button live-refresh-button'; refresh.disabled = state.loading;
  refresh.textContent = state.loading ? '확인 중…' : '↻ 상태 새로고침';
  refresh.setAttribute('aria-label', '라이브 상태 새로고침');
  refresh.dataset.liveFocus = 'refresh';
  refresh.addEventListener('click', () => loadLiveStatus(page.streamer.id));
  heading.append(copy, refresh);

  const content = document.createElement('div'); content.className = 'live-content';
  if (!state.hasLoaded && !state.error) {
    const message = document.createElement('p'); message.className = 'live-state-message';
    message.textContent = '현재 방송 상태를 확인하고 있어요.'; content.append(message);
  } else if (!state.hasLoaded) {
    const message = document.createElement('p'); message.className = 'live-state-message is-error';
    message.textContent = '방송 상태를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.'; content.append(message);
  } else if (state.isLive) {
    const card = document.createElement('div'); card.className = 'live-preview-card';
    const preview = document.createElement('a'); preview.className = 'live-preview-link';
    preview.dataset.liveFocus = 'preview';
    preview.href = state.streamUrl; preview.target = '_blank'; preview.rel = 'noopener noreferrer';
    preview.setAttribute('aria-label', `${page.streamer.nickname} 라이브 방송 보기`);
    const frame = document.createElement('span'); frame.className = 'live-thumbnail-frame';
    const image = document.createElement('img'); image.className = 'live-thumbnail';
    image.src = state.thumbnailUrl; image.alt = `${page.streamer.nickname} 방송 미리보기`; image.loading = 'lazy';
    image.addEventListener('error', () => frame.classList.add('has-no-thumbnail'), { once: true });
    const fallback = document.createElement('span'); fallback.className = 'live-thumbnail-fallback'; fallback.textContent = '미리보기 썸네일을 불러올 수 없어요.';
    const badge = document.createElement('span'); badge.className = 'live-badge'; badge.innerHTML = '<i aria-hidden="true"></i> LIVE';
    frame.append(image, fallback, badge); preview.append(frame);

    const details = document.createElement('div'); details.className = 'live-preview-details';
    const info = document.createElement('div'); info.className = 'live-preview-info';
    const liveStatus = document.createElement('span'); liveStatus.className = 'live-status-label'; liveStatus.textContent = '현재 방송 중';
    const broadcastTitle = document.createElement('strong'); broadcastTitle.className = 'live-broadcast-title';
    broadcastTitle.textContent = state.title || '방송을 진행하고 있어요.';
    const viewers = document.createElement('span'); viewers.className = 'live-viewer-count';
    viewers.textContent = `시청자 ${Number(state.viewerCount || 0).toLocaleString('ko-KR')}명`;
    info.append(liveStatus, broadcastTitle, viewers);
    const watch = document.createElement('a'); watch.className = 'button button-primary live-watch-button';
    watch.dataset.liveFocus = 'watch';
    watch.href = state.streamUrl; watch.target = '_blank'; watch.rel = 'noopener noreferrer'; watch.textContent = '방송 보러가기 ↗';
    details.append(info, watch); card.append(preview, details); content.append(card);
    if (state.error) {
      const warning = document.createElement('p'); warning.className = 'live-stale-note';
      warning.textContent = '방송 상태를 새로 확인하지 못해 이전 정보를 표시하고 있어요.'; content.append(warning);
    }
  } else {
    const offline = document.createElement('div'); offline.className = 'live-offline-card';
    const mark = document.createElement('span'); mark.className = 'live-offline-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '◷';
    const info = document.createElement('div'); info.className = 'live-offline-copy';
    const message = document.createElement('strong'); message.textContent = '방송이 종료되었어요.';
    const note = document.createElement('span'); note.textContent = '지금은 방송 중이 아닙니다. 다음 방송을 기다려 주세요.';
    info.append(message, note); offline.append(mark, info);
    const station = document.createElement('a'); station.className = 'button live-station-link';
    station.dataset.liveFocus = 'station';
    station.href = page.streamer.soopUrl; station.target = '_blank'; station.rel = 'noopener noreferrer'; station.textContent = 'SOOP 방송국 보기 ↗';
    offline.append(station); content.append(offline);
    if (state.error) {
      const warning = document.createElement('p'); warning.className = 'live-stale-note';
      warning.textContent = '방송 상태를 새로 확인하지 못해 이전 정보를 표시하고 있어요.'; content.append(warning);
    }
  }
  section.append(heading, content);
  return section;
}

async function loadLiveStatus(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const state = liveStatusStateFor(streamerId);
  if (state.loading) return;
  state.loading = true; state.error = '';
  const button = $('liveSection')?.querySelector('.live-refresh-button');
  if (button) { button.disabled = true; button.textContent = '확인 중…'; }
  try {
    const result = (await callLiveStatus({ streamerId })).data;
    if (!currentPage || currentPage.streamer.id !== streamerId) return;
    state.hasLoaded = true;
    state.isLive = result.isLive === true;
    state.title = typeof result.title === 'string' ? result.title : '';
    state.viewerCount = Number(result.viewerCount) || 0;
    state.broadcastId = typeof result.broadcastId === 'string' ? result.broadcastId : '';
    state.streamUrl = typeof result.streamUrl === 'string' ? result.streamUrl : '';
    state.thumbnailUrl = typeof result.thumbnailUrl === 'string' ? result.thumbnailUrl : '';
  } catch (_) {
    if (currentPage && currentPage.streamer.id === streamerId) state.error = 'unavailable';
  } finally {
    state.loading = false;
    if (currentPage && currentPage.streamer.id === streamerId) refreshLiveSection(streamerId);
  }
}

function refreshLiveSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('liveSection');
  if (section) {
    const active = section.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active && active.dataset.liveFocus;
    const replacement = renderLiveSection(currentPage);
    section.replaceWith(replacement);
    if (focusKey) {
      const focusTarget = [...replacement.querySelectorAll('[data-live-focus]')]
        .find((element) => element.dataset.liveFocus === focusKey)
        || replacement.querySelector('.live-refresh-button');
      focusTarget?.focus({ preventScroll: true });
    }
  }
}

function renderVodSection(page) {
  const vods = page.vods && Array.isArray(page.vods.items)
    ? {
      ...page.vods,
      items: page.vods.items.slice(0, MAX_LOADED_VIDEO_ITEMS),
      available: Math.min(MAX_LOADED_VIDEO_ITEMS, Number(page.vods.available ?? page.vods.total) || 0),
    }
    : { items: [], total: 0, available: 0, refreshedAt: null, generation: '', nextOffset: 0, hasMore: false };
  const streamerId = page.streamer.id;
  const isRefreshing = vodRefreshesInProgress.has(streamerId);
  const isLoadingMore = vodPageLoadsInProgress.has(streamerId);
  const section = document.createElement('section');
  section.className = 'vod-section content-card';
  section.id = 'vodSection';

  const heading = document.createElement('div');
  heading.className = 'vod-heading';
  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'SOOP REPLAYS';
  const title = document.createElement('h2'); title.textContent = '방송 다시보기';
  const count = document.createElement('span'); count.className = 'vod-count'; count.textContent = `전체 ${vods.total.toLocaleString('ko-KR')}개`;
  headingCopy.append(eyebrow, title, count);
  heading.append(headingCopy);

  if (page.isOwner) {
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.className = 'button button-primary vod-refresh-button';
    refresh.textContent = isRefreshing ? '다시보기를 불러오는 중…' : isLoadingMore ? '목록을 불러오는 중…' : '↻ 목록 갱신';
    refresh.disabled = isRefreshing || isLoadingMore;
    refresh.addEventListener('click', async () => {
      if (vodRefreshesInProgress.has(streamerId) || vodPageLoadsInProgress.has(streamerId)) return;
      vodRefreshesInProgress.add(streamerId);
      refresh.disabled = true;
      refresh.textContent = '다시보기를 불러오는 중…';
      replaceVodSectionIfCurrent(streamerId);
      try {
        const result = await callVodRefresh({ streamerId });
        if (result.data && result.data.inProgress) {
          if (currentPage && currentPage.streamer.id === streamerId) {
            showToast('다시보기 목록을 갱신 중이에요. 완료 후 다시 시도해 주세요.');
          }
          return;
        }
        page.vods = result.data.vods;
        if (currentPage && currentPage.streamer.id === streamerId) {
          currentPage.vods = result.data.vods;
          const loadedCount = Number(page.vods.available) || page.vods.items.length;
          showToast(page.vods.total > loadedCount
            ? `최근 다시보기 ${loadedCount.toLocaleString('ko-KR')}개를 불러왔어요. 전체 ${page.vods.total.toLocaleString('ko-KR')}개 중이에요.`
            : `다시보기 ${loadedCount.toLocaleString('ko-KR')}개를 갱신했어요.`);
        }
      } catch (error) {
        if (currentPage && currentPage.streamer.id === streamerId) {
          showToast(error.message || '다시보기 목록을 갱신하지 못했어요.');
        }
      } finally {
        vodRefreshesInProgress.delete(streamerId);
        replaceVodSectionIfCurrent(streamerId);
      }
    });
    heading.append(refresh);
  }

  const status = document.createElement('p'); status.className = 'vod-refresh-status';
  status.textContent = vods.refreshedAt
    ? `마지막 갱신 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(vods.refreshedAt))}`
    : '아직 갱신된 다시보기 목록이 없어요.';
  section.append(heading, status);
  if (vods.total > vods.available) {
    const limitNote = document.createElement('p'); limitNote.className = 'vod-refresh-status';
    limitNote.textContent = `최근 영상 ${vods.available}개까지만 표시해요.`;
    section.append(limitNote);
  }

  if (!vods.items.length) {
    const empty = document.createElement('p'); empty.className = 'vod-empty-state';
    empty.textContent = page.isOwner
      ? '목록 갱신을 눌러 SOOP 다시보기를 가져오세요.'
      : '스트리머가 다시보기 목록을 갱신하면 여기에 표시돼요.';
    section.append(empty);
    return section;
  }

  const scrollbox = document.createElement('div'); scrollbox.className = 'vod-scrollbox';
  const grid = document.createElement('div'); grid.className = 'vod-grid';
  vods.items.forEach((vod) => {
    if (!vod || !/^\d{1,20}$/.test(String(vod.id || ''))) return;
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'vod-card';
    card.setAttribute('aria-label', `${vod.title || '제목 없음'} 재생`);
    card.addEventListener('click', () => openVodPlayer(vod));
    const imageFrame = document.createElement('span'); imageFrame.className = 'vod-thumbnail-frame';
    if (vod.thumbnailUrl) {
      const image = document.createElement('img'); image.className = 'vod-thumbnail';
      image.src = vod.thumbnailUrl; image.alt = ''; image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); imageFrame.classList.add('vod-thumbnail-missing'); }, { once: true });
      imageFrame.append(image);
    } else imageFrame.classList.add('vod-thumbnail-missing');
    const duration = formatVodDuration(vod.durationMs);
    if (duration) {
      const badge = document.createElement('span'); badge.className = 'vod-duration'; badge.textContent = duration;
      imageFrame.append(badge);
    }
    const copy = document.createElement('span'); copy.className = 'vod-copy';
    const vodTitle = document.createElement('strong'); vodTitle.className = 'vod-title'; vodTitle.textContent = vod.title || '제목 없음';
    const metadata = document.createElement('span'); metadata.className = 'vod-metadata';
    const date = document.createElement('span'); date.textContent = vod.regDate || '';
    const views = document.createElement('span'); views.textContent = `조회 ${Math.max(0, Number(vod.readCount) || 0).toLocaleString('ko-KR')}`;
    metadata.append(date, views); copy.append(vodTitle, metadata); card.append(imageFrame, copy); grid.append(card);
  });
  scrollbox.append(grid);
  if (vods.hasMore) {
    const moreRow = document.createElement('div'); moreRow.className = 'vod-more-row';
    const more = document.createElement('button'); more.type = 'button'; more.className = 'button vod-more-button';
    const loading = vodPageLoadsInProgress.has(streamerId);
    const refreshing = vodRefreshesInProgress.has(streamerId);
    more.disabled = loading || refreshing;
    more.textContent = loading ? '목록을 불러오는 중…' : refreshing ? '다시보기 갱신 중…' : `더 보기 (${Math.max(0, vods.available - vods.items.length).toLocaleString('ko-KR')}개 남음)`;
    more.addEventListener('click', () => loadMoreVods(streamerId, vods));
    moreRow.append(more); scrollbox.append(moreRow);
  }
  section.append(scrollbox);
  return section;
}

function youtubeStateFor(streamerId) {
  if (!youtubeStates.has(streamerId)) {
    youtubeStates.set(streamerId, { loading: false, hasLoaded: false, error: '', stale: false, data: null });
  }
  return youtubeStates.get(streamerId);
}

function renderYouTubeSection(page) {
  const channelUrl = String(page.profile && page.profile.youtubeChannelUrl || '').trim();
  const streamerId = page.streamer.id;
  const state = youtubeStateFor(streamerId);
  const editor = page.isOwner ? createProfileLinkEditor(page, 'youtubeChannelUrl', {
    label: 'YouTube 채널 링크', placeholder: 'https://www.youtube.com/@채널명',
    note: '채널 또는 사용자 URL을 입력하면 공개 영상 목록을 표시합니다.', value: channelUrl,
  }) : null;
  const section = document.createElement('section');
  section.className = 'youtube-section content-card';
  section.id = 'youtubeSection';

  const heading = document.createElement('div'); heading.className = 'youtube-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'YOUTUBE VIDEOS';
  const title = document.createElement('h2'); title.textContent = 'YouTube 영상';
  const count = document.createElement('span'); count.className = 'vod-count';
  count.textContent = channelUrl && state.data ? `전체 ${Number(state.data.totalCount || 0).toLocaleString('ko-KR')}개` : '';
  copy.append(eyebrow, title, count);

  const actions = document.createElement('div'); actions.className = 'youtube-heading-actions';
  if (channelUrl) {
    const channel = document.createElement('a'); channel.className = 'button youtube-channel-link';
    channel.href = channelUrl; channel.target = '_blank'; channel.rel = 'noopener noreferrer';
    channel.textContent = '채널 보기 ↗';
    actions.append(channel);
  }
  if (editor && editor.toggleButton) actions.append(editor.toggleButton);
  if (page.isOwner && channelUrl) {
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'button youtube-refresh-button';
    refresh.dataset.youtubeFocus = 'refresh';
    refresh.disabled = state.loading;
    refresh.textContent = state.loading ? '목록 확인 중…' : '↻ 영상 목록 갱신';
    refresh.addEventListener('click', () => loadYouTubeVideos(streamerId, true));
    actions.append(refresh);
  }
  heading.append(copy, actions);
  section.append(heading);

  if (!channelUrl) {
    const empty = document.createElement('p');
    empty.className = 'profile-link-empty-state';
    empty.textContent = 'YouTube 채널 링크가 아직 등록되지 않았어요.';
    section.append(empty);
    if (editor) section.append(editor.element);
    return section;
  }
  if (editor) section.append(editor.element);

  const status = document.createElement('p'); status.className = 'youtube-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  if (state.loading && !state.hasLoaded) {
    status.textContent = '최신 영상을 불러오고 있어요.';
    section.append(status);
    return section;
  }
  if (state.error && !state.hasLoaded) {
    status.classList.add('is-error');
    const message = document.createElement('span'); message.textContent = state.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button youtube-retry-button';
    retry.textContent = '다시 불러오기'; retry.addEventListener('click', () => loadYouTubeVideos(streamerId));
    status.append(message, retry); section.append(status);
    return section;
  }
  if (state.stale) {
    status.classList.add('is-stale'); status.textContent = 'YouTube에 연결하지 못해 이전 목록을 표시하고 있어요.';
    section.append(status);
  }
  const videos = state.data && Array.isArray(state.data.items)
    ? state.data.items.slice(0, MAX_LOADED_VIDEO_ITEMS)
    : [];
  if (!videos.length) {
    const empty = document.createElement('p'); empty.className = 'youtube-empty-state';
    empty.textContent = state.hasLoaded ? '아직 공개된 YouTube 영상이 없어요.' : '최신 영상을 불러오고 있어요.';
    section.append(empty);
    return section;
  }

  const scrollbox = document.createElement('div'); scrollbox.className = 'youtube-scrollbox vod-scrollbox';
  const grid = document.createElement('div'); grid.className = 'youtube-grid vod-grid';
  videos.forEach((video) => {
    if (!video || !/^[A-Za-z0-9_-]{11}$/.test(String(video.id || ''))) return;
    const card = document.createElement('button'); card.type = 'button'; card.className = 'vod-card youtube-video-card';
    card.setAttribute('aria-label', `${video.title || 'YouTube 영상'} 재생`);
    card.addEventListener('click', () => openYouTubePlayer(video));
    const frame = document.createElement('span'); frame.className = 'vod-thumbnail-frame youtube-thumbnail-frame';
    const image = document.createElement('img'); image.className = 'vod-thumbnail';
    image.src = video.thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`;
    image.alt = ''; image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); frame.classList.add('youtube-thumbnail-missing'); }, { once: true });
    const play = document.createElement('span'); play.className = 'youtube-play-mark'; play.setAttribute('aria-hidden', 'true'); play.textContent = '▶';
    frame.append(image, play);
    const body = document.createElement('span'); body.className = 'vod-copy';
    const videoTitle = document.createElement('strong'); videoTitle.className = 'vod-title'; videoTitle.textContent = video.title || '제목 없음';
    const metadata = document.createElement('span'); metadata.className = 'vod-metadata';
    const date = document.createElement('span');
    const publishedAt = Date.parse(video.publishedAt || '');
    date.textContent = Number.isFinite(publishedAt)
      ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(publishedAt))
      : '날짜 정보 없음';
    const platform = document.createElement('span'); platform.textContent = 'YouTube';
    metadata.append(date, platform); body.append(videoTitle, metadata); card.append(frame, body); grid.append(card);
  });
  scrollbox.append(grid); section.append(scrollbox);
  return section;
}

function renderSongbookSection(page) {
  const state = fanPageContentStateFor(page.streamer.id);
  const entries = Array.isArray(page.songbook) ? page.songbook : state.songbook;
  const section = document.createElement('section');
  section.className = 'songbook-section content-card';
  section.id = 'songbookSection';

  const heading = document.createElement('div'); heading.className = 'songbook-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'SONGBOOK';
  const title = document.createElement('h2'); title.textContent = '노래책';
  const count = document.createElement('span'); count.className = 'songbook-count';
  count.textContent = `${entries.length.toLocaleString('ko-KR')}곡`;
  copy.append(eyebrow, title, count); heading.append(copy); section.append(heading);

  const description = document.createElement('p'); description.className = 'songbook-description';
  description.textContent = '스트리머가 부를 수 있는 노래를 모아뒀어요. 곡을 누르면 팬페이지 안에서 재생됩니다.';
  section.append(description);

  if (page.isOwner) {
    const form = document.createElement('form'); form.className = 'songbook-add-form';
    const input = document.createElement('input'); input.type = 'url'; input.name = 'youtubeUrl';
    input.required = true; input.maxLength = 500; input.placeholder = 'https://www.youtube.com/watch?v=…';
    input.setAttribute('aria-label', '추가할 YouTube 노래 링크');
    const add = document.createElement('button'); add.type = 'submit'; add.className = 'button button-primary';
    add.textContent = '＋ 노래 추가';
    form.append(input, add);
    const hint = document.createElement('small'); hint.className = 'songbook-owner-hint';
    hint.textContent = 'YouTube 영상 링크를 붙여 넣으면 제목과 썸네일을 불러옵니다. 최대 500곡까지 등록할 수 있어요.';
    form.append(hint);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (form.reportValidity()) addSongbookEntry(page, input, add);
    });
    section.append(form);
  }

  if (!entries.length) {
    const empty = document.createElement('p'); empty.className = 'songbook-empty-state';
    if (!state.songbookLoaded) {
      if (state.songbookLoading) empty.textContent = '노래 목록을 불러오고 있어요.';
      else if (state.songbookError) {
        empty.textContent = state.songbookError;
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button songbook-retry-button';
        retry.textContent = '다시 불러오기'; retry.addEventListener('click', () => loadSongbookEntries(page));
        section.append(empty, retry);
        return section;
      } else empty.textContent = '노래 목록을 불러옵니다.';
    } else {
      empty.textContent = page.isOwner ? '아직 등록한 노래가 없어요. YouTube 링크를 추가해 보세요.' : '아직 등록된 노래가 없어요.';
    }
    section.append(empty);
    return section;
  }

  const list = document.createElement('div'); list.className = 'songbook-list';
  entries.forEach((entry) => {
    if (!entry || !/^[A-Za-z0-9_-]{11}$/.test(String(entry.id || ''))) return;
    const row = document.createElement('div'); row.className = 'songbook-row';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'songbook-entry';
    play.setAttribute('aria-label', `${entry.title || '노래'} 재생`);
    play.addEventListener('click', () => openYouTubePlayer({ id: entry.id, title: entry.title }));
    const frame = document.createElement('span'); frame.className = 'songbook-thumbnail-frame';
    const image = document.createElement('img'); image.className = 'songbook-thumbnail';
    image.src = entry.thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(entry.id)}/mqdefault.jpg`;
    image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('error', () => { image.remove(); frame.classList.add('is-missing'); }, { once: true });
    frame.append(image);
    const details = document.createElement('span'); details.className = 'songbook-entry-details';
    const songTitle = document.createElement('strong'); songTitle.textContent = entry.title || '제목 없음';
    const source = document.createElement('span'); source.textContent = 'YouTube · 팬페이지에서 재생';
    details.append(songTitle, source); play.append(frame, details); row.append(play);
    if (page.isOwner) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button songbook-delete-button';
      remove.textContent = '삭제'; remove.setAttribute('aria-label', `${entry.title || '노래'} 삭제`);
      remove.addEventListener('click', () => deleteSongbookEntry(page, entry.id, remove));
      row.append(remove);
    }
    list.append(row);
  });
  section.append(list);
  return section;
}

async function addSongbookEntry(page, input, button) {
  if (!page.isOwner || button.disabled) return;
  button.disabled = true; button.textContent = '영상 확인 중…';
  try {
    const result = (await callSongbook({ action: 'add', streamerId: page.streamer.id, youtubeUrl: input.value.trim() })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.songbook = rememberFanPageContent(page.streamer.id, 'songbook', result.songbook, true);
    refreshSongbookSection(page.streamer.id);
    showToast('노래를 노래책에 추가했어요.');
  } catch (error) {
    showToast(error.message || '노래를 추가하지 못했어요.');
  } finally {
    button.disabled = false; button.textContent = '＋ 노래 추가';
  }
}

async function deleteSongbookEntry(page, videoId, button) {
  if (!page.isOwner || button.disabled || !confirm('이 노래를 노래책에서 삭제할까요?')) return;
  button.disabled = true;
  try {
    const result = (await callSongbook({ action: 'delete', streamerId: page.streamer.id, videoId })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.songbook = rememberFanPageContent(page.streamer.id, 'songbook', result.songbook, true);
    refreshSongbookSection(page.streamer.id);
    showToast('노래를 노래책에서 삭제했어요.');
  } catch (error) {
    showToast(error.message || '노래를 삭제하지 못했어요.');
    button.disabled = false;
  }
}

function refreshSongbookSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('songbookSection');
  if (section) section.replaceWith(renderSongbookSection(currentPage));
}

function fanPageContentStateFor(streamerId) {
  let state = fanPageContentStates.get(streamerId);
  if (!state) {
    state = {
      songbook: [], songbookLoaded: false, songbookLoading: false, songbookError: '', songbookRevision: 0,
      playedGames: [], playedGamesLoaded: false, playedGamesLoading: false, playedGamesError: '', playedGamesRevision: 0,
    };
    fanPageContentStates.set(streamerId, state);
  }
  return state;
}

function rememberFanPageContent(streamerId, key, value, changed = false) {
  const state = fanPageContentStateFor(streamerId);
  state[key] = Array.isArray(value) ? value : [];
  state[`${key}Loaded`] = true;
  state[`${key}Error`] = '';
  if (changed) state[`${key}Revision`] += 1;
  return state[key];
}

function loadFanPageContent(page) {
  const state = fanPageContentStateFor(page.streamer.id);
  if (state.songbookLoaded) page.songbook = state.songbook;
  else loadSongbookEntries(page);
  if (state.playedGamesLoaded) page.playedGames = state.playedGames;
  else loadPlayedGames(page);
  if (page.profile && page.profile.youtubeChannelUrl) loadYouTubeVideos(page.streamer.id);
  if (page.profile && page.profile.cafeUrl) loadCafePosts(page.streamer.id);
}

async function loadSongbookEntries(page) {
  const streamerId = page.streamer.id;
  const state = fanPageContentStateFor(streamerId);
  if (state.songbookLoaded || state.songbookLoading) return;
  const revision = state.songbookRevision;
  state.songbookLoading = true; state.songbookError = '';
  refreshSongbookSection(streamerId);
  try {
    const result = (await callSongbook({ action: 'list', streamerId })).data;
    const entries = Array.isArray(result.songbook) ? result.songbook : [];
    if (state.songbookRevision === revision) rememberFanPageContent(streamerId, 'songbook', entries);
  } catch (error) {
    state.songbookError = error.message || '노래 목록을 불러오지 못했어요.';
  } finally {
    state.songbookLoading = false;
    if (currentPage && currentPage.streamer.id === streamerId) {
      currentPage.songbook = state.songbook;
      refreshSongbookSection(streamerId);
    }
  }
}

function renderPlayedGamesSection(page) {
  const state = fanPageContentStateFor(page.streamer.id);
  const games = Array.isArray(page.playedGames) ? page.playedGames : state.playedGames;
  const section = document.createElement('section');
  section.className = 'played-games-section content-card';
  section.id = 'playedGamesSection';

  const heading = document.createElement('div'); heading.className = 'played-games-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'PLAYED GAMES';
  const title = document.createElement('h2'); title.textContent = '플레이한 게임';
  const count = document.createElement('span'); count.className = 'played-games-count';
  count.textContent = `${games.length.toLocaleString('ko-KR')}개`;
  copy.append(eyebrow, title, count); heading.append(copy); section.append(heading);

  const description = document.createElement('p'); description.className = 'played-games-description';
  description.textContent = '함께 플레이한 게임과 다시보기를 모아뒀어요.';
  section.append(description);

  if (page.isOwner) {
    const form = document.createElement('form'); form.className = 'played-games-add-form';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.name = 'gameName';
    nameInput.maxLength = 100; nameInput.placeholder = '게임 이름 (Steam은 자동으로 가져와요)';
    nameInput.setAttribute('aria-label', '추가할 게임 이름');
    const linkInput = document.createElement('input'); linkInput.type = 'url'; linkInput.name = 'gameUrl';
    linkInput.required = true; linkInput.maxLength = 500; linkInput.placeholder = 'Steam 등 게임 페이지 링크';
    linkInput.setAttribute('aria-label', '추가할 게임 링크');
    const add = document.createElement('button'); add.type = 'submit'; add.className = 'button button-primary';
    add.textContent = '＋ 게임 추가';
    form.append(nameInput, linkInput, add);
    const hint = document.createElement('small'); hint.className = 'played-games-owner-hint';
    hint.textContent = 'Steam은 이름과 썸네일을 자동으로 가져오고, 다른 게임은 이름과 HTTPS 링크를 직접 입력해 주세요. 게임마다 SOOP 다시보기를 연결할 수 있어요.';
    form.append(hint);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (form.reportValidity()) addPlayedGame(page, nameInput, linkInput, add);
    });
    section.append(form);
  }

  if (!games.length) {
    const empty = document.createElement('p'); empty.className = 'played-games-empty-state';
    if (!state.playedGamesLoaded) {
      if (state.playedGamesLoading) empty.textContent = '플레이한 게임 목록을 불러오고 있어요.';
      else if (state.playedGamesError) {
        empty.textContent = state.playedGamesError;
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button played-games-retry-button';
        retry.textContent = '다시 불러오기'; retry.addEventListener('click', () => loadPlayedGames(page));
        section.append(empty, retry);
        return section;
      } else empty.textContent = '플레이한 게임 목록을 불러옵니다.';
    } else {
      empty.textContent = page.isOwner ? '아직 추가한 게임이 없어요. 게임 링크로 첫 게임을 등록해 보세요.' : '아직 등록된 게임이 없어요.';
    }
    section.append(empty);
    return section;
  }

  const grid = document.createElement('div'); grid.className = 'played-games-grid';
  const cachedVods = page.vods && Array.isArray(page.vods.items) ? page.vods.items : [];
  games.forEach((game) => {
    const appId = String(game && game.appId || '');
    if (!/^(?:[1-9]\d{0,9}|custom_[a-f0-9]{32})$/.test(appId)) return;
    const card = document.createElement('article'); card.className = 'played-game-card';
    const top = document.createElement('div'); top.className = 'played-game-main';
    const link = document.createElement('a'); link.className = 'played-game-steam-link';
    link.href = typeof game.gameUrl === 'string' && /^https:\/\//i.test(game.gameUrl) ? game.gameUrl : '#';
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${game.name || '게임'} 게임 페이지 열기`);
    const frame = document.createElement('span'); frame.className = 'played-game-thumbnail-frame';
    if (typeof game.thumbnailUrl === 'string' && /^https:\/\/(?:[^/]+\.)?steamstatic\.com\//i.test(game.thumbnailUrl)) {
      const image = document.createElement('img'); image.className = 'played-game-thumbnail';
      image.src = game.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => { image.remove(); frame.classList.add('is-missing'); }, { once: true });
      frame.append(image);
    } else {
      frame.classList.add('is-missing');
      frame.dataset.label = game.isSteam ? 'STEAM GAME' : 'GAME';
    }
    const details = document.createElement('span'); details.className = 'played-game-details';
    const name = document.createElement('strong'); name.textContent = game.name || 'Steam 게임';
    const shortcut = document.createElement('span'); shortcut.textContent = game.isSteam ? 'Steam에서 게임 보기 ↗' : '게임 링크 열기 ↗';
    details.append(name, shortcut); link.append(frame, details); top.append(link);
    if (page.isOwner) {
      const removeGame = document.createElement('button'); removeGame.type = 'button';
      removeGame.className = 'button played-game-delete-button'; removeGame.textContent = '삭제';
      removeGame.setAttribute('aria-label', `${game.name || '게임'} 삭제`);
      removeGame.addEventListener('click', () => deletePlayedGame(page, appId, removeGame));
      top.append(removeGame);
    }
    card.append(top);

    const record = game.bestRecord && typeof game.bestRecord === 'object' ? game.bestRecord : null;
    if (record || page.isOwner) {
    const recordSection = document.createElement('div'); recordSection.className = 'played-game-record';
    const recordCopy = document.createElement('div'); recordCopy.className = 'played-game-record-copy';
    const recordLabel = document.createElement('span'); recordLabel.className = 'played-game-record-label';
    const recordValue = document.createElement('strong'); recordValue.className = 'played-game-record-value';
    if (record && ['rank', 'record'].includes(record.type) && typeof record.value === 'string' && record.value.trim()) {
      recordLabel.textContent = record.type === 'rank' ? '최고랭크' : '최고기록';
      recordValue.textContent = record.value;
      recordCopy.append(recordLabel, recordValue);
    } else {
      recordCopy.classList.add('is-empty');
      recordCopy.textContent = '최고기록이나 최고랭크를 등록해 보세요.';
    }
    recordSection.append(recordCopy);
    if (page.isOwner) {
      const editor = document.createElement('form'); editor.className = 'played-game-record-editor'; editor.hidden = true;
      const type = document.createElement('select'); type.name = 'recordType'; type.setAttribute('aria-label', '기록 종류');
      [['record', '최고기록'], ['rank', '최고랭크']].forEach(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label;
        if (record && record.type === value) option.selected = true;
        type.append(option);
      });
      const value = document.createElement('input'); value.type = 'text'; value.name = 'recordValue';
      value.maxLength = 100; value.value = record && typeof record.value === 'string' ? record.value : '';
      value.placeholder = '예: 다이아몬드 2 또는 12,500점'; value.setAttribute('aria-label', `${game.name || '게임'} 최고기록 또는 최고랭크`);
      const actions = document.createElement('div'); actions.className = 'played-game-record-actions';
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = '저장';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소';
      cancel.addEventListener('click', () => { editor.hidden = true; recordSection.querySelector('.played-game-record-edit').hidden = false; });
      actions.append(save, cancel);
      const hint = document.createElement('small'); hint.textContent = '내용을 비우고 저장하면 기록을 삭제해요.';
      editor.append(type, value, actions, hint);
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button played-game-record-edit';
      edit.textContent = record ? '기록 수정' : '기록 추가';
      edit.addEventListener('click', () => { edit.hidden = true; editor.hidden = false; value.focus(); });
      editor.addEventListener('submit', (event) => {
        event.preventDefault(); savePlayedGameRecord(page, appId, type, value, save);
      });
      recordSection.append(edit, editor);
    }
    card.append(recordSection);
    }

    const vods = Array.isArray(game.vods) ? game.vods : [];
    const vodHeading = document.createElement('div'); vodHeading.className = 'played-game-vods-heading';
    const vodLabel = document.createElement('strong'); vodLabel.textContent = '다시보기';
    const vodCount = document.createElement('span'); vodCount.textContent = `${vods.length}개`;
    vodHeading.append(vodLabel, vodCount); card.append(vodHeading);
    if (vods.length) {
      const vodList = document.createElement('ul'); vodList.className = 'played-game-vod-list';
      vods.forEach((vodEntry) => {
        const vodId = String(vodEntry && vodEntry.id || '');
        if (!/^\d{1,20}$/.test(vodId)) return;
        const vodData = cachedVods.find((item) => String(item && item.id) === vodId);
        const item = document.createElement('li'); item.className = 'played-game-vod-item';
        const vodLink = document.createElement('a'); vodLink.href = `https://vod.sooplive.com/player/${encodeURIComponent(vodId)}`;
        vodLink.target = '_blank'; vodLink.rel = 'noopener noreferrer';
        vodLink.textContent = vodData && vodData.title && vodData.title !== '제목 없음' ? vodData.title : `다시보기 #${vodId}`;
        vodLink.setAttribute('aria-label', `${vodLink.textContent} 열기`);
        item.append(vodLink);
        if (page.isOwner) {
          const removeVod = document.createElement('button'); removeVod.type = 'button';
          removeVod.className = 'played-game-vod-delete'; removeVod.textContent = '×';
          removeVod.setAttribute('aria-label', `다시보기 #${vodId} 삭제`);
          removeVod.addEventListener('click', () => deletePlayedGameVod(page, appId, vodId, removeVod));
          item.append(removeVod);
        }
        vodList.append(item);
      });
      card.append(vodList);
    } else {
      const noVods = document.createElement('p'); noVods.className = 'played-game-no-vods';
      noVods.textContent = '연결된 다시보기가 없어요.';
      card.append(noVods);
    }
    if (page.isOwner) {
      const vodForm = document.createElement('form'); vodForm.className = 'played-game-vod-form';
      const vodInput = document.createElement('input'); vodInput.type = 'url'; vodInput.name = 'vodUrl';
      vodInput.required = true; vodInput.maxLength = 500; vodInput.placeholder = 'SOOP 다시보기 링크';
      vodInput.setAttribute('aria-label', `${game.name || '게임'}에 연결할 SOOP 다시보기 링크`);
      const addVod = document.createElement('button'); addVod.type = 'submit'; addVod.className = 'button'; addVod.textContent = '링크 연결';
      vodForm.append(vodInput, addVod);
      vodForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (vodForm.reportValidity()) addPlayedGameVod(page, appId, vodInput, addVod);
      });
      card.append(vodForm);
    }
    grid.append(card);
  });
  section.append(grid);
  return section;
}

async function addPlayedGame(page, nameInput, linkInput, button) {
  if (!page.isOwner || button.disabled) return;
  button.disabled = true; button.textContent = '게임 확인 중…';
  try {
    const result = (await callPlayedGames({
      action: 'add-game', streamerId: page.streamer.id,
      gameName: nameInput.value.trim(), gameUrl: linkInput.value.trim(),
    })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.playedGames = rememberFanPageContent(page.streamer.id, 'playedGames', result.playedGames, true);
    refreshPlayedGamesSection(page.streamer.id);
    showToast('플레이한 게임을 추가했어요.');
  } catch (error) {
    showToast(error.message || '게임을 추가하지 못했어요.');
  } finally {
    button.disabled = false; button.textContent = '＋ 게임 추가';
  }
}

async function addPlayedGameVod(page, appId, input, button) {
  if (!page.isOwner || button.disabled) return;
  button.disabled = true; button.textContent = '연결 중…';
  try {
    const result = (await callPlayedGames({ action: 'add-vod', streamerId: page.streamer.id, appId, vodUrl: input.value.trim() })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.playedGames = rememberFanPageContent(page.streamer.id, 'playedGames', result.playedGames, true);
    refreshPlayedGamesSection(page.streamer.id);
    showToast('다시보기를 게임에 연결했어요.');
  } catch (error) {
    showToast(error.message || '다시보기를 연결하지 못했어요.');
  } finally {
    button.disabled = false; button.textContent = '링크 연결';
  }
}

async function savePlayedGameRecord(page, appId, type, input, button) {
  if (!page.isOwner || button.disabled) return;
  button.disabled = true; button.textContent = '저장 중…';
  try {
    const result = (await callPlayedGames({
      action: 'set-record', streamerId: page.streamer.id, appId,
      recordType: type.value, recordValue: input.value.trim(),
    })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.playedGames = rememberFanPageContent(page.streamer.id, 'playedGames', result.playedGames, true);
    refreshPlayedGamesSection(page.streamer.id);
    showToast(input.value.trim() ? '게임 최고기록을 저장했어요.' : '게임 최고기록을 삭제했어요.');
  } catch (error) {
    showToast(error.message || '게임 최고기록을 저장하지 못했어요.');
    button.disabled = false; button.textContent = '저장';
  }
}

async function deletePlayedGame(page, appId, button) {
  if (!page.isOwner || button.disabled || !confirm('이 게임과 연결된 다시보기를 모두 삭제할까요?')) return;
  button.disabled = true;
  try {
    const result = (await callPlayedGames({ action: 'delete-game', streamerId: page.streamer.id, appId })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.playedGames = rememberFanPageContent(page.streamer.id, 'playedGames', result.playedGames, true);
    refreshPlayedGamesSection(page.streamer.id);
    showToast('게임을 삭제했어요.');
  } catch (error) {
    showToast(error.message || '게임을 삭제하지 못했어요.');
    button.disabled = false;
  }
}

async function deletePlayedGameVod(page, appId, vodId, button) {
  if (!page.isOwner || button.disabled || !confirm('이 다시보기 링크를 삭제할까요?')) return;
  button.disabled = true;
  try {
    const result = (await callPlayedGames({ action: 'delete-vod', streamerId: page.streamer.id, appId, vodId })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    currentPage.playedGames = rememberFanPageContent(page.streamer.id, 'playedGames', result.playedGames, true);
    refreshPlayedGamesSection(page.streamer.id);
    showToast('다시보기 링크를 삭제했어요.');
  } catch (error) {
    showToast(error.message || '다시보기를 삭제하지 못했어요.');
    button.disabled = false;
  }
}

function refreshPlayedGamesSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('playedGamesSection');
  if (section) section.replaceWith(renderPlayedGamesSection(currentPage));
}

async function loadPlayedGames(page) {
  const streamerId = page.streamer.id;
  const state = fanPageContentStateFor(streamerId);
  if (state.playedGamesLoaded || state.playedGamesLoading) return;
  const revision = state.playedGamesRevision;
  state.playedGamesLoading = true; state.playedGamesError = '';
  refreshPlayedGamesSection(streamerId);
  try {
    const result = (await callPlayedGames({ action: 'list', streamerId })).data;
    const entries = Array.isArray(result.playedGames) ? result.playedGames : [];
    if (state.playedGamesRevision === revision) rememberFanPageContent(streamerId, 'playedGames', entries);
  } catch (error) {
    state.playedGamesError = error.message || '플레이한 게임 목록을 불러오지 못했어요.';
  } finally {
    state.playedGamesLoading = false;
    if (currentPage && currentPage.streamer.id === streamerId) {
      currentPage.playedGames = state.playedGames;
      refreshPlayedGamesSection(streamerId);
    }
  }
}

function fanPageMemoryStateFor(streamerId) {
  let state = fanPageMemoryStates.get(streamerId);
  if (!state) {
    state = { saving: false, deletingId: '', memories: [], loaded: false, loading: false, error: '', revision: 0 };
    fanPageMemoryStates.set(streamerId, state);
  }
  return state;
}

function renderMemoriesSection(page) {
  const state = fanPageMemoryStateFor(page.streamer.id);
  const memories = Array.isArray(page.memories) ? page.memories : state.memories;
  const section = document.createElement('section');
  section.className = 'memory-moments-section content-card';
  section.id = 'memoryMomentsSection';

  const heading = document.createElement('div'); heading.className = 'memory-moments-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'MEMORY MOMENTS';
  const title = document.createElement('h2'); title.textContent = '기억의 순간';
  const count = document.createElement('span'); count.className = 'memory-moments-count';
  count.textContent = `${memories.length.toLocaleString('ko-KR')}개`;
  copy.append(eyebrow, title, count); heading.append(copy); section.append(heading);

  const description = document.createElement('p'); description.className = 'memory-moments-description';
  description.textContent = '100일, 200일 방송처럼 오래 간직하고 싶은 기념 다시보기를 모아뒀어요.';
  section.append(description);

  if (page.isOwner) {
    const form = document.createElement('form'); form.className = 'memory-moments-form';
    const momentTitle = document.createElement('input'); momentTitle.type = 'text'; momentTitle.name = 'title';
    momentTitle.required = true; momentTitle.maxLength = 80; momentTitle.placeholder = '예: 100일 방송 다시보기';
    momentTitle.setAttribute('aria-label', '기억의 순간 제목');
    const videoUrl = document.createElement('input'); videoUrl.type = 'url'; videoUrl.name = 'url';
    videoUrl.required = true; videoUrl.maxLength = 500; videoUrl.placeholder = 'SOOP 다시보기 또는 YouTube 영상 링크';
    videoUrl.setAttribute('aria-label', '기억의 순간 다시보기 링크');
    const add = document.createElement('button'); add.type = 'submit'; add.className = 'button button-primary';
    add.disabled = state.saving; add.textContent = state.saving ? '저장 중…' : '＋ 순간 추가';
    form.append(momentTitle, videoUrl, add);
    const hint = document.createElement('small'); hint.className = 'memory-moments-owner-hint';
    hint.textContent = '인증 스트리머와 관리자만 추가·삭제할 수 있어요. SOOP 다시보기와 YouTube 영상 링크를 지원합니다.';
    form.append(hint);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (form.reportValidity()) addMemoryMoment(page, momentTitle, videoUrl, add);
    });
    section.append(form);
  }

  if (!memories.length) {
    const empty = document.createElement('p'); empty.className = 'memory-moments-empty';
    if (!state.loaded) {
      if (state.loading) empty.textContent = '기억의 순간을 불러오고 있어요.';
      else if (state.error) {
        empty.textContent = state.error;
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button memory-moments-retry-button';
        retry.textContent = '다시 불러오기'; retry.addEventListener('click', () => loadFanPageMemories(page));
        section.append(empty, retry);
        return section;
      } else empty.textContent = '기억의 순간을 불러옵니다.';
    } else {
      empty.textContent = page.isOwner
        ? '아직 등록된 기억의 순간이 없어요. 첫 기념 다시보기를 추가해 보세요.'
        : '아직 등록된 기념 다시보기가 없어요.';
    }
    section.append(empty);
    return section;
  }

  const list = document.createElement('div'); list.className = 'memory-moments-list';
  memories.forEach((memory) => {
    if (!memory || !/^[0-9a-f-]{36}$/i.test(String(memory.id || ''))) return;
    const card = document.createElement('article'); card.className = 'memory-moment-card';
    const thumbnailFrame = document.createElement('div'); thumbnailFrame.className = 'memory-moment-thumbnail-frame';
    const thumbnailFallback = document.createElement('span'); thumbnailFallback.className = 'memory-moment-thumbnail-fallback';
    thumbnailFallback.textContent = '✦'; thumbnailFallback.setAttribute('aria-hidden', 'true');
    thumbnailFrame.append(thumbnailFallback);
    if (typeof memory.thumbnailUrl === 'string' && memory.thumbnailUrl) {
      const thumbnail = document.createElement('img'); thumbnail.className = 'memory-moment-thumbnail';
      thumbnail.src = memory.thumbnailUrl; thumbnail.alt = `${memory.title || '기억의 순간'} 썸네일`;
      thumbnail.loading = 'lazy'; thumbnail.decoding = 'async'; thumbnail.referrerPolicy = 'no-referrer';
      thumbnail.addEventListener('error', () => {
        thumbnailFrame.classList.remove('has-thumbnail');
        thumbnail.remove();
      }, { once: true });
      thumbnailFrame.classList.add('has-thumbnail');
      thumbnailFrame.append(thumbnail);
    }
    const detail = document.createElement('div'); detail.className = 'memory-moment-detail';
    const meta = document.createElement('div'); meta.className = 'memory-moment-meta';
    const platform = document.createElement('span'); platform.className = 'memory-moment-platform';
    platform.textContent = memory.platform === 'youtube' ? 'YouTube' : 'SOOP';
    const createdAt = Number(memory.createdAt);
    if (Number.isFinite(createdAt) && createdAt > 0) {
      const date = document.createElement('time'); date.className = 'memory-moment-date';
      date.dateTime = new Date(createdAt).toISOString();
      date.textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(createdAt);
      meta.append(platform, date);
    } else {
      meta.append(platform);
    }
    const name = document.createElement('h3'); name.className = 'memory-moment-title';
    name.textContent = String(memory.title || '기억의 순간');
    detail.append(meta, name);
    const actions = document.createElement('div'); actions.className = 'memory-moment-actions';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'button button-primary memory-moment-play';
    play.textContent = '▶ 팬페이지에서 재생';
    play.addEventListener('click', () => {
      if (memory.platform === 'youtube') openYouTubePlayer({ id: memory.videoId, title: memory.title });
      else openVodPlayer({ id: memory.videoId, title: memory.title });
    });
    const external = document.createElement('a'); external.className = 'button memory-moment-external';
    external.href = memory.url; external.target = '_blank'; external.rel = 'noopener noreferrer';
    external.textContent = '원본 링크 ↗';
    actions.append(play, external);
    if (page.isOwner) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button memory-moment-delete';
      remove.disabled = state.saving || state.deletingId === memory.id;
      remove.textContent = state.deletingId === memory.id ? '삭제 중…' : '삭제';
      remove.setAttribute('aria-label', `${memory.title || '기억의 순간'} 삭제`);
      remove.addEventListener('click', () => deleteMemoryMoment(page, memory, remove));
      actions.append(remove);
    }
    card.append(thumbnailFrame, detail, actions); list.append(card);
  });
  section.append(list);
  return section;
}

async function addMemoryMoment(page, titleInput, urlInput, button) {
  const state = fanPageMemoryStateFor(page.streamer.id);
  if (!page.isOwner || state.saving || button.disabled) return;
  state.saving = true; button.disabled = true; button.textContent = '저장 중…';
  try {
    const result = (await callMemories({
      action: 'add', streamerId: page.streamer.id, title: titleInput.value.trim(), url: urlInput.value.trim(),
    })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    state.memories = Array.isArray(result.memories) ? result.memories : [];
    state.loaded = true; state.error = ''; state.revision += 1;
    page.memories = state.memories;
    currentPage.memories = state.memories;
    state.saving = false;
    refreshMemoriesSection(page.streamer.id);
    showToast('기억의 순간을 추가했어요.');
  } catch (error) {
    showToast(error.message || '기억의 순간을 추가하지 못했어요.');
  } finally {
    state.saving = false;
    if (button.isConnected) { button.disabled = false; button.textContent = '＋ 순간 추가'; }
  }
}

async function loadFanPageMemories(page) {
  const state = fanPageMemoryStateFor(page.streamer.id);
  if (state.loaded || state.loading) {
    if (state.loaded) {
      page.memories = state.memories;
      if (currentPage && currentPage.streamer.id === page.streamer.id) currentPage.memories = state.memories;
    }
    return;
  }
  const revision = state.revision;
  state.loading = true; state.error = '';
  refreshMemoriesSection(page.streamer.id);
  try {
    const result = (await callMemories({ action: 'list', streamerId: page.streamer.id })).data;
    const entries = Array.isArray(result.memories) ? result.memories : [];
    if (state.revision === revision) {
      state.memories = entries;
      state.loaded = true;
      if (currentPage && currentPage.streamer.id === page.streamer.id) currentPage.memories = entries;
      page.memories = entries;
    }
  } catch (error) {
    state.error = error.message || '기억의 순간을 불러오지 못했어요.';
  } finally {
    state.loading = false;
    if (currentPage && currentPage.streamer.id === page.streamer.id) {
      currentPage.memories = state.memories;
      refreshMemoriesSection(page.streamer.id);
    }
  }
}

async function deleteMemoryMoment(page, memory, button) {
  const state = fanPageMemoryStateFor(page.streamer.id);
  if (!page.isOwner || state.saving || button.disabled
    || !confirm(`“${memory.title}” 기억의 순간을 삭제할까요?`)) return;
  state.saving = true; state.deletingId = memory.id; button.disabled = true; button.textContent = '삭제 중…';
  try {
    const result = (await callMemories({ action: 'delete', streamerId: page.streamer.id, id: memory.id })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    state.memories = Array.isArray(result.memories) ? result.memories : [];
    state.loaded = true; state.error = ''; state.revision += 1;
    page.memories = state.memories;
    currentPage.memories = state.memories;
    showToast('기억의 순간을 삭제했어요.');
  } catch (error) {
    showToast(error.message || '기억의 순간을 삭제하지 못했어요.');
  } finally {
    state.saving = false; state.deletingId = '';
    refreshMemoriesSection(page.streamer.id);
  }
}

function refreshMemoriesSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('memoryMomentsSection');
  if (section) section.replaceWith(renderMemoriesSection(currentPage));
}

function videoLibraryStateFor(streamerId) {
  let state = videoLibraryStates.get(streamerId);
  if (!state) {
    state = {
      loaded: false, loading: false, saving: false, error: '', categories: [], items: [],
      categoryId: '', cursor: null, hasMore: false, canManage: false, isAdmin: false,
      channels: [], isInitialImporting: false, isSyncing: false, searchQuery: '', editingId: '', editingCategoryId: '', syncTimer: 0,
      searchMode: false, searchLoading: false, searchTimer: 0, searchRevision: 0,
    };
    videoLibraryStates.set(streamerId, state);
  }
  return state;
}

function refreshVideoLibrarySection(streamerId, options = {}) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('videoLibrarySection');
  if (!section) return;
  const focusedSearch = options.preserveSearchFocus && section.contains(document.activeElement)
    && document.activeElement.matches('.video-library-search') ? document.activeElement : null;
  const selectionStart = focusedSearch ? focusedSearch.selectionStart : null;
  const selectionEnd = focusedSearch ? focusedSearch.selectionEnd : null;
  section.replaceWith(renderVideoLibrarySection(currentPage));
  if (focusedSearch) {
    const nextSearch = $('videoLibrarySection')?.querySelector('.video-library-search');
    nextSearch?.focus({ preventScroll: true });
    if (nextSearch && selectionStart !== null && selectionEnd !== null) {
      nextSearch.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function videoLibraryCategorySelect(categories, selectedId, label) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id; option.textContent = category.name;
    option.selected = category.id === selectedId;
    select.append(option);
  });
  return select;
}

function renderVideoLibrarySection(page) {
  const state = videoLibraryStateFor(page.streamer.id);
  const section = document.createElement('section');
  section.className = 'video-library-section content-card';
  section.id = 'videoLibrarySection';

  const heading = document.createElement('div'); heading.className = 'video-library-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'FAVORITES';
  const title = document.createElement('h2'); title.textContent = '즐겨찾기';
  const count = document.createElement('span'); count.className = 'video-library-count';
  count.textContent = `${state.items.length.toLocaleString('ko-KR')}개 표시`;
  copy.append(eyebrow, title, count);
  const headingActions = document.createElement('div'); headingActions.className = 'video-library-heading-actions';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'button video-library-refresh';
  refresh.disabled = state.loading || state.saving;
  refresh.textContent = state.loading ? '불러오는 중…' : '↻ 새로고침';
  refresh.addEventListener('click', () => loadVideoLibrary(page, { refresh: true }));
  headingActions.append(refresh); heading.append(copy, headingActions); section.append(heading);

  const description = document.createElement('p'); description.className = 'video-library-description';
  description.textContent = '스트리머가 라이브에서 자주 시청하는 영상을 모았습니다.';
  section.append(description);

  if (state.canManage) {
    const categoryManager = document.createElement('div'); categoryManager.className = 'video-library-category-manager';
    const categoryForm = document.createElement('form'); categoryForm.className = 'video-library-category-form';
    const categoryInput = document.createElement('input'); categoryInput.type = 'text'; categoryInput.maxLength = 32;
    categoryInput.placeholder = '새 하위 카테고리'; categoryInput.setAttribute('aria-label', '새 영상 카테고리 이름');
    const addCategory = document.createElement('button'); addCategory.type = 'submit'; addCategory.className = 'button button-primary';
    addCategory.disabled = state.saving; addCategory.textContent = '＋ 카테고리';
    categoryForm.append(categoryInput, addCategory);
    categoryForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!categoryInput.value.trim() || state.saving) return;
      runVideoLibraryMutation(page, 'category-add', { name: categoryInput.value.trim() }, '카테고리를 추가했어요.');
    });
    categoryManager.append(categoryForm);
    section.append(categoryManager);
  }

  const categoryBar = document.createElement('div'); categoryBar.className = 'video-library-categories';
  categoryBar.setAttribute('aria-label', '영상 카테고리');
  const allCategory = document.createElement('button'); allCategory.type = 'button';
  allCategory.className = `video-library-category${state.categoryId ? '' : ' is-active'}`;
  allCategory.textContent = '전체'; allCategory.setAttribute('aria-pressed', String(!state.categoryId));
  allCategory.addEventListener('click', () => selectVideoLibraryCategory(page, ''));
  categoryBar.append(allCategory);
  state.categories.forEach((category) => {
    const select = document.createElement('button'); select.type = 'button';
    select.className = `video-library-category${state.categoryId === category.id ? ' is-active' : ''}`;
    select.textContent = category.name; select.setAttribute('aria-pressed', String(state.categoryId === category.id));
    select.addEventListener('click', () => selectVideoLibraryCategory(page, category.id));
    categoryBar.append(select);
  });
  section.append(categoryBar);

  const selectedCategory = state.categories.find((category) => category.id === state.categoryId);
  if (state.canManage && selectedCategory) {
    const categoryTools = document.createElement('div'); categoryTools.className = 'video-library-category-tools';
    const editorContent = document.createElement('div'); editorContent.className = 'video-library-category-editor';
    editorContent.id = 'videoLibraryCategoryEditor';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'button video-library-category-edit-toggle';
    const isEditingCategory = state.editingCategoryId === selectedCategory.id;
    toggle.textContent = isEditingCategory ? '편집 닫기' : '카테고리 편집';
    toggle.setAttribute('aria-expanded', String(isEditingCategory));
    toggle.setAttribute('aria-controls', editorContent.id);
    toggle.setAttribute('aria-label', isEditingCategory
      ? `${selectedCategory.name} 카테고리 편집 닫기` : `${selectedCategory.name} 카테고리 편집 열기`);
    toggle.addEventListener('click', () => {
      state.editingCategoryId = isEditingCategory ? '' : selectedCategory.id;
      refreshVideoLibrarySection(page.streamer.id);
    });
    categoryTools.append(toggle);

    if (isEditingCategory) {
      const editForm = document.createElement('form'); editForm.className = 'video-library-category-edit-form';
      const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.required = true;
      nameInput.maxLength = 32; nameInput.value = selectedCategory.name;
      nameInput.setAttribute('aria-label', '카테고리 이름');
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary';
      save.disabled = state.saving; save.textContent = state.saving ? '저장 중…' : '이름 저장';
      editForm.append(nameInput, save);
      editForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name || state.saving) return;
        runVideoLibraryMutation(page, 'category-rename', { categoryId: selectedCategory.id, name }, '카테고리 이름을 바꿨어요.');
      });
      const deleteNote = document.createElement('p'); deleteNote.className = 'video-library-category-delete-note';
      deleteNote.textContent = '영상이나 YouTube 채널이 연결된 카테고리는 삭제할 수 없어요.';
      editorContent.append(editForm, deleteNote);

      const actions = document.createElement('div'); actions.className = 'video-library-category-edit-actions';
      const index = state.categories.findIndex((category) => category.id === selectedCategory.id);
      const up = document.createElement('button'); up.type = 'button'; up.className = 'button';
      up.textContent = '↑ 위로'; up.disabled = state.saving || index <= 0;
      up.addEventListener('click', () => reorderVideoLibraryCategory(page, index, index - 1));
      const down = document.createElement('button'); down.type = 'button'; down.className = 'button';
      down.textContent = '↓ 아래로'; down.disabled = state.saving || index < 0 || index >= state.categories.length - 1;
      down.addEventListener('click', () => reorderVideoLibraryCategory(page, index, index + 1));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button video-library-category-delete';
      const categoryHasContent = !state.loaded || state.items.length > 0 || state.hasMore
        || state.channels.some((channel) => channel.categoryId === selectedCategory.id);
      remove.disabled = state.saving || categoryHasContent; remove.textContent = '카테고리 삭제';
      remove.title = categoryHasContent ? '영상과 연결된 채널이 없는 카테고리만 삭제할 수 있어요.' : '';
      remove.addEventListener('click', () => {
        if (!confirm(`“${selectedCategory.name}” 카테고리를 삭제할까요? 영상과 연결된 YouTube 채널이 없는 카테고리만 삭제할 수 있어요.`)) return;
        runVideoLibraryMutation(page, 'category-delete', { categoryId: selectedCategory.id }, '카테고리를 삭제했어요.');
      });
      actions.append(up, down, remove);
      editorContent.append(actions);
    }
    categoryTools.append(toggle, editorContent);
    section.append(categoryTools);
  }

  if (state.canManage && state.categories.length) {
    const addForm = document.createElement('form'); addForm.className = 'video-library-add-form';
    const category = videoLibraryCategorySelect(state.categories, state.categoryId || state.categories[0].id, '추가할 영상 카테고리');
    const url = document.createElement('input'); url.type = 'url'; url.required = true; url.maxLength = 500;
    url.placeholder = 'YouTube 또는 SOOP 다시보기 링크'; url.setAttribute('aria-label', '등록할 영상 링크');
    const add = document.createElement('button'); add.type = 'submit'; add.className = 'button button-primary';
    add.disabled = state.saving; add.textContent = state.saving ? '등록 중…' : '＋ 영상 추가';
    addForm.append(category, url, add);
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!addForm.reportValidity() || state.saving) return;
      runVideoLibraryMutation(page, 'video-add', { categoryId: category.value, url: url.value.trim() }, '영상을 추가했어요.');
    });
    section.append(addForm);
  }

  if (state.isAdmin && state.categories.length) {
    const admin = document.createElement('details'); admin.className = 'video-library-admin-tools';
    const summary = document.createElement('summary'); summary.textContent = '관리자 · YouTube 채널 전체 영상 가져오기';
    admin.append(summary);
    const form = document.createElement('form'); form.className = 'video-library-channel-form';
    const url = document.createElement('input'); url.type = 'url'; url.required = true; url.maxLength = 500;
    url.placeholder = 'YouTube 채널 또는 @핸들 링크'; url.setAttribute('aria-label', 'YouTube 채널 주소');
    const category = videoLibraryCategorySelect(state.categories, state.categoryId || state.categories[0].id, '가져올 영상 카테고리');
    const add = document.createElement('button'); add.type = 'submit'; add.className = 'button button-primary';
    add.disabled = state.saving; add.textContent = state.saving ? '등록 중…' : '채널 추가';
    form.append(url, category, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || state.saving) return;
      runVideoLibraryMutation(page, 'channel-add', { url: url.value.trim(), categoryId: category.value }, '채널을 등록했어요. 영상 가져오기가 백그라운드에서 시작됩니다.');
    });
    admin.append(form);
    if (state.channels.length) {
      const channelList = document.createElement('div'); channelList.className = 'video-library-channel-list';
      state.channels.forEach((channel) => {
        const card = document.createElement('article'); card.className = 'video-library-channel-card';
        const name = document.createElement('a'); name.href = channel.channelUrl; name.target = '_blank';
        name.rel = 'noopener noreferrer'; name.textContent = channel.channelTitle || channel.id;
        const progress = document.createElement('progress'); progress.max = 100;
        progress.value = channel.videoCount ? Math.min(100, channel.importedCount / channel.videoCount * 100) : (channel.syncStatus === 'ready' ? 100 : 0);
        const status = document.createElement('small');
        status.textContent = channel.syncStatus === 'syncing'
          ? `영상 가져오는 중 · ${channel.importedCount.toLocaleString('ko-KR')} / ${channel.videoCount.toLocaleString('ko-KR')}`
          : channel.syncStatus === 'error' ? `가져오기 실패 · ${channel.syncError || '다시 동기화해 주세요.'}`
            : `최근 동기화 ${channel.lastSyncAt ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(channel.lastSyncAt) : '없음'} · ${channel.importedCount.toLocaleString('ko-KR')}개`;
        const channelCategory = videoLibraryCategorySelect(state.categories, channel.categoryId, `${channel.channelTitle} 카테고리`);
        channelCategory.addEventListener('change', () => runVideoLibraryMutation(page, 'channel-set-category', {
          channelId: channel.id, categoryId: channelCategory.value,
        }, '채널 카테고리를 바꿨어요.'));
        const sync = document.createElement('button'); sync.type = 'button'; sync.className = 'button';
        sync.disabled = state.saving || channel.syncStatus === 'syncing'; sync.textContent = channel.syncStatus === 'error' ? '다시 시도' : '전체 동기화';
        sync.addEventListener('click', () => runVideoLibraryMutation(page, 'channel-sync', { channelId: channel.id }, '전체 영상 동기화를 시작했어요.'));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button video-library-channel-delete';
        remove.disabled = state.saving; remove.textContent = '채널 삭제';
        remove.addEventListener('click', () => {
          if (!confirm(`“${channel.channelTitle}” 채널과 가져온 영상을 모두 삭제할까요?`)) return;
          runVideoLibraryMutation(page, 'channel-delete', { channelId: channel.id }, '채널과 가져온 영상을 삭제했어요.');
        });
        card.append(name, progress, status, channelCategory, sync, remove); channelList.append(card);
      });
      admin.append(channelList);
    }
    section.append(admin);
  }

  if (state.loading && !state.loaded) {
    const loading = document.createElement('p'); loading.className = 'video-library-state';
    loading.textContent = '공통 영상 모음을 불러오고 있어요.'; section.append(loading); return section;
  }
  if (state.error && !state.loaded) {
    const error = document.createElement('div'); error.className = 'video-library-state is-error';
    const message = document.createElement('span'); message.textContent = state.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button'; retry.textContent = '다시 불러오기';
    retry.addEventListener('click', () => loadVideoLibrary(page, { refresh: true }));
    error.append(message, retry); section.append(error); return section;
  }
  if (state.error) {
    const warning = document.createElement('p'); warning.className = 'video-library-inline-error'; warning.textContent = state.error;
    section.append(warning);
  }

  if (state.items.length || state.searchQuery) {
    const search = document.createElement('input'); search.type = 'search'; search.className = 'video-library-search';
    search.placeholder = '채널 전체 영상에서 검색'; search.setAttribute('aria-label', '채널 전체 영상 검색');
    search.value = state.searchQuery;
    search.addEventListener('input', () => {
      state.searchQuery = search.value.trim() ? search.value : '';
      state.searchRevision += 1;
      clearTimeout(state.searchTimer);
      state.searchMode = !!state.searchQuery.trim();
      state.searchLoading = false;
      state.error = '';
      state.items = [];
      state.cursor = null;
      state.hasMore = false;
      if (!state.searchMode) {
        state.loaded = false;
        renderVideoLibraryItems(page, section, state);
        void loadVideoLibrary(page, { refresh: true });
        return;
      }
      state.loaded = true;
      const queryLength = Array.from(state.searchQuery.normalize('NFC').trim()).length;
      state.searchLoading = queryLength >= 2;
      renderVideoLibraryItems(page, section, state);
      if (state.searchLoading) {
        const revision = state.searchRevision;
        state.searchTimer = window.setTimeout(() => requestVideoLibrarySearch(page, revision), 450);
      }
    });
    section.append(search);
  }
  renderVideoLibraryItems(page, section, state);

  if (!state.hasMore && state.loaded && !state.items.length && !state.searchMode) {
    const empty = document.createElement('p'); empty.className = 'video-library-state';
    empty.textContent = state.isInitialImporting
      ? '첫 영상을 가져오고 있어요. 잠시 후 목록에 표시됩니다.'
      : state.isSyncing
        ? '채널 영상을 가져오고 있어요. 새로고침하면 추가된 영상을 확인할 수 있습니다.'
        : state.canManage && !state.categories.length
          ? '먼저 하위 카테고리를 추가해 주세요.' : '아직 등록된 영상이 없어요.';
    section.append(empty);
  }
  if (state.isSyncing && state.items.length) {
    const progress = document.createElement('p'); progress.className = 'video-library-state';
    progress.textContent = '채널의 나머지 영상도 계속 가져오고 있어요. 새로고침하면 추가된 영상을 확인할 수 있습니다.';
    section.append(progress);
  }
  return section;
}

function renderVideoLibraryItems(page, section, state) {
  section.querySelector('.video-library-grid')?.remove();
  section.querySelector('.video-library-empty-filter')?.remove();
  section.querySelector('.video-library-load-more')?.remove();
  const count = section.querySelector('.video-library-count');
  if (count) count.textContent = `${state.items.length.toLocaleString('ko-KR')}개 표시`;
  const items = state.items;
  if (!items.length) {
    const queryLength = Array.from(state.searchQuery.normalize('NFC').trim()).length;
    if (state.searchMode && state.searchLoading) {
      const pending = document.createElement('p'); pending.className = 'video-library-empty-filter video-library-state';
      pending.textContent = '채널의 전체 영상에서 검색하고 있어요.';
      section.append(pending);
    } else if (state.searchMode && queryLength < 2) {
      const hint = document.createElement('p'); hint.className = 'video-library-empty-filter video-library-state';
      hint.textContent = '두 글자 이상 입력하면 채널 전체 영상에서 검색해요.';
      section.append(hint);
    } else if (state.searchMode) {
      const empty = document.createElement('p'); empty.className = 'video-library-empty-filter video-library-state';
      empty.textContent = state.error ? '검색하지 못했어요. 잠시 후 다시 시도해 주세요.' : '채널 전체 영상에서 검색 결과가 없어요.';
      section.append(empty);
    }
    return;
  }
  const grid = document.createElement('div'); grid.className = 'video-library-grid';
  items.forEach((item) => {
    const card = document.createElement('article'); card.className = 'video-library-card';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'video-library-play';
    play.setAttribute('aria-label', `${item.title} 재생`);
    play.addEventListener('click', () => {
      if (item.platform === 'youtube') openYouTubePlayer({ id: item.videoId, title: item.title });
      else openVodPlayer({ id: item.videoId, title: item.title });
    });
    const frame = document.createElement('span'); frame.className = 'video-library-thumbnail-frame';
    const thumbnailUrl = item.thumbnailUrl || (item.platform === 'youtube'
      ? `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/mqdefault.jpg` : '');
    if (thumbnailUrl) {
      const image = document.createElement('img'); image.src = thumbnailUrl;
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.remove(); frame.classList.add('is-missing'); }, { once: true });
      frame.append(image);
    } else frame.classList.add('is-missing');
    const icon = document.createElement('span'); icon.className = 'video-library-play-icon'; icon.textContent = '▶';
    frame.append(icon); play.append(frame);
    const body = document.createElement('div'); body.className = 'video-library-card-body';
    const source = document.createElement('span'); source.className = 'video-library-source';
    source.textContent = item.sourceType === 'channel' ? `${item.channelTitle || 'YouTube 채널'} · YouTube` : item.platform === 'youtube' ? 'YouTube' : 'SOOP';
    const name = document.createElement('h3'); name.textContent = item.title || '제목 없음';
    const meta = document.createElement('small');
    const published = Date.parse(item.publishedAt || '');
    meta.textContent = Number.isFinite(published)
      ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(published)
      : '날짜 정보 없음';
    body.append(source, name, meta); card.append(play, body);
    if (state.canManage && item.sourceType === 'manual') {
      const actions = document.createElement('div'); actions.className = 'video-library-card-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button'; edit.textContent = state.editingId === item.id ? '편집 닫기' : '편집';
      edit.addEventListener('click', () => { state.editingId = state.editingId === item.id ? '' : item.id; refreshVideoLibrarySection(page.streamer.id); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button'; remove.textContent = '삭제';
      remove.addEventListener('click', () => {
        if (!confirm(`“${item.title}” 영상을 모음에서 삭제할까요?`)) return;
        runVideoLibraryMutation(page, 'video-delete', { id: item.id }, '영상을 삭제했어요.');
      });
      actions.append(edit, remove); card.append(actions);
      if (state.editingId === item.id) {
        const form = document.createElement('form'); form.className = 'video-library-edit-form';
        const titleInput = document.createElement('input'); titleInput.type = 'text'; titleInput.required = true;
        titleInput.maxLength = 120; titleInput.value = item.title; titleInput.setAttribute('aria-label', '영상 제목');
        const category = videoLibraryCategorySelect(state.categories, item.categoryId, '영상 카테고리');
        const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = '저장';
        form.append(titleInput, category, save);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (!form.reportValidity() || state.saving) return;
          runVideoLibraryMutation(page, 'video-update', { id: item.id, title: titleInput.value.trim(), categoryId: category.value }, '영상 정보를 바꿨어요.');
        });
        card.append(form);
      }
    }
    grid.append(card);
  });
  section.append(grid);
  if (state.hasMore) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'button video-library-load-more';
    more.disabled = state.loading; more.textContent = state.loading ? '불러오는 중…' : '더 많은 영상 보기';
    more.addEventListener('click', () => loadVideoLibrary(page, { append: true }));
    section.append(more);
  }
}

function requestVideoLibrarySearch(page, revision) {
  const state = videoLibraryStateFor(page.streamer.id);
  if (revision !== state.searchRevision || !state.searchMode) return;
  if (state.loading) {
    state.searchTimer = window.setTimeout(() => requestVideoLibrarySearch(page, revision), 150);
    return;
  }
  void loadVideoLibrary(page, { refresh: true, searchRevision: revision });
}

async function loadVideoLibrary(page, options = {}) {
  const state = videoLibraryStateFor(page.streamer.id);
  if (state.loading || (state.loaded && !options.refresh && !options.append)) return;
  const append = options.append === true;
  const searchMode = state.searchMode && Array.from(state.searchQuery.normalize('NFC').trim()).length >= 2;
  const searchRevision = options.searchRevision ?? state.searchRevision;
  const searchQuery = state.searchQuery;
  const requestCategoryId = state.categoryId;
  const cursor = append ? state.cursor : null;
  state.loading = true; state.error = '';
  refreshVideoLibrarySection(page.streamer.id, { preserveSearchFocus: true });
  try {
    const result = (await callVideoLibrary({
      action: searchMode ? 'search' : 'list',
      ...(searchMode ? { query: searchQuery } : {}),
      categoryId: state.categoryId || '', cursor, limit: 24,
    })).data;
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    if (searchRevision !== state.searchRevision || requestCategoryId !== state.categoryId
      || (searchMode && searchQuery !== state.searchQuery)) return;
    state.categories = Array.isArray(result.categories) ? result.categories : [];
    state.canManage = result.canManage === true;
    state.isAdmin = result.isAdmin === true;
    state.isInitialImporting = result.isInitialImporting === true;
    state.isSyncing = result.isSyncing === true;
    state.channels = Array.isArray(result.channels) ? result.channels : [];
    const incoming = Array.isArray(result.items) ? result.items : [];
    if (append) {
      const merged = new Map(state.items.map((item) => [item.id, item]));
      incoming.forEach((item) => merged.set(item.id, item));
      state.items = [...merged.values()];
    } else state.items = incoming;
    state.cursor = result.nextCursor || null;
    state.hasMore = result.hasMore === true;
    state.loaded = true;
    if (searchMode) state.searchLoading = false;
  } catch (error) {
    if (searchRevision === state.searchRevision && requestCategoryId === state.categoryId
      && (!searchMode || searchQuery === state.searchQuery)) {
      state.error = error.message || (searchMode ? '전체 영상 검색을 완료하지 못했어요.' : '공통 영상 모음을 불러오지 못했어요.');
      if (searchMode) state.searchLoading = false;
    }
  } finally {
    state.loading = false;
    if (currentPage && currentPage.streamer.id === page.streamer.id) {
      refreshVideoLibrarySection(page.streamer.id, { preserveSearchFocus: true });
      clearTimeout(state.syncTimer);
      const view = $('fanPageView');
      if ((state.isAdmin && state.channels.some((channel) => channel.syncStatus === 'syncing')
        || state.isInitialImporting) && !state.searchMode
        && view?.dataset.fanpageActiveTab === 'video-library') {
        state.syncTimer = window.setTimeout(() => loadVideoLibrary(page, { refresh: true }), 6500);
      }
      if (requestCategoryId !== state.categoryId && !state.loading) {
        window.setTimeout(() => loadVideoLibrary(page), 0);
      } else if (searchRevision !== state.searchRevision && !state.searchMode && !state.loading) {
        window.setTimeout(() => loadVideoLibrary(page, { refresh: true }), 0);
      }
    }
  }
}

function selectVideoLibraryCategory(page, categoryId) {
  const state = videoLibraryStateFor(page.streamer.id);
  if (state.categoryId === categoryId) return;
  clearTimeout(state.searchTimer);
  state.searchRevision += 1;
  state.categoryId = categoryId; state.items = []; state.cursor = null; state.hasMore = false;
  state.loaded = false; state.searchQuery = ''; state.searchMode = false; state.searchLoading = false;
  state.editingId = ''; state.editingCategoryId = '';
  void loadVideoLibrary(page);
}

async function runVideoLibraryMutation(page, action, payload, successMessage) {
  const state = videoLibraryStateFor(page.streamer.id);
  if (state.saving) return;
  state.saving = true; state.error = '';
  refreshVideoLibrarySection(page.streamer.id);
  try {
    await callVideoLibrary({ action, ...payload });
    if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
    if (action === 'category-delete' && state.categoryId === payload.categoryId) state.categoryId = '';
    state.loaded = false; state.editingId = ''; state.editingCategoryId = '';
    showToast(successMessage);
  } catch (error) {
    showToast(error.message || '영상 모음 변경을 저장하지 못했어요.');
  } finally {
    state.saving = false;
    if (currentPage && currentPage.streamer.id === page.streamer.id) {
      await loadVideoLibrary(page, { refresh: true });
      refreshVideoLibrarySection(page.streamer.id);
    }
  }
}

async function reorderVideoLibraryCategory(page, from, to) {
  const state = videoLibraryStateFor(page.streamer.id);
  const order = state.categories.map((category) => category.id);
  if (to < 0 || to >= order.length || from < 0 || from >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  await runVideoLibraryMutation(page, 'category-order', { order }, '카테고리 순서를 바꿨어요.');
}

function renderOgqSection(page, paired = false) {
  const profile = page.profile || {};
  const streamerId = page.streamer.id;
  let ogqUrl = '';
  let emoticonId = '';
  try {
    ogqUrl = normalizeProfileLink('ogqEmoticonUrl', profile.ogqEmoticonUrl);
    emoticonId = new URL(ogqUrl).pathname.split('/').filter(Boolean).at(-1) || '';
  } catch (_) {}

  const section = document.createElement('section');
  section.className = `ogq-section content-card${paired ? ' fan-feature-ogq-panel' : ''}`;
  section.id = 'ogqSection';
  const heading = document.createElement('div');
  heading.className = 'ogq-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'SOOP OGQ EMOTICONS';
  const title = document.createElement('h2'); title.textContent = 'OGQ 이모티콘';
  copy.append(eyebrow, title);
  const actions = document.createElement('div'); actions.className = 'ogq-heading-actions';
  if (ogqUrl) {
    const openLink = document.createElement('a'); openLink.className = 'button ogq-open-link';
    openLink.href = ogqUrl; openLink.target = '_blank'; openLink.rel = 'noopener noreferrer';
    openLink.textContent = 'OGQ에서 보기 ↗'; actions.append(openLink);
  }
  const editor = page.isOwner ? createProfileLinkEditor(page, 'ogqEmoticonUrl', {
    label: 'SOOP OGQ 이모티콘 링크', placeholder: 'https://ogqmarket.sooplive.com/emoticon/상품ID',
    note: '상품 링크를 등록하면 대표 이미지 미리보기와 OGQ 바로가기를 표시합니다.',
    value: String(profile.ogqEmoticonUrl || ''),
  }) : null;
  if (editor && editor.toggleButton) actions.append(editor.toggleButton);
  heading.append(copy, actions); section.append(heading);

  if (!ogqUrl || !emoticonId) {
    const empty = document.createElement('p'); empty.className = 'profile-link-empty-state';
    empty.textContent = 'OGQ 이모티콘 링크가 아직 등록되지 않았어요.';
    section.append(empty);
    if (editor) section.append(editor.element);
    return section;
  }

  const preview = document.createElement('a'); preview.className = 'ogq-product-preview';
  preview.href = ogqUrl; preview.target = '_blank'; preview.rel = 'noopener noreferrer';
  const imageFrame = document.createElement('span'); imageFrame.className = 'ogq-product-image-frame';
  const image = document.createElement('img'); image.className = 'ogq-product-image';
  image.src = `https://ogqmarket.img.sooplive.com/sticker/${encodeURIComponent(emoticonId)}/main.png`;
  image.alt = `${page.streamer.nickname} OGQ 이모티콘 대표 이미지`; image.loading = 'lazy'; image.decoding = 'async';
  const fallback = document.createElement('span'); fallback.className = 'ogq-product-image-fallback';
  fallback.textContent = 'OGQ'; fallback.setAttribute('aria-hidden', 'true');
  image.addEventListener('error', () => { image.remove(); imageFrame.classList.add('is-missing'); }, { once: true });
  imageFrame.append(image, fallback);
  const details = document.createElement('span'); details.className = 'ogq-product-details';
  const productLabel = document.createElement('span'); productLabel.className = 'ogq-product-label'; productLabel.textContent = 'SOOP OGQ EMOTICON';
  const productTitle = document.createElement('strong'); productTitle.textContent = '공식 이모티콘 미리보기';
  const productHint = document.createElement('span'); productHint.textContent = '대표 이미지를 누르면 상품 페이지로 이동합니다.';
  details.append(productLabel, productTitle, productHint); preview.append(imageFrame, details); section.append(preview);
  if (editor) section.append(editor.element);
  return section;
}

function refreshOgqSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('ogqSection');
  if (section) section.replaceWith(renderOgqSection(currentPage, section.classList.contains('fan-feature-ogq-panel')));
}

function refreshYouTubeSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('youtubeSection');
  if (!section) return;
  const focused = section.contains(document.activeElement);
  const replacement = renderYouTubeSection(currentPage);
  if (!replacement) { section.remove(); return; }
  section.replaceWith(replacement);
  if (focused) replacement.querySelector('[data-youtube-focus="refresh"]')?.focus({ preventScroll: true });
}

async function loadYouTubeVideos(streamerId, forceRefresh = false) {
  const state = youtubeStateFor(streamerId);
  if (state.loading || (state.hasLoaded && !forceRefresh)) return;
  state.loading = true;
  state.error = '';
  refreshYouTubeSection(streamerId);
  try {
    const response = await callYouTubeVideos({ streamerId, forceRefresh });
    if (!currentPage || currentPage.streamer.id !== streamerId) return;
    const youtube = response.data && response.data.youtube ? response.data.youtube : { items: [], totalCount: 0 };
    state.data = {
      ...youtube,
      items: Array.isArray(youtube.items) ? youtube.items.slice(0, MAX_LOADED_VIDEO_ITEMS) : [],
    };
    state.stale = response.data && response.data.stale === true;
    state.hasLoaded = true;
    if (forceRefresh && state.stale) showToast('YouTube 연결이 원활하지 않아 이전 목록을 유지했어요.');
    else if (forceRefresh && response.data && response.data.refreshCoolingDown) showToast('잠시 전에 갱신했어요.');
    else if (forceRefresh) showToast('YouTube 영상 목록을 갱신했어요.');
  } catch (error) {
    if (!currentPage || currentPage.streamer.id !== streamerId) return;
    state.error = error.message || 'YouTube 영상을 불러오지 못했어요.';
    state.hasLoaded = false;
  } finally {
    state.loading = false;
    refreshYouTubeSection(streamerId);
  }
}

function cafeStateFor(streamerId) {
  if (!cafeStates.has(streamerId)) {
    cafeStates.set(streamerId, { loading: false, hasLoaded: false, error: '', stale: false, data: null });
  }
  return cafeStates.get(streamerId);
}

function renderCafeSection(page) {
  const cafeUrl = String(page.profile && page.profile.cafeUrl || '').trim();
  const streamerId = page.streamer.id;
  const state = cafeStateFor(streamerId);
  const editor = page.isOwner ? createProfileLinkEditor(page, 'cafeUrl', {
    label: '네이버 카페 주소', placeholder: 'https://cafe.naver.com/카페주소',
    note: '카페 홈 또는 전체글보기 주소를 입력하면 공개 게시글을 표시합니다.', value: cafeUrl,
  }) : null;
  const section = document.createElement('section');
  section.className = 'cafe-section content-card';
  section.id = 'cafeSection';

  const heading = document.createElement('div'); heading.className = 'cafe-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'NAVER CAFE';
  const title = document.createElement('h2'); title.textContent = '네이버 카페 전체글보기';
  copy.append(eyebrow, title);
  const actions = document.createElement('div'); actions.className = 'cafe-heading-actions';
  if (cafeUrl) {
    const more = document.createElement('a'); more.className = 'cafe-more-link';
    more.href = (state.data && state.data.cafeListUrl) || cafeUrl;
    more.target = '_blank'; more.rel = 'noopener noreferrer'; more.textContent = '더보기 ↗';
    actions.append(more);
  }
  if (editor && editor.toggleButton) actions.append(editor.toggleButton);
  heading.append(copy, actions); section.append(heading);

  if (!cafeUrl) {
    const empty = document.createElement('p');
    empty.className = 'profile-link-empty-state';
    empty.textContent = '네이버 카페 주소가 아직 등록되지 않았어요.';
    section.append(empty);
    if (editor) section.append(editor.element);
    return section;
  }
  if (editor) section.append(editor.element);

  if (state.loading && !state.hasLoaded) {
    const status = document.createElement('p'); status.className = 'cafe-status';
    status.setAttribute('role', 'status'); status.textContent = '카페 글 목록을 불러오고 있어요.';
    section.append(status);
    return section;
  }
  if (state.error && !state.hasLoaded) {
    const status = document.createElement('div'); status.className = 'cafe-status is-error';
    const message = document.createElement('span'); message.textContent = state.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button cafe-retry-button';
    retry.textContent = '다시 불러오기'; retry.addEventListener('click', () => loadCafePosts(streamerId));
    status.append(message, retry); section.append(status);
    return section;
  }
  if (state.stale) {
    const stale = document.createElement('p'); stale.className = 'cafe-stale-note';
    stale.textContent = '네이버 카페 연결이 원활하지 않아 이전 목록을 표시하고 있어요.';
    section.append(stale);
  }
  const items = state.data && Array.isArray(state.data.items) ? state.data.items : [];
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'cafe-status';
    empty.textContent = state.hasLoaded ? '표시할 공개 게시글이 없어요.' : '카페 글 목록을 불러오고 있어요.';
    section.append(empty);
    return section;
  }

  const list = document.createElement('div'); list.className = 'cafe-post-list';
  items.forEach((post) => {
    if (!post || !Number.isSafeInteger(Number(post.articleId)) || !/^\d+$/.test(String(post.cafeId || state.data.cafeId || ''))) return;
    const cafeId = String(post.cafeId || state.data.cafeId);
    const articleId = String(post.articleId);
    const row = document.createElement('a'); row.className = 'cafe-post-row';
    row.href = `https://cafe.naver.com/ca-fe/cafes/${encodeURIComponent(cafeId)}/articles/${encodeURIComponent(articleId)}`;
    row.target = '_blank'; row.rel = 'noopener noreferrer';
    const postTitle = document.createElement('span'); postTitle.className = 'cafe-post-title';
    postTitle.textContent = String(post.title || '제목 없음');
    const metadata = document.createElement('span'); metadata.className = 'cafe-post-meta';
    const author = document.createElement('span'); author.className = 'cafe-post-author'; author.textContent = String(post.writer || '');
    const date = document.createElement('time'); date.className = 'cafe-post-date';
    const timestamp = Number(post.writeDate);
    if (Number.isFinite(timestamp)) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(timestamp));
      const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      date.dateTime = new Date(timestamp).toISOString();
      date.textContent = `${dateParts.year}.${dateParts.month}.${dateParts.day}.`;
    } else date.textContent = '';
    const comments = document.createElement('span'); comments.className = 'cafe-post-comments';
    comments.textContent = String(Math.max(0, Math.floor(Number(post.commentCount) || 0)));
    comments.setAttribute('aria-label', `댓글 ${comments.textContent}개`);
    metadata.append(author, date, comments); row.append(postTitle, metadata); list.append(row);
  });
  if (!list.childElementCount) {
    const empty = document.createElement('p'); empty.className = 'cafe-status'; empty.textContent = '표시할 공개 게시글이 없어요.';
    section.append(empty);
  } else section.append(list);
  return section;
}

function refreshCafeSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('cafeSection');
  if (!section) return;
  section.replaceWith(renderCafeSection(currentPage));
}

async function loadCafePosts(streamerId) {
  const state = cafeStateFor(streamerId);
  if (state.loading || state.hasLoaded) return;
  state.loading = true;
  state.error = '';
  refreshCafeSection(streamerId);
  try {
    const response = await callCafePosts({ streamerId });
    if (!currentPage || currentPage.streamer.id !== streamerId) return;
    state.data = response.data && response.data.cafe ? response.data.cafe : { items: [] };
    state.stale = response.data && response.data.stale === true;
    state.hasLoaded = true;
  } catch (error) {
    if (!currentPage || currentPage.streamer.id !== streamerId) return;
    state.error = error.message || '카페 글 목록을 불러오지 못했어요.';
  } finally {
    state.loading = false;
    refreshCafeSection(streamerId);
  }
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function calendarStateFor(streamerId) {
  if (!calendarStates.has(streamerId)) {
    const today = new Date();
    calendarStates.set(streamerId, {
      view: 'month', year: today.getFullYear(), month: today.getMonth() + 1,
      selectedDate: localDateKey(today), days: [], fetchedAt: null,
      loading: false, error: '', stale: false, requestId: 0,
    });
  }
  return calendarStates.get(streamerId);
}

function calendarWeekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function calendarPeriodLabel(state) {
  if (state.view === 'month') return `${state.year}년 ${state.month}월`;
  const selected = parseLocalDateKey(state.selectedDate);
  const start = calendarWeekStart(selected);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const formatter = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function galleryPageUrl(page, category = 'all') {
  const url = new URL('https://neezu-crypto.github.io/streamer-gallery/');
  url.searchParams.set('streamer', page.streamer.nickname);
  if (category !== 'all') url.searchParams.set('category', category);
  return url.href;
}

function renderGallerySection(page) {
  const section = document.createElement('section');
  section.className = 'fan-gallery-section content-card';
  section.id = 'fanGallerySection';

  const heading = document.createElement('div'); heading.className = 'fan-gallery-heading';
  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'STREAMER GALLERY';
  const title = document.createElement('h2'); title.textContent = '팬 갤러리';
  const subtitle = document.createElement('p'); subtitle.className = 'fan-gallery-subtitle'; subtitle.textContent = '팬들이 남긴 순간';
  headingCopy.append(eyebrow, title, subtitle);
  const headingActions = document.createElement('div'); headingActions.className = 'fan-gallery-heading-actions';
  const count = document.createElement('span'); count.className = 'fan-gallery-count'; count.textContent = '불러오는 중';
  const allGalleryLink = document.createElement('a'); allGalleryLink.className = 'button button-primary fan-gallery-all-link';
  allGalleryLink.href = galleryPageUrl(page); allGalleryLink.target = '_blank'; allGalleryLink.rel = 'noopener noreferrer';
  allGalleryLink.textContent = '전체 갤러리 보기 ↗';
  headingActions.append(count, allGalleryLink); heading.append(headingCopy, headingActions);

  const tabs = document.createElement('div'); tabs.className = 'fan-gallery-tabs';
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '갤러리 종류');
  const categories = [
    { id: 'all', label: '전체' },
    { id: 'fan-art', label: '팬아트' },
    { id: 'screenshot', label: '방송 캡처' },
  ];
  let activeCategory = 'all';
  let galleryData = null;
  let isLoading = true;
  let errorMessage = '';
  let hasLoaded = false;
  let loadingPromise = null;
  const status = document.createElement('p'); status.className = 'fan-gallery-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const grid = document.createElement('div'); grid.className = 'fan-gallery-grid';

  function renderItems() {
    count.textContent = galleryData
      ? `전체 ${Number(galleryData.totalCount || 0).toLocaleString('ko-KR')}개`
      : isLoading ? '불러오는 중' : '';
    allGalleryLink.href = galleryPageUrl(page, activeCategory);
    tabs.querySelectorAll('[role="tab"]').forEach((button) => {
      const selected = button.dataset.category === activeCategory;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-active', selected);
    });
    grid.replaceChildren();
    if (isLoading) {
      status.textContent = '갤러리 이미지를 불러오고 있어요.';
      status.classList.remove('is-error');
      return;
    }
    if (errorMessage) {
      status.replaceChildren();
      const message = document.createElement('span'); message.textContent = errorMessage;
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button fan-gallery-retry';
      retry.textContent = '다시 불러오기'; retry.addEventListener('click', loadGallery);
      status.append(message, retry); status.classList.add('is-error');
      return;
    }
    status.classList.remove('is-error');
    const matchingItems = (galleryData?.items || []).filter((item) => activeCategory === 'all' || item.category === activeCategory);
    const items = activeCategory === 'all' ? matchingItems.slice(0, Number(galleryData?.previewSize) || 8) : matchingItems;
    if (!items.length) {
      status.textContent = galleryData?.linked === false
        ? '연결된 스트리머 갤러리를 찾지 못했어요.'
        : galleryData?.totalCount
          ? '선택한 분류의 이미지가 아직 없어요.'
          : '아직 이 스트리머의 갤러리 이미지가 없어요.';
      return;
    }
    status.textContent = '';
    items.forEach((item) => {
      const card = document.createElement('a'); card.className = 'fan-gallery-card';
      card.href = galleryPageUrl(page, item.category); card.target = '_blank'; card.rel = 'noopener noreferrer';
      card.setAttribute('aria-label', `${page.streamer.nickname} ${item.categoryLabel} 갤러리 보기`);
      const frame = document.createElement('span'); frame.className = 'fan-gallery-thumb-frame';
      const image = document.createElement('img'); image.className = 'fan-gallery-thumb';
      image.src = item.thumbUrl; image.alt = ''; image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); frame.classList.add('is-missing'); }, { once: true });
      const category = document.createElement('span'); category.className = 'fan-gallery-category'; category.textContent = item.categoryLabel;
      frame.append(image, category);
      const details = document.createElement('span'); details.className = 'fan-gallery-card-details';
      const date = document.createElement('span'); date.className = 'fan-gallery-date';
      date.textContent = item.createdAt ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(item.createdAt)) : '날짜 정보 없음';
      const stats = document.createElement('span'); stats.className = 'fan-gallery-stats';
      stats.textContent = `♥ ${Number(item.likeCount || 0).toLocaleString('ko-KR')}　댓글 ${Number(item.commentCount || 0).toLocaleString('ko-KR')}`;
      details.append(date, stats); card.append(frame, details); grid.append(card);
    });
  }

  async function loadGallery() {
    if (loadingPromise) return loadingPromise;
    if (hasLoaded && !errorMessage) return;
    isLoading = true; errorMessage = ''; renderItems();
    loadingPromise = (async () => {
      try {
        const response = await callGallery({ streamerId: page.streamer.id });
        if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
        galleryData = response.data || { totalCount: 0, items: [] };
        hasLoaded = true;
      } catch (error) {
        if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
        errorMessage = error.message || '갤러리를 불러오지 못했어요.';
      } finally {
        if (currentPage && currentPage.streamer.id === page.streamer.id) {
          isLoading = false;
          renderItems();
        }
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  categories.forEach(({ id, label }) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab');
    button.dataset.category = id; button.textContent = label;
    button.addEventListener('click', () => { activeCategory = id; renderItems(); });
    tabs.append(button);
  });
  section.append(heading, tabs, status, grid);
  section.loadGallery = loadGallery;
  return section;
}

function weeklyScheduleWeekTitle(streamerName, weekStart) {
  const monday = parseLocalDateKey(weekStart);
  // 목요일이 포함된 달을 해당 주의 달로 사용해 월 경계를 넘는 주도 일정하게 표시한다.
  const reference = new Date(monday); reference.setDate(reference.getDate() + 3);
  const firstDay = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const weekOfMonth = Math.floor((reference.getDate() - 1 + mondayOffset) / 7) + 1;
  return `${streamerName}의 ${reference.getMonth() + 1}월 ${weekOfMonth}주차 일정`;
}

function weekStartFromDate(value) {
  const date = parseLocalDateKey(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(date);
}

function formatWeeklyScheduleDate(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

// 원본 템플릿 1672×941px에서 장식 테두리를 피해서 측정한 실제 입력 그리드.
// 캔버스 출력과 HTML 입력 오버레이가 이 좌표를 함께 사용한다.
const WEEKLY_SCHEDULE_LAYOUT = Object.freeze({
  width: 1672,
  height: 941,
  title: Object.freeze({ centerX: 1120, centerY: 99, maxWidth: 660, previousX: 722, nextX: 1515 }),
  avatar: Object.freeze({ x: 94, y: 176, w: 390, h: 565 }),
  footer: Object.freeze({ centerX: 301, centerY: 850, maxWidth: 408, field: Object.freeze({ x: 81, y: 822, w: 440, h: 56 }) }),
  days: Object.freeze([
    ...Array.from({ length: 4 }, (_, index) => Object.freeze({ x: 585 + index * 262, y: 171, w: 242, h: 323, time: Object.freeze({ left: 0.08, top: 0.17, width: 0.82, height: 0.18 }), content: Object.freeze({ left: 0.10, top: 0.40, width: 0.80, height: 0.34 }), linked: Object.freeze({ left: 0.08, top: 0.75, width: 0.84, height: 0.09 }), offline: Object.freeze({ top: 0.105, right: 0.08 }), weekdayY: 0.90 })),
    ...Array.from({ length: 3 }, (_, index) => Object.freeze({ x: 588 + index * 347, y: 525, w: 317, h: 331, time: Object.freeze({ left: 0.08, top: 0.16, width: 0.82, height: 0.17 }), content: Object.freeze({ left: 0.10, top: 0.39, width: 0.80, height: 0.34 }), linked: Object.freeze({ left: 0.08, top: 0.74, width: 0.84, height: 0.09 }), offline: Object.freeze({ top: 0.10, right: 0.08 }), weekdayY: 0.90 })),
  ]),
});

function weeklyScheduleRegion(rect, region) {
  return {
    x: rect.x + rect.w * region.left,
    y: rect.y + rect.h * region.top,
    w: rect.w * region.width,
    h: rect.h * region.height,
  };
}

function setWeeklySchedulePercentRect(element, rect) {
  element.style.left = `${rect.x / WEEKLY_SCHEDULE_LAYOUT.width * 100}%`;
  element.style.top = `${rect.y / WEEKLY_SCHEDULE_LAYOUT.height * 100}%`;
  element.style.width = `${rect.w / WEEKLY_SCHEDULE_LAYOUT.width * 100}%`;
  element.style.height = `${rect.h / WEEKLY_SCHEDULE_LAYOUT.height * 100}%`;
}

function setWeeklyScheduleArrowPosition(element, x) {
  element.style.left = `${x / WEEKLY_SCHEDULE_LAYOUT.width * 100}cqw`;
  element.style.top = `${WEEKLY_SCHEDULE_LAYOUT.title.centerY / WEEKLY_SCHEDULE_LAYOUT.width * 100}cqw`;
}

function wrapWeeklyScheduleCanvasText(ctx, value, maxWidth, maxLines) {
  const lines = [];
  const characters = Array.from(String(value || '').replace(/\r/g, ''));
  let line = '';
  let overflow = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '\n') {
      lines.push(line.trimEnd()); line = '';
      if (lines.length >= maxLines) { overflow = index < characters.length - 1; break; }
      continue;
    }
    const candidate = line + character;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line.trimEnd()); line = character.trim() ? character : '';
      if (lines.length >= maxLines) { overflow = true; break; }
    } else line = candidate;
  }
  if (line && lines.length < maxLines) lines.push(line.trimEnd());
  if (lines.length > maxLines) { lines.length = maxLines; overflow = true; }
  if (overflow && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = Array.from(last).slice(0, -1).join('');
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function drawWeeklyScheduleTitle(ctx, value) {
  const title = String(value || '');
  let fontSize = 50;
  const { centerX, centerY, maxWidth } = WEEKLY_SCHEDULE_LAYOUT.title;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#a74464';
  ctx.font = `800 ${fontSize}px Jua, "Gowun Dodum", sans-serif`;
  while (ctx.measureText(title).width > maxWidth && fontSize > 25) {
    fontSize -= 1;
    ctx.font = `800 ${fontSize}px Jua, "Gowun Dodum", sans-serif`;
  }
  const metrics = ctx.measureText(title);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.75;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  ctx.fillText(title, centerX, centerY + (ascent - descent) / 2, maxWidth);
  return fontSize;
}

function drawWeeklyScheduleFooterText(ctx, value, centerX, centerY, maxWidth) {
  const fullText = String(value || '');
  let fontSize = 30;
  const minimumFontSize = 18;
  const setFont = () => { ctx.font = `800 ${fontSize}px Jua, "Gowun Dodum", sans-serif`; };
  setFont();
  while (ctx.measureText(fullText).width > maxWidth && fontSize > minimumFontSize) {
    fontSize -= 1;
    setFont();
  }
  let displayText = fullText;
  const overflow = ctx.measureText(fullText).width > maxWidth;
  if (overflow) {
    const characters = Array.from(fullText);
    while (characters.length && ctx.measureText(`${characters.join('')}…`).width > maxWidth) characters.pop();
    displayText = characters.length ? `${characters.join('')}…` : '…';
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, centerX, centerY);
  return { overflow, fontSize };
}

function createWeeklyScheduleStageArrow(direction) {
  const previous = direction === 'previous';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `weekly-schedule-arrow weekly-schedule-stage-${previous ? 'previous' : 'next'}`;
  button.setAttribute('aria-label', previous ? '이전 주 일정' : '다음 주 일정');
  button.textContent = previous ? '‹' : '›';
  return button;
}

async function ensureWeeklyScheduleFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('800 50px Jua'),
    document.fonts.load('700 32px "Gowun Dodum"'),
  ]);
}

function normalizeGraphicTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const hourOnly = /^(\d{1,2})$/.exec(text);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (hour < 0 || hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:00`;
  }
  const full = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!full) return null;
  const hour = Number(full[1]); const minute = Number(full[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function updateWeeklyScheduleTargets(page, state, board, statusMessage = '') {
  const sourceBoard = board?._weeklyScheduleSourceBoard || (board?.classList.contains('weekly-schedule-board') ? board : null);
  const visibleBoards = new Set([sourceBoard, board, sourceBoard?._weeklyScheduleViewDialog].filter((item) => item?.isConnected));
  const start = parseLocalDateKey(state.weekStart);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  visibleBoards.forEach((targetBoard) => {
    const boardTitle = targetBoard.querySelector('.weekly-schedule-title');
    const boardRange = targetBoard.querySelector('.weekly-schedule-date-range');
    const boardStatus = targetBoard.querySelector('.weekly-schedule-status');
    if (boardTitle) boardTitle.textContent = weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart);
    if (boardRange) boardRange.textContent = `${formatWeeklyScheduleDate(start)} – ${formatWeeklyScheduleDate(end)}`;
    if (boardStatus) boardStatus.textContent = statusMessage;
    void targetBoard._drawWeeklyBoard?.();
  });
  const editor = $('weeklyScheduleGraphicDialog');
  if (editor?.open) {
    editor._syncWeeklyFields?.();
    editor._refreshWeeklySchedulePreview?.();
  }
}

async function loadWeeklySchedulePageData(page, weekStart, board, options = {}) {
  const state = weeklyScheduleGraphicStateFor(page.streamer.id);
  const requestId = ++state.loadRequestId;
  const requestedWeekStart = weekStartFromDate(weekStart);
  const weekChanged = state.weekStart !== requestedWeekStart;
  if (weekChanged) {
    state.entries = Array.from({ length: 7 }, () => ({ time: '', content: '', offline: false }));
    state.linkedEvents = Array.from({ length: 7 }, () => []);
    state.footerText = '';
    state.avatarImageId = '';
    state.savedAvatar = null;
    state.carriedForwardFrom = '';
    state.avatarUnavailable = false;
    state.selectedImage = null;
    if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
    state.localObjectUrl = '';
    state.updatedAt = 0;
  }
  state.weekStart = requestedWeekStart;
  state.loading = true;
  updateWeeklyScheduleTargets(page, state, board, '일정을 불러오는 중이에요.');
  const start = parseLocalDateKey(state.weekStart); const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setDate(date.getDate() + index); return localDateKey(date);
  });
  const months = [...new Set(dates.map((dateKey) => { const date = parseLocalDateKey(dateKey); return `${date.getFullYear()}-${date.getMonth() + 1}`; }))];
  try {
    const [saved, calendarResults] = await Promise.all([
      callWeeklySchedule({
        action: 'get', streamerId: page.streamer.id, weekStart: state.weekStart,
        carryForward: options.carryForward === true,
      }),
      Promise.all(months.map((monthKey) => {
        const [year, month] = monthKey.split('-').map(Number);
        return callCalendar({ streamerId: page.streamer.id, view: 'month', year, month, day: 1 })
          .catch((error) => ({ data: { days: [], loadError: error.message || 'SOOP 일정을 불러오지 못했어요.' } }));
      })),
    ]);
    if (requestId !== state.loadRequestId) return;
    const savedAvatarId = saved.data.avatarImageId || '';
    if (state.avatarImageId !== savedAvatarId) {
      state.selectedImage = null;
      if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
      state.localObjectUrl = '';
    }
    state.entries = Array.isArray(saved.data.entries) && saved.data.entries.length === 7
      ? saved.data.entries.map((entry) => ({ time: String(entry.time || ''), content: String(entry.content || ''), offline: entry.offline === true }))
      : Array.from({ length: 7 }, () => ({ time: '', content: '', offline: false }));
    state.footerText = typeof saved.data.footerText === 'string' ? saved.data.footerText.slice(0, 48) : '';
    state.avatarImageId = savedAvatarId;
    state.updatedAt = Number(saved.data.updatedAt) || 0;
    state.weekUpdatedAtByStart[state.weekStart] = state.updatedAt;
    state.savedAvatar = saved.data.avatar || null;
    state.carriedForwardFrom = typeof saved.data.carriedForwardFrom === 'string' ? saved.data.carriedForwardFrom : '';
    state.avatarUnavailable = saved.data.avatarUnavailable === true;
    const eventMap = new Map(dates.map((date) => [date, []]));
    const calendarErrors = calendarResults.map((result) => result.data.loadError).filter(Boolean);
    calendarResults.forEach((result) => (result.data.days || []).forEach((day) => {
      if (eventMap.has(day.date)) eventMap.set(day.date, day.events || []);
    }));
    state.linkedEvents = dates.map((date) => eventMap.get(date) || []);
    state.loading = false; state.dirty = false;
    state.saveStatus = state.avatarUnavailable ? '아바타 이미지를 불러오지 못했어요. 갤러리에서 다시 선택해 주세요.' : '';
    const statusMessages = [];
    if (state.carriedForwardFrom) statusMessages.push('이전 방송표의 내용을 가져왔어요.');
    if (state.avatarUnavailable) statusMessages.push('아바타 이미지는 갤러리에서 다시 선택해 주세요.');
    if (calendarErrors.length) statusMessages.push('SOOP 일정을 불러오지 못해 저장된 방송표만 표시하고 있어요.');
    updateWeeklyScheduleTargets(page, state, board, statusMessages.join(' '));
  } catch (error) {
    if (requestId !== state.loadRequestId) return;
    state.loading = false;
    const rawMessage = String(error && error.message || '');
    const message = /\binternal\b|\bnot[- ]found\b|unknown error/i.test(rawMessage)
      ? '주간 방송표를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
      : rawMessage || '일정을 불러오지 못했어요.';
    updateWeeklyScheduleTargets(page, state, board, message);
  }
}

function renderCalendarSection(page) {
  const state = weeklyScheduleGraphicStateFor(page.streamer.id);
  const canManage = page.isOwner || isAdminUser;
  const mobileScheduleMedia = window.matchMedia('(max-width: 720px)');
  const section = document.createElement('section');
  section.className = 'weekly-schedule-board content-card'; section.id = 'calendarSection';
  const heading = document.createElement('header'); heading.className = 'weekly-schedule-board-heading';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'STREAMER SCHEDULE';
  const title = document.createElement('h2'); title.className = 'weekly-schedule-title weekly-schedule-sr-title'; title.textContent = weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart);
  const dateRange = document.createElement('p'); dateRange.className = 'weekly-schedule-date-range';
  const startDate = parseLocalDateKey(state.weekStart); const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
  dateRange.textContent = `${formatWeeklyScheduleDate(startDate)} – ${formatWeeklyScheduleDate(endDate)}`;
  const status = document.createElement('p'); status.className = 'weekly-schedule-status'; status.setAttribute('role', 'status');
  heading.append(eyebrow, title, dateRange, status);

  const imageFrame = document.createElement('div'); imageFrame.className = 'weekly-schedule-board-frame';
  const canvas = document.createElement('canvas'); canvas.width = WEEKLY_SCHEDULE_LAYOUT.width; canvas.height = WEEKLY_SCHEDULE_LAYOUT.height; canvas.className = 'weekly-schedule-board-canvas';
  const avatar = document.createElement('img'); avatar.className = 'weekly-schedule-board-avatar'; avatar.alt = `${page.streamer.nickname} 갤러리 이미지`; avatar.hidden = true;
  setWeeklySchedulePercentRect(avatar, WEEKLY_SCHEDULE_LAYOUT.avatar);
  const previous = createWeeklyScheduleStageArrow('previous');
  const next = createWeeklyScheduleStageArrow('next');
  setWeeklyScheduleArrowPosition(previous, WEEKLY_SCHEDULE_LAYOUT.title.previousX);
  setWeeklyScheduleArrowPosition(next, WEEKLY_SCHEDULE_LAYOUT.title.nextX);
  const dateCaption = document.createElement('p'); dateCaption.className = 'weekly-schedule-date-caption';
  const mobileList = document.createElement('div'); mobileList.className = 'weekly-schedule-mobile-list';
  imageFrame.append(canvas, avatar, previous, next, dateCaption, mobileList);
  let template = null; let templatePromise = null;
  const ctx = canvas.getContext('2d');
  function drawBoard() {
    if (!ctx) return;
    if (!templatePromise) {
      templatePromise = new Promise((resolve) => {
        template = new Image(); template.onload = resolve; template.onerror = resolve;
        template.src = new URL('./assets/weekly-schedule-template.png?v=20261031-weekly-board-v2', import.meta.url).href;
      });
    }
    return templatePromise.then(async () => {
      await ensureWeeklyScheduleFonts();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (template?.naturalWidth) ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
      const weekStart = parseLocalDateKey(state.weekStart); const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      ctx.save();
      drawWeeklyScheduleTitle(ctx, weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart));
      const defaultFooterText = `${formatWeeklyScheduleDate(weekStart)} – ${formatWeeklyScheduleDate(weekEnd)}`;
      const footerText = state.footerText || defaultFooterText;
      dateCaption.textContent = footerText;
      ctx.fillStyle = '#9b365c';
      ctx.shadowColor = '#ffffffd9'; ctx.shadowBlur = 3;
      const footer = WEEKLY_SCHEDULE_LAYOUT.footer;
      drawWeeklyScheduleFooterText(ctx, footerText, footer.centerX, footer.centerY, footer.maxWidth); ctx.shadowBlur = 0;
      const days = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
      WEEKLY_SCHEDULE_LAYOUT.days.forEach((rect, index) => {
        const { x, y, w, h } = rect; const entry = state.entries[index] || {};
        const linked = state.linkedEvents[index] || [];
        const lines = [];
        if (!entry.offline && entry.content) lines.push(entry.content);
        linked.forEach((event) => lines.push(`${event.time ? `${event.time} ` : ''}${event.title || event.typeName || '방송 일정'}`));
        const linkedHoliday = linked.some((event) => event.typeName === '휴방');
        const firstLine = entry.offline || linkedHoliday ? '휴방' : (normalizeGraphicTime(entry.time) || linked.find((event) => event.time)?.time || '');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const timeBox = weeklyScheduleRegion(rect, rect.time);
        const contentBox = weeklyScheduleRegion(rect, rect.content);
        ctx.fillStyle = '#a63d61'; ctx.font = `800 ${w < 260 ? 36 : 38}px Jua, "Gowun Dodum", sans-serif`;
        if (firstLine) ctx.fillText(firstLine, timeBox.x + timeBox.w / 2, timeBox.y + timeBox.h / 2, timeBox.w);
        const fontSize = w < 260 ? 29 : 31;
        ctx.fillStyle = '#a94d6b'; ctx.font = `700 ${fontSize}px Gowun Dodum, sans-serif`;
        const lineHeight = w < 260 ? 34 : 36;
        const shown = lines.flatMap((line) => wrapWeeklyScheduleCanvasText(ctx, line, contentBox.w, Math.max(1, Math.floor(contentBox.h / lineHeight)))).slice(0, Math.floor(contentBox.h / lineHeight));
        const centerY = contentBox.y + contentBox.h / 2; const startY = centerY - ((shown.length - 1) * lineHeight) / 2;
        shown.forEach((line, lineIndex) => {
          ctx.fillText(line, contentBox.x + contentBox.w / 2, startY + lineIndex * lineHeight, contentBox.w);
        });
        ctx.fillStyle = '#a63d61'; ctx.font = '800 30px Jua, "Gowun Dodum", sans-serif';
        ctx.fillText(days[index], x + w / 2, y + h * rect.weekdayY, w - 24);
      });
      ctx.restore();
      mobileList.replaceChildren();
      days.forEach((weekday, index) => {
        const row = document.createElement('article'); row.className = 'weekly-schedule-mobile-day';
        const date = new Date(weekStart); date.setDate(date.getDate() + index);
        const label = document.createElement('strong'); label.textContent = `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekday}`;
        const details = document.createElement('p');
        const entry = state.entries[index] || {}; const linked = state.linkedEvents[index] || [];
        const lines = [];
        if (entry.offline) lines.push('휴방');
        else if (entry.time || entry.content) lines.push(`${entry.time || '시간 미정'}${entry.content ? ` · ${entry.content}` : ''}`);
        linked.forEach((event) => lines.push(`${event.time ? `${event.time} ` : ''}${event.title || event.typeName || '방송 일정'}`));
        details.textContent = lines.length ? lines.join(' / ') : '등록된 일정 없음';
        row.append(label, details); mobileList.append(row);
      });
      const savedAvatarUrl = state.selectedImage?.thumbUrl || state.savedAvatar?.thumbUrl
        || state.selectedImage?.imageUrl || state.savedAvatar?.imageUrl || '';
      avatar.hidden = !savedAvatarUrl;
      if (savedAvatarUrl && avatar.src !== savedAvatarUrl) avatar.src = savedAvatarUrl;
    });
  }
  section._drawWeeklyBoard = drawBoard;
  const edit = canManage ? document.createElement('button') : null;
  if (edit) {
    edit.type = 'button'; edit.className = 'weekly-schedule-board-edit';
    edit.setAttribute('aria-label', '방송표 편집'); edit.title = '방송표 편집';
    edit.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
    edit.addEventListener('click', (event) => { event.stopPropagation(); if (!mobileScheduleMedia.matches) openWeeklyScheduleDialog(page); });
    imageFrame.append(edit);
  }
  const openSchedule = () => {
    if (canManage && !mobileScheduleMedia.matches) openWeeklyScheduleDialog(page);
    else openWeeklyScheduleViewDialog(page, section);
  };
  imageFrame.addEventListener('click', openSchedule);
  imageFrame.addEventListener('keydown', (event) => {
    if (event.target !== imageFrame) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSchedule(); }
  });
  const syncScheduleActivation = () => {
    imageFrame.tabIndex = 0; imageFrame.setAttribute('role', 'group');
    imageFrame.setAttribute('aria-label', `주간 방송표. 클릭하거나 Enter를 눌러 ${canManage && !mobileScheduleMedia.matches ? '편집' : '크게 보기'}할 수 있습니다. 양쪽 화살표로 주차를 이동합니다.`);
    if (edit) edit.hidden = mobileScheduleMedia.matches;
  };
  syncScheduleActivation();
  if (typeof mobileScheduleMedia.addEventListener === 'function') mobileScheduleMedia.addEventListener('change', syncScheduleActivation);
  else mobileScheduleMedia.addListener(syncScheduleActivation);
  section._cleanupWeeklyScheduleViewport = () => {
    if (typeof mobileScheduleMedia.removeEventListener === 'function') mobileScheduleMedia.removeEventListener('change', syncScheduleActivation);
    else mobileScheduleMedia.removeListener(syncScheduleActivation);
  };
  previous.addEventListener('click', (event) => {
    event.stopPropagation();
    const date = parseLocalDateKey(state.weekStart); date.setDate(date.getDate() - 7);
    void loadWeeklySchedulePageData(page, localDateKey(date), section);
  });
  next.addEventListener('click', (event) => {
    event.stopPropagation();
    const date = parseLocalDateKey(state.weekStart); date.setDate(date.getDate() + 7);
    void loadWeeklySchedulePageData(page, localDateKey(date), section, { carryForward: true });
  });
  section.append(heading, imageFrame);
  drawBoard();
  void loadWeeklySchedulePageData(page, state.weekStart, section);
  return section;
}

function renderWeeklyScheduleViewDialog(page, board) {
  const state = weeklyScheduleGraphicStateFor(page.streamer.id);
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog weekly-schedule-view-dialog';
  dialog.setAttribute('aria-label', '주간 방송표');
  const card = document.createElement('section'); card.className = 'account-dialog-card weekly-schedule-view-card';
  const header = document.createElement('header'); header.className = 'weekly-schedule-view-heading';
  const title = document.createElement('h2'); title.className = 'weekly-schedule-title weekly-schedule-sr-title';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close'; close.setAttribute('aria-label', '주간 방송표 닫기'); close.textContent = '×';
  header.append(title, close);
  const dateRange = document.createElement('p'); dateRange.className = 'weekly-schedule-date-range';
  const readingHint = document.createElement('p'); readingHint.className = 'weekly-schedule-view-hint'; readingHint.textContent = '주간 일정은 누구나 열람할 수 있어요.';
  const status = document.createElement('p'); status.className = 'weekly-schedule-status'; status.setAttribute('role', 'status');
  const frame = document.createElement('div'); frame.className = 'weekly-schedule-view-frame';
  const canvas = document.createElement('canvas'); canvas.width = WEEKLY_SCHEDULE_LAYOUT.width; canvas.height = WEEKLY_SCHEDULE_LAYOUT.height; canvas.className = 'weekly-schedule-view-canvas'; canvas.setAttribute('aria-label', '주간 방송표 미리보기');
  const avatar = document.createElement('img'); avatar.className = 'weekly-schedule-board-avatar'; avatar.alt = `${page.streamer.nickname} 갤러리 이미지`; avatar.hidden = true;
  setWeeklySchedulePercentRect(avatar, WEEKLY_SCHEDULE_LAYOUT.avatar);
  const previous = createWeeklyScheduleStageArrow('previous');
  const next = createWeeklyScheduleStageArrow('next');
  setWeeklyScheduleArrowPosition(previous, WEEKLY_SCHEDULE_LAYOUT.title.previousX);
  setWeeklyScheduleArrowPosition(next, WEEKLY_SCHEDULE_LAYOUT.title.nextX);
  frame.append(canvas, avatar, previous, next);
  const detailsHeading = document.createElement('h3'); detailsHeading.className = 'weekly-schedule-view-details-title'; detailsHeading.textContent = '요일별 일정';
  const footerCaption = document.createElement('p'); footerCaption.className = 'weekly-schedule-view-footer-caption';
  const details = document.createElement('div'); details.className = 'weekly-schedule-view-details';
  card.append(header, dateRange, readingHint, status, frame, footerCaption, detailsHeading, details); dialog.append(card);
  const ctx = canvas.getContext('2d');
  const weekdays = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  async function drawView() {
    await board?._drawWeeklyBoard?.();
    const sourceCanvas = board?.querySelector('.weekly-schedule-board-canvas');
    if (ctx && sourceCanvas) ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    const sourceAvatar = board?.querySelector('.weekly-schedule-board-avatar');
    avatar.hidden = !sourceAvatar || sourceAvatar.hidden;
    if (!avatar.hidden && sourceAvatar.src !== avatar.src) avatar.src = sourceAvatar.src;
    title.textContent = weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart);
    const start = parseLocalDateKey(state.weekStart); const end = new Date(start); end.setDate(end.getDate() + 6);
    dateRange.textContent = `${formatWeeklyScheduleDate(start)} – ${formatWeeklyScheduleDate(end)}`;
    footerCaption.textContent = state.footerText || dateRange.textContent;
    details.replaceChildren();
    weekdays.forEach((weekday, index) => {
      const date = new Date(start); date.setDate(date.getDate() + index);
      const entry = state.entries[index] || {}; const linked = state.linkedEvents[index] || [];
      const item = document.createElement('article'); item.className = 'weekly-schedule-view-day';
      const label = document.createElement('h4'); label.textContent = `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekday}`;
      const lines = [];
      if (entry.offline) lines.push('휴방');
      else if (entry.time || entry.content) lines.push(`${entry.time || '시간 미정'}${entry.content ? ` · ${entry.content}` : ''}`);
      linked.forEach((event) => lines.push(`${event.time ? `${event.time} ` : ''}${event.title || event.typeName || '방송 일정'}`.trim()));
      const text = document.createElement('p'); text.textContent = lines.length ? lines.join(' / ') : '등록된 일정 없음';
      item.append(label, text); details.append(item);
    });
  }
  const moveWeek = (offset) => {
    const date = parseLocalDateKey(state.weekStart); date.setDate(date.getDate() + offset * 7);
    void loadWeeklySchedulePageData(page, localDateKey(date), dialog, { carryForward: offset > 0 });
  };
  previous.addEventListener('click', (event) => { event.stopPropagation(); moveWeek(-1); });
  next.addEventListener('click', (event) => { event.stopPropagation(); moveWeek(1); });
  close.addEventListener('click', () => dialog.close());
  dialog._drawWeeklyBoard = drawView;
  dialog._weeklyScheduleSourceBoard = board;
  dialog.addEventListener('close', () => dialog.remove());
  return dialog;
}

function openWeeklyScheduleViewDialog(page, board) {
  if (!board?._weeklyScheduleViewDialog?.isConnected) {
    const dialog = renderWeeklyScheduleViewDialog(page, board);
    board._weeklyScheduleViewDialog = dialog; board.append(dialog);
  }
  const dialog = board._weeklyScheduleViewDialog;
  dialog._drawWeeklyBoard?.();
  showFanPageModal(dialog);
}

function openFanPageScheduleDialog(selectedDate) {
  const dialog = $('fanPageScheduleDialog');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  form.reset();
  form.querySelector('[name="date"]').value = selectedDate || localDateKey(new Date());
  showFanPageModal(dialog);
}

function selectCalendarDate(streamerId, state, date) {
  const changesMonth = state.view === 'month'
    && (date.getFullYear() !== state.year || date.getMonth() + 1 !== state.month);
  state.selectedDate = localDateKey(date);
  state.year = date.getFullYear();
  state.month = date.getMonth() + 1;
  if (changesMonth) {
    state.error = ''; state.days = []; state.fetchedAt = null; state.stale = false;
    refreshCalendarSection(streamerId);
    loadCalendar(streamerId);
  } else refreshCalendarSection(streamerId);
}

async function deleteFanPageSchedule(page, event, button) {
  if (!event || event.source !== 'fanpage' || !event.id || button.disabled) return;
  if (!window.confirm(`“${event.title || '이 일정'}” 일정을 삭제할까요?`)) return;
  button.disabled = true;
  button.textContent = '삭제 중…';
  try {
    await callScheduleDelete({ streamerId: page.streamer.id, eventId: event.id });
    const state = calendarStateFor(page.streamer.id);
    state.requestId += 1;
    state.days = (state.days || []).map((day) => ({
      ...day,
      events: (day.events || []).filter((item) => !(item.source === 'fanpage' && item.id === event.id)),
    })).filter((day) => day.events.length);
    state.fetchedAt = null; state.stale = false; state.error = ''; state.loading = false;
    showToast('팬페이지 일정을 삭제했어요.');
    refreshCalendarSection(page.streamer.id);
    loadCalendar(page.streamer.id);
  } catch (error) {
    showToast(error.message || '일정을 삭제하지 못했어요.');
  } finally {
    button.disabled = false;
    button.textContent = '삭제';
  }
}

function renderFanPageScheduleDialog(page) {
  const dialog = document.createElement('dialog'); dialog.id = 'fanPageScheduleDialog';
  dialog.className = 'account-dialog calendar-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'calendarEditorTitle');
  const form = document.createElement('form'); form.className = 'account-dialog-card calendar-editor-form';
  const heading = document.createElement('div'); heading.className = 'profile-editor-heading';
  const title = document.createElement('h2'); title.id = 'calendarEditorTitle'; title.textContent = '팬페이지 일정 추가';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close';
  close.setAttribute('aria-label', '일정 창 닫기'); close.textContent = '×'; close.addEventListener('click', () => dialog.close());
  heading.append(title, close);

  const fields = document.createElement('div'); fields.className = 'calendar-editor-grid';
  const dateLabel = document.createElement('label'); dateLabel.className = 'profile-editor-field'; dateLabel.textContent = '날짜';
  const date = document.createElement('input'); date.type = 'date'; date.name = 'date'; date.required = true;
  dateLabel.append(date);
  const timeLabel = document.createElement('label'); timeLabel.className = 'profile-editor-field'; timeLabel.textContent = '시간';
  const time = document.createElement('input'); time.type = 'time'; time.name = 'time';
  timeLabel.append(time);
  const typeLabel = document.createElement('label'); typeLabel.className = 'profile-editor-field'; typeLabel.textContent = '일정 종류';
  const type = document.createElement('select'); type.name = 'typeName';
  ['방송예정', '방송', '합방', '휴방', '기타'].forEach((value) => {
    const option = document.createElement('option'); option.value = value; option.textContent = value; type.append(option);
  });
  typeLabel.append(type);
  const titleLabel = document.createElement('label'); titleLabel.className = 'profile-editor-field calendar-editor-wide'; titleLabel.textContent = '일정 이름';
  const eventTitle = document.createElement('input'); eventTitle.type = 'text'; eventTitle.name = 'title'; eventTitle.maxLength = 200;
  eventTitle.placeholder = '예: 오늘 저녁 합방'; eventTitle.required = true;
  titleLabel.append(eventTitle);
  fields.append(dateLabel, timeLabel, typeLabel, titleLabel);

  const note = document.createElement('p'); note.className = 'calendar-editor-note';
  note.textContent = '추가한 일정은 SOOP 캘린더 일정과 함께 표시됩니다.';
  const footer = document.createElement('div'); footer.className = 'profile-editor-footer calendar-editor-footer';
  const hint = document.createElement('small'); hint.textContent = '일정은 팬페이지 서버에 저장됩니다.';
  const actions = document.createElement('div'); actions.className = 'profile-editor-footer-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소'; cancel.addEventListener('click', () => dialog.close());
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button button-primary'; save.textContent = '일정 추가';
  actions.append(cancel, save); footer.append(hint, actions);
  form.append(heading, fields, note, footer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || save.disabled) return;
    save.disabled = true; save.textContent = '저장 중…';
    try {
      await callScheduleAdd({
        streamerId: page.streamer.id,
        date: date.value,
        time: time.value,
        typeName: type.value,
        title: eventTitle.value.trim(),
      });
      const state = calendarStateFor(page.streamer.id);
      const addedDate = parseLocalDateKey(date.value);
      state.selectedDate = date.value; state.year = addedDate.getFullYear(); state.month = addedDate.getMonth() + 1;
      state.days = []; state.fetchedAt = null; state.stale = false; state.error = '';
      dialog.close(); form.reset();
      showToast('팬페이지 일정을 추가했어요.');
      refreshCalendarSection(page.streamer.id);
      loadCalendar(page.streamer.id);
    } catch (error) {
      showToast(error.message || '일정을 추가하지 못했어요.');
    } finally {
      save.disabled = false; save.textContent = '일정 추가';
    }
  });
  dialog.append(form);
  return dialog;
}

function weeklyScheduleGraphicStateFor(streamerId) {
  if (!weeklyScheduleGraphicStates.has(streamerId)) {
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const monday = parseLocalDateKey(`${todayParts.year}-${todayParts.month}-${todayParts.day}`);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    weeklyScheduleGraphicStates.set(streamerId, {
      weekStart: localDateKey(monday),
      footerText: '',
      selectedImage: null,
      avatarImageId: '',
      entries: Array.from({ length: 7 }, () => ({ time: '', content: '', offline: false })),
      linkedEvents: Array.from({ length: 7 }, () => []),
      updatedAt: 0,
      weekUpdatedAtByStart: {},
      carriedForwardFrom: '',
      avatarUnavailable: false,
      loading: false,
      loadRequestId: 0,
      saveTimer: 0,
      savePromise: null,
      saveStatus: '',
      dirty: false,
      localObjectUrl: '',
      galleryItems: [],
      galleryLoaded: false,
      galleryNextOffset: 0,
      galleryHasMore: false,
      galleryLoading: false,
      galleryOpen: false,
      uploadOpen: false,
      uploadBusy: false,
    });
  }
  return weeklyScheduleGraphicStates.get(streamerId);
}

function renderWeeklyScheduleDialog(page) {
  const state = weeklyScheduleGraphicStateFor(page.streamer.id);
  const dialog = document.createElement('dialog');
  dialog.id = 'weeklyScheduleGraphicDialog'; dialog.className = 'account-dialog weekly-schedule-dialog';
  const card = document.createElement('div'); card.className = 'account-dialog-card weekly-schedule-card';
  const header = document.createElement('div'); header.className = 'profile-editor-heading';
  const headingCopy = document.createElement('div');
  const title = document.createElement('h2'); title.id = 'weeklyScheduleGraphicTitle'; title.textContent = weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart);
  title.className = 'weekly-schedule-editor-title';
  const previousWeek = document.createElement('button'); previousWeek.type = 'button'; previousWeek.className = 'weekly-schedule-arrow'; previousWeek.setAttribute('aria-label', '이전 주 일정'); previousWeek.textContent = '‹';
  const nextWeek = document.createElement('button'); nextWeek.type = 'button'; nextWeek.className = 'weekly-schedule-arrow'; nextWeek.setAttribute('aria-label', '다음 주 일정'); nextWeek.textContent = '›';
  headingCopy.append(title);
  const saveStatus = document.createElement('span'); saveStatus.className = 'weekly-schedule-save-status weekly-schedule-header-status'; saveStatus.setAttribute('role', 'status');
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close';
  close.setAttribute('aria-label', '방송표 편집 닫기'); close.textContent = '×';
  header.append(headingCopy, saveStatus, close);

  const form = document.createElement('form'); form.className = 'weekly-schedule-form';
  form.addEventListener('submit', (event) => event.preventDefault());
  const meta = document.createElement('div'); meta.className = 'weekly-schedule-meta';
  const titleField = document.createElement('label'); titleField.className = 'profile-editor-field'; titleField.textContent = '방송표 제목';
  const graphicTitle = document.createElement('input'); graphicTitle.name = 'graphicTitle'; graphicTitle.type = 'text'; graphicTitle.maxLength = 70;
  graphicTitle.value = weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart); graphicTitle.readOnly = true;
  titleField.append(graphicTitle);
  const weekField = document.createElement('label'); weekField.className = 'profile-editor-field'; weekField.textContent = '월요일 날짜';
  const weekInput = document.createElement('input'); weekInput.name = 'weekStart'; weekInput.type = 'date'; weekInput.required = true; weekInput.value = state.weekStart;
  weekField.append(weekInput);
  meta.append(titleField, weekField); meta.hidden = true;

  let linkedEventsOpen = false;
  const linkedEventsToggle = document.createElement('button'); linkedEventsToggle.type = 'button'; linkedEventsToggle.className = 'weekly-schedule-linked-toggle';
  linkedEventsToggle.hidden = true; linkedEventsToggle.setAttribute('aria-expanded', 'false');
  const linkedEventsPanel = document.createElement('section'); linkedEventsPanel.className = 'weekly-schedule-linked-events';
  linkedEventsPanel.id = 'weeklyScheduleLinkedEvents'; linkedEventsToggle.setAttribute('aria-controls', linkedEventsPanel.id);
  const linkedEventsHeading = document.createElement('strong'); linkedEventsHeading.textContent = '자동 연동 일정';
  const linkedEventsList = document.createElement('div'); linkedEventsList.className = 'weekly-schedule-linked-list';
  linkedEventsPanel.append(linkedEventsHeading, linkedEventsList);
  linkedEventsPanel.hidden = true;

  const imageTools = document.createElement('dialog'); imageTools.className = 'account-dialog weekly-schedule-image-tools';
  imageTools.setAttribute('aria-label', '갤러리 이미지 선택 및 등록');
  const imageCard = document.createElement('div'); imageCard.className = 'account-dialog-card weekly-schedule-gallery-card';
  const imageHeading = document.createElement('div'); imageHeading.className = 'weekly-schedule-image-heading';
  const imageLabel = document.createElement('strong'); imageLabel.textContent = '갤러리 이미지';
  const imageNote = document.createElement('small'); imageNote.textContent = '이미지를 선택하면 방송표에 바로 적용돼요.';
  imageHeading.append(imageLabel, imageNote);
  const imageActions = document.createElement('div'); imageActions.className = 'weekly-schedule-image-actions';
  const chooseImage = document.createElement('button'); chooseImage.type = 'button'; chooseImage.className = 'button'; chooseImage.textContent = '갤러리에서 선택';
  const uploadImage = document.createElement('button'); uploadImage.type = 'button'; uploadImage.className = 'button'; uploadImage.textContent = '새 이미지 등록';
  const clearImage = document.createElement('button'); clearImage.type = 'button'; clearImage.className = 'button weekly-schedule-clear-image'; clearImage.textContent = '선택 이미지 제거';
  const closeImageTools = document.createElement('button'); closeImageTools.type = 'button'; closeImageTools.className = 'button'; closeImageTools.textContent = '닫기';
  imageActions.append(chooseImage, uploadImage, clearImage, closeImageTools);
  const selectedImageNote = document.createElement('p'); selectedImageNote.className = 'weekly-schedule-selected-image'; selectedImageNote.textContent = '왼쪽 사진 영역을 눌러 선택해 주세요.';

  const galleryPanel = document.createElement('div'); galleryPanel.className = 'weekly-schedule-gallery-picker'; galleryPanel.hidden = true;
  const galleryStatus = document.createElement('p'); galleryStatus.className = 'weekly-schedule-gallery-status'; galleryStatus.setAttribute('role', 'status');
  const galleryGrid = document.createElement('div'); galleryGrid.className = 'weekly-schedule-gallery-grid';
  const galleryMore = document.createElement('button'); galleryMore.type = 'button'; galleryMore.className = 'button'; galleryMore.textContent = '갤러리 이미지 더 보기';
  galleryPanel.append(galleryStatus, galleryGrid, galleryMore);

  const uploadPanel = document.createElement('div'); uploadPanel.className = 'weekly-schedule-upload-panel'; uploadPanel.hidden = true;
  const uploadFields = document.createElement('div'); uploadFields.className = 'weekly-schedule-upload-fields';
  const categoryLabel = document.createElement('label'); categoryLabel.className = 'profile-editor-field'; categoryLabel.textContent = '갤러리 분류';
  const category = document.createElement('select'); category.name = 'galleryCategory';
  [['screenshot', '스크린샷'], ['ai-art', 'AI 일러스트'], ['fan-art', '팬아트'], ['meme', '밈'], ['etc', '기타']].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; category.append(option);
  });
  categoryLabel.append(category);
  const fileLabel = document.createElement('label'); fileLabel.className = 'profile-editor-field'; fileLabel.textContent = '이미지 파일';
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
  // 파일 선택기 취소도 cancel 이벤트를 발생시킨다. 이 이벤트가 모달의 Esc 취소 처리로
  // 전달되는 브라우저에서도 부모 편집 모달이 닫히지 않도록 입력 요소에서 차단한다.
  fileInput.addEventListener('cancel', (event) => event.stopPropagation());
  fileLabel.append(fileInput); uploadFields.append(categoryLabel, fileLabel);
  const uploadNote = document.createElement('small'); uploadNote.className = 'weekly-schedule-upload-note';
  uploadNote.textContent = '갤러리와 같은 jpg/png/webp/gif 형식, 최대 15MB입니다. 썸네일도 함께 생성돼요.';
  const uploadStatus = document.createElement('p'); uploadStatus.className = 'weekly-schedule-upload-status'; uploadStatus.setAttribute('role', 'status');
  const uploadSubmit = document.createElement('button'); uploadSubmit.type = 'button'; uploadSubmit.className = 'button button-primary'; uploadSubmit.textContent = '갤러리에 등록하고 선택';
  uploadPanel.append(uploadFields, uploadNote, uploadStatus, uploadSubmit);
  imageCard.append(imageHeading, imageActions, selectedImageNote, galleryPanel, uploadPanel);
  imageTools.append(imageCard);

  const dayHeading = document.createElement('div'); dayHeading.className = 'weekly-schedule-days-heading';
  const daysTitle = document.createElement('h3'); daysTitle.textContent = '요일별 일정';
  const daysHint = document.createElement('small'); daysHint.textContent = '첫 줄은 시작 시간(예: 7 → 07:00), 둘째 줄은 콘텐츠예요.';
  dayHeading.append(daysTitle, daysHint);
  const dayGrid = document.createElement('div'); dayGrid.className = 'weekly-schedule-day-edit-grid';
  const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
  const dayInputs = [];
  weekdays.forEach((weekday, index) => {
    const dayCard = document.createElement('section'); dayCard.className = 'weekly-schedule-day-edit';
    const rectangles = WEEKLY_SCHEDULE_LAYOUT.days[index];
    setWeeklySchedulePercentRect(dayCard, rectangles);
    const timeRect = weeklyScheduleRegion(rectangles, rectangles.time);
    const contentRect = weeklyScheduleRegion(rectangles, rectangles.content);
    const linkedRect = weeklyScheduleRegion(rectangles, rectangles.linked);
    dayCard.style.setProperty('--time-font-size', `${(rectangles.w < 260 ? 36 : 38) / WEEKLY_SCHEDULE_LAYOUT.width * 100}cqw`);
    dayCard.style.setProperty('--content-font-size', `${(rectangles.w < 260 ? 29 : 31) / WEEKLY_SCHEDULE_LAYOUT.width * 100}cqw`);
    dayCard.style.setProperty('--linked-font-size', `${16 / WEEKLY_SCHEDULE_LAYOUT.width * 100}cqw`);
    dayCard.style.setProperty('--time-left', `${(timeRect.x - rectangles.x) / rectangles.w * 100}%`);
    dayCard.style.setProperty('--time-top', `${(timeRect.y - rectangles.y) / rectangles.h * 100}%`);
    dayCard.style.setProperty('--time-width', `${timeRect.w / rectangles.w * 100}%`);
    dayCard.style.setProperty('--time-height', `${timeRect.h / rectangles.h * 100}%`);
    dayCard.style.setProperty('--content-left', `${(contentRect.x - rectangles.x) / rectangles.w * 100}%`);
    dayCard.style.setProperty('--content-top', `${(contentRect.y - rectangles.y) / rectangles.h * 100}%`);
    dayCard.style.setProperty('--content-width', `${contentRect.w / rectangles.w * 100}%`);
    dayCard.style.setProperty('--content-height', `${contentRect.h / rectangles.h * 100}%`);
    dayCard.style.setProperty('--linked-left', `${(linkedRect.x - rectangles.x) / rectangles.w * 100}%`);
    dayCard.style.setProperty('--linked-top', `${(linkedRect.y - rectangles.y) / rectangles.h * 100}%`);
    dayCard.style.setProperty('--linked-width', `${linkedRect.w / rectangles.w * 100}%`);
    dayCard.style.setProperty('--linked-height', `${linkedRect.h / rectangles.h * 100}%`);
    dayCard.style.setProperty('--offline-top', `${rectangles.offline.top * 100}%`);
    dayCard.style.setProperty('--offline-right', `${rectangles.offline.right * 100}%`);
    const offlineLabel = document.createElement('label'); offlineLabel.className = 'weekly-schedule-offline-label';
    const offline = document.createElement('input'); offline.type = 'checkbox'; offline.name = `offline-${index}`;
    offlineLabel.append(offline, document.createTextNode('휴방'));
    const timeLabel = document.createElement('label'); timeLabel.className = 'weekly-schedule-stage-time-field';
    const time = document.createElement('input'); time.type = 'text'; time.inputMode = 'numeric'; time.placeholder = '시작 시간'; time.maxLength = 5; time.name = `time-${index}`; time.setAttribute('aria-label', `${weekday}요일 방송 시작 시간`); timeLabel.append(time);
    const textLabel = document.createElement('label'); textLabel.className = 'weekly-schedule-stage-content-field';
    const text = document.createElement('div'); text.className = 'weekly-schedule-stage-content-input'; text.contentEditable = 'true'; text.setAttribute('role', 'textbox');
    text.setAttribute('aria-multiline', 'true'); text.setAttribute('aria-label', `${weekday}요일 방송 콘텐츠`); text.dataset.placeholder = '방송 콘텐츠'; text.spellcheck = false; textLabel.append(text);
    const linkedDisplay = document.createElement('div'); linkedDisplay.className = 'weekly-schedule-stage-linked'; linkedDisplay.setAttribute('aria-label', `${weekday}요일 자동 연동 일정`);
    offline.addEventListener('change', () => { time.disabled = offline.checked; text.contentEditable = offline.checked ? 'false' : 'true'; markWeeklyDirty(); });
    time.addEventListener('input', markWeeklyDirty);
    time.addEventListener('blur', () => {
      const normalized = normalizeGraphicTime(time.value);
      if (normalized) time.value = normalized;
      markWeeklyDirty();
    });
    text.addEventListener('input', () => {
      if (text.innerText.length > 100) text.innerText = text.innerText.slice(0, 100);
      markWeeklyDirty();
    });
    dayCard.append(offlineLabel, timeLabel, textLabel, linkedDisplay); dayGrid.append(dayCard);
    dayInputs.push({ offline, time, text, linkedDisplay });
  });

  const previewHeading = document.createElement('div'); previewHeading.className = 'weekly-schedule-preview-heading';
  const previewTitle = document.createElement('h3'); previewTitle.textContent = '미리보기';
  const previewNote = document.createElement('small'); previewNote.textContent = '템플릿 이미지는 새로 제작한 팬페이지 전용 배경입니다.';
  previewHeading.append(previewTitle, previewNote);
  const previewFrame = document.createElement('div'); previewFrame.className = 'weekly-schedule-preview-frame weekly-schedule-template-stage';
  const previewCanvas = document.createElement('canvas'); previewCanvas.className = 'weekly-schedule-preview-canvas';
  previewCanvas.width = WEEKLY_SCHEDULE_LAYOUT.width; previewCanvas.height = WEEKLY_SCHEDULE_LAYOUT.height; previewCanvas.setAttribute('aria-label', '주간 방송표 이미지 미리보기');
  const avatarHitArea = document.createElement('button'); avatarHitArea.type = 'button'; avatarHitArea.className = 'weekly-schedule-avatar-hit-area';
  setWeeklySchedulePercentRect(avatarHitArea, WEEKLY_SCHEDULE_LAYOUT.avatar);
  avatarHitArea.setAttribute('aria-label', '템플릿 이미지 칸에서 갤러리 사진 선택 또는 등록');
  const footerTextInput = document.createElement('input'); footerTextInput.type = 'text'; footerTextInput.className = 'weekly-schedule-footer-text';
  footerTextInput.maxLength = 48; footerTextInput.setAttribute('aria-label', '하단 리본 날짜 또는 문구');
  footerTextInput.title = '날짜 범위 또는 원하는 문구를 입력할 수 있어요.';
  previousWeek.classList.add('weekly-schedule-stage-previous'); nextWeek.classList.add('weekly-schedule-stage-next');
  setWeeklyScheduleArrowPosition(previousWeek, WEEKLY_SCHEDULE_LAYOUT.title.previousX);
  setWeeklyScheduleArrowPosition(nextWeek, WEEKLY_SCHEDULE_LAYOUT.title.nextX);
  setWeeklySchedulePercentRect(footerTextInput, WEEKLY_SCHEDULE_LAYOUT.footer.field);
  previewFrame.append(previewCanvas, previousWeek, nextWeek, dayGrid, avatarHitArea, footerTextInput);

  const footer = document.createElement('div'); footer.className = 'profile-editor-footer weekly-schedule-footer';
  const saveHint = document.createElement('small'); saveHint.textContent = '내용은 주차별로 서버에 자동 저장돼요. 기존 연동 일정은 수정되지 않습니다.';
  const footerTextWarning = document.createElement('small'); footerTextWarning.className = 'weekly-schedule-footer-text-warning'; footerTextWarning.setAttribute('role', 'status'); footerTextWarning.hidden = true;
  const footerActions = document.createElement('div'); footerActions.className = 'profile-editor-footer-actions';
  const download = document.createElement('button'); download.type = 'button'; download.className = 'button button-primary'; download.textContent = 'PNG 이미지 저장';
  footerActions.append(download); footer.append(saveHint, footerTextWarning, footerActions);
  dayHeading.hidden = true; previewHeading.hidden = true;
  form.append(meta, previewFrame, linkedEventsToggle, linkedEventsPanel, footer);
  card.append(header, form); dialog.append(card, imageTools);

  const templateImage = new Image();
  const templateImageUrl = new URL('./assets/weekly-schedule-template.png?v=20261031-weekly-board-v2', import.meta.url).href;
  let templateLoadPromise = null;
  let drawRequest = 0;
  const ctx = previewCanvas.getContext('2d');
  function formatGraphicDate(date) {
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  }
  function dateAtWeekday(offset) {
    const start = parseLocalDateKey(weekInput.value || state.weekStart);
    start.setDate(start.getDate() + offset);
    return start;
  }
  function drawImageCover(image, x, y, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sw = width / scale; const sh = height / scale;
    const sx = (image.naturalWidth - sw) / 2; const sy = (image.naturalHeight - sh) / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height); ctx.restore();
  }
  function drawGraphicDay(day, index, rect, includeEditableValues = true) {
    const { x, y, w, h } = rect;
    const layout = WEEKLY_SCHEDULE_LAYOUT.days[index];
    const input = dayInputs[index];
    const isOffline = input.offline.checked;
    const dayName = weekdays[index];
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const linkedEvents = state.linkedEvents[index] || [];
    const linkedHoliday = linkedEvents.some((event) => event.typeName === '휴방');
    const time = includeEditableValues
      ? (isOffline || linkedHoliday ? '휴방' : (normalizeGraphicTime(input.time.value) || linkedEvents.find((event) => event.time)?.time || ''))
      : '';
    const timeBox = weeklyScheduleRegion(layout, layout.time);
    const contentBox = weeklyScheduleRegion(layout, layout.content);
    ctx.fillStyle = '#a63d61'; ctx.font = `800 ${w < 260 ? 36 : 38}px Jua, "Gowun Dodum", sans-serif`;
    if (time) ctx.fillText(time, timeBox.x + timeBox.w / 2, timeBox.y + timeBox.h / 2, timeBox.w);
    const lines = [];
    if (includeEditableValues && input.text.innerText.trim() && !isOffline) lines.push(input.text.innerText.trim());
    if (includeEditableValues) linkedEvents.forEach((event) => {
      const linked = `${event.time && event.time !== time ? `${event.time} ` : ''}${event.title || event.typeName || '연동 일정'}`.trim();
      if (linked) lines.push(linked);
    });
    if (includeEditableValues && isOffline && !lines.length) lines.push('방송 일정이 없습니다');
    const fontSize = w < 260 ? 29 : 31;
    ctx.fillStyle = '#a94d6b'; ctx.font = `700 ${fontSize}px Gowun Dodum, sans-serif`;
    const lineHeight = w < 260 ? 34 : 36;
    const maxLines = Math.max(1, Math.floor(contentBox.h / lineHeight));
    const shown = lines.flatMap((line) => wrapWeeklyScheduleCanvasText(ctx, line, contentBox.w, maxLines)).slice(0, maxLines);
    const startY = contentBox.y + contentBox.h / 2 - ((shown.length - 1) * lineHeight) / 2;
    shown.forEach((line, lineIndex) => {
      ctx.fillText(line, contentBox.x + contentBox.w / 2, startY + lineIndex * lineHeight, contentBox.w);
    });
    ctx.fillStyle = '#a63d61'; ctx.font = '800 30px Jua, "Gowun Dodum", sans-serif';
    ctx.fillText(`${dayName}요일`, x + w / 2, y + h * layout.weekdayY, w - 24);
    ctx.restore();
  }
  async function drawPreview(includeEditableValues = false) {
    const request = ++drawRequest;
    if (!ctx) return;
    if (!templateImage.complete || !templateImage.naturalWidth) {
      if (!templateLoadPromise) templateLoadPromise = new Promise((resolve) => {
        templateImage.onload = resolve; templateImage.onerror = resolve; templateImage.src = templateImageUrl;
      });
      await templateLoadPromise;
    }
    await ensureWeeklyScheduleFonts();
    if (request !== drawRequest) return;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (templateImage.naturalWidth) ctx.drawImage(templateImage, 0, 0, previewCanvas.width, previewCanvas.height);
    const selected = state.selectedImage;
    const avatar = selected?.image;
    const avatarBounds = WEEKLY_SCHEDULE_LAYOUT.avatar;
    if (avatar?.complete && avatar.naturalWidth) drawImageCover(avatar, avatarBounds.x, avatarBounds.y, avatarBounds.w, avatarBounds.h);
    else {
      ctx.save(); ctx.fillStyle = '#9c8390'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 26px Gowun Dodum, sans-serif'; ctx.fillText('갤러리에서 아바타를 선택하세요', avatarBounds.x + avatarBounds.w / 2, avatarBounds.y + avatarBounds.h / 2); ctx.restore();
    }
    const graphicTitle = weeklyScheduleWeekTitle(page.streamer.nickname, weekInput.value || state.weekStart);
    title.textContent = graphicTitle; titleField.querySelector('input').value = graphicTitle;
    ctx.save();
    drawWeeklyScheduleTitle(ctx, graphicTitle);
    const weekStart = parseLocalDateKey(weekInput.value || state.weekStart); const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    const defaultFooterText = `${formatGraphicDate(weekStart)} – ${formatGraphicDate(weekEnd)}`;
    if (!footerTextInput.matches(':focus')) footerTextInput.value = state.footerText || defaultFooterText;
    const footerText = state.footerText || defaultFooterText;
    ctx.fillStyle = '#9b365c';
    ctx.shadowColor = '#ffffffd9'; ctx.shadowBlur = 3;
    const footerLayout = WEEKLY_SCHEDULE_LAYOUT.footer;
    const footerFit = drawWeeklyScheduleFooterText(ctx, footerTextInput.matches(':focus') ? '' : footerText, footerLayout.centerX, footerLayout.centerY, footerLayout.maxWidth);
    footerTextInput.style.fontSize = `calc(${footerFit.fontSize / 16.72}cqw)`;
    ctx.shadowBlur = 0;
    footerTextWarning.hidden = !footerFit.overflow;
    footerTextWarning.textContent = footerFit.overflow
      ? '문구가 리본에 다 들어가지 않아요. 더 짧게 입력하면 저장 이미지에도 전체가 표시됩니다.'
      : '';
    ctx.restore();
    WEEKLY_SCHEDULE_LAYOUT.days.forEach((rect, index) => drawGraphicDay(dayInputs[index], index, rect, includeEditableValues));
    selectedImageNote.textContent = selected ? `적용 중 · ${selected.categoryLabel || '갤러리 이미지'}` : '사진을 고르지 않으면 이 칸은 비워 둡니다.';
    clearImage.disabled = !selected; clearImage.hidden = !selected;
  }

  async function loadScheduleGallery(append = false) {
    if (state.galleryLoading) return;
    state.galleryLoading = true; galleryStatus.textContent = '공개 갤러리를 불러오고 있어요.'; galleryGrid.replaceChildren(); galleryMore.hidden = true;
    try {
      const offset = append ? state.galleryNextOffset : 0;
      const result = (await callGalleryUploadTarget({ streamerId: page.streamer.id, view: 'rolling-paper-picker', offset })).data;
      const items = Array.isArray(result.items) ? result.items.filter((item) => item?.id && item.thumbUrl) : [];
      state.galleryItems = append ? [...state.galleryItems, ...items] : items;
      state.galleryNextOffset = Number(result.nextOffset) || state.galleryItems.length;
      state.galleryHasMore = result.hasMore === true; state.galleryLoaded = true;
      renderScheduleGalleryItems();
    } catch (error) {
      galleryStatus.textContent = error.message || '갤러리 이미지를 불러오지 못했어요.';
    } finally { state.galleryLoading = false; galleryMore.disabled = false; }
  }
  function renderScheduleGalleryItems() {
    galleryGrid.replaceChildren();
    galleryStatus.textContent = state.galleryItems.length ? '' : '선택할 수 있는 공개 갤러리 이미지가 없어요.';
    state.galleryItems.forEach((item) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'weekly-schedule-gallery-image';
      button.setAttribute('aria-label', `${item.categoryLabel || '갤러리'} 이미지 선택`);
      const image = document.createElement('img'); image.src = item.thumbUrl; image.alt = ''; image.loading = 'lazy';
      button.append(image); button.addEventListener('click', () => selectScheduleGalleryImage(item)); galleryGrid.append(button);
    });
    galleryMore.hidden = !state.galleryHasMore;
    galleryMore.disabled = state.galleryLoading;
  }
  async function selectScheduleGalleryImage(item, persist = true) {
    galleryStatus.textContent = '이미지를 준비하고 있어요.';
    galleryGrid.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const result = (await callGalleryUploadTarget({ streamerId: page.streamer.id, view: 'schedule-image-data', imageId: item.id })).data;
      const image = new Image(); image.src = result.dataUrl;
      await image.decode();
      if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
      state.localObjectUrl = '';
      state.selectedImage = { ...item, image };
      state.avatarImageId = item.id;
      state.galleryOpen = false; galleryPanel.hidden = true; uploadPanel.hidden = true;
      if (imageTools.open) imageTools.close();
      if (persist) markWeeklyDirty(); else drawPreview();
    } catch (error) {
      galleryStatus.textContent = error.message || '이미지를 선택하지 못했어요.';
    } finally { galleryGrid.querySelectorAll('button').forEach((button) => { button.disabled = false; }); }
  }
  async function makeGalleryThumbnail(file) {
    return new Promise((resolve, reject) => {
      const image = new Image(); const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const width = image.naturalWidth; const height = image.naturalHeight;
        const scale = Math.min(1, 480 / Math.max(width, height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? resolve({ blob, width, height }) : reject(new Error('썸네일 생성에 실패했어요.')), 'image/jpeg', 0.82);
      };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('이미지를 읽을 수 없어요.')); };
      image.src = objectUrl;
    });
  }
  async function uploadScheduleGalleryImage() {
    const file = fileInput.files?.[0];
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!file) { uploadStatus.textContent = '이미지 파일을 선택해 주세요.'; return; }
    if (!allowed.has(file.type)) { uploadStatus.textContent = 'jpg/png/webp/gif 이미지만 등록할 수 있어요.'; return; }
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) { uploadStatus.textContent = '이미지 용량은 15MB 이하여야 해요.'; return; }
    if (state.uploadBusy) return;
    state.uploadBusy = true; uploadSubmit.disabled = true; uploadSubmit.textContent = '등록 중…';
    let uploadedToR2 = false;
    try {
      uploadStatus.textContent = '갤러리 형식의 썸네일을 만드는 중…';
      const thumb = await makeGalleryThumbnail(file);
      uploadStatus.textContent = '갤러리 저장 공간을 준비하는 중…';
      const target = (await callGalleryUploadTarget({ streamerId: page.streamer.id, view: 'upload-target' })).data;
      const prepared = (await callGalleryUploadPrepare({ contentType: file.type, fileSize: file.size, thumbFileSize: thumb.blob.size })).data;
      uploadStatus.textContent = '이미지와 썸네일을 갤러리에 올리는 중…';
      const imagePut = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!imagePut.ok) throw new Error(`원본 업로드에 실패했어요 (${imagePut.status}).`);
      uploadedToR2 = true;
      const thumbPut = await fetch(prepared.thumbUploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: thumb.blob });
      if (!thumbPut.ok) throw new Error(`썸네일 업로드에 실패했어요 (${thumbPut.status}).`);
      uploadStatus.textContent = '갤러리에 이미지를 등록하는 중…';
      const registered = (await callGalleryImageRegister({
        imageId: prepared.imageId, key: prepared.key, thumbKey: prepared.thumbKey,
        streamerId: target.streamerId, streamerName: target.streamerName, category: category.value,
        width: thumb.width, height: thumb.height,
      })).data;
      const source = URL.createObjectURL(file);
      const image = new Image(); image.src = source; await image.decode();
      if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
      state.localObjectUrl = source;
      const categoryLabel = category.options[category.selectedIndex]?.textContent || '갤러리 이미지';
      state.selectedImage = { id: registered.imageId, imageUrl: registered.imageUrl, thumbUrl: registered.thumbUrl, category: category.value, categoryLabel, image };
      state.avatarImageId = registered.imageId;
      state.galleryItems = [{ ...state.selectedImage, thumbUrl: registered.thumbUrl }, ...state.galleryItems.filter((item) => item.id !== registered.imageId)];
      state.galleryLoaded = true; state.galleryOpen = false; state.uploadOpen = false;
      galleryPanel.hidden = true; uploadPanel.hidden = true; if (imageTools.open) imageTools.close(); fileInput.value = '';
      uploadStatus.textContent = '갤러리 등록을 마치고 방송표에 적용했어요.';
      markWeeklyDirty(); showToast('갤러리에 이미지를 등록하고 방송표에 넣었어요.');
    } catch (error) {
      uploadStatus.textContent = uploadedToR2
        ? `${error.message || '등록하지 못했어요.'} 파일 업로드 후 갤러리 등록 단계에서 실패했을 수 있어요.`
        : (error.message || '갤러리에 이미지를 등록하지 못했어요.');
    } finally {
      state.uploadBusy = false; uploadSubmit.disabled = false; uploadSubmit.textContent = '갤러리에 등록하고 선택';
    }
  }
  function syncWeeklyFields() {
    weekInput.value = state.weekStart;
    graphicTitle.value = weeklyScheduleWeekTitle(page.streamer.nickname, state.weekStart);
    title.textContent = graphicTitle.value;
    const footerStart = parseLocalDateKey(state.weekStart); const footerEnd = new Date(footerStart); footerEnd.setDate(footerEnd.getDate() + 6);
    footerTextInput.value = state.footerText || `${formatGraphicDate(footerStart)} – ${formatGraphicDate(footerEnd)}`;
    dayInputs.forEach((input, index) => {
      const entry = state.entries[index] || {};
      input.offline.checked = entry.offline === true;
      input.time.value = entry.time || '';
      input.text.innerText = entry.content || '';
      input.time.disabled = input.offline.checked; input.text.contentEditable = input.offline.checked ? 'false' : 'true';
      const events = (state.linkedEvents[index] || []).map((event) => `${event.time ? `${event.time} ` : ''}${event.title || event.typeName || '일정'}`.trim()).filter(Boolean);
      input.linkedDisplay.replaceChildren();
      events.slice(0, 3).forEach((eventText) => {
        const line = document.createElement('span'); line.textContent = eventText; input.linkedDisplay.append(line);
      });
    });
    linkedEventsList.replaceChildren();
    let linkedCount = 0;
    (state.linkedEvents || []).forEach((events, index) => events.forEach((event) => {
      const row = document.createElement('p'); row.className = 'weekly-schedule-linked-row';
      const weekday = document.createElement('strong'); weekday.textContent = `${weekdays[index]}요일`;
      const source = document.createElement('span'); source.textContent = event.source === 'fanpage' ? '팬페이지 일정' : 'SOOP 일정';
      const eventText = document.createElement('span'); eventText.textContent = `${event.time ? `${event.time} ` : ''}${event.title || event.typeName || '일정'}`;
      row.append(weekday, source, eventText); linkedEventsList.append(row); linkedCount += 1;
    }));
    if (!linkedCount) {
      const empty = document.createElement('p'); empty.className = 'weekly-schedule-linked-empty'; empty.textContent = '이번 주에 연동된 일정이 없어요.'; linkedEventsList.append(empty);
    }
    linkedEventsToggle.hidden = linkedCount === 0;
    if (!linkedCount) linkedEventsOpen = false;
    linkedEventsToggle.textContent = `자동 연동 일정 ${linkedCount}개 ${linkedEventsOpen ? '접기' : '펼치기'}`;
    linkedEventsToggle.setAttribute('aria-expanded', String(linkedEventsOpen));
    linkedEventsPanel.hidden = !linkedEventsOpen;
    saveStatus.textContent = state.saveStatus || '';
    if (state.avatarImageId && state.savedAvatar && (!state.selectedImage || state.selectedImage.id !== state.avatarImageId)) {
      void selectScheduleGalleryImage({ id: state.avatarImageId, thumbUrl: state.savedAvatar.thumbUrl, imageUrl: state.savedAvatar.imageUrl, categoryLabel: '저장된 갤러리 이미지' }, false);
    }
    avatarHitArea.hidden = false;
    drawPreview(false);
  }

  function collectWeeklyEntries() {
    return dayInputs.map(({ offline, time, text }) => {
      const normalized = offline.checked ? '' : normalizeGraphicTime(time.value);
      if (normalized === null) throw new Error('시간은 0~23 또는 7:30 형식으로 입력해 주세요.');
      return { time: normalized || '', content: offline.checked ? '' : text.innerText.trim().slice(0, 100), offline: offline.checked };
    });
  }

  async function saveCurrentWeek() {
    window.clearTimeout(state.saveTimer);
    if (state.savePromise) {
      const result = await state.savePromise;
      if (!result || !state.dirty) return result;
    }
    if (!state.dirty) return true;
    state.savePromise = (async () => {
      while (state.dirty) {
        let entries;
        try { entries = collectWeeklyEntries(); }
        catch (error) { state.saveStatus = error.message; saveStatus.textContent = error.message; return false; }
        const revision = state.localRevision || 0;
        const savingWeekStart = state.weekStart;
        const savingAvatarImageId = state.avatarImageId || '';
        const savingFooterText = state.footerText || '';
        const expectedUpdatedAt = state.updatedAt;
        state.saveStatus = '저장 중…'; saveStatus.textContent = state.saveStatus;
        try {
          const response = await callWeeklySchedule({
            action: 'save', streamerId: page.streamer.id, weekStart: savingWeekStart,
            entries, avatarImageId: savingAvatarImageId, footerText: savingFooterText, expectedUpdatedAt,
          });
          state.weekUpdatedAtByStart[savingWeekStart] = Number(response.data.updatedAt) || Date.now();
          if (state.weekStart === savingWeekStart) {
            state.updatedAt = state.weekUpdatedAtByStart[savingWeekStart];
            state.entries = entries;
            if ((state.localRevision || 0) === revision) state.dirty = false;
          }
          if (state.weekStart === savingWeekStart) {
            state.saveStatus = state.dirty ? '변경사항을 저장하고 있어요.' : '저장 완료';
            saveStatus.textContent = state.saveStatus;
          }
          if (state.weekStart === savingWeekStart) $('calendarSection')?._drawWeeklyBoard?.();
        } catch (error) {
          if (state.weekStart === savingWeekStart) {
            state.saveStatus = error.message || '저장하지 못했어요. 다시 시도해 주세요.';
            saveStatus.textContent = state.saveStatus;
          }
          return false;
        }
      }
      return true;
    })().finally(() => { state.savePromise = null; });
    return state.savePromise;
  }

  function markWeeklyDirty() {
    state.dirty = true; state.localRevision = (state.localRevision || 0) + 1;
    try { state.entries = collectWeeklyEntries(); }
    catch (error) { state.saveStatus = error.message; saveStatus.textContent = error.message; drawPreview(); return; }
    state.saveStatus = '자동 저장 대기…'; saveStatus.textContent = state.saveStatus;
    drawPreview();
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => { void saveCurrentWeek(); }, 700);
  }

  footerTextInput.addEventListener('focus', () => { void drawPreview(false); });
  footerTextInput.addEventListener('input', () => {
    state.footerText = footerTextInput.value.trim().slice(0, footerTextInput.maxLength);
    markWeeklyDirty();
  });
  footerTextInput.addEventListener('blur', () => {
    if (!footerTextInput.value.trim()) {
      state.footerText = '';
      const start = parseLocalDateKey(state.weekStart); const end = new Date(start); end.setDate(end.getDate() + 6);
      footerTextInput.value = `${formatGraphicDate(start)} – ${formatGraphicDate(end)}`;
    }
    drawPreview(false);
  });

  async function moveEditorWeek(offset) {
    if (state.weekNavigationBusy) return;
    let entries;
    try { entries = collectWeeklyEntries(); }
    catch (error) { state.saveStatus = error.message; saveStatus.textContent = error.message; return; }
    const setNavigationBusy = (busy) => {
      previousWeek.disabled = busy; nextWeek.disabled = busy;
      footerTextInput.disabled = busy; avatarHitArea.disabled = busy;
      chooseImage.disabled = busy; uploadImage.disabled = busy;
      clearImage.disabled = busy || !(state.selectedImage || state.savedAvatar);
      dayInputs.forEach(({ offline, time, text }) => {
        offline.disabled = busy;
        time.disabled = busy || offline.checked;
        text.contentEditable = busy || offline.checked ? 'false' : 'true';
      });
    };
    window.clearTimeout(state.saveTimer);
    const previous = {
      weekStart: state.weekStart,
      entries: entries.map((entry) => ({ ...entry })),
      linkedEvents: state.linkedEvents.map((events) => [...events]),
      footerText: state.footerText,
      avatarImageId: state.avatarImageId,
      savedAvatar: state.savedAvatar,
      selectedImage: state.selectedImage,
      carriedForwardFrom: state.carriedForwardFrom || '',
      avatarUnavailable: state.avatarUnavailable === true,
      updatedAt: state.updatedAt,
      dirty: state.dirty,
      localRevision: state.localRevision || 0,
      loading: state.loading,
      saveStatus: state.saveStatus,
      localObjectUrl: state.localObjectUrl,
      entriesToSave: entries,
      pendingSave: state.savePromise,
    };
    const date = parseLocalDateKey(state.weekStart); date.setDate(date.getDate() + offset * 7);
    const nextWeekStart = localDateKey(date);

    // 화면의 주차와 날짜부터 바꾸고, 저장·불러오기는 그 뒤에 진행한다.
    state.weekNavigationBusy = true;
    setNavigationBusy(true);
    state.weekStart = nextWeekStart;
    state.entries = Array.from({ length: 7 }, () => ({ time: '', content: '', offline: false }));
    state.linkedEvents = Array.from({ length: 7 }, () => []);
    state.footerText = '';
    state.avatarImageId = '';
    state.savedAvatar = null;
    state.selectedImage = null;
    state.carriedForwardFrom = '';
    state.avatarUnavailable = false;
    state.updatedAt = state.weekUpdatedAtByStart[nextWeekStart] || 0;
    state.dirty = false;
    state.localRevision = previous.localRevision + 1;
    state.loading = true;
    state.saveStatus = '주간 일정을 불러오는 중…';
    syncWeeklyFields();
    updateWeeklyScheduleTargets(page, state, $('calendarSection'), '주간 일정을 불러오는 중이에요.');

    try {
      if (previous.pendingSave) await previous.pendingSave;
      if (previous.dirty) {
        const expectedUpdatedAt = state.weekUpdatedAtByStart[previous.weekStart] ?? previous.updatedAt;
        const response = await callWeeklySchedule({
          action: 'save', streamerId: page.streamer.id, weekStart: previous.weekStart,
          entries: previous.entriesToSave, avatarImageId: previous.avatarImageId || '',
          footerText: previous.footerText || '', expectedUpdatedAt,
        });
        state.weekUpdatedAtByStart[previous.weekStart] = Number(response.data.updatedAt) || Date.now();
      }
      if (state.localObjectUrl === previous.localObjectUrl && state.localObjectUrl) {
        URL.revokeObjectURL(state.localObjectUrl);
        state.localObjectUrl = '';
      }
      await loadWeeklySchedulePageData(page, nextWeekStart, $('calendarSection'), { carryForward: offset > 0 });
      syncWeeklyFields();
      if (offset > 0 && state.carriedForwardFrom) {
        state.dirty = true;
        state.localRevision = (state.localRevision || 0) + 1;
        const carriedForwardFrom = state.carriedForwardFrom;
        const saved = await saveCurrentWeek();
        if (saved && state.weekStart === nextWeekStart) {
          state.saveStatus = state.avatarUnavailable
            ? `이전 방송표(${carriedForwardFrom})를 가져왔어요. 아바타 이미지는 갤러리에서 다시 선택해 주세요.`
            : `이전 방송표(${carriedForwardFrom}) 내용을 가져와 저장했어요.`;
          saveStatus.textContent = state.saveStatus;
          updateWeeklyScheduleTargets(page, state, $('calendarSection'), state.saveStatus);
        }
      }
    } catch (error) {
      // 저장에 실패하면 편집 내용을 복원해 재시도할 수 있게 한다.
      state.weekStart = previous.weekStart;
      state.entries = previous.entries;
      state.linkedEvents = previous.linkedEvents;
      state.footerText = previous.footerText;
      state.avatarImageId = previous.avatarImageId;
      state.savedAvatar = previous.savedAvatar;
      state.selectedImage = previous.selectedImage;
      state.carriedForwardFrom = previous.carriedForwardFrom;
      state.avatarUnavailable = previous.avatarUnavailable;
      state.updatedAt = state.weekUpdatedAtByStart[previous.weekStart] ?? previous.updatedAt;
      state.dirty = previous.dirty;
      state.localRevision = previous.localRevision;
      state.loading = previous.loading;
      state.localObjectUrl = previous.localObjectUrl;
      state.saveStatus = error.message || '이전 주 일정을 저장하지 못했어요.';
      syncWeeklyFields();
      updateWeeklyScheduleTargets(page, state, $('calendarSection'), state.saveStatus);
    } finally {
      state.weekNavigationBusy = false;
      setNavigationBusy(false);
    }
  }

  chooseImage.addEventListener('click', () => {
    state.galleryOpen = !state.galleryOpen; galleryPanel.hidden = !state.galleryOpen;
    if (state.galleryOpen && !state.galleryLoaded) void loadScheduleGallery();
    else if (state.galleryOpen) renderScheduleGalleryItems();
    if (state.galleryOpen) { state.uploadOpen = false; uploadPanel.hidden = true; }
  });
  avatarHitArea.addEventListener('click', () => {
    state.galleryOpen = false; state.uploadOpen = false;
    galleryPanel.hidden = true; uploadPanel.hidden = true;
    clearImage.hidden = !(state.selectedImage || state.savedAvatar);
    showFanPageModal(imageTools);
  });
  closeImageTools.addEventListener('click', () => { imageTools.close(); });
  uploadImage.addEventListener('click', () => {
    state.uploadOpen = !state.uploadOpen; uploadPanel.hidden = !state.uploadOpen;
    if (state.uploadOpen) { state.galleryOpen = false; galleryPanel.hidden = true; }
  });
  clearImage.addEventListener('click', () => {
    if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
    state.localObjectUrl = ''; state.selectedImage = null; state.avatarImageId = ''; state.savedAvatar = null;
    if (imageTools.open) imageTools.close(); markWeeklyDirty();
  });
  galleryMore.addEventListener('click', () => loadScheduleGallery(true));
  uploadSubmit.addEventListener('click', uploadScheduleGalleryImage);
  linkedEventsToggle.addEventListener('click', () => {
    linkedEventsOpen = !linkedEventsOpen;
    linkedEventsPanel.hidden = !linkedEventsOpen;
    const count = linkedEventsList.querySelectorAll('.weekly-schedule-linked-row').length;
    linkedEventsToggle.textContent = `자동 연동 일정 ${count}개 ${linkedEventsOpen ? '접기' : '펼치기'}`;
    linkedEventsToggle.setAttribute('aria-expanded', String(linkedEventsOpen));
  });
  previousWeek.addEventListener('click', () => { void moveEditorWeek(-1); });
  nextWeek.addEventListener('click', () => { void moveEditorWeek(1); });
  const closeAndSave = async () => { if (await saveCurrentWeek()) dialog.close(); };
  close.addEventListener('click', closeAndSave);
  dialog.addEventListener('cancel', (event) => {
    // 자식 갤러리 모달이나 파일 선택기에서 올라온 취소는 편집 모달 취소로 처리하지 않는다.
    if (event.target !== dialog) return;
    event.preventDefault(); void closeAndSave();
  });
  imageTools.addEventListener('cancel', (event) => event.stopPropagation());
  imageTools.addEventListener('close', () => {
    if (dialog.open && avatarHitArea.isConnected) avatarHitArea.focus({ preventScroll: true });
  });
  dialog.addEventListener('close', () => {
    if (imageTools.open) imageTools.close();
    state.weekStart = weekInput.value || state.weekStart;
  });
  download.addEventListener('click', () => {
    if (download.disabled) return;
    download.disabled = true; download.textContent = '이미지 준비 중…';
    saveCurrentWeek().then((saved) => { if (!saved) throw new Error('저장 오류를 먼저 해결해 주세요.'); return drawPreview(true); })
      .then(() => new Promise((resolve, reject) => previewCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 이미지를 만들지 못했어요.')), 'image/png')))
      .then((blob) => {
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        const safeTitle = (graphicTitle.value.trim() || '주간 방송표').replace(/[\\/:*?"<>|]+/g, '-');
        link.href = url; link.download = `${safeTitle}-${weekInput.value || localDateKey(new Date())}.png`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('주간 방송표 PNG를 저장했어요.');
      }).catch((error) => showToast(error.message || 'PNG 저장에 실패했어요.'))
      .finally(() => { void drawPreview(false); download.disabled = false; download.textContent = 'PNG 이미지 저장'; });
  });
  dialog._syncWeeklyFields = syncWeeklyFields;
  dialog._saveCurrentWeek = saveCurrentWeek;
  dialog._refreshWeeklySchedulePreview = drawPreview;
  syncWeeklyFields();
  return dialog;
}

function openWeeklyScheduleDialog(page) {
  const dialog = $('weeklyScheduleGraphicDialog');
  if (dialog) {
    showFanPageModal(dialog);
    dialog._syncWeeklyFields?.();
    dialog._refreshWeeklySchedulePreview?.();
    const state = weeklyScheduleGraphicStateFor(page.streamer.id);
    if (state.carriedForwardFrom && !state.updatedAt && !state.dirty) {
      state.dirty = true;
      state.localRevision = (state.localRevision || 0) + 1;
      const sourceWeekStart = state.carriedForwardFrom;
      dialog._saveCurrentWeek?.().then((saved) => {
        if (!saved || state.carriedForwardFrom !== sourceWeekStart) return;
        state.saveStatus = state.avatarUnavailable
          ? `이전 방송표(${sourceWeekStart})를 가져왔어요. 아바타 이미지는 갤러리에서 다시 선택해 주세요.`
          : `이전 방송표(${sourceWeekStart}) 내용을 가져와 저장했어요.`;
        const status = dialog.querySelector('.weekly-schedule-save-status');
        if (status) status.textContent = state.saveStatus;
        updateWeeklyScheduleTargets(page, state, $('calendarSection'), state.saveStatus);
      });
    }
  }
}

function refreshCalendarSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('calendarSection');
  if (section) {
    section._cleanupWeeklyScheduleViewport?.();
    section.replaceWith(renderCalendarSection(currentPage));
  }
}

function shiftCalendar(streamerId, amount) {
  const state = calendarStateFor(streamerId);
  const selected = parseLocalDateKey(state.selectedDate);
  if (state.view === 'month') {
    const next = new Date(selected.getFullYear(), selected.getMonth() + amount, 1);
    state.selectedDate = localDateKey(next); state.year = next.getFullYear(); state.month = next.getMonth() + 1;
  } else {
    selected.setDate(selected.getDate() + amount * 7);
    state.selectedDate = localDateKey(selected); state.year = selected.getFullYear(); state.month = selected.getMonth() + 1;
  }
  state.error = ''; state.days = []; state.fetchedAt = null; state.stale = false;
  refreshCalendarSection(streamerId);
  loadCalendar(streamerId);
}

async function loadCalendar(streamerId, forceRefresh = false) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const state = calendarStateFor(streamerId);
  const selected = parseLocalDateKey(state.selectedDate);
  const requestDate = state.view === 'week' ? calendarWeekStart(selected) : new Date(state.year, state.month - 1, 1);
  const requestId = ++state.requestId;
  state.loading = true; state.error = '';
  refreshCalendarSection(streamerId);
  try {
    const result = await callCalendar({
      streamerId,
      view: state.view,
      year: requestDate.getFullYear(),
      month: requestDate.getMonth() + 1,
      day: requestDate.getDate(),
      forceRefresh,
    });
    if (state.requestId !== requestId) return;
    state.days = Array.isArray(result.data.days) ? result.data.days : [];
    state.fetchedAt = Number(result.data.fetchedAt) || Date.now();
    state.stale = !!result.data.stale;
  } catch (error) {
    if (state.requestId !== requestId) return;
    state.error = error.message || '방송 일정을 불러오지 못했어요.';
  } finally {
    if (state.requestId === requestId) {
      state.loading = false;
      refreshCalendarSection(streamerId);
    }
  }
}

function renderVodPlayerDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'vodPlayerDialog'; dialog.className = 'account-dialog vod-player-dialog';
  const card = document.createElement('div'); card.className = 'account-dialog-card vod-player-card';
  const heading = document.createElement('div'); heading.className = 'vod-player-heading';
  const title = document.createElement('h2'); title.id = 'vodPlayerTitle'; title.textContent = '방송 다시보기';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close';
  close.setAttribute('aria-label', '플레이어 닫기'); close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  heading.append(title, close);
  const frame = document.createElement('div'); frame.className = 'vod-player-frame vod-player-frame-soop';
  const iframe = document.createElement('iframe'); iframe.id = 'vodPlayerFrame'; iframe.title = 'SOOP 다시보기 및 채팅 플레이어';
  iframe.src = 'about:blank'; iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.append(iframe);
  const footer = document.createElement('div'); footer.className = 'vod-player-footer';
  const note = document.createElement('p'); note.textContent = 'SOOP 플레이어 안의 스피커 버튼이나 ↑/↓ 키로 볼륨을 조절할 수 있어요. 재생되지 않으면 SOOP에서 열어 주세요.';
  const link = document.createElement('a'); link.id = 'vodPlayerExternalLink'; link.className = 'button button-primary';
  link.href = 'https://vod.sooplive.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'SOOP에서 열기 ↗';
  footer.append(note, link);
  const comments = document.createElement('section'); comments.id = 'vodCommentsPanel'; comments.className = 'vod-comments-panel';
  comments.setAttribute('aria-live', 'polite');
  comments.textContent = '댓글을 불러오고 있어요.';
  card.append(heading, frame, footer, comments); dialog.append(card);
  dialog.addEventListener('close', () => {
    iframe.src = 'about:blank';
    vodCommentRequestId += 1;
    vodCommentState = null;
  });
  return dialog;
}

function openVodPlayer(vod) {
  if (!/^\d{1,20}$/.test(String(vod && vod.id || ''))) return;
  const id = encodeURIComponent(vod.id);
  $('vodPlayerTitle').textContent = vod.title || '방송 다시보기';
  $('vodPlayerExternalLink').href = `https://vod.sooplive.com/player/${id}`;
  $('vodPlayerFrame').src = `https://vod.sooplive.com/player/${id}/embed?autoPlay=false&mutePlay=false&showChat=true`;
  showFanPageModal($('vodPlayerDialog'));
  vodCommentState = {
    streamerId: currentPage.streamer.id,
    vodId: String(vod.id),
    activeTab: 'soop',
    profileEditorOpen: false,
    loading: true,
    loadingMore: false,
    error: '',
    profile: null,
    canDelete: false,
    soop: { available: true, totalCount: 0, items: [], hasMore: false, nextPageNo: 1, nextLastNo: 0, error: '' },
    fanpage: { items: [], hasMore: false, countLabel: '0' },
  };
  const requestId = ++vodCommentRequestId;
  renderVodCommentsContents();
  loadVodComments(requestId);
}

function createVodCommentAvatar(profile) {
  const avatar = document.createElement('span');
  avatar.className = 'vod-comment-avatar';
  const nickname = String(profile && profile.nickname || '?');
  const url = String(profile && profile.avatarUrl || '');
  if (url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      avatar.replaceChildren();
      avatar.textContent = nickname.charAt(0) || '?';
      avatar.classList.add('is-fallback');
    }, { once: true });
    avatar.append(image);
  } else {
    avatar.textContent = nickname.charAt(0) || '?';
    avatar.classList.add('is-fallback');
  }
  return avatar;
}

function formatCommentDate(value, soopFormat = false) {
  if (soopFormat) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(String(value || ''));
    return match ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}` : String(value || '');
  }
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul',
  }).format(new Date(timestamp));
}

function renderVodCommentItem(comment, source) {
  const article = document.createElement('article');
  article.className = 'vod-comment-item';
  const identity = document.createElement('div'); identity.className = 'vod-comment-identity';
  identity.append(createVodCommentAvatar(comment));
  const copy = document.createElement('div'); copy.className = 'vod-comment-author-copy';
  const nickname = document.createElement('strong'); nickname.className = 'vod-comment-nickname'; nickname.textContent = comment.nickname || 'SOOP 유저';
  const meta = document.createElement('span'); meta.className = 'vod-comment-meta';
  const handle = comment.soopId ? `@${comment.soopId}` : '';
  const created = formatCommentDate(comment.createdAt, source === 'soop');
  meta.textContent = [handle, created].filter(Boolean).join(' · ');
  copy.append(nickname, meta); identity.append(copy);
  if (source === 'fanpage' && vodCommentState && vodCommentState.canDelete) {
    const remove = document.createElement('button'); remove.type = 'button';
    remove.className = 'vod-comment-delete'; remove.textContent = '삭제';
    remove.setAttribute('aria-label', `${comment.nickname || '사용자'} 댓글 삭제`);
    remove.addEventListener('click', () => deleteVodComment(comment.id));
    identity.append(remove);
  }
  const content = document.createElement('p'); content.className = 'vod-comment-content'; content.textContent = comment.content || '';
  article.append(identity, content);
  return article;
}

function renderCommentProfileEditor() {
  const state = vodCommentState;
  const wrap = document.createElement('div'); wrap.className = 'vod-comment-profile-editor';
  if (!canSaveCommentProfile()) {
    const title = document.createElement('strong'); title.textContent = '로그인 후 댓글 프로필 설정';
    const note = document.createElement('p');
    note.textContent = '게스트 세션에서는 프로필을 저장할 수 없어요. Google·카카오 로그인 또는 스트리머 인증을 완료해 주세요.';
    const login = document.createElement('button'); login.type = 'button'; login.className = 'button button-primary';
    login.textContent = '로그인 / 인증';
    login.addEventListener('click', () => showFanPageModal($('loginChoiceDialog')));
    wrap.append(title, note, login);
    return wrap;
  }
  const title = document.createElement('strong'); title.textContent = state.profile ? '댓글 프로필 수정' : '댓글 프로필 설정';
  const note = document.createElement('p');
  note.textContent = '배팅시장 또는 갤러리에 저장된 프로필을 불러옵니다. 저장하면 팬페이지 댓글에 이 프로필이 표시돼요.';
  const grid = document.createElement('div'); grid.className = 'vod-comment-profile-fields';
  const nicknameLabel = document.createElement('label'); nicknameLabel.textContent = '닉네임';
  const nickname = document.createElement('input'); nickname.type = 'text'; nickname.maxLength = 12;
  nickname.autocomplete = 'nickname'; nickname.placeholder = '1~12자';
  nickname.value = state.profile && state.profile.nickname || '';
  nicknameLabel.append(nickname);
  const soopLabel = document.createElement('label'); soopLabel.textContent = 'SOOP 아이디 (선택)';
  const soopId = document.createElement('input'); soopId.type = 'text'; soopId.maxLength = 20;
  soopId.autocomplete = 'off'; soopId.placeholder = '영문 소문자/숫자';
  soopId.value = state.profile && state.profile.soopId || '';
  soopLabel.append(soopId); grid.append(nicknameLabel, soopLabel);
  const actions = document.createElement('div'); actions.className = 'vod-comment-profile-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소';
  cancel.addEventListener('click', () => {
    if (!state.profile) return;
    state.profileEditorOpen = false;
    renderVodCommentsContents();
  });
  const save = document.createElement('button'); save.type = 'button'; save.className = 'button button-primary'; save.textContent = '프로필 저장';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      if (!canSaveCommentProfile()) {
        showFanPageModal($('loginChoiceDialog'));
        return;
      }
      const result = await callCommentProfileSave({ nickname: nickname.value.trim(), soopId: soopId.value.trim() });
      state.profile = { ...result.data.profile, source: 'streamerFanPageCommentProfiles' };
      state.profileEditorOpen = false;
      renderVodCommentsContents();
      showToast('댓글 프로필을 저장했어요.');
    } catch (error) {
      showToast(error.message || '댓글 프로필을 저장하지 못했어요.');
    } finally { save.disabled = false; }
  });
  actions.append(cancel, save); wrap.append(title, note, grid, actions);
  return wrap;
}

function renderFanpageCommentComposer() {
  const state = vodCommentState;
  const composer = document.createElement('div'); composer.className = 'vod-comment-composer';
  const canComment = canSaveCommentProfile();
  if (canComment && state.profile) {
    const identity = document.createElement('div'); identity.className = 'vod-comment-composer-identity';
    identity.append(createVodCommentAvatar(state.profile));
    const name = document.createElement('strong'); name.textContent = state.profile.nickname;
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'vod-comment-profile-edit'; edit.textContent = '프로필 수정';
    edit.addEventListener('click', () => { state.profileEditorOpen = true; renderVodCommentsContents(); });
    identity.append(name, edit); composer.append(identity);
  } else {
    const prompt = document.createElement('p'); prompt.className = 'vod-comment-profile-required';
    prompt.textContent = canComment
      ? '댓글을 등록하려면 먼저 프로필을 설정해 주세요.'
      : '댓글을 등록하려면 로그인 후 댓글 프로필을 설정해 주세요.';
    composer.append(prompt);
  }
  if (state.profileEditorOpen || !state.profile || !canComment) composer.append(renderCommentProfileEditor());
  if (canComment && state.profile && !state.profileEditorOpen) {
    const textarea = document.createElement('textarea'); textarea.className = 'vod-comment-input';
    textarea.maxLength = 500; textarea.rows = 3; textarea.placeholder = '팬페이지에 댓글을 남겨보세요.';
    const footer = document.createElement('div'); footer.className = 'vod-comment-compose-footer';
    const count = document.createElement('span'); count.className = 'vod-comment-input-count'; count.textContent = '0 / 500';
    const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'button button-primary';
    submit.textContent = '댓글 등록'; submit.disabled = true;
    textarea.addEventListener('input', () => {
      count.textContent = `${textarea.value.length} / 500`;
      submit.disabled = !textarea.value.trim() || state.loading;
    });
    submit.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) return;
      submit.disabled = true;
      try {
        const result = await callVodCommentAdd({ streamerId: state.streamerId, vodId: state.vodId, content });
        state.fanpage.items = [...state.fanpage.items, result.data.comment].slice(-50);
        state.fanpage.hasMore = state.fanpage.hasMore || state.fanpage.items.length === 50;
        state.fanpage.countLabel = `${state.fanpage.items.length}${state.fanpage.hasMore ? '+' : ''}`;
        renderVodCommentsContents();
        showToast('팬페이지 댓글을 등록했어요.');
      } catch (error) {
        showToast(error.message || '댓글을 등록하지 못했어요.');
        submit.disabled = false;
      }
    });
    footer.append(count, submit); composer.append(textarea, footer);
  }
  return composer;
}

function renderVodCommentsContents() {
  const root = $('vodCommentsPanel');
  const state = vodCommentState;
  if (!root || !state) return;
  root.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'vod-comments-heading';
  const headingCopy = document.createElement('div');
  const title = document.createElement('h3'); title.textContent = '다시보기 댓글';
  const hint = document.createElement('p'); hint.textContent = 'SOOP 댓글은 읽기 전용이며, 팬페이지 댓글은 이곳에서 등록할 수 있어요.';
  headingCopy.append(title, hint); heading.append(headingCopy);
  const tabs = document.createElement('div'); tabs.className = 'vod-comments-tabs'; tabs.setAttribute('role', 'tablist');
  const soopTab = document.createElement('button'); soopTab.type = 'button'; soopTab.setAttribute('role', 'tab');
  soopTab.setAttribute('aria-selected', String(state.activeTab === 'soop'));
  soopTab.className = state.activeTab === 'soop' ? 'is-active' : '';
  soopTab.textContent = `SOOP 댓글 ${state.soop.totalCount.toLocaleString('ko-KR')}`;
  soopTab.addEventListener('click', () => { state.activeTab = 'soop'; renderVodCommentsContents(); });
  const fanTab = document.createElement('button'); fanTab.type = 'button'; fanTab.setAttribute('role', 'tab');
  fanTab.setAttribute('aria-selected', String(state.activeTab === 'fanpage'));
  fanTab.className = state.activeTab === 'fanpage' ? 'is-active' : '';
  fanTab.textContent = `팬페이지 댓글 ${state.fanpage.countLabel || state.fanpage.items.length}`;
  fanTab.addEventListener('click', () => { state.activeTab = 'fanpage'; renderVodCommentsContents(); });
  tabs.append(soopTab, fanTab); root.append(heading, tabs);
  const body = document.createElement('div'); body.className = 'vod-comments-body';
  if (state.loading && !state.soop.items.length && !state.fanpage.items.length) {
    const loading = document.createElement('p'); loading.className = 'vod-comments-status';
    loading.textContent = '댓글을 불러오고 있어요.'; body.append(loading); root.append(body); return;
  }
  if (state.error) {
    const error = document.createElement('p'); error.className = 'vod-comments-status is-error'; error.textContent = state.error;
    body.append(error);
  } else if (state.activeTab === 'soop') {
    if (state.soop.error) {
      const error = document.createElement('p'); error.className = 'vod-comments-status is-error'; error.textContent = state.soop.error;
      body.append(error);
    } else if (!state.soop.available) {
      const unavailable = document.createElement('p'); unavailable.className = 'vod-comments-status';
      unavailable.textContent = '이 다시보기에서는 SOOP 댓글을 사용할 수 없어요.'; body.append(unavailable);
    } else if (!state.soop.items.length) {
      const empty = document.createElement('p'); empty.className = 'vod-comments-status'; empty.textContent = '등록된 SOOP 댓글이 없어요.';
      body.append(empty);
    } else {
      const list = document.createElement('div'); list.className = 'vod-comments-list';
      state.soop.items.forEach((comment) => list.append(renderVodCommentItem(comment, 'soop')));
      body.append(list);
    }
    if (state.soop.hasMore) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'button vod-comments-more';
      more.textContent = state.loadingMore ? '불러오는 중…' : 'SOOP 댓글 더 보기'; more.disabled = state.loadingMore;
      more.addEventListener('click', loadMoreSoopVodComments); body.append(more);
    }
  } else {
    body.append(renderFanpageCommentComposer());
    if (!state.fanpage.items.length) {
      const empty = document.createElement('p'); empty.className = 'vod-comments-status'; empty.textContent = '아직 팬페이지 댓글이 없어요. 첫 댓글을 남겨보세요.';
      body.append(empty);
    } else {
      const list = document.createElement('div'); list.className = 'vod-comments-list';
      state.fanpage.items.forEach((comment) => list.append(renderVodCommentItem(comment, 'fanpage')));
      body.append(list);
      if (state.fanpage.hasMore) {
        const limit = document.createElement('p'); limit.className = 'vod-comments-status'; limit.textContent = '최근 댓글 50개를 표시하고 있어요.';
        body.append(limit);
      }
    }
  }
  root.append(body);
}

async function loadVodComments(requestId) {
  const state = vodCommentState;
  if (!state || requestId !== vodCommentRequestId) return;
  state.loading = true; state.error = '';
  renderVodCommentsContents();
  try {
    const result = await callVodComments({ streamerId: state.streamerId, vodId: state.vodId });
    if (!vodCommentState || requestId !== vodCommentRequestId) return;
    state.profile = result.data.profile || null;
    state.canDelete = result.data.canDelete === true;
    state.soop = result.data.soop;
    state.fanpage = result.data.fanpage;
    if (!state.profile) state.profileEditorOpen = true;
  } catch (error) {
    if (!vodCommentState || requestId !== vodCommentRequestId) return;
    state.error = error.message || '댓글을 불러오지 못했어요.';
  } finally {
    if (vodCommentState && requestId === vodCommentRequestId) {
      state.loading = false;
      renderVodCommentsContents();
    }
  }
}

async function loadMoreSoopVodComments() {
  const state = vodCommentState;
  if (!state || state.loadingMore || !state.soop.hasMore) return;
  const requestId = vodCommentRequestId;
  state.loadingMore = true; renderVodCommentsContents();
  try {
    const result = await callVodComments({
      streamerId: state.streamerId,
      vodId: state.vodId,
      soopPageNo: state.soop.nextPageNo,
      soopLastNo: state.soop.nextLastNo,
    });
    if (!vodCommentState || requestId !== vodCommentRequestId) return;
    const prior = state.soop;
    state.soop = {
      ...result.data.soop,
      items: [...prior.items, ...result.data.soop.items],
    };
    state.fanpage = result.data.fanpage;
  } catch (error) {
    showToast(error.message || 'SOOP 댓글을 더 불러오지 못했어요.');
  } finally {
    if (vodCommentState && requestId === vodCommentRequestId) {
      state.loadingMore = false; renderVodCommentsContents();
    }
  }
}

async function deleteVodComment(commentId) {
  const state = vodCommentState;
  if (!state || !state.canDelete || !confirm('이 팬페이지 댓글을 삭제할까요?')) return;
  try {
    await callVodCommentDelete({ streamerId: state.streamerId, vodId: state.vodId, commentId });
    state.fanpage.items = state.fanpage.items.filter((comment) => comment.id !== commentId);
    state.fanpage.countLabel = `${state.fanpage.items.length}${state.fanpage.hasMore ? '+' : ''}`;
    renderVodCommentsContents();
    showToast('팬페이지 댓글을 삭제했어요.');
  } catch (error) {
    showToast(error.message || '댓글을 삭제하지 못했어요.');
  }
}

function renderYouTubePlayerDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'youtubePlayerDialog'; dialog.className = 'account-dialog vod-player-dialog';
  const card = document.createElement('div'); card.className = 'account-dialog-card vod-player-card';
  const heading = document.createElement('div'); heading.className = 'vod-player-heading youtube-player-heading';
  const title = document.createElement('h2'); title.id = 'youtubePlayerTitle'; title.textContent = 'YouTube 영상';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close';
  close.setAttribute('aria-label', 'YouTube 플레이어 닫기'); close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  const frame = document.createElement('div'); frame.className = 'vod-player-frame';
  frame.id = 'youtubePlayerFrame';
  const volumeControls = document.createElement('div'); volumeControls.className = 'youtube-player-volume';
  const volumeLabel = document.createElement('label'); volumeLabel.htmlFor = 'youtubePlayerVolume'; volumeLabel.textContent = '볼륨';
  const volumeSlider = document.createElement('input'); volumeSlider.id = 'youtubePlayerVolume';
  volumeSlider.type = 'range'; volumeSlider.min = '0'; volumeSlider.max = '100'; volumeSlider.step = '1';
  volumeSlider.value = String(youtubeVolumeLevel); volumeSlider.disabled = true;
  volumeSlider.setAttribute('aria-label', 'YouTube 영상 볼륨');
  const volumeOutput = document.createElement('output'); volumeOutput.id = 'youtubePlayerVolumeOutput';
  volumeOutput.htmlFor = volumeSlider.id; volumeOutput.textContent = `${youtubeVolumeLevel}%`;
  const muteButton = document.createElement('button'); muteButton.id = 'youtubePlayerMuteButton';
  muteButton.type = 'button'; muteButton.className = 'button'; muteButton.textContent = '음소거'; muteButton.disabled = true;
  volumeControls.append(volumeLabel, volumeSlider, volumeOutput, muteButton);
  heading.append(title, volumeControls, close);
  const footer = document.createElement('div'); footer.className = 'vod-player-footer';
  const note = document.createElement('p'); note.id = 'youtubePlayerNote';
  note.textContent = '영상은 YouTube 공식 플레이어로 재생돼요. 외부 재생이 제한된 영상은 YouTube에서 열어 주세요.';
  const link = document.createElement('a'); link.id = 'youtubePlayerExternalLink'; link.className = 'button button-primary';
  link.href = 'https://www.youtube.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'YouTube에서 열기 ↗';
  footer.append(note, link); card.append(heading, frame, footer); dialog.append(card);
  volumeSlider.addEventListener('input', () => {
    const volume = setYouTubePlayerVolume(volumeSlider.value);
    if (volume > 0) youtubeLastAudibleVolume = volume;
    if (youtubePlayer) {
      youtubePlayer.setVolume(volume);
      if (volume === 0) youtubePlayer.mute();
      else youtubePlayer.unMute();
    }
    updateYouTubeVolumeControls();
  });
  muteButton.addEventListener('click', () => {
    if (!youtubePlayer) return;
    if (youtubePlayer.isMuted()) {
      const volume = youtubeVolumeLevel > 0 ? youtubeVolumeLevel : youtubeLastAudibleVolume;
      youtubeVolumeLevel = setYouTubePlayerVolume(volume);
      volumeSlider.value = String(volume);
      youtubePlayer.setVolume(volume);
      youtubePlayer.unMute();
    } else {
      const volume = Number(youtubePlayer.getVolume());
      if (volume > 0) {
        youtubeLastAudibleVolume = volume;
        youtubeVolumeLevel = volume;
      }
      youtubePlayer.mute();
    }
    updateYouTubeVolumeControls();
  });
  dialog.addEventListener('close', () => {
    youtubePlayerGeneration += 1;
    if (youtubePlayer) {
      try { youtubePlayer.destroy(); } catch (_) { /* the iframe may already have been removed */ }
      youtubePlayer = null;
    }
    frame.replaceChildren();
    volumeSlider.disabled = true;
    muteButton.disabled = true;
    $('youtubePlayerNote').textContent = '영상은 YouTube 공식 플레이어로 재생돼요. 외부 재생이 제한된 영상은 YouTube에서 열어 주세요.';
  });
  return dialog;
}

function loadYouTubeIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (youtubeIframeApiPromise) return youtubeIframeApiPromise;
  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    let timeoutId = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (error) reject(error);
      else if (window.YT && window.YT.Player) resolve(window.YT);
      else reject(new Error('YouTube 플레이어 API를 불러오지 못했어요.'));
    };
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        if (typeof previousCallback === 'function') previousCallback();
      } finally {
        finish();
      }
    };
    let script = [...document.scripts].find((candidate) => {
      try {
        const url = new URL(candidate.src, location.href);
        return url.hostname === 'www.youtube.com' && url.pathname === '/iframe_api';
      } catch (_) {
        return false;
      }
    });
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.addEventListener('error', () => finish(new Error('YouTube 플레이어 API를 불러오지 못했어요.')), { once: true });
      document.head.append(script);
    } else {
      script.addEventListener('error', () => finish(new Error('YouTube 플레이어 API를 불러오지 못했어요.')), { once: true });
    }
    timeoutId = window.setTimeout(() => finish(new Error('YouTube 플레이어 API 연결 시간이 초과됐어요.')), 20000);
  }).catch((error) => {
    youtubeIframeApiPromise = null;
    throw error;
  });
  return youtubeIframeApiPromise;
}

function updateYouTubeVolumeControls() {
  const slider = $('youtubePlayerVolume');
  const output = $('youtubePlayerVolumeOutput');
  const muteButton = $('youtubePlayerMuteButton');
  if (!slider || !output || !muteButton || !youtubePlayer) return;
  const muted = youtubePlayer.isMuted();
  const volume = Math.round(Number(youtubePlayer.getVolume()) || youtubeVolumeLevel);
  if (volume > 0) youtubeLastAudibleVolume = volume;
  slider.value = String(youtubeVolumeLevel);
  output.textContent = `${youtubeVolumeLevel}%${muted ? ' · 음소거' : ''}`;
  muteButton.textContent = muted ? '소리 켜기' : '음소거';
}

function openYouTubePlayer(video) {
  if (!video || !/^[A-Za-z0-9_-]{11}$/.test(String(video.id || ''))) return;
  const id = encodeURIComponent(video.id);
  $('youtubePlayerTitle').textContent = video.title || 'YouTube 영상';
  $('youtubePlayerExternalLink').href = `https://www.youtube.com/watch?v=${id}`;
  const dialog = $('youtubePlayerDialog');
  const frame = $('youtubePlayerFrame');
  const iframe = document.createElement('iframe');
  iframe.id = 'youtubePlayerFrameElement'; iframe.title = 'YouTube 영상 플레이어';
  const playerUrl = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  playerUrl.searchParams.set('autoplay', '1');
  playerUrl.searchParams.set('rel', '0');
  playerUrl.searchParams.set('playsinline', '1');
  playerUrl.searchParams.set('enablejsapi', '1');
  playerUrl.searchParams.set('origin', location.origin);
  iframe.src = playerUrl.toString();
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.replaceChildren(iframe);
  const generation = ++youtubePlayerGeneration;
  $('youtubePlayerVolume').value = String(youtubeVolumeLevel);
  $('youtubePlayerVolumeOutput').textContent = `${youtubeVolumeLevel}%`;
  $('youtubePlayerVolume').disabled = true;
  $('youtubePlayerMuteButton').disabled = true;
  $('youtubePlayerNote').textContent = '볼륨 조절을 연결하고 있어요.';
  showFanPageModal(dialog);
  loadYouTubeIframeApi().then((YT) => {
    if (generation !== youtubePlayerGeneration || !dialog.open || !iframe.isConnected) return;
    youtubePlayer = new YT.Player(iframe, {
      events: {
        onReady: (event) => {
          if (generation !== youtubePlayerGeneration || !dialog.open) {
            try { event.target.destroy(); } catch (_) { /* stale player */ }
            return;
          }
          youtubePlayer = event.target;
          youtubePlayer.setVolume(youtubeVolumeLevel);
          if (youtubeVolumeLevel === 0) youtubePlayer.mute();
          $('youtubePlayerVolume').disabled = false;
          $('youtubePlayerMuteButton').disabled = false;
          $('youtubePlayerNote').textContent = '영상은 YouTube 공식 플레이어로 재생돼요. 아래 볼륨 조절은 쇼츠 화면에서도 사용할 수 있어요.';
          updateYouTubeVolumeControls();
        },
      },
    });
  }).catch(() => {
    if (generation !== youtubePlayerGeneration || !dialog.open) return;
    $('youtubePlayerNote').textContent = '볼륨 조절 연결이 안 되면 영상 안의 스피커 버튼이나 YouTube에서 열기로 조절해 주세요.';
  });
}

function replaceVodSectionIfCurrent(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('vodSection');
  if (section) section.replaceWith(renderVodSection(currentPage));
}

async function loadMoreVods(streamerId, currentVods) {
  if (vodPageLoadsInProgress.has(streamerId) || vodRefreshesInProgress.has(streamerId)
    || currentVods.items.length >= MAX_LOADED_VIDEO_ITEMS) return;
  vodPageLoadsInProgress.add(streamerId);
  replaceVodSectionIfCurrent(streamerId);
  try {
    const result = await callVodPage({
      streamerId,
      offset: Number(currentVods.nextOffset) || currentVods.items.length,
      generation: currentVods.generation || '',
    });
    if (!currentPage || currentPage.streamer.id !== streamerId) return;
    const nextPage = result.data.vods;
    const knownIds = new Set(currentPage.vods.items.map((vod) => vod.id));
    const addedItems = nextPage.items.filter((vod) => !knownIds.has(vod.id));
    const available = Math.min(MAX_LOADED_VIDEO_ITEMS, Number(nextPage.available ?? nextPage.total) || 0);
    const items = [...currentPage.vods.items, ...addedItems].slice(0, MAX_LOADED_VIDEO_ITEMS);
    currentPage.vods = {
      ...nextPage,
      items,
      available,
      nextOffset: Math.min(MAX_LOADED_VIDEO_ITEMS, nextPage.nextOffset),
      hasMore: items.length < available && nextPage.hasMore,
    };
  } catch (error) {
    if (currentPage && currentPage.streamer.id === streamerId) {
      if (error.code === 'functions/aborted') {
        try {
          const latest = (await callBootstrap({ streamerId })).data;
          if (latest.page && currentPage && currentPage.streamer.id === streamerId) {
            currentPage.vods = latest.page.vods;
            showToast('목록이 갱신되어 최신 상태로 불러왔어요.');
          } else showToast(error.message || '다시보기 목록을 불러오지 못했어요.');
        } catch (reloadError) {
          showToast(reloadError.message || error.message || '다시보기 목록을 불러오지 못했어요.');
        }
      } else showToast(error.message || '다시보기 목록을 불러오지 못했어요.');
    }
  } finally {
    vodPageLoadsInProgress.delete(streamerId);
    replaceVodSectionIfCurrent(streamerId);
  }
}

async function runSearch() {
  const query = $('searchInput').value.trim();
  $('clearSearch').classList.toggle('hidden', !query);
  const hint = $('searchHint');
  if (!query) {
    $('searchResults').replaceChildren();
    hint.textContent = '인증 스트리머의 닉네임이나 방송국 아이디를 입력해 주세요.';
    return;
  }
  hint.textContent = '인증된 스트리머를 찾고 있어요…';
  try {
    const result = await callSearch({ query });
    const streamers = Array.isArray(result.data.streamers) ? result.data.streamers : [];
    if (streamers.length) {
      renderList($('searchResults'), streamers);
      hint.textContent = `검색 결과 ${streamers.length}명`;
    } else {
      const empty = document.createElement('div');
      empty.className = 'search-empty search-empty-guidance';
      const title = document.createElement('strong');
      title.className = 'search-empty-guidance-title';
      title.textContent = '찾는 스트리머가 없나요?';
      const description = document.createElement('p');
      description.textContent = '스트리머 인증을 신청하고 승인되면 본인 팬페이지가 생성돼요.';
      const verify = document.createElement('button');
      verify.type = 'button'; verify.className = 'button button-primary search-empty-verify';
      verify.textContent = '스트리머 인증하기';
      verify.addEventListener('click', () => showFanPageModal($('streamerVerifyDialog')));
      empty.append(title, description, verify);
      $('searchResults').replaceChildren(empty);
      hint.textContent = '일치하는 인증 스트리머를 찾지 못했어요.';
    }
  } catch (error) { hint.textContent = error.message || '검색에 실패했어요.'; }
}
function showStartupError(error) {
  const isStreamerNotFound = error && (
    error.code === 'functions/not-found'
    || error.code === 'not-found'
    || /인증된 스트리머 팬페이지를 찾을 수 없습니다|팬페이지를 찾을 수 없습니다/.test(error.message || '')
  );
  $('startupCover').classList.add('is-error');
  $('startupCover').classList.toggle('is-not-found', isStreamerNotFound);
  $('startupTitle').textContent = isStreamerNotFound ? '팬페이지를 찾을 수 없어요' : '페이지를 불러오지 못했어요';
  $('startupMessage').textContent = isStreamerNotFound
    ? '해당 스트리머의 팬페이지가 없습니다. 팬페이지는 인증된 스트리머에게 제공되며, 방송국 아이디가 맞는지 확인해 주세요.'
    : error && error.message ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.';
  $('retryButton').textContent = isStreamerNotFound ? '스트리머 검색으로 이동' : '다시 불러오기';
  $('retryButton').classList.remove('hidden');
}
async function loadApp() {
  $('startupCover').classList.remove('is-error');
  $('startupCover').classList.remove('is-not-found');
  $('retryButton').classList.add('hidden');
  $('retryButton').textContent = '다시 불러오기';
  $('startupTitle').textContent = '페이지를 준비하고 있어요';
  $('startupMessage').textContent = '로그인 상태와 인증된 스트리머 정보를 확인하고 있습니다.';
  try {
    let requestedId = routeId();
    const hadAuthAtBootstrap = !!auth.currentUser;
    const authReady = ensureAuthReady();
    let result;
    if (requestedId) {
      try {
        result = (await callBootstrap({ streamerId: requestedId })).data;
      } catch (error) {
        // Older deployed bootstrap revisions still require the anonymous session;
        // retry after Auth restores so a fresh visitor does not get stuck at startup.
        if (hadAuthAtBootstrap || !['functions/unauthenticated', 'unauthenticated'].includes(error.code)) throw error;
        await authReady;
        result = (await callBootstrap({ streamerId: requestedId })).data;
      }
    } else {
      await authReady;
      result = (await callBootstrap({ streamerId: requestedId })).data;
    }
    if (result.redirectTo && result.redirectTo !== requestedId) {
      history.replaceState(null, '', `#/p/${encodeURIComponent(result.redirectTo)}`);
      requestedId = result.redirectTo;
      result = (await callBootstrap({ streamerId: requestedId })).data;
    }
    isAdminUser = result.isAdmin === true;
    verifiedStreamerUid = result.verifiedStreamer ? auth.currentUser.uid : '';
    verifiedStreamerProfile = result.verifiedStreamer || null;
    verifiedStreamerProfileUid = result.verifiedStreamer ? auth.currentUser.uid : '';
    renderAuthControls();
    if (requestedId && !result.page) {
      throw Object.assign(new Error('팬페이지를 찾을 수 없습니다.'), { code: 'not-found' });
    }
    const recentPromise = callRecent(requestedId ? { streamerId: requestedId } : {})
      .then((value) => value.data.streamers)
      .catch((error) => {
        console.warn('Could not load recent fanpages:', error.message || error);
        return [];
      });
    if (!requestedId) {
      const directoryPromise = callSearch({ query: '', includeAll: true })
        .then((value) => Array.isArray(value.data.streamers) ? value.data.streamers : [])
        .catch((error) => {
          console.warn('Could not load the registered streamer directory:', error.message || error);
          return [];
        });
      const [recent, registered] = await Promise.all([recentPromise, directoryPromise]);
      renderList($('recentPages'), recent, true, '최근 방문한 팬페이지가 여기에 표시돼요.');
      renderRegisteredStreamers(registered);
      setVisibleView(null);
      $('searchInput').value = '';
      $('searchInput').oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 220);
        $('clearSearch').classList.toggle('hidden', !$('searchInput').value);
      };
      $('clearSearch').onclick = () => { $('searchInput').value = ''; runSearch(); $('searchInput').focus(); };
    } else {
      const page = result.page;
      page.isStreamerOwner = !!(result.verifiedStreamer && result.verifiedStreamer.id === page.streamer.id);
      // 관리자는 서버가 권한을 확인한 경우에만 스트리머 시점의 설정 UI를 본다.
      page.isOwner = page.isStreamerOwner || result.isAdmin === true;
      setVisibleView(page);
      openTamagotchiAdminFromDeepLink();
      recentPromise.then((recent) => {
        if (currentPage && currentPage.streamer.id === page.streamer.id) {
          renderList($('recentPages'), recent, true, '최근 방문한 팬페이지가 여기에 표시돼요.');
        }
      });
      if (!hadAuthAtBootstrap) {
        void authReady.then(async (user) => {
          if (!user || routeId() !== requestedId) return;
          const authenticated = (await callBootstrap({ streamerId: requestedId })).data;
          if (authenticated.redirectTo && authenticated.redirectTo !== requestedId) {
            history.replaceState(null, '', `#/p/${encodeURIComponent(authenticated.redirectTo)}`);
            void loadApp();
            return;
          }
          isAdminUser = authenticated.isAdmin === true;
          verifiedStreamerUid = authenticated.verifiedStreamer ? user.uid : '';
          verifiedStreamerProfile = authenticated.verifiedStreamer || null;
          verifiedStreamerProfileUid = authenticated.verifiedStreamer ? user.uid : '';
          renderAuthControls();
          if (!currentPage || currentPage.streamer.id !== requestedId) return;
          const wasOwner = currentPage.isOwner;
          const wasStreamerOwner = currentPage.isStreamerOwner;
          currentPage.isStreamerOwner = !!(authenticated.verifiedStreamer
            && authenticated.verifiedStreamer.id === currentPage.streamer.id);
          currentPage.isOwner = currentPage.isStreamerOwner || authenticated.isAdmin === true;
          if (wasOwner !== currentPage.isOwner || wasStreamerOwner !== currentPage.isStreamerOwner) {
            renderFanPage(currentPage);
          }
          openTamagotchiAdminFromDeepLink();
        }).catch((error) => console.warn('로그인 상태에 따른 팬페이지 권한 확인 실패:', error.message || error));
      }
    }
    void waitForPageAssets();
    $('startupCover').classList.add('hidden');
    $('siteShell').setAttribute('aria-hidden', 'false');
    $('siteShell').classList.add('is-ready');
    if (LOGIN_ASSIST_QUERY) {
      const loginUrl = new URL(location.href);
      loginUrl.searchParams.delete('login');
      history.replaceState(null, '', loginUrl.href);
    }
    if (loginAssistTab) {
      if (hasRecognizedFanpageAccount()) completeLoginAssistTab();
      else window.setTimeout(() => showFanPageModal($('loginChoiceDialog')), 120);
    }
  } catch (error) { showStartupError(error); }
}
$('retryButton').addEventListener('click', () => {
  if ($('startupCover').classList.contains('is-not-found')) {
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
    loadApp();
    return;
  }
  loadApp();
});
$('openLoginOptions').addEventListener('click', () => showFanPageModal($('loginChoiceDialog')));
$('closeLoginChoices').addEventListener('click', () => $('loginChoiceDialog').close());
$('choiceGoogleLogin').addEventListener('click', () => { $('loginChoiceDialog').close(); loginWithGoogle(); });
$('choiceKakaoLogin').addEventListener('click', () => { $('loginChoiceDialog').close(); loginWithKakao(); });
$('closeLoginAssistTab').addEventListener('click', () => {
  window.close();
  window.setTimeout(() => {
    if (!window.closed) $('loginAssistCloseStatus').textContent = '브라우저에서 자동 닫기를 허용하지 않으면 탭의 닫기 버튼을 눌러 주세요.';
  }, 200);
});
$('openStreamerVerification').addEventListener('click', () => {
  $('loginChoiceDialog').close();
  showFanPageModal($('streamerVerifyDialog'));
});
$('closeStreamerVerification').addEventListener('click', () => $('streamerVerifyDialog').close());
$('checkStreamerVerification').addEventListener('click', () => submitOrCheckStreamerVerification(true));
$('renewVerificationCode').addEventListener('click', () => submitOrCheckStreamerVerification(false, true));
$('streamerVerificationForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submitOrCheckStreamerVerification(false);
});
$('logoutButton').addEventListener('click', logout);
$('openAdminStats').addEventListener('click', () => {
  if (!isAdminUser) return;
  showFanPageModal($('adminStatsDialog'));
  loadAdminStats();
  loadAdminDesignFeedback();
  loadAdminTamagotchiApplications();
});
$('closeAdminStats').addEventListener('click', () => $('adminStatsDialog').close());
$('refreshAdminStats').addEventListener('click', loadAdminStats);
$('viewerStatsAdminDataRange').addEventListener('change', () => {
  if (latestViewerStatsAdminUsage) renderViewerStatsUsage(latestViewerStatsAdminUsage);
});
$('refreshDesignFeedback').addEventListener('click', loadAdminDesignFeedback);
$('refreshTamagotchiApplications').addEventListener('click', loadAdminTamagotchiApplications);
$('adminTamagotchiApplicationFilter').addEventListener('change', renderAdminTamagotchiApplications);
$('adminTamagotchiApplicationList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-tamagotchi-action][data-streamer-id][data-application-id]');
  if (!button || !isAdminUser) return;
  const action = button.dataset.tamagotchiAction;
  const reviewNote = prompt(action === 'approve'
    ? '신청자에게 전달할 승인 메모 (선택 사항)'
    : '신청자에게 전달할 보완 요청 내용을 적어 주세요.');
  if (reviewNote === null) return;
  if (action === 'reject' && !reviewNote.trim()) {
    $('adminTamagotchiApplicationStatus').textContent = '보완 요청 사유를 입력해 주세요.';
    return;
  }
  button.disabled = true;
  $('adminTamagotchiApplicationStatus').textContent = action === 'approve' ? '신청서를 승인하고 있어요.' : '보완 요청을 보내고 있어요.';
  try {
    await callTamagotchiApplications({
      action: 'review',
      streamerId: button.dataset.streamerId,
      applicationId: button.dataset.applicationId,
      decision: action,
      reviewNote: reviewNote.trim(),
    });
    await loadAdminTamagotchiApplications();
  } catch (error) {
    $('adminTamagotchiApplicationStatus').textContent = error.message || '신청서를 처리하지 못했어요.';
    button.disabled = false;
  }
});
$('openDesignFeedback').addEventListener('click', () => {
  const activeId = routeId().toLowerCase();
  const streamer = currentPage?.streamer && String(currentPage.streamer.id || '').toLowerCase() === activeId
    ? currentPage.streamer
    : null;
  $('designFeedbackContext').textContent = streamer
    ? `대상: ${streamer.nickname} 팬페이지 · 인증 스트리머만 제출할 수 있어요.`
    : '대상: 사이트 전체 · 인증 스트리머만 제출할 수 있어요.';
  $('designFeedbackStatus').textContent = '';
  $('designFeedbackStatus').classList.remove('is-error');
  $('designFeedbackForm').reset();
  showFanPageModal($('designFeedbackDialog'));
  updateDesignFeedbackEligibility();
});
$('closeDesignFeedback').addEventListener('click', () => $('designFeedbackDialog').close());
$('cancelDesignFeedback').addEventListener('click', () => $('designFeedbackDialog').close());
$('designFeedbackForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const submit = $('submitDesignFeedback');
  const status = $('designFeedbackStatus');
  const profileReady = !!(
    auth.currentUser
    && verifiedStreamerUid === auth.currentUser.uid
    && verifiedStreamerProfileUid === auth.currentUser.uid
    && verifiedStreamerProfile
  );
  if (!profileReady) {
    status.textContent = auth.currentUser && verifiedStreamerUid === auth.currentUser.uid
      ? '인증 프로필을 불러오고 있어요. 잠시 후 다시 시도해 주세요.'
      : '스트리머 인증을 완료한 계정만 문의를 보낼 수 있어요.';
    return;
  }
  submit.disabled = true;
  status.classList.remove('is-error');
  status.textContent = '의견을 접수하고 있어요.';
  try {
    const activeId = routeId().toLowerCase();
    const streamerId = currentPage?.streamer && String(currentPage.streamer.id || '').toLowerCase() === activeId
      ? String(currentPage.streamer.id || '').trim().toLowerCase()
      : '';
    await callDesignFeedback({
      action: 'submit',
      category: $('designFeedbackCategory').value,
      title: $('designFeedbackTitleInput').value.trim(),
      content: $('designFeedbackMessage').value.trim(),
      streamerId,
    });
    form.reset();
    $('designFeedbackDialog').close();
    showToast('디자인 문의 / 건의를 접수했어요.');
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = error.message || '건의를 접수하지 못했어요. 잠시 후 다시 시도해 주세요.';
  } finally {
    updateDesignFeedbackEligibility();
  }
});
$('adminDesignFeedbackList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-design-feedback-action][data-feedback-id]');
  if (!button || !isAdminUser) return;
  const action = button.dataset.designFeedbackAction;
  const feedbackId = button.dataset.feedbackId;
  if (action === 'delete' && !confirm('이 건의를 삭제할까요?')) return;
  button.disabled = true;
  $('adminDesignFeedbackStatus').textContent = action === 'delete' ? '건의를 삭제하고 있어요.' : '처리 상태를 저장하고 있어요.';
  try {
    await callDesignFeedback({
      action,
      feedbackId,
      status: button.dataset.feedbackStatus,
    });
    await loadAdminDesignFeedback();
  } catch (error) {
    $('adminDesignFeedbackStatus').textContent = error.message || '건의를 처리하지 못했어요.';
    button.disabled = false;
  }
});
$('refreshViewerSubscriptionRequests').addEventListener('click', loadAdminViewerSubscriptionRequests);
$('viewerSubscriptionAdminList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-subscription-action][data-request-id]');
  if (!button || !isAdminUser) return;
  const action = button.dataset.subscriptionAction;
  const requestId = button.dataset.requestId;
  if (action === 'reject' && !confirm('이 구독 신청을 거절할까요?')) return;
  button.disabled = true;
  $('viewerSubscriptionAdminStatus').textContent = action === 'approve'
    ? '승인 처리 중이에요.'
    : '신청을 거절하고 있어요.';
  try {
    await callAdminViewerSubscriptionRequests({ action, requestId });
    await loadAdminViewerSubscriptionRequests();
  } catch (error) {
    $('viewerSubscriptionAdminStatus').textContent = error.message || '신청을 처리하지 못했어요.';
    button.disabled = false;
  }
});
$('adminStatsSearch').addEventListener('input', () => {
  if (adminStatsData) renderAdminStatsList(adminStatsData.streamers);
});
window.addEventListener('hashchange', loadApp);
loadApp();

async function submitOrCheckStreamerVerification(checkOnly, renewOnly = false) {
  const submitButton = $('submitStreamerVerification');
  const checkButton = $('checkStreamerVerification');
  const status = $('verificationStatus');
  const nickname = $('verificationNickname').value.trim();
  const soopId = $('verificationSoopId').value.trim().toLowerCase();
  if (!checkOnly && !renewOnly && !$('streamerVerificationForm').reportValidity()) return;
  submitButton.disabled = true;
  checkButton.disabled = true;
  status.textContent = checkOnly ? '인증 상태를 확인하고 있어요.' : renewOnly ? '새 코드를 발급하고 있어요.' : '인증 신청을 접수하고 있어요.';
  try {
    const previousText = $('verificationNoteCode').textContent.trim();
    const previousCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(previousText) ? previousText : '';
    if (!auth.currentUser) await waitForAuthRestore();
    if (!auth.currentUser) await signInAnonymously(auth);
    const payload = { source: 'streamer-fanpage', checkOnly };
    if (!checkOnly && !renewOnly) Object.assign(payload, { nickname, soopId });
    const result = (await callStreamerVerification(payload)).data || {};
    if (result.action === 'already-verified' || result.action === 'auto-approved') {
      status.textContent = '인증이 확인됐어요. 본인 팬페이지로 이동합니다.';
      if (loginAssistTab) completeLoginAssistTab();
      else setTimeout(() => location.reload(), 500);
      return;
    }
    if (result.action === 'switch') {
      status.textContent = '이미 인증된 계정이 확인됐어요.';
      if (await confirmAccountSwitch()) {
        await signInWithCustomToken(auth, result.customToken);
        preserveLoginAssistTabForReload();
        location.reload();
      }
      return;
    }
    if (result.action === 'pending') {
      const note = $('verificationNote');
      const canSendNote = result.noteEligible === true || (!result.isSwitch && result.noteEligible !== false);
      note.hidden = !canSendNote;
      if (canSendNote) {
        const code = Number(result.verificationCodeExpiresAt) > Date.now()
          ? result.verificationCode || (checkOnly ? previousCode : '') : '';
        const codeButton = $('verificationNoteCode');
        codeButton.textContent = code || '코드 없음';
        codeButton.disabled = !code;
        $('verificationNoteStatus').textContent = code ? '' : '코드가 없거나 만료됐어요. 새 코드를 발급해주세요.';
        codeButton.onclick = async () => {
          try { await navigator.clipboard.writeText(code); $('verificationNoteStatus').textContent = '복사했어요. 쪽지 본문에 붙여넣어 보내주세요.'; }
          catch (_) { $('verificationNoteStatus').textContent = '코드를 선택해 직접 복사해주세요.'; }
        };
      }
      status.textContent = result.isSwitch
        ? (canSendNote
          ? '계정 전환 신청이 접수됐어요. 기존 인증 스트리머의 SOOP 아이디로 코드를 보내면 확인 후 이 기기에서도 기존 계정으로 전환됩니다.'
          : '계정 전환 신청은 관리자 수동 검수가 필요합니다.')
        : checkOnly
          ? `${result.nickname || '스트리머'} 인증은 아직 검토 중이에요. 승인 후 다시 확인해 주세요.`
          : '인증 신청을 접수했어요. SOOP 쪽지의 발신자 아이디와 코드를 대조해 자동 승인합니다.';
      return;
    }
    throw new Error('인증 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } catch (error) {
    console.error('Streamer verification failed:', error);
    status.textContent = error.message || '인증 요청에 실패했어요. 잠시 후 다시 시도해 주세요.';
  } finally {
    submitButton.disabled = false;
    checkButton.disabled = false;
  }
}
