import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Update feedback status
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultság' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { status } = body;

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Érvénytelen status' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    const result = await pool.query(
      `UPDATE feedback 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, status, updated_at`,
      [status, params.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Feedback nem található' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true,
      feedback: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error updating feedback:', error);
    return NextResponse.json(
      { error: 'Hiba történt a feedback frissítésekor' },
      { status: 500 }
    );
  }
}





