/**
 * Pathway work-phase templates for an episode: merged multi-pathway JSON from care_pathways.
 * Reads canonical work_phases_json; falls back to legacy steps_json when the new column is empty.
 */

import type { Pool } from 'pg';

export type PathwayWorkPhasePool = 'consult' | 'work' | 'control';

/** Template item from care_pathways JSON (canonical key: work_phase_code). */
export interface PathwayWorkPhaseTemplate {
  work_phase_code: string;
  label?: string;
  pool: PathwayWorkPhasePool;
  duration_minutes: number;
  default_days_offset: number;
  requires_precommit?: boolean;
  optional?: boolean;
}

function poolFromUnknown(v: unknown): PathwayWorkPhasePool {
  return v === 'consult' || v === 'work' || v === 'control' ? v : 'work';
}

/** Normalize one pathway JSON element (accepts work_phase_code or legacy step_code). */
export function normalizePathwayWorkPhaseElement(el: unknown): PathwayWorkPhaseTemplate | null {
  if (!el || typeof el !== 'object') return null;
  const o = el as Record<string, unknown>;
  const code =
    (typeof o.work_phase_code === 'string' && o.work_phase_code.trim()) ||
    (typeof o.step_code === 'string' && o.step_code.trim());
  if (!code) return null;
  return {
    work_phase_code: code.trim(),
    label: typeof o.label === 'string' ? o.label : undefined,
    pool: poolFromUnknown(o.pool),
    duration_minutes: typeof o.duration_minutes === 'number' && o.duration_minutes > 0 ? o.duration_minutes : 30,
    default_days_offset:
      typeof o.default_days_offset === 'number' && o.default_days_offset >= 0 ? o.default_days_offset : 7,
    requires_precommit: o.requires_precommit === true,
    optional: o.optional === true,
  };
}

export function normalizePathwayWorkPhaseArray(raw: unknown): PathwayWorkPhaseTemplate[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PathwayWorkPhaseTemplate[] = [];
  for (const el of raw) {
    const n = normalizePathwayWorkPhaseElement(el);
    if (n) out.push(n);
  }
  return out.length > 0 ? out : null;
}

/** Two templates are "the same step with different parameters" — a merge conflict. */
function templatesConflict(a: PathwayWorkPhaseTemplate, b: PathwayWorkPhaseTemplate): boolean {
  return (
    a.pool !== b.pool ||
    a.duration_minutes !== b.duration_minutes ||
    a.default_days_offset !== b.default_days_offset
  );
}

/**
 * Deduplicate merged multi-pathway templates by `work_phase_code`, preserving order.
 * First occurrence wins (earlier pathway by ordinal has precedence). When a later
 * occurrence carries different parameters it is dropped and the conflict is logged,
 * so two pathways defining the same code with different durations/offsets no longer
 * silently produce duplicate steps.
 */
export function dedupePathwayWorkPhases(templates: PathwayWorkPhaseTemplate[]): PathwayWorkPhaseTemplate[] {
  const seen = new Map<string, PathwayWorkPhaseTemplate>();
  const out: PathwayWorkPhaseTemplate[] = [];
  for (const t of templates) {
    const existing = seen.get(t.work_phase_code);
    if (!existing) {
      seen.set(t.work_phase_code, t);
      out.push(t);
      continue;
    }
    if (templatesConflict(existing, t)) {
      console.warn(
        `[pathway-merge] conflicting duplicate work_phase_code "${t.work_phase_code}" dropped; ` +
          `kept pool=${existing.pool}/dur=${existing.duration_minutes}/offset=${existing.default_days_offset}, ` +
          `dropped pool=${t.pool}/dur=${t.duration_minutes}/offset=${t.default_days_offset}`
      );
    }
    // duplicate (identical or conflicting) → keep the first, drop this one
  }
  return out;
}

/**
 * Templates from care_pathways columns: non-empty work_phases_json wins; otherwise legacy steps_json.
 * (Using `work_phases_json ?? steps_json` before normalize is wrong when canonical column is `[]`.)
 */
export function pathwayTemplatesFromCarePathwayRow(row: {
  work_phases_json?: unknown;
  steps_json?: unknown;
}): PathwayWorkPhaseTemplate[] | null {
  const w = normalizePathwayWorkPhaseArray(row.work_phases_json);
  if (w) return w;
  return normalizePathwayWorkPhaseArray(row.steps_json);
}

/**
 * All pathway work-phase templates for an episode, in pathway ordinal order (multi-pathway),
 * then legacy single care_pathway_id on patient_episodes when episode_pathways is empty.
 */
export async function getPathwayWorkPhasesForEpisode(
  pool: Pool,
  episodeId: string
): Promise<PathwayWorkPhaseTemplate[] | null> {
  try {
    const multiRow = await pool.query(
      `SELECT cp.work_phases_json, cp.steps_json
       FROM episode_pathways ep
       JOIN care_pathways cp ON ep.care_pathway_id = cp.id
       WHERE ep.episode_id = $1
       ORDER BY ep.ordinal`,
      [episodeId]
    );
    if (multiRow.rows.length > 0) {
      const merged: PathwayWorkPhaseTemplate[] = [];
      for (const row of multiRow.rows) {
        const arr = pathwayTemplatesFromCarePathwayRow(row);
        if (arr) merged.push(...arr);
      }
      if (merged.length === 0) return null;
      return dedupePathwayWorkPhases(merged);
    }
  } catch {
    /* episode_pathways may be missing */
  }

  const r = await pool.query(
    `SELECT cp.work_phases_json, cp.steps_json
     FROM patient_episodes pe
     JOIN care_pathways cp ON pe.care_pathway_id = cp.id
     WHERE pe.id = $1`,
    [episodeId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return pathwayTemplatesFromCarePathwayRow(row);
}
