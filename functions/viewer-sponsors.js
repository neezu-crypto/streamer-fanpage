'use strict';

const { createHash } = require('node:crypto');
const { getDatabase, getDatabaseWithUrl } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

// 고점체크 ‘오늘의 후원 스트리머’의 신규 통합 캐시 결제 데이터는 과거 별풍선
// 수동 승인 경로(streamerFanPageSponsor*)와 의도적으로 분리한다.
const ROOT = 'streamerFanPageViewerSponsors';
const CAMPAIGNS_PATH = `${ROOT}/campaigns`;
const CLAIMS_PATH = `${ROOT}/claimsBySoopId`;
const RESULTS_PATH = `${ROOT}/paymentResults`;
const OPERATIONS_PATH = `${ROOT}/paymentOperations`;
const LIMITS_PATH = `${ROOT}/limits`;
const LEGACY_ADS_PATH = 'streamerFanPageSponsorAds';
const LEGACY_CLAIMS_PATH = 'streamerFanPageSponsorPlacementClaims';
const WALLET_ROOT = 'gameSeriesWallet';
const WALLET_PURCHASES_KEY = 'fanPageViewerSponsorPurchases';
const WALLET_LEDGER_KIND = 'viewerSponsorPromotion';
const FANPAGE_DATABASE_URL = 'https://streamer-fanpage-rtdb.firebaseio.com';
const LIFE_GAME_DATABASE_URL = 'https://streamer-life-game-rtdb.firebaseio.com';
const STOCK_MARKET_DATABASE_URL = 'https://soop-stock-market-rtdb.firebaseio.com';
const STOCK_MARKET_MIGRATION_STATE_PATH = 'adminCenter/stockMarketDatabaseMigration/state';
const MAX_ADS_PER_RAIL = 5;
const MAX_ACTIVE_ADS = MAX_ADS_PER_RAIL * 2;
const CASH_PER_DAY = 10;
const MAX_DAYS = 30;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const RESERVATION_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const SOOP_ID_RE = /^[a-z0-9]{2,20}$/;
const FORBIDDEN_TEXT_RE = /[<>\x00-\x1F\x7F]/;

// 주식시장의 streamerStockListing.js와 동일한 종목명 비교 기준.
function normalizeStockName(value) {
  return String(value || '').normalize('NFC').trim()
    .replace(/^\[[^\]]+\]\s*/u, '')
    .toLocaleLowerCase('ko-KR')
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
}

function isListedNickname(stocks, nickname) {
  const normalized = normalizeStockName(nickname);
  return !!normalized && Object.values(stocks || {}).some((stock) => normalizeStockName(stock && stock.name) === normalized);
}

function hasApprovedHistory(records, idField, soopId, statuses = ['approved']) {
  return Object.values(records || {}).some((record) => record && statuses.includes(record.status)
    && normalizeSoopId(record[idField]) === soopId);
}

