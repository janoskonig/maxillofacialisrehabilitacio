'use client';

import { useEffect, useState } from 'react';
import { BellOff, BellRing, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { QuestionnaireReminderOptOut } from '@/lib/questionnaire-reminder-optout';

interface Props {
  /** 'portal' = a beteg saját beállítása; 'staff' = kartonon a személyzet. */
  mode: 'portal' | 'staff';
  /** Staff módban kötelező. */
  patientId?: string;
  /** Staff módban: csak olvasható nézet. */
  readOnly?: boolean;
  /** Tömör (kártyán belüli) megjelenés. */
  compact?: boolean;
}

/**
 * Kérdőív-emlékeztetők ki/bekapcsolása (patients.kerdoiv_emlekezteto_tiltva).
 * Kikapcsolva a beteg nem kap OHIP-14 / önkitöltés kitöltésére buzdító e-mailt,
 * push-t és portál-feladatot; önkéntesen továbbra is kitöltheti a kérdőíveket.
 */
export function QuestionnaireReminderOptOutCard({ mode, patientId, readOnly = false, compact = false }: Props) {
  const { showToast } = useToast();
  const [state, setState] = useState<QuestionnaireReminderOptOut | null>(null);
  const [saving, setSaving] = useState(false);

  const endpoint =
    mode === 'portal'
      ? '/api/patient-portal/questionnaire-reminders'
      : `/api/patients/${patientId}/questionnaire-reminders`;

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.optedOut === 'boolean') setState(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const toggle = async () => {
    if (!state || saving || readOnly) return;
    const next = !state.optedOut;
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optedOut: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState(await res.json());
      showToast(
        next ? 'Kérdőív-emlékeztetők kikapcsolva' : 'Kérdőív-emlékeztetők visszakapcsolva',
        'success',
      );
    } catch {
      showToast('Nem sikerült menteni a beállítást', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!state) return null;

  const optedOut = state.optedOut;
  const changedText = state.changedAt
    ? `${new Date(state.changedAt).toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' })}${
        mode === 'staff' && state.changedBy
          ? ` · ${state.changedBy === 'patient' ? 'a beteg a portálon' : state.changedBy}`
          : ''
      }`
    : null;

  const title = mode === 'portal' ? 'Kérdőív-emlékeztetők' : 'Kérdőív-emlékeztetők a betegnek';
  const description = optedOut
    ? mode === 'portal'
      ? 'Ön nem kér emlékeztetőt a kérdőívek kitöltésére. A kérdőíveket ettől még bármikor önkéntesen kitöltheti.'
      : 'A beteg nem kap kérdőív-kitöltésre buzdító e-mailt, értesítést és portál-feladatot (OHIP-14, önkitöltés).'
    : mode === 'portal'
      ? 'Időnként e-mailben és értesítésben emlékeztetjük a kérdőívek (pl. OHIP-14) kitöltésére. Ha nem kíván kérdőívet kitölteni, kikapcsolhatja.'
      : 'A beteg megkapja a kérdőív-kitöltésre buzdító emlékeztetőket (OHIP-14, önkitöltés).';

  const wrapperClass = compact
    ? 'mb-6 p-3 rounded-lg border'
    : 'rounded-lg border p-4 sm:p-6';
  const toneClass = optedOut
    ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
    : 'bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800';

  return (
    <div className={`${wrapperClass} ${toneClass}`}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between">
        <div className="min-w-0">
          <p
            className={`font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 ${
              compact ? 'text-sm' : 'text-base sm:text-lg'
            }`}
          >
            {optedOut ? (
              <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" aria-hidden="true" />
            ) : (
              <BellRing className="w-4 h-4 text-medical-primary shrink-0" aria-hidden="true" />
            )}
            {title}
            {optedOut && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                kikapcsolva
              </span>
            )}
          </p>
          <p className={`text-gray-600 dark:text-gray-400 mt-1 ${compact ? 'text-xs' : 'text-xs sm:text-sm'}`}>
            {description}
          </p>
          {changedText && (
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">Utoljára módosítva: {changedText}</p>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            role="switch"
            aria-checked={!optedOut}
            onClick={toggle}
            disabled={saving}
            className={`shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
              optedOut
                ? 'border-medical-primary text-medical-primary hover:bg-medical-primary/5'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {optedOut ? 'Emlékeztetők visszakapcsolása' : 'Nem kérek emlékeztetőt'}
          </button>
        )}
      </div>
    </div>
  );
}
