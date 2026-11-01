import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { isValidUUID } from '@/lib/validation';
import { createClinicalPackage, packageSchema } from '@/lib/prosthesis-lifecycle/packages';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const roles=['admin','fogpótlástanász','beutalo_orvos'] as const;
export const POST=roleHandler([...roles],async(req,{params,auth})=>{
  if (!isValidUUID(params.id)) throw new HttpError(400,'Érvénytelen betegazonosító');
  const input=packageSchema.safeParse(await req.json().catch(()=>null));
  if (!input.success) throw new HttpError(400,'Epizódot, jóváhagyott tervet, státuszt és fogpótlást válasszon');
  return NextResponse.json(await createClinicalPackage(params.id,auth.userId,input.data),{status:201});
});
export const GET=roleHandler([...roles],async(req,{params})=>{
  const id=req.nextUrl.searchParams.get('id');
  if (!isValidUUID(params.id) || !id || !isValidUUID(id)) throw new HttpError(400,'Érvénytelen csomagazonosító');
  const r=await getDbPool().query('SELECT archive,sha256 FROM clinical_document_packages WHERE patient_id=$1 AND id=$2',[params.id,id]);
  if (!r.rows.length) throw new HttpError(404,'Dokumentumcsomag nem található');
  return new NextResponse(new Uint8Array(r.rows[0].archive),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="meltanyossagi_${id}.zip"`,'Cache-Control':'private, no-store','X-Content-SHA256':r.rows[0].sha256}});
});
