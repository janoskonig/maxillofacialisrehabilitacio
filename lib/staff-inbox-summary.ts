import { getDbPool } from '@/lib/db';
import { getUnreadDoctorMessageCount } from '@/lib/doctor-communication';
import type { AuthPayload } from '@/lib/auth-server';
import { getStaffPatientMessageScope } from '@/lib/messaging/patient-message-scope';

export type StaffInboxSummary = {
  patientUnread: number;
  doctorUnread: number;
};

async function countPatientUnreadToStaff(viewer: Pick<AuthPayload, 'userId' | 'role'>): Promise<number> {
  const pool = getDbPool();
  const scope = getStaffPatientMessageScope(viewer);
  const result = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM messages m
     JOIN patients p ON p.id = m.patient_id
     WHERE m.sender_type = 'patient' AND m.read_at IS NULL AND ${scope.where}`,
    scope.params,
  );
  return result.rows[0]?.c ?? 0;
}

export async function getStaffInboxSummary(viewer: Pick<AuthPayload, 'userId' | 'role'>): Promise<StaffInboxSummary> {
  const [patientUnread, doctorUnread] = await Promise.all([
    countPatientUnreadToStaff(viewer),
    getUnreadDoctorMessageCount(viewer.userId),
  ]);
  return { patientUnread, doctorUnread };
}
