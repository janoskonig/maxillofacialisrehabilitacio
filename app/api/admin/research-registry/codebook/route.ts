import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { generateCodebook } from '@/lib/research-registry/codebook';

export const dynamic = 'force-dynamic';

/** GET /api/admin/research-registry/codebook — publication-grade codebook MVP */
export const GET = roleHandler(['admin', 'fogpótlástanász'], async () => {
  const codebook = generateCodebook();
  return NextResponse.json(codebook);
});
