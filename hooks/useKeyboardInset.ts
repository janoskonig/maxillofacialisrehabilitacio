'use client';

import { useEffect, useState } from 'react';

/**
 * useKeyboardInset — a felugró (mobil) képernyő-billentyűzet magassága pixelben.
 *
 * A `visualViewport` API-ra épül: amikor a soft keyboard megjelenik, a vizuális
 * viewport összezsugorodik, miközben a layout viewport (és így a `position`-
 * alapú elrendezés) gyakran NEM. A különbségből számoljuk a billentyűzet
 * magasságát, hogy a composer fölé tudjon emelkedni.
 *
 * Asztali böngészőkben (nincs soft keyboard) az érték végig 0 → no-op.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Apró (<80px) eltérések (pl. címsor-animáció) ne számítsanak billentyűzetnek.
      setInset(keyboard > 80 ? Math.round(keyboard) : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
