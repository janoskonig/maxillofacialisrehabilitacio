import { z } from 'zod';

export const PROSTHESIS_TYPES = {
  removable: 'Kivehető fogpótlás',
  fixed: 'Rögzített fogpótlás',
  combined_fixed_removable: 'Kombinált rögzített–kivehető fogpótlás',
  screw_retained_implant_bridge: 'Csavarozott implantációs híd',
  obturator: 'Obturátor',
  other: 'Egyéb',
} as const;
export const JAWS = { felso: 'Felső', also: 'Alsó' } as const;
export const PROBLEMS = {
  pain_pressure: 'Fájdalom / nyomási pont', retention_stability: 'Retenció / stabilitás',
  occlusion: 'Okklúzió', mechanical: 'Mechanikai probléma', other: 'Egyéb',
} as const;
export const INTERVENTIONS = {
  pressure_relief: 'Nyomási pont tehermentesítése', retention_adjustment: 'Retenció / stabilitás igazítása',
  occlusal_adjustment: 'Okklúziós korrekció', repair: 'Javítás', remake: 'Újrakészítés',
  advice: 'Tanácsadás / beavatkozás nélkül', other: 'Egyéb',
} as const;
export const RESULTS = { resolved: 'Megoldódott', improved: 'Javult', persists: 'Fennáll', uncertain: 'Bizonytalan' } as const;
export const NEXT_ACTIONS = {
  further_adjustment: 'További igazítás', routine_review: 'Rutin kontroll',
  laboratory: 'Laboratóriumi munka', other_followup: 'Egyéb követés',
} as const;
export const FOLLOWUP_STATUSES = {
  comfortable: 'Elérve, panaszmentes', ongoing_problem: 'Elérve, panasza fennáll',
  access_barrier: 'Nem jutott időponthoz', elsewhere: 'Máshol kap ellátást',
  stopped_attending: 'Nem kíván visszatérni', unknown: 'Nem elérhető / nem ismert',
} as const;
export const DELAY_REASONS = {
  none: 'Nincs jelzett késés', capacity: 'Időpont-kapacitás', laboratory: 'Laboratórium',
  clinical: 'Klinikai ok', patient: 'Beteghez kapcsolódó ok',
} as const;
export const CONSTRUCTION_ACTIVITIES = {
  impression: 'Lenyomat / szkennelés', trial: 'Próba', registration: 'Harapásregisztráció',
  adjustment: 'Igazítás', delivery: 'Átadás', other: 'Egyéb klinikai munka',
} as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Érvénytelen dátum');
const optionalNote = z.string().trim().max(1000).default('');
const minutes = z.number().int().min(1).max(1440).nullable().default(null);
const rating = z.number().int().min(0).max(10).nullable().default(null);
const unique = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(20).refine(
  (items) => new Set(items).size === items.length, 'Azonos választás csak egyszer adható meg',
);
export const prosthesisSchema = z.object({
  action: z.literal('register'), episodeId: z.string().uuid(), jaw: z.enum(['felso', 'also']),
  prosthesisType: z.enum(Object.keys(PROSTHESIS_TYPES) as [keyof typeof PROSTHESIS_TYPES, ...Array<keyof typeof PROSTHESIS_TYPES>]),
  label: z.string().trim().min(1).max(160),
});
export const deliverySchema = z.object({
  action: z.literal('deliver'), prosthesisId: z.string().uuid(), appointmentId: z.string().uuid(),
});
export const baselineAmendmentSchema = z.object({
  action: z.literal('amend_baseline'), prosthesisId: z.string().uuid(),
});
export const careLinkSchema = z.object({
  prosthesisId: z.string().uuid(),
  problems: unique(z.enum(['pain_pressure', 'retention_stability', 'occlusion', 'mechanical', 'other'])),
  interventions: unique(z.enum(['pressure_relief', 'retention_adjustment', 'occlusal_adjustment', 'repair', 'remake', 'advice', 'other'])),
  result: z.enum(['resolved', 'improved', 'persists', 'uncertain']).nullable(),
  nextAction: z.enum(['further_adjustment', 'routine_review', 'laboratory', 'other_followup']).nullable(),
  functionScore: rating, comfortScore: rating,
});
export const encounterSchema = z.object({
  action: z.literal('record_visit'), appointmentId: z.string().uuid(),
  expectedVersion: z.number().int().min(0).default(0),
  phase: z.enum(['construction', 'aftercare']), clinicalMinutes: minutes,
  constructionActivities: unique(z.enum(['impression', 'trial', 'registration', 'adjustment', 'delivery', 'other'])).default([]),
  planDeviation: optionalNote, delayReason: z.enum(['none', 'capacity', 'laboratory', 'clinical', 'patient']).default('none'),
  note: optionalNote, returnAfterDays: z.number().int().min(1).max(730).nullable().default(null),
  links: z.array(careLinkSchema).min(1).max(10),
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(v.links.map((l) => l.prosthesisId)).size !== v.links.length) fail('A fogpótlás csak egyszer kapcsolható');
  if (v.phase === 'construction' && !v.constructionActivities.length) fail('Legalább egy tevékenység szükséges');
  if (v.phase === 'aftercare' && v.constructionActivities.length) fail('Utógondozáshoz nem adható készítési tevékenység');
  for (const link of v.links) {
    if (v.phase === 'aftercare' && (!link.interventions.length || (link.problems.length && !link.result))) {
      fail('Jelölje az elvégzett munkát és panasz esetén az eredményt');
    }
    if (!link.problems.length && link.result) fail('Panasz nélküli kontrollhoz nem adható problémaeredmény');
    if (v.phase === 'aftercare' && !link.problems.length && link.interventions.some((i) => i !== 'advice')) {
      fail('Igazításhoz vagy javításhoz jelölje az értékelt problémát');
    }
  }
  if (v.phase === 'aftercare' && v.returnAfterDays && v.links.some((l) => !l.nextAction)) fail('Visszarendelésnél válassza ki a következő alkalom célját');
  if (!v.returnAfterDays && v.links.some((l) => l.nextAction === 'further_adjustment' || l.nextAction === 'laboratory' || l.nextAction === 'other_followup')) {
    fail('Kért új alkalomhoz adja meg a visszatérés idejét');
  }
});
export const followupSchema = z.object({
  action: z.literal('followup'), prosthesisId: z.string().uuid(), assessedOn: date,
  status: z.enum(['comfortable', 'ongoing_problem', 'access_barrier', 'elsewhere', 'stopped_attending', 'unknown']),
  contactMethod: z.enum(['in_person', 'phone', 'portal', 'record_review']),
  unresolved: z.boolean().nullable(), functionScore: rating, comfortScore: rating, note: optionalNote,
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if ((v.status === 'comfortable' && v.unresolved !== false) || (v.status === 'ongoing_problem' && v.unresolved !== true)) fail('A panaszállapot és az eredmény nem egyezik');
  if (v.status === 'unknown' && (v.unresolved !== null || v.functionScore !== null || v.comfortScore !== null)) fail('Ismeretlen követésből nem következtethető klinikai eredmény');
  if (['comfortable', 'ongoing_problem'].includes(v.status) && v.contactMethod === 'record_review') fail('A beteg elérését igénylő eredményhez közvetlen kapcsolat szükséges');
});
export const queueUpdateSchema = z.object({
  appointmentId: z.string().uuid().nullable(),
  delayReason: z.enum(['none', 'capacity', 'laboratory', 'clinical', 'patient']),
  expectedVersion: z.number().int().min(1),
});

