'use client';

import { useState } from 'react';
import { BASE_LABELS,NATURAL_TOOTH_BASE_OPTIONS,readConditions,patchToothConditions,UPPER_ROW,LOWER_ROW,type ToothConditions } from '@/components/patient-form/odontogram/tooth-conditions';
import { emptyLayers, type ClinicalLayers, type Position } from '@/lib/prosthesis-lifecycle/model';
import { ClinicalArch } from './ClinicalArch';
import { formInput } from './WorkflowForm';
import { ToothEditor } from '@/components/patient-form/odontogram/ToothEditor';
import { normalizeToothData,type ToothStatus } from '@/lib/tooth-data';
import { observedComponents,setObservedComponents } from '@/lib/prosthesis-findings';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';
import { COMPONENT_CONTEXTS,COMPONENT_IDS,PROSTHESIS_COMPONENTS,positionLabel,MAX_PROSTHESIS_POSITIONS } from '@/lib/prosthesis-components';

export function ProsthesisPositionField({jaw,positions,onChange,expanded=false}:{expanded?:boolean;jaw:'felso'|'also'|'';positions:Position[];onChange:(positions:Position[])=>void}) {
  const [role,setRole]=useState<Position['role']|''>('');
  const selected=positions.filter(p=>p.role===role).map(p=>p.tooth);
  const layers=emptyLayers();for(const p of positions)layers.prostheses[`${p.tooth}:${p.role}`]=p;
  return <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={expanded}><summary className="cursor-pointer text-sm font-medium">A pótlás helye a fogíven · {positions.length?`${positions.length} megadott pozíció`:'ha ismert'}</summary><div className="mt-3 space-y-3">
    <p className="text-xs text-slate-500">Válassz elemet, majd kattints a megfelelő foghelyekre. Egy foghelyhez több elem is rendelhető; a korábbi jelölések megmaradnak.</p>
    <label className="block text-sm font-medium">Mit jelölsz a fogíven?<select className={formInput} value={role} onChange={e=>setRole(e.target.value as Position['role'])}><option value="">Válassz elemet…</option>{Object.entries(COMPONENT_CONTEXTS).map(([context,label])=><optgroup key={context} label={label}>{COMPONENT_IDS.filter(id=>PROSTHESIS_COMPONENTS[id].context===context).map(id=><option key={id} value={id}>{PROSTHESIS_COMPONENTS[id].label}</option>)}</optgroup>)}</select></label>{!role&&<p className="text-xs text-slate-500">Előbb válassz konkrét elemet a három csoport egyikéből.</p>}
    {!jaw?<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Előbb válaszd ki, hogy felső vagy alsó fogpótlásról van szó.</p>:<ClinicalArch jaw={jaw} layers={layers} selected={selected} label="Fogpótlás helyének kijelölése" onSelect={role?tooth=>{if(selected.includes(tooth))onChange(positions.filter(p=>!(p.tooth===tooth&&p.role===role)));else if(positions.length<MAX_PROSTHESIS_POSITIONS)onChange([...positions,{tooth,role}]);}:undefined}/>}
    {!!positions.length&&<div className="flex flex-wrap gap-2">{positions.map((p,i)=><button key={`${p.tooth}:${p.role}`} type="button" aria-label={`${p.tooth}. ${positionLabel(p.role,true)} eltávolítása`} className="rounded-lg border px-2 py-1 text-xs" onClick={()=>onChange(positions.filter((_,j)=>j!==i))}>{p.tooth} · {positionLabel(p.role,true)} ×</button>)}</div>}
    <p className="text-xs text-slate-500">A pótlás helyének kijelölése a saját fogak vizsgálati állapotát nem módosítja.</p>
  </div></details>;
}

