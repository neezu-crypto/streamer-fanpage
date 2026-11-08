'use strict';
const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { checkBugReportLimit, contentDigest } = require('./viewer-bug-report-policy');

// 단일 요청의 접수와 제한 예약은 멱등하게 연결한다. 브라우저는 이 경로를 직접 읽지 않는다.
async function submitBugReport({ db, uid, requestId, title, content, now = Date.now() }) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new HttpsError('invalid-argument', '요청 번호를 확인해 주세요.');
  if (typeof content !== 'string' || content.trim().length < 5 || content.length > 2000 || typeof title !== 'string' || title.length > 80) throw new HttpsError('invalid-argument', '제목과 오류 내용의 길이를 확인해 주세요.');
  const digest = contentDigest(content);
  const fingerprint = createHash('sha256').update(JSON.stringify([title.trim(), content.trim()])).digest('hex');
  const subject = createHash('sha256').update(uid).digest('hex');
  const reportId = createHash('sha256').update(uid + ':' + requestId).digest('hex');
  const limitRef = db.ref(`viewerStatsBugReportLimits/${subject}`);
  const reportRef = db.ref(`viewerStatsBugReports/${reportId}`);
  const existingReport = (await reportRef.get()).val();
  if (existingReport) {
    if (existingReport.senderUid !== uid || existingReport.fingerprint !== fingerprint) throw new HttpsError('already-exists', '같은 요청 번호가 다른 내용에 사용됐습니다.');
  }
  let rejection = '';
  let listener;
  await new Promise((resolve, reject) => { listener = () => resolve(); limitRef.on('value', listener, reject); });
  try {
    const reserved = await limitRef.transaction((current) => {
      rejection = '';
      const state = current && typeof current === 'object' ? current : {};
      const check = checkBugReportLimit(state, { now, digest, requestId });
      if (check.reason === 'replay') {
        const entry = state.requests[requestId];
        if (entry.fingerprint !== fingerprint) { rejection = 'request-conflict'; return; }
        if (entry.status === 'committed' && !existingReport) { rejection = 'already-processed'; return; }
        if (entry.status === 'reserved' && Number(entry.leaseUntil) <= now && !existingReport) {
          const otherRequests = { ...state.requests }; delete otherRequests[requestId];
          const renewed = checkBugReportLimit({ ...state, requests: otherRequests }, { now, digest, requestId });
          if (renewed.reason !== 'allowed') { rejection = renewed.reason; return; }
          return { ...state, requests: { ...state.requests, [requestId]: { ...entry, createdAt: now, leaseUntil: now + 600000 } } };
        }
        return state;
      }
      if (check.reason !== 'allowed') { rejection = check.reason; return; }
      return { ...state, requests: { ...(state.requests || {}), [requestId]: { digest, fingerprint, status: 'reserved', createdAt: now, leaseUntil: now + 600000, reportId } } };
    }, undefined, false);
    if (!reserved.committed) {
      const messages = {
        duplicate: '같은 내용을 24시간 이내에 이미 제보했습니다.',
        cooldown: '제보 후 1분이 지나면 다시 보낼 수 있습니다.',
        'daily-limit': '하루에 제보를 최대 5건 보낼 수 있습니다. 한국 시간 자정 이후 다시 시도해 주세요.',
        'request-conflict': '같은 요청 번호를 다른 내용에 사용할 수 없습니다.',
        'already-processed': '이미 처리된 요청입니다. 새로운 제보를 작성해 주세요.',
      };
      throw new HttpsError('resource-exhausted', messages[rejection] || '제보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    const saved = await reportRef.transaction((current) => {
      if (current) return current.senderUid === uid && current.fingerprint === fingerprint ? current : undefined;
      return { senderUid: uid, title: title.trim(), content: content.trim(), digest, fingerprint, status: 'open', createdAt: now, requestId };
    }, undefined, false);
    if (!saved.committed) throw new HttpsError('already-exists', '같은 요청 번호가 다른 내용에 사용됐습니다.');
    const completed = await limitRef.transaction((current) => {
      const entry = current?.requests?.[requestId];
      if (!entry || entry.digest !== digest) return;
      return { ...current, requests: { ...current.requests, [requestId]: { ...entry, status: 'committed' } } };
    }, undefined, false);
    if (!completed.committed) throw new HttpsError('aborted', '제보는 저장됐지만 접수 상태를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
    return { submitted: true, reportId };
  } finally { limitRef.off('value', listener); }
}
async function bugReportStatus({ db, uid, requestId }) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new HttpsError('invalid-argument', '요청 번호를 확인해 주세요.');
  const subject = createHash('sha256').update(uid).digest('hex');
  const reportId = createHash('sha256').update(uid + ':' + requestId).digest('hex');
  const [reportSnap, limitSnap] = await Promise.all([
    db.ref(`viewerStatsBugReports/${reportId}`).get(),
    db.ref(`viewerStatsBugReportLimits/${subject}`).get(),
  ]);
  const report = reportSnap.val();
  const entry = limitSnap.val()?.requests?.[requestId];
  if ((report?.senderUid === uid || report?.status === 'deleted') && entry?.status === 'reserved') {
    // 저장 성공 후 제한 기록 확정이 실패한 경우에는 결과 확인 시 같은 예약을 복구한다.
    // 내용과 요청 번호가 다른 레코드를 확정하지 않도록 서버 지문을 함께 확인한다.
    if (entry.reportId !== reportId || (report.status !== 'deleted' && (entry.fingerprint !== report.fingerprint || entry.digest !== report.digest))) {
      throw new HttpsError('aborted', '제보 접수 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.');
    }
    const ref = db.ref(`viewerStatsBugReportLimits/${subject}`);
    let listener;
    await new Promise((resolve, reject) => { listener = () => resolve(); ref.on('value', listener, reject); });
    try {
      const result = await ref.transaction((current) => {
        const reserved = current?.requests?.[requestId];
        if (!reserved || reserved.fingerprint !== entry.fingerprint || reserved.digest !== entry.digest || reserved.reportId !== reportId) return;
        if (reserved.status === 'committed') return current;
        if (reserved.status !== 'reserved') return;
        return { ...current, requests: { ...current.requests, [requestId]: { ...reserved, status: 'committed' } } };
      }, undefined, false);
      if (!result.committed) throw new HttpsError('aborted', '제보 접수 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.');
    } finally { ref.off('value', listener); }
  }
  if (report?.senderUid === uid || report?.status === 'deleted') return { status: 'submitted', reportId };
  if (!entry) return { status: 'unknown' };
  if (entry.status === 'committed') return { status: 'submitted', reportId };
  return { status: 'pending', reportId };
}
module.exports = { submitBugReport, bugReportStatus };
