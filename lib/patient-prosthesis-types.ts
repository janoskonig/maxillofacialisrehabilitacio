import type { PoolClient } from 'pg';
import type { Patient } from '@/lib/types';
import { HttpError } from '@/lib/auth-server';
import { probeColumnExists } from '@/lib/schema-probe';

/** Old clients and pre-migration reads cannot erase the richer type selection. */
export async function savePatientProsthesisTypes(db:Pick<PoolClient,'query'>,patientId:string,patient:Pick<Patient,'felsoFogpotlasTipusok'|'alsoFogpotlasTipusok'>) {
  if(patient.felsoFogpotlasTipusok==null&&patient.alsoFogpotlasTipusok==null)return;
  if(!await probeColumnExists(db,'patient_dental_status','felso_fogpotlas_tipusok'))throw new HttpError(503,'A több fogpótlástípus mentéséhez a 115-ös adatbázis-frissítés szükséges.');
  await db.query(`UPDATE patient_dental_status SET
    felso_fogpotlas_tipusok=CASE WHEN $2 THEN $3::jsonb ELSE felso_fogpotlas_tipusok END,
    also_fogpotlas_tipusok=CASE WHEN $4 THEN $5::jsonb ELSE also_fogpotlas_tipusok END WHERE patient_id=$1`,
    [patientId,patient.felsoFogpotlasTipusok!=null,JSON.stringify(patient.felsoFogpotlasTipusok??null),patient.alsoFogpotlasTipusok!=null,JSON.stringify(patient.alsoFogpotlasTipusok??null)]);
}
