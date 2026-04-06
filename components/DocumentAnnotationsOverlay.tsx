'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';
import type { TextPayloadV1 } from '@/lib/document-annotations-schema';
import { Pencil, Type, Save, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { drawFreehandAnnotationsFiltered, hueFromString } from '@/lib/document-annotation-canvas';

function formatAnnotationDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

type ImageLayout = {
  ox: number;
  oy: number;
  dw: number;
  dh: number;
};

function computeImageContentLayout(img: HTMLImageElement): ImageLayout | null {
  const rect = img.getBoundingClientRect();
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh || rect.width === 0 || rect.height === 0) return null;
  const cw = rect.width;
  const ch = rect.height;
  const scale = Math.min(cw / nw, ch / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  return { ox, oy, dw, dh };
}

type DraftPath = { points: { x: number; y: number }[]; color: string; widthRel: number };

export type DocumentAnnotationsOverlayProps = {
  patientId: string;
  documentId: string;
  imageUrl: string | null;
  mode: 'view' | 'edit';
  canEdit?: boolean;
  imgClassName?: string;
  compact?: boolean;
  onImageLoad?: () => void;
  onImageError?: () => void;
  onAnnotationsUpdated?: () => void;
};

export function DocumentAnnotationsOverlay({
  patientId,
  documentId,
  imageUrl,
  mode,
  canEdit = false,
  imgClassName = 'max-w-full max-h-full object-contain block',
  compact = false,
  onImageLoad,
  onImageError,
  onAnnotationsUpdated,
}: DocumentAnnotationsOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<ImageLayout | null>(null);
  const [annotations, setAnnotations] = useState<PatientDocumentAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [tool, setTool] = useState<'pen' | 'text'>('pen');
  const [draftPaths, setDraftPaths] = useState<DraftPath[]>([]);
  const [activeStroke, setActiveStroke] = useState<DraftPath | null>(null);
  const drawingRef = useRef<DraftPath | null>(null);
  const penColor = '#ef4444';
  const widthRel = 0.008;
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenAnnotationIds, setHiddenAnnotationIds] = useState<Set<string>>(new Set());
  /** Kisebb képernyőn a jegyzék alapból zárva — több hely a képnek és kevesebb véletlen görgetés. */
  const [mobileNotesExpanded, setMobileNotesExpanded] = useState(false);
  const pendingTextPanelRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const loadAnnotations = useCallback(async () => {
    if (!patientId || !documentId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/documents/${documentId}/annotations`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        setAnnotations([]);
        return;
      }
      const data = await res.json();
      setAnnotations(data.annotations || []);
    } catch {
      setAnnotations([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, documentId]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  useEffect(() => {
    setMobileNotesExpanded(false);
  }, [documentId]);

  useEffect(() => {
    if (!pendingText || mode !== 'edit' || !canEdit) return;
    const el = pendingTextPanelRef.current?.querySelector('textarea');
    requestAnimationFrame(() => {
      el?.focus({ preventScroll: true });
      pendingTextPanelRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [pendingText, mode, canEdit]);

  useEffect(() => {
    const valid = new Set(annotations.map((a) => a.id));
    setHiddenAnnotationIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
      });
      if (next.size === prev.size && Array.from(prev).every((id) => next.has(id))) return prev;
      return next;
    });
  }, [annotations]);

  const byAuthor = useMemo(() => {
    const m = new Map<string, PatientDocumentAnnotation[]>();
    for (const a of annotations) {
      const k = a.createdBy || '';
      const list = m.get(k) ?? [];
      list.push(a);
      m.set(k, list);
    }
    m.forEach((list) => {
      list.sort((a: PatientDocumentAnnotation, b: PatientDocumentAnnotation) =>
        (a.createdAt || '').localeCompare(b.createdAt || ''),
      );
    });
    return m;
  }, [annotations]);

  const authorKeys = useMemo(() => {
    return Array.from(byAuthor.keys()).sort((a, b) => {
      const na = (byAuthor.get(a)?.[0]?.createdByName || a).toLowerCase();
      const nb = (byAuthor.get(b)?.[0]?.createdByName || b).toLowerCase();
      return na.localeCompare(nb, 'hu');
    });
  }, [byAuthor]);

  const toggleAnnotationVisibility = useCallback((id: string) => {
    setHiddenAnnotationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAuthorVisibility = useCallback(
    (createdBy: string) => {
      const group = byAuthor.get(createdBy);
      if (!group?.length) return;
      const ids = group.map((a) => a.id);
      setHiddenAnnotationIds((prev) => {
        const allHidden = ids.every((id) => prev.has(id));
        const next = new Set(prev);
        if (allHidden) ids.forEach((id) => next.delete(id));
        else ids.forEach((id) => next.add(id));
        return next;
      });
    },
    [byAuthor],
  );

  const updateLayout = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    const next = computeImageContentLayout(img);
    setLayout(next);
  }, []);

  useEffect(() => {
    if (annotations.length === 0) return;
    let id1 = 0;
    let id2 = 0;
    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => updateLayout());
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [annotations, updateLayout]);

  useLayoutEffect(() => {
    updateLayout();
  }, [imageUrl, updateLayout]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => updateLayout());
    ro.observe(img);
    const wrap = wrapRef.current;
    if (wrap) ro.observe(wrap);
    return () => ro.disconnect();
  }, [imageUrl, updateLayout]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const { dw, dh } = layout;
    if (dw < 2 || dh < 2) return;
    canvas.width = Math.max(1, Math.floor(dw * dpr));
    canvas.height = Math.max(1, Math.floor(dh * dpr));
    canvas.style.width = `${dw}px`;
    canvas.style.height = `${dh}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, dw, dh);

    if (!showAnnotations) return;

    const minStrokePx = compact ? 3 : 2;

    const drawPathList = (paths: DraftPath[], alpha = 1) => {
      ctx.globalAlpha = alpha;
      for (const path of paths) {
        if (path.points.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = path.color;
        const wr = Number.isFinite(path.widthRel) && path.widthRel > 0 ? path.widthRel : 0.008;
        ctx.lineWidth = Math.max(minStrokePx, wr * Math.min(dw, dh));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.moveTo(path.points[0].x * dw, path.points[0].y * dh);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x * dw, path.points[i].y * dh);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const img = imgRef.current;
    const nw = img && img.naturalWidth > 0 ? img.naturalWidth : 0;
    const nh = img && img.naturalHeight > 0 ? img.naturalHeight : 0;
    if (nw > 0 && nh > 0) {
      drawFreehandAnnotationsFiltered(ctx, dw, dh, nw, nh, 'contain', annotations, {
        hiddenIds: hiddenAnnotationIds,
        selectedId,
        minStrokePx,
      });
    }

    const live = activeStroke ? [...draftPaths, activeStroke] : draftPaths;
    drawPathList(live, 1);
  }, [
    annotations,
    draftPaths,
    activeStroke,
    layout,
    showAnnotations,
    selectedId,
    compact,
    hiddenAnnotationIds,
  ]);

  useLayoutEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const normFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const img = imgRef.current;
      if (!img || !layout) return null;
      const r = img.getBoundingClientRect();
      const lx = clientX - r.left - layout.ox;
      const ly = clientY - r.top - layout.oy;
      const x = Math.min(1, Math.max(0, lx / layout.dw));
      const y = Math.min(1, Math.max(0, ly / layout.dh));
      return { x, y };
    },
    [layout],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== 'edit' || !canEdit || !showAnnotations) return;
    const n = normFromClient(e.clientX, e.clientY);
    if (!n) return;

    if (tool === 'text') {
      e.preventDefault();
      setPendingText(n);
      setPendingTextValue('');
      return;
    }

    if (tool !== 'pen') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke = { points: [n], color: penColor, widthRel };
    drawingRef.current = stroke;
    setActiveStroke(stroke);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== 'edit' || !canEdit || tool !== 'pen') return;
    const prev = drawingRef.current;
    if (!prev) return;
    e.preventDefault();
    const n = normFromClient(e.clientX, e.clientY);
    if (!n) return;
    const last = prev.points[prev.points.length - 1];
    const dx = n.x - last.x;
    const dy = n.y - last.y;
    if (dx * dx + dy * dy < 1e-8) return;
    const next = { ...prev, points: [...prev.points, n] };
    drawingRef.current = next;
    setActiveStroke(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (mode !== 'edit' || !canEdit || tool !== 'pen') return;
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const cur = drawingRef.current;
    drawingRef.current = null;
    setActiveStroke(null);
    if (cur && cur.points.length >= 2) {
      setDraftPaths((p) => [...p, cur]);
    }
  };

  const saveFreehand = async () => {
    if (draftPaths.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/documents/${documentId}/annotations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'freehand',
            payload: { v: 1, paths: draftPaths },
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(typeof err.error === 'string' ? err.error : 'Mentés sikertelen');
        return;
      }
      setDraftPaths([]);
      await loadAnnotations();
      onAnnotationsUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const saveTextAnnotation = async () => {
    if (!pendingText || !pendingTextValue.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/documents/${documentId}/annotations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'text',
            payload: {
              v: 1,
              x: pendingText.x,
              y: pendingText.y,
              text: pendingTextValue.trim(),
              style: 'box',
            },
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(typeof err.error === 'string' ? err.error : 'Mentés sikertelen');
        return;
      }
      setPendingText(null);
      setPendingTextValue('');
      await loadAnnotations();
      onAnnotationsUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnotation = async (id: string) => {
    if (!window.confirm('Biztosan törli ezt az annotációt? (Visszaállítható.)')) return;
    const res = await fetch(
      `/api/patients/${patientId}/documents/${documentId}/annotations/${id}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (!res.ok) {
      alert('Törlés sikertelen');
      return;
    }
    setSelectedId(null);
    await loadAnnotations();
    onAnnotationsUpdated?.();
  };

  if (!imageUrl) return null;

  const visibleTextAnnotations = annotations.filter(
    (a) => a.kind === 'text' && !hiddenAnnotationIds.has(a.id),
  );

  const notesCount = annotations.length + draftPaths.length;

  const editChrome = mode === 'edit' && canEdit;
  /** Vetítés / előkészítő: sötét háttérhez igazított eszközsor. */
  const toolbarOnDark = compact && editChrome;

  return (
    <div className="flex flex-col gap-2 w-full max-w-full">
      {editChrome && (
        <div
          className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center text-sm ${
            toolbarOnDark ? 'text-white' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTool('pen')}
            className={`flex items-center gap-1 px-2 py-1 rounded border ${
              tool === 'pen'
                ? 'bg-medical-primary text-white border-medical-primary'
                : toolbarOnDark
                  ? 'bg-white/10 border-white/30 text-white hover:bg-white/15'
                  : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <Pencil className="w-4 h-4" />
            Szabadkézi
          </button>
          <button
            type="button"
            onClick={() => setTool('text')}
            className={`flex items-center gap-1 px-2 py-1 rounded border ${
              tool === 'text'
                ? 'bg-medical-primary text-white border-medical-primary'
                : toolbarOnDark
                  ? 'bg-white/10 border-white/30 text-white hover:bg-white/15'
                  : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <Type className="w-4 h-4" />
            Szöveg
          </button>
          {tool === 'pen' && draftPaths.length > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={saveFreehand}
              className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Szabadkézi mentése
            </button>
          )}
          {tool === 'pen' && draftPaths.length > 0 && (
            <button
              type="button"
              onClick={() => setDraftPaths([])}
              className={
                toolbarOnDark
                  ? 'px-2 py-1 rounded border border-white/30 bg-white/10 text-white hover:bg-white/15'
                  : 'px-2 py-1 rounded border border-gray-300 bg-white text-gray-900'
              }
            >
              Vázlat törlése
            </button>
          )}
          </div>
          <button
            type="button"
            onClick={() => setShowAnnotations((s) => !s)}
            className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded border w-full sm:w-auto sm:ml-auto ${
              toolbarOnDark
                ? 'border-white/30 bg-white/10 text-white hover:bg-white/15'
                : 'border-gray-300 bg-white text-gray-900'
            }`}
          >
            {showAnnotations ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            Annotációk {showAnnotations ? 'látszanak' : 'rejtve'}
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 min-h-0 items-start w-full min-w-0">
        <div ref={wrapRef} className="relative inline-block max-w-full max-h-[min(85dvh,900px)] mx-auto shrink-0">
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className={imgClassName}
            draggable={false}
            onLoad={() => {
              updateLayout();
              onImageLoad?.();
            }}
            onError={() => onImageError?.()}
          />
          {layout && (
            <div
              className="absolute overflow-visible [-webkit-touch-callout:none]"
              style={{
                left: layout.ox,
                top: layout.oy,
                width: layout.dw,
                height: layout.dh,
                pointerEvents:
                  mode === 'edit' && canEdit && showAnnotations && (tool === 'pen' || tool === 'text')
                    ? 'auto'
                    : 'none',
                cursor: mode === 'edit' && canEdit && showAnnotations && tool === 'text' ? 'crosshair' : 'default',
                touchAction:
                  mode === 'edit' && canEdit && showAnnotations
                    ? tool === 'pen'
                      ? 'none'
                      : 'manipulation'
                    : 'auto',
              }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 z-[1] select-none"
                style={{ touchAction: mode === 'edit' && canEdit && tool === 'pen' ? 'none' : 'inherit' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              {showAnnotations &&
                visibleTextAnnotations.map((ann) => {
                  const p = ann.payload as TextPayloadV1;
                  if (Number(p.v) !== 1) return null;
                  const hue = hueFromString(ann.createdBy);
                  const border = selectedId === ann.id ? '2px solid #fbbf24' : `2px solid hsl(${hue}, 60%, 45%)`;
                  const anchorRight = typeof p.x === 'number' && p.x > 0.55;
                  return (
                    <div
                      key={ann.id}
                      className="absolute z-[2]"
                      style={{
                        left: `${p.x * 100}%`,
                        top: `${p.y * 100}%`,
                        transform: anchorRight ? 'translate(-100%, -100%)' : 'translate(0, -100%)',
                        maxWidth: 'min(18rem, 92%)',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mode === 'edit' && canEdit) setSelectedId(ann.id);
                      }}
                    >
                      <div
                        className="rounded-md px-2 py-1 text-left shadow-md bg-white/95 text-gray-900 text-sm select-text"
                        style={{ border }}
                      >
                        <p className="whitespace-pre-wrap break-words">{p.text}</p>
                        <p className="text-[10px] text-gray-600 mt-1 border-t border-gray-200 pt-0.5">
                          {ann.createdByName || ann.createdBy}
                          {ann.createdAt ? ` · ${formatAnnotationDateTime(ann.createdAt)}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            </div>
          )}
        </div>

        {showAnnotations && notesCount > 0 && (
          <>
            <button
              type="button"
              className={`lg:hidden w-full shrink-0 rounded-lg border px-3 py-2 text-left text-sm font-medium ${
                compact
                  ? 'border-white/25 bg-zinc-900 text-zinc-100'
                  : 'border-gray-200 bg-white text-gray-800'
              }`}
              onClick={() => setMobileNotesExpanded((o) => !o)}
            >
              {mobileNotesExpanded ? 'Jegyzetek elrejtése' : `Jegyzetek / rajzok megnyitása (${notesCount})`}
            </button>
            <div
              className={`min-w-0 w-full lg:w-56 shrink-0 rounded-lg border p-2 text-xs overflow-y-auto ${
                compact
                  ? 'border-white/25 bg-zinc-900 text-zinc-100 max-h-[42vh] lg:max-h-[min(85dvh,900px)] lg:w-52 shadow-lg shadow-black/50 p-2.5'
                  : 'border-gray-200 bg-white text-gray-900 max-h-[42vh] lg:max-h-[min(85dvh,900px)]'
              } ${mobileNotesExpanded ? '' : 'max-lg:hidden'} lg:block`}
            >
            <p className={`font-semibold mb-2 ${compact ? 'text-white' : 'text-gray-700'}`}>
              Jegyzetek / rajzok
            </p>
            {draftPaths.length > 0 && (
              <div
                className={`mb-2 pb-2 border-b ${compact ? 'border-white/20' : 'border-gray-200'}`}
              >
                <p className={compact ? 'text-amber-300' : 'text-amber-800'}>
                  Vázlat (nem mentett vonalak)
                </p>
              </div>
            )}
            <div className="space-y-3">
              {authorKeys.map((authorKey) => {
                const group = byAuthor.get(authorKey) ?? [];
                const authorLabel = group[0]?.createdByName || authorKey || 'Ismeretlen';
                const allHidden =
                  group.length > 0 && group.every((a) => hiddenAnnotationIds.has(a.id));
                return (
                  <div key={authorKey || '—'}>
                    <div className="flex items-center gap-1 mb-1 min-w-0">
                      <button
                        type="button"
                        title={allHidden ? 'Szerző rétegeinek megjelenítése' : 'Szerző rétegeinek elrejtése'}
                        onClick={() => toggleAuthorVisibility(authorKey)}
                        className={
                          compact
                            ? 'p-1 rounded shrink-0 text-zinc-300 hover:bg-white/10'
                            : 'p-1 rounded shrink-0 text-gray-600 hover:bg-gray-100'
                        }
                      >
                        {allHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <span
                        className={`font-medium truncate text-[11px] ${compact ? 'text-zinc-100' : 'text-gray-800'}`}
                        title={authorLabel}
                      >
                        {authorLabel}
                      </span>
                    </div>
                    <ul
                      className={`space-y-1.5 pl-1 border-l border-dashed ml-1.5 ${
                        compact ? 'border-white/15' : 'border-gray-200'
                      }`}
                    >
                      {group.map((ann) => {
                        const hidden = hiddenAnnotationIds.has(ann.id);
                        return (
                          <li key={ann.id} className="flex items-start gap-1 min-w-0">
                            <button
                              type="button"
                              title={hidden ? 'Megjelenítés' : 'Elrejtés'}
                              onClick={() => toggleAnnotationVisibility(ann.id)}
                              className={
                                compact
                                  ? 'p-0.5 rounded shrink-0 text-zinc-400 hover:bg-white/10 mt-0.5'
                                  : 'p-0.5 rounded shrink-0 text-gray-500 hover:bg-gray-100 mt-0.5'
                              }
                            >
                              {hidden ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <button
                                type="button"
                                onClick={() => setSelectedId(ann.id === selectedId ? null : ann.id)}
                                className={
                                  compact
                                    ? `w-full text-left rounded px-1.5 py-1 transition-colors ${
                                        selectedId === ann.id
                                          ? 'bg-white/15 ring-1 ring-white/30'
                                          : 'hover:bg-white/10'
                                      }`
                                    : `w-full text-left rounded px-1.5 py-1 transition-colors ${
                                        selectedId === ann.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                                      }`
                                }
                              >
                                <span
                                  className={`font-medium block ${compact ? 'text-white' : 'text-gray-800'}`}
                                >
                                  {ann.kind === 'freehand' ? 'Szabadkézi' : 'Szöveg'}
                                </span>
                                <span className={`block ${compact ? 'text-zinc-400' : 'text-gray-400'}`}>
                                  {ann.createdAt ? formatAnnotationDateTime(ann.createdAt) : ''}
                                </span>
                              </button>
                              {editChrome && selectedId === ann.id && (
                                <button
                                  type="button"
                                  onClick={() => deleteAnnotation(ann.id)}
                                  className={`mt-0.5 flex items-center gap-1 hover:underline text-[10px] ${
                                    compact ? 'text-red-400' : 'text-red-600'
                                  }`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Törlés
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
          </>
        )}
      </div>

      {portalReady &&
        pendingText &&
        editChrome &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center overscroll-contain bg-black/50 p-4"
            style={{
              paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="annotation-text-title"
            onClick={() => {
              setPendingText(null);
              setPendingTextValue('');
            }}
          >
            <div
              ref={pendingTextPanelRef}
              className={`w-full max-w-[400px] max-h-[min(85dvh,520px)] overflow-y-auto rounded-lg border p-3 shadow-xl ${
                compact
                  ? 'border-white/25 bg-zinc-900 text-zinc-100'
                  : 'border-gray-300 bg-white text-gray-900'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <label
                id="annotation-text-title"
                className={`block text-sm font-medium mb-1 ${compact ? 'text-zinc-200' : 'text-gray-700'}`}
              >
                Szöveg a képen
              </label>
              <textarea
                className={`w-full border rounded p-2 text-sm min-h-[80px] ${
                  compact
                    ? 'border-white/25 bg-black/40 text-zinc-100 placeholder:text-zinc-500'
                    : 'border-gray-300 bg-white text-gray-900'
                }`}
                value={pendingTextValue}
                onChange={(e) => setPendingTextValue(e.target.value)}
              />
              <div className="flex flex-col-reverse sm:flex-row gap-2 mt-2 sm:justify-end">
                <button
                  type="button"
                  className={
                    compact
                      ? 'px-3 py-2 rounded border border-white/30 text-white hover:bg-white/10 w-full sm:w-auto'
                      : 'px-3 py-2 border border-gray-300 rounded text-gray-900 w-full sm:w-auto'
                  }
                  onClick={() => {
                    setPendingText(null);
                    setPendingTextValue('');
                  }}
                >
                  Mégse
                </button>
                <button
                  type="button"
                  disabled={saving || !pendingTextValue.trim()}
                  className="px-3 py-2 bg-medical-primary text-white rounded disabled:opacity-50 w-full sm:w-auto"
                  onClick={saveTextAnnotation}
                >
                  Mentés
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
