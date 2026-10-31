import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  addDays, attended, budapestToday, observationEnd, slotSecured,
  type AftercareWorkspace, type CareAppointment, type CareEncounter, type Prosthesis, type SchedulingRequest,
  type prosthesisSchema, type deliverySchema, type encounterSchema, type followupSchema, type queueUpdateSchema, type baselineAmendmentSchema,
} from './model';
import type { z } from 'zod';

type Db = Pick<Pool, 'query'> | PoolClient;
const BASELINE_SQL = `jsonb_build_object('nem', p.nem, 'ageBandStart', (EXTRACT(year FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Budapest')::date, p.szuletesi_datum))::int / 5) * 5,
  'kezelesre_erkezes_indoka', p.kezelesre_erkezes_indoka, 'radioterapia', p.radioterapia,
  'maxilladefektus_van', p.maxilladefektus_van, 'mandibuladefektus_van', p.mandibuladefektus_van,
  'brown_fuggoleges_osztaly', p.brown_fuggoleges_osztaly, 'brown_vizszintes_komponens', p.brown_vizszintes_komponens,
  'kovacs_dobak_osztaly', p.kovacs_dobak_osztaly,
  'maxilla_defektus_raszter', p.maxilla_defektus_raszter, 'mandibula_defektus_raszter', p.mandibula_defektus_raszter)`;
const PROSTHESIS_SELECT = `SELECT pr.id, pr.patient_id AS "patientId", pr.episode_id AS "episodeId", pr.jaw,
  pr.prosthesis_type AS "prosthesisType", pr.label, pr.baseline, pr.original_plan AS "originalPlan",
  pr.delivery_date::text AS "deliveryDate", pr.delivery_appointment_id AS "deliveryAppointmentId", pr.created_at AS "createdAt",
  CASE WHEN pr.delivery_date IS NOT NULL THEN da.appointment_status IS NOT DISTINCT FROM 'completed' END AS "deliveryConfirmed",
  CASE WHEN f.prosthesis_id IS NOT NULL THEN json_build_object(
    'assessedOn', f.assessed_on::text, 'status', f.status, 'contactMethod', f.contact_method,
    'unresolved', f.unresolved, 'functionScore', f.function_score, 'comfortScore', f.comfort_score) END AS followup
  FROM prostheses pr LEFT JOIN prosthesis_followups f ON f.prosthesis_id = pr.id
  LEFT JOIN appointments da ON da.id = pr.delivery_appointment_id`;
const ENCOUNTER_SELECT = `SELECT c.id, c.appointment_id AS "appointmentId", c.phase, c.occurred_on::text AS "occurredOn", c.occurred_at AS "occurredAt",
  a.appointment_status AS "appointmentStatus", c.clinician_email AS clinician, c.clinical_minutes AS "clinicalMinutes",
  c.construction_activities AS "constructionActivities", c.plan_deviation AS "planDeviation", c.delay_reason AS "delayReason",
  c.note, c.return_after_days AS "returnAfterDays", c.links, c.version
  FROM prosthesis_care_encounters c JOIN appointments a ON a.id = c.appointment_id`;
const APPOINTMENT_SELECT = `SELECT a.id, a.episode_id AS "episodeId",
  COALESCE(a.start_time, s.start_time) AS "startTime",
  (COALESCE(a.start_time, s.start_time) AT TIME ZONE 'Europe/Budapest')::date::text AS "occurredOn",
  a.appointment_status AS "appointmentStatus", a.dentist_email AS clinician
  FROM appointments a LEFT JOIN available_time_slots s ON s.id = a.time_slot_id`;

