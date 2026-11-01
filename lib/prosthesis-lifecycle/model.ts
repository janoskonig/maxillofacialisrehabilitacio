import { z } from 'zod';
import { applyTreatmentOutcome } from '@/lib/tooth-treatment-outcome';

export const clinicalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s;
}, 'Érvénytelen klinikai dátum');
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(10000);
const map = z.record(z.unknown());
export const layersSchema = z.object({ teeth: map.default({}), implants: map.default({}), prostheses: map.default({}) });
export type ClinicalLayers = z.infer<typeof layersSchema>;
export const emptyLayers = (): ClinicalLayers => ({ teeth: {}, implants: {}, prostheses: {} });
export const positionsSchema = z.array(z.object({
  tooth: z.number().int().refine(n => /^[1-4][1-8]$/.test(String(n)), 'FDI fogszám szükséges'),
  role: z.enum(['abutment','pontic','denture_tooth','implant','clasp','attachment']),
})).max(32).refine(p => new Set(p.map(x => `${x.tooth}:${x.role}`)).size === p.length, 'Ismétlődő pozíció');
export type Position = z.infer<typeof positionsSchema>[number];
const meta = {
  requestKey: uuid, occurredOn: clinicalDay, occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
  precision: z.enum(['day','exact']).default('day'), source: text.max(500), note: z.string().trim().max(10000).default(''),
  supersedesId: uuid.optional(),
};
const device = {
  episodeId: uuid.nullable(), jaw: z.enum(['felso','also']), origin: z.enum(['local','external','unknown']),
  episodeMode:z.enum(['new','existing']).optional(),episodeReason:z.string().trim().max(10000).optional(),
  role: z.enum(['provisional','definitive','unknown']), label: text.max(160),
  prosthesisType: z.enum(['removable','fixed','combined_fixed_removable','screw_retained_implant_bridge','obturator','other']),
  specification: map.default({}), positions: positionsSchema.default([]),
};
const followup = z.object({ purpose: text.max(200), afterDays: z.number().int().min(1).max(3650) });
const activity = z.object({
  prosthesisId: uuid, phase: z.enum(['construction','aftercare','repair']),
  workPhaseId: uuid.optional(), repairCaseId: uuid.optional(),
  activity: text.max(1000), outcome: z.enum(['completed','unsuccessful','partial']),
  result: text.max(2000), followups: z.array(followup).max(10).default([]),
  completedTaskIds: z.array(uuid).max(20).default([]),
});
export const clinicalCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), ...meta, ...device }),
  z.object({ action: z.literal('review_mapping'), ...meta, ...device, prosthesisId: uuid }),
  z.object({ action: z.literal('set_goal'), ...meta, episodeId: uuid, prosthesisId: uuid, baselineStateId: uuid }),
  z.object({ action: z.literal('milestone'), ...meta, prosthesisId: uuid,
    milestone: z.enum(['lab_completed','accepted','delivered','in_use','retired']), followups: z.array(followup).max(10).default([]) }),
  z.object({ action: z.literal('status'), ...meta, episodeId: uuid.nullable(), prosthesisId: uuid.nullable().default(null),
    mode: z.enum(['assessment','change']), layers: layersSchema, expectedBefore: layersSchema.optional(),
    sourceEventId: uuid.optional(), legacySnapshotId: uuid.optional() }),
  z.object({ action: z.literal('plan'), ...meta, episodeId: uuid, baselineStateId: uuid.nullable().optional(),
    description: z.string().trim().max(60000).optional(), approved: z.boolean(), prosthesisIds: z.array(uuid).max(2).refine(ids=>new Set(ids).size===ids.length,'Ismétlődő fogpótlás').optional(),
    treatments: z.array(z.object({ toothNumber: z.number().int().refine(n => /^[1-4][1-8]$/.test(String(n))), treatmentCode: text.max(100) })).max(200).optional(),
    expectedVersion:z.number().int().min(0).optional(),
    narratives:z.object({treatmentPlan:z.string().max(20000).nullable().optional(),treatmentPlanUpper:z.string().max(20000).nullable().optional(),treatmentPlanLower:z.string().max(20000).nullable().optional()}).optional(),
  }),
  z.object({ action: z.literal('visit'), ...meta, appointmentId: uuid.nullable().default(null),
    clinician: text.max(200), clinicalMinutes: z.number().int().min(1).max(1440).nullable(),
    links: z.array(activity).min(1).max(20) }),
  z.object({ action: z.literal('repair'), ...meta, prosthesisId: uuid, baselineStateId: uuid,
    reason: text, plan: text, documentIds: z.array(uuid).max(50).default([]), laboratoryTasks: z.array(text.max(1000)).max(50).default([]) }),
  z.object({ action: z.literal('repair_result'), ...meta, repairCaseId: uuid, result: text,
    outcome: z.enum(['completed','remake']), }),
  z.object({ action: z.literal('remake'), ...meta, prosthesisId: uuid, repairCaseId: uuid.optional(), label: text.max(160), reason: text }),
  z.object({ action: z.literal('work'), ...meta, episodeId: uuid.nullable(), workPhaseId: uuid.optional(),
    label: text.max(200), scope: z.enum(['episode','prosthesis']), prosthesisIds: z.array(uuid).max(2).refine(ids=>new Set(ids).size===ids.length,'Ismétlődő fogpótlás'),
    repairCaseId: uuid.optional(), requiresPhaseIds: z.array(uuid).max(50).default([]), pathwayId: uuid.optional() }),
  z.object({ action: z.literal('book_task'), ...meta, taskId: uuid, appointmentId: uuid.nullable() }),
]).superRefine((c,ctx) => {
  const fail = (message: string) => ctx.addIssue({ code:'custom', message });
  if ((c.precision === 'exact') !== !!c.occurredAt) fail('Pontos időponthoz időbélyeg szükséges; nap pontosságnál hagyja üresen');
  if (c.occurredAt && new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Budapest' }).format(new Date(c.occurredAt)) !== c.occurredOn) fail('Az időpont és a klinikai nap eltér');
  if (c.action === 'work' && ((c.scope==='episode') !== (c.prosthesisIds.length===0))) fail('Epizódszintű munka vagy konkrét fogpótlás-hivatkozás szükséges');
  if (c.action === 'work' && !c.episodeId&&!c.repairCaseId) fail('Készítési epizód vagy önálló javítási ügy szükséges');
  if ((c.action==='register' || c.action==='review_mapping') && c.origin==='local' && !c.episodeId) fail('Helyben készített pótláshoz epizód szükséges');
  if (c.action==='status' && c.mode==='change' && !c.expectedBefore) fail('Változáshoz az előző értékek megerősítése szükséges');
  if (c.action==='status' && c.mode==='change' && !c.sourceEventId) fail('Változáshoz dokumentált eredmény forráseseménye szükséges');
  if (c.action==='visit' && new Set(c.links.map(l => `${l.prosthesisId}:${l.workPhaseId ?? l.activity}`)).size !== c.links.length) fail('Ismétlődő vizittevékenység');
  if (c.supersedesId && !['milestone','visit','status'].includes(c.action)) fail('Ehhez a művelethez új változat szükséges');
});
export type ClinicalCommand = z.infer<typeof clinicalCommandSchema>;

/** Stable JSON also makes retries insensitive to object key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value==='object') return `{${Object.keys(value).sort().filter(k => (value as Record<string,unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export interface StateEvidence {
  id: string; event_id: string; occurred_on: string; occurred_at: string | null; recorded_at: string;
  mode: 'assessment' | 'change'; layers: ClinicalLayers; expected_before: ClinicalLayers | null;
  supersedes_id?: string | null; note?: string; source?: string;
  recorded_by?: string; recorder?: string;
}
export function applyLayerPatch(before: ClinicalLayers, patch: ClinicalLayers): ClinicalLayers {
  const out = structuredClone(before);
  for (const layer of ['teeth','implants','prostheses'] as const) {
    for (const [key,value] of Object.entries(patch[layer] ?? {})) {
      if (value === null) delete out[layer][key]; else out[layer][key] = value;
    }
  }
  return out;
}
/** Replays clinical dates; later assessments remain authoritative. Unknown stays unknown. */
export function replayStates(states: StateEvidence[], untilId?: string) {
  let layers = emptyLayers();
  const conflicts: Array<{ stateId: string; layer: string; position: string; expected: unknown; actual: unknown }> = [];
  const milestones: Array<{ state: StateEvidence; layers: ClinicalLayers }> = [];
  const changes: StateEvidence[] = [];
  const instant=(s:string)=>new Date(s).getTime();
  const ordered = [...states].sort((a,b) => a.occurred_on.localeCompare(b.occurred_on)
    || (a.occurred_at&&b.occurred_at?instant(a.occurred_at)-instant(b.occurred_at):a.occurred_at?1:b.occurred_at?-1:0)
    || instant(a.recorded_at)-instant(b.recorded_at) || a.id.localeCompare(b.id));
  for (const state of ordered) {
    if (state.mode === 'assessment') {
      // A late entry must not silently contradict an already recorded examination.
      for (const change of changes.filter(c=>instant(c.recorded_at)>instant(state.recorded_at))) {
        for (const layer of ['teeth','implants','prostheses'] as const) for (const key of Object.keys(change.layers[layer])) {
          if (state.layers[layer][key]!==undefined && canonical(layers[layer][key])!==canonical(state.layers[layer][key]))
            conflicts.push({stateId:state.id,layer,position:key,expected:layers[layer][key],actual:state.layers[layer][key]});
        }
      }
      layers = structuredClone(state.layers);
      changes.length=0;
    }
    else {
      for (const layer of ['teeth','implants','prostheses'] as const) {
        for (const key of Object.keys(state.layers[layer])) {
          const expected = state.expected_before?.[layer]?.[key];
          if (canonical(layers[layer][key]) !== canonical(expected)) conflicts.push({ stateId: state.id, layer, position:key, expected, actual:layers[layer][key] });
        }
      }
      layers = applyLayerPatch(layers,state.layers);
      changes.push(state);
    }
    milestones.push({ state, layers:structuredClone(layers) });
    if (state.id===untilId) break;
  }
  return { layers, conflicts, milestones };
}
/** A prosthetic role never erases natural tooth loss. */
export function projectClinicalPlan(baseline: ClinicalLayers, treatments: Array<{ toothNumber: number; treatmentCode: string }>, devices: Array<{ id:string; positions:Position[];jaw?:'felso'|'also' }>): ClinicalLayers {
  const out = structuredClone(baseline);
  for (const t of treatments) {
    const key = String(t.toothNumber);
    if (t.treatmentCode==='implantacio') out.implants[key] = { present:true, planned:true };
    else if (t.treatmentCode==='mufog' || t.treatmentCode==='hezagfog') {
      // Explicitly planned artificial teeth occupy the prosthetic layer only.
      // Existing device-position roles remain authoritative; no jaw-only match.
      const candidates=devices.filter(d=>d.jaw?d.jaw===(t.toothNumber<30?'felso':'also'):devices.length===1);
      const device=candidates.length===1?candidates[0]:null;
      if(device&&!device.positions.some(p=>p.tooth===t.toothNumber)) {
        const role=t.treatmentCode==='mufog'?'denture_tooth':'pontic';
        out.prostheses[`${device.id}:${t.toothNumber}:${role}`]={prosthesisId:device.id,tooth:t.toothNumber,role,planned:true};
      }
    }
    else {
      const result = applyTreatmentOutcome(out.teeth[key],t.treatmentCode);
      if (result.changed) out.teeth[key] = result.next ?? { base:'sound' };
    }
  }
  for (const d of devices) for (const p of d.positions) {
    const key = `${d.id}:${p.tooth}:${p.role}`;
    out.prostheses[key] = { prosthesisId:d.id, tooth:p.tooth, role:p.role, planned:true };
  }
  return out;
}
