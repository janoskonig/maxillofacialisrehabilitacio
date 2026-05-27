import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  resetRateLimit,
  buildRateLimitedResponse,
} from '@/lib/api/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('allows up to `limit` events in window', () => {
    const opts = { key: 'k1', limit: 3, windowMs: 1000 };
    expect(checkRateLimit(opts).allowed).toBe(true);
    expect(checkRateLimit(opts).allowed).toBe(true);
    expect(checkRateLimit(opts).allowed).toBe(true);
    const denied = checkRateLimit(opts);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('separates buckets by key', () => {
    expect(checkRateLimit({ key: 'a', limit: 1, windowMs: 1000 }).allowed).toBe(true);
    expect(checkRateLimit({ key: 'a', limit: 1, windowMs: 1000 }).allowed).toBe(false);
    expect(checkRateLimit({ key: 'b', limit: 1, windowMs: 1000 }).allowed).toBe(true);
  });

  it('resetRateLimit clears the bucket', () => {
    const opts = { key: 'reset', limit: 1, windowMs: 1000 };
    expect(checkRateLimit(opts).allowed).toBe(true);
    expect(checkRateLimit(opts).allowed).toBe(false);
    resetRateLimit('reset');
    expect(checkRateLimit(opts).allowed).toBe(true);
  });

  it('reports remaining capacity correctly', () => {
    const opts = { key: 'rem', limit: 3, windowMs: 1000 };
    expect(checkRateLimit(opts).remaining).toBe(2);
    expect(checkRateLimit(opts).remaining).toBe(1);
    expect(checkRateLimit(opts).remaining).toBe(0);
  });
});

describe('buildRateLimitedResponse', () => {
  it('exposes Retry-After (seconds) >= 1 even when the window just expired', () => {
    const r = buildRateLimitedResponse({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() - 100,
      used: 5,
    });
    expect(r.retryAfterSeconds).toBe(1);
    expect(r.body.error).toMatch(/Túl sok kérés/i);
  });
  it('passes through custom message', () => {
    const r = buildRateLimitedResponse(
      { allowed: false, remaining: 0, resetAt: Date.now() + 2000, used: 1 },
      'custom',
    );
    expect(r.body.error).toBe('custom');
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
