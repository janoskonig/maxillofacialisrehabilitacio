'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Banknote, Building2, FileCheck2, History, Paperclip, Plus, Upload, Wrench } from 'lucide-react';
import { budapestToday } from '@/lib/aftercare/model';
import { COST_COMPONENTS, costBreakdownSchema, costTotals, financingCommandSchema, FINANCING_MODES, FINANCING_STATUSES, financingSummary, formatFinancingAmount, type CostBreakdown, type EpisodeFinancing, type FinancingEvent } from '@/lib/episode-financing/model';
import type { EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
import { FormErrors, formInput, primaryButton, secondaryButton } from './WorkflowForm';

type CostKey = keyof typeof COST_COMPONENTS;
type Draft = { requestKey:string; planVersionId:string|null; occurredOn:string; effectiveOn:string; occurredAt:string|null; precision:'day'|'exact'; source:string; reason:string; mode:keyof typeof FINANCING_MODES; status:keyof typeof FINANCING_STATUSES; currency:'HUF'|'EUR'; payer:string; decisionReference:string; documentIds:string[]; costs:CostBreakdown; correctsId?:string };
const icons = { laboratory:Wrench, clinical:Building2, implant:Banknote };
const emptyCost = (enabled=true) => ({enabled,totalAmount:null,fundedAmount:null,patientAmount:null,quoteDocumentIds:[]} as CostBreakdown['laboratory']);
const emptyCosts = ():CostBreakdown => ({laboratory:emptyCost(),clinical:{...emptyCost(),neakCategory:null},implant:emptyCost(false)});
const amountLabels = {totalAmount:'Költség',fundedAmount:'Támogatás',patientAmount:'Beteg fizeti'} as const;

export function EpisodeFinancingPanel({plan,canEdit,disabled=false,planUnsaved=false,onChanged,onStateChange}:{
  plan:EpisodeTreatmentPlanRecord;canEdit:boolean;disabled?:boolean;planUnsaved?:boolean;onChanged:(data:EpisodeFinancing)=>void;
  onStateChange?:(state:{dirty:boolean;saving:boolean})=>void;
}) {
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[uploading,setUploading]=useState<CostKey|null>(null),[errors,setErrors]=useState<string[]>([]),[conflict,setConflict]=useState(false),[followCurrent,setFollowCurrent]=useState(true);
  const [uploaded,setUploaded]=useState<Array<{id:string;filename:string}>>([]);
  const documents=useMemo(()=>Array.from(new Map([...(plan.documents??[]),...uploaded].map(d=>[d.id,d])).values()),[plan.documents,uploaded]);
  const current=plan.financing?.current,event=current?.event;
  useEffect(()=>{onStateChange?.({dirty:!!draft,saving:busy||!!uploading});},[draft,busy,uploading,onStateChange]);
  useEffect(()=>()=>onStateChange?.({dirty:false,saving:false}),[onStateChange]);
  useEffect(()=>{
    if(followCurrent)setDraft(d=>d&&d.planVersionId!==(plan.clinicalPlan?.id??null)?{...d,planVersionId:plan.clinicalPlan?.id??null,status:'pending',requestKey:crypto.randomUUID()}:d);
  },[plan.clinicalPlan?.id,followCurrent]);
  function open(previous?:FinancingEvent){
    const e=previous??event;
    setFollowCurrent(!previous);setErrors([]);setConflict(false);
    setDraft({requestKey:crypto.randomUUID(),planVersionId:previous?previous.plan_version_id:plan.clinicalPlan?.id??null,
      occurredOn:previous?.occurred_on??budapestToday(),effectiveOn:previous?.effective_on??budapestToday(),occurredAt:previous?.occurred_at??null,precision:previous?.time_precision??'day',
      source:previous?.source??'Saját rögzítés',reason:previous?'Korábbi bejegyzés pontosítása':'Költségek és árajánlatok rögzítése',mode:e?.mode??'unknown',status:previous?.status??'pending',currency:e?.currency??'HUF',payer:e?.payer??'',
      decisionReference:previous?.decision_reference??'',documentIds:e?.document_ids??[],costs:structuredClone(e?.cost_breakdown??emptyCosts()),...(previous?{correctsId:previous.id}:{})});
  }
  function patch(update:Partial<Draft>){setDraft(d=>d?{...d,...update,requestKey:crypto.randomUUID()}:d);setErrors([]);}
  function costPatch(key:CostKey,update:Partial<CostBreakdown['clinical']>){
    if(!draft)return;
    const item={...draft.costs[key],...update};
    if(key==='clinical'&&'neakCategory' in item&&item.neakCategory==='04'){item.fundedAmount='0';item.patientAmount=item.totalAmount;}
    patch({costs:{...draft.costs,[key]:item}});
  }
  async function upload(key:CostKey,file:File){
    if(!plan.patientId){setErrors(['A feltöltéshez a beteg azonosítója szükséges.']);return;}
    setUploading(key);setErrors([]);
    try{
      const body=new FormData();body.append('file',file);body.append('description',`${COST_COMPONENTS[key]} · árajánlat`);body.append('tags',JSON.stringify(['árajánlat',`epizód:${plan.episodeId}`,`finanszírozás:${key}`]));
      const response=await fetch(`/api/patients/${plan.patientId}/documents`,{method:'POST',body});const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Az árajánlat nem tölthető fel.');
      setUploaded(d=>[...d,result.document]);
      setDraft(d=>d?{...d,requestKey:crypto.randomUUID(),costs:{...d.costs,[key]:{...d.costs[key],quoteDocumentIds:Array.from(new Set([...d.costs[key].quoteDocumentIds,result.document.id]))}}}:d);
    }catch(e){setErrors([(e as Error).message]);}finally{setUploading(null);}
  }
  async function submit(e:FormEvent){
    e.preventDefault();if(!draft||busy||uploading||disabled)return;
    if(planUnsaved&&draft.status==='approved'){setErrors(['Mentsd a kezelési tervet, majd ellenőrizd az ahhoz tartozó finanszírozást.']);return;}
    const costs=costBreakdownSchema.safeParse(draft.costs);
    if(!costs.success){setErrors(costs.error.issues.map(i=>i.message));return;}
    const input={...draft,action:'financing',episodeId:plan.episodeId,expectedVersion:plan.financing?.revision??0,costBreakdown:costs.data,...costTotals(costs.data)};
    const parsed=financingCommandSchema.safeParse(input);
    if(!parsed.success){setErrors(parsed.error.issues.map(i=>i.message));return;}
    setBusy(true);setErrors([]);
    try{
      const response=await fetch(`/api/episodes/${plan.episodeId}/financing`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data)});const result=await response.json();
      if(!response.ok){
        if(result._errorMeta?.code==='FINANCING_CONFLICT'){const fresh=await fetch(`/api/episodes/${plan.episodeId}/financing`,{cache:'no-store'});if(fresh.ok)onChanged((await fresh.json()).financing);setConflict(true);}
        throw new Error(result.error||'A finanszírozás nem menthető.');
      }
      onChanged(result.financing);setDraft(null);setConflict(false);
    }catch(e){setErrors([(e as Error).message]);}finally{setBusy(false);}
  }
  const costs=draft?.costs??event?.cost_breakdown;
  const parsedCosts=costs?costBreakdownSchema.safeParse(costs):null;
  const totals=parsedCosts?.success?costTotals(parsedCosts.data):null;
  return <section id="finanszirozas" aria-label="Az epizód finanszírozása" className="scroll-mt-24 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-950">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-lg font-semibold"><Banknote className="h-5 w-5"/>Finanszírozás és árajánlatok</h3><p className="mt-1 text-sm text-slate-500">Három költségcsoport, külön összeggel és csatolt árajánlattal.</p><p className="mt-1 text-sm">{financingSummary(current)}</p></div>
      {canEdit&&!draft&&<button type="button" disabled={disabled} className={primaryButton} onClick={()=>open()}><Plus className="h-4 w-4"/>{event?'Finanszírozás módosítása':'Finanszírozás megadása'}</button>}
    </div>
    {current?.requiresReview&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">A terv megváltozott. Az új tervhez a finanszírozást is ellenőrizd.</p>}
    {event&&!event.cost_breakdown&&<div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900"><strong>Korábbi, összesített finanszírozás</strong><p>Teljes összeg: {formatFinancingAmount(event.total_amount,event.currency)} · beteg terhe: {formatFinancingAmount(event.patient_amount,event.currency)}</p><p className="mt-1 text-xs text-slate-500">A három költségcsoport szerinti bontás még nincs rögzítve. A korábbi bejegyzés megmarad.</p></div>}
    <form onSubmit={submit} aria-label="Finanszírozási változás rögzítése" noValidate>
      <fieldset disabled={disabled||busy||!!uploading} className="min-w-0 space-y-4">
        <div className="grid min-w-0 items-start gap-3 lg:grid-cols-3">{(Object.keys(COST_COMPONENTS) as CostKey[]).map((key,index)=>{
          const item=costs?.[key],Icon=icons[key],enabled=item?.enabled??false;
          const paid=key==='clinical'&&costs?.clinical.neakCategory==='04';
          return <section key={key} aria-label={COST_COMPONENTS[key]} className={`min-w-0 rounded-2xl border p-3 ${enabled?'border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/20':'border-slate-200 dark:border-slate-700'}`}>
            <div className="mb-3 flex items-center gap-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100"><Icon className="h-4 w-4"/></span><h4 className="text-sm font-semibold">{index+1}. {COST_COMPONENTS[key]}</h4></div>
            {draft?<label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>costPatch(key,{enabled:e.target.checked})}/>Van ilyen költség</label>:<p className="mb-3 text-xs text-slate-500">{item?enabled?'Rögzített költségcsoport':'Nem merül fel':'Még nincs rögzítve'}</p>}
            {enabled&&<div className="space-y-3">
              {key==='clinical'&&(draft?<div><p className="mb-2 text-xs font-medium">NEAK térítési kategória</p><div className="grid gap-2"><button type="button" aria-pressed={paid} className={`rounded-xl border p-2.5 text-left text-sm ${paid?'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100':'border-slate-300 dark:border-slate-700'}`} onClick={()=>costPatch('clinical',{neakCategory:'04'})}>04 · Fizetős ellátás</button>{paid?<button type="button" className="text-left text-xs underline" onClick={()=>costPatch('clinical',{neakCategory:null})}>Másik kategória megadása</button>:<label className="text-xs">Más térítési kategória<input aria-label="NEAK térítési kategória" className={`${formInput} mt-1`} inputMode="numeric" maxLength={2} placeholder="Kétjegyű kód" value={costs?.clinical.neakCategory??''} onChange={e=>costPatch('clinical',{neakCategory:e.target.value||null})}/></label>}</div></div>:<p className="text-sm font-semibold">Kategória: {costs?.clinical.neakCategory??'Nincs megadva'}{paid?' · fizetős':''}</p>)}
              {draft?<div className="space-y-2">{(Object.keys(amountLabels) as Array<keyof typeof amountLabels>).map(field=><label key={field} className="block text-xs">{amountLabels[field]} ({draft.currency})<input className={`${formInput} mt-1`} aria-label={`${COST_COMPONENTS[key]}: ${amountLabels[field]}`} inputMode="decimal" placeholder="Még nem ismert" value={item?.[field]??''} readOnly={paid&&field!=='totalAmount'} onChange={e=>costPatch(key,{[field]:e.target.value||null})}/></label>)}
                {!paid&&<div className="flex flex-wrap gap-2 text-xs"><button type="button" className="rounded-lg border px-2 py-1.5" onClick={()=>costPatch(key,{fundedAmount:'0',patientAmount:item?.totalAmount??null})}>Beteg fizeti</button><button type="button" className="rounded-lg border px-2 py-1.5" onClick={()=>costPatch(key,{fundedAmount:item?.totalAmount??null,patientAmount:'0'})}>Teljes támogatás</button></div>}
              </div>:<><p className="text-xl font-semibold">{formatFinancingAmount(item?.totalAmount??null,event?.currency??'HUF')}</p><p className="text-sm">Beteg fizeti: {formatFinancingAmount(item?.patientAmount??null,event?.currency??'HUF')}</p></>}
              <div className="border-t pt-3 dark:border-slate-700"><p className={`flex items-center gap-1.5 text-xs font-semibold ${item?.quoteDocumentIds.length?'text-teal-700 dark:text-teal-300':'text-amber-700 dark:text-amber-300'}`}><FileCheck2 className="h-4 w-4"/>{item?.quoteDocumentIds.length?`${item.quoteDocumentIds.length} csatolt árajánlat`:'Árajánlat szükséges'}</p>
                {item?.quoteDocumentIds.map(id=><a key={id} href={`/api/patients/${plan.patientId}/documents/${id}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 break-all text-xs underline"><Paperclip className="h-3 w-3 shrink-0"/>{documents.find(d=>d.id===id)?.filename??'Csatolt árajánlat'}</a>)}
                {draft&&<><label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm"><Upload className="h-4 w-4"/>{uploading===key?'Feltöltés…':'Árajánlat feltöltése'}<input type="file" className="sr-only" aria-label={`${COST_COMPONENTS[key]}: Árajánlat feltöltése`} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(key,file);e.target.value='';}}/></label>
                  {!!documents.length&&<details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Meglévő dokumentum csatolása</summary><div className="mt-2 space-y-2">{documents.map(doc=><label key={doc.id} className="flex items-start gap-2 break-all"><input type="checkbox" checked={item?.quoteDocumentIds.includes(doc.id)??false} onChange={e=>costPatch(key,{quoteDocumentIds:e.target.checked?[...(item?.quoteDocumentIds??[]),doc.id]:item?.quoteDocumentIds.filter(id=>id!==doc.id)??[]})}/>{doc.filename}</label>)}</div></details>}
                </>}
              </div>
            </div>}
          </section>;
        })}</div>
        {totals&&<div className="grid gap-2 rounded-xl bg-slate-100 p-3 sm:grid-cols-3 dark:bg-slate-900">{(Object.keys(amountLabels) as Array<keyof typeof amountLabels>).map(key=><div key={key}><p className="text-xs text-slate-500">Összesen · {amountLabels[key]}</p><p className="mt-1 font-semibold">{formatFinancingAmount(totals[key],draft?.currency??event?.currency??'HUF')}</p></div>)}</div>}
        {draft&&<>
          <fieldset className="min-w-0"><legend className="mb-2 text-sm font-semibold">Finanszírozás módja</legend><div className="flex flex-wrap gap-2">{Object.entries(FINANCING_MODES).filter(([id])=>id!=='unknown').map(([id,label])=><label key={id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${draft.mode===id?'border-blue-600 bg-blue-50 dark:bg-blue-950':'border-slate-300 dark:border-slate-700'}`}><input type="radio" name="financing-mode" checked={draft.mode===id} onChange={()=>patch({mode:id as Draft['mode']})}/>{label}</label>)}</div></fieldset>
          <fieldset className="min-w-0"><legend className="mb-2 text-sm font-semibold">Állapot</legend><div className="grid gap-2 sm:grid-cols-3">{(['pending','approved','rejected'] as const).map(status=><label key={status} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${draft.status===status?'border-teal-600 bg-teal-50 dark:bg-teal-950':'border-slate-300 dark:border-slate-700'}`}><input type="radio" name="finance-status" checked={draft.status===status} onChange={()=>patch({status})}/>{status==='pending'?'Előkészítés':status==='approved'?'Jóváhagyva':'Elutasítva'}</label>)}</div></fieldset>
          <p className="text-xs text-slate-500">Előkészítés közben a hiányzó összegek és árajánlatok később is pótolhatók. Jóváhagyáshoz minden érintett költségcsoporthoz árajánlat szükséges.</p>
          <details className="rounded-xl border p-3 text-sm dark:border-slate-700"><summary className="cursor-pointer font-medium">Dátum, forrás és korábbi tervváltozat</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>Döntés napja<input type="date" max={budapestToday()} className={`${formInput} mt-1`} value={draft.occurredOn} onChange={e=>patch({occurredOn:e.target.value,...(draft.effectiveOn===draft.occurredOn?{effectiveOn:e.target.value}:{})})}/></label>
            <label>Érvényesség kezdete<input type="date" className={`${formInput} mt-1`} value={draft.effectiveOn} onChange={e=>patch({effectiveOn:e.target.value})}/></label>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={draft.precision==='exact'} onChange={e=>patch({precision:e.target.checked?'exact':'day',occurredAt:null})}/>A döntés pontos időpontját is rögzítem</label>
            {draft.precision==='exact'&&<label>Döntés pontos időpontja<input type="datetime-local" className={`${formInput} mt-1`} value={draft.occurredAt?new Date(new Date(draft.occurredAt).getTime()-new Date(draft.occurredAt).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>patch({occurredAt:e.target.value?new Date(e.target.value).toISOString():null})}/></label>}
            <label>Pénznem<select className={`${formInput} mt-1`} value={draft.currency} onChange={e=>patch({currency:e.target.value as Draft['currency']})}><option value="HUF">HUF</option><option value="EUR">EUR</option></select></label>
            <label>Finanszírozó neve<input className={`${formInput} mt-1`} value={draft.payer} onChange={e=>patch({payer:e.target.value})}/></label>
            <label>Információ forrása<input className={`${formInput} mt-1`} value={draft.source} onChange={e=>patch({source:e.target.value})}/></label>
            <label>Határozat hivatkozása<input className={`${formInput} mt-1`} value={draft.decisionReference} onChange={e=>patch({decisionReference:e.target.value})}/></label>
            <label className="sm:col-span-2">Rögzítés vagy változás oka<input className={`${formInput} mt-1`} value={draft.reason} onChange={e=>patch({reason:e.target.value})}/></label>
            <label className="flex gap-2 sm:col-span-2"><input type="checkbox" checked={followCurrent} onChange={e=>{setFollowCurrent(e.target.checked);if(e.target.checked)patch({planVersionId:plan.clinicalPlan?.id??null,status:'pending'});}}/>Az aktuálisan mentett tervhez kapcsolom</label>
            {!followCurrent&&<label className="sm:col-span-2">Tervváltozat<select className={`${formInput} mt-1`} value={draft.planVersionId??''} onChange={e=>patch({planVersionId:e.target.value||null,status:'pending'})}><option value="">Epizódszintű előkészítés</option>{plan.history?.map(p=><option key={p.id} value={p.id}>{p.version}. változat · {p.description}</option>)}</select></label>}
            <button type="button" className="text-left text-sm underline" onClick={()=>patch({status:'withdrawn'})}>Korábbi finanszírozás visszavonása</button>
          </div></details>
          {draft.status==='withdrawn'&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">A korábbi finanszírozás visszavonását rögzíted.</p>}
          <FormErrors messages={errors}/>
          <div className="flex flex-wrap gap-3"><button type="submit" className={primaryButton}>{busy?'Mentés…':conflict?'Áttekintett adatok mentése':'Finanszírozás mentése'}</button><button type="button" className={secondaryButton} onClick={()=>setDraft(null)}>Mégse</button></div>
        </>}
      </fieldset>
    </form>
    {!!plan.financing?.upcoming.length&&<div className="rounded-xl bg-blue-50 p-3 text-sm dark:bg-blue-950">{plan.financing.upcoming.map(e=><p key={e.id}>{e.effective_on}-tól: {FINANCING_MODES[e.mode]} · {FINANCING_STATUSES[e.status]}</p>)}</div>}
    {!!plan.financing?.history.length&&<details className="border-t pt-3 text-xs dark:border-slate-700"><summary className="flex cursor-pointer items-center gap-2 font-medium"><History className="h-4 w-4"/>Korábbi finanszírozási adatok · {plan.financing.history.length}</summary><ol className="mt-3 space-y-3">{plan.financing.history.map(e=><li key={e.id} className="rounded-xl border p-3"><strong>{e.effective_on} · {FINANCING_MODES[e.mode]} · {FINANCING_STATUSES[e.status]}{!e.active?' · javított korábbi bejegyzés':''}</strong><p className="mt-1">{e.reason} · forrás: {e.source}</p><details className="my-2"><summary className="cursor-pointer">Összegek, terv és mellékletek</summary><div className="mt-2 space-y-2"><p>Teljes összeg: {formatFinancingAmount(e.total_amount,e.currency)} · beteg fizeti: {formatFinancingAmount(e.patient_amount,e.currency)}</p><p>Terv: {e.plan_version_id?`${plan.history?.find(p=>p.id===e.plan_version_id)?.version??'Korábbi'}. változat`:'Epizódszintű előkészítés'}{e.decision_reference?` · ${e.decision_reference}`:''}</p>{Object.entries(e.cost_breakdown??{}).filter(([,item])=>item.enabled).map(([key,item])=><p key={key}>{COST_COMPONENTS[key as CostKey]}: {formatFinancingAmount(item.totalAmount,e.currency)} · beteg: {formatFinancingAmount(item.patientAmount,e.currency)}</p>)}{e.document_ids?.map(id=><a key={id} className="block break-all underline" href={`/api/patients/${plan.patientId}/documents/${id}`} target="_blank" rel="noreferrer">{documents.find(d=>d.id===id)?.filename??'Csatolt dokumentum'}</a>)}</div></details><p className="mt-1">Rögzítette: {e.recorder} · {new Date(e.recorded_at).toLocaleString('hu-HU')}</p>{canEdit&&e.active&&!draft&&<button type="button" className="mt-2 underline" disabled={disabled} onClick={()=>open(e)}>Hibás bejegyzés javítása</button>}</li>)}</ol></details>}
  </section>;
}