export type CareLink = z.infer<typeof careLinkSchema>;
export type EncounterInput = z.infer<typeof encounterSchema>;
export interface Prosthesis {
  id: string; patientId: string; episodeId: string; jaw: keyof typeof JAWS;
  prosthesisType: keyof typeof PROSTHESIS_TYPES; label: string;
  deliveryDate: string | null; deliveryAppointmentId: string | null;
  deliveryConfirmed?: boolean | null;
  baseline: Record<string, unknown>; originalPlan: Record<string, unknown>; createdAt: string;
  followup?: Followup | null;
}
export interface Followup {
  assessedOn: string; status: keyof typeof FOLLOWUP_STATUSES; contactMethod: string;
  unresolved: boolean | null; functionScore: number | null; comfortScore: number | null;
}
export interface CareEncounter extends Omit<EncounterInput, 'action' | 'expectedVersion'> {
  id: string; version: number; occurredOn: string; occurredAt?: string; appointmentStatus: string | null;
  clinician: string; links: CareLink[];
}
export interface CareAppointment {
  id: string; episodeId: string | null; startTime: string; occurredOn: string;
  appointmentStatus: string | null; clinician: string;
}
export interface SchedulingRequest {
  id: string; patientId: string; patientName: string; episodeId: string;
  prosthesisLabels: string; source: 'delivery_review' | 'visit_return';
  prosthesisIds: string[];
  requestedOn: string; dueOn: string; intervalDays: number | null; nextAction: string;
  appointmentId: string | null; appointmentStart: string | null; appointmentStatus: string | null;
  delayReason: keyof typeof DELAY_REASONS; version: number;
  slotSecured: boolean; completed: boolean;
}
export interface AftercareWorkspace {
  patientName: string; deceased: boolean;
  episodes: Array<{ id: string; label: string; status: string }>;
  prostheses: Prosthesis[]; encounters: CareEncounter[]; appointments: CareAppointment[];
  requests: SchedulingRequest[];
}

