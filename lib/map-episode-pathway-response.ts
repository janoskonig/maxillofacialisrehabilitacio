/**
 * Normalizes episode_pathways query rows for JSON responses during work-phase domain cutover.
 * `stepCount` is retained for older clients; `workPhaseCount` is the preferred name (same value).
 */

export interface EpisodePathwayApiRow {
  id: string;
  episode_id?: string;
  carePathwayId: string;
  ordinal: number;
  pathwayName: string;
  jaw?: string | null;
  stepCount: number;
}

export interface EpisodePathwayResponseItem {
  id: string;
  carePathwayId: string;
  ordinal: number;
  pathwayName: string;
  jaw: 'felso' | 'also' | null;
  stepCount: number;
  workPhaseCount: number;
}

export function mapEpisodePathwayRow(r: EpisodePathwayApiRow): EpisodePathwayResponseItem {
  const n = Number(r.stepCount) || 0;
  return {
    id: r.id,
    carePathwayId: r.carePathwayId,
    ordinal: r.ordinal,
    pathwayName: r.pathwayName,
    jaw: r.jaw === 'felso' || r.jaw === 'also' ? r.jaw : null,
    stepCount: n,
    workPhaseCount: n,
  };
}

export function mapEpisodePathwayRows(rows: EpisodePathwayApiRow[]): EpisodePathwayResponseItem[] {
  return rows.map(mapEpisodePathwayRow);
}
