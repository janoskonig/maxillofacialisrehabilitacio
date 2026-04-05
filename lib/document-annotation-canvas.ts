import type { PatientDocumentAnnotation } from '@/lib/types/document-annotation';

export type NormPoint = { x: number; y: number };

export type StrokePath = { points: NormPoint[]; color: string; widthRel: number };

export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function normalizeStrokePoints(points: { x: unknown; y: unknown }[]): NormPoint[] {
  const out: NormPoint[] = [];
  for (const pt of points) {
    const x = Number(pt.x);
    const y = Number(pt.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.push({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    }
  }
  return out;
}

/** Normalizált [0,1] koordináta → pixel a megjelenített dobozban (object-contain / object-cover). */
export function normToPixel(
  nx: number,
  ny: number,
  cw: number,
  ch: number,
  nw: number,
  nh: number,
  objectFit: 'contain' | 'cover',
): { x: number; y: number } {
  const scale =
    objectFit === 'cover' ? Math.max(cw / nw, ch / nh) : Math.min(cw / nw, ch / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  return { x: nx * dw + ox, y: ny * dh + oy };
}

/** object-contain mint a nagy nézőben: visszaadja az ox,oy,dw,dh-et a kép elem belsejében. */
export function layoutForObjectContain(img: HTMLImageElement): {
  ox: number;
  oy: number;
  dw: number;
  dh: number;
} | null {
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

export function freehandPathsFromAnnotation(
  ann: PatientDocumentAnnotation,
  minPaths = true,
): StrokePath[] {
  if (ann.kind !== 'freehand') return [];
  const raw = ann.payload as Record<string, unknown>;
  if (Number(raw.v) !== 1 || !Array.isArray(raw.paths)) return [];
  const hue = hueFromString(ann.createdBy);
  const out: StrokePath[] = [];
  for (const path of raw.paths as { points?: unknown; color?: unknown; widthRel?: unknown }[]) {
    if (!path || !Array.isArray(path.points)) continue;
    const pts = normalizeStrokePoints(path.points as { x: unknown; y: unknown }[]);
    if (minPaths && pts.length < 2) continue;
    const color =
      typeof path.color === 'string' && path.color.length > 0
        ? path.color
        : `hsl(${hue}, 85%, 52%)`;
    const widthRel = Number(path.widthRel);
    out.push({
      points: pts,
      color,
      widthRel: Number.isFinite(widthRel) && widthRel > 0 ? widthRel : 0.008,
    });
  }
  return out;
}

export function drawStrokePathsNorm(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  nw: number,
  nh: number,
  objectFit: 'contain' | 'cover',
  paths: StrokePath[],
  minStrokePx: number,
  alpha = 1,
): void {
  if (paths.length === 0 || cw < 2 || ch < 2) return;
  ctx.globalAlpha = alpha;
  for (const path of paths) {
    if (path.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = path.color;
    const wr = Number.isFinite(path.widthRel) && path.widthRel > 0 ? path.widthRel : 0.008;
    const scale =
      objectFit === 'cover' ? Math.max(cw / nw, ch / nh) : Math.min(cw / nw, ch / nh);
    const approx = wr * Math.min(nw * scale, nh * scale);
    ctx.lineWidth = Math.max(minStrokePx, approx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const p0 = normToPixel(path.points[0].x, path.points[0].y, cw, ch, nw, nh, objectFit);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < path.points.length; i++) {
      const p = normToPixel(path.points[i].x, path.points[i].y, cw, ch, nw, nh, objectFit);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function drawFreehandAnnotationsFiltered(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  nw: number,
  nh: number,
  objectFit: 'contain' | 'cover',
  annotations: PatientDocumentAnnotation[],
  options: {
    hiddenIds: Set<string>;
    selectedId?: string | null;
    minStrokePx: number;
  },
): void {
  for (const ann of annotations) {
    if (options.hiddenIds.has(ann.id)) continue;
    if (ann.kind !== 'freehand') continue;
    const paths = freehandPathsFromAnnotation(ann);
    if (paths.length === 0) continue;
    const highlight = options.selectedId === ann.id;
    drawStrokePathsNorm(ctx, cw, ch, nw, nh, objectFit, paths, options.minStrokePx, highlight ? 1 : 0.95);
    if (highlight && paths[0]?.points[0]) {
      const p = normToPixel(
        paths[0].points[0].x,
        paths[0].points[0].y,
        cw,
        ch,
        nw,
        nh,
        objectFit,
      );
      ctx.beginPath();
      ctx.fillStyle = `hsl(${hueFromString(ann.createdBy)}, 85%, 45%)`;
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
