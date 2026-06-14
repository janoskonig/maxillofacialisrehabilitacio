import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';
import { validateUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Orvosonkénti munkalista: „adott kezelőorvos delegált betegei".
 *
 * A számonkérés alapja — a betegnek KÉZI (ragadós) kezelőorvosa van
 * (patients.kezeleoorvos_user_id, lásd lib/kezeleoorvos-assignment.ts), és
 * itt orvosonként látszik, hol tart, és hol „akadt el" (nyitott epizód, de
 * nincs jövőbeli időpont).
 *
 * Jogosultság:
 *   - fogpótlástanász: CSAK a saját delegált betegei (a ?doctorId-t figyelmen
 *     kívül hagyjuk).
 *   - admin: opcionális ?doctorId szűrő; e nélkül az összes delegált beteg, a
 *     kezelőorvos nevével együtt (kliens oldali csoportosításhoz).
 */
export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const role = auth.role;

  let doctorId: string | null = null;
  if (role === 'fogpótlástanász') {
    doctorId = auth.userId; // mindig a saját
  } else if (role === 'admin') {
    const q = req.nextUrl.searchParams.get('doctorId');
    doctorId = q ? validateUUID(q, 'Orvos ID') : null;
  } else {
    // egyéb szerepkör nem lát delegált-munkalistát
    return NextResponse.json({ patients: [], scope: 'none' as const });
  }

  const params: unknown[] = [];
  let whereDoctor = 'p.kezeleoorvos_user_id IS NOT NULL';
  if (doctorId) {
    params.push(doctorId);
    whereDoctor = `p.kezeleoorvos_user_id = $1`;
  }

  const res = await pool.query(
    `SELECT
        p.id,
        p.nev,
        p.kezeleoorvos_user_id              AS "doctorId",
        COALESCE(ku.doktor_neve, ku.email)  AS "doctorName",
        p.kezeleoorvos_intezete             AS "intezmeny",
        p.kezeleoorvos_assigned_at          AS "assignedAt",
        COALESCE(ab.doktor_neve, ab.email)  AS "assignedByName",
        (SELECT COUNT(*)::int FROM patient_episodes pe
           WHERE pe.patient_id = p.id AND pe.status = 'open')   AS "openEpisodes",
        (SELECT MIN(a.start_time) FROM appointments a
           WHERE a.patient_id = p.id
             AND a.start_time >= now()
             AND (a.appointment_status IS NULL
                  OR a.appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient'))
             AND (a.approval_status IS NULL OR a.approval_status <> 'rejected')) AS "nextAppt",
        (SELECT MAX(a.start_time) FROM appointments a
           WHERE a.patient_id = p.id
             AND a.start_time < now()
             AND (a.appointment_status IS NULL
                  OR a.appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient'))) AS "lastAppt"
       FROM patients p
       JOIN users ku ON ku.id = p.kezeleoorvos_user_id
       LEFT JOIN users ab ON ab.id = p.kezeleoorvos_assigned_by
      WHERE ${whereDoctor}
      ORDER BY "doctorName", p.nev`,
    params
  );

  const patients = res.rows.map((r: any) => ({
    id: r.id,
    nev: r.nev,
    doctorId: r.doctorId,
    doctorName: r.doctorName ?? null,
    intezmeny: r.intezmeny ?? null,
    assignedAt: r.assignedAt ?? null,
    assignedByName: r.assignedByName ?? null,
    openEpisodes: r.openEpisodes ?? 0,
    nextAppt: r.nextAppt ?? null,
    lastAppt: r.lastAppt ?? null,
    // „Elakadt": nyitott epizód van, de nincs jövőbeli időpont → kell vele tenni.
    stalled: (r.openEpisodes ?? 0) > 0 && r.nextAppt == null,
  }));

  return NextResponse.json({
    patients,
    scope: doctorId ? (role === 'admin' ? 'doctor' : 'self') : 'all',
  });
});
