'use strict';

// 횟수형 상품 제한이 아니라 짧은 순간의 자동 반복 요청만 완화한다.
const WINDOW_MS = 10000;
const BURST_LIMIT = 30;
function nextPaidBurstState(current, now) {
  if (!Number.isFinite(now)) throw new Error('invalid-time');
  const timestamps = (Array.isArray(current?.timestamps) ? current.timestamps : [])
    .filter((value) => Number.isFinite(value) && value > now - WINDOW_MS && value <= now)
    .slice(-BURST_LIMIT);
  if (timestamps.length >= BURST_LIMIT) return { allowed: false, retryAfterMs: Math.max(1, timestamps[0] + WINDOW_MS - now) };
  return { allowed: true, state: { timestamps: [...timestamps, now] } };
}
module.exports = { nextPaidBurstState, WINDOW_MS, BURST_LIMIT };
