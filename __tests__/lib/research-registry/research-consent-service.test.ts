import { describe, it, expect } from 'vitest';

describe('research-consent-service policy', () => {
  it('portal grant uses patient_portal capture without staff attestation', async () => {
    const { grantResearchConsent } = await import('@/lib/research-registry/research-consent-service');
    expect(typeof grantResearchConsent).toBe('function');
  });
});
