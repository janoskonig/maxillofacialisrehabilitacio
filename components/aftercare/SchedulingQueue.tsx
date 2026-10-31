'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { DELAY_REASONS, NEXT_ACTIONS, budapestToday, slotSecured, type CareAppointment, type SchedulingRequest } from '@/lib/aftercare/model';
import { groupSchedulingRequests, type SchedulingGroup } from '@/lib/aftercare/scheduling-groups';
import { AppointmentBookingSection } from '@/components/AppointmentBookingSection';
import { CapacityForecastChart } from '@/components/charts/CapacityForecastChart';
import { appointmentDate, Field, inputClass, Options, panel, requestJson, shortDate } from './Fields';

export function SchedulingQueue() {
  const [requests, setRequests] = useState<SchedulingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'unsecured' | 'all' | 'secured'>('unsecured');
  const [active, setActive] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const load = useCallback(async () => {
    const data = await requestJson<{ requests: SchedulingRequest[] }>('/api/aftercare/queue');
    setRequests(data.requests);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [load]);
  const today = budapestToday();
  const groups = groupSchedulingRequests(requests);
  const shown = groups.filter((r) => filter === 'all' || (filter === 'secured' ? r.slotSecured : !r.slotSecured));
  async function exportResearch() {
    setExporting(true); setError('');
    try {
      const data = await requestJson<unknown>('/api/aftercare/research-export', {});
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `prosthesis-workload-${today}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  }
  return <div className="space-y-4 text-gray-900 dark:text-gray-100">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm text-gray-500 dark:text-gray-400">{loading ? 'Betöltés…' : `${groups.filter((r) => !r.slotSecured).length} időpontra vár · ${groups.filter((r) => !r.slotSecured && r.dueOn < today).length} határidőn túl`}</p></div>
      <div className="flex items-end gap-2"><Field label="Mutasd"><select className={inputClass} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
        <option value="unsecured">Időpontra vár</option><option value="secured">Időpontja van</option><option value="all">Minden kérés</option></select></Field>
        <button type="button" aria-label="Frissítés" className="btn-secondary" onClick={() => { setError(''); load().catch((e) => setError(e.message)); }}><RefreshCw className="h-4 w-4" /></button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {!loading && <div className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
      {shown.map((r) => <section key={r.members.map((m) => `${m.id}:${m.version}`).join('|')} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1">
          <Link href={`/patients/${r.patientId}/stages?episodeId=${r.episodeId}&view=aftercare#gondozas`} className="font-medium text-teal-800 hover:underline dark:text-teal-200">{r.patientName}</Link>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{r.source === 'delivery_review' ? 'Háromhavi kontroll' : r.nextAction.split(',').map((key) => NEXT_ACTIONS[key as keyof typeof NEXT_ACTIONS] || key).join(', ')} · {r.prosthesisLabels}</p>
          {r.slotSecured && <p className="mt-1 text-sm text-teal-700 dark:text-teal-300">{appointmentDate(r.appointmentStart)}</p>}
          {r.delayReason !== 'none' && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Késés: {DELAY_REASONS[r.delayReason]}</p>}
        </div>
          <p className={`text-sm ${!r.slotSecured && r.dueOn < today ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'}`}>{shortDate(r.dueOn)}</p>
          <button className="btn-secondary text-sm" aria-expanded={active === r.id} onClick={() => setActive(active === r.id ? null : r.id)}>{active === r.id ? 'Bezárás' : 'Időpont'}</button>
        </div>
        {r.slotSecured && ['completed', 'unsuccessful'].includes(r.appointmentStatus ?? '') && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">Megjelent; a {r.source === 'delivery_review' ? 'követés' : 'vizit'} dokumentációja még nem teljes.</p>}
        {active === r.id && <QueueEditor request={r} onUpdated={load} onError={setError} />}
      </section>)}
      {!shown.length && <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Nincs ilyen visszarendelés.</p>}
    </div>}
    <details className="text-sm" onToggle={(e) => setShowReports(e.currentTarget.open)}><summary className="cursor-pointer text-gray-500 dark:text-gray-400">Összesítések és kutatási export</summary>
      {showReports && <div className="mt-3 space-y-4"><button className="btn-secondary" disabled={exporting} onClick={exportResearch}>{exporting ? 'Exportálás…' : 'Kutatási export'}</button>
        <div className={panel}><CapacityForecastChart /></div></div>}
    </details>
  </div>;
}

function QueueEditor({ request, onUpdated, onError }: { request: SchedulingGroup; onUpdated: () => Promise<void>; onError: (message: string) => void }) {
  const [appointments, setAppointments] = useState<CareAppointment[]>([]);
  const [appointmentId, setAppointmentId] = useState(request.slotSecured ? request.appointmentId ?? '' : '');
  const [delayReason, setDelayReason] = useState(request.delayReason);
  const [busy, setBusy] = useState(false);
  const loadOptions = useCallback(async () => {
    const data = await requestJson<{ appointments: CareAppointment[] }>(`/api/patients/${request.patientId}/aftercare`);
    setAppointments(data.appointments.filter((a) => slotSecured(a.appointmentStatus, a.id) && a.occurredOn > request.requestedOn
      && (request.source !== 'delivery_review' || a.occurredOn >= request.dueOn)));
  }, [request.patientId, request.requestedOn, request.dueOn, request.source]);
  useEffect(() => { loadOptions().catch((e) => onError(e.message)); }, [loadOptions, onError]);
  async function update(id: string | null) {
    setBusy(true); onError('');
    try {
      for (const member of request.members) await requestJson(`/api/aftercare/queue/${member.id}`, { appointmentId: id, delayReason, expectedVersion: member.version }, 'PATCH');
      await onUpdated();
    } catch (e) {
      onError(`${(e as Error).message}${id ? ' A már lefoglalt időpont megmaradt; frissítés után kapcsolható.' : ''}`);
      await onUpdated().catch(() => {});
    } finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-3 border-t border-gray-200 pt-3 dark:border-gray-700">
    <div className="flex items-end gap-2"><div className="flex-1"><Field label="Időpont a beteghez"><select className={inputClass} value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
      <option value="">Nincs kapcsolt időpont</option>{appointments.map((a) => <option key={a.id} value={a.id}>{appointmentDate(a.startTime)}</option>)}</select></Field></div>
      <button className="btn-primary" disabled={busy} onClick={() => update(appointmentId || null)}>Mentés</button>
    </div>
    <details><summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">Késés jelzése</summary><Field label="Késés oka"><select className={inputClass} value={delayReason} onChange={(e) => setDelayReason(e.target.value as typeof delayReason)}><Options options={DELAY_REASONS} /></select></Field></details>
    <details><summary className="cursor-pointer text-sm text-teal-700 dark:text-teal-300">Új időpont foglalása</summary>
      <AppointmentBookingSection patientId={request.patientId} pool="control" standalone bookingOnly fixedAppointmentType="kontroll"
        onBooked={(id) => { if (id) { setAppointmentId(id); void update(id); } else { void loadOptions().catch((e) => onError(e.message)); } }} />
    </details>
  </div>;
}
