import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithPopup, signInWithCustomToken, linkWithPopup, signOut, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

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
const functions = getFunctions(app, 'us-central1');
const callBootstrap = httpsCallable(functions, 'streamerFanPageBootstrap');
const callSearch = httpsCallable(functions, 'streamerFanPageSearch');
const callRecent = httpsCallable(functions, 'streamerFanPageRecent');
const callSave = httpsCallable(functions, 'streamerFanPageSave');
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

if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init('ed4f01d6903ca41d5dc0ab32b6ae143c');

function renderAuthControls() {
  const user = auth.currentUser;
  const googleLinked = !!(user && user.providerData.some((provider) => provider.providerId === 'google.com'));
  const kakaoLinked = !!(user && localStorage.getItem(KAKAO_LINKED_UID_KEY) === user.uid);
  $('accountStatus').textContent = !user
    ? '로그인 확인 중'
    : user.isAnonymous && !kakaoLinked
      ? '게스트 이용 중'
      : googleLinked
        ? 'Google 계정 연결됨'
        : '카카오 계정 연결됨';
  $('googleLoginButton').classList.toggle('hidden', googleLinked);
  $('googleLoginButton').textContent = user && !user.isAnonymous ? 'Google 연결' : 'Google 로그인';
  $('kakaoLoginButton').textContent = user && !user.isAnonymous ? '카카오 연결' : '카카오 로그인';
  $('choiceGoogleLogin').classList.toggle('hidden', googleLinked);
  $('choiceGoogleLogin').textContent = user && !user.isAnonymous ? 'Google 계정 연결' : 'Google로 로그인';
  $('choiceKakaoLogin').classList.toggle('hidden', kakaoLinked);
  $('choiceKakaoLogin').textContent = user && !user.isAnonymous ? '카카오 계정 연결' : '카카오로 로그인';
  $('logoutButton').classList.toggle('hidden', !user || (user.isAnonymous && !kakaoLinked));
}

