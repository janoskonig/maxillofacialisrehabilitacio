'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

/**
 * Kötelező „teljes sorozat” foglalás — epizód nézetben (PatientForm), ha a backend szerint több lépés/intent van.
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
    <div className="mb-4 flex gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">Teljes kezelési sorozat időpontjainak lefoglalása kötelező lépés</p>
        <p className="text-amber-900/90">
          Ehhez az epizódhoz több munkafázis tartozik. A munkalistán az „Összes szükséges időpont lefoglalása”
          gombbal egyszerre foglalhatod a szükséges időpontokat (jóváhagyás után).
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
