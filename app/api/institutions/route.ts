import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

// Intézmények listázása a users táblából
export async function GET(request: NextRequest) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/institutions/route.ts:5',message:'GET /api/institutions entry',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const pool = getDbPool();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/institutions/route.ts:9',message:'Pool obtained, before query',data:{poolTotalCount:pool.totalCount,poolIdleCount:pool.idleCount,poolWaitingCount:pool.waitingCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // Lekérjük az egyedi intézményeket a users táblából
    const result = await pool.query(
      `SELECT DISTINCT intezmeny 
       FROM users 
       WHERE intezmeny IS NOT NULL AND intezmeny != ''
       ORDER BY intezmeny ASC`
    );
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/institutions/route.ts:18',message:'Query completed, after query',data:{poolTotalCount:pool.totalCount,poolIdleCount:pool.idleCount,poolWaitingCount:pool.waitingCount,institutionsCount:result.rows.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    const institutions = result.rows.map(row => row.intezmeny);

    return NextResponse.json({ institutions });
  } catch (error: any) {
    // #region agent log
    const pool = getDbPool();
    fetch('http://127.0.0.1:7242/ingest/c070e5b2-a34e-45de-ad79-947d2863632f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/institutions/route.ts:25',message:'Error in GET /api/institutions',data:{error:error.message,code:error.code,poolTotalCount:pool?.totalCount,poolIdleCount:pool?.idleCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('Error fetching institutions:', error);
    return NextResponse.json(
      { error: 'Hiba történt az intézmények lekérdezésekor' },
      { status: 500 }
    );
  }
}




