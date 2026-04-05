import { z } from 'zod';

const normPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const pathSchema = z.object({
  points: z.array(normPointSchema).min(2).max(8000),
  color: z.string().max(32),
  widthRel: z.number().min(0.0003).max(0.12),
});

/** Szabadkézi annotáció payload (v1) — koordináták [0,1] normalizáltak a képtérhez. */
export const freehandPayloadSchema = z.object({
  v: z.literal(1),
  paths: z.array(pathSchema).min(1).max(250),
});

/** Szöveges jelölés payload (v1). */
export const textPayloadSchema = z.object({
  v: z.literal(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1).optional(),
  h: z.number().min(0).max(1).optional(),
  text: z.string().min(1).max(2000),
  style: z.enum(['box', 'bubble']),
});

export const createAnnotationBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('freehand'), payload: freehandPayloadSchema }),
  z.object({ kind: z.literal('text'), payload: textPayloadSchema }),
]);

export type FreehandPayloadV1 = z.infer<typeof freehandPayloadSchema>;
export type TextPayloadV1 = z.infer<typeof textPayloadSchema>;
export type CreateAnnotationBody = z.infer<typeof createAnnotationBodySchema>;

const MAX_TOTAL_FREEHAND_POINTS = 30_000;

export function assertFreehandPointBudget(payload: FreehandPayloadV1): void {
  let total = 0;
  for (const p of payload.paths) {
    total += p.points.length;
  }
  if (total > MAX_TOTAL_FREEHAND_POINTS) {
    throw new Error(`Túl sok pont (max ${MAX_TOTAL_FREEHAND_POINTS})`);
  }
}

export function isImageMime(mime: string | null | undefined): boolean {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('image/');
}
