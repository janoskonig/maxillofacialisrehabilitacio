import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { baselineAmendmentSchema, deliverySchema, encounterSchema, followupSchema, patientBurden, prosthesisSchema } from '@/lib/aftercare/model';
import { amendBaseline, deliverProsthesis, loadAftercareWorkspace, loadSchedulingRequests, recordCareEncounter, recordFollowup, registerProsthesis, updateSchedulingRequest } from '@/lib/aftercare/service';
import { createTestAppointment, createTestEpisode, createTestPatient, createTestSlot, createTestUser, createTestWorkPhase, cleanupCreated } from './helpers/factories';
import { authedRequest } from './helpers/auth';
import { GET, POST } from '@/app/api/patients/[id]/aftercare/route';
import { buildWorkloadResearchRows } from '@/lib/aftercare/research';

const patients: string[] = [];
afterEach(async () => {
  const db = getDbPool();
  if (patients.length) {
    const keys = await db.query(`SELECT id::text FROM prostheses WHERE patient_id = ANY($1::uuid[])
      UNION ALL SELECT id::text FROM prosthesis_care_encounters WHERE patient_id = ANY($1::uuid[])
      UNION ALL SELECT id::text FROM aftercare_requests WHERE patient_id = ANY($1::uuid[])`, [patients]);
    const episodes = await db.query('SELECT id FROM patient_episodes WHERE patient_id = ANY($1::uuid[])', [patients]);
    await db.query('DELETE FROM aftercare_requests WHERE patient_id = ANY($1::uuid[])', [patients]);
    await db.query('DELETE FROM prosthesis_followups WHERE prosthesis_id IN (SELECT id FROM prostheses WHERE patient_id = ANY($1::uuid[]))', [patients]);
    await db.query('DELETE FROM prosthesis_care_encounters WHERE patient_id = ANY($1::uuid[])', [patients]);
    await db.query('DELETE FROM clinical_followup_tasks WHERE patient_id = ANY($1::uuid[])', [patients]);
    await db.query('DELETE FROM clinical_episode_closures WHERE episode_id IN (SELECT id FROM patient_episodes WHERE patient_id=ANY($1::uuid[]))',[patients]);
    await db.query('DELETE FROM prosthesis_repair_work_phases WHERE patient_id=ANY($1::uuid[])',[patients]);
    await db.query('DELETE FROM episode_prosthesis_goals WHERE patient_id=ANY($1::uuid[])',[patients]);
    await db.query('DELETE FROM prosthesis_repair_cases WHERE patient_id=ANY($1::uuid[])',[patients]);
    await db.query('DELETE FROM clinical_dental_states WHERE patient_id=ANY($1::uuid[])',[patients]);
    await db.query('DELETE FROM prosthesis_clinical_events WHERE patient_id=ANY($1::uuid[])',[patients]);
    await db.query('DELETE FROM prosthesis_episode_links WHERE episode_id IN (SELECT id FROM patient_episodes WHERE patient_id=ANY($1::uuid[]))',[patients]);
    await db.query('DELETE FROM episode_work_phases WHERE episode_id IN (SELECT id FROM patient_episodes WHERE patient_id=ANY($1::uuid[]) AND parent_episode_id IS NOT NULL)',[patients]);
    await db.query('DELETE FROM prostheses WHERE patient_id = ANY($1::uuid[])', [patients]);
    await db.query('DELETE FROM prosthesis_workload_history WHERE entity_id = ANY($1::text[]) OR episode_id = ANY($2::uuid[])', [keys.rows.map((r) => r.id), episodes.rows.map((r) => r.id)]);
    await db.query('DELETE FROM patient_episodes WHERE patient_id=ANY($1::uuid[]) AND parent_episode_id IS NOT NULL',[patients]);
  }
  patients.length = 0;
  await cleanupCreated();
});
async function setup() {
  const doctor = await createTestUser();
  const patient = await createTestPatient(); patients.push(patient.id);
  const episode = await createTestEpisode(undefined, patient.id);
  await getDbPool().query('UPDATE patient_episodes SET treatment_plan = $2 WHERE id = $1', [episode.id, 'Original clinical plan']);
  const phase = await createTestWorkPhase(undefined, episode.id);
  const register = (jaw: 'felso' | 'also') => registerProsthesis(patient.id, doctor.id, prosthesisSchema.parse({ action: 'register',
    episodeId: episode.id, jaw, prosthesisType: jaw === 'felso' ? 'obturator' : 'screw_retained_implant_bridge', label: jaw }));
  async function appointment(day: string, status: 'completed' | 'no_show' | 'cancelled_by_patient' | null = 'completed') {
    const startTime = new Date(`${day}T10:00:00Z`);
    const slot = await createTestSlot(undefined, doctor.id, { startTime });
    const a = await createTestAppointment(undefined, { patientId: patient.id, episodeId: episode.id, timeSlotId: slot.id, startTime, appointmentStatus: status });
    await getDbPool().query('UPDATE appointments SET dentist_email = $2 WHERE id = $1', [a.id, doctor.email]);
    return a;
  }
  return { doctor, patient, episode, phase, register, appointment };
}
const link = (id: string) => ({ prosthesisId: id, problems: ['pain_pressure'], interventions: ['pressure_relief'], result: 'improved', nextAction: 'further_adjustment' });

