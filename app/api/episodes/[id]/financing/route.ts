import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { isValidUUID } from '@/lib/validation';
import { probeColumnExists } from '@/lib/schema-probe';
import { financingCommandSchema } from '@/lib/episode-financing/model';
import { loadEpisodeFinancing,saveEpisodeFinancing } from '@/lib/episode-financing/service';

export const dynamic='force-dynamic';
async function context(episodeId:string){
  const pool=getDbPool();
  if(!await probeColumnExists(pool,'episode_financing_events','effective_on'))return null;
  return (await pool.query(`SELECT e.patient_id,(SELECT id FROM prosthesis_plan_versions WHERE episode_id=e.id ORDER BY version DESC LIMIT 1) AS plan_id
    FROM patient_episodes e WHERE e.id=$1`,[episodeId])).rows[0]??false;
}
export const GET=authedHandler(async(_req,{params})=>{
  if(!isValidUUID(params.id))return NextResponse.json({error:'Érvénytelen epizódazonosító.'},{status:400});
  const ctx=await context(params.id);
  if(ctx===null)return NextResponse.json({error:'A finanszírozáskezeléshez adatbázis-frissítés szükséges.'},{status:503});
  if(!ctx)return NextResponse.json({error:'Epizód nem található.'},{status:404});
  return NextResponse.json({financing:await loadEpisodeFinancing(getDbPool(),params.id,ctx.plan_id)},{headers:{'Cache-Control':'private, no-store'}});
});
export const POST=roleHandler(['admin','beutalo_orvos','fogpótlástanász'],async(req,{params,auth})=>{
  if(!isValidUUID(params.id))return NextResponse.json({error:'Érvénytelen epizódazonosító.'},{status:400});
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Érvényes finanszírozási adatok szükségesek.'},{status:400});
  if(body.episodeId&&body.episodeId!==params.id)return NextResponse.json({error:'Az epizódazonosítók eltérnek.'},{status:400});
  const command=financingCommandSchema.parse({...body,action:'financing',episodeId:params.id});
  const ctx=await context(params.id);
  if(ctx===null)return NextResponse.json({error:'A finanszírozáskezeléshez adatbázis-frissítés szükséges.'},{status:503});
  if(!ctx)return NextResponse.json({error:'Epizód nem található.'},{status:404});
  const saved=await saveEpisodeFinancing(ctx.patient_id,auth.userId,command);
  const latest=await context(params.id);
  return NextResponse.json({...saved,financing:await loadEpisodeFinancing(getDbPool(),params.id,latest&&latest.plan_id)},{headers:{'Cache-Control':'private, no-store'}});
});
