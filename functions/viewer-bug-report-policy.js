'use strict';
const { createHash } = require('node:crypto');
const DAY = 86400000;
function normalizeContent(text) { return String(text || '').trim().replace(/\s+/gu, ' '); }
function contentDigest(text) { return createHash('sha256').update(normalizeContent(text)).digest('hex'); }
function kstDay(now) { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
function checkBugReportLimit(state, { now, digest, requestId }) {
  const record = state && typeof state === 'object' ? state : {};
  const requests = record.requests && typeof record.requests === 'object' ? record.requests : {};
  const existing = requests[requestId];
  if (existing) return existing.digest === digest ? { reason: 'replay' } : { reason: 'request-conflict' };
  const today = kstDay(now);
  const recent = Object.values(requests).filter((item) => item && (item.status === 'committed' || (item.status === 'reserved' && Number(item.leaseUntil) > now)));
  if (recent.some((item) => item.digest === digest && now - Number(item.createdAt) < DAY && now >= Number(item.createdAt))) return { reason: 'duplicate' };
  if (recent.some((item) => now - Number(item.createdAt) < 60000 && now >= Number(item.createdAt))) return { reason: 'cooldown' };
  if (recent.filter((item) => kstDay(Number(item.createdAt)) === today).length >= 5) return { reason: 'daily-limit' };
  return { reason: 'allowed' };
}
module.exports = { normalizeContent, contentDigest, kstDay, checkBugReportLimit };
