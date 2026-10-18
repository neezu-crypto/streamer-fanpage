import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithPopup, signInWithCustomToken, linkWithPopup, signOut, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { getDatabase, ref, get, onValue } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

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
const callBootstrap = httpsCallable(functions, 'streamerFanPageBootstrap');
const callSearch = httpsCallable(functions, 'streamerFanPageSearch');
const callRecent = httpsCallable(functions, 'streamerFanPageRecent');
const callAdminStats = httpsCallable(functions, 'streamerFanPageAdminStats');
const callDesignFeedback = httpsCallable(functions, 'streamerFanPageDesignFeedback');
const callAdminViewerSubscriptionRequests = httpsCallable(functions, 'streamerFanPageAdminViewerSubscriptionRequests');
const callSave = httpsCallable(functions, 'streamerFanPageSave');
const callSongbook = httpsCallable(functions, 'streamerFanPageSongbook');
const callVodPage = httpsCallable(functions, 'streamerFanPageVodPage');
const callVodComments = httpsCallable(functions, 'streamerFanPageVodComments');
const callVodCommentAdd = httpsCallable(functions, 'streamerFanPageVodCommentAdd');
const callVodCommentDelete = httpsCallable(functions, 'streamerFanPageVodCommentDelete');
const callCommentProfileSave = httpsCallable(functions, 'streamerFanPageCommentProfileSave');
const callVodRefresh = httpsCallable(functions, 'streamerFanPageVodRefresh', { timeout: 3600000 });
const callCalendar = httpsCallable(functions, 'streamerFanPageCalendar');
const callLiveStatus = httpsCallable(functions, 'streamerFanPageLiveStatus');
const callGallery = httpsCallable(functions, 'streamerFanPageGallery');
const callScheduleAdd = httpsCallable(functions, 'streamerFanPageScheduleAdd');
const callScheduleDelete = httpsCallable(functions, 'streamerFanPageScheduleDelete');
const callYouTubeVideos = httpsCallable(functions, 'streamerFanPageYouTubeVideos');
const callCafePosts = httpsCallable(functions, 'streamerFanPageCafePosts');
const callRoulette = httpsCallable(functions, 'streamerFanPageRoulette');
const callUpbo = httpsCallable(functions, 'streamerFanPageUpbo');
// 로그인 연결은 시리즈의 공유 Firebase Functions callable을 사용한다.
const callLinkGoogle = httpsCallable(functions, 'linkGoogleAccount');
const callLinkKakao = httpsCallable(functions, 'linkKakaoAccount');
const callStreamerVerification = httpsCallable(functions, 'requestStreamerVerification');
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
const KAKAO_LINKED_UID_KEY = 'streamerFanPage.kakaoLinkedUid';
const MAX_LOADED_VIDEO_ITEMS = 500;
const MAX_BANNER_IMAGE_ITEMS = 20;
const MAX_UPBO_ITEMS = 100;
const DEFAULT_FANPAGE_LAYOUT = 1;
const BUTTON_CLICK_SOUND_STORAGE_KEY = 'streamerFanPage.buttonClickVolume';
const DEFAULT_BUTTON_CLICK_VOLUME = 20;
const buttonClickAudio = new Audio(new URL('./assets/sounds/button-click.mp3', import.meta.url).href);
const modalOpenAudio = new Audio(new URL('./assets/sounds/modal-open.mp3', import.meta.url).href);
const saveButtonAudio = new Audio(new URL('./assets/sounds/save-button.mp3', import.meta.url).href);
const catPawCloseAudio = new Audio(new URL('./assets/sounds/cat-paw-close.mp3', import.meta.url).href);
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
function setButtonClickVolume(value) {
  const volume = Number(value);
  buttonClickVolume = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : DEFAULT_BUTTON_CLICK_VOLUME;
  try { localStorage.setItem(BUTTON_CLICK_SOUND_STORAGE_KEY, String(buttonClickVolume)); } catch (_) { /* volume still applies for this visit */ }
  return buttonClickVolume;
}
let modalOpenGeneration = 0;
function playUiSound(audio, volumeOffsetPercent = 0, startOffsetSeconds = 0) {
  if (buttonClickVolume <= 0) return;
  audio.volume = Math.min(1, (buttonClickVolume + volumeOffsetPercent) / 100);
  audio.currentTime = startOffsetSeconds;
  const playback = audio.play();
  if (playback && typeof playback.catch === 'function') playback.catch(() => {});
}
function showFanPageModal(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  dialog.showModal();
  modalOpenGeneration += 1;
  playUiSound(modalOpenAudio);
}
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
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('data-no-click-sound')) return;
  const openGeneration = modalOpenGeneration;
  queueMicrotask(() => {
    if (modalOpenGeneration !== openGeneration) return;
    if (isCatPawCloseButton(button)) playUiSound(catPawCloseAudio, 0, 0.05);
    else if (isCompleteButton(button)) playUiSound(saveButtonAudio, 10);
    else playUiSound(isSaveOrCompleteButton(button) ? saveButtonAudio : buttonClickAudio);
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
let verifiedStatusUnsubscribe = null;
let switchApprovalUnsubscribe = null;
let switchHandoffInProgress = false;
const vodRefreshesInProgress = new Set();
const vodPageLoadsInProgress = new Set();
let vodCommentState = null;
let vodCommentRequestId = 0;
const calendarStates = new Map();
const liveStatusStates = new Map();
const youtubeStates = new Map();
const cafeStates = new Map();
const rouletteStates = new Map();
const upboStates = new Map();
let galleryLoadPromise = Promise.resolve();

if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init('ed4f01d6903ca41d5dc0ab32b6ae143c');

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
  } catch (error) {
    if (error && error.code === 'auth/credential-already-in-use') {
      if (!(await confirmAccountSwitch())) return;
      try {
        await signInWithPopup(auth, googleProvider);
        await callLinkGoogle();
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
  if (!window.Kakao || !window.Kakao.isInitialized()) {
    showToast('카카오 로그인을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    return;
  }
  const button = $('choiceKakaoLogin');
  button.disabled = true;
  window.Kakao.Auth.login({
    success: async (authObj) => {
      try {
        const result = await callLinkKakao({ kakaoAccessToken: authObj.access_token });
        const action = result.data && result.data.action;
        if (action === 'switch') {
          if (!(await confirmAccountSwitch())) return;
          const signedIn = await signInWithCustomToken(auth, result.data.customToken);
          localStorage.setItem(KAKAO_LINKED_UID_KEY, signedIn.user.uid);
          location.reload();
          return;
        }
        if (auth.currentUser && (action === 'linked' || action === 'already-linked')) {
          localStorage.setItem(KAKAO_LINKED_UID_KEY, auth.currentUser.uid);
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
      ['일별 순방문 합', streamer.last30DailyUniqueVisitors],
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
      bar.title = `${day.date}: 조회 ${formatStatCount(views)}회 · 일별 순방문 ${formatStatCount(day.uniqueVisitors)}명`;
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
function renderViewerStatsUsage(usage) {
  const safeUsage = usage && typeof usage === 'object' ? usage : {};
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
    const nickname = document.createElement('strong');
    nickname.textContent = request.nickname || '닉네임 없음';
    const donorId = document.createElement('small');
    donorId.textContent = request.donorSoopId ? '후원 SOOP 아이디 · @' + request.donorSoopId : 'SOOP 아이디 미입력 · 기존 방식 신청';
    const account = document.createElement('small');
    const uid = String(request.requesterUid || '');
    account.textContent = '계정 UID · ' + (uid.length > 8 ? '…' + uid.slice(-8) : uid);
    const donationStatus = document.createElement('small');
    donationStatus.textContent = request.verificationSource === 'soop-donation-notification'
      ? 'SOOP 후원 알림 자동 확인 완료'
      : request.donationCompletedAt
        ? '후원 완료 신호 · ' + new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(request.donationCompletedAt))
        : request.donorSoopId ? '후원 완료 신호 대기' : '자동 확인 정보 없음';
    const requestedAt = document.createElement('small');
    requestedAt.textContent = request.requestedAt
      ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(request.requestedAt))
      : '신청 시각 없음';
    identity.append(nickname, donorId, donationStatus, account, requestedAt);

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
    approve.textContent = processingActive ? '자동 승인 처리 중…' : request.status === 'processing' ? '승인 재개' : '후원 확인 · 30일 승인';
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
    ? `${formatStatCount(rows.length)}건 대기 중${truncated ? ' · 200건까지만 표시' : ''}. 자동 확인이 일치하지 않거나 오래 멈춘 신청은 후원자 SOOP 아이디와 후원 내역을 확인해 처리해 주세요.`
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
    $('adminStatsStatus').textContent = Number.isFinite(generatedAt)
      ? `최근 집계 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(generatedAt))} · 최근 30일 기준`
      : '최근 30일 기준 집계예요.';
  } catch (error) {
    $('adminStatsStatus').textContent = error.message || '통계를 불러오지 못했어요.';
  } finally {
    adminStatsLoading = false;
    $('refreshAdminStats').disabled = false;
    $('refreshAdminStats').textContent = '↻ 새로고침';
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
async function waitForPageAssets() {
  const images = [...document.querySelectorAll('#mainContent img')]
    .filter((image) => image.loading !== 'lazy' && image.getBoundingClientRect().top < window.innerHeight);
  const criticalAssets = [
    ...(document.fonts && document.fonts.ready ? [document.fonts.ready.catch(() => undefined)] : []),
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
    empty.textContent = state.canManage ? '신청 항목을 추가하면 팬들이 여기서 신청할 수 있어요.' : '아직 신청할 수 있는 항목이 없어요.';
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
  const addItem = upboButton('+ 항목 추가', 'button-primary upbo-small-button upbo-add-item-inline', () => openUpboItemEditor(page));
  addItem.disabled = state.saving || state.items.length >= MAX_UPBO_ITEMS;
  heading.append(headingCopy, addItem); panel.append(heading);
  if (!state.items.length) {
    const empty = document.createElement('p'); empty.className = 'upbo-inline-empty'; empty.textContent = '아직 항목이 없어요. 항목 추가 버튼으로 등록해 주세요.';
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
  document.body.append(dialog); showFanPageModal(dialog); name.field.focus();
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

function renderKawaiiWelcome(page) {
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
    document.getElementById('fanGallerySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const scheduleButton = document.createElement('button'); scheduleButton.type = 'button';
  scheduleButton.className = 'button'; scheduleButton.textContent = '방송 일정 보기';
  scheduleButton.addEventListener('click', () => {
    document.getElementById('calendarSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  stockPriceSparklineRequest += 1;
  currentPage = page;
  const view = $('fanPageView');
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
  if (layoutDesign === 1) view.append(renderKawaiiWelcome(page));
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
  const ogqSection = fanCharacterCard ? null : renderOgqSection(page);
  const cafeSection = renderCafeSection(page);
  const calendarSection = renderCalendarSection(page);
  const gallerySection = renderGallerySection(page);
  const contentSections = [upboSection, rouletteSection, messengerSection, liveSection, vodSection,
    youtubeSection, songbookSection, ogqSection, cafeSection, calendarSection, gallerySection].filter(Boolean);
  if (featuredPair) view.append(featuredPair);
  if (layoutDesign === 1) {
    const grid = document.createElement('div'); grid.className = 'fanpage-design-one-grid';
    const mainColumn = document.createElement('div'); mainColumn.className = 'fanpage-design-one-column fanpage-design-one-main-column';
    const sideColumn = document.createElement('aside'); sideColumn.className = 'fanpage-design-one-column fanpage-design-one-side-column';
    [gallerySection, liveSection, vodSection, cafeSection, calendarSection]
      .filter(Boolean).forEach((contentSection) => mainColumn.append(contentSection));
    [upboSection, rouletteSection, messengerSection, youtubeSection, songbookSection, ogqSection]
      .filter(Boolean).forEach((contentSection) => sideColumn.append(contentSection));
    grid.append(mainColumn, sideColumn);
    view.append(grid);
  } else {
    contentSections.forEach((contentSection) => view.append(contentSection));
  }
  const bottomBanner = renderBannerSection(page, 'bottom');
  if (bottomBanner) {
    view.classList.add('has-bottom-banner');
    $('siteShell').classList.add('has-bottom-banner');
    document.body.classList.add('fanpage-bottom-banner-active');
    view.append(bottomBanner);
  }
  if (page.isOwner) view.append(renderFanPageScheduleDialog(page));
  view.append(renderVodPlayerDialog());
  if (youtubeSection) view.append(renderYouTubePlayerDialog());
  fanPageQuickNavCleanup = createFanPageQuickRemote(view);
  loadLiveStatus(page.streamer.id);
  liveStatusTimer = window.setInterval(() => loadLiveStatus(page.streamer.id), 60 * 1000);
  if (page.profile && page.profile.youtubeChannelUrl) loadYouTubeVideos(page.streamer.id);
  if (page.profile && page.profile.cafeUrl) loadCafePosts(page.streamer.id);
  loadCalendar(page.streamer.id);
  loadUpboBoard(page.streamer.id);

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
    bannerEditors.bottomBannerImageUrls = createBannerSettingsEditor(
      'bottomBannerImageUrls', '하단 배너 이미지', profile.bottomBannerImageUrls || [],
    );
    grid.append(bannerEditors.topBannerImageUrls.element, bannerEditors.bottomBannerImageUrls.element);
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
    ['youtube-section', 'YouTube'], ['songbook-section', '노래책'],
    ['ogq-section', 'OGQ 이모티콘'], ['cafe-section', '네이버 카페'],
    ['calendar-section', '방송 일정'], ['fan-gallery-section', '팬 갤러리'],
    ['fan-banner-bottom', '하단 배너'],
  ];
  const sections = [...view.children]
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
  const panel = document.createElement('div'); panel.className = 'fan-quick-panel'; panel.id = 'fanQuickPanel'; panel.hidden = true;
  const header = document.createElement('div'); header.className = 'fan-quick-header';
  const title = document.createElement('strong'); title.textContent = '빠른 이동';
  const soundSettingsButton = document.createElement('button'); soundSettingsButton.type = 'button';
  soundSettingsButton.className = 'fan-quick-sound-settings';
  soundSettingsButton.setAttribute('aria-label', '효과음 볼륨 설정');
  soundSettingsButton.title = '효과음 볼륨 설정';
  soundSettingsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11"/></svg>';
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
  soundDescription.textContent = '버튼 클릭음, 저장음, 모달 열림음, 발바닥 닫기음의 크기를 함께 조절해요. 0%로 끌 수 있고, 이 브라우저에 저장돼요.';
  const soundVolumeRow = document.createElement('div'); soundVolumeRow.className = 'fan-sound-volume-row';
  const soundVolumeLabel = document.createElement('label'); soundVolumeLabel.htmlFor = 'fanButtonClickVolume';
  soundVolumeLabel.textContent = '효과음 볼륨';
  const soundVolumeValue = document.createElement('output'); soundVolumeValue.className = 'fan-sound-volume-value';
  soundVolumeValue.htmlFor = 'fanButtonClickVolume';
  const soundVolume = document.createElement('input'); soundVolume.type = 'range';
  soundVolume.id = 'fanButtonClickVolume'; soundVolume.className = 'fan-sound-volume-range';
  soundVolume.min = '0'; soundVolume.max = '100'; soundVolume.step = '5';
  soundVolume.value = String(buttonClickVolume);
  soundVolume.setAttribute('aria-label', '버튼 클릭, 저장, 모달 열림 및 발바닥 닫기 효과음 볼륨');
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
      document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!window.matchMedia('(min-width: 1280px)').matches) setExpanded(false);
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
  remote.append(toggle, panel); view.append(remote, soundDialog);

  let expanded = false;
  let scrollFrame = 0;
  let dragging = false;
  let remoteDrag = null;
  let resizeObserver = null;
  const positionStorageKey = 'streamerFanPage.quickRemotePosition';
  const isDesktop = () => window.matchMedia('(min-width: 1280px)').matches;
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
  syncDeviceMode();
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    header.removeEventListener('pointerdown', startRemoteDrag);
    header.removeEventListener('pointermove', moveRemoteDrag);
    header.removeEventListener('pointerup', finishRemoteDrag);
    header.removeEventListener('pointercancel', finishRemoteDrag);
    header.removeEventListener('lostpointercapture', finishRemoteDrag);
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

function createBannerSettingsEditor(field, labelText, sourceUrls) {
  const wrapper = document.createElement('div');
  wrapper.className = 'profile-editor-field profile-editor-wide banner-settings-editor';
  const heading = document.createElement('div'); heading.className = 'banner-settings-heading';
  const label = document.createElement('strong'); label.textContent = labelText;
  const add = document.createElement('button'); add.type = 'button'; add.className = 'button banner-settings-add'; add.textContent = '+ 이미지 추가';
  heading.append(label, add);
  const rows = document.createElement('div'); rows.className = 'banner-settings-rows';
  const urls = Array.isArray(sourceUrls) ? sourceUrls.filter((url) => typeof url === 'string').slice(0, MAX_BANNER_IMAGE_ITEMS) : [];
  const addRow = (value = '') => {
    if (rows.children.length >= MAX_BANNER_IMAGE_ITEMS) return;
    const row = document.createElement('div'); row.className = 'banner-settings-row';
    const input = document.createElement('input'); input.type = 'url'; input.maxLength = 2048;
    input.placeholder = 'https://이미지주소'; input.value = value; input.autocomplete = 'url'; input.setAttribute('aria-label', `${labelText} 이미지 주소`);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button banner-settings-remove';
    remove.textContent = '삭제'; remove.setAttribute('aria-label', `${labelText} 주소 삭제`);
    remove.addEventListener('click', () => row.remove());
    row.append(input, remove); rows.append(row);
    add.disabled = rows.children.length >= MAX_BANNER_IMAGE_ITEMS;
  };
  urls.forEach((url) => addRow(url));
  add.addEventListener('click', () => addRow());
  const note = document.createElement('small'); note.className = 'profile-editor-hint';
  note.textContent = `배너 규격은 약 2045×298px이며, 상단·하단 각각 최대 ${MAX_BANNER_IMAGE_ITEMS}개까지 등록할 수 있어요.`;
  wrapper.append(heading, rows, note);
  return {
    element: wrapper,
    values() { return [...rows.querySelectorAll('input')].map((input) => input.value.trim()).filter(Boolean); },
  };
}

function renderBannerSection(page, position) {
  const isTop = position === 'top';
  const field = isTop ? 'topBannerImageUrls' : 'bottomBannerImageUrls';
  const storedUrls = page.profile && page.profile[field];
  const urls = Array.isArray(storedUrls) ? storedUrls.map((url) => {
    try { return normalizeBannerImageUrl(url); } catch (_) { return ''; }
  }).filter(Boolean).slice(0, MAX_BANNER_IMAGE_ITEMS) : [];
  if (!urls.length) return null;

  const section = document.createElement('section');
  section.className = `fan-banner-section fan-banner-${position}`;
  section.id = `${position}BannerSection`;
  section.setAttribute('aria-label', `${page.streamer.nickname} ${isTop ? '상단' : '하단'} 배너`);
  const list = document.createElement('div'); list.className = 'fan-banner-list';
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
  const entries = Array.isArray(page.songbook) ? page.songbook : [];
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
    empty.textContent = page.isOwner ? '아직 등록한 노래가 없어요. YouTube 링크를 추가해 보세요.' : '아직 등록된 노래가 없어요.';
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
    currentPage.songbook = Array.isArray(result.songbook) ? result.songbook : [];
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
    currentPage.songbook = Array.isArray(result.songbook) ? result.songbook : [];
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
  if (state.loading) return;
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
    isLoading = true; errorMessage = ''; renderItems();
    try {
      const response = await callGallery({ streamerId: page.streamer.id });
      if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
      galleryData = response.data || { totalCount: 0, items: [] };
    } catch (error) {
      if (!currentPage || currentPage.streamer.id !== page.streamer.id) return;
      errorMessage = error.message || '갤러리를 불러오지 못했어요.';
    } finally {
      if (currentPage && currentPage.streamer.id === page.streamer.id) {
        isLoading = false;
        renderItems();
      }
    }
  }

  categories.forEach(({ id, label }) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab');
    button.dataset.category = id; button.textContent = label;
    button.addEventListener('click', () => { activeCategory = id; renderItems(); });
    tabs.append(button);
  });
  section.append(heading, tabs, status, grid);
  galleryLoadPromise = loadGallery();
  return section;
}

function renderCalendarSection(page) {
  const streamerId = page.streamer.id;
  const state = calendarStateFor(streamerId);
  const section = document.createElement('section');
  section.className = 'calendar-section content-card';
  section.id = 'calendarSection';

  const heading = document.createElement('div'); heading.className = 'calendar-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'STREAMER SCHEDULE';
  const title = document.createElement('h2'); title.textContent = '방송 일정';
  copy.append(eyebrow, title);
  if (page.isOwner) {
    const ownerHint = document.createElement('p'); ownerHint.className = 'calendar-owner-hint';
    ownerHint.textContent = '날짜를 더블 클릭해 해당 날짜에 일정을 추가할 수 있어요.';
    copy.append(ownerHint);
  }
  const controls = document.createElement('div'); controls.className = 'calendar-controls';
  const mode = document.createElement('div'); mode.className = 'calendar-mode-switch'; mode.setAttribute('role', 'group'); mode.setAttribute('aria-label', '캘린더 보기');
  [['month', '월간'], ['week', '주간']].forEach(([value, label]) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `calendar-mode-button${state.view === value ? ' is-active' : ''}`;
    button.setAttribute('aria-pressed', String(state.view === value)); button.textContent = label;
    button.addEventListener('click', () => {
      if (state.view === value) return;
      state.view = value;
      state.error = '';
      state.days = []; state.fetchedAt = null; state.stale = false;
      refreshCalendarSection(streamerId);
      loadCalendar(streamerId);
    });
    mode.append(button);
  });
  const navigation = document.createElement('div'); navigation.className = 'calendar-navigation';
  const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'calendar-nav-button';
  previous.setAttribute('aria-label', '이전 기간'); previous.textContent = '‹';
  previous.addEventListener('click', () => shiftCalendar(streamerId, -1));
  const period = document.createElement('strong'); period.className = 'calendar-period'; period.textContent = calendarPeriodLabel(state);
  const next = document.createElement('button'); next.type = 'button'; next.className = 'calendar-nav-button';
  next.setAttribute('aria-label', '다음 기간'); next.textContent = '›';
  next.addEventListener('click', () => shiftCalendar(streamerId, 1));
  navigation.append(previous, period, next);
  const today = document.createElement('button'); today.type = 'button'; today.className = 'calendar-today-button'; today.textContent = '오늘';
  today.addEventListener('click', () => {
    const now = new Date(); state.selectedDate = localDateKey(now); state.year = now.getFullYear(); state.month = now.getMonth() + 1; state.error = '';
    state.days = []; state.fetchedAt = null; state.stale = false;
    refreshCalendarSection(streamerId); loadCalendar(streamerId);
  });
  if (page.isOwner) {
    const addSchedule = document.createElement('button'); addSchedule.type = 'button';
    addSchedule.className = 'button button-primary calendar-add-button'; addSchedule.textContent = '＋ 일정 추가';
    addSchedule.addEventListener('click', () => openFanPageScheduleDialog(state.selectedDate));
    controls.append(mode, navigation, today, addSchedule);
  } else controls.append(mode, navigation, today);
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'calendar-refresh-button';
  refresh.disabled = state.loading; refresh.setAttribute('aria-label', '일정 새로고침'); refresh.textContent = state.loading ? '불러오는 중…' : '↻ 새로고침';
  refresh.addEventListener('click', () => loadCalendar(streamerId, true));
  controls.append(refresh);
  heading.append(copy, controls);

  const legend = document.createElement('div'); legend.className = 'calendar-legend';
  ['방송', '방송예정', '합방', '휴방', '기타'].forEach((label, index) => {
    const item = document.createElement('span'); item.className = `calendar-legend-item calendar-type-${index + 1}`;
    const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true');
    item.append(dot, document.createTextNode(label)); legend.append(item);
  });
  [['SOOP 일정', 'soop'], ['팬페이지 일정', 'fanpage']].forEach(([label, source]) => {
    const item = document.createElement('span'); item.className = `calendar-legend-item calendar-source-key calendar-source-${source}`;
    const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true');
    item.append(dot, document.createTextNode(label)); legend.append(item);
  });

  const grid = document.createElement('div'); grid.className = `calendar-grid${state.view === 'week' ? ' is-week-view' : ''}`;
  grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', `${calendarPeriodLabel(state)} 방송 일정`);
  ['일', '월', '화', '수', '목', '금', '토'].forEach((label) => {
    const dayName = document.createElement('div'); dayName.className = 'calendar-weekday'; dayName.setAttribute('role', 'columnheader'); dayName.textContent = label;
    grid.append(dayName);
  });
  const selected = parseLocalDateKey(state.selectedDate);
  const first = state.view === 'week'
    ? calendarWeekStart(selected)
    : calendarWeekStart(new Date(state.year, state.month - 1, 1));
  const cellCount = state.view === 'week' ? 7 : 42;
  const eventsByDate = new Map((state.days || []).map((item) => [item.date, item.events || []]));
  for (let index = 0; index < cellCount; index += 1) {
    const date = new Date(first); date.setDate(first.getDate() + index);
    const dateKey = localDateKey(date);
    const events = eventsByDate.get(dateKey) || [];
    const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'calendar-day';
    if (page.isOwner) cell.classList.add('calendar-day-can-add');
    if (state.view === 'month' && date.getMonth() + 1 !== state.month) cell.classList.add('is-outside-month');
    if (dateKey === localDateKey(new Date())) cell.classList.add('is-today');
    if (dateKey === state.selectedDate) cell.classList.add('is-selected');
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `${date.getMonth() + 1}월 ${date.getDate()}일, 일정 ${events.length}개${page.isOwner ? ', 더블 클릭하여 일정 추가' : ''}`);
    if (page.isOwner) cell.title = '더블 클릭하여 이 날짜에 일정 추가';
    let dayClickTimer = 0;
    cell.addEventListener('click', () => {
      if (!page.isOwner) {
        selectCalendarDate(streamerId, state, date);
        return;
      }
      window.clearTimeout(dayClickTimer);
      dayClickTimer = window.setTimeout(() => selectCalendarDate(streamerId, state, date), 360);
    });
    if (page.isOwner) {
      cell.addEventListener('dblclick', (event) => {
        event.preventDefault();
        window.clearTimeout(dayClickTimer);
        selectCalendarDate(streamerId, state, date);
        openFanPageScheduleDialog(dateKey);
      });
    }
    const number = document.createElement('span'); number.className = 'calendar-day-number'; number.textContent = String(date.getDate()); cell.append(number);
    const eventList = document.createElement('span'); eventList.className = 'calendar-day-events';
    events.slice(0, state.view === 'week' ? 3 : 2).forEach((event) => {
      const chip = document.createElement('span');
      chip.className = event.source === 'fanpage'
        ? 'calendar-event-chip calendar-source-fanpage'
        : `calendar-event-chip calendar-type-${Math.max(1, Math.min(5, Number(event.type) || 5))}`;
      chip.textContent = event.title || event.typeName || '방송 일정';
      eventList.append(chip);
    });
    if (events.length > (state.view === 'week' ? 3 : 2)) {
      const more = document.createElement('span'); more.className = 'calendar-more-count'; more.textContent = `+${events.length - (state.view === 'week' ? 3 : 2)}개`;
      eventList.append(more);
    }
    cell.append(eventList); grid.append(cell);
  }

  const selectedEvents = eventsByDate.get(state.selectedDate) || [];
  const detail = document.createElement('div'); detail.className = 'calendar-day-detail';
  const detailHeading = document.createElement('div'); detailHeading.className = 'calendar-detail-heading';
  const detailTitle = document.createElement('h3');
  detailTitle.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(selected);
  const updateNote = document.createElement('span'); updateNote.className = `calendar-update-note${state.stale ? ' is-stale' : ''}`;
  updateNote.textContent = state.stale
    ? '저장된 일정 표시 중'
    : state.fetchedAt ? `갱신 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(state.fetchedAt))}` : '';
  detailHeading.append(detailTitle, updateNote); detail.append(detailHeading);

  if (state.loading) {
    const status = document.createElement('p'); status.className = 'calendar-state-message is-loading'; status.textContent = '방송 일정을 불러오고 있어요.'; detail.append(status);
  } else if (state.error) {
    const status = document.createElement('p'); status.className = 'calendar-state-message'; status.textContent = state.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button calendar-retry-button'; retry.textContent = '다시 시도'; retry.addEventListener('click', () => loadCalendar(streamerId, true));
    detail.append(status, retry);
  } else if (!selectedEvents.length) {
    const empty = document.createElement('p'); empty.className = 'calendar-empty-state'; empty.textContent = '이 날짜에 등록된 일정이 없어요.'; detail.append(empty);
  } else {
    const list = document.createElement('div'); list.className = 'calendar-event-list';
    selectedEvents.forEach((event) => {
      const row = document.createElement('article'); row.className = 'calendar-event-row';
      const time = document.createElement('time'); time.className = 'calendar-event-time'; time.textContent = event.time || '시간 미정';
      const body = document.createElement('div'); body.className = 'calendar-event-body';
      const eventTitle = document.createElement('strong'); eventTitle.textContent = event.title || '방송 일정';
      const badges = document.createElement('span'); badges.className = 'calendar-event-badges';
      const source = document.createElement('span'); source.className = `calendar-source-badge calendar-source-${event.source === 'fanpage' ? 'fanpage' : 'soop'}`;
      source.textContent = event.source === 'fanpage' ? '팬페이지' : 'SOOP';
      const category = document.createElement('span');
      category.className = event.source === 'fanpage'
        ? 'calendar-event-category calendar-source-fanpage'
        : `calendar-event-category calendar-type-${Math.max(1, Math.min(5, Number(event.type) || 5))}`;
      category.textContent = event.typeName || '일정';
      badges.append(source, category); body.append(eventTitle, badges); row.append(time, body);
      if (page.isOwner && event.source === 'fanpage') {
        const remove = document.createElement('button'); remove.type = 'button';
        remove.className = 'calendar-event-delete-button'; remove.textContent = '삭제';
        remove.setAttribute('aria-label', `팬페이지 일정 삭제: ${event.title || '일정'}`);
        remove.addEventListener('click', () => deleteFanPageSchedule(page, event, remove));
        row.append(remove);
      }
      list.append(row);
    });
    detail.append(list);
  }
  section.append(heading, legend, grid, detail);
  return section;
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

function refreshCalendarSection(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('calendarSection');
  if (section) section.replaceWith(renderCalendarSection(currentPage));
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
  const note = document.createElement('p'); note.textContent = '플레이어가 표시되지 않거나 재생되지 않으면 SOOP에서 열어 주세요.';
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
  $('vodPlayerFrame').src = `https://vod.sooplive.com/player/${id}/embed?autoPlay=false&mutePlay=true&showChat=true`;
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
  const heading = document.createElement('div'); heading.className = 'vod-player-heading';
  const title = document.createElement('h2'); title.id = 'youtubePlayerTitle'; title.textContent = 'YouTube 영상';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close';
  close.setAttribute('aria-label', 'YouTube 플레이어 닫기'); close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  heading.append(title, close);
  const frame = document.createElement('div'); frame.className = 'vod-player-frame';
  const iframe = document.createElement('iframe'); iframe.id = 'youtubePlayerFrame'; iframe.title = 'YouTube 영상 플레이어';
  iframe.src = 'about:blank';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.append(iframe);
  const footer = document.createElement('div'); footer.className = 'vod-player-footer';
  const note = document.createElement('p'); note.textContent = '영상은 YouTube 공식 플레이어로 재생돼요. 외부 재생이 제한된 영상은 YouTube에서 열어 주세요.';
  const link = document.createElement('a'); link.id = 'youtubePlayerExternalLink'; link.className = 'button button-primary';
  link.href = 'https://www.youtube.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'YouTube에서 열기 ↗';
  footer.append(note, link); card.append(heading, frame, footer); dialog.append(card);
  dialog.addEventListener('close', () => { iframe.src = 'about:blank'; });
  return dialog;
}

function openYouTubePlayer(video) {
  if (!video || !/^[A-Za-z0-9_-]{11}$/.test(String(video.id || ''))) return;
  const id = encodeURIComponent(video.id);
  $('youtubePlayerTitle').textContent = video.title || 'YouTube 영상';
  $('youtubePlayerExternalLink').href = `https://www.youtube.com/watch?v=${id}`;
  $('youtubePlayerFrame').src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
  showFanPageModal($('youtubePlayerDialog'));
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
    renderList($('searchResults'), result.data.streamers);
    hint.textContent = result.data.streamers.length ? `검색 결과 ${result.data.streamers.length}명` : '일치하는 인증 스트리머를 찾지 못했어요.';
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
  galleryLoadPromise = Promise.resolve();
  $('startupCover').classList.remove('is-error');
  $('startupCover').classList.remove('is-not-found');
  $('retryButton').classList.add('hidden');
  $('retryButton').textContent = '다시 불러오기';
  $('startupTitle').textContent = '페이지를 준비하고 있어요';
  $('startupMessage').textContent = '로그인 상태와 인증된 스트리머 정보를 확인하고 있습니다.';
  try {
    if (!await waitForAuthRestore()) await signInAnonymously(auth);
    let requestedId = routeId();
    let result = (await callBootstrap({ streamerId: requestedId })).data;
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
    const recentPromise = callRecent().then((value) => value.data.streamers);
    if (!requestedId) {
      const recent = await recentPromise;
      renderList($('recentPages'), recent, true, '최근 방문한 팬페이지가 여기에 표시돼요.');
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
      const recent = await recentPromise;
      renderList($('recentPages'), recent, true, '최근 방문한 팬페이지가 여기에 표시돼요.');
    }
    await Promise.all([waitForPageAssets(), galleryLoadPromise]);
    $('startupCover').classList.add('hidden');
    $('siteShell').setAttribute('aria-hidden', 'false');
    $('siteShell').classList.add('is-ready');
    if (new URLSearchParams(location.search).get('login') === '1') {
      const loginUrl = new URL(location.href);
      loginUrl.searchParams.delete('login');
      history.replaceState(null, '', loginUrl.href);
      if (auth.currentUser && auth.currentUser.isAnonymous
        && localStorage.getItem(KAKAO_LINKED_UID_KEY) !== auth.currentUser.uid
        && verifiedStreamerUid !== auth.currentUser.uid) {
        window.setTimeout(() => showFanPageModal($('loginChoiceDialog')), 120);
      }
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
});
$('closeAdminStats').addEventListener('click', () => $('adminStatsDialog').close());
$('refreshAdminStats').addEventListener('click', loadAdminStats);
$('refreshDesignFeedback').addEventListener('click', loadAdminDesignFeedback);
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
      setTimeout(() => location.reload(), 500);
      return;
    }
    if (result.action === 'switch') {
      status.textContent = '이미 인증된 계정이 확인됐어요.';
      if (await confirmAccountSwitch()) {
        await signInWithCustomToken(auth, result.customToken);
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
