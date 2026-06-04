import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LINK_SRC = readFileSync(
  join(process.cwd(), 'lib/link-appointment-work-phase.ts'),
  'utf8'
);
const ROUTE_SRC = readFileSync(
  join(process.cwd(), 'app/api/appointments/[id]/link-work-phase/route.ts'),
  'utf8'
);

describe('link-appointment-work-phase', () => {
  it('sets episode_id on appointment when linking portal booking', () => {
    expect(LINK_SRC).toMatch(/SET episode_id = \$1/);
    expect(LINK_SRC).toMatch(/pool = \$5/);
  });

  it('requires episodeId when appointment has no episode', () => {
    expect(LINK_SRC).toMatch(/effectiveEpisodeId = appt\.episodeId \?\? params\.episodeId/);
    expect(LINK_SRC).toMatch(/Epizód megadása kötelező/);
  });

  it('route delegates to linkAppointmentToWorkPhase', () => {
    expect(ROUTE_SRC).toMatch(/linkAppointmentToWorkPhase/);
    expect(ROUTE_SRC).toMatch(/projectRemainingSteps/);
  });
});
