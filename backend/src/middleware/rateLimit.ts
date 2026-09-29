/**
 * In-memory token buckets, one per key (an IP). Good enough to stop a script hammering
 * the newsletter form from one address. On Workers each isolate has its own memory
 * and isolates come and go, so there it only slows abuse down; the per-address
 * resend limit in the newsletter routes is the durable guard.
 */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    /** Burst size. */
    private capacity: number,
    /** Milliseconds to regain one token. */
    private refillMs: number,
    private maxKeys = 10_000,
  ) {}

  /** Takes one token for `key`; false when the bucket is empty. */
  take(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    } else {
      const regained = Math.floor((now - b.at) / this.refillMs);
      if (regained > 0) {
        b.tokens = Math.min(this.capacity, b.tokens + regained);
        b.at = b.tokens === this.capacity ? now : b.at + regained * this.refillMs;
      }
    }
    if (b.tokens <= 0) return false;
    b.tokens--;
    return true;
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) {
      if (now - b.at >= this.capacity * this.refillMs) this.buckets.delete(k);
    }
    // Still full: drop the oldest half rather than grow without bound.
    if (this.buckets.size >= this.maxKeys) {
      const keys = [...this.buckets.keys()];
      for (const k of keys.slice(0, keys.length >> 1)) this.buckets.delete(k);
    }
  }
}
