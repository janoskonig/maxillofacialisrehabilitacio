import { z } from 'zod';
import { clinicalDay } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalLayers, Position } from '@/lib/prosthesis-lifecycle/model';
import type { EpisodeFinancing } from '@/lib/episode-financing/model';

export const MAX_EPISODE_TREATMENT_PLAN_LENGTH = 20000;
export const PLAN_TREATMENT_LABELS:Record<string,string>={huzas:'Eltávolítás',implantacio:'Implantáció',korona:'Korona',tomes:'Tömés',gyokerkezeles:'Gyökérkezelés',hid_pillerkezeles:'Pillérkezelés',csiszolas:'Csiszolás',mufog:'Műfog',hezagfog:'Hídtest'};
export const episodePlanDetailsSchema=z.object({
  baselineStateId:z.string().uuid().nullable(),
  treatments:z.array(z.object({toothNumber:z.number().int().refine(n=>/^[1-4][1-8]$/.test(String(n))),treatmentCode:z.string().trim().min(1).max(100)})).max(200),
  approved:z.boolean(),occurredOn:clinicalDay,source:z.string().trim().min(1).max(500),requestKey:z.string().uuid(),
});
export type EpisodePlanDetails=z.infer<typeof episodePlanDetailsSchema>;

export interface JawTreatmentPlans {
  treatmentPlan?: string | null;
  treatmentPlanUpper?: string | null;
  treatmentPlanLower?: string | null;
}

export interface EpisodeTreatmentPlanRecord extends JawTreatmentPlans {
  episodeId: string;
  treatmentPlan: string | null;
  treatmentPlanUpper: string | null;
  treatmentPlanLower: string | null;
  version: number;
  patientId?:string;
  jaw?:'felso'|'also'|null;
  prosthesisId?:string|null;
  prosthesisLabel?:string|null;
  device?:{id:string;positions:Position[]}|null;
  unified?:boolean;
  financing?:EpisodeFinancing;
  documents?:Array<{id:string;filename:string}>;
  clinicalPlan?:{id:string;version:number;approved:boolean;baselineStateId:string|null;treatments:Array<{toothNumber:number;treatmentCode:string}>;occurredOn:string;source:string}|null;
  legacyClinicalDescription?:string|null;
  states?:Array<{id:string;occurred_on:string;note?:string;source?:string;layers?:ClinicalLayers}>;
  history?:Array<{id:string;version:number;approved:boolean;occurredOn:string;source:string;recordedAt:string;recorder:string;description:string;previousNarratives?:JawTreatmentPlans}>;
}

/** Keep unclassified old text; never infer its jaw or repeat an exact assigned copy. */
export function getUnassignedLegacyPlan(plan: JawTreatmentPlans): string | null {
  const legacy = plan.treatmentPlan?.trim();
  if (!legacy || legacy === plan.treatmentPlanUpper?.trim() || legacy === plan.treatmentPlanLower?.trim()) return null;
  return legacy;
}

export type PlanUpdate = (
  { mode: 'jaws'; treatmentPlanUpper: string | null; treatmentPlanLower: string | null; expectedVersion: number } |
  { mode: 'legacy'; treatmentPlan: string | null; expectedVersion: number }) & {clinical?:EpisodePlanDetails};

export function parseEpisodeTreatmentPlanUpdate(body: unknown): PlanUpdate | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Érvénytelen kérés.' };
  const fields = body as Record<string, unknown>;
  const expectedVersion = fields.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2147483647) {
    return { error: 'A kezelési terv változatszáma hiányzik vagy érvénytelen.' };
  }
  const has = (key: string) => Object.prototype.hasOwnProperty.call(fields, key);
  const valid = (value: unknown) => value === null || typeof value === 'string' && value.length <= MAX_EPISODE_TREATMENT_PLAN_LENGTH;
  const text = (value: unknown) => typeof value === 'string' ? value.trim() || null : null;
  const details=has('clinical')?episodePlanDetailsSchema.safeParse(fields.clinical):null;
  if (details&&!details.success) return {error:'A terv részletes adatai, dátuma vagy forrása érvénytelen.'};
  const clinical=details?.success?{clinical:details.data}:{};
  if (has('treatmentPlanUpper') || has('treatmentPlanLower')) {
    if (has('treatmentPlan') || !valid(fields.treatmentPlanUpper) || !valid(fields.treatmentPlanLower)) {
      return { error: `Külön felső és alsó terv szükséges (szöveg vagy null), legfeljebb ${MAX_EPISODE_TREATMENT_PLAN_LENGTH} karakter állcsontonként.` };
    }
    return { mode: 'jaws', treatmentPlanUpper: text(fields.treatmentPlanUpper), treatmentPlanLower: text(fields.treatmentPlanLower), expectedVersion,...clinical };
  }
  // Older clients may update the preserved common text, never the new jaw-specific fields.
  if (!valid(fields.treatmentPlan)) return { error: `A kezelési terv szöveg vagy null legyen, legfeljebb ${MAX_EPISODE_TREATMENT_PLAN_LENGTH} karakter.` };
  return { mode: 'legacy', treatmentPlan: text(fields.treatmentPlan), expectedVersion,...clinical };
}
