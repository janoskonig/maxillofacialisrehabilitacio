'use client';

import { useState, useEffect } from 'react';
import { PatientStageTimeline, PatientStageEntry, patientStageOptions } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { Calendar, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

interface PatientStageTimelineProps {
  patientId: string;
  onRefresh?: () => void;
}

export function PatientStageTimeline({
  patientId,
  onRefresh,
}: PatientStageTimelineProps) {
  const { showToast } = useToast();
  const [timeline, setTimeline] = useState<PatientStageTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/patients/${patientId}/stages`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Hiba a timeline betöltésekor');
      }

      const data = await response.json();
      setTimeline(data.timeline);

      // Auto-expand first episode
      if (data.timeline?.episodes?.length > 0) {
        setExpandedEpisodes(new Set([data.timeline.episodes[0].episodeId]));
      }
    } catch (error) {
      console.error('Error fetching timeline:', error);
      showToast('Hiba a timeline betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) {
      fetchTimeline();
    }
  }, [patientId]);

  const toggleEpisode = (episodeId: string) => {
    const newExpanded = new Set(expandedEpisodes);
    if (newExpanded.has(episodeId)) {
      newExpanded.delete(episodeId);
    } else {
      newExpanded.add(episodeId);
    }
    setExpandedEpisodes(newExpanded);
  };

  const getStageLabel = (stage: string) => {
    return patientStageOptions.find((opt) => opt.value === stage)?.label || stage;
  };

  const getStageColor = (stage: string) => {
    const colors: Record<string, string> = {
      uj_beteg: 'bg-blue-100 text-blue-800',
      onkologiai_kezeles_kesz: 'bg-purple-100 text-purple-800',
      arajanlatra_var: 'bg-yellow-100 text-yellow-800',
      implantacios_sebeszi_tervezesre_var: 'bg-orange-100 text-orange-800',
      fogpotlasra_var: 'bg-amber-100 text-amber-800',
      fogpotlas_keszul: 'bg-indigo-100 text-indigo-800',
      fogpotlas_kesz: 'bg-green-100 text-green-800',
      gondozas_alatt: 'bg-gray-100 text-gray-800',
    };
    return colors[stage] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/3"></div>
        </div>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-500">Nincs stádium információ.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Stádium Timeline</h3>
        <button
          onClick={fetchTimeline}
          className="text-sm text-medical-primary hover:text-medical-primary-dark"
        >
          Frissítés
        </button>
      </div>

      {/* Current Stage */}
      {timeline.currentStage && (
        <div className="mb-6 p-4 bg-medical-primary/10 border border-medical-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-medical-primary" />
            <span className="text-sm font-medium text-gray-600">Jelenlegi stádium</span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${getStageColor(
                timeline.currentStage.stage
              )}`}
            >
              {getStageLabel(timeline.currentStage.stage)}
            </span>
            {timeline.currentStage.stageDate && (
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {format(new Date(timeline.currentStage.stageDate), 'yyyy. MMMM d. HH:mm', {
                  locale: hu,
                })}
              </span>
            )}
          </div>
          {timeline.currentStage.notes && (
            <p className="text-sm text-gray-700 mt-2">{timeline.currentStage.notes}</p>
          )}
        </div>
      )}

      {/* Episodes */}
      {timeline.episodes && timeline.episodes.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-base font-medium text-gray-900 mb-3">Epizódok</h4>
          {timeline.episodes.map((episode, episodeIndex) => {
            const isExpanded = expandedEpisodes.has(episode.episodeId);
            return (
              <div
                key={episode.episodeId}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => toggleEpisode(episode.episodeId)}
                  className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      Epizód {episodeIndex + 1}
                    </span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(episode.startDate), 'yyyy. MMMM d.', { locale: hu })}
                      {episode.endDate &&
                        ` - ${format(new Date(episode.endDate), 'yyyy. MMMM d.', { locale: hu })}`}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({episode.stages.length} stádium)
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-500" />
                  )}
                </button>

                {isExpanded && (
                  <div className="p-4 space-y-3">
                    {episode.stages.map((stage, stageIndex) => (
                      <div
                        key={stage.id}
                        className="flex items-start gap-4 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0"
                      >
                        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-medical-primary mt-2"></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${getStageColor(
                                stage.stage
                              )}`}
                            >
                              {getStageLabel(stage.stage)}
                            </span>
                            {stage.stageDate && (
                              <span className="text-xs text-gray-500">
                                {format(new Date(stage.stageDate), 'yyyy. MMMM d. HH:mm', {
                                  locale: hu,
                                })}
                              </span>
                            )}
                          </div>
                          {stage.notes && (
                            <p className="text-sm text-gray-600 mt-1">{stage.notes}</p>
                          )}
                          {stage.createdBy && (
                            <p className="text-xs text-gray-400 mt-1">
                              {stage.createdBy}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Full History (if no episodes) */}
      {(!timeline.episodes || timeline.episodes.length === 0) && timeline.history && timeline.history.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-base font-medium text-gray-900 mb-3">Teljes történet</h4>
          {timeline.history.map((stage) => (
            <div
              key={stage.id}
              className="flex items-start gap-4 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0"
            >
              <div className="flex-shrink-0 w-2 h-2 rounded-full bg-medical-primary mt-2"></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${getStageColor(
                      stage.stage
                    )}`}
                  >
                    {getStageLabel(stage.stage)}
                  </span>
                  {stage.stageDate && (
                    <span className="text-xs text-gray-500">
                      {format(new Date(stage.stageDate), 'yyyy. MMMM d. HH:mm', { locale: hu })}
                    </span>
                  )}
                </div>
                {stage.notes && (
                  <p className="text-sm text-gray-600 mt-1">{stage.notes}</p>
                )}
                {stage.createdBy && (
                  <p className="text-xs text-gray-400 mt-1">{stage.createdBy}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(!timeline.history || timeline.history.length === 0) && (
        <p className="text-gray-500 text-center py-8">Még nincs stádium bejegyzés.</p>
      )}
    </div>
  );
}
