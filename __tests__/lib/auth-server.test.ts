import { describe, it, expect } from 'vitest';
import { HttpError } from '@/lib/auth-server';

describe('HttpError', () => {
  it('creates an error with status and message', () => {
    const error = new HttpError(401, 'Unauthorized');
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.message).toBe('Unauthorized');
    expect(error.name).toBe('HttpError');
  });

  it('creates an error with optional code', () => {
    const error = new HttpError(403, 'Forbidden', 'FORBIDDEN');
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('is catchable as an Error', () => {
    const error = new HttpError(500, 'Server Error');
    expect(error instanceof Error).toBe(true);
  });
});
