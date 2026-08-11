'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  User,
  Stethoscope,
  CalendarClock,
  Milestone,
  MessageCircle,
  FolderOpen,
} from 'lucide-react';

/** A betegkarton fülei, amik a profil oldalon (/patients/[id]/view) élnek. */
export type PatientProfileTabId =
  | 'attekintes'
  | 'torzsadatok'
  | 'anamnezis'
  | 'terv_idopont'
  | 'kommunikacio'
  | 'adminisztracio';

/** A „Kezelés menete" saját útvonalon él (/patients/[id]/stages), de a fülsor része. */
export type PatientTabId = PatientProfileTabId | 'stadiumok';

const TABS: Array<{ id: PatientTabId; label: string; shortLabel: string; icon: ReactNode }> = [
  { id: 'attekintes', label: 'Áttekintés', shortLabel: 'Áttekintés', icon: <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'torzsadatok', label: 'Törzsadatok', shortLabel: 'Törzs', icon: <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'anamnezis', label: 'Anamnézis & vizsgálat', shortLabel: 'Anamnézis', icon: <Stethoscope className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'terv_idopont', label: 'Kezelési terv & időpont', shortLabel: 'Terv', icon: <CalendarClock className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'stadiumok', label: 'Kezelés menete', shortLabel: 'Kezelés', icon: <Milestone className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'kommunikacio', label: 'Kommunikáció', shortLabel: 'Üzenet', icon: <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'adminisztracio', label: 'Adminisztráció', shortLabel: 'Admin', icon: <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
];

interface PatientTabsNavProps {
  patientId: string;
  activeTab: PatientTabId;
  /**
   * Profil nézetben a hat profil-fül state-váltással vált; ha nincs megadva,
   * minden fül linkként a profil megfelelő fülére navigál (?tab=…).
   */
  onTabChange?: (tab: PatientProfileTabId) => void;
  /** Technikus nem éri el a stádium oldalt — a fül számára elrejthető. */
  showStadiumok?: boolean;
}

/**
 * A betegkarton közös fülsora — a profil oldal és a stádium oldal ugyanazt a
 * navigációt mutatja, így a két felület egy összefüggő betegkartonként viselkedik.
 */
export function PatientTabsNav({ patientId, activeTab, onTabChange, showStadiumok = true }: PatientTabsNavProps) {
  const tabs = showStadiumok ? TABS : TABS.filter((t) => t.id !== 'stadiumok');

  const classFor = (id: PatientTabId) =>
    `flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
      activeTab === id
        ? 'text-medical-primary border-medical-primary'
        : 'text-gray-700 dark:text-gray-300 hover:text-medical-primary border-transparent hover:border-medical-primary'
    }`;

  return (
    <div className="mb-4 sm:mb-6 border-b border-gray-200 dark:border-gray-800 -mx-2 sm:mx-0">
      <nav
        className="flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide px-2 sm:px-0"
        aria-label="Betegkarton fülök"
      >
        {tabs.map((tab) => {
          const { id } = tab;
          const inner = (
            <>
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </>
          );
          if (id !== 'stadiumok' && onTabChange) {
            return (
              <button key={id} onClick={() => onTabChange(id)} className={classFor(id)}>
                {inner}
              </button>
            );
          }
          const href =
            id === 'stadiumok'
              ? `/patients/${patientId}/stages`
              : `/patients/${patientId}/view?tab=${id}`;
          return (
            <Link
              key={id}
              href={href}
              className={classFor(id)}
              aria-current={activeTab === id ? 'page' : undefined}
            >
              {inner}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
