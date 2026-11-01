import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { budapestToday } from '@/lib/aftercare/model';
import { canonical } from '@/lib/prosthesis-lifecycle/model';
import { financingAt, type EpisodeFinancing, type FinancingCommand, type FinancingEvent } from './model';

type Db=Pick<PoolClient,'query'>;
export const FINANCING_SELECT=`SELECT f.*,f.effective_on::text,f.total_amount::text,f.funded_amount::text,f.patient_amount::text,
  e.occurred_on::text,e.occurred_at::text,e.time_precision,e.recorded_at::text,e.recorded_by,e.source,e.note,u.email AS recorder,
  NOT EXISTS(SELECT 1 FROM prosthesis_clinical_events n WHERE n.supersedes_id=e.id) AS active
  FROM episode_financing_events f JOIN prosthesis_clinical_events e ON e.id=f.event_id JOIN users u ON u.id=e.recorded_by`;
export async function loadFinancingHistory(db:Db,episodeId:string):Promise<FinancingEvent[]> {
  return (await db.query(`${FINANCING_SELECT} WHERE f.episode_id=$1 ORDER BY f.effective_on DESC,e.occurred_on DESC,f.version DESC`,[episodeId])).rows;
}
export function financingWorkspace(history:FinancingEvent[],planId:string|null,asOf=budapestToday()):EpisodeFinancing {
  return {revision:history.reduce((v,e)=>Math.max(v,e.version),0),current:financingAt(history,asOf,planId),history,
    upcoming:history.filter(e=>e.active&&e.effective_on>asOf).sort((a,b)=>a.effective_on.localeCompare(b.effective_on)||a.version-b.version)};
}
export async function loadEpisodeFinancing(db:Db,episodeId:string,planId:string|null):Promise<EpisodeFinancing> {
  return financingWorkspace(await loadFinancingHistory(db,episodeId),planId);
}

export async function saveEpisodeFinancing(patientId:string,actor:string,c:FinancingCommand) {
  if(c.occurredOn>budapestToday()||(c.occurredAt&&new Date(c.occurredAt).getTime()>Date.now()))throw new HttpError(400,'A finanszírozási döntés nem rögzíthető jövőben megtörtént eseményként');
  const db=await getDbPool().connect();
  try {
    await db.query('BEGIN');
    if(!(await db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE',[patientId])).rowCount)throw new HttpError(404,'Beteg nem található');
    const ep=(await db.query('SELECT id FROM patient_episodes WHERE id=$1 AND patient_id=$2 FOR UPDATE',[c.episodeId,patientId])).rows[0];
    if(!ep)throw new HttpError(404,'A beteg ellátási epizódja nem található');
    const retry=(await db.query('SELECT id,payload,kind FROM prosthesis_clinical_events WHERE patient_id=$1 AND request_key=$2',[patientId,c.requestKey])).rows[0];
    if(retry){
      if(retry.kind!=='financing_changed'||canonical(retry.payload.command)!==canonical(c))throw new HttpError(409,'Az ismétlési kulcs más tartalomhoz tartozik');
      await db.query('COMMIT');return {id:retry.payload.entityId as string,eventId:retry.id as string};
    }
    const history=await loadFinancingHistory(db,c.episodeId),revision=history.reduce((v,e)=>Math.max(v,e.version),0);
    if(revision!==c.expectedVersion)throw new HttpError(409,'A finanszírozás közben módosult. Töltse be és tekintse át a friss állapotot.','FINANCING_CONFLICT');
    if(c.planVersionId){
      const plan=(await db.query(`SELECT p.id,e.occurred_on::text FROM prosthesis_plan_versions p JOIN prosthesis_active_events e ON e.id=p.event_id
        WHERE p.id=$1 AND p.episode_id=$2 AND p.patient_id=$3`,[c.planVersionId,c.episodeId,patientId])).rows[0];
      if(!plan)throw new HttpError(400,'A finanszírozáshoz választott terv nem ehhez az epizódhoz tartozik');
      if(plan.occurred_on>c.occurredOn)throw new HttpError(409,'A finanszírozási döntés nem előzheti meg a hivatkozott terv klinikai dátumát');
    }
    const previous=c.correctsId?history.find(e=>e.id===c.correctsId&&e.active):null;
    if(c.correctsId&&!previous)throw new HttpError(409,'A korrigálandó döntés már javított, vagy nem ehhez az epizódhoz tartozik');
    const ids=Array.from(new Set(c.documentIds));
    if(ids.length&&(await db.query('SELECT id FROM patient_documents WHERE patient_id=$1 AND id=ANY($2::uuid[])',[patientId,ids])).rowCount!==ids.length)throw new HttpError(400,'Másik beteg vagy hiányzó dokumentum nem kapcsolható');
    const linked=(await db.query('SELECT prosthesis_id FROM prosthesis_episode_links WHERE episode_id=$1',[c.episodeId])).rows[0];
    const id=randomUUID(),eventId=randomUUID();
    await db.query(`INSERT INTO prosthesis_clinical_events(id,patient_id,episode_id,prosthesis_id,kind,occurred_on,occurred_at,time_precision,source,note,payload,recorded_by,request_key,supersedes_id)
      VALUES($1,$2,$3,$4,'financing_changed',$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,[eventId,patientId,c.episodeId,linked?.prosthesis_id??null,c.occurredOn,c.occurredAt,c.precision,c.source,c.note||c.reason,
      JSON.stringify({command:c,entityId:id}),actor,c.requestKey,previous?.event_id??null]);
    await db.query(`INSERT INTO episode_financing_events(id,event_id,patient_id,episode_id,prosthesis_id,plan_version_id,version,effective_on,mode,status,payer,currency,total_amount,funded_amount,patient_amount,reason,decision_reference,document_ids,corrects_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,[id,eventId,patientId,c.episodeId,linked?.prosthesis_id??null,c.planVersionId,revision+1,c.effectiveOn,c.mode,c.status,c.payer,c.currency,c.totalAmount,c.fundedAmount,c.patientAmount,c.reason,c.decisionReference,ids,c.correctsId??null]);
    await db.query('COMMIT');return {id,eventId};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
