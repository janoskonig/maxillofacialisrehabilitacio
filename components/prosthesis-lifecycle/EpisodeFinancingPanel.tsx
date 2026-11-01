'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Banknote, Clock3, History, Plus } from 'lucide-react';
import { budapestToday } from '@/lib/aftercare/model';
import { financingCommandSchema, FINANCING_MODES, FINANCING_STATUSES, financingSummary, formatFinancingAmount, type EpisodeFinancing, type FinancingEvent } from '@/lib/episode-financing/model';
import type { EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
import { useClinicalFormMode } from './FormMode';
import { FormErrors, FormField, WorkflowSteps, formInput, primaryButton, secondaryButton } from './WorkflowForm';

type Draft = {
  requestKey: string; occurredOn: string; effectiveOn: string; precision: 'day' | 'exact'; localTime: string; source: string; planVersionId: string;
  mode: keyof typeof FINANCING_MODES | ''; status: keyof typeof FINANCING_STATUSES | ''; payer: string; currency: 'HUF' | 'EUR';
  totalAmount: string; fundedAmount: string; patientAmount: string; reason: string; decisionReference: string; documentIds: string[]; correctsId?: string;
};
const modeHints: Record<keyof typeof FINANCING_MODES, string> = {
  self_pay: 'A beteg fizeti az ellátást.', neak: 'Közfinanszírozott ellátás.', equity: 'Egyedi kérelem és döntés alapján.',
  mixed: 'A beteg és a finanszírozó megosztja a költséget.', other: 'Például más intézmény vagy szervezet.', unknown: 'Még nincs biztos információ.',
};
const amounts = [['totalAmount', 'Teljes összeg'], ['fundedAmount', 'Finanszírozói rész'], ['patientAmount', 'Beteg terhe']] as const;

export function EpisodeFinancingPanel({ plan, canEdit, disabled = false, planUnsaved = false, onChanged, onStateChange }: {
  plan: EpisodeTreatmentPlanRecord; canEdit: boolean; disabled?: boolean; planUnsaved?:boolean; onChanged: (data: EpisodeFinancing) => void;
  onStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}) {
  const {expert}=useClinicalFormMode();
  const [followCurrent,setFollowCurrent]=useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [conflict, setConflict] = useState(false);
  const [knownAmounts, setKnownAmounts] = useState<boolean | null>(null), [differentDate, setDifferentDate] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const data = plan.financing, current = data?.current, event = current?.event;
  const agreed = event?.status === 'approved' && !current?.requiresReview;
  useEffect(() => { onStateChange?.({ dirty: !!draft, saving: busy }); }, [draft, busy, onStateChange]);
  useEffect(() => () => onStateChange?.({ dirty: false, saving: false }), [onStateChange]);
  const editing = !!draft;
  useEffect(() => { if (editing) heading.current?.focus(); }, [step, editing]);

  useEffect(()=>{
    if(!editing||!followCurrent)return;
    const planId=plan.clinicalPlan?.id??'';
    setDraft(d=>d&&d.planVersionId!==planId?{...d,planVersionId:planId,status:'',requestKey:crypto.randomUUID()}:d);
  },[plan.clinicalPlan?.id,editing,followCurrent]);

  function open(previous?: FinancingEvent) {
    const e = previous ?? event;
    setFollowCurrent(!previous);
    setDraft({ requestKey: crypto.randomUUID(), occurredOn: previous?.occurred_on ?? budapestToday(), effectiveOn: previous?.effective_on ?? budapestToday(), precision: previous?.time_precision ?? 'day',
      localTime: previous?.occurred_at ? new Date(new Date(previous.occurred_at).getTime() - new Date(previous.occurred_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
      source: previous?.source ?? '', planVersionId: previous ? previous.plan_version_id ?? '' : plan.clinicalPlan?.id ?? '', mode: e?.mode ?? '', status: previous?.status ?? '',
      payer: e?.payer ?? '', currency: e?.currency ?? 'HUF', totalAmount: e?.total_amount ?? '', fundedAmount: e?.funded_amount ?? '', patientAmount: e?.patient_amount ?? '',
      reason: '', decisionReference: previous?.decision_reference ?? '', documentIds: previous?.document_ids ?? [], ...(previous ? { correctsId: previous.id } : {}) });
    setKnownAmounts(e && [e.total_amount, e.funded_amount, e.patient_amount].some(v => v !== null) ? true : null);
    setDifferentDate(!!previous && previous.effective_on !== previous.occurred_on);
    setStep(0); setErrors([]); setConflict(false);
  }
  function patch(values: Partial<Draft>) { setDraft(d => d ? { ...d, ...values, requestKey: crypto.randomUUID() } : d); setErrors([]); }
  function body() {
    if (!draft) return null;
    const time = draft.localTime ? new Date(draft.localTime) : null;
    return { ...draft, action: 'financing' as const, episodeId: plan.episodeId, expectedVersion: data?.revision ?? 0, planVersionId: draft.planVersionId || null,
      effectiveOn: differentDate ? draft.effectiveOn : draft.occurredOn, ...(!knownAmounts ? { totalAmount: '', fundedAmount: '', patientAmount: '' } : {}),
      occurredAt: draft.precision === 'exact' && time && Number.isFinite(time.getTime()) ? time.toISOString() : null };
  }
  function validate(until: number) {
    if (!draft) return false;
    const messages: string[] = [];
    if (!draft.mode) messages.push('Válaszd ki, ki fizeti az ellátást.');
    if (!draft.status) messages.push('Válaszd ki, hol tart a finanszírozás eldöntése.');
    if (draft.mode === 'other' && !draft.payer.trim()) messages.push('Írd be az egyéb finanszírozó nevét.');
    if (draft.status === 'approved' && (!draft.planVersionId || draft.mode === 'unknown')) messages.push('Elfogadott finanszírozáshoz mentett terv és ismert finanszírozási mód szükséges.');
    if (until >= 1) {
      if (knownAmounts === null) messages.push('Jelöld, hogy ismert-e már az összeg.');
      if (knownAmounts && ![draft.totalAmount, draft.fundedAmount, draft.patientAmount].some(v => v.trim())) messages.push('Legalább egy ismert összeget adj meg, vagy válaszd a „Még nem ismert” lehetőséget.');
      const linkedPlan=plan.history?.find(p=>p.id===draft.planVersionId);
      if(linkedPlan?.occurredOn&&linkedPlan.occurredOn>draft.occurredOn)messages.push('A döntés a kiválasztott terv elkészülte utáni vagy azzal azonos napi lehet. Ellenőrizd a dátumot vagy válassz korábbi tervet.');
      if (draft.occurredOn > budapestToday()) messages.push('A döntés napja mai vagy korábbi nap lehet. Jövőbeli érvényességet külön adhatsz meg.');
      const parsed = financingCommandSchema.safeParse({ ...body(), source: until < 2 ? 'Ellenőrzés' : draft.source, reason: until < 2 ? 'Ellenőrzés' : draft.reason });
      if (!parsed.success) for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (['mode', 'status'].includes(key)) continue;
        if (key === 'source') messages.push('Add meg, honnan származik az információ: például beteggel egyeztetés vagy határozat.');
        else if (key === 'reason') messages.push('Írd le röviden a rögzítés vagy a változás okát.');
        else if (['occurredOn', 'effectiveOn'].includes(key)) messages.push('Adj meg érvényes döntési és érvényességi dátumot.');
        else if (amounts.some(([name]) => name === key)) messages.push(`${amounts.find(([name]) => name === key)![1]}: nem negatív számot adj meg, legfeljebb két tizedesjeggyel.`);
        else messages.push(issue.message);
      }
    }
    setErrors(Array.from(new Set(messages))); return !messages.length;
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (disabled || busy || !draft)return;
    if(planUnsaved){setErrors(['Mentsd a kezelési tervet. Az itt kitöltött finanszírozási adatok megmaradnak, és utána a mentett tervhez kapcsolhatók.']);return;}
    if(!validate(expert?2:step))return;
    if (!expert&&step < 2) { setStep(step + 1); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/episodes/${plan.episodeId}/financing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
      const result = await res.json();
      if (!res.ok) {
        if (result._errorMeta?.code === 'FINANCING_CONFLICT') {
          const fresh = await fetch(`/api/episodes/${plan.episodeId}/financing`, { cache: 'no-store' });
          if (fresh.ok) onChanged((await fresh.json()).financing); setConflict(true);
        }
        throw new Error(result.error || 'A finanszírozás nem menthető.');
      }
      onChanged(result.financing); setDraft(null); setConflict(false);
    } catch (e) { setErrors([(e as Error).message]); } finally { setBusy(false); }
  }
  const selectedPlan = draft && plan.history?.find(p => p.id === draft.planVersionId);
  return <section id="finanszirozas" aria-label="Az epizód finanszírozása" className="my-4 scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-950">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${agreed ? 'bg-teal-50 text-teal-700 dark:bg-teal-950' : 'bg-slate-100 text-slate-600 dark:bg-slate-800'}`}><Banknote className="h-5 w-5" /></span><div><h4 className="font-semibold">Finanszírozás</h4><p className="mt-1 text-sm text-slate-500">{financingSummary(current)}</p>{event && <p className="mt-1 text-xs text-slate-400">Érvényes: {event.effective_on}-tól</p>}</div></div>{canEdit && !draft && <button type="button" disabled={disabled||(!expert&&planUnsaved)} onClick={() => open()} className={secondaryButton}><Plus className="h-4 w-4" />{event ? 'Finanszírozás módosítása' : 'Finanszírozás megadása'}</button>}</div>
    {current?.requiresReview && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">A terv megváltozott. Ellenőrizd, hogy az új megoldásra is érvényes-e a finanszírozás, majd rögzítsd az aktuális döntést.</p>}
    {planUnsaved && canEdit && <p className="mt-3 text-sm text-slate-500">A finanszírozást itt előkészítheted. Mentéséhez előbb mentsd a kezelési tervet, majd ellenőrizd a finanszírozási döntés állapotát.</p>}
    {!draft && event && <div className="mt-4 grid gap-2 sm:grid-cols-3">{[['Teljes összeg', event.total_amount], ['Finanszírozói rész', event.funded_amount], ['Beteg terhe', event.patient_amount]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold">{formatFinancingAmount(value, event.currency)}</p></div>)}</div>}
    {!!data?.upcoming.length && <div className="mt-3 space-y-1 rounded-xl bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">{data.upcoming.map(e => <p key={e.id}><Clock3 className="mr-1 inline h-3.5 w-3.5" />{e.effective_on}-tól: {FINANCING_MODES[e.mode]} · {e.plan_version_id && e.plan_version_id !== plan.clinicalPlan?.id ? 'Új tervhez ellenőrizendő' : FINANCING_STATUSES[e.status]}</p>)}</div>}
    {draft && <form onSubmit={submit} noValidate aria-label="Finanszírozási változás rögzítése" className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{draft.correctsId ? 'Korábbi bejegyzés javítása' : event ? 'Finanszírozás változása' : 'Finanszírozás megadása'}</p><button type="button" disabled={busy} onClick={() => setDraft(null)} className="text-sm underline disabled:opacity-40">Mégse</button></div>
      {!expert&&<WorkflowSteps labels={['Ki fizeti?', 'Mikor és mennyi?', 'Ellenőrzés']} current={step} />}
      <fieldset disabled={disabled || busy} className="space-y-4"><h5 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">{expert?'Finanszírozási adatok egyben':['Ki és milyen döntés alapján fizeti az ellátást?', 'Mikortól érvényes, és mennyibe kerül?', 'Ellenőrizd, majd mentsd az adatokat.'][step]}</h5>
        {(expert||step === 0) && <>
          <fieldset><legend className="sr-only">Finanszírozási mód</legend><div className="grid gap-2 sm:grid-cols-2">{(['self_pay', 'neak', 'equity', 'mixed', 'other', 'unknown'] as const).map(mode => <label key={mode} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${draft.mode === mode ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50' : 'border-slate-200 dark:border-slate-700'}`}><input type="radio" name="financing-mode" aria-label={FINANCING_MODES[mode]} value={mode} checked={draft.mode === mode} onChange={() => patch({ mode })} className="mt-1" /><span><span className="block text-sm font-medium">{FINANCING_MODES[mode]}</span><span className="mt-1 block text-xs text-slate-500">{modeHints[mode]}</span></span></label>)}</div></fieldset>
          {draft.mode === 'other' && <FormField id="finance-payer" label="Finanszírozó neve"><input id="finance-payer" className={formInput} maxLength={200} value={draft.payer} onChange={e => patch({ payer: e.target.value })} /></FormField>}
          <FormField id="finance-status" label="Hol tart a finanszírozás eldöntése?" hint="Ez a fizetésről szóló döntés. A kezelési terv klinikai jóváhagyását külön rögzíted."><select id="finance-status" aria-describedby="finance-status-hint" className={formInput} value={draft.status} onChange={e => patch({ status: e.target.value as Draft['status'] })}><option value="">Válassz állapotot…</option>{Object.entries(FINANCING_STATUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></FormField>
          <p className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900">{draft.planVersionId ? `Ehhez a tervhez kapcsolódik: ${selectedPlan?.version ?? plan.clinicalPlan?.version}. változat.` : 'Még nincs kiválasztott terv. Egyeztetés rögzíthető, elfogadott finanszírozáshoz előbb ments kezelési tervet.'}</p>
          <details className="text-sm" open={expert}><summary className="cursor-pointer text-slate-500">Kapcsolódó terv kiválasztása</summary><label className="my-2 flex gap-2 text-sm"><input type="checkbox" checked={followCurrent} onChange={e=>{setFollowCurrent(e.target.checked);if(e.target.checked)patch({planVersionId:plan.clinicalPlan?.id??''});}}/>Az aktuálisan mentett tervhez kapcsolom</label><FormField id="finance-plan" label="Érintett tervváltozat"><select id="finance-plan" className={formInput} value={draft.planVersionId} onChange={e => {setFollowCurrent(false);patch({ planVersionId: e.target.value });}}><option value="">Még nincs konkrét terv</option>{plan.history?.map(p => <option key={p.id} value={p.id}>{p.version}. változat · {p.description.slice(0, 80)}</option>)}</select></FormField></details>
        </>}
        {(expert||step === 1) && <>
          <FormField id="finance-day" label="Mikor született a döntés vagy egyeztetés?" hint="Korábbi eseményhez annak tényleges napját add meg."><input id="finance-day" type="date" max={budapestToday()} className={formInput} value={draft.occurredOn} onChange={e => patch({ occurredOn: e.target.value, ...(!differentDate ? { effectiveOn: e.target.value } : {}) })} /></FormField>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={differentDate} onChange={e => { setDifferentDate(e.target.checked); patch({ effectiveOn: draft.occurredOn }); }} />Más naptól érvényes a finanszírozás</label>
          {differentDate && <FormField id="finance-effective" label="Melyik naptól érvényes?" hint="Ez lehet korábbi vagy jövőbeli nap is."><input id="finance-effective" type="date" className={formInput} value={draft.effectiveOn} onChange={e => patch({ effectiveOn: e.target.value })} /></FormField>}
<details className="text-sm" open={expert||draft.precision==='exact'}><summary className="cursor-pointer text-slate-500">Pontos időpont megadása · opcionális</summary><div className="mt-3 space-y-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.precision === 'exact'} onChange={e => patch({ precision: e.target.checked ? 'exact' : 'day' })} />A döntés pontos időpontját is ismerem</label>{draft.precision === 'exact' && <FormField id="finance-time" label="Döntés pontos időpontja"><input id="finance-time" type="datetime-local" className={formInput} value={draft.localTime} onChange={e => patch({ localTime: e.target.value })} /></FormField>}</div></details>
          <fieldset><legend className="mb-2 text-sm font-medium">Ismert már az összeg?</legend><div className="flex flex-wrap gap-4">{[{ known: true, label: 'Ismert összeget rögzítek' }, { known: false, label: 'Még nem ismert' }].map(({ known, label }) => <label key={String(known)} className="flex gap-2 text-sm"><input type="radio" name="finance-amount-known" checked={knownAmounts === known} onChange={() => { setKnownAmounts(known); patch({}); }} />{label}</label>)}</div></fieldset>
          {(expert||knownAmounts) && <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><FormField id="finance-currency" label="Pénznem"><select id="finance-currency" className={formInput} value={draft.currency} onChange={e => patch({ currency: e.target.value as Draft['currency'] })}><option value="HUF">Forint (HUF)</option><option value="EUR">Euró (EUR)</option></select></FormField><div className="grid gap-3 sm:grid-cols-3">{amounts.map(([key, label]) => <FormField key={key} id={`finance-${key}`} label={label}><input id={`finance-${key}`} inputMode="decimal" className={formInput} placeholder="Nem ismert" disabled={knownAmounts===false} value={knownAmounts===false?'':draft[key]} onChange={e => {setKnownAmounts(true);patch({ [key]: e.target.value });}} /></FormField>)}</div><p className="text-xs text-slate-500">Csak az ismert összegeket töltsd ki. Az üres mező ismeretlent jelent; a 0 azt, hogy biztosan nincs fizetendő összeg.</p>{knownAmounts&&draft.totalAmount.trim() && <div className="flex flex-wrap gap-3 text-xs"><button type="button" className="underline" onClick={() => patch({ fundedAmount: '0', patientAmount: draft.totalAmount })}>A teljes összeget a beteg fizeti</button>{draft.mode !== 'self_pay' && <button type="button" className="underline" onClick={() => patch({ fundedAmount: draft.totalAmount, patientAmount: '0' })}>A teljes összeget a finanszírozó fizeti</button>}</div>}</div>}
        </>}
        {(expert||step === 2) && <>
          <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 dark:bg-slate-900"><div><dt className="text-xs text-slate-500">Finanszírozás</dt><dd className="mt-1 font-medium">{draft.mode && FINANCING_MODES[draft.mode]} · {draft.status && FINANCING_STATUSES[draft.status]}</dd></div><div><dt className="text-xs text-slate-500">Döntés / érvényesség kezdete</dt><dd className="mt-1">{draft.occurredOn} / {differentDate ? draft.effectiveOn : draft.occurredOn}</dd></div>{amounts.map(([key, label]) => <div key={key}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-medium">{formatFinancingAmount(knownAmounts && draft[key].trim() ? draft[key].replace(/\s/g, '').replace(',', '.') : null, draft.currency)}</dd></div>)}</dl>
          <FormField id="finance-reason" label="Mi a rögzítés vagy a változás oka?" hint="Például: a kérelem elbírálása megtörtént, vagy a beteg más finanszírozást választott."><textarea id="finance-reason" className={formInput} rows={2} maxLength={2000} value={draft.reason} onChange={e => patch({ reason: e.target.value })} /></FormField>
          <FormField id="finance-source" label="Honnan származik az információ?" hint="Például: beteggel egyeztetés, határozat száma vagy korabeli karton."><input id="finance-source" className={formInput} maxLength={500} value={draft.source} onChange={e => patch({ source: e.target.value })} /></FormField>
          <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" open={expert}><summary className="cursor-pointer text-sm font-medium">Határozat és mellékletek · opcionális</summary><div className="mt-3 space-y-3">{draft.mode !== 'other' && <FormField id="finance-payer" label="Finanszírozó neve" optional><input id="finance-payer" className={formInput} maxLength={200} value={draft.payer} onChange={e => patch({ payer: e.target.value })} /></FormField>}<FormField id="finance-reference" label="Határozat / megállapodás hivatkozása" optional><input id="finance-reference" className={formInput} maxLength={200} value={draft.decisionReference} onChange={e => patch({ decisionReference: e.target.value })} /></FormField>{!!plan.documents?.length && <fieldset><legend className="text-sm font-medium">Kapcsolódó dokumentumok</legend>{plan.documents.map(doc => <label key={doc.id} className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={draft.documentIds.includes(doc.id)} onChange={e => patch({ documentIds: e.target.checked ? [...draft.documentIds, doc.id] : draft.documentIds.filter(id => id !== doc.id) })} />{doc.filename}</label>)}</fieldset>}</div></details>
          <p className="text-xs text-slate-500">A rendszer külön megőrzi, hogy te most rögzítetted ezeket az adatokat. A korábbi döntések és mellékletcsomagok megmaradnak.</p>
        </>}
        <FormErrors messages={errors} />
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">{!expert&&step > 0 ? <button type="button" className={secondaryButton} onClick={() => { setStep(step - 1); setErrors([]); }}><ArrowLeft className="h-4 w-4" />Vissza</button> : <span />}<button type="submit" className={primaryButton}>{busy ? 'Mentés…' : !expert&&step < 2 ? <>Tovább<ArrowRight className="h-4 w-4" /></> : conflict ? 'Áttekintett adatok mentése' : 'Finanszírozás mentése'}</button></div>
      </fieldset>
    </form>}
    {!draft&&!!data?.history.length && <FinancingHistory plan={plan} eventId={event?.id} canEdit={canEdit} disabled={disabled || busy} onCorrect={open} />}
  </section>;
}

