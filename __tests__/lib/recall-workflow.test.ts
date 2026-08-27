import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureRecallTasksForEpisode, recallDueAt } from '@/lib/recall-tasks';
import {
  linkRecallTaskToAppointment,
  syncRecallTaskForAppointmentStatus,
  validateRecallTaskForBooking,
} from '@/lib/recall-task-lifecycle';

describe('recall ütemezés', () => {
  it('teljesült kezelés híján a klinikai átadás (STAGE_6) dátumától számol, low kadenciával', async () => {
    const deliveryAt = new Date('2026-03-28T10:00:00.000Z');
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'ep-1', recall_risk_level: null, stage6_at: deliveryAt, last_completed_at: null }],
      })
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'r-1' }, { id: 'r-2' }] });

    await expect(ensureRecallTasksForEpisode('ep-1', { query } as any)).resolves.toBe(2);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toMatch(/MIN\(se\.at\)[\s\S]*STAGE_6/i);
    // Az arbiter a 088-as partiális (source='auto') unique indexet célozza,
    // és a beszúrt sor is auto-forrású.
    expect(query.mock.calls[1][0]).toMatch(
      /ON CONFLICT \(episode_id, recall_interval_days\)[\s\S]*source = 'auto'/i,
    );
    expect(query.mock.calls[1][1][1]).toEqual([180, 365]);
    expect(query.mock.calls[1][1][2].map((d: Date) => d.toISOString())).toEqual([
      '2026-09-24T10:00:00.000Z',
      '2027-03-28T10:00:00.000Z',
    ]);
    expect(query.mock.calls[1][1][3]).toEqual(['6 hónapos kontroll', '12 hónapos kontroll']);
  });

  it('a horgony az utolsó teljesült kezelés, ha az későbbi a STAGE_6-nál', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'ep-1',
          recall_risk_level: null,
          stage6_at: new Date('2026-03-28T10:00:00.000Z'),
          last_completed_at: new Date('2026-05-01T08:00:00.000Z'),
        }],
      })
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'r-1' }, { id: 'r-2' }] });

    await ensureRecallTasksForEpisode('ep-1', { query } as any);

    expect(query.mock.calls[1][1][2].map((d: Date) => d.toISOString())).toEqual([
      '2026-10-28T08:00:00.000Z',
      '2027-05-01T08:00:00.000Z',
    ]);
  });

  it('high rizikószintnél a sűrűbb kadenciát generálja', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'ep-1',
          recall_risk_level: 'high',
          stage6_at: new Date('2026-03-28T10:00:00.000Z'),
          last_completed_at: null,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 4, rows: [{ id: 'r-1' }] });

    await ensureRecallTasksForEpisode('ep-1', { query } as any);

    expect(query.mock.calls[1][1][1]).toEqual([30, 90, 180, 365]);
  });

  it('STAGE_6 nélkül nem hoz létre fallback-now feladatot', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(ensureRecallTasksForEpisode('ep-1', { query } as any)).resolves.toBe(0);
    expect(query).toHaveBeenCalledOnce();
  });

  it('nyitott epizódon is 0, ha még nincs STAGE_6 esemény', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'ep-1', recall_risk_level: 'high', stage6_at: null, last_completed_at: new Date() }],
    });
    await expect(ensureRecallTasksForEpisode('ep-1', { query } as any)).resolves.toBe(0);
    expect(query).toHaveBeenCalledOnce();
  });

  it('UTC naptári napokkal számol, DST-váltás sem tolja el az órát', () => {
    expect(recallDueAt(new Date('2026-03-28T23:30:00.000Z'), 1).toISOString())
      .toBe('2026-03-29T23:30:00.000Z');
  });
});

describe('recall foglalási lifecycle', () => {
  it('elutasítja a már teljesített feladat foglalását', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{
        id: 'task-1', episode_id: 'ep-1', patient_id: 'patient-1',
        episode_status: 'open', completed_at: new Date(), appointment_id: null,
        appointment_status: null,
      }],
    });
    const result = await validateRecallTaskForBooking({ query } as any, {
      taskId: 'task-1', patientId: 'patient-1', episodeId: 'ep-1',
    });
    expect(result).toMatchObject({ ok: false, code: 'RECALL_TASK_COMPLETED', status: 409 });
  });

  it('egy régi lemondott linket leválaszt, majd újrafoglalhatóvá tesz', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1', episode_id: 'ep-1', patient_id: 'patient-1',
          episode_status: 'open', completed_at: null, appointment_id: 'appt-old',
          appointment_status: 'cancelled_by_patient',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(validateRecallTaskForBooking({ query } as any, {
      taskId: 'task-1', patientId: 'patient-1', episodeId: 'ep-1',
    })).resolves.toEqual({ ok: true });
    expect(query.mock.calls[1][0]).toMatch(/appointment_id = NULL/i);
  });

  it('a foglalást a feladathoz köti, teljesítéskor lezárja, no-show-nál visszanyitja', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await linkRecallTaskToAppointment({ query } as any, 'task-1', 'appt-1');
    await syncRecallTaskForAppointmentStatus({ query } as any, {
      appointmentId: 'appt-1', oldStatus: null, newStatus: 'completed',
    });
    await syncRecallTaskForAppointmentStatus({ query } as any, {
      appointmentId: 'appt-1', oldStatus: 'completed', newStatus: 'no_show',
    });

    expect(query.mock.calls[0][0]).toMatch(/SET appointment_id = \$2/i);
    expect(query.mock.calls[1][0]).toMatch(/completed_at = COALESCE/i);
    expect(query.mock.calls[2][0]).toMatch(/appointment_id = NULL, completed_at = NULL/i);
  });
});

describe('migration 081 — recall invariánsok', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'database', 'migrations', '081_recall_workflow.sql'),
    'utf8',
  );

  it('egyedi 6/12 hónapos feladatot és egyedi appointment-linket kényszerít ki', () => {
    expect(sql).toContain('idx_episode_tasks_recall_interval_unique');
    expect(sql).toContain('idx_episode_tasks_recall_appointment_unique');
    expect(sql).toMatch(/recall_interval_days IN \(180, 365\)/);
    expect(sql).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/);
  });
});
