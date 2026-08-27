'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';

/**
 * „Teljes sorozat egy menetben foglalható” ajánlat — epizód nézetben (PatientForm),
 * ha a backend szerint több lépés/intent van. Csak informál, nem tilt.
 */
export function ChainBookingCallout({ episodeId }: { episodeId: string | null | undefined }) {
  const [needs, setNeeds] = useState<boolean | null>(null);

  useEffect(() => {
    if (!episodeId) {
      setNeeds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/chain-booking-status`, { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && res.ok) {
          setNeeds(!!data.needsFullChainBooking);
        }
      } catch {
        if (!cancelled) setNeeds(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  if (!episodeId || !needs) return null;

  return (
    <div className="mb-4 flex gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
      <Info className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-300" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">Több lépés is foglalható egyszerre</p>
        <p className="text-blue-800/90 dark:text-blue-300/90">
          Ehhez az epizódhoz több munkafázis tartozik. A munkalistán az „Összes szükséges időpont lefoglalása”
          gombbal egy menetben lefoglalhatod őket — a láncolást a rendszer számolja.
        </p>
        <p>
          <Link href="/?tab=worklist" className="font-medium text-medical-primary underline">
            Munkalista megnyitása
          </Link>
        </p>
      </div>
    </div>
  );
}
