'use strict';

const { getDatabase, getDatabaseWithUrl } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

const ADS_PATH = 'streamerFanPageSponsorAds';
const REQUESTS_PATH = 'streamerFanPageSponsorRequests';
const PENDING_PATH = 'streamerFanPageSponsorPending';
const CLAIMS_PATH = 'streamerFanPageSponsorPlacementClaims';
const LIMITS_PATH = 'streamerFanPageSponsorLimits';
const MAX_ADS_PER_RAIL = 5;
const MAX_ACTIVE_ADS = MAX_ADS_PER_RAIL * 2;
const BALLOONS_PER_DAY = 10;
const MAX_DAYS = 30;
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const SOOP_ID_RE = /^[a-z0-9]{2,20}$/;
const FORBIDDEN_TEXT_RE = /[<>\x00-\x1F\x7F]/;
const FANPAGE_DATABASE_URL = 'https://streamer-fanpage-rtdb.firebaseio.com';
const fanpageDb = () => getDatabaseWithUrl(FANPAGE_DATABASE_URL);
const sharedDb = () => getDatabase();

function requireAuth(request) {
  if (!request.auth || typeof request.auth.uid !== 'string') {
    throw new HttpsError('unauthenticated', '페이지 연결을 확인한 뒤 다시 시도해 주세요.');
  }
  return request.auth.uid;
}

async function isAdmin(uid) {
  const snapshot = await sharedDb().ref(`adminCenter/adminUids/${uid}`).get();
  return snapshot.val() === true;
}

function normalizeStreamerId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function profileImageUrl(soopId) {
  return `https://stimg.sooplive.com/LOGO/${soopId.slice(0, 2)}/${soopId}/${soopId}.jpg`;
}

function stationUrl(soopId) {
  return `https://www.sooplive.com/station/${soopId}`;
}

function validRequestId(requestId) {
  return typeof requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(requestId);
}

function isPendingRequest(record, now = Date.now()) {
  return !!record && record.status === 'pending'
    && (Number(record.donationCompletedAt) > 0 || Number(record.expiresAt) > now);
}

async function releaseRequestIndexes(db, requestId, soopId) {
  await Promise.all([
    db.ref(`${PENDING_PATH}/${requestId}`).remove(),
    db.ref(`${CLAIMS_PATH}/${requestId}`).remove(),
  ]);
}

async function holdFreshRealtimeSnapshot(ref) {
  let listener = null;
  const snapshot = await new Promise((resolve, reject) => {
    listener = (value) => resolve(value);
    ref.on('value', listener, (error) => {
      ref.off('value', listener);
      reject(error);
    });
  });
  return { snapshot, release: () => ref.off('value', listener) };
}

async function expirePendingRequest(db, requestId, record) {
  const expiration = await db.ref(`${REQUESTS_PATH}/${requestId}`).transaction((current) => {
    if (!current || current.status !== 'pending' || Number(current.donationCompletedAt) > 0 || Number(current.expiresAt) > Date.now()) return;
    return { ...current, status: 'expired', updatedAt: Date.now() };
  });
  if (expiration.committed && expiration.snapshot.val() && expiration.snapshot.val().status === 'expired') {
    await releaseRequestIndexes(db, requestId, normalizeStreamerId(record && record.soopId));
  }
}

