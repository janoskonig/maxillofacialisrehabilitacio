import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { isValidUUID } from '@/lib/validation';
import { clinicalCommandSchema } from '@/lib/prosthesis-lifecycle/model';
import { executeClinicalCommand, loadClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';

export const dynamic='force-dynamic';
const roles=['admin','fogpótlástanász','beutalo_orvos'] as const;
function valid(id:string) { if (!isValidUUID(id)) throw new HttpError(400,'Érvénytelen betegazonosító'); return id; }
export const GET=roleHandler([...roles],async (_req,{params}) =>
  NextResponse.json(await loadClinicalWorkspace(valid(params.id)),{headers:{'Cache-Control':'private, no-store'}}));
export const POST=roleHandler([...roles],async (req,{params,auth}) => {
  const parsed=clinicalCommandSchema.safeParse(await req.json().catch(()=>null));
  if (!parsed.success) throw new HttpError(400,parsed.error.issues.map(i=>i.message).join('; '));
  return NextResponse.json(await executeClinicalCommand(valid(params.id),auth.userId,parsed.data),{status:201});
});
