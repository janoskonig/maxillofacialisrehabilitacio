'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  User,
  Stethoscope,
  CalendarClock,
  MessageCircle,
  FolderOpen,
  ClipboardList,
} from 'lucide-react';
import { episodeOverviewHref } from '@/lib/episode-overview';

/** A betegkarton fülei, amik a profil oldalon (/patients/[id]/view) élnek. */
export type PatientProfileTabId =
  | 'attekintes'
  | 'torzsadatok'
  | 'anamnezis'
  | 'kommunikacio'
  | 'adminisztracio';

/** A „Kezelési terv & időpont" hub saját útvonalon él (/patients/[id]/stages), de a fülsor része. */
export type PatientTabId = PatientProfileTabId | 'stadiumok' | 'aftercare' | 'epizod';

const TABS: Array<{ id: PatientTabId; label: string; shortLabel: string; icon: ReactNode }> = [
  { id: 'attekintes', label: 'Áttekintés', shortLabel: 'Áttekintés', icon: <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'torzsadatok', label: 'Törzsadatok', shortLabel: 'Törzs', icon: <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'anamnezis', label: 'Anamnézis & vizsgálat', shortLabel: 'Anamnézis', icon: <Stethoscope className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'epizod', label: 'Epizód és terv', shortLabel: 'Epizód', icon: <ClipboardList className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'stadiumok', label: 'Kezelés', shortLabel: 'Kezelés', icon: <CalendarClock className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'aftercare', label: 'Fogpótlások és gondozás', shortLabel: 'Fogpótlások', icon: <Stethoscope className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'kommunikacio', label: 'Kommunikáció', shortLabel: 'Üzenet', icon: <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
  { id: 'adminisztracio', label: 'Dokumentumok és adminisztráció', shortLabel: 'Dok. és admin', icon: <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> },
];

interface PatientTabsNavProps {
  patientId: string;
  activeTab: PatientTabId;
  /**
   * Profil nézetben a hat profil-fül state-váltással vált; ha nincs megadva,
   * minden fül linkként a profil megfelelő fülére navigál (?tab=…).
   */
  onTabChange?: (tab: PatientProfileTabId) => void;
  /** Technikus nem éri el a terv-hub oldalt — a fül számára elrejthető. */
  showStadiumok?: boolean;
  episodeId?:string|null;
  onNavigate?:(href:string)=>void|Promise<void>;
}

/**
 * A betegkarton közös fülsora — a profil oldal és a stádium oldal ugyanazt a
 * navigációt mutatja, így a két felület egy összefüggő betegkartonként viselkedik.
 */
export function PatientTabsNav({ patientId, activeTab, onTabChange, showStadiumok = true,episodeId,onNavigate }: PatientTabsNavProps) {
  const episodeTabs=new Set<PatientTabId>(['epizod','anamnezis','stadiumok','aftercare']);
  const groups=[
    {label:'Beteg',tabs:TABS.filter(t=>!episodeTabs.has(t.id))},
    {label:'Ellátási epizód',tabs:showStadiumok?['epizod','anamnezis','stadiumok','aftercare'].map(id=>TABS.find(t=>t.id===id)!):[]},
  ];

  const classFor = (id: PatientTabId) =>
    `flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
      (activeTab === id)
        ? 'text-medical-primary border-medical-primary'
        : 'text-gray-700 dark:text-gray-300 hover:text-medical-primary border-transparent hover:border-medical-primary'
    }`;

  return (
    <div className="mb-4 sm:mb-6 border-b border-gray-200 dark:border-gray-800 -mx-2 sm:mx-0">
      <nav
        className="space-y-2 px-2 sm:px-0"
        aria-label="Betegkarton fülök"
      >
        {groups.filter(group=>group.tabs.length>0).map(group=><div key={group.label} role="group" aria-label={group.label} className={group.label==='Ellátási epizód'?'rounded-t-xl bg-blue-50/60 px-2 pt-2 dark:bg-blue-950/20':''}><p className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{group.label}</p><div className="flex gap-0.5 overflow-x-auto scrollbar-hide sm:gap-1">{group.tabs.map((tab) => {
          const { id } = tab;
          const inner = (
            <>
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </>
          );
          if (id !== 'stadiumok' && id !== 'aftercare' && id!=='epizod' && id!=='anamnezis' && onTabChange) {
            return (
              <button key={id} onClick={() => onTabChange(id)} className={classFor(id)}>
                {inner}
              </button>
            );
          }
          const href =
            id==='anamnezis'?`${episodeOverviewHref(patientId,episodeId)}#adatfelulvizsgalat`:id==='epizod'?episodeOverviewHref(patientId,episodeId):id === 'stadiumok'
              ? `/patients/${patientId}/stages${episodeId?`?episodeId=${encodeURIComponent(episodeId)}`:''}`
              : id === 'aftercare' ? `/patients/${patientId}/prostheses${episodeId?`?episodeId=${encodeURIComponent(episodeId)}`:''}` : `/patients/${patientId}/view?tab=${id}${episodeId?`&episodeId=${encodeURIComponent(episodeId)}`:''}`;
          return (
            <Link
              key={id}
              href={href}
              className={classFor(id)}
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={onNavigate?e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();void onNavigate(href);}:undefined}
            >
              {inner}
            </Link>
          );
        })}</div></div>)}
      </nav>
    </div>
  );
}
