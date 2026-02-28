import { NextRequest, NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getUnmappedStepCodes } from '@/lib/step-catalog-cache';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const items = await getUnmappedStepCodes();
  return NextResponse.json({ items });
});
