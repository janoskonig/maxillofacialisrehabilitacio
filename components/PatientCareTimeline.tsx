'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import {
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  X,
  Users,
  ListTodo,
  Flag,
  MessageSquare,
  Stethoscope,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { patientStageOptions } from '@/lib/types';
import { LEGACY_MERGED_STAGE_EVENT_ID_PREFIX } from '@/lib/legacy-patient-stage-map';
import {
  CARE_TIMELINE_FILTER_OPTIONS,
  filterCareTimelineEvents,
} from '@/lib/patient-care-timeline-filters';
import type {
  CareTimelineEvent,
  CareTimelineFilterCategory,
  PatientCareTimelineResponse,
} from '@/lib/types/patient-care-timeline';

interface PatientCareTimelineProps {
  patientId: string;
  onRefresh?: () => void;
  canEditStageStart?: boolean;
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

function canPatchStageEventId(id: string): boolean {
  const raw = id.startsWith('stage:') ? id.slice(6) : id;
  return (
    !raw.startsWith(LEGACY_MERGED_STAGE_EVENT_ID_PREFIX) &&
    !raw.startsWith('stage-') &&
    !raw.startsWith('hist-')
  );
}

function stageEventUuid(id: string): string {
  return id.startsWith('stage:') ? id.slice(6) : id;
}

function getStageColor(stageOrCode: string) {
  const legacyColors: Record<string, string> = {
    uj_beteg: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300',
    arajanlatra_var: 'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-300',
    fogpotlas_kesz: 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300',
    gondozas_alatt: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200',
  };
  if (legacyColors[stageOrCode]) return legacyColors[stageOrCode];
  const stageNum = stageOrCode.replace('STAGE_', '');
  const palette = [
    'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300',
    'bg-purple-100 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300',
    'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-300',
    'bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300',
    'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300',
    'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300',
    'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300',
    'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200',
  ];
  return palette[parseInt(stageNum, 10) % palette.length] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
}

function eventTypeIcon(type: CareTimelineEvent['type']) {
  switch (type) {
    case 'stage_change':
      return Calendar;
    case 'consilium':
    case 'consilium_prep':
    case 'consilium_prep_link':
      return Users;
    case 'delegated_task':
      return ListTodo;
    case 'milestone':
      return Flag;
    case 'work_phase':
      return Stethoscope;
    default:
      return MessageSquare;
  }
}

function eventTypeLabel(type: CareTimelineEvent['type']): string {
  switch (type) {
    case 'stage_change':
      return 'Stádium';
    case 'consilium':
      return 'Konzílium';
    case 'consilium_prep':
      return 'Előkészítés';
    case 'consilium_prep_link':
      return 'Prep link';
    case 'delegated_task':
      return 'Feladat';
    case 'milestone':
      return 'Mérföldkő';
    case 'work_phase':
      return 'Munkafázis';
    default:
      return 'Esemény';
  }
}

function EventRow({
  event,
  canEditStageStart,
  editingEventId,
  editAtValue,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditValueChange,
}: {
  event: CareTimelineEvent;
  canEditStageStart: boolean;
  editingEventId: string | null;
  editAtValue: string;
  saving: boolean;
  onStartEdit: (id: string, at: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditValueChange: (v: string) => void;
}) {
  const Icon = eventTypeIcon(event.type);
  const atFormatted = format(new Date(event.at), 'yyyy. MMM d. HH:mm', { locale: hu });

  const consiliumHref =
    event.type === 'consilium'
      ? event.payload.sessionStatus === 'draft'
        ? `/consilium`
        : `/consilium/${event.payload.sessionId}/present`
      : event.type === 'consilium_prep'
        ? `/consilium/${event.payload.sessionId}/present`
        : null;

  const taskHref =
    event.type === 'delegated_task' && event.payload.presentationPath
      ? event.payload.presentationPath
      : event.type === 'delegated_task' && event.payload.consiliumSessionId
        ? `/consilium/${event.payload.consiliumSessionId}/present`
        : null;

  return (
    <li className="relative flex gap-3 pb-4 border-l-2 border-gray-100 dark:border-gray-800 pl-4 ml-2 last:pb-0">
      <div className="absolute -left-[9px] top-1 h-4 w-4 rounded-full bg-white dark:bg-gray-900 border-2 border-medical-primary/40 flex items-center justify-center">
        <Icon className="w-2.5 h-2.5 text-medical-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {eventTypeLabel(event.type)}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {event.type === 'stage_change' &&
            canEditStageStart &&
            editingEventId === stageEventUuid(event.id) ? (
              <span className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={editAtValue}
                  onChange={(e) => onEditValueChange(e.target.value)}
                  className="rounded border border-gray-300 dark:border-gray-700 px-1 py-0.5 text-xs"
                />
                <button
                  type="button"
                  onClick={onSaveEdit}
                  disabled={saving}
                  className="p-0.5 text-green-600 dark:text-green-300"
                  title="Mentés"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={saving}
                  className="p-0.5 text-gray-500 dark:text-gray-400"
                  title="Mégse"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ) : (
              <>
                {atFormatted}
                {event.type === 'stage_change' &&
                  canEditStageStart &&
                  canPatchStageEventId(event.id) && (
                    <button
                      type="button"
                      onClick={() => onStartEdit(stageEventUuid(event.id), event.at)}
                      className="p-0.5 text-gray-400 dark:text-gray-500 hover:text-medical-primary"
                      title="Stádium kezdetének szerkesztése"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
              </>
            )}
          </span>
        </div>

        {event.type === 'stage_change' && (
          <>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-sm font-medium ${getStageColor(event.payload.stageCode)}`}
            >
              {event.payload.stageLabel}
            </span>
            {event.payload.note && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{event.payload.note}</p>
            )}
            {event.payload.authorDisplay && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{event.payload.authorDisplay}</p>
            )}
          </>
        )}

        {event.type === 'consilium' && (
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {consiliumHref ? (
                <Link href={consiliumHref} className="text-medical-primary hover:underline">
                  {event.payload.title}
                </Link>
              ) : (
                event.payload.title
              )}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {event.payload.discussed ? 'Megbeszélve' : 'Nem került sorra'} ·{' '}
              {event.payload.sessionStatus}
            </p>
            {event.payload.verdictSummary && (
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{event.payload.verdictSummary}</p>
            )}
          </div>
        )}

        {event.type === 'consilium_prep' && (
          <div>
            {consiliumHref && (
              <Link href={consiliumHref} className="text-xs text-medical-primary hover:underline">
                Konzílium megnyitása
              </Link>
            )}
            <p className="text-sm text-gray-800 dark:text-gray-200 mt-1 whitespace-pre-wrap">{event.payload.body}</p>
            {event.payload.authorDisplay && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">— {event.payload.authorDisplay}</p>
            )}
          </div>
        )}

        {event.type === 'consilium_prep_link' && (
          <div>
            <p className="text-sm text-gray-800 dark:text-gray-200">Prep link megosztva</p>
            {event.payload.senderName && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{event.payload.senderName}</p>
            )}
            <Link
              href={event.payload.prepUrl}
              className="inline-flex items-center gap-1 text-sm text-medical-primary hover:underline mt-1"
            >
              Előkészítő felület
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {event.type === 'delegated_task' && (
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {taskHref ? (
                <Link href={taskHref} className="text-medical-primary hover:underline">
                  {event.payload.title}
                </Link>
              ) : (
                event.payload.title
              )}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {event.payload.status === 'done'
                ? 'Kész'
                : event.payload.status === 'cancelled'
                  ? 'Visszavonva'
                  : 'Nyitott'}
              {event.payload.source ? ` · ${event.payload.source}` : ''}
              {event.payload.assigneeName ? ` · ${event.payload.assigneeName}` : ''}
            </p>
          </div>
        )}

        {event.type === 'milestone' && (
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{event.payload.label}</p>
            {event.payload.note && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{event.payload.note}</p>
            )}
          </div>
        )}

        {event.type === 'work_phase' && (
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{event.payload.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {event.payload.status === 'completed' ? 'Befejezve' : 'Kihagyva'}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export function PatientCareTimeline({
  patientId,
  onRefresh,
  canEditStageStart = false,
}: PatientCareTimelineProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<PatientCareTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CareTimelineFilterCategory>('all');
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editAtValue, setEditAtValue] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/patients/${patientId}/care-timeline`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Hiba a timeline betöltésekor');
      const json = (await res.json()) as PatientCareTimelineResponse;
      setData(json);
      if (json.episodes.length > 0) {
        setExpandedEpisodes(new Set([json.episodes[0].episodeId]));
      }
    } catch {
      showToast('Hiba a timeline betöltésekor', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) fetchTimeline();
  }, [patientId]);

  const getStageLabel = (code: string, label?: string) => {
    if (label) return label;
    return patientStageOptions.find((o) => o.value === code)?.label || code;
  };

  const toggleEpisode = (episodeId: string) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
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
      const res = await fetch(`/api/patients/${patientId}/stages/events/${editingEventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ at: at.toISOString() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast((body as { error?: string }).error || 'Hiba a mentéskor', 'error');
        return;
      }
      showToast('Stádium kezdete frissítve', 'success');
      setEditingEventId(null);
      fetchTimeline();
      onRefresh?.();
    } catch {
      showToast('Hiba a mentéskor', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filteredEpisodes = useMemo(() => {
    if (!data) return [];
    return data.episodes.map((ep) => ({
      ...ep,
      events: filterCareTimelineEvents(ep.events, filter),
    }));
  }, [data, filter]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
        <p className="text-gray-500 dark:text-gray-400">Nincs timeline adat.</p>
      </div>
    );
  }

  const current = data.currentStage;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Páciens timeline</h3>
        <button
          type="button"
          onClick={fetchTimeline}
          className="text-sm text-medical-primary hover:text-medical-primary-dark self-start"
        >
          Frissítés
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {CARE_TIMELINE_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setFilter(opt.id)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              filter === opt.id
                ? 'bg-medical-primary text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {current && (
        <div className="mb-6 p-4 bg-medical-primary/10 border border-medical-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-medical-primary" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Jelenlegi stádium</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${getStageColor(current.stageCode)}`}
            >
              {getStageLabel(current.stageCode, current.stageLabel)}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {format(new Date(current.at), 'yyyy. MMMM d. HH:mm', { locale: hu })}
            </span>
          </div>
          {current.note && <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">{current.note}</p>}
        </div>
      )}

      {filteredEpisodes.length === 0 ||
      filteredEpisodes.every((ep) => ep.events.length === 0) ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">Nincs megjeleníthető esemény a kiválasztott szűrővel.</p>
      ) : (
        <div className="space-y-4">
          <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">Epizódok</h4>
          {filteredEpisodes.map((ep) => {
            if (ep.events.length === 0) return null;
            const expanded = expandedEpisodes.has(ep.episodeId);
            const title =
              ep.chiefComplaint || ep.caseTitle || ep.reason || 'Epizód';
            return (
              <div key={ep.episodeId} className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleEpisode(ep.episodeId)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
                >
                  <div>
                    <span
                      className={`text-xs font-medium mr-2 ${
                        ep.status === 'open' ? 'text-green-600 dark:text-green-300' : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {ep.status === 'open' ? 'Aktív' : 'Zárt'}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{title}</span>
                    {ep.openedAt && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {format(new Date(ep.openedAt), 'yyyy. MM. dd.', { locale: hu })}
                      </span>
                    )}
                  </div>
                  {expanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                  )}
                </button>
                {expanded && (
                  <ul className="p-4 pt-2 m-0 list-none">
                    {ep.events.map((ev) => (
                      <EventRow
                        key={ev.id}
                        event={ev}
                        canEditStageStart={canEditStageStart}
                        editingEventId={editingEventId}
                        editAtValue={editAtValue}
                        saving={saving}
                        onStartEdit={(id, at) => {
                          setEditingEventId(id);
                          setEditAtValue(toDatetimeLocal(at));
                        }}
                        onCancelEdit={() => {
                          setEditingEventId(null);
                          setEditAtValue('');
                        }}
                        onSaveEdit={saveStageStart}
                        onEditValueChange={setEditAtValue}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
