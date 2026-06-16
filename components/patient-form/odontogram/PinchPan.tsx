'use client';

import { useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react';

/**
 * Könnyű pinch-zoom / pan réteg az odontogram-ívekhez (mobil).
 * - A gesztus alatt közvetlenül a DOM `transform`-ot írjuk (nincs React re-render → snappy),
 *   és csak a gesztus végén kommitálunk state-be.
 * - 2 ujj: zoom + pásztázás a fókuszpont megtartásával. 1 ujj: pásztázás, ha már rá van zoomolva.
 * - Dupla koppintás: visszaáll alaphelyzetbe.
 * - Tap (mozgás nélkül) átmegy a fogakra (kijelölés), pásztázás utáni kattintást elnyeljük.
 */
export function PinchPan({ children, maxScale = 4 }: { children: ReactNode; maxScale?: number }) {
  const content = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef({
    active: false,
    startDist: 0,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    localX: 0,
    localY: 0,
    startMidX: 0,
    startMidY: 0,
    startPx: 0,
    startPy: 0,
  });
  const moved = useRef(false);
  const lastTap = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  const apply = (animate = false) => {
    const el = content.current;
    if (!el) return;
    const v = view.current;
    el.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
  };

  const clamp = (s: number) => Math.min(maxScale, Math.max(1, s));

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;

    const pts = Array.from(pointers.current.values());
    const rect = content.current?.parentElement?.getBoundingClientRect();
    const ox = rect?.left ?? 0;
    const oy = rect?.top ?? 0;
    const v = view.current;
    const g = gesture.current;

    // Pointer-capture csak tényleges gesztusnál — különben elvenné a natív lapgörgetést.
    const startsGesture = pts.length === 2 || (pts.length === 1 && v.scale > 1);
    if (startsGesture) (e.target as Element).setPointerCapture?.(e.pointerId);

    if (pts.length === 2) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const midX = (pts[0].x + pts[1].x) / 2 - ox;
      const midY = (pts[0].y + pts[1].y) / 2 - oy;
      g.active = true;
      g.startDist = Math.hypot(dx, dy) || 1;
      g.startScale = v.scale;
      g.startTx = v.tx;
      g.startTy = v.ty;
      g.startMidX = midX;
      g.startMidY = midY;
      g.localX = (midX - v.tx) / v.scale;
      g.localY = (midY - v.ty) / v.scale;
    } else if (pts.length === 1 && v.scale > 1) {
      g.active = true;
      g.startTx = v.tx;
      g.startTy = v.ty;
      g.startPx = pts[0].x;
      g.startPy = pts[0].y;
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g.active) return;

    const pts = Array.from(pointers.current.values());
    const v = view.current;
    const rect = content.current?.parentElement?.getBoundingClientRect();
    const ox = rect?.left ?? 0;
    const oy = rect?.top ?? 0;

    if (pts.length >= 2) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      const midX = (pts[0].x + pts[1].x) / 2 - ox;
      const midY = (pts[0].y + pts[1].y) / 2 - oy;
      const next = clamp(g.startScale * (dist / g.startDist));
      v.scale = next;
      v.tx = midX - next * g.localX;
      v.ty = midY - next * g.localY;
      moved.current = true;
      apply();
    } else if (pts.length === 1 && v.scale > 1) {
      const ddx = pts[0].x - g.startPx;
      const ddy = pts[0].y - g.startPy;
      if (Math.abs(ddx) + Math.abs(ddy) > 4) moved.current = true;
      v.tx = g.startTx + ddx;
      v.ty = g.startTy + ddy;
      apply();
    }
  };

  const reset = (animate = true) => {
    view.current = { scale: 1, tx: 0, ty: 0 };
    apply(animate);
    setZoomed(false);
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    (e.target as Element).releasePointerCapture?.(e.pointerId);

    // dupla koppintás → reset
    if (!moved.current && pointers.current.size === 0) {
      const now = Date.now();
      if (now - lastTap.current < 300 && view.current.scale > 1) {
        reset();
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
    }

    if (pointers.current.size < 2) gesture.current.active = false;
    if (pointers.current.size === 0) {
      const v = view.current;
      if (v.scale <= 1.01) {
        reset(false);
      } else {
        setZoomed(true);
      }
    }
  };

  // Pásztázás/zoom utáni szellem-kattintás elnyelése (ne jelöljön ki fogat).
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = false;
    }
  };

  return (
    <div className="relative">
      <div
        className="overflow-hidden"
        style={{ touchAction: zoomed ? 'none' : 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div ref={content} style={{ transformOrigin: '0 0', willChange: 'transform' }}>
          {children}
        </div>
      </div>
      {zoomed && (
        <button
          type="button"
          onClick={() => reset()}
          className="absolute top-1 right-1 z-10 rounded-full bg-white/90 dark:bg-gray-900/90 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-[11px] px-2.5 py-1 shadow-sm"
        >
          Nagyítás vissza
        </button>
      )}
    </div>
  );
}
