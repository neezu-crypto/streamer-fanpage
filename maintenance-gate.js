import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
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

const app = getApps().find((candidate) => candidate.name === '[DEFAULT]') || initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
const checkMaintenanceAccess = httpsCallable(functions, 'streamerFanPageMaintenanceAccess');
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const gate = document.getElementById('maintenanceGate');
const status = document.getElementById('maintenanceGateStatus');
const loginButton = document.getElementById('maintenanceAdminLogin');
const siteShell = document.getElementById('siteShell');
const normalPageTitle = '스트리머 팬페이지';
const maintenancePageTitle = '스트리머 팬페이지 | 서비스 점검 중';
const checksInFlight = new Map();
let latestCheckId = 0;
let authorizedUid = '';
let appStarted = false;
let appStartPromise = null;

function showMaintenance(message) {
  document.title = maintenancePageTitle;
  siteShell.setAttribute('aria-hidden', 'true');
  siteShell.setAttribute('inert', '');
  gate.hidden = false;
  status.textContent = message;
  loginButton.disabled = false;
}

async function startAdminPage() {
  if (appStarted) return;
  if (appStartPromise) return appStartPromise;

  appStartPromise = (async () => {
    await import('./app.js?v=20261103-favorites-description-v1');
    await import('https://neezu-crypto.github.io/streamer-game-series-shop/game-series-emotes.js?game=streamerFanPage&v=20261028-emote-modal-bottom-right');
    appStarted = true;
  })();

  try {
    await appStartPromise;
  } catch (error) {
    console.error('팬페이지 관리자 화면을 불러오지 못했습니다:', error);
    showMaintenance('관리자 권한은 확인했지만 페이지를 불러오지 못했습니다. 다시 로그인해 주세요.');
  } finally {
    appStartPromise = null;
  }
}

async function verifyAdmin(user) {
  if (!user || user.isAnonymous) {
    authorizedUid = '';
    showMaintenance('팬페이지는 점검 중입니다. 관리자는 Google 계정으로 로그인해 정상 이용할 수 있습니다.');
    return;
  }
  if (authorizedUid === user.uid && appStarted) {
    gate.hidden = true;
    return;
  }
  if (checksInFlight.has(user.uid)) return checksInFlight.get(user.uid);

  const checkId = ++latestCheckId;
  gate.hidden = false;
  status.textContent = '관리자 권한을 확인하고 있습니다.';
  loginButton.disabled = true;
  const checkPromise = (async () => {
    try {
      const response = await checkMaintenanceAccess({});
      if (checkId !== latestCheckId || auth.currentUser?.uid !== user.uid) return;
      if (response.data?.isAdmin !== true) {
        authorizedUid = '';
        showMaintenance('이 계정은 관리자 계정이 아닙니다. 관리자 계정으로 로그인해 주세요.');
        return;
      }

      authorizedUid = user.uid;
      document.title = normalPageTitle;
      siteShell.removeAttribute('inert');
      siteShell.setAttribute('aria-hidden', 'false');
      gate.hidden = true;
      await startAdminPage();
    } catch (error) {
      if (checkId !== latestCheckId || auth.currentUser?.uid !== user.uid) return;
      console.error('팬페이지 관리자 권한 확인 실패:', error);
      authorizedUid = '';
      showMaintenance('관리자 권한을 확인하지 못했습니다. 연결을 확인한 뒤 다시 로그인해 주세요.');
    } finally {
      if (checkId === latestCheckId) loginButton.disabled = false;
    }
  })();
  checksInFlight.set(user.uid, checkPromise);
  try {
    await checkPromise;
  } finally {
    if (checksInFlight.get(user.uid) === checkPromise) checksInFlight.delete(user.uid);
  }
}

loginButton.addEventListener('click', async () => {
  loginButton.disabled = true;
  status.textContent = 'Google 계정 로그인을 기다리고 있습니다.';
  try {
    await signInWithPopup(auth, googleProvider);
    if (auth.currentUser) await verifyAdmin(auth.currentUser);
  } catch (error) {
    console.error('팬페이지 관리자 로그인 실패:', error);
    showMaintenance('로그인하지 못했습니다. 관리자 Google 계정으로 다시 시도해 주세요.');
  } finally {
    loginButton.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user || user.isAnonymous) {
    latestCheckId += 1;
    authorizedUid = '';
    showMaintenance('팬페이지는 점검 중입니다. 관리자는 Google 계정으로 로그인해 정상 이용할 수 있습니다.');
    return;
  }
  void verifyAdmin(user);
});
