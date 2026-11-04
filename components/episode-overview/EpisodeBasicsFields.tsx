'use client';

import { useEffect, useState } from 'react';
import { Building2, UserRound } from 'lucide-react';
import { BASIC_LABELS, type EpisodeClinicalContent } from '@/lib/episode-clinical/model';
import { requiresGuardian } from '@/lib/legal/legal-capacity';

type Basics = EpisodeClinicalContent['basics'];
type Doctor = { displayName: string; intezmeny: string | null };
const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('hu');
export function institutionForDoctor(name: string | null, doctors: Doctor[]): string | null {
  const institutions = Array.from(new Set(doctors.filter(d => normalize(d.displayName) === normalize(name ?? '')).map(d => d.intezmeny?.trim()).filter((v):v is string=>!!v)));
  return institutions.length === 1 ? institutions[0]! : null;
}

export function EpisodeBasicsFields({ value, effectiveOn, onChange }: {
  value: Basics; effectiveOn: string; onChange: (value: Basics) => void;
}) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/users/fogpotlastanasz', { signal: controller.signal }).then(async response => {
      if (response.ok) setDoctors((await response.json()).users ?? []);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const institution = institutionForDoctor(value.kezeleoorvos, doctors);
    if (institution && !value.kezeleoorvosIntezete?.trim()) onChange({ ...value, kezeleoorvosIntezete: institution });
  }, [doctors, value, onChange]);
  const guardian = requiresGuardian(value.szuletesiDatum, new Date(`${effectiveOn}T12:00:00`));
  const field = (key: keyof Basics) => <label key={key} className="block text-sm">{BASIC_LABELS[key]}
    {key === 'nem' ? <div className="mt-1 flex gap-2" role="group" aria-label="Nem">
      {([{value:'ferfi',label:'Férfi'},{value:'no',label:'Nő'}] as const).map(option => <button key={option.value} type="button" aria-pressed={value.nem === option.value}
        className={`flex-1 rounded-xl border px-3 py-2.5 ${value.nem === option.value ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100' : 'border-slate-300 dark:border-slate-700'}`}
        onClick={() => onChange({...value,nem:value.nem===option.value?null:option.value})}>{option.label}</button>)}
    </div> : <input type={key === 'szuletesiDatum' ? 'date' : key.includes('Email') || key === 'email' ? 'email' : 'text'}
      aria-label={BASIC_LABELS[key]} className="form-input mt-1" value={value[key] ?? ''} onChange={e => onChange({...value,[key]:e.target.value || null})} />}
  </label>;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">{(['nev','taj','szuletesiDatum','nem','telefonszam','email','cim','varos','iranyitoszam'] as const).map(field)}</div>
    {guardian && <fieldset className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><legend className="px-1 text-sm font-semibold">Törvényes képviselő · 18 év alatt</legend>
      <div className="grid gap-3 sm:grid-cols-2">{(['torvenyesKepviseloNev','torvenyesKepviseloKapcsolat','torvenyesKepviseloEmail'] as const).map(field)}</div>
    </fieldset>}
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <label className="block text-sm"><span className="mb-1 flex items-center gap-2"><UserRound className="h-4 w-4" />Kezelőorvos az adatfelvételkor</span>
        <input aria-label="Kezelőorvos az adatfelvételkor" className="form-input" list="episode-doctors" value={value.kezeleoorvos ?? ''}
          onChange={e => { const name=e.target.value, institution=institutionForDoctor(name,doctors); onChange({...value,kezeleoorvos:name || null,...(institution ? {kezeleoorvosIntezete:institution} : {})}); }} />
        <datalist id="episode-doctors">{doctors.map(d => <option key={`${d.displayName}-${d.intezmeny}`} value={d.displayName}>{d.intezmeny}</option>)}</datalist>
      </label>
      <label className="mt-3 block text-sm"><span className="mb-1 flex items-center gap-2"><Building2 className="h-4 w-4" />Kezelőorvos intézete az adatfelvételkor</span>
        <input aria-label="Kezelőorvos intézete az adatfelvételkor" className="form-input" value={value.kezeleoorvosIntezete ?? ''} onChange={e => onChange({...value,kezeleoorvosIntezete:e.target.value || null})} />
      </label>
      <p className="mt-2 text-xs text-slate-500">Ismert orvos kiválasztásakor az intézet automatikusan kitöltődik.</p>
    </div>
  </div>;
}
