'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PatientEpisode, StageCatalogEntry, StageSuggestion, EpisodeGetResponse } from '@/lib/types';
import { REASON_VALUES } from '@/lib/types';
import { Calendar, ArrowRight, Clock, AlertTriangle, ChevronDown, ChevronUp, Plus, Loader2, Activity, CheckCircle } from 'lucide-react';
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
  STAGE_0: 'bg-blue-100 text-blue-800 border-blue-200',
  STAGE_1: 'bg-purple-100 text-purple-800 border-purple-200',
  STAGE_2: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  STAGE_3: 'bg-orange-100 text-orange-800 border-orange-200',
  STAGE_4: 'bg-red-100 text-red-800 border-red-200',
  STAGE_5: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  STAGE_6: 'bg-green-100 text-green-800 border-green-200',
  STAGE_7: 'bg-gray-100 text-gray-800 border-gray-200',
};

function getStageColor(code: string): string {
  return STAGE_COLORS[code] || 'bg-gray-100 text-gray-800 border-gray-200';
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
        }
      } else {
        setActiveEpisode(null);
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
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-3"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!activeEpisode) {
    return (
      <div className="bg-amber-50 rounded-lg border border-amber-200 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900">Nincs aktív ellátási epizód</h3>
            <p className="text-sm text-amber-700 mt-1">
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
  const totalStages = catalog.length || 8;

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-medical-primary" />
            <h3 className="text-lg font-semibold text-gray-900">Ellátási epizód</h3>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 hover:text-gray-700 p-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Episode title + reason */}
        <div className="mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">
              {activeEpisode.chiefComplaint}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {activeEpisode.reason}
            </span>
            {activeEpisode.treatmentTypeLabel && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                {activeEpisode.treatmentTypeLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(new Date(activeEpisode.openedAt), 'yyyy. MMM d.', { locale: hu })}
            </span>
            {activeEpisode.assignedProviderName && (
              <span>{activeEpisode.assignedProviderName}</span>
            )}
          </div>
        </div>

        {/* Stage progress bar */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${getStageColor(stageCode)}`}>
              {stageLabel}
            </span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: totalStages }).map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i <= stageIndex ? 'bg-medical-primary' : 'bg-gray-200'
                }`}
                title={catalog[i]?.labelHu ?? `STAGE_${i}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-0.5">
            <span>Kezdet</span>
            <span>Gondozás</span>
          </div>
        </div>

        {/* Stage suggestion banner */}
        {suggestion && (
          <div
            className="bg-blue-50 border border-blue-200 rounded-md p-3 cursor-pointer hover:bg-blue-100 transition-colors"
            onClick={() => setShowSuggestionModal(true)}
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-medium text-blue-900">
                  Javaslat: {getStageLabel(suggestion.suggestedStage)}
                </span>
                <span className="text-xs text-blue-600 ml-2">
                  Kattintson a részletekért
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-400" />
            </div>
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
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
                        ? 'bg-gray-50 text-gray-500 border-gray-200 line-through'
                        : 'bg-white text-gray-400 border-gray-100'
                    }`}
                  >
                    {cat.labelHu}
                  </span>
                );
              })}
            </div>

            {/* Version info */}
            <div className="flex gap-4 text-xs text-gray-400">
              <span>stageVersion: {activeEpisode.stageVersion ?? 0}</span>
              <span>snapshotVersion: {activeEpisode.snapshotVersion ?? 0}</span>
              {activeEpisode.currentRulesetVersion != null && (
                <span>ruleset: v{activeEpisode.currentRulesetVersion}</span>
              )}
            </div>

            <a
              href={`/patients/${patientId}/stages`}
              className="inline-flex items-center gap-1 text-sm text-medical-primary hover:text-medical-primary-dark"
            >
              Teljes stádium kezelés
              <ArrowRight className="w-3 h-3" />
            </a>
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
