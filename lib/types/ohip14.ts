import { z } from 'zod';

/**
 * Az összes OHIP-14 timepoint, sorrendben. Ez az egyetlen forrás — a
 * validációk, UI-listák és az emlékeztető-logika mind ebből származnak.
 * T0 stádium-kapuzott (protetikai fázis előtt), T1–T5 az átadáshoz képest
 * relatív (ablakok: lib/ohip14-timepoint-stage.ts).
 */
export const OHIP14_TIMEPOINTS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const;

export type OHIP14Timepoint = (typeof OHIP14_TIMEPOINTS)[number];

export function isOhip14Timepoint(value: unknown): value is OHIP14Timepoint {
  return typeof value === 'string' && (OHIP14_TIMEPOINTS as readonly string[]).includes(value);
}

export type OHIP14ResponseValue = 0 | 1 | 2 | 3 | 4;

export const ohip14ResponseValueSchema = z.enum(['0', '1', '2', '3', '4']).transform((val) => parseInt(val) as OHIP14ResponseValue);

export const ohip14ResponseSchema = z.object({
  id: z.string().optional(),
  patientId: z.string().min(1, 'Beteg ID kötelező'),
  episodeId: z.string().optional().nullable(),
  timepoint: z.enum(OHIP14_TIMEPOINTS),
  stageCode: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  completedByPatient: z.boolean().default(true),
  q1_functional_limitation: z.number().int().min(0).max(4).nullable(),
  q2_functional_limitation: z.number().int().min(0).max(4).nullable(),
  q3_physical_pain: z.number().int().min(0).max(4).nullable(),
  q4_physical_pain: z.number().int().min(0).max(4).nullable(),
  q5_psychological_discomfort: z.number().int().min(0).max(4).nullable(),
  q6_psychological_discomfort: z.number().int().min(0).max(4).nullable(),
  q7_physical_disability: z.number().int().min(0).max(4).nullable(),
  q8_physical_disability: z.number().int().min(0).max(4).nullable(),
  q9_psychological_disability: z.number().int().min(0).max(4).nullable(),
  q10_psychological_disability: z.number().int().min(0).max(4).nullable(),
  q11_social_disability: z.number().int().min(0).max(4).nullable(),
  q12_social_disability: z.number().int().min(0).max(4).nullable(),
  q13_handicap: z.number().int().min(0).max(4).nullable(),
  q14_handicap: z.number().int().min(0).max(4).nullable(),
  totalScore: z.number().int().min(0).max(56).optional(),
  functionalLimitationScore: z.number().int().min(0).max(8).optional(),
  physicalPainScore: z.number().int().min(0).max(8).optional(),
  psychologicalDiscomfortScore: z.number().int().min(0).max(8).optional(),
  physicalDisabilityScore: z.number().int().min(0).max(8).optional(),
  psychologicalDisabilityScore: z.number().int().min(0).max(8).optional(),
  socialDisabilityScore: z.number().int().min(0).max(8).optional(),
  handicapScore: z.number().int().min(0).max(8).optional(),
  notes: z.string().optional().nullable(),
  lockedAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  updatedBy: z.string().optional().nullable(),
});

export type OHIP14Response = z.infer<typeof ohip14ResponseSchema>;

export interface OHIP14Question {
  id: string;
  question: string;
  dimension: string;
  dimensionHungarian: string;
  questionNumber: number;
}

export interface OHIP14Dimension {
  id: string;
  name: string;
  nameHungarian: string;
  questions: OHIP14Question[];
}

export const ohip14TimepointOptions: Array<{ value: OHIP14Timepoint; label: string; description: string }> = [
  { value: 'T0', label: 'T0', description: 'Protetikai fázis előtt' },
  { value: 'T1', label: 'T1', description: 'Közvetlenül átadás után' },
  { value: 'T2', label: 'T2', description: 'Átadás után ~1 hónap' },
  { value: 'T3', label: 'T3', description: 'Átadás után ~6 hónap' },
  { value: 'T4', label: 'T4', description: 'Átadás után ~1 év' },
  { value: 'T5', label: 'T5', description: 'Átadás után ~3 év' },
];

export const ohip14ResponseValueOptions: Array<{ value: OHIP14ResponseValue; label: string }> = [
  { value: 0, label: 'Soha' },
  { value: 1, label: 'Ritkán' },
  { value: 2, label: 'Néha' },
  { value: 3, label: 'Gyakran' },
  { value: 4, label: 'Mindig' },
];