/** Provisional window: [delivery, delivery + 3 calendar months), end-of-month clamped. */
export function observationEnd(deliveredOn: string): string {
  const [y, m, d] = deliveredOn.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 3, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 2, Math.min(d, last))).toISOString().slice(0, 10);
}
export function addDays(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function budapestToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date());
}
export function attended(status: string | null): boolean {
  // An unsuccessful clinical attempt still consumed an attended visit.
  return status === 'completed' || status === 'unsuccessful';
}
export function slotSecured(status: string | null, appointmentId: string | null): boolean {
  return !!appointmentId && (status === null || attended(status));
}
export function inObservationWindow(prosthesis: Prosthesis, visit: CareEncounter): boolean {
  return !!prosthesis.deliveryDate && prosthesis.deliveryConfirmed !== false && visit.phase === 'aftercare' && attended(visit.appointmentStatus)
    && visit.appointmentId !== prosthesis.deliveryAppointmentId
    && visit.occurredOn >= prosthesis.deliveryDate && visit.occurredOn < observationEnd(prosthesis.deliveryDate);
}
const adjustmentCodes = ['pressure_relief', 'retention_adjustment', 'occlusal_adjustment'];
export function prosthesisMetrics(prosthesis: Prosthesis, visits: CareEncounter[], asOf = budapestToday()) {
  const rows = visits.filter((v) => v.occurredOn <= asOf && inObservationWindow(prosthesis, v)
    && v.links.some((l) => l.prosthesisId === prosthesis.id)).sort((a, b) => (a.occurredAt ?? a.occurredOn).localeCompare(b.occurredAt ?? b.occurredOn) || a.id.localeCompare(b.id));
  const problemRows = rows.filter((v) => v.links.find((l) => l.prosthesisId === prosthesis.id)!.problems.length > 0);
  const seen = new Set<string>();
  let repeatedAdjustmentVisits = 0;
  for (const v of problemRows) {
    const adjustments = v.links.find((l) => l.prosthesisId === prosthesis.id)!.interventions.filter((i) => adjustmentCodes.includes(i));
    if (adjustments.some((i) => seen.has(i))) repeatedAdjustmentVisits++;
    adjustments.forEach((i) => seen.add(i));
  }
  const countIntervention = (code: string) => problemRows.filter((v) => v.links.find((l) => l.prosthesisId === prosthesis.id)!.interventions.some((i) => i === code)).length;
  // Resolve by problem category: a later routine or a resolved mechanical problem must
  // not erase an earlier unresolved pain assessment.
  const latest = new Map<string, string | null>();
  for (const v of problemRows) {
    const link = v.links.find((l) => l.prosthesisId === prosthesis.id)!;
    link.problems.forEach((p) => latest.set(p, link.result));
  }
  return {
    problemVisits: new Set(problemRows.map((v) => v.appointmentId)).size,
    routineVisits: new Set(rows.filter((v) => !problemRows.includes(v)).map((v) => v.appointmentId)).size,
    recordedClinicalMinutes: problemRows.reduce((n, v) => n + (v.clinicalMinutes ?? 0), 0),
    visitsWithRecordedMinutes: problemRows.filter((v) => v.clinicalMinutes !== null).length,
    // Duration belongs to the appointment and is NOT additive across prostheses.
    repeatedAdjustmentVisits, repairs: countIntervention('repair'), remakes: countIntervention('remake'),
    unresolvedProblemCategories: Array.from(latest).filter(([, r]) => r !== 'resolved').map(([p]) => p),
    observationComplete: !!prosthesis.deliveryDate && observationEnd(prosthesis.deliveryDate) <= asOf,
    followupRecorded: !!prosthesis.followup && prosthesis.followup.assessedOn <= asOf,
  };
}
export function patientBurden(prostheses: Prosthesis[], visits: CareEncounter[], asOf = budapestToday()) {
  const rows = visits.filter((v) => v.occurredOn <= asOf && prostheses.some((p) => inObservationWindow(p, v)
    && v.links.some((l) => l.prosthesisId === p.id && l.problems.length)));
  const uniqueVisits = Array.from(new Map(rows.map((v) => [v.appointmentId, v])).values());
  return {
    problemVisits: uniqueVisits.length,
    recordedClinicalMinutes: uniqueVisits.reduce((n, v) => n + (v.clinicalMinutes ?? 0), 0),
    visitsWithRecordedMinutes: uniqueVisits.filter((v) => v.clinicalMinutes !== null).length,
  };
}