exports.streamerFanPageSponsorAds = onCall({ maxInstances: 20, enforceAppCheck: true }, async (request) => {
  const uid = requireAuth(request);
  const db = fanpageDb();
  const data = request.data || {};
  const action = String(data.action || 'list');

  if (action === 'list') {
    const now = Date.now();
    const claimsRef = db.ref(CLAIMS_PATH);
    const claimsResult = await claimsRef.transaction((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      for (const [requestId, claim] of Object.entries(next)) {
        if (!claim) {
          delete next[requestId];
          continue;
        }
        const pendingExpired = claim.status === 'pending'
          && !Number(claim.donationCompletedAt)
          && Number(claim.expiresAt) <= now;
        const adExpired = claim.status === 'active' && Number(claim.expiresAt) <= now;
        if (pendingExpired || adExpired) delete next[requestId];
      }
      return next;
    });
    const [snapshot, claimsSnapshot] = await Promise.all([
      db.ref(ADS_PATH).get(),
      Promise.resolve(claimsResult.snapshot),
    ]);
    const claims = claimsSnapshot.val() || {};
    const pendingByRail = { left: 0, right: 0 };
    Object.values(claims).forEach((claim) => {
      if (claim && claim.status === 'pending' && ['left', 'right'].includes(claim.rail)) pendingByRail[claim.rail] += 1;
    });
    const ads = Object.entries(snapshot.val() || {})
      .map(([campaignId, record]) => ({ campaignId, ...(record || {}) }))
      .filter((ad) => ad.status === 'active' && Number(ad.expiresAt) > now)
      .sort((a, b) => Number(b.expiresAt) - Number(a.expiresAt))
      .slice(0, MAX_ACTIVE_ADS)
      .map((ad) => ({
        nickname: String(ad.nickname || '').slice(0, 40),
        soopId: normalizeStreamerId(ad.soopId),
        avatarUrl: profileImageUrl(normalizeStreamerId(ad.soopId)),
        stationUrl: stationUrl(normalizeStreamerId(ad.soopId)),
        rail: ad.rail === 'right' ? 'right' : 'left',
        startsAt: Math.max(0, Number(ad.startsAt) || 0),
        expiresAt: Math.max(0, Number(ad.expiresAt) || 0),
      }));
    return { ads, pendingByRail, isAdmin: await isAdmin(uid), maxAdsPerRail: MAX_ADS_PER_RAIL };
  }

  if (action === 'submit') {
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim() : '';
    const soopId = normalizeStreamerId(data.soopId);
    const donorSoopId = normalizeStreamerId(data.donorSoopId);
    const rail = data.rail === 'right' ? 'right' : data.rail === 'left' ? 'left' : '';
    const days = Number(data.days);
    if (!nickname || nickname.length > 40 || FORBIDDEN_TEXT_RE.test(nickname)) {
      throw new HttpsError('invalid-argument', '스트리머 닉네임을 확인해 주세요.');
    }
    if (!SOOP_ID_RE.test(soopId)) throw new HttpsError('invalid-argument', 'SOOP 아이디를 영문 소문자와 숫자 2~20자로 입력해 주세요.');
    if (!SOOP_ID_RE.test(donorSoopId)) throw new HttpsError('invalid-argument', '후원 계정의 SOOP 아이디를 확인해 주세요.');
    if (!rail) throw new HttpsError('invalid-argument', '홍보할 위치를 다시 선택해 주세요.');
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      throw new HttpsError('invalid-argument', `홍보 기간은 1~${MAX_DAYS}일로 선택해 주세요.`);
    }

    const now = Date.now();
    const limitRef = db.ref(`${LIMITS_PATH}/${uid}`);
    const limit = await limitRef.transaction((current) => {
      const lastRequestedAt = Number(current && current.lastRequestedAt) || 0;
      if (now - lastRequestedAt < REQUEST_COOLDOWN_MS) return;
      return { lastRequestedAt: now };
    });
    if (!limit.committed) throw new HttpsError('resource-exhausted', '신청은 잠시 후 다시 시도해 주세요.');

    const requestRef = db.ref(REQUESTS_PATH).push();
    const requestId = requestRef.key;
    const claimRef = db.ref(CLAIMS_PATH);
    const claim = await claimRef.transaction((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      for (const [id, item] of Object.entries(next)) {
        if (!item) {
          delete next[id];
          continue;
        }
        const pendingExpired = item.status === 'pending'
          && !Number(item.donationCompletedAt)
          && Number(item.expiresAt) <= now;
        const adExpired = item.status === 'active' && Number(item.expiresAt) <= now;
        if (pendingExpired || adExpired) delete next[id];
      }
      const entries = Object.values(next);
      if (entries.some((item) => normalizeStreamerId(item.soopId) === soopId)) return;
      const railCount = entries.filter((item) => item.rail === rail).length;
      if (railCount >= MAX_ADS_PER_RAIL || entries.length >= MAX_ACTIVE_ADS) return;
      next[requestId] = {
        soopId,
        rail,
        status: 'pending',
        requestedAt: now,
        expiresAt: now + REQUEST_TTL_MS,
        donationCompletedAt: 0,
      };
      return next;
    });
    if (!claim.committed) {
      const entries = Object.values(claim.snapshot.val() || {});
      if (entries.some((item) => normalizeStreamerId(item && item.soopId) === soopId)) {
        throw new HttpsError('already-exists', '이 스트리머는 이미 홍보 중이거나 신청 확인 중입니다.');
      }
      throw new HttpsError('resource-exhausted', '선택한 홍보 영역의 신청 자리가 모두 찼습니다. 빈자리가 생기면 다시 신청해 주세요.');
    }
    const record = {
      requesterUid: uid,
      nickname,
      soopId,
      rail,
      donorSoopId,
      days,
      balloonCost: days * BALLOONS_PER_DAY,
      status: 'pending',
      requestedAt: now,
      expiresAt: now + REQUEST_TTL_MS,
      donationCompletedAt: 0,
    };
    try {
      await db.ref().update({
        [`${REQUESTS_PATH}/${requestId}`]: record,
        [`${PENDING_PATH}/${requestId}`]: { status: 'pending', requestedAt: now },
      });
    } catch (error) {
      await claimRef.child(requestId).remove();
      throw error;
    }
    return { requestId, requestedAt: now, balloonCost: record.balloonCost, days, rail, status: 'pending' };
  }

  if (action === 'donationComplete' || action === 'cancel' || action === 'status') {
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
    if (!validRequestId(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
    const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
    const existing = (await requestRef.get()).val();
    if (!existing || existing.requesterUid !== uid) throw new HttpsError('not-found', '신청을 찾을 수 없습니다.');

    if (action === 'status') {
      if (existing.status === 'pending' && !Number(existing.donationCompletedAt) && Number(existing.expiresAt) <= Date.now()) {
        await expirePendingRequest(db, requestId, existing);
        return { status: 'expired' };
      }
      const ad = existing.status === 'approved' && existing.campaignId
        ? (await db.ref(`${ADS_PATH}/${existing.campaignId}`).get()).val()
        : null;
      return {
        status: String(existing.status || ''),
        requestedAt: Math.max(0, Number(existing.requestedAt) || 0),
        donationCompletedAt: Math.max(0, Number(existing.donationCompletedAt) || 0),
        expiresAt: Math.max(0, Number(ad && ad.expiresAt) || 0),
        nickname: String(existing.nickname || '').slice(0, 40),
        soopId: soopIdFromRecord(existing),
        donorSoopId: normalizeStreamerId(existing.donorSoopId),
        days: Math.max(1, Math.min(MAX_DAYS, Number(existing.days) || 1)),
        balloonCost: Math.max(0, Number(existing.balloonCost) || 0),
      };
    }

    if (action === 'donationComplete') {
      const now = Date.now();
      // 관리자가 수동 승인을 처리하는 동안 브라우저 상태 폴링이 갱신되기 전에
      // 사용자가 완료 버튼을 누를 수 있다. 승인/처리 중 상태는 오류로 돌리지 않는다.
      if (existing.status === 'approved') {
        const ad = existing.campaignId
          ? (await db.ref(`${ADS_PATH}/${existing.campaignId}`).get()).val()
          : null;
        return {
          status: 'approved',
          donationCompletedAt: Math.max(0, Number(existing.donationCompletedAt) || 0),
          expiresAt: Math.max(0, Number(ad && ad.expiresAt) || Number(existing.approvedUntil) || 0),
        };
      }
      if (existing.status === 'processing') {
        return {
          status: 'processing',
          donationCompletedAt: Math.max(0, Number(existing.donationCompletedAt) || 0),
        };
      }
      if (!isPendingRequest(existing, now)) {
        throw new HttpsError('failed-precondition', '후원 완료를 등록할 수 있는 대기 신청이 없습니다. 신청 상태를 새로고침해 주세요.');
      }
      const claimRef = db.ref(`${CLAIMS_PATH}/${requestId}`);
      const held = [];
      try {
      held.push(await holdFreshRealtimeSnapshot(claimRef));
      held.push(await holdFreshRealtimeSnapshot(requestRef));
      const requestSoopId = soopIdFromRecord(existing);
      const markClaimDonationComplete = () => claimRef.transaction((current) => {
        if (!current || current.status !== 'pending' || current.soopId !== requestSoopId) return;
        if (Number(current.donationCompletedAt) > 0) return current;
        return { ...current, donationCompletedAt: now };
      });
      let claim = await markClaimDonationComplete();
      let claimValue = claim.snapshot.val();
      // 다른 신청 확인/만료 정리와 겹쳐 transaction이 중단됐지만 예약이 여전히
      // 유효한 경우 한 번 재시도해 순간적인 동시 갱신을 복구한다.
      if (!claim.committed && claimValue && claimValue.status === 'pending' &&
          claimValue.soopId === requestSoopId && !Number(claimValue.donationCompletedAt)) {
        claim = await markClaimDonationComplete();
        claimValue = claim.snapshot.val();
      }
      if (!claim.committed && !(claimValue && claimValue.status === 'pending' &&
          claimValue.soopId === requestSoopId && Number(claimValue.donationCompletedAt) > 0)) {
        // 관리자가 같은 순간에 승인을 시작했을 수 있으니 최신 상태를 확인하고,
        // 대기열에 남은 정상 신청에는 기존의 잘못된 '자리 없음' 안내를 하지 않는다.
        const [latestRequestSnapshot, latestClaimSnapshot] = await Promise.all([
          requestRef.get(),
          claimRef.get(),
        ]);
        const latestRequest = latestRequestSnapshot.val() || {};
        const latestClaim = latestClaimSnapshot.val() || {};
        if (latestRequest.requesterUid === uid && latestRequest.status === 'approved') {
          const ad = latestRequest.campaignId
            ? (await db.ref(`${ADS_PATH}/${latestRequest.campaignId}`).get()).val()
            : null;
          return {
            status: 'approved',
            donationCompletedAt: Math.max(0, Number(latestRequest.donationCompletedAt) || 0),
            expiresAt: Math.max(0, Number(ad && ad.expiresAt) || Number(latestRequest.approvedUntil) || 0),
          };
        }
        if (latestRequest.requesterUid === uid && latestRequest.status === 'processing') {
          return {
            status: 'processing',
            donationCompletedAt: Math.max(0, Number(latestRequest.donationCompletedAt) || 0),
          };
        }
        console.warn('홍보 신청 후원 완료 예약 확인 실패:', {
          requestId,
          requestStatus: String(latestRequest.status || ''),
          claimStatus: String(latestClaim.status || ''),
          claimMatchesRequest: latestClaim.soopId === soopIdFromRecord(latestRequest),
        });
        throw new HttpsError('failed-precondition', '신청 자리 예약 상태를 확인하지 못했습니다. 신청 상태를 새로고침한 뒤 다시 시도해 주세요.');
      }
      const result = await requestRef.transaction((current) => {
        if (!current || current.requesterUid !== uid || !isPendingRequest(current, now)) return;
        if (Number(current.donationCompletedAt) > 0) return current;
        return { ...current, donationCompletedAt: now, updatedAt: now };
      });
      const saved = result.snapshot.val();
      if (!saved || saved.requesterUid !== uid || saved.status !== 'pending') {
        await claimRef.child('donationCompletedAt').transaction((current) => current === now ? 0 : current);
        throw new HttpsError('failed-precondition', '후원 완료를 등록할 수 있는 대기 신청이 없습니다.');
      }
      return { status: 'pending', donationCompletedAt: Number(saved.donationCompletedAt) || now };
      } finally {
        held.forEach((item) => item.release());
      }
    }

    if (Number(existing.donationCompletedAt) > 0) {
      throw new HttpsError('failed-precondition', '후원 완료를 알린 신청은 취소할 수 없습니다. 운영자에게 문의해 주세요.');
    }
    const canceledAt = Date.now();
    const canceled = await requestRef.transaction((current) => {
      if (!current || current.requesterUid !== uid || Number(current.donationCompletedAt) > 0 || !isPendingRequest(current)) return;
      return { ...current, status: 'cancelled', canceledAt, updatedAt: canceledAt };
    });
    if (!canceled.committed) throw new HttpsError('failed-precondition', '취소할 수 있는 대기 신청이 없습니다.');
    await releaseRequestIndexes(db, requestId, soopIdFromRecord(existing));
    return { status: 'cancelled' };
  }

  throw new HttpsError('invalid-argument', '홍보 신청 요청을 확인해 주세요.');
});

function soopIdFromRecord(record) {
  return normalizeStreamerId(record && record.soopId);
}

exports.streamerFanPageAdminSponsorAds = onCall({ maxInstances: 10, enforceAppCheck: true }, async (request) => {
  const adminUid = requireAuth(request);
  const db = fanpageDb();
  if (!await isAdmin(adminUid)) throw new HttpsError('permission-denied', '관리자만 홍보 신청을 관리할 수 있습니다.');
  const data = request.data || {};
  const action = String(data.action || 'list');

  if (action === 'list') {
    const pendingSnapshot = await db.ref(PENDING_PATH).get();
    const pendingIds = Object.keys(pendingSnapshot.val() || {}).slice(-100);
    const requests = [];
    for (const requestId of pendingIds) {
      const record = (await db.ref(`${REQUESTS_PATH}/${requestId}`).get()).val();
      if (!record || record.status !== 'pending') continue;
      if (!Number(record.donationCompletedAt) && Number(record.expiresAt) <= Date.now()) {
        await expirePendingRequest(db, requestId, record);
        continue;
      }
      requests.push({
        requestId,
        nickname: String(record.nickname || '').slice(0, 40),
        soopId: soopIdFromRecord(record),
        donorSoopId: normalizeStreamerId(record.donorSoopId),
        days: Math.max(1, Math.min(MAX_DAYS, Number(record.days) || 1)),
        balloonCost: Math.max(0, Number(record.balloonCost) || 0),
        donationCompletedAt: Math.max(0, Number(record.donationCompletedAt) || 0),
        requestedAt: Math.max(0, Number(record.requestedAt) || 0),
        expiresAt: Math.max(0, Number(record.expiresAt) || 0),
      });
    }
    requests.sort((a, b) => a.requestedAt - b.requestedAt);
    return { requests, truncated: Object.keys(pendingSnapshot.val() || {}).length > pendingIds.length };
  }

  if (action !== 'approve' && action !== 'reject') throw new HttpsError('invalid-argument', '신청 처리 방법을 확인해 주세요.');
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
  if (!validRequestId(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
  const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
  const now = Date.now();
  const requestSnapshot = await requestRef.get();
  const pendingRecord = requestSnapshot.val();
  if (!pendingRecord || pendingRecord.status !== 'pending') throw new HttpsError('failed-precondition', '대기 중인 신청만 처리할 수 있습니다.');
  if (!Number(pendingRecord.donationCompletedAt) && Number(pendingRecord.expiresAt) <= now) {
    await expirePendingRequest(db, requestId, pendingRecord);
    throw new HttpsError('failed-precondition', '신청이 만료되어 처리할 수 없습니다.');
  }

  if (action === 'reject') {
    // Keep a live listener attached until the transaction completes. A one-shot
    // get() can leave a fresh Functions instance's transaction cache empty, which
    // makes the update callback abort even though the request is still pending.
    const heldRequest = await holdFreshRealtimeSnapshot(requestRef);
    try {
      const currentRequest = heldRequest.snapshot.val();
      if (currentRequest && currentRequest.status === 'rejected') {
        await releaseRequestIndexes(db, requestId, soopIdFromRecord(currentRequest));
        return { status: 'rejected', alreadyProcessed: true };
      }
      if (!currentRequest || currentRequest.status !== 'pending') {
        const status = String(currentRequest && currentRequest.status || 'missing');
        throw new HttpsError('failed-precondition', `현재 신청 상태가 ${status}입니다. 목록을 새로고침해 주세요.`);
      }
      if (!Number(currentRequest.donationCompletedAt) && Number(currentRequest.expiresAt) <= now) {
        await expirePendingRequest(db, requestId, currentRequest);
        throw new HttpsError('failed-precondition', '신청이 만료되어 처리할 수 없습니다.');
      }

      const result = await requestRef.transaction((current) => {
        if (!current || current.status !== 'pending') return;
        return { ...current, status: 'rejected', reviewedAt: now, reviewedBy: adminUid };
      }, undefined, false);
      const resultValue = result.snapshot.val();
      if (!result.committed && !(resultValue && resultValue.status === 'rejected')) {
        console.error('고점체크 홍보 신청 반려 트랜잭션 실패:', {
          requestId,
          currentStatus: String(resultValue && resultValue.status || 'missing'),
        });
        throw new HttpsError('aborted', '반려 상태를 저장하지 못했습니다. 신청 목록을 새로고침한 뒤 다시 시도해 주세요.');
      }
      await releaseRequestIndexes(db, requestId, soopIdFromRecord(currentRequest));
      return { status: 'rejected' };
    } finally {
      heldRequest.release();
    }
  }

  if (!Number(pendingRecord.donationCompletedAt)) {
    throw new HttpsError('failed-precondition', '신청자가 후원 완료를 표시하지 않았습니다.');
  }
  const processing = await requestRef.transaction((current) => {
    if (!current || current.status !== 'pending') return;
    return { ...current, status: 'processing', processingAt: now, processingBy: adminUid };
  });
  if (!processing.committed) throw new HttpsError('failed-precondition', '이미 처리 중이거나 완료된 신청입니다.');

  const soopId = soopIdFromRecord(pendingRecord);
  const campaignId = requestId;
  const claimRef = db.ref(`${CLAIMS_PATH}/${requestId}`);
  let claimActivated = false;
  let adCreated = false;
  try {
    const adRef = db.ref(ADS_PATH);
    const savedAd = {
      campaignId,
      soopId,
      rail: pendingRecord.rail === 'right' ? 'right' : 'left',
      nickname: String(pendingRecord.nickname || '').slice(0, 40),
      status: 'active',
      startsAt: now,
      expiresAt: now + Math.max(1, Math.min(MAX_DAYS, Number(pendingRecord.days) || 1)) * 24 * 60 * 60 * 1000,
      requestId,
    };
    const capacity = await adRef.transaction((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      for (const [id, ad] of Object.entries(next)) {
        if (!ad || ad.status !== 'active' || Number(ad.expiresAt) <= now) delete next[id];
      }
      const activeForRail = Object.values(next).filter((ad) => ad.rail === savedAd.rail).length;
      if (Object.keys(next).length >= MAX_ACTIVE_ADS || activeForRail >= MAX_ADS_PER_RAIL) return;
      next[campaignId] = savedAd;
      return next;
    });
    if (!capacity.committed) throw new HttpsError('resource-exhausted', '현재 홍보 칸이 모두 찼습니다. 빈 칸이 생기면 신청해 주세요.');
    adCreated = true;

    const activation = await claimRef.transaction((current) => {
      if (!current || current.status !== 'pending' || !Number(current.donationCompletedAt)) return;
      return { ...current, status: 'active', expiresAt: savedAd.expiresAt, campaignId };
    });
    if (!activation.committed) throw new HttpsError('failed-precondition', '홍보 자리 예약을 확인하지 못했습니다.');
    claimActivated = true;

    const finalized = await requestRef.transaction((current) => {
      if (!current || current.status !== 'processing' || current.processingBy !== adminUid) return;
      return { ...current, status: 'approved', reviewedAt: now, reviewedBy: adminUid, campaignId, approvedUntil: savedAd.expiresAt };
    });
    if (!finalized.committed) throw new HttpsError('aborted', '신청 처리 결과를 저장하지 못했습니다.');
    await db.ref(`${PENDING_PATH}/${requestId}`).remove();
    return { status: 'approved', expiresAt: savedAd.expiresAt };
  } catch (error) {
    if (adCreated) await db.ref(`${ADS_PATH}/${campaignId}`).remove().catch(() => null);
    if (claimActivated) await claimRef.transaction((current) => current && current.status === 'active' && current.campaignId === campaignId
      ? { ...current, status: 'pending', expiresAt: Number(pendingRecord.expiresAt) || now, campaignId: null }
      : current).catch(() => null);
    await requestRef.transaction((current) => {
      if (!current || current.status !== 'processing' || current.processingBy !== adminUid) return;
      return { ...current, status: 'pending', processingAt: null, processingBy: null, updatedAt: Date.now() };
    }).catch(() => null);
    throw error;
  }
});
