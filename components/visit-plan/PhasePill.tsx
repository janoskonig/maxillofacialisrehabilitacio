'use client';

/**
 * Kezelés-„kocka": egy munkafázis az alkalom-soron belül, kompakt pill.
 * Kattintás → menü (hatókör/idő, áthelyezés, státusz, feladat, elhagyás);
 * húzás → másik alkalomba vagy az „Új alkalom" zónába. Az összevont gyerek
 * a primary-ja státuszát mutatja és lánc-ikont kap.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CalendarX2, ArrowRightLeft, Plus, SkipForward, RotateCcw, Undo2,
  Trash2, SendHorizontal, Ruler, ChevronLeft, Check,
} from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { LONG_DURATION_MINUTES } from '@/lib/treatment-plan-validation';
import { Popover, MenuItem, MenuHeading } from './Popover';
import {
  parseTeethInput,
  phaseScopeText,
  statusConfig,
  type EpisodeStep,
  type EpisodeVisit,
  type VisitTarget,
} from './visit-plan-types';

export interface PhasePillActions {
  onMove: (target: VisitTarget) => void;
  onDelete: () => void;
  onSkip: (reason: string) => void;
  onUnskip: () => void;
  onReopen: (reason: string) => void;
  onScope: (patch: { jaw: EpisodeStep['jaw']; teeth: string[]; durationMinutes: number }) => void;
  onDelegate: () => void;
}

export interface PhasePillProps {
  step: EpisodeStep;
  label: string;
  displayStatus: EpisodeStep['status'];
  /** Összevont gyerek (a primary-jával egy időpont). */
  isChild: boolean;
  /** A csoport-primary címkéje (gyereknél). */
  primaryLabel?: string | null;
  isNext: boolean;
  pending: boolean;
  visits: EpisodeVisit[];
  visitTitle: (visit: EpisodeVisit, index: number) => string;
  actions: PhasePillActions;
  dragDisabled?: boolean;
}

type MenuView = 'menu' | 'scope' | 'move' | 'reopen' | 'skip';

