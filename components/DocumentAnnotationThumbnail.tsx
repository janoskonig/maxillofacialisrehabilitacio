'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';
import type { TextPayloadV1 } from '@/lib/document-annotations-schema';
import { drawFreehandAnnotationsFiltered, normToPixel } from '@/lib/document-annotation-canvas';

const EMPTY_HIDDEN = new Set<string>();

type Props = {
  patientId: string;
  documentId: string;
  imageUrl: string;
  annotations?: PatientDocumentAnnotation[] | null;
  objectFit?: 'contain' | 'cover';
  className?: string;
  imgClassName?: string;
  onImageError?: () => void;
};

export function DocumentAnnotationThumbnail({
  patientId,
  documentId,
  imageUrl,
  annotations: annotationsProp,
  objectFit = 'cover',
  className = '',
  imgClassName = 'w-full h-full object-cover',
  onImageError,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [annotations, setAnnotations] = useState<PatientDocumentAnnotation[]>(annotationsProp ?? []);
  const [nw, setNw] = useState(1);
  const [nh, setNH] = useState(1);

  useEffect(() => {
    if (annotationsProp != null) {
      setAnnotations(annotationsProp);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/patients/${patientId}/documents/${documentId}/annotations`,
          { credentials: 'include' },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setAnnotations(data.annotations || []);
      } catch {
        if (!cancelled) setAnnotations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, documentId, annotationsProp]);

  const redraw = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!wrap || !canvas || !img || !img.complete) return;
    const rect = wrap.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw < 2 || ch < 2) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);
    const inw = img.naturalWidth || nw;
    const inh = img.naturalHeight || nh;
    if (inw < 1 || inh < 1) return;

    drawFreehandAnnotationsFiltered(ctx, cw, ch, inw, inh, objectFit, annotations, {
      hiddenIds: EMPTY_HIDDEN,
      minStrokePx: 1.5,
    });
  }, [annotations, nw, nh, objectFit]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  const onImgLoad = () => {
    const img = imgRef.current;
    if (img) {
      setNw(img.naturalWidth || 1);
      setNH(img.naturalHeight || 1);
    }
    redraw();
  };

  const textItems = annotations.filter((a) => a.kind === 'text');

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt=""
        className={imgClassName}
        draggable={false}
        loading="lazy"
        decoding="async"
        onLoad={onImgLoad}
        onError={onImageError}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-[1]"
        aria-hidden
      />
      {textItems.map((ann) => {
        const p = ann.payload as TextPayloadV1;
        if (Number(p.v) !== 1 || !String(p.text ?? '').trim()) return null;
        const inw = imgRef.current?.naturalWidth || nw;
        const inh = imgRef.current?.naturalHeight || nh;
        const wrap = wrapRef.current;
        if (!wrap || inw < 1 || inh < 1) return null;
        const { width: cw, height: ch } = wrap.getBoundingClientRect();
        if (cw < 2 || ch < 2) return null;
        const pos = normToPixel(p.x, p.y, cw, ch, inw, inh, objectFit);
        return (
          <div
            key={ann.id}
            className="absolute z-[2] pointer-events-none max-w-[45%]"
            style={{
              left: pos.x,
              top: pos.y,
              transform: 'translate(-10%, -100%)',
            }}
          >
            <div
              className="rounded px-0.5 py-px shadow-sm border border-black/25 bg-white/90 text-gray-900 leading-tight"
              style={{ fontSize: 'clamp(5px, 2.2vw, 9px)' }}
            >
              <p className="truncate font-medium">{String(p.text).trim()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
