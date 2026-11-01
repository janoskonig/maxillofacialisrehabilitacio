'use client';
import { useState } from 'react';
import { canonical, emptyLayers, type ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { UPPER_ROW, LOWER_ROW, BASE_LABELS } from '@/components/patient-form/odontogram/tooth-conditions';

const valueLabel=(v:unknown):string => {
  if (v==null) return 'Ismeretlen';
  if (typeof v==='string') return v;
  const o=v as Record<string,unknown>;
  return Object.entries(o).map(([k,x])=>k==='base' ? BASE_LABELS[x as keyof typeof BASE_LABELS]??String(x) : `${k}: ${typeof x==='object'?JSON.stringify(x):String(x)}`).join('; ');
};
function atTooth(layers:ClinicalLayers,n:number) {
  return { tooth:layers.teeth[n],implant:layers.implants[n],prostheses:Object.values(layers.prostheses).filter(v=>v && typeof v==='object' && (v as {tooth?:number}).tooth===n) };
}
export function StatusComparison({data}:{data:ClinicalWorkspace}) {
  const [planId,setPlanId]=useState(''), [stateId,setStateId]=useState(''), [mode,setMode]=useState('before_plan');
  const [selected,setSelected]=useState<number|null>(null);
  const plan=data.plans.find(p=>p.id===planId)??data.plans[0];
  const actual=stateId ? data.milestones.find(m=>m.state.id===stateId)?.layers??emptyLayers() : data.actual;
  const baseline=plan?.content.baseline??emptyLayers(), target=plan?.content.target??emptyLayers();
  const left:ClinicalLayers=mode==='plan_actual'?target:baseline, right:ClinicalLayers=mode==='before_plan'?target:actual;
  return <section className="min-w-0 max-w-full rounded-xl border bg-white dark:bg-gray-900 p-4 space-y-4" aria-label="Fogazati státuszok összehasonlítása">
    <h2 className="font-semibold text-lg">Kiindulási, tervezett és tényleges státusz</h2>
    <div className="flex flex-wrap gap-3">
      <label className="min-w-0 max-w-full text-sm">Összehasonlítás<select className="block max-w-full rounded border p-2 dark:bg-gray-900" value={mode} onChange={e=>setMode(e.target.value)}>
        <option value="before_plan">Előtte ↔ tervezett utána</option><option value="before_actual">Előtte ↔ tényleges utána</option><option value="plan_actual">Terv ↔ megvalósult</option>
      </select></label>
      <label className="min-w-0 max-w-full text-sm">Tervverzió<select className="block max-w-full rounded border p-2 dark:bg-gray-900" value={plan?.id??''} onChange={e=>setPlanId(e.target.value)}>
        {!data.plans.length&&<option value="">Nincs dokumentált terv</option>}{data.plans.map(p=><option key={p.id} value={p.id}>{p.version}. változat · {p.content.description.slice(0,50)} {p.approved?'(jóváhagyott)':p.baseline_state_id?'(tervezet)':'(szöveges tervezet, nincs kiindulási státusz)'}</option>)}
      </select></label>
      <label className="min-w-0 max-w-full text-sm">Tényleges köztes állapot<select className="block max-w-full rounded border p-2 dark:bg-gray-900" value={stateId} onChange={e=>setStateId(e.target.value)}>
        <option value="">Legutóbbi dokumentált állapot</option>{data.milestones.map(m=><option key={m.state.id} value={m.state.id}>{m.state.occurred_on} · {m.state.note||m.state.source}</option>)}
      </select></label>
    </div>
    <p className="text-sm text-gray-600 dark:text-gray-300">A sárga jelölés eltérést mutat. A kérdőjel hiányzó adatot jelent. Kattintson egy fogpozícióra a rétegek és a forrás megtekintéséhez.</p>
    {(!plan?.content.baseline || !data.states.length)&&<p className="text-amber-700">Az összehasonlítás hiányos: rögzített kiindulási státusz, terv és tényleges vizsgálat szükséges. A tervet a Kezelés fülön egészítheti ki.</p>}
    <div className="overflow-x-auto"><div className="grid grid-cols-2 gap-5 min-w-[1120px]">
      {[{title:mode==='plan_actual'?'Tervezett':'Kiindulási',layers:left},{title:mode==='before_plan'?'Tervezett':'Tényleges',layers:right}].map((side,i)=><div key={i}>
        <h3 className="font-medium mb-3">{side.title}</h3>
        {[UPPER_ROW,LOWER_ROW].map((row,j)=><div key={j} className="grid gap-1 mb-4" style={{gridTemplateColumns:'repeat(16,minmax(0,1fr))'}} aria-label={j?'Alsó fogív':'Felső fogív'}>{row.map(n=>{
          const cell=atTooth(side.layers,n), diff=canonical(atTooth(left,n))!==canonical(atTooth(right,n));
          const t=cell.tooth as {base?:string}|undefined;
          return <button type="button" key={n} onClick={()=>setSelected(n)} title={`${n}: ${valueLabel(cell.tooth)}`} className={`rounded-t-xl rounded-b-md border px-1 py-2 text-xs ${diff?'bg-amber-100 border-amber-500 text-gray-900':'bg-gray-50 dark:bg-gray-800'}`}>
            <strong>{n}</strong><span className="block">{t?.base==='missing'?'Hiány':cell.tooth?'Fog':'?'}</span><span className="block">{cell.implant&&(cell.implant as {present?:boolean}).present!==false?'I':'·'} {cell.prostheses.length?'P':'·'}</span>
          </button>;
        })}</div>)}
      </div>)}
    </div></div>
    {selected&&<div className="rounded-lg border p-3 space-y-2" role="status"><h3 className="font-semibold">{selected}. pozíció</h3>
      {[{label:'Bal oldal',layers:left},{label:'Jobb oldal',layers:right}].map(s=>{const v=atTooth(s.layers,selected);return <div key={s.label}><strong>{s.label}</strong><p>Saját fog: {valueLabel(v.tooth)} · Implantátum: {valueLabel(v.implant)}</p>{v.prostheses.map((p,i)=><p key={i}>Fogpótlás: {valueLabel(p)}</p>)}</div>;})}
      <p className="text-sm">Terv forrása: {plan?.id??'nincs'}; státusz: {stateId||data.milestones.at(-1)?.state.event_id||'nincs'}</p>
      {data.events.filter(e=>e.kind==='status' && (e.payload.command.layers?.teeth?.[selected]!==undefined || Object.values(e.payload.command.layers?.prostheses??{}).some((p:any)=>p?.tooth===selected))).map(e=><p key={e.id} className="text-sm">{String(e.occurred_on).slice(0,10)} · {e.note} · {e.source} · rögzítette: {e.recorder}, {new Date(e.recorded_at).toLocaleString('hu-HU')} · esemény: {e.id}</p>)}
    </div>}
  </section>;
}