async function hasPromotionEligibility(soopId, nickname) {
  const shared = sharedDb();
  const market = await activeStockMarketDatabase(shared);
  const verified = await shared.ref('streamerVerifications').orderByChild('soopId').equalTo(soopId).get();
  if (Object.values(verified.val() || {}).some((record) => typeof record?.nickname === 'string'
    && normalizeSoopId(record.soopId) === soopId)) return true;
  const stocks = (await market.ref('stocks').get()).val();
  if (isListedNickname(stocks, nickname)) return true;

  const queryHistory = async (db, path, field, statuses, indexed = true) => {
    // 기존 요청 노드는 status만 인덱스되어 있다. 캠페인은 별도 인덱스가 없다.
    const ref = db.ref(path);
    const snapshot = indexed && statuses.length === 1 && statuses[0] === 'approved'
      ? await ref.orderByChild('status').equalTo('approved').get()
      : await ref.get();
    return hasApprovedHistory(snapshot.val(), field, soopId, statuses);
  };
  const life = getDatabaseWithUrl(LIFE_GAME_DATABASE_URL);
  const checks = [
    ...['bannerRequests', 'chartBannerRequests', 'cardBannerRequests', 'relayRoomRequests']
      .map((path) => queryHistory(market, path, 'streamerId', ['approved'])),
    queryHistory(life, 'lifeGame/sponsorRequests', 'soopId', ['approved']),
    queryHistory(fanpageDb(), 'streamerFanPageSponsorRequests', 'soopId', ['approved'], false),
    queryHistory(fanpageDb(), CAMPAIGNS_PATH, 'soopId', ['active', 'ended'], false),
  ];
  const results = await Promise.allSettled(checks);
  if (results.some((result) => result.status === 'fulfilled' && result.value)) return true;
  if (results.some((result) => result.status === 'rejected')) {
    throw new HttpsError('unavailable', '홍보 이력을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return false;
}

const fanpageDb = () => getDatabaseWithUrl(FANPAGE_DATABASE_URL);
const sharedDb = () => getDatabase();
async function activeStockMarketDatabase(shared = sharedDb()) {
  const state = (await shared.ref(STOCK_MARKET_MIGRATION_STATE_PATH).get()).val() || {};
  return state.phase === 'market-primary' ? getDatabaseWithUrl(STOCK_MARKET_DATABASE_URL) : shared;
}

function requireAuth(request) {
  if (!request.auth || typeof request.auth.uid !== 'string') {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

function normalizeSoopId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function profileImageUrl(soopId) {
  return `https://stimg.sooplive.com/LOGO/${soopId.slice(0, 2)}/${soopId}/${soopId}.jpg`;
}

function stationUrl(soopId) {
  return `https://www.sooplive.com/station/${soopId}`;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function validateRequestId(value) {
  const requestId = String(value || '');
  if (!REQUEST_ID_RE.test(requestId)) {
    throw new HttpsError('invalid-argument', '결제 요청을 다시 시작해 주세요.');
  }
  return requestId;
}

function toPublicCampaign(record, campaignId) {
  const soopId = normalizeSoopId(record && record.soopId);
  return {
    campaignId,
    nickname: String(record && record.nickname || '').slice(0, 40),
    soopId,
    avatarUrl: String(record && record.avatarUrl || profileImageUrl(soopId)),
    stationUrl: stationUrl(soopId),
    rail: record && record.rail === 'right' ? 'right' : 'left',
    startsAt: Math.max(0, Number(record && record.startsAt) || 0),
    expiresAt: Math.max(0, Number(record && record.expiresAt) || 0),
  };
}

function cleanCampaigns(records, now) {
  return Object.entries(records && typeof records === 'object' ? records : {})
    .map(([campaignId, record]) => ({ campaignId, ...(record || {}) }))
    .filter((campaign) => campaign.status === 'active' && Number(campaign.expiresAt) > now);
}

async function isAdmin(uid) {
  const snapshot = await sharedDb().ref(`adminCenter/adminUids/${uid}`).get();
  return snapshot.val() === true;
}

async function resolveProfile(soopId) {
  if (!SOOP_ID_RE.test(soopId)) {
    throw new HttpsError('invalid-argument', 'SOOP 아이디를 영문 소문자와 숫자 2~20자로 입력해 주세요.');
  }
  let nickname = '';
  try {
    const url = new URL('https://sch.sooplive.co.kr/api.php');
    url.search = new URLSearchParams({ l: 'DF', m: 'bjSearch', v: '3.0', szOrder: 'score', szKeyword: soopId, nPageNo: '1', nListCnt: '30', w: 'webk', tab: 'bj' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('SOOP search failed');
    const payload = await response.json();
    if (Number(payload?.RESULT) !== 1 || !Array.isArray(payload.DATA)) throw new Error('Invalid SOOP response');
    const match = payload.DATA.find((row) => normalizeSoopId(row?.user_id) === soopId);
    nickname = typeof match?.user_nick === 'string' ? match.user_nick.trim() : '';
  } catch (_) {
    throw new HttpsError('unavailable', 'SOOP 검색을 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!nickname || nickname.length > 40 || FORBIDDEN_TEXT_RE.test(nickname)) {
    throw new HttpsError('not-found', '스트리머의 SOOP ID를 확인해주세요');
  }
  if (!await hasPromotionEligibility(soopId, nickname)) {
    throw new HttpsError('failed-precondition', '인증·상장 또는 승인된 스트리머 홍보 이력을 찾을 수 없습니다.');
  }
  return { soopId, nickname, avatarUrl: profileImageUrl(soopId), stationUrl: stationUrl(soopId) };
}

async function getCashStatus(uid) {
  const account = (await sharedDb().ref(`${WALLET_ROOT}/accounts/${uid}`).get()).val() || {};
  return { balanceCash: nonNegativeInteger(account.balanceCash) };
}

async function legacyCapacity(db, now) {
  const [adsSnapshot, claimsSnapshot] = await Promise.all([
    db.ref(LEGACY_ADS_PATH).get(),
    db.ref(LEGACY_CLAIMS_PATH).get(),
  ]);
  const capacity = { total: 0, left: 0, right: 0, soopIds: [] };
  cleanCampaigns(adsSnapshot.val(), now).forEach((campaign) => {
    const rail = campaign.rail === 'right' ? 'right' : 'left';
    capacity.total += 1;
    capacity[rail] += 1;
    capacity.soopIds.push(normalizeSoopId(campaign.soopId));
  });
  Object.values(claimsSnapshot.val() || {}).forEach((claim) => {
    if (!claim || Number(claim.expiresAt) <= now || claim.status !== 'pending') return;
    const rail = claim.rail === 'right' ? 'right' : 'left';
    capacity.total += 1;
    capacity[rail] += 1;
    capacity.soopIds.push(normalizeSoopId(claim.soopId));
  });
  return capacity;
}

async function reservePlacement({ db, soopId, rail, requestId, now, legacy = { total: 0, left: 0, right: 0 } }) {
  if (Array.isArray(legacy.soopIds) && legacy.soopIds.includes(soopId)) {
    throw new HttpsError('already-exists', '이 스트리머는 기존 홍보 신청 또는 노출 상태입니다.');
  }
  const result = await db.ref(CLAIMS_PATH).transaction((current) => {
    const next = { ...(current && typeof current === 'object' ? current : {}) };
    for (const [id, claim] of Object.entries(next)) {
      if (!claim || Number(claim.expiresAt) <= now) delete next[id];
    }
    const existing = next[soopId];
    if (existing) {
      if (existing.requestId === requestId) return next;
      return;
    }
    const entries = Object.values(next);
    const railCount = entries.filter((claim) => claim.rail === rail).length;
    if (entries.length + legacy.total >= MAX_ACTIVE_ADS || railCount + legacy[rail] >= MAX_ADS_PER_RAIL) return;
    next[soopId] = { requestId, soopId, rail, status: 'reserving', createdAt: now, expiresAt: now + RESERVATION_TTL_MS };
    return next;
  }, undefined, false);
  const claim = result.snapshot.val() && result.snapshot.val()[soopId];
  if (claim && claim.requestId === requestId) return claim;
  if (claim && claim.soopId === soopId) {
    throw new HttpsError('already-exists', '이 스트리머는 이미 오늘의 후원 스트리머에 표시 중입니다.');
  }
  throw new HttpsError('resource-exhausted', '선택한 홍보 영역의 자리가 모두 찼습니다.');
}

async function releasePlacement(db, soopId, requestId) {
  await db.ref(`${CLAIMS_PATH}/${soopId}`).transaction((current) => {
    if (!current || current.requestId !== requestId) return current;
    return null;
  }, undefined, false);
}

async function withFreshValue(ref, work) {
  let listener;
  await new Promise((resolve, reject) => {
    listener = () => resolve();
    ref.on('value', listener, (error) => { ref.off('value', listener); reject(error); });
  });
  try { return await work(); } finally { ref.off('value', listener); }
}

async function debitCash({ uid, requestId, cashAmount, paymentFingerprint, now }) {
  const accountRef = sharedDb().ref(`${WALLET_ROOT}/accounts/${uid}`);
  let insufficient = false;
  let conflict = false;
  let previous = null;
  const transaction = await withFreshValue(accountRef, () => accountRef.transaction((current) => {
    insufficient = false;
    conflict = false;
    previous = null;
    const account = current && typeof current === 'object' ? current : {};
    const purchases = account[WALLET_PURCHASES_KEY] && typeof account[WALLET_PURCHASES_KEY] === 'object'
      ? account[WALLET_PURCHASES_KEY] : {};
    previous = purchases[requestId] || null;
    if (previous) {
      conflict = previous.fingerprint !== paymentFingerprint || Number(previous.cashAmount) !== cashAmount;
      return account;
    }
    const balance = nonNegativeInteger(account.balanceCash);
    if (balance < cashAmount) {
      insufficient = true;
      return;
    }
    return {
      ...account,
      balanceCash: balance - cashAmount,
      [WALLET_PURCHASES_KEY]: {
        ...purchases,
        [requestId]: {
          requestId,
          product: WALLET_LEDGER_KIND,
          cashAmount,
          fingerprint: paymentFingerprint,
          status: 'charged',
          chargedAt: now,
        },
      },
    };
  }, undefined, false));
  if (conflict) throw new HttpsError('already-exists', '같은 결제 번호가 다른 내용에 사용됐습니다. 다시 시도해 주세요.');
  if (previous && (previous.status !== 'charged' || previous.adminRefund)) throw new HttpsError('failed-precondition', '이미 환불 처리된 결제 요청입니다.');
  if (insufficient) throw new HttpsError('failed-precondition', `통합 캐시가 부족합니다. 필요 ${cashAmount}캐시입니다.`);
  if (!transaction.committed && !previous) throw new HttpsError('aborted', '통합 캐시 차감에 실패했습니다. 다시 시도해 주세요.');
  const account = transaction.snapshot.val() || {};
  return { alreadyCharged: !!previous, remainingCash: nonNegativeInteger(account.balanceCash) };
}

async function writeDebitLedger({ uid, requestId, cashAmount, now }) {
  const ledgerRef = sharedDb().ref(`${WALLET_ROOT}/ledger/${uid}/${requestId}_${WALLET_LEDGER_KIND}`);
  const result = await withFreshValue(ledgerRef, () => ledgerRef.transaction((current) => current ? (current.requestId === requestId && current.type === WALLET_LEDGER_KIND && Number(current.balanceDelta) === -cashAmount ? current : undefined) : {
    requestId,
    type: WALLET_LEDGER_KIND,
    balanceDelta: -cashAmount,
    createdAt: now,
  }, undefined, false));
  if (!result.committed) throw new HttpsError('aborted', '결제 원장 기록을 대조하지 못했습니다.');
}

async function refundCash({ uid, requestId, cashAmount, now, reason }) {
  const accountRef = sharedDb().ref(`${WALLET_ROOT}/accounts/${uid}`);
  let result = null;
  const transaction = await withFreshValue(accountRef, () => accountRef.transaction((current) => {
    result = null;
    const account = current && typeof current === 'object' ? current : {};
    const purchases = account[WALLET_PURCHASES_KEY] && typeof account[WALLET_PURCHASES_KEY] === 'object'
      ? account[WALLET_PURCHASES_KEY] : {};
    const purchase = purchases[requestId];
    if (!purchase) return;
    if (purchase.adminRefund) return;
    if (Number(purchase.cashAmount) !== cashAmount || !['charged', 'refunded'].includes(purchase.status)) return;
    if (purchase.status === 'refunded') {
      result = { refunded: true, alreadyRefunded: true };
      return account;
    }
    result = { refunded: true, alreadyRefunded: false };
    return {
      ...account,
      balanceCash: nonNegativeInteger(account.balanceCash) + cashAmount,
      [WALLET_PURCHASES_KEY]: {
        ...purchases,
        [requestId]: { ...purchase, status: 'refunded', refundedAt: now, refundReason: reason },
      },
    };
  }, undefined, false));
  if (!result && !transaction.committed) throw new HttpsError('aborted', '자동 환불을 완료하지 못했습니다. 관리자에게 문의해 주세요.');
  const ledgerRef = sharedDb().ref(`${WALLET_ROOT}/ledger/${uid}/${requestId}_${WALLET_LEDGER_KIND}_refund`);
  const ledger = await withFreshValue(ledgerRef, () => ledgerRef.transaction((current) => current ? (current.requestId === requestId && current.type === `${WALLET_LEDGER_KIND}_refund` && Number(current.balanceDelta) === cashAmount ? current : undefined) : {
    requestId,
    type: `${WALLET_LEDGER_KIND}_refund`,
    balanceDelta: cashAmount,
    reason,
    createdAt: now,
  }, undefined, false));
  if (!ledger.committed) throw new HttpsError('aborted', '환불 원장을 대조하지 못했습니다. 관리자에게 문의해 주세요.');
  return result || { refunded: true, alreadyRefunded: true };
}

async function activateCampaign({ db, campaign, requestId, now }) {
  const campaignRef = db.ref(`${CAMPAIGNS_PATH}/${requestId}`);
  const created = await campaignRef.transaction((current) => {
    if (!current) return campaign;
    if (current.paymentRequestId === requestId && current.status === 'active') return current;
    return;
  }, undefined, false);
  const saved = created.snapshot.val();
  if (!saved || saved.paymentRequestId !== requestId || saved.status !== 'active') {
    throw new HttpsError('aborted', '홍보 캠페인을 시작하지 못했습니다.');
  }
  const claimRef = db.ref(`${CLAIMS_PATH}/${campaign.soopId}`);
  const claim = await withFreshValue(claimRef, () => claimRef.transaction((current) => {
    if (!current || current.requestId !== requestId || (current.status !== 'active' && Number(current.expiresAt) <= Date.now())) return;
    return { ...current, status: 'active', campaignId: requestId, expiresAt: campaign.expiresAt, updatedAt: now };
  }, undefined, false));
  if (!claim.committed && (!claim.snapshot.val() || claim.snapshot.val().campaignId !== requestId)) {
    throw new HttpsError('aborted', '홍보 자리 상태를 확정하지 못했습니다.');
  }
  return saved;
}

async function listLegacyAds(db, now) {
  const legacySnapshot = await db.ref(LEGACY_ADS_PATH).get();
  return cleanCampaigns(legacySnapshot.val(), now).map((record) => toPublicCampaign(record, String(record.requestId || `${record.soopId}-${record.startsAt}`)));
}

async function listNewAds(db, now) {
  const campaignSnapshot = await db.ref(CAMPAIGNS_PATH).get();
  return cleanCampaigns(campaignSnapshot.val(), now).map((record) => toPublicCampaign(record, String(record.paymentRequestId || record.campaignId || `${record.soopId}-${record.startsAt}`)));
}

async function countLegacyPending(db, now) {
  const snapshot = await db.ref(LEGACY_CLAIMS_PATH).get();
  const pending = { left: 0, right: 0 };
  Object.values(snapshot.val() || {}).forEach((claim) => {
    if (claim && claim.status === 'pending' && Number(claim.expiresAt) > now && ['left', 'right'].includes(claim.rail)) pending[claim.rail] += 1;
  });
  return pending;
}

const streamerFanPageViewerSponsors = onCall({ maxInstances: 20, enforceAppCheck: true }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const action = String(data.action || 'list');
  const db = fanpageDb();

  if (action === 'list') {
    const now = Date.now();
    const [legacyAds, newAds, pendingByRail] = await Promise.all([
      listLegacyAds(db, now),
      listNewAds(db, now),
      countLegacyPending(db, now),
    ]);
    const merged = [...legacyAds, ...newAds]
      .filter((campaign, index, list) => list.findIndex((item) => item.soopId === campaign.soopId) === index)
      .sort((a, b) => Number(a.startsAt) - Number(b.startsAt))
      .slice(0, MAX_ACTIVE_ADS);
    return { ads: merged, pendingByRail, maxAdsPerRail: MAX_ADS_PER_RAIL, isAdmin: await isAdmin(uid) };
  }

  if (action === 'profile') {
    return { profile: await resolveProfile(normalizeSoopId(data.soopId)) };
  }

  if (action === 'status') {
    return { cashPerDay: CASH_PER_DAY, maxDays: MAX_DAYS, ...(await getCashStatus(uid)) };
  }

  if (action === 'payment-status') {
    const requestId = validateRequestId(data.requestId);
    const [resultSnapshot, accountSnapshot, campaignSnapshot, operationSnapshot] = await Promise.all([
      db.ref(`${RESULTS_PATH}/${requestId}`).get(),
      sharedDb().ref(`${WALLET_ROOT}/accounts/${uid}/${WALLET_PURCHASES_KEY}/${requestId}`).get(),
      db.ref(`${CAMPAIGNS_PATH}/${requestId}`).get(),
      db.ref(`${OPERATIONS_PATH}/${requestId}`).get(),
    ]);
    const result = resultSnapshot.val();
    const purchase = accountSnapshot.val();
    const campaign = campaignSnapshot.val();
    const operation = operationSnapshot.val();
    if (operation && operation.requesterUid !== uid) throw new HttpsError('permission-denied', '다른 사용자의 결제 요청입니다.');
    if (result && result.requesterUid !== uid) throw new HttpsError('permission-denied', '다른 사용자의 결제 요청입니다.');
    if (result?.status === 'activated') return { status: 'activated', nickname: result.nickname, soopId: result.soopId, days: result.days, cashAmount: result.cashAmount, expiresAt: result.expiresAt, remainingCash: (await getCashStatus(uid)).balanceCash };
    if (result?.status === 'refund-pending') return { status: 'refund-pending' };
    if (result?.status === 'refunded') return { status: 'refunded' };
    if (operation?.status === 'failed-no-charge' && !purchase) return { status: 'failed-no-charge' };
    if (purchase?.status === 'charged' && !purchase.adminRefund && campaign?.status === 'active' && campaign.requesterUidHash === createHash('sha256').update(uid).digest('hex')) {
      const claim = (await db.ref(`${CLAIMS_PATH}/${campaign.soopId}`).get()).val();
      if (claim?.status === 'active' && claim.campaignId === requestId) return { status: 'activated', nickname: campaign.nickname, soopId: campaign.soopId, days: campaign.days, cashAmount: campaign.cashCost, expiresAt: campaign.expiresAt, remainingCash: (await getCashStatus(uid)).balanceCash };
    }
    return { status: purchase || operation ? 'pending' : 'unknown' };
  }

  if (action !== 'purchase') throw new HttpsError('invalid-argument', '홍보 요청을 확인해 주세요.');
  const requestId = validateRequestId(data.requestId);
  const soopId = normalizeSoopId(data.soopId);
  const rail = data.rail === 'right' ? 'right' : data.rail === 'left' ? 'left' : '';
  const days = Number(data.days);
  if (!rail) throw new HttpsError('invalid-argument', '홍보할 위치를 선택해 주세요.');
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new HttpsError('invalid-argument', `홍보 기간은 1~${MAX_DAYS}일로 선택해 주세요.`);
  }

  const now = Date.now();
  const priorResult = (await db.ref(`${RESULTS_PATH}/${requestId}`).get()).val();
  if (priorResult) {
    if (priorResult.requesterUid !== uid) throw new HttpsError('permission-denied', '다른 사용자의 결제 요청입니다.');
    if (priorResult.status === 'activated') return priorResult;
    if (priorResult.status === 'refunded') throw new HttpsError('aborted', '이전 요청은 자동 환불되었습니다. 다시 결제해 주세요.');
    if (priorResult.status === 'refund-pending') throw new HttpsError('failed-precondition', '이전 요청의 환불을 확인 중입니다. 관리자에게 문의해 주세요.');
  }

  const limit = await db.ref(`${LIMITS_PATH}/${uid}`).transaction((current) => {
    const lastRequestedAt = Number(current && current.lastRequestedAt) || 0;
    if (now - lastRequestedAt < REQUEST_COOLDOWN_MS) return;
    return { lastRequestedAt: now };
  }, undefined, false);
  if (!limit.committed) throw new HttpsError('resource-exhausted', '잠시 후 다시 시도해 주세요.');

  const profile = await resolveProfile(soopId);
  const nickname = profile.nickname;
  const cashAmount = days * CASH_PER_DAY;
  const paymentFingerprint = fingerprint({ soopId, rail, days, cashAmount });
  const expiresAt = now + days * DAY_MS;
  const campaign = {
    paymentMethod: 'integrated-cash',
    paymentRequestId: requestId,
    requesterUidHash: createHash('sha256').update(uid).digest('hex'),
    nickname,
    soopId,
    avatarUrl: profile.avatarUrl,
    rail,
    days,
    cashCost: cashAmount,
    status: 'active',
    startsAt: now,
    expiresAt,
    createdAt: now,
  };

  const operationRef = db.ref(`${OPERATIONS_PATH}/${requestId}`);
  const operation = await withFreshValue(operationRef, () => operationRef.transaction((current) => {
    if (current) return;
    return { requesterUid: uid, soopId, rail, days, cashAmount, status: 'processing', createdAt: now, leaseUntil: now + 15 * 60 * 1000 };
  }, undefined, false));
  if (!operation.committed) throw new HttpsError('already-exists', '이미 처리 중인 결제 요청입니다. 결과를 확인해 주세요.');
  let charged = false;
  let campaignActivated = false;
  try {
    const legacy = await legacyCapacity(db, now);
    await reservePlacement({ db, soopId, rail, requestId, now, legacy });
    const debit = await debitCash({ uid, requestId, cashAmount, paymentFingerprint, now });
    charged = true;
    await writeDebitLedger({ uid, requestId, cashAmount, now });
    const savedCampaign = await activateCampaign({ db, campaign, requestId, now });
    campaignActivated = true;
    const result = {
      status: 'activated',
      requesterUid: uid,
      campaignId: requestId,
      nickname: savedCampaign.nickname,
      soopId: savedCampaign.soopId,
      rail: savedCampaign.rail,
      days,
      cashAmount,
      startsAt: now,
      expiresAt,
      remainingCash: debit.remainingCash,
      updatedAt: now,
    };
    try {
      await db.ref(`${RESULTS_PATH}/${requestId}`).set(result);
      await operationRef.update({ status: 'activated', updatedAt: Date.now() });
    } catch (resultError) {
      console.error('오늘의 후원 스트리머 결제 결과 저장 실패', { requestId, resultError });
    }
    return result;
  } catch (error) {
    if (campaignActivated) throw error;
    if (charged) {
      try {
        await db.ref(`${CAMPAIGNS_PATH}/${requestId}`).transaction((current) => {
          if (current && current.paymentRequestId === requestId) return null;
          return current;
        }, undefined, false);
        await refundCash({ uid, requestId, cashAmount, now: Date.now(), reason: '고점체크 홍보 활성화 실패 자동 환불' });
        await db.ref(`${RESULTS_PATH}/${requestId}`).set({ status: 'refunded', requesterUid: uid, cashAmount, failureCode: String(error && error.code || 'activation-failed'), updatedAt: Date.now() });
        await operationRef.update({ status: 'refunded', updatedAt: Date.now() });
      } catch (refundError) {
        await db.ref(`${RESULTS_PATH}/${requestId}`).set({ status: 'refund-pending', requesterUid: uid, cashAmount, failureCode: String(error && error.code || 'activation-failed'), refundFailure: String(refundError && refundError.code || 'unknown'), updatedAt: Date.now() });
        await operationRef.update({ status: 'refund-pending', updatedAt: Date.now() }).catch(() => null);
        throw new HttpsError('internal', '홍보 활성화에 실패했고 자동 환불을 확인하지 못했습니다. 관리자에게 문의해 주세요.');
      }
    }
    await releasePlacement(db, soopId, requestId).catch(() => null);
    throw error;
  }
});

// 호출 중단 또는 네트워크 장애 후에는 충분한 대기 시간을 둔 다음 실제 원장과
// 캠페인을 대조한다. 불일치는 자동으로 돈을 움직이지 않고 관리자 검토로 넘긴다.
async function reconcileViewerSponsorPayments() {
  const db = fanpageDb();
  const now = Date.now();
  const snapshot = await db.ref(OPERATIONS_PATH).get();
  let checked = 0;
  for (const [requestId, operation] of Object.entries(snapshot.val() || {})) {
    if (checked >= 100 || !operation || operation.status !== 'processing' || Number(operation.leaseUntil) > now) continue;
    checked++;
    const operationRef = db.ref(`${OPERATIONS_PATH}/${requestId}`);
    try {
      const [resultSnap, purchaseSnap, campaignSnap] = await Promise.all([
        db.ref(`${RESULTS_PATH}/${requestId}`).get(),
        sharedDb().ref(`${WALLET_ROOT}/accounts/${operation.requesterUid}/${WALLET_PURCHASES_KEY}/${requestId}`).get(),
        db.ref(`${CAMPAIGNS_PATH}/${requestId}`).get(),
      ]);
      const result = resultSnap.val(), purchase = purchaseSnap.val(), campaign = campaignSnap.val();
      if (result?.status === 'activated' || result?.status === 'refunded' || result?.status === 'refund-pending') {
        await operationRef.update({ status: result.status, updatedAt: now });
        continue;
      }
      if (!purchase) {
        await releasePlacement(db, operation.soopId, requestId);
        await operationRef.update({ status: 'failed-no-charge', updatedAt: now });
        continue;
      }
      const claim = (await db.ref(`${CLAIMS_PATH}/${operation.soopId}`).get()).val();
      const ownerHash = createHash('sha256').update(operation.requesterUid).digest('hex');
      if (purchase.status === 'charged' && campaign?.status === 'active' && campaign.requesterUidHash === ownerHash && claim?.status === 'active' && claim.campaignId === requestId) {
        await db.ref(`${RESULTS_PATH}/${requestId}`).set({ status: 'activated', requesterUid: operation.requesterUid, campaignId: requestId, nickname: campaign.nickname, soopId: campaign.soopId, rail: campaign.rail, days: campaign.days, cashAmount: campaign.cashCost, startsAt: campaign.startsAt, expiresAt: campaign.expiresAt, updatedAt: now });
        await operationRef.update({ status: 'activated', updatedAt: now });
      } else {
        await db.ref(`${RESULTS_PATH}/${requestId}`).set({ status: 'refund-pending', requesterUid: operation.requesterUid, cashAmount: operation.cashAmount, failureCode: 'interrupted-payment', refundFailure: campaign ? 'campaign-review-required' : 'manual-retry-required', updatedAt: now });
        await operationRef.update({ status: 'refund-pending', updatedAt: now });
      }
    } catch (error) {
      console.error('홍보 결제 대조 실패', { requestId, error });
    }
  }
  return { checked };
}

module.exports = {
  streamerFanPageViewerSponsors,
  reconcileViewerSponsorPayments,
  CASH_PER_DAY,
  MAX_DAYS,
  WALLET_PURCHASES_KEY,
  debitCash,
  refundCash,
  resolveProfile,
  // 외부 API 없이 확인 가능한 입력·공개 응답 규칙 테스트용 공개 헬퍼
  __test: { normalizeSoopId, profileImageUrl, validateRequestId, toPublicCampaign, cleanCampaigns, normalizeStockName, isListedNickname, hasApprovedHistory },
};
