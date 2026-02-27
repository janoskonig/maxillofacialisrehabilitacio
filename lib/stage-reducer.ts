/**
 * Stage reducer: computes stage suggestion based on snapshot + PUBLISHED ruleset.
 * Core of the FSM / SSOT system. Never changes stage directly — produces suggestions only.
 */

import { getDbPool } from './db';
import { createHash } from 'crypto';
import type { StageTransitionRule } from './types';

export interface EpisodeSnapshot {
  episodeId: string;
  patientId: string;
  reason: string;
  currentStage: string;
  stageVersion: number;
  snapshotVersion: number;
  hasCompletedConsult: boolean;
  hasTreatmentPlan: boolean;
  hasOffer: boolean;
  offerAccepted: boolean;
  hasSurgicalAppointmentCompleted: boolean;
  hasProstheticAppointmentStarted: boolean;
  noSurgicalPhase: boolean;
  hasDeliveryCompleted: boolean;
  deliveryOlderThan30Days: boolean;
  treatmentTypeId: string | null;
  carePathwayId: string | null;
}

export interface ReducerResult {
  suggestedStage: string | null;
  fromStage: string;
  matchedRuleIds: string[];
  rulesetVersion: number;
  snapshotVersion: number;
  dedupeKey: string;
}

function computeDedupeKey(
  episodeId: string,
  rulesetVersion: number,
  fromStage: string,
  suggestedStage: string,
  conditionInputsMin: string
): string {
  const raw = `${episodeId}:${rulesetVersion}:${fromStage}:${suggestedStage}:${conditionInputsMin}`;
  return createHash('sha256').update(raw).digest('hex').substring(0, 64);
}

async function getPublishedRuleset(pool: ReturnType<typeof getDbPool>): Promise<{
  version: number;
  rules: StageTransitionRule[];
} | null> {
  const r = await pool.query(
    `SELECT version, rules FROM stage_transition_rulesets WHERE status = 'PUBLISHED' LIMIT 1`
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    version: row.version,
    rules: (row.rules || []) as StageTransitionRule[],
  };
}

function evaluateCondition(condition: string, snapshot: EpisodeSnapshot): boolean {
  switch (condition) {
    case 'has_completed_appointment_consult':
      return snapshot.hasCompletedConsult;
    case 'has_treatment_plan':
      return snapshot.hasTreatmentPlan;
    case 'has_offer':
      return snapshot.hasOffer;
    case 'offer_accepted':
      return snapshot.offerAccepted;
    case 'has_surgical_appointment_completed':
      return snapshot.hasSurgicalAppointmentCompleted;
    case 'has_prosthetic_appointment_started':
      return snapshot.hasProstheticAppointmentStarted;
    case 'no_surgical_phase':
      return snapshot.noSurgicalPhase;
    case 'has_delivery_completed':
      return snapshot.hasDeliveryCompleted;
    case 'delivery_older_than_30_days':
      return snapshot.deliveryOlderThan30Days;
    default:
      return false;
  }
}

