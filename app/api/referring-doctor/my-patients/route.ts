import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { getPatientDataCompleteness } from '@/lib/patient-data-completeness';
import { splitByResponsible, doctorActionableMissing } from '@/lib/missing-data-reminders';
import { completenessEditHref } from '@/lib/completeness-deeplinks';

export const dynamic = 'force-dynamic';

/**
 * GET /api/referring-doctor/my-patients
 *
 * A bejelentkezett beutaló orvos saját beutalt betegei a főoldali
 * „Beutalt betegeim” panelhez: aktuális stádium, következő időpont,
 * olvasatlan beteg-üzenetek száma.
 *
 * A hozzárendelés a bevált név-konvenciót követi: users.doktor_neve =
 * patient_referral.beutalo_orvos (trim + kisbetű-tolerancia). Elgépelt
 * beutaló-névnél a beteg kimarad — ismert korlát, a jövőbeni FK-s
 * megoldásig.
 */
export const GET = roleHandler(['beutalo_orvos'], async (_req, { auth }) => {
  const pool = getDbPool();

  const userRes = await pool.query(`SELECT doktor_neve FROM users WHERE id = $1`, [auth.userId]);
  const doktorNeve: string | null = userRes.rows[0]?.doktor_neve ?? null;
  if (!doktorNeve || doktorNeve.trim() === '') {
    return NextResponse.json({ patients: [], missingDoctorName: true });
  }

  const patientsRes = await pool.query(
    `SELECT p.id, p.nev
     FROM patients p
     JOIN patient_referral pr ON pr.patient_id = p.id
     WHERE lower(btrim(pr.beutalo_orvos)) = lower(btrim($1))
     ORDER BY p.nev NULLS LAST`,
    [doktorNeve]
  );
  const ids: string[] = patientsRes.rows.map((r: any) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ patients: [], missingDoctorName: false });
  }

  const [stagesRes, apptRes, unreadRes] = await Promise.all([
    // Legutóbbi stádium-esemény betegenként (magyar címkével).
    pool.query(
      `SELECT DISTINCT ON (se.patient_id)
         se.patient_id, se.stage_code AS "stageCode", sc.label_hu AS "stageLabel"
       FROM stage_events se
       JOIN patient_episodes e ON e.id = se.episode_id
       JOIN stage_catalog sc ON sc.code = se.stage_code AND sc.reason = e.reason
       WHERE se.patient_id = ANY($1::uuid[])
       ORDER BY se.patient_id, se.at DESC`,
      [ids]
    ),
    // Legkorábbi jövőbeli, nem lemondott időpont betegenként.
    pool.query(
      `SELECT DISTINCT ON (a.patient_id)
         a.patient_id, ats.start_time AS "startTime", u.doktor_neve AS "dentistName"
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       LEFT JOIN users u ON a.dentist_email = u.email
       WHERE a.patient_id = ANY($1::uuid[])
         AND ats.start_time >= NOW()
         AND (a.appointment_status IS NULL
              OR a.appointment_status NOT IN ('cancelled_by_patient', 'cancelled_by_doctor'))
       ORDER BY a.patient_id, ats.start_time ASC`,
      [ids]
    ),
    // Munkatársak által még nem olvasott beteg-üzenetek betegenként.
    pool.query(
      `SELECT patient_id, COUNT(*)::int AS unread
       FROM messages
       WHERE sender_type = 'patient' AND read_at IS NULL AND patient_id = ANY($1::uuid[])
       GROUP BY patient_id`,
      [ids]
    ),
  ]);

  const stageByPatient = new Map(stagesRes.rows.map((r: any) => [r.patient_id, r]));
  const apptByPatient = new Map(apptRes.rows.map((r: any) => [r.patient_id, r]));
  const unreadByPatient = new Map(unreadRes.rows.map((r: any) => [r.patient_id, r.unread]));

  // A beutaló által pótolható hiányok (beutaló indoklás, műtét, szövettan,
  // BNO, TNM) — chipekként jelennek meg a panelen, karton-deeplinkkel.
  const report = await getPatientDataCompleteness();
  const completenessById = new Map(report.patients.map((r) => [r.patientId, r]));

  const patients = patientsRes.rows.map((p: any) => {
    const compRow = completenessById.get(p.id);
    const referrerMissing = compRow
      ? splitByResponsible(doctorActionableMissing(compRow)).referrerItems.map((i) => ({
          key: i.key,
          label: i.label,
          href: completenessEditHref(p.id, i.key),
        }))
      : [];
    return {
      id: p.id,
      nev: p.nev,
      stageCode: stageByPatient.get(p.id)?.stageCode ?? null,
      stageLabel: stageByPatient.get(p.id)?.stageLabel ?? null,
      nextAppointmentAt: apptByPatient.get(p.id)?.startTime ?? null,
      nextAppointmentDentist: apptByPatient.get(p.id)?.dentistName ?? null,
      unreadMessages: unreadByPatient.get(p.id) ?? 0,
      referrerMissing,
    };
  });

  return NextResponse.json({ patients, missingDoctorName: false });
});
