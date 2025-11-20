import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Batch lekérdezés az időpontokhoz beteg ID-k alapján
// Optimalizálás: egyetlen lekérdezésben visszaadja az összes beteg időpontjait
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { patientIds } = body;

    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      return NextResponse.json({ appointments: {} }, { status: 200 });
    }

    const pool = getDbPool();

    // Lekérdezzük az összes releváns időpontot egyetlen query-ben
    // Csak a jövőbeli időpontokat (4 órás késleltetéssel)
    const now = new Date();
    const fourHoursFromNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    const query = `
      SELECT 
        a.patient_id as "patientId",
        a.id,
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        ats.start_time as "startTime",
        ats.status,
        ats.cim,
        ats.teremszam,
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      LEFT JOIN users u ON a.dentist_email = u.email
      WHERE a.patient_id = ANY($1::uuid[])
        AND ats.start_time >= $2
      ORDER BY ats.start_time ASC
    `;

    const result = await pool.query(query, [
      patientIds,
      fourHoursFromNow.toISOString()
    ]);

    // Csoportosítás beteg ID szerint, csak a legkorábbi időpontot tartjuk meg
    const appointmentsMap: Record<string, any> = {};
    const patientAppointments: Record<string, any[]> = {};

    // Először csoportosítjuk beteg ID szerint
    result.rows.forEach((apt: any) => {
      const patientId = apt.patientId;
      if (!patientAppointments[patientId]) {
        patientAppointments[patientId] = [];
      }
      patientAppointments[patientId].push(apt);
    });

    // Minden beteghez csak a legkorábbi időpontot tartjuk meg
    Object.keys(patientAppointments).forEach((patientId) => {
      const apts = patientAppointments[patientId];
      if (apts.length > 0) {
        // Már rendezve van startTime szerint ASC, ezért az első a legkorábbi
        const nextApt = apts[0];
        appointmentsMap[patientId] = {
          id: nextApt.id,
          startTime: nextApt.startTime,
          dentistEmail: nextApt.dentistEmail,
          dentistName: nextApt.dentistName,
        };
      }
    });

    return NextResponse.json({ appointments: appointmentsMap }, { status: 200 });
  } catch (error) {
    console.error('Error fetching batch appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}

