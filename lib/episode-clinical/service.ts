import { randomUUID } from 'crypto';
import type { Pool,PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { PATIENT_SELECT_FIELDS } from '@/lib/queries/patient-fields';
import { canonical } from '@/lib/prosthesis-lifecycle/model';
import { clinicalTemplate,patientAtReview,type EpisodeClinicalReview,type EpisodeClinicalWorkspace,type EpisodeReviewCommand } from './model';
import type { Patient } from '@/lib/types';
import { isValidUUID } from '@/lib/validation';

type Db=Pick<Pool|PoolClient,'query'>;
export async function patientForEpisodeExport(db:Db,patient:Patient,patientId:string,query:URLSearchParams){
  const episodeId=query.get('episodeId'),reviewId=query.get('clinicalReviewId');
  if((episodeId&&!isValidUUID(episodeId))||(reviewId&&(!episodeId||!isValidUUID(reviewId))))throw new HttpError(400,'Érvénytelen epizód vagy adatfelvétel.');
  const review=episodeId?await selectedEpisodeReview(db,patientId,episodeId,reviewId):null;
  if(episodeId&&!review)throw new HttpError(409,'Az epizód dokumentált adatfelülvizsgálata szükséges.','EPISODE_CLINICAL_REVIEW_REQUIRED');
  return {patient:review?patientAtReview(patient,review):patient,review};
}
const SELECT=`SELECT r.id,r.patient_id AS "patientId",r.episode_id AS "episodeId",r.version,
  r.effective_on::text AS "effectiveOn",r.source,r.note,r.content,r.source_review_id AS "sourceReviewId",
  r.recorded_at::text AS "recordedAt",r.recorded_by AS "recordedBy",COALESCE(u.doktor_neve,u.email) AS recorder
  FROM episode_clinical_reviews r JOIN users u ON u.id=r.recorded_by`;
function reviewRow(row:EpisodeClinicalReview):EpisodeClinicalReview{return {...row,recordedAt:new Date(row.recordedAt).toISOString()};}
// DATE values are calendar days, not local-midnight timestamps.
const PATIENT_REVIEW_FIELDS=PATIENT_SELECT_FIELDS.replace('szuletesi_datum as','szuletesi_datum::text as').replace('mutet_ideje as','mutet_ideje::text as').replace('baleset_idopont as','baleset_idopont::text as');

export async function selectedEpisodeReview(db:Db,patientId:string,episodeId:string,reviewId?:string|null):Promise<EpisodeClinicalReview|null>{
  const result=await db.query(`${SELECT} WHERE r.patient_id=$1 AND r.episode_id=$2${reviewId?' AND r.id=$3':''} ORDER BY r.effective_on DESC,r.version DESC LIMIT 1`,reviewId?[patientId,episodeId,reviewId]:[patientId,episodeId]);
  if(reviewId&&!result.rows.length)throw new HttpError(404,'A kijelölt epizód adatfelülvizsgálata nem található.');
  return result.rows[0]?reviewRow(result.rows[0]):null;
}
export async function loadEpisodeClinical(patientId:string,episodeId:string,db:Db=getDbPool()):Promise<EpisodeClinicalWorkspace>{
  const episode=(await db.query('SELECT id,reason,chief_complaint AS "chiefComplaint",status FROM patient_episodes WHERE patient_id=$1 AND id=$2',[patientId,episodeId])).rows[0];
  if(!episode)throw new HttpError(404,'A beteg epizódja nem található.');
  const history=(await db.query(`${SELECT} WHERE r.patient_id=$1 AND r.episode_id=$2 ORDER BY r.effective_on DESC,r.version DESC`,[patientId,episodeId])).rows.map(reviewRow) as EpisodeClinicalReview[];
  const current=history[0]??null;
  const patient=(await db.query(`SELECT ${PATIENT_REVIEW_FIELDS} FROM patients_full WHERE id=$1`,[patientId])).rows[0];
  const availableReviews=(await db.query(`SELECT DISTINCT ON(r.episode_id) r.id,r.episode_id AS "episodeId",r.effective_on::text AS "effectiveOn",r.version,r.recorded_at::text AS "recordedAt",e.case_title AS "caseTitle"
    FROM episode_clinical_reviews r JOIN patient_episodes e ON e.id=r.episode_id
    WHERE r.patient_id=$1 AND r.episode_id<>$2 ORDER BY r.episode_id,r.effective_on DESC,r.version DESC`,[patientId,episodeId])).rows;
  return {episode,current,history,latestVersion:Math.max(0,...history.map(r=>r.version)),
    template:current?.content??clinicalTemplate(patient,episode.reason),templateProvenance:current?'review':'legacy_unreviewed',availableReviews};
}

export async function saveEpisodeReview(patientId:string,episodeId:string,actor:string,command:EpisodeReviewCommand){
  const db=await getDbPool().connect();
  try{
    await db.query('BEGIN');
    if(!(await db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE',[patientId])).rowCount)throw new HttpError(404,'Beteg nem található.');
    const episode=(await db.query('SELECT reason FROM patient_episodes WHERE id=$1 AND patient_id=$2 FOR UPDATE',[episodeId,patientId])).rows[0];
    if(!episode)throw new HttpError(404,'A beteg epizódja nem található.');
    const previous=(await db.query('SELECT id,kind,episode_id,payload FROM prosthesis_clinical_events WHERE patient_id=$1 AND request_key=$2',[patientId,command.requestKey])).rows[0];
    if(previous){
      if(previous.kind!=='episode_clinical_reviewed'||previous.episode_id!==episodeId||canonical(previous.payload.command)!==canonical(command))throw new HttpError(409,'Az ismétlési kulcs más adatokhoz tartozik.');
      const review=reviewRow((await db.query(`${SELECT} WHERE r.event_id=$1`,[previous.id])).rows[0]);
      await db.query('COMMIT');return {review};
    }
    const version=Number((await db.query('SELECT COALESCE(max(version),0) AS version FROM episode_clinical_reviews WHERE episode_id=$1',[episodeId])).rows[0].version);
    if(command.expectedVersion!==version||command.expectedReason!==episode.reason){
      const error=new HttpError(409,'Az epizód klinikai adatai közben módosultak. Töltsd újra és ellenőrizd a friss változatot.','EPISODE_CLINICAL_CONFLICT');error.details={latestVersion:version};throw error;
    }
    if(command.sourceReviewId&&!(await db.query('SELECT id FROM episode_clinical_reviews WHERE id=$1 AND patient_id=$2',[command.sourceReviewId,patientId])).rowCount)throw new HttpError(400,'Az átvett előzmény nem a beteghez tartozik.');
    if(command.content.baselineStateId){
      const state=(await db.query(`SELECT e.occurred_on::text AS day FROM clinical_dental_states s JOIN prosthesis_active_events e ON e.id=s.event_id WHERE s.id=$1 AND s.patient_id=$2`,[command.content.baselineStateId,patientId])).rows[0];
      if(!state||state.day>command.effectiveOn)throw new HttpError(400,'A kiindulási státusz nem a beteghez vagy nem az adatfelvétel előtti időponthoz tartozik.');
    }
    const id=randomUUID(),eventId=randomUUID();
    await db.query(`INSERT INTO prosthesis_clinical_events(id,patient_id,episode_id,kind,occurred_on,time_precision,source,note,payload,recorded_by,request_key)
      VALUES($1,$2,$3,'episode_clinical_reviewed',$4,'day',$5,$6,$7::jsonb,$8,$9)`,[eventId,patientId,episodeId,command.effectiveOn,command.source,command.note,JSON.stringify({command,entityId:id}),actor,command.requestKey]);
    await db.query(`INSERT INTO episode_clinical_reviews(id,patient_id,episode_id,version,event_id,effective_on,source,note,content,source_review_id,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,[id,patientId,episodeId,version+1,eventId,command.effectiveOn,command.source,command.note,JSON.stringify(command.content),command.sourceReviewId,actor]);
    // The clinical timeline determines the current etiology, not the order of entry.
    const current=await selectedEpisodeReview(db,patientId,episodeId);
    await db.query('UPDATE patient_episodes SET reason=$3,auto_created=FALSE,snapshot_version=snapshot_version+1 WHERE id=$1 AND patient_id=$2',[episodeId,patientId,current!.content.reason]);
    const review=await selectedEpisodeReview(db,patientId,episodeId,id);
    await db.query('COMMIT');return {review:review!};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
