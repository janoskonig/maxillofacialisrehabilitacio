import type { Pool } from 'pg';
import { PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
import type { Patient } from '@/lib/types';

export interface PatientSearchFilters {
  query?: string;
  kezeleoorvos?: string;
  intezmeny?: string;
  limit?: number;
  offset?: number;
}

export class PatientRepository {
  constructor(private pool: Pool) {}

  async findById(id: string): Promise<Patient | null> {
    const result = await this.pool.query(
      `SELECT ${PATIENT_SELECT_FIELDS} FROM patients WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async existsById(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM patients WHERE id = $1',
      [id]
    );
    return result.rows.length > 0;
  }

  async findBasicById(id: string) {
    const result = await this.pool.query(
      'SELECT id, nev, taj, email, nem, created_by FROM patients WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  async count(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*)::int as count FROM patients');
    return result.rows[0].count;
  }

  async findByTaj(taj: string, excludeId?: string): Promise<Patient | null> {
    if (excludeId) {
      const result = await this.pool.query(
        `SELECT ${PATIENT_SELECT_FIELDS} FROM patients WHERE taj = $1 AND id != $2`,
        [taj, excludeId]
      );
      return result.rows[0] ?? null;
    }
    const result = await this.pool.query(
      `SELECT ${PATIENT_SELECT_FIELDS} FROM patients WHERE taj = $1`,
      [taj]
    );
    return result.rows[0] ?? null;
  }
}