export async function loadSchedulingRequests(db: Db, patientId?: string): Promise<SchedulingRequest[]> {
  const r = await db.query(`SELECT r.id, r.patient_id AS "patientId", p.nev AS "patientName", r.episode_id AS "episodeId",
    CASE WHEN r.delivery_prosthesis_id IS NOT NULL THEN 'delivery_review' ELSE 'visit_return' END AS source,
    COALESCE(pr.label, (SELECT string_agg(p2.label, ', ' ORDER BY p2.jaw, p2.id) FROM prostheses p2
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(c.links) l WHERE l->>'prosthesisId' = p2.id::text))) AS "prosthesisLabels",
    CASE WHEN pr.id IS NOT NULL THEN jsonb_build_array(pr.id)
      ELSE (SELECT jsonb_agg(l->>'prosthesisId') FROM jsonb_array_elements(c.links) l) END AS "prosthesisIds",
    r.requested_on::text AS "requestedOn", r.due_on::text AS "dueOn", r.interval_days AS "intervalDays",
    r.next_action AS "nextAction", r.appointment_id AS "appointmentId",
    COALESCE(a.start_time, s.start_time) AS "appointmentStart", a.appointment_status AS "appointmentStatus",
    r.delay_reason AS "delayReason", r.version,
    CASE WHEN r.delivery_prosthesis_id IS NOT NULL THEN f.prosthesis_id IS NOT NULL
      ELSE EXISTS (SELECT 1 FROM prosthesis_care_encounters done JOIN appointments da ON da.id = done.appointment_id
        WHERE done.appointment_id = r.appointment_id AND da.appointment_status IN ('completed', 'unsuccessful')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.links) sl WHERE NOT EXISTS
          (SELECT 1 FROM jsonb_array_elements(done.links) dl WHERE dl->>'prosthesisId' = sl->>'prosthesisId'))) END AS completed
    FROM aftercare_requests r JOIN patients p ON p.id = r.patient_id
    LEFT JOIN prostheses pr ON pr.id = r.delivery_prosthesis_id
    LEFT JOIN prosthesis_followups f ON f.prosthesis_id = pr.id
    LEFT JOIN prosthesis_care_encounters c ON c.id = r.encounter_id
    LEFT JOIN appointments a ON a.id = r.appointment_id
    LEFT JOIN available_time_slots s ON s.id = a.time_slot_id
    WHERE p.halal_datum IS NULL ${patientId ? 'AND r.patient_id = $1' : ''}
    ORDER BY r.due_on, r.id`, patientId ? [patientId] : []);
  return r.rows.map((row) => ({ ...row,
    appointmentStart: row.appointmentStart ? new Date(row.appointmentStart).toISOString() : null,
    slotSecured: slotSecured(row.appointmentStatus, row.appointmentId) })) as SchedulingRequest[];
}

export async function loadAftercareWorkspace(patientId: string, db: Db = getDbPool()): Promise<AftercareWorkspace> {
  const patient = await db.query('SELECT nev, halal_datum FROM patients WHERE id = $1', [patientId]);
  if (!patient.rows.length) throw new HttpError(404, 'Beteg nem található');
  const [prostheses, encounters, appointments, episodes, requests] = await Promise.all([
    db.query(`${PROSTHESIS_SELECT} WHERE pr.patient_id = $1 ORDER BY pr.created_at, pr.id`, [patientId]),
    db.query(`${ENCOUNTER_SELECT} WHERE c.patient_id = $1 ORDER BY c.occurred_at, c.created_at, c.id`, [patientId]),
    db.query(`${APPOINTMENT_SELECT} WHERE a.patient_id = $1 ORDER BY COALESCE(a.start_time, s.start_time) DESC`, [patientId]),
    db.query(`SELECT id, COALESCE(case_title, chief_complaint, reason) AS label, status
      FROM patient_episodes WHERE patient_id = $1 ORDER BY opened_at DESC`, [patientId]),
    loadSchedulingRequests(db, patientId),
  ]);
  return {
    patientName: patient.rows[0].nev, deceased: !!patient.rows[0].halal_datum,
    episodes: episodes.rows,
    prostheses: prostheses.rows.map((p) => ({ ...p, createdAt: new Date(p.createdAt).toISOString() })),
    encounters: encounters.rows.map((c) => ({ ...c, occurredAt: new Date(c.occurredAt).toISOString() })),
    appointments: appointments.rows.map((a) => ({ ...a, startTime: new Date(a.startTime).toISOString() })), requests,
  };
}

