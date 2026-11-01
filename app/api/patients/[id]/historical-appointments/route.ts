import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { isValidUUID } from '@/lib/validation';
import { recordRetrospectiveAppointment,retrospectiveAppointmentOptions,retrospectiveAppointmentSchema } from '@/lib/retrospective-appointments';
export const dynamic='force-dynamic';
const roles=['admin','fogpótlástanász','beutalo_orvos'] as const;
function valid(id:string){if(!isValidUUID(id))throw new HttpError(400,'Érvénytelen betegazonosító');return id;}
export const GET=roleHandler([...roles],async(_req,{params})=>NextResponse.json(await retrospectiveAppointmentOptions(valid(params.id)),{headers:{'Cache-Control':'private, no-store'}}));
export const POST=roleHandler([...roles],async(req,{params,auth})=>{
  const input=retrospectiveAppointmentSchema.safeParse(await req.json().catch(()=>null));
  if(!input.success)throw new HttpError(400,input.error.issues.map(i=>i.message).join('; '));
  return NextResponse.json(await recordRetrospectiveAppointment(valid(params.id),auth,input.data),{status:201});
});
