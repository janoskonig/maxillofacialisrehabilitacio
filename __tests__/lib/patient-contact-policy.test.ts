import { describe, expect, it, vi } from 'vitest';
import { canContactPatient } from '@/lib/patient-contact-policy';

describe('canContactPatient', () => {
  it('csak élő, létező beteg esetén engedélyezi a kapcsolatfelvételt', async () => {
    const aliveDb = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const blockedDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(canContactPatient('alive-patient', aliveDb as any)).resolves.toBe(true);
    await expect(canContactPatient('deceased-patient', blockedDb as any)).resolves.toBe(false);

    const sql = aliveDb.query.mock.calls[0][0] as string;
    expect(sql).toContain('halal_datum IS NULL');
  });

  it('adatbázishibánál fail-closed módon hibát ad tovább', async () => {
    const dbError = new Error('database unavailable');
    const failingDb = { query: vi.fn().mockRejectedValue(dbError) };

    await expect(canContactPatient('patient-id', failingDb as any)).rejects.toBe(dbError);
  });
});