async function transaction<T>(actorId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await getDbPool().connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.aftercare_actor', $1, true)", [actorId]);
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally { db.release(); }
}
async function patientForWrite(db: Db, patientId: string) {
  const r = await db.query('SELECT id, halal_datum FROM patients WHERE id = $1 FOR SHARE', [patientId]);
  if (!r.rows.length) throw new HttpError(404, 'Beteg nem található');
  if (r.rows[0].halal_datum) throw new HttpError(409, 'Elhunyt beteghez új ellátási adat nem rögzíthető');
}
async function appointmentForWrite(db: Db, patientId: string, id: string): Promise<CareAppointment> {
  const r = await db.query(`${APPOINTMENT_SELECT} WHERE a.id = $1 AND a.patient_id = $2 FOR UPDATE OF a`, [id, patientId]);
  if (!r.rows.length) throw new HttpError(404, 'A beteg időpontja nem található');
  return r.rows[0];
}
async function prosthesisForWrite(db: Db, patientId: string, id: string): Promise<Prosthesis> {
  const r = await db.query(`${PROSTHESIS_SELECT} WHERE pr.id = $1 AND pr.patient_id = $2 FOR UPDATE OF pr`, [id, patientId]);
  if (!r.rows.length) throw new HttpError(404, 'A beteg fogpótlása nem található');
  return r.rows[0];
}
function assertAttended(appointment: CareAppointment) {
  if (!attended(appointment.appointmentStatus)) throw new HttpError(409, 'Előbb rögzítse az időpont megjelent kimenetelét');
  if (!appointment.occurredOn || appointment.occurredOn > budapestToday()) throw new HttpError(409, 'Jövőbeli időpont nem dokumentálható megtörtént vizitként');
}

export async function registerProsthesis(patientId: string, actor: string, input: z.infer<typeof prosthesisSchema>) {
  return transaction(actor, async (db) => {
    await patientForWrite(db, patientId);
    const ep = await db.query('SELECT id, status FROM patient_episodes WHERE id = $1 AND patient_id = $2 FOR UPDATE', [input.episodeId, patientId]);
    if (!ep.rows.length) throw new HttpError(404, 'A beteg epizódja nem található');
    if (ep.rows[0].status !== 'open') throw new HttpError(409, 'Új fogpótlás nyitott epizódhoz vehető fel');
    const r = await db.query(`INSERT INTO prostheses(patient_id, episode_id, jaw, prosthesis_type, label, baseline, original_plan, created_by)
      SELECT $1, pe.id, $3, $4, $5,
        ${BASELINE_SQL},
        jsonb_build_object('treatmentPlan', pe.treatment_plan, 'treatmentPlanUpper', pe.treatment_plan_upper,
          'treatmentPlanLower', pe.treatment_plan_lower, 'capturedAt', now(), 'workPhases',
          COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY COALESCE(w.seq, w.pathway_order_index), w.id)
            FROM episode_work_phases w WHERE w.episode_id = pe.id), '[]'::jsonb)), $6
      FROM patient_episodes pe JOIN patients_full p ON p.id = pe.patient_id
      WHERE pe.id = $2 RETURNING id`, [patientId, input.episodeId, input.jaw, input.prosthesisType, input.label, actor]);
    return r.rows[0];
  });
}

export async function deliverProsthesis(patientId: string, actor: string, input: z.infer<typeof deliverySchema>) {
  return transaction(actor, async (db) => {
    await patientForWrite(db, patientId);
    // Appointment before prosthesis is the shared lock ordering for all care writes.
    const appointment = await appointmentForWrite(db, patientId, input.appointmentId);
    assertAttended(appointment);
    if (appointment.appointmentStatus !== 'completed') throw new HttpError(409, 'Az átadási időpont eredménye teljesült kell legyen');
    const p = await prosthesisForWrite(db, patientId, input.prosthesisId);
    if (p.deliveryDate) {
      if (p.deliveryAppointmentId === appointment.id) return { id: p.id }; // safe retry
      throw new HttpError(409, 'Az átadás már rögzítve van');
    }
    if (appointment.episodeId && appointment.episodeId !== p.episodeId) throw new HttpError(409, 'Az átadás másik epizódhoz tartozik');
    if (new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date(p.createdAt)) > appointment.occurredOn) {
      // Retrospective registration is supported, but its snapshot must be explicitly labelled.
      // Do not silently manufacture historical baseline data.
      await db.query(`UPDATE prostheses SET baseline = baseline || '{"retrospective":true}'::jsonb WHERE id = $1`, [p.id]);
    }
    const prior = await db.query(`SELECT id FROM prosthesis_care_encounters WHERE appointment_id = $1
      AND phase = 'aftercare' AND EXISTS (SELECT 1 FROM jsonb_array_elements(links) l WHERE l->>'prosthesisId' = $2)`, [appointment.id, p.id]);
    if (prior.rows.length) throw new HttpError(409, 'Az átadási időpont nem lehet ugyanennek a fogpótlásnak utógondozási vizitje');
    await db.query('UPDATE prostheses SET delivery_date = $2, delivery_appointment_id = $3 WHERE id = $1', [p.id, appointment.occurredOn, appointment.id]);
    await db.query(`INSERT INTO aftercare_requests(patient_id, episode_id, delivery_prosthesis_id, requested_on, due_on, next_action, updated_by)
      VALUES ($1, $2, $3, $4, $5, 'routine_review', $6)`, [patientId, p.episodeId, p.id, appointment.occurredOn, observationEnd(appointment.occurredOn), actor]);
    return { id: p.id };
  });
}

