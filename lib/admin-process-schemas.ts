/**
 * Zod schemas for admin process configuration (care pathways, stage catalog, treatment types).
 * Used by API routes for validation. Enforces invariants to prevent adatdrift.
 */

import { z } from 'zod';

const STEP_CODE_REGEX = /^[a-z0-9_]+$/;
const POOL_VALUES = ['consult', 'work', 'control'] as const;

/** Canonicalize step_code: trim, lowercase, spaces→underscore */
export function canonicalizeStepCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Slugify a Hungarian label into a step_code-safe string */
export function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Pathway step schema — used in steps_json. label is the user-facing name; step_code is auto-generated. */
export const pathwayStepSchema = z.object({
  label: z.string().min(1, 'Lépés neve kötelező').max(255),
  step_code: z.string().optional(),
  pool: z.enum(POOL_VALUES),
  duration_minutes: z.number().int().min(5, 'duration_minutes minimum 5'),
  default_days_offset: z.number().int().min(0).nullable().optional(),
  requires_precommit: z.boolean().optional().default(false),
  optional: z.boolean().optional(),
});

export type PathwayStepInput = z.infer<typeof pathwayStepSchema>;

/**
 * steps_json array with auto-generated step_codes from labels.
 * step_code = slugify(label) + "_" + arrayIndex — guaranteed unique.
 */
export const stepsJsonSchema = z
  .array(pathwayStepSchema)
  .transform((steps) =>
    steps.map((s, idx) => ({
      ...s,
      step_code: `${slugifyLabel(s.label)}_${idx}`,
    }))
  );

const REASON_VALUES = [
  'traumás sérülés',
  'veleszületett rendellenesség',
  'onkológiai kezelés utáni állapot',
] as const;

const carePathwayBaseSchema = z.object({
  name: z.string().min(1, 'Név kötelező').max(100),
  reason: z.enum(REASON_VALUES).nullable().optional(),
  treatmentTypeId: z.string().uuid().nullable().optional(),
  stepsJson: stepsJsonSchema,
  version: z.number().int().optional(),
  priority: z.number().int().optional().default(0),
  ownerId: z.string().uuid().nullable().optional(),
  auditReason: z.string().min(1, 'auditReason kötelező'),
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** Care pathway create body */
export const carePathwayCreateSchema = carePathwayBaseSchema.refine(
  (data) => {
    const hasReason = (data.reason ?? '') !== '';
    const hasTreatmentType = (data.treatmentTypeId ?? '') !== '';
    return (hasReason && !hasTreatmentType) || (!hasReason && hasTreatmentType);
  },
  { message: 'Pontosan az egyik: reason vagy treatmentTypeId kötelező (XOR)' }
);

/** Care pathway patch body */
export const carePathwayPatchSchema = carePathwayBaseSchema
  .omit({ auditReason: true })
  .partial()
  .extend({
    auditReason: z.string().min(1, 'auditReason kötelező'),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.reason !== undefined && data.treatmentTypeId !== undefined) return false;
      return true;
    },
    { message: 'reason és treatmentTypeId nem módosítható egyszerre' }
  );

/** Stage catalog create */
export const stageCatalogCreateSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_]+$/, 'code csak betű, szám, _'),
  reason: z.enum(REASON_VALUES),
  labelHu: z.string().min(1, 'labelHu kötelező').max(255),
  orderIndex: z.number().int().min(0),
  isTerminal: z.boolean().optional().default(false),
  defaultDurationDays: z.number().int().min(0).nullable().optional(),
  auditReason: z.string().min(1, 'auditReason kötelező'),
});

/** Stage catalog patch — whitelist: code és reason immutable */
export const stageCatalogPatchSchema = z.object({
  labelHu: z.string().min(1).max(255).optional(),
  orderIndex: z.number().int().min(0).optional(),
  isTerminal: z.boolean().optional(),
  defaultDurationDays: z.number().int().min(0).nullable().optional(),
  auditReason: z.string().min(1, 'auditReason kötelező'),
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** Treatment type create */
export const treatmentTypeCreateSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'code csak a-z, 0-9, _'),
  labelHu: z.string().min(1, 'labelHu kötelező').max(255),
  auditReason: z.string().min(1, 'auditReason kötelező'),
});

/** Treatment type patch — code immutable */
export const treatmentTypePatchSchema = z.object({
  labelHu: z.string().min(1, 'labelHu kötelező').max(255),
  auditReason: z.string().min(1, 'auditReason kötelező'),
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** Step catalog patch — labelHu, labelEn, isActive */
export const stepCatalogPatchSchema = z.object({
  labelHu: z.string().min(1).max(255).optional(),
  labelEn: z.string().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Step catalog batch item — upsert (INSERT or UPDATE) */
export const stepCatalogBatchItemSchema = z.object({
  stepCode: z
    .string()
    .min(1, 'step_code kötelező')
    .transform(canonicalizeStepCode)
    .refine((v) => STEP_CODE_REGEX.test(v), 'step_code csak a-z, 0-9, _ lehet'),
  labelHu: z.string().min(1, 'label_hu kötelező').max(255),
  labelEn: z.string().max(255).nullable().optional().default(null),
  isActive: z.boolean().optional().default(true),
});

export type StepCatalogBatchItem = z.infer<typeof stepCatalogBatchItemSchema>;

/** Step catalog batch body */
export const stepCatalogBatchSchema = z.object({
  items: z.array(stepCatalogBatchItemSchema).min(1, 'Legalább egy elem szükséges'),
});
