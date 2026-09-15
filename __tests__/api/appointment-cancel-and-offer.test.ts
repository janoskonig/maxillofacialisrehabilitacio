import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/appointments/[id]/cancel-and-offer — lemondás + feltételes új
 * ajánlat egy tranzakcióban. Mockolt pool/kliens: a SQL-sorrendet és a
 * guard-okat rögzítjük (a valódi DB-s viselkedést az integrációs teszt fedi).
 */

const clientQueryMock = vi.fn();
const poolQueryMock = vi.fn();
const releaseMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getDbPool: () => ({
    query: poolQueryMock,
    connect: async () => ({ query: clientQueryMock, release: releaseMock }),
  }),
}));

vi.mock('@/lib/auth-server', () => ({
  verifyAuth: vi.fn(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.name = 'HttpError';
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock('@/lib/api-error-handler', () => ({
  handleApiError: vi.fn((error: any, msg: string) =>
    NextResponse.json({ error: error?.message || msg }, { status: error?.status || 500 })
  ),
}));
vi.mock('@/lib/legal/patient-data-access-log', () => ({ maybeLogPatientAccess: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => true) }));
vi.mock('@/lib/scheduling-events', () => ({ emitSchedulingEvent: vi.fn(async () => undefined) }));

const findEwpMock = vi.fn();
const revertMock = vi.fn(async () => undefined);
vi.mock('@/lib/episode-work-phase-revert-lookup', () => ({
  findEwpForAppointmentRevert: (...a: unknown[]) => findEwpMock(...a),
  revertWorkPhaseLinkToPending: (...a: unknown[]) => revertMock(...(a as [])),
}));
const auditMock = vi.fn(async () => undefined);
vi.mock('@/lib/work-phase-audit', () => ({
  insertWorkPhaseAudit: (...a: unknown[]) => auditMock(...(a as [])),
}));
const adoptMock = vi.fn(async () => true);
vi.mock('@/lib/visit-appointment-sync', () => ({
  adoptAppointmentForPhaseVisit: (...a: unknown[]) => adoptMock(...(a as [])),
}));
const calendarReleaseMock = vi.fn(async () => undefined);
vi.mock('@/lib/appointment-calendar-release', () => ({
  releaseGoogleCalendarEventForCancelledSlot: (...a: unknown[]) => calendarReleaseMock(...(a as [])),
}));
const patientMailMock = vi.fn(async (..._args: unknown[]) => undefined);
const dentistMailMock = vi.fn(async (..._args: unknown[]) => undefined);
const adminMailMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/email', () => ({
  sendCancellationWithNewOfferToPatient: (...a: unknown[]) => patientMailMock(...(a as [])),
  sendAppointmentCancellationNotification: (...a: unknown[]) => dentistMailMock(...(a as [])),
  sendConditionalAppointmentNotificationToAdmin: (...a: unknown[]) => adminMailMock(...(a as [])),
}));

import { POST } from '@/app/api/appointments/[id]/cancel-and-offer/route';
import { requireRole } from '@/lib/auth-server';

const admin = { userId: 'admin-1', email: 'admin@dev.local', role: 'admin' as const };
const dentist = { userId: 'dent-1', email: 'doki@dev.local', role: 'fogpótlástanász' as const };
const OLD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const OLD_SLOT = 'bbbbbbbb-0000-4000-8000-000000000001';
const NEW_SLOT = 'bbbbbbbb-0000-4000-8000-000000000002';
const ALT_SLOT = 'bbbbbbbb-0000-4000-8000-000000000003';
const NEW_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const EWP_ID = 'cccccccc-0000-4000-8000-000000000001';
const EPISODE_ID = 'dddddddd-0000-4000-8000-000000000001';
const future = (days: number) => new Date(Date.now() + days * 86_400_000);

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/appointments/${OLD_ID}/cancel-and-offer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function oldRow(extra: Record<string, unknown> = {}) {
  return {
    id: OLD_ID,
    patient_id: 'pat-1',
    episode_id: EPISODE_ID,
    time_slot_id: OLD_SLOT,
    slot_intent_id: 'intent-1',
    created_by: 'doki@dev.local',
    dentist_email: 'doki@dev.local',
    google_calendar_event_id: 'gcal-1',
    approval_status: null,
    alternative_time_slot_ids: [],
    appointment_status: null,
    appointment_type: 'munkafazis',
    pool: 'work',
    duration_minutes: 30,
    step_code: 'lenyomat',
    step_seq: 0,
    work_phase_id: EWP_ID,
    attempt_number: 1,
    created_via: 'worklist',
    start_time: future(2),
    time_slot_user_id: 'dent-1',
    time_slot_source: 'manual',
    patient_name: 'Teszt Elek',
    patient_taj: '123456789',
    patient_email: 'elek@example.com',
    patient_nem: 'ferfi',
    time_slot_user_email: 'doki@dev.local',
    is_recall_linked: false,
    ...extra,
  };
}

