'use strict';

const crypto = require('node:crypto');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

const SUBSCRIPTIONS_PATH = 'streamerFanPageViewerSubscriptions';
const REQUESTS_PATH = 'streamerFanPageViewerSubscriptionRequests';
const PENDING_PATH = 'streamerFanPageViewerSubscriptionPending';
const SIGNALS_PATH = 'streamerFanPageAdminSubscriptionSignals';
const SOOP_CLAIMS_PATH = 'streamerFanPageViewerSubscriptionSoopIds';
const LEGACY_SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_CODE_TTL_MS = 30 * 60 * 1000;
const VERIFICATION_CODE_COOLDOWN_MS = 60 * 1000;
const PROCESSING_STALE_MS = 2 * 60 * 1000;
const SOOP_ID_RE = /^[a-z0-9]{2,20}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const VERIFICATION_CODE_RE = /^[A-F0-9]{10}$/;

let lookupSoopNickname = async () => '';
let lookupSoopNicknames = async () => new Map();

function configureSoopNicknameLookups(singleLookup, batchLookup) {
  if (typeof singleLookup === 'function') lookupSoopNickname = singleLookup;
  if (typeof batchLookup === 'function') lookupSoopNicknames = batchLookup;
}

function requireAuth(request) {
  if (!request.auth || typeof request.auth.uid !== 'string') {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

async function isAdmin(uid) {
  const snapshot = await getDatabase().ref(`adminCenter/adminUids/${uid}`).get();
  return snapshot.val() === true;
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

async function requireProtectedAccount(request) {
  const uid = requireAuth(request);
  if (!(await accountAccess(uid)).accountProtected) {
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

function normalizedSoopId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function createVerificationCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function verificationCodeHash(requestId, code) {
  return crypto.createHash('sha256').update(`${requestId}:${code}`).digest('hex');
}

function safeCodeEquals(expected, actual) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const provided = Buffer.from(verificationCodeHash(actual.requestId, actual.code), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return provided.length === stored.length && crypto.timingSafeEqual(provided, stored);
}

function subscriptionInfo(value, now) {
  const subscription = value && typeof value === 'object' ? value : {};
  return {
    subscribed: (Number(subscription.expiresAt) || 0) > now,
    expiresAt: Math.max(0, Number(subscription.expiresAt) || 0),
    pendingRequestId: typeof subscription.pendingRequestId === 'string' ? subscription.pendingRequestId : '',
    lastRequestId: typeof subscription.lastRequestId === 'string' ? subscription.lastRequestId : '',
  };
}

async function getRequest(db, requestId) {
  if (!requestId) return null;
  const snapshot = await db.ref(`${REQUESTS_PATH}/${requestId}`).get();
  return snapshot.exists() ? snapshot.val() : null;
}

async function clearPending(db, requestId, requesterUid) {
  const updates = {
    [`${PENDING_PATH}/${requestId}`]: null,
    [`${SIGNALS_PATH}/${requestId}`]: null,
  };
  await db.ref().update(updates);
  if (requesterUid) {
    await transactionWithCachedValue(
      db.ref(`${SUBSCRIPTIONS_PATH}/${requesterUid}/pendingRequestId`),
      (current) => current === requestId ? null : current,
    );
  }
}

async function transactionWithCachedValue(ref, update) {
  const listener = () => {};
  const cancelListener = () => {};

  // Keep a listener active while get() fetches the server value. A listener's
  // first callback can be an incomplete local null; get() waits for a complete
  // server value and populates the active listener cache used by transaction().
  ref.on('value', listener, cancelListener);
  try {
    await ref.get();
    return await ref.transaction(update);
  } finally {
    ref.off('value', listener);
  }
}

exports.streamerFanPageViewerSubscription = onCall({ maxInstances: 20, enforceAppCheck: true }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const action = String(data.action || 'status');
  const db = getDatabase();
  const subscriptionRef = db.ref(`${SUBSCRIPTIONS_PATH}/${uid}`);

  if (action === 'status') {
    const [subscriptionSnapshot, access] = await Promise.all([subscriptionRef.get(), accountAccess(uid)]);
    const now = Date.now();
    const subscription = subscriptionSnapshot.val() || {};
    const info = subscriptionInfo(subscription, now);
    const pendingRequest = await getRequest(db, info.pendingRequestId);
    const lastRequest = await getRequest(db, info.lastRequestId);
    const isPending = !!(pendingRequest && pendingRequest.requesterUid === uid &&
      ['pending', 'processing'].includes(pendingRequest.status));
    if (info.pendingRequestId && !isPending) await clearPending(db, info.pendingRequestId, uid).catch(() => null);
    return {
      accountProtected: access.accountProtected,
      isAdmin: access.isAdmin,
      subscribed: access.isAdmin || info.subscribed,
      expiresAt: info.expiresAt,
      pending: isPending,
      pendingRequestId: isPending ? info.pendingRequestId : '',
      pendingRequestStatus: isPending ? String(pendingRequest.status || '') : '',
      pendingCanRenewCode: isPending && pendingRequest.verificationMethod === 'subscriber-comment-code' && (
        pendingRequest.status === 'pending' || (
          pendingRequest.status === 'processing' && Number(pendingRequest.processingAt) > 0 &&
          now - Number(pendingRequest.processingAt) >= PROCESSING_STALE_MS
        )
      ),
      pendingRequestedAt: isPending ? Math.max(0, Number(pendingRequest.requestedAt) || 0) : 0,
      pendingVerificationMethod: isPending ? String(pendingRequest.verificationMethod || 'star-donation') : '',
      pendingSoopId: isPending ? String(pendingRequest.soopId || pendingRequest.donorSoopId || '').slice(0, 20) : '',
      pendingCodeExpiresAt: isPending ? Math.max(0, Number(pendingRequest.codeExpiresAt) || 0) : 0,
      pendingDonorSoopId: isPending && pendingRequest.verificationMethod !== 'subscriber-comment-code'
        ? String(pendingRequest.donorSoopId || '').slice(0, 20) : '',
      pendingBalloonCost: isPending ? Number(pendingRequest.balloonCost) || 33 : 0,
      pendingDonationCompletedAt: isPending ? Math.max(0, Number(pendingRequest.donationCompletedAt) || 0) : 0,
      lastRequestStatus: lastRequest && typeof lastRequest.status === 'string' ? lastRequest.status : '',
      lastReviewedAt: Math.max(0, Number(lastRequest && lastRequest.reviewedAt) || 0),
      durationDays: 30,
    };
  }

  if (action === 'request') {
    await requireProtectedAccount(request);
    const soopId = normalizedSoopId(data.soopId);
    if (!SOOP_ID_RE.test(soopId)) {
      throw new HttpsError('invalid-argument', '본인 SOOP 방송국 아이디를 확인해 주세요.');
    }

    const now = Date.now();
    const requestRef = db.ref(REQUESTS_PATH).push();
    const requestId = requestRef.key;
    const code = createVerificationCode();
    const codeExpiresAt = now + VERIFICATION_CODE_TTL_MS;
    const claim = await transactionWithCachedValue(subscriptionRef, (current) => {
      const previous = current && typeof current === 'object' ? current : {};
      if (previous.pendingRequestId) return;
      const lastRequestedAt = Number(previous.lastRequestedAt) || 0;
      if (lastRequestedAt && now - lastRequestedAt < VERIFICATION_CODE_COOLDOWN_MS) return;
      return { ...previous, pendingRequestId: requestId, lastRequestId: requestId, lastRequestedAt: now };
    });
    if (!claim.committed) {
      const current = claim.snapshot.val() || {};
      if (current.pendingRequestId) {
        const pending = await getRequest(db, current.pendingRequestId);
        if (pending && ['pending', 'processing'].includes(pending.status)) {
          return { action: 'already-pending', requestId: current.pendingRequestId, requestedAt: Number(pending.requestedAt) || 0 };
        }
      }
      throw new HttpsError('resource-exhausted', '신청 코드는 1분 간격으로 발급할 수 있습니다. 잠시 후 다시 시도해 주세요.');
    }

    try {
      let nickname = '';
      try {
        nickname = String(await lookupSoopNickname(soopId) || '').trim().slice(0, 40);
      } catch (error) {
        console.warn('Could not resolve SOOP nickname for subscription request:', error.message || error);
      }
      await db.ref().update({
        [`${REQUESTS_PATH}/${requestId}`]: {
          requesterUid: uid,
          soopId,
          ...(nickname ? { nickname } : {}),
          verificationMethod: 'subscriber-comment-code',
          verificationCodeHash: verificationCodeHash(requestId, code),
          codeExpiresAt,
          status: 'pending',
          requestedAt: now,
        },
        [`${PENDING_PATH}/${requestId}`]: {
          status: 'pending',
          requestedAt: now,
          verificationMethod: 'subscriber-comment-code',
        },
        [`${SIGNALS_PATH}/${requestId}`]: { requestedAt: now },
      });
    } catch (error) {
      await transactionWithCachedValue(
        subscriptionRef.child('pendingRequestId'),
        (current) => current === requestId ? null : current,
      );
      throw error;
    }
    return { action: 'pending', requestId, soopId, code, codeExpiresAt, requestedAt: now };
  }

  if (action === 'renewCode') {
    await requireProtectedAccount(request);
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
    if (!REQUEST_ID_RE.test(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
    const code = createVerificationCode();
    const now = Date.now();
    const codeExpiresAt = now + VERIFICATION_CODE_TTL_MS;
    const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
    const result = await transactionWithCachedValue(requestRef, (current) => {
      const staleProcessing = current && current.status === 'processing' &&
        Number(current.processingAt) > 0 && now - Number(current.processingAt) >= PROCESSING_STALE_MS;
      if (!current || current.requesterUid !== uid || (current.status !== 'pending' && !staleProcessing) ||
          current.verificationMethod !== 'subscriber-comment-code') return;
      const lastIssuedAt = Number(current.codeIssuedAt) || Number(current.requestedAt) || 0;
      const currentCodeExpiresAt = Number(current.codeExpiresAt) || 0;
      // An expired code cannot be used, so let the requester replace it immediately.
      // Keep the cooldown only while a previously issued code is still valid.
      if (currentCodeExpiresAt > now && now - lastIssuedAt < VERIFICATION_CODE_COOLDOWN_MS) return;
      return {
        ...current,
        status: 'pending',
        processingAt: null,
        processingToken: null,
        verificationCodeHash: verificationCodeHash(requestId, code),
        codeExpiresAt,
        codeIssuedAt: now,
      };
    });
    if (!result.committed) {
      const current = result.snapshot.val();
      if (current && current.requesterUid === uid && current.status === 'processing' &&
          current.verificationMethod === 'subscriber-comment-code') {
        throw new HttpsError('failed-precondition', '관리자가 신청을 확인 중이에요. 확인이 끝난 뒤 상태를 새로고침해 주세요.');
      }
      if (!current || current.requesterUid !== uid || current.status !== 'pending' ||
          current.verificationMethod !== 'subscriber-comment-code') {
        throw new HttpsError('failed-precondition', '코드를 다시 발급할 수 있는 대기 중 신청이 없습니다. 신청 상태를 새로고침해 주세요.');
      }
      const lastIssuedAt = Number(current.codeIssuedAt) || Number(current.requestedAt) || 0;
      const retryAfterSeconds = Math.ceil((VERIFICATION_CODE_COOLDOWN_MS - (now - lastIssuedAt)) / 1000);
      throw new HttpsError(
        'resource-exhausted',
        '현재 인증 코드가 아직 유효해요. 잠시 후 다시 발급할 수 있습니다.',
        { retryAfterSeconds: Math.max(1, retryAfterSeconds) },
      );
    }
    await db.ref(`${PENDING_PATH}/${requestId}/status`).set('pending').catch(() => null);
    return { code, codeExpiresAt };
  }

  if (action === 'donationComplete') {
    await requireProtectedAccount(request);
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
    if (!REQUEST_ID_RE.test(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
    const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
    const now = Date.now();
    const result = await transactionWithCachedValue(requestRef, (current) => {
      if (!current || current.requesterUid !== uid || current.status !== 'pending' ||
          current.verificationMethod === 'subscriber-comment-code' ||
          !SOOP_ID_RE.test(String(current.donorSoopId || '')) ||
          ![10, 33].includes(Number(current.balloonCost))) return;
      if (Number(current.donationCompletedAt) > 0) return current;
      return { ...current, donationCompletedAt: now, updatedAt: now };
    });
    const completed = result.snapshot.val();
    if (!completed || completed.requesterUid !== uid || completed.status !== 'pending' || !(Number(completed.donationCompletedAt) > 0)) {
      throw new HttpsError('failed-precondition', '후원 확인을 시작할 수 있는 기존 대기 신청이 없습니다.');
    }
    await db.ref(`${PENDING_PATH}/${requestId}`).update({ donationCompletedAt: Number(completed.donationCompletedAt) || now });
    return { donationCompletedAt: Number(completed.donationCompletedAt) || now };
  }

  if (action === 'cancel') {
    await requireProtectedAccount(request);
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
    if (!REQUEST_ID_RE.test(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
    const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
    // Keep the RTDB value listener active until the conditional transaction finishes.
    const canceledAt = Date.now();
    const result = await transactionWithCachedValue(requestRef, (current) => {
      if (!current || current.requesterUid !== uid || current.status !== 'pending') return;
      return { ...current, status: 'cancelled', canceledAt, verificationCodeHash: null };
    });
    if (!result.committed) throw new HttpsError('failed-precondition', '취소할 수 있는 대기 중 신청이 없습니다.');
    await clearPending(db, requestId, uid);
    return { cancelled: true };
  }

  if (action === 'periodAccess') {
    const [subscriptionSnapshot, admin] = await Promise.all([subscriptionRef.get(), isAdmin(uid)]);
    const info = subscriptionInfo(subscriptionSnapshot.val(), Date.now());
    if (!admin && !info.subscribed) throw new HttpsError('permission-denied', '구독 계정에서 이용할 수 있습니다.');
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
    const allIds = Object.keys(pendingSnapshot.val() || {});
    const pendingIds = allIds.slice(-200);
    const requests = (await Promise.all(pendingIds.map(async (requestId) => {
      const record = await getRequest(db, requestId);
      if (!record || !['pending', 'processing'].includes(record.status)) return null;
      return {
        requestId,
        requesterUid: String(record.requesterUid || ''),
        nickname: String(record.nickname || '').slice(0, 40),
        soopId: String(record.soopId || record.donorSoopId || '').slice(0, 20),
        donorSoopId: String(record.donorSoopId || '').slice(0, 20),
        verificationMethod: String(record.verificationMethod || 'star-donation'),
        verificationSource: String(record.verificationSource || ''),
        codeExpiresAt: Math.max(0, Number(record.codeExpiresAt) || 0),
        donationCompletedAt: Math.max(0, Number(record.donationCompletedAt) || 0),
        status: record.status,
        requestedAt: Math.max(0, Number(record.requestedAt) || 0),
        processingAt: Math.max(0, Number(record.processingAt) || 0),
      };
    }))).filter(Boolean);
    requests.sort((a, b) => a.requestedAt - b.requestedAt);
    const unresolved = requests.filter((item) => item.soopId && !item.nickname).slice(-20);
    if (unresolved.length) {
      try {
        const nicknames = await lookupSoopNicknames(unresolved.map((item) => item.soopId), 4);
        const nicknameUpdates = {};
        for (const item of unresolved) {
          const nickname = String(nicknames.get(item.soopId.toLowerCase()) || '').trim().slice(0, 40);
          if (!nickname) continue;
          item.nickname = nickname;
          nicknameUpdates[`${REQUESTS_PATH}/${item.requestId}/nickname`] = nickname;
        }
        if (Object.keys(nicknameUpdates).length) await db.ref().update(nicknameUpdates);
      } catch (error) {
        console.warn('Could not resolve pending SOOP subscription nicknames:', error.message || error);
      }
    }
    return { requests, truncated: allIds.length > pendingIds.length };
  }

  if (action !== 'approve' && action !== 'reject') {
    throw new HttpsError('invalid-argument', '구독 신청 처리 방법을 확인해 주세요.');
  }
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
  if (!REQUEST_ID_RE.test(requestId)) throw new HttpsError('invalid-argument', '신청 번호를 확인해 주세요.');
  const requestRef = db.ref(`${REQUESTS_PATH}/${requestId}`);
  const now = Date.now();
  const initial = await requestRef.get();
  const initialRecord = initial.val();
  if (initialRecord && initialRecord.status === 'approved') {
    const existing = await db.ref(`${SUBSCRIPTIONS_PATH}/${initialRecord.requesterUid}`).get();
    return { ok: true, status: 'approved', expiresAt: Number(existing.val() && existing.val().expiresAt) || 0 };
  }
  if (!initialRecord || !['pending', 'processing'].includes(initialRecord.status)) {
    throw new HttpsError('failed-precondition', '대기 중인 신청이 아닙니다. 새로고침해 주세요.');
  }
  const isCodeFlow = initialRecord.verificationMethod === 'subscriber-comment-code';
  let verifiedSoopId = normalizedSoopId(data.commenterSoopId || data.verifiedSoopId);
  let approvedUntil = Number(data.approvedUntil) || 0;

  if (action === 'approve' && isCodeFlow) {
    const code = typeof data.verificationCode === 'string' ? data.verificationCode.trim().toUpperCase() : '';
    const expectedSoopId = normalizedSoopId(initialRecord.soopId);
    if (!data.activeSubscriptionConfirmed) throw new HttpsError('failed-precondition', 'SOOP 구독 상태를 확인한 뒤 체크해 주세요.');
    if (!SOOP_ID_RE.test(verifiedSoopId) || verifiedSoopId !== expectedSoopId) {
      throw new HttpsError('failed-precondition', '댓글 작성자의 방송국 아이디가 신청 아이디와 일치하지 않습니다.');
    }
    if (!VERIFICATION_CODE_RE.test(code) || Number(initialRecord.codeExpiresAt) <= now ||
        !safeCodeEquals(initialRecord.verificationCodeHash, { requestId, code })) {
      throw new HttpsError('failed-precondition', '댓글 코드가 틀렸거나 만료되었습니다. 신청자에게 새 코드를 발급받도록 안내해 주세요.');
    }
    if (!Number.isFinite(approvedUntil) || approvedUntil <= now || approvedUntil > now + 370 * 24 * 60 * 60 * 1000) {
      throw new HttpsError('invalid-argument', 'SOOP에서 확인한 구독 만료 시각을 입력해 주세요.');
    }
  } else if (action === 'approve') {
    verifiedSoopId = normalizedSoopId(initialRecord.donorSoopId);
    if (!SOOP_ID_RE.test(verifiedSoopId)) throw new HttpsError('failed-precondition', '기존 후원 신청의 SOOP 아이디를 확인할 수 없습니다.');
  }

  if (action === 'reject') {
    const result = await transactionWithCachedValue(requestRef, (current) => {
      if (!current || current.status !== 'pending') return;
      return { ...current, status: 'rejected', reviewedAt: now, reviewedBy: adminUid, verificationCodeHash: null };
    });
    if (!result.committed) throw new HttpsError('failed-precondition', '대기 중인 신청만 거절할 수 있습니다.');
    await clearPending(db, requestId, result.snapshot.val().requesterUid);
    return { ok: true, status: 'rejected' };
  }

  const claimToken = crypto.randomBytes(16).toString('hex');
  const claim = await transactionWithCachedValue(requestRef, (current) => {
    const staleProcessing = current && current.status === 'processing' &&
      now - (Number(current.processingAt) || 0) >= PROCESSING_STALE_MS;
    if (!current || (current.status !== 'pending' && !staleProcessing)) return;
    return { ...current, status: 'processing', reviewedBy: adminUid, processingAt: now, processingToken: claimToken };
  });
  if (!claim.committed) {
    const current = claim.snapshot.val();
    if (current && current.status === 'approved') {
      const existing = await db.ref(`${SUBSCRIPTIONS_PATH}/${current.requesterUid}`).get();
      await clearPending(db, requestId, current.requesterUid);
      return { ok: true, status: 'approved', expiresAt: Number(existing.val() && existing.val().expiresAt) || 0 };
    }
    throw new HttpsError('failed-precondition', '처리 중이거나 이미 처리된 신청입니다.');
  }

  const record = claim.snapshot.val();
  const soopClaimRef = db.ref(`${SOOP_CLAIMS_PATH}/${verifiedSoopId}`);
  let claimedSoopId = false;
  let previousSoopClaim = null;
  try {
    previousSoopClaim = (await soopClaimRef.get()).val();
    const soopClaim = await transactionWithCachedValue(soopClaimRef, (current) => {
      if (current && current.uid && current.uid !== record.requesterUid) return;
      if (current && current.uid === record.requesterUid) return current;
      return {
        uid: record.requesterUid,
        requestId,
        verifiedAt: now,
        verifiedBy: adminUid,
      };
    });
    claimedSoopId = soopClaim.committed && !previousSoopClaim &&
      !!(soopClaim.snapshot.val() && soopClaim.snapshot.val().requestId === requestId);
    if (!soopClaim.committed) {
      throw new HttpsError('already-exists', '이 SOOP 아이디는 다른 계정에 이미 연결되어 있습니다.');
    }

    await db.ref(`${PENDING_PATH}/${requestId}/status`).set('processing');
    const subscriptionRef = db.ref(`${SUBSCRIPTIONS_PATH}/${record.requesterUid}`);
    const entitlement = await transactionWithCachedValue(subscriptionRef, (current) => {
      const previous = current && typeof current === 'object' ? current : {};
      if (previous.lastApprovedRequestId === requestId) return previous;
      if (previous.pendingRequestId && previous.pendingRequestId !== requestId) return;
      const approvedAt = Date.now();
      const currentExpiry = Math.max(0, Number(previous.expiresAt) || 0);
      const expiresAt = isCodeFlow
        ? Math.max(approvedAt, currentExpiry, approvedUntil)
        : Math.max(approvedAt, currentExpiry) + LEGACY_SUBSCRIPTION_DURATION_MS;
      return {
        ...previous,
        expiresAt,
        soopId: verifiedSoopId,
        subscriptionSource: isCodeFlow ? 'soop-subscriber-comment' : 'legacy-star-donation',
        lastApprovedAt: approvedAt,
        lastApprovedRequestId: requestId,
      };
    });
    if (!entitlement.committed && entitlement.snapshot.val()?.lastApprovedRequestId !== requestId) {
      throw new HttpsError('aborted', '구독 기간 갱신을 완료하지 못했습니다. 다시 승인 처리해 주세요.');
    }
    const expiresAt = Number(entitlement.snapshot.val() && entitlement.snapshot.val().expiresAt) || 0;
    const finalized = await transactionWithCachedValue(requestRef, (current) => {
      if (!current || current.status !== 'processing' || current.processingToken !== claimToken) return;
      return {
        ...current,
        status: 'approved',
        reviewedAt: Date.now(),
        reviewedBy: adminUid,
        approvedUntil: expiresAt,
        verifiedSoopId,
        verificationCodeHash: null,
        codeConsumedAt: isCodeFlow ? Date.now() : null,
        processingAt: null,
        processingToken: null,
      };
    });
    if (!finalized.committed && !(finalized.snapshot.val() && finalized.snapshot.val().status === 'approved')) {
      throw new HttpsError('aborted', '구독 신청 상태를 완료로 바꾸지 못했습니다. 새로고침해 확인해 주세요.');
    }
    await clearPending(db, requestId, record.requesterUid);
    return { ok: true, status: 'approved', expiresAt };
  } catch (error) {
    if (claimedSoopId) {
      await transactionWithCachedValue(soopClaimRef, (current) => current && current.requestId === requestId ? previousSoopClaim : current).catch(() => null);
    }
    const restored = await transactionWithCachedValue(requestRef, (current) => {
      if (!current || current.status !== 'processing' || current.processingToken !== claimToken) return;
      return { ...current, status: 'pending', processingAt: null, processingToken: null };
    }).catch(() => null);
    if (restored && restored.committed) {
      const pending = restored.snapshot.val() || {};
      await db.ref(`${PENDING_PATH}/${requestId}`).set({
        status: 'pending',
        requestedAt: Number(pending.requestedAt) || 0,
        verificationMethod: String(pending.verificationMethod || 'star-donation'),
        donationCompletedAt: Number(pending.donationCompletedAt) || 0,
      }).catch(() => null);
    }
    throw error;
  }
});

exports.configureSoopNicknameLookups = configureSoopNicknameLookups;