function FinancingHistory({ plan, eventId, canEdit, disabled, onCorrect }: { plan: EpisodeTreatmentPlanRecord; eventId?: string; canEdit: boolean; disabled: boolean; onCorrect: (event: FinancingEvent) => void }) {
  return <details className="mt-4 border-t border-slate-100 pt-3 text-xs dark:border-slate-800"><summary className="cursor-pointer font-medium"><History className="mr-1 inline h-3.5 w-3.5" />Korábbi finanszírozási adatok · {plan.financing!.history.length}</summary><ol className="mt-3 space-y-3">{plan.financing!.history.map(e => <li key={e.id} className={`border-l-2 pl-3 ${e.id === eventId ? 'border-teal-500' : 'border-slate-200 dark:border-slate-700'} ${e.active ? '' : 'opacity-50'}`}><p className="font-semibold">{e.effective_on}-tól · {FINANCING_MODES[e.mode]} · {FINANCING_STATUSES[e.status]}{e.id === eventId && ' · jelenleg érvényes'}</p><p className="mt-1">{e.reason}</p><p className="mt-1">{e.plan_version_id ? `${plan.history?.find(p => p.id === e.plan_version_id)?.version ?? 'Korábbi'}. tervváltozat` : 'Még nincs konkrét terv'} · beteg terhe: {formatFinancingAmount(e.patient_amount, e.currency)}</p><details className="mt-1"><summary className="cursor-pointer">Döntés részletei és forrása</summary><p className="mt-1">Teljes összeg: {formatFinancingAmount(e.total_amount, e.currency)} · finanszírozói rész: {formatFinancingAmount(e.funded_amount, e.currency)}</p><p className="mt-1">Forrás: {e.source}{e.payer && ` · ${e.payer}`}{e.decision_reference && ` · ${e.decision_reference}`}</p>{!!e.document_ids.length && <p className="mt-1">Mellékletek: {e.document_ids.map(id => plan.documents?.find(d => d.id === id)?.filename ?? id).join(', ')}</p>}<p className="mt-1 text-slate-400">Döntés: {e.occurred_on} · rögzítette: {e.recorder}, {new Date(e.recorded_at).toLocaleString('hu-HU')}{!e.active && ' · javított korábbi bejegyzés'}</p></details>{canEdit && e.active && <button type="button" disabled={disabled} onClick={() => onCorrect(e)} className="mt-2 underline disabled:opacity-40">Hibás bejegyzés javítása</button>}</li>)}</ol></details>;
}