function newSlotRow(extra: Record<string, unknown> = {}) {
  return {
    id: NEW_SLOT,
    state: 'free',
    status: 'available',
    start_time: future(5),
    cim: null,
    teremszam: '12',
    user_id: 'dent-1',
    dentist_email: 'doki@dev.local',
    dentist_name: 'Dr. Doki',
    ...extra,
  };
}

/** A tranzakció SQL-hívásainak sorrendje a happy path-on; a mock ezekre válaszol. */
function primeHappyPath(opts: { old?: Record<string, unknown>; newSlot?: Record<string, unknown>; alt?: boolean } = {}) {
  clientQueryMock.mockReset();
  clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/FROM appointments a/.test(sql) && /FOR UPDATE OF a/.test(sql)) return { rows: [oldRow(opts.old)] };
    if (/FROM available_time_slots ats/.test(sql) && /FOR UPDATE OF ats/.test(sql)) return { rows: [newSlotRow(opts.newSlot)] };
    if (/SELECT id, state, status, start_time FROM available_time_slots WHERE id = ANY/.test(sql)) {
      return { rows: [{ id: ALT_SLOT, state: 'free', status: 'available', start_time: future(6) }] };
    }
    if (/INSERT INTO appointments/.test(sql)) {
      return {
        rows: [{
          id: NEW_ID, patientId: 'pat-1', timeSlotId: params?.[1], episodeId: params?.[7],
          workPhaseId: params?.[12], approvalStatus: 'pending', appointmentType: params?.[6], createdAt: 'now',
        }],
      };
    }
    return { rows: [], rowCount: 1 };
  });
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation(async (sql: string) => {
    if (/SELECT email FROM users WHERE role = 'admin'/.test(sql)) return { rows: [{ email: 'admin@dev.local' }] };
    if (/SELECT id, start_time, cim, teremszam FROM available_time_slots/.test(sql)) {
      return { rows: [{ id: ALT_SLOT, start_time: future(6), cim: null, teremszam: null }] };
    }
    return { rows: [] };
  });
}

function sqlCalls(): Array<[string, unknown[] | undefined]> {
  return clientQueryMock.mock.calls.map((c) => [c[0] as string, c[1] as unknown[] | undefined]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(admin);
  findEwpMock.mockResolvedValue({ id: EWP_ID, status: 'scheduled', appointmentId: OLD_ID });
});

