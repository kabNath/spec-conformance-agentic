// Fixed-window rate limit per API key, in memory. Honest limits: it is per process (with several instances the real
// limit is limit x instances) and resets on restart. Good enough for a single-instance pilot; move it to the database
// or a gateway before running more than one instance.
export class RateLimiter {
  private windows = new Map<string, { start: number; n: number }>();
  constructor(private limit: number, private windowMs = 60_000, private now: () => number = Date.now) {}

  check(key: string): { ok: boolean; limit: number; remaining: number; retryAfterSec: number } {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) { w = { start: t, n: 0 }; this.windows.set(key, w); if (this.windows.size > 10_000) this.sweep(t); }
    w.n++;
    const retryAfterSec = Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000));
    return { ok: w.n <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - w.n), retryAfterSec };
  }
  private sweep(t: number) { for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k); }
}

/** RATE_LIMIT_PER_MIN (default 60 requests per minute and API key). */
export const limiterFromEnv = (env: Record<string, string | undefined> = process.env) =>
  new RateLimiter(Math.max(1, Number(env.RATE_LIMIT_PER_MIN) || 60));
