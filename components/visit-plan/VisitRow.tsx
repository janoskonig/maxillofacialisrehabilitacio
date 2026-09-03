'use client';

/**
 * Egy alkalom („vizit") sora a tervben: fejléc (sorszám, cím, dátum/ablak,
 * összidő, státusz, foglalás, menü) + a kockák. Sortable (alkalmak
 * átrendezése) és droppable (kocka / paletta-elem ide ejtése). A fejlécre
 * kattintás aktívvá teszi az alkalmat — a paletta ide pakol.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GripVertical, ChevronUp, ChevronDown, Trash2, Pencil, MoreHorizontal,
  CalendarDays, Clock3, Plus, Loader2, Link2, Unlink, CalendarCheck2,
} from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Popover, MenuItem } from './Popover';
import {
  formatShortDateTime,
  visitHasOpenAppointment,
  type EpisodeVisit,
  type VisitDateInfo,
  type VisitStatusSummary,
} from './visit-plan-types';

export interface VisitRowProps {
  visit: EpisodeVisit;
  index: number;
  visitCount: number;
  title: string;
  statusSummary: VisitStatusSummary;
  totalMinutes: number | null;
  dateInfo: VisitDateInfo | null;
  phaseCount: number;
  isActive: boolean;
  pending: boolean;
  onActivate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteEmpty: () => void;
  onRename: (label: string | null) => void;
  /** Puzzle v2: meglévő időpont hozzárendelése (a váz) — nincs, ha nincs szabad időpont. */
  onAttachAppointment?: () => void;
  unattachedCount?: number;
  /** Puzzle v2: az alkalom időpontjának leválasztása lemondás nélkül. */
  onDetachAppointment?: () => void;
  /** Vizit-szintű foglalási vezérlő (a konténer rendereli a worklist-állapotból). */
  bookingSlot?: ReactNode;
  /** Kockák. */
  children: ReactNode;
  /** A kockák alatt megjelenő extra tartalom (pl. feladat-kiosztó blokk). */
  footer?: ReactNode;
}

