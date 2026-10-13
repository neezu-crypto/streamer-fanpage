import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
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
const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
const callViewerStats = httpsCallable(functions, 'streamerFanPageViewerStats');
const $ = (id) => document.getElementById(id);
const MAX_CONCURRENT_STATS_REQUESTS = 3;
const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;

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

function formatVodDate(value) {
  const date = String(value || '').trim().slice(0, 10);
  return date ? date.replaceAll('-', '.') : '날짜 정보 없음';
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
  card.dataset.statsState = 'ready';
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
  message.textContent = error && error.message ? error.message : '유저 수 그래프를 불러오지 못했어요.';
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
    if (!job.card.isConnected || job.loadToken !== activeLoadToken || job.card.dataset.statsState !== 'queued') continue;
    activeStatsRequests += 1;
    job.card.dataset.statsState = 'loading';
    callViewerStats({ action: 'stats', streamerId: job.streamerId, vodId: job.vod.id })
      .then((result) => {
        if (!job.card.isConnected || job.loadToken !== activeLoadToken) return;
        const stats = result.data && result.data.stats;
        if (!stats || !stats.highest || !stats.lowest) throw new Error('시청자 그래프 응답을 확인하지 못했어요.');
        showStatsLinks(job.card, stats);
      })
      .catch((error) => showStatsError(job.card, error, job.loadToken))
      .finally(() => {
        activeStatsRequests = Math.max(0, activeStatsRequests - 1);
        pumpStatsQueue();
      });
  }
}

function enqueueStats(card, vod, loadToken) {
  if (!selectedStreamer || card.dataset.statsState !== 'idle') return;
  card.dataset.statsState = 'queued';
  statsQueue.push({ card, vod, loadToken, streamerId: selectedStreamer.soopId });
  pumpStatsQueue();
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
    $('viewerVodStatus').textContent = error.message || '다시보기 목록을 불러오지 못했어요.';
  } finally {
    if (loadToken === activeLoadToken) {
      $('viewerLoadMore').disabled = false;
      $('viewerLoadMore').textContent = '더 많은 다시보기 불러오기';
    }
  }
}

async function selectStreamer(streamer) {
  activeLoadToken += 1;
  const loadToken = activeLoadToken;
  selectedStreamer = streamer;
  nextPage = 1;
  hasMoreVods = false;
  vodTotal = 0;
  statsQueue = [];
  if (statsObserver) statsObserver.disconnect();
  $('viewerVodGrid').replaceChildren();
  $('viewerLoadMore').classList.add('hidden');
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
    if (requestId === searchRequestId) setSearchHint(error.message || '스트리머 검색에 실패했어요.', true);
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

getAuthReady().catch((error) => setSearchHint(error.message || '통계 연결을 시작하지 못했어요.', true));
