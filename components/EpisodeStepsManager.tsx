'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  Loader2, SkipForward, RotateCcw, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronUp, ArrowUp, ArrowDown, GripVertical, Trash2,
  Plus, Search, FileText, Layers, PenLine,
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const restrictToVerticalAxis: Modifier = (args) => ({
  ...args.transform,
  x: 0,
});

interface EpisodeStep {
  id: string;
  episodeId: string;
  stepCode: string;
  pathwayOrderIndex: number;
  pool: string;
  durationMinutes: number;
  defaultDaysOffset: number;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  appointmentId: string | null;
  createdAt: string;
  completedAt: string | null;
  sourceEpisodePathwayId: string | null;
  seq: number | null;
  customLabel?: string | null;
}

interface StepCatalogItem {
  stepCode: string;
  labelHu: string;
}

interface EpisodePathwayInfo {
  id: string;
  carePathwayId: string;
  pathwayName: string;
}

export interface EpisodeStepsManagerProps {
  episodeId: string;
  carePathwayId: string | null;
  carePathwayName?: string | null;
  episodePathways?: EpisodePathwayInfo[];
  onStepChanged?: () => void;
}

const poolLabels: Record<string, string> = {
  consult: 'Konzultáció',
  work: 'Munkafázis',
  control: 'Kontroll',
};

const statusConfig: Record<string, { icon: typeof Circle; label: string; color: string; bgColor: string }> = {
  pending: { icon: Circle, label: 'Várakozik', color: 'text-gray-400', bgColor: 'bg-gray-50' },
  scheduled: { icon: Clock, label: 'Időpont foglalva', color: 'text-blue-500', bgColor: 'bg-blue-50' },
  completed: { icon: CheckCircle2, label: 'Kész', color: 'text-green-500', bgColor: 'bg-green-50' },
  skipped: { icon: SkipForward, label: 'Átugorva', color: 'text-amber-500', bgColor: 'bg-amber-50' },
};

const PATHWAY_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
];

type AdderTab = 'catalog' | 'freetext';

// ─── Sortable step row ───────────────────────────────────────────────────────

