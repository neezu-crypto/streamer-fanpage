'use strict';

const OP_GG_REGIONS = new Set(['br', 'eune', 'euw', 'jp', 'kr', 'lan', 'las', 'me', 'na', 'oce', 'ru', 'sea', 'tr']);

function normalizeRiotId(value) {
  if (typeof value !== 'string' || value.length > 120) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const input = value.trim();
  const separator = input.indexOf('#');
  if (separator < 1 || separator !== input.lastIndexOf('#')) return null;
  const gameName = input.slice(0, separator).trim();
  const tagLine = input.slice(separator + 1).trim();
  if (!gameName || !tagLine || gameName.length > 100 || tagLine.length > 20) return null;
  return `${gameName}#${tagLine}`;
}

function normalizeOpggRegion(value) {
  const region = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OP_GG_REGIONS.has(region) ? region : '';
}

function isLeagueOfLegendsGame(game) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) return false;
  if (game.gameType === 'league-of-legends') return true;
  return typeof game.name === 'string' && /^(?:league of legends|리그 오브 레전드|롤)$/i.test(game.name.trim());
}

function upsertLeagueOfLegendsAccount(current, { riotId, opggRegion, requestedAppId = '', newAppId, maxItems, now = Date.now() }) {
  const games = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  let appId = requestedAppId;
  if (appId && (!games[appId] || !isLeagueOfLegendsGame(games[appId]))) return { ok: false, error: 'invalid-target' };
  if (!appId) appId = Object.entries(games).find(([, game]) => isLeagueOfLegendsGame(game))?.[0] || '';
  const existing = appId ? games[appId] : null;
  if (!existing && Object.keys(games).length >= maxItems) return { ok: false, error: 'full' };
  if (!appId) appId = newAppId;
  const entry = existing
    ? { ...existing, name: '리그 오브 레전드', gameType: 'league-of-legends', riotId, opggRegion }
    : {
      name: '리그 오브 레전드', gameType: 'league-of-legends',
      gameUrl: 'https://www.leagueoflegends.com/ko-kr/', thumbnailUrl: '',
      createdAt: now, vods: {}, riotId, opggRegion,
    };
  return { ok: true, appId, games: { ...games, [appId]: entry } };
}

function disconnectLeagueOfLegendsAccount(game) {
  if (!isLeagueOfLegendsGame(game)) return null;
  const updated = { ...game, gameType: 'league-of-legends' };
  delete updated.riotId;
  delete updated.opggRegion;
  return updated;
}

function normalizePlayedGameBestRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['rank', 'record'].includes(value.type)
    || typeof value.value !== 'string' || !value.value.trim()) return null;
  return { type: value.type, value: value.value.trim().slice(0, 100) };
}

function updatePlayedGameBestRecord(game, record, updatedAt = Date.now()) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) return null;
  const updated = { ...game };
  if (record && record.value) updated.bestRecord = { type: record.type, value: record.value, updatedAt };
  else delete updated.bestRecord;
  return updated;
}

function isPlayedGameId(value) {
  return /^(?:[1-9]\d{0,9}|custom_[a-f0-9]{32})$/.test(String(value || ''));
}

function normalizePlayedGameLink(value, gameId) {
  if (/^[1-9]\d{0,9}$/.test(String(gameId || ''))) return `https://store.steampowered.com/app/${gameId}/`;
  if (typeof value === 'string' && value.trim() && value.length <= 500) {
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password && !parsed.port) return parsed.href;
    } catch (_) { /* Fall back to the canonical legacy Steam URL when possible. */ }
  }
  return '';
}

function parseCustomPlayedGameLink(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.port) return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

module.exports = {
  OP_GG_REGIONS,
  disconnectLeagueOfLegendsAccount,
  isLeagueOfLegendsGame,
  isPlayedGameId,
  normalizeOpggRegion,
  normalizeRiotId,
  normalizePlayedGameBestRecord,
  normalizePlayedGameLink,
  parseCustomPlayedGameLink,
  updatePlayedGameBestRecord,
  upsertLeagueOfLegendsAccount,
};
