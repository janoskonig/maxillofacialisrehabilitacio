import type { PoolClient } from 'pg';
import { HttpError } from '@/lib/auth-server';
import { replayStates, type StateEvidence } from './model';

type Db = Pick<PoolClient,'query'>;
export async function loadClinicalStates(db:Db, patientId:string):Promise<StateEvidence[]> {
  const r = await db.query(`SELECT s.*,e.occurred_on::text,e.occurred_at::text,e.recorded_at::text,e.source,e.note,e.supersedes_id,e.recorded_by,u.email AS recorder
    FROM clinical_dental_states s JOIN prosthesis_active_events e ON e.id=s.event_id
    JOIN users u ON u.id=e.recorded_by
    WHERE s.patient_id=$1 ORDER BY e.occurred_on,e.occurred_at NULLS FIRST,e.recorded_at,e.id`,[patientId]);
  return r.rows;
}
export async function baselineAt(db:Db, patientId:string, id:string, day:string) {
  const states=await loadClinicalStates(db,patientId), selected=states.find(s=>s.id===id);
  if (!selected) throw new HttpError(404,'A beteg dokumentált kiindulási státusza nem található');
  if (selected.occurred_on>day) throw new HttpError(409,'A kiindulási státusz későbbi, mint az ellátás');
  const replay=replayStates(states,id);
  if (replay.conflicts.length) throw new HttpError(409,'A kiindulási státusz idővonalán felülvizsgálandó eltérés van');
  return replay.layers;
}
