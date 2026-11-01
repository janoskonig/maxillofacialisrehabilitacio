import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { HttpError } from '@/lib/auth-server';
import { getUnassignedLegacyPlan, type EpisodeTreatmentPlanRecord, type JawTreatmentPlans } from '@/lib/episode-treatment-plan';
import { projectClinicalPlan, type ClinicalCommand } from './model';
import { baselineAt, loadClinicalStates } from './states';

type Db=Pick<PoolClient,'query'>;

// Shared by the editor and document export. Episode text columns are mirrors;
// a unified version is the authoritative document, including explicit clears.
export const EPISODE_PLAN_SELECT=`SELECT pe.id AS "episodeId",pe.patient_id AS "patientId",
  pe.case_title AS "caseTitle",pe.chief_complaint AS "chiefComplaint",pe.status,tt.label_hu AS "treatmentTypeLabel",
  pe.treatment_plan AS "treatmentPlan",pe.treatment_plan_upper AS "treatmentPlanUpper",pe.treatment_plan_lower AS "treatmentPlanLower",
  GREATEST(pe.treatment_plan_version,COALESCE(v.version,0)) AS version,
  p.jaw,p.id AS "prosthesisId",p.label AS "prosthesisLabel",
  v.id AS "planId",v.version AS "clinicalVersion",v.approved,v.baseline_state_id AS "baselineStateId",v.content,
  v.episode_plan_version AS "episodePlanVersion",e.occurred_on::text AS "occurredOn",e.source
  FROM patient_episodes pe
  LEFT JOIN treatment_types tt ON tt.id=pe.treatment_type_id
  LEFT JOIN prosthesis_episode_links l ON l.episode_id=pe.id
  LEFT JOIN prostheses p ON p.id=l.prosthesis_id
  LEFT JOIN LATERAL (SELECT * FROM prosthesis_plan_versions pv WHERE pv.episode_id=pe.id ORDER BY pv.version DESC LIMIT 1) v ON true
  LEFT JOIN prosthesis_active_events e ON e.id=v.event_id`;

export function episodePlanFromRow(row:any):EpisodeTreatmentPlanRecord {
  const texts:JawTreatmentPlans=row.episodePlanVersion!=null ? row.content.narratives : row;
  const plan:EpisodeTreatmentPlanRecord={episodeId:row.episodeId,patientId:row.patientId,version:row.version,
    treatmentPlan:texts.treatmentPlan??null,treatmentPlanUpper:texts.treatmentPlanUpper??null,treatmentPlanLower:texts.treatmentPlanLower??null,
    jaw:row.jaw??null,prosthesisId:row.prosthesisId??null,prosthesisLabel:row.prosthesisLabel??null,unified:row.episodePlanVersion!=null,clinicalPlan:null,legacyClinicalDescription:null};
  if(row.planId){
    plan.clinicalPlan={id:row.planId,version:row.clinicalVersion,approved:row.approved,baselineStateId:row.baselineStateId,
      treatments:row.content.treatments??[],occurredOn:row.occurredOn,source:row.source};
    if(row.episodePlanVersion==null && row.content.description){
      const key=row.jaw==='felso'?'treatmentPlanUpper':row.jaw==='also'?'treatmentPlanLower':null;
      if(key&&!plan[key])plan[key]=row.content.description;
      else if(row.content.description!==(key?plan[key]:plan.treatmentPlan))plan.legacyClinicalDescription=row.content.description;
    }
  }
  return plan;
}

export async function loadEpisodeTreatmentPlan(db:Db,episodeId:string,details=false) {
  const row=(await db.query(`${EPISODE_PLAN_SELECT} WHERE pe.id=$1`,[episodeId])).rows[0];
  if(!row)return null;
  const plan=episodePlanFromRow(row);
  if(details){
    const [states,history]=await Promise.all([
      loadClinicalStates(db,row.patientId),
      db.query(`SELECT p.id,p.version,p.approved,e.occurred_on::text AS "occurredOn",e.source,e.recorded_at AS "recordedAt",
        u.email AS recorder,p.content->>'description' AS description,p.content->'previousNarratives' AS "previousNarratives" FROM prosthesis_plan_versions p
        JOIN prosthesis_active_events e ON e.id=p.event_id JOIN users u ON u.id=e.recorded_by
        WHERE p.episode_id=$1 ORDER BY p.version DESC`,[episodeId]),
    ]);
    plan.states=states.map(s=>({id:s.id,occurred_on:s.occurred_on,note:s.note,source:s.source}));
    plan.history=history.rows;
  }
  return plan;
}

export class TreatmentPlanConflict extends HttpError {
  constructor(public plan:EpisodeTreatmentPlanRecord){super(409,'A kezelési tervet közben más módosította. Tekintse át a friss változatot.');}
}

/** Caller holds the patient lock. Every writer appends a version and updates
 * mirrors atomically. A plan never changes actual states, work or bookings. */
