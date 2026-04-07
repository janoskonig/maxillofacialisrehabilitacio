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

function pickTemplateArrayFromCarePathwayRow(row: {
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
        const arr = pickTemplateArrayFromCarePathwayRow(row);
        if (arr) merged.push(...arr);
      }
      return merged.length > 0 ? merged : null;
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
  return pickTemplateArrayFromCarePathwayRow(row);
}
