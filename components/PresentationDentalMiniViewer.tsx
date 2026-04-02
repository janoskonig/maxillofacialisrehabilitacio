'use client';

import { ToothCheckbox } from '@/components/patient-form/ToothCheckbox';
import type { ToothStatus } from '@/hooks/usePatientAutoSave';

const UPPER_L = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_R = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_L = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_R = [31, 32, 33, 34, 35, 36, 37, 38];

export function PresentationDentalMiniViewer({
  patientId,
  meglevoFogak,
  meglevoImplantatumok,
  nemIsmertPoziciokbanImplantatum,
  nemIsmertPoziciokbanImplantatumReszletek,
}: {
  patientId: string;
  meglevoFogak: Record<string, ToothStatus>;
  meglevoImplantatumok: Record<string, string>;
  nemIsmertPoziciokbanImplantatum?: boolean | null;
  nemIsmertPoziciokbanImplantatumReszletek?: string | null;
}) {
  const fogak = meglevoFogak || {};
  const implantEntries = Object.entries(meglevoImplantatumok || {});
  const hasKnownImplant = implantEntries.length > 0;
  const hasUnknownImplant = !!nemIsmertPoziciokbanImplantatum;
  const hasAnyDentalData =
    Object.keys(fogak).length > 0 || hasKnownImplant || hasUnknownImplant;

  if (!hasAnyDentalData) {
    return (
      <div className="rounded-lg border border-white/10 bg-gray-100/95 p-3 text-xs text-gray-600">
        Nincs rögzített fogazati státusz vagy implantátum adat.
      </div>
    );
  }

  const prefix = `present-dental-${patientId}`;

  return (
    <div className="rounded-lg border border-white/10 bg-gray-100/95 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-800">Fogazati státusz</p>
        {(hasKnownImplant || hasUnknownImplant) && (
          <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 border border-amber-200">
            Implantátum
          </span>
        )}
      </div>

      {Object.keys(fogak).length > 0 && (
        <div className="overflow-x-auto rounded-md bg-gray-50/80 p-2 border border-gray-200/80">
          <div className="flex justify-between mb-1.5 min-w-[520px]">
            <div className="flex gap-0.5">
              {UPPER_L.map((tooth) => (
                <ToothCheckbox
                  key={tooth}
                  toothNumber={String(tooth)}
                  value={fogak[String(tooth)]}
                  onChange={() => {}}
                  disabled
                  idPrefix={prefix}
                />
              ))}
            </div>
            <div className="flex gap-0.5">
              {UPPER_R.map((tooth) => (
                <ToothCheckbox
                  key={tooth}
                  toothNumber={String(tooth)}
                  value={fogak[String(tooth)]}
                  onChange={() => {}}
                  disabled
                  idPrefix={prefix}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-between min-w-[520px]">
            <div className="flex gap-0.5">
              {LOWER_L.map((tooth) => (
                <ToothCheckbox
                  key={tooth}
                  toothNumber={String(tooth)}
                  value={fogak[String(tooth)]}
                  onChange={() => {}}
                  disabled
                  idPrefix={prefix}
                />
              ))}
            </div>
            <div className="flex gap-0.5">
              {LOWER_R.map((tooth) => (
                <ToothCheckbox
                  key={tooth}
                  toothNumber={String(tooth)}
                  value={fogak[String(tooth)]}
                  onChange={() => {}}
                  disabled
                  idPrefix={prefix}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {(hasKnownImplant || hasUnknownImplant) && (
        <div className="text-xs text-gray-800 space-y-1 border-t border-gray-200 pt-2">
          {hasKnownImplant && (
            <ul className="list-disc pl-4 space-y-0.5">
              {implantEntries.map(([pos, detail]) => {
                const d = String(detail ?? '').trim();
                return (
                  <li key={pos}>
                    <span className="font-medium">{pos}</span>
                    {d ? `. pozíció: ${d}` : '. pozíció (implantátum)'}
                  </li>
                );
              })}
            </ul>
          )}
          {hasUnknownImplant && (
            <p className="text-amber-900/90">
              Ismeretlen pozícióban implantátum
              {nemIsmertPoziciokbanImplantatumReszletek?.trim()
                ? `: ${nemIsmertPoziciokbanImplantatumReszletek.trim()}`
                : '.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
