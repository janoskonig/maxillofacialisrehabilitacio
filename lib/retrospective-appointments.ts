import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { budapestToday } from '@/lib/aftercare/model';
import { canonical,clinicalDay } from '@/lib/prosthesis-lifecycle/model';

export const retrospectiveAppointmentSchema=z.object({
  requestKey:z.string().uuid(),occurredOn:clinicalDay,occurredAt:z.string().datetime({offset:true}).nullable().default(null),
  precision:z.enum(['day','exact']),source:z.string().trim().min(1).max(500),
  clinicianId:z.string().uuid(),episodeId:z.string().uuid().nullable().default(null),
  appointmentType:z.enum(['elso_konzultacio','munkafazis','kontroll','recall','egyeb']),
  clinicalMinutes:z.number().int().min(1).max(1440).nullable().default(null),
  appointmentStatus:z.enum(['completed','unsuccessful']).default('completed'),
  notes:z.string().trim().max(10000).default(''),existingAppointmentId:z.string().uuid().nullable().default(null),
}).superRefine((c,ctx)=>{
  if((c.precision==='exact')!==!!c.occurredAt)ctx.addIssue({code:'custom',message:'Jelölje, hogy a pontos idő ismert-e'});
  if(c.occurredAt&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date(c.occurredAt))!==c.occurredOn)ctx.addIssue({code:'custom',message:'A nap és a pontos idő eltér'});
});
export type RetrospectiveAppointmentInput=z.infer<typeof retrospectiveAppointmentSchema>;

