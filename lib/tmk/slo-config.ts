/**
 * Operational SLO targets for clinical vs research read models.
 */

export interface SloTarget {
  name: string;
  p95LatencyMs: number;
  maxStaleDurationMs: number;
  rebuildTargetMs: number;
  alertThresholdMs?: number;
  operatorAction: string;
}

export const CLINICAL_CONSISTENCY_SLA: SloTarget = {
  name: 'clinical_consistency',
  p95LatencyMs: 500,
  maxStaleDurationMs: 0,
  rebuildTargetMs: 0,
  operatorAction: 'Investigate write path latency; check DB pool saturation.',
};

export const RESEARCH_CONSISTENCY_SLA: SloTarget = {
  name: 'research_consistency',
  p95LatencyMs: 30_000,
  maxStaleDurationMs: 300_000,
  rebuildTargetMs: 600_000,
  alertThresholdMs: 600_000,
  operatorAction: 'Trigger quality recompute queue drain or partial read-model rebuild.',
};

export const EXPORT_QUEUE_SLA: SloTarget = {
  name: 'export_queue',
  p95LatencyMs: 120_000,
  maxStaleDurationMs: 3_600_000,
  rebuildTargetMs: 1_800_000,
  alertThresholdMs: 3_600_000,
  operatorAction: 'Check analysis_exports failures; verify checksum hierarchy.',
};

export const QUALITY_RECOMPUTE_SLA: SloTarget = {
  name: 'quality_recompute',
  p95LatencyMs: 10_000,
  maxStaleDurationMs: 900_000,
  rebuildTargetMs: 300_000,
  alertThresholdMs: 1_800_000,
  operatorAction: 'Drain quality_recompute_jobs; quarantine poison messages after 5 attempts.',
};

export const TMK_SLO_TARGETS: readonly SloTarget[] = [
  CLINICAL_CONSISTENCY_SLA,
  RESEARCH_CONSISTENCY_SLA,
  EXPORT_QUEUE_SLA,
  QUALITY_RECOMPUTE_SLA,
] as const;

export function getSloByName(name: string): SloTarget | undefined {
  return TMK_SLO_TARGETS.find((s) => s.name === name);
}
