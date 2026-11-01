import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { isValidUUID } from '@/lib/validation';
import { reviewCommandSchema } from '@/lib/episode-clinical/model';
import { loadEpisodeClinical,saveEpisodeReview } from '@/lib/episode-clinical/service';
export const dynamic='force-dynamic';
const roles=['admin','fogpótlástanász','beutalo_orvos'] as const;
const valid=(params:Record<string,string>)=>isValidUUID(params.id)&&isValidUUID(params.episodeId);
export const GET=roleHandler([...roles],async(_req,{params})=>{
  if(!valid(params))return NextResponse.json({error:'Érvénytelen beteg- vagy epizódazonosító.'},{status:400});
  return NextResponse.json(await loadEpisodeClinical(params.id,params.episodeId),{headers:{'Cache-Control':'private, no-store'}});
});
export const POST=roleHandler([...roles],async(req,{params,auth})=>{
  if(!valid(params))return NextResponse.json({error:'Érvénytelen beteg- vagy epizódazonosító.'},{status:400});
  const parsed=reviewCommandSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(i=>i.message).join(' ')},{status:400});
  return NextResponse.json(await saveEpisodeReview(params.id,params.episodeId,auth.userId,parsed.data),{headers:{'Cache-Control':'private, no-store'}});
});
