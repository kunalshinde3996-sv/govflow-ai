// Per-user sliding-window rate limiter (in-memory; adequate for a single API instance).
const hits = new Map();

export function checkRate(userId, { limit = Number(process.env.ASSISTANT_RATE_LIMIT || 20), windowMs = 60_000, now = Date.now() } = {}) {
  const arr = (hits.get(userId) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(userId, arr);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  hits.set(userId, arr);
  return { ok: true };
}
export const resetRateLimits = () => hits.clear();