export async function amendBaseline(patientId: string, actor: string, input: z.infer<typeof baselineAmendmentSchema>) {
  return transaction(actor, async (db) => {
    await patientForWrite(db, patientId);
    const prosthesis = await prosthesisForWrite(db, patientId, input.prosthesisId);
    // Corrections stay traceable. After delivery these are explicitly retrospective,
    // never presented as an assessment that was captured before treatment.
    await db.query(`UPDATE prostheses pr SET baseline = ${BASELINE_SQL}
      || jsonb_build_object('amended', true, 'retrospective', $3::boolean, 'amendedAt', now())
      FROM patients_full p WHERE pr.id = $1 AND p.id = $2`,
    [prosthesis.id, patientId, !!prosthesis.deliveryDate || prosthesis.baseline.retrospective === true]);
    return { id: prosthesis.id };
  });
}

export async function recordCareEncounter(patientId: string, actor: string, input: z.infer<typeof encounterSchema>) {
  return transaction(actor, async (db) => {
    await patientForWrite(db, patientId);
    const appointment = await appointmentForWrite(db, patientId, input.appointmentId);
    assertAttended(appointment);
    const linked: Prosthesis[] = [];
    for (const link of [...input.links].sort((a, b) => a.prosthesisId.localeCompare(b.prosthesisId))) {
      const p = await prosthesisForWrite(db, patientId, link.prosthesisId);
      if (input.phase === 'aftercare' && (!p.deliveryDate || p.deliveryConfirmed === false || appointment.occurredOn < p.deliveryDate || p.deliveryAppointmentId === appointment.id)) {
        throw new HttpError(409, 'Utógondozás csak az érintett fogpótlás átadása utáni külön időponton rögzíthető');
      }
      if (input.phase === 'construction' && p.deliveryDate && appointment.occurredOn > p.deliveryDate) {
        throw new HttpError(409, 'Az átadás utáni ellátást utógondozásként dokumentálja');
      }
      linked.push(p);
    }
    const existing = await db.query('SELECT id, version FROM prosthesis_care_encounters WHERE appointment_id = $1 FOR UPDATE', [appointment.id]);
    if (Number(existing.rows[0]?.version ?? 0) !== input.expectedVersion) throw new HttpError(409, 'A vizit megváltozott. Töltse újra szerkesztés előtt.');
    const values = [patientId, appointment.id, input.phase, appointment.occurredOn, appointment.clinician,
      input.clinicalMinutes, input.constructionActivities, input.planDeviation, input.delayReason, input.note,
      input.returnAfterDays, JSON.stringify(input.links), actor, appointment.startTime];
    const result = await db.query(`INSERT INTO prosthesis_care_encounters(patient_id, appointment_id, phase, occurred_on, clinician_email,
      clinical_minutes, construction_activities, plan_deviation, delay_reason, note, return_after_days, links, recorded_by, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
      ON CONFLICT (appointment_id) DO UPDATE SET phase = EXCLUDED.phase, occurred_on = EXCLUDED.occurred_on,
        clinician_email = EXCLUDED.clinician_email, clinical_minutes = EXCLUDED.clinical_minutes,
        construction_activities = EXCLUDED.construction_activities, plan_deviation = EXCLUDED.plan_deviation,
        delay_reason = EXCLUDED.delay_reason, note = EXCLUDED.note, return_after_days = EXCLUDED.return_after_days,
        links = EXCLUDED.links, recorded_by = EXCLUDED.recorded_by, occurred_at = EXCLUDED.occurred_at,
        version = prosthesis_care_encounters.version + 1, updated_at = now()
      RETURNING id, version`, values);
    const encounterId = result.rows[0].id;
    const request = await db.query('SELECT *, due_on::text AS due_on FROM aftercare_requests WHERE encounter_id = $1 FOR UPDATE', [encounterId]);
    if (request.rows.length && (request.rows[0].appointment_id || request.rows[0].delay_reason !== 'none')
      && (request.rows[0].interval_days !== input.returnAfterDays || addDays(appointment.occurredOn, input.returnAfterDays ?? 0) !== request.rows[0].due_on)) {
      throw new HttpError(409, 'Az egyeztetett visszarendelést előbb oldja fel az ütemezési sorban');
    }
    if (input.returnAfterDays) {
      const nextActions = Array.from(new Set(input.links.map((l) => l.nextAction).filter(Boolean))).sort().join(',') || 'other_followup';
      await db.query(`INSERT INTO aftercare_requests(patient_id, episode_id, encounter_id, requested_on, due_on, interval_days, next_action, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (encounter_id) DO UPDATE SET due_on = EXCLUDED.due_on, interval_days = EXCLUDED.interval_days,
          next_action = EXCLUDED.next_action, updated_by = EXCLUDED.updated_by, version = aftercare_requests.version + 1, updated_at = now()`,
      [patientId, linked[0].episodeId, encounterId, appointment.occurredOn, addDays(appointment.occurredOn, input.returnAfterDays), input.returnAfterDays, nextActions, actor]);
    } else if (request.rows.length) await db.query('DELETE FROM aftercare_requests WHERE encounter_id = $1', [encounterId]);
    return result.rows[0];
  });
}

