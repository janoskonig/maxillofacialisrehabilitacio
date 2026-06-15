'use client';

import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';

export interface PlanStartDateControlProps {
  episodeId: string;
  planStartDate: string | null | undefined;
  onSaved: () => void;
}

/** Epizód tervezési kezdődátuma — a munkafázis ablakok horgonya. */
export function PlanStartDateControl({
  episodeId,
  planStartDate,
  onSaved,
}: PlanStartDateControlProps) {
  const toInputValue = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };

  const [value, setValue] = useState(toInputValue(planStartDate));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setValue(toInputValue(planStartDate));
  }, [planStartDate, episodeId]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          planStartDate: value ? `${value}T12:00:00.000Z` : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Mentés sikertelen');
      setMessage('Mentve — az ablakok újraszámolódnak.');
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSaving(false);
    }
  };

  const displayCurrent = planStartDate
    ? new Date(planStartDate).toLocaleDateString('hu-HU', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 mb-2">
      <Calendar className="w-3.5 h-3.5 text-medical-primary shrink-0" />
      <span className="font-medium">Kezdődátum (terv):</span>
      {displayCurrent && (
        <span className="text-gray-600 dark:text-gray-400" title="Jelenleg mentett">
          {displayCurrent}
        </span>
      )}
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border rounded px-1.5 py-0.5 text-xs"
        aria-label="Tervezési kezdődátum"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="text-medical-primary hover:underline font-medium disabled:opacity-50"
      >
        {saving ? '…' : 'Mentés'}
      </button>
      {message && <span className="text-gray-600 dark:text-gray-400">{message}</span>}
    </div>
  );
}
