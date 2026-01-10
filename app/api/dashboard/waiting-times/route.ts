import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';

/**
 * GET /api/dashboard/waiting-times - Várakozási idők lekérése első konzultációra és munkafázisra
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága az adatok megtekintéséhez' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    // Jelenlegi dátum/idő JavaScript-ben (UTC)
    const now = new Date();
    const nowISO = now.toISOString();

    // 1. Első konzultáció várakozási idő (csak jövőbeli időpontok)
    // A várakozási időt a JELENLEGI DÁTUMTÓL számoljuk, nem a beteg létrehozásának dátumától!
    const elsoKonzultacioResult = await pool.query(`
      WITH first_appointments AS (
        SELECT 
          p.id as patient_id,
          MIN(ats.start_time) FILTER (WHERE a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio') as elso_idopont,
          EXTRACT(EPOCH FROM (MIN(ats.start_time) FILTER (WHERE a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio') - $1::timestamp with time zone)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE ats.start_time > $1::timestamp with time zone
          AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
        GROUP BY p.id
        HAVING MIN(ats.start_time) FILTER (WHERE a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio') IS NOT NULL
      )
      SELECT 
        ROUND(AVG(varakozasi_ido_napokban)::numeric, 1) as atlag,
        ROUND(STDDEV_POP(varakozasi_ido_napokban)::numeric, 1) as szoras,
        COUNT(*) as beteg_szama
      FROM first_appointments
    `, [nowISO]);

    // 2. Munkafázis várakozási idő (következő munkafázis időpont - legutolsó időpont)
    // A legutolsó időpont óta eltelt időt számoljuk
    const munkafazisResult = await pool.query(`
      WITH patient_last_appointments AS (
        SELECT 
          p.id as patient_id,
          MAX(ats.start_time) FILTER (WHERE ats.start_time <= $1::timestamp with time zone) as legutolso_idopont
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        GROUP BY p.id
        HAVING MAX(ats.start_time) FILTER (WHERE ats.start_time <= $1::timestamp with time zone) IS NOT NULL
      ),
      next_work_phase AS (
        SELECT 
          pla.patient_id,
          pla.legutolso_idopont,
          MIN(ats.start_time) FILTER (WHERE a.appointment_type = 'munkafazis') as kovetkezo_munkafazis_idopont,
          EXTRACT(EPOCH FROM (MIN(ats.start_time) FILTER (WHERE a.appointment_type = 'munkafazis') - pla.legutolso_idopont)) / 86400 as varakozasi_ido_napokban
        FROM patient_last_appointments pla
        JOIN appointments a ON pla.patient_id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE a.appointment_type = 'munkafazis'
          AND ats.start_time > $1::timestamp with time zone
          AND ats.start_time > pla.legutolso_idopont
        GROUP BY pla.patient_id, pla.legutolso_idopont
        HAVING MIN(ats.start_time) FILTER (WHERE a.appointment_type = 'munkafazis') IS NOT NULL
      )
      SELECT 
        ROUND(AVG(varakozasi_ido_napokban)::numeric, 1) as atlag,
        ROUND(STDDEV_POP(varakozasi_ido_napokban)::numeric, 1) as szoras,
        COUNT(*) as beteg_szama
      FROM next_work_phase
    `, [nowISO]);

    const elsoKonzultacio = elsoKonzultacioResult.rows[0] || {};
    const munkafazis = munkafazisResult.rows[0] || {};

    return NextResponse.json({
      elsoKonzultacio: elsoKonzultacio.atlag
        ? {
            atlag: parseFloat(elsoKonzultacio.atlag) || 0,
            szoras: parseFloat(elsoKonzultacio.szoras) || null,
            betegSzama: parseInt(elsoKonzultacio.beteg_szama) || 0,
          }
        : null,
      munkafazis: munkafazis.atlag
        ? {
            atlag: parseFloat(munkafazis.atlag) || 0,
            szoras: parseFloat(munkafazis.szoras) || null,
            betegSzama: parseInt(munkafazis.beteg_szama) || 0,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching waiting times:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

