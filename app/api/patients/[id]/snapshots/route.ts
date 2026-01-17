import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { withCorrelation } from '@/lib/api/withCorrelation';
import { handleApiError } from '@/lib/api-error-handler';

// GET /api/patients/[id]/snapshots - List snapshots for a patient
export const GET = withCorrelation(async (req: NextRequest, { correlationId }) => {
  try {
    // Authorization: require authenticated user
    const auth = await verifyAuth(req);
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

    // Extract patient ID from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const patientIdIndex = pathParts.indexOf('patients');
    const patientId = pathParts[patientIdIndex + 1];

    if (!patientId) {
      const response = NextResponse.json(
        {
          error: {
            name: 'BadRequestError',
            status: 400,
            message: 'Beteg ID hiányzik',
            correlationId,
          },
        },
        { status: 400 }
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    const pool = getDbPool();

    // Verify patient exists and user has access
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

    // Role-based access: viewer can only view, editor/admin can view and edit
    // For snapshots, all authenticated users can view (read-only)
    // (Additional restrictions can be added if needed)

    // Fetch snapshots (ordered by created_at DESC)
    const snapshotsResult = await pool.query(
      `SELECT 
        id,
        created_at as "createdAt",
        created_by_user_id as "createdByUserId",
        source,
        -- Get user email for display (optional, can be null if user deleted)
        (SELECT email FROM users WHERE id = created_by_user_id) as "createdByEmail"
      FROM patient_snapshots
      WHERE patient_id = $1
      ORDER BY created_at DESC`,
      [patientId]
    );

    const response = NextResponse.json(
      {
        snapshots: snapshotsResult.rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          createdByUserId: row.createdByUserId,
          createdByEmail: row.createdByEmail, // For display, can be null
          source: row.source,
        })),
      },
      { status: 200 }
    );
    response.headers.set('x-correlation-id', correlationId);
    return response;
  } catch (error: any) {
    console.error('Hiba a snapshotok lekérdezésekor:', error);
    return handleApiError(error, 'Hiba történt a snapshotok lekérdezésekor', correlationId);
  }
});
