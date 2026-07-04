'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { DuplicateMatch } from '@/lib/patient-duplicate-check';

interface DuplicateWarningCardProps {
  matches: DuplicateMatch[];
}

/**
 * Lehetséges duplikátum figyelmeztetés az új beteg felvétele közben.
 * Nem blokkol: a felvevő döntése, hogy folytatja-e (a pontos TAJ-ütközést
 * a mentés úgyis 409-cel elutasítja).
 */
export function DuplicateWarningCard({ matches }: DuplicateWarningCardProps) {
  if (matches.length === 0) return null;

  const tajMatches = matches.filter(m => m.matchType === 'taj');
  const nameMatches = matches.filter(m => m.matchType === 'nev_datum');
  const hasMasked = matches.some(m => m.masked);

  const renderMatch = (match: DuplicateMatch, idx: number) => (
    <li key={`${match.matchType}-${match.patientId ?? idx}`} className="flex items-center gap-2">
      <span className="font-medium">{match.displayLabel}</span>
      {match.patientId && (
        <Link
          href={`/patients/${match.patientId}/view`}
          target="_blank"
          className="text-sm text-amber-800 dark:text-amber-200 underline hover:no-underline"
        >
          Karton megnyitása
        </Link>
      )}
    </li>
  );

  return (
    <div
      role="alert"
      className="bg-amber-50 dark:bg-amber-950/40 border-l-4 border-amber-500 p-4 rounded-md"
    >
      <div className="flex items-start">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300 mr-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
          {tajMatches.length > 0 && (
            <div>
              <p className="font-semibold">Ezzel a TAJ számmal már létezik beteg a rendszerben — a mentés nem fog sikerülni.</p>
              <ul className="mt-1 space-y-1">{tajMatches.map(renderMatch)}</ul>
            </div>
          )}
          {nameMatches.length > 0 && (
            <div>
              <p className="font-semibold">
                Lehetséges duplikátum: azonos születési dátumú, hasonló nevű beteg már szerepel a rendszerben.
              </p>
              <ul className="mt-1 space-y-1">{nameMatches.map(renderMatch)}</ul>
              <p className="mt-1">
                Ha ugyanarról a betegről van szó, kérjük, a meglévő kartont használja új beteg rögzítése helyett.
              </p>
            </div>
          )}
          {hasMasked && (
            <p>
              A találat részleteit adatvédelmi okból nem jeleníthetjük meg. Kérjük, egyeztessen a klinikával,
              mielőtt új betegként rögzíti.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
