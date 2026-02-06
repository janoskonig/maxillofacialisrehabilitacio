'use client';

import { useState, useEffect } from 'react';
import type { PatientStageTimeline, PatientStageEntry, StageEventTimeline, StageCatalogEntry } from '@/lib/types';
import { patientStageOptions } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { Calendar, Clock, ChevronDown, ChevronUp, Pencil, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';

interface PatientStageTimelineProps {
  patientId: string;
  onRefresh?: () => void;
  /** Csak admin láthatja a stádium kezdet szerkesztés gombot */
  canEditStageStart?: boolean;
}

type TimelineData = PatientStageTimeline | StageEventTimeline;

function isStageEventEntry(s: unknown): s is { stageCode: string; at: string; note?: string | null } {
  return typeof s === 'object' && s != null && 'stageCode' in s;
}

function isLegacyStage(s: unknown): s is { stage: string; stageDate?: string | null; notes?: string | null } {
  return typeof s === 'object' && s != null && 'stage' in s;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function PatientStageTimeline({
  patientId,
  onRefresh,
  canEditStageStart = false,
}: PatientStageTimelineProps) {
  const { showToast } = useToast();
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [catalog, setCatalog] = useState<StageCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editAtValue, setEditAtValue] = useState('');
  const [saving, setSaving] = useState(false);

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

      if (data.timeline?.episodes?.length > 0) {
        setExpandedEpisodes(new Set([data.timeline.episodes[0].episodeId]));
        const reason = data.timeline.episodes[0].episode?.reason;
        if (data.useNewModel && reason) {
          const catRes = await fetch(`/api/stage-catalog?reason=${encodeURIComponent(reason)}`, { credentials: 'include' });
          if (catRes.ok) {
            const catData = await catRes.json();
            setCatalog(catData.catalog ?? []);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching timeline:', error);
      showToast('Hiba a timeline betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) fetchTimeline();
  }, [patientId]);

  const toggleEpisode = (episodeId: string) => {
    const newExpanded = new Set(expandedEpisodes);
    if (newExpanded.has(episodeId)) newExpanded.delete(episodeId);
    else newExpanded.add(episodeId);
    setExpandedEpisodes(newExpanded);
  };

  const startEditStageStart = (eventId: string, atIso: string) => {
    setEditingEventId(eventId);
    setEditAtValue(toDatetimeLocal(atIso));
  };

  const cancelEditStageStart = () => {
    setEditingEventId(null);
    setEditAtValue('');
  };

  const saveStageStart = async () => {
    if (!editingEventId || !editAtValue.trim()) return;
    setSaving(true);
    try {
      const at = new Date(editAtValue);
      if (Number.isNaN(at.getTime())) {
        showToast('Érvénytelen dátum', 'error');
        return;
      }
      const res = await fetch(
        `/api/patients/${patientId}/stages/events/${editingEventId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ at: at.toISOString() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Hiba a mentéskor', 'error');
        return;
      }
      showToast('Stádium kezdete frissítve', 'success');
      setEditingEventId(null);
      setEditAtValue('');
      fetchTimeline();
      onRefresh?.();
    } catch {
      showToast('Hiba a mentéskor', 'error');
    } finally {
      setSaving(false);
    }
  };

  const getStageLabel = (stageOrCode: string) => {
    const fromCatalog = catalog.find((c) => c.code === stageOrCode)?.labelHu;
    if (fromCatalog) return fromCatalog;
    return patientStageOptions.find((opt) => opt.value === stageOrCode)?.label || stageOrCode;
  };

  const getStageColor = (stageOrCode: string) => {
    const legacyColors: Record<string, string> = {
      uj_beteg: 'bg-blue-100 text-blue-800',
      onkologiai_kezeles_kesz: 'bg-purple-100 text-purple-800',
      arajanlatra_var: 'bg-yellow-100 text-yellow-800',
      implantacios_sebeszi_tervezesre_var: 'bg-orange-100 text-orange-800',
      fogpotlasra_var: 'bg-amber-100 text-amber-800',
      fogpotlas_keszul: 'bg-indigo-100 text-indigo-800',
      fogpotlas_kesz: 'bg-green-100 text-green-800',
      gondozas_alatt: 'bg-gray-100 text-gray-800',
    };
    if (legacyColors[stageOrCode]) return legacyColors[stageOrCode];
    const stageNum = stageOrCode.replace('STAGE_', '');
    const palette = ['bg-blue-100 text-blue-800', 'bg-purple-100 text-purple-800', 'bg-yellow-100 text-yellow-800', 'bg-orange-100 text-orange-800', 'bg-amber-100 text-amber-800', 'bg-indigo-100 text-indigo-800', 'bg-green-100 text-green-800', 'bg-gray-100 text-gray-800'];
    return palette[parseInt(stageNum, 10) % palette.length] || 'bg-gray-100 text-gray-800';
  };

  const currentStage = timeline?.currentStage;
  const currentStageKey = currentStage && isStageEventEntry(currentStage) ? currentStage.stageCode : currentStage && isLegacyStage(currentStage) ? currentStage.stage : null;
  const currentStageDate = currentStage && (isStageEventEntry(currentStage) ? currentStage.at : isLegacyStage(currentStage) ? currentStage.stageDate : null);
  const currentStageNote = currentStage && (isStageEventEntry(currentStage) ? currentStage.note : isLegacyStage(currentStage) ? currentStage.notes : null);

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
      {currentStage && currentStageKey && (
        <div className="mb-6 p-4 bg-medical-primary/10 border border-medical-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-medical-primary" />
            <span className="text-sm font-medium text-gray-600">Jelenlegi stádium</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStageColor(currentStageKey)}`}>
              {getStageLabel(currentStageKey)}
            </span>
            {currentStageDate && (
              <>
                {editingEventId === (currentStage as { id?: string }).id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={editAtValue}
                      onChange={(e) => setEditAtValue(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <button type="button" onClick={saveStageStart} disabled={saving} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Mentés">
                      <Check className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={cancelEditStageStart} disabled={saving} className="p-1 text-gray-500 hover:bg-gray-100 rounded" title="Mégse">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-sm text-gray-600 flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {format(new Date(currentStageDate), 'yyyy. MMMM d. HH:mm', { locale: hu })}
                    {canEditStageStart && (currentStage as { id?: string }).id && (
                      <button
                        type="button"
                        onClick={() => startEditStageStart((currentStage as { id: string }).id, currentStageDate)}
                        className="ml-1 p-1 text-gray-400 hover:text-medical-primary hover:bg-medical-primary/10 rounded"
                        title="Stádium kezdetének szerkesztése"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
          {currentStageNote && (
            <p className="text-sm text-gray-700 mt-2">{currentStageNote}</p>
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
                      {'episode' in episode && episode.episode?.chiefComplaint
                        ? episode.episode.chiefComplaint
                        : `Epizód ${episodeIndex + 1}`}
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
                    {episode.stages.map((stage: unknown, stageIndex: number) => {
                      const key = isStageEventEntry(stage) ? stage.stageCode : isLegacyStage(stage) ? stage.stage : String(stageIndex);
                      const date = isStageEventEntry(stage) ? stage.at : isLegacyStage(stage) ? stage.stageDate : null;
                      const note = isStageEventEntry(stage) ? stage.note : isLegacyStage(stage) ? stage.notes : null;
                      const createdBy = stage && typeof stage === 'object' && 'createdBy' in stage ? (stage as { createdBy?: string }).createdBy : null;
                      const id = stage && typeof stage === 'object' && 'id' in stage ? (stage as { id: string }).id : `stage-${episodeIndex}-${stageIndex}`;
                      const isNewModelWithId = typeof id === 'string' && id !== `stage-${episodeIndex}-${stageIndex}` && date;
                      const isEditing = editingEventId === id;
                      return (
                        <div
                          key={id}
                          className="flex items-start gap-4 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0"
                        >
                          <div className="flex-shrink-0 w-2 h-2 rounded-full bg-medical-primary mt-2" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${getStageColor(key)}`}>
                                {getStageLabel(key)}
                              </span>
                              {isEditing ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="datetime-local"
                                    value={editAtValue}
                                    onChange={(e) => setEditAtValue(e.target.value)}
                                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={saveStageStart}
                                    disabled={saving}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title="Mentés"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditStageStart}
                                    disabled={saving}
                                    className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                                    title="Mégse"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  {date && (
                                    <span className="text-xs text-gray-500">
                                      {format(new Date(date), 'yyyy. MMMM d. HH:mm', { locale: hu })}
                                    </span>
                                  )}
                                  {canEditStageStart && isNewModelWithId && (
                                    <button
                                      type="button"
                                      onClick={() => startEditStageStart(id, date!)}
                                      className="p-1 text-gray-400 hover:text-medical-primary hover:bg-medical-primary/10 rounded"
                                      title="Stádium kezdetének szerkesztése"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                            {note && <p className="text-sm text-gray-600 mt-1">{note}</p>}
                            {createdBy && <p className="text-xs text-gray-400 mt-1">{createdBy}</p>}
                          </div>
                        </div>
                      );
                    })}
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
          {timeline.history.map((stage: unknown, idx: number) => {
            const key = isStageEventEntry(stage) ? stage.stageCode : isLegacyStage(stage) ? stage.stage : String(idx);
            const date = isStageEventEntry(stage) ? stage.at : isLegacyStage(stage) ? stage.stageDate : null;
            const note = isStageEventEntry(stage) ? stage.note : isLegacyStage(stage) ? stage.notes : null;
            const createdBy = stage && typeof stage === 'object' && 'createdBy' in stage ? (stage as { createdBy?: string }).createdBy : null;
            const id = stage && typeof stage === 'object' && 'id' in stage ? (stage as { id: string }).id : `hist-${idx}`;
            const isNewModelWithId = typeof id === 'string' && !id.startsWith('hist-') && date;
            const isEditing = editingEventId === id;
            return (
              <div key={id} className="flex items-start gap-4 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
                <div className="flex-shrink-0 w-2 h-2 rounded-full bg-medical-primary mt-2" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStageColor(key)}`}>
                      {getStageLabel(key)}
                    </span>
                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="datetime-local"
                          value={editAtValue}
                          onChange={(e) => setEditAtValue(e.target.value)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button type="button" onClick={saveStageStart} disabled={saving} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Mentés">
                          <Check className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={cancelEditStageStart} disabled={saving} className="p-1 text-gray-500 hover:bg-gray-100 rounded" title="Mégse">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {date && (
                          <span className="text-xs text-gray-500">
                            {format(new Date(date), 'yyyy. MMMM d. HH:mm', { locale: hu })}
                          </span>
                        )}
                        {canEditStageStart && isNewModelWithId && (
                          <button
                            type="button"
                            onClick={() => startEditStageStart(id, date!)}
                            className="p-1 text-gray-400 hover:text-medical-primary hover:bg-medical-primary/10 rounded"
                            title="Stádium kezdetének szerkesztése"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {note && <p className="text-sm text-gray-600 mt-1">{note}</p>}
                  {createdBy && <p className="text-xs text-gray-400 mt-1">{createdBy}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(!timeline.history || timeline.history.length === 0) && (
        <p className="text-gray-500 text-center py-8">Még nincs stádium bejegyzés.</p>
      )}
    </div>
  );
}
