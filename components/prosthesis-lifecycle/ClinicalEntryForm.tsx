'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { budapestToday, PROSTHESIS_TYPES } from '@/lib/aftercare/model';
import { emptyLayers, replayStates, type ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { BASE_LABELS, UPPER_ROW, LOWER_ROW } from '@/components/patient-form/odontogram/tooth-conditions';

const input='w-full rounded border border-gray-300 p-2 dark:bg-gray-900 dark:border-gray-600';
export const ACTION_LABELS:Record<string,string>={register:'Fogpótlás és saját epizód felvétele',review_mapping:'Régi pótlás megfeleltetése',set_goal:'Kiindulási státusz kapcsolása',milestone:'Mérföldkő rögzítése',visit:'Megtörtént vizit',status:'Fogazati státusz',repair:'Új javítási epizód',repair_result:'Javítási epizód lezárása',remake:'Teljes újrakészítés',work:'Munka és kapcsolatai',book_task:'Kontroll időpontja'};
export function ClinicalEntryForm({data,initial,onSave,onCancel,busy}:{data:ClinicalWorkspace;initial:Record<string,any>;onSave:(c:unknown)=>Promise<void>;onCancel:()=>void;busy:boolean}) {
  const [draft,setDraft]=useState<Record<string,any>>({requestKey:crypto.randomUUID(),precision:'day',source:'Klinikai dokumentáció',note:'',
    episodeId:data.episodes.find(e=>e.status==='open')?.id??data.episodes[0]?.id??'',prosthesisId:data.prostheses[0]?.id??'',
    origin:'local',role:'definitive',jaw:'felso',prosthesisType:'removable',label:'',positions:[],specification:{},
    milestone:'lab_completed',mode:'assessment',layers:emptyLayers(),baselineStateId:data.states[0]?.id??'',
    approved:false,prosthesisIds:[],treatments:[],scope:'prosthesis',requiresPhaseIds:[],links:[],
    clinician:'',clinicalMinutes:null,appointmentId:null,followups:[],outcome:'completed',documentIds:[],laboratoryTasks:[],...initial,
    occurredOn:initial.occurredOn??data.appointments.find(a=>a.id===initial.appointmentId)?.day??budapestToday()});
  const [confirmed,setConfirmed]=useState(false),[positionTooth,setPositionTooth]=useState('11'),[positionRole,setPositionRole]=useState('denture_tooth');
  const patch=(key:string,value:unknown)=>setDraft(d=>({...d,[key]:value}));
  const field=(label:string,child:ReactNode)=><label className="block text-sm space-y-1"><span className="font-medium">{label}</span>{child}</label>;
  const text=(key:string,label:string,required=true,type='text')=>field(label,<input className={input} type={type} required={required} value={draft[key]??''} onChange={e=>patch(key,e.target.value)}/>);
  const area=(key:string,label:string,required=true)=>field(label,<textarea className={input} rows={3} required={required} value={draft[key]??''} onChange={e=>patch(key,e.target.value)}/>);
  const select=(key:string,label:string,options:Array<{id:string;label:string}>,nullable=false)=>field(label,<select className={input} required={!nullable} value={draft[key]??''} onChange={e=>patch(key,e.target.value||null)}><option value="">Válasszon</option>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>);
  const multi=(key:string,label:string,options:Array<{id:string;label:string}>)=>field(label,<div className="max-h-44 overflow-y-auto rounded border p-2 space-y-1">{!options.length&&<p>Nincs választható rekord.</p>}{options.map(o=><label key={o.id} className="flex gap-2"><input type="checkbox" checked={(draft[key]??[]).includes(o.id)} onChange={e=>patch(key,e.target.checked?[...(draft[key]??[]),o.id]:(draft[key]??[]).filter((id:string)=>id!==o.id))}/>{o.label}</label>)}</div>);
  const epOptions=data.episodes.map(e=>({id:e.id,label:`${e.case_title||e.reason} (${e.status})`}));
  const pOptions=data.prostheses.map(p=>({id:p.id,label:`${p.label} · ${p.jaw==='felso'?'felső':'alsó'} · ${p.role} · ${p.id.slice(0,8)}`}));
  const sOptions=data.states.map(s=>({id:s.id,label:`${s.occurred_on} · ${s.note||s.source}`}));
  const workOptions=data.work.filter(w=>draft.repairCaseId?w.repair_case_id===draft.repairCaseId:w.episode_id===draft.episodeId).map(w=>({id:w.id,label:w.custom_label||w.work_phase_code}));
  const action=draft.action as string;
  const layers:ClinicalLayers=draft.layers;
  function layerValue(layer:keyof ClinicalLayers,key:string,value:unknown) {
    const next=structuredClone(layers);if(value===undefined) delete next[layer][key];else next[layer][key]=value;patch('layers',next);
  }
  async function submit(e:FormEvent) {
    e.preventDefault();
    const command:Record<string,any>={...draft,episodeId:draft.episodeId||null,occurredAt:draft.precision==='exact'&&draft.localTime?new Date(draft.localTime).toISOString():null};
    for (const key of ['workPhaseId','repairCaseId','pathwayId','sourceEventId','legacySnapshotId']) if (!command[key]) delete command[key];
    if (action==='set_goal'&&!command.baselineStateId) command.baselineStateId=null;
    if (action==='work'&&command.scope==='episode') command.prosthesisIds=[];
    if (action==='status' && draft.mode==='change') {
      const previous=data.states.filter(s=>s.event_id!==draft.supersedesId && s.occurred_on<=draft.occurredOn);
      command.expectedBefore=replayStates(previous).layers;
    }
    if (action==='repair') command.laboratoryTasks=(draft.labText??'').split('\n').map((s:string)=>s.trim()).filter(Boolean);
    if (action==='visit') command.clinicalMinutes=draft.clinicalMinutes?Number(draft.clinicalMinutes):null;
    await onSave(command);
  }
  return <form onSubmit={submit} className="rounded-xl border border-blue-200 bg-blue-50/40 dark:bg-gray-950 p-5 space-y-4" aria-label={ACTION_LABELS[action]}>
    <div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{ACTION_LABELS[action]}{draft.supersedesId?' · korrekció':''}</h2><button type="button" onClick={onCancel}>Bezárás</button></div>
    <div className="grid md:grid-cols-3 gap-3">
      {field('Történés napja',<input className={input} type="date" required max={budapestToday()} value={draft.occurredOn} onChange={e=>patch('occurredOn',e.target.value)}/>)}
      {select('precision','Időpont pontossága',[{id:'day',label:'Csak a nap ismert'},{id:'exact',label:'Pontos időpont ismert'}])}
      {draft.precision==='exact'&&text('localTime','Tényleges időpont',true,'datetime-local')}
      {text('source','Forrás (pl. korabeli karton, vizsgálat)')}
    </div>
    <p className="text-xs text-gray-600 dark:text-gray-300">A rendszer külön megőrzi a mai rögzítési időt és a bejelentkezett rögzítőt. Korábbi esemény lezárt epizódhoz is felvihető.</p>
    {['register','review_mapping','set_goal','status','work'].includes(action)&&select('episodeId',['register','review_mapping'].includes(action)?'Előzményepizód (a pótlás új saját epizódot kap)':'Ellátási epizód',epOptions,['register','review_mapping','status'].includes(action)||(action==='work'&&!!draft.repairCaseId))}
    {action==='register'&&<p className="text-sm">Egy epizód egy állcsont egy fogpótlásához tartozik. Az ideiglenes pótlás is önálló epizódot kap.</p>}
    {['review_mapping','set_goal','milestone','repair','remake'].includes(action)&&select('prosthesisId','Fogpótlás',pOptions)}
    {['register','review_mapping'].includes(action)&&<>
      <div className="grid md:grid-cols-3 gap-3">{text('label','Megnevezés')}{select('jaw','Állcsont',[{id:'felso',label:'Felső'},{id:'also',label:'Alsó'}])}{select('origin','Eredet',[{id:'local',label:'Ebben az ellátásban készül'},{id:'external',label:'Máshol készült'},{id:'unknown',label:'Nem ismert'}])}{select('role','Szerep',[{id:'provisional',label:'Ideiglenes'},{id:'definitive',label:'Végleges'},{id:'unknown',label:'Nem ismert'}])}{select('prosthesisType','Típus',Object.entries(PROSTHESIS_TYPES).map(([id,label])=>({id,label})))}</div>
      <div className="grid md:grid-cols-3 gap-3">{['material','retention','design'].map((k,i)=>field(['Anyag','Elhorgonyzás','Klinikai specifikáció'][i],<input className={input} value={draft.specification[k]??''} onChange={e=>patch('specification',{...draft.specification,[k]:e.target.value})}/>))}</div>
      <fieldset className="rounded border p-3 space-y-2"><legend>Érintett pozíciók és szerepek</legend><div className="flex flex-wrap gap-2"><input aria-label="FDI fogszám" className="w-24 border rounded p-2 dark:bg-gray-900" value={positionTooth} onChange={e=>setPositionTooth(e.target.value)}/><select className="border rounded p-2 dark:bg-gray-900" value={positionRole} onChange={e=>setPositionRole(e.target.value)}>{Object.entries({abutment:'Pillér',pontic:'Hídtest',denture_tooth:'Műfog',implant:'Implantátum',clasp:'Kapocs',attachment:'Elhorgonyzás'}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><button type="button" className="underline" onClick={()=>patch('positions',[...draft.positions,{tooth:Number(positionTooth),role:positionRole}])}>Pozíció hozzáadása</button></div>{draft.positions.map((p:any,i:number)=><button key={i} type="button" className="mr-3 rounded border px-2 py-1" onClick={()=>patch('positions',draft.positions.filter((_:any,j:number)=>i!==j))}>{p.tooth}: {p.role} ×</button>)}</fieldset>
    </>}
    {['set_goal','repair'].includes(action)&&select('baselineStateId','Ellátás előtti dokumentált státusz',sOptions)}
    {action==='milestone'&&select('milestone','Mérföldkő',[{id:'lab_completed',label:'Labor elkészült'},{id:'accepted',label:'Klinikailag késznek elfogadva'},{id:'delivered',label:'Átadva'},{id:'in_use',label:'Használatban'},{id:'retired',label:'Használat megszűnt'}])}
    {action==='status'&&<>
      {select('mode','Dokumentálás módja',[{id:'assessment',label:'Vizsgálati állapot (csak az ismert adatok)'},{id:'change',label:'Megerősített eredmény miatti változás'}])}
      {draft.mode==='change'&&select('sourceEventId','Dokumentált eredmény forrása',data.events.filter(e=>e.active&&['visit','accepted','delivered','repair_completed'].includes(e.kind)).map(e=>({id:e.id,label:`${String(e.occurred_on).slice(0,10)} · ${e.kind} · ${e.note}`})))}
      {field('Korábbi státusz átvétele (opcionális, ellenőrzést igényel)',<select className={input} defaultValue="" onChange={e=>{const s=data.legacyStates.find(s=>s.id===e.target.value);if(s){patch('layers',{teeth:s.fogak,implants:{},prostheses:{}});patch('occurredOn',s.effective_date);patch('legacySnapshotId',s.id);}}}><option value="">Új dokumentált vizsgálat</option>{data.legacyStates.map(s=><option key={s.id} value={s.id}>{s.effective_date} · {s.note}</option>)}</select>)}
      <p className="text-sm">A mezők szándékosan üresek. A mai státusz nem kerül automatikusan egy korábbi vizsgálatba. Változásnál csak az érintett pozíciókat adja meg.</p>
      {[UPPER_ROW,LOWER_ROW].map((row,i)=><fieldset key={i} className="border rounded p-3"><legend>{i?'Alsó':'Felső'} fogív</legend><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{row.map(n=><div key={n} className="text-xs rounded bg-white dark:bg-gray-900 p-2"><strong>{n}</strong><select aria-label={`${n}. saját fog`} className={input} value={(layers.teeth[n] as any)?.base??''} onChange={e=>layerValue('teeth',String(n),e.target.value?{base:e.target.value}:undefined)}><option value="">Ismeretlen / nincs bejegyzés</option>{Object.entries(BASE_LABELS).filter(([id])=>!['implant','bridge_pontic','denture_tooth'].includes(id)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><select aria-label={`${n}. implantátum`} className={input} value={layers.implants[n]===undefined?'':(layers.implants[n] as any)?.present?'yes':'no'} onChange={e=>layerValue('implants',String(n),e.target.value?{present:e.target.value==='yes'}:undefined)}><option value="">Implantátum: nem ismert</option><option value="yes">Implantátum jelen</option><option value="no">Implantátum nincs</option></select></div>)}</div></fieldset>)}
      <fieldset className="border rounded p-3"><legend>Megfigyelt fogpótlások (külön réteg)</legend>{data.prostheses.map(p=><div key={p.id}><strong>{p.label}</strong><div className="flex flex-wrap gap-3">{p.positions.map((pos:any)=>{const key=`${p.id}:${pos.tooth}:${pos.role}`;return <label key={key} className="text-sm"><input type="checkbox" checked={!!layers.prostheses[key]} onChange={e=>layerValue('prostheses',key,e.target.checked?{prosthesisId:p.id,...pos}:undefined)}/> {pos.tooth}: {pos.role}</label>;})}</div></div>)}</fieldset>
      {draft.mode==='change'&&<label className="flex gap-2"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>A változást és a történési nap előtti állapotot klinikailag ellenőriztem.</label>}
    </>}
    {action==='visit'&&<>
      {select('appointmentId','Meglévő időponthoz kapcsolás',data.appointments.map(a=>({id:a.id,label:`${a.day} · ${a.appointment_status||'foglalt'}`})),true)}
      <p className="text-sm">Időpontkapcsolat nélkül is rögzíthető megtörtént vizit. Egy közös vizithez több, külön eredményű tevékenységet adhat.</p>
      <div className="grid md:grid-cols-2 gap-3">{text('clinician','Ellátó')}{text('clinicalMinutes','Teljes vizit klinikai ideje percben (egyszer)',false,'number')}</div>
      {draft.links.map((l:any,i:number)=>{const update=(k:string,v:unknown)=>patch('links',draft.links.map((x:any,j:number)=>i===j?{...x,[k]:v}:x));return <fieldset className="rounded border p-3 space-y-2" key={i}><legend>{i+1}. tevékenység</legend><div className="grid md:grid-cols-2 gap-2">
        {field('Fogpótlás',<select className={input} required value={l.prosthesisId} onChange={e=>update('prosthesisId',e.target.value)}><option value="">Válasszon</option>{pOptions.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>)}
        {field('Ellátás',<select className={input} value={l.phase} onChange={e=>update('phase',e.target.value)}><option value="construction">Készítés</option><option value="aftercare">Kontroll, javítás nélkül</option><option value="repair">Igazítás / javítás (saját epizódban)</option></select>)}
        {field('Elvégzett munka',<input className={input} required value={l.activity} onChange={e=>update('activity',e.target.value)}/>)}
        {field('Eredmény',<select className={input} value={l.outcome} onChange={e=>update('outcome',e.target.value)}><option value="completed">Teljesített</option><option value="partial">Részben teljesített</option><option value="unsuccessful">Sikertelen</option></select>)}
        {field('Eredmény leírása',<input className={input} required value={l.result} onChange={e=>update('result',e.target.value)}/>)}
        {field('Munkafázis',<select className={input} value={l.workPhaseId??''} onChange={e=>update('workPhaseId',e.target.value||undefined)}><option value="">Nincs</option>{data.work.filter(w=>w.prosthesis_ids.includes(l.prosthesisId)||w.clinical_scope==='episode').map(w=><option key={w.id} value={w.id}>{w.custom_label||w.work_phase_code}</option>)}</select>)}
        {l.phase==='repair'&&field('Javítási ügy',<select className={input} required value={l.repairCaseId??''} onChange={e=>update('repairCaseId',e.target.value||undefined)}><option value="">Válasszon</option>{data.repairs.filter(r=>r.prosthesis_id===l.prosthesisId).map(r=><option key={r.id} value={r.id}>{r.reason}</option>)}</select>)}
      </div>
      <div className="flex gap-2">{field('Új kontroll célja',<input className={input} value={l.followups[0]?.purpose??''} onChange={e=>update('followups',e.target.value?[{purpose:e.target.value,afterDays:l.followups[0]?.afterDays??14}]:[])}/>)}{field('Nap múlva',<input type="number" min={1} max={3650} className={input} value={l.followups[0]?.afterDays??14} onChange={e=>update('followups',[{purpose:l.followups[0]?.purpose??'Kontroll',afterDays:Number(e.target.value)}])}/>)}</div>
      <div className="text-sm">Ezzel teljesített kontrollfeladatok:{data.tasks.filter(t=>t.prosthesis_id===l.prosthesisId&&!t.completed).map(t=><label key={t.id} className="block"><input type="checkbox" checked={l.completedTaskIds.includes(t.id)} onChange={e=>update('completedTaskIds',e.target.checked?[...l.completedTaskIds,t.id]:l.completedTaskIds.filter((id:string)=>id!==t.id))}/> {t.due_on} · {t.purpose}</label>)}</div>
      <button type="button" className="text-red-700 underline" onClick={()=>patch('links',draft.links.filter((_:any,j:number)=>i!==j))}>Tevékenység eltávolítása</button></fieldset>;})}
      <button type="button" className="underline" onClick={()=>patch('links',[...draft.links,{prosthesisId:draft.prosthesisId,phase:'construction',activity:'',outcome:'completed',result:'',followups:[],completedTaskIds:[]}])}>Tevékenység hozzáadása</button>
    </>}
    {action==='repair'&&<><p className="text-sm">Minden javítás új epizódot indít. A fogpótlás tartós azonosítója megmarad.</p>{area('reason','Javítás oka')}{area('plan','Javítás terve')}{area('labText','Laborfeladatok (soronként)',false)}{multi('documentIds','Kapcsolódó dokumentumok',data.documents.map(d=>({id:d.id,label:d.filename})))}</>}
    {action==='repair_result'&&<>{select('repairCaseId','Javítási ügy',data.repairs.map(r=>({id:r.id,label:r.reason})))}{area('result','Eredmény és lezárás')}</>}
    {action==='remake'&&<>{select('repairCaseId','Előzmény javítási ügy',data.repairs.filter(r=>r.prosthesis_id===draft.prosthesisId).map(r=>({id:r.id,label:r.reason})),true)}{text('label','Új fogpótlás és epizód megnevezése')}{area('reason','Újrakészítés klinikai indoka')}<p className="text-sm">Új epizód és új fogpótlás jön létre, az előző azonosítói és a javítás története megmaradnak.</p></>}
    {action==='work'&&<>{select('workPhaseId','Meglévő munka kapcsolása',workOptions,true)}{text('label','Munka megnevezése')}{select('scope','Hatókör',[{id:'episode',label:'Általános vizsgálat / előkészítés az epizódhoz'},{id:'prosthesis',label:'Konkrét fogpótlás(ok)'}])}{draft.scope==='prosthesis'&&multi('prosthesisIds','Érintett fogpótlások',pOptions)}{select('repairCaseId','Javítási ügy',data.repairs.map(r=>({id:r.id,label:r.reason})),true)}{multi('requiresPhaseIds','Kifejezett előfeltételek',workOptions.filter(w=>w.id!==draft.workPhaseId))}{select('pathwayId','A sablon további munkái is ezt a pótlást örököljék',data.pathways.filter(p=>p.episode_id===draft.episodeId).map(p=>({id:p.id,label:p.name})),true)}</>}
    {action==='book_task'&&<>{select('taskId','Kontrollfeladat',data.tasks.filter(t=>!t.completed).map(t=>({id:t.id,label:`${t.due_on} · ${t.purpose}`})))}{select('appointmentId','Közös vagy önálló időpont',data.appointments.map(a=>({id:a.id,label:`${a.day} · ${a.appointment_status||'foglalt'}`})),true)}</>}
    {area('note','Klinikai megjegyzés',false)}
    <button type="submit" disabled={busy} className="rounded-lg bg-blue-700 text-white px-5 py-2 disabled:opacity-50">{busy?'Mentés…':'Mentés a kartonba'}</button>
  </form>;
}
