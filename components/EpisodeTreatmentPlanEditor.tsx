'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { MAX_EPISODE_TREATMENT_PLAN_LENGTH, getUnassignedLegacyPlan, type EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';

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
  const dirty = plan !== null && (draft.upper.trim() !== (plan.treatmentPlanUpper ?? '') || draft.lower.trim() !== (plan.treatmentPlanLower ?? ''));
  const legacy = plan ? getUnassignedLegacyPlan(plan) : null;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/treatment-plan`, { credentials: 'include', signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nem sikerült betölteni a kezelési tervet.');
      if (signal?.aborted) return;
      setPlan(data.plan);
      setDraft({ upper: data.plan.treatmentPlanUpper ?? '', lower: data.plan.treatmentPlanLower ?? '' });
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
        body: JSON.stringify({ treatmentPlanUpper: draft.upper.trim() || null, treatmentPlanLower: draft.lower.trim() || null, expectedVersion: plan.version }),
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
      setDraft({ upper: data.plan.treatmentPlanUpper ?? '', lower: data.plan.treatmentPlanLower ?? '' });
      setConflict(false);
      showToast('Kezelési tervek mentve.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mentési hiba.');
    } finally { setSaving(false); }
  };

  return (
    <section aria-label="Epizód kezelési terve" className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Kezelési tervek állcsontonként</h3>
      <p className="mt-1 mb-3 text-sm text-gray-600 dark:text-gray-400">Az epizód felső és alsó állcsontjának tervezett ellátása, külön rögzítve. Mentés után a NEAK-csomag külön kezelési terv dokumentumában is megjelenik.</p>
      {loading ? <p role="status">Kezelési terv betöltése…</p> : plan ? (
        canEdit ? <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([{ jaw: 'upper', label: 'Felső állcsont kezelési terve' }, { jaw: 'lower', label: 'Alsó állcsont kezelési terve' }] as const).map(({ jaw, label }) => (
              <div key={jaw}>
                <label htmlFor={`treatment-plan-${episodeId}-${jaw}`} className="block mb-2 text-sm font-semibold">{label}</label>
                <textarea id={`treatment-plan-${episodeId}-${jaw}`} value={draft[jaw]} onChange={(e) => setDraft((current) => ({ ...current, [jaw]: e.target.value }))} disabled={saving}
                  rows={7} maxLength={MAX_EPISODE_TREATMENT_PLAN_LENGTH}
                  placeholder="Tervezett ellátás, érintett fogak, választott megoldás és indoklás…"
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 p-3 text-sm text-gray-900 dark:text-gray-100" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={!dirty || saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Mentés…' : conflict ? 'Áttekintett terv mentése' : 'Kezelési tervek mentése'}</button>
            {dirty && <button type="button" disabled={saving} onClick={() => { setDraft({ upper: plan.treatmentPlanUpper ?? '', lower: plan.treatmentPlanLower ?? '' }); setConflict(false); setError(null); }} className="text-sm underline">Módosítások elvetése</button>}
            <span className="text-xs text-gray-500 dark:text-gray-400" role="status">{dirty ? 'Nem mentett módosítások' : (plan.treatmentPlanUpper || plan.treatmentPlanLower) ? 'Mentett kezelési tervek' : 'Nincs még rögzített kezelési terv'}</span>
          </div>
        </> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><p className="font-semibold">Felső állcsont kezelési terve</p><p className="mt-1 whitespace-pre-wrap break-words">{plan.treatmentPlanUpper || 'Nincs rögzített felső kezelési terv.'}</p></div>
          <div><p className="font-semibold">Alsó állcsont kezelési terve</p><p className="mt-1 whitespace-pre-wrap break-words">{plan.treatmentPlanLower || 'Nincs rögzített alsó kezelési terv.'}</p></div>
        </div>
      ) : <button type="button" onClick={() => load()} className="text-sm underline">Újrapróbálás</button>}
      {legacy && <div className="mt-3 rounded border border-amber-200 dark:border-amber-700 p-3 text-sm">
        <p className="font-semibold">Korábban rögzített közös terv</p>
        <p className="mt-1">A korábbi szöveg megmaradt. Az állcsont szerinti besorolását Ön adhatja meg.</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{legacy}</p>
        {canEdit && <div className="mt-2 flex flex-wrap gap-3">
          <button type="button" disabled={saving || draft.upper.includes(legacy)} onClick={() => setDraft((current) => ({ ...current, upper: [current.upper, legacy].filter(Boolean).join('\n\n') }))} className="underline">Hozzáadás a felső tervhez</button>
          <button type="button" disabled={saving || draft.lower.includes(legacy)} onClick={() => setDraft((current) => ({ ...current, lower: [current.lower, legacy].filter(Boolean).join('\n\n') }))} className="underline">Hozzáadás az alsó tervhez</button>
        </div>}
      </div>}
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
