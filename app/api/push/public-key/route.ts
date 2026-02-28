import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  
  if (!publicKey) {
    logger.error('[Push] VAPID_PUBLIC_KEY not configured in environment variables');
    return NextResponse.json(
      { 
        error: 'VAPID public key not configured',
        message: 'Please run "npm run vapid:generate" and add VAPID_PUBLIC_KEY to your .env file'
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ publicKey });
}
