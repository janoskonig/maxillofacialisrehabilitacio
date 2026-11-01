'use client';

import { useState } from 'react';
import { ArrowLeftRight, CalendarDays, Layers } from 'lucide-react';
import { emptyLayers, type ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { ClinicalArch, archDifferences, positionDescription } from './ClinicalArch';

const MODES = [
  {id:'before_plan',label:'Előtte ↔ tervezett utána',left:'Kiindulási állapot',right:'Tervezett célállapot'},
  {id:'before_actual',label:'Előtte ↔ tényleges utána',left:'Kiindulási állapot',right:'Tényleges állapot'},
  {id:'plan_actual',label:'Terv ↔ megvalósult',left:'Tervezett célállapot',right:'Tényleges állapot'},
];

export function StatusComparison({data}:{data:ClinicalWorkspace}) {
  const [planId,setPlanId]=useState(''),[stateId,setStateId]=useState(''),[mode,setMode]=useState(MODES[0].id);
  const [selected,setSelected]=useState<number|null>(null);
  const plan=data.plans.find(p=>p.id===planId)??data.plans[0];
  const actual=stateId?data.milestones.find(m=>m.state.id===stateId)?.layers??emptyLayers():data.actual;
  const baseline=plan?.content.baseline??emptyLayers(),target=plan?.content.target??emptyLayers();
  const left:ClinicalLayers=mode==='plan_actual'?target:baseline,right:ClinicalLayers=mode==='before_plan'?target:actual;
  const comparison=MODES.find(m=>m.id===mode)!;
  const differences=archDifferences(left,right);
  const selectStyle='mt-1 block w-full min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900';
  return <section aria-label="Fogazati státuszok összehasonlítása" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Fogazati állapotok összehasonlítása</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Azonos fogívek, külön sajátfog-, implantátum- és fogpótlásjelöléssel.</p></div><span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"><ArrowLeftRight className="h-4 w-4"/>{differences.length} eltérő fogpozíció</span></div>
    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Összehasonlítás">{MODES.map(m=><button key={m.id} type="button" aria-pressed={mode===m.id} onClick={()=>setMode(m.id)} className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${mode===m.id?'border-blue-600 bg-blue-700 text-white shadow-sm':'border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>{m.label}</button>)}</div>
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 dark:border-slate-700 dark:bg-slate-950">
      <label className="min-w-0 text-xs font-medium text-slate-500"><span className="flex items-center gap-1.5"><Layers className="h-4 w-4"/>Tervverzió</span><select className={selectStyle} value={plan?.id??''} onChange={e=>setPlanId(e.target.value)}>{!data.plans.length&&<option value="">Nincs dokumentált terv</option>}{data.plans.map(p=><option key={p.id} value={p.id}>{p.version}. változat · {p.content.description.slice(0,60)||'Szöveges tervezet'} · {p.approved?'jóváhagyott':'tervezet'}</option>)}</select></label>
      <label className="min-w-0 text-xs font-medium text-slate-500"><span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4"/>Tényleges köztes állapot</span><select className={selectStyle} disabled={mode==='before_plan'} value={stateId} onChange={e=>setStateId(e.target.value)}><option value="">Legutóbbi dokumentált állapot</option>{data.milestones.map(m=><option key={m.state.id} value={m.state.id}>{m.state.occurred_on} · {m.state.note||m.state.source}</option>)}</select></label>
    </div>
    {(!plan?.content.baseline||!data.states.length)&&<p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Az összehasonlítás hiányos. A kérdőjel ismeretlen adatot jelent. A kiindulási státuszt és a tervet a Kezelés fülön kapcsolhatod össze.</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">{[{title:comparison.left,layers:left},{title:comparison.right,layers:right}].map((side,i)=><article key={i} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-5 dark:border-slate-700 dark:bg-slate-950"><div className="mb-5 flex items-center gap-3"><span className={`flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold ${i?'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200':'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200'}`}>{i?'B':'A'}</span><h3 className="font-semibold">{side.title}</h3></div><ClinicalArch layers={side.layers} changed={differences} selected={selected?[selected]:[]} onSelect={setSelected} label={side.title}/></article>)}</div>
    <p className="text-xs text-slate-500">Kattints egy fogra: mindkét oldalon kijelölődik, alatta megjelennek az adatai és a dokumentált források.</p>
    {selected&&<div role="status" className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30"><h3 className="mb-3 font-semibold">{selected}. fogpozíció</h3><div className="grid gap-3 md:grid-cols-2">{[{label:comparison.left,layers:left},{label:comparison.right,layers:right}].map(s=><div key={s.label} className="rounded-xl bg-white p-3 text-sm dark:bg-slate-900"><strong>{s.label}</strong><p className="mt-1 text-slate-600 dark:text-slate-300">{positionDescription(s.layers,selected)}</p></div>)}</div><div className="mt-3 space-y-1 text-xs text-slate-500">{data.events.filter(e=>e.active!==false&&e.kind==='status'&&(e.payload.command.layers?.teeth?.[selected]!==undefined||e.payload.command.layers?.implants?.[selected]!==undefined||Object.values(e.payload.command.layers?.prostheses??{}).some((p:any)=>p?.tooth===selected))).map(e=><p key={e.id}>{String(e.occurred_on).slice(0,10)} · {e.note||e.source} · rögzítette: {e.recorder}, {new Date(e.recorded_at).toLocaleString('hu-HU')}</p>)}</div></div>}
  </section>;
}