export async function retrospectiveAppointmentOptions(patientId:string){
  const db=getDbPool();
  const patient=await db.query('SELECT id FROM patients WHERE id=$1',[patientId]);
  if(!patient.rows.length)throw new HttpError(404,'Beteg nem található');
  const [clinicians,episodes,appointments]=await Promise.all([
    db.query(`SELECT id,email,COALESCE(doktor_neve,email)||CASE WHEN active THEN '' ELSE ' (korábbi ellátó)' END AS name FROM users WHERE role IN ('admin','fogpótlástanász','beutalo_orvos') ORDER BY active DESC,doktor_neve,email`),
    db.query(`SELECT id,COALESCE(case_title,chief_complaint,reason) AS label,status FROM patient_episodes WHERE patient_id=$1 ORDER BY opened_at DESC`,[patientId]),
    db.query(`SELECT a.id,(a.start_time AT TIME ZONE 'Europe/Budapest')::date::text AS day,a.appointment_status AS status
      FROM appointments a WHERE a.patient_id=$1 AND a.start_time<=now() ORDER BY a.start_time DESC`,[patientId]),
  ]);
  return {clinicians:clinicians.rows,episodes:episodes.rows,appointments:appointments.rows};
}
/** Historical documentation is an attended appointment, not a future reservation. */
export async function recordRetrospectiveAppointment(patientId:string,actor:{userId:string;email:string},c:RetrospectiveAppointmentInput){
  if(c.occurredOn>budapestToday()||(c.occurredAt&&new Date(c.occurredAt).getTime()>Date.now()))throw new HttpError(400,'Csak már megtörtént időpont rögzíthető');
  const db=await getDbPool().connect();
  try{
    await db.query('BEGIN');
    const patient=await db.query('SELECT id,halal_datum FROM patients WHERE id=$1 FOR UPDATE',[patientId]);
    if(!patient.rows.length)throw new HttpError(404,'Beteg nem található');
    const death=patient.rows[0].halal_datum;
    if(death&&c.occurredOn>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date(death)))throw new HttpError(409,'Az ellátás nem lehet a halálozás után');
    const retry=await db.query('SELECT appointment_id,command FROM retrospective_appointment_records WHERE patient_id=$1 AND request_key=$2',[patientId,c.requestKey]);
    if(retry.rows.length){
      if(canonical(retry.rows[0].command)!==canonical(c))throw new HttpError(409,'Az ismétlési kulcs más tartalomhoz tartozik');
      await db.query('COMMIT');return {appointmentId:retry.rows[0].appointment_id,reused:true};
    }
    const clinician=await db.query(`SELECT id,email FROM users WHERE id=$1 AND role IN ('admin','fogpótlástanász','beutalo_orvos')`,[c.clinicianId]);
    if(!clinician.rows.length)throw new HttpError(400,'Válasszon ellátó orvost');
    if(c.episodeId){const ep=await db.query('SELECT id FROM patient_episodes WHERE id=$1 AND patient_id=$2',[c.episodeId,patientId]);if(!ep.rows.length)throw new HttpError(400,'Az epizód másik beteghez tartozik');}
    const pool=c.appointmentType==='elso_konzultacio'?'consult':['kontroll','recall'].includes(c.appointmentType)?'control':'work';
    let appointmentId:string;
    if(c.existingAppointmentId){
      const previous=await db.query(`SELECT a.*,(a.start_time AT TIME ZONE 'Europe/Budapest')::date::text AS day
        FROM appointments a WHERE a.id=$1 AND a.patient_id=$2 FOR UPDATE`,[c.existingAppointmentId,patientId]);
      const a=previous.rows[0];
      if(!a)throw new HttpError(404,'A beteg időpontja nem található');
      if(a.day!==c.occurredOn)throw new HttpError(409,'A meglévő időpont napja eltér');
      if(c.precision==='exact'&&new Date(a.start_time).getTime()!==new Date(c.occurredAt!).getTime())throw new HttpError(409,'A meglévő időpont pontos ideje eltér');
      if(a.appointment_status&&!['completed','unsuccessful'].includes(a.appointment_status))throw new HttpError(409,'A lemondott vagy elmulasztott időpont kimenetelét előbb javítsa a státuszszerkesztőben');
      if(a.episode_id&&c.episodeId&&a.episode_id!==c.episodeId)throw new HttpError(409,'Az időpont másik epizódhoz tartozik');
      if(a.dentist_email&&a.dentist_email!==clinician.rows[0].email)throw new HttpError(409,'A meglévő időpont ellátó orvosa eltér');
      const documented=await db.query('SELECT appointment_id FROM retrospective_appointment_records WHERE appointment_id=$1',[a.id]);
      if(documented.rows.length)throw new HttpError(409,'Ez a korábbi időpont már dokumentálva van');
      appointmentId=a.id;
      await db.query(`UPDATE appointments SET appointment_status=$2,completion_notes=concat_ws(E'\n',NULLIF(completion_notes,''),NULLIF($3,'')),episode_id=COALESCE(episode_id,$4) WHERE id=$1`,[a.id,c.appointmentStatus,c.notes,c.episodeId]);
    }else{
      const duplicates=await db.query(`SELECT a.id FROM appointments a LEFT JOIN retrospective_appointment_records r ON r.appointment_id=a.id
        WHERE a.patient_id=$1 AND (a.start_time AT TIME ZONE 'Europe/Budapest')::date=$2::date
          AND ($3::timestamptz IS NULL OR a.start_time=$3 OR r.time_precision='day') LIMIT 1`,[patientId,c.occurredOn,c.occurredAt]);
      if(duplicates.rows.length)throw new HttpError(409,'Erre a napra és időre már van időpont. Válassza a meglévő időponthoz kapcsolást.');
      const slot=await db.query(`INSERT INTO available_time_slots(user_id,start_time,status,state,source,slot_purpose,duration_minutes)
        VALUES($1,COALESCE($2::timestamptz,($3::date+time '00:00') AT TIME ZONE 'Europe/Budapest'),'booked','booked','manual',$4,$5) RETURNING id`,[c.clinicianId,c.occurredAt,c.occurredOn,pool,c.clinicalMinutes??30]);
      const a=await db.query(`INSERT INTO appointments(patient_id,time_slot_id,created_by,dentist_email,appointment_status,completion_notes,appointment_type,episode_id,pool,duration_minutes,created_via,approval_status,recorded_at,effective_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'migration','approved',now(),$11) RETURNING id`,[patientId,slot.rows[0].id,actor.email,clinician.rows[0].email,c.appointmentStatus,c.notes,c.appointmentType,c.episodeId,pool,c.clinicalMinutes??30,c.occurredAt]);
      appointmentId=a.rows[0].id;
    }
    await db.query(`INSERT INTO retrospective_appointment_records(appointment_id,patient_id,request_key,occurred_on,occurred_at,time_precision,source,clinical_minutes,command,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[appointmentId,patientId,c.requestKey,c.occurredOn,c.occurredAt,c.precision,c.source,c.clinicalMinutes,JSON.stringify(c),actor.userId]);
    await db.query('COMMIT');return {appointmentId,reused:!!c.existingAppointmentId};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
