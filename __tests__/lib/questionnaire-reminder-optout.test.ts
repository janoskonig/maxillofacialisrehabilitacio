import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ getDbPool: () => ({ query }) }));

const sendOhipReminderEmail = vi.fn();
vi.mock('@/lib/email', () => ({ sendOhipReminderEmail: (...a: unknown[]) => sendOhipReminderEmail(...a) }));
vi.mock('@/lib/email/admin-notification-queue', () => ({ queueAdminNotification: vi.fn(async () => {}) }));
vi.mock('@/lib/ohip14-stage', () => ({
  getOhipPatientContext: vi.fn(async () => ({ episodeId: 'ep1', stageCode: null, deliveryDate: null })),
}));
vi.mock('@/lib/ohip14-timepoint-stage', () => ({
  getTimepointAvailability: () => ({ allowed: true, closesAt: null }),
}));
const closeOpenOhipPatientTasks = vi.fn(async () => 1);
const closeOpenOhipEscalationTasks = vi.fn(async () => 0);
const ensurePatientOhipTask = vi.fn(async (..._a: unknown[]) => false);
const escalateOhipToKezeloorvos = vi.fn(async (..._a: unknown[]) => false);
vi.mock('@/lib/ohip14-patient-tasks', () => ({
  ensurePatientOhipTask: (...a: unknown[]) => (ensurePatientOhipTask as any)(...a),
  pushPatientOhipReminder: vi.fn(),
  escalateOhipToKezeloorvos: (...a: unknown[]) => (escalateOhipToKezeloorvos as any)(...a),
  closeOpenOhipPatientTasks: (...a: unknown[]) => (closeOpenOhipPatientTasks as any)(...a),
  closeOpenOhipEscalationTasks: (...a: unknown[]) => (closeOpenOhipEscalationTasks as any)(...a),
}));

import { sendOhipReminders } from '@/lib/ohip14-reminders';
import { parseOptOutBody } from '@/lib/questionnaire-reminder-optout';

function patientRow(id: string, optedOut: boolean) {
  return { patient_id: id, nev: 'Teszt', nem: 'no', email: `${id}@example.test`, opted_out: optedOut, episode_id: 'ep1' };
}

describe('kérdőív-emlékeztető leiratkozás', () => {
  beforeEach(() => {
    query.mockReset();
    sendOhipReminderEmail.mockReset();
    closeOpenOhipPatientTasks.mockClear();
    closeOpenOhipEscalationTasks.mockClear();
    ensurePatientOhipTask.mockClear();
    escalateOhipToKezeloorvos.mockClear();
  });

  it('a leiratkozott beteg nem kap OHIP e-mailt, feladatot vagy eszkalációt; a nyitott feladatai lezárulnak', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM patients p')) return { rows: [patientRow('p-opt', true), patientRow('p-ok', false)] };
      if (sql.includes('count(*)')) return { rows: [{ c: 0 }] };
      return { rows: [] };
    });

    const res = await sendOhipReminders();

    expect(sendOhipReminderEmail).toHaveBeenCalledTimes(1);
    expect(sendOhipReminderEmail.mock.calls[0][0]).toBe('p-ok@example.test');
    expect(ensurePatientOhipTask).toHaveBeenCalledTimes(1);
    expect(ensurePatientOhipTask.mock.calls[0][1]).toBe('p-ok');
    expect(escalateOhipToKezeloorvos.mock.calls.every((c) => c[1] !== 'p-opt')).toBe(true);
    expect(closeOpenOhipPatientTasks).toHaveBeenCalledWith('p-opt');
    expect(closeOpenOhipEscalationTasks).toHaveBeenCalledWith('p-opt');
    expect(res.optedOut).toBe(1);
    expect(res.sent).toBe(1);
  });

  it('parseOptOutBody csak boolean-t fogad el', () => {
    expect(parseOptOutBody({ optedOut: true })).toBe(true);
    expect(parseOptOutBody({ optedOut: false })).toBe(false);
    expect(parseOptOutBody({ optedOut: 'true' })).toBeNull();
    expect(parseOptOutBody(null)).toBeNull();
  });
});
