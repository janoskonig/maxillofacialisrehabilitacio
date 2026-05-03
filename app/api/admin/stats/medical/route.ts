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
    ohip14DeltaSummaryResult,
    ohip14DeltaHistogramResult,
    treatmentPlanCompletionResult,
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

    // OHIP-14 javulás T0 → T3 (klinikai kimenet KPI).
    // (patient_id, episode_id) páron belül párosítjuk a T0 és T3 score-t.
    // Csak ahol mindkettő total_score nem NULL.
    pool.query(`
      WITH delta AS (
        SELECT
          t0.patient_id,
          t0.episode_id,
          t3.total_score - t0.total_score AS delta
        FROM ohip14_responses t0
        JOIN ohip14_responses t3
          ON t0.patient_id = t3.patient_id
         AND COALESCE(t0.episode_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(t3.episode_id, '00000000-0000-0000-0000-000000000000'::uuid)
        WHERE t0.timepoint = 'T0' AND t3.timepoint = 'T3'
          AND t0.total_score IS NOT NULL AND t3.total_score IS NOT NULL
      )
      SELECT
        COUNT(*)::int AS paros_szam,
        ROUND(AVG(delta)::numeric, 2) AS atlag_delta,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta))::numeric, 2) AS median_delta,
        ROUND(STDDEV_POP(delta)::numeric, 2) AS szoras_delta,
        MIN(delta)::int AS min_delta,
        MAX(delta)::int AS max_delta,
        COUNT(*) FILTER (WHERE delta < 0)::int AS javulok_szama,
        COUNT(*) FILTER (WHERE delta = 0)::int AS valtozatlanok_szama,
        COUNT(*) FILTER (WHERE delta > 0)::int AS romlok_szama
      FROM delta
    `),
    // Hisztogram a delta értékekre — alacsony pontszám = jobb minőség (OHIP-14 0..56).
    // Csoportok: <=-20, -19..-10, -9..-5, -4..-1, 0, 1..4, 5..9, 10..19, >=20
    pool.query(`
      WITH delta AS (
        SELECT t3.total_score - t0.total_score AS delta
        FROM ohip14_responses t0
        JOIN ohip14_responses t3
          ON t0.patient_id = t3.patient_id
         AND COALESCE(t0.episode_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(t3.episode_id, '00000000-0000-0000-0000-000000000000'::uuid)
        WHERE t0.timepoint = 'T0' AND t3.timepoint = 'T3'
          AND t0.total_score IS NOT NULL AND t3.total_score IS NOT NULL
      )
      SELECT
        CASE
          WHEN delta <= -20 THEN '≤-20 (nagy javulás)'
          WHEN delta <= -10 THEN '-19..-10'
          WHEN delta <= -5  THEN '-9..-5'
          WHEN delta <= -1  THEN '-4..-1'
          WHEN delta = 0    THEN '0'
          WHEN delta <= 4   THEN '1..4'
          WHEN delta <= 9   THEN '5..9'
          WHEN delta <= 19  THEN '10..19'
          ELSE '≥20 (nagy romlás)'
        END AS sav,
        CASE
          WHEN delta <= -20 THEN 0
          WHEN delta <= -10 THEN 1
          WHEN delta <= -5  THEN 2
          WHEN delta <= -1  THEN 3
          WHEN delta = 0    THEN 4
          WHEN delta <= 4   THEN 5
          WHEN delta <= 9   THEN 6
          WHEN delta <= 19  THEN 7
          ELSE 8
        END AS sav_idx,
        COUNT(*)::int AS darab
      FROM delta
      GROUP BY 1, 2
      ORDER BY 2
    `),
    // Kezelési terv készültségi % per beteg (felső / alsó / arcot külön).
    // Egy beteg "készült" arányát az `elem.elkeszult = true` darabszám / össz tervsor adja meg.
    // Csak azon betegek, akiknek van legalább 1 elem az adott rácsban.
    pool.query(`
      WITH percentages AS (
        SELECT
          patient_id,
          jsonb_array_length(COALESCE(kezelesi_terv_felso, '[]'::jsonb)) AS felso_osszes,
          (
            SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(kezelesi_terv_felso, '[]'::jsonb)) e
            WHERE COALESCE((e->>'elkeszult')::boolean, false)
          ) AS felso_kesz,
          jsonb_array_length(COALESCE(kezelesi_terv_also, '[]'::jsonb)) AS also_osszes,
          (
            SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(kezelesi_terv_also, '[]'::jsonb)) e
            WHERE COALESCE((e->>'elkeszult')::boolean, false)
          ) AS also_kesz,
          jsonb_array_length(COALESCE(kezelesi_terv_arcot_erinto, '[]'::jsonb)) AS arcot_osszes,
          (
            SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(kezelesi_terv_arcot_erinto, '[]'::jsonb)) e
            WHERE COALESCE((e->>'elkeszult')::boolean, false)
          ) AS arcot_kesz
        FROM patient_treatment_plans
      ),
      ratios AS (
        SELECT
          CASE WHEN felso_osszes > 0 THEN felso_kesz::numeric / felso_osszes END AS felso_arany,
          CASE WHEN also_osszes  > 0 THEN also_kesz::numeric  / also_osszes  END AS also_arany,
          CASE WHEN arcot_osszes > 0 THEN arcot_kesz::numeric / arcot_osszes END AS arcot_arany
        FROM percentages
      )
      SELECT
        COUNT(felso_arany)::int  AS felso_minta,
        ROUND(AVG(felso_arany * 100)::numeric, 1)  AS felso_atlag_pct,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY felso_arany * 100))::numeric, 1) AS felso_median_pct,
        COUNT(*) FILTER (WHERE felso_arany = 1)::int  AS felso_teljesen_kesz,
        COUNT(also_arany)::int  AS also_minta,
        ROUND(AVG(also_arany * 100)::numeric, 1)  AS also_atlag_pct,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY also_arany * 100))::numeric, 1) AS also_median_pct,
        COUNT(*) FILTER (WHERE also_arany = 1)::int  AS also_teljesen_kesz,
        COUNT(arcot_arany)::int AS arcot_minta,
        ROUND(AVG(arcot_arany * 100)::numeric, 1) AS arcot_atlag_pct,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY arcot_arany * 100))::numeric, 1) AS arcot_median_pct,
        COUNT(*) FILTER (WHERE arcot_arany = 1)::int AS arcot_teljesen_kesz
      FROM ratios
    `),
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

  // ── OHIP-14 T0 → T3 delta + hisztogram (gap-fillelt 9 sávra) ──
  const ohipDeltaSummary = ohip14DeltaSummaryResult.rows[0] || {};
  const numOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const OHIP_DELTA_LABELS = [
    '≤-20 (nagy javulás)',
    '-19..-10',
    '-9..-5',
    '-4..-1',
    '0',
    '1..4',
    '5..9',
    '10..19',
    '≥20 (nagy romlás)',
  ];
  const ohipDeltaBucketMap = new Map<number, number>(
    ohip14DeltaHistogramResult.rows.map((r: Record<string, unknown>) => [
      parseInt(String(r.sav_idx), 10),
      parseInt(String(r.darab), 10),
    ]),
  );
  const ohipDeltaHisztogram = OHIP_DELTA_LABELS.map((label, idx) => ({
    sav: label,
    savIdx: idx,
    darab: ohipDeltaBucketMap.get(idx) ?? 0,
  }));

  // ── Kezelési terv készültség: 3 rács × {minta, átlag, medián, teljesen kész} ──
  const tplComp = treatmentPlanCompletionResult.rows[0] || {};
  const completionFor = (prefix: 'felso' | 'also' | 'arcot') => ({
    mintaSzam: parseInt(String(tplComp[`${prefix}_minta`] ?? '0'), 10) || 0,
    atlagPct: numOrNull(tplComp[`${prefix}_atlag_pct`]),
    medianPct: numOrNull(tplComp[`${prefix}_median_pct`]),
    teljesenKesz: parseInt(String(tplComp[`${prefix}_teljesen_kesz`] ?? '0'), 10) || 0,
  });

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
      t0t3Delta: {
        parosSzam: parseInt(String(ohipDeltaSummary.paros_szam ?? '0'), 10) || 0,
        atlagDelta: numOrNull(ohipDeltaSummary.atlag_delta),
        medianDelta: numOrNull(ohipDeltaSummary.median_delta),
        szorasDelta: numOrNull(ohipDeltaSummary.szoras_delta),
        minDelta: numOrNull(ohipDeltaSummary.min_delta),
        maxDelta: numOrNull(ohipDeltaSummary.max_delta),
        javulokSzama: parseInt(String(ohipDeltaSummary.javulok_szama ?? '0'), 10) || 0,
        valtozatlanokSzama: parseInt(String(ohipDeltaSummary.valtozatlanok_szama ?? '0'), 10) || 0,
        romlokSzama: parseInt(String(ohipDeltaSummary.romlok_szama ?? '0'), 10) || 0,
        hisztogram: ohipDeltaHisztogram,
      },
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
      keszultseg: {
        felso: completionFor('felso'),
        also: completionFor('also'),
        arcot: completionFor('arcot'),
      },
    },
  };

  return NextResponse.json(response);
});
