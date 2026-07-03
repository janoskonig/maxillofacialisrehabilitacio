'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  isPortalDisplayScale,
  PORTAL_DISPLAY_SCALES,
  PORTAL_SCALE_EVENT,
  PORTAL_SCALE_LABELS,
  PORTAL_SCALE_STORAGE_KEY,
  setPortalScale,
  type PortalDisplayScale,
} from '@/lib/portal-display-scale';

const SCALE_DESCRIPTIONS: Record<PortalDisplayScale, string> = {
  normal: 'Alapértelmezett betűméret.',
  nagy: 'Kb. 13%-kal nagyobb szöveg és gombok.',
  extra: 'Kb. 25%-kal nagyobb szöveg és gombok.',
};

/**
 * Profil oldali „Megjelenítés” kártya: a kényelmi mód fokozatának részletes
 * beállítása élő előnézettel (a váltás azonnal érvényesül az egész portálon).
 * A fejléc „Aa” gombjával közös állapotot a PORTAL_SCALE_EVENT tartja szinkronban.
 */
export function DisplayScaleCard() {
  const [scale, setScale] = useState<PortalDisplayScale>('normal');

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(PORTAL_SCALE_STORAGE_KEY);
      if (isPortalDisplayScale(cached)) setScale(cached);
    } catch {}
    const onScaleChange = (e: Event) => {
      const detail = (e as CustomEvent<PortalDisplayScale>).detail;
      if (isPortalDisplayScale(detail)) setScale(detail);
    };
    window.addEventListener(PORTAL_SCALE_EVENT, onScaleChange);
    return () => window.removeEventListener(PORTAL_SCALE_EVENT, onScaleChange);
  }, []);

  const select = (next: PortalDisplayScale) => {
    setScale(next);
    setPortalScale(next);
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <Eye className="w-5 h-5 text-medical-primary" aria-hidden="true" />
        Megjelenítés
      </h2>
      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-4">
        Válassza ki a kényelmes betűméretet — a beállítás azonnal érvényesül, és minden eszközén
        megmarad.
      </p>
      <div role="radiogroup" aria-label="Betűméret" className="flex flex-col sm:flex-row gap-2">
        {PORTAL_DISPLAY_SCALES.map(option => {
          const selected = option === scale;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => select(option)}
              className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                selected
                  ? 'border-medical-primary bg-medical-primary/5 ring-1 ring-medical-primary'
                  : 'border-gray-200 dark:border-gray-700 hover:border-medical-primary/60'
              }`}
            >
              <span
                className={`block font-semibold text-gray-900 dark:text-gray-100 ${
                  option === 'nagy' ? 'text-lg' : option === 'extra' ? 'text-xl' : 'text-base'
                }`}
              >
                Aa — {PORTAL_SCALE_LABELS[option]}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                {SCALE_DESCRIPTIONS[option]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
