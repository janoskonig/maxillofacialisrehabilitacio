'use client';
import { cloneElement, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import { budapestToday, PROSTHESIS_TYPES } from '@/lib/aftercare/model';
import { clinicalCommandSchema, emptyLayers, replayStates, type ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { DentalAssessmentField, ProsthesisPositionField } from './ClinicalChartFields';
import { POSITION_ROLES } from './ClinicalArch';
import { useClinicalFormMode } from './FormMode';
import { FormErrors, formInput, primaryButton, secondaryButton } from './WorkflowForm';

const input=formInput;
export const ACTION_LABELS:Record<string,string>={register:'Fogpótlás felvétele',review_mapping:'Régi pótlás megfeleltetése',set_goal:'Vizsgálat kapcsolása a kezeléshez',milestone:'Elkészülés vagy átadás rögzítése',visit:'Ellátás rögzítése',status:'Fogazati státusz',repair:'Javítás indítása',repair_result:'Javítás lezárása',remake:'Teljes újrakészítés',work:'Munka és kapcsolatai',book_task:'Kontroll időpontja'};
export function ClinicalEntryForm({data,initial,onSave,onCancel,busy,onDirtyChange}:{data:ClinicalWorkspace;initial:Record<string,any>;onSave:(c:unknown)=>Promise<void>;onCancel:()=>void;busy:boolean;onDirtyChange?:(dirty:boolean)=>void}) {
  const {expert}=useClinicalFormMode();
  const formId=useId();let fieldIndex=0;
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  useEffect(()=>{if(!dirty)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
  const [reviewing,setReviewing]=useState(false),[errors,setErrors]=useState<string[]>([]);
  const [draft,setDraft]=useState<Record<string,any>>({requestKey:crypto.randomUUID(),precision:'day',source:'',note:'',
    episodeMode:'new',episodeId:data.episodes.length===1?data.episodes[0].id:'',prosthesisId:data.prostheses.length===1?data.prostheses[0].id:'',
    origin:'',role:'',jaw:'',prosthesisType:'',label:'',positions:[],specification:{},
    milestone:'',mode:'assessment',layers:emptyLayers(),baselineStateId:'',
    approved:false,prosthesisIds:[],treatments:[],scope:'prosthesis',requiresPhaseIds:[],
    clinician:'',clinicalMinutes:null,appointmentId:null,followups:[],outcome:'completed',documentIds:[],laboratoryTasks:[],...initial,
    links:initial.supersedesId?initial.links??[]:(initial.links??(initial.action==='visit'?[{prosthesisId:initial.prosthesisId??(data.prostheses.length===1?data.prostheses[0].id:''),phase:'',activity:'',result:'',followups:[],completedTaskIds:[]}]:[])).map((l:any)=>({...l,outcome:''})),
    occurredOn:initial.occurredOn??data.appointments.find(a=>a.id===initial.appointmentId)?.day??budapestToday()});
  const [confirmed,setConfirmed]=useState(false);
  const occupiedJaws=(episodeId:string)=>data.prostheses.filter(p=>p.episode_id===episodeId||(data.episodeLinks??[]).some(l=>l.episode_id===episodeId&&l.prosthesis_id===p.id)).map(p=>p.jaw);
  const patch=(key:string,value:unknown)=>{setDirty(true);setDraft(d=>{
    const next={...d,[key]:value,requestKey:crypto.randomUUID()};
    if(d.action==='visit'&&key==='appointmentId'&&value)next.occurredOn=data.appointments.find(a=>a.id===value)?.day??d.occurredOn;
    if(key==='origin'&&value!=='local')next.episodeMode='new';
    if((key==='episodeMode'||key==='episodeId')&&next.action==='register'&&next.episodeMode==='existing'){
      const occupied=occupiedJaws(next.episodeId),available=['felso','also'].filter(j=>!occupied.includes(j));
      if(available.length===1)next.jaw=available[0];else if(occupied.includes(next.jaw))next.jaw='';
    }
    return next;
  });setReviewing(false);setErrors([]);};
  const field=(label:string,child:ReactElement)=>{const id=`${formId}-${++fieldIndex}`;return <div key={label} className="min-w-0 space-y-1"><label htmlFor={id} className="text-sm font-medium">{label}</label>{cloneElement(child,{id})}</div>;};
  const text=(key:string,label:string,required=true,type='text')=>field(label,<input className={input} type={type} required={required} value={draft[key]??''} onChange={e=>patch(key,e.target.value)}/>);
  const area=(key:string,label:string,required=true)=>field(label,<textarea className={input} rows={3} required={required} value={draft[key]??''} onChange={e=>patch(key,e.target.value)}/>);
  const select=(key:string,label:string,options:Array<{id:string;label:string;disabled?:boolean}>,nullable=false)=>field(label,<select className={input} required={!nullable} value={draft[key]??''} onChange={e=>patch(key,e.target.value||null)}><option value="">Válasszon</option>{options.map(o=><option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>)}</select>);
  const multi=(key:string,label:string,options:Array<{id:string;label:string}>)=><fieldset><legend className="mb-2 text-sm font-medium">{label}</legend><div className="max-h-44 overflow-y-auto rounded border p-2 space-y-1">{!options.length&&<p>Nincs választható rekord.</p>}{options.map(o=><label key={o.id} className="flex gap-2"><input type="checkbox" checked={(draft[key]??[]).includes(o.id)} onChange={e=>patch(key,e.target.checked?[...(draft[key]??[]),o.id]:(draft[key]??[]).filter((id:string)=>id!==o.id))}/>{o.label}</label>)}</div></fieldset>;
  const epOptions=data.episodes.map(e=>({id:e.id,label:`${e.case_title||e.reason} (${e.status==='closed'?'lezárt':e.status==='paused'?'szünetel':'folyamatban'})`}));
  const pOptions=data.prostheses.map(p=>({id:p.id,label:`${p.label} · ${p.jaw==='felso'?'felső':'alsó'} · ${p.role==='provisional'?'ideiglenes':p.role==='definitive'?'végleges':'szerepe nem ismert'}`}));
  const sOptions=data.states.filter(s=>s.occurred_on<=draft.occurredOn).map(s=>({id:s.id,label:`${s.occurred_on} · ${s.note||s.source}`}));
  const workOptions=data.work.filter(w=>draft.repairCaseId?w.repair_case_id===draft.repairCaseId:w.episode_id===draft.episodeId).map(w=>({id:w.id,label:w.custom_label||w.work_phase_code}));
  const action=draft.action as string;
  const layers:ClinicalLayers=draft.layers;
  function layerValue(layer:keyof ClinicalLayers,key:string,value:unknown) {
    const next=structuredClone(layers);if(value===undefined) delete next[layer][key];else next[layer][key]=value;patch('layers',next);
  }
  async function submit(e:FormEvent) {
    e.preventDefault();
    if(busy)return;
    const localTime=draft.localTime?new Date(draft.localTime):null;
    const command:Record<string,any>={...draft,episodeId:draft.episodeId||null,occurredAt:draft.precision==='exact'&&localTime&&Number.isFinite(localTime.getTime())?localTime.toISOString():null};
    if(['register','review_mapping'].includes(action)&&!command.episodeReason?.trim())delete command.episodeReason;
    if(action==='status')command.prosthesisId=draft.prosthesisId||null;
    for (const key of ['workPhaseId','repairCaseId','pathwayId','sourceEventId','legacySnapshotId']) if (!command[key]) delete command[key];
    if (action==='set_goal'&&!command.baselineStateId) command.baselineStateId=null;
    if (action==='work'&&command.scope==='episode') command.prosthesisIds=[];
    if (action==='status' && draft.mode==='change') {
      const previous=data.states.filter(s=>s.event_id!==draft.supersedesId && s.occurred_on<=draft.occurredOn);
      command.expectedBefore=replayStates(previous).layers;
    }
    if (action==='repair') command.laboratoryTasks=(draft.labText??'').split('\n').map((s:string)=>s.trim()).filter(Boolean);
    if (action==='visit') command.clinicalMinutes=draft.clinicalMinutes?Number(draft.clinicalMinutes):null;
    const messages:string[]=[];
    const parsed=clinicalCommandSchema.safeParse(command);
    if(!parsed.success)for(const issue of parsed.error.issues){
      const fields:Record<string,string>={episodeId:'Kapcsolódó kezelés',prosthesisId:'Fogpótlás',baselineStateId:'Ellátás előtti vizsgálat',jaw:'Állcsont',role:'Ideiglenes vagy végleges',origin:'Eredet',prosthesisType:'Pótlás típusa',label:'Megnevezés',source:'Információ forrása',occurredOn:'Történés napja',occurredAt:'Pontos időpont',clinician:'Ellátó',activity:'Elvégzett munka',result:'Eredmény leírása',outcome:'Teljesülés',phase:'Ellátás típusa',repairCaseId:'Javítás',reason:'Indok',plan:'Javítás terve',sourceEventId:'Dokumentált eredmény',taskId:'Kontrollfeladat',clinicalMinutes:'Klinikai idő',links:'Elvégzett tevékenység'};
      const key=String(issue.path[issue.path[0]==='links'&&issue.path.length>2?2:0]??'');
      const prefix=issue.path[0]==='links'&&typeof issue.path[1]==='number'?`${issue.path[1]+1}. tevékenység · `:'';
      messages.push(issue.code==='custom'?issue.message:key==='clinicalMinutes'?'A klinikai idő 1 és 1440 közötti egész perc lehet.':`${prefix}${fields[key]??'Adat'}: töltsd ki vagy válassz érvényes értéket.`);
    }
    if(action==='register'&&draft.origin==='local'&&draft.episodeMode!=='existing'&&!draft.episodeReason?.trim())messages.push('Írd le, miért indul az új fogpótlás készítése.');
    if(draft.occurredOn>budapestToday())messages.push('Megtörtént eseményhez mai vagy korábbi napot adj meg.');
    if(action==='visit'&&draft.appointmentId){const appointment=data.appointments.find(a=>a.id===draft.appointmentId);if(appointment?.day!==draft.occurredOn)messages.push('A vizit napja egyezzen meg a kapcsolt időpont napjával. Ellenőrizd a dátumot vagy válassz másik időpontot.');if(appointment&&!['completed','unsuccessful'].includes(appointment.appointment_status))messages.push('A kapcsolt időpontot előbb megtörténtként kell lezárni. Lemondott vagy elmulasztott időpont nem dokumentálható ellátásként.');}
    if(action==='status'&&draft.mode==='change'&&!confirmed)messages.push('Erősítsd meg, hogy a státuszváltozást klinikailag ellenőrizted.');
    if(action==='status'&&!Object.values(layers).some(values=>Object.keys(values).length)&&!draft.note.trim())messages.push('Rögzíts legalább egy megfigyelést, vagy a megjegyzésben írd le, miért nem ismert a fogazati állapot.');
    if(messages.length){setErrors(Array.from(new Set(messages)));setReviewing(false);return;}
    if(!expert&&!reviewing){setDirty(true);setReviewing(true);return;}
    await onSave(parsed.success?parsed.data:command);
  }
  return <form onSubmit={submit} noValidate className="rounded-xl border border-blue-200 bg-blue-50/40 dark:bg-gray-950 p-5 space-y-4" aria-label={ACTION_LABELS[action]}>
    <div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{ACTION_LABELS[action]}{draft.supersedesId?' · korrekció':''}</h2><button type="button" disabled={busy} onClick={onCancel} className="text-sm underline disabled:opacity-40">Mégse</button></div>
    <p className="text-sm text-slate-500">{action==='register'&&draft.episodeMode==='existing'?'Az epizód fogpótlását add meg. Állcsontonként egy készülék, összesen legfeljebb kettő kapcsolható hozzá.':action==='register'?'Egy készüléket adj meg: felső vagy alsó, ideiglenes vagy végleges. Egy epizódban egy felső és egy alsó készülék készülhet. Máshol készült készüléket is felvehetsz.':action==='visit'?'Egy alkalom minden elvégzett munkáját itt rögzítsd, külön eredménnyel. A beteg megjelenése és a klinikai idő egyszer számít.':action==='status'?'Csak a vizsgálatkor ténylegesen ismert állapotot add meg.':action==='repair'?'A javítás saját kezelést indít ugyanahhoz a fogpótláshoz.':'A ténylegesen megtörtént esemény adatait add meg.'}</p>
    <fieldset disabled={busy} className="space-y-4">
    <div hidden={reviewing&&!expert} className="space-y-4">
      {field('Melyik napon történt?',<input className={input} type="date" required max={budapestToday()} value={draft.occurredOn} onChange={e=>patch('occurredOn',e.target.value)}/>)}
      <p className="text-xs text-slate-500">Korábbi eseményhez annak napját add meg. A mostani rögzítés idejét és a rögzítőt külön megőrizzük.</p>
    {['review_mapping','set_goal','status','work'].includes(action)&&select('episodeId',['register','review_mapping'].includes(action)?'Melyik korábbi kezeléshez kapcsolódik?':'Ellátási epizód',epOptions,['register','review_mapping','status'].includes(action)||(action==='work'&&!!draft.repairCaseId))}
    {['review_mapping','set_goal','milestone','repair','remake'].includes(action)&&select('prosthesisId','Fogpótlás',pOptions)}
    {['register','review_mapping'].includes(action)&&<>
      <div className="grid md:grid-cols-3 gap-3">{text('label','Megnevezés')}{select('jaw','Állcsont',[{id:'felso',label:'Felső',disabled:draft.episodeMode==='existing'&&occupiedJaws(draft.episodeId).includes('felso')},{id:'also',label:'Alsó',disabled:draft.episodeMode==='existing'&&occupiedJaws(draft.episodeId).includes('also')}])}{initial.episodeMode!=='existing'&&select('origin','Eredet',[{id:'local',label:'Itt készül vagy készült'},{id:'external',label:'Máshol készült'},{id:'unknown',label:'Nem ismert'}])}{select('role','Ideiglenes vagy végleges?',[{id:'provisional',label:'Ideiglenes'},{id:'definitive',label:'Végleges'},{id:'unknown',label:'Nem ismert'}])}{select('prosthesisType','Típus',Object.entries(PROSTHESIS_TYPES).map(([id,label])=>({id,label})))}</div>
      {action==='register'&&draft.origin==='local'&&initial.episodeMode!=='existing'&&<div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">{select('episodeMode','Hogyan kapcsolódjon az epizódhoz?',[{id:'new',label:'Új elkészítési epizód'},{id:'existing',label:'Meglévő nyitott epizód'}])}{select('episodeId',draft.episodeMode==='existing'?'Melyik epizódhoz kapcsolódik?':'Melyik korábbi kezeléshez kapcsolódik?',draft.episodeMode==='existing'?epOptions.filter(o=>data.episodes.find(e=>e.id===o.id)?.status==='open'&&occupiedJaws(o.id).length<2&&!(data.episodeLinks??[]).some(l=>l.episode_id===o.id&&l.purpose==='repair')):epOptions)}<p className="mt-2 text-xs text-slate-500">{draft.episodeMode==='existing'?'A kiválasztott epizódban állcsontonként egy fogpótlás lehet.':'A fogpótlás új epizódot kap, a kiválasztott korábbi ellátáshoz kapcsolva.'}</p></div>}
      {action==='register'&&draft.origin==='local'&&draft.episodeMode!=='existing'&&area('episodeReason','Miért indul az új elkészítési epizód?')}
      <p className="text-xs text-slate-500">A megnevezés legyen könnyen felismerhető, például: „Felső teljes lemezes fogpótlás”.</p>
      <ProsthesisPositionField expanded={expert} jaw={draft.jaw} positions={draft.positions} onChange={positions=>patch('positions',positions)}/>
      <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={expert}><summary className="cursor-pointer text-sm font-medium">Anyag, elhorgonyzás és további részletek · opcionális</summary><div className="mt-3 grid gap-3 sm:grid-cols-3">{['material','retention','design'].map((k,i)=>field(['Anyag','Elhorgonyzás','Klinikai leírás'][i],<input className={input} value={draft.specification[k]??''} onChange={e=>patch('specification',{...draft.specification,[k]:e.target.value})}/>))}</div></details>
    </>}
    {['set_goal','repair'].includes(action)&&select('baselineStateId','Ellátás előtti dokumentált státusz',sOptions)}
    {action==='milestone'&&select('milestone','Mi történt a fogpótlással?',[{id:'lab_completed',label:'Labor elkészült'},{id:'accepted',label:'Klinikailag késznek elfogadva'},{id:'delivered',label:'Átadva'},{id:'in_use',label:'Használatban'},{id:'retired',label:'Használat megszűnt'}])}
    {action==='status'&&<>
      {select('mode','Dokumentálás módja',[{id:'assessment',label:'Vizsgálati állapot (csak az ismert adatok)'},{id:'change',label:'Megerősített eredmény miatti változás'}])}
      {draft.mode==='change'&&select('sourceEventId','Dokumentált eredmény forrása',data.events.filter(e=>e.active&&['visit','accepted','delivered','repair_completed'].includes(e.kind)).map(e=>({id:e.id,label:`${String(e.occurred_on).slice(0,10)} · ${{visit:'Ellátás',accepted:'Klinikai elfogadás',delivered:'Átadás',repair_completed:'Javítás lezárása'}[e.kind as string]??'Eredmény'} · ${e.note}`})))}
      {field('Korábbi státusz átvétele (opcionális, ellenőrzést igényel)',<select className={input} defaultValue="" onChange={e=>{const s=data.legacyStates.find(s=>s.id===e.target.value);if(s){patch('layers',{teeth:s.fogak,implants:{},prostheses:{}});patch('occurredOn',s.effective_date);patch('legacySnapshotId',s.id);}}}><option value="">Új dokumentált vizsgálat</option>{data.legacyStates.map(s=><option key={s.id} value={s.id}>{s.effective_date} · {s.note}</option>)}</select>)}
      <p className="text-sm">A mezők szándékosan üresek. A mai státusz nem kerül automatikusan egy korábbi vizsgálatba. Változásnál csak az érintett pozíciókat adja meg.</p>
      <DentalAssessmentField expanded={expert} layers={layers} onChange={value=>patch('layers',value)}/>
      <fieldset className="border rounded p-3"><legend>Megfigyelt fogpótlások (külön réteg)</legend>{data.prostheses.map(p=><div key={p.id}><strong>{p.label}</strong><div className="flex flex-wrap gap-3">{p.positions.map((pos:any)=>{const key=`${p.id}:${pos.tooth}:${pos.role}`;return <label key={key} className="text-sm"><input type="checkbox" checked={!!layers.prostheses[key]} onChange={e=>layerValue('prostheses',key,e.target.checked?{prosthesisId:p.id,...pos}:undefined)}/> {pos.tooth}: {pos.role}</label>;})}</div></div>)}</fieldset>
      {draft.mode==='change'&&<label className="flex gap-2"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>A változást és a történési nap előtti állapotot klinikailag ellenőriztem.</label>}
    </>}
    {action==='visit'&&<>
      <details className="rounded-xl border p-3" open={expert||!!draft.appointmentId}><summary className="cursor-pointer text-sm font-medium">Meglévő időpont kapcsolása · ha volt foglalás</summary><div className="mt-3">{select('appointmentId','Meglévő időponthoz kapcsolás',data.appointments.map(a=>{const documented=data.events.some(e=>e.active&&e.kind==='visit'&&e.payload.command.appointmentId===a.id&&e.id!==draft.supersedesId)||(data.legacyEncounters??[]).some(e=>e.appointment_id===a.id);const eligible=['completed','unsuccessful'].includes(a.appointment_status);return{id:a.id,label:`${a.day} · ${documented?'Már dokumentálva':!eligible?'Még nincs megtörténtként lezárva':a.appointment_status==='unsuccessful'?'Megtörtént, sikertelen':'Megtörtént'}`,disabled:documented||!eligible};}),true)}<p className="mt-2 text-xs text-slate-500">A kiválasztott időpont napját átvezetjük a vizit dátumához. Már dokumentált alkalmat az Ellátások nézetben javíthatsz.</p></div></details>
      <p className="text-sm">Az ellátást korábbi időpontfoglalás nélkül is rögzítheted. A közösen végzett munkákat tevékenységenként add meg.</p>
      <div className="grid md:grid-cols-2 gap-3">{text('clinician','Ki végezte az ellátást?')}{text('clinicalMinutes','Az egész alkalom klinikai ideje, percben · ha mérték',false,'number')}</div>
      {draft.links.map((l:any,i:number)=>{const update=(k:string,v:unknown)=>patch('links',draft.links.map((x:any,j:number)=>i===j?{...x,[k]:v,...(k==='prosthesisId'||k==='phase'?{workPhaseId:undefined,repairCaseId:undefined,completedTaskIds:[]}:{}),...(k==='outcome'&&v!=='completed'?{completedTaskIds:[]}:{} )}:x));return <fieldset className="rounded border p-3 space-y-2" key={i}><legend>{i+1}. tevékenység</legend><div className="grid md:grid-cols-2 gap-2">
        {field('Fogpótlás',<select className={input} required value={l.prosthesisId} onChange={e=>update('prosthesisId',e.target.value)}><option value="">Válasszon</option>{pOptions.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>)}
        {field('Ellátás',<select className={input} value={l.phase} onChange={e=>update('phase',e.target.value)}><option value="">Válassz ellátást…</option><option value="construction">Készítés</option><option value="aftercare">Kontroll, javítás nélkül</option><option value="repair">Igazítás / javítás (saját epizódban)</option></select>)}
        {field('Elvégzett munka',<input className={input} required value={l.activity} onChange={e=>update('activity',e.target.value)}/>)}
        {field('Eredmény',<select className={input} value={l.outcome} onChange={e=>update('outcome',e.target.value)}><option value="">Válassz eredményt…</option><option value="completed">Teljesített</option><option value="partial">Részben teljesített</option><option value="unsuccessful">Sikertelen</option></select>)}
        {field('Eredmény leírása',<input className={input} required value={l.result} onChange={e=>update('result',e.target.value)}/>)}
        <details className="rounded-lg border p-2" open={expert||!!l.workPhaseId}><summary className="cursor-pointer text-xs text-slate-500">Munkafázishoz kapcsolás · opcionális</summary>{field('Munkafázis',<select className={input} value={l.workPhaseId??''} onChange={e=>update('workPhaseId',e.target.value||undefined)}><option value="">Nincs</option>{data.work.filter(w=>w.prosthesis_ids.includes(l.prosthesisId)||(w.clinical_scope==='episode'&&w.episode_id===data.prostheses.find(p=>p.id===l.prosthesisId)?.episode_id)).map(w=><option key={w.id} value={w.id}>{w.custom_label||w.work_phase_code}</option>)}</select>)}</details>
        {l.phase==='repair'&&field('Javítási ügy',<select className={input} required value={l.repairCaseId??''} onChange={e=>update('repairCaseId',e.target.value||undefined)}><option value="">Válasszon</option>{data.repairs.filter(r=>r.prosthesis_id===l.prosthesisId).map(r=><option key={r.id} value={r.id}>{r.reason}</option>)}</select>)}
      </div>
      <details className="rounded-lg border p-3" open={expert||!!l.followups.length}><summary className="cursor-pointer text-sm font-medium">Kell új kontroll?</summary><div className="flex gap-2">{field('Új kontroll célja',<input className={input} value={l.followups[0]?.purpose??''} onChange={e=>update('followups',e.target.value?[{purpose:e.target.value,afterDays:l.followups[0]?.afterDays??14}]:[])}/>)}{field('Nap múlva',<input type="number" min={1} max={3650} className={input} value={l.followups[0]?.afterDays??14} onChange={e=>update('followups',[{purpose:l.followups[0]?.purpose??'Kontroll',afterDays:Number(e.target.value)}])}/>)}</div></details>
      {!!data.tasks.filter(t=>t.prosthesis_id===l.prosthesisId&&!t.completed).length&&<div className="text-sm">Ezzel teljesített kontrollfeladatok:{l.outcome!=='completed'&&<p className="text-xs text-slate-500">Teljesített eredmény esetén jelölhető.</p>}{data.tasks.filter(t=>t.prosthesis_id===l.prosthesisId&&!t.completed).map(t=><label key={t.id} className="block"><input type="checkbox" disabled={l.outcome!=='completed'} checked={l.completedTaskIds.includes(t.id)} onChange={e=>update('completedTaskIds',e.target.checked?[...l.completedTaskIds,t.id]:l.completedTaskIds.filter((id:string)=>id!==t.id))}/> {t.due_on} · {t.purpose}</label>)}</div>}
      <button type="button" className="text-red-700 underline" onClick={()=>patch('links',draft.links.filter((_:any,j:number)=>i!==j))}>Tevékenység eltávolítása</button></fieldset>;})}
      <button type="button" className="underline" onClick={()=>patch('links',[...draft.links,{prosthesisId:draft.prosthesisId,phase:'',activity:'',outcome:'',result:'',followups:[],completedTaskIds:[]}])}>Tevékenység hozzáadása</button>
    </>}
    {action==='repair'&&<><p className="text-sm">Minden javítás saját kezelést indít. A fogpótlás és a korábbi előzményei megmaradnak.</p>{area('reason','Javítás oka')}{area('plan','Javítás terve')}{area('labText','Laborfeladatok (soronként)',false)}{multi('documentIds','Kapcsolódó dokumentumok',data.documents.map(d=>({id:d.id,label:d.filename})))}</>}
    {action==='repair_result'&&<>{select('repairCaseId','Javítási ügy',data.repairs.map(r=>({id:r.id,label:r.reason})))}{area('result','Eredmény és lezárás')}</>}
    {action==='remake'&&<>{select('repairCaseId','Előzmény javítási ügy',data.repairs.filter(r=>r.prosthesis_id===draft.prosthesisId).map(r=>({id:r.id,label:r.reason})),true)}{text('label','Új fogpótlás és epizód megnevezése')}{area('reason','Újrakészítés klinikai indoka')}<p className="text-sm">Új epizód és új fogpótlás jön létre, az előző azonosítói és a javítás története megmaradnak.</p></>}
    {action==='work'&&<>{select('workPhaseId','Meglévő munka kapcsolása',workOptions,true)}{text('label','Munka megnevezése')}{select('scope','Hatókör',[{id:'episode',label:'Általános vizsgálat / előkészítés az epizódhoz'},{id:'prosthesis',label:'Konkrét fogpótlás(ok)'}])}{draft.scope==='prosthesis'&&multi('prosthesisIds','Érintett fogpótlások',pOptions)}{select('repairCaseId','Javítási ügy',data.repairs.map(r=>({id:r.id,label:r.reason})),true)}{multi('requiresPhaseIds','Kifejezett előfeltételek',workOptions.filter(w=>w.id!==draft.workPhaseId))}{select('pathwayId','A sablon további munkái is ezt a pótlást örököljék',data.pathways.filter(p=>p.episode_id===draft.episodeId).map(p=>({id:p.id,label:p.name})),true)}</>}
    {action==='book_task'&&<>{select('taskId','Kontrollfeladat',data.tasks.filter(t=>!t.completed).map(t=>({id:t.id,label:`${t.due_on} · ${t.purpose}`})))}{select('appointmentId','Közös vagy önálló időpont',data.appointments.map(a=>({id:a.id,label:`${a.day} · ${a.appointment_status||'foglalt'}`})),true)}</>}
    {field('Mi alapján rögzíted?',<input className={input} required maxLength={500} placeholder="Például: saját vizsgálat vagy korabeli karton" value={draft.source} onChange={e=>patch('source',e.target.value)}/>)}
    <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={expert}><summary className="cursor-pointer text-sm font-medium">Megjegyzés és pontos időpont · opcionális</summary><div className="mt-3 space-y-3">{area('note','Klinikai megjegyzés',false)}{select('precision','Mennyire pontos az időpont?',[{id:'day',label:'Csak a nap ismert'},{id:'exact',label:'Óra és perc is ismert'}])}{draft.precision==='exact'&&text('localTime','Tényleges időpont',true,'datetime-local')}</div></details>
    </div>
    {reviewing&&!expert&&<ClinicalEntryReview draft={draft} data={data}/>}
    <FormErrors messages={errors}/>
    <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">{reviewing&&!expert&&<button type="button" onClick={()=>setReviewing(false)} className={secondaryButton}>Vissza a szerkesztéshez</button>}<button type="submit" className={primaryButton}>{busy?'Mentés…':expert||reviewing?'Mentés a kartonba':'Adatok ellenőrzése'}</button></div>
    </fieldset>
  </form>;
}

function ClinicalEntryReview({draft,data}:{draft:Record<string,any>;data:ClinicalWorkspace}) {
  const p=data.prostheses.find(p=>p.id===draft.prosthesisId);
  const milestone:Record<string,string>={lab_completed:'Labor elkészült',accepted:'Klinikailag késznek elfogadva',delivered:'Átadva',in_use:'Használatban',retired:'Használat megszűnt'};
  return <section aria-label="Mentés előtti összefoglaló" className="space-y-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
    <h3 className="font-semibold">Ez kerül a kartonba</h3>
    <p className="text-sm">{ACTION_LABELS[draft.action]} · {draft.occurredOn}{draft.precision==='exact'&&` · ${draft.localTime.replace('T',' ')}`}</p>
    {p&&!['status','register'].includes(draft.action)&&<p className="text-sm font-medium">{p.label}</p>}
    {['register','review_mapping'].includes(draft.action)&&<><p className="font-medium">{draft.label}</p><p className="text-sm">{draft.jaw==='felso'?'Felső':'Alsó'} állcsont · {draft.role==='provisional'?'Ideiglenes':draft.role==='definitive'?'Végleges':'Szerepe nem ismert'} · {PROSTHESIS_TYPES[draft.prosthesisType as keyof typeof PROSTHESIS_TYPES]}</p><p className="text-sm">{draft.origin==='local'?(draft.episodeMode==='existing'?'Helyben készül / készült · a kiválasztott epizódhoz kapcsolva':'Helyben készül / készült · új elkészítési epizóddal'):draft.origin==='external'?'Máshol készült':'Eredete nem ismert'}</p><p className="text-sm">{draft.positions.length?draft.positions.map((p:any)=>`${p.tooth}: ${POSITION_ROLES[p.role]}`).join(', '):'Foghelyek még nincsenek megadva.'}</p></>}
    {draft.action==='visit'&&<><p className="text-sm">Ellátó: {draft.clinician} · teljes klinikai idő: {draft.clinicalMinutes||'Nem mért'}{draft.clinicalMinutes?' perc':''}</p>{draft.links.map((l:any,i:number)=><div key={i} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><p className="font-medium">{data.prostheses.find(p=>p.id===l.prosthesisId)?.label} · {l.phase==='construction'?'Készítés':l.phase==='aftercare'?'Kontroll':'Javítás'}</p><p className="mt-1">{l.activity} · {l.outcome==='completed'?'Teljesített':l.outcome==='partial'?'Részben teljesített':'Sikertelen'}</p><p>{l.result}</p>{l.followups.map((f:any,j:number)=><p key={j}>Követés: {f.purpose}, {f.afterDays} nap múlva</p>)}{!!l.completedTaskIds.length&&<p>{l.completedTaskIds.length} kontrollfeladat teljesülése is rögzül.</p>}</div>)}</>}
    {draft.action==='status'&&<p className="text-sm">{draft.mode==='assessment'?'Vizsgálati állapot':'Megerősített státuszváltozás'}: {Object.keys(draft.layers.teeth).length} sajátfog-adat, {Object.keys(draft.layers.implants).length} implantátum-adat és {Object.keys(draft.layers.prostheses).length} pótlási pozíció. {draft.mode==='assessment'?'A többi pozíció ismeretlen marad.':'Csak a megadott adatok változnak.'}</p>}
    {draft.action==='milestone'&&<p className="text-sm">{milestone[draft.milestone]}</p>}
    {draft.reason&&<p className="text-sm">Indok: {draft.reason}</p>}{draft.plan&&<p className="text-sm">Terv: {draft.plan}</p>}{draft.result&&<p className="text-sm">Eredmény: {draft.result}</p>}
    {draft.action==='set_goal'&&<p className="text-sm">Kiindulási vizsgálat: {data.states.find(s=>s.id===draft.baselineStateId)?.occurred_on}</p>}
    {draft.action==='book_task'&&<p className="text-sm">{data.tasks.find(t=>t.id===draft.taskId)?.purpose} · {draft.appointmentId?data.appointments.find(a=>a.id===draft.appointmentId)?.day:'Időpontkapcsolat törlése'}</p>}
    {draft.action==='work'&&<p className="text-sm">{draft.label} · {draft.scope==='episode'?'Általános vizsgálat vagy előkészítés':draft.prosthesisIds.map((id:string)=>data.prostheses.find(p=>p.id===id)?.label).join(', ')} · {draft.requiresPhaseIds.length} előfeltétel</p>}
    <p className="text-sm">Forrás: {draft.source}</p>{draft.note&&<p className="whitespace-pre-wrap text-sm">{draft.note}</p>}
    <p className="text-xs text-slate-500">Mentés után ez dokumentált esemény lesz. A rögzítés időpontját és a rögzítőt a rendszer hozzáadja.</p>
  </section>;
}
