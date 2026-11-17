import { describe, it, expect, vi } from 'vitest';
import {
  activePatientSql,
  cancelAutomaticPatientTasks,
  inactivatePatient,
  inactivePatientSql,
  parseInactivationInput,
  reactivatePatient,
} from '@/lib/patient-inactivation';
import { PATIENT_INACTIVATION_REASONS } from '@/lib/patient-inactivation-reasons';
import { readFileSync } from 'fs';
import path from 'path';

function fakeDb(rowsByCall: Array<{ rows: unknown[]; rowCount?: number }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  return {
    calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return rowsByCall[i++] ?? { rows: [], rowCount: 0 };
    }),
  };
}

describe('patient inactivation — input', () => {
  it('accepts every known reason', () => {
    for (const reason of PATIENT_INACTIVATION_REASONS) {
      const note = reason === 'egyeb' ? 'x' : undefined;
      expect(parseInactivationInput({ reason, note }).reason).toBe(reason);
    }
  });

  it('rejects unknown reasons with 400', () => {
    expect(() => parseInactivationInput({ reason: 'elhunyt' })).toThrowError(/Érvénytelen/);
  });

  it('requires a note for "egyeb"', () => {
    expect(() => parseInactivationInput({ reason: 'egyeb', note: '   ' })).toThrowError(/kötelező/);
  });

  it('trims the note and turns empty into null', () => {
    expect(parseInactivationInput({ reason: 'nem_celcsoport', note: '  ' }).note).toBeNull();
    expect(parseInactivationInput({ reason: 'nem_celcsoport', note: ' FP rendelés ' }).note).toBe('FP rendelés');
  });

  it('rejects overly long notes', () => {
    expect(() => parseInactivationInput({ reason: 'nem_celcsoport', note: 'a'.repeat(2001) })).toThrow();
  });
});

describe('patient inactivation — SQL fragments', () => {
  it('is column-tolerant (works before migration 117)', () => {
    expect(activePatientSql('p')).toBe(`(to_jsonb(p) ->> 'inaktivalva_at') IS NULL`);
    expect(inactivePatientSql('x')).toBe(`(to_jsonb(x) ->> 'inaktivalva_at') IS NOT NULL`);
  });

  it('migration CHECK constraint lists exactly the code reasons', () => {
    const sql = readFileSync(
      path.join(__dirname, '../../database/migrations/117_patient_inactivation.sql'),
      'utf8',
    );
    const m = sql.match(/inaktivalas_oka IN \(([^)]*)\)/);
    expect(m).toBeTruthy();
    const listed = m![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(listed).toEqual([...PATIENT_INACTIVATION_REASONS]);
  });
});

describe('patient inactivation — writes', () => {
  it('inactivates, then cancels only automatic open tasks', async () => {
    const db = fakeDb([{ rows: [{ id: 'p1' }] }, { rows: [], rowCount: 2 }]);
    await inactivatePatient(db, 'p1', 'u1', { reason: 'nem_celcsoport', note: 'egyszerű FP' });
    expect(db.calls[0].sql).toMatch(/UPDATE patients/);
    expect(db.calls[0].params).toEqual(['p1', 'nem_celcsoport', 'egyszerű FP', 'u1']);
    expect(db.calls[1].sql).toMatch(/UPDATE user_tasks/);
    expect(db.calls[1].params[1]).toEqual(['missing_data', 'recall_due', 'ohip14']);
    // Az updated_at-et nem bántjuk (PatientForm optimista zárolás).
    expect(db.calls[0].sql).not.toMatch(/updated_at/);
  });

  it('404s on an unknown patient and touches no tasks', async () => {
    const db = fakeDb([{ rows: [] }]);
    await expect(
      inactivatePatient(db, 'nope', 'u1', { reason: 'duplikatum' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.calls).toHaveLength(1);
  });

  it('validates before writing', async () => {
    const db = fakeDb([]);
    await expect(inactivatePatient(db, 'p1', 'u1', { reason: 'bogus' })).rejects.toMatchObject({ status: 400 });
    expect(db.calls).toHaveLength(0);
  });

  it('reactivation clears every inactivation column', async () => {
    const db = fakeDb([{ rows: [{ id: 'p1' }] }]);
    await reactivatePatient(db, 'p1');
    const sql = db.calls[0].sql;
    for (const col of ['inaktivalva_at', 'inaktivalas_oka', 'inaktivalas_megjegyzes', 'inaktivalta_user_id']) {
      expect(sql).toMatch(new RegExp(`${col} = NULL`));
    }
  });

  it('cancelAutomaticPatientTasks returns the affected row count', async () => {
    const db = fakeDb([{ rows: [], rowCount: 3 }]);
    expect(await cancelAutomaticPatientTasks(db, 'p1')).toBe(3);
  });
});