onAuthStateChanged(auth, renderAuthControls);

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
  const button = $('googleLoginButton');
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
  const button = $('kakaoLoginButton');
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
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const images = [...document.querySelectorAll('#mainContent img')];
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
}
function setVisibleView(page) {
  $('homeView').classList.toggle('hidden', !!page);
  $('fanPageView').classList.toggle('hidden', !page);
  if (page) renderFanPage(page);
}
function renderFanPage(page) {
  currentPage = page;
  const view = $('fanPageView');
  view.replaceChildren();
  const back = document.createElement('a');
  back.href = '#/';
  back.className = 'back-link';
  back.innerHTML = '<span aria-hidden="true">←</span> 스트리머 검색으로';
  const hero = document.createElement('section');
  hero.className = 'fan-hero';
  const identity = document.createElement('div');
  identity.className = 'fan-identity';
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  setImage(avatar, page.streamer.avatarUrl, page.streamer.nickname);
  const info = document.createElement('div');
  const name = document.createElement('h1');
  name.className = 'fan-name';
  name.textContent = page.streamer.nickname;
  const handle = document.createElement('div');
  handle.className = 'fan-id';
  handle.textContent = `SOOP · ${page.streamer.soopId}`;
  const verified = document.createElement('span');
  verified.className = 'verified-tag';
  verified.textContent = '✓ 인증 스트리머';
  info.append(name, handle, verified);
  identity.append(avatar, info);
  const actions = document.createElement('div');
  actions.className = 'fan-hero-actions';
  const soop = document.createElement('a');
  soop.className = 'button'; soop.href = page.streamer.soopUrl;
  soop.target = '_blank'; soop.rel = 'noopener noreferrer'; soop.textContent = '방송국 방문 ↗';
  actions.append(soop);
  if (page.isOwner) {
    const edit = document.createElement('a');
    edit.className = 'button button-primary'; edit.href = '#editIntro'; edit.textContent = '페이지 소개 수정';
    actions.append(edit);
  }
  hero.append(identity, actions);

  const body = document.createElement('div');
  body.className = 'fan-body';
  const introCard = document.createElement('section');
  introCard.className = 'content-card';
  const title = document.createElement('h2'); title.textContent = '팬페이지';
  const intro = document.createElement('p'); intro.className = page.intro ? 'intro-copy' : 'intro-copy intro-empty';
  intro.textContent = page.intro || (page.isOwner ? '팬들에게 전할 인사말을 적어보세요.' : '팬페이지 소개가 아직 등록되지 않았어요.');
  introCard.append(title, intro);
  const side = document.createElement('aside'); side.className = 'content-card side-card';
  const sideTitle = document.createElement('h2'); sideTitle.textContent = '함께 응원해요';
  const sideCopy = document.createElement('p'); sideCopy.textContent = '스트리머의 방송 일정과 소식은 공식 방송국에서 확인할 수 있어요.';
  side.append(sideTitle, sideCopy);
  const fanBody = document.createElement('p'); fanBody.textContent = '이 페이지는 인증된 스트리머가 직접 관리합니다.'; side.append(fanBody);
  body.append(introCard, side);
  view.append(back, hero, body);

  if (page.isOwner) {
    const editor = document.createElement('section');
    editor.id = 'editIntro'; editor.className = 'content-card edit-panel';
    const label = document.createElement('label'); label.htmlFor = 'introInput'; label.textContent = '팬들에게 전하는 소개';
    const textarea = document.createElement('textarea'); textarea.id = 'introInput'; textarea.maxLength = 700; textarea.placeholder = '팬들에게 전하고 싶은 인사말이나 페이지 소개를 적어주세요.'; textarea.value = page.intro || '';
    const footer = document.createElement('div'); footer.className = 'edit-footer';
    const count = document.createElement('small'); count.textContent = `${textarea.value.length} / 700`;
    textarea.addEventListener('input', () => { count.textContent = `${textarea.value.length} / 700`; });
    const save = document.createElement('button'); save.type = 'button'; save.className = 'button button-primary'; save.textContent = '소개 저장';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const result = await callSave({ intro: textarea.value });
        currentPage.intro = result.data.page.intro;
        renderFanPage(currentPage);
        showToast('팬페이지 소개를 저장했어요.');
      } catch (error) { showToast(error.message || '저장하지 못했어요.'); }
      finally { save.disabled = false; }
    });
    footer.append(count, save); editor.append(label, textarea, footer); view.append(editor);
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
      page.isOwner = !!result.verifiedStreamer && result.verifiedStreamer.id === page.streamer.id;
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
$('googleLoginButton').addEventListener('click', loginWithGoogle);
$('kakaoLoginButton').addEventListener('click', loginWithKakao);
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
$('streamerVerificationForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submitOrCheckStreamerVerification(false);
});
$('logoutButton').addEventListener('click', logout);
window.addEventListener('hashchange', loadApp);
loadApp();

async function submitOrCheckStreamerVerification(checkOnly) {
  const submitButton = $('submitStreamerVerification');
  const checkButton = $('checkStreamerVerification');
  const status = $('verificationStatus');
  const nickname = $('verificationNickname').value.trim();
  const soopId = $('verificationSoopId').value.trim().toLowerCase();
  if (!checkOnly && !$('streamerVerificationForm').reportValidity()) return;
  submitButton.disabled = true;
  checkButton.disabled = true;
  status.textContent = checkOnly ? '인증 상태를 확인하고 있어요.' : '인증 신청을 접수하고 있어요.';
  try {
    if (!auth.currentUser) await waitForAuthRestore();
    if (!auth.currentUser) await signInAnonymously(auth);
    const payload = { source: 'streamer-fanpage' };
    if (!checkOnly) Object.assign(payload, { nickname, soopId });
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
      status.textContent = checkOnly
        ? `${result.nickname || '스트리머'} 인증은 아직 검토 중이에요. 승인 후 다시 확인해 주세요.`
        : '인증 신청을 접수했어요. 관리자 승인 후 “승인 여부 확인”을 눌러 주세요.';
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
