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

/**
 * True only if a currently valid (not expired) ethics approval (ETT TUKEB) is
 * on record. Research exports are legally blocked without one.
 */
export async function hasActiveEthicsApproval(pool?: Pool): Promise<boolean> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT 1 FROM ethics_approvals
     WHERE approved_at <= CURRENT_DATE
       AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
     LIMIT 1`
  );
  return r.rows.length > 0;
}

/** Throws unless a valid ethics approval is on record. */
export async function assertEthicsApprovalActive(pool?: Pool): Promise<void> {
  if (!(await hasActiveEthicsApproval(pool))) {
    throw new ResearchExportBlockedError(
      'Kutatási export tiltva: nincs érvényes kutatásetikai engedély (ETT TUKEB) rögzítve. ' +
        'Vegye fel az engedélyt az ethics_approvals táblába, mielőtt bármilyen kutatási exportot indítana.'
    );
  }
}

/**
 * Full cohort-export gate: requires BOTH a valid ethics approval AND the
 * export mode to be enabled. Either failing throws ResearchExportBlockedError.
 */
export async function assertResearchExportModeAllowsCohortExport(pool?: Pool): Promise<void> {
  if (RESEARCH_EXPORT_MODE === 'disabled') {
    throw new ResearchExportBlockedError(
      'Kutatási kohorsz export jelenleg tiltva (RESEARCH_EXPORT_MODE=disabled). ' +
        'Klinikai statisztika CSV továbbra is elérhető. ' +
        'Lásd lib/research-registry/OPERATIONAL-DECISIONS.md.'
    );
  }
  // Even when enabled, a valid ethics approval (ETT TUKEB) is mandatory.
  await assertEthicsApprovalActive(pool);
}

export async function filterPatientsEligibleForResearchExport(
  patientIds: string[],
  pool?: Pool
): Promise<{ eligible: string[]; excluded: string[] }> {
  // No valid ethics approval → no patient is eligible for research export.
  if (RESEARCH_EXPORT_MODE === 'disabled' || !(await hasActiveEthicsApproval(pool))) {
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