export async function buildSnapshot(episodeId: string): Promise<EpisodeSnapshot | null> {
  const pool = getDbPool();

  const epRow = await pool.query(
    `SELECT pe.id, pe.patient_id, pe.reason, pe.status,
       pe.stage_version, pe.snapshot_version,
       pe.treatment_type_id, pe.care_pathway_id
     FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );
  if (epRow.rows.length === 0) return null;
  const ep = epRow.rows[0];

  if (ep.status !== 'open') return null;

  const stageRow = await pool.query(
    `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
    [episodeId]
  );
  const currentStage = stageRow.rows[0]?.stage_code ?? 'STAGE_0';

  // pool='consult' for first consult, pool='work' for work phase, pool='control' for control
  // appointment_type: 'elso_konzultacio', 'munkafazis', 'kontroll' (or NULL)
  // step_code patterns: *_atadas for delivery steps, *_implant_* for surgical
  const [appointmentStats, milestoneStats] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(bool_or(
           (a.pool = 'consult' OR a.appointment_type = 'elso_konzultacio')
           AND a.appointment_status = 'completed'
         ), false) as has_consult,
         COALESCE(bool_or(
           a.appointment_status = 'completed'
           AND a.pool = 'work'
         ), false) as has_prosthetic,
         MAX(a.start_time) FILTER (WHERE a.appointment_status = 'completed') as last_completed_at
       FROM appointments a WHERE a.episode_id = $1`,
      [episodeId]
    ).catch(() => ({
      rows: [{ has_consult: false, has_prosthetic: false, last_completed_at: null }],
    })),
    pool.query(
      `SELECT code FROM patient_milestones WHERE episode_id = $1
       AND code IN ('DELIVERY_DONE', 'OFFER_ACCEPTED', 'NO_SURGICAL_PHASE', 'SURG_IMPLANT_PLACED')`,
      [episodeId]
    ).catch(() => ({ rows: [] as Array<{ code: string }> })),
  ]);

  const stats = appointmentStats.rows[0] ?? {};
  const milestones = new Set((milestoneStats.rows as Array<{ code: string }>).map((r) => r.code));

  const deliveryDone = milestones.has('DELIVERY_DONE');
  const hasSurgery = milestones.has('SURG_IMPLANT_PLACED');

  // Check for delivery via completed appointment with step_code ending in _atadas
  // Also check episode_steps for completed delivery steps as fallback
  let deliveryDate: Date | null = null;
  if (!deliveryDone) {
    try {
      const deliveryAppRow = await pool.query(
        `SELECT a.start_time FROM appointments a
         JOIN slot_intents si ON si.id = a.slot_intent_id
         WHERE a.episode_id = $1 AND a.appointment_status = 'completed'
           AND si.step_code LIKE '%_atadas'
         ORDER BY a.start_time DESC LIMIT 1`,
        [episodeId]
      );
      if (deliveryAppRow.rows.length > 0) {
        deliveryDate = new Date(deliveryAppRow.rows[0].start_time);
      }
    } catch {
      // slot_intents might not have slot_intent_id FK — graceful fallback
    }
  }

  const actualDeliveryDone = deliveryDone || deliveryDate != null;
  const deliveryOlderThan30Days = actualDeliveryDone && deliveryDate
    ? (Date.now() - deliveryDate.getTime()) > 30 * 24 * 60 * 60 * 1000
    : deliveryDone; // If milestone exists, assume old enough

  const hasTreatmentPlan = !!(ep.treatment_type_id || ep.care_pathway_id);

  // tags is JSONB array, use @> with JSONB containment
  const offerRow = await pool.query(
    `SELECT 1 FROM patient_documents WHERE patient_id = $1
     AND tags @> '"offer"'::jsonb LIMIT 1`,
    [ep.patient_id]
  ).catch(() => ({ rows: [] }));
  const hasOffer = offerRow.rows.length > 0;

  const offerAccepted = milestones.has('OFFER_ACCEPTED');
  const noSurgicalPhaseFlag = milestones.has('NO_SURGICAL_PHASE');

  return {
    episodeId,
    patientId: ep.patient_id,
    reason: ep.reason,
    currentStage,
    stageVersion: ep.stage_version ?? 0,
    snapshotVersion: ep.snapshot_version ?? 0,
    hasCompletedConsult: stats.has_consult ?? false,
    hasTreatmentPlan,
    hasOffer,
    offerAccepted,
    hasSurgicalAppointmentCompleted: hasSurgery,
    hasProstheticAppointmentStarted: stats.has_prosthetic ?? false,
    noSurgicalPhase: noSurgicalPhaseFlag,
    hasDeliveryCompleted: actualDeliveryDone,
    deliveryOlderThan30Days,
    treatmentTypeId: ep.treatment_type_id,
    carePathwayId: ep.care_pathway_id,
  };
}

export async function reduce(snapshot: EpisodeSnapshot): Promise<ReducerResult | null> {
  const pool = getDbPool();
  const ruleset = await getPublishedRuleset(pool);
  if (!ruleset) return null;

  const applicableRules = ruleset.rules.filter(
    (rule) => rule.from_stage === snapshot.currentStage
  );

  for (const rule of applicableRules) {
    const allConditionsMet = rule.conditions.every((cond) =>
      evaluateCondition(cond, snapshot)
    );
    if (allConditionsMet) {
      const conditionsKey = [...rule.conditions].sort().join(',');
      const dedupeKey = computeDedupeKey(
        snapshot.episodeId,
        ruleset.version,
        snapshot.currentStage,
        rule.to_stage,
        conditionsKey
      );
      return {
        suggestedStage: rule.to_stage,
        fromStage: snapshot.currentStage,
        matchedRuleIds: [rule.id],
        rulesetVersion: ruleset.version,
        snapshotVersion: snapshot.snapshotVersion,
        dedupeKey,
      };
    }
  }

  return null;
}

export async function computeStageSuggestion(episodeId: string): Promise<ReducerResult | null> {
  const snapshot = await buildSnapshot(episodeId);
  if (!snapshot) return null;
  return reduce(snapshot);
}
