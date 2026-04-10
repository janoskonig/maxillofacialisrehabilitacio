import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import type { MedicalStats } from '@/lib/types';
import { getBnoKodToNevMap } from '@/lib/bno-codes-data';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin'], async (req, { auth }) => {
  const pool = getDbPool();

  const bnoMap = getBnoKodToNevMap();

  const [
    bnoResult,
    referringDoctorsResult,
    dmftStatsResult,
    dmftDistributionResult,
    toothPositionsResult,
    implantPositionsResult,
    waitingTimeResult,
    doctorWorkloadResult,
    ohip14ByTimepointResult,
    ohip14TotalsResult,
    treatmentPlanSummaryResult,
    treatmentPlanByCodeResult,
    treatmentPlanArcotResult,
    treatmentTypesResult,
  ] = await Promise.all([
    // 1. BNO statisztikák (from patient_anamnesis)
    pool.query(`
      SELECT 
        TRIM(unnest(string_to_array(bno, ','))) as bno_kod,
        COUNT(*) as elofordulas
      FROM patient_anamnesis
      WHERE bno IS NOT NULL AND bno != ''
      GROUP BY bno_kod
      ORDER BY elofordulas DESC
    `),

    // 2. Beutaló orvosok eloszlása (from patient_referral)
    pool.query(`
      SELECT 
        beutalo_orvos as orvos,
        COUNT(*) as darab
      FROM patient_referral
      WHERE beutalo_orvos IS NOT NULL AND beutalo_orvos != ''
      GROUP BY beutalo_orvos
      ORDER BY darab DESC
    `),

    // 3. DMF stats (from patient_dental_status)
    pool.query(`
      WITH dmft_calculations AS (
        SELECT 
          patient_id,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patient_dental_status
        WHERE meglevo_fogak IS NOT NULL AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        COUNT(*) as total_patients,
        ROUND(AVG(dmft_total)::numeric, 2) as atlag,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dmft_total))::numeric, 2) as median,
        ROUND(STDDEV(dmft_total)::numeric, 2) as szoras,
        MIN(dmft_total) as min_val,
        MAX(dmft_total) as max_val
      FROM dmft_calculations
      WHERE dmft_total >= 0
    `),

    // 4. DMFT distribution (from patient_dental_status)
    pool.query(`
      WITH dmft_calculations AS (
        SELECT 
          patient_id,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patient_dental_status
        WHERE meglevo_fogak IS NOT NULL AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        dmft_total as dmft,
        COUNT(*) as beteg_szama
      FROM dmft_calculations
      WHERE dmft_total >= 0
      GROUP BY dmft_total
      ORDER BY dmft_total
    `),

    // 5. Fogak pozíciói (from patient_dental_status)
    pool.query(`
      WITH tooth_positions AS (
        SELECT 
          key::int as fog_szam,
          value->>'status' as status
        FROM patient_dental_status,
        LATERAL jsonb_each(meglevo_fogak)
        WHERE meglevo_fogak IS NOT NULL AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        fog_szam as "fogSzam",
        COUNT(*) FILTER (WHERE status = 'D') as "dSzama",
        COUNT(*) FILTER (WHERE status = 'F') as "fSzama",
        COUNT(*) FILTER (WHERE status = 'M') as "mSzama",
        COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'D' AND status IS DISTINCT FROM 'F' AND status IS DISTINCT FROM 'M') as "egeszsSeges",
        COUNT(*) as osszes
      FROM tooth_positions
      WHERE fog_szam BETWEEN 11 AND 48
      GROUP BY fog_szam
      ORDER BY fog_szam
    `),

    // 6. Implantátumok pozíciói (from patient_dental_status)
    pool.query(`
      WITH implant_positions AS (
        SELECT key::int as fog_szam
        FROM patient_dental_status,
        LATERAL jsonb_each(meglevo_implantatumok)
        WHERE meglevo_implantatumok IS NOT NULL AND meglevo_implantatumok != '{}'::jsonb
        
        UNION ALL
        
        SELECT fog_szama::int as fog_szam
        FROM implants
        WHERE fog_szama ~ '^[0-9]+$'
      )
      SELECT 
        fog_szam as "fogSzam",
        COUNT(*) as "implantatumSzama"
      FROM implant_positions
      WHERE fog_szam BETWEEN 11 AND 48
      GROUP BY fog_szam
      ORDER BY fog_szam
    `).catch(() =>
      pool.query(`
        SELECT 
          key::int as "fogSzam",
          COUNT(*) as "implantatumSzama"
        FROM patient_dental_status,
        LATERAL jsonb_each(meglevo_implantatumok)
        WHERE meglevo_implantatumok IS NOT NULL AND meglevo_implantatumok != '{}'::jsonb
          AND key::int BETWEEN 11 AND 48
        GROUP BY key::int
        ORDER BY key::int
      `)
    ),

    // 7. Átlagos első időpontra való várakozási idő
    pool.query(`
      WITH first_appointments AS (
        SELECT DISTINCT ON (p.id)
          p.id as patient_id,
          ats.start_time as elso_idopont,
          a.created_at as idopont_letrehozas,
          EXTRACT(EPOCH FROM (ats.start_time - a.created_at)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE ats.start_time > a.created_at
          AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
          AND a.appointment_status IS NULL
        ORDER BY p.id, ats.start_time ASC, a.created_at ASC
      )
      SELECT 
        ROUND(AVG(varakozasi_ido_napokban)::numeric, 1) as atlag_varakozasi_ido_napokban,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY varakozasi_ido_napokban))::numeric, 1) as median_varakozasi_ido_napokban,
        ROUND(STDDEV_POP(varakozasi_ido_napokban)::numeric, 1) as szoras_varakozasi_ido_napokban,
        ROUND(MIN(varakozasi_ido_napokban)::numeric, 1) as min_varakozasi_ido_napokban,
        ROUND(MAX(varakozasi_ido_napokban)::numeric, 1) as max_varakozasi_ido_napokban,
        COUNT(*) as beteg_szama_idoponttal
      FROM first_appointments
    `),

    // 8. Orvosok leterheltsége
    pool.query(`
      SELECT 
        COALESCE(u.doktor_neve, u.email) as orvos_nev,
        u.email as orvos_email,
        COUNT(DISTINCT ats.id) FILTER (WHERE ats.start_time > NOW() AND ats.status = 'booked') as jovobeli_idopontok_szama,
        COUNT(DISTINCT ats.id) FILTER (WHERE ats.start_time > NOW() AND ats.status = 'available') as elerheto_idopontok_szama,
        COUNT(DISTINCT ats.id) FILTER (WHERE ats.start_time <= NOW() AND ats.status = 'booked') as multbeli_idopontok_szama
      FROM users u
      LEFT JOIN available_time_slots ats ON u.id = ats.user_id
      WHERE u.role IN ('fogpótlástanász', 'admin') AND u.active = true
      GROUP BY u.id, u.doktor_neve, u.email
      HAVING COUNT(DISTINCT ats.id) > 0
      ORDER BY jovobeli_idopontok_szama DESC
    `),

    pool.query(`
      SELECT
        o.timepoint,
        COUNT(*)::int AS kitoltesek_szama,
        COUNT(DISTINCT o.patient_id)::int AS betegek_szama,
        ROUND(AVG(o.total_score)::numeric, 2) AS atlag_total,
        (
          SELECT ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.total_score))::numeric, 2)
          FROM ohip14_responses i
          WHERE i.timepoint = o.timepoint AND i.total_score IS NOT NULL
        ) AS median_total
      FROM ohip14_responses o
      GROUP BY o.timepoint
      ORDER BY o.timepoint
    `),

    pool.query(`
      SELECT
        COUNT(*)::int AS osszes_kitoltes,
        COUNT(DISTINCT patient_id)::int AS betegek
      FROM ohip14_responses
    `),

    pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE jsonb_array_length(COALESCE(kezelesi_terv_felso, '[]'::jsonb)) > 0
             OR jsonb_array_length(COALESCE(kezelesi_terv_also, '[]'::jsonb)) > 0
             OR jsonb_array_length(COALESCE(kezelesi_terv_arcot_erinto, '[]'::jsonb)) > 0
        )::int AS betegek_tervvel,
        COALESCE(SUM(jsonb_array_length(COALESCE(kezelesi_terv_felso, '[]'::jsonb))), 0)::bigint AS felso_sorok,
        COALESCE(SUM(jsonb_array_length(COALESCE(kezelesi_terv_also, '[]'::jsonb))), 0)::bigint AS also_sorok,
        COALESCE(SUM(jsonb_array_length(COALESCE(kezelesi_terv_arcot_erinto, '[]'::jsonb))), 0)::bigint AS arcot_sorok,
        COALESCE(SUM((
          SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(p.kezelesi_terv_felso, '[]'::jsonb)) e
          WHERE COALESCE((e->>'elkeszult')::boolean, false)
        )), 0)::bigint AS felso_kesz,
        COALESCE(SUM((
          SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(p.kezelesi_terv_also, '[]'::jsonb)) e
          WHERE COALESCE((e->>'elkeszult')::boolean, false)
        )), 0)::bigint AS also_kesz,
        COALESCE(SUM((
          SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(p.kezelesi_terv_arcot_erinto, '[]'::jsonb)) e
          WHERE COALESCE((e->>'elkeszult')::boolean, false)
        )), 0)::bigint AS arcot_kesz
      FROM patient_treatment_plans p
    `),

    pool.query(`
      WITH items AS (
        SELECT COALESCE(
          NULLIF(TRIM(elem->>'treatmentTypeCode'), ''),
          NULLIF(TRIM(elem->>'tipus'), ''),
          'ismeretlen'
        ) AS kod
        FROM patient_treatment_plans p,
        LATERAL jsonb_array_elements(COALESCE(p.kezelesi_terv_felso, '[]'::jsonb)) AS elem
        UNION ALL
        SELECT COALESCE(
          NULLIF(TRIM(elem->>'treatmentTypeCode'), ''),
          NULLIF(TRIM(elem->>'tipus'), ''),
          'ismeretlen'
        )
        FROM patient_treatment_plans p,
        LATERAL jsonb_array_elements(COALESCE(p.kezelesi_terv_also, '[]'::jsonb)) AS elem
      )
      SELECT kod, COUNT(*)::int AS darab
      FROM items
      GROUP BY kod
      ORDER BY darab DESC
    `),

    pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(elem->>'tipus'), ''), 'nincs_tipus') AS tipus,
        COUNT(*)::int AS darab
      FROM patient_treatment_plans p,
      LATERAL jsonb_array_elements(COALESCE(p.kezelesi_terv_arcot_erinto, '[]'::jsonb)) AS elem
      GROUP BY 1
      ORDER BY darab DESC
    `),

    pool.query(`SELECT code, label_hu FROM treatment_types ORDER BY code`),
  ]);

  const dmftStats = dmftStatsResult.rows[0] || {};
  const dmftDistribution = dmftDistributionResult.rows || [];
  const waitingTime = waitingTimeResult.rows[0] || {};

  const ohipTotals = ohip14TotalsResult.rows[0] || {};
  const ohipByTp = new Map(
    ohip14ByTimepointResult.rows.map((r: Record<string, unknown>) => [
      String(r.timepoint),
      {
        kitoltesekSzama: parseInt(String(r.kitoltesek_szama), 10) || 0,
        betegekSzama: parseInt(String(r.betegek_szama), 10) || 0,
        atlagTotal:
          r.atlag_total != null ? parseFloat(String(r.atlag_total)) : null,
        medianTotal:
          r.median_total != null ? parseFloat(String(r.median_total)) : null,
      },
    ])
  );
  const tpOrder = ['T0', 'T1', 'T2', 'T3'];
  const ohip14Idopontok = tpOrder.map((tp) => {
    const row = ohipByTp.get(tp);
    return {
      timepoint: tp,
      kitoltesekSzama: row?.kitoltesekSzama ?? 0,
      betegekSzama: row?.betegekSzama ?? 0,
      atlagTotalScore: row?.atlagTotal ?? null,
      medianTotalScore: row?.medianTotal ?? null,
    };
  });

  const tps = treatmentPlanSummaryResult.rows[0] || {};
  const num = (v: unknown) => {
    if (v == null) return 0;
    const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const labelByCode = new Map<string, string>(
    treatmentTypesResult.rows.map((r: { code: string; label_hu: string }) => [
      r.code,
      r.label_hu,
    ])
  );
  const fogpotlasTipusSzerint = treatmentPlanByCodeResult.rows.map(
    (r: { kod: string; darab: string | number }) => {
      const kod = String(r.kod);
      return {
        kod,
        labelHu: labelByCode.get(kod) ?? null,
        darab: parseInt(String(r.darab), 10) || 0,
      };
    }
  );

  const response: MedicalStats = {
    bno: {
      data: bnoResult.rows.map((row) => {
        const kod = String(row.bno_kod).trim();
        const lookupKey = kod.replace(/\s+/g, '').toUpperCase();
        const nev =
          bnoMap.get(lookupKey) || bnoMap.get(kod.toUpperCase()) || null;
        return {
          kod,
          nev,
          elofordulas: parseInt(row.elofordulas, 10),
        };
      }),
    },
    referringDoctors: {
      data: referringDoctorsResult.rows.map(row => ({
        orvos: row.orvos,
        darab: parseInt(row.darab)
      }))
    },
    dmfDistribution: {
      data: dmftDistribution.map((row: any) => ({
        dmft: parseInt(row.dmft),
        betegSzama: parseInt(row.beteg_szama)
      })),
      stats: {
        atlag: parseFloat(dmftStats.atlag) || 0,
        median: parseFloat(dmftStats.median) || 0,
        szoras: parseFloat(dmftStats.szoras) || 0,
        min: parseInt(dmftStats.min_val) || 0,
        max: parseInt(dmftStats.max_val) || 0
      }
    },
    toothPositions: {
      data: toothPositionsResult.rows.map(row => ({
        fogSzam: parseInt(row.fogSzam),
        dSzama: parseInt(row.dSzama),
        fSzama: parseInt(row.fSzama),
        mSzama: parseInt(row.mSzama),
        egeszsSeges: parseInt(row.egeszsSeges),
        osszes: parseInt(row.osszes)
      }))
    },
    implantPositions: {
      data: implantPositionsResult.rows.map(row => ({
        fogSzam: parseInt(row.fogSzam),
        implantatumSzama: parseInt(row.implantatumSzama)
      }))
    },
    waitingTime: {
      atlagNapokban: parseFloat(waitingTime.atlag_varakozasi_ido_napokban) || 0,
      medianNapokban: parseFloat(waitingTime.median_varakozasi_ido_napokban) || 0,
      szorasNapokban: parseFloat(waitingTime.szoras_varakozasi_ido_napokban) || 0,
      minNapokban: parseFloat(waitingTime.min_varakozasi_ido_napokban) || 0,
      maxNapokban: parseFloat(waitingTime.max_varakozasi_ido_napokban) || 0,
      betegSzamaIdoponttal: parseInt(waitingTime.beteg_szama_idoponttal) || 0
    },
    doctorWorkload: {
      data: doctorWorkloadResult.rows.map(row => ({
        orvosNev: row.orvos_nev,
        orvosEmail: row.orvos_email,
        jovobeliIdopontokSzama: parseInt(row.jovobeli_idopontok_szama) || 0,
        elerhetoIdopontokSzama: parseInt(row.elerheto_idopontok_szama) || 0,
        multbeliIdopontokSzama: parseInt(row.multbeli_idopontok_szama) || 0
      }))
    },
    ohip14: {
      betegekLegalabbEgyKitoltessel: parseInt(String(ohipTotals.betegek), 10) || 0,
      osszesKitoltes: parseInt(String(ohipTotals.osszes_kitoltes), 10) || 0,
      idopontokSzerint: ohip14Idopontok,
    },
    treatmentPlans: {
      betegekKiosztottTervvel: num(tps.betegek_tervvel),
      osszesTervSorAFelson: num(tps.felso_sorok),
      osszesTervSorAlso: num(tps.also_sorok),
      osszesTervSorArcotErinto: num(tps.arcot_sorok),
      elkeszultFelson: num(tps.felso_kesz),
      elkeszultAlso: num(tps.also_kesz),
      elkeszultArcotErinto: num(tps.arcot_kesz),
      fogpotlasTipusSzerint,
      arcotErintoTipusSzerint: treatmentPlanArcotResult.rows.map(
        (r: { tipus: string; darab: string | number }) => ({
          tipus: String(r.tipus),
          darab: parseInt(String(r.darab), 10) || 0,
        })
      ),
    },
  };

  return NextResponse.json(response);
});
