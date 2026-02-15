import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { fetchVirtualAppointments } from '@/lib/virtual-appointments-service';

// Get appointments for calendar view with date range filtering
export const dynamic = 'force-dynamic';

/** Extract YYYY-MM-DD in Europe/Budapest from ISO string (avoids UTC date shift) */
function toDateOnlyBudapest(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' }); // YYYY-MM-DD
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const searchParams = request.nextUrl.searchParams;
    
    // Date range parameters
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const dentistEmail = searchParams.get('dentistEmail');
    const status = searchParams.get('status'); // appointment status filter
    const includeAvailableSlots = searchParams.get('includeAvailableSlots') === 'true';
    const includeVirtual = searchParams.get('includeVirtual') === 'true';

    // Build WHERE clause
    const whereConditions: string[] = [];
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    // Date range filter
    if (startDate) {
      whereConditions.push(`ats.start_time >= $${paramIndex}`);
      queryParams.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereConditions.push(`ats.start_time < $${paramIndex}`);
      queryParams.push(endDate);
      paramIndex++;
    }

    // Dentist filter
    if (dentistEmail) {
      whereConditions.push(`a.dentist_email = $${paramIndex}`);
      queryParams.push(dentistEmail);
      paramIndex++;
    }

    // Status filter
    if (status) {
      if (status === 'upcoming') {
        // Upcoming appointments (no status or null)
        whereConditions.push(`(a.appointment_status IS NULL OR a.appointment_status = '')`);
      } else {
        whereConditions.push(`a.appointment_status = $${paramIndex}`);
        queryParams.push(status);
        paramIndex++;
      }
    }

    // No role-based filtering - everyone sees all appointments in calendar view

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Query appointments
    const appointmentsQuery = `
      SELECT 
        a.id,
        a.patient_id as "patientId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        a.appointment_status as "appointmentStatus",
        a.completion_notes as "completionNotes",
        a.is_late as "isLate",
        a.appointment_type as "appointmentType",
        ats.start_time as "startTime",
        ats.status as "slotStatus",
        ats.cim,
        ats.teremszam,
        p.nev as "patientName",
        p.taj as "patientTaj",
        p.email as "patientEmail",
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      ${whereClause}
      ORDER BY ats.start_time ASC
    `;

    const appointmentsResult = await pool.query(appointmentsQuery, queryParams);

    // If requested, also fetch available time slots
    let availableSlots: any[] = [];
    if (includeAvailableSlots) {
      const slotsWhereConditions: string[] = [];
      const slotsQueryParams: unknown[] = [];
      let slotsParamIndex = 1;

      // Date range for slots
      if (startDate) {
        slotsWhereConditions.push(`ats.start_time >= $${slotsParamIndex}`);
        slotsQueryParams.push(startDate);
        slotsParamIndex++;
      }
      if (endDate) {
        slotsWhereConditions.push(`ats.start_time < $${slotsParamIndex}`);
        slotsQueryParams.push(endDate);
        slotsParamIndex++;
      }

      // Only show available slots
      slotsWhereConditions.push(`ats.status = $${slotsParamIndex}`);
      slotsQueryParams.push('available');
      slotsParamIndex++;

      // Role-based filtering for slots
      if (auth.role === 'fogpótlástanász') {
        slotsWhereConditions.push(`ats.user_id = (SELECT id FROM users WHERE email = $${slotsParamIndex})`);
        slotsQueryParams.push(auth.email);
        slotsParamIndex++;
      }
      // Admin and others see all available slots

      const slotsWhereClause = slotsWhereConditions.length > 0
        ? `WHERE ${slotsWhereConditions.join(' AND ')}`
        : '';

      const slotsQuery = `
        SELECT 
          ats.id,
          ats.start_time as "startTime",
          ats.status,
          ats.cim,
          ats.teremszam,
          u.email as "dentistEmail",
          u.doktor_neve as "dentistName"
        FROM available_time_slots ats
        LEFT JOIN users u ON ats.user_id = u.id
        ${slotsWhereClause}
        ORDER BY ats.start_time ASC
      `;

      const slotsResult = await pool.query(slotsQuery, slotsQueryParams);
      availableSlots = slotsResult.rows;
    }

    // Group appointments by date for efficient rendering
    const appointmentsByDate: Record<string, any[]> = {};
    appointmentsResult.rows.forEach((appointment: any) => {
      const dateKey = new Date(appointment.startTime).toISOString().split('T')[0];
      if (!appointmentsByDate[dateKey]) {
        appointmentsByDate[dateKey] = [];
      }
      appointmentsByDate[dateKey].push(appointment);
    });

    // Group available slots by date
    const slotsByDate: Record<string, any[]> = {};
    availableSlots.forEach((slot: any) => {
      const dateKey = new Date(slot.startTime).toISOString().split('T')[0];
      if (!slotsByDate[dateKey]) {
        slotsByDate[dateKey] = [];
      }
      slotsByDate[dateKey].push(slot);
    });

    // Virtual appointments: import service directly (no HTTP)
    let virtualAppointments: any[] = [];
    let virtualAppointmentsByDate: Record<string, any[]> = {};
    if (includeVirtual && startDate && endDate) {
      const rangeStart = toDateOnlyBudapest(startDate);
      const rangeEnd = toDateOnlyBudapest(endDate);
      if (rangeStart && rangeEnd && rangeEnd >= rangeStart) {
        const { items } = await fetchVirtualAppointments({
          rangeStartDate: rangeStart,
          rangeEndDate: rangeEnd,
          readyOnly: true,
        });
        virtualAppointments = items;
        items.forEach((v: any) => {
          // Virtual spans window; add to each day in window (within view range) for calendar display
          // Use Budapest timezone consistently for date keys (matches rangeStart/rangeEnd from toDateOnlyBudapest)
          const startStr = toDateOnlyBudapest(v.windowStartDate);
          const endStr = toDateOnlyBudapest(v.windowEndDate);
          if (!startStr || !endStr) return;
          let current = startStr;
          while (current <= endStr && current <= rangeEnd) {
            if (current >= rangeStart) {
              if (!virtualAppointmentsByDate[current]) virtualAppointmentsByDate[current] = [];
              virtualAppointmentsByDate[current].push(v);
            }
            const nextDate = new Date(current + 'T12:00:00Z');
            nextDate.setUTCDate(nextDate.getUTCDate() + 1);
            current = nextDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
          }
        });
      }
    }

    const response: Record<string, unknown> = {
      appointments: appointmentsResult.rows,
      appointmentsByDate,
      availableSlots,
      slotsByDate,
    };
    if (includeVirtual) {
      response.virtualAppointments = virtualAppointments;
      response.virtualAppointmentsByDate = virtualAppointmentsByDate;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching calendar appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt a naptár adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

