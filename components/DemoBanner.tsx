'use client';

/**
 * Állandó „DEMÓ – szimulált adatok" sáv. Csak akkor jelenik meg, ha a
 * NEXT_PUBLIC_DEMO_MODE build-idejű env === 'true' (a demó-instance-on).
 * Éles telepítésen semmit sem renderel.
 */
export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return null;
  return (
    <div
      role="note"
      className="sticky top-0 z-[60] w-full bg-amber-500 text-amber-950 text-center text-sm font-semibold px-4 py-1.5 shadow-sm"
    >
      DEMÓ környezet — minden adat szimulált, valós beteg adatai nem szerepelnek benne.
    </div>
  );
}
