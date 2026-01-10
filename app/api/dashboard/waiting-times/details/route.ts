import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';

/**
 * GET /api/dashboard/waiting-times/details - Részletes várakozási idők betegekkel
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
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'elso_konzultacio' vagy 'munkafazis'

    // Jelenlegi dátum/idő JavaScript-ben (UTC)
    const now = new Date();
    const nowISO = now.toISOString();

    if (type === 'elso_konzultacio') {
      // Első konzultáció részletes adatok
      const result = await pool.query(`
        SELECT 
          p.id as patient_id,
          p.nev as patient_name,
          p.taj as patient_taj,
          $1::timestamp with time zone as jelenlegi_datum,
          MIN(ats.start_time) FILTER (WHERE a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio') as elso_konzultacio_idopont,
          EXTRACT(EPOCH FROM (MIN(ats.start_time) FILTER (WHERE a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio') - $1::timestamp with time zone)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE ats.start_time > $1::timestamp with time zone
          AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
        GROUP BY p.id, p.nev, p.taj
        HAVING MIN(ats.start_time) FILTER (WHERE a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio') IS NOT NULL
        ORDER BY elso_konzultacio_idopont ASC
      `, [nowISO]);

      return NextResponse.json({
        type: 'elso_konzultacio',
        data: result.rows.map(row => ({
          patientId: row.patient_id,
          patientName: row.patient_name,
          patientTaj: row.patient_taj,
          currentDate: row.jelenlegi_datum,
          firstConsultationDate: row.elso_konzultacio_idopont,
          waitingTimeDays: parseFloat(row.varakozasi_ido_napokban) || 0,
        })),
      });
    } else if (type === 'munkafazis') {
      // Munkafázis részletes adatok
      const result = await pool.query(`
        WITH patient_last_appointments AS (
          SELECT 
            p.id as patient_id,
            p.nev as patient_name,
            p.taj as patient_taj,
            MAX(ats.start_time) FILTER (WHERE ats.start_time <= $1::timestamp with time zone) as legutolso_idopont
          FROM patients p
          JOIN appointments a ON p.id = a.patient_id
          JOIN available_time_slots ats ON a.time_slot_id = ats.id
          GROUP BY p.id, p.nev, p.taj
          HAVING MAX(ats.start_time) FILTER (WHERE ats.start_time <= $1::timestamp with time zone) IS NOT NULL
        ),
        next_work_phase AS (
          SELECT 
            pla.patient_id,
            pla.patient_name,
            pla.patient_taj,
            pla.legutolso_idopont,
            MIN(ats.start_time) FILTER (WHERE a.appointment_type = 'munkafazis') as kovetkezo_munkafazis_idopont,
            EXTRACT(EPOCH FROM (MIN(ats.start_time) FILTER (WHERE a.appointment_type = 'munkafazis') - pla.legutolso_idopont)) / 86400 as varakozasi_ido_napokban
          FROM patient_last_appointments pla
          JOIN appointments a ON pla.patient_id = a.patient_id
          JOIN available_time_slots ats ON a.time_slot_id = ats.id
          WHERE a.appointment_type = 'munkafazis'
            AND ats.start_time > $1::timestamp with time zone
            AND ats.start_time > pla.legutolso_idopont
          GROUP BY pla.patient_id, pla.patient_name, pla.patient_taj, pla.legutolso_idopont
          HAVING MIN(ats.start_time) FILTER (WHERE a.appointment_type = 'munkafazis') IS NOT NULL
        )
        SELECT 
          patient_id,
          patient_name,
          patient_taj,
          $1::timestamp with time zone as jelenlegi_datum,
          legutolso_idopont,
          kovetkezo_munkafazis_idopont,
          varakozasi_ido_napokban
        FROM next_work_phase
        ORDER BY kovetkezo_munkafazis_idopont ASC
      `, [nowISO]);

      return NextResponse.json({
        type: 'munkafazis',
        data: result.rows.map(row => ({
          patientId: row.patient_id,
          patientName: row.patient_name,
          patientTaj: row.patient_taj,
          currentDate: row.jelenlegi_datum,
          lastAppointmentDate: row.legutolso_idopont,
          nextWorkPhaseDate: row.kovetkezo_munkafazis_idopont,
          waitingTimeDays: parseFloat(row.varakozasi_ido_napokban) || 0,
        })),
      });
    } else {
      return NextResponse.json(
        { error: 'Érvénytelen típus. Használja az "elso_konzultacio" vagy "munkafazis" értéket.' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error fetching waiting times details:', error);
    return NextResponse.json(
      { error: 'Hiba történt az adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