export function completeness(prosthesis: Prosthesis, visits: CareEncounter[], asOf = budapestToday()) {
  const due: string[] = [];
  const future: string[] = [];
  const b = prosthesis.baseline;
  if (b.nem == null || b.ageBandStart == null) due.push('Kiindulási betegjellemzők');
  if (b.maxilladefektus_van == null || b.mandibuladefektus_van == null) due.push('Kiindulási defektusjellemzők');
  if (b.maxilladefektus_van === true && (!b.brown_fuggoleges_osztaly || !b.brown_vizszintes_komponens)) due.push('Maxilladefektus osztályozása');
  if (b.mandibuladefektus_van === true && !b.kovacs_dobak_osztaly) due.push('Mandibuladefektus osztályozása');
  const baselineDue = due.slice();
  if (prosthesis.deliveryDate && prosthesis.deliveryConfirmed === false) due.push('Az átadási időpont teljesülésének ellenőrzése');
  if (!prosthesis.deliveryDate) future.push('Átadási időpont és háromhavi követés');
  else if (observationEnd(prosthesis.deliveryDate) > asOf) future.push(`Háromhavi követés: ${observationEnd(prosthesis.deliveryDate)}`);
  else if (!prosthesis.followup || prosthesis.followup.assessedOn > asOf) due.push('Háromhavi követés állapota');
  const linked = new Set(visits.filter((v) => v.links.some((l) => l.prosthesisId === prosthesis.id)).map((v) => v.appointmentId));
  return { due, baselineDue, future, linkedAppointments: Array.from(linked) };
}
