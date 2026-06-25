'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PatientEpisode, ReasonType, TriggerType } from '@/lib/types';
import { REASON_VALUES, TRIGGER_TYPE_VALUES } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { completenessEditHref } from '@/lib/completeness-deeplinks';
import { Plus, Loader2, AlertTriangle } from 'lucide-react';

interface MissingItem {
  key: string;
  label: string;
}

interface GateBlock {
  missing: MissingItem[];
  canOverride: boolean;
}

interface PatientEpisodeFormProps {
  patientId: string;
  patientReason?: ReasonType | null;
  onEpisodeCreated?: (episode: PatientEpisode) => void;
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  recidiva: 'Recidíva',
  fogelvesztes: 'Fogelvesztés',
  potlasvesztes: 'Pótlásvesztés',
  kontrollbol_uj_panasz: 'Kontrollból új panasz',
  egyeb: 'Egyéb',
};

export function PatientEpisodeForm({
  patientId,
  patientReason,
  onEpisodeCreated,
}: PatientEpisodeFormProps) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReasonType>(patientReason || 'onkológiai kezelés utáni állapot');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType | ''>('');
  const [saving, setSaving] = useState(false);
  const [gateBlock, setGateBlock] = useState<GateBlock | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const submit = async (opts?: { force?: boolean; overrideReason?: string }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason,
          chiefComplaint: chiefComplaint.trim(),
          triggerType: triggerType || undefined,
          force: opts?.force || undefined,
          overrideReason: opts?.overrideReason || undefined,
        }),
      });

      const data = await res.json();

      // KAPU: hiányos klinikai adat — hiánylista + (jogosultság esetén) felülbírálás.
      if (res.status === 422 && data.error === 'CLINICAL_DATA_INCOMPLETE') {
        setGateBlock({ missing: data.missing ?? [], canOverride: !!data.canOverride });
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Hiba az epizód létrehozásakor');
      }

      showToast('Új ellátási epizód sikeresen indítva', 'success');
      setChiefComplaint('');
      setTriggerType('');
      setGateBlock(null);
      setOverrideReason('');
      setOpen(false);
      onEpisodeCreated?.(data.episode);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Hiba az epizód létrehozásakor', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chiefComplaint.trim()) {
      showToast('Cím / ok megadása kötelező', 'error');
      return;
    }
    setGateBlock(null);
    await submit();
  };

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      showToast('A felülbíráláshoz indok megadása kötelező', 'error');
      return;
    }
    await submit({ force: true, overrideReason: overrideReason.trim() });
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-medical-primary hover:text-medical-primary-dark font-medium"
        >
          <Plus className="w-5 h-5" />
          Új ellátási epizód indítása
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">Új ellátási epizód</h4>

          {gateBlock && (
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Hiányzó kötelező klinikai adatok
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    Az epizód indítása előtt pótolja az alábbi adatokat (kattintással a megfelelő űrlaprészhez ugorhat):
                  </p>
                  <ul className="flex flex-wrap gap-1.5 mt-2">
                    {gateBlock.missing.map((m) => (
                      <li key={m.key}>
                        <Link
                          href={completenessEditHref(patientId, m.key)}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border border-amber-300 dark:border-amber-800 bg-white dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60"
                        >
                          {m.label}
                        </Link>
                      </li>
                    ))}
                  </ul>

                  {gateBlock.canOverride && (
                    <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-900">
                      <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                        Felülbírálás indoka (kezelőorvosi/admin felelősség)
                      </label>
                      <textarea
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        rows={2}
                        placeholder="Pl. sürgős eset, az adat utólag pótlásra kerül…"
                        className="w-full rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onClick={handleOverride}
                        disabled={saving}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                        Felülbírálás és epizód indítása
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Etiológia (kötelező)</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonType)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
              required
            >
              {REASON_VALUES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cím / ok (kötelező)</label>
            <input
              type="text"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="pl. Obturátor remake, Recidíva 2027"
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Indító esemény (opcionális)</label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType((e.target.value || '') as TriggerType | '')}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {TRIGGER_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50 text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Epizód indítása
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setChiefComplaint(''); setTriggerType(''); }}
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              Mégse
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
