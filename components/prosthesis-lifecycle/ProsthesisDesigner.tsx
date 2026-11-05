'use client';

import { useState } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';
import { COMPONENT_CONTEXTS,COMPONENT_IDS,PROSTHESIS_COMPONENTS,MAX_PROSTHESIS_POSITIONS,isDetailedPositionRole,positionLabel,positionAnnotations,type ComponentContext,type ProsthesisComponent } from '@/lib/prosthesis-components';
import { Check, Layers, Link2, MoreHorizontal, RotateCcw } from 'lucide-react';
import { UPPER_ROW,LOWER_ROW } from '@/components/patient-form/odontogram/tooth-conditions';
import { FIXED_TYPES,REMOVABLE_TYPES,isFixedDevice } from '@/lib/prosthesis-types';
import type { ClinicalLayers,Position } from '@/lib/prosthesis-lifecycle/model';
import { prosthesisCategory,suggestedProsthesisLabel } from '@/lib/prosthesis-registration';
import { ClinicalArch } from './ClinicalArch';
import { formInput } from './WorkflowForm';

export type ProsthesisDraft={jaw:''|'felso'|'also';prosthesisType:string;role:string;label:string;positions:Position[];specification:Record<string,unknown>};
const selectedClass='border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100';
const plainClass='border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950';