export async function persistEpisodeTreatmentPlan(db:Db,patientId:string,actor:string,c:Extract<ClinicalCommand,{action:'plan'}>) {
  const ep=(await db.query('SELECT id FROM patient_episodes WHERE id=$1 AND patient_id=$2 FOR UPDATE',[c.episodeId,patientId])).rows[0];
  if(!ep)throw new HttpError(404,'A beteg ellátási epizódja nem található');
  const previous=(await loadEpisodeTreatmentPlan(db,c.episodeId))!;
  if(c.expectedVersion!==undefined&&c.expectedVersion!==previous.version)throw new TreatmentPlanConflict(previous);
  const narratives:Required<JawTreatmentPlans>={treatmentPlan:previous.treatmentPlan,treatmentPlanUpper:previous.treatmentPlanUpper,treatmentPlanLower:previous.treatmentPlanLower,...c.narratives};
  const ownKey=previous.jaw==='felso'?'treatmentPlanUpper':previous.jaw==='also'?'treatmentPlanLower':null;
  if(!c.narratives&&c.description!==undefined)narratives[ownKey??'treatmentPlan']=c.description||null;
  if(ownKey&&c.narratives){
    const otherKey=ownKey==='treatmentPlanUpper'?'treatmentPlanLower':'treatmentPlanUpper';
    if(narratives[otherKey]!==previous[otherKey])throw new HttpError(400,'Az epizódban csak a saját fogpótlás állcsontjának terve módosítható');
  }
  if(c.prosthesisIds&&(c.prosthesisIds.length!==1||c.prosthesisIds[0]!==previous.prosthesisId))throw new HttpError(409,'A terv az epizód saját fogpótlásához tartozzon');
  const devices=previous.prosthesisId?(await db.query('SELECT * FROM prostheses WHERE id=$1 AND patient_id=$2',[previous.prosthesisId,patientId])).rows:[];
  const baselineStateId=c.baselineStateId===undefined?previous.clinicalPlan?.baselineStateId??null:c.baselineStateId;
  const baseline=baselineStateId?await baselineAt(db,patientId,baselineStateId,c.occurredOn):null;
  const treatments=c.treatments??previous.clinicalPlan?.treatments??[];
  if(previous.jaw&&treatments.some(t=>(t.toothNumber<30)!==(previous.jaw==='felso')))throw new HttpError(400,'A beavatkozás nem az epizód állcsontjához tartozik');
  const description=ownKey?narratives[ownKey]??'':[
    narratives.treatmentPlanUpper&&`Felső állcsont: ${narratives.treatmentPlanUpper}`,
    narratives.treatmentPlanLower&&`Alsó állcsont: ${narratives.treatmentPlanLower}`,
    getUnassignedLegacyPlan(narratives),
  ].filter(Boolean).join('\n\n');
  if(c.approved&&(!baseline||devices.length!==1||!description.trim()))throw new HttpError(409,'Jóváhagyáshoz a saját fogpótlás, dokumentált kiindulási státusz és tervleírás szükséges');
  const phases=await db.query(`SELECT w.*,COALESCE((SELECT jsonb_agg(prosthesis_id) FROM work_phase_prostheses WHERE work_phase_id=w.id),'[]') AS prosthesis_ids
    FROM episode_work_phases w WHERE w.episode_id=$1 ORDER BY COALESCE(w.seq,w.pathway_order_index),w.id`,[c.episodeId]);
  const id=randomUUID(),eventId=randomUUID(),version=previous.version+1;
  const content={description,narratives,treatments,devices,workPhases:phases.rows,baseline,target:baseline?projectClinicalPlan(baseline,treatments,devices):null,
    ...(!previous.unified?{previousNarratives:{treatmentPlan:previous.treatmentPlan,treatmentPlanUpper:previous.treatmentPlanUpper,treatmentPlanLower:previous.treatmentPlanLower}}:{})};
  await db.query(`INSERT INTO prosthesis_clinical_events(id,patient_id,episode_id,kind,occurred_on,occurred_at,time_precision,source,note,payload,recorded_by,request_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,[eventId,patientId,c.episodeId,c.approved?'plan_approved':'plan_draft',c.occurredOn,c.occurredAt,c.precision,c.source,c.note,JSON.stringify({command:c,entityId:id}),actor,c.requestKey]);
  await db.query(`INSERT INTO prosthesis_plan_versions(id,patient_id,episode_id,baseline_state_id,version,event_id,content,approved,episode_plan_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$5)`,[id,patientId,c.episodeId,baselineStateId,version,eventId,JSON.stringify(content),c.approved]);
  await db.query(`UPDATE patient_episodes SET treatment_plan=$2,treatment_plan_upper=$3,treatment_plan_lower=$4,treatment_plan_version=$5 WHERE id=$1`,[c.episodeId,narratives.treatmentPlan,narratives.treatmentPlanUpper,narratives.treatmentPlanLower,version]);
  return {id,eventId};
}
