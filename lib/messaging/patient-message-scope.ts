import type { AuthPayload } from '@/lib/auth-server';

/** Same treatment-history access as hasEverTreatedPatient, for message queries (alias m). */
export function sqlPatientEverTreated(userParam: string): string {
  return `EXISTS (
    SELECT 1 FROM patients p
     WHERE p.id = m.patient_id
       AND (
         p.kezeleoorvos_user_id = ${userParam}
         OR EXISTS (
           SELECT 1 FROM patient_episodes pe
            WHERE pe.patient_id = p.id AND pe.assigned_provider_id = ${userParam}
         )
         OR EXISTS (
           SELECT 1 FROM appointments a
            JOIN users u ON u.email = a.dentist_email
           WHERE a.patient_id = p.id AND u.id = ${userParam}
         )
         OR (
           p.kezeleoorvos IS NOT NULL AND p.kezeleoorvos <> ''
           AND EXISTS (
             SELECT 1 FROM users u
              WHERE u.id = ${userParam}
                AND (p.kezeleoorvos = u.email OR p.kezeleoorvos = u.doktor_neve)
           )
         )
       )
  )`;
}

/** Only the doctor's own conversation, including legacy messages without a recipient. */
export function sqlPatientLaneForDoctor(doctorParam: string): string {
  return `(
    (m.sender_type = 'patient' AND (m.recipient_doctor_id = ${doctorParam} OR m.recipient_doctor_id IS NULL))
    OR (m.sender_type = 'doctor' AND m.sender_id = ${doctorParam})
  )`;
}

/** Shared visibility for the inbox, recent patient messages and unread badges. */
export function getStaffPatientMessageScope(viewer: Pick<AuthPayload, 'userId' | 'role'>) {
  if (viewer.role === 'admin') return { where: 'TRUE', params: [] as string[] };
  return {
    where: `${sqlPatientEverTreated('$1::uuid')} AND ${sqlPatientLaneForDoctor('$1::uuid')}`,
    params: [viewer.userId],
  };
}
