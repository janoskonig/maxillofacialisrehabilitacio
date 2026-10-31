import { describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  completeness, encounterSchema, followupSchema, observationEnd, patientBurden, prosthesisMetrics,
  type AftercareWorkspace, type CareEncounter, type CareLink, type Prosthesis,
} from '@/lib/aftercare/model';
import { buildWorkloadResearchRows } from '@/lib/aftercare/research';
import { assertExportPhiSafe } from '@/lib/research-registry/phi-safety';

const upper: Prosthesis = { id: randomUUID(), patientId: randomUUID(), episodeId: randomUUID(), label: 'Upper', jaw: 'felso',
  prosthesisType: 'obturator', baseline: { nem: 'nő', ageBandStart: 50, maxilladefektus_van: false, mandibuladefektus_van: false },
  originalPlan: {}, createdAt: '2026-01-01', deliveryDate: '2026-01-31', deliveryAppointmentId: randomUUID() };
const lower: Prosthesis = { ...upper, id: randomUUID(), label: 'Lower', jaw: 'also', deliveryDate: '2026-02-28', deliveryAppointmentId: randomUUID() };
const link = (prosthesisId: string, patch: Partial<CareLink> = {}): CareLink => ({ prosthesisId, problems: ['pain_pressure'],
  interventions: ['pressure_relief'], result: 'improved', nextAction: 'further_adjustment', functionScore: null, comfortScore: null, ...patch });
const visit = (day: string, links = [link(upper.id)], patch: Partial<CareEncounter> = {}): CareEncounter => ({
  id: randomUUID(), appointmentId: randomUUID(), occurredOn: day, phase: 'aftercare', appointmentStatus: 'completed',
  clinician: 'doctor@example.test', clinicalMinutes: null, constructionActivities: [], planDeviation: '', delayReason: 'none',
  note: '', returnAfterDays: 14, version: 1, links, ...patch,
});

describe('delivery-linked workload measurements', () => {
  it.each([['2026-01-31', '2026-04-30'], ['2025-11-30', '2026-02-28'], ['2023-11-30', '2024-02-29'], ['2026-08-31', '2026-11-30']])('clamps three calendar months from %s', (from, to) => {
    expect(observationEnd(from)).toBe(to);
  });
  it('counts shared attendance once, using each prosthesis window and excluding routine, cancelled, pending, no-show and delivery visits', () => {
    const visits = [
      visit('2026-03-01', [link(upper.id), link(lower.id)], { clinicalMinutes: 20 }),
      visit('2026-04-30', [link(upper.id), link(lower.id)], { clinicalMinutes: 10 }), // upper boundary excluded
      visit('2026-03-02', [link(upper.id, { problems: [], interventions: ['advice'], result: null, nextAction: 'routine_review' })]),
      visit('2026-03-03', undefined, { appointmentStatus: 'cancelled_by_patient' }),
      visit('2026-03-04', undefined, { appointmentStatus: 'no_show' }),
      visit('2026-03-05', undefined, { appointmentStatus: null }),
      visit('2026-01-31', undefined, { appointmentId: upper.deliveryAppointmentId! }),
      visit('2026-05-01', [link(lower.id)], { appointmentStatus: 'unsuccessful' }),
    ];
    expect(prosthesisMetrics(upper, visits, '2026-06-01')).toMatchObject({ problemVisits: 1, routineVisits: 1, recordedClinicalMinutes: 20, visitsWithRecordedMinutes: 1 });
    expect(prosthesisMetrics(lower, visits, '2026-06-01').problemVisits).toBe(3);
    expect(patientBurden([upper, lower], visits, '2026-06-01')).toEqual({ problemVisits: 3, recordedClinicalMinutes: 30, visitsWithRecordedMinutes: 2 });
  });
  it('keeps repeated adjustments, repairs, remakes and unresolved categories separate', () => {
    const visits = [visit('2026-02-01'), visit('2026-02-10'),
      visit('2026-02-20', [link(upper.id, { problems: ['mechanical'], interventions: ['repair', 'remake'], result: 'resolved' })]),
      visit('2026-02-21', [link(upper.id, { problems: [], interventions: ['advice'], result: null })])];
    expect(prosthesisMetrics(upper, visits, '2026-05-01')).toMatchObject({ problemVisits: 3, routineVisits: 1,
      repeatedAdjustmentVisits: 1, repairs: 1, remakes: 1, unresolvedProblemCategories: ['pain_pressure'], visitsWithRecordedMinutes: 0 });
  });
  it('uses actual appointment time for same-day problem resolution, regardless of documentation order or UUID', () => {
    const late = visit('2026-03-01', [link(upper.id, { result: 'resolved' })], { id: 'a', occurredAt: '2026-03-01T15:00:00Z' });
    const early = visit('2026-03-01', [link(upper.id)], { id: 'z', occurredAt: '2026-03-01T09:00:00Z' });
    expect(prosthesisMetrics(upper, [late, early], '2026-05-01').unresolvedProblemCategories).toEqual([]);
  });
  it('separates future completeness from due omissions and does not infer comfort from no return visits', () => {
    expect(completeness(upper, [], '2026-03-01')).toMatchObject({ due: [], future: ['Háromhavi követés: 2026-04-30'] });
    expect(completeness(upper, [], '2026-05-01').due).toContain('Háromhavi követés állapota');
    expect(prosthesisMetrics(upper, [], '2026-03-01')).toMatchObject({ observationComplete: false, followupRecorded: false });
  });
});

