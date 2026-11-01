'use client';

import { BASE_LABELS, LOWER_ROW, UPPER_ROW, readConditions, toothGroup } from '@/components/patient-form/odontogram/tooth-conditions';
import { ToothShapeChart } from '@/components/patient-form/odontogram/ToothShapeChart';
import { GEO } from '@/components/patient-form/odontogram/ToothShape';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';
import { canonical, type ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';

export const POSITION_ROLES:Record<string,string>={abutment:'Pillér',pontic:'Hídtest',denture_tooth:'Műfog',implant:'Implantátum',clasp:'Kapocs',attachment:'Elhorgonyzás'};

export function clinicalPosition(layers:ClinicalLayers,tooth:number) {
  return {tooth:layers.teeth[tooth],implant:layers.implants[tooth],prostheses:Object.values(layers.prostheses).filter((p:any)=>p?.tooth===tooth)};
}

export function positionDescription(layers:ClinicalLayers,tooth:number) {
  const p=clinicalPosition(layers,tooth),value=p.tooth as {base?:string;status?:string}|undefined;
  const legacy=value?.status&&['D','F','M'].includes(value.status)?readConditions(p.tooth as ToothStatus):null;
  const natural=legacy?BASE_LABELS[legacy.base]:value?.base?BASE_LABELS[value.base as keyof typeof BASE_LABELS]??value.base:p.tooth?'Dokumentált, alapállapota nem ismert':'Ismeretlen';
  const implant=p.implant===undefined?'nem ismert':(p.implant as {present?:boolean})?.present===false?'nincs':'jelen';
  const roles=p.prostheses.map((v:any)=>POSITION_ROLES[v.role]??v.role).join(', ');
  return `Saját fog: ${natural}; implantátum: ${implant}${roles?`; fogpótlás: ${roles}`:''}`;
}

export function archDifferences(before:ClinicalLayers,after:ClinicalLayers) {
  return [...UPPER_ROW,...LOWER_ROW].filter(n=>canonical(clinicalPosition(before,n))!==canonical(clinicalPosition(after,n)));
}

export function ClinicalArch({layers,jaw,selected=[],changed=[],marked=[],onSelect,label,compact=false}:{
  layers:ClinicalLayers;jaw?:'felso'|'also'|null;selected?:number[];changed?:number[];marked?:number[];
  onSelect?:(tooth:number)=>void;label:string;compact?:boolean;
}) {
  const rows=jaw==='felso'?[{name:'Felső állcsont',teeth:UPPER_ROW,upper:true}]:jaw==='also'?[{name:'Alsó állcsont',teeth:LOWER_ROW,upper:false}]:[
    {name:'Felső állcsont',teeth:UPPER_ROW,upper:true},{name:'Alsó állcsont',teeth:LOWER_ROW,upper:false},
  ];
  return <div aria-label={label} className={compact?'space-y-3':'space-y-5'}>
    {rows.map(row=><div key={row.name}>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400"><span>{row.name}</span>{!compact&&<span>A beteg jobb oldala ← → bal oldala</span>}</div>
      <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        {[row.teeth.slice(0,8),row.teeth.slice(8)].map((quadrant,q)=><div key={q} className="grid grid-cols-8 gap-0.5 rounded-2xl bg-slate-50 px-1 py-2 dark:bg-slate-900/70">
          {quadrant.map((n,i)=>{
            const p=clinicalPosition(layers,n),raw=p.tooth as {base?:string;status?:string}|undefined;
            const known=!!(raw?.base&&BASE_LABELS[raw.base as keyof typeof BASE_LABELS]||raw?.status&&['D','F','M'].includes(raw.status));
            const implant=(p.implant as {present?:boolean})?.present===true;
            const active=selected.includes(n),diff=changed.includes(n),scope=marked.includes(n),geometry=GEO[toothGroup(n)];
            const text=`${n}. fog · ${positionDescription(layers,n)}`;
            const color=active?'border-blue-600 bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100':diff?'border-amber-500 bg-amber-50 dark:bg-amber-950/40':scope?'border-teal-400 bg-teal-50 dark:bg-teal-950/30':'border-transparent';
            const body=<><span className={`text-[11px] font-semibold ${active?'text-blue-700 dark:text-blue-200':'text-slate-500 dark:text-slate-400'}`}>{n}</span>
              <svg aria-hidden="true" viewBox="0 0 28 43" className={compact?'h-10 w-full':'h-14 w-full'}>
                {known?<ToothShapeChart fdi={n} conditions={readConditions(p.tooth as ToothStatus)}/>:<><path d={geometry.out} transform={row.upper?'translate(0,40) scale(1,-1)':undefined} fill="none" stroke="#b5c0cf" strokeWidth="1" strokeDasharray="2 2"/><text x="14" y="24" textAnchor="middle" fontSize="10" fill="#8291a5">?</text></>}
                {implant&&<g transform={row.upper?undefined:'translate(0,40) scale(1,-1)'}><path d="M11,18 L17,18 L16,6 L14,3 L12,6 Z" fill="#ddd6fe" stroke="#7c3aed" strokeWidth="0.8"/>{[7,10,13,16].map(y=><path key={y} d={`M10.5,${y} h7`} stroke="#7c3aed" strokeWidth="0.8"/>)}</g>}
                {!!p.prostheses.length&&<path d={geometry.crown} transform={row.upper?'translate(0,40) scale(1,-1)':undefined} fill="#99f6e4" fillOpacity="0.8" stroke="#0f766e" strokeWidth="1.1" strokeDasharray="2 1"/>}
              </svg>
              <span className="flex h-3 items-center justify-center gap-0.5 text-[9px] font-bold"><span className={implant?'text-violet-700 dark:text-violet-300':'text-slate-300 dark:text-slate-700'}>{implant?'I':'·'}</span><span className={p.prostheses.length?'text-teal-700 dark:text-teal-300':'text-slate-300 dark:text-slate-700'}>{p.prostheses.length?'P':'·'}</span></span>
            </>;
            const style={paddingTop:compact?2:Math.round((q===0?i:7-i)*1.5)+2,paddingBottom:4};
            return onSelect?<button key={n} type="button" aria-label={text} aria-pressed={active} title={text} onClick={()=>onSelect(n)} className={`flex min-w-0 flex-col items-center rounded-xl border-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${color}`} style={style}>{body}</button>:
              <div key={n} role="img" aria-label={text} title={text} className={`flex min-w-0 flex-col items-center rounded-xl border-2 ${color}`} style={style}>{body}</div>;
          })}
        </div>)}
      </div>
    </div>)}
    {!compact&&<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400"><span>? Ismeretlen sajátfog-állapot</span><span className="text-violet-700 dark:text-violet-300">I Implantátum</span><span className="text-teal-700 dark:text-teal-300">P Fogpótlás</span>{changed.length>0&&<span className="text-amber-700 dark:text-amber-300">Sárga keret: eltérés</span>}</div>}
  </div>;
}
