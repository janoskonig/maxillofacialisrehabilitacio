import { z } from 'zod';
import type { PatientEpisode } from '@/lib/types';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';

export const EPISODE_TRIGGER_LABELS:Record<string,string>={recidiva:'Recidíva',fogelvesztes:'Fogelvesztés',potlasvesztes:'Pótlásvesztés',kontrollbol_uj_panasz:'Kontroll során észlelt új panasz',egyeb:'Egyéb'};
export function episodeOverviewHref(patientId:string,episodeId?:string|null,section?:'plan'|'financing'){
  const query=new URLSearchParams();if(episodeId)query.set('episodeId',episodeId);
  return `/patients/${patientId}/episodes${query.size?`?${query}`:''}${section==='financing'?'#finanszirozas':section==='plan'?'#kezelesi-terv':''}`;
}
export function episodeDevices(data:Pick<ClinicalWorkspace,'prostheses'|'episodeLinks'>,episodeId:string){
  const links=(data.episodeLinks??[]).filter(l=>l.episode_id===episodeId);
  return data.prostheses.filter(p=>links.some(l=>l.prosthesis_id===p.id)||p.episode_id===episodeId);
}
export function selectEpisode(episodes:PatientEpisode[],data:Pick<ClinicalWorkspace,'prostheses'|'episodeLinks'>,requested?:string|null){
  if(requested)return episodes.find(e=>e.id===requested)??null;
  return episodes.find(e=>e.status==='open'&&episodeDevices(data,e.id).length>0)??episodes.find(e=>e.status==='open')??episodes[0]??null;
}
const contextFields={chiefComplaint:z.string().trim().min(1,'Az epizód indításának oka szükséges.').max(10000),caseTitle:z.string().trim().max(500).nullable(),triggerType:z.enum(['recidiva','fogelvesztes','potlasvesztes','kontrollbol_uj_panasz','egyeb']).nullable()};
export const episodeContextSchema=z.object({requestKey:z.string().uuid(),expected:z.object({...contextFields,chiefComplaint:z.string().max(10000)}),...contextFields});
export type EpisodeContextCommand=z.infer<typeof episodeContextSchema>;
export type EpisodeContext=Pick<PatientEpisode,'chiefComplaint'|'caseTitle'|'triggerType'>;
export function episodeContext(value:EpisodeContext):EpisodeContext{return{chiefComplaint:value.chiefComplaint??'',caseTitle:value.caseTitle?.trim()||null,triggerType:value.triggerType||null};}
