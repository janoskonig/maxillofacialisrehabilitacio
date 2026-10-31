import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { isValidUUID } from '@/lib/validation';
import { queueUpdateSchema } from '@/lib/aftercare/model';
import { updateSchedulingRequest } from '@/lib/aftercare/service';

export const dynamic = 'force-dynamic';
export const PATCH = roleHandler(['admin', 'fogpótlástanász', 'beutalo_orvos'], async (req, { params, auth }) => {
  if (!isValidUUID(params.id)) throw new HttpError(400, 'Érvénytelen visszarendelés');
  const parsed = queueUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
  return NextResponse.json(await updateSchedulingRequest(params.id, auth.userId, parsed.data));
});