export async function recordFollowup(patientId: string, actor: string, input: z.infer<typeof followupSchema>) {
  return transaction(actor, async (db) => {
    await patientForWrite(db, patientId);
    const p = await prosthesisForWrite(db, patientId, input.prosthesisId);
    if (!p.deliveryDate || p.deliveryConfirmed === false || input.assessedOn < observationEnd(p.deliveryDate) || input.assessedOn > budapestToday()) {
      throw new HttpError(409, 'A háromhavi követés az ablak lezárásától a mai napig rögzíthető');
    }
    const r = await db.query(`INSERT INTO prosthesis_followups(prosthesis_id, assessed_on, status, contact_method,
      unresolved, function_score, comfort_score, note, recorded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (prosthesis_id) DO NOTHING RETURNING prosthesis_id AS id`,
    [p.id, input.assessedOn, input.status, input.contactMethod, input.unresolved, input.functionScore, input.comfortScore, input.note, actor]);
    if (!r.rows.length) throw new HttpError(409, 'A háromhavi követés már rögzítve van');
    return r.rows[0];
  });
}

export async function updateSchedulingRequest(id: string, actor: string, input: z.infer<typeof queueUpdateSchema>) {
  return transaction(actor, async (db) => {
    // Read before locking; lock appointments before the queue row, like encounter writes.
    const found = await db.query('SELECT patient_id, delivery_prosthesis_id FROM aftercare_requests WHERE id = $1', [id]);
    if (!found.rows.length) throw new HttpError(404, 'Visszarendelés nem található');
    await patientForWrite(db, found.rows[0].patient_id);
    const appointment = input.appointmentId ? await appointmentForWrite(db, found.rows[0].patient_id, input.appointmentId) : null;
    const deliveryProsthesis = found.rows[0].delivery_prosthesis_id
      ? await prosthesisForWrite(db, found.rows[0].patient_id, found.rows[0].delivery_prosthesis_id) : null;
    const r = await db.query('SELECT *, requested_on::text AS requested_on FROM aftercare_requests WHERE id = $1 FOR UPDATE', [id]);
    const request = r.rows[0];
    if (!request || request.version !== input.expectedVersion) throw new HttpError(409, 'Az ütemezés megváltozott. Töltse újra a sort.');
    if (appointment) {
      if (!slotSecured(appointment.appointmentStatus, appointment.id)) throw new HttpError(409, 'Lemondott vagy elmulasztott időpont nem biztosított hely');
      if (appointment.occurredOn <= request.requested_on) throw new HttpError(409, 'A visszarendelés időpontja a kérés utáni napra eshet');
      if (deliveryProsthesis?.deliveryDate) {
        if (appointment.occurredOn < observationEnd(deliveryProsthesis.deliveryDate)) throw new HttpError(409, 'A háromhavi kontroll az ablak végére vagy azután foglalható');
      }
    }
    await db.query(`UPDATE aftercare_requests SET appointment_id = $2, delay_reason = $3, version = version + 1,
      updated_by = $4, updated_at = now() WHERE id = $1`, [id, input.appointmentId, input.delayReason, actor]);
    return { id };
  });
}