export function ProsthesisDesigner({value,onChange,background,backgroundLabel,conflicted,occupiedJaws,expert=false,existing=false,disabled=false}:{
  value:ProsthesisDraft;onChange:(patch:Partial<ProsthesisDraft>)=>void;background:ClinicalLayers;backgroundLabel:string;
  conflicted:boolean;occupiedJaws:string[];expert?:boolean;existing?:boolean;disabled?:boolean;
}){
  const mobile=useBreakpoint()==='mobile';
  const [selected,setSelected]=useState<number[]>([]),[multiple,setMultiple]=useState(false),[sheetOpen,setSheetOpen]=useState(false);
  const [context,setContext]=useState<ComponentContext>('tooth');
  const initialType=String(value.specification.clinicalType??'');
  const [group,setGroup]=useState<'fixed'|'removable'|'other'|''>((FIXED_TYPES as readonly string[]).includes(initialType)?'fixed':(REMOVABLE_TYPES as readonly string[]).includes(initialType)?'removable':'');
  const [error,setError]=useState('');
  const type=String(value.specification.clinicalType??'');
  const annotations=positionAnnotations(value.positions);
  const taken=!!value.jaw&&occupiedJaws.includes(value.jaw);
  const blocked=taken&&!!value.prosthesisType&&!isFixedDevice(value.prosthesisType);
  function selectTeeth(teeth:number[],batch=false){
    if(batch)setMultiple(true);
    const next=batch?teeth:multiple?selected.includes(teeth[0])?selected.filter(n=>n!==teeth[0]):selected.length&&(selected[0]<30)!==(teeth[0]<30)?teeth:[...selected,teeth[0]]:teeth;
    setSelected(next);setError('');if(next.length&&mobile)setSheetOpen(true);
  }
  function toggleComponent(component:ProsthesisComponent){
    if(!selected.length||disabled)return;
    const jaw=selected[0]<30?'felso':'also';
    const remove=selected.every(tooth=>value.positions.some(p=>p.tooth===tooth&&p.role===component));
    if(!remove&&value.positions.some(p=>(p.tooth<30)!==(jaw==='felso'))){setError('Egy fogpótlás egy állcsonthoz tartozik. A másik állcsont készülékét külön vedd fel, vagy előbb töröld az elemeket.');return;}
    if(!remove&&value.prosthesisType&&!isFixedDevice(value.prosthesisType)&&occupiedJaws.includes(jaw)){setError('Ezen az állcsonton már van kivehető fogpótlás. Újabb rögzített pótlás megadható.');return;}
    const positions=remove?value.positions.filter(p=>!(selected.includes(p.tooth)&&p.role===component)):[...value.positions,...selected.filter(tooth=>!value.positions.some(p=>p.tooth===tooth&&p.role===component)).map(tooth=>({tooth,role:component}))];
    if(positions.length>MAX_PROSTHESIS_POSITIONS){setError('Túl sok elem tartozik ehhez a fogpótláshoz.');return;}
    setError('');onChange({positions,jaw:positions.length?(positions[0].tooth<30?'felso':'also'):''});
  }
  function chooseType(clinicalType:string){
    const category=prosthesisCategory(clinicalType)??'other';
    if(taken&&!isFixedDevice(category)){setError('Ezen az állcsonton már van kivehető fogpótlás; rögzítettből több is megadható.');return;}
    setError('');onChange({prosthesisType:category,specification:{...value.specification,clinicalType}});
  }
  const spec=(key:string,next:unknown)=>onChange({specification:{...value.specification,[key]:next}});
  const proposedLabel=suggestedProsthesisLabel(value);
  const inspector=<fieldset disabled={disabled} aria-label="Foghelyhez rendelt elemek" className="min-w-0 space-y-3">
    <div><h4 className="font-semibold">{selected.length?`${selected.join(', ')}. foghely${selected.length>1?'ek':''}`:'Válassz foghelyet az ábrán'}</h4><p className="mt-1 text-xs text-slate-500">Egy foghelyhez több elem is rendelhető. A kiválasztott elemre újra kattintva eltávolíthatod.</p></div>
    {selected.length>0&&<>
      <div role="group" aria-label="Az elem helye" className="grid grid-cols-3 gap-1">{(Object.entries(COMPONENT_CONTEXTS) as Array<[ComponentContext,string]>).map(([id,label])=><button key={id} type="button" aria-pressed={context===id} className={`min-w-0 rounded-lg border px-2 py-2 text-xs ${context===id?selectedClass:plainClass}`} onClick={()=>setContext(id)}>{label}</button>)}</div>
      <div role="group" aria-label={`${COMPONENT_CONTEXTS[context]} választható elemek`} className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-1">{COMPONENT_IDS.filter(id=>PROSTHESIS_COMPONENTS[id].context===context).map(id=>{
        const item=PROSTHESIS_COMPONENTS[id],count=selected.filter(tooth=>value.positions.some(p=>p.tooth===tooth&&p.role===id)).length;
        const checked=count===selected.length,mixed=count>0&&!checked;
        return <button key={id} type="button" aria-label={item.label} aria-pressed={mixed?'mixed':checked} className={`flex min-w-0 items-start gap-2 rounded-xl border p-2.5 text-left text-sm ${checked?selectedClass:mixed?'border-amber-400 bg-amber-50 dark:bg-amber-950':plainClass}`} onClick={()=>toggleComponent(id)}><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border">{checked&&<Check className="h-3 w-3"/>}{mixed&&'−'}</span><span>{item.label}</span></button>;
      })}</div>
      {value.positions.some(p=>selected.includes(p.tooth))&&<div className="space-y-1 border-t pt-2 text-xs"><p className="font-medium">Ehhez a kijelöléshez rögzítve</p>{value.positions.filter(p=>selected.includes(p.tooth)).map(p=><p key={`${p.tooth}:${p.role}`}>{p.tooth} · {positionLabel(p.role,true)}</p>)}</div>}
    </>}
    {error&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{error}</p>}
  </fieldset>;
  return <div className="min-w-0 space-y-5">
    <section aria-label="Fogpótlás kijelölése az odontogramon" className="min-w-0 space-y-3 rounded-2xl border border-blue-200 bg-white p-3 sm:p-4 dark:border-blue-900 dark:bg-slate-950">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">1. Válassz foghelyet és rendelj hozzá elemeket</h3><p className="mt-1 text-xs text-slate-500">Kattints egy foghelyre, majd válaszd ki a fogra, foghelyre vagy implantátumra kerülő elemeket.</p></div>{value.positions.length>0&&<button type="button" className="inline-flex items-center gap-1 text-xs underline" onClick={()=>{setError('');onChange({jaw:'',positions:[]});}}><RotateCcw className="h-3.5 w-3.5"/>Összes elem törlése</button>}</div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <ClinicalArch layers={background} selected={selected} marked={value.positions.map(p=>p.tooth)} annotations={annotations} label="Fogpótlás helyének kijelölése" onSelect={tooth=>selectTeeth([tooth])}/>
          <div className="flex flex-wrap items-center gap-2"><label className="mr-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={multiple} onChange={e=>{setMultiple(e.target.checked);if(!e.target.checked&&selected.length>1)setSelected([selected[0]]);}}/>Több foghely kijelölése</label><button type="button" className="rounded-lg border px-2.5 py-2 text-xs" onClick={()=>selectTeeth(UPPER_ROW,true)}>Összes felső foghely</button><button type="button" className="rounded-lg border px-2.5 py-2 text-xs" onClick={()=>selectTeeth(LOWER_ROW,true)}>Összes alsó foghely</button></div>
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">{backgroundLabel}{conflicted&&<span className="ml-2 text-amber-700 dark:text-amber-300"> · eltérések ellenőrizendők</span>}</div>
        </div>
        {!mobile&&<div className="min-w-0 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">{inspector}</div>}
      </div>
      {mobile&&selected.length>0&&<button type="button" className="w-full rounded-xl border border-blue-300 p-3 text-left text-sm" onClick={()=>setSheetOpen(true)}>{selected.join(', ')}. foghely · elemek szerkesztése</button>}
      {mobile&&<MobileBottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Foghely elemei">{inspector}<button type="button" className="mt-4 w-full rounded-xl bg-blue-700 p-3 text-sm font-medium text-white" onClick={()=>setSheetOpen(false)}>Kész – vissza a fogívhez</button></MobileBottomSheet>}
      {value.positions.length>0&&<div aria-label="Kijelölt pozíciók" className="flex flex-wrap gap-1.5">{value.positions.map(p=><button key={`${p.tooth}:${p.role}`} type="button" aria-label={`${p.tooth}. ${positionLabel(p.role,true)} eltávolítása`} className={`min-w-0 break-words rounded-lg px-2 py-1.5 text-left text-xs ${isDetailedPositionRole(p.role)?'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100':'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}`} onClick={()=>{setError('');const positions=value.positions.filter(x=>x!==p);onChange({positions,jaw:positions.length?value.jaw:''});}}>{p.tooth} · {positionLabel(p.role,true)} ×</button>)}</div>}
      {value.positions.some(p=>!isDetailedPositionRole(p.role))&&<p className="text-xs text-amber-700 dark:text-amber-300">A korábbi általános jelölések megmaradtak. Ezekből nem következtetünk automatikusan a részletes elem típusára.</p>}
      {!value.positions.length&&<details className="text-sm"><summary className="cursor-pointer text-slate-500">A foghelyek még nem ismertek</summary><fieldset className="mt-2"><legend className="text-xs">Állcsont</legend><div className="mt-1 flex gap-2">{(['felso','also'] as const).map(jaw=><button key={jaw} type="button" aria-pressed={value.jaw===jaw} className={`rounded-xl border px-4 py-2 ${value.jaw===jaw?selectedClass:plainClass}`} onClick={()=>onChange({jaw})}>{jaw==='felso'?'Felső':'Alsó'}</button>)}</div></fieldset></details>}
      <p className="text-xs text-slate-500">A háttér a rögzített fogstátusz; az új elemek a készülékhez tartoznak. A kijelölés nem módosítja a saját fogak vagy a meglévő implantátumok állapotát.</p>
    </section>
    <section aria-label="Fogpótlás szakmai típusa" className="space-y-3"><h3 className="font-semibold">2. Milyen fogpótlás?</h3>
      <div role="group" aria-label="Pótláscsoport" className="grid grid-cols-3 gap-2">{([{id:'fixed',label:'Rögzített',icon:Link2},{id:'removable',label:'Kivehető / zárólemez',icon:Layers},{id:'other',label:'Egyéb',icon:MoreHorizontal}] as const).map(item=><button key={item.id} type="button" aria-pressed={group===item.id} className={`min-w-0 rounded-xl border p-3 text-left text-sm ${group===item.id?selectedClass:plainClass}`} onClick={()=>{setGroup(item.id);if(item.id==='other')chooseType('');}}><item.icon className="mb-2 h-5 w-5"/>{item.label}</button>)}</div>
      {group&&group!=='other'&&<div role="group" aria-label="Részletes fogpótlástípus" className="grid gap-2 sm:grid-cols-2">{(group==='fixed'?FIXED_TYPES:REMOVABLE_TYPES).map(clinicalType=><button key={clinicalType} type="button" aria-pressed={type===clinicalType} disabled={taken&&!isFixedDevice(prosthesisCategory(clinicalType)??'other')} className={`flex min-w-0 items-start gap-2 rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${type===clinicalType?selectedClass:plainClass}`} onClick={()=>chooseType(clinicalType)}><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border">{type===clinicalType&&<Check className="h-3 w-3"/>}</span>{clinicalType}</button>)}</div>}
      {group==='other'&&<label className="block text-sm">Pontos típus<input className={formInput} maxLength={160} value={type} onChange={e=>chooseType(e.target.value)}/></label>}
      {taken&&<p className="text-xs text-amber-700 dark:text-amber-300">A kiválasztott állcsonton már van kivehető fogpótlás. Rögzítettből több is felvehető.</p>}
      {blocked&&<p role="alert" className="text-sm text-amber-800">A kiválasztott típus ütközik a meglévő kivehető fogpótlással.</p>}
    </section>
    <fieldset aria-label="Ideiglenes vagy végleges?"><legend className="mb-2 font-semibold">3. Ideiglenes vagy végleges?</legend><div className="flex flex-wrap gap-2">{[{id:'provisional',label:'Ideiglenes'},{id:'definitive',label:'Végleges'},{id:'unknown',label:'Nem ismert'}].map(role=><button key={role.id} type="button" aria-pressed={value.role===role.id} className={`rounded-xl border px-4 py-2.5 text-sm ${value.role===role.id?selectedClass:plainClass}`} onClick={()=>onChange({role:role.id})}>{role.label}</button>)}</div></fieldset>
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="text-xs text-slate-500">A készülék megnevezése</p><p className="mt-1 text-sm font-semibold">{value.label.trim()||proposedLabel}</p><details className="mt-2 text-sm" open={expert}><summary className="cursor-pointer text-slate-500">Saját megnevezés megadása</summary><label className="mt-2 block">Megnevezés<input className={formInput} value={value.label} maxLength={160} placeholder={proposedLabel} onChange={e=>onChange({label:e.target.value})}/></label></details></div>
    <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={expert||existing}><summary className="cursor-pointer text-sm font-medium">Már meglévő fogpótlás · készítés, elégedettség és panasz</summary><div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Mikor készült?<input className={formInput} placeholder="pl. 2023 tavasz" value={String(value.specification.madeWhen??'')} onChange={e=>spec('madeWhen',e.target.value)}/></label><label className="text-sm">Ki / hol készült?<input className={formInput} value={String(value.specification.madeBy??'')} onChange={e=>spec('madeBy',e.target.value)}/></label></div>
      <fieldset><legend className="text-sm">Elégedett vele?</legend><div className="mt-1 flex gap-2">{[{value:true,label:'Igen'},{value:false,label:'Nem'},{value:null,label:'Nem ismert'}].map(option=><button key={option.label} type="button" aria-pressed={(value.specification.satisfied??null)===option.value} className={`rounded-lg border px-3 py-2 text-sm ${(value.specification.satisfied??null)===option.value?selectedClass:plainClass}`} onClick={()=>spec('satisfied',option.value)}>{option.label}</button>)}</div></fieldset>
      {(value.specification.satisfied===false||!!value.specification.complaint)&&<label className="block text-sm">Mi a baj vele?<textarea className={formInput} rows={2} value={String(value.specification.complaint??'')} onChange={e=>spec('complaint',e.target.value)}/></label>}
    </div></details>
  </div>;
}
