import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

// GET /api/patients/[id]/snapshots/[snapshotId] - Get snapshot detail
export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth, params, correlationId }) => {
  const patientId = params.id;
  const snapshotId = params.snapshotId;

  const pool = getDbPool();

  // Verify patient exists
  const patientResult = await pool.query(
    `SELECT id FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    const response = NextResponse.json(
      { error: 'Beteg nem található' },
      { status: 404 }
    );
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  // Fetch snapshot detail
  const snapshotResult = await pool.query(
    `SELECT 
      id,
      snapshot_data as "snapshotData",
      created_at as "createdAt",
      created_by_user_id as "createdByUserId",
      source,
      -- Get user email for display
      (SELECT email FROM users WHERE id = created_by_user_id) as "createdByEmail"
    FROM patient_snapshots
    WHERE id = $1 AND patient_id = $2`,
    [snapshotId, patientId]
  );

  if (snapshotResult.rows.length === 0) {
    const response = NextResponse.json(
      { error: 'Snapshot nem található' },
      { status: 404 }
    );
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  const snapshot = snapshotResult.rows[0];

  const response = NextResponse.json(
    {
      snapshot: {
        id: snapshot.id,
        snapshotData: snapshot.snapshotData, // Full patient object
        createdAt: snapshot.createdAt,
        createdByUserId: snapshot.createdByUserId,
        createdByEmail: snapshot.createdByEmail,
        source: snapshot.source,
      },
    },
    { status: 200 }
  );
  response.headers.set('x-correlation-id', correlationId);
  return response;
});
