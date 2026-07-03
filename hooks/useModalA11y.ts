'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface UseModalA11yOptions {
  /** Escape lenyomására hívódik (ha nincs megadva, az Esc nem zár). */
  onClose?: () => void;
  /**
   * Nyitott-e a dialógus. Olyan komponensnél kell, ami zárt állapotban
   * null-t renderel (a hook a korai return előtt hívódik). Alapértelmezés:
   * true — a csak nyitottan mountolt dialógusoknál nem kell megadni.
   */
  active?: boolean;
}

/**
 * Modális dialógusok billentyűzet-akadálymentesítése:
 *  - megnyitáskor a fókusz a dialógusba kerül (első fókuszálható elem);
 *  - Tab / Shift+Tab a dialóguson belül körbejár (fókusz-csapda);
 *  - Esc bezárja (onClose);
 *  - bezáráskor a fókusz visszaáll az azt megnyitó elemre.
 *
 * Használat: a visszakapott ref-et a dialógus konténerére kell tenni
 * (a komponens csak nyitott állapotban legyen renderelve).
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  options: UseModalA11yOptions = {}
) {
  const containerRef = useRef<T | null>(null);
  const active = options.active ?? true;
  // Az onClose identitás-változása ne indítsa újra a fókusz-logikát.
  const onCloseRef = useRef(options.onClose);
  onCloseRef.current = options.onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? container).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(el => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Fókusz vissza a megnyitó elemre (ha még a dokumentumban van).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
