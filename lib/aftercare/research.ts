import { anonymizedSubjectKey } from '@/lib/research-registry/research-patient-view';
import { attended, observationEnd, patientBurden, prosthesisMetrics, type AftercareWorkspace } from './model';

export const WORKLOAD_DATASET_VERSION = 'prosthesis-workload-1.0';
export const WORKLOAD_DEFINITIONS = {
  observationWindow: '[delivery local date, delivery + 3 calendar months), end-of-month clamped; Europe/Budapest',
  mainOutcome: 'Distinct attended appointments assessing/managing a prosthesis problem within its own window',
  attendance: 'completed or unsuccessful; cancelled, no-show and pending excluded',
  duration: 'Measured clinical minutes per appointment, shared across prostheses; missing is null',
  repeatedAdjustmentVisits: 'Visits repeating any previously recorded adjustment category for the same prosthesis within its window',
  scores: 'Patient-reported 0–10 function and comfort, higher is better; separate exploratory items, no combined score',
  ascertainment: 'Three-month follow-up recorded at/after the window end; assessedOn offset identifies late ascertainment',
  baseline: 'Snapshot at prosthesis registration; retrospective flags mark registration after delivery',
  counts: 'Prosthesis counts and minutes are not additive across prostheses; subject row deduplicates attendance',
  censoring: 'An incomplete window or absent follow-up is not interpreted as zero burden or comfort',
};
export function researchKey(id: string, entity: string) {
  return Buffer.from(anonymizedSubjectKey(id, `${process.env.RESEARCH_PSEUDONYM_SALT || process.env.JWT_SECRET || ''}:workload:${entity}`), 'hex').toString('base64url');
}
function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

/** Explicit projection: no notes, names, emails, raw IDs or exact clinical dates. */
export function buildWorkloadResearchRows(patientId: string, data: AftercareWorkspace, asOf: string): Record<string, unknown>[] {
  const subjectKey = researchKey(patientId, 'patient');
  const rows: Record<string, unknown>[] = [];
  rows.push({ recordKey: `subject:${subjectKey}`, recordType: 'subject', subjectKey,
    ...patientBurden(data.prostheses, data.encounters, asOf) });
  for (const p of data.prostheses) {
    const prosthesisKey = researchKey(p.id, 'prosthesis');
    const metrics = prosthesisMetrics(p, data.encounters, asOf);
    const b = p.baseline;
    const construction = data.encounters.filter((v) => v.phase === 'construction' && v.occurredOn <= asOf && attended(v.appointmentStatus)
      && v.links.some((l) => l.prosthesisId === p.id));
    rows.push({ recordKey: `prosthesis:${prosthesisKey}`, recordType: 'prosthesis', subjectKey, prosthesisKey,
      episodeKey: researchKey(p.episodeId, 'episode'), jaw: p.jaw, prosthesisType: p.prosthesisType,
      delivered: p.deliveryDate !== null, deliveryConfirmed: p.deliveryDate ? p.deliveryConfirmed !== false : null,
      daysObserved: p.deliveryDate ? Math.max(0, daysBetween(p.deliveryDate, asOf < observationEnd(p.deliveryDate) ? asOf : observationEnd(p.deliveryDate))) : null,
      ...metrics,
      // A zero observed count before delivery must not masquerade as an outcome.
      problemVisits: p.deliveryDate && p.deliveryConfirmed !== false ? metrics.problemVisits : null,
      routineVisits: p.deliveryDate && p.deliveryConfirmed !== false ? metrics.routineVisits : null,
      baseline: {
        sex: b.nem ?? null, ageBandStart: b.ageBandStart ?? null, reason: b.kezelesre_erkezes_indoka ?? null,
        radiotherapy: b.radioterapia ?? null, upperDefect: b.maxilladefektus_van ?? null, lowerDefect: b.mandibuladefektus_van ?? null,
        brownVertical: b.brown_fuggoleges_osztaly ?? null, brownHorizontal: b.brown_vizszintes_komponens ?? null,
        kovacsDobak: b.kovacs_dobak_osztaly ?? null, upperDefectRegions: b.maxilla_defektus_raszter ?? null,
        lowerDefectRegions: b.mandibula_defektus_raszter ?? null, retrospective: b.retrospective === true, amended: b.amended === true,
      },
      originalPlannedVisits: Array.isArray(p.originalPlan.workPhases)
        ? new Set(p.originalPlan.workPhases.map((w: Record<string, unknown>) => w.visit_id || w.id)).size : null,
      constructionVisits: construction.length,
      constructionMinutes: construction.reduce((n, v) => n + (v.clinicalMinutes ?? 0), 0),
      constructionVisitsWithMinutes: construction.filter((v) => v.clinicalMinutes !== null).length,
      constructionDeviations: construction.filter((v) => !!v.planDeviation).length,
      followup: p.followup && p.followup.assessedOn <= asOf ? { status: p.followup.status, contactMethod: p.followup.contactMethod,
        assessedDaysAfterDelivery: p.deliveryDate ? daysBetween(p.deliveryDate, p.followup.assessedOn) : null,
        unresolved: p.followup.unresolved, functionScore: p.followup.functionScore, comfortScore: p.followup.comfortScore } : null,
    });
  }
  for (const v of data.encounters.filter((v) => v.occurredOn <= asOf)) {
    const encounterKey = researchKey(v.appointmentId, 'appointment');
    rows.push({ recordKey: `visit:${encounterKey}`, recordType: 'visit', subjectKey, encounterKey,
      phase: v.phase, attended: attended(v.appointmentStatus), appointmentStatus: v.appointmentStatus,
      clinicianKey: researchKey(v.clinician, 'clinician'), clinicalMinutes: v.clinicalMinutes,
      constructionActivities: v.constructionActivities, planDeviationRecorded: !!v.planDeviation, delayReason: v.delayReason,
      returnAfterDays: v.returnAfterDays, revision: v.version,
      prostheses: v.links.map((l) => {
        const p = data.prostheses.find((p) => p.id === l.prosthesisId)!;
        return { prosthesisKey: researchKey(l.prosthesisId, 'prosthesis'),
          daysAfterDelivery: p.deliveryDate ? daysBetween(p.deliveryDate, v.occurredOn) : null,
          problems: l.problems, interventions: l.interventions, result: l.result, nextAction: l.nextAction,
          functionScore: l.functionScore, comfortScore: l.comfortScore };
      }),
    });
  }
  for (const r of data.requests) {
    rows.push({ recordKey: `request:${researchKey(r.id, 'request')}`, recordType: 'scheduling_request', subjectKey,
      source: r.source, requestedIntervalDays: r.intervalDays, nextAction: r.nextAction, slotSecured: r.slotSecured,
      completed: r.completed, delayReason: r.delayReason,
      daysFromDueToSlot: r.appointmentStart ? daysBetween(r.dueOn, new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest' }).format(new Date(r.appointmentStart))) : null,
    });
  }
  return rows;
}