export function VisitRow({
  visit, index, visitCount, title, statusSummary, totalMinutes, dateInfo, phaseCount,
  isActive, pending, onActivate, onMoveUp, onMoveDown, onDeleteEmpty, onRename,
  onAttachAppointment, unattachedCount = 0, onDetachAppointment,
  bookingSlot, children, footer,
}: VisitRowProps) {
  const bookedOpen = visitHasOpenAppointment(visit);
  const emptyBooked = bookedOpen && phaseCount === 0;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: `visit:${visit.id}`, data: { type: 'visit', visitId: visit.id }, disabled: pending });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `visitdrop:${visit.id}`,
    data: { type: 'visit-drop', visitId: visit.id },
    disabled: pending,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.6 : pending ? 0.7 : 1,
    zIndex: isDragging ? 40 : undefined,
    position: 'relative',
  };

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(visit.label ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const commitRename = () => {
    const next = draft.trim() || null;
    setRenaming(false);
    if (next !== (visit.label ?? null)) onRename(next);
  };

  return (
    <div ref={setNodeRef} style={style} data-testid={`visit-row-${visit.id}`}>
      <div
        className={`rounded-xl border transition-colors ${
          isOver
            ? 'border-medical-primary ring-2 ring-medical-primary/30 bg-medical-primary/5'
            : isActive
              ? 'border-medical-primary/50 bg-white dark:bg-gray-900 ring-1 ring-medical-primary/20'
              : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
        } ${isDragging ? 'shadow-lg' : ''}`}
      >
        {/* ─── Fejléc ─────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
          onClick={onActivate}
          role="button"
          tabIndex={0}
          aria-pressed={isActive}
          aria-label={`${index + 1}. alkalom kiválasztása`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onActivate();
            }
          }}
        >
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="touch-none p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-grab active:cursor-grabbing shrink-0 text-gray-400 dark:text-gray-500"
            {...attributes}
            {...listeners}
            tabIndex={-1}
            aria-label="Alkalom átrendezése húzással"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 shrink-0 tabular-nums">
            {index + 1}.
          </span>
          {renaming ? (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraft(visit.label ?? '');
                  setRenaming(false);
                }
              }}
              placeholder="Alkalom címkéje"
              aria-label="Alkalom címkéje"
              className="flex-1 min-w-0 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-0.5 bg-white dark:bg-gray-900"
            />
          ) : (
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate min-w-0" title={title}>
              {title}
            </span>
          )}
          {pending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" aria-label="Mentés…" />}
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0 ${statusSummary.chipClass}`}>
            {statusSummary.label}
          </span>
          {dateInfo && (
            <span
              className={`hidden sm:inline-flex items-center gap-1 text-xs shrink-0 ${
                dateInfo.kind === 'booked'
                  ? 'text-blue-600 dark:text-blue-300'
                  : dateInfo.kind === 'done'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
              title={dateInfo.kind === 'booked' ? 'Foglalt időpont' : dateInfo.kind === 'done' ? 'Teljesítés dátuma' : 'Becsült időablak'}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              {dateInfo.text}
            </span>
          )}
          {totalMinutes != null && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 tabular-nums"
              data-testid="visit-total-minutes"
              title="Az alkalom összideje"
            >
              <Clock3 className="w-3.5 h-3.5" />
              {totalMinutes}′
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()} role="presentation">
            {bookingSlot ??
              (bookedOpen && visit.appointmentStart ? (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded"
                  title="Az alkalom időpontja (a váz) — a tartalom ide pakolható"
                  data-testid="visit-appointment-chip"
                >
                  <CalendarCheck2 className="w-3 h-3" />
                  {formatShortDateTime(visit.appointmentStart)}
                </span>
              ) : null)}
            <Popover
              align="right"
              widthClass="w-56"
              disabled={pending}
              triggerAriaLabel="Alkalom műveletei"
              triggerTitle="Alkalom műveletei"
              triggerClassName="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 transition-colors disabled:opacity-50"
              trigger={<MoreHorizontal className="w-4 h-4" />}
            >
              {(close) => (
                <div>
                  <MenuItem onClick={() => { setDraft(visit.label ?? ''); setRenaming(true); close(); }}>
                    <Pencil className="w-3.5 h-3.5" /> Címke szerkesztése
                  </MenuItem>
                  <MenuItem disabled={index === 0} onClick={() => { onMoveUp(); close(); }}>
                    <ChevronUp className="w-3.5 h-3.5" /> Előrébb
                  </MenuItem>
                  <MenuItem disabled={index >= visitCount - 1} onClick={() => { onMoveDown(); close(); }}>
                    <ChevronDown className="w-3.5 h-3.5" /> Hátrébb
                  </MenuItem>
                  {!bookedOpen && onAttachAppointment && (
                    <MenuItem
                      disabled={unattachedCount === 0}
                      onClick={() => { onAttachAppointment(); close(); }}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {unattachedCount > 0
                        ? `Meglévő időpont hozzárendelése (${unattachedCount})`
                        : 'Meglévő időpont hozzárendelése — nincs szabad'}
                    </MenuItem>
                  )}
                  {bookedOpen && onDetachAppointment && (
                    <MenuItem onClick={() => { onDetachAppointment(); close(); }}>
                      <Unlink className="w-3.5 h-3.5" /> Időpont leválasztása (megmarad)
                    </MenuItem>
                  )}
                  <MenuItem
                    tone="danger"
                    disabled={phaseCount > 0}
                    onClick={() => { onDeleteEmpty(); close(); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {phaseCount > 0
                      ? 'Törlés (előbb ürítse ki)'
                      : bookedOpen
                        ? 'Üres alkalom törlése (időpont lemondása)'
                        : 'Üres alkalom törlése'}
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>
        </div>

        {/* ─── Kockák (droppable) ──────────────────────────────────────── */}
        <div ref={setDropRef} className="flex flex-wrap items-center gap-1.5 px-2 pb-2 min-h-[36px]">
          {children}
          {phaseCount === 0 && (
            <span className={`text-xs px-1 ${emptyBooked ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}`}>
              {emptyBooked
                ? 'Foglalt időpont tartalom nélkül — válasszon a palettáról, vagy húzzon ide kezelést.'
                : 'Üres alkalom — válasszon a bal oldali palettáról, vagy húzzon ide kezelést.'}
            </span>
          )}
          {!isActive && phaseCount > 0 && (
            <button
              type="button"
              onClick={onActivate}
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 transition-colors"
              title="Ide pakolok (a paletta erre az alkalomra tesz)"
              aria-label={`${index + 1}. alkalom kiválasztása célként`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {footer && <div className="px-2 pb-2">{footer}</div>}
      </div>
    </div>
  );
}
