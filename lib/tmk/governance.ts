/**
 * Study/center governance MVP helpers.
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';

export type StudyPermission = 'read' | 'contribute' | 'approve' | 'export';

export async function hasStudyCenterPermission(
  studyId: string,
  centerCode: string,
  permission: StudyPermission,
  pool?: Pool
): Promise<boolean> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT 1 FROM study_center_permissions
     WHERE study_id = $1 AND center_code = $2 AND permission = $3 AND revoked_at IS NULL
     LIMIT 1`,
    [studyId, centerCode, permission]
  );
  return r.rowCount !== null && r.rowCount > 0;
}

export async function grantStudyCenterPermission(
  studyId: string,
  centerCode: string,
  permission: StudyPermission,
  grantedBy: string,
  pool?: Pool
): Promise<void> {
  const db = pool ?? getDbPool();
  await db.query(
    `INSERT INTO study_center_permissions (study_id, center_code, permission, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (study_id, center_code, permission) DO UPDATE SET
       granted_by = EXCLUDED.granted_by,
       granted_at = CURRENT_TIMESTAMP,
       revoked_at = NULL`,
    [studyId, centerCode, permission, grantedBy]
  );
}
