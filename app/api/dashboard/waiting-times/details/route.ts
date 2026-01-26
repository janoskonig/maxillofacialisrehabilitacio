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
      // A várakozási időt az IDŐPONT LÉTREHOZÁSÁTÓL számoljuk (amikor a páciens megkapta az időpontot)
      const result = await pool.query(`
        SELECT DISTINCT ON (p.id)
          p.id as patient_id,
          p.nev as patient_name,
          p.taj as patient_taj,
          a.created_at as idopont_letrehozas,
          ats.start_time as elso_konzultacio_idopont,
          EXTRACT(EPOCH FROM (ats.start_time - a.created_at)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE ats.start_time > $1::timestamp with time zone
          AND (a.appointment_type IS NULL OR a.appointment_type = 'elso_konzultacio')
        ORDER BY p.id, ats.start_time ASC, a.created_at ASC
      `, [nowISO]);

      return NextResponse.json({
        type: 'elso_konzultacio',
        data: result.rows.map(row => ({
          patientId: row.patient_id,
          patientName: row.patient_name,
          patientTaj: row.patient_taj,
          appointmentCreatedAt: row.idopont_letrehozas,
          firstConsultationDate: row.elso_konzultacio_idopont,
          waitingTimeDays: parseFloat(row.varakozasi_ido_napokban) || 0,
        })),
      });
    } else if (type === 'munkafazis') {
      // Munkafázis részletes adatok
      // A várakozási időt az IDŐPONT LÉTREHOZÁSÁTÓL számoljuk (amikor a páciens megkapta a munkafázis időpontot)
      const result = await pool.query(`
        SELECT DISTINCT ON (p.id)
          p.id as patient_id,
          p.nev as patient_name,
          p.taj as patient_taj,
          a.created_at as idopont_letrehozas,
          ats.start_time as kovetkezo_munkafazis_idopont,
          EXTRACT(EPOCH FROM (ats.start_time - a.created_at)) / 86400 as varakozasi_ido_napokban
        FROM patients p
        JOIN appointments a ON p.id = a.patient_id
        JOIN available_time_slots ats ON a.time_slot_id = ats.id
        WHERE a.appointment_type = 'munkafazis'
          AND ats.start_time > $1::timestamp with time zone
        ORDER BY p.id, ats.start_time ASC, a.created_at ASC
      `, [nowISO]);

      return NextResponse.json({
        type: 'munkafazis',
        data: result.rows.map(row => ({
          patientId: row.patient_id,
          patientName: row.patient_name,
          patientTaj: row.patient_taj,
          appointmentCreatedAt: row.idopont_letrehozas,
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

