import { randomUUID } from 'crypto';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { budapestToday } from '@/lib/aftercare/model';
import { canonical } from '@/lib/prosthesis-lifecycle/model';
import { episodeContext,type EpisodeContextCommand } from '@/lib/episode-overview';
import { probeColumnExists } from '@/lib/schema-probe';

export async function saveEpisodeContext(patientId:string,episodeId:string,actor:string,command:EpisodeContextCommand){
  const db=await getDbPool().connect();
  try{
    await db.query('BEGIN');
    if(!(await db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE',[patientId])).rowCount)throw new HttpError(404,'Beteg nem található.');
    const row=(await db.query('SELECT chief_complaint AS "chiefComplaint",case_title AS "caseTitle",trigger_type AS "triggerType" FROM patient_episodes WHERE id=$1 AND patient_id=$2 FOR UPDATE',[episodeId,patientId])).rows[0];
    if(!row)throw new HttpError(404,'A beteg epizódja nem található.');
    const current=episodeContext(row);
    const previous=(await db.query('SELECT id,kind,episode_id,payload FROM prosthesis_clinical_events WHERE patient_id=$1 AND request_key=$2',[patientId,command.requestKey])).rows[0];
    if(previous){
      if(previous.kind!=='episode_context_updated'||previous.episode_id!==episodeId||canonical(previous.payload.command)!==canonical(command))throw new HttpError(409,'Az ismétlési kulcs más adatokhoz tartozik.');
      await db.query('COMMIT');return{context:current,eventId:previous.id};
    }
    if(canonical(current)!==canonical(episodeContext(command.expected))){
      const error=new HttpError(409,'Az epizód alapadatait közben módosították. Ellenőrizd a friss adatokat a saját szöveged mentése előtt.','EPISODE_CONTEXT_CONFLICT');error.details={context:current};throw error;
    }
    const next=episodeContext(command),eventId=randomUUID();
    // Kézi pontosítás után a betegfelvételi adatok későbbi szinkronja nem írhatja felül.
    const manual=await probeColumnExists(db,'patient_episodes','auto_created')?',auto_created=FALSE':'';
    await db.query(`UPDATE patient_episodes SET chief_complaint=$3,case_title=$4,trigger_type=$5${manual} WHERE id=$1 AND patient_id=$2`,[episodeId,patientId,next.chiefComplaint,next.caseTitle,next.triggerType]);
    await db.query(`INSERT INTO prosthesis_clinical_events(id,patient_id,episode_id,kind,occurred_on,time_precision,source,note,payload,recorded_by,request_key)
      VALUES($1,$2,$3,'episode_context_updated',$4,'day','Epizód alapadatainak szerkesztése',$5,$6::jsonb,$7,$8)`,[eventId,patientId,episodeId,budapestToday(),'Az epizód indokának vagy megnevezésének pontosítása',JSON.stringify({command,before:current,after:next}),actor,command.requestKey]);
    await db.query('COMMIT');return{context:next,eventId};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
