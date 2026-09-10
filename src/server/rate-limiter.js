/**
 * In-memory token-bucket rate limiter, keyed by client address. Each key
 * gets `perMinute` tokens that refill continuously; a request spends one.
 * A limit of 0 disables the limiter entirely. This is a fairness guard for
 * a single-instance deployment, not a distributed quota: the global
 * MAX_QUEUE cap in worker-client.js remains the hard backstop on load.
 */
export function createRateLimiter({ perMinute, now = () => Date.now(), maxKeys = 10_000 }) {
  const buckets = new Map();
  const capacity = perMinute;
  const refillPerMs = perMinute / 60_000;

  function prune(time) {
    // A full bucket carries no state worth keeping; drop those first.
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + (time - bucket.updated) * refillPerMs >= capacity) buckets.delete(key);
    }
    // Still over the cap (a flood of distinct addresses): drop the oldest.
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
  }

  return {
    enabled: perMinute > 0,
    /** Returns { allowed: true } or { allowed: false, retryAfterSeconds }. */
    take(key) {
      if (!(perMinute > 0)) return { allowed: true };
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) prune(time);
        bucket = { tokens: capacity, updated: time };
        buckets.set(key, bucket);
      } else {
        bucket.tokens = Math.min(capacity, bucket.tokens + (time - bucket.updated) * refillPerMs);
        bucket.updated = time;
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true };
      }
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) };
    },
  };
}

/**
 * The client address used as the rate-limit key. Behind a trusted reverse
 * proxy this is the first X-Forwarded-For entry; a client can put a forged
 * value there, which only lets it spend a different bucket — total load is
 * still bounded by the global queue.
 */
export function clientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
    if (first) return first;
  }
  return request.socket?.remoteAddress ?? 'unknown';
}
