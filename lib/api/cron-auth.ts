import { HttpError } from '@/lib/auth-server';

type CronRequest = {
  headers: { get(name: string): string | null };
  nextUrl: { searchParams: URLSearchParams };
};

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
 * (both spellings were used across the existing endpoints).
 */
export function hasValidCronKey(req: CronRequest, envName: string): boolean {
  const expected = process.env[envName];
  if (!expected) return false;
  const provided =
    req.headers.get('x-api-key') ||
    req.nextUrl.searchParams.get('api_key') ||
    req.nextUrl.searchParams.get('apiKey');
  return !!provided && provided === expected;
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