function SortableStepRow({
  step, idx, isNext, stepLabel, pathwayLabel, pathwayColor,
  onSkipConfirm, onUnskipConfirm, onDelete, onMoveUp, onMoveDown,
  canMoveUp, canMoveDown, reordering,
}: {
  step: EpisodeStep;
  idx: number;
  isNext: boolean;
  stepLabel: string;
  pathwayLabel: string | null;
  pathwayColor: string;
  onSkipConfirm: () => void;
  onUnskipConfirm: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reordering: boolean;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: step.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
  };

  const config = statusConfig[step.status] ?? statusConfig.pending;
  const StatusIcon = config.icon;
  const canSkip = step.status === 'pending' || step.status === 'scheduled';
  const canUnskip = step.status === 'skipped';
  const canDelete = step.status === 'pending' || step.status === 'skipped';
  const isAdHoc = !step.sourceEpisodePathwayId;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors ${
          isDragging ? 'shadow-lg ring-2 ring-medical-primary/30' : ''
        } ${isNext ? 'bg-medical-primary/5 border border-medical-primary/20' : config.bgColor}`}
      >
        {/* Drag handle */}
        <button
          ref={setActivatorNodeRef}
          className="touch-none p-1 rounded hover:bg-gray-200 cursor-grab active:cursor-grabbing shrink-0"
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label="Húzd át"
        >
          <GripVertical className="w-4 h-4 text-gray-400" />
        </button>

        {/* Reorder arrows */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp || reordering}
            className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed"
            title="Feljebb"
          >
            <ArrowUp className="w-3 h-3 text-gray-500" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown || reordering}
            className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed"
            title="Lejjebb"
          >
            <ArrowDown className="w-3 h-3 text-gray-500" />
          </button>
        </div>

        {/* Step number + icon */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-gray-400 w-5 text-right">{idx + 1}.</span>
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
        </div>

        {/* Step info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${step.status === 'skipped' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {stepLabel}
            </span>
            {isNext && (
              <span className="text-xs font-medium text-medical-primary bg-medical-primary/10 px-1.5 py-0.5 rounded">
                Következő
              </span>
            )}
            {pathwayLabel && (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${pathwayColor}`}>
                {pathwayLabel}
              </span>
            )}
            {isAdHoc && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                egyedi
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-500">{poolLabels[step.pool] ?? step.pool}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">{step.durationMinutes} perc</span>
            <span className="text-xs text-gray-400">·</span>
            <span className={`text-xs ${config.color}`}>{config.label}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1">
          {canDelete && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
              title="Lépés elhagyása a tervből"
            >
              <Trash2 className="w-3 h-3" />
              Elhagyom
            </button>
          )}
          {canSkip && (
            <button
              onClick={onSkipConfirm}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-100 rounded hover:bg-amber-200 transition-colors"
              title="Lépés átugrása"
            >
              <SkipForward className="w-3 h-3" />
              Átugrom
            </button>
          )}
          {canUnskip && (
            <button
              onClick={onUnskipConfirm}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
              title="Visszaállítás"
            >
              <RotateCcw className="w-3 h-3" />
              Visszaállít
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step row + inline confirm (combined) ────────────────────────────────────

function StepRowWithConfirm({
  step, idx, isNext, stepLabel, pathwayLabel, pathwayColor,
  confirmStepId, confirmAction, skipReason, saving, reordering,
  canMoveUp, canMoveDown,
  onSkipConfirm, onUnskipConfirm, onDelete, onMoveUp, onMoveDown,
  onSkip, onUnskip, onDeleteConfirm, onCancel, onSkipReasonChange,
}: {
  step: EpisodeStep; idx: number; isNext: boolean; stepLabel: string;
  pathwayLabel: string | null; pathwayColor: string;
  confirmStepId: string | null; confirmAction: 'skip' | 'unskip' | 'delete' | null;
  skipReason: string; saving: boolean; reordering: boolean;
  canMoveUp: boolean; canMoveDown: boolean;
  onSkipConfirm: () => void; onUnskipConfirm: () => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
  onSkip: () => void; onUnskip: () => void; onDeleteConfirm: () => void;
  onCancel: () => void; onSkipReasonChange: (v: string) => void;
}) {
  const isConfirming = confirmStepId === step.id;
  return (
    <div>
      <SortableStepRow
        step={step} idx={idx} isNext={isNext}
        stepLabel={stepLabel} pathwayLabel={pathwayLabel} pathwayColor={pathwayColor}
        onSkipConfirm={onSkipConfirm} onUnskipConfirm={onUnskipConfirm} onDelete={onDelete}
        onMoveUp={onMoveUp} onMoveDown={onMoveDown}
        canMoveUp={canMoveUp} canMoveDown={canMoveDown} reordering={reordering}
      />
      {isConfirming && (
        <div className="mt-1 ml-12 p-3 rounded-lg border border-gray-200 bg-white">
          {confirmAction === 'skip' && (
            <>
              <p className="text-sm text-gray-700 mb-2">
                Biztosan átugorja a(z) <strong>{stepLabel}</strong> lépést?
              </p>
              <input
                type="text" value={skipReason} onChange={(e) => onSkipReasonChange(e.target.value)}
                placeholder="Ok (opcionális, pl. már megtörtént)"
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mb-2"
              />
              <div className="flex items-center gap-2">
                <button onClick={onSkip} disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Átugrás
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Mégse</button>
              </div>
            </>
          )}
          {confirmAction === 'unskip' && (
            <>
              <p className="text-sm text-gray-700 mb-2">Visszaállítja a(z) <strong>{stepLabel}</strong> lépést várakozóra?</p>
              <div className="flex items-center gap-2">
                <button onClick={onUnskip} disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-600 text-white rounded text-xs font-medium hover:bg-gray-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Visszaállítás
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Mégse</button>
              </div>
            </>
          )}
          {confirmAction === 'delete' && (
            <>
              <p className="text-sm text-gray-700 mb-2">
                Biztosan elhagyja a(z) <strong>{stepLabel}</strong> lépést a tervből? Ez a művelet nem vonható vissza.
              </p>
              <div className="flex items-center gap-2">
                <button onClick={onDeleteConfirm} disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Elhagyás
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Mégse</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EpisodeStepsManager({
  episodeId,
  carePathwayId,
  carePathwayName,
  episodePathways: initialEpisodePathways,
  onStepChanged,
}: EpisodeStepsManagerProps) {
  const { showToast } = useToast();
  const [steps, setSteps] = useState<EpisodeStep[]>([]);
  const [stepLabels, setStepLabels] = useState<Map<string, string>>(new Map());
  const [catalogItems, setCatalogItems] = useState<StepCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [confirmStepId, setConfirmStepId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'skip' | 'unskip' | 'delete' | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [episodePathways, setEpisodePathways] = useState<EpisodePathwayInfo[]>(initialEpisodePathways ?? []);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Step adder panel
  const [adderOpen, setAdderOpen] = useState(false);
  const [adderTab, setAdderTab] = useState<AdderTab>('catalog');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [addingStep, setAddingStep] = useState(false);

  // Free-text step form
  const [freeLabel, setFreeLabel] = useState('');
  const [freePool, setFreePool] = useState('work');
  const [freeDuration, setFreeDuration] = useState(30);

  const hasMultiplePathways = episodePathways.length > 1;

  const pathwayColorMap = useMemo(() => {
    const m = new Map<string, string>();
    episodePathways.forEach((ep, idx) => {
      m.set(ep.id, PATHWAY_COLORS[idx % PATHWAY_COLORS.length]);
    });
    return m;
  }, [episodePathways]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ─── Data loading ────────────────────────────────────────────────────────

  const loadSteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 409) { setSteps([]); return; }
        throw new Error('Nem sikerült betölteni');
      }
      const data = await res.json();
      setSteps(data.steps ?? []);
    } catch (e) {
      console.error('Error loading episode steps:', e);
    }
  }, [episodeId]);

  const loadLabels = useCallback(async () => {
    try {
      const res = await fetch('/api/step-catalog', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const items: StepCatalogItem[] = (data.items ?? data.steps ?? []).map((s: { stepCode: string; labelHu: string }) => ({
          stepCode: s.stepCode,
          labelHu: s.labelHu,
        }));
        setCatalogItems(items);
        const map = new Map<string, string>();
        items.forEach((s) => map.set(s.stepCode, s.labelHu));
        setStepLabels(map);
      }
    } catch { /* non-critical */ }
  }, []);

  const loadEpisodePathways = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEpisodePathways(data.episode?.episodePathways ?? []);
      }
    } catch { /* non-critical */ }
  }, [episodeId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSteps(), loadLabels(), loadEpisodePathways()]).finally(() => setLoading(false));
  }, [carePathwayId, loadSteps, loadLabels, loadEpisodePathways]);

  // ─── Step actions ────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await loadSteps();
      showToast('Lépések generálva', 'success');
    } catch {
      showToast('Nem sikerült generálni a lépéseket', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSkip = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'skipped', reason: skipReason || 'Manuálisan átugorva' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps((prev) => prev.map((s) => (s.id === stepId ? data.step : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      setSkipReason('');
      showToast('Lépés átugorva', 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUnskip = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'pending', reason: 'Visszaállítva várakozóra' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps((prev) => prev.map((s) => (s.id === stepId ? data.step : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      showToast('Lépés visszaállítva', 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/${stepId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      setConfirmStepId(null);
      setConfirmAction(null);
      showToast('Lépés törölve', 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a törlésnél', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Reorder (arrows) ───────────────────────────────────────────────────

  const persistReorder = async (newSteps: EpisodeStep[]) => {
    setReordering(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stepIds: newSteps.map((s) => s.id) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps(data.steps ?? newSteps);
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba az átrendezésnél', 'error');
      await loadSteps();
    } finally {
      setReordering(false);
    }
  };

  const handleMoveStep = (stepId: string, direction: 'up' | 'down') => {
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;
    const newSteps = [...steps];
    [newSteps[idx], newSteps[targetIdx]] = [newSteps[targetIdx], newSteps[idx]];
    setSteps(newSteps);
    persistReorder(newSteps);
  };

  // ─── DnD reorder ────────────────────────────────────────────────────────

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = steps.findIndex((s) => s.id === active.id);
    const newIdx = steps.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newSteps = [...steps];
    const [removed] = newSteps.splice(oldIdx, 1);
    newSteps.splice(newIdx, 0, removed);
    setSteps(newSteps);
    persistReorder(newSteps);
  };

  // ─── Step adder ─────────────────────────────────────────────────────────

  const addCatalogStep = async (item: StepCatalogItem) => {
    setAddingStep(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stepCode: item.stepCode, pool: 'work' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps((prev) => [...prev, data.step]);
      showToast(`${item.labelHu} hozzáadva`, 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a hozzáadásnál', 'error');
    } finally {
      setAddingStep(false);
    }
  };

  const addFreeTextStep = async () => {
    if (!freeLabel.trim()) return;
    setAddingStep(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          label: freeLabel.trim(),
          pool: freePool,
          durationMinutes: freeDuration,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps((prev) => [...prev, data.step]);
      setFreeLabel('');
      setFreeDuration(30);
      showToast('Egyedi lépés hozzáadva', 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a hozzáadásnál', 'error');
    } finally {
      setAddingStep(false);
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const getStepLabel = (step: EpisodeStep): string => {
    if (step.customLabel) return step.customLabel;
    return stepLabels.get(step.stepCode) ?? step.stepCode.replace(/_/g, ' ');
  };

  const getPathwayLabel = (sourceId: string | null): string | null => {
    if (!sourceId || !hasMultiplePathways) return null;
    return episodePathways.find((p) => p.id === sourceId)?.pathwayName ?? null;
  };

  const getPathwayColor = (sourceId: string | null): string => {
    if (!sourceId) return 'bg-gray-100 text-gray-600';
    return pathwayColorMap.get(sourceId) ?? 'bg-gray-100 text-gray-600';
  };

  const filteredCatalog = useMemo(() => {
    if (!catalogSearch.trim()) return catalogItems;
    const q = catalogSearch.toLowerCase();
    return catalogItems.filter(
      (item) => item.labelHu.toLowerCase().includes(q) || item.stepCode.toLowerCase().includes(q)
    );
  }, [catalogItems, catalogSearch]);

  const nextPendingIndex = steps.findIndex((s) => s.status === 'pending' || s.status === 'scheduled');
  const stepIds = useMemo(() => steps.map((s) => s.id), [steps]);

  const hasPathways = carePathwayId || (episodePathways && episodePathways.length > 0);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900">Kezelési lépések</h3>
          {hasMultiplePathways ? (
            <p className="text-sm text-gray-500 mt-0.5">{episodePathways.length} kezelési út összefésülve</p>
          ) : carePathwayName ? (
            <p className="text-sm text-gray-500 mt-0.5">{carePathwayName}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {steps.length > 0 && (
            <span className="text-xs text-gray-500">
              {steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length}/{steps.length} kész
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Betöltés…</span>
            </div>
          ) : (
            <>
              {/* ─── Step adder panel ─────────────────────────────────── */}
              <div className="mb-4">
                {!adderOpen ? (
                  <div className="flex items-center gap-2">
                    {steps.length === 0 && hasPathways && (
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-medical-primary text-white rounded-md text-sm hover:bg-medical-primary-dark disabled:opacity-50"
                      >
                        {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <Layers className="w-3.5 h-3.5" />
                        Lépések generálása sablonból
                      </button>
                    )}
                    <button
                      onClick={() => setAdderOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 text-gray-600 rounded-md text-sm hover:border-medical-primary hover:text-medical-primary transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Lépés hozzáadása
                    </button>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                    {/* Tab switcher */}
                    <div className="flex items-center gap-1 mb-3">
                      <button
                        onClick={() => setAdderTab('catalog')}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          adderTab === 'catalog'
                            ? 'bg-medical-primary text-white'
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <FileText className="w-3 h-3" />
                        Katalógusból
                      </button>
                      <button
                        onClick={() => setAdderTab('freetext')}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          adderTab === 'freetext'
                            ? 'bg-medical-primary text-white'
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <PenLine className="w-3 h-3" />
                        Szabad lépés
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => setAdderOpen(false)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                      >
                        Bezárás
                      </button>
                    </div>

                    {/* Catalog tab */}
                    {adderTab === 'catalog' && (
                      <div>
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <input
                            type="text"
                            value={catalogSearch}
                            onChange={(e) => setCatalogSearch(e.target.value)}
                            placeholder="Lépés keresése…"
                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {filteredCatalog.length === 0 ? (
                            <p className="text-xs text-gray-500 py-2 text-center">Nincs találat</p>
                          ) : (
                            filteredCatalog.map((item) => (
                              <button
                                key={item.stepCode}
                                onClick={() => addCatalogStep(item)}
                                disabled={addingStep}
                                className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-white hover:shadow-sm transition-all text-sm disabled:opacity-50 group"
                              >
                                <Plus className="w-3.5 h-3.5 text-gray-400 group-hover:text-medical-primary shrink-0" />
                                <span className="font-medium text-gray-800 group-hover:text-medical-primary">{item.labelHu}</span>
                                <span className="text-xs text-gray-400 ml-auto shrink-0">{item.stepCode}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Free text tab */}
                    {adderTab === 'freetext' && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={freeLabel}
                          onChange={(e) => setFreeLabel(e.target.value)}
                          placeholder="Lépés megnevezése (pl. Ideiglenes korona)"
                          className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5"
                        />
                        <div className="flex items-center gap-2">
                          <select
                            value={freePool}
                            onChange={(e) => setFreePool(e.target.value)}
                            className="text-sm border border-gray-300 rounded-md px-2 py-1.5"
                          >
                            <option value="consult">Konzultáció</option>
                            <option value="work">Munkafázis</option>
                            <option value="control">Kontroll</option>
                          </select>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={freeDuration}
                              onChange={(e) => setFreeDuration(Math.max(5, parseInt(e.target.value) || 30))}
                              min={5}
                              step={5}
                              className="w-16 text-sm border border-gray-300 rounded-md px-2 py-1.5 text-center"
                            />
                            <span className="text-xs text-gray-500">perc</span>
                          </div>
                          <button
                            onClick={addFreeTextStep}
                            disabled={!freeLabel.trim() || addingStep}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-medical-primary text-white rounded-md text-sm hover:bg-medical-primary-dark disabled:opacity-50 ml-auto"
                          >
                            {addingStep ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            Hozzáadás
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ─── Step list with DnD ──────────────────────────────── */}
              {steps.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">Még nincsenek lépések. Adj hozzá lépéseket fent a tervhez.</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500 mb-2">
                    Húzd a lépéseket a kívánt sorrendbe, vagy használd a nyilakat. A kukával elhagyhatod a felesleges lépéseket.
                  </p>
                  {mounted ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
                    <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                      {steps.map((step, idx) => (
                        <StepRowWithConfirm
                          key={step.id}
                          step={step}
                          idx={idx}
                          isNext={idx === nextPendingIndex}
                          stepLabel={getStepLabel(step)}
                          pathwayLabel={getPathwayLabel(step.sourceEpisodePathwayId)}
                          pathwayColor={getPathwayColor(step.sourceEpisodePathwayId)}
                          confirmStepId={confirmStepId}
                          confirmAction={confirmAction}
                          skipReason={skipReason}
                          saving={saving}
                          reordering={reordering}
                          canMoveUp={idx > 0}
                          canMoveDown={idx < steps.length - 1}
                          onSkipConfirm={() => { setConfirmStepId(step.id); setConfirmAction('skip'); setSkipReason(''); }}
                          onUnskipConfirm={() => { setConfirmStepId(step.id); setConfirmAction('unskip'); }}
                          onDelete={() => { setConfirmStepId(step.id); setConfirmAction('delete'); }}
                          onMoveUp={() => handleMoveStep(step.id, 'up')}
                          onMoveDown={() => handleMoveStep(step.id, 'down')}
                          onSkip={() => handleSkip(step.id)}
                          onUnskip={() => handleUnskip(step.id)}
                          onDeleteConfirm={() => handleDelete(step.id)}
                          onCancel={() => { setConfirmStepId(null); setConfirmAction(null); }}
                          onSkipReasonChange={setSkipReason}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                  ) : (
                    <div className="animate-pulse space-y-2">
                      {steps.map((_, i) => (
                        <div key={i} className="h-12 bg-gray-100 rounded-lg" />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
