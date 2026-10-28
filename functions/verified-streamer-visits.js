'use strict';

const SOOP_ID_PATTERN = /^[a-z0-9]{2,20}$/i;
const VISIT_MARKETS = new Set(['streamerFanPage', 'viewerStats']);

async function recordVerifiedStreamerVisit(db, verified, market, dateKey, visitedAt = Date.now()) {
  if (!VISIT_MARKETS.has(market)) throw new Error('Unsupported verified streamer visit market.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) throw new Error('Invalid visit date key.');
  const soopId = String(verified && verified.streamer && verified.streamer.soopId || '').trim().toLowerCase();
  if (!SOOP_ID_PATTERN.test(soopId)) return false;

  // The public SOOP ID is sufficient for daily deduplication; Firebase UIDs are not written to visit logs.
  const dedupRef = db.ref(`verifiedStreamerVisitDedup/${market}/${dateKey}/${soopId}`);
  let alreadyLogged = false;
  const dedupResult = await dedupRef.transaction((current) => {
    if (current) {
      alreadyLogged = true;
      return;
    }
    return true;
  });
  if (!dedupResult.committed || alreadyLogged) return false;

  try {
    const eventRef = db.ref('verifiedStreamerVisits').push();
    await eventRef.set({
      nickname: String(verified.streamer.nickname || '').slice(0, 40),
      soopId,
      market,
      visitedAt: Number(visitedAt) || Date.now(),
    });
  } catch (error) {
    await dedupRef.remove().catch(() => {});
    throw error;
  }
  return true;
}

async function pruneVerifiedStreamerVisitDedup(db, markets, todayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayKey || ''))) throw new Error('Invalid current date key.');
  await Promise.all([...new Set(markets)].filter((market) => VISIT_MARKETS.has(market)).map(async (market) => {
    const ref = db.ref(`verifiedStreamerVisitDedup/${market}`);
    const snapshot = await ref.get();
    const updates = {};
    Object.keys(snapshot.val() || {}).forEach((key) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < todayKey) updates[key] = null;
    });
    if (Object.keys(updates).length) await ref.update(updates);
  }));
}

module.exports = { pruneVerifiedStreamerVisitDedup, recordVerifiedStreamerVisit };
