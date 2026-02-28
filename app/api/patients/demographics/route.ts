import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

// Korfa, etiológia és DMF-T index statisztikák
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Ellenőrizzük a felhasználó szerepkörét és jogosultságait
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az adatok megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const now = new Date();
    const currentYear = now.getFullYear();

    // 1. KORFA - korcsoportok szerinti eloszlás
    const ageDistribution = await pool.query(`
      SELECT 
        CASE 
          WHEN szuletesi_datum IS NULL THEN 'Nincs adat'
          WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 30 THEN '0-29 év'
          WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 40 THEN '30-39 év'
          WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 50 THEN '40-49 év'
          WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 60 THEN '50-59 év'
          WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 70 THEN '60-69 év'
          WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 80 THEN '70-79 év'
          ELSE '80+ év'
        END as korcsoport,
        COUNT(*) as darab,
        ROUND(AVG(EXTRACT(YEAR FROM AGE(szuletesi_datum))), 2) as atlag_kor
      FROM patients
      WHERE szuletesi_datum IS NOT NULL
      GROUP BY korcsoport
      ORDER BY 
        CASE korcsoport
          WHEN '0-29 év' THEN 1
          WHEN '30-39 év' THEN 2
          WHEN '40-49 év' THEN 3
          WHEN '50-59 év' THEN 4
          WHEN '60-69 év' THEN 5
          WHEN '70-79 év' THEN 6
          WHEN '80+ év' THEN 7
          ELSE 8
        END
    `);

    // 2. ETIOLÓGIA - kezelésre érkezés indoka szerinti eloszlás
    const etiologyDistribution = await pool.query(`
      SELECT 
        COALESCE(kezelesre_erkezes_indoka, 'Nincs adat') as etiologia,
        COUNT(*) as darab,
        ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM patients), 0), 2) as szazalek
      FROM patients
      GROUP BY kezelesre_erkezes_indoka
      ORDER BY darab DESC
    `);

    // 3. DMF-T INDEX - számolás a meglevo_fogak JSONB mezőből
    // PostgreSQL-ben a JSONB kulcsokon végigiterálunk és számolunk
    const dmftStats = await pool.query(`
      WITH dmft_calculations AS (
        SELECT 
          id,
          meglevo_fogak,
          -- Számoljuk meg a D, F, M státuszú fogakat
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE fog.value->>'status' = 'D'
          ) as d_count,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE fog.value->>'status' = 'F'
          ) as f_count,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE fog.value->>'status' = 'M'
          ) as m_count
        FROM patients
        WHERE meglevo_fogak IS NOT NULL 
          AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        COUNT(*) as total_patients_with_data,
        ROUND(AVG(dmft_total), 2) as atlag_dmft,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dmft_total), 2) as median_dmft,
        MIN(dmft_total) as min_dmft,
        MAX(dmft_total) as max_dmft,
        ROUND(AVG(d_count), 2) as atlag_d,
        ROUND(AVG(f_count), 2) as atlag_f,
        ROUND(AVG(m_count), 2) as atlag_m
      FROM dmft_calculations
      WHERE dmft_total > 0
    `);

    // DMF-T eloszlás korcsoportok szerint
    const dmftByAge = await pool.query(`
      WITH patient_ages AS (
        SELECT 
          id,
          CASE 
            WHEN szuletesi_datum IS NULL THEN 'Nincs adat'
            WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 30 THEN '0-29 év'
            WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 40 THEN '30-39 év'
            WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 50 THEN '40-49 év'
            WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 60 THEN '50-59 év'
            WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 70 THEN '60-69 év'
            WHEN EXTRACT(YEAR FROM AGE(szuletesi_datum)) < 80 THEN '70-79 év'
            ELSE '80+ év'
          END as korcsoport,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patients
        WHERE meglevo_fogak IS NOT NULL 
          AND meglevo_fogak != '{}'::jsonb
          AND szuletesi_datum IS NOT NULL
      )
      SELECT 
        korcsoport,
        COUNT(*) as darab,
        ROUND(AVG(dmft_total), 2) as atlag_dmft,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dmft_total), 2) as median_dmft
      FROM patient_ages
      WHERE dmft_total > 0
      GROUP BY korcsoport
      ORDER BY 
        CASE korcsoport
          WHEN '0-29 év' THEN 1
          WHEN '30-39 év' THEN 2
          WHEN '40-49 év' THEN 3
          WHEN '50-59 év' THEN 4
          WHEN '60-69 év' THEN 5
          WHEN '70-79 év' THEN 6
          WHEN '80+ év' THEN 7
          ELSE 8
        END
    `);

    // DMF-T eloszlás etiológia szerint
    const dmftByEtiology = await pool.query(`
      WITH patient_dmft AS (
        SELECT 
          id,
          COALESCE(kezelesre_erkezes_indoka, 'Nincs adat') as etiologia,
          (
            SELECT COUNT(*)
            FROM jsonb_each(meglevo_fogak) AS fog
            WHERE (fog.value->>'status' = 'D' OR fog.value->>'status' = 'F' OR fog.value->>'status' = 'M')
          ) as dmft_total
        FROM patients
        WHERE meglevo_fogak IS NOT NULL 
          AND meglevo_fogak != '{}'::jsonb
      )
      SELECT 
        etiologia,
        COUNT(*) as darab,
        ROUND(AVG(dmft_total), 2) as atlag_dmft,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dmft_total), 2) as median_dmft
      FROM patient_dmft
      WHERE dmft_total > 0
      GROUP BY etiologia
      ORDER BY darab DESC
    `);

    return NextResponse.json({
      korfa: {
        eloszlás: ageDistribution.rows.map(row => ({
          korcsoport: row.korcsoport,
          darab: parseInt(row.darab),
          atlagKor: parseFloat(row.atlag_kor) || null
        })),
        osszes: ageDistribution.rows.reduce((sum, row) => sum + parseInt(row.darab), 0)
      },
      etiologia: {
        eloszlás: etiologyDistribution.rows.map(row => ({
          etiologia: row.etiologia,
          darab: parseInt(row.darab),
          szazalek: parseFloat(row.szazalek) || 0
        })),
        osszes: etiologyDistribution.rows.reduce((sum, row) => sum + parseInt(row.darab), 0)
      },
      dmft: {
        osszesitett: dmftStats.rows[0] ? {
          totalPaciensek: parseInt(dmftStats.rows[0].total_patients_with_data) || 0,
          atlag: parseFloat(dmftStats.rows[0].atlag_dmft) || 0,
          median: parseFloat(dmftStats.rows[0].median_dmft) || 0,
          minimum: parseInt(dmftStats.rows[0].min_dmft) || 0,
          maximum: parseInt(dmftStats.rows[0].max_dmft) || 0,
          atlagD: parseFloat(dmftStats.rows[0].atlag_d) || 0,
          atlagF: parseFloat(dmftStats.rows[0].atlag_f) || 0,
          atlagM: parseFloat(dmftStats.rows[0].atlag_m) || 0
        } : null,
        korcsoportokSzerint: dmftByAge.rows.map(row => ({
          korcsoport: row.korcsoport,
          darab: parseInt(row.darab),
          atlagDmft: parseFloat(row.atlag_dmft) || 0,
          medianDmft: parseFloat(row.median_dmft) || 0
        })),
        etiologiaSzerint: dmftByEtiology.rows.map(row => ({
          etiologia: row.etiologia,
          darab: parseInt(row.darab),
          atlagDmft: parseFloat(row.atlag_dmft) || 0,
          medianDmft: parseFloat(row.median_dmft) || 0
        }))
      }
    });
  } catch (error) {
    logger.error('Hiba a demográfiai statisztikák lekérdezésekor:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}





