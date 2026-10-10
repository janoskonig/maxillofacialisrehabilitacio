export const MAX_EPISODE_TREATMENT_PLAN_LENGTH = 20000;

export interface EpisodeTreatmentPlanRecord {
  episodeId: string;
  treatmentPlan: string | null;
  version: number;
}

export function parseEpisodeTreatmentPlanUpdate(body: unknown):
  { treatmentPlan: string | null; expectedVersion: number } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Érvénytelen kérés.' };
  const { treatmentPlan, expectedVersion } = body as Record<string, unknown>;
  if (treatmentPlan !== null && typeof treatmentPlan !== 'string') {
    return { error: 'A kezelési terv szöveg vagy null legyen.' };
  }
  if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2147483647) {
    return { error: 'A kezelési terv változatszáma hiányzik vagy érvénytelen.' };
  }
  if (typeof treatmentPlan === 'string' && treatmentPlan.length > MAX_EPISODE_TREATMENT_PLAN_LENGTH) {
    return { error: `A kezelési terv legfeljebb ${MAX_EPISODE_TREATMENT_PLAN_LENGTH} karakter lehet.` };
  }
  return { treatmentPlan: typeof treatmentPlan === 'string' ? treatmentPlan.trim() || null : null, expectedVersion };
}
