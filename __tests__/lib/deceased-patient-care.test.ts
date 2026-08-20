import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  closePatientCareOnDeath,
  DeceasedPatientEpisodeError,
  isDeceasedPatientEpisodeError,
} from '@/lib/patient-death-care';
import { createOpenEpisodeWithInitialStageZero } from '@/lib/patient-episode-create';

describe('elhunyt beteg ellátásának lezárása', () => {
  it('lezárja az epizódot, teljesíti a recall-feladatot és lejáratja az intentet', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'ep-1' }, { id: 'ep-2' }] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({ rowCount: 4, rows: [{ id: 'intent-1' }] });

    await expect(closePatientCareOnDeath({ query } as any, 'patient-id')).resolves.toEqual({
      episodesClosed: 2,
      tasksCompleted: 3,
      intentsExpired: 4,
    });

    expect(query.mock.calls[0][0]).toMatch(/status\s*=\s*'closed'/i);
    expect(query.mock.calls[1][0]).toMatch(/completed_at\s*=\s*COALESCE/i);
    expect(query.mock.calls[2][0]).toMatch(/state\s*=\s*'expired'/i);
    expect(query.mock.calls.every((call) => call[1][0] === 'patient-id')).toBe(true);
  });

  it('az epizódnyitó szolgáltatás már beszúrás előtt elutasítja az elhunyt beteget', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'patient-id', halal_datum: '2026-01-01' }] })
        .mockResolvedValueOnce({ rows: [] }), // ROLLBACK
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };

    await expect(createOpenEpisodeWithInitialStageZero(pool as any, {
      patientId: 'patient-id',
      reason: 'onkológiai kezelés utáni állapot',
      chiefComplaint: 'Teszt',
      caseTitle: null,
      parentEpisodeId: null,
      triggerType: null,
      treatmentTypeId: null,
      createdBy: 'doctor@example.test',
    })).rejects.toBeInstanceOf(DeceasedPatientEpisodeError);

    expect(client.query.mock.calls.some((call) => /INSERT INTO patient_episodes/i.test(call[0]))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('a doménhibát stabil hibakód alapján is felismeri', () => {
    expect(isDeceasedPatientEpisodeError(new DeceasedPatientEpisodeError())).toBe(true);
    expect(isDeceasedPatientEpisodeError({ code: 'DECEASED_PATIENT_EPISODE_FORBIDDEN' })).toBe(true);
    expect(isDeceasedPatientEpisodeError(new Error('más hiba'))).toBe(false);
  });
});
describe('migration 080 — adatbázis-invariánsok', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'database', 'migrations', '080_deceased_patient_episode_guard.sql'),
    'utf8',
  );

  it('backfillben lezárja az epizódokat, feladatokat és intenteket', () => {
    expect(sql).toMatch(/UPDATE patient_episodes[\s\S]*?status\s*=\s*'closed'/i);
    expect(sql).toMatch(/UPDATE episode_tasks[\s\S]*?completed_at/i);
    expect(sql).toMatch(/UPDATE slot_intents[\s\S]*?state\s*=\s*'expired'/i);
  });

  it('triggerrel tiltja az újranyitást és az új aktív recall/ütemezési állapotot', () => {
    expect(sql).toContain('trg_patient_episodes_deceased_guard');
    expect(sql).toContain('trg_episode_tasks_active_episode_guard');
    expect(sql).toContain('trg_slot_intents_active_episode_guard');
    expect(sql).toContain('trg_patients_close_care_on_death');
    expect(sql).toContain('patient_episodes_deceased_patient_guard');
  });

  it('egyetlen tranzakcióban fut', () => {
    expect(sql).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/);
  });
});
