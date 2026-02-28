import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';
import { logger } from '@/lib/logger';
import { createAppointment, sendAppointmentNotifications } from '@/lib/appointment-service';

// Get all appointments
export const dynamic = 'force-dynamic';

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

    // Pagination paraméterek
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;
    const patientId = searchParams.get('patientId');

    // WHERE feltétel építése
    let whereClause = '';
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (patientId) {
      whereClause = `WHERE a.patient_id = $${paramIndex}`;
      queryParams.push(patientId);
      paramIndex++;
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);

    // Data query with optional patientId filter
    const query = `
      SELECT 
        a.id,
        a.patient_id as "patientId",
        a.episode_id as "episodeId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        a.approved_at as "approvedAt",
        a.approval_status as "approvalStatus",
        a.approval_token as "approvalToken",
        a.appointment_status as "appointmentStatus",
        a.completion_notes as "completionNotes",
        a.is_late as "isLate",
        a.appointment_type as "appointmentType",
        a.step_code as "stepCode",
        a.pool,
        a.created_via as "createdVia",
        ats.start_time as "startTime",
        ats.status,
        ats.cim,
        ats.teremszam,
        ats.source as "timeSlotSource",
        p.nev as "patientName",
        p.taj as "patientTaj",
        p.email as "patientEmail",
        sc.label_hu as "stepLabel"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      LEFT JOIN step_catalog sc ON a.step_code = sc.step_code AND sc.is_active = true
      ${whereClause}
      ORDER BY ats.start_time ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit.toString(), offset.toString());

    const result = await pool.query(query, queryParams);
    
    const total = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(total / limit);
    
    return NextResponse.json({ 
      appointments: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      }
    });
  } catch (error) {
    logger.error('Error fetching appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt a foglalások lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Book an appointment (only sebészorvos)
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    if (auth.role !== 'sebészorvos' && auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json(
        { error: 'Csak sebészorvos, admin vagy fogpótlástanász foglalhat időpontot' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { patientId, timeSlotId, cim, teremszam, appointmentType, episodeId, pool = 'work', overrideReason, stepCode, createdVia: createdViaParam, slotIntentId, stepSeq } = body;
    const bodyRequiresPrecommit = body.requiresPrecommit === true;

    const validCreatedVia = ['worklist', 'patient_form', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'] as const;
    const createdVia = typeof createdViaParam === 'string' && validCreatedVia.includes(createdViaParam as (typeof validCreatedVia)[number])
      ? createdViaParam
      : 'worklist';

    if (!patientId || !timeSlotId) {
      return NextResponse.json(
        { error: 'Beteg ID és időpont ID megadása kötelező' },
        { status: 400 }
      );
    }

    const validPools = ['consult', 'work', 'control'];
    const poolValue = (validPools.includes(pool) ? pool : 'work') as 'consult' | 'work' | 'control';

    const db = getDbPool();

    // Verify patient exists
    const patientResult = await db.query(
      'SELECT id, nev, taj, email, nem, created_by FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    if (poolValue === 'work' && !episodeId) {
      return NextResponse.json(
        { error: 'Work pool foglaláshoz epizód ID kötelező (episodeId)', code: 'EPISODE_ID_REQUIRED' },
        { status: 400 }
      );
    }

    const outcome = await createAppointment(db, {
      patientId,
      timeSlotId,
      episodeId: episodeId || null,
      appointmentType: appointmentType || null,
      pool: poolValue,
      cim,
      teremszam,
      overrideReason,
      stepCode,
      createdVia,
      slotIntentId,
      stepSeq: typeof stepSeq === 'number' ? stepSeq : null,
      requiresPrecommit: bodyRequiresPrecommit,
    }, {
      email: auth.email,
      userId: auth.userId,
      role: auth.role,
    });

    if (!outcome.ok) {
      const { error, status, ...rest } = outcome.validationError;
      return NextResponse.json({ error, ...rest }, { status });
    }

    const { appointment, timeSlot, updatedTimeSlot, durationMinutes } = outcome.result;

    // Fire-and-forget notifications (errors are caught internally)
    sendAppointmentNotifications(db, {
      appointment,
      patient: { nev: patient.nev, taj: patient.taj, email: patient.email, nem: patient.nem },
      timeSlot,
      updatedTimeSlot,
      durationMinutes,
      bookerEmail: auth.email,
    }).catch((err) => {
      logger.error('Unexpected error in sendAppointmentNotifications:', err);
    });

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Hiba történt az időpont foglalásakor');
  }
}
