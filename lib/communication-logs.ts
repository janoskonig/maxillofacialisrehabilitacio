import { getDbPool } from './db';

export type CommunicationType = 'message' | 'phone' | 'in_person' | 'other';
export type CommunicationDirection = 'doctor_to_patient' | 'patient_to_doctor';

export interface CommunicationLog {
  id: string;
  patientId: string;
  doctorId: string | null;
  communicationType: CommunicationType;
  direction: CommunicationDirection;
  subject: string | null;
  content: string;
  metadata: Record<string, any> | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateCommunicationLogInput {
  patientId: string;
  doctorId?: string | null;
  communicationType: CommunicationType;
  direction: CommunicationDirection;
  subject?: string | null;
  content: string;
  metadata?: Record<string, any> | null;
  createdBy: string;
}

/**
 * Érintkezési napló létrehozása
 */
export async function logCommunication(input: CreateCommunicationLogInput): Promise<CommunicationLog> {
  const pool = getDbPool();

  const result = await pool.query(
    `INSERT INTO communication_logs (patient_id, doctor_id, communication_type, direction, subject, content, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, patient_id, doctor_id, communication_type, direction, subject, content, metadata, created_at, created_by`,
    [
      input.patientId,
      input.doctorId || null,
      input.communicationType,
      input.direction,
      input.subject || null,
      input.content,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdBy,
    ]
  );

  const row = result.rows[0];
  
  // Parse metadata - PostgreSQL JSONB returns as object/array, not string
  let metadataParsed: Record<string, any> | null = null;
  if (row.metadata) {
    if (typeof row.metadata === 'string') {
      try {
        metadataParsed = JSON.parse(row.metadata);
      } catch (e) {
        console.warn('[logCommunication] Failed to parse metadata:', e);
        metadataParsed = null;
      }
    } else if (typeof row.metadata === 'object') {
      metadataParsed = row.metadata;
    }
  }
  
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    communicationType: row.communication_type,
    direction: row.direction,
    subject: row.subject,
    content: row.content,
    metadata: metadataParsed,
    createdAt: new Date(row.created_at),
    createdBy: row.created_by,
  };
}

/**
 * Beteg érintkezési naplójának lekérése
 */
export async function getPatientCommunicationLogs(
  patientId: string,
  options?: {
    communicationType?: CommunicationType;
    limit?: number;
    offset?: number;
  }
): Promise<CommunicationLog[]> {
  const pool = getDbPool();

  let query = `
    SELECT id, patient_id, doctor_id, communication_type, direction, subject, content, metadata, created_at, created_by
    FROM communication_logs
    WHERE patient_id = $1
  `;
  const params: any[] = [patientId];

  if (options?.communicationType) {
    query += ` AND communication_type = $${params.length + 1}`;
    params.push(options.communicationType);
  }

  query += ' ORDER BY created_at DESC';

  if (options?.limit) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET $${params.length + 1}`;
    params.push(options.offset);
  }

  const result = await pool.query(query, params);

  return result.rows.map((row: any) => {
    // Parse metadata - PostgreSQL JSONB returns as object/array, not string
    let metadataParsed: Record<string, any> | null = null;
    if (row.metadata) {
      if (typeof row.metadata === 'string') {
        try {
          metadataParsed = JSON.parse(row.metadata);
        } catch (e) {
          console.warn('[getPatientCommunicationLogs] Failed to parse metadata:', e, row.id);
          metadataParsed = null;
        }
      } else if (typeof row.metadata === 'object') {
        metadataParsed = row.metadata;
      }
    }
    
    return {
      id: row.id,
      patientId: row.patient_id,
      doctorId: row.doctor_id,
      communicationType: row.communication_type,
      direction: row.direction,
      subject: row.subject,
      content: row.content,
      metadata: metadataParsed,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by,
    };
  });
}

