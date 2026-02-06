import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import type { MedicalStats } from '@/lib/types';

// Szakmai statisztikák API végpont
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Csak admin hozzáférés
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az admin statisztikák megtekintéséhez' },
        { status: 403 }
      );
    }

    const pool = getDbPool();

    // 1. BNO statisztikák
    const bnoResult = await pool.query(`
      SELECT 
        TRIM(unnest(string_to_array(bno, ','))) as bno_kod,
        COUNT(*) as elofordulas
      FROM patients
      WHERE bno IS NOT NULL AND bno != ''
      GROUP BY bno_kod
      ORDER BY elofordulas DESC
    `);

    // 2. Beutaló orvosok eloszlása
    const referringDoctorsResult = await pool.query(`
      SELECT 
        beutalo_orvos as orvos,
        COUNT(*) as darab
      FROM patients
      WHERE beutalo_orvos IS NOT NULL AND beutalo_orvos != ''
      GROUP BY beutalo_orvos
      ORDER BY darab DESC
    `);

    // 3. DMF index eloszlás
    const dmftCalculationsResult = await pool.query(`
      WITH dmft_calculations AS (
        SELECT 
          id,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patients
        WHERE meglevo_fogak IS NOT NULL AND meglevo_fogak != '{}'::jsonb
      )
      SELECT * FROM dmft_calculations WHERE dmft_total >= 0
    `);

    const dmftStatsResult = await pool.query(`
      WITH dmft_calculations AS (
        SELECT 
          id,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patients
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
    `);

    const dmftDistributionResult = await pool.query(`
      WITH dmft_calculations AS (
        SELECT 
          id,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patients
        WHERE meglevo_fogak IS NOT NULL AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        dmft_total as dmft,
        COUNT(*) as beteg_szama
      FROM dmft_calculations
      WHERE dmft_total >= 0
      GROUP BY dmft_total
      ORDER BY dmft_total
    `);

    // 4. Fogak pozíciói (Zsigmondy)
    const toothPositionsResult = await pool.query(`
      WITH tooth_positions AS (
        SELECT 
          key::int as fog_szam,
          value->>'status' as status
        FROM patients,
        LATERAL jsonb_each(meglevo_fogak)
        WHERE meglevo_fogak IS NOT NULL AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        fog_szam as "fogSzam",
        COUNT(*) FILTER (WHERE status = 'D') as "dSzama",
        COUNT(*) FILTER (WHERE status = 'F') as "fSzama",
        COUNT(*) FILTER (WHERE status = 'M') as "mSzama",
        COUNT(*) as osszes
      FROM tooth_positions
      WHERE fog_szam BETWEEN 11 AND 48
      GROUP BY fog_szam
      ORDER BY fog_szam
    `);

    // 5. Implantátumok pozíciói (Zsigmondy)
    // Először ellenőrizzük, hogy létezik-e az implants tábla
    let implantPositionsResult;
    try {
      implantPositionsResult = await pool.query(`
        WITH implant_positions AS (
          -- JSONB mezőből
          SELECT key::int as fog_szam
          FROM patients,
          LATERAL jsonb_each(meglevo_implantatumok)
          WHERE meglevo_implantatumok IS NOT NULL AND meglevo_implantatumok != '{}'::jsonb
          
          UNION ALL
          
          -- Normalizált táblából (ha létezik)
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
      `);
    } catch (error: any) {
      // Ha az implants tábla nem létezik, csak a JSONB mezőből kérdezzük le
      if (error.code === '42P01') { // relation does not exist
        implantPositionsResult = await pool.query(`
          SELECT 
            key::int as "fogSzam",
            COUNT(*) as "implantatumSzama"
          FROM patients,
          LATERAL jsonb_each(meglevo_implantatumok)
          WHERE meglevo_implantatumok IS NOT NULL AND meglevo_implantatumok != '{}'::jsonb
            AND key::int BETWEEN 11 AND 48
          GROUP BY key::int
          ORDER BY key::int
        `);
      } else {
        throw error;
      }
    }

    // 6. Átlagos első időpontra való várakozási idő
    // Csak az első konzultációkat számoljuk (appointment_type = 'elso_konzultacio' vagy NULL a kompatibilitásért)
    // A várakozási időt az IDŐPONT LÉTREHOZÁSÁTÓL számoljuk (amikor a páciens megkapta az időpontot)
    const waitingTimeResult = await pool.query(`
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
    `);

    // 7. Orvosok leterheltsége
    const doctorWorkloadResult = await pool.query(`
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
    `);

    // 8. Kezelőorvosra vár státuszú betegek
    const waitingPatientsResult = await pool.query(`
      WITH betegek_idoponttal AS (
        SELECT DISTINCT p.id
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE ats.start_time > NOW() 
          AND (a.approval_status IS NULL OR a.approval_status = 'approved')
          AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
          AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
      ),
      waiting_patients AS (
        SELECT 
          p.id,
          p.nev,
          p.taj,
          p.kezeleoorvos,
          p.created_at as beteg_letrehozva,
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM appointments a2 
              JOIN available_time_slots ats2 ON a2.time_slot_id = ats2.id
              WHERE a2.patient_id = p.id AND a2.approval_status = 'pending'
            ) THEN 'pending'
            ELSE 'nincs_idopont'
          END as status
        FROM patients p
        WHERE (p.kezeleoorvos IS NULL OR p.kezeleoorvos = '')
          AND p.id NOT IN (SELECT id FROM betegek_idoponttal)
      )
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'nincs_idopont') as nincs_idopont_count,
        COUNT(*) as total_count,
        json_agg(
          json_build_object(
            'id', id,
            'nev', nev,
            'taj', taj,
            'kezeleoorvos', kezeleoorvos,
            'betegLetrehozva', beteg_letrehozva,
            'status', status
          )
        ) as betegek
      FROM waiting_patients
    `);

    // Adatok összeállítása
    const dmftStats = dmftStatsResult.rows[0] || {};
    const dmftDistribution = dmftDistributionResult.rows || [];
    const waitingTime = waitingTimeResult.rows[0] || {};
    const waitingPatients = waitingPatientsResult.rows[0] || {};

    const response: MedicalStats = {
      bno: {
        data: bnoResult.rows.map(row => ({
          kod: row.bno_kod,
          elofordulas: parseInt(row.elofordulas)
        }))
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
      waitingPatients: {
        osszes: parseInt(waitingPatients.total_count) || 0,
        pending: parseInt(waitingPatients.pending_count) || 0,
        nincsIdopont: parseInt(waitingPatients.nincs_idopont_count) || 0,
        betegek: (waitingPatients.betegek || []).map((patient: any) => ({
          id: patient.id,
          nev: patient.nev,
          taj: patient.taj,
          kezeleoorvos: patient.kezeleoorvos,
          betegLetrehozva: patient.betegLetrehozva,
          status: patient.status
        }))
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Hiba a szakmai statisztikák lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}
