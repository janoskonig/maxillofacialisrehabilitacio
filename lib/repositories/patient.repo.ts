import type { Pool } from 'pg';
import { PATIENT_SELECT_FIELDS, PATIENTS_FULL_TABLE, PATIENT_LIST_FIELDS } from '@/lib/queries/patient-fields';
import type { Patient, PatientListItem, PatientDentalStatus, PatientAnamnesis } from '@/lib/types';

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
      `SELECT ${PATIENT_SELECT_FIELDS} FROM ${PATIENTS_FULL_TABLE} WHERE id = $1`,
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

  async findListById(id: string): Promise<PatientListItem | null> {
    const result = await this.pool.query(
      `SELECT ${PATIENT_LIST_FIELDS} FROM patients WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findDentalStatus(patientId: string): Promise<PatientDentalStatus | null> {
    const result = await this.pool.query(
      `SELECT patient_id as "patientId",
              meglevo_fogak as "meglevoFogak",
              meglevo_implantatumok as "meglevoImplantatumok",
              nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
              nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
              felso_fogpotlas_van as "felsoFogpotlasVan",
              felso_fogpotlas_mikor as "felsoFogpotlasMikor",
              felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
              felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
              felso_fogpotlas_problema as "felsoFogpotlasProblema",
              felso_fogpotlas_tipus as "felsoFogpotlasTipus",
              also_fogpotlas_van as "alsoFogpotlasVan",
              also_fogpotlas_mikor as "alsoFogpotlasMikor",
              also_fogpotlas_keszito as "alsoFogpotlasKeszito",
              also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
              also_fogpotlas_problema as "alsoFogpotlasProblema",
              also_fogpotlas_tipus as "alsoFogpotlasTipus"
       FROM patient_dental_status WHERE patient_id = $1`,
      [patientId]
    );
    return result.rows[0] ?? null;
  }

  async findAnamnesis(patientId: string): Promise<PatientAnamnesis | null> {
    const result = await this.pool.query(
      `SELECT patient_id as "patientId",
              kezelesre_erkezes_indoka as "kezelesreErkezesIndoka",
              alkoholfogyasztas, dohanyzas_szam as "dohanyzasSzam",
              maxilladefektus_van as "maxilladefektusVan",
              brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
              brown_vizszintes_komponens as "brownVizszintesKomponens",
              mandibuladefektus_van as "mandibuladefektusVan",
              kovacs_dobak_osztaly as "kovacsDobakOsztaly",
              nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
              gombocos_beszed as "gombocosBeszed",
              nyalmirigy_allapot as "nyalmirigyAllapot",
              bno, diagnozis, tnm_staging as "tnmStaging"
       FROM patient_anamnesis WHERE patient_id = $1`,
      [patientId]
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
        `SELECT ${PATIENT_SELECT_FIELDS} FROM ${PATIENTS_FULL_TABLE} WHERE taj = $1 AND id != $2`,
        [taj, excludeId]
      );
      return result.rows[0] ?? null;
    }
    const result = await this.pool.query(
      `SELECT ${PATIENT_SELECT_FIELDS} FROM ${PATIENTS_FULL_TABLE} WHERE taj = $1`,
      [taj]
    );
    return result.rows[0] ?? null;
  }
}
