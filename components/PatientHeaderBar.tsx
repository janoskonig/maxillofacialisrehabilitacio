'use client';

import { useEffect, useState } from 'react';
import { Patient, patientStageOptions, PatientStageEntry } from '@/lib/types';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import { calculateAge } from '@/lib/dateUtils';
import { Phone, CalendarPlus, ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { completenessEditHref } from '@/lib/completeness-deeplinks';
import { KezeloorvosDelegationWidget } from '@/components/KezeloorvosDelegationWidget';

interface MissingItemLite {
  key: string;
  label: string;
}

interface PatientHeaderBarProps {
  patient: Patient;
  currentStage: PatientStageEntry | null;
  /** Időpont CTA / „következő lépés” kattintás → ugrás a „Kezelési terv & időpont” fülre. */
  onGoToScheduling?: () => void;
  /** A „következő lépés” kiírásához van-e jogosultság (technikus nem lát munkalistát). */
  canSeeNextStep?: boolean;
  /** Admin / fogpótlástanász delegálhat kezelőorvost. */
  canAssignDoctor?: boolean;
}

const STAGE_BADGE_COLORS: Record<string, string> = {
  uj_beteg: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  onkologiai_kezeles_kesz: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300',
  arajanlatra_var: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300',
  implantacios_sebeszi_tervezesre_var: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
  fogpotlasra_var: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  fogpotlas_keszul: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300',
  fogpotlas_kesz: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  gondozas_alatt: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

function getStageBadgeColor(stage: string): string {
  return STAGE_BADGE_COLORS[stage] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
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
  canAssignDoctor = false,
}: PatientHeaderBarProps) {
  const [nextStepLabel, setNextStepLabel] = useState<string | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [completeness, setCompleteness] = useState<{
    score: number;
    clinicalMissing: number;
    researchMissing: number;
    clinicalMissingItems: MissingItemLite[];
    researchMissingItems: MissingItemLite[];
  } | null>(null);

  useEffect(() => {
    if (!patient.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/patients/${patient.id!}/completeness`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.score === 'number') {
          setCompleteness({
            score: data.score,
            clinicalMissing: data.clinicalMissing ?? 0,
            researchMissing: data.researchMissing ?? 0,
            clinicalMissingItems: data.clinicalMissingItems ?? [],
            researchMissingItems: data.researchMissingItems ?? [],
          });
        }
      } catch {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patient.id]);

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

  const completenessDot =
    completeness == null
      ? ''
      : completeness.score >= 90
      ? 'bg-green-500'
      : completeness.score >= 70
      ? 'bg-amber-500'
      : 'bg-red-500';
  const totalMissing = completeness ? completeness.clinicalMissing + completeness.researchMissing : 0;
  const completenessTitle =
    completeness == null
      ? ''
      : totalMissing === 0
      ? 'Adatteljesség: minden értelmezhető adat megvan'
      : `Adatteljesség — ${completeness.clinicalMissing} klinikai · ${completeness.researchMissing} kutatási hiányzó adat`;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-3 sm:px-4 py-3 mb-4 sm:mb-6">
      <div className="flex items-center gap-3">
        {/* Avatar / monogram */}
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-medium text-sm shrink-0">
          {getInitials(patient.nev)}
        </div>

        {/* Név + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">
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
          <div className="text-xs sm:text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
            {patient.telefonszam && (
              <a
                href={`tel:${patient.telefonszam.replace(/\s/g, '')}`}
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
              >
                <Phone className="w-3 h-3" />
                {patient.telefonszam}
              </a>
            )}
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <KezeloorvosDelegationWidget patientId={patient.id!} canAssign={canAssignDoctor} />
            {completeness && (
              totalMissing > 0 ? (
                <button
                  type="button"
                  onClick={() => setChecklistOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-medical-primary"
                  title={completenessTitle}
                  aria-expanded={checklistOpen}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${completenessDot}`} />
                  Adatteljesség {completeness.score}%
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${checklistOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500"
                  title={completenessTitle}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${completenessDot}`} />
                  Adatteljesség {completeness.score}%
                </span>
              )
            )}
          </div>

          {/* Kattintható hiány-checklist: deep-link a betegűrlap megfelelő füléhez */}
          {completeness && checklistOpen && totalMissing > 0 && (
            <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-2">
              <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
                Hiányzó adatok – kattintson a pótláshoz
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {[
                  ...completeness.clinicalMissingItems.map((m) => ({ ...m, group: 'clinical' as const })),
                  ...completeness.researchMissingItems.map((m) => ({ ...m, group: 'research' as const })),
                ].map((m) => (
                  <li key={`${m.group}:${m.key}`}>
                    <Link
                      href={completenessEditHref(patient.id!, m.key)}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                        m.group === 'clinical'
                          ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60'
                          : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60'
                      }`}
                    >
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              <span className="block text-[11px] text-gray-400 dark:text-gray-500 leading-none">Következő lépés</span>
              <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100 group-hover:text-medical-primary inline-flex items-center gap-1">
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
