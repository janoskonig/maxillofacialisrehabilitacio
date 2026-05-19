/**
 * Research export eligibility — enforces operational-policy decisions.
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import { RESEARCH_EXPORT_MODE } from './operational-policy';
import { isPatientResearchUsable } from './consent';

export class ResearchExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchExportBlockedError';
  }
}

export function assertResearchExportModeAllowsCohortExport(): void {
  if (RESEARCH_EXPORT_MODE === 'disabled') {
    throw new ResearchExportBlockedError(
      'Kutatási kohorsz export jelenleg tiltva (RESEARCH_EXPORT_MODE=disabled). ' +
        'Klinikai statisztika CSV továbbra is elérhető. ' +
        'Lásd lib/research-registry/OPERATIONAL-DECISIONS.md.'
    );
  }
}

export async function filterPatientsEligibleForResearchExport(
  patientIds: string[],
  pool?: Pool
): Promise<{ eligible: string[]; excluded: string[] }> {
  if (RESEARCH_EXPORT_MODE === 'disabled') {
    return { eligible: [], excluded: patientIds };
  }

  const eligible: string[] = [];
  const excluded: string[] = [];
  for (const id of patientIds) {
    if (await isPatientResearchUsable(id, pool)) {
      eligible.push(id);
    } else {
      excluded.push(id);
    }
  }
  return { eligible, excluded };
}
