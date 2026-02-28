import { NextRequest, NextResponse } from 'next/server';
import { clearPatientPortalSession } from '@/lib/patient-portal-server';
import { logger } from '@/lib/logger';

/**
 * Logout from patient portal
 * POST /api/patient-portal/auth/logout
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await clearPatientPortalSession();

    return NextResponse.json({
      success: true,
      message: 'Sikeresen kijelentkezett',
    });
  } catch (error) {
    logger.error('Error logging out:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kijelentkezéskor' },
      { status: 500 }
    );
  }
}








