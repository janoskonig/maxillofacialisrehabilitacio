import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * GET /api/dashboard/waiting-times - Várakozási idők lekérése első konzultációra és munkafázisra
 */
export const dynamic = 'force-dynamic';

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
    // A várakozási időt az IDŐPONT LÉTREHOZÁSÁTÓL számoljuk (amikor a páciens megkapta az időpontot)
    const elsoKonzultacioResult = await pool.query(`
      WITH first_appointments AS (
        SELECT DISTINCT ON (p.id)
          p.id as patient_id,
          ats.start_time as elso_idopont,
          a.created_at as idopont_letrehozas,
          EXTRACT(EPOCH FROM (ats.start_time - a.created_at)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE ats.start_time > $1::timestamp with time zone
          AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
        ORDER BY p.id, ats.start_time ASC, a.created_at ASC
      )
      SELECT 
        ROUND(AVG(varakozasi_ido_napokban)::numeric, 1) as atlag,
        ROUND(STDDEV_POP(varakozasi_ido_napokban)::numeric, 1) as szoras,
        COUNT(*) as beteg_szama
      FROM first_appointments
    `, [nowISO]);

    // 2. Munkafázis várakozási idő
    // A várakozási időt az IDŐPONT LÉTREHOZÁSÁTÓL számoljuk (amikor a páciens megkapta a munkafázis időpontot)
    const munkafazisResult = await pool.query(`
      WITH next_work_phase AS (
        SELECT DISTINCT ON (p.id)
          p.id as patient_id,
          ats.start_time as kovetkezo_munkafazis_idopont,
          a.created_at as idopont_letrehozas,
          EXTRACT(EPOCH FROM (ats.start_time - a.created_at)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE a.appointment_type = 'munkafazis'
          AND ats.start_time > $1::timestamp with time zone
        ORDER BY p.id, ats.start_time ASC, a.created_at ASC
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
    logger.error('Error fetching waiting times:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

