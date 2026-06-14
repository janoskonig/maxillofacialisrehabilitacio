'use client';

import { useEffect, useState } from 'react';
import { Patient, patientStageOptions, PatientStageEntry } from '@/lib/types';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import { calculateAge } from '@/lib/dateUtils';
import { Phone, CalendarPlus, ArrowRight } from 'lucide-react';

interface PatientHeaderBarProps {
  patient: Patient;
  currentStage: PatientStageEntry | null;
  /** Időpont CTA / „következő lépés” kattintás → ugrás a „Kezelési terv & időpont” fülre. */
  onGoToScheduling?: () => void;
  /** A „következő lépés” kiírásához van-e jogosultság (technikus nem lát munkalistát). */
  canSeeNextStep?: boolean;
}

const STAGE_BADGE_COLORS: Record<string, string> = {
  uj_beteg: 'bg-blue-100 text-blue-800',
  onkologiai_kezeles_kesz: 'bg-purple-100 text-purple-800',
  arajanlatra_var: 'bg-yellow-100 text-yellow-800',
  implantacios_sebeszi_tervezesre_var: 'bg-orange-100 text-orange-800',
  fogpotlasra_var: 'bg-amber-100 text-amber-800',
  fogpotlas_keszul: 'bg-indigo-100 text-indigo-800',
  fogpotlas_kesz: 'bg-green-100 text-green-800',
  gondozas_alatt: 'bg-gray-100 text-gray-800',
};

function getStageBadgeColor(stage: string): string {
  return STAGE_BADGE_COLORS[stage] || 'bg-gray-100 text-gray-800';
}

function getInitials(name?: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Állandó beteg-fejléc — minden fülön látszik. Konszolidálja a korábban szétszórt
 * név + stádium-badge + személyes meta + „következő lépés” információt egy helyre.
 */
export function PatientHeaderBar({
  patient,
  currentStage,
  onGoToScheduling,
  canSeeNextStep = true,
}: PatientHeaderBarProps) {
  const [nextStepLabel, setNextStepLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!canSeeNextStep || !patient.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/worklists/wip-next-appointments?patientId=${encodeURIComponent(patient.id!)}`,
          { credentials: 'include' }
        );
        if (!res.ok) return;
        const data = await res.json();
        const items: WorklistItemBackend[] = data.items ?? [];
        if (items.length === 0) return;
        const sorted = [...items].sort((a, b) => {
          const epA = a.episodeOrder ?? 0;
          const epB = b.episodeOrder ?? 0;
          if (epA !== epB) return epA - epB;
          return (a.stepSeq ?? 0) - (b.stepSeq ?? 0);
        });
        const first = sorted[0];
        if (!cancelled) setNextStepLabel(first.stepLabel || first.nextStep || null);
      } catch {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patient.id, canSeeNextStep]);

  const stageLabel = currentStage
    ? patientStageOptions.find((opt) => opt.value === currentStage.stage)?.label || currentStage.stage
    : null;

  const age = calculateAge(patient.szuletesiDatum);
  const metaParts: string[] = [];
  if (patient.taj) metaParts.push(`TAJ ${patient.taj}`);
  if (age != null) metaParts.push(`${age} é`);
  if (patient.nem) metaParts.push(patient.nem);

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 sm:px-4 py-3 mb-4 sm:mb-6">
      <div className="flex items-center gap-3">
        {/* Avatar / monogram */}
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-medium text-sm shrink-0">
          {getInitials(patient.nev)}
        </div>

        {/* Név + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-medium text-gray-900 truncate">
              {patient.nev || 'Névtelen beteg'}
            </span>
            {stageLabel && (
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStageBadgeColor(currentStage!.stage)}`}
                title={currentStage?.notes || stageLabel}
              >
                {stageLabel}
              </span>
            )}
          </div>
          <div className="text-xs sm:text-[13px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
            {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
            {patient.telefonszam && (
              <a
                href={`tel:${patient.telefonszam.replace(/\s/g, '')}`}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
              >
                <Phone className="w-3 h-3" />
                {patient.telefonszam}
              </a>
            )}
          </div>
        </div>

        {/* Következő lépés + CTA */}
        <div className="text-right shrink-0 hidden sm:block">
          {canSeeNextStep && nextStepLabel && (
            <button
              type="button"
              onClick={onGoToScheduling}
              className="block w-full text-right group"
              title="Ugrás a Kezelési terv & időpont fülre"
            >
              <span className="block text-[11px] text-gray-400 leading-none">Következő lépés</span>
              <span className="text-[13px] font-medium text-gray-900 group-hover:text-medical-primary inline-flex items-center gap-1">
                {nextStepLabel}
                <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </span>
            </button>
          )}
        </div>

        {onGoToScheduling && (
          <button
            type="button"
            onClick={onGoToScheduling}
            className="btn-secondary flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm shrink-0"
            title="Időpontfoglalás"
          >
            <CalendarPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Időpont</span>
          </button>
        )}
      </div>
    </div>
  );
}
