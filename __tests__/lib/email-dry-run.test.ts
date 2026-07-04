import { describe, it, expect } from 'vitest';
import { isEmailDryRun } from '@/lib/email/config';

describe('isEmailDryRun — biztonságos alapértelmezés', () => {
  it('nem-élesben alapból SZÁRAZ (ez a védelem lényege)', () => {
    expect(isEmailDryRun({ NODE_ENV: 'development' })).toBe(true);
    expect(isEmailDryRun({ NODE_ENV: 'test' })).toBe(true);
    expect(isEmailDryRun({})).toBe(true);
  });

  it('élesben alapból küld', () => {
    expect(isEmailDryRun({ NODE_ENV: 'production' })).toBe(false);
  });

  it('EMAIL_DRY_RUN=false nem-élesben is engedélyezi a küldést (explicit opt-in)', () => {
    expect(isEmailDryRun({ NODE_ENV: 'development', EMAIL_DRY_RUN: 'false' })).toBe(false);
  });

  it('EMAIL_DRY_RUN=true élesben is szárazra kényszerít', () => {
    expect(isEmailDryRun({ NODE_ENV: 'production', EMAIL_DRY_RUN: 'true' })).toBe(true);
  });

  it('érvénytelen érték = alapértelmezett viselkedés', () => {
    expect(isEmailDryRun({ NODE_ENV: 'production', EMAIL_DRY_RUN: 'yes' })).toBe(false);
    expect(isEmailDryRun({ NODE_ENV: 'development', EMAIL_DRY_RUN: '1' })).toBe(true);
  });
});
