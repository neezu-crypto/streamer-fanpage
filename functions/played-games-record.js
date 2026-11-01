'use strict';

const OP_GG_REGIONS = new Set(['br', 'eune', 'euw', 'jp', 'kr', 'lan', 'las', 'me', 'na', 'oce', 'ru', 'sea', 'tr']);
const OP_GG_GAME_CONFIG = Object.freeze({
  'league-of-legends': {
    name: '리그 오브 레전드',
    aliases: /^(?:league of legends|리그 오브 레전드|롤)$/i,
    accountField: 'riotId',
    gameUrl: 'https://www.leagueoflegends.com/ko-kr/',
  },
  valorant: {
    name: '발로란트',
    aliases: /^(?:valorant|발로란트)$/i,
    accountField: 'riotId',
    gameUrl: 'https://playvalorant.com/ko-kr/',
  },
  overwatch: {
    name: '오버워치 2',
    aliases: /^(?:overwatch(?:\s*2)?|오버워치(?:\s*2)?)$/i,
    accountField: 'battleTag',
    gameUrl: 'https://overwatch.blizzard.com/ko-kr/',
  },
  pubg: {
    name: '배틀그라운드',
    aliases: /^(?:pubg(?:\s*:\s*battlegrounds)?|playerunknown'?s battlegrounds|배틀그라운드|펍지)$/i,
    accountField: 'pubgNickname',
    gameUrl: 'https://pubg.com/ko/',
  },
});

const OVERWATCH_OP_GG_REGIONS = new Set(['global', 'us', 'eu', 'kr']);

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

function normalizeBattleTag(value) {
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const input = value.trim();
  const separator = input.lastIndexOf('#');
  if (separator < 1 || separator !== input.indexOf('#')) return null;
  const name = input.slice(0, separator).trim();
  const numericTag = input.slice(separator + 1).trim();
  if (!name || name.length > 100 || !/^\d{3,12}$/.test(numericTag)) return null;
  return `${name}#${numericTag}`;
}

function normalizePubgNickname(value) {
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const nickname = value.trim();
  return nickname ? nickname : null;
}

function normalizeOpggAccountId(gameType, value) {
  const config = OP_GG_GAME_CONFIG[gameType];
  if (!config) return null;
  if (config.accountField === 'riotId') return normalizeRiotId(value);
  if (config.accountField === 'battleTag') return normalizeBattleTag(value);
  if (config.accountField === 'pubgNickname') return normalizePubgNickname(value);
  return null;
}

function normalizeOverwatchOpggRegion(value) {
  const region = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OVERWATCH_OP_GG_REGIONS.has(region) ? region : 'global';
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

function getOpggGameType(game) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) return '';
  if (Object.hasOwn(OP_GG_GAME_CONFIG, game.gameType)) return game.gameType;
  const name = typeof game.name === 'string' ? game.name.trim() : '';
  return Object.entries(OP_GG_GAME_CONFIG).find(([, config]) => config.aliases.test(name))?.[0] || '';
}

function isOpggGame(game, gameType) {
  return Boolean(gameType && getOpggGameType(game) === gameType);
}

function upsertOpggAccount(current, { gameType, accountId, opggRegion, overwatchRegion, requestedAppId = '', newAppId, maxItems, now = Date.now() }) {
  const config = OP_GG_GAME_CONFIG[gameType];
  const normalizedAccountId = normalizeOpggAccountId(gameType, accountId);
  if (!config || !normalizedAccountId) return { ok: false, error: 'invalid-account' };
  const games = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  let appId = requestedAppId;
  if (appId && (!games[appId] || !isOpggGame(games[appId], gameType))) return { ok: false, error: 'invalid-target' };
  if (!appId) appId = Object.entries(games).find(([, game]) => isOpggGame(game, gameType))?.[0] || '';
  const existing = appId ? games[appId] : null;
  if (!existing && Object.keys(games).length >= maxItems) return { ok: false, error: 'full' };
  if (!appId) appId = newAppId;
  const entry = existing
    ? { ...existing, name: config.name, gameType, [config.accountField]: normalizedAccountId }
    : {
      name: config.name, gameType,
      gameUrl: config.gameUrl, thumbnailUrl: '',
      createdAt: now, vods: {}, [config.accountField]: normalizedAccountId,
    };
  if (gameType === 'league-of-legends') entry.opggRegion = normalizeOpggRegion(opggRegion) || 'kr';
  if (gameType === 'overwatch') entry.overwatchRegion = normalizeOverwatchOpggRegion(overwatchRegion);
  return { ok: true, appId, games: { ...games, [appId]: entry } };
}

function disconnectOpggAccount(game) {
  const gameType = getOpggGameType(game);
  const config = OP_GG_GAME_CONFIG[gameType];
  if (!config) return null;
  const updated = { ...game, gameType };
  delete updated[config.accountField];
  if (gameType === 'league-of-legends') delete updated.opggRegion;
  if (gameType === 'overwatch') delete updated.overwatchRegion;
  return updated;
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
  OP_GG_GAME_CONFIG,
  OVERWATCH_OP_GG_REGIONS,
  disconnectOpggAccount,
  disconnectLeagueOfLegendsAccount,
  getOpggGameType,
  isLeagueOfLegendsGame,
  isOpggGame,
  isPlayedGameId,
  normalizeOpggRegion,
  normalizeOverwatchOpggRegion,
  normalizeOpggAccountId,
  normalizeBattleTag,
  normalizePubgNickname,
  normalizeRiotId,
  normalizePlayedGameBestRecord,
  normalizePlayedGameLink,
  parseCustomPlayedGameLink,
  updatePlayedGameBestRecord,
  upsertOpggAccount,
  upsertLeagueOfLegendsAccount,
};
