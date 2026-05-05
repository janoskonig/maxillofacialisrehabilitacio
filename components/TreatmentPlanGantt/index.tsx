'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Calendar, Loader2 } from 'lucide-react';
import type { EpisodeStatusFilter, ZoomPreset, TimelineEpisode, TimelineStep } from './types';
import { useTimelineData } from './useTimelineData';
import { useTimelineRange } from './useTimelineRange';
import { minTrackWidthPx } from './timeline-math';
import { useMaxMd } from './useMaxMd';
import { fallbackCounts } from './episode-utils';
import { episodeNeedsAttention } from './episode-utils';
import { FiltersBar } from './FiltersBar';
import { TimelineHeader } from './TimelineHeader';
import { EpisodeRow } from './EpisodeRow';
import { Legend } from './Legend';
import { StepPopover } from './StepPopover';
import { EMPTY_EPISODES } from './empty-episodes';

function parseZoom(s: string | null): ZoomPreset {
  if (s === '14d' || s === '30d' || s === '90d' || s === 'auto') return s;
  return '30d';
}

function parseStatus(s: string | null): EpisodeStatusFilter {
  if (s === 'open' || s === 'closed' || s === 'all') return s;
  return 'open';
}

export function TreatmentPlanGantt() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const isMobile = useMaxMd();

  const mergeParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const n = new URLSearchParams(sp.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === undefined || val === null || val === '') n.delete(key);
        else n.set(key, val);
      }
      router.replace(`${pathname}?${n.toString()}`, { scroll: false });
    },
    [router, pathname, sp]
  );

  const status = parseStatus(sp.get('tplan_status'));
  const setStatus = (v: EpisodeStatusFilter) => mergeParams({ tplan_status: v });

  const providerId = sp.get('tplan_pid') ?? '';
  const setProviderId = (id: string) => mergeParams({ tplan_pid: id || null });

  const zoom = parseZoom(sp.get('tplan_zoom'));
  const setZoom = (z: ZoomPreset) => mergeParams({ tplan_zoom: z });

  const treatmentType = sp.get('tplan_type') ?? '';
  const setTreatmentType = (v: string) => mergeParams({ tplan_type: v || null });

  const attentionOnly = sp.get('tplan_attn') === '1';
  const setAttentionOnly = (v: boolean) => mergeParams({ tplan_attn: v ? '1' : null });

  const [searchInput, setSearchInput] = useState(() => sp.get('tplan_q') ?? '');
  const [searchDebounced, setSearchDebounced] = useState(() => sp.get('tplan_q') ?? '');

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const cur = sp.get('tplan_q') ?? '';
    if (cur !== searchDebounced) {
      mergeParams({ tplan_q: searchDebounced || null });
    }
  }, [searchDebounced, sp, mergeParams]);

  const { episodes, meta, loading, error } = useTimelineData({
    status,
    providerId,
    searchDebounced,
  });

  const nowMs = meta?.serverNow ? new Date(meta.serverNow).getTime() : Date.now();

  const filtered = useMemo(() => {
    let list = episodes;
    if (treatmentType) {
      list = list.filter((e) => (e.treatmentTypeLabel ?? '') === treatmentType);
    }
    if (attentionOnly) {
      list = list.filter((e) => episodeNeedsAttention(e, nowMs));
    }
    return list;
  }, [episodes, treatmentType, attentionOnly, nowMs]);

  const treatmentTypeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of episodes) {
      if (e.treatmentTypeLabel) s.add(e.treatmentTypeLabel);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'hu'));
  }, [episodes]);

  const episodesForRange = useMemo(
    () => (zoom === 'auto' ? filtered : EMPTY_EPISODES),
    [zoom, filtered]
  );

  const axis = useTimelineRange(zoom, episodesForRange, meta?.serverNow ?? null);

  const trackW = useMemo(
    () => minTrackWidthPx(zoom, { t0: axis.t0, t1: axis.t1, rangeMs: axis.rangeMs }),
    [zoom, axis.t0, axis.t1, axis.rangeMs]
  );

  const leftCol = isMobile ? 200 : 280;

  const serverCounts = meta?.counts ?? fallbackCounts(episodes, nowMs);
  const counts =
    treatmentType || attentionOnly ? fallbackCounts(filtered, nowMs) : serverCounts;

  const [popover, setPopover] = useState<{ episode: TimelineEpisode; step: TimelineStep } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const useVirt = !isMobile && filtered.length > 30;
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });

  const rangeForRows = useMemo(
    () => ({ t0: axis.t0, t1: axis.t1, rangeMs: axis.rangeMs, nowMs: axis.nowMs }),
    [axis.t0, axis.t1, axis.rangeMs, axis.nowMs]
  );

  // Stabil step-select callback: az `EpisodeRow` `memo`-wrapped, de a régi
  // inline `(step, _el) => setPopover({ episode: ep, step })` minden
  // render-nél új closure-t adott, ami invalidálta a memo-t (és
  // virtualizer-rel is felesleges re-render-eket okozott a látható
  // sorokon). Egy stabil callback + episode lookup-ra váltunk.
  //
  // Az episode lookup-ot az EpisodeRow-ra delegáljuk a `data-episode-id`
  // helyett — ez bonyolítaná a row-t. Kompromisszum: a callback önmaga
  // stabil, és `episode`-t csak közvetlenül passzoljuk át a step-tel.
  const handleStepSelect = useCallback(
    (episode: TimelineEpisode, step: TimelineStep) => {
      setPopover({ episode, step });
    },
    []
  );

  const renderRow = (ep: TimelineEpisode) => (
    <EpisodeRow
      key={ep.episodeId}
      episode={ep}
      range={rangeForRows}
      toPercent={axis.toPercent}
      todayPercent={axis.todayPercent}
      trackMinWidth={trackW}
      onStepSelect={handleStepSelect}
    />
  );

  return (
    <div className="space-y-4">
      <FiltersBar
        status={status}
        onStatus={setStatus}
        providerId={providerId}
        onProviderId={setProviderId}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        treatmentType={treatmentType}
        onTreatmentType={setTreatmentType}
        treatmentTypeOptions={treatmentTypeOptions}
        attentionOnly={attentionOnly}
        onAttentionOnly={setAttentionOnly}
        zoom={zoom}
        onZoom={setZoom}
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
          {filtered.length} megjelenítve / {episodes.length} betöltve
        </span>
        <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">{counts.actionNeededIn7d} figyelmet igényel</span>
      </div>

      <Legend />

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-medical-primary" />
          <span className="ml-2 text-sm text-gray-500">Kezelési tervek betöltése…</span>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      {!loading && !error && episodes.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Calendar className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincs kezelési terv idővonal adat.</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && episodes.length > 0 && (
        <div className="text-center py-8 text-sm text-gray-600">Nincs a szűrőknek megfelelő epizód.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm"
          role="region"
          aria-label="Kezelési tervek idővonala"
        >
          <div className="flex flex-col" style={{ minWidth: leftCol + trackW }}>
            <div className="flex shrink-0 border-b border-gray-200 bg-gray-50/90">
              <div
                className="sticky left-0 z-20 flex-shrink-0 border-r border-gray-200 bg-gray-50/95"
                style={{ width: leftCol, minHeight: 40 }}
              />
              <TimelineHeader
                t0={axis.t0}
                t1={axis.t1}
                toPercent={axis.toPercent}
                todayPercent={axis.todayPercent}
                trackMinWidth={trackW}
                height={40}
              />
            </div>

            {useVirt ? (
              <div ref={scrollRef} className="overflow-y-auto max-h-[min(70vh,800px)] relative">
                <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((vi) => (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      className="absolute left-0 top-0 w-full border-b border-gray-50"
                      style={{
                        transform: `translateY(${vi.start}px)`,
                        height: `${vi.size}px`,
                      }}
                    >
                      {renderRow(filtered[vi.index]!)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={isMobile ? '' : 'max-h-[min(70vh,800px)] overflow-y-auto'}>{filtered.map(renderRow)}</div>
            )}
          </div>
        </div>
      )}

      {meta && (
        <div className="text-xs text-gray-400 text-right">
          Frissítve: {new Date(meta.fetchedAt).toLocaleTimeString('hu-HU')} · ETA = heurisztikus becslés
        </div>
      )}

      <StepPopover
        open={!!popover}
        step={popover?.step ?? null}
        episode={popover?.episode ?? null}
        isMobile={isMobile}
        onClose={() => setPopover(null)}
      />
    </div>
  );
}