describe('prosthesis aftercare persistence', () => {
  it('preserves baseline/original plan and subsequent structural changes; creates one review per confirmed delivery without duplicating retries', async () => {
    const s = await setup();
    const p = await s.register('felso');
    const registered=await getDbPool().query('SELECT episode_id FROM prostheses WHERE id=$1',[p.id]);
    const prosthesisEpisodeId=registered.rows[0].episode_id;
    await getDbPool().query('UPDATE episode_work_phases SET episode_id=$2 WHERE id=$1',[s.phase.id,prosthesisEpisodeId]);
    await getDbPool().query('UPDATE episode_work_phases SET duration_minutes = 45 WHERE id = $1', [s.phase.id]);
    await getDbPool().query('UPDATE patient_episodes SET treatment_plan = $2 WHERE id = $1', [prosthesisEpisodeId, 'Revised clinical plan']);
    const appointment = await s.appointment('2026-01-31');
    const delivery = deliverySchema.parse({ action: 'deliver', prosthesisId: p.id, appointmentId: appointment.id });
    await deliverProsthesis(s.patient.id, s.doctor.id, delivery);
    await deliverProsthesis(s.patient.id, s.doctor.id, delivery);
    const data = await loadAftercareWorkspace(s.patient.id);
    expect(data.prostheses[0]).toMatchObject({ deliveryDate: '2026-01-31', originalPlan: { treatmentPlan: 'Original clinical plan' }, baseline: { retrospective: true } });
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0]).toMatchObject({ dueOn: '2026-04-30', slotSecured: false });
    const history = await getDbPool().query('SELECT entity, old_data, new_data FROM prosthesis_workload_history WHERE episode_id = $1', [prosthesisEpisodeId]);
    expect(history.rows.some((h) => h.entity === 'episode_work_phases' && h.old_data.duration_minutes === 30 && h.new_data.duration_minutes === 45)).toBe(true);
    expect(history.rows.some((h) => h.entity === 'patient_episodes' && h.old_data.treatment_plan === 'Original clinical plan')).toBe(true);
    await amendBaseline(s.patient.id, s.doctor.id, baselineAmendmentSchema.parse({ action: 'amend_baseline', prosthesisId: p.id }));
    expect((await loadAftercareWorkspace(s.patient.id)).prostheses[0].baseline).toMatchObject({ amended: true, retrospective: true });
  });
  it('records a shared attended visit once, rejects stale overwrites, and reopens the scheduling queue after cancellation', async () => {
    const s = await setup();
    const upper = await s.register('felso'); const lower = await s.register('also');
    const delivery = await s.appointment('2026-01-31');
    for (const p of [upper, lower]) await deliverProsthesis(s.patient.id, s.doctor.id, deliverySchema.parse({ action: 'deliver', prosthesisId: p.id, appointmentId: delivery.id }));
    const adjustment = await s.appointment('2026-02-10');
    const input = encounterSchema.parse({ action: 'record_visit', appointmentId: adjustment.id, phase: 'aftercare', clinicalMinutes: 20, returnAfterDays: 14, links: [link(upper.id), link(lower.id)] });
    await recordCareEncounter(s.patient.id, s.doctor.id, input);
    await expect(recordCareEncounter(s.patient.id, s.doctor.id, input)).rejects.toMatchObject({ status: 409 });
    let data = await loadAftercareWorkspace(s.patient.id);
    expect(data.encounters).toHaveLength(1);
    expect(typeof data.encounters[0].occurredAt).toBe('string');
    expect(() => buildWorkloadResearchRows(s.patient.id, data, '2026-05-01')).not.toThrow();
    expect(patientBurden(data.prostheses, data.encounters, '2026-05-01')).toMatchObject({ problemVisits: 1, recordedClinicalMinutes: 20 });
    const request = data.requests.find((r) => r.source === 'visit_return')!;
    const followup = await s.appointment('2026-02-24', null);
    await updateSchedulingRequest(request.id, s.doctor.id, { appointmentId: followup.id, delayReason: 'capacity', expectedVersion: request.version });
    expect((await loadSchedulingRequests(getDbPool(), s.patient.id)).find((r) => r.id === request.id)?.slotSecured).toBe(true);
    await getDbPool().query("UPDATE appointments SET appointment_status = 'cancelled_by_patient' WHERE id = $1", [followup.id]);
    data = await loadAftercareWorkspace(s.patient.id);
    expect(data.requests.find((r) => r.id === request.id)).toMatchObject({ slotSecured: false, completed: false, delayReason: 'capacity' });
    await recordCareEncounter(s.patient.id, s.doctor.id, { ...input, expectedVersion: 1, clinicalMinutes: 25 });
    expect((await loadAftercareWorkspace(s.patient.id)).encounters[0].version).toBe(2);
    await getDbPool().query('DELETE FROM appointments WHERE id = $1', [followup.id]);
    expect((await loadSchedulingRequests(getDbPool(), s.patient.id)).find((r) => r.id === request.id)).toMatchObject({ appointmentId: null, slotSecured: false });
    await getDbPool().query("UPDATE appointments SET appointment_status = 'no_show' WHERE id = $1", [delivery.id]);
    const unconfirmed = await loadAftercareWorkspace(s.patient.id);
    expect(patientBurden(unconfirmed.prostheses, unconfirmed.encounters, '2026-05-01').problemVisits).toBe(0);
  });
  it('rejects no-shows, cross-patient links, before-delivery aftercare and premature three-month ascertainment', async () => {
    const s = await setup(); const p = await s.register('felso');
    const a = await s.appointment('2026-02-10', 'no_show');
    await expect(deliverProsthesis(s.patient.id, s.doctor.id, deliverySchema.parse({ action: 'deliver', prosthesisId: p.id, appointmentId: a.id }))).rejects.toMatchObject({ status: 409 });
    const attended = await s.appointment('2026-02-12');
    const input = encounterSchema.parse({ action: 'record_visit', appointmentId: attended.id, phase: 'aftercare', returnAfterDays: 14, links: [link(p.id)] });
    await expect(recordCareEncounter(s.patient.id, s.doctor.id, input)).rejects.toMatchObject({ status: 409 });
    const other = await createTestPatient(); patients.push(other.id);
    await expect(deliverProsthesis(other.id, s.doctor.id, deliverySchema.parse({ action: 'deliver', prosthesisId: p.id, appointmentId: attended.id }))).rejects.toMatchObject({ status: 404 });
    await deliverProsthesis(s.patient.id, s.doctor.id, deliverySchema.parse({ action: 'deliver', prosthesisId: p.id, appointmentId: attended.id }));
    await expect(recordFollowup(s.patient.id, s.doctor.id, followupSchema.parse({ action: 'followup', prosthesisId: p.id, assessedOn: '2026-03-01',
      status: 'unknown', contactMethod: 'record_review', unresolved: null }))).rejects.toMatchObject({ status: 409 });
    await recordFollowup(s.patient.id, s.doctor.id, followupSchema.parse({ action: 'followup', prosthesisId: p.id, assessedOn: '2026-05-12',
      status: 'access_barrier', contactMethod: 'phone', unresolved: null }));
    const data = await loadAftercareWorkspace(s.patient.id);
    expect(data.prostheses[0].followup).toMatchObject({ status: 'access_barrier', unresolved: null });
    expect(data.requests[0].completed).toBe(true);
    // Later care remains recordable after the research window and follow-up.
    const later = await s.appointment('2026-06-01');
    await recordCareEncounter(s.patient.id, s.doctor.id, { ...input, appointmentId: later.id });
    expect((await loadAftercareWorkspace(s.patient.id)).encounters).toHaveLength(1);
  });
  it('enforces staff roles and validates clinical payloads before writing', async () => {
    const s = await setup();
    const auth = { id: s.doctor.id, email: s.doctor.email, role: 'fogpótlástanász' as const };
    const invalid = await POST(await authedRequest(`http://localhost/api/patients/${s.patient.id}/aftercare`, { user: auth, method: 'POST', body: { action: 'record_visit' } }), { params: { id: s.patient.id } });
    expect(invalid.status).toBe(400);
    const tech = await createTestUser(undefined, { role: 'technikus' });
    const forbidden = await GET(await authedRequest(`http://localhost/api/patients/${s.patient.id}/aftercare`, { user: { id: tech.id, email: tech.email, role: 'technikus' } }), { params: { id: s.patient.id } });
    expect(forbidden.status).toBe(403);
  });
  it('saves a routine review without creating a return request when the clinician did not request one', async () => {
    const s = await setup(); const prosthesis = await s.register('felso');
    const delivery = await s.appointment('2026-01-31');
    await deliverProsthesis(s.patient.id, s.doctor.id, deliverySchema.parse({ action: 'deliver', prosthesisId: prosthesis.id, appointmentId: delivery.id }));
    const review = await s.appointment('2026-02-10');
    await recordCareEncounter(s.patient.id, s.doctor.id, encounterSchema.parse({ action: 'record_visit', appointmentId: review.id,
      phase: 'aftercare', returnAfterDays: null, links: [{ prosthesisId: prosthesis.id, problems: [], interventions: ['advice'], result: null, nextAction: null }] }));
    const data = await loadAftercareWorkspace(s.patient.id);
    expect(data.encounters).toHaveLength(1);
    expect(data.requests).toHaveLength(1);
    expect(data.requests[0].source).toBe('delivery_review');
    expect(patientBurden(data.prostheses, data.encounters, '2026-05-01').problemVisits).toBe(0);
  });
  it('keeps a shared return request open until every requested prosthesis is documented', async () => {
    const s = await setup(); const upper = await s.register('felso'); const lower = await s.register('also');
    const delivery = await s.appointment('2026-01-31');
    for (const p of [upper, lower]) await deliverProsthesis(s.patient.id, s.doctor.id, deliverySchema.parse({ action: 'deliver', prosthesisId: p.id, appointmentId: delivery.id }));
    const first = await s.appointment('2026-02-10');
    await recordCareEncounter(s.patient.id, s.doctor.id, encounterSchema.parse({ action: 'record_visit', appointmentId: first.id, phase: 'aftercare', returnAfterDays: 14, links: [link(upper.id), link(lower.id)] }));
    const request = (await loadAftercareWorkspace(s.patient.id)).requests.find((r) => r.source === 'visit_return')!;
    const second = await s.appointment('2026-02-24');
    await updateSchedulingRequest(request.id, s.doctor.id, { appointmentId: second.id, delayReason: 'none', expectedVersion: request.version });
    const input = encounterSchema.parse({ action: 'record_visit', appointmentId: second.id, phase: 'aftercare', returnAfterDays: 14, links: [link(upper.id)] });
    await recordCareEncounter(s.patient.id, s.doctor.id, input);
    expect((await loadSchedulingRequests(getDbPool(), s.patient.id)).find((r) => r.id === request.id)?.completed).toBe(false);
    await recordCareEncounter(s.patient.id, s.doctor.id, encounterSchema.parse({ ...input, expectedVersion: 1, links: [link(upper.id), link(lower.id)] }));
    expect((await loadSchedulingRequests(getDbPool(), s.patient.id)).find((r) => r.id === request.id)?.completed).toBe(true);
  });
});


