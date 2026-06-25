'use client';

import { useEffect, useState, useCallback } from 'react';
import { Stethoscope, AlertCircle, Pencil, X, Check, Loader2 } from 'lucide-react';

interface KezeloorvosInfo {
  userId: string | null;
  name: string | null;
  intezmeny: string | null;
  assignedByName: string | null;
  isManual: boolean;
}

interface DoctorOption {
  id: string;
  name: string;
  intezmeny: string | null;
}

interface Props {
  patientId: string;
  /** Csak admin / fogpótlástanász delegálhat — másnak csak megjelenítés. */
  canAssign?: boolean;
  /** A hozzárendelés megváltozása után (pl. a fejléc completeness-frissítéséhez). */
  onChanged?: () => void;
}

/**
 * A beteg kezelőorvosa ("páciens kezelőorvosa: dr. X.Y.") — az adatteljességért
 * felelős EGYETLEN személy. Chipként mutatja a felelőst (vagy piros „nincs
 * kijelölve" figyelmeztetést), és admin / fogpótlástanász számára egy modallal
 * delegálható / átadható (a meglévő PATCH /api/patients/[id]/kezeleoorvos).
 */
export function KezeloorvosDelegationWidget({ patientId, canAssign = false, onChanged }: Props) {
  const [info, setInfo] = useState<KezeloorvosInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/kezeleoorvos`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setInfo(data.kezeleoorvos ?? null);
    } catch {
      /* non-critical */
    }
  }, [patientId]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const openModal = async () => {
    setError(null);
    setSelected(info?.userId ?? '');
    setOpen(true);
    if (doctors.length === 0) {
      try {
        const res = await fetch('/api/users/fogpotlastanasz', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setDoctors(
            (data.users ?? []).map((u: { id: string; name?: string; displayName?: string; intezmeny?: string | null }) => ({
              id: u.id,
              name: u.displayName || u.name || '',
              intezmeny: u.intezmeny ?? null,
            }))
          );
        }
      } catch {
        /* non-critical */
      }
    }
  };

  const save = async (userId: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/kezeleoorvos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'A hozzárendelés sikertelen.');
      }
      await loadInfo();
      setOpen(false);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'A hozzárendelés sikertelen.');
    } finally {
      setSaving(false);
    }
  };

  const hasDoctor = !!info?.name;

  return (
    <>
      {hasDoctor ? (
        <button
          type="button"
          disabled={!canAssign}
          onClick={canAssign ? openModal : undefined}
          className={`inline-flex items-center gap-1 text-gray-600 dark:text-gray-300 ${
            canAssign ? 'hover:text-medical-primary cursor-pointer' : 'cursor-default'
          }`}
          title={
            info?.assignedByName
              ? `Kezelőorvos: ${info.name} — delegálta: ${info.assignedByName}`
              : `Kezelőorvos: ${info?.name}`
          }
        >
          <Stethoscope className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate max-w-[14rem]">{info?.name}</span>
          {canAssign && <Pencil className="w-3 h-3 opacity-60" />}
        </button>
      ) : (
        <button
          type="button"
          disabled={!canAssign}
          onClick={canAssign ? openModal : undefined}
          className={`inline-flex items-center gap-1 font-medium text-medical-error ${
            canAssign ? 'hover:underline cursor-pointer' : 'cursor-default'
          }`}
          title="Nincs kezelőorvos kijelölve – ő felel az adatteljességért"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Nincs kezelőorvos
          {canAssign && <Pencil className="w-3 h-3 opacity-60" />}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Kezelőorvos kijelölése / átadása
              </h3>
              <button
                type="button"
                onClick={() => !saving && setOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              A kijelölt kezelőorvos felel a beteg adatteljességéért. A kézi hozzárendelést az
              automatikus újraszámítás nem írja felül.
            </p>

            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Kezelőorvos
            </label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-2 py-1.5 mb-3 text-gray-900 dark:text-gray-100"
            >
              <option value="">— Válasszon orvost —</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.intezmeny ? ` · ${d.intezmeny}` : ''}
                </option>
              ))}
            </select>

            {error && <div className="text-xs text-medical-error mb-3">{error}</div>}

            <div className="flex items-center justify-between gap-2">
              {info?.userId ? (
                <button
                  type="button"
                  onClick={() => save(null)}
                  disabled={saving}
                  className="text-xs text-gray-500 hover:text-medical-error disabled:opacity-50"
                >
                  Kezelőorvos lekapcsolása
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Mégse
                </button>
                <button
                  type="button"
                  onClick={() => save(selected || null)}
                  disabled={saving || !selected || selected === info?.userId}
                  className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Mentés
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
