/**
 * Egyszerű in-memory sliding-window rate limiter (Slice 0.8).
 *
 * Csak az aktuális Node folyamatban él — több instance esetén minden példány
 * külön számláló. Fázis 5: `checkRateLimitAsync` Redis-et használ, ha
 * `REDIS_URL` be van állítva; különben vagy hiba esetén memória fallback.
 *
 * Használat:
 *   const result = await checkRateLimitAsync({ key: `msg:${userId}`, limit: 30, windowMs: 60_000 });
 *   if (!result.allowed) return new Response(...429...);
 *
 * A `key`-nek elég dimenziót adni, hogy a hívó tudja szétválasztani:
 * pl. `msg-patient:{userId}`, `msg-doctor:{userId}` külön számolódik.
 */

import { checkRedisRateLimit } from './rate-limit-redis';

interface BucketState {
  // Időbélyegek (ms), a legrégebbi elsőként; a window-on kívül esőket
  // a checkRateLimit minden híváskor lemetszi.
  timestamps: number[];
}

const buckets = new Map<string, BucketState>();

export interface RateLimitOptions {
  key: string;
  /** Hány esemény engedélyezett a window-ban. */
  limit: number;
  /** Sliding window mérete ms-ban. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hány eseményre van még kapacitás a window végéig. */
  remaining: number;
  /** Mikor szabadul fel kapacitás (ha allowed=false) — unix ms. */
  resetAt: number;
  /** Hány eseményt számoltunk a window-ban (a mostanival együtt). */
  used: number;
}

/**
 * Egy eseményt rögzít és visszaadja a kvótát.
 *
 *  - Ha még belefért: `allowed = true`, és a `timestamps`-be tett egy bejegyzést.
 *  - Ha telített: `allowed = false`, és NEM tesz bele újabb bejegyzést.
 *
 * A `resetAt` mindig a window-ban legkorábbi esemény + windowMs.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const cutoff = now - opts.windowMs;

  let bucket = buckets.get(opts.key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(opts.key, bucket);
  }

  // Töröljük a window-on kívül esőket.
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] < cutoff) {
    bucket.timestamps.shift();
  }

  const oldest = bucket.timestamps[0] ?? now;
  const resetAt = oldest + opts.windowMs;

  if (bucket.timestamps.length >= opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      used: bucket.timestamps.length,
    };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    remaining: opts.limit - bucket.timestamps.length,
    resetAt: bucket.timestamps[0] + opts.windowMs,
    used: bucket.timestamps.length,
  };
}

/**
 * Fázis 5 — Redis (ha elérhető), különben in-memory sliding window.
 */
export async function checkRateLimitAsync(opts: RateLimitOptions): Promise<RateLimitResult> {
  if (process.env.REDIS_URL?.trim()) {
    try {
      return await checkRedisRateLimit(opts);
    } catch {
      // Redis átmenetileg nem elérhető — ne blokkoljuk a küldést teljesen,
      // essünk vissza process-szintű limitre.
    }
  }
  return checkRateLimit(opts);
}

/**
 * Tisztító hook teszthez / üzemeltetéshez. Production-ben nem érdemes hívni.
 */
export function resetRateLimit(key?: string): void {
  if (key) {
    buckets.delete(key);
  } else {
    buckets.clear();
  }
}

/**
 * Standard 429 JSON Response payload + Retry-After header érték.
 * A hívó NextResponse.json + a `headers` Map-ot tud használni.
 */
export function buildRateLimitedResponse(result: RateLimitResult, message?: string): {
  body: { error: string; retryAfterMs: number };
  retryAfterSeconds: number;
} {
  const retryAfterMs = Math.max(0, result.resetAt - Date.now());
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return {
    body: {
      error: message ?? 'Túl sok kérés — várj egy kicsit, majd próbáld újra.',
      retryAfterMs,
    },
    retryAfterSeconds,
  };
}