export function PhasePill({
  step, label, displayStatus, isChild, primaryLabel, isNext, pending,
  visits, visitTitle, actions, dragDisabled,
}: PhasePillProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: `phase:${step.id}`,
    data: { type: 'phase', stepId: step.id, visitId: step.visitId },
    disabled: dragDisabled || pending,
  });
  // Csak a pointer-húzás él a kockán; a billentyűs alternatíva a menü
  // „Áthelyezés" pontja (Enter/Space így a menüt nyitja, nem húzást indít).
  const { onKeyDown: _ignoredKeyDown, ...pointerListeners } = (listeners ?? {}) as Record<string, unknown>;
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : pending ? 0.6 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  };

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('menu');
  const [reason, setReason] = useState('');
  const [jaw, setJaw] = useState<string>(step.jaw ?? '');
  const [teethText, setTeethText] = useState(step.teeth.join(', '));
  const [duration, setDuration] = useState(step.durationMinutes);

  // Húzás után a felengedésre eső click ne nyissa a menüt.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      setView('menu');
      setReason('');
      setJaw(step.jaw ?? '');
      setTeethText(step.teeth.join(', '));
      setDuration(step.durationMinutes);
    }
    setOpen(next);
  };

  const config = statusConfig[displayStatus] ?? statusConfig.pending;
  const StatusIcon = config.icon;
  const scope = phaseScopeText(step);
  const canSkip = !isChild && (step.status === 'pending' || step.status === 'scheduled');
  const canUnskip = !isChild && step.status === 'skipped';
  const canReopen = !isChild && step.status === 'completed';
  const canDelegate = !isChild && (step.status === 'pending' || step.status === 'scheduled');
  const muted = displayStatus === 'completed' || displayStatus === 'skipped';
  const targets = visits
    .map((v, idx) => ({ v, idx }))
    .filter(({ v }) => v.id !== step.visitId);

  const pillClass = `group inline-flex items-center gap-1.5 max-w-full pl-2 pr-2.5 py-1 rounded-full border text-sm transition-colors select-none ${
    isNext
      ? 'border-medical-primary/40 bg-medical-primary/10 text-gray-900 dark:text-gray-100'
      : muted
        ? 'border-transparent bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 hover:border-medical-primary/50'
  } ${dragDisabled || pending ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'shadow-lg ring-2 ring-medical-primary/30' : ''}`;

  return (
    <div ref={setNodeRef} style={style} className="max-w-full" data-testid={`phase-pill-${step.id}`}>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        align="left"
        widthClass="w-72"
        disabled={pending}
        triggerClassName={`${pillClass} touch-none`}
        triggerAriaLabel={`${label} — műveletek`}
        triggerTitle={`${label} · ${config.label}${scope ? ` · ${scope}` : ''}`}
        triggerRef={setActivatorNodeRef}
        triggerProps={{ ...attributes, ...pointerListeners, role: undefined }}
        trigger={
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${config.color}`} aria-hidden />
            <span className={`truncate ${displayStatus === 'skipped' ? 'line-through' : ''}`}>{label}</span>
            {scope && (
              <span className="text-[11px] text-teal-700 dark:text-teal-300 shrink-0">{scope}</span>
            )}
            <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
              {step.durationMinutes}′
            </span>
            {step.status === 'pending' && step.lostAppointment && (
              <CalendarX2
                className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-300"
                aria-label="Nincs élő időpont — foglaljon újat"
              />
            )}
          </span>
        }
      >
        {(close) => {
          const done = () => {
            close();
            setView('menu');
          };
          if (view === 'scope') {
            return (
              <form
                className="p-1 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  actions.onScope({
                    jaw: jaw === '' ? null : (jaw as EpisodeStep['jaw']),
                    teeth: parseTeethInput(teethText),
                    durationMinutes: Math.max(5, duration || 30),
                  });
                  done();
                }}
              >
                <button type="button" onClick={() => setView('menu')} className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-medical-primary px-1">
                  <ChevronLeft className="w-3 h-3" /> Vissza
                </button>
                <div className="flex items-center gap-2 px-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400 w-16" htmlFor={`jaw-${step.id}`}>Állcsont</label>
                  <select
                    id={`jaw-${step.id}`}
                    value={jaw}
                    onChange={(e) => setJaw(e.target.value)}
                    className="flex-1 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900"
                  >
                    <option value="">—</option>
                    <option value="felso">felső</option>
                    <option value="also">alsó</option>
                    <option value="mindketto">mindkettő</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 px-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400 w-16" htmlFor={`teeth-${step.id}`}>Fogak</label>
                  <input
                    id={`teeth-${step.id}`}
                    type="text"
                    value={teethText}
                    onChange={(e) => setTeethText(e.target.value)}
                    placeholder="pl. 11, 12, 21"
                    className="flex-1 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900"
                  />
                </div>
                <div className="flex items-center gap-2 px-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400 w-16" htmlFor={`dur-${step.id}`}>Idő</label>
                  <input
                    id={`dur-${step.id}`}
                    type="number"
                    min={5}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value, 10) || 0)}
                    className="w-20 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-center bg-white dark:bg-gray-900"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">perc</span>
                </div>
                {duration > LONG_DURATION_MINUTES && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 px-1">
                    Szokatlanul hosszú időtartam — ellenőrizze, hogy valóban egy alkalomra szánja.
                  </p>
                )}
                <div className="flex justify-end px-1">
                  <button type="submit" className="inline-flex items-center gap-1 px-2.5 py-1 bg-medical-primary text-white rounded text-xs font-medium hover:bg-medical-primary-dark">
                    <Check className="w-3 h-3" /> Mentés
                  </button>
                </div>
              </form>
            );
          }
          if (view === 'move') {
            return (
              <div>
                <button type="button" onClick={() => setView('menu')} className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-medical-primary px-2 pt-1">
                  <ChevronLeft className="w-3 h-3" /> Vissza
                </button>
                <MenuHeading>Áthelyezés másik alkalomba</MenuHeading>
                {targets.length === 0 && (
                  <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">Nincs másik alkalom.</p>
                )}
                {targets.map(({ v, idx }) => (
                  <MenuItem key={v.id} onClick={() => { actions.onMove(v.id); done(); }}>
                    {visitTitle(v, idx)}
                  </MenuItem>
                ))}
                <MenuItem tone="primary" onClick={() => { actions.onMove('new'); done(); }}>
                  <Plus className="w-3.5 h-3.5" /> Új alkalom
                </MenuItem>
              </div>
            );
          }
          if (view === 'reopen' || view === 'skip') {
            const isReopen = view === 'reopen';
            const valid = !isReopen || reason.trim().length >= 5;
            return (
              <form
                className="p-1 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!valid) return;
                  if (isReopen) actions.onReopen(reason.trim());
                  else actions.onSkip(reason.trim());
                  done();
                }}
              >
                <button type="button" onClick={() => setView('menu')} className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-medical-primary px-1">
                  <ChevronLeft className="w-3 h-3" /> Vissza
                </button>
                <p className="text-xs text-gray-600 dark:text-gray-400 px-1">
                  {isReopen
                    ? 'A kész fázis visszaáll várakozóra — indoklás szükséges (legalább 5 karakter).'
                    : step.status === 'scheduled'
                      ? 'Az átugrással a jövőbeli foglalt időpont lemondásra kerül.'
                      : 'A fázis átugorva marad a tervben (visszaállítható).'}
                </p>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={isReopen ? 'Indoklás…' : 'Ok (opcionális)'}
                  autoFocus
                  className="w-full text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900"
                />
                <div className="flex justify-end px-1">
                  <button
                    type="submit"
                    disabled={!valid}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-white rounded text-xs font-medium disabled:opacity-50 ${isReopen ? 'bg-gray-600 hover:bg-gray-700' : 'bg-amber-500 hover:bg-amber-600'}`}
                  >
                    {isReopen ? 'Visszaállítás' : 'Átugrás'}
                  </button>
                </div>
              </form>
            );
          }
          return (
            <div>
              <div className="px-2 pt-1.5 pb-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{label}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {config.label}
                  {isChild && primaryLabel ? ` · az alkalom blokkjában (${primaryLabel})` : ''}
                </p>
              </div>
              <MenuItem onClick={() => setView('scope')}>
                <Ruler className="w-3.5 h-3.5" /> Hatókör és időtartam
              </MenuItem>
              <MenuItem onClick={() => setView('move')}>
                <ArrowRightLeft className="w-3.5 h-3.5" /> Áthelyezés másik alkalomba
              </MenuItem>
              {canDelegate && (
                <MenuItem onClick={() => { actions.onDelegate(); done(); }}>
                  <SendHorizontal className="w-3.5 h-3.5" /> Feladat kiosztása
                </MenuItem>
              )}
              {canSkip && (
                <MenuItem onClick={() => { setReason(''); setView('skip'); }}>
                  <SkipForward className="w-3.5 h-3.5" /> Átugrom
                </MenuItem>
              )}
              {canUnskip && (
                <MenuItem onClick={() => { actions.onUnskip(); done(); }}>
                  <RotateCcw className="w-3.5 h-3.5" /> Visszaállítás várakozóra
                </MenuItem>
              )}
              {canReopen && (
                <MenuItem onClick={() => { setReason(''); setView('reopen'); }}>
                  <Undo2 className="w-3.5 h-3.5" /> Mégsem kész
                </MenuItem>
              )}
              <MenuItem tone="danger" onClick={() => { actions.onDelete(); done(); }}>
                <Trash2 className="w-3.5 h-3.5" /> Elhagyom a tervből
              </MenuItem>
            </div>
          );
        }}
      </Popover>
    </div>
  );
}
