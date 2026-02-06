import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';

// Helper to get correlation ID from request
function getCorrelationIdFromRequest(request: NextRequest): string {
  return request.headers.get('x-correlation-id')?.toLowerCase() || 
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 
     'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
       const r = (Math.random() * 16) | 0;
       const v = c === 'x' ? r : (r & 0x3) | 0x8;
       return v.toString(16);
     }));
}

// GET /api/patients/[id]/snapshots/[snapshotId] - Get snapshot detail
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; snapshotId: string } }
) {
  const correlationId = getCorrelationIdFromRequest(request);

  try {
    // Authorization: require authenticated user
    const auth = await verifyAuth(request);
    if (!auth) {
      const response = NextResponse.json(
        {
          error: {
            name: 'UnauthorizedError',
            status: 401,
            message: 'Bejelentkezés szükséges',
            correlationId,
          },
        },
        { status: 401 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

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
        {
          error: {
            name: 'NotFoundError',
            status: 404,
            message: 'Beteg nem található',
            correlationId,
          },
        },
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
        {
          error: {
            name: 'NotFoundError',
            status: 404,
            message: 'Snapshot nem található',
            correlationId,
          },
        },
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
  } catch (error: any) {
    console.error('Hiba a snapshot lekérdezésekor:', error);
    return handleApiError(error, 'Hiba történt a snapshot lekérdezésekor', correlationId);
  }
}
