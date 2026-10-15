'use strict';

const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

const SUBSCRIPTIONS_PATH = 'streamerFanPageViewerSubscriptions';
const REQUESTS_PATH = 'streamerFanPageViewerSubscriptionRequests';
const PENDING_PATH = 'streamerFanPageViewerSubscriptionPending';
const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const BALLOON_COST = 10;
const MAX_DONOR_NICKNAME_LENGTH = 20;
const FORBIDDEN_TEXT_RE = /[<>\x00-\x1F\x7F]/;

function requireAuth(request) {
  if (!request.auth || typeof request.auth.uid !== 'string') {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

async function isAdmin(uid) {
  const db = getDatabase();
  const adminSnapshot = await db.ref(`adminCenter/adminUids/${uid}`).get();
  return adminSnapshot.val() === true;
}

async function accountAccess(uid) {
  const db = getDatabase();
  const [userSnapshot, admin] = await Promise.all([
    db.ref(`users/${uid}`).get(),
    isAdmin(uid),
  ]);
  const user = userSnapshot.val() || {};
  return {
    isAdmin: admin,
    accountProtected: admin || user.googleLinked === true || user.kakaoLinked === true || user.streamerVerified === true,
  };
}

async function accountProtection(uid) {
  return (await accountAccess(uid)).accountProtected;
}

async function requireProtectedAccount(request) {
  const uid = requireAuth(request);
  if (!await accountProtection(uid)) {
    throw new HttpsError('permission-denied', '구독 신청은 Google·Kakao 계정 연결 또는 스트리머 인증을 완료한 계정에서만 할 수 있습니다.');
  }
  return uid;
}

async function requireAdmin(request) {
  const uid = requireAuth(request);
  if (!await isAdmin(uid)) {
    throw new HttpsError('permission-denied', '관리자만 구독 신청을 관리할 수 있습니다.');
  }
  return uid;
}

function subscriptionInfo(value, now) {
  const subscription = value && typeof value === 'object' ? value : {};
  const expiresAt = Math.max(0, Number(subscription.expiresAt) || 0);
  return {
    subscribed: expiresAt > now,
    expiresAt,
    pendingRequestId: typeof subscription.pendingRequestId === 'string' ? subscription.pendingRequestId : '',
    lastRequestId: typeof subscription.lastRequestId === 'string' ? subscription.lastRequestId : '',
  };
}

async function getRequest(db, requestId) {
  if (!requestId) return null;
  const snapshot = await db.ref(`${REQUESTS_PATH}/${requestId}`).get();
  return snapshot.exists() ? snapshot.val() : null;
}

exports.streamerFanPageViewerSubscription = onCall({ maxInstances: 20, enforceAppCheck: true }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const action = String(data.action || 'status');
  const db = getDatabase();
  const subscriptionRef = db.ref(`${SUBSCRIPTIONS_PATH}/${uid}`);

  if (action === 'status') {
    const [subscriptionSnapshot, access] = await Promise.all([
      subscriptionRef.get(),
      accountAccess(uid),
    ]);
    const now = Date.now();
    const subscription = subscriptionSnapshot.val() || {};
    const info = subscriptionInfo(subscription, now);
    const pendingRequest = await getRequest(db, info.pendingRequestId);
    const lastRequest = await getRequest(db, info.lastRequestId);
    const isPending = !!(pendingRequest && ['pending', 'processing'].includes(pendingRequest.status));
    if (info.pendingRequestId && !isPending) {
      await subscriptionRef.child('pendingRequestId')
        .transaction((current) => current === info.pendingRequestId ? null : current);
    }
    return {
      accountProtected: access.accountProtected,
      isAdmin: access.isAdmin,
      subscribed: access.isAdmin || info.subscribed,
      expiresAt: info.expiresAt,
      pending: isPending,
      pendingRequestId: isPending ? info.pendingRequestId : '',
      pendingRequestedAt: isPending ? Math.max(0, Number(pendingRequest.requestedAt) || 0) : 0,
      lastRequestStatus: lastRequest && typeof lastRequest.status === 'string' ? lastRequest.status : '',
      lastReviewedAt: Math.max(0, Number(lastRequest && lastRequest.reviewedAt) || 0),
      balloonCost: BALLOON_COST,
      durationDays: 30,
    };
  }

  if (action === 'request') {
    await requireProtectedAccount(request);
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().slice(0, MAX_DONOR_NICKNAME_LENGTH) : '';
    if (!nickname || FORBIDDEN_TEXT_RE.test(nickname)) {
      throw new HttpsError('invalid-argument', '후원에 사용한 SOOP 닉네임을 입력해 주세요.');
    }

    const now = Date.now();
    const requestRef = db.ref(REQUESTS_PATH).push();
    const requestId = requestRef.key;
    const claim = await subscriptionRef.transaction((current) => {
      const previous = current && typeof current === 'object' ? current : {};
      if (previous.pendingRequestId) return;
      const lastRequestedAt = Number(previous.lastRequestedAt) || 0;
      if (lastRequestedAt && now - lastRequestedAt < 60 * 1000) return;
      return {
        ...previous,
        pendingRequestId: requestId,
        lastRequestId: requestId,
        lastRequestedAt: now,
      };
    });
    if (!claim.committed) {
      const current = claim.snapshot.val() || {};
      if (current.pendingRequestId) {
        const pending = await getRequest(db, current.pendingRequestId);
        if (pending && ['pending', 'processing'].includes(pending.status)) {
          return { action: 'already-pending', requestedAt: Number(pending.requestedAt) || 0 };
        }
      }
      throw new HttpsError('resource-exhausted', '신청을 잠시 간격을 두고 다시 시도해 주세요.');
    }

    const record = {
      requesterUid: uid,
      nickname,
      balloonCost: BALLOON_COST,
      durationDays: 30,
      status: 'pending',
      requestedAt: now,
    };
    try {
      await db.ref().update({
        [`${REQUESTS_PATH}/${requestId}`]: record,
        [`${PENDING_PATH}/${requestId}`]: now,
      });
    } catch (error) {
      await subscriptionRef.child('pendingRequestId').transaction((current) => current === requestId ? null : current);
      throw error;
    }
    return { action: 'pending', requestedAt: now };
  }

  if (action === 'cancel') {
    await requireProtectedAccount(request);
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
    const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
    const canceledAt = Date.now();
    const result = await requestRef.transaction((current) => {
      if (!current || current.requesterUid !== uid || current.status !== 'pending') return;
      return { ...current, status: 'cancelled', canceledAt };
    });
    if (!result.committed) throw new HttpsError('failed-precondition', '취소할 수 있는 대기 중 신청이 없습니다.');
    await db.ref().update({ [`${PENDING_PATH}/${requestId}`]: null });
    await subscriptionRef.child('pendingRequestId').transaction((current) => current === requestId ? null : current);
    return { cancelled: true };
  }

  if (action === 'periodAccess') {
    const [subscriptionSnapshot, admin] = await Promise.all([
      subscriptionRef.get(),
      isAdmin(uid),
    ]);
    const info = subscriptionInfo(subscriptionSnapshot.val(), Date.now());
    if (!admin && !info.subscribed) {
      throw new HttpsError('permission-denied', '기간별 최고 시청 순간은 구독 계정에서 이용할 수 있습니다.');
    }
    return { subscribed: true, isAdmin: admin, expiresAt: info.expiresAt };
  }

  throw new HttpsError('invalid-argument', '구독 요청을 확인해 주세요.');
});

exports.streamerFanPageAdminViewerSubscriptionRequests = onCall({ maxInstances: 10 }, async (request) => {
  const adminUid = await requireAdmin(request);
  const db = getDatabase();
  const data = request.data || {};
  const action = String(data.action || 'list');

  if (action === 'list') {
    const pendingSnapshot = await db.ref(PENDING_PATH).get();
    const pendingIds = Object.keys(pendingSnapshot.val() || {}).slice(-200);
    const requests = (await Promise.all(pendingIds.map(async (requestId) => {
      const record = await getRequest(db, requestId);
      if (!record || !['pending', 'processing'].includes(record.status)) return null;
      return {
        requestId,
        requesterUid: String(record.requesterUid || ''),
        nickname: String(record.nickname || '').slice(0, MAX_DONOR_NICKNAME_LENGTH),
        status: record.status,
        requestedAt: Math.max(0, Number(record.requestedAt) || 0),
      };
    }))).filter(Boolean);
    requests.sort((a, b) => a.requestedAt - b.requestedAt);
    return { requests, truncated: Object.keys(pendingSnapshot.val() || {}).length > pendingIds.length };
  }

  if (action !== 'approve' && action !== 'reject') {
    throw new HttpsError('invalid-argument', '구독 신청 처리 방법을 확인해 주세요.');
  }
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
  const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
  const now = Date.now();

  if (action === 'reject') {
    const result = await requestRef.transaction((current) => {
      if (!current || current.status !== 'pending') return;
      return { ...current, status: 'rejected', reviewedAt: now, reviewedBy: adminUid };
    });
    if (!result.committed) throw new HttpsError('failed-precondition', '대기 중인 신청만 거절할 수 있습니다.');
    const record = result.snapshot.val();
    await db.ref().update({ [`${PENDING_PATH}/${requestId}`]: null });
    await db.ref(`${SUBSCRIPTIONS_PATH}/${record.requesterUid}/pendingRequestId`)
      .transaction((current) => current === requestId ? null : current);
    return { ok: true, status: 'rejected' };
  }

  const claim = await requestRef.transaction((current) => {
    if (!current || !['pending', 'processing'].includes(current.status)) return;
    return { ...current, status: 'processing', reviewedBy: adminUid, processingAt: now };
  });
  if (!claim.committed) {
    const current = claim.snapshot.val();
    if (current && current.status === 'approved') {
      const existing = await db.ref(`${SUBSCRIPTIONS_PATH}/${current.requesterUid}`).get();
      return { ok: true, status: 'approved', expiresAt: Number(existing.val() && existing.val().expiresAt) || 0 };
    }
    throw new HttpsError('failed-precondition', '처리 중이거나 이미 처리된 신청입니다.');
  }

  const record = claim.snapshot.val();
  const subscriptionRef = db.ref(`${SUBSCRIPTIONS_PATH}/${record.requesterUid}`);
  const entitlement = await subscriptionRef.transaction((current) => {
    const previous = current && typeof current === 'object' ? current : {};
    if (previous.lastApprovedRequestId === requestId) return previous;
    const currentExpiry = Math.max(0, Number(previous.expiresAt) || 0);
    return {
      ...previous,
      expiresAt: Math.max(Date.now(), currentExpiry) + SUBSCRIPTION_DURATION_MS,
      lastApprovedAt: Date.now(),
      lastApprovedRequestId: requestId,
    };
  });
  if (!entitlement.committed) {
    const current = entitlement.snapshot.val() || {};
    if (current.lastApprovedRequestId !== requestId) {
      throw new HttpsError('aborted', '구독 기간 갱신을 완료하지 못했습니다. 다시 승인 처리해 주세요.');
    }
  }
  const expiresAt = Number(entitlement.snapshot.val() && entitlement.snapshot.val().expiresAt) || 0;
  await db.ref().update({
    [`${REQUESTS_PATH}/${requestId}/status`]: 'approved',
    [`${REQUESTS_PATH}/${requestId}/reviewedAt`]: Date.now(),
    [`${REQUESTS_PATH}/${requestId}/approvedUntil`]: expiresAt,
    [`${PENDING_PATH}/${requestId}`]: null,
  });
  await subscriptionRef.child('pendingRequestId').transaction((current) => current === requestId ? null : current);
  return { ok: true, status: 'approved', expiresAt };
});
