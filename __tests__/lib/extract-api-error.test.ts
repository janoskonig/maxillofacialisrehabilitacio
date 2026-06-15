import { describe, it, expect } from 'vitest';
import { extractApiError, formatApiError, toUserMessage } from '@/lib/extract-api-error';

function jsonResponse(body: unknown, status = 400, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('extractApiError', () => {
  it('extracts message, code, hint, and correlationId (header wins)', async () => {
    const res = jsonResponse(
      { error: 'Ez az időpont már le van foglalva', code: 'SLOT_ALREADY_BOOKED', hint: 'Válassz másik időpontot' },
      409,
      { 'x-correlation-id': '7f3a-corr' },
    );
    const e = await extractApiError(res);
    expect(e.message).toBe('Ez az időpont már le van foglalva');
    expect(e.code).toBe('SLOT_ALREADY_BOOKED');
    expect(e.hint).toBe('Válassz másik időpontot');
    expect(e.correlationId).toBe('7f3a-corr');
    expect(e.status).toBe(409);
  });

  it('falls back to _errorMeta for code + correlationId', async () => {
    const res = jsonResponse({ error: 'Hiba', _errorMeta: { code: 'X_CODE', correlationId: 'meta-corr' } }, 500);
    const e = await extractApiError(res);
    expect(e.code).toBe('X_CODE');
    expect(e.correlationId).toBe('meta-corr');
  });

  it('prefers the header correlationId over _errorMeta', async () => {
    const res = jsonResponse({ error: 'Hiba', _errorMeta: { correlationId: 'meta' } }, 500, { 'x-correlation-id': 'header' });
    expect((await extractApiError(res)).correlationId).toBe('header');
  });

  it('uses the fallback message for a non-JSON body and never throws', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    const e = await extractApiError(res, 'Hálózati hiba');
    expect(e.message).toBe('Hálózati hiba');
    expect(e.code).toBeNull();
    expect(e.correlationId).toBeNull();
  });

  it('treats empty/whitespace error and hint as absent', async () => {
    const e = await extractApiError(jsonResponse({ error: '   ', hint: '' }, 400));
    expect(e.message).toBe('Hiba történt');
    expect(e.hint).toBeNull();
  });

  it('leaves the original body readable (reads via clone)', async () => {
    const res = jsonResponse({ error: 'Hiba', code: 'C' });
    await extractApiError(res);
    await expect(res.json()).resolves.toEqual({ error: 'Hiba', code: 'C' });
  });
});

describe('formatApiError', () => {
  it('combines message, hint, and a copyable [code · correlationId] tag', () => {
    const s = formatApiError({ message: 'Foglalt', code: 'SLOT_ALREADY_BOOKED', hint: 'Másik időpont', correlationId: 'abc', status: 409 });
    expect(s).toContain('Foglalt');
    expect(s).toContain('Tipp: Másik időpont');
    expect(s).toContain('[SLOT_ALREADY_BOOKED · abc]');
  });

  it('omits the tag entirely when there is no code or correlationId', () => {
    expect(formatApiError({ message: 'Csak üzenet', code: null, hint: null, correlationId: null, status: 400 }))
      .toBe('Csak üzenet');
  });

  it('shows just the code when correlationId is missing', () => {
    const s = formatApiError({ message: 'M', code: 'ONLY_CODE', hint: null, correlationId: null, status: 400 });
    expect(s).toContain('[ONLY_CODE]');
  });
});

describe('toUserMessage', () => {
  it('end-to-end: Response → user+support string', async () => {
    const res = new Response(JSON.stringify({ error: 'Csak jövőbeli időpontot lehet lefoglalni', code: 'SLOT_IN_PAST' }), {
      status: 400, headers: { 'content-type': 'application/json', 'x-correlation-id': 'cid-1' },
    });
    const msg = await toUserMessage(res);
    expect(msg).toContain('Csak jövőbeli időpontot lehet lefoglalni');
    expect(msg).toContain('[SLOT_IN_PAST · cid-1]');
  });
});