export function DentalAssessmentField({layers,onChange,expanded=false,disabled=false}:{layers:ClinicalLayers;onChange:(layers:ClinicalLayers)=>void;expanded?:boolean;disabled?:boolean}) {
  const [selected,setSelected]=useState<number|null>(null),[sheetOpen,setSheetOpen]=useState(false);
  const mobile=useBreakpoint()==='mobile';
  function updateBase(tooth:number,value:string){
    const next=structuredClone(layers),finding={...(normalizeToothData(next.teeth[tooth] as ToothStatus)??{})};
    if(finding.status==='D'&&finding.caries===undefined)finding.caries=true;
    delete finding.status;
    if(value)finding.base=value as NonNullable<typeof finding.base>;else delete finding.base;
    if(Object.keys(finding).length)next.teeth[tooth]=finding;else delete next.teeth[tooth];
    onChange(next);
  }
  function patchFinding(tooth:number,patch:Partial<ToothConditions>){
    if(disabled)return;
    if(patch.components){onChange(setObservedComponents(layers,tooth,patch.components));return;}
    const next=structuredClone(layers),value=patchToothConditions(next.teeth[tooth] as ToothStatus,patch);
    if(value===undefined)delete next.teeth[tooth];else next.teeth[tooth]=value;
    onChange(next);
  }
  const fields=(tooth:number)=>{
    const raw=normalizeToothData(layers.teeth[tooth] as ToothStatus);
    const base=raw?.base??(raw?.status?readConditions(raw).base:''),components=observedComponents(layers,tooth);
    const detail=<ToothEditor fdi={tooth} conditions={{...readConditions(layers.teeth[tooth] as ToothStatus),components}} showBase={false} onChange={patch=>patchFinding(tooth,patch)} disabled={disabled} touch={mobile}/>;
    return <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Saját fog állapota<select aria-label={`${tooth}. saját fog`} className={formInput} value={base} onChange={e=>updateBase(tooth,e.target.value)}><option value="">Nem ismert / nincs bejegyzés</option>{base&&!NATURAL_TOOTH_BASE_OPTIONS.includes(base)&&<option value={base}>{BASE_LABELS[base as keyof typeof BASE_LABELS]??base} · korábbi jelölés</option>}{NATURAL_TOOTH_BASE_OPTIONS.map(id=><option key={id} value={id}>{BASE_LABELS[id]}</option>)}</select></label>
        <label className="text-sm">Implantátum<select aria-label={`${tooth}. implantátum`} className={formInput} value={layers.implants[tooth]===undefined?'':(layers.implants[tooth] as any)?.present===true?'yes':(layers.implants[tooth] as any)?.present===false?'no':''} onChange={e=>{
          const next=structuredClone(layers);for(const [key,value] of Object.entries(next.prostheses))if((value as any)?.tooth===tooth&&(value as any)?.role==='position_implant')delete next.prostheses[key];
          const raw=normalizeToothData(next.teeth[tooth] as ToothStatus);if(raw?.components)next.teeth[tooth]={...raw,components:raw.components.filter(role=>role!=='position_implant')};
          if(e.target.value)next.implants[tooth]={...(next.implants[tooth] as object??{}),present:e.target.value==='yes'};
          else {const {present,...detail}=(next.implants[tooth]??{}) as Record<string,unknown>;if(Object.keys(detail).length)next.implants[tooth]=detail;else delete next.implants[tooth];}
          onChange(next);
        }}><option value="">Nem ismert / nincs bejegyzés</option><option value="yes">Implantátum jelen</option><option value="no">Implantátum nincs</option></select></label>
      </div>
      {expanded?<details><summary className="cursor-pointer text-sm">Részletes lelet és fogpótlási elemek · {components.length}</summary><div className="mt-3">{detail}</div></details>:detail}
    </fieldset>;
  };
  const panel=selected!==null?<fieldset className="min-w-0 rounded-xl bg-blue-50 p-3 dark:bg-blue-950/40"><legend className="text-sm font-semibold">{selected}. foghely</legend>{fields(selected)}</fieldset>:null;
  return <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <div><h3 className="text-sm font-semibold">Mit mutatott a vizsgálat?</h3><p className="mt-1 text-xs text-slate-500">Kattints egy foghelyre. A vizsgálati lelet és a megfigyelt fogpótlási elemek külön megadhatók; a nem ismert adatokat hagyd üresen.</p></div>
    <ClinicalArch layers={layers} selected={selected===null?[]:[selected]} label="Vizsgált fog kiválasztása" onSelect={expanded||disabled?undefined:tooth=>{setSelected(tooth);if(mobile)setSheetOpen(true);}}/>
    {expanded?[UPPER_ROW,LOWER_ROW].map((row,i)=><fieldset key={i}><legend className="mb-2 text-sm font-semibold">{i?'Alsó':'Felső'} állcsont · minden fog</legend><div className="grid gap-2 md:grid-cols-2">{row.map(tooth=><div key={tooth} className="min-w-0 rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="mb-2 font-semibold">{tooth}. foghely</p>{fields(tooth)}</div>)}</div></fieldset>):mobile?<>
      {selected!==null&&<button type="button" className="w-full rounded-xl border p-3 text-sm" onClick={()=>setSheetOpen(true)}>{selected}. foghely · lelet és fogpótlási elemek</button>}
      <MobileBottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Vizsgált foghely">{panel}<button type="button" className="mt-4 w-full rounded-xl bg-blue-700 p-3 text-sm text-white" onClick={()=>setSheetOpen(false)}>Kész – vissza a fogívhez</button></MobileBottomSheet>
    </>:panel??<p className="text-sm text-slate-500">Válassz egy foghelyet a fenti ábrán.</p>}
    <p className="text-xs text-slate-500">A megfigyelt elemek a vizsgálat leletét rögzítik. A készüléknyilvántartást és a kezelési tervet külön dokumentáljuk.</p>
  </div>;
}
