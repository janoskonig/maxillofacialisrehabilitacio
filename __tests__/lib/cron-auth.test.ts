import { describe, it, expect, afterEach } from 'vitest';
import { hasValidCronKey, requireCronKey } from '@/lib/api/cron-auth';
import { HttpError } from '@/lib/auth-server';

const ENV = 'TEST_CRON_KEY';

function makeReq(opts: { header?: string | null; api_key?: string; apiKey?: string }) {
  const params = new URLSearchParams();
  if (opts.api_key !== undefined) params.set('api_key', opts.api_key);
  if (opts.apiKey !== undefined) params.set('apiKey', opts.apiKey);
  return {
    headers: { get: (name: string) => (name === 'x-api-key' ? opts.header ?? null : null) },
    nextUrl: { searchParams: params },
  };
}

afterEach(() => {
  delete process.env[ENV];
});

describe('hasValidCronKey', () => {
  it('fails closed when the env var is unset, even if a key is supplied', () => {
    expect(hasValidCronKey(makeReq({ header: 'anything' }), ENV)).toBe(false);
  });

  it('rejects when no key is supplied', () => {
    process.env[ENV] = 'secret';
    expect(hasValidCronKey(makeReq({}), ENV)).toBe(false);
  });

  it('accepts a matching x-api-key header', () => {
    process.env[ENV] = 'secret';
    expect(hasValidCronKey(makeReq({ header: 'secret' }), ENV)).toBe(true);
  });

  it('accepts a matching api_key or apiKey query param', () => {
    process.env[ENV] = 'secret';
    expect(hasValidCronKey(makeReq({ api_key: 'secret' }), ENV)).toBe(true);
    expect(hasValidCronKey(makeReq({ apiKey: 'secret' }), ENV)).toBe(true);
  });

  it('rejects a mismatched key', () => {
    process.env[ENV] = 'secret';
    expect(hasValidCronKey(makeReq({ header: 'wrong' }), ENV)).toBe(false);
  });
});

describe('requireCronKey', () => {
  it('throws HttpError(401) when the key is invalid or unconfigured', () => {
    expect(() => requireCronKey(makeReq({ header: 'x' }), ENV)).toThrow(HttpError);
    try {
      requireCronKey(makeReq({ header: 'x' }), ENV);
    } catch (e) {
      expect((e as HttpError).status).toBe(401);
    }
  });

  it('does not throw when a valid key is present', () => {
    process.env[ENV] = 'secret';
    expect(() => requireCronKey(makeReq({ header: 'secret' }), ENV)).not.toThrow();
  });
});
