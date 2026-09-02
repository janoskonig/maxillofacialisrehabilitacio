'use client';

/**
 * Vizit-szintű foglalás: egy alkalom = egy időpont. A gomb a worklist-sor
 * állapotából (READY / BOOKED / …) rajzolódik; több nyitott fázisnál a
 * foglalás előtt a konténer egy blokkba vonja őket (prepare-booking).
 */
import { CalendarPlus, CalendarClock, ChevronDown, Link2, AlertTriangle, Loader2 } from 'lucide-react';
import type { WorklistRowState } from '@/lib/worklist-types';
import { Popover, MenuItem } from './Popover';
import { formatShortDate } from './visit-plan-types';

export interface VisitBookingButtonProps {
  state: WorklistRowState;
  bookedStartIso?: string | null;
  /** ≥2 nyitott fázis — a foglalás egy blokkba vonja őket. */
  needsMerge: boolean;
  busy: boolean;
  onBook: () => void;
  onLink: () => void;
  onMarkDoneRetro: () => void;
  onMarkUnsuccessful: () => void;
}

export function VisitBookingButton({
  state, bookedStartIso, needsMerge, busy, onBook, onLink, onMarkDoneRetro, onMarkUnsuccessful,
}: VisitBookingButtonProps) {
  if (state === 'BOOKING_IN_PROGRESS' || busy) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 px-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Foglalás…
      </span>
    );
  }
  if (state === 'OVERRIDE_REQUIRED') {
    return (
      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300" title="A foglaláshoz felülírási megerősítés szükséges">
        Felülírás szükséges
      </span>
    );
  }
  if (state === 'NEEDS_REVIEW') {
    return (
      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300" title="Hiányzó foglalási adat (időtartam, időablak vagy pool)">
        Ellenőrizendő
      </span>
    );
  }
  if (state === 'READY') {
    return (
      <div className="inline-flex items-stretch rounded overflow-hidden">
        <button
          type="button"
          onClick={onBook}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-white bg-medical-primary hover:bg-medical-primary-dark transition-colors"
          title={needsMerge ? 'Az alkalom fázisai egy időpontra kerülnek, majd időpont választása' : 'Időpont foglalása erre az alkalomra'}
        >
          <CalendarPlus className="w-3 h-3" />
          Foglalás
        </button>
        <Popover
          align="right"
          widthClass="w-60"
          triggerAriaLabel="További foglalási lehetőségek"
          triggerClassName="px-1 text-white bg-medical-primary hover:bg-medical-primary-dark border-l border-white/20"
          trigger={<ChevronDown className="w-3 h-3" />}
        >
          {(close) => (
            <div>
              <MenuItem onClick={() => { onLink(); close(); }}>
                <Link2 className="w-3.5 h-3.5" /> Meglévő foglalás hozzárendelése
              </MenuItem>
              <MenuItem onClick={() => { onMarkDoneRetro(); close(); }}>
                Elkészült (utólag)
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>
    );
  }
  if (state === 'BOOKED') {
    return (
      <Popover
        align="right"
        widthClass="w-60"
        triggerAriaLabel="Foglalt alkalom műveletei"
        triggerClassName="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
        trigger={
          <>
            <CalendarClock className="w-3 h-3" />
            {bookedStartIso ? formatShortDate(bookedStartIso) : 'Foglalva'}
            <ChevronDown className="w-3 h-3" />
          </>
        }
      >
        {(close) => (
          <div>
            <MenuItem onClick={() => { onBook(); close(); }}>
              <CalendarClock className="w-3.5 h-3.5" /> Áthelyezés másik időpontra
            </MenuItem>
            <MenuItem onClick={() => { onMarkUnsuccessful(); close(); }}>
              <AlertTriangle className="w-3.5 h-3.5" /> Sikertelen próba
            </MenuItem>
            <MenuItem onClick={() => { onMarkDoneRetro(); close(); }}>
              Elkészült (utólag)
            </MenuItem>
          </div>
        )}
      </Popover>
    );
  }
  return null;
}
