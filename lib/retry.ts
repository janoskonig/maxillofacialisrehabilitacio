/**
 * Retry helper exponenciális backoff-fel, jitterrel és Retry-After header támogatással
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryOptions = {
  retries: number; // pl. 3
  baseDelayMs: number; // pl. 500
  maxDelayMs: number; // pl. 4000
  jitterRatio?: number; // pl. 0.2
  shouldRetry: (err: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown; retryAfter?: number }) => void;
};

/**
 * Retry mechanizmus exponenciális backoff-fel, jitterrel és Retry-After header támogatással
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const jitterRatio = opts.jitterRatio ?? 0.2;

  let attempt = 0;
  // attempt: 0 = első futás, hibánál jön az 1..retries retry

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.retries || !opts.shouldRetry(err)) {
        throw err;
      }

      attempt += 1;

      // Retry-After header ellenőrzése (ha van, azt preferáljuk)
      let delayMs: number;
      const retryAfter = extractRetryAfter(err);
      
      if (retryAfter !== null) {
        // Retry-After header értéke (másodpercben vagy HTTP date string)
        delayMs = retryAfter * 1000; // másodpercből milliszekundumba
        // Max delay korlátozás (biztonság)
        delayMs = Math.min(delayMs, opts.maxDelayMs);
      } else {
        // Exponenciális backoff + jitter
        const exp = Math.pow(2, attempt - 1);
        const raw = Math.min(opts.maxDelayMs, opts.baseDelayMs * exp);
        const jitter = raw * jitterRatio * (Math.random() * 2 - 1); // +/- jitter
        delayMs = Math.max(0, Math.round(raw + jitter));
      }

      opts.onRetry?.({ attempt, delayMs, err, retryAfter: retryAfter !== null ? retryAfter : undefined });
      await sleep(delayMs);
    }
  }
}

/**
 * Retry-After header kinyerése error response-ből
 * @returns Retry-After érték másodpercben, vagy null ha nincs
 */
function extractRetryAfter(err: unknown): number | null {
  const e = err as any;
  const headers = e?.response?.headers || e?.headers;
  
  if (!headers) {
    return null;
  }

  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  
  if (!retryAfter) {
    return null;
  }

  // Ha szám (másodperc), azt használjuk
  const numeric = Number(retryAfter);
  if (!isNaN(numeric) && numeric > 0) {
    return numeric;
  }

  // Ha HTTP date string, számoljuk ki a különbséget
  try {
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((date.getTime() - now) / 1000));
      return diff;
    }
  } catch {
    // Invalid date, ignore
  }

  return null;
}
