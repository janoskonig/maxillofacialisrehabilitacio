/**
 * GET /api/admin/stats/unsuccessful-attempts
 *
 * Migration 029 + PR 3 / C + PR 4: admin statisztika a sikertelen próbákról.
 *
 * Query params:
 *   - `days` — visszamenőleg hány napra (default: 30, max: 365). Ha 0,
 *     az összes idejű adatot adja.
 *   - `doctor` — opcionális szűrő egy adott `attempt_failed_by` értékre
 *     (email-cím vagy "(ismeretlen)"). Az orvos-bontás (`byDoctor`) és a
 *     `availableDoctors` mindig az ÖSSZES adat alapján számol — különben
 *     nem lehetne dropdown-ot megjeleníteni.
 *
 * Visszaadja:
 *   - `summary` — időszak total + összes idejű total (a `doctor` szűrőt is figyelembe veszi)
 *   - `byDoctor` — top 10 orvos a `attempt_failed_by` mező szerint (NEM szűrt)
 *   - `availableDoctors` — az összes orvos, akinek volt sikertelen jelölése (UI dropdown)
 *   - `byWorkPhase` — top 10 munkafázis (work_phase_code + label) gyakoriság szerint
 *   - `topReasons` — top 10 leggyakoribb indok-szöveg (case-insensitive trim)
 *   - `reasonsByTemplate` — kanonikus sablonok szerinti bontás (5 + "Egyéb")
 *   - `weeklyTrend` — heti sikertelen-próba szám (max 26 hét)
 *   - `recent` — 10 legfrissebb sikertelen próba (audit context)
 *
 * Csak admin-szerepkörnek; ha pre-029 DB (oszlopok hiányoznak), 503-at ad.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { probeAttemptColumns } from '@/lib/appointment-attempts';
import {
  UNSUCCESSFUL_REASON_TEMPLATES,
  matchReasonTemplate,
} from '@/lib/unsuccessful-attempt-templates';

export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

interface DoctorBucket {
  doctor: string;
  count: number;
}

interface WorkPhaseBucket {
  workPhaseCode: string;
  label: string | null;
  count: number;
}

interface ReasonBucket {
  reason: string;
  count: number;
}

interface ReasonTemplateBucket {
  template: string;
  /** True if this is a canonical template; false for the "Egyéb" bucket. */
  canonical: boolean;
  count: number;
  /** A "Egyéb" kötegnél az ide tartozó top egyedi szövegek + counts (max 10). */
  examples?: Array<{ text: string; count: number }>;
}

interface WeeklyBucket {
  weekStart: string;
  count: number;
}

interface RecentSample {
  appointmentId: string;
  patientId: string | null;
  patientName: string | null;
  workPhaseLabel: string | null;
  workPhaseCode: string | null;
  attemptNumber: number;
  appointmentStart: string | null;
  failedAt: string | null;
  failedBy: string | null;
  reason: string | null;
}

