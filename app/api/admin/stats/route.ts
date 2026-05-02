import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

// Hungarian short weekday labels (Monday-first to match Postgres ISODOW 1..7).
const NAP_NEVEK = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
const HONAP_NEVEK = [
  'Jan', 'Feb', 'Már', 'Ápr', 'Máj', 'Jún',
  'Júl', 'Aug', 'Szep', 'Okt', 'Nov', 'Dec',
];

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal
}

export const GET = roleHandler(['admin'], async () => {
  const pool = getDbPool();

  // All queries run in parallel — previously they ran serially (~25 round-trips).
  const [
    patientsTotal,
    patientsThisMonth,
    patientsLastMonth,
    patientsByGender,
    patientsByEtiology,
    patientsByDoctor,
    patientsMonthlyTrend,

    usersTotal,
    usersByRole,
    usersActive,
    usersInactive,
    usersRecent,

    appointmentsTotal,
    appointmentsUpcoming,
    appointmentsPast,
    appointmentsThisMonth,
    appointmentsByStatus,
    appointmentsByOutcome,
    appointmentsLatePast,
    appointmentsByHour,
    appointmentsByWeekday,

    timeSlotsTotal,
    timeSlotsAvailable,
    timeSlotsBooked,

    activityTotal,
    activityLast7Days,
    activityLast30Days,
    activityByAction,
    activityByUser,
    activityDailyTrend,

    feedbackTotal,
    feedbackByStatus,
    feedbackByType,

    documentsTotal,
    documentsRecent,
  ] = await Promise.all([
    // ───── BETEGEK ─────
    pool.query('SELECT COUNT(*) as total FROM patients'),
    pool.query(`
      SELECT COUNT(*) as total
      FROM patients
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `),
    pool.query(`
      SELECT COUNT(*) as total
      FROM patients
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND created_at <  DATE_TRUNC('month', CURRENT_DATE)
    `),
    pool.query(`
      SELECT
        COALESCE(nem, 'Nincs adat') as nem,
        COUNT(*) as darab
      FROM patients
      GROUP BY nem
      ORDER BY darab DESC
    `),
    pool.query(`
      SELECT
        COALESCE(a.kezelesre_erkezes_indoka, 'Nincs adat') as etiologia,
        COUNT(*) as darab
      FROM patients p
      LEFT JOIN patient_anamnesis a ON a.patient_id = p.id
      GROUP BY a.kezelesre_erkezes_indoka
      ORDER BY darab DESC
    `),
    pool.query(`
      SELECT
        COALESCE(u.doktor_neve, u.email, p.kezeleoorvos, 'Nincs adat') as orvos,
        COUNT(*) as darab
      FROM patients p
      LEFT JOIN users u ON u.id = p.kezeleoorvos_user_id
      WHERE p.kezeleoorvos_user_id IS NOT NULL OR p.kezeleoorvos IS NOT NULL
      GROUP BY COALESCE(u.doktor_neve, u.email, p.kezeleoorvos)
      ORDER BY darab DESC
      LIMIT 10
    `),
    // last 12 calendar months including current
    pool.query(`
      WITH months AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months',
          DATE_TRUNC('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS month_start
      )
      SELECT
        TO_CHAR(m.month_start, 'YYYY-MM') as honap_kulcs,
        EXTRACT(MONTH FROM m.month_start)::int as honap_idx,
        EXTRACT(YEAR  FROM m.month_start)::int as ev,
        COUNT(p.id) as darab
      FROM months m
      LEFT JOIN patients p
        ON p.created_at >= m.month_start
       AND p.created_at <  m.month_start + INTERVAL '1 month'
      GROUP BY m.month_start
      ORDER BY m.month_start
    `),

    // ───── FELHASZNÁLÓK ─────
    pool.query('SELECT COUNT(*) as total FROM users'),
    pool.query(`
      SELECT
        role,
        COUNT(*) as darab,
        COUNT(*) FILTER (WHERE active = true) as aktiv
      FROM users
      GROUP BY role
      ORDER BY darab DESC
    `),
    pool.query(`SELECT COUNT(*) as total FROM users WHERE active = true`),
    pool.query(`SELECT COUNT(*) as total FROM users WHERE active = false`),
    pool.query(`
      SELECT COUNT(*) as total
      FROM users
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `),

    // ───── IDŐPONTFOGLALÁSOK ─────
    pool.query(`
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
    `),
    pool.query(`
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE ats.start_time > NOW()
    `),
    pool.query(`
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE ats.start_time <= NOW()
    `),
    pool.query(`
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE ats.start_time >= DATE_TRUNC('month', CURRENT_DATE)
    `),
    // approval_status NULL = normál (nem páciens-jóváhagyási folyam)
    pool.query(`
      SELECT
        CASE
          WHEN a.approval_status IS NULL THEN 'normal'
          ELSE a.approval_status
        END as status,
        COUNT(*) as darab
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      GROUP BY 1
      ORDER BY darab DESC
    `),
    // appointment_status (kimenetel): completed / no_show / cancelled_* / pending (NULL)
    pool.query(`
      SELECT
        COALESCE(a.appointment_status, 'pending') as kimenet,
        COUNT(*) as darab
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      GROUP BY 1
      ORDER BY darab DESC
    `),
    // late arrivals among past completed/no-show appointments
    pool.query(`
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      WHERE a.is_late = true
    `),
    // booking peak hours (0..23) by appointment count, local time = Europe/Budapest
    pool.query(`
      SELECT
        EXTRACT(HOUR FROM (ats.start_time AT TIME ZONE 'Europe/Budapest'))::int as ora,
        COUNT(*) as darab
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      GROUP BY 1
      ORDER BY 1
    `),
    // weekday distribution (ISODOW: 1=Mon..7=Sun)
    pool.query(`
      SELECT
        EXTRACT(ISODOW FROM (ats.start_time AT TIME ZONE 'Europe/Budapest'))::int as nap_idx,
        COUNT(*) as darab
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      GROUP BY 1
      ORDER BY 1
    `),

    // ───── IDŐSLOTOK ─────
    pool.query('SELECT COUNT(*) as total FROM available_time_slots'),
    pool.query(`
      SELECT COUNT(*) as total
      FROM available_time_slots
      WHERE status = 'available' AND start_time > NOW()
    `),
    pool.query(`SELECT COUNT(*) as total FROM available_time_slots WHERE status = 'booked'`),

    // ───── AKTIVITÁS ─────
    pool.query('SELECT COUNT(*) as total FROM activity_logs'),
    pool.query(`SELECT COUNT(*) as total FROM activity_logs WHERE created_at >= NOW() - INTERVAL '7 days'`),
    pool.query(`SELECT COUNT(*) as total FROM activity_logs WHERE created_at >= NOW() - INTERVAL '30 days'`),
    pool.query(`
      SELECT action, COUNT(*) as darab
      FROM activity_logs
      GROUP BY action
      ORDER BY darab DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT
        COALESCE(user_email, 'unknown') as user_email,
        COUNT(*) as darab
      FROM activity_logs
      GROUP BY user_email
      ORDER BY darab DESC
      LIMIT 10
    `),
    // last 30 days activity counts (gap-filled with 0s)
    pool.query(`
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - INTERVAL '29 days')::date,
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS d
      )
      SELECT
        TO_CHAR(d.d, 'YYYY-MM-DD') as datum,
        COUNT(al.id) as darab
      FROM days d
      LEFT JOIN activity_logs al
        ON (al.created_at AT TIME ZONE 'Europe/Budapest')::date = d.d
      GROUP BY d.d
      ORDER BY d.d
    `),

    // ───── VISSZAJELZÉSEK ─────
    pool.query('SELECT COUNT(*) as total FROM feedback'),
    pool.query(`
      SELECT status, COUNT(*) as darab
      FROM feedback
      GROUP BY status
      ORDER BY darab DESC
    `),
    pool.query(`
      SELECT type, COUNT(*) as darab
      FROM feedback
      GROUP BY type
      ORDER BY darab DESC
    `),

    // ───── DOKUMENTUMOK ─────
    pool.query('SELECT COUNT(*) as total FROM patient_documents'),
    pool.query(`
      SELECT COUNT(*) as total
      FROM patient_documents
      WHERE uploaded_at >= CURRENT_DATE - INTERVAL '30 days'
    `),
  ]);

  // ── Derived appointment metrics ──
  const outcomeCounts: Record<string, number> = Object.fromEntries(
    appointmentsByOutcome.rows.map((r) => [r.kimenet as string, parseInt(r.darab)]),
  );
  const completed = outcomeCounts.completed ?? 0;
  const noShow = outcomeCounts.no_show ?? 0;
  const cancelledByDoctor = outcomeCounts.cancelled_by_doctor ?? 0;
  const cancelledByPatient = outcomeCounts.cancelled_by_patient ?? 0;
  const pendingOutcome = outcomeCounts.pending ?? 0;
  const finishedTotal = completed + noShow; // megjelent vagy hiányzott
  const cancelledTotal = cancelledByDoctor + cancelledByPatient;
  const allTerminal = finishedTotal + cancelledTotal;

  // ── Hour distribution (0..23 gap-filled) ──
  const hourMap = new Map<number, number>(
    appointmentsByHour.rows.map((r) => [parseInt(r.ora), parseInt(r.darab)]),
  );
  const csucsOrak = Array.from({ length: 24 }, (_, h) => ({
    ora: h,
    cimke: `${String(h).padStart(2, '0')}:00`,
    darab: hourMap.get(h) ?? 0,
  }));

  // ── Weekday distribution (1..7 gap-filled, ISO Monday-first) ──
  const weekdayMap = new Map<number, number>(
    appointmentsByWeekday.rows.map((r) => [parseInt(r.nap_idx), parseInt(r.darab)]),
  );
  const napiEloszlas = NAP_NEVEK.map((nev, idx) => ({
    napIdx: idx + 1,
    napNev: nev,
    darab: weekdayMap.get(idx + 1) ?? 0,
  }));

  // ── Patient monthly trend ──
  const havitTrend = patientsMonthlyTrend.rows.map((row) => ({
    honap: row.honap_kulcs as string,
    cimke: `${HONAP_NEVEK[(parseInt(row.honap_idx) - 1) % 12]} ${String(row.ev).slice(2)}`,
    darab: parseInt(row.darab),
  }));

  // ── Activity daily trend ──
  const napiTrend = activityDailyTrend.rows.map((row) => {
    const isoDate: string = row.datum;
    const day = parseInt(isoDate.slice(8, 10));
    const monthIdx = parseInt(isoDate.slice(5, 7)) - 1;
    return {
      datum: isoDate,
      cimke: `${HONAP_NEVEK[monthIdx]} ${day}.`,
      darab: parseInt(row.darab),
    };
  });

  return NextResponse.json({
    generaltAt: new Date().toISOString(),
    betegek: {
      osszes: parseInt(patientsTotal.rows[0].total),
      ebbenAHonapban: parseInt(patientsThisMonth.rows[0].total),
      multHonapban: parseInt(patientsLastMonth.rows[0].total),
      nemSzerint: patientsByGender.rows.map((row) => ({
        nem: row.nem,
        darab: parseInt(row.darab),
      })),
      etiologiaSzerint: patientsByEtiology.rows.map((row) => ({
        etiologia: row.etiologia,
        darab: parseInt(row.darab),
      })),
      orvosSzerint: patientsByDoctor.rows.map((row) => ({
        orvos: row.orvos,
        darab: parseInt(row.darab),
      })),
      havitTrend,
    },
    felhasznalok: {
      osszes: parseInt(usersTotal.rows[0].total),
      aktiv: parseInt(usersActive.rows[0].total),
      inaktiv: parseInt(usersInactive.rows[0].total),
      utolso30Napban: parseInt(usersRecent.rows[0].total),
      szerepkorSzerint: usersByRole.rows.map((row) => ({
        szerepkor: row.role,
        osszes: parseInt(row.darab),
        aktiv: parseInt(row.aktiv),
      })),
    },
    idopontfoglalasok: {
      osszes: parseInt(appointmentsTotal.rows[0].total),
      jovobeli: parseInt(appointmentsUpcoming.rows[0].total),
      multbeli: parseInt(appointmentsPast.rows[0].total),
      ebbenAHonapban: parseInt(appointmentsThisMonth.rows[0].total),
      statusSzerint: appointmentsByStatus.rows.map((row) => ({
        status: row.status,
        darab: parseInt(row.darab),
      })),
      kimenetSzerint: [
        { kimenet: 'completed', darab: completed },
        { kimenet: 'no_show', darab: noShow },
        { kimenet: 'cancelled_by_doctor', darab: cancelledByDoctor },
        { kimenet: 'cancelled_by_patient', darab: cancelledByPatient },
        { kimenet: 'pending', darab: pendingOutcome },
      ],
      kesesekSzama: parseInt(appointmentsLatePast.rows[0].total),
      // arányok %-ban (egy tizedesig); finishedTotal / allTerminal nullánál 0
      noShowArany: pct(noShow, finishedTotal),
      lemondasiArany: pct(cancelledTotal, allTerminal),
      befejezesiArany: pct(completed, finishedTotal),
      csucsOrak,
      napiEloszlas,
    },
    idoslotok: {
      osszes: parseInt(timeSlotsTotal.rows[0].total),
      elerheto: parseInt(timeSlotsAvailable.rows[0].total),
      lefoglalt: parseInt(timeSlotsBooked.rows[0].total),
    },
    aktivitas: {
      osszes: parseInt(activityTotal.rows[0].total),
      utolso7Nap: parseInt(activityLast7Days.rows[0].total),
      utolso30Nap: parseInt(activityLast30Days.rows[0].total),
      muveletSzerint: activityByAction.rows.map((row) => ({
        muvelet: row.action,
        darab: parseInt(row.darab),
      })),
      felhasznaloSzerint: activityByUser.rows.map((row) => ({
        felhasznalo: row.user_email,
        darab: parseInt(row.darab),
      })),
      napiTrend,
    },
    visszajelzesek: {
      osszes: parseInt(feedbackTotal.rows[0].total),
      statusSzerint: feedbackByStatus.rows.map((row) => ({
        status: row.status,
        darab: parseInt(row.darab),
      })),
      tipusSzerint: feedbackByType.rows.map((row) => ({
        tipus: row.type,
        darab: parseInt(row.darab),
      })),
    },
    dokumentumok: {
      osszes: parseInt(documentsTotal.rows[0].total),
      utolso30Napban: parseInt(documentsRecent.rows[0].total),
    },
  });
});
