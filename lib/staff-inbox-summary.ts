import { getDbPool } from '@/lib/db';
import { getUnreadDoctorMessageCount } from '@/lib/doctor-communication';

export type StaffInboxSummary = {
  patientUnread: number;
  doctorUnread: number;
};

async function countPatientUnreadToStaff(): Promise<number> {
  const pool = getDbPool();
  const result = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM messages WHERE sender_type = 'patient' AND read_at IS NULL`
  );
  return result.rows[0]?.c ?? 0;
}

export async function getStaffInboxSummary(userId: string): Promise<StaffInboxSummary> {
  const [patientUnread, doctorUnread] = await Promise.all([
    countPatientUnreadToStaff(),
    getUnreadDoctorMessageCount(userId),
  ]);
  return { patientUnread, doctorUnread };
}
