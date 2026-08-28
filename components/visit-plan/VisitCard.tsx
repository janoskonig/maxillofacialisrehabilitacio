'use client';

/**
 * WP-4.3 — alkalom-kártya: egy vizit (episode_visits sor) a kezelési terven.
 *
 * Fejléc: sorszám + címke (label vagy a fázisok címkéiből), dátum vagy becsült
 * ablak, összidő, státusz-chip, days_offset („ennyi nappal az előző alkalom
 * után") szerkesztéssel. A kártya sortable (alkalmak átrendezése drag-droppal),
 * a törzse droppable (kockák áthúzása ide) — és MINDEN műveletnek van nem-drag
 * alternatívája: fel/le gombok, illetve a kockákon az áthelyezés-menü.
 */
import { useState } from 'react';
import {
  GripVertical, Pencil, ChevronUp, ChevronDown, Trash2, Loader2,
  CalendarDays, Clock3, Check,
} from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EpisodeVisit, VisitDateInfo, VisitStatusSummary } from './visit-plan-types';

export interface VisitCardProps {
  visit: EpisodeVisit;
  /** 0-alapú index a megjelenített alkalom-sorrendben. */
  index: number;
  visitCount: number;
  title: string;
  statusSummary: VisitStatusSummary;
  totalMinutes: number | null;
  dateInfo: VisitDateInfo | null;
  phaseCount: number;
  saving: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteEmpty: () => void;
  /** Címke és days_offset mentése (PATCH /visits/:visitId). */
  onSaveMeta: (patch: { label: string | null; daysOffset: number | null }) => Promise<boolean>;
  children: React.ReactNode;
}

export function VisitCard({
  visit, index, visitCount, title, statusSummary, totalMinutes, dateInfo,
  phaseCount, saving, onMoveUp, onMoveDown, onDeleteEmpty, onSaveMeta, children,
}: VisitCardProps) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: `visit:${visit.id}`, data: { type: 'visit', visitId: visit.id } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `visitdrop:${visit.id}`,
    data: { type: 'visit-drop', visitId: visit.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 40 : undefined,
    position: 'relative' as const,
  };

  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(visit.label ?? '');
  const [offsetDraft, setOffsetDraft] = useState<string>(
    visit.daysOffset != null ? String(visit.daysOffset) : ''
  );
  const [metaSaving, setMetaSaving] = useState(false);

  const openEditor = () => {
    setLabelDraft(visit.label ?? '');
    setOffsetDraft(visit.daysOffset != null ? String(visit.daysOffset) : '');
    setEditing(true);
  };

  const handleSaveMeta = async () => {
    setMetaSaving(true);
    try {
      const parsed = offsetDraft.trim() === '' ? null : Math.max(0, parseInt(offsetDraft, 10) || 0);
      const ok = await onSaveMeta({
        label: labelDraft.trim() || null,
        daysOffset: parsed,
      });
      if (ok) setEditing(false);
    } finally {
      setMetaSaving(false);
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`rounded-xl border transition-colors ${
          isOver
            ? 'border-medical-primary ring-2 ring-medical-primary/30 bg-medical-primary/5'
            : 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40'
        } ${isDragging ? 'shadow-lg' : ''}`}
      >
        {/* ─── Fejléc ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-gray-100 dark:border-gray-800">
          <button
            ref={setActivatorNodeRef}
            className="touch-none p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-grab active:cursor-grabbing shrink-0"
            {...attributes}
            {...listeners}
            tabIndex={-1}
            aria-label="Alkalom átrendezése húzással"
          >
            <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          </button>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 shrink-0">
            {index + 1}. alkalom
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400 truncate min-w-0">
            {title}
          </span>
          <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${statusSummary.chipClass}`}
          >
            {statusSummary.label}
          </span>
          {dateInfo && (
            <span
              className={`inline-flex items-center gap-1 text-xs shrink-0 ${
                dateInfo.kind === 'booked'
                  ? 'text-blue-600 dark:text-blue-300'
                  : dateInfo.kind === 'done'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
              title={
                dateInfo.kind === 'booked'
                  ? 'Foglalt időpont'
                  : dateInfo.kind === 'done'
                    ? 'Teljesítés dátuma'
                    : 'Becsült időablak'
              }
            >
              <CalendarDays className="w-3.5 h-3.5" />
              {dateInfo.text}
            </span>
          )}
          {totalMinutes != null && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0">
              <Clock3 className="w-3.5 h-3.5" />
              {totalMinutes} perc
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
            {index === 0
              ? 'első alkalom'
              : visit.daysOffset != null
                ? `az előző után ${visit.daysOffset} nappal`
                : 'eltolás nincs megadva'}
          </span>

          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={openEditor}
              className="p-1 text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 rounded transition-colors"
              title="Alkalom címkéje és eltolása"
              aria-label="Alkalom szerkesztése"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0 || saving}
              className="p-1 text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 rounded transition-colors disabled:opacity-30"
              title="Alkalom előrébb"
              aria-label="Alkalom feljebb"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === visitCount - 1 || saving}
              className="p-1 text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 rounded transition-colors disabled:opacity-30"
              title="Alkalom hátrébb"
              aria-label="Alkalom lejjebb"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            {phaseCount === 0 && (
              <button
                type="button"
                onClick={onDeleteEmpty}
                disabled={saving}
                className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors disabled:opacity-50"
                title="Üres alkalom törlése"
                aria-label="Üres alkalom törlése"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ─── Címke + eltolás szerkesztő ─────────────────────────────── */}
        {editing && (
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 flex-1 min-w-[180px]">
              <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" htmlFor={`visit-label-${visit.id}`}>
                Címke:
              </label>
              <input
                id={`visit-label-${visit.id}`}
                type="text"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder="pl. Előkészítés + lenyomat"
                className="flex-1 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" htmlFor={`visit-offset-${visit.id}`}>
                Az előző alkalom után:
              </label>
              <input
                id={`visit-offset-${visit.id}`}
                type="number"
                min={0}
                value={offsetDraft}
                onChange={(e) => setOffsetDraft(e.target.value)}
                className="w-16 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-center"
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">nappal</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleSaveMeta}
                disabled={metaSaving}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-medical-primary text-white rounded text-xs font-medium hover:bg-medical-primary-dark disabled:opacity-50"
              >
                {metaSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Mentés
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Mégse
              </button>
            </div>
          </div>
        )}

        {/* ─── Kockák (droppable törzs) ───────────────────────────────── */}
        <div ref={setDropRef} className="p-2 space-y-1 min-h-[44px]">
          {phaseCount === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-2 py-2">
              Üres alkalom — húzzon ide kezelés-kockát, vagy használja a kockák
              „Áthelyezés" menüjét.
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
