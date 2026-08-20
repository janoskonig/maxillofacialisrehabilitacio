import { createHash } from 'node:crypto';
import { HttpError } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

type CronRequest = {
  headers: { get(name: string): string | null };
  nextUrl: { searchParams: URLSearchParams };
};

/**
 * Non-reversible fingerprint for log output: hossz + a SHA-256 első 8 hex jegye.
 * Ennyiből össze lehet hasonlítani a cron service és a web service kulcsát anélkül,
 * hogy a titok bekerülne a logba.
 */
function fingerprint(value: string | null | undefined): string {
  if (!value) return 'none';
  return `len=${value.length} sha=${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
}

/**
 * Returns true only when a cron API key is configured (the env var is set) AND the
 * request presents the matching key. When the env var is unset it returns false —
 * i.e. it FAILS CLOSED.
 *
 * This replaces the `if (expectedKey && provided !== expectedKey)` pattern that was
 * repeated across the cron endpoints. That pattern skipped the check entirely when
 * the key was unset, leaving these state-mutating / patient-notifying endpoints open
 * to anonymous callers on any deployment that hadn't configured the key (which none
 * of .env.example documented).
 *
 * Accepts the key via the `x-api-key` header or the `api_key` / `apiKey` query param
 * (both spellings were used across the existing endpoints). A hívó (scripts/cron-sync.js)
 * MINDHÁRMAT elküldi, ezért mindegyiket megvizsgáljuk: korábban az első nem-üres érték
 * nyert, így egy proxy/WAF által átírt `x-api-key` fejléc kizárta a helyes query paramot
 * is — néma, állandó 401 minden cron végponton.
 *
 * Mindkét oldalt trimmeljük: a Render dashboardba beillesztett kulcs végén maradt
 * szóköz/újsor egyébként szintén néma 401-et okoz, amit a hívó oldal csak
 * státuszkódként lát.
 * Sikertelen egyeztetéskor ujjlenyomatot logolunk, hogy a "nincs beállítva", a "más a
 * kulcs" és a "csak az egyik csatorna romlott el" eset megkülönböztethető legyen.
 */
export function hasValidCronKey(req: CronRequest, envName: string): boolean {
  const expected = process.env[envName]?.trim();
  const candidates: Array<[string, string]> = [
    ['x-api-key', (req.headers.get('x-api-key') ?? '').trim()],
    ['api_key', (req.nextUrl.searchParams.get('api_key') ?? '').trim()],
    ['apiKey', (req.nextUrl.searchParams.get('apiKey') ?? '').trim()],
  ];
  const supplied = candidates.filter(([, value]) => value !== '');

  if (expected && supplied.some(([, value]) => value === expected)) return true;

  // Kulcs nélküli hívás (pl. bejelentkezett admin a böngészőből) nem naplózandó —
  // csak az érdekel, amikor valaki kulccsal próbálkozott és mégsem ment át.
  if (supplied.length === 0) return false;

  logger.error(
    `[cron-auth] Elutasított cron hívás — env=${envName} ` +
      `elvárt=${expected ? fingerprint(expected) : 'NINCS BEÁLLÍTVA'} ` +
      `kapott=[${supplied.map(([name, value]) => `${name}: ${fingerprint(value)}`).join(', ')}]`,
  );
  return false;
}

/**
 * Throws HttpError(401) unless a valid cron key is present. Use for key-only cron
 * endpoints (no interactive fallback). Handlers wrapped with apiHandler route the
 * throw through handleApiError automatically.
 */
export function requireCronKey(req: CronRequest, envName: string): void {
  if (!hasValidCronKey(req, envName)) {
    throw new HttpError(401, 'Unauthorized', 'UNAUTHORIZED');
  }
}
