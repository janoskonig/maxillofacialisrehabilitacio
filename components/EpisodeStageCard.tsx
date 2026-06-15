'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PatientEpisode, StageCatalogEntry, StageSuggestion, EpisodeGetResponse } from '@/lib/types';
import { REASON_VALUES } from '@/lib/types';
import { Calendar, ArrowRight, ChevronRight, Clock, AlertTriangle, ChevronDown, ChevronUp, Plus, Loader2, Activity, CheckCircle, UserRound } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { StageSuggestionModal } from './StageSuggestionModal';

interface EpisodeStageCardProps {
  patientId: string;
  patientName?: string | null;
  patientReason?: string | null;
  onStageChanged?: () => void;
}

const STAGE_COLORS: Record<string, string> = {
  STAGE_0: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
  STAGE_1: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
  STAGE_2: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-300 dark:border-yellow-800',
  STAGE_3: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800',
  STAGE_4: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800',
  STAGE_5: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
  STAGE_6: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800',
  STAGE_7: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
};

function getStageColor(code: string): string {
  return STAGE_COLORS[code] || 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
}

export function EpisodeStageCard({
  patientId,
  patientName,
  patientReason,
  onStageChanged,
}: EpisodeStageCardProps) {
  const [episodes, setEpisodes] = useState<PatientEpisode[]>([]);
  const [activeEpisode, setActiveEpisode] = useState<EpisodeGetResponse | null>(null);
  const [catalog, setCatalog] = useState<StageCatalogEntry[]>([]);
  const [enteredByStage, setEnteredByStage] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const epRes = await fetch(`/api/patients/${patientId}/episodes`, {
        credentials: 'include',
      });
      if (!epRes.ok) return;
      const epData = await epRes.json();
      setEpisodes(epData.episodes ?? []);

      const openEp = (epData.episodes ?? []).find((e: PatientEpisode) => e.status === 'open');
      if (openEp) {
        const detailRes = await fetch(`/api/episodes/${openEp.id}`, {
          credentials: 'include',
        });
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setActiveEpisode(detailData.episode ?? null);

          const reason = detailData.episode?.reason;
          if (reason) {
            const catUrl = `/api/stage-catalog?reason=${encodeURIComponent(reason)}`;
            const catRes = await fetch(catUrl, { credentials: 'include' });
            if (catRes.ok) {
              const catData = await catRes.json();
              setCatalog(catData.catalog ?? []);
            }
          }

          // Stádium-belépési dátumok a horizontális idővonalhoz (mikor lépett be).
          try {
            const stagesRes = await fetch(`/api/patients/${patientId}/stages`, { credentials: 'include' });
            if (stagesRes.ok) {
              const sd = await stagesRes.json();
              const epEntry = (sd.timeline?.episodes ?? []).find(
                (e: { episodeId: string }) => e.episodeId === openEp.id
              );
              const map: Record<string, string> = {};
              // `stages` desc sorrendben jön → az utolsó felülírás a legkorábbi belépés.
              for (const ev of (epEntry?.stages ?? []) as Array<{ stageCode: string; at: string }>) {
                map[ev.stageCode] = ev.at;
              }
              setEnteredByStage(map);
            }
          } catch {
            /* non-critical */
          }
        }
      } else {
        setActiveEpisode(null);
        setEnteredByStage({});
      }
    } catch (error) {
      console.error('Error fetching episode data:', error);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getStageLabel = (code: string): string => {
    return catalog.find((c) => c.code === code)?.labelHu ?? code;
  };

  const handleSuggestionAccepted = () => {
    setShowSuggestionModal(false);
    fetchData();
    onStageChanged?.();
  };

  const handleSuggestionDismissed = () => {
    setShowSuggestionModal(false);
    fetchData();
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!activeEpisode) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800/60 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200">Nincs aktív ellátási epizód</h3>
            <p className="text-sm text-amber-700 dark:text-amber-300/90 mt-1">
              A betegnek nincs nyitott ellátási epizódja. Az ellátás strukturált követéséhez indítson egy újat.
            </p>
            <a
              href={`/patients/${patientId}/stages`}
              className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Új epizód indítása
            </a>
          </div>
        </div>
      </div>
    );
  }

  const stageCode = activeEpisode.currentStageCode ?? 'STAGE_0';
  const stageLabel = activeEpisode.currentStageLabel ?? getStageLabel(stageCode);
  const suggestion = activeEpisode.stageSuggestion;
  const stageIndex = parseInt(stageCode.replace('STAGE_', ''), 10);
  const orderedStages = [...catalog].sort((a, b) => a.orderIndex - b.orderIndex);
  const currentIdx = orderedStages.findIndex((c) => c.code === stageCode);

  return (
    <>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-medical-primary" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Ellátási epizód</h3>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Episode hero */}
        <div className="mb-4">
          <p className="text-base font-medium text-gray-900 dark:text-gray-100">{activeEpisode.chiefComplaint}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {activeEpisode.reason}
            </span>
            {activeEpisode.treatmentTypeLabel && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                {activeEpisode.treatmentTypeLabel}
              </span>
            )}
          </div>
        </div>

        {/* Meta: opened + provider */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-none">Megnyitva</p>
              <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5 truncate">
                {format(new Date(activeEpisode.openedAt), 'yyyy. MMM d.', { locale: hu })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <UserRound className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-none">Kezelőorvos</p>
              <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5 truncate">
                {activeEpisode.assignedProviderName ?? '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Stage progress — horizontal timeline (mikor lépett be az egyes stádiumokba) */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${getStageColor(stageCode)}`}>
              {stageLabel}
            </span>
            {orderedStages.length > 0 && currentIdx >= 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
                {currentIdx + 1} / {orderedStages.length} stádium
              </span>
            )}
          </div>

          {orderedStages.length > 0 ? (
            <div className="overflow-x-auto -mx-1 px-1 pb-1">
              <div className="flex items-start min-w-max pt-1">
                {orderedStages.map((cat, i) => {
                  const isCurrent = i === currentIdx;
                  const isPast = currentIdx >= 0 && i < currentIdx;
                  const entered = enteredByStage[cat.code];
                  const isLast = i === orderedStages.length - 1;
                  return (
                    <div key={cat.code} className="flex flex-col items-center" style={{ width: 90 }}>
                      <div className="flex items-center w-full h-4">
                        <div
                          className={`h-0.5 flex-1 ${
                            i === 0 ? 'opacity-0' : isPast || isCurrent ? 'bg-medical-primary' : 'bg-gray-200 dark:bg-gray-700'
                          }`}
                        />
                        <div
                          className={`w-3.5 h-3.5 rounded-full shrink-0 border-2 ${
                            isCurrent
                              ? 'bg-white dark:bg-gray-900 border-medical-primary ring-2 ring-medical-primary/30'
                              : isPast
                                ? 'bg-medical-primary border-medical-primary'
                                : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600'
                          }`}
                          title={cat.labelHu}
                        />
                        {isLast ? (
                          <div className="flex-1 flex items-center">
                            <ChevronRight
                              className={`w-4 h-4 -ml-0.5 ${isPast || isCurrent ? 'text-medical-primary' : 'text-gray-300'}`}
                            />
                          </div>
                        ) : (
                          <div className={`h-0.5 flex-1 ${isPast ? 'bg-medical-primary' : 'bg-gray-200 dark:bg-gray-700'}`} />
                        )}
                      </div>
                      <p
                        className={`mt-1.5 text-center text-[11px] leading-tight px-0.5 ${
                          isCurrent ? 'font-semibold text-gray-900 dark:text-gray-100' : isPast ? 'text-gray-600 dark:text-gray-400' : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {cat.labelHu}
                      </p>
                      <p className="mt-0.5 text-center text-[10px] text-gray-400 dark:text-gray-500 h-3">
                        {entered ? format(new Date(entered), 'MMM d.', { locale: hu }) : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1 px-0.5">
              <span>Kezdet</span>
              <span>Gondozás</span>
            </div>
          )}
        </div>

        {/* Stage suggestion banner */}
        {suggestion && (
          <div
            className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-md p-3 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            onClick={() => setShowSuggestionModal(true)}
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Javaslat: {getStageLabel(suggestion.suggestedStage)}
                </span>
                <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">
                  Kattintson a részletekért
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-400 dark:text-blue-500" />
            </div>
          </div>
        )}

        {/* Primary action — always visible */}
        <a
          href={`/patients/${patientId}/stages`}
          className="inline-flex items-center gap-1.5 mt-1 text-sm font-medium text-medical-primary hover:text-medical-primary-dark"
        >
          Teljes stádium kezelés
          <ArrowRight className="w-3.5 h-3.5" />
        </a>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
            {/* Timeline chips */}
            <div className="flex flex-wrap gap-2">
              {catalog.map((cat) => {
                const catIndex = parseInt(cat.code.replace('STAGE_', ''), 10);
                const isCurrent = cat.code === stageCode;
                const isPast = catIndex < stageIndex;
                return (
                  <span
                    key={cat.code}
                    className={`text-xs px-2 py-1 rounded-full border ${
                      isCurrent
                        ? getStageColor(cat.code) + ' font-semibold ring-2 ring-offset-1 ring-medical-primary'
                        : isPast
                        ? 'bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-500 border-gray-200 dark:border-gray-700 line-through'
                        : 'bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 border-gray-100 dark:border-gray-800'
                    }`}
                  >
                    {cat.labelHu}
                  </span>
                );
              })}
            </div>

          </div>
        )}
      </div>

      {showSuggestionModal && suggestion && activeEpisode && (
        <StageSuggestionModal
          episodeId={activeEpisode.id}
          suggestion={suggestion}
          stageLabel={getStageLabel(suggestion.suggestedStage)}
          fromStageLabel={suggestion.fromStage ? getStageLabel(suggestion.fromStage) : undefined}
          stageVersion={activeEpisode.stageVersion ?? 0}
          onAccepted={handleSuggestionAccepted}
          onDismissed={handleSuggestionDismissed}
          onClose={() => setShowSuggestionModal(false)}
        />
      )}
    </>
  );
}
