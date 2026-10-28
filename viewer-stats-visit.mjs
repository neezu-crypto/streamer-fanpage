export function createViewerStatsVisitNotifier(callVisit, onError = () => {}) {
  const attemptedUids = new Set();

  return async function notifyVerifiedStreamerVisit(user) {
    const uid = user && typeof user.uid === 'string' ? user.uid.trim() : '';
    if (!uid || user.isAnonymous || attemptedUids.has(uid)) return false;

    attemptedUids.add(uid);
    try {
      await callVisit();
      return true;
    } catch (error) {
      attemptedUids.delete(uid);
      onError(error);
      return false;
    }
  };
}
