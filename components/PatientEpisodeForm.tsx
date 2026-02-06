'use client';

import { useState } from 'react';
import type { PatientEpisode, ReasonType, TriggerType } from '@/lib/types';
import { REASON_VALUES, TRIGGER_TYPE_VALUES } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { Plus, Loader2 } from 'lucide-react';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chiefComplaint.trim()) {
      showToast('Cím / ok megadása kötelező', 'error');
      return;
    }

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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Hiba az epizód létrehozásakor');
      }

      showToast('Új ellátási epizód sikeresen indítva', 'success');
      setChiefComplaint('');
      setTriggerType('');
      setOpen(false);
      onEpisodeCreated?.(data.episode);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Hiba az epizód létrehozásakor', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
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
          <h4 className="font-semibold text-gray-900">Új ellátási epizód</h4>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Etiológia (kötelező)</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonType)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            >
              {REASON_VALUES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cím / ok (kötelező)</label>
            <input
              type="text"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="pl. Obturátor remake, Recidíva 2027"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Indító esemény (opcionális)</label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType((e.target.value || '') as TriggerType | '')}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
              className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
            >
              Mégse
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
