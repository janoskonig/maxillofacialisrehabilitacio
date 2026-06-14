'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { MobileBottomSheet } from '@/components/mobile/MobileBottomSheet';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { MessageContextEntityType } from '@/lib/types/messaging';

export interface PendingContextLink {
  entityType: MessageContextEntityType;
  entityId: string;
  label: string;
  subtitle?: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientId?: string | null;
  onSelect: (link: PendingContextLink) => void;
  excludeKeys?: string[];
}

const ENTITY_OPTIONS: { value: MessageContextEntityType; label: string; needsPatient: boolean }[] = [
  { value: 'document', label: 'Dokumentum', needsPatient: true },
  { value: 'patient', label: 'Beteg', needsPatient: true },
  { value: 'episode', label: 'Epizód', needsPatient: true },
  { value: 'appointment', label: 'Időpont', needsPatient: true },
  { value: 'work_phase', label: 'Munkafázis', needsPatient: true },
  { value: 'task', label: 'Feladat', needsPatient: false },
  { value: 'consilium_session', label: 'Konzílium', needsPatient: false },
];

type ListRow = { id: string; label: string; subtitle?: string | null };

function entityKey(type: MessageContextEntityType, id: string) {
  return `${type}:${id}`;
}

export function ContextLinkAttachPicker({
  isOpen,
  onClose,
  patientId,
  onSelect,
  excludeKeys = [],
}: Props) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [entityType, setEntityType] = useState<MessageContextEntityType>('document');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excluded = useMemo(() => new Set(excludeKeys), [excludeKeys]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      if (entityType === 'patient' && patientId) {
        const res = await fetch(`/api/patients/${patientId}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Beteg betöltése sikertelen');
        setRows([{ id: patientId, label: data.patient?.nev || 'Beteg', subtitle: data.patient?.taj }]);
        return;
      }

      if (!patientId && entityType !== 'task' && entityType !== 'consilium_session') {
        setError('Válasszon beteget, vagy használjon konzílium / feladat típust.');
        return;
      }

      if (entityType === 'document' && patientId) {
        const res = await fetch(`/api/patients/${patientId}/documents`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Dokumentumok betöltése sikertelen');
        setRows(
          (data.documents ?? []).map((d: { id: string; filename: string; tags?: string[] }) => ({
            id: d.id,
            label: d.filename,
            subtitle: d.tags?.join(', ') || null,
          })),
        );
        return;
      }

      if (entityType === 'episode' && patientId) {
        const res = await fetch(`/api/patients/${patientId}/episodes`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Epizódok betöltése sikertelen');
        setRows(
          (data.episodes ?? []).map(
            (e: { id: string; status: string; reason?: string; caseTitle?: string }) => ({
              id: e.id,
              label: e.caseTitle || e.reason || 'Epizód',
              subtitle: e.status,
            }),
          ),
        );
        return;
      }

      if (entityType === 'appointment' && patientId) {
        const res = await fetch(
          `/api/appointments?patientId=${patientId}&limit=50`,
          { credentials: 'include' },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Időpontok betöltése sikertelen');
        setRows(
          (data.appointments ?? []).map(
            (a: { id: string; startTime?: string; stepLabel?: string; dentistEmail?: string }) => ({
              id: a.id,
              label: a.stepLabel || 'Időpont',
              subtitle: a.startTime
                ? new Date(a.startTime).toLocaleString('hu-HU')
                : a.dentistEmail,
            }),
          ),
        );
        return;
      }

      if (entityType === 'work_phase' && patientId) {
        const res = await fetch(`/api/patients/${patientId}/care-timeline`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Timeline betöltése sikertelen');
        const events = (data.events ?? []) as Array<{
          type: string;
          payload?: { workPhaseId?: string; workPhaseCode?: string; label?: string };
        }>;
        const seen = new Set<string>();
        const out: ListRow[] = [];
        for (const ev of events) {
          if (ev.type !== 'work_phase' || !ev.payload?.workPhaseId) continue;
          if (seen.has(ev.payload.workPhaseId)) continue;
          seen.add(ev.payload.workPhaseId);
          out.push({
            id: ev.payload.workPhaseId,
            label: ev.payload.label || ev.payload.workPhaseCode || 'Munkafázis',
            subtitle: ev.payload.workPhaseCode,
          });
        }
        setRows(out);
        return;
      }

      if (entityType === 'task') {
        const res = await fetch('/api/user-tasks', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Feladatok betöltése sikertelen');
        let tasks = (data.tasks ?? []) as Array<{
          id: string;
          title: string;
          status: string;
          patientId?: string | null;
        }>;
        if (patientId) {
          tasks = tasks.filter((t) => t.patientId === patientId);
        }
        setRows(
          tasks.map((t) => ({
            id: t.id,
            label: t.title,
            subtitle: t.status,
          })),
        );
        return;
      }

      if (entityType === 'consilium_session') {
        const res = await fetch('/api/consilium/sessions/summary', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Konzíliumok betöltése sikertelen');
        setRows(
          (data.sessions ?? []).map(
            (s: { id: string; title: string; scheduledAt: string; status: string }) => ({
              id: s.id,
              label: s.title,
              subtitle: new Date(s.scheduledAt).toLocaleString('hu-HU'),
            }),
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
    } finally {
      setLoading(false);
    }
  }, [entityType, patientId]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }
    void loadRows();
  }, [isOpen, loadRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        (r.subtitle ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const body = (
    <div className="flex flex-col gap-3 min-h-0">
      <div>
        <label className="form-label block mb-1">Entitás típus</label>
        <select
          className="form-input w-full"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value as MessageContextEntityType)}
        >
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={o.needsPatient && !patientId}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        <input
          type="search"
          className="form-input w-full pl-9"
          placeholder="Keresés…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-gray-500" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Nincs választható elem.</p>
      ) : (
        <ul className="overflow-y-auto max-h-[45vh] divide-y border rounded-lg">
          {filtered.map((row) => {
            const key = entityKey(entityType, row.id);
            const disabled = excluded.has(key);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onSelect({
                      entityType,
                      entityId: row.id,
                      label: row.label,
                      subtitle: row.subtitle,
                    });
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="font-medium text-sm truncate">{row.label}</div>
                  {row.subtitle ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{row.subtitle}</div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <MobileBottomSheet open={isOpen} onOpenChange={(o) => !o && onClose()} title="Kontextus csatolása">
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold">Kontextus csatolása</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Bezárás">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-hidden">{body}</div>
      </div>
    </div>
  );
}
