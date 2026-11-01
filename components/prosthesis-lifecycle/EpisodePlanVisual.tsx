'use client';

import { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, Plus, X } from 'lucide-react';
import { PLAN_TREATMENT_LABELS, type EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
import { emptyLayers, projectClinicalPlan } from '@/lib/prosthesis-lifecycle/model';
import { ClinicalArch, archDifferences } from './ClinicalArch';

type Treatment={toothNumber:number;treatmentCode:string};
const COLORS:Record<string,string>={huzas:'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',implantacio:'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',korona:'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',mufog:'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200',hezagfog:'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200'};

export function EpisodePlanVisual({plan,baselineStateId,treatments,onChange,disabled=false}:{
  plan:EpisodeTreatmentPlanRecord;baselineStateId:string|null;treatments:Treatment[];
  onChange?:(treatments:Treatment[])=>void;disabled?:boolean;
}) {
  const [selection,setSelection]=useState<number[]>([]);
  const [code,setCode]=useState('huzas');
  const [preview,setPreview]=useState(false);
  const baseline=plan.states?.find(s=>s.id===baselineStateId)?.layers;
  const target=baseline?projectClinicalPlan(baseline,treatments,plan.devices??(plan.device?[plan.device]:[])):null;
  const diff=baseline&&target?archDifferences(baseline,target):[];
  const selected=selection.filter(n=>!plan.jaw||(n<30)===(plan.jaw==='felso'));
  const editable=!!onChange&&!disabled;
  function add() {
    if(!selected.length||!onChange)return;
    const next=[...treatments];
    for(const toothNumber of selected)if(!next.some(t=>t.toothNumber===toothNumber&&t.treatmentCode===code))next.push({toothNumber,treatmentCode:code});
    onChange(next);setSelection([]);
  }
  function move(index:number,direction:number) {
    if(!onChange)return;
    const next=[...treatments];[next[index],next[index+direction]]=[next[index+direction],next[index]];onChange(next);
  }
  return <section aria-label="Grafikus kezeléstervező" className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <div><h4 className="font-semibold text-slate-900 dark:text-slate-100">Fogíven tervezés</h4><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{editable?'Jelöld ki a fogakat, majd add hozzá a kívánt beavatkozást.':'A dokumentált kiindulás és a tervből számított célállapot.'}</p></div>
      <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs dark:bg-slate-800" role="group" aria-label="Tervező megjelenítése">
        <button type="button" aria-pressed={!preview} className={`rounded-lg px-3 py-2 ${!preview?'bg-white font-semibold shadow-sm dark:bg-slate-700':''}`} onClick={()=>setPreview(false)}>Kiindulás és kijelölés</button>
        <button type="button" aria-pressed={preview} className={`rounded-lg px-3 py-2 ${preview?'bg-white font-semibold shadow-sm dark:bg-slate-700':''}`} onClick={()=>setPreview(true)}>Célállapot előnézete</button>
      </div>
    </div>
    <div className="p-3 sm:p-5">
      {!baseline&&<p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Válassz kiindulási státuszt a célállapothoz. Addig a fogak állapota ismeretlen; beavatkozásokat már tervezhetsz.</p>}
      {preview&&target?<><div className="mb-4 flex items-center gap-2 text-sm font-medium text-teal-800 dark:text-teal-200"><ArrowRight className="h-4 w-4"/>Tervezett állapot <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs dark:bg-teal-950">{diff.length} eltérő fogpozíció</span></div><ClinicalArch layers={target} jaw={plan.jaw} changed={diff} label="Tervezett fogív"/></>:
        <ClinicalArch layers={baseline??emptyLayers()} jaw={plan.jaw} selected={selected} marked={treatments.map(t=>t.toothNumber)} onSelect={editable?n=>setSelection(s=>s.includes(n)?s.filter(v=>v!==n):[...s,n]):undefined} label="Kiindulási fogív és fogkijelölés"/>}
      {preview&&!target&&<p className="mt-3 text-sm text-slate-500">A célállapot még nem számítható ki dokumentált kiindulás nélkül.</p>}
      {editable&&!preview&&<div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-blue-900 dark:text-blue-100">{selected.length?`Kijelölve: ${[...selected].sort((a,b)=>a-b).join(', ')}`:'Kattints a kezelendő fogakra'}</span>{selected.length>0&&<button type="button" className="underline" onClick={()=>setSelection([])}>Kijelölés törlése</button>}</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tervezett beavatkozás típusa">{Object.entries(PLAN_TREATMENT_LABELS).map(([id,label])=><button key={id} type="button" aria-pressed={code===id} onClick={()=>setCode(id)} className={`rounded-lg border px-2.5 py-1.5 text-xs ${code===id?'border-blue-600 bg-blue-700 font-semibold text-white':'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>{label}</button>)}</div>
        <button type="button" disabled={!selected.length} onClick={add} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"><Plus className="h-4 w-4"/>{selected.length?`Hozzáadás a tervhez · ${selected.length} fog`:'Hozzáadás a tervhez'}</button>
      </div>}
      <div className="mt-5 flex items-center justify-between"><h5 className="text-sm font-semibold">Tervezett beavatkozások</h5><span className="text-xs text-slate-500">{treatments.length} lépés · végrehajtási sorrendben</span></div>
      {!treatments.length?<div className="mt-2 flex items-center gap-3 rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-700"><Plus className="h-5 w-5 shrink-0"/>Még nincs külön fogszintű beavatkozás a tervben.</div>:
        <ol className="mt-3 space-y-2">{treatments.map((t,i)=><li key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800">{i+1}</span><span className={`rounded-lg px-2 py-1 text-sm font-bold ${COLORS[t.treatmentCode]??'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{t.toothNumber}</span><span className="min-w-0 flex-1 text-sm font-medium">{PLAN_TREATMENT_LABELS[t.treatmentCode]??t.treatmentCode}</span>{editable&&<div className="flex shrink-0 gap-1"><button type="button" aria-label={`${i+1}. beavatkozás előrébb`} disabled={i===0} onClick={()=>move(i,-1)} className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-20 dark:hover:bg-slate-800"><ArrowUp className="h-4 w-4"/></button><button type="button" aria-label={`${i+1}. beavatkozás hátrébb`} disabled={i===treatments.length-1} onClick={()=>move(i,1)} className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-20 dark:hover:bg-slate-800"><ArrowDown className="h-4 w-4"/></button><button type="button" aria-label={`${i+1}. beavatkozás törlése`} onClick={()=>onChange?.(treatments.filter((_,j)=>i!==j))} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><X className="h-4 w-4"/></button></div>}</li>)}</ol>}
      {preview&&target&&<p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Check className="h-3.5 w-3.5"/>Ez a terv előnézete. A tényleges státusz külön, dokumentált eredmény alapján változik.</p>}
    </div>
  </section>;
}
