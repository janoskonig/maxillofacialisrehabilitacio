/**
 * Megosztott skeleton-primitívek a route-szintű `loading.tsx`-ekhez.
 *
 * Cél: észlelt gyorsaság — navigáció / route-chunk betöltés alatt a layout
 * azonnal megjelenik üres képernyő helyett. Tisztán prezentációs, nincs benne
 * adatlogika, ezért szerver-komponensként renderelhető (nincs 'use client').
 */

export function Shimmer({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`} />;
}

/** Egységes oldalfejléc-csík (a PageHeader helyén). */
function HeaderBar() {
  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
        <Shimmer className="h-6 w-6 rounded-md" />
        <Shimmer className="h-5 w-40" />
        <div className="ml-auto flex items-center gap-2">
          <Shimmer className="h-8 w-8 rounded-full" />
          <Shimmer className="h-8 w-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Univerzális lista/oldal skeleton — minden staff útvonal és a páciens-lista alapértelmezett fallbackja. */
export function PageListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <HeaderBar />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Shimmer className="h-10 flex-1 rounded-lg" />
          <Shimmer className="h-10 w-28 rounded-lg" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <Shimmer className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Shimmer className="h-4 w-1/3" />
                <Shimmer className="h-3 w-1/2" />
              </div>
              <Shimmer className="h-8 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Naptár skeleton — heti rács fejléccel. */
export function CalendarSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <HeaderBar />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Shimmer className="h-8 w-48" />
          <div className="flex gap-2">
            <Shimmer className="h-9 w-9 rounded-lg" />
            <Shimmer className="h-9 w-24 rounded-lg" />
            <Shimmer className="h-9 w-9 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Shimmer key={`h-${i}`} className="h-6 w-full" />
          ))}
          {Array.from({ length: 7 * 5 }).map((_, i) => (
            <Shimmer key={`c-${i}`} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Üzenet-nézet skeleton — beszélgetéslista + szál panel. */
export function MessagesSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <HeaderBar />
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="mb-4 flex gap-2">
          <Shimmer className="h-9 w-40 rounded-lg" />
          <Shimmer className="h-9 w-40 rounded-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <div className="space-y-2 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Shimmer className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Shimmer className="h-3.5 w-2/3" />
                  <Shimmer className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 md:block">
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                  <Shimmer className={`h-12 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'} rounded-2xl`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
