'use client';

import { useEffect,useId,useState } from 'react';
import type { PatientEpisode, ReasonType, TriggerType } from '@/lib/types';
import { REASON_VALUES, TRIGGER_TYPE_VALUES } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { Plus, Loader2 } from 'lucide-react';

interface PatientEpisodeFormProps {
  patientId: string;
  patientReason?: ReasonType | null;
  onEpisodeCreated?: (episode: PatientEpisode) => void;
  /** Beágyazott mód: nincs saját kártya-keret és nyitó gomb — a szülő vezérli a láthatóságot. */
  embedded?: boolean;
  /** Beágyazott módban hívódik Mégse-re és sikeres létrehozás után. */
  onClose?: () => void;
  onStateChange?:(state:{dirty:boolean;saving:boolean})=>void;
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
  embedded = false,
  onClose,
  onStateChange,
}: PatientEpisodeFormProps) {
  const { showToast } = useToast();
  const fieldId=useId();
  const [open, setOpen] = useState(embedded);
  const [reason, setReason] = useState<ReasonType|''>(patientReason || '');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [caseTitle,setCaseTitle]=useState('');
  const [triggerType, setTriggerType] = useState<TriggerType | ''>('');
  const [saving, setSaving] = useState(false);

  const dirty=!!(chiefComplaint||caseTitle||triggerType||reason!==(patientReason||''));
  useEffect(()=>{onStateChange?.({dirty,saving});},[dirty,saving,onStateChange]);
  useEffect(()=>()=>onStateChange?.({dirty:false,saving:false}),[onStateChange]);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason,
          chiefComplaint: chiefComplaint.trim(),caseTitle:caseTitle.trim()||null,
          triggerType: triggerType || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Hiba az epizód létrehozásakor');
      }

      showToast('Új ellátási epizód sikeresen indítva', 'success');
      setChiefComplaint('');setCaseTitle('');
      setTriggerType('');
      setOpen(embedded);
      if (embedded) onClose?.();
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
      showToast('Az epizód indításának oka kötelező', 'error');
      return;
    }
    await submit();
  };

  return (
    <div className={embedded ? '' : 'bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4'}>
      {!open && !embedded ? (
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
          <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">Először az ellátás konkrét okát add meg. A tervezett fogpótlást és annak finanszírozását az epizódhoz kapcsolhatod.</p>

          <div>
            <label htmlFor={`${fieldId}-reason`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Az ellátás alapjául szolgáló állapot</label>
            <select
              id={`${fieldId}-reason`} value={reason}
              onChange={(e) => setReason(e.target.value as ReasonType)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
              required
            >
              <option value="" disabled>Válassz állapotot…</option>
              {REASON_VALUES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${fieldId}-complaint`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Miért indul ez az epizód?</label>
            <textarea
              rows={3}
              maxLength={10000}
              id={`${fieldId}-complaint`} value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Például: felső foghiány rehabilitációja vagy eltört pótlás javítása"
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
              required
            />
          </div>

          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rövid megnevezés · opcionális<input type="text" maxLength={500} value={caseTitle} onChange={e=>setCaseTitle(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" placeholder="Például: felső végleges fogpótlás"/></label></div>
          <div>
            <label htmlFor={`${fieldId}-trigger`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Indító esemény (opcionális)</label>
            <select
              id={`${fieldId}-trigger`} value={triggerType}
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
              onClick={() => {
                setChiefComplaint('');setCaseTitle('');
                setTriggerType('');
                if (embedded) onClose?.();
                else setOpen(false);
              }}
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
