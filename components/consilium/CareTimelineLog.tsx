'use client';

import type { PresentationTimelineEpisode } from '@/lib/consilium-presentation';
import type { CareTimelineFlatRow } from '@/lib/consilium-view-helpers';
import {
  careTimelineAuthorNameClass,
  careTimelineEpisodeAccent,
  consiliumShortDisplay,
  formatConsiliumHuDateTime,
} from '@/lib/consilium-view-helpers';

export type CareTimelineLegacyStage = {
  stageLabel?: string | null;
  stageCode?: string | null;
  stageDate?: string | null;
  notes?: string | null;
};

type CareTimelineLogProps = {
  timelineRows: CareTimelineFlatRow[];
  episodesWithoutStages: PresentationTimelineEpisode[];
  /** Vetítés: nagyobb szöveg + alcím */
  present?: boolean;
  legacyStage?: CareTimelineLegacyStage | null;
};

export function CareTimelineLog({
  timelineRows,
  episodesWithoutStages,
  present = false,
  legacyStage = null,
}: CareTimelineLogProps) {
  const tStage = present ? 'text-base md:text-lg' : 'text-base';
  const tNote = present ? 'text-sm md:text-base' : 'text-sm';
  const tEpBlock = present ? 'text-sm md:text-base' : 'text-sm';
  const tOrphan = present ? 'text-sm md:text-base' : 'text-sm';
  const maxName = present ? 'min(100%,16rem)' : 'min(100%,14rem)';

  const showLegacy =
    timelineRows.length === 0 &&
    episodesWithoutStages.length === 0 &&
    legacyStage &&
    Boolean(legacyStage.stageLabel || legacyStage.stageCode);

  const showEmpty =
    timelineRows.length === 0 &&
    episodesWithoutStages.length === 0 &&
    !showLegacy;

  const hasTimelineContent =
    timelineRows.length > 0 || episodesWithoutStages.length > 0 || Boolean(showLegacy);

  return (
    <>
      {hasTimelineContent ? (
        present ? (
          <p className="text-xs text-white/45 mb-3">Legfelül a legutóbbi bejegyzés</p>
        ) : (
          <p className="text-[11px] text-white/40 mb-2">Újabbtól a régebbi felé (függőleges idővonal)</p>
        )
      ) : null}

      {timelineRows.length > 0 ? (
        <div className="relative">
          <div
            className="pointer-events-none absolute left-[11px] top-3 bottom-6 w-px bg-gradient-to-b from-white/22 via-white/12 to-white/[0.06]"
            aria-hidden
          />
          <ul className="m-0 list-none space-y-0 p-0">
            {timelineRows.map((row, i) => {
              const prev = i > 0 ? timelineRows[i - 1] : null;
              const showEp = !prev || prev.episodeId !== row.episodeId;
              const accent = careTimelineEpisodeAccent(row.episodeId);
              const isLast = i === timelineRows.length - 1;
              return (
                <li key={row.st.id} className={`relative flex gap-0 ${isLast ? 'pb-1' : 'pb-5'}`}>
                  <div className="relative z-[1] flex w-6 shrink-0 justify-center pt-2">
                    <span
                      className={`shrink-0 rounded-full ${
                        showEp ? `h-3 w-3 ${accent.timelineEpisodeDotClass}` : `h-2.5 w-2.5 ${accent.timelineStageDotClass}`
                      }`}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2 pl-1">
                    {showEp ? (
                      <div className={`rounded-lg px-2.5 py-2 ${accent.episodeBlockClass}`}>
                        <p className={`font-semibold leading-snug ${accent.episodeTitleClass} ${tEpBlock}`}>
                          {row.epLabel}
                        </p>
                        {row.episodeCreatedBy ? (
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/55">
                            <span className="text-white/45">Epizód rögzítő:</span>
                            <span
                              className={`truncate ${careTimelineAuthorNameClass(row.episodeCreatedByRole)}`}
                              style={{ maxWidth: maxName }}
                              title={row.episodeCreatedBy}
                            >
                              {consiliumShortDisplay(row.episodeCreatedBy)}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className={`rounded-lg px-2.5 py-2 ${accent.stageCardClass}`}>
                      <p className={`font-semibold leading-snug text-white ${tStage}`}>{row.st.stageLabel}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/65">
                        <span className="tabular-nums">{formatConsiliumHuDateTime(row.st.at)}</span>
                        {row.st.authorDisplay ? (
                          <span
                            className={`truncate ${careTimelineAuthorNameClass(row.st.authorRole)}`}
                            style={{ maxWidth: maxName }}
                            title={row.st.authorDisplay}
                          >
                            {consiliumShortDisplay(row.st.authorDisplay)}
                          </span>
                        ) : null}
                      </p>
                      {row.st.note ? (
                        <p className={`mt-1.5 whitespace-pre-wrap leading-snug text-white/85 ${tNote}`}>{row.st.note}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {episodesWithoutStages.length > 0 ? (
        <div
          className={`${timelineRows.length > 0 ? 'mt-5 border-t border-white/15 pt-4' : ''} relative`}
        >
          {timelineRows.length === 0 ? (
            <div
              className="pointer-events-none absolute left-[11px] top-3 bottom-6 w-px bg-gradient-to-b from-white/22 via-white/12 to-white/[0.06]"
              aria-hidden
            />
          ) : null}
          <ul className="m-0 list-none space-y-0 p-0">
            {episodesWithoutStages.map((ep, ei) => {
              const accent = careTimelineEpisodeAccent(ep.id);
              const epLabel = [ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód';
              const isLast = ei === episodesWithoutStages.length - 1;
              return (
                <li key={ep.id} className={`relative flex gap-0 ${isLast ? 'pb-1' : 'pb-4'}`}>
                  <div className="relative z-[1] flex w-6 shrink-0 justify-center pt-2">
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full ${accent.timelineEpisodeDotClass}`}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1 pl-1">
                    <div className={`rounded-lg px-2.5 py-2 ${accent.episodeBlockClass} ${tOrphan}`}>
                      <p className={`font-semibold leading-snug ${accent.episodeTitleClass}`}>{epLabel}</p>
                      <p className="mt-1 text-white/55">Nincs stádium bejegyzés.</p>
                      {ep.episodeCreatedBy ? (
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/55">
                          <span className="text-white/40">Rögzítő:</span>
                          <span
                            className={`truncate ${careTimelineAuthorNameClass(ep.episodeCreatedByRole)}`}
                            style={{ maxWidth: maxName }}
                            title={ep.episodeCreatedBy}
                          >
                            {consiliumShortDisplay(ep.episodeCreatedBy)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {showLegacy && legacyStage ? (
        <div className="mt-3 space-y-1">
          <div className="relative flex gap-0 pb-1">
            <div className="relative z-[1] flex w-6 shrink-0 justify-center pt-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/30 ring-2 ring-zinc-950"
                aria-hidden
              />
            </div>
            <div className="min-w-0 flex-1 pl-1 space-y-1">
              <p className={`font-semibold text-white ${tStage}`}>
                {legacyStage.stageLabel || legacyStage.stageCode}
              </p>
              <p className="text-sm text-white/65">{formatConsiliumHuDateTime(legacyStage.stageDate)}</p>
              {legacyStage.notes ? (
                <p className={`whitespace-pre-wrap text-white/85 ${tNote}`}>{legacyStage.notes}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showEmpty ? <p className="text-sm text-white/50">Nincs stádium vagy epizód adat.</p> : null}
    </>
  );
}
