'use client';

import { hasDentalData, type EpisodeDentalStatus } from '@/lib/episode-clinical/model';
import { EpisodeClinicalFields } from './EpisodeClinicalFields';

export function LegacyDentalChart({ dental }: { dental?: EpisodeDentalStatus }) {
  if (!hasDentalData(dental)) return null;
  return <section aria-label="Korábban rögzített fogazati karton" className="space-y-3">
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
      <h3 className="font-semibold">Korábban rögzített kartonadatok</h3>
      <p className="mt-1">A betegkartonban megőrzött fogstátusz és implantátumleírások. Az epizódhoz való átvételük az adatfelülvizsgálatkor menthető.</p>
    </div>
    <EpisodeClinicalFields dental={dental} readOnly dentalOnly />
  </section>;
}