describe('structured clinical validation', () => {
  const input = { action: 'record_visit', appointmentId: randomUUID(), phase: 'aftercare', returnAfterDays: 14, links: [link(upper.id)] };
  it('requires a result and next action for problems and rejects duplicate prostheses', () => {
    expect(encounterSchema.safeParse(input).success).toBe(true);
    expect(encounterSchema.safeParse({ ...input, links: [link(upper.id, { result: null })] }).success).toBe(false);
    expect(encounterSchema.safeParse({ ...input, links: [link(upper.id), link(upper.id)] }).success).toBe(false);
    expect(encounterSchema.safeParse({ ...input, returnAfterDays: null }).success).toBe(false);
  });
  it('allows a problem-free routine review but requires assessed problems for actual adjustments', () => {
    expect(encounterSchema.safeParse({ ...input, links: [link(upper.id, { problems: [], result: null, interventions: ['advice'] })] }).success).toBe(true);
    expect(encounterSchema.safeParse({ ...input, links: [link(upper.id, { problems: [], result: null })] }).success).toBe(false);
  });
  it('accepts a completed adjustment without inventing a return visit, and requires a purpose only when a slot is requested', () => {
    expect(encounterSchema.safeParse({ ...input, returnAfterDays: null, links: [link(upper.id, { result: 'resolved', nextAction: null })] }).success).toBe(true);
    expect(encounterSchema.safeParse({ ...input, links: [link(upper.id, { nextAction: null })] }).success).toBe(false);
  });
  it('rejects invented measurements or contradictory follow-up findings for unknown patients', () => {
    const f = { action: 'followup', prosthesisId: upper.id, assessedOn: '2026-05-01', status: 'unknown', contactMethod: 'record_review', unresolved: null };
    expect(followupSchema.safeParse(f).success).toBe(true);
    expect(followupSchema.safeParse({ ...f, functionScore: 5 }).success).toBe(false);
    expect(followupSchema.safeParse({ ...f, status: 'comfortable', unresolved: false }).success).toBe(false);
    expect(followupSchema.safeParse({ ...f, assessedOn: '2026-02-30' }).success).toBe(false);
  });
});

it('exports separate subject/prosthesis/visit rows without free text, direct IDs, dates, or clinician email', () => {
  const v = visit('2026-03-01', [link(upper.id), link(lower.id)], { note: 'Jane Sensitive 123 456 789', clinicalMinutes: null });
  const data: AftercareWorkspace = { patientName: 'Jane Sensitive', deceased: false, episodes: [],
    prostheses: [upper, lower, { ...upper, id: randomUUID(), deliveryDate: null }], encounters: [v], appointments: [], requests: [] };
  const rows = buildWorkloadResearchRows(upper.patientId, data, '2026-05-01');
  const output = JSON.stringify(rows);
  expect(output).not.toContain('Jane');
  expect(output).not.toContain(upper.id);
  expect(output).not.toContain(v.clinician);
  expect(output).not.toContain(v.occurredOn);
  expect(rows.find((r) => r.recordType === 'subject')).toMatchObject({ problemVisits: 1, visitsWithRecordedMinutes: 0 });
  expect(rows.filter((r) => r.recordType === 'prosthesis').at(-1)?.problemVisits).toBeNull();
  expect(rows.find((r) => r.recordType === 'visit')?.clinicalMinutes).toBeNull();
  expect(() => assertExportPhiSafe(rows)).not.toThrow();
});
