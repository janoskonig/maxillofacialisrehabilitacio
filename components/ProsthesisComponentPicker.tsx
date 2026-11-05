'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { COMPONENT_CONTEXTS, COMPONENT_IDS, PROSTHESIS_COMPONENTS, type ComponentContext, type ProsthesisComponent } from '@/lib/prosthesis-components';

/** One catalog and interaction for examination findings and appliance components. */
export function ProsthesisComponentPicker({value,onToggle,mixed=[],disabled=false,compact=false}:{
  value:readonly string[];onToggle:(component:ProsthesisComponent)=>void;mixed?:readonly string[];disabled?:boolean;compact?:boolean;
}) {
  const [context,setContext]=useState<ComponentContext>('tooth');
  return <fieldset disabled={disabled} className="min-w-0 space-y-3" aria-label="Fogpótlási elemek">
    <div role="group" aria-label="Az elem helye" className="grid grid-cols-3 gap-1">
      {(Object.entries(COMPONENT_CONTEXTS) as Array<[ComponentContext,string]>).map(([id,label])=><button key={id} type="button" aria-pressed={context===id} className={`min-w-0 rounded-lg border px-2 py-2 text-xs ${context===id?'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100':'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'}`} onClick={()=>setContext(id)}>{label}</button>)}
    </div>
    <div role="group" aria-label={`${COMPONENT_CONTEXTS[context]} választható elemek`} className={`grid gap-1.5 sm:grid-cols-2 ${compact?'xl:grid-cols-1':'xl:grid-cols-3'}`}>
      {COMPONENT_IDS.filter(id=>PROSTHESIS_COMPONENTS[id].context===context).map(id=>{
        const checked=value.includes(id),partial=mixed.includes(id);
        return <button key={id} type="button" aria-label={PROSTHESIS_COMPONENTS[id].label} aria-pressed={partial?'mixed':checked} onClick={()=>onToggle(id)} className={`flex min-w-0 items-start gap-2 rounded-xl border p-2.5 text-left text-sm ${checked?'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100':partial?'border-amber-400 bg-amber-50 dark:bg-amber-950':'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'}`}>
          <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border">{checked&&<Check className="h-3 w-3"/>}{partial&&'−'}</span><span>{PROSTHESIS_COMPONENTS[id].label}</span>
        </button>;
      })}
    </div>
  </fieldset>;
}