describe('POST /api/appointments/[id]/cancel-and-offer — happy path', () => {
  it('lemondja a régit, beszúrja az ajánlatot az örökölt kontextussal, átköti a fázist, egy levelet küld', async () => {
    primeHappyPath({ alt: true });
    const res = await POST(req({ timeSlotId: NEW_SLOT, alternativeTimeSlotIds: [ALT_SLOT, ALT_SLOT, ''] }), { params: { id: OLD_ID } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cancelledAppointmentId).toBe(OLD_ID);
    expect(body.offer.id).toBe(NEW_ID);
    expect(body.offer.alternativeTimeSlotIds).toEqual([ALT_SLOT]); // dedup + üres kiszűrve

    const calls = sqlCalls();
    const sqlText = calls.map(([s]) => s);
    // Tranzakció-keret
    expect(sqlText[0]).toBe('BEGIN');
    expect(sqlText[sqlText.length - 1]).toBe('COMMIT');
    expect(sqlText).not.toContain('ROLLBACK');

    // Régi sor: kanonikus lemondás
    const cancelIdx = sqlText.findIndex((s) => /SET appointment_status = 'cancelled_by_doctor'/.test(s));
    expect(cancelIdx).toBeGreaterThan(0);
    expect(sqlText[cancelIdx]).toMatch(/slot_intent_id = NULL/);
    expect(sqlText[cancelIdx]).toMatch(/approval_token = NULL/);
    expect(sqlText.some((s) => /INSERT INTO appointment_status_events/.test(s))).toBe(true);
    expect(calls.some(([s, p]) => /UPDATE slot_intents SET state = 'expired'/.test(s) && p?.[0] === 'intent-1')).toBe(true);
    expect(calls.some(([s, p]) => /SET status = 'available', state = 'free' WHERE id = \$1/.test(s) && p?.[0] === OLD_SLOT)).toBe(true);

    // Fázis: revert a régiről, majd link az újra + audit + alkalom-örökítés
    expect(revertMock).toHaveBeenCalledTimes(1);
    const linkCall = calls.find(([s]) => /UPDATE episode_work_phases/.test(s) && /SET appointment_id = \$1/.test(s));
    expect(linkCall?.[1]).toEqual([NEW_ID, EWP_ID]);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(adoptMock).toHaveBeenCalledWith(expect.anything(), EWP_ID, NEW_ID);

    // Új sor: örökölt kontextus + pending
    const insert = calls.find(([s]) => /INSERT INTO appointments/.test(s));
    expect(insert?.[0]).toMatch(/'pending'/);
    const p = insert![1]!;
    expect(p[0]).toBe('pat-1');          // patient_id
    expect(p[1]).toBe(NEW_SLOT);         // time_slot_id
    expect(p[2]).toBe(admin.email);      // created_by
    expect(p[3]).toBe('doki@dev.local'); // dentist_email (új slot tulaja)
    expect(typeof p[4]).toBe('string');  // approval_token
    expect((p[4] as string).length).toBe(64);
    expect(p[5]).toBe(JSON.stringify([ALT_SLOT]));
    expect(p[6]).toBe('munkafazis');     // típus öröklődik
    expect(p[7]).toBe(EPISODE_ID);
    expect(p[8]).toBe('work');
    expect(p[9]).toBe(30);
    expect(p[10]).toBe('lenyomat');
    expect(p[11]).toBe(0);
    expect(p[12]).toBe(EWP_ID);
    expect(p[13]).toBe(1);               // attempt_number: rebook, nem új próba
    expect(p[14]).toBe('worklist');

    // Új slot lefoglalva, REPROJECT_INTENTS az epizódra
    expect(calls.some(([s, pr]) => /SET status = 'booked', state = 'booked' WHERE id = \$1/.test(s) && pr?.[0] === NEW_SLOT)).toBe(true);
    expect(calls.some(([s, pr]) => /REPROJECT_INTENTS/.test(s) && pr?.[0] === EPISODE_ID)).toBe(true);

    // Levelek: EGY beteg-levél (lemondás + ajánlat), orvos-értesítés, admin digest, naptár
    expect(patientMailMock).toHaveBeenCalledTimes(1);
    const mail = patientMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mail.patientEmail).toBe('elek@example.com');
    expect(mail.approvalToken).toBe(p[4]);
    expect(mail.hasAlternatives).toBe(true);
    expect(dentistMailMock).toHaveBeenCalledTimes(1);
    expect(adminMailMock).toHaveBeenCalledTimes(1);
    expect(calendarReleaseMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      timeSlotId: OLD_SLOT,
      googleCalendarEventId: 'gcal-1',
    }));
    expect(releaseMock).toHaveBeenCalled();
  });

  it('epizód nélküli időpontnál nincs fázis-műtét, de a levél megy', async () => {
    primeHappyPath({ old: { episode_id: null, work_phase_id: null, step_code: null, step_seq: null } });
    const res = await POST(req({ timeSlotId: NEW_SLOT }), { params: { id: OLD_ID } });
    expect(res.status).toBe(201);
    expect(findEwpMock).not.toHaveBeenCalled();
    expect(revertMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(sqlCalls().some(([s]) => /REPROJECT_INTENTS/.test(s))).toBe(false);
    expect(patientMailMock).toHaveBeenCalledTimes(1);
  });

  it('a kért típus felülírja az öröklöttet; recall-kötött időpont csak recall-lal', async () => {
    primeHappyPath();
    await POST(req({ timeSlotId: NEW_SLOT, appointmentType: 'kontroll' }), { params: { id: OLD_ID } });
    const insert = sqlCalls().find(([s]) => /INSERT INTO appointments/.test(s));
    expect(insert![1]![6]).toBe('kontroll');

    primeHappyPath({ old: { is_recall_linked: true, appointment_type: 'recall' } });
    const bad = await POST(req({ timeSlotId: NEW_SLOT, appointmentType: 'kontroll' }), { params: { id: OLD_ID } });
    expect(bad.status).toBe(409);
    expect((await bad.json()).code).toBe('RECALL_TYPE_LOCKED');

    primeHappyPath({ old: { is_recall_linked: true, appointment_type: 'recall' } });
    const ok = await POST(req({ timeSlotId: NEW_SLOT }), { params: { id: OLD_ID } });
    expect(ok.status).toBe(201);
    expect(sqlCalls().some(([s, p]) => /UPDATE episode_tasks SET appointment_id = \$1/.test(s) && p?.[0] === NEW_ID && p?.[1] === OLD_ID)).toBe(true);
  });
});

