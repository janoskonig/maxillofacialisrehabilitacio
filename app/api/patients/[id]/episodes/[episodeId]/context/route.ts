import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { isValidUUID } from '@/lib/validation';
import { episodeContextSchema } from '@/lib/episode-overview';
import { saveEpisodeContext } from '@/lib/episode-context';
export const dynamic='force-dynamic';
export const PATCH=roleHandler(['admin','fogpótlástanász','beutalo_orvos'],async(req,{params,auth})=>{
  if(!isValidUUID(params.id)||!isValidUUID(params.episodeId))return NextResponse.json({error:'Érvénytelen beteg- vagy epizódazonosító.'},{status:400});
  const parsed=episodeContextSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(i=>i.message).join(' ')},{status:400});
  return NextResponse.json(await saveEpisodeContext(params.id,params.episodeId,auth.userId,parsed.data),{headers:{'Cache-Control':'private, no-store'}});
});
