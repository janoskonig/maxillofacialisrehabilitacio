'use client';

import { useState } from 'react';
import { BASE_LABELS,UPPER_ROW,LOWER_ROW } from '@/components/patient-form/odontogram/tooth-conditions';
import { emptyLayers, type ClinicalLayers, type Position } from '@/lib/prosthesis-lifecycle/model';
import { ClinicalArch, POSITION_ROLES } from './ClinicalArch';
import { formInput } from './WorkflowForm';

const roleHints:Record<string,string>={denture_tooth:'A pótlás műfoga ezen a helyen.',pontic:'A híd hiányzó fogat helyettesítő része.',abutment:'A pótlást tartó pillérfog.',implant:'A pótláshoz tartozó implantátum helye.',clasp:'Kapocs helye.',attachment:'Egyéb elhorgonyzó elem helye.'};
export function ProsthesisPositionField({jaw,positions,onChange,expanded=false}:{expanded?:boolean;jaw:'felso'|'also'|'';positions:Position[];onChange:(positions:Position[])=>void}) {
  const [role,setRole]=useState<Position['role']>('denture_tooth');
  const selected=positions.filter(p=>p.role===role).map(p=>p.tooth);
  const layers=emptyLayers();for(const p of positions)layers.prostheses[`${p.tooth}:${p.role}`]=p;
  return <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={expanded}><summary className="cursor-pointer text-sm font-medium">A pótlás helye a fogíven · {positions.length?`${positions.length} megadott pozíció`:'ha ismert'}</summary><div className="mt-3 space-y-3">
    <p className="text-xs text-slate-500">Válassz szerepet, majd kattints a megfelelő foghelyekre. Ugyanarra a foghelyre több különböző szerepet is megadhatsz.</p>
    <label className="block text-sm font-medium">Mit jelölsz a fogíven?<select className={formInput} value={role} onChange={e=>setRole(e.target.value as Position['role'])}>{Object.entries(POSITION_ROLES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><p className="text-xs text-slate-500">{roleHints[role]}</p>
    {!jaw?<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Előbb válaszd ki, hogy felső vagy alsó fogpótlásról van szó.</p>:<ClinicalArch jaw={jaw} layers={layers} selected={selected} label="Fogpótlás helyének kijelölése" onSelect={tooth=>onChange(selected.includes(tooth)?positions.filter(p=>!(p.tooth===tooth&&p.role===role)):[...positions,{tooth,role}])}/>}
    {!!positions.length&&<div className="flex flex-wrap gap-2">{positions.map((p,i)=><button key={`${p.tooth}:${p.role}`} type="button" aria-label={`${p.tooth}. ${POSITION_ROLES[p.role]} eltávolítása`} className="rounded-lg border px-2 py-1 text-xs" onClick={()=>onChange(positions.filter((_,j)=>j!==i))}>{p.tooth} · {POSITION_ROLES[p.role]} ×</button>)}</div>}
    <p className="text-xs text-slate-500">A pótlás helyének kijelölése a saját fogak vizsgálati állapotát nem módosítja.</p>
  </div></details>;
}

export function DentalAssessmentField({layers,onChange,expanded=false}:{layers:ClinicalLayers;onChange:(layers:ClinicalLayers)=>void;expanded?:boolean}) {
  const [selected,setSelected]=useState<number|null>(null);
  function update(layer:'teeth'|'implants',value:unknown,tooth=selected){
    if(tooth===null)return;const next=structuredClone(layers);
    if(value===undefined)delete next[layer][String(tooth)];else next[layer][String(tooth)]=value;
    onChange(next);
  }
  const fields=(tooth:number)=><div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm">Saját fog állapota<select aria-label={`${tooth}. saját fog`} className={formInput} value={(layers.teeth[tooth] as any)?.base??''} onChange={e=>update('teeth',e.target.value?{base:e.target.value}:undefined,tooth)}><option value="">Nem ismert / nincs bejegyzés</option>{Object.entries(BASE_LABELS).filter(([id])=>!['implant','bridge_pontic','denture_tooth'].includes(id)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <label className="text-sm">Implantátum<select aria-label={`${tooth}. implantátum`} className={formInput} value={layers.implants[tooth]===undefined?'':(layers.implants[tooth] as any)?.present?'yes':'no'} onChange={e=>update('implants',e.target.value?{present:e.target.value==='yes'}:undefined,tooth)}><option value="">Nem ismert / nincs bejegyzés</option><option value="yes">Implantátum jelen</option><option value="no">Implantátum nincs</option></select></label>
  </div>;
  return <div className="space-y-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <div><h3 className="text-sm font-semibold">Mit mutatott a vizsgálat?</h3><p className="mt-1 text-xs text-slate-500">{expanded?'Minden fog adata közvetlenül szerkeszthető az alábbi mezőkben.':'Kattints egy fogra, majd add meg a megfigyelt állapotát.'} A nem vizsgált vagy nem ismert adatok üresen maradnak.</p></div>
    <ClinicalArch layers={layers} selected={selected===null?[]:[selected]} label="Vizsgált fog kiválasztása" onSelect={expanded?undefined:setSelected}/>
    {expanded?[UPPER_ROW,LOWER_ROW].map((row,i)=><fieldset key={i}><legend className="mb-2 text-sm font-semibold">{i?'Alsó':'Felső'} állcsont · minden fog</legend><div className="grid gap-2 md:grid-cols-2">{row.map(tooth=><div key={tooth} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="mb-2 font-semibold">{tooth}. foghely</p>{fields(tooth)}</div>)}</div></fieldset>):selected!==null?<fieldset className="rounded-xl bg-blue-50 p-3 dark:bg-blue-950/40"><legend className="text-sm font-semibold">{selected}. foghely</legend>{fields(selected)}</fieldset>:<p className="text-sm text-slate-500">Válassz egy foghelyet a fenti ábrán.</p>}
    <p className="text-xs text-slate-500">Saját fog és implantátum külön adat. A hiányzó saját fog helyén implantátum és fogpótlás is jelen lehet.</p>
  </div>;
}
