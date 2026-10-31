'use client';

import { useState, type FormEvent } from 'react';
import {
  CONSTRUCTION_ACTIVITIES, DELAY_REASONS, NEXT_ACTIONS, RESULTS,
  attended, budapestToday, type AftercareWorkspace, type CareEncounter, type CareLink, type EncounterInput,
} from '@/lib/aftercare/model';
import { appointmentDate, Choices, Field, inputClass, Options, Rating } from './Fields';

const problemLabels = { pain_pressure: 'Fájdalom / nyomás', retention_stability: 'Instabilitás', occlusion: 'Harapás', mechanical: 'Mechanikai hiba', other: 'Egyéb' };
const workLabels = { pressure_relief: 'Nyomási pont igazítása', retention_adjustment: 'Retenció igazítása', occlusal_adjustment: 'Harapáskorrekció', repair: 'Javítás', remake: 'Újrakészítés', advice: 'Tanács / nincs beavatkozás', other: 'Egyéb' };
const emptyLink = (prosthesisId: string): CareLink => ({ prosthesisId, problems: [], interventions: [], result: null, nextAction: null, functionScore: null, comfortScore: null });
const finding = (l: CareLink) => JSON.stringify([l.problems, l.interventions, l.result]);

export function VisitForm({ data, editing, initialAppointmentId, preferredEpisodeId, busy, onSave, onCancel }: {
  data: AftercareWorkspace; editing?: CareEncounter; initialAppointmentId?: string; preferredEpisodeId?: string; busy: boolean;
  onSave: (value: EncounterInput) => Promise<void>; onCancel: () => void;
}) {
  const appointments = data.appointments.filter((a) => (!data.prostheses.some((p) => p.deliveryAppointmentId === a.id) || a.id === initialAppointmentId || a.id === editing?.appointmentId) && (!preferredEpisodeId || !a.episodeId || a.episodeId === preferredEpisodeId || a.id === editing?.appointmentId) && attended(a.appointmentStatus) && a.occurredOn <= budapestToday()
    && (!data.encounters.some((c) => c.appointmentId === a.id) || a.id === editing?.appointmentId));
  const [value, setValue] = useState<EncounterInput>(() => {
    if (editing) return { ...editing, action: 'record_visit', expectedVersion: editing.version };
    const a = appointments.find((a) => a.id === initialAppointmentId) ?? (appointments.length === 1 ? appointments[0] : undefined);
    const scoped = data.prostheses.filter((p) => !(a?.episodeId || preferredEpisodeId) || p.episodeId === (a?.episodeId || preferredEpisodeId));
    const delivered = scoped.filter((p) => p.deliveryDate && p.deliveryConfirmed !== false && (!a || (p.deliveryDate <= a.occurredOn && p.deliveryAppointmentId !== a.id)));
    const phase = delivered.length ? 'aftercare' : 'construction';
    const candidates = phase === 'aftercare' ? delivered : scoped.filter((p) => !a || !p.deliveryDate || p.deliveryDate >= a.occurredOn);
    const requested = a ? data.requests.filter((r) => r.appointmentId === a.id).flatMap((r) => r.prosthesisIds) : [];
    return { action: 'record_visit', expectedVersion: 0, appointmentId: a?.id ?? '', phase,
      clinicalMinutes: null, constructionActivities: [], planDeviation: '', delayReason: 'none', note: '', returnAfterDays: null,
      links: a ? candidates.filter((p) => requested.includes(p.id) || (!requested.length && candidates.length === 1)).map((p) => emptyLink(p.id)) : [],
    };
  });
  const [separate, setSeparate] = useState(() => !!editing && editing.links.some((l) => finding(l) !== finding(editing.links[0])));
  const [wantsReturn, setWantsReturn] = useState(!!editing?.returnAfterDays);
  const appointment = data.appointments.find((a) => a.id === value.appointmentId);
  const eligible = data.prostheses.filter((p) => !appointment || (value.phase === 'aftercare'
    ? p.deliveryDate && p.deliveryConfirmed !== false && p.deliveryDate <= appointment.occurredOn && p.deliveryAppointmentId !== appointment.id
    : !p.deliveryDate || p.deliveryDate >= appointment.occurredOn));
  const set = <K extends keyof EncounterInput>(key: K, v: EncounterInput[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const update = (ids: string[], patch: Partial<CareLink>) => setValue((prev) => ({ ...prev,
    links: prev.links.map((l) => ids.includes(l.prosthesisId) ? { ...l, ...patch } : l) }));
  function selectAppointment(id: string) {
    const a = data.appointments.find((a) => a.id === id);
    const scoped = data.prostheses.filter((p) => !(a?.episodeId || preferredEpisodeId) || p.episodeId === (a?.episodeId || preferredEpisodeId));
    const delivered = scoped.filter((p) => p.deliveryDate && p.deliveryConfirmed !== false && p.deliveryAppointmentId !== id && (!a || p.deliveryDate <= a.occurredOn));
    const candidates = delivered.length ? delivered : scoped.filter((p) => !a || !p.deliveryDate || p.deliveryDate >= a.occurredOn);
    setValue((prev) => ({ ...prev, appointmentId: id, phase: delivered.length ? 'aftercare' : 'construction',
      constructionActivities: [], returnAfterDays: null, clinicalMinutes: null, note: '', planDeviation: '', delayReason: 'none',
      links: candidates.length === 1 ? [emptyLink(candidates[0].id)] : [] }));
    setWantsReturn(false);
  }
  function submit(e: FormEvent) { e.preventDefault(); void onSave(value); }
  function clinicalFields(link: CareLink, ids: string[]) {
    const routine = !link.problems.length && link.interventions.length === 1 && link.interventions[0] === 'advice';
    return <div className="space-y-3">
      <Choices compact legend="Panasz" options={{ none: 'Nincs panasz', ...problemLabels }} value={routine ? ['none'] : link.problems}
        onChange={(selected) => {
          if (!routine && selected.includes('none')) update(ids, { problems: [], interventions: ['advice'], result: null });
          else {
            const problems = selected.filter((p): p is CareLink['problems'][number] => p !== 'none');
            update(ids, { problems, result: problems.length ? link.result : null, ...(routine ? { interventions: [] } : {}) });
          }
        }} />
      {!routine && <>
        <Choices compact legend="Elvégzett munka" options={workLabels} value={link.interventions}
          onChange={(interventions) => update(ids, { interventions })} />
        {link.problems.length > 0 && <fieldset><legend className="mb-1 text-sm font-medium">Eredmény</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{Object.entries(RESULTS).map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" name={`result-${ids.join('-')}`} checked={link.result === key} onChange={() => update(ids, { result: key as CareLink['result'] })} />{label}
          </label>)}</div></fieldset>}
      </>}
    </div>;
  }
  return <form onSubmit={submit} className="space-y-4" aria-label="Klinikai vizit dokumentálása">
    <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{editing ? `Vizit javítása${appointment ? ` · ${appointmentDate(appointment.startTime)}` : ''}` : appointment ? appointmentDate(appointment.startTime) : 'Vizit rögzítése'}</h2>
      <button type="button" className="text-sm text-gray-500 underline dark:text-gray-400" onClick={onCancel}>Mégse</button></div>
    {!initialAppointmentId && !editing && <Field label="Időpont"><select required className={inputClass} value={value.appointmentId} onChange={(e) => selectAppointment(e.target.value)}>
      <option value="">Válasszon időpontot</option>{appointments.map((a) => <option key={a.id} value={a.id}>{appointmentDate(a.startTime)}</option>)}</select></Field>}
    {!appointments.length && <p className="text-sm text-gray-500 dark:text-gray-400">Nincs még dokumentálható, megjelent időpont.</p>}
    {appointment && eligible.length > 1 && <fieldset><legend className="mb-1 text-sm font-medium">Érintett fogpótlás</legend>
      <div className="flex flex-wrap gap-2">{eligible.map((p) => <label key={p.id} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
        <input type="checkbox" checked={value.links.some((l) => l.prosthesisId === p.id)} onChange={(e) => {
          if (!e.target.checked) set('links', value.links.filter((l) => l.prosthesisId !== p.id));
          else {
            const base = !separate && value.links[0] ? { ...value.links[0], prosthesisId: p.id, functionScore: null, comfortScore: null } : emptyLink(p.id);
            set('links', [...value.links, base]);
          }
        }} />{p.label}</label>)}</div></fieldset>}
    {appointment && eligible.length === 1 && <p className="text-sm text-gray-600 dark:text-gray-300">{eligible[0].label}</p>}
    {value.phase === 'aftercare' && value.links.length > 0 && (separate
      ? value.links.map((l) => <section key={l.prosthesisId} className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700"><h3 className="text-sm font-medium">{data.prostheses.find((p) => p.id === l.prosthesisId)?.label}</h3>{clinicalFields(l, [l.prosthesisId])}</section>)
      : clinicalFields(value.links[0], value.links.map((l) => l.prosthesisId)))}
    {value.phase === 'construction' && <Choices compact legend="Elvégzett munka" options={CONSTRUCTION_ACTIVITIES} value={value.constructionActivities} onChange={(v) => set('constructionActivities', v)} />}
    <div><label className="inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={wantsReturn} onChange={(e) => {
      setWantsReturn(e.target.checked);
      setValue((v) => ({ ...v, returnAfterDays: null, links: v.links.map((l) => ({ ...l, nextAction: e.target.checked ? (l.problems.length ? 'further_adjustment' : 'routine_review') : null })) }));
    }} />Új időpontot kérek</label>
      {wantsReturn && <div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label="Hány nap múlva?"><input required type="number" min={1} max={730} className={inputClass} value={value.returnAfterDays ?? ''}
        onChange={(e) => set('returnAfterDays', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Mire?"><select required className={inputClass} value={value.links[0]?.nextAction ?? ''} onChange={(e) => update(value.links.map((l) => l.prosthesisId), { nextAction: e.target.value as CareLink['nextAction'] })}>
          <option value="">Válasszon</option><Options options={NEXT_ACTIONS} /></select></Field></div>}
    </div>
    <details><summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">Megjegyzés és további adatok</summary>
      <div className="mt-3 space-y-3"><Field label="Megjegyzés"><textarea className={inputClass} maxLength={1000} rows={2} value={value.note} onChange={(e) => set('note', e.target.value)} /></Field>
        <Field label="Mért klinikai idő (perc)"><input type="number" min={1} max={1440} className={inputClass} value={value.clinicalMinutes ?? ''} onChange={(e) => set('clinicalMinutes', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        {value.links.length > 1 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={separate} onChange={(e) => {
          const next = e.target.checked; setSeparate(next);
          if (!next && value.links[0]) update(value.links.map((l) => l.prosthesisId), { problems: value.links[0].problems, interventions: value.links[0].interventions, result: value.links[0].result });
        }} />Eltérő lelet fogpótlásonként</label>}
        {value.links.map((l) => <div key={l.prosthesisId} className="grid gap-3 sm:grid-cols-2"><Rating label={`Funkció · ${data.prostheses.find((p) => p.id === l.prosthesisId)?.label}`} value={l.functionScore} onChange={(v) => update([l.prosthesisId], { functionScore: v })} />
          <Rating label={`Komfort · ${data.prostheses.find((p) => p.id === l.prosthesisId)?.label}`} value={l.comfortScore} onChange={(v) => update([l.prosthesisId], { comfortScore: v })} /></div>)}
        {value.phase === 'construction' && <Field label="Terveltérés oka"><textarea maxLength={1000} className={inputClass} value={value.planDeviation} onChange={(e) => set('planDeviation', e.target.value)} /></Field>}
        <Field label="Késés oka"><select className={inputClass} value={value.delayReason} onChange={(e) => set('delayReason', e.target.value as EncounterInput['delayReason'])}><Options options={DELAY_REASONS} /></select></Field>
      </div>
    </details>
    <button className="btn-primary" disabled={busy || !value.appointmentId || !value.links.length}>{busy ? 'Mentés…' : 'Mentés'}</button>
  </form>;
}
