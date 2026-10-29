'use strict';

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
  isPlayedGameId,
  normalizePlayedGameBestRecord,
  normalizePlayedGameLink,
  parseCustomPlayedGameLink,
  updatePlayedGameBestRecord,
};
