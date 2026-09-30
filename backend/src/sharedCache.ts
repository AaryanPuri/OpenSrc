/**
 * A JSON cache that Worker isolates share: the Cache API (`caches.default`) on Cloudflare,
 * an in-memory TTLCache elsewhere (Node, tests). On Workers a small per-isolate memory
 * layer sits in front, so a hot key doesn't even touch the Cache API.
 *
 * Keys are full URLs on the site's own origin (the Cache API wants a URL), built with
 * `cacheKey`. Failures never break a request: a broken cache just misses.
 */
import { TTLCache } from "./cache.js";

export interface JsonCache {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown, ttlMs: number): Promise<void>;
}

/** The subset of the Workers `Cache` this uses. */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

/** `https://opensrc.studio/__cache/<name>?<sorted params>`: one entry per normalized request. */
export function cacheKey(
  origin: string,
  name: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  return `${origin}/__cache/${name}?${p}`;
}

export function memoryJsonCache(maxEntries = 500): JsonCache {
  const store = new TTLCache<unknown>(60_000, maxEntries);
  return {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    put: async (key, value, ttlMs) => store.set(key, value, ttlMs),
  };
}

export function cacheApiJsonCache(cache: CacheLike): JsonCache {
  return {
    async get<T>(key: string) {
      try {
        const res = await cache.match(key);
        return res ? ((await res.json()) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    async put(key, value, ttlMs) {
      try {
        await cache.put(
          key,
          new Response(JSON.stringify(value), {
            headers: {
              "content-type": "application/json",
              "cache-control": `public, max-age=${Math.max(1, Math.round(ttlMs / 1000))}`,
            },
          }),
        );
      } catch {
        /* a failed write only costs a later miss */
      }
    },
  };
}

/** Memory first, then the next layer; a hit below refills memory for a short while. */
export function layeredJsonCache(front: JsonCache, back: JsonCache, frontTtlMs = 30_000): JsonCache {
  return {
    async get<T>(key: string) {
      const hit = await front.get<T>(key);
      if (hit !== undefined) return hit;
      const below = await back.get<T>(key);
      if (below !== undefined) await front.put(key, below, frontTtlMs);
      return below;
    },
    async put(key, value, ttlMs) {
      await Promise.all([front.put(key, value, Math.min(ttlMs, frontTtlMs)), back.put(key, value, ttlMs)]);
    },
  };
}

/** `caches.default` when the runtime has it (Workers), else memory only (Node). */
export function defaultJsonCache(): JsonCache {
  const cf = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
  return cf ? layeredJsonCache(memoryJsonCache(), cacheApiJsonCache(cf)) : memoryJsonCache();
}
