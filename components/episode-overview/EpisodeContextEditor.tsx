'use client';

import { useEffect,useState } from 'react';
import type { PatientEpisode } from '@/lib/types';
import { episodeContext,episodeContextSchema,EPISODE_TRIGGER_LABELS,type EpisodeContext } from '@/lib/episode-overview';
import { FormErrors,FormField,formInput,primaryButton,secondaryButton } from '@/components/prosthesis-lifecycle/WorkflowForm';

export function EpisodeContextEditor({episode,onSaved,onStateChange}:{episode:PatientEpisode;onSaved:(context:EpisodeContext)=>void;onStateChange:(state:{dirty:boolean;saving:boolean})=>void}){
  const [expected,setExpected]=useState(()=>episodeContext(episode)),[draft,setDraft]=useState(()=>episodeContext(episode));
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID()),[saving,setSaving]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const dirty=JSON.stringify(draft)!==JSON.stringify(expected);
  useEffect(()=>{onStateChange({dirty,saving});},[dirty,saving,onStateChange]);
  useEffect(()=>()=>onStateChange({dirty:false,saving:false}),[onStateChange]);
  function patch(values:Partial<EpisodeContext>){setDraft(d=>({...d,...values}));setRequestKey(crypto.randomUUID());setError('');}
  async function save(){
    if(!dirty||saving)return;
    const parsed=episodeContextSchema.safeParse({...draft,expected,requestKey});
    if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).join(' '));return;}
    setSaving(true);setError('');
    try{
      const response=await fetch(`/api/patients/${episode.patientId}/episodes/${episode.id}/context`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data)});
      const result=await response.json();
      if(!response.ok){
        if(result._errorMeta?.code==='EPISODE_CONTEXT_CONFLICT'&&result._errorMeta.details?.context){setExpected(result._errorMeta.details.context);setConflict(true);onSaved(result._errorMeta.details.context);}
        throw new Error(result.error||'Az epizód alapadatai nem menthetők.');
      }
      setExpected(result.context);setDraft(result.context);setRequestKey(crypto.randomUUID());setConflict(false);onSaved(result.context);
    }catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  return <section aria-label="Epizód alapadatainak szerkesztése" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-950">
    <h3 className="font-semibold">Az epizód indítása</h3>
    <fieldset disabled={saving} className="space-y-4">
      <FormField id="episode-title" label="Epizód megnevezése" optional hint="Rövid, felismerhető cím, például: Felső végleges fogpótlás."><input id="episode-title" className={formInput} maxLength={500} value={draft.caseTitle??''} onChange={e=>patch({caseTitle:e.target.value||null})}/></FormField>
      <FormField id="episode-reason" label="Miért indult ez az epizód?" hint="A konkrét panaszt vagy ellátási szükségletet írd le, például: felső foghiány rehabilitációja vagy eltört lemez javítása."><textarea id="episode-reason" className={formInput} rows={3} maxLength={10000} value={draft.chiefComplaint} onChange={e=>patch({chiefComplaint:e.target.value})}/></FormField>
      <FormField id="episode-trigger" label="Mi váltotta ki az új epizódot?" optional><select id="episode-trigger" className={formInput} value={draft.triggerType??''} onChange={e=>patch({triggerType:(e.target.value||null) as PatientEpisode['triggerType']})}><option value="">Nincs megadva</option>{Object.entries(EPISODE_TRIGGER_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></FormField>
      <p className="text-xs text-slate-500">A pontosítás előtti adatok megmaradnak az előzményekben. Az epizód állapota és a dokumentált kezelések ettől nem változnak.</p>
      {conflict&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">A szerveren rögzített indok: {expected.chiefComplaint||'Nincs megadva'}</p>}
      <FormErrors messages={error?[error]:[]}/>
      <div className="flex flex-wrap gap-3"><button type="button" className={primaryButton} disabled={!dirty||saving} onClick={save}>{saving?'Mentés…':conflict?'Áttekintett alapadatok mentése':'Epizód alapadatainak mentése'}</button>{dirty&&<button type="button" className={secondaryButton} onClick={()=>{setDraft(expected);setError('');setConflict(false);setRequestKey(crypto.randomUUID());}}>Módosítások elvetése</button>}</div>
    </fieldset>
  </section>;
}
