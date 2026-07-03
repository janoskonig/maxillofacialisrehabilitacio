'use client';

/**
 * „Ugrás a tartalomra” link billentyűzetes / képernyőolvasós felhasználóknak.
 * Vizuálisan rejtett; Tab-ra fókuszt kapva jelenik meg a bal felső sarokban.
 */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:dark:bg-gray-900 focus:text-medical-primary focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:outline focus:outline-2 focus:outline-medical-primary"
    >
      Ugrás a tartalomra
    </a>
  );
}
