'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Odontogram megjelenítési stílus:
 *  - 'chart'      — klasszikus grafikus fogstátusz (fogfelszín-diagram + gyökerek, arpadent-szerű)
 *  - 'silhouette' — egyszerű sziluett nézet (a korábbi megjelenítés)
 */
export type OdontogramStyle = 'chart' | 'silhouette';

const STORAGE_KEY = 'odontogram-style';
const CHANGE_EVENT = 'odontogram-style-change';
const DEFAULT_STYLE: OdontogramStyle = 'chart';

export function normalizeOdontogramStyle(value: unknown): OdontogramStyle {
  return value === 'silhouette' ? 'silhouette' : DEFAULT_STYLE;
}

/**
 * Böngészőnként tárolt nézet-preferencia. Minden példány szinkronban marad
 * (saját custom event + storage event másik fülről).
 */
export function useOdontogramStyle(): [OdontogramStyle, (s: OdontogramStyle) => void] {
  const [style, setStyleState] = useState<OdontogramStyle>(DEFAULT_STYLE);

  useEffect(() => {
    const read = () => {
      try {
        setStyleState(normalizeOdontogramStyle(window.localStorage.getItem(STORAGE_KEY)));
      } catch {
        /* privát mód / letiltott storage — marad az alapértelmezés */
      }
    };
    read();
    window.addEventListener(CHANGE_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(CHANGE_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);

  const setStyle = useCallback((s: OdontogramStyle) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, s);
    } catch {
      /* storage nélkül csak a mostani oldalletöltésre él */
    }
    setStyleState(s);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [style, setStyle];
}

const OPTIONS: Array<{ value: OdontogramStyle; label: string; title: string }> = [
  { value: 'chart', label: 'Grafikus', title: 'Grafikus fogstátusz — fogfelszínek és gyökerek' },
  { value: 'silhouette', label: 'Egyszerű', title: 'Egyszerű sziluett nézet' },
];

/** Kis szegmens-kapcsoló a két odontogram-nézet közti váltáshoz. */
export function OdontogramStyleToggle({ className = '' }: { className?: string }) {
  const [style, setStyle] = useOdontogramStyle();
  return (
    <div
      className={`inline-flex items-center rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden ${className}`}
      role="group"
      aria-label="Odontogram nézet"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={style === o.value}
          onClick={() => setStyle(o.value)}
          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
            style === o.value
              ? 'bg-medical-primary text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-800/60'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
