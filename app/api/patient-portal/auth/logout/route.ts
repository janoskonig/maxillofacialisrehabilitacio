import { NextRequest, NextResponse } from 'next/server';
import { clearPatientPortalSession } from '@/lib/patient-portal-server';

/**
 * Logout from patient portal
 * POST /api/patient-portal/auth/logout
 */
export async function POST(request: NextRequest) {
  try {
    await clearPatientPortalSession();

    return NextResponse.json({
      success: true,
      message: 'Sikeresen kijelentkezett',
    });
  } catch (error) {
    console.error('Error logging out:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kijelentkezéskor' },
      { status: 500 }
    );
  }
}


