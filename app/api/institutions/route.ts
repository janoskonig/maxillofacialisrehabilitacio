import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';

// Intézmények listázása a users táblából
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const pool = getDbPool();
    
    // Lekérjük az egyedi intézményeket a users táblából
    const result = await pool.query(
      `SELECT DISTINCT intezmeny 
       FROM users 
       WHERE intezmeny IS NOT NULL AND intezmeny != ''
       ORDER BY intezmeny ASC`
    );

    const institutions = result.rows.map(row => row.intezmeny);

    return NextResponse.json({ institutions });
  } catch (error) {
    logger.error('Error fetching institutions:', error);
    return NextResponse.json(
      { error: 'Hiba történt az intézmények lekérdezésekor' },
      { status: 500 }
    );
  }
}




