'use client';

/**
 * WP-4.3 — „Áthelyezés másik alkalomba" menü: a drag-drop KÖTELEZŐ nem-drag
 * alternatívája (mobil + akadálymentesség). Cél-vizit lista + „Új alkalom".
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import type { EpisodeVisit } from './visit-plan-types';

export interface MoveToVisitMenuProps {
  visits: EpisodeVisit[];
  currentVisitId: string | null;
  /** Az alkalom megjelenő neve a listában (pl. „2. alkalom — Koronapróba"). */
  visitOptionLabel: (visit: EpisodeVisit, index: number) => string;
  onMove: (target: string | 'new') => void;
  saving: boolean;
  /** Kompakt (ikon-) változat a vékony kész/kihagyott sorokhoz. */
  compact?: boolean;
}

export function MoveToVisitMenu({
  visits,
  currentVisitId,
  visitOptionLabel,
  onMove,
  saving,
  compact = false,
}: MoveToVisitMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const targets = visits
    .map((v, idx) => ({ visit: v, idx }))
    .filter(({ visit }) => visit.id !== currentVisitId);

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          compact
            ? 'shrink-0 p-1 text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 rounded transition-colors disabled:opacity-50'
            : 'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50'
        }
        title="Áthelyezés másik alkalomba"
      >
        <ArrowRightLeft className={compact ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
        {!compact && 'Áthelyezés'}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1"
        >
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Áthelyezés másik alkalomba
          </p>
          {targets.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
              Nincs másik alkalom — hozzon létre újat alább.
            </p>
          )}
          {targets.map(({ visit, idx }) => (
            <button
              key={visit.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMove(visit.id);
              }}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {visitOptionLabel(visit, idx)}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onMove('new');
            }}
            className="w-full text-left px-2 py-1.5 rounded text-sm font-medium text-medical-primary hover:bg-medical-primary/10 transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Új alkalom
          </button>
        </div>
      )}
    </div>
  );
}