export const GET = roleHandler(['admin'], async (req: NextRequest) => {
  const pool = getDbPool();
  const hasAttemptColumns = await probeAttemptColumns(pool);
  if (!hasAttemptColumns) {
    return NextResponse.json(
      {
        error:
          'A 029-es migráció még nem futott le ezen az adatbázison. A sikertelen próba statisztika nem elérhető, amíg a `appointments.attempt_failed_*` oszlopok nincsenek létrehozva.',
        code: 'MIGRATION_029_REQUIRED',
      },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = searchParams.get('days');
  const days = (() => {
    const parsed = daysRaw == null ? DEFAULT_DAYS : Number(daysRaw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAYS;
    return Math.min(parsed, MAX_DAYS);
  })();
  const doctorFilterRaw = searchParams.get('doctor');
  const doctorFilter = doctorFilterRaw && doctorFilterRaw.trim() ? doctorFilterRaw.trim() : null;

  // Paramétereket egy közös sorrendben építjük fel:
  //   $1 (ha days>0): days string
  //   $2 vagy $1 (ha doctor szűrt): doctor érték
  // A `baseFrom` a periodos + doctorFilteres szűrőt is alkalmazza.
  const periodParams: unknown[] = [];
  let periodWhere = '';
  if (days > 0) {
    periodParams.push(String(days));
    periodWhere = `AND a.attempt_failed_at >= CURRENT_TIMESTAMP - ($${periodParams.length} || ' days')::interval`;
  }
  let doctorWhere = '';
  if (doctorFilter) {
    periodParams.push(doctorFilter);
    doctorWhere = doctorFilter === '(ismeretlen)'
      ? `AND COALESCE(NULLIF(TRIM(a.attempt_failed_by), ''), '(ismeretlen)') = $${periodParams.length}`
      : `AND a.attempt_failed_by = $${periodParams.length}`;
  }

  const baseFrom = `
    FROM appointments a
    LEFT JOIN patients p ON p.id = a.patient_id
    LEFT JOIN episode_work_phases ewp
      ON (a.work_phase_id IS NOT NULL AND ewp.id = a.work_phase_id)
      OR (a.work_phase_id IS NULL AND ewp.episode_id = a.episode_id AND ewp.work_phase_code = a.step_code)
    LEFT JOIN work_phase_catalog wpc ON wpc.work_phase_code = COALESCE(ewp.work_phase_code, a.step_code)
    WHERE a.appointment_status = 'unsuccessful'
      ${periodWhere}
      ${doctorWhere}
  `;

  // A `byDoctor` és `availableDoctors` lekérések a doctorWhere NÉLKÜL futnak —
  // mindig a teljes orvos-listát mutatják (különben a dropdown elveszne).
  const baseFromNoDoctor = `
    FROM appointments a
    WHERE a.appointment_status = 'unsuccessful'
      ${periodWhere}
  `;
  const periodParamsNoDoctor = days > 0 ? [String(days)] : [];

  const [
    summaryPeriod,
    summaryAll,
    byDoctorRows,
    availableDoctorRows,
    byWorkPhaseRows,
    topReasonsRows,
    allReasonRows,
    weeklyRows,
    recentRows,
  ] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count ${baseFrom}`,
      periodParams
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM appointments
        WHERE appointment_status = 'unsuccessful'`
    ),
    pool.query<{ doctor: string; count: number }>(
      `SELECT COALESCE(NULLIF(TRIM(a.attempt_failed_by), ''), '(ismeretlen)') AS doctor,
              COUNT(*)::int AS count
         ${baseFromNoDoctor}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10`,
      periodParamsNoDoctor
    ),
    pool.query<{ doctor: string }>(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(a.attempt_failed_by), ''), '(ismeretlen)') AS doctor
         FROM appointments a
        WHERE a.appointment_status = 'unsuccessful'
        ORDER BY 1 ASC`
    ),
    pool.query<{ work_phase_code: string | null; label: string | null; count: number }>(
      `SELECT COALESCE(ewp.work_phase_code, a.step_code, '(ismeretlen)') AS work_phase_code,
              wpc.label AS label,
              COUNT(*)::int AS count
         ${baseFrom}
        GROUP BY 1, 2
        ORDER BY count DESC
        LIMIT 10`,
      periodParams
    ),
    pool.query<{ reason: string; count: number }>(
      `SELECT COALESCE(NULLIF(TRIM(a.attempt_failed_reason), ''), '(üres)') AS reason,
              COUNT(*)::int AS count
         ${baseFrom}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10`,
      periodParams
    ),
    // Az összes egyedi indok-szöveg + count — a kanonikus-template csoportosításhoz
    // alkalmazzuk a `matchReasonTemplate`-t TS oldalon.
    pool.query<{ reason: string; count: number }>(
      `SELECT COALESCE(NULLIF(TRIM(a.attempt_failed_reason), ''), '') AS reason,
              COUNT(*)::int AS count
         ${baseFrom}
        GROUP BY 1`,
      periodParams
    ),
    pool.query<{ week_start: Date; count: number }>(
      `SELECT DATE_TRUNC('week', a.attempt_failed_at)::date AS week_start,
              COUNT(*)::int AS count
         ${baseFrom}
          AND a.attempt_failed_at >= CURRENT_TIMESTAMP - INTERVAL '26 weeks'
        GROUP BY week_start
        ORDER BY week_start ASC`,
      periodParams
    ),
    pool.query<{
      id: string;
      patient_id: string | null;
      patient_name: string | null;
      work_phase_label: string | null;
      work_phase_code: string | null;
      attempt_number: number;
      start_time: Date | string | null;
      attempt_failed_at: Date | string | null;
      attempt_failed_by: string | null;
      attempt_failed_reason: string | null;
    }>(
      `SELECT a.id,
              a.patient_id,
              p.nev AS patient_name,
              wpc.label AS work_phase_label,
              COALESCE(ewp.work_phase_code, a.step_code) AS work_phase_code,
              a.attempt_number,
              a.start_time,
              a.attempt_failed_at,
              a.attempt_failed_by,
              a.attempt_failed_reason
         ${baseFrom}
        ORDER BY a.attempt_failed_at DESC NULLS LAST
        LIMIT 10`,
      periodParams
    ),
  ]);

  const byDoctor: DoctorBucket[] = byDoctorRows.rows.map((r) => ({
    doctor: r.doctor,
    count: Number(r.count),
  }));
  const availableDoctors: string[] = availableDoctorRows.rows
    .map((r) => r.doctor)
    .filter((d): d is string => typeof d === 'string' && d.length > 0);
  const byWorkPhase: WorkPhaseBucket[] = byWorkPhaseRows.rows.map((r) => ({
    workPhaseCode: r.work_phase_code ?? '(ismeretlen)',
    label: r.label,
    count: Number(r.count),
  }));
  const topReasons: ReasonBucket[] = topReasonsRows.rows.map((r) => ({
    reason: r.reason,
    count: Number(r.count),
  }));

  // PR 4 / Stats #3: kanonikus sablonokra csoportosítás. Minden chip-template-re
  // előre létrehozzuk a köteget (akkor is, ha 0), hogy a UI stabil oszlopokat
  // tudjon mutatni; végül egy "Egyéb" köteg gyűjti az összes maradékot, és top
  // 10 egyedi szöveggel illusztráljuk.
  const templateCounts = new Map<string, number>();
  for (const t of UNSUCCESSFUL_REASON_TEMPLATES) templateCounts.set(t, 0);
  const otherFreeforms = new Map<string, number>();
  for (const r of allReasonRows.rows) {
    const reasonText = r.reason ?? '';
    const count = Number(r.count) || 0;
    if (count === 0) continue;
    const matched = matchReasonTemplate(reasonText);
    if (matched) {
      templateCounts.set(matched, (templateCounts.get(matched) ?? 0) + count);
    } else {
      const key = reasonText.trim() || '(üres)';
      otherFreeforms.set(key, (otherFreeforms.get(key) ?? 0) + count);
    }
  }
  const reasonsByTemplate: ReasonTemplateBucket[] = [
    ...UNSUCCESSFUL_REASON_TEMPLATES.map<ReasonTemplateBucket>((template) => ({
      template,
      canonical: true,
      count: templateCounts.get(template) ?? 0,
    })),
  ];
  const otherTotal = Array.from(otherFreeforms.values()).reduce((s, n) => s + n, 0);
  if (otherTotal > 0) {
    const examples = Array.from(otherFreeforms.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([text, count]) => ({ text, count }));
    reasonsByTemplate.push({
      template: 'Egyéb (szabad szöveg)',
      canonical: false,
      count: otherTotal,
      examples,
    });
  }

  const weeklyTrend: WeeklyBucket[] = weeklyRows.rows.map((r) => ({
    weekStart: r.week_start instanceof Date
      ? r.week_start.toISOString().slice(0, 10)
      : String(r.week_start),
    count: Number(r.count),
  }));
  const recent: RecentSample[] = recentRows.rows.map((r) => ({
    appointmentId: r.id,
    patientId: r.patient_id,
    patientName: r.patient_name,
    workPhaseLabel: r.work_phase_label,
    workPhaseCode: r.work_phase_code,
    attemptNumber: Number(r.attempt_number ?? 1),
    appointmentStart: r.start_time
      ? r.start_time instanceof Date
        ? r.start_time.toISOString()
        : new Date(r.start_time).toISOString()
      : null,
    failedAt: r.attempt_failed_at
      ? r.attempt_failed_at instanceof Date
        ? r.attempt_failed_at.toISOString()
        : new Date(r.attempt_failed_at).toISOString()
      : null,
    failedBy: r.attempt_failed_by,
    reason: r.attempt_failed_reason,
  }));

  return NextResponse.json({
    days,
    doctorFilter,
    summary: {
      period: Number(summaryPeriod.rows[0]?.count ?? 0),
      allTime: Number(summaryAll.rows[0]?.count ?? 0),
    },
    byDoctor,
    availableDoctors,
    byWorkPhase,
    topReasons,
    reasonsByTemplate,
    weeklyTrend,
    recent,
  });
});
