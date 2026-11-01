'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import Link from 'next/link';
import { budapestToday } from '@/lib/aftercare/model';
import { MAX_EPISODE_TREATMENT_PLAN_LENGTH, PLAN_TREATMENT_LABELS, getUnassignedLegacyPlan, type EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';

interface Props {
  episodeId: string;
  canEdit: boolean;
  onStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}

export function EpisodeTreatmentPlanEditor({ episodeId, canEdit, onStateChange }: Props) {
  const { showToast } = useToast();
  const [plan, setPlan] = useState<EpisodeTreatmentPlanRecord | null>(null);
  const [draft, setDraft] = useState({ upper: '', lower: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [details,setDetails]=useState({baselineStateId:null as string|null,treatments:[] as Array<{toothNumber:number;treatmentCode:string}>,occurredOn:budapestToday(),source:'Klinikai dokumentáció'});
  const [detailsBase,setDetailsBase]=useState('');
  const [approved,setApproved]=useState(false);
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const dirty = plan !== null && (draft.upper.trim() !== (plan.treatmentPlanUpper ?? '') || draft.lower.trim() !== (plan.treatmentPlanLower ?? '') || JSON.stringify(details)!==detailsBase || approved);
  const legacy = plan ? getUnassignedLegacyPlan(plan) : null;
  const jaws=([{jaw:'upper',code:'felso',label:'Felső állcsont kezelési terve'},{jaw:'lower',code:'also',label:'Alsó állcsont kezelési terve'}] as const).filter(j=>!plan?.jaw||plan.jaw===j.code);
  const changed=()=>{setRequestKey(crypto.randomUUID());setApproved(false);};
  function reset(next:EpisodeTreatmentPlanRecord){
    setDraft({upper:next.treatmentPlanUpper??'',lower:next.treatmentPlanLower??''});
    const values={baselineStateId:next.clinicalPlan?.baselineStateId??null,treatments:next.clinicalPlan?.treatments??[],occurredOn:budapestToday(),source:'Klinikai dokumentáció'};
    setDetails(values);setDetailsBase(JSON.stringify(values));setApproved(false);setRequestKey(crypto.randomUUID());
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/treatment-plan`, { credentials: 'include', signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nem sikerült betölteni a kezelési tervet.');
      if (signal?.aborted) return;
      setPlan(data.plan);
      reset(data.plan);
      setConflict(false);
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Betöltési hiba.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => { onStateChange?.({ dirty, saving }); }, [dirty, saving, onStateChange]);
  useEffect(() => () => onStateChange?.({ dirty: false, saving: false }), [onStateChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const save = async () => {
    if (!plan || !canEdit || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/treatment-plan`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treatmentPlanUpper: draft.upper.trim() || null, treatmentPlanLower: draft.lower.trim() || null, expectedVersion: plan.version,clinical:{...details,approved,requestKey} }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'TREATMENT_PLAN_CONFLICT') {
        setPlan(data.plan);
        setConflict(true);
        setError('A kezelési tervet közben más módosította. A saját szövege megmaradt; mentés előtt hasonlítsa össze a friss változattal.');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Nem sikerült menteni a kezelési tervet.');
      setPlan(data.plan);
      reset(data.plan);
      setConflict(false);
      showToast('Közös tervváltozat mentve.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mentési hiba.');
    } finally { setSaving(false); }
  };

  return (
    <section aria-label="Epizód kezelési terve" className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{plan?.jaw?`${plan.jaw==='felso'?'Felső':'Alsó'} fogpótlás kezelési terve`:'Kezelési tervek állcsontonként'}</h3>
      <p className="mt-1 mb-3 text-sm text-gray-600 dark:text-gray-400">Az itt mentett tervet használja a Fogpótlások és gondozás nézet, a grafikus összehasonlítás és a dokumentumgenerálás is. Módosításkor új változat készül.</p>
      {plan?.prosthesisLabel&&<p className="mb-3 text-sm font-medium">Fogpótlás: {plan.prosthesisLabel} · {plan.clinicalPlan?`${plan.clinicalPlan.version}. változat · ${plan.clinicalPlan.approved?'jóváhagyott':'tervezet'}`:'még nincs kiadott tervváltozat'}</p>}
      {loading ? <p role="status">Kezelési terv betöltése…</p> : plan ? (
        canEdit ? <>
          <div className={`grid gap-4 ${jaws.length>1?'md:grid-cols-2':''}`}>
            {jaws.map(({ jaw, label }) => (
              <div key={jaw}>
                <label htmlFor={`treatment-plan-${episodeId}-${jaw}`} className="block mb-2 text-sm font-semibold">{label}</label>
                <textarea id={`treatment-plan-${episodeId}-${jaw}`} value={draft[jaw]} onChange={(e) => {changed();setDraft((current) => ({ ...current, [jaw]: e.target.value }));}} disabled={saving}
                  rows={7} maxLength={MAX_EPISODE_TREATMENT_PLAN_LENGTH}
                  placeholder="Tervezett ellátás, érintett fogak, választott megoldás és indoklás…"
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 p-3 text-sm text-gray-900 dark:text-gray-100" />
              </div>
            ))}
          </div>
          <details className="mt-4 rounded border p-3">
            <summary className="cursor-pointer font-medium">Kiindulási státusz, beavatkozások és dokumentálás</summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">A szöveg önmagában is menthető tervezetként. Grafikus célállapothoz és jóváhagyáshoz dokumentált kiindulási státusz szükséges. A tényleges fogazati státuszt a terv mentése nem módosítja.</p>
            <label className="mt-3 block text-sm">Ellátás előtti dokumentált státusz<select className="mt-1 block w-full rounded border p-2 dark:bg-gray-900" disabled={saving} value={details.baselineStateId??''} onChange={e=>{changed();setDetails(d=>({...d,baselineStateId:e.target.value||null}));}}><option value="">Nincs kiválasztva · szöveges tervezet</option>{plan.states?.map(s=><option key={s.id} value={s.id}>{s.occurred_on} · {s.note||s.source}</option>)}</select></label>
            {!plan.states?.length&&plan.patientId&&<Link className="mt-2 block text-sm underline" href={`/patients/${plan.patientId}/prostheses`}>Dokumentált státusz rögzítése a Fogpótlások és gondozás fülön</Link>}
            <fieldset className="mt-3 space-y-2"><legend className="text-sm font-medium">Beavatkozások végrehajtási sorrendben</legend>{details.treatments.map((t,i)=><div className="flex flex-wrap gap-2" key={i}>
              <input aria-label={`${i+1}. beavatkozás fogszáma`} type="number" className="w-24 rounded border p-2 dark:bg-gray-900" disabled={saving} value={t.toothNumber} onChange={e=>{changed();setDetails(d=>({...d,treatments:d.treatments.map((x,j)=>i===j?{...x,toothNumber:Number(e.target.value)}:x)}));}}/>
              <select aria-label={`${i+1}. beavatkozás`} className="rounded border p-2 dark:bg-gray-900" disabled={saving} value={t.treatmentCode} onChange={e=>{changed();setDetails(d=>({...d,treatments:d.treatments.map((x,j)=>i===j?{...x,treatmentCode:e.target.value}:x)}));}}>{!PLAN_TREATMENT_LABELS[t.treatmentCode]&&<option value={t.treatmentCode}>{t.treatmentCode}</option>}{Object.entries(PLAN_TREATMENT_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
              <button type="button" className="text-sm underline" disabled={saving} onClick={()=>{changed();setDetails(d=>({...d,treatments:d.treatments.filter((_,j)=>i!==j)}));}}>Eltávolítás</button>
            </div>)}<button type="button" className="text-sm underline" disabled={saving} onClick={()=>{changed();setDetails(d=>({...d,treatments:[...d.treatments,{toothNumber:plan.jaw==='also'?31:11,treatmentCode:'huzas'}]}));}}>Beavatkozás hozzáadása</button></fieldset>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Terv dátuma<input type="date" max={budapestToday()} className="mt-1 block w-full rounded border p-2 dark:bg-gray-900" value={details.occurredOn} disabled={saving} onChange={e=>{changed();setDetails(d=>({...d,occurredOn:e.target.value}));}}/></label><label className="text-sm">Dokumentálás forrása<input className="mt-1 block w-full rounded border p-2 dark:bg-gray-900" maxLength={500} value={details.source} disabled={saving} onChange={e=>{changed();setDetails(d=>({...d,source:e.target.value}));}}/></label></div>
          </details>
          <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" disabled={saving||!plan.prosthesisId||!details.baselineStateId} checked={approved} onChange={e=>{setRequestKey(crypto.randomUUID());setApproved(e.target.checked);}}/>Ezt a tervváltozatot jóváhagyom</label>
          <p className="mt-1 text-xs text-gray-500">Módosítás után ismételt jóváhagyás szükséges. A korábban jóváhagyott változatok és a kiadott mellékletek megmaradnak.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={!dirty || saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Mentés…' : conflict ? 'Áttekintett terv mentése' : 'Kezelési terv mentése'}</button>
            {dirty && <button type="button" disabled={saving} onClick={() => {reset(plan);setConflict(false);setError(null);}} className="text-sm underline">Módosítások elvetése</button>}
            <span className="text-xs text-gray-500 dark:text-gray-400" role="status">{dirty ? 'Nem mentett módosítások' : (plan.treatmentPlanUpper || plan.treatmentPlanLower) ? 'Mentett kezelési terv' : 'Nincs még rögzített kezelési terv'}</span>
          </div>
        </> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">{jaws.map(j=><div key={j.jaw}><p className="font-semibold">{j.label}</p><p className="mt-1 whitespace-pre-wrap break-words">{(j.jaw==='upper'?plan.treatmentPlanUpper:plan.treatmentPlanLower)||'Nincs rögzített kezelési terv.'}</p></div>)}</div>
      ) : <button type="button" onClick={() => load()} className="text-sm underline">Újrapróbálás</button>}
      {legacy && <div className="mt-3 rounded border border-amber-200 dark:border-amber-700 p-3 text-sm">
        <p className="font-semibold">Korábban rögzített közös terv</p>
        <p className="mt-1">A korábbi szöveg megmaradt. Az állcsont szerinti besorolását Ön adhatja meg.</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{legacy}</p>
        {canEdit && <div className="mt-2 flex flex-wrap gap-3">
          {jaws.map(j=><button key={j.jaw} type="button" disabled={saving||draft[j.jaw].includes(legacy)} onClick={()=>{changed();setDraft(current=>({...current,[j.jaw]:[current[j.jaw],legacy].filter(Boolean).join('\n\n')}));}} className="underline">{j.jaw==='upper'?'Hozzáadás a felső tervhez':'Hozzáadás az alsó tervhez'}</button>)}
        </div>}
      </div>}
      {plan?.legacyClinicalDescription&&<div className="mt-3 rounded border border-amber-300 p-3 text-sm"><p className="font-semibold">Korábbi külön tervváltozat · összevezetést igényel</p><p className="mt-1 whitespace-pre-wrap">{plan.legacyClinicalDescription}</p><p className="mt-1">A korábbi szöveg megmaradt. Mentés előtt ellenőrizze, mely részei tartoznak az aktuális tervhez.</p>{canEdit&&jaws.map(j=><button key={j.jaw} type="button" className="mr-3 mt-2 underline" disabled={saving||draft[j.jaw].includes(plan.legacyClinicalDescription!)} onClick={()=>{changed();setDraft(d=>({...d,[j.jaw]:[d[j.jaw],plan.legacyClinicalDescription].filter(Boolean).join('\n\n')}));}}>{j.jaw==='upper'?'Korábbi leírás hozzáadása a felső tervhez':'Korábbi leírás hozzáadása az alsó tervhez'}</button>)}</div>}
      {!!plan?.history?.length&&<details className="mt-3 rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">Tervváltozatok és jóváhagyások</summary>{plan.history.map(v=><article key={v.id} className="mt-3 border-t pt-2"><strong>{v.version}. változat · {v.approved?'jóváhagyott':'tervezet'} · {v.occurredOn}</strong><p className="whitespace-pre-wrap">{v.description||'Üres szöveges tervezet'}</p><p className="text-xs">Forrás: {v.source} · rögzítette: {v.recorder}, {new Date(v.recordedAt).toLocaleString('hu-HU')}</p>{v.previousNarratives&&<details className="mt-2"><summary className="cursor-pointer">Az összevezetés előtt rögzített szövegek</summary>{Object.entries(v.previousNarratives).map(([key,value])=>value&&<p className="mt-1 whitespace-pre-wrap" key={key}><strong>{key==='treatmentPlanUpper'?'Felső':key==='treatmentPlanLower'?'Alsó':'Korábbi közös terv'}:</strong> {value}</p>)}</details>}</article>)}</details>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {conflict && plan && <div className="mt-3 rounded border border-amber-200 dark:border-amber-700 p-3 text-sm">
        <p className="font-semibold">A szerveren mentett friss változat</p>
        <p className="mt-2 font-semibold">Felső állcsont</p><p className="whitespace-pre-wrap break-words">{plan.treatmentPlanUpper || 'Nincs rögzített felső kezelési terv.'}</p>
        <p className="mt-2 font-semibold">Alsó állcsont</p><p className="whitespace-pre-wrap break-words">{plan.treatmentPlanLower || 'Nincs rögzített alsó kezelési terv.'}</p>
      </div>}
    </section>
  );
}

/** Historical episodes load their saved plan only when expanded. */
export function EpisodeTreatmentPlanDisclosure({ episodeId, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  return <div className="w-full mt-2">
    <button type="button" onClick={() => setOpen(true)} disabled={open} aria-expanded={open} className="text-sm text-medical-primary underline">Kezelési tervek megtekintése</button>
    {open && <div className="mt-2"><EpisodeTreatmentPlanEditor episodeId={episodeId} canEdit={canEdit} /></div>}
  </div>;
}
