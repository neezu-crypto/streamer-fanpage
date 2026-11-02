const SUPPRESSED_SOOP_SEARCH_IDS = new Set(['naaary']);
const SUPPRESSED_SOOP_SEARCH_NICKNAMES = new Set(['나리$']);

function normalizeSearchIdentity(value) {
  return String(value || '').trim().normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
}

function isSuppressedSoopSearchResult(streamer) {
  const soopId = normalizeSearchIdentity(streamer && (streamer.soopId || streamer.id));
  const nickname = normalizeSearchIdentity(streamer && streamer.nickname);
  return SUPPRESSED_SOOP_SEARCH_IDS.has(soopId)
    || SUPPRESSED_SOOP_SEARCH_NICKNAMES.has(nickname);
}

function isSuppressedSoopSearchQuery(query) {
  const normalized = normalizeSearchIdentity(query);
  return SUPPRESSED_SOOP_SEARCH_IDS.has(normalized)
    || SUPPRESSED_SOOP_SEARCH_NICKNAMES.has(normalized);
}

module.exports = { isSuppressedSoopSearchQuery, isSuppressedSoopSearchResult };