it('snapshots both jaw plans and audits later jaw-specific changes without rewriting the baseline', async () => {
  const s = await setup();
  const db = getDbPool();
  await db.query('UPDATE patient_episodes SET treatment_plan_upper=$2,treatment_plan_lower=$3 WHERE id=$1', [s.episode.id, 'Original upper plan', 'Original lower plan']);
  const p = await s.register('felso');
  const episodeId=(await db.query('SELECT episode_id FROM prostheses WHERE id=$1',[p.id])).rows[0].episode_id;
  await db.query('UPDATE patient_episodes SET treatment_plan_upper=$2 WHERE id=$1', [episodeId, 'Revised upper plan']);
  await db.query('UPDATE patient_episodes SET treatment_plan_lower=$2 WHERE id=$1', [episodeId, 'Revised lower plan']);
  const data = await loadAftercareWorkspace(s.patient.id);
  expect(data.prostheses.find((item) => item.id === p.id)?.originalPlan).toMatchObject({
    treatmentPlan: 'Original clinical plan', treatmentPlanUpper: 'Original upper plan', treatmentPlanLower: 'Original lower plan',
  });
  const audit = await db.query("SELECT old_data,new_data FROM prosthesis_workload_history WHERE episode_id=$1 AND entity='patient_episodes' ORDER BY id", [episodeId]);
  expect(audit.rows).toHaveLength(2);
  expect(audit.rows[0].new_data.treatment_plan_upper).toBe('Revised upper plan');
  expect(audit.rows[1].old_data.treatment_plan_lower).toBe('Original lower plan');
  expect(audit.rows[1].new_data.treatment_plan_lower).toBe('Revised lower plan');
});
