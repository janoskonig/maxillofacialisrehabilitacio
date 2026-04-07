import { describe, expect, it } from 'vitest';
import { mapEpisodePathwayRow } from '@/lib/map-episode-pathway-response';

describe('mapEpisodePathwayRow', () => {
  it('duplicates count as workPhaseCount and stepCount', () => {
    const r = mapEpisodePathwayRow({
      id: 'a',
      carePathwayId: 'b',
      ordinal: 0,
      pathwayName: 'P',
      jaw: 'felso',
      stepCount: 3,
    });
    expect(r.stepCount).toBe(3);
    expect(r.workPhaseCount).toBe(3);
    expect(r.jaw).toBe('felso');
  });

  it('normalizes jaw to null when unknown', () => {
    const r = mapEpisodePathwayRow({
      id: 'a',
      carePathwayId: 'b',
      ordinal: 0,
      pathwayName: 'P',
      jaw: null,
      stepCount: 0,
    });
    expect(r.jaw).toBeNull();
    expect(r.workPhaseCount).toBe(0);
  });
});
