export const MAX_EPISODE_TREATMENT_PLAN_LENGTH = 20000;

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
}

/** Keep unclassified old text; never infer its jaw or repeat an exact assigned copy. */
export function getUnassignedLegacyPlan(plan: JawTreatmentPlans): string | null {
  const legacy = plan.treatmentPlan?.trim();
  if (!legacy || legacy === plan.treatmentPlanUpper?.trim() || legacy === plan.treatmentPlanLower?.trim()) return null;
  return legacy;
}

type PlanUpdate =
  { mode: 'jaws'; treatmentPlanUpper: string | null; treatmentPlanLower: string | null; expectedVersion: number } |
  { mode: 'legacy'; treatmentPlan: string | null; expectedVersion: number };

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
  if (has('treatmentPlanUpper') || has('treatmentPlanLower')) {
    if (has('treatmentPlan') || !valid(fields.treatmentPlanUpper) || !valid(fields.treatmentPlanLower)) {
      return { error: `Külön felső és alsó terv szükséges (szöveg vagy null), legfeljebb ${MAX_EPISODE_TREATMENT_PLAN_LENGTH} karakter állcsontonként.` };
    }
    return { mode: 'jaws', treatmentPlanUpper: text(fields.treatmentPlanUpper), treatmentPlanLower: text(fields.treatmentPlanLower), expectedVersion };
  }
  // Older clients may update the preserved common text, never the new jaw-specific fields.
  if (!valid(fields.treatmentPlan)) return { error: `A kezelési terv szöveg vagy null legyen, legfeljebb ${MAX_EPISODE_TREATMENT_PLAN_LENGTH} karakter.` };
  return { mode: 'legacy', treatmentPlan: text(fields.treatmentPlan), expectedVersion };
}
