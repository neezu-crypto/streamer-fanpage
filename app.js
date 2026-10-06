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
const callSave = httpsCallable(functions, 'streamerFanPageSave');
const callVodPage = httpsCallable(functions, 'streamerFanPageVodPage');
const callVodRefresh = httpsCallable(functions, 'streamerFanPageVodRefresh', { timeout: 3600000 });
const callCalendar = httpsCallable(functions, 'streamerFanPageCalendar');
const callLiveStatus = httpsCallable(functions, 'streamerFanPageLiveStatus');
const callScheduleAdd = httpsCallable(functions, 'streamerFanPageScheduleAdd');
const callScheduleDelete = httpsCallable(functions, 'streamerFanPageScheduleDelete');
// 로그인 연결은 시리즈의 공유 Firebase Functions callable을 사용한다.
const callLinkGoogle = httpsCallable(functions, 'linkGoogleAccount');
const callLinkKakao = httpsCallable(functions, 'linkKakaoAccount');
const callStreamerVerification = httpsCallable(functions, 'requestStreamerVerification');
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
const KAKAO_LINKED_UID_KEY = 'streamerFanPage.kakaoLinkedUid';
const $ = (id) => document.getElementById(id);
let currentPage = null;
let searchTimer = 0;
let toastTimer = 0;
let liveStatusTimer = 0;
let verifiedStreamerUid = '';
let verifiedStatusUnsubscribe = null;
let switchApprovalUnsubscribe = null;
let switchHandoffInProgress = false;
const vodRefreshesInProgress = new Set();
const vodPageLoadsInProgress = new Set();
const calendarStates = new Map();
const liveStatusStates = new Map();

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
  $('openLoginOptions').classList.toggle('hidden', !!(user && (!user.isAnonymous || kakaoLinked || streamerVerified)));
  $('choiceGoogleLogin').classList.toggle('hidden', googleLinked);
  $('choiceGoogleLogin').textContent = user && !user.isAnonymous ? 'Google 계정 연결' : 'Google로 로그인';
  $('choiceKakaoLogin').classList.toggle('hidden', kakaoLinked);
  $('choiceKakaoLogin').textContent = user && !user.isAnonymous ? '카카오 계정 연결' : '카카오로 로그인';
  $('logoutButton').classList.toggle('hidden', !user || (user.isAnonymous && !kakaoLinked && !streamerVerified));
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
  switchHandoffInProgress = false;
  renderAuthControls();
  if (!user) return;

  let hasInitialVerifiedValue = false;
  let previousVerifiedValue = false;
  verifiedStatusUnsubscribe = onValue(ref(db, `users/${user.uid}/streamerVerified`), (snapshot) => {
    if (auth.currentUser?.uid !== user.uid) return;
    const verified = snapshot.val() === true;
    verifiedStreamerUid = verified ? user.uid : '';
    renderAuthControls();
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
    dialog.showModal();
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
  if (!page && liveStatusTimer) {
    window.clearInterval(liveStatusTimer);
    liveStatusTimer = 0;
  }
  $('homeView').classList.toggle('hidden', !!page);
  $('fanPageView').classList.toggle('hidden', !page);
  $('devbar').classList.toggle('hidden', !!page);
  $('brandEyebrow').classList.toggle('hidden', !!page);
  const pageName = page ? `${page.streamer.nickname} 팬페이지` : '스트리머 팬페이지';
  $('brandTitle').textContent = pageName;
  document.title = pageName;
  if (page) renderFanPage(page);
}
function renderFanPage(page) {
  if (liveStatusTimer) window.clearInterval(liveStatusTimer);
  liveStatusTimer = 0;
  currentPage = page;
  const view = $('fanPageView');
  view.replaceChildren();
  const back = document.createElement('a');
  back.href = '#/';
  back.className = 'back-link';
  back.innerHTML = '<span aria-hidden="true">←</span> 스트리머 검색으로';
  const profile = page.profile || {};
  const section = document.createElement('section');
  section.className = 'profile-board';
  const label = document.createElement('div');
  label.className = 'profile-tab';
  label.innerHTML = 'PROFILE <span aria-hidden="true">💗🖊</span>';
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
    ['생일', profile.birthday], ['MBTI', profile.mbti],
    ['전공', profile.major], ['데뷔', profile.debutDate],
  ];
  factRows.forEach(([key, value]) => {
    const row = document.createElement('div'); row.className = 'profile-fact';
    const term = document.createElement('span'); term.textContent = key;
    const description = document.createElement('strong'); description.textContent = value || '미등록';
    row.append(term, description); facts.append(row);
  });

  let about = null;
  if (page.intro) {
    about = document.createElement('div'); about.className = 'profile-about';
    const aboutLabel = document.createElement('strong'); aboutLabel.textContent = 'ABOUT';
    const aboutText = document.createElement('span'); aboutText.textContent = page.intro;
    about.append(aboutLabel, aboutText);
  }

  const details = document.createElement('div'); details.className = 'profile-details';
  const detailRows = [
    ['팬닉', profile.fanNickname], ['팬덤명', profile.fandomName],
    ['콘텐츠', Array.isArray(profile.contents) ? profile.contents.join(' · ') : ''], ['방송 시간', profile.scheduleText],
  ];
  detailRows.forEach(([key, value]) => {
    const item = document.createElement('div'); item.className = 'profile-detail';
    const term = document.createElement('span'); term.className = 'profile-detail-label'; term.textContent = key;
    const description = document.createElement('span'); description.className = 'profile-detail-value'; description.textContent = value || '미등록';
    item.append(term, description); details.append(item);
  });

  const actions = document.createElement('div'); actions.className = 'profile-actions';
  const soop = document.createElement('a');
  soop.className = 'button'; soop.href = page.streamer.soopUrl; soop.target = '_blank';
  soop.rel = 'noopener noreferrer'; soop.textContent = 'SOOP 방송국 ↗';
  actions.append(soop);
  if (profile.rouletteUrl) {
    const roulette = document.createElement('a');
    roulette.className = 'button button-primary'; roulette.href = profile.rouletteUrl;
    roulette.target = '_blank'; roulette.rel = 'noopener noreferrer'; roulette.textContent = '룰렛 확률 ↗';
    actions.append(roulette);
  }
  if (page.isOwner) {
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button'; edit.textContent = '⚙ 설정';
    edit.addEventListener('click', () => $('profileSettingsDialog').showModal());
    actions.append(edit);
  }
  section.append(label, identity, facts);
  if (about) section.append(about);
  section.append(details, actions);
  if (!page.isOwner) view.append(back);
  view.append(section);
  view.append(renderLiveSection(page));
  view.append(renderVodSection(page));
  view.append(renderCalendarSection(page));
  if (page.isOwner) view.append(renderFanPageScheduleDialog(page));
  view.append(renderVodPlayerDialog());
  loadLiveStatus(page.streamer.id);
  liveStatusTimer = window.setInterval(() => loadLiveStatus(page.streamer.id), 60 * 1000);
  loadCalendar(page.streamer.id);

  if (page.isOwner) {
    const editorDialog = document.createElement('dialog');
    editorDialog.id = 'profileSettingsDialog'; editorDialog.className = 'account-dialog profile-settings-dialog';
    const editor = document.createElement('div'); editor.className = 'account-dialog-card profile-editor';
    const headingRow = document.createElement('div'); headingRow.className = 'profile-editor-heading';
    const heading = document.createElement('h2'); heading.textContent = '팬페이지 설정';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'button profile-settings-close'; close.setAttribute('aria-label', '설정 닫기'); close.textContent = '×';
    close.addEventListener('click', () => editorDialog.close());
    headingRow.append(heading, close); editor.append(headingRow);
    const fields = [
      ['birthday', '생일', 20], ['mbti', 'MBTI', 8], ['major', '전공', 50], ['debutDate', '데뷔일', 20],
      ['fanNickname', '팬닉', 30], ['fandomName', '팬덤명', 30], ['contents', '콘텐츠 (쉼표로 구분)', 160],
      ['scheduleText', '방송 시간', 120], ['rouletteUrl', '룰렛 확률 링크', 300],
    ];
    const inputMap = {};
    const grid = document.createElement('div'); grid.className = 'profile-editor-grid';
    fields.forEach(([key, labelText, maxLength]) => {
      const wrapper = document.createElement('label'); wrapper.className = 'profile-editor-field'; wrapper.textContent = labelText;
      const input = key === 'scheduleText' ? document.createElement('textarea') : document.createElement('input');
      input.name = key; input.maxLength = maxLength;
      if (key === 'rouletteUrl') { input.type = 'url'; input.placeholder = 'https://'; }
      input.value = key === 'contents' ? (profile.contents || []).join(', ') : (profile[key] || '');
      wrapper.append(input);
      if (key === 'rouletteUrl') {
        const hint = document.createElement('small');
        hint.className = 'profile-editor-hint';
        hint.textContent = '주소를 입력하면 버튼이 표시되고, 비워두면 숨겨집니다.';
        wrapper.append(hint);
      }
      grid.append(wrapper); inputMap[key] = input;
    });
    const introLabel = document.createElement('label'); introLabel.className = 'profile-editor-field profile-editor-wide'; introLabel.textContent = 'ABOUT 문구';
    const introInput = document.createElement('textarea'); introInput.maxLength = 700; introInput.value = page.intro || '';
    introLabel.append(introInput); grid.append(introLabel);
    const footer = document.createElement('div'); footer.className = 'edit-footer profile-editor-footer';
    const note = document.createElement('small'); note.textContent = '수정 내용은 서버에 저장됩니다.';
    const footerActions = document.createElement('div'); footerActions.className = 'profile-editor-footer-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.textContent = '취소';
    cancel.addEventListener('click', () => editorDialog.close());
    const save = document.createElement('button'); save.type = 'button'; save.className = 'button button-primary'; save.textContent = '프로필 저장';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const value = (key) => inputMap[key].value.trim();
        const result = await callSave({
          streamerId: currentPage.streamer.id,
          intro: introInput.value,
          profile: {
            birthday: value('birthday'), mbti: value('mbti'), major: value('major'), debutDate: value('debutDate'),
            fanNickname: value('fanNickname'), fandomName: value('fandomName'),
            contents: value('contents').split(',').map((item) => item.trim()).filter(Boolean),
            scheduleText: value('scheduleText'), rouletteUrl: value('rouletteUrl'),
          },
        });
        currentPage.intro = result.data.page.intro;
        currentPage.profile = result.data.page.profile;
        editorDialog.close();
        renderFanPage(currentPage);
        showToast('프로필을 저장했어요.');
      } catch (error) { showToast(error.message || '저장하지 못했어요.'); }
      finally { save.disabled = false; }
    });
    footerActions.append(cancel, save);
    footer.append(note, footerActions); editor.append(grid, footer); editorDialog.append(editor);
    editorDialog.addEventListener('click', (event) => { if (event.target === editorDialog) editorDialog.close(); });
    view.append(editorDialog);
  }
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
    ? page.vods
    : { items: [], total: 0, refreshedAt: null, generation: '', nextOffset: 0, hasMore: false };
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
    refresh.textContent = isRefreshing ? '전체 목록을 불러오는 중…' : isLoadingMore ? '목록을 불러오는 중…' : '↻ 전체 목록 갱신';
    refresh.disabled = isRefreshing || isLoadingMore;
    refresh.addEventListener('click', async () => {
      if (vodRefreshesInProgress.has(streamerId) || vodPageLoadsInProgress.has(streamerId)) return;
      vodRefreshesInProgress.add(streamerId);
      refresh.disabled = true;
      refresh.textContent = '전체 목록을 불러오는 중…';
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
          showToast(`다시보기 ${page.vods.total.toLocaleString('ko-KR')}개를 갱신했어요.`);
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

  if (!vods.items.length) {
    const empty = document.createElement('p'); empty.className = 'vod-empty-state';
    empty.textContent = page.isOwner
      ? '전체 목록 갱신을 눌러 SOOP 다시보기를 가져오세요.'
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
    more.textContent = loading ? '목록을 불러오는 중…' : refreshing ? '전체 목록 갱신 중…' : `더 보기 (${Math.max(0, vods.total - vods.items.length).toLocaleString('ko-KR')}개 남음)`;
    more.addEventListener('click', () => loadMoreVods(streamerId, vods));
    moreRow.append(more); scrollbox.append(moreRow);
  }
  section.append(scrollbox);
  return section;
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
    if (state.view === 'month' && date.getMonth() + 1 !== state.month) cell.classList.add('is-outside-month');
    if (dateKey === localDateKey(new Date())) cell.classList.add('is-today');
    if (dateKey === state.selectedDate) cell.classList.add('is-selected');
    cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', `${date.getMonth() + 1}월 ${date.getDate()}일, 일정 ${events.length}개`);
    cell.addEventListener('click', () => {
      const changesMonth = state.view === 'month' && (date.getFullYear() !== state.year || date.getMonth() + 1 !== state.month);
      state.selectedDate = dateKey;
      state.year = date.getFullYear(); state.month = date.getMonth() + 1;
      if (changesMonth) {
        state.error = ''; state.days = []; state.fetchedAt = null; state.stale = false;
        refreshCalendarSection(streamerId); loadCalendar(streamerId);
      } else refreshCalendarSection(streamerId);
    });
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
  dialog.showModal();
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
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
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
  const frame = document.createElement('div'); frame.className = 'vod-player-frame';
  const iframe = document.createElement('iframe'); iframe.id = 'vodPlayerFrame'; iframe.title = 'SOOP 다시보기 플레이어';
  iframe.src = 'about:blank'; iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.append(iframe);
  const footer = document.createElement('div'); footer.className = 'vod-player-footer';
  const note = document.createElement('p'); note.textContent = '플레이어가 표시되지 않거나 재생되지 않으면 SOOP에서 열어 주세요.';
  const link = document.createElement('a'); link.id = 'vodPlayerExternalLink'; link.className = 'button button-primary';
  link.href = 'https://vod.sooplive.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'SOOP에서 열기 ↗';
  footer.append(note, link); card.append(heading, frame, footer); dialog.append(card);
  dialog.addEventListener('close', () => { iframe.src = 'about:blank'; });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  return dialog;
}

function openVodPlayer(vod) {
  if (!/^\d{1,20}$/.test(String(vod && vod.id || ''))) return;
  const id = encodeURIComponent(vod.id);
  $('vodPlayerTitle').textContent = vod.title || '방송 다시보기';
  $('vodPlayerExternalLink').href = `https://vod.sooplive.com/player/${id}`;
  $('vodPlayerFrame').src = `https://vod.sooplive.com/player/${id}/embed?autoPlay=false&mutePlay=true&showChat=false`;
  $('vodPlayerDialog').showModal();
}

function replaceVodSectionIfCurrent(streamerId) {
  if (!currentPage || currentPage.streamer.id !== streamerId) return;
  const section = $('vodSection');
  if (section) section.replaceWith(renderVodSection(currentPage));
}

async function loadMoreVods(streamerId, currentVods) {
  if (vodPageLoadsInProgress.has(streamerId) || vodRefreshesInProgress.has(streamerId)) return;
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
    currentPage.vods = {
      ...nextPage,
      items: [...currentPage.vods.items, ...addedItems],
      nextOffset: nextPage.nextOffset,
      hasMore: nextPage.hasMore,
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
  $('startupCover').classList.add('is-error');
  $('startupTitle').textContent = '페이지를 불러오지 못했어요';
  $('startupMessage').textContent = error && error.message ? error.message : '연결 상태를 확인한 뒤 다시 시도해 주세요.';
  $('retryButton').classList.remove('hidden');
}
async function loadApp() {
  $('startupCover').classList.remove('is-error');
  $('retryButton').classList.add('hidden');
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
    verifiedStreamerUid = result.verifiedStreamer ? auth.currentUser.uid : '';
    renderAuthControls();
    if (requestedId && !result.page) throw new Error('팬페이지를 찾을 수 없습니다.');
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
      // 관리자는 서버가 권한을 확인한 경우에만 소유자 화면과 같은 설정 UI를 본다.
      page.isOwner = (!!result.verifiedStreamer && result.verifiedStreamer.id === page.streamer.id)
        || result.isAdmin === true;
      setVisibleView(page);
      const recent = await recentPromise;
      renderList($('recentPages'), recent, true, '최근 방문한 팬페이지가 여기에 표시돼요.');
    }
    await waitForPageAssets();
    $('startupCover').classList.add('hidden');
    $('siteShell').setAttribute('aria-hidden', 'false');
    $('siteShell').classList.add('is-ready');
  } catch (error) { showStartupError(error); }
}
$('retryButton').addEventListener('click', loadApp);
$('openLoginOptions').addEventListener('click', () => $('loginChoiceDialog').showModal());
$('closeLoginChoices').addEventListener('click', () => $('loginChoiceDialog').close());
$('choiceGoogleLogin').addEventListener('click', () => { $('loginChoiceDialog').close(); loginWithGoogle(); });
$('choiceKakaoLogin').addEventListener('click', () => { $('loginChoiceDialog').close(); loginWithKakao(); });
$('openStreamerVerification').addEventListener('click', () => {
  $('loginChoiceDialog').close();
  $('streamerVerifyDialog').showModal();
});
$('closeStreamerVerification').addEventListener('click', () => $('streamerVerifyDialog').close());
$('checkStreamerVerification').addEventListener('click', () => submitOrCheckStreamerVerification(true));
$('renewVerificationCode').addEventListener('click', () => submitOrCheckStreamerVerification(false, true));
$('streamerVerificationForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submitOrCheckStreamerVerification(false);
});
$('logoutButton').addEventListener('click', logout);
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
      note.hidden = !!result.isSwitch;
      if (!result.isSwitch) {
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
      status.textContent = checkOnly
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
