import { PROSTHESIS_TYPES, budapestToday } from '@/lib/aftercare/model';
import { dentalLayers } from '@/lib/episode-clinical/model';
import { FIXED_TYPES, REMOVABLE_TYPES, lifecycleCategoryForType } from '@/lib/prosthesis-types';
import { emptyLayers, replayStates, type Position } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { addToothComponentFindings } from '@/lib/prosthesis-findings';

export const CLINICAL_PROSTHESIS_TYPES = [...FIXED_TYPES, ...REMOVABLE_TYPES] as const;
export const prosthesisCategory=lifecycleCategoryForType;
export function prosthesisTypeLabel(type:string,specification:Record<string,unknown>={}) {
  return typeof specification.clinicalType==='string'&&specification.clinicalType.trim()
    ? specification.clinicalType : PROSTHESIS_TYPES[type as keyof typeof PROSTHESIS_TYPES]??type;
}
export function suggestedProsthesisLabel(value:{jaw:string;prosthesisType:string;role:string;positions:Position[];specification:Record<string,unknown>}) {
  const jaw=value.jaw==='felso'?'Felső':value.jaw==='also'?'Alsó':'';
  const type=prosthesisTypeLabel(value.prosthesisType,value.specification)||'fogpótlás';
  const teeth=Array.from(new Set(value.positions.map(p=>p.tooth))).sort((a,b)=>a-b);
  const label=`${jaw}${value.role==='provisional'?' ideiglenes':''} ${type}${teeth.length?` · ${teeth.join(', ')}`:''}`.trim();
  return label.length<=160?label:`${label.slice(0,157)}…`;
}
/** Background only: never copy today's status into a historical registration or into its saved command. */
export function registrationBackground(data:Pick<ClinicalWorkspace,'states'|'legacyStates'|'legacyDental'>,day:string) {
  const states=(data.states??[]).filter(s=>s.occurred_on<=day);
  if(states.length){
    const latest=[...states].sort((a,b)=>a.occurred_on.localeCompare(b.occurred_on)).at(-1)!;
    const result=replayStates(states);
    return {layers:result.layers,label:`Dokumentált fogstátusz · ${latest.occurred_on}`,conflicted:result.conflicts.length>0};
  }
  const snapshot=(data.legacyStates??[]).filter(s=>s.effective_date<=day).sort((a,b)=>a.effective_date.localeCompare(b.effective_date)).at(-1);
  if(snapshot)return {layers:addToothComponentFindings({...emptyLayers(),teeth:structuredClone(snapshot.fogak??{})}),label:`Korábbi fogstátusz · ${snapshot.effective_date}`,conflicted:false};
  if(day===budapestToday()&&!(data.states??[]).length&&data.legacyDental){
    return {layers:dentalLayers(data.legacyDental),label:'Megőrzött kartonadatok · dátumuk nem igazolt',conflicted:false};
  }
  return {layers:emptyLayers(),label:'Erre a napra nincs dokumentált fogstátusz',conflicted:false};
}

export const PROSTHESIS_DETAIL_LABELS = {
  madeWhen:'Mikor készült?',madeBy:'Ki / hol készült?',satisfied:'Elégedett vele?',complaint:'Panasz a meglévő fogpótlással',
  material:'Anyag',retention:'Elhorgonyzás',design:'Klinikai leírás',
} as const;
export function prosthesisDetails(specification:Record<string,unknown>={}) {
  return Object.entries(PROSTHESIS_DETAIL_LABELS).flatMap(([key,label])=>{
    const value=specification[key];
    if(key==='satisfied')return typeof value==='boolean'?[{label,value:value?'Igen':'Nem'}]:[];
    return typeof value==='string'&&value.trim()?[{label,value}]:[];
  });
}
