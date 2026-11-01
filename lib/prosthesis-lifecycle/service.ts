import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { addDays, budapestToday, observationEnd } from '@/lib/aftercare/model';
import { createEpisodeVisit } from '@/lib/episode-visits';
import { canonical, clinicalCommandSchema, emptyLayers, replayStates, type ClinicalCommand } from './model';

import { baselineAt, loadClinicalStates } from './states';
import { EPISODE_PLAN_SELECT, episodePlanFromRow, persistEpisodeTreatmentPlan } from './plans';
import { FINANCING_SELECT } from '@/lib/episode-financing/service';
import type { FinancingEvent } from '@/lib/episode-financing/model';
export { loadClinicalStates } from './states';

type Db = Pick<PoolClient,'query'>;
const fail = (message:string, status=409):never => { throw new HttpError(status,message); };
async function one(db:Db, sql:string, values:unknown[], message='A beteghez tartozó rekord nem található') {
  const r = await db.query(sql,values);
  return r.rows[0] ?? fail(message,404);
}
async function device(db:Db, patientId:string, id:string) {
  return one(db,'SELECT *,delivery_date::text FROM prostheses WHERE patient_id=$1 AND id=$2',[patientId,id]);
}
async function episode(db:Db, patientId:string, id:string) {
  return one(db,'SELECT * FROM patient_episodes WHERE patient_id=$1 AND id=$2',[patientId,id]);
}
async function newEpisode(db:Db,patientId:string,actor:string,parentId:string|null,label:string,day:string,chiefComplaint?:string) {
  const parent=parentId?await episode(db,patientId,parentId):null;
  const context=parent??(await db.query('SELECT * FROM patient_episodes WHERE patient_id=$1 ORDER BY opened_at DESC LIMIT 1',[patientId])).rows[0];
  if(!context)fail('Az ellátás indokához válasszon előzményepizódot');
  const r=await db.query(`INSERT INTO patient_episodes(patient_id,reason,chief_complaint,case_title,status,opened_at,parent_episode_id,trigger_type,created_by,treatment_plan,treatment_plan_upper,treatment_plan_lower)
    VALUES($1,$2,$3,$4,'open',$5::date::timestamp AT TIME ZONE 'Europe/Budapest',$6,'egyeb',$7,$8,$9,$10) RETURNING id`,[patientId,context.reason,chiefComplaint?.trim()||context.chief_complaint||'',label,day,parentId,actor,context.treatment_plan??null,context.treatment_plan_upper??null,context.treatment_plan_lower??null]);
  return r.rows[0].id as string;
}
async function clinicalWork(db:Db,patientId:string,id:string) {
  const w=await db.query(`SELECT w.*,false AS is_repair_work,
    COALESCE((SELECT jsonb_agg(prosthesis_id) FROM work_phase_prostheses WHERE work_phase_id=w.id),'[]') AS prosthesis_ids,
    COALESCE((SELECT jsonb_agg(requires_phase_id) FROM clinical_work_dependencies WHERE work_phase_id=w.id),'[]') AS requires_phase_ids
    FROM episode_work_phases w JOIN patient_episodes e ON e.id=w.episode_id WHERE e.patient_id=$1 AND w.id=$2`,[patientId,id]);
  if(w.rows.length)return w.rows[0];
  return one(db,`SELECT w.*,true AS is_repair_work,'prosthesis' AS clinical_scope,jsonb_build_array(r.prosthesis_id) AS prosthesis_ids
    FROM prosthesis_repair_work_phases w JOIN prosthesis_repair_cases r ON r.id=w.repair_case_id WHERE w.patient_id=$1 AND w.id=$2`,[patientId,id]);
}
async function state(db:Db, patientId:string, id:string) {
  return one(db,`SELECT s.*,e.occurred_on::text,e.occurred_at,e.recorded_at FROM clinical_dental_states s
    JOIN prosthesis_active_events e ON e.id=s.event_id WHERE s.patient_id=$1 AND s.id=$2`,[patientId,id]);
}
async function append(db:Db, patientId:string, actor:string, c:ClinicalCommand, kind:string,
  context:{ episodeId?:string|null; prosthesisId?:string|null; entityId?:string; extra?:Record<string,unknown> } = {}) {
  if (c.supersedesId) {
    const previous = await one(db,'SELECT * FROM prosthesis_active_events WHERE patient_id=$1 AND id=$2',[patientId,c.supersedesId]);
    if (previous.kind!==kind || previous.prosthesis_id!==(context.prosthesisId??null) || previous.episode_id!==(context.episodeId??null)) fail('A korrekció másik klinikai eseményhez tartozik');
    if (kind==='visit' && previous.payload.command.appointmentId && previous.payload.command.appointmentId !== (c as Extract<ClinicalCommand,{action:'visit'}>).appointmentId) fail('A már kapcsolt vizit nem helyezhető át másik időpontra');
  }
  const id = randomUUID();
  const entityId = context.entityId ?? id;
  await db.query(`INSERT INTO prosthesis_clinical_events(id,patient_id,episode_id,prosthesis_id,kind,occurred_on,occurred_at,time_precision,source,note,payload,recorded_by,request_key,supersedes_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
  [id,patientId,context.episodeId??null,context.prosthesisId??null,kind,c.occurredOn,c.occurredAt,c.precision,c.source,c.note,
    JSON.stringify({ command:c, entityId, ...context.extra }),actor,c.requestKey,c.supersedesId??null]);
  return { id:entityId, eventId:id };
}
async function insertDevice(db:Db, patientId:string, actor:string, c:Extract<ClinicalCommand,{action:'register'|'review_mapping'}>) {
  if (c.episodeId) await episode(db,patientId,c.episodeId);
  const upper = c.jaw==='felso';
  if (c.positions.some(p => upper !== (p.tooth<30))) fail('A pozíció nem a kiválasztott állcsonthoz tartozik',400);
  // The selected episode is provenance, never a container for another appliance.
  const ownLink=c.action==='review_mapping'&&c.episodeId ? await db.query("SELECT 1 FROM prosthesis_episode_links WHERE episode_id=$1 AND prosthesis_id=$2 AND purpose='construction'",[c.episodeId,c.prosthesisId]):{rows:[]};
  let actualEpisodeId:string|null=null;
  if(c.episodeMode==='existing'){
    if(c.action!=='register'||c.origin!=='local'||!c.episodeId)fail('Az epizódhoz helyben készülő, új fogpótlás kapcsolható.',400);
    const ep=await episode(db,patientId,c.episodeId!);
    if(ep.status!=='open')fail('Ehhez nyitott, még fogpótlás nélküli epizód szükséges.');
    if((await db.query('SELECT 1 FROM prosthesis_episode_links WHERE episode_id=$1 UNION ALL SELECT 1 FROM prostheses WHERE episode_id=$1',[ep.id])).rows.length)fail('Az epizódnak már van fogpótlása. Másik készülékhez új epizód szükséges.');
    actualEpisodeId=ep.id;
  }else if(c.origin==='local')actualEpisodeId=ownLink.rows.length?c.episodeId:await newEpisode(db,patientId,actor,c.episodeId,`${c.jaw==='felso'?'Felső':'Alsó'} ${c.role==='provisional'?'ideiglenes':'fogpótlás'} – ${c.label}`,c.occurredOn,c.episodeReason);
  const values = [patientId,actualEpisodeId,c.jaw,c.prosthesisType,c.label,actor,c.origin,c.role,JSON.stringify(c.specification),JSON.stringify(c.positions)];
  if (c.action==='review_mapping') {
    const p = await device(db,patientId,c.prosthesisId);
    if (!p.mapping_review_required) fail('A megfeleltetés már megtörtént; a történeti azonosság nem írható át');
    await db.query("DELETE FROM prosthesis_episode_links WHERE prosthesis_id=$1 AND purpose='construction'",[p.id]);
    await db.query(`UPDATE prostheses SET episode_id=$2,jaw=$3,prosthesis_type=$4,label=$5,origin=$7,role=$8,specification=$9,positions=$10,mapping_review_required=false WHERE id=$11 AND patient_id=$1`,[...values,c.prosthesisId]);
    return c.prosthesisId;
  }
  const r = await db.query(`INSERT INTO prostheses(patient_id,episode_id,jaw,prosthesis_type,label,created_by,origin,role,specification,positions,baseline,original_plan,mapping_review_required)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{"unassessed":true}',
      COALESCE((SELECT jsonb_build_object('treatmentPlan',pe.treatment_plan,'treatmentPlanUpper',pe.treatment_plan_upper,
        'treatmentPlanLower',pe.treatment_plan_lower,'sourceEpisodeId',pe.id,'capturedAt',now(),
        'workPhases',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY COALESCE(w.seq,w.pathway_order_index),w.id)
          FROM episode_work_phases w WHERE w.episode_id=pe.id),'[]'::jsonb))
        FROM patient_episodes pe WHERE pe.id=COALESCE($11::uuid,$2::uuid)),'{}'::jsonb),false) RETURNING id`,[...values,c.episodeId]);
  return r.rows[0].id as string;
}
async function validateMilestoneChronology(db:Db, p:any) {
  const r = await db.query(`SELECT kind,occurred_on::text AS day,occurred_at FROM prosthesis_active_events
    WHERE prosthesis_id=$1 AND kind IN ('lab_completed','accepted','delivered','in_use','retired')`,[p.id]);
  const order = ['lab_completed','accepted','delivered','in_use','retired'];
  for (let i=0;i<order.length;i++) for (let j=i+1;j<order.length;j++) {
    const a=r.rows.find(x=>x.kind===order[i]), b=r.rows.find(x=>x.kind===order[j]);
    if (a && b && (a.day>b.day || (a.day===b.day && a.occurred_at && b.occurred_at && a.occurred_at>b.occurred_at))) fail('A klinikai mérföldkövek időrendje ellentmondásos');
  }
  const delivery=r.rows.find(x=>x.kind==='delivered')?.day ?? (p.delivery_date ? String(p.delivery_date).slice(0,10) : null);
  if (delivery) {
    const visits = await db.query(`SELECT e.payload FROM prosthesis_active_events e WHERE e.patient_id=$1 AND e.kind='visit'
      AND e.occurred_on<$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'command'->'links') l
        WHERE l->>'prosthesisId'=$3 AND l->>'phase' IN ('aftercare','repair'))`,[p.patient_id,delivery,p.id]);
    if (visits.rows.length) fail('Az új átadási dátum korábbi gondozási eseménnyel ütközik');
  }
}
async function closeIfAccepted(db:Db, patientId:string, actor:string, c:ClinicalCommand, episodeId:string) {
  const ep=await episode(db,patientId,episodeId);
  const goals=await db.query(`SELECT l.*,e.id AS acceptance_id,e.occurred_on::text AS accepted_on
    FROM prosthesis_episode_links l LEFT JOIN prosthesis_active_events e
      ON e.prosthesis_id=l.prosthesis_id AND e.kind='accepted' WHERE l.episode_id=$1 AND l.purpose='construction'`,[episodeId]);
  if (!goals.rows.length || goals.rows.some(g=>!g.acceptance_id) || ep.status==='closed') return;
  const day=goals.rows.map(g=>g.accepted_on).sort().at(-1)!;
  // Closure is separately audited, with the exact acceptance versions and actors.
  const closureCommand={ ...c, requestKey:randomUUID(), occurredOn:day, occurredAt:null, precision:'day', supersedesId:undefined } as ClinicalCommand;
  const ev=await append(db,patientId,actor,closureCommand,'episode_closed',{episodeId,extra:{acceptanceEvents:goals.rows}});
  await db.query(`INSERT INTO clinical_episode_closures(episode_id,event_id,acceptance_events,previous_closed_at) VALUES($1,$2,$3,$4)`,[episodeId,ev.eventId,JSON.stringify(goals.rows),ep.closed_at]);
  await db.query(`UPDATE patient_episodes SET status='closed',closed_at=$2::date::timestamp AT TIME ZONE 'Europe/Budapest' WHERE id=$1`,[episodeId,day]);
  await db.query(`UPDATE slot_intents SET state='cancelled' WHERE episode_id=$1 AND state='open'`,[episodeId]);
}
async function addTask(db:Db, patientId:string, prosthesisId:string, eventId:string, day:string, purpose:string) {
  await db.query(`INSERT INTO clinical_followup_tasks(patient_id,prosthesis_id,goal_id,source_event_id,due_on,purpose)
    SELECT $1,$2,(SELECT id FROM episode_prosthesis_goals WHERE definitive_prosthesis_id=$2 LIMIT 1),$3,$4,$5
    ON CONFLICT(source_event_id,prosthesis_id,purpose) DO NOTHING`,[patientId,prosthesisId,eventId,day,purpose]);
}
async function assertDocuments(db:Db, patientId:string, ids:string[]) {
  if (!ids.length) return;
  const r=await db.query('SELECT id FROM patient_documents WHERE patient_id=$1 AND id=ANY($2::uuid[])',[patientId,ids]);
  if (r.rows.length!==new Set(ids).size) fail('Másik beteg dokumentuma nem kapcsolható',400);
}

/** Patient lock serializes clinical chronology and concurrent request-key retries. */
export async function executeClinicalCommand(patientId:string, actor:string, c:ClinicalCommand) {
  if (c.occurredOn>budapestToday() || (c.occurredAt && new Date(c.occurredAt).getTime()>Date.now())) fail('Jövőbeli esemény nem dokumentálható megtörténtként',400);
  const db=await getDbPool().connect();
  try {
    await db.query('BEGIN');
    const patient=await one(db,'SELECT id,halal_datum FROM patients WHERE id=$1 FOR UPDATE',[patientId]);
    if (patient.halal_datum && c.occurredOn>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date(patient.halal_datum))) fail('A klinikai esemény nem lehet a halálozás után');
    await db.query("SELECT set_config('app.aftercare_actor',$1,true)",[actor]);
    const retry=await db.query('SELECT id,payload FROM prosthesis_clinical_events WHERE patient_id=$1 AND request_key=$2',[patientId,c.requestKey]);
    if (retry.rows.length) {
      if (canonical(retry.rows[0].payload.command)!==canonical(c)) fail('Az ismétlési kulcs más tartalomhoz tartozik');
      await db.query('COMMIT');
      return { id:retry.rows[0].payload.entityId, eventId:retry.rows[0].id };
    }
    const result=await perform(db,patientId,actor,c);
    await db.query('COMMIT');
    return result;
  } catch(e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}

async function perform(db:PoolClient, patientId:string, actor:string, c:ClinicalCommand):Promise<{id:string;eventId:string}> {
  switch(c.action) {
    case 'register': case 'review_mapping': {
      const id=await insertDevice(db,patientId,actor,c);
      const p=await device(db,patientId,id);
      return append(db,patientId,actor,c,c.action==='register'?'registered':'mapping_reviewed',{prosthesisId:id,episodeId:p.episode_id,entityId:id});
    }
    case 'set_goal': {
      const ep=await episode(db,patientId,c.episodeId), p=await device(db,patientId,c.prosthesisId);
      if (p.episode_id!==ep.id || p.origin!=='local') fail('Az epizód saját fogpótlását válassza');
      if (ep.status==='closed') {
        const accepted=await db.query("SELECT id FROM prosthesis_active_events WHERE prosthesis_id=$1 AND kind='accepted'",[p.id]);
        if (!accepted.rows.length) fail('Lezárt epizódhoz csak már dokumentált klinikai elfogadással kapcsolható utólag pótlási cél');
      }
      if (c.baselineStateId) await baselineAt(db,patientId,c.baselineStateId,c.occurredOn);
      const r=await db.query(`INSERT INTO episode_prosthesis_goals(patient_id,episode_id,jaw,definitive_prosthesis_id,baseline_state_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(episode_id,jaw) DO UPDATE SET definitive_prosthesis_id=EXCLUDED.definitive_prosthesis_id,baseline_state_id=EXCLUDED.baseline_state_id RETURNING id`,[patientId,ep.id,p.jaw,p.id,c.baselineStateId,actor]);
      const ev=await append(db,patientId,actor,c,'goal_set',{episodeId:ep.id,prosthesisId:p.id,entityId:r.rows[0].id});
      await closeIfAccepted(db,patientId,actor,c,ep.id);
      return ev;
    }
    case 'milestone': {
      const p=await device(db,patientId,c.prosthesisId);
      const exists=await db.query('SELECT id FROM prosthesis_active_events WHERE prosthesis_id=$1 AND kind=$2',[p.id,c.milestone]);
      if (exists.rows.length && exists.rows[0].id!==c.supersedesId) fail('A mérföldkő már szerepel; korrekcióként rögzítse');
      const ev=await append(db,patientId,actor,c,c.milestone,{episodeId:p.episode_id,prosthesisId:p.id});
      await validateMilestoneChronology(db,p);
      if (c.milestone==='delivered') {
        await db.query('UPDATE prostheses SET delivery_date=$2,delivery_appointment_id=NULL WHERE id=$1',[p.id,c.occurredOn]);
        if (c.supersedesId) {
          // A correction may move due dates; old task records remain audit evidence.
          const old=await db.query('SELECT * FROM clinical_followup_tasks WHERE source_event_id=$1',[c.supersedesId]);
          if (old.rows.some(t=>t.completed_event_id||t.appointment_id)) fail('Foglalt vagy teljesített követés forrásdátumának módosítása felülvizsgálatot igényel');
        }
        await addTask(db,patientId,p.id,ev.eventId,observationEnd(c.occurredOn),'Háromhavi kontroll');
      }
      for (const f of c.followups) await addTask(db,patientId,p.id,ev.eventId,addDays(c.occurredOn,f.afterDays),f.purpose);
      if (c.milestone==='accepted' && p.episode_id) await closeIfAccepted(db,patientId,actor,c,p.episode_id);
      return ev;
    }
    case 'status': {
      if (c.episodeId) await episode(db,patientId,c.episodeId);
      if (c.prosthesisId) await device(db,patientId,c.prosthesisId);
      if (c.sourceEventId) {
        const source=await one(db,'SELECT kind,occurred_on::text FROM prosthesis_active_events WHERE patient_id=$1 AND id=$2',[patientId,c.sourceEventId]);
        if (!['visit','accepted','delivered','repair_completed'].includes(source.kind) || source.occurred_on>c.occurredOn) fail('A státuszváltozás forrása dokumentált korábbi eredmény legyen');
      }
      if (c.legacySnapshotId) {
        await one(db,'SELECT id FROM dental_status_snapshots WHERE patient_id=$1 AND id=$2',[patientId,c.legacySnapshotId]);
      }
      const id=randomUUID();
      const ev=await append(db,patientId,actor,c,'status',{episodeId:c.episodeId,prosthesisId:c.prosthesisId,entityId:id});
      await db.query(`INSERT INTO clinical_dental_states(id,patient_id,event_id,mode,layers,expected_before,legacy_snapshot_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,patientId,ev.eventId,c.mode,JSON.stringify(c.layers),c.expectedBefore?JSON.stringify(c.expectedBefore):null,c.legacySnapshotId??null]);
      return ev;
    }
    case 'plan': return persistEpisodeTreatmentPlan(db,patientId,actor,c);
    case 'visit': {
      if (c.appointmentId) {
        const a=await one(db,`SELECT a.*,COALESCE(a.start_time,s.start_time)::timestamptz AS clinical_start FROM appointments a
          LEFT JOIN available_time_slots s ON s.id=a.time_slot_id WHERE a.patient_id=$1 AND a.id=$2 FOR UPDATE OF a`,[patientId,c.appointmentId]);
        if (!['completed','unsuccessful'].includes(a.appointment_status)) fail('Lemondott vagy elmulasztott időpont nem dokumentálható megtörtént vizitként');
        if (new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date(a.clinical_start))!==c.occurredOn) fail('A vizit napja eltér a kapcsolt időponttól');
        const prior=await db.query(`SELECT id FROM prosthesis_active_events WHERE patient_id=$1 AND kind='visit' AND payload->'command'->>'appointmentId'=$2`,[patientId,c.appointmentId]);
        if (prior.rows.some(v=>v.id!==c.supersedesId)) fail('Az időpontnak már van dokumentációja; válassza a korrekciót');
        const legacy=await db.query('SELECT id FROM prosthesis_care_encounters WHERE appointment_id=$1',[c.appointmentId]);
        if (legacy.rows.length) fail('Az időpont gondozási dokumentációja már létezik a korábbi vizitűrlapon');
      }
      for (const l of c.links) {
        const p=await device(db,patientId,l.prosthesisId);
        const delivery=await db.query(`SELECT delivery_date::text AS day FROM prostheses WHERE id=$1`,[p.id]);
        if (l.phase!=='construction' && (!delivery.rows[0].day || delivery.rows[0].day>c.occurredOn)) fail('Gondozáshoz előző átadás szükséges');
        if (l.phase==='construction' && delivery.rows[0].day && delivery.rows[0].day<c.occurredOn) fail('Átadás után gondozásként vagy javításként dokumentálja a munkát');
        if (l.repairCaseId) {
          const repair=await one(db,'SELECT * FROM prosthesis_repair_cases WHERE patient_id=$1 AND id=$2',[patientId,l.repairCaseId]);
          if (repair.prosthesis_id!==p.id) fail('A javítás másik fogpótláshoz tartozik');
          await assertRepairOpen(db,repair,c.occurredOn);
        } else if (l.phase==='repair') fail('Javítási tevékenységhez javítási ügy szükséges');
        if (l.workPhaseId) {
          const w=await clinicalWork(db,patientId,l.workPhaseId);
          if (w.clinical_scope!=='episode' && !w.prosthesis_ids.includes(p.id)) fail('A munkafázis nincs a fogpótláshoz kapcsolva');
          if (w.repair_case_id && w.repair_case_id!==l.repairCaseId) fail('A munkafázis másik javításhoz tartozik');
          for(const requiredId of w.requires_phase_ids){const required=await clinicalWork(db,patientId,requiredId);
            if(required.status!=='completed'||!required.completed_at||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date(required.completed_at))>c.occurredOn)fail('A munkafázis kifejezett előfeltétele még nem teljesült az esemény napján');}
        }
      }
      const ev=await append(db,patientId,actor,c,'visit');
      for (const l of c.links) {
        for (const f of l.followups) await addTask(db,patientId,l.prosthesisId,ev.eventId,addDays(c.occurredOn,f.afterDays),f.purpose);
        for (const taskId of l.completedTaskIds) {
          const t=await one(db,'SELECT * FROM clinical_followup_tasks WHERE patient_id=$1 AND id=$2',[patientId,taskId]);
          if (t.prosthesis_id!==l.prosthesisId || l.outcome!=='completed') fail('A kontroll csak saját, teljesített tevékenységgel zárható');
          const source=await one(db,'SELECT occurred_on::text FROM prosthesis_active_events WHERE id=$1',[t.source_event_id]);
          if (source.occurred_on>c.occurredOn || (t.appointment_id && t.appointment_id!==c.appointmentId)) fail('A kontroll másik időponthoz vagy későbbi forráshoz kapcsolódik');
          const completion=t.completed_event_id ? await db.query('SELECT id FROM prosthesis_active_events WHERE id=$1',[t.completed_event_id]):{rows:[]};
          if (completion.rows.length && t.completed_event_id!==c.supersedesId) fail('A kontroll már teljesült');
          await db.query('UPDATE clinical_followup_tasks SET completed_event_id=$2 WHERE id=$1',[taskId,ev.eventId]);
        }
      }
      // Results remain per prosthesis. Only a wholly successful shared phase completes.
      const phaseIds=new Set(c.links.map(l=>l.workPhaseId).filter((id):id is string=>!!id));
      for (const phaseId of Array.from(phaseIds)) {
        const phase=await clinicalWork(db,patientId,phaseId);
        if(phase.is_repair_work){
          const latest=await db.query(`SELECT e.payload,e.occurred_on::text AS day FROM prosthesis_active_events e WHERE e.patient_id=$1 AND e.kind='visit'
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'command'->'links') l WHERE l->>'workPhaseId'=$2)
            ORDER BY e.occurred_on DESC,e.occurred_at DESC NULLS LAST,e.recorded_at DESC LIMIT 1`,[patientId,phaseId]);
          const done=latest.rows[0].payload.command.links.filter((l:any)=>l.workPhaseId===phaseId).every((l:any)=>l.outcome==='completed');
          await db.query(`UPDATE prosthesis_repair_work_phases SET status=$2,completed_at=CASE WHEN $2='completed' THEN $3::date::timestamp AT TIME ZONE 'Europe/Budapest' ELSE NULL END,last_event_id=$4 WHERE id=$1`,[phaseId,done?'completed':'pending',latest.rows[0].day,ev.eventId]);
          continue;
        }
        const bindings=await db.query('SELECT prosthesis_id FROM work_phase_prostheses WHERE work_phase_id=$1',[phaseId]);
        const events=await db.query(`SELECT payload,occurred_on::text AS day FROM prosthesis_active_events WHERE patient_id=$1 AND kind='visit'
          ORDER BY occurred_on,occurred_at NULLS FIRST,recorded_at`,[patientId]);
        const outcomes=new Map<string,{outcome:string;day:string}>();
        for (const e of events.rows) for (const link of e.payload.command.links) if (link.workPhaseId===phaseId) outcomes.set(link.prosthesisId,{outcome:link.outcome,day:e.day});
        const required=bindings.rows.length ? bindings.rows.map(x=>x.prosthesis_id) : Array.from(outcomes.keys());
        const completed=required.every(id=>outcomes.get(id)?.outcome==='completed');
        const day=Array.from(outcomes.values()).map(x=>x.day).sort().at(-1);
        await db.query(`UPDATE episode_work_phases SET status=$2::varchar,completed_at=CASE WHEN $2::varchar='completed' THEN $3::date::timestamp AT TIME ZONE 'Europe/Budapest' ELSE NULL END WHERE id=$1`,[phaseId,completed?'completed':'pending',day]);
      }
      return ev;
    }
    case 'repair': {
      const p=await device(db,patientId,c.prosthesisId);
      if (!p.delivery_date || p.delivery_date>c.occurredOn) fail('Javítási ügyhöz dokumentált korábbi átadás szükséges');
      await baselineAt(db,patientId,c.baselineStateId,c.occurredOn);
      await assertDocuments(db,patientId,c.documentIds);
      const repairEpisodeId=await newEpisode(db,patientId,actor,p.episode_id,`Javítás – ${p.label}: ${c.reason.slice(0,120)}`,c.occurredOn,c.reason);
      await db.query("INSERT INTO prosthesis_episode_links(episode_id,prosthesis_id,purpose) VALUES($1,$2,'repair')",[repairEpisodeId,p.id]);
      const id=randomUUID(), ev=await append(db,patientId,actor,c,'repair_opened',{prosthesisId:p.id,episodeId:repairEpisodeId,entityId:id});
      await db.query(`INSERT INTO prosthesis_repair_cases(id,patient_id,prosthesis_id,baseline_state_id,opened_event_id,reason,plan,documents,laboratory_tasks,episode_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,patientId,p.id,c.baselineStateId,ev.eventId,c.reason,c.plan,JSON.stringify(c.documentIds),JSON.stringify(c.laboratoryTasks),repairEpisodeId]);
      return ev;
    }
    case 'repair_result': {
      const r=await one(db,'SELECT * FROM prosthesis_repair_cases WHERE patient_id=$1 AND id=$2',[patientId,c.repairCaseId]);
      const p=await device(db,patientId,r.prosthesis_id);
      if (c.outcome==='remake') fail('Újrakészítéshez használja az új epizódot és fogpótlást létrehozó műveletet');
      await assertRepairOpen(db,r,c.occurredOn,true);
      const ev=await append(db,patientId,actor,c,'repair_completed',{episodeId:r.episode_id,prosthesisId:p.id,entityId:r.id});
      await db.query("UPDATE patient_episodes SET status='closed',closed_at=$2::date::timestamp AT TIME ZONE 'Europe/Budapest' WHERE id=$1",[r.episode_id,c.occurredOn]);
      return ev;
    }
    case 'remake': {
      const p=await device(db,patientId,c.prosthesisId);
      if (c.repairCaseId) {
        const r=await one(db,'SELECT * FROM prosthesis_repair_cases WHERE patient_id=$1 AND id=$2',[patientId,c.repairCaseId]);
        if (r.prosthesis_id!==p.id) fail('A javítás másik fogpótláshoz tartozik');
        await assertRepairOpen(db,r,c.occurredOn,true);
      }
      const old=p.episode_id ? await episode(db,patientId,p.episode_id) : null;
      const reason=old?.reason ?? (await one(db,'SELECT kezelesre_erkezes_indoka AS reason FROM patients_full WHERE id=$1',[patientId])).reason;
      if (!reason) fail('Új epizódhoz ellátási indok szükséges a betegkartonban');
      const ep=await db.query(`INSERT INTO patient_episodes(patient_id,reason,chief_complaint,case_title,parent_episode_id,trigger_type,status,opened_at,created_by)
        VALUES($1,$2,$3,$4,$5,'potlasvesztes','open',$6::date::timestamp AT TIME ZONE 'Europe/Budapest',$7) RETURNING id`,[patientId,reason,c.reason,c.label,p.episode_id,c.occurredOn,actor]);
      const pr=await db.query(`INSERT INTO prostheses(patient_id,episode_id,jaw,prosthesis_type,label,baseline,original_plan,created_by,origin,role,specification,positions,replaces_id,mapping_review_required)
        VALUES($1,$2,$3,$4,$5,'{"unassessed":true}','{}',$6,'local','definitive',$7,$8,$9,false) RETURNING id`,[patientId,ep.rows[0].id,p.jaw,p.prosthesis_type,c.label,actor,p.specification,JSON.stringify(p.positions),p.id]);
      await db.query(`INSERT INTO episode_prosthesis_goals(patient_id,episode_id,jaw,definitive_prosthesis_id,created_by) VALUES($1,$2,$3,$4,$5)`,[patientId,ep.rows[0].id,p.jaw,pr.rows[0].id,actor]);
      const ev=await append(db,patientId,actor,c,'remake_decided',{episodeId:ep.rows[0].id,prosthesisId:p.id,entityId:pr.rows[0].id,extra:{newEpisodeId:ep.rows[0].id,newProsthesisId:pr.rows[0].id}});
      if(c.repairCaseId)await db.query("UPDATE patient_episodes SET status='closed',closed_at=$2::date::timestamp AT TIME ZONE 'Europe/Budapest' WHERE id=(SELECT episode_id FROM prosthesis_repair_cases WHERE id=$1)",[c.repairCaseId,c.occurredOn]);
      return ev;
    }
    case 'work': return saveWork(db,patientId,actor,c);
    case 'book_task': {
      const t=await one(db,'SELECT * FROM clinical_followup_tasks WHERE patient_id=$1 AND id=$2',[patientId,c.taskId]);
      const completed=t.completed_event_id ? await db.query('SELECT id FROM prosthesis_active_events WHERE id=$1',[t.completed_event_id]):{rows:[]};
      if (completed.rows.length) fail('Teljesített kontroll nem foglalható át');
      if (c.appointmentId) {
        const a=await one(db,`SELECT a.appointment_status,(COALESCE(a.start_time,s.start_time) AT TIME ZONE 'Europe/Budapest')::date::text AS day
          FROM appointments a LEFT JOIN available_time_slots s ON s.id=a.time_slot_id WHERE a.patient_id=$1 AND a.id=$2`,[patientId,c.appointmentId]);
        if (a.appointment_status && !['completed','unsuccessful'].includes(a.appointment_status)) fail('Lemondott vagy elmulasztott időpontra nem foglalható kontroll');
        const source=await one(db,'SELECT occurred_on::text AS day FROM prosthesis_active_events WHERE id=$1',[t.source_event_id]);
        if (!a.day || a.day<source.day) fail('A kontroll időpontja a forrásesemény elé esik');
      }
      await db.query('UPDATE clinical_followup_tasks SET appointment_id=$2 WHERE id=$1',[t.id,c.appointmentId]);
      return append(db,patientId,actor,c,'followup_booked',{prosthesisId:t.prosthesis_id,entityId:t.id});
    }
  }
}
async function assertRepairOpen(db:Db, repair:any, day:string,closing=false) {
  const opened=await one(db,'SELECT occurred_on::text AS day FROM prosthesis_active_events WHERE id=$1',[repair.opened_event_id]);
  if (opened.day>day) fail('A javítás lezárása megelőzi a megnyitását');
  const done=await db.query(`SELECT id,occurred_on::text AS day FROM prosthesis_active_events WHERE patient_id=$1 AND kind IN ('repair_completed','remake_decided') AND payload->'command'->>'repairCaseId'=$2`,[repair.patient_id,repair.id]);
  if (done.rows.some(e=>closing||e.day<day)) fail('A javítási ügy ezen a klinikai napon már lezárt');
}
async function saveWork(db:PoolClient,patientId:string,actor:string,c:Extract<ClinicalCommand,{action:'work'}>) {
  if(c.repairCaseId)return saveRepairWork(db,patientId,actor,c);
  const episodeId=c.episodeId??fail('Elkészítési epizód szükséges');
  await episode(db,patientId,episodeId);
  for (const id of c.prosthesisIds) {
    const p=await device(db,patientId,id);
    if (p.episode_id!==c.episodeId) fail('A készítési munka fogpótlása másik epizódhoz tartozik');
  }
  let id=c.workPhaseId;
  if (id) {
    const w=await one(db,'SELECT * FROM episode_work_phases WHERE id=$1 AND episode_id=$2',[id,c.episodeId]);
    if (w.status==='completed') fail('Teljesített munka kapcsolatai nem írhatók át');
    await db.query('UPDATE episode_work_phases SET clinical_scope=$2,repair_case_id=$3 WHERE id=$1',[id,c.scope,c.repairCaseId??null]);
    await db.query('DELETE FROM work_phase_prostheses WHERE work_phase_id=$1',[id]);
    await db.query('DELETE FROM clinical_work_dependencies WHERE work_phase_id=$1',[id]);
  } else {
    const visit=await createEpisodeVisit(db,{episodeId,daysOffset:7});
    const r=await db.query(`INSERT INTO episode_work_phases(episode_id,work_phase_code,pathway_order_index,seq,pool,duration_minutes,default_days_offset,custom_label,visit_id,clinical_scope,repair_case_id)
      SELECT $1,'custom',COALESCE(MAX(pathway_order_index),-1)+1,COALESCE(MAX(seq),-1)+1,'work',30,7,$2,$3,$4,$5 FROM episode_work_phases WHERE episode_id=$1 RETURNING id`,[c.episodeId,c.label,visit.id,c.scope,c.repairCaseId??null]);
    id=r.rows[0].id;
  }
  for (const p of c.prosthesisIds) await db.query(`INSERT INTO work_phase_prostheses(work_phase_id,prosthesis_id,goal_id) SELECT $1,$2,(SELECT g.id FROM episode_prosthesis_goals g JOIN prostheses p ON p.jaw=g.jaw AND p.episode_id=g.episode_id WHERE g.episode_id=$3 AND p.id=$2)`,[id,p,c.episodeId]);
  for (const required of c.requiresPhaseIds) {
    await one(db,'SELECT id FROM episode_work_phases WHERE id=$1 AND episode_id=$2',[required,c.episodeId]);
    const cycle=await db.query(`WITH RECURSIVE chain(id) AS (SELECT $1::uuid UNION SELECT d.requires_phase_id FROM clinical_work_dependencies d JOIN chain c ON c.id=d.work_phase_id) SELECT 1 FROM chain WHERE id=$2`,[required,id]);
    if (cycle.rows.length) fail('Körkörös munkafázis-függőség');
    await db.query('INSERT INTO clinical_work_dependencies(work_phase_id,requires_phase_id) VALUES($1,$2)',[id,required]);
  }
  if (c.pathwayId) {
    if (c.prosthesisIds.length!==1) fail('Sablonhoz egy konkrét fogpótlást válasszon');
    await one(db,'SELECT id FROM episode_pathways WHERE id=$1 AND episode_id=$2',[c.pathwayId,c.episodeId]);
    await db.query(`UPDATE episode_pathways SET prosthesis_id=$2,prosthesis_goal_id=(SELECT goal_id FROM work_phase_prostheses WHERE work_phase_id=$3 AND prosthesis_id=$2) WHERE id=$1`,[c.pathwayId,c.prosthesisIds[0],id]);
    await db.query(`INSERT INTO work_phase_prostheses(work_phase_id,prosthesis_id,goal_id)
      SELECT w.id,$2,(SELECT goal_id FROM work_phase_prostheses WHERE work_phase_id=$3 AND prosthesis_id=$2)
      FROM episode_work_phases w WHERE w.source_episode_pathway_id=$1 AND w.clinical_scope='review' AND w.status<>'completed'
      ON CONFLICT DO NOTHING`,[c.pathwayId,c.prosthesisIds[0],id]);
    await db.query(`UPDATE episode_work_phases SET clinical_scope='prosthesis' WHERE source_episode_pathway_id=$1 AND clinical_scope='review' AND status<>'completed'`,[c.pathwayId]);
    await db.query(`INSERT INTO clinical_work_dependencies(work_phase_id,requires_phase_id)
      SELECT id,previous FROM (SELECT id,lag(id) OVER(ORDER BY pathway_order_index) AS previous
        FROM episode_work_phases WHERE source_episode_pathway_id=$1) chain WHERE previous IS NOT NULL ON CONFLICT DO NOTHING`,[c.pathwayId]);
  }
  return append(db,patientId,actor,c,'work_linked',{episodeId:c.episodeId,entityId:id});
}
async function saveRepairWork(db:PoolClient,patientId:string,actor:string,c:Extract<ClinicalCommand,{action:'work'}>) {
  const r=await one(db,'SELECT * FROM prosthesis_repair_cases WHERE patient_id=$1 AND id=$2',[patientId,c.repairCaseId]);
  await assertRepairOpen(db,r,c.occurredOn);
  if(c.scope!=='prosthesis'||c.prosthesisIds.length!==1||c.prosthesisIds[0]!==r.prosthesis_id)fail('Javítási munka az ügy saját fogpótlásához tartozhat');
  const id=c.workPhaseId??randomUUID();
  if(c.workPhaseId){const old=await clinicalWork(db,patientId,id);if(!old.is_repair_work||old.repair_case_id!==r.id||old.status==='completed')fail('A javítási munkafázis nem módosítható');}
  for(const requiredId of c.requiresPhaseIds){
    const required=await clinicalWork(db,patientId,requiredId);
    if(requiredId===id||required.repair_case_id!==r.id)fail('Javítási függőség az ügy másik munkafázisa lehet');
    const cycle=await db.query(`WITH RECURSIVE chain(id) AS (SELECT $1::uuid UNION SELECT unnest(w.requires_phase_ids) FROM prosthesis_repair_work_phases w JOIN chain c ON c.id=w.id) SELECT 1 FROM chain WHERE id=$2`,[requiredId,id]);
    if(cycle.rows.length)fail('Körkörös javítási függőség');
  }
  const ev=await append(db,patientId,actor,c,'work_linked',{episodeId:r.episode_id,prosthesisId:r.prosthesis_id,entityId:id});
  await db.query(`INSERT INTO prosthesis_repair_work_phases(id,repair_case_id,patient_id,label,requires_phase_ids,last_event_id)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,requires_phase_ids=EXCLUDED.requires_phase_ids,last_event_id=EXCLUDED.last_event_id`,[id,r.id,patientId,c.label,c.requiresPhaseIds,ev.eventId]);
  return ev;
}

export async function loadClinicalWorkspace(patientId:string) {
  const db=getDbPool();
  const p=await one(db,'SELECT nev FROM patients WHERE id=$1',[patientId]);
  const [episodes,prostheses,events,goals,plans,repairs,work,tasks,states,packages,legacy,documents,pathways,appointments,closures,legacyEncounters,repairWork,episodeLinks,episodePlans,financing]=await Promise.all([
    db.query('SELECT id,case_title,reason,status,opened_at,closed_at,parent_episode_id FROM patient_episodes WHERE patient_id=$1 ORDER BY opened_at DESC',[patientId]),
    db.query('SELECT *,delivery_date::text FROM prostheses WHERE patient_id=$1 ORDER BY created_at,id',[patientId]),
    db.query(`SELECT e.*,e.occurred_on::text,u.email AS recorder,NOT EXISTS(SELECT 1 FROM prosthesis_clinical_events n WHERE n.supersedes_id=e.id) AS active
      FROM prosthesis_clinical_events e JOIN users u ON u.id=e.recorded_by WHERE e.patient_id=$1 ORDER BY e.occurred_on,e.occurred_at NULLS FIRST,e.recorded_at,e.id`,[patientId]),
    db.query('SELECT * FROM episode_prosthesis_goals WHERE patient_id=$1',[patientId]),
    db.query(`SELECT p.*,e.occurred_on::text,e.recorded_at FROM prosthesis_plan_versions p JOIN prosthesis_active_events e ON e.id=p.event_id
      WHERE p.patient_id=$1 ORDER BY e.recorded_at DESC,p.version DESC`,[patientId]),
    db.query('SELECT * FROM prosthesis_repair_cases WHERE patient_id=$1',[patientId]),
    db.query(`SELECT w.*,COALESCE((SELECT jsonb_agg(prosthesis_id) FROM work_phase_prostheses WHERE work_phase_id=w.id),'[]') AS prosthesis_ids,
      COALESCE((SELECT jsonb_agg(requires_phase_id) FROM clinical_work_dependencies WHERE work_phase_id=w.id),'[]') AS requires_phase_ids
      FROM episode_work_phases w JOIN patient_episodes e ON e.id=w.episode_id WHERE e.patient_id=$1 ORDER BY w.episode_id,w.seq,w.id`,[patientId]),
    db.query(`SELECT t.*,t.due_on::text,a.appointment_status,e.occurred_on::text AS source_day,
      (t.completed_event_id IS NOT NULL AND EXISTS(SELECT 1 FROM prosthesis_active_events d WHERE d.id=t.completed_event_id)
        AND (t.appointment_id IS NULL OR a.appointment_status IN ('completed','unsuccessful'))) AS completed,
      (a.id IS NOT NULL AND (a.appointment_status IS NULL OR a.appointment_status IN ('completed','unsuccessful'))) AS slot_secured
      FROM clinical_followup_tasks t JOIN prosthesis_active_events e ON e.id=t.source_event_id
      LEFT JOIN appointments a ON a.id=t.appointment_id WHERE t.patient_id=$1 ORDER BY t.due_on,t.id`,[patientId]),
    loadClinicalStates(db,patientId),
    db.query('SELECT id,episode_id,plan_version_id,status_state_id,manifest,sha256,created_at FROM clinical_document_packages WHERE patient_id=$1 ORDER BY created_at DESC',[patientId]),
    db.query('SELECT id,effective_date::text,fogak,note,created_at FROM dental_status_snapshots WHERE patient_id=$1 ORDER BY effective_date',[patientId]),
    db.query('SELECT id,filename,tags FROM patient_documents WHERE patient_id=$1 ORDER BY uploaded_at DESC',[patientId]),
    db.query('SELECT p.id,p.episode_id,p.jaw,p.prosthesis_id,c.name FROM episode_pathways p JOIN care_pathways c ON c.id=p.care_pathway_id JOIN patient_episodes e ON e.id=p.episode_id WHERE e.patient_id=$1',[patientId]),
    db.query(`SELECT a.id,a.appointment_status,(COALESCE(a.start_time,s.start_time) AT TIME ZONE 'Europe/Budapest')::date::text AS day
      FROM appointments a LEFT JOIN available_time_slots s ON s.id=a.time_slot_id WHERE a.patient_id=$1 ORDER BY COALESCE(a.start_time,s.start_time) DESC`,[patientId]),
    db.query('SELECT c.* FROM clinical_episode_closures c JOIN patient_episodes e ON e.id=c.episode_id WHERE e.patient_id=$1',[patientId]),
    db.query('SELECT id,appointment_id,occurred_on::text,occurred_at,phase,clinical_minutes,note,links,created_at,recorded_by FROM prosthesis_care_encounters WHERE patient_id=$1 ORDER BY occurred_on',[patientId]),
    db.query(`SELECT w.*,w.label AS custom_label,'repair' AS work_phase_code,'prosthesis' AS clinical_scope,r.episode_id,
      jsonb_build_array(r.prosthesis_id) AS prosthesis_ids FROM prosthesis_repair_work_phases w JOIN prosthesis_repair_cases r ON r.id=w.repair_case_id WHERE w.patient_id=$1`,[patientId]),
    db.query('SELECT l.* FROM prosthesis_episode_links l JOIN patient_episodes e ON e.id=l.episode_id WHERE e.patient_id=$1',[patientId]),
    db.query(`${EPISODE_PLAN_SELECT} WHERE pe.patient_id=$1 ORDER BY pe.opened_at DESC,pe.id`,[patientId]),
    db.query<FinancingEvent>(`${FINANCING_SELECT} WHERE f.patient_id=$1 ORDER BY f.effective_on DESC,f.version DESC`,[patientId]),
  ]);
  const replay=replayStates(states);
  const activeEvents=events.rows.filter(e=>e.active);
  const closureReview=closures.rows.filter(c=>(c.acceptance_events as Array<{acceptance_id:string}>).some(a=>!activeEvents.some(e=>e.id===a.acceptance_id))).map(c=>c.episode_id);
  return { patientName:p.nev,episodes:episodes.rows,prostheses:prostheses.rows,events:events.rows,goals:goals.rows,plans:plans.rows,repairs:repairs.rows,
    work:[...work.rows,...repairWork.rows],tasks:tasks.rows,states,actual:replay.layers,conflicts:replay.conflicts,milestones:replay.milestones,
    packages:packages.rows,financingEvents:financing.rows,episodeLinks:episodeLinks.rows,episodePlans:episodePlans.rows.map(episodePlanFromRow),legacyStates:legacy.rows,legacyEncounters:legacyEncounters.rows,documents:documents.rows,pathways:pathways.rows,appointments:appointments.rows,closureReview };
}
export type ClinicalWorkspace = Awaited<ReturnType<typeof loadClinicalWorkspace>>;

/** Compatibility writes obey the same every-repair-is-a-new-episode rule. */
export async function recordLegacyRepairEpisodes(db:PoolClient,patientId:string,actor:string,encounterId:string,occurredOn:string,links:Array<{prosthesisId:string;interventions:string[];problems:string[];result:string|null}>) {
  for(const link of links.filter(l=>l.interventions.some(i=>i!=='advice'))){
    const p=await device(db,patientId,link.prosthesisId);
    if(!p.delivery_date)continue;
    const source=`Gondozási vizit: ${encounterId}`;
    const existing=await db.query(`SELECT r.id FROM prosthesis_repair_cases r JOIN prosthesis_clinical_events e ON e.id=r.opened_event_id
      WHERE r.patient_id=$1 AND r.prosthesis_id=$2 AND e.source=$3`,[patientId,p.id,source]);
    if(existing.rows.length)continue;
    const previous=(await loadClinicalStates(db,patientId)).filter(s=>s.occurred_on<=occurredOn).at(-1);
    const meta={requestKey:randomUUID(),occurredOn,source,note:'Korábbi gondozási felületből kapcsolt javítás; a korabeli vizit külön megmaradt.'};
    const baseline=previous?{id:previous.id}:await perform(db,patientId,actor,clinicalCommandSchema.parse({...meta,action:'status',episodeId:p.episode_id,mode:'assessment',layers:emptyLayers(),note:'Fogazati státusz a gondozási űrlapon nincs dokumentálva; hiányos kiindulási adat.'}));
    const repair=await perform(db,patientId,actor,clinicalCommandSchema.parse({...meta,requestKey:randomUUID(),action:'repair',prosthesisId:p.id,baselineStateId:baseline.id,reason:link.problems.join(', ')||'Igazítás / javítás',plan:link.interventions.join(', ')}));
    if(link.interventions.includes('remake')){
      await perform(db,patientId,actor,clinicalCommandSchema.parse({...meta,requestKey:randomUUID(),action:'remake',prosthesisId:p.id,repairCaseId:repair.id,label:`Újrakészítés: ${p.label}`,reason:'A gondozási vizitben teljes újrakészítésként dokumentálva'}));
      continue;
    }
    if(link.result==='resolved')await perform(db,patientId,actor,clinicalCommandSchema.parse({...meta,requestKey:randomUUID(),action:'repair_result',repairCaseId:repair.id,outcome:'completed',result:'A vizitben a probléma megoldódottként dokumentálva'}));
  }
}
