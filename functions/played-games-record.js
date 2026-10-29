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

module.exports = { normalizePlayedGameBestRecord, updatePlayedGameBestRecord };
