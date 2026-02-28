import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

/**
 * Get patient change history
 * GET /api/patients/[id]/changes
 */
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params }) => {
  const pool = getDbPool();
  const role = auth.role;
  const userEmail = auth.email;
  const patientId = params.id;

  // Verify patient exists and user has access (same logic as GET /api/patients/[id])
  const patientResult = await pool.query(
      `SELECT 
        p.id,
        p.nev,
        r.beutalo_intezmeny as "beutaloIntezmeny",
        t.kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto"
      FROM patients p
      LEFT JOIN patient_referral r ON r.patient_id = p.id
      LEFT JOIN patient_treatment_plans t ON t.patient_id = p.id
      WHERE p.id = $1`,
      [patientId]
  );

  if (patientResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
  }

  const patient = patientResult.rows[0];

  // Role-based access control (same as patient view)
  if (role === 'technikus') {
    // Technikus: csak azokat a betegeket látja, akikhez epitézist rendeltek
    const hasEpitesis = patient.kezelesiTervArcotErinto &&
      Array.isArray(patient.kezelesiTervArcotErinto) &&
      patient.kezelesiTervArcotErinto.length > 0;
    if (!hasEpitesis) {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ehhez a beteghez' },
        { status: 403 }
      );
    }
  } else if (role === 'sebészorvos' && userEmail) {
    // Sebészorvos: csak azokat a betegeket látja, akik az ő intézményéből származnak
    const userResult = await pool.query(
      `SELECT intezmeny FROM users WHERE email = $1`,
      [userEmail]
    );

    if (userResult.rows.length > 0 && userResult.rows[0].intezmeny) {
      const userInstitution = userResult.rows[0].intezmeny;
      if (patient.beutaloIntezmeny !== userInstitution) {
        return NextResponse.json(
          { error: 'Nincs jogosultsága ehhez a beteghez' },
          { status: 403 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ehhez a beteghez' },
        { status: 403 }
      );
    }
  }
  // fogpótlástanász, admin, editor, viewer: mindent látnak (nincs szűrés)

  // Get query parameters for filtering
  const { searchParams } = new URL(req.url);
  const fieldName = searchParams.get('field_name');
  const changedBy = searchParams.get('changed_by');
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const limit = parseInt(searchParams.get('limit') || '1000', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  // Build query with filters
  let query = `
      SELECT 
        id,
        patient_id as "patientId",
        field_name as "fieldName",
        field_display_name as "fieldDisplayName",
        old_value as "oldValue",
        new_value as "newValue",
        changed_by as "changedBy",
        changed_at as "changedAt",
        ip_address as "ipAddress"
      FROM patient_changes
      WHERE patient_id = $1
  `;

  const queryParams: any[] = [patientId];
  let paramIndex = 2;

  if (fieldName) {
    query += ` AND field_name = $${paramIndex}`;
    queryParams.push(fieldName);
    paramIndex++;
  }

  if (changedBy) {
    query += ` AND changed_by = $${paramIndex}`;
    queryParams.push(changedBy);
    paramIndex++;
  }

  if (startDate) {
    query += ` AND changed_at >= $${paramIndex}`;
    queryParams.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND changed_at <= $${paramIndex}`;
    queryParams.push(endDate);
    paramIndex++;
  }

  // Order by most recent first
  query += ` ORDER BY changed_at DESC`;

  // Get total count for pagination
  const countQuery = query.replace(
      /SELECT[\s\S]*FROM/,
      'SELECT COUNT(*) as total FROM'
  ).replace(/ORDER BY[\s\S]*$/, '');

  const countResult = await pool.query(countQuery, queryParams);
  const total = parseInt(countResult.rows[0].total, 10);

  // Add limit and offset
  query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  queryParams.push(limit, offset);

  const result = await pool.query(query, queryParams);

  return NextResponse.json({
    changes: result.rows,
    total,
    limit,
    offset,
  });
});

