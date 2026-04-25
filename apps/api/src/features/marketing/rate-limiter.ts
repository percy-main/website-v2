/**
 * Tiny in-memory sliding-window rate limiter for the public lead endpoint.
 *
 * Sized for the expected lead volume (tens per day at most). If we ever grow
 * to multiple Fastify instances or higher volume, swap this for a shared
 * rate-limit plugin keyed off Redis. For now the simplicity is the feature.
 */
export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key: string) {
      const now = Date.now();
      const windowStart = now - opts.windowMs;
      const existing = (hits.get(key) ?? []).filter((t) => t > windowStart);
      existing.push(now);
      hits.set(key, existing);
      // Opportunistic prune: if every key seen during this tick has expired
      // out, remove it so the Map doesn't grow unbounded.
      if (Math.random() < 0.01) {
        for (const [k, v] of hits) {
          if (v.every((t) => t <= windowStart)) hits.delete(k);
        }
      }
      if (existing.length > opts.max) {
        const oldest = existing[0] ?? now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + opts.windowMs - now) / 1000),
          ),
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