describe('POST /api/appointments/[id]/cancel-and-offer — guard-ok (ROLLBACK, nincs írás)', () => {
  async function expectRejected(body: unknown, status: number, code: string) {
    const res = await POST(req(body), { params: { id: OLD_ID } });
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    const sqlText = sqlCalls().map(([s]) => s);
    if (sqlText.length > 0) {
      expect(sqlText).toContain('ROLLBACK');
      expect(sqlText.some((s) => /INSERT INTO appointments/.test(s))).toBe(false);
      expect(sqlText.some((s) => /cancelled_by_doctor/.test(s))).toBe(false);
    }
    expect(patientMailMock).not.toHaveBeenCalled();
  }

  it('timeSlotId hiányzik → 400 (tranzakció sem indul)', async () => {
    primeHappyPath();
    const res = await POST(req({}), { params: { id: OLD_ID } });
    expect(res.status).toBe(400);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('nem létező időpont → 404', async () => {
    primeHappyPath();
    clientQueryMock.mockImplementationOnce(async () => ({ rows: [] })); // BEGIN
    clientQueryMock.mockImplementationOnce(async () => ({ rows: [] })); // SELECT old → üres
    await expectRejected({ timeSlotId: NEW_SLOT }, 404, 'APPOINTMENT_NOT_FOUND');
  });

  it('fogpótlástanász csak a saját slotján lévő időpontot mondhatja le → 403', async () => {
    vi.mocked(requireRole).mockResolvedValue(dentist);
    primeHappyPath({ old: { time_slot_user_email: 'masik@dev.local' } });
    await expectRejected({ timeSlotId: NEW_SLOT }, 403, 'FORBIDDEN');
  });

  it('már lemondott / lezárt időpont → 409', async () => {
    primeHappyPath({ old: { appointment_status: 'cancelled_by_doctor' } });
    await expectRejected({ timeSlotId: NEW_SLOT }, 409, 'APPOINTMENT_NOT_OPEN');
  });

  it('beteg e-mail nélkül → 400', async () => {
    primeHappyPath({ old: { patient_email: '  ' } });
    await expectRejected({ timeSlotId: NEW_SLOT }, 400, 'PATIENT_EMAIL_REQUIRED');
  });

  it('ugyanaz a slot, mint a lemondott → 400', async () => {
    primeHappyPath();
    await expectRejected({ timeSlotId: OLD_SLOT }, 400, 'SAME_SLOT');
  });

  it('az ajánlott slot közben elkelt → 409', async () => {
    primeHappyPath({ newSlot: { state: 'booked', status: 'booked' } });
    await expectRejected({ timeSlotId: NEW_SLOT }, 409, 'SLOT_ALREADY_BOOKED');
  });

  it('múltbeli ajánlott slot → 400', async () => {
    primeHappyPath({ newSlot: { start_time: new Date(Date.now() - 3_600_000) } });
    await expectRejected({ timeSlotId: NEW_SLOT }, 400, 'SLOT_IN_PAST');
  });

  it('érvénytelen típus → 400', async () => {
    primeHappyPath();
    const res = await POST(req({ timeSlotId: NEW_SLOT, appointmentType: 'valami' }), { params: { id: OLD_ID } });
    expect(res.status).toBe(400);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('foglalt alternatíva → 400', async () => {
    primeHappyPath();
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (/FROM appointments a/.test(sql) && /FOR UPDATE OF a\b/.test(sql)) return { rows: [oldRow()] };
      if (/FOR UPDATE OF ats/.test(sql)) return { rows: [newSlotRow()] };
      if (/SELECT id, state, status, start_time FROM available_time_slots WHERE id = ANY/.test(sql)) {
        return { rows: [{ id: ALT_SLOT, state: 'booked', status: 'booked', start_time: future(6) }] };
      }
      return { rows: [] };
    });
    await expectRejected({ timeSlotId: NEW_SLOT, alternativeTimeSlotIds: [ALT_SLOT] }, 400, 'ALTERNATIVE_NOT_FREE');
  });

  it('DB-hiba írás közben → ROLLBACK + a hiba továbbmegy a közös hibakezelőnek', async () => {
    primeHappyPath();
    const base = clientQueryMock.getMockImplementation()!;
    clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO appointments/.test(sql)) throw new Error('boom');
      return base(sql, params);
    });
    const res = await POST(req({ timeSlotId: NEW_SLOT }), { params: { id: OLD_ID } });
    expect(res.status).toBe(500);
    expect(sqlCalls().map(([s]) => s)).toContain('ROLLBACK');
    expect(patientMailMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });
});
