import { describe, it, expect } from 'vitest';
import { handleApiError } from '@/lib/api-error-handler';
import { HttpError } from '@/lib/auth-server';

describe('handleApiError', () => {
  it('maps HttpError to the correct HTTP status', async () => {
    const res = handleApiError(new HttpError(401, 'Bejelentkezés szükséges', 'UNAUTHENTICATED'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Bejelentkezés szükséges');
    expect(body._errorMeta?.status).toBe(401);
  });

  it('maps duck-typed status objects without instanceof Error', async () => {
    const res = handleApiError({ status: 403, message: 'Nincs jogosultság', name: 'HttpError' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Nincs jogosultság');
  });
});
