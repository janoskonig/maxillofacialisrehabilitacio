'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus, ClipboardCheck, CalendarClock, AlertCircle } from 'lucide-react';
import {
  CONSTRUCTION_ACTIVITIES, DELAY_REASONS, FOLLOWUP_STATUSES, INTERVENTIONS, JAWS, NEXT_ACTIONS, PROBLEMS, PROSTHESIS_TYPES, RESULTS,
  attended, budapestToday, completeness, observationEnd, patientBurden, prosthesisMetrics,
  type AftercareWorkspace, type CareEncounter, type Prosthesis,
} from '@/lib/aftercare/model';
import { appointmentDate, Field, inputClass, Options, panel, requestJson, shortDate } from './Fields';
import { VisitForm } from './VisitForm';
import { FollowupForm } from './FollowupForm';

type Mode = { kind: 'register' } | { kind: 'visit'; encounter?: CareEncounter; appointmentId?: string } | { kind: 'delivery' | 'followup'; prosthesis: Prosthesis } | null;
const labelCodes = (codes: string[], labels: Record<string, string>) => codes.map((code) => labels[code] || code).join(' · ');

export function PatientAftercare({ patientId, initialAppointmentId, selectedEpisodeId, embedded = false, workspace, onWorkspaceChanged, onRequestScheduling }: {
  patientId: string;
  initialAppointmentId?: string;
  selectedEpisodeId?: string;
  embedded?: boolean;
  workspace?: AftercareWorkspace;
  onWorkspaceChanged?: (data: AftercareWorkspace) => void;
  onRequestScheduling?: () => void;
}) {
  const [localData, setData] = useState<AftercareWorkspace | null>(null);
  const data = workspace ?? localData;
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [episodeId, setEpisodeId] = useState(selectedEpisodeId ?? '');
  const openedAppointment = useRef(false);
  const url = `/api/patients/${patientId}/aftercare`;
  const load = useCallback(async () => {
    const result = await requestJson<AftercareWorkspace>(url);
    setData(result);
    onWorkspaceChanged?.(result);
    setEpisodeId((id) => id || result.episodes.find((e) => e.status === 'open')?.id || result.episodes[0]?.id || '');
  }, [url, onWorkspaceChanged]);
  const externallyLoaded = workspace !== undefined;
  useEffect(() => { if (!externallyLoaded) load().catch((e) => setError(e.message)); }, [load, externallyLoaded]);
  useEffect(() => { openedAppointment.current = false; }, [initialAppointmentId]);
  useEffect(() => {
    if (!data || openedAppointment.current || !data.prostheses.length) return;
    if (!initialAppointmentId) {
      openedAppointment.current = true;
      if (data.appointments.some((a) => (!selectedEpisodeId || a.episodeId === selectedEpisodeId || !a.episodeId) && attended(a.appointmentStatus) && a.occurredOn <= budapestToday()
        && !data.encounters.some((v) => v.appointmentId === a.id) && !data.prostheses.some((p) => p.deliveryAppointmentId === a.id))) setMode({ kind: 'visit' });
      return;
    }
    const appointment = data.appointments.find((a) => a.id === initialAppointmentId);
    if (!appointment || !attended(appointment.appointmentStatus)) return;
    openedAppointment.current = true;
    if (appointment.episodeId) setEpisodeId(appointment.episodeId);
    setMode({ kind: 'visit', appointmentId: initialAppointmentId, encounter: data.encounters.find((v) => v.appointmentId === initialAppointmentId) });
  }, [data, initialAppointmentId, selectedEpisodeId]);
  async function save(body: unknown) {
    setBusy(true); setError(''); setMessage('');
    try { await requestJson(url, body); await load(); setMode(null); setMessage('Mentve a betegkartonba.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const start = (next: Mode) => { setError(''); setMessage(''); setMode(next); };
  const today = budapestToday();
  const prostheses = data?.prostheses.filter((p) => p.episodeId === episodeId) ?? [];
  const burden = data ? patientBurden(prostheses, data.encounters) : null;
  const missingVisits = data?.appointments.filter((a) => a.episodeId === episodeId && attended(a.appointmentStatus) && a.occurredOn <= today
    && !data.encounters.some((c) => c.appointmentId === a.id) && !data.prostheses.some((p) => p.deliveryAppointmentId === a.id)) ?? [];

  return <div className="space-y-5 text-gray-900 dark:text-gray-100">
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}
      {!data && <button className="ml-3 underline" onClick={() => { setError(''); load().catch((e) => setError(e.message)); }}>Újrapróbálás</button>}</div>}
    {message && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{message}</p>}
    {!data ? !error && <p role="status">Betöltés…</p> : <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {embedded ? <h2 className="text-base font-semibold">Gondozás / igazítás</h2> : <h1 className="text-xl font-semibold">{data.patientName}</h1>}
        {onRequestScheduling ? <button type="button" onClick={onRequestScheduling} className="text-sm text-medical-primary hover:underline">Időpontok / visszarendelés</button> : <Link href={`/patients/${patientId}/stages#gyors-foglalas`} className="inline-flex items-center gap-2 text-sm text-gray-500 underline dark:text-gray-400"><CalendarClock className="h-4 w-4" />Időpontok</Link>}
      </div>
      {((!embedded && data.episodes.length > 1) || (!mode && prostheses.length > 0)) && <div className="flex flex-wrap items-end gap-3">
        {!embedded && data.episodes.length > 1 && <div className="min-w-64 flex-1"><Field label="Ellátási epizód"><select className={inputClass} value={episodeId} disabled={!!mode} onChange={(e) => setEpisodeId(e.target.value)}>
          {!data.episodes.length && <option value="">Nincs epizód</option>}{data.episodes.map((e) => <option key={e.id} value={e.id}>{e.label}{e.status === 'closed' ? ' · Lezárt' : e.status === 'paused' ? ' · Szünetel' : ''}</option>)}
        </select></Field></div>}
        {!mode && prostheses.length > 0 && <button className="btn-primary inline-flex items-center gap-2" disabled={data.deceased} onClick={() => start({ kind: 'visit' })}><ClipboardCheck className="h-4 w-4" />Új vizit</button>}
      </div>}
      {embedded && prostheses.some((p) => p.deliveryDate) && <ul className="space-y-2 text-sm">{prostheses.filter((p) => p.deliveryDate).map((p) => {
        const problems = currentProblems(p, data.encounters);
        return <li key={p.id} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
          <div className="flex items-center justify-between gap-2 flex-wrap"><div><span className="font-medium">{p.label}</span><span className="ml-2 text-xs text-gray-500 dark:text-gray-400">Átadás: {shortDate(p.deliveryDate)}</span></div>
            {!p.followup && observationEnd(p.deliveryDate!) <= today && <button type="button" className="text-xs text-teal-700 underline dark:text-teal-300" disabled={data.deceased || !!mode} onClick={() => start({ kind: 'followup', prosthesis: p })}>Háromhavi követés</button>}
          </div>
          {p.deliveryConfirmed === false && <p className="mt-1 text-amber-700 dark:text-amber-300">Az átadási időpont teljesülését ellenőrizni kell.</p>}
          {problems.length > 0 && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Nyitott probléma: {labelCodes(problems, PROBLEMS)}</p>}
        </li>;
      })}</ul>}
      {data.deceased && <p className="text-sm text-gray-500 dark:text-gray-400">Elhunyt beteg · korábbi ellátási adatok.</p>}
      {mode && <section className={panel}>
        {mode.kind === 'register' && <RegisterForm episodeId={episodeId} busy={busy} onSave={save} onCancel={() => setMode(null)} />}
        {mode.kind === 'delivery' && <DeliveryForm data={data} prosthesis={mode.prosthesis} busy={busy} onSave={save} onCancel={() => setMode(null)} />}
        {mode.kind === 'visit' && <VisitForm key={mode.encounter?.id ?? mode.appointmentId ?? 'new-visit'} data={data} preferredEpisodeId={selectedEpisodeId} editing={mode.encounter} initialAppointmentId={mode.appointmentId} busy={busy} onSave={save} onCancel={() => setMode(null)} />}
        {mode.kind === 'followup' && <FollowupForm prosthesis={mode.prosthesis} busy={busy} onSave={save} onCancel={() => setMode(null)} />}
      </section>}
      {!prostheses.length && mode?.kind !== 'register' && <section className={panel}><h2 className="font-semibold">Fogpótlás beállítása</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Ezt egyszer kell megadni, a későbbi vizitek már ehhez kapcsolódnak.</p>
        {data.episodes.some((e) => e.id === episodeId && e.status === 'open') && <button className="btn-primary mt-3" disabled={data.deceased || !!mode} onClick={() => start({ kind: 'register' })}>Fogpótlás megadása</button>}
        {!data.episodes.length && <Link href={`/patients/${patientId}/stages`} className="mt-3 inline-block text-teal-700 underline">Ellátási epizód létrehozása</Link>}</section>}
      {!mode && prostheses.some((p) => p.deliveryDate && !p.followup && observationEnd(p.deliveryDate) <= today) && <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
        <span>Háromhavi követés:</span>{prostheses.filter((p) => p.deliveryDate && !p.followup && observationEnd(p.deliveryDate) <= today).map((p) =>
          <button key={p.id} className="text-teal-700 underline dark:text-teal-300" onClick={() => start({ kind: 'followup', prosthesis: p })}>{p.label}</button>)}
      </div>}
      {!mode && prostheses.filter((p) => !p.deliveryDate).map((p) => <button key={p.id} className="text-sm text-teal-700 underline dark:text-teal-300" disabled={data.deceased} onClick={() => start({ kind: 'delivery', prosthesis: p })}>{p.label} · Átadás rögzítése</button>)}
      {prostheses.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-gray-500 dark:text-gray-400">Előzmények és beállítások</summary><div className="mt-3 space-y-3">
      <details className={panel}><summary className="cursor-pointer text-sm font-medium">Fogpótlás és átadás</summary>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">{prostheses.map((p) => {
        const m = prosthesisMetrics(p, data.encounters);
        const c = completeness(p, data.encounters);
        const liveProblems = currentProblems(p, data.encounters);
        const end = p.deliveryDate ? observationEnd(p.deliveryDate) : null;
        return <section key={p.id} className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{JAWS[p.jaw]} · {PROSTHESIS_TYPES[p.prosthesisType]}</p><h2 className="mt-1 text-lg font-semibold">{p.label}</h2></div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${p.deliveryDate ? 'bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'}`}>{p.deliveryDate ? 'Adaptáció és utógondozás' : 'Készítés'}</span></div>
          {p.deliveryDate ? <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Átadás: {shortDate(p.deliveryDate)} · Ablak vége: {shortDate(end)}</p>
            : <button className="btn-primary mt-4" disabled={data.deceased || !!mode} onClick={() => start({ kind: 'delivery', prosthesis: p })}>Átadás rögzítése</button>}
          {p.deliveryConfirmed === false && <p role="alert" className="mt-3 text-sm text-amber-800 dark:text-amber-300">Az átadási időpont már nem teljesült státuszú. A kutatási számlálás szünetel; ellenőrizze az időpont kimenetelét.</p>}
          {liveProblems.length > 0 && <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"><AlertCircle className="h-4 w-4 shrink-0" /><span>Nyitott probléma: {labelCodes(liveProblems, PROBLEMS)}</span></div>}
          <details className="mt-3"><summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">Kutatási adatok és eredeti terv</summary>
          {p.deliveryDate && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Problémás vizit" value={m.problemVisits} /><Stat label="Panasz nélküli kontroll" value={m.routineVisits} />
            <Stat label="Ismételt igazítási vizit" value={m.repeatedAdjustmentVisits} /><Stat label="Javítás / újrakészítés" value={`${m.repairs} / ${m.remakes}`} />
          </dl>}
          {p.followup ? <p className="mt-4 text-sm">Háromhavi követés: <strong>{FOLLOWUP_STATUSES[p.followup.status]}</strong> · {shortDate(p.followup.assessedOn)}
            {p.followup.functionScore !== null && ` · Funkció: ${p.followup.functionScore}/10`}{p.followup.comfortScore !== null && ` · Komfort: ${p.followup.comfortScore}/10`}</p>
            : end && end <= today && <button className="btn-secondary mt-4" disabled={data.deceased || !!mode} onClick={() => start({ kind: 'followup', prosthesis: p })}>Háromhavi követés</button>}
          <div className="mt-4 border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
            {c.due.length > 0 ? <><p className="font-medium text-amber-800 dark:text-amber-300">Most hiányzik</p><p className="mt-1">{c.due.join(' · ')}</p></> : <p className="text-teal-700 dark:text-teal-300">Az eddig esedékes adatok rögzítve</p>}
            {c.baselineDue.length > 0 && <div className="mt-2 space-y-2">
              <Link className="inline-block text-teal-700 underline" href={`/patients/${patientId}/view?tab=anamnezis`}>Vizsgálati adatok megnyitása</Link>
              <p className="text-xs text-gray-500 dark:text-gray-400">A karton kiegészítése után az adatokat új pillanatképként veheti át. Az eredeti értékeket megőrizzük; átadás után a kiegészítés utólagosként jelölt.</p>
              <button className="btn-secondary" disabled={busy || data.deceased} onClick={() => save({ action: 'amend_baseline', prosthesisId: p.id })}>Kiegészített vizsgálati adatok átvétele</button>
            </div>}
            {c.future.length > 0 && <p className="mt-2 text-gray-500 dark:text-gray-400">Később esedékes: {c.future.join(' · ')}</p>}
            {p.baseline.retrospective === true && <p className="mt-2 text-gray-500 dark:text-gray-400">Utólag felvett eset: a kiindulási pillanatkép a regisztrációkor készült.</p>}
          </div>
          <details className="mt-3"><summary className="cursor-pointer text-sm text-teal-700 dark:text-teal-300">Rögzített eredeti terv</summary>
            {typeof p.originalPlan.treatmentPlanUpper === 'string' && p.originalPlan.treatmentPlanUpper && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Felső állcsont:</strong> {p.originalPlan.treatmentPlanUpper}</p>}
            {typeof p.originalPlan.treatmentPlanLower === 'string' && p.originalPlan.treatmentPlanLower && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Alsó állcsont:</strong> {p.originalPlan.treatmentPlanLower}</p>}
            <p className="mt-2 whitespace-pre-wrap text-sm">{typeof p.originalPlan.treatmentPlan === 'string' && p.originalPlan.treatmentPlan ? p.originalPlan.treatmentPlan : 'Nincs szöveges terv a pillanatképben.'}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{Array.isArray(p.originalPlan.workPhases) ? p.originalPlan.workPhases.length : 0} munkafázis a regisztrációkor. A későbbi változásokat előzményként megőrizzük.</p>
          </details>
          </details>
        </section>;
      })}</div>
        <button className="mt-4 inline-flex items-center gap-1 text-sm text-gray-500 underline dark:text-gray-400" disabled={data.deceased || !!mode || !data.episodes.some((e) => e.id === episodeId && e.status === 'open')} onClick={() => start({ kind: 'register' })}><Plus className="h-3 w-3" />Másik fogpótlás</button>
      </details>
      <details className={panel}><summary className="cursor-pointer text-sm font-medium">Korábbi vizitek</summary>
        <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">{data.encounters.filter((v) => v.links.some((l) => prostheses.some((p) => p.id === l.prosthesisId))).slice().reverse().map((v) => <article key={v.id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-semibold">{v.occurredAt ? appointmentDate(v.occurredAt) : shortDate(v.occurredOn)} · {v.phase === 'construction' ? 'Készítés' : 'Utógondozás'} · {v.clinician}</h3>
            <button disabled={data.deceased || !!mode || !attended(v.appointmentStatus)} className="text-sm text-teal-700 underline dark:text-teal-300" onClick={() => start({ kind: 'visit', encounter: v })}>Javítás</button></div>
          {!attended(v.appointmentStatus) && <p className="mt-1 text-sm text-amber-700">Az időpont jelenleg nem megjelent státuszú; a kutatási számlálásból kimarad.</p>}
          {v.phase === 'construction' && <p className="mt-2 text-sm">{labelCodes(v.constructionActivities, CONSTRUCTION_ACTIVITIES)}{v.planDeviation && ` · Terveltérés: ${v.planDeviation}`}</p>}
          {v.links.map((l) => <p key={l.prosthesisId} className="mt-2 text-sm"><strong>{data.prostheses.find((p) => p.id === l.prosthesisId)?.label}:</strong> {l.problems.length ? labelCodes(l.problems, PROBLEMS) : v.phase === 'aftercare' ? 'Panasz nélküli kontroll' : ''}
            {l.interventions.length > 0 && ` → ${labelCodes(l.interventions, INTERVENTIONS)}`}{l.result && ` · ${RESULTS[l.result]}`}{l.nextAction && ` · ${NEXT_ACTIONS[l.nextAction]}`}
            {l.functionScore !== null && ` · Funkció: ${l.functionScore}/10`}{l.comfortScore !== null && ` · Komfort: ${l.comfortScore}/10`}</p>)}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{v.clinicalMinutes !== null ? `${v.clinicalMinutes} perc mért klinikai idő` : 'Klinikai idő nincs mérve'}{v.returnAfterDays && ` · Visszatérés: ${v.returnAfterDays} nap`}{v.delayReason !== 'none' && ` · Késés: ${DELAY_REASONS[v.delayReason]}`} · {v.version}. változat</p>
          {v.note && <p className="mt-2 whitespace-pre-wrap text-sm">{v.note}</p>}
        </article>)}</div>
        {!data.encounters.length && <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Még nincs rögzített vizit.</p>}
      </details>
      {burden && prostheses.length > 0 && <details className={panel}><summary className="cursor-pointer text-sm font-medium">Kutatási összesítés</summary>
        <p className="my-3 text-xs text-gray-500 dark:text-gray-400">Az átadástól számított három naptári hónap. Egy megjelenés két érintett fogpótlás esetén is egyszer számít.</p>
        <dl className="grid grid-cols-2 gap-3 text-sm"><Stat label="Problémás megjelenés" value={burden.problemVisits} /><Stat label="Rögzített idő" value={`${burden.recordedClinicalMinutes} perc (${burden.visitsWithRecordedMinutes} vizit)`} /></dl>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{missingVisits.length > 0 ? `${missingVisits.length} megjelent időpont dokumentációja még hiányzik.` : 'Az eddigi vizitek dokumentálva.'}</p>
      </details>}
      </div></details>}
    </>}
  </div>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-gray-500 dark:text-gray-400">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>;
}
function currentProblems(prosthesis: Prosthesis, encounters: CareEncounter[]) {
  const states = new Map<string, string | null>();
  const visits = encounters.filter((v) => v.phase === 'aftercare' && attended(v.appointmentStatus));
  for (const v of visits) {
    if (prosthesis.followup?.unresolved === false && v.occurredOn <= prosthesis.followup.assessedOn) continue;
    const link = v.links.find((l) => l.prosthesisId === prosthesis.id);
    link?.problems.forEach((p) => states.set(p, link.result));
  }
  return Array.from(states).filter(([, r]) => r !== 'resolved').map(([p]) => p);
}
function RegisterForm({ episodeId, busy, onSave, onCancel }: { episodeId: string; busy: boolean; onSave: (v: unknown) => Promise<void>; onCancel: () => void }) {
  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const jaw = f.get('jaw') as keyof typeof JAWS; const type = f.get('type') as keyof typeof PROSTHESIS_TYPES;
    void onSave({ action: 'register', episodeId, label: `${JAWS[jaw]} · ${PROSTHESIS_TYPES[type]}`, jaw, prosthesisType: type }); }
  return <form className="space-y-4" onSubmit={submit}><h2 className="font-semibold">Fogpótlás megadása</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Állcsont"><select name="jaw" className={inputClass}><Options options={JAWS} /></select></Field>
      <Field label="Fogpótlástípus"><select name="type" className={inputClass}><Options options={PROSTHESIS_TYPES} /></select></Field></div>
    <div className="flex gap-2"><button className="btn-primary" disabled={busy}>Fogpótlás felvétele</button><button type="button" className="btn-secondary" onClick={onCancel}>Mégse</button></div>
  </form>;
}
function DeliveryForm({ data, prosthesis, busy, onSave, onCancel }: { data: AftercareWorkspace; prosthesis: Prosthesis; busy: boolean; onSave: (v: unknown) => Promise<void>; onCancel: () => void }) {
  const [appointmentId, setAppointmentId] = useState('');
  const appointments = data.appointments.filter((a) => a.appointmentStatus === 'completed' && a.occurredOn <= budapestToday() && (!a.episodeId || a.episodeId === prosthesis.episodeId));
  function submit(e: FormEvent) { e.preventDefault(); void onSave({ action: 'deliver', prosthesisId: prosthesis.id, appointmentId }); }
  return <form className="space-y-4" onSubmit={submit}><h2 className="text-lg font-semibold">Átadás · {prosthesis.label}</h2>
    <Field label="Teljesült átadási időpont"><select required className={inputClass} value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}><option value="">Válasszon időpontot</option>{appointments.map((a) => <option key={a.id} value={a.id}>{appointmentDate(a.startTime)} · {a.clinician}</option>)}</select></Field>
    <p className="text-sm text-gray-500 dark:text-gray-400">Az átadás dátumát az időpont adja. Automatikusan létrejön a háromhavi követés kérése.</p>
    {!appointments.length && <Link href={`/patients/${prosthesis.patientId}/stages`} className="block text-sm text-teal-700 underline">Időpont és teljesülés rögzítése</Link>}
    <div className="flex gap-2"><button className="btn-primary" disabled={busy || !appointmentId}>Átadás rögzítése</button><button type="button" className="btn-secondary" onClick={onCancel}>Mégse</button></div>
  </form>;
}
