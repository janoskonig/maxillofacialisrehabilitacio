'use client';

import { Check, Link2, Layers } from 'lucide-react';
import { FIXED_TYPES, REMOVABLE_TYPES } from '@/lib/prosthesis-types';

export function ProsthesisTypeChoices({value,onChange,disabled,jaw}:{value:string[];onChange:(value:string[])=>void;disabled:boolean;jaw:string}) {
  function toggle(type:string, removable:boolean) {
    const rest=value.filter(t=>t!==type && (!removable || !(REMOVABLE_TYPES as readonly string[]).includes(t)));
    onChange(value.includes(type)?rest:[...rest,type]);
  }
  return <div className="space-y-4">
    <fieldset className="min-w-0"><legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4"/>Rögzített · többféle is lehet</legend>
      <div className="space-y-2">{FIXED_TYPES.map(type=><button key={type} type="button" aria-pressed={value.includes(type)} aria-label={`${jaw}: ${type}`} disabled={disabled} onClick={()=>toggle(type,false)}
        className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left text-sm ${value.includes(type)?'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100':'border-slate-200 dark:border-slate-700'}`}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border">{value.includes(type)&&<Check className="h-4 w-4"/>}</span>{type}</button>)}</div>
    </fieldset>
    <fieldset className="min-w-0"><legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4"/>Kivehető · egyféle választható</legend>
      <div className="space-y-2">{REMOVABLE_TYPES.map(type=><button key={type} type="button" aria-pressed={value.includes(type)} aria-label={`${jaw}: ${type}`} disabled={disabled} onClick={()=>toggle(type,true)}
        className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left text-sm ${value.includes(type)?'border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100':'border-slate-200 dark:border-slate-700'}`}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border">{value.includes(type)&&<Check className="h-4 w-4"/>}</span>{type}</button>)}</div>
    </fieldset>
    {value.includes('sebészi sablon készítése')&&<p className="text-xs text-slate-500">Korábbi adat: sebészi sablon készítése</p>}
  </div>;
}
