import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { generateCodebook } from '@/lib/tmk/codebook';

export const dynamic = 'force-dynamic';

/** GET /api/admin/tmk/codebook — publication-grade codebook MVP */
export const GET = roleHandler(['admin', 'fogpótlástanász'], async () => {
  const codebook = generateCodebook();
  return NextResponse.json(codebook);
});
