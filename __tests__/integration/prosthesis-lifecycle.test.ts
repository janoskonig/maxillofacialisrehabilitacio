import { afterEach,describe,expect,it } from 'vitest';
import { createHash } from 'crypto';
import { getDbPool } from '@/lib/db';
import { clinicalCommandSchema,emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import { executeClinicalCommand,loadClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { createClinicalPackage,packageSchema } from '@/lib/prosthesis-lifecycle/packages';
import { createOpenEpisodeWithInitialStageZero } from '@/lib/patient-episode-create';
import { createTestEpisode,createTestPatient,createTestUser,createTestSlot,createTestAppointment,cleanupCreated } from './helpers/factories';
const patientIds:string[]=[];
afterEach(async()=>{
  const db=getDbPool();
  for(const id of patientIds) {
    await db.query('DELETE FROM clinical_document_packages WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM clinical_episode_closures WHERE episode_id IN (SELECT id FROM patient_episodes WHERE patient_id=$1)',[id]);
    await db.query('DELETE FROM clinical_followup_tasks WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM prosthesis_plan_versions WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM prosthesis_repair_work_phases WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM work_phase_prostheses WHERE prosthesis_id IN (SELECT id FROM prostheses WHERE patient_id=$1)',[id]);
    await db.query('DELETE FROM episode_prosthesis_goals WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM episode_work_phases WHERE episode_id IN (SELECT id FROM patient_episodes WHERE patient_id=$1)',[id]);
    await db.query('DELETE FROM prosthesis_repair_cases WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM clinical_dental_states WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM prosthesis_clinical_events WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM prosthesis_episode_links WHERE prosthesis_id IN (SELECT id FROM prostheses WHERE patient_id=$1)',[id]);
    await db.query('DELETE FROM prostheses WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM appointments WHERE patient_id=$1',[id]);
    // Remake episodes were created by the service, outside the factory tracker.
    await db.query('DELETE FROM patient_episodes WHERE patient_id=$1',[id]);
  }
  patientIds.length=0;await cleanupCreated();
});
async function setup(){
  const doctor=await createTestUser(),patient=await createTestPatient();patientIds.push(patient.id);
  const episode=await createTestEpisode(undefined,patient.id);
  const run=(input:Record<string,unknown>)=>executeClinicalCommand(patient.id,doctor.id,clinicalCommandSchema.parse({requestKey:crypto.randomUUID(),occurredOn:'2026-01-01',source:'Korabeli karton',...input}));
  const register=async(jaw='felso',role='definitive')=>{const r=await run({action:'register',episodeId:episode.id,jaw,role,origin:'local',prosthesisType:'removable',label:`${jaw} ${role}`,positions:[{tooth:jaw==='felso'?11:31,role:'denture_tooth'}]});const p=await getDbPool().query('SELECT episode_id FROM prostheses WHERE id=$1',[r.id]);return {...r,episodeId:p.rows[0].episode_id as string};};
  const baseline=()=>run({action:'status',episodeId:episode.id,mode:'assessment',layers:{...emptyLayers(),teeth:{'11':{base:'missing'},'31':{base:'missing'}}}});
  const milestone=(id:string,milestone:string,occurredOn='2026-02-01')=>run({action:'milestone',prosthesisId:id,milestone,occurredOn});
  return {doctor,patient,episode,run,register,baseline,milestone,load:()=>loadClinicalWorkspace(patient.id)};
}
describe('prosthesis lifecycle with clinical dates',()=>{
  it('does not close existing appliance episodes when another episode starts and forbids a second appliance in one episode',async()=>{
    const s=await setup(),p=await s.register();
    await createOpenEpisodeWithInitialStageZero(getDbPool(),{patientId:s.patient.id,reason:'traumás sérülés',chiefComplaint:'Új, külön ellátás',caseTitle:null,parentEpisodeId:null,triggerType:'egyeb',treatmentTypeId:null,createdBy:s.doctor.id});
    expect((await s.load()).episodes.find(e=>e.id===p.episodeId)?.status).toBe('open');
    await expect(getDbPool().query(`INSERT INTO prostheses(patient_id,episode_id,jaw,prosthesis_type,label,baseline,original_plan,created_by,origin,role)
      VALUES($1,$2,'also','removable','Második pótlás','{}','{}',$3,'local','definitive')`,[s.patient.id,p.episodeId,s.doctor.id])).rejects.toMatchObject({code:'23514'});
  });
  it('blocks legacy closure paths before clinical acceptance and rejects inconsistent milestone chronology',async()=>{
    const s=await setup(),p=await s.register(),base=await s.baseline();
    await s.run({action:'set_goal',episodeId:p.episodeId,prosthesisId:p.id,baselineStateId:base.id});
    await s.milestone(p.id,'lab_completed','2026-03-10');
    await expect(getDbPool().query("UPDATE patient_episodes SET status='closed' WHERE id=$1",[p.episodeId])).rejects.toMatchObject({code:'23514'});
    await expect(s.milestone(p.id,'accepted','2026-03-01')).rejects.toMatchObject({status:409});
    await s.milestone(p.id,'accepted','2026-03-11');
    await expect(s.milestone(p.id,'delivered','2026-03-09')).rejects.toMatchObject({status:409});
  });
  it('gives each jaw and provisional appliance a separate episode; each closes on its own clinical acceptance',async()=>{
    const s=await setup(),upper=await s.register(),lower=await s.register('also'),temporary=await s.register('felso','provisional');
    const base=await s.baseline();
    expect(new Set([upper.episodeId,lower.episodeId,temporary.episodeId]).size).toBe(3);
    for(const p of [upper,lower,temporary])await s.run({action:'set_goal',episodeId:p.episodeId,prosthesisId:p.id,baselineStateId:base.id});
    await s.milestone(temporary.id,'accepted');await s.milestone(upper.id,'lab_completed');
    expect((await s.load()).episodes.find(e=>e.id===temporary.episodeId)?.status).toBe('closed');
    expect((await s.load()).episodes.find(e=>e.id===upper.episodeId)?.status).toBe('open');
    await s.milestone(upper.id,'accepted');
    expect((await s.load()).episodes.find(e=>e.id===upper.episodeId)?.status).toBe('closed');
    expect((await s.load()).episodes.find(e=>e.id===lower.episodeId)?.status).toBe('open');
    await s.milestone(lower.id,'accepted','2026-02-12');expect((await s.load()).episodes.find(e=>e.id===lower.episodeId)?.status).toBe('closed');
    await s.milestone(upper.id,'delivered','2026-02-15');
    const data=await s.load();expect(data.tasks[0].due_on).toBe('2026-05-15');expect(data.tasks[0].completed).toBe(false);
    expect(data.events.find(e=>e.kind==='delivered')?.occurred_on).toBe('2026-02-15');
    expect(data.events.find(e=>e.kind==='delivered')?.recorded_at).toBeTruthy();
    await expect(getDbPool().query('UPDATE prosthesis_clinical_events SET note=$2 WHERE id=$1',[data.events[0].id,'changed'])).rejects.toMatchObject({code:'23514'});
  });
  it('records a mixed visit once with independent outcomes and no duplicated followups on retry',async()=>{
    const s=await setup(),upper=await s.register(),lower=await s.register('also');
    await s.milestone(upper.id,'delivered','2026-02-01');
    const repairBase=await s.baseline();
    const repair=await s.run({action:'repair',prosthesisId:upper.id,baselineStateId:repairBase.id,reason:'Igazítás',plan:'Nyomási pont korrekciója',occurredOn:'2026-02-05'});
    const upperWork=await s.run({action:'work',episodeId:null,repairCaseId:repair.id,label:'Felső igazítás',scope:'prosthesis',prosthesisIds:[upper.id],occurredOn:'2026-02-05'});
    const lowerWork=await s.run({action:'work',episodeId:lower.episodeId,label:'Alsó próba',scope:'prosthesis',prosthesisIds:[lower.id]});
    const command={action:'visit',requestKey:crypto.randomUUID(),occurredOn:'2026-02-10',clinician:s.doctor.email,clinicalMinutes:40,links:[
      {prosthesisId:upper.id,phase:'repair',repairCaseId:repair.id,workPhaseId:upperWork.id,activity:'Igazítás',outcome:'completed',result:'Jó',followups:[{purpose:'Felső kontroll',afterDays:14}]},
      {prosthesisId:lower.id,phase:'construction',workPhaseId:lowerWork.id,activity:'Próba',outcome:'unsuccessful',result:'Új próba szükséges'},
    ]};
    await s.run(command);await s.run(command);
    const data=await s.load();expect(data.events.filter(e=>e.kind==='visit')).toHaveLength(1);
    expect(data.work.find(w=>w.id===upperWork.id)?.status).toBe('completed');expect(data.work.find(w=>w.id===lowerWork.id)?.status).toBe('pending');
    expect(data.tasks.filter(t=>t.purpose==='Felső kontroll')).toHaveLength(1);
    expect(data.events.find(e=>e.kind==='visit')?.payload.command.clinicalMinutes).toBe(40);
    await expect(s.run({...command,clinicalMinutes:45})).rejects.toMatchObject({status:409});
  });
  it('keeps repairs after closure and connects a remake to its old prosthesis, episode and repair',async()=>{
    const s=await setup(),p=await s.register(),base=await s.baseline();
    await s.run({action:'set_goal',episodeId:p.episodeId,prosthesisId:p.id,baselineStateId:base.id});
    await s.milestone(p.id,'accepted');await s.milestone(p.id,'delivered');
    const repair=await s.run({action:'repair',prosthesisId:p.id,baselineStateId:base.id,reason:'Törés',plan:'Laborjavítás és próba',occurredOn:'2026-03-01'});
    const w=await s.run({action:'work',episodeId:s.episode.id,scope:'prosthesis',prosthesisIds:[p.id],repairCaseId:repair.id,label:'Javítási lenyomat',occurredOn:'2026-03-01'});
    expect(w.id).toBeTruthy();expect((await s.load()).episodes.find(e=>e.id===p.episodeId)?.status).toBe('closed');
    const repairEpisode=(await s.load()).repairs.find(r=>r.id===repair.id)?.episode_id;
    expect(repairEpisode).toBeTruthy();expect(repairEpisode).not.toBe(p.episodeId);
    const remake=await s.run({action:'remake',prosthesisId:p.id,repairCaseId:repair.id,label:'Új végleges felső',reason:'Javítás helyett újrakészítés',occurredOn:'2026-03-15'});
    const data=await s.load(),replacement=data.prostheses.find(p=>p.id===remake.id);
    expect(replacement?.replaces_id).toBe(p.id);expect(replacement?.episode_id).not.toBe(p.episodeId);
    expect(data.episodes.find(e=>e.id===replacement?.episode_id)?.parent_episode_id).toBe(p.episodeId);
    expect(data.repairs).toHaveLength(1);expect(data.events.some(e=>e.kind==='remake_decided'&&e.payload.command.repairCaseId===repair.id)).toBe(true);
  });
  it('supports an independent multistage repair for a prosthesis made elsewhere, without a construction episode',async()=>{
    const s=await setup();
    const p=await s.run({action:'register',episodeId:null,jaw:'felso',role:'definitive',origin:'external',prosthesisType:'removable',label:'Máshol készült felső'});
    const base=await s.baseline();await s.milestone(p.id,'delivered');
    const repair=await s.run({action:'repair',prosthesisId:p.id,baselineStateId:base.id,reason:'Törés',plan:'Lenyomat, labor és próba',occurredOn:'2026-03-01'});
    const first=await s.run({action:'work',episodeId:null,repairCaseId:repair.id,prosthesisIds:[p.id],scope:'prosthesis',label:'Lenyomat',occurredOn:'2026-03-01'});
    const second=await s.run({action:'work',episodeId:null,repairCaseId:repair.id,prosthesisIds:[p.id],scope:'prosthesis',label:'Próba',requiresPhaseIds:[first.id],occurredOn:'2026-03-01'});
    const visit=(workPhaseId:string,occurredOn:string)=>s.run({action:'visit',occurredOn,clinician:s.doctor.email,clinicalMinutes:20,links:[{prosthesisId:p.id,repairCaseId:repair.id,workPhaseId,phase:'repair',activity:'Javítás',outcome:'completed',result:'Teljesült'}]});
    await expect(visit(second.id,'2026-03-05')).rejects.toMatchObject({status:409});
    await visit(first.id,'2026-03-05');await visit(second.id,'2026-03-10');
    await s.run({action:'repair_result',repairCaseId:repair.id,outcome:'completed',result:'Átadva, panaszmentes',occurredOn:'2026-03-12'});
    const data=await s.load();expect(data.episodes).toHaveLength(2);expect(data.prostheses.find(d=>d.id===p.id)?.episode_id).toBeNull();
    expect(data.episodeLinks.filter(l=>l.purpose==='repair')).toHaveLength(1);
    expect(data.work.filter(w=>w.repair_case_id===repair.id).map(w=>w.status)).toEqual(['completed','completed']);
  });
  it('completes shared appointment followups separately and does not complete cancelled appointments',async()=>{
    const s=await setup(),upper=await s.register(),lower=await s.register('also');
    await s.milestone(upper.id,'delivered');await s.milestone(lower.id,'delivered');
    const slot=await createTestSlot(undefined,s.doctor.id,{startTime:new Date('2026-05-01T10:00:00Z')});
    const appointment=await createTestAppointment(undefined,{patientId:s.patient.id,episodeId:s.episode.id,timeSlotId:slot.id,startTime:new Date('2026-05-01T10:00:00Z'),appointmentStatus:'completed'});
    const tasks=(await s.load()).tasks;
    for(const t of tasks)await s.run({action:'book_task',taskId:t.id,appointmentId:appointment.id});
    const upperTask=tasks.find(t=>t.prosthesis_id===upper.id)!;
    await s.run({action:'visit',appointmentId:appointment.id,occurredOn:'2026-05-01',clinician:s.doctor.email,clinicalMinutes:30,links:[{prosthesisId:upper.id,phase:'aftercare',activity:'Kontroll',outcome:'completed',result:'Jó',completedTaskIds:[upperTask.id]}]});
    let data=await s.load();expect(data.tasks.filter(t=>t.completed)).toHaveLength(1);
    await getDbPool().query("UPDATE appointments SET appointment_status='cancelled_by_patient' WHERE id=$1",[appointment.id]);
    data=await s.load();expect(data.tasks.every(t=>!t.completed&&!t.slot_secured)).toBe(true);
    await expect(s.run({action:'visit',appointmentId:appointment.id,occurredOn:'2026-05-01',clinician:s.doctor.email,clinicalMinutes:10,links:[{prosthesisId:lower.id,phase:'aftercare',activity:'Kontroll',outcome:'completed',result:'Jó'}]})).rejects.toMatchObject({status:409});
  });
  it('preserves correction history and flags an acceptance correction against its old closure',async()=>{
    const s=await setup(),p=await s.register(),base=await s.baseline();
    await s.run({action:'set_goal',episodeId:p.episodeId,prosthesisId:p.id,baselineStateId:base.id});
    const accepted=await s.milestone(p.id,'accepted','2026-02-01');
    await s.run({action:'milestone',prosthesisId:p.id,milestone:'accepted',supersedesId:accepted.eventId,occurredOn:'2026-02-02',note:'A korabeli karton pontosítása'});
    const data=await s.load();expect(data.events.find(e=>e.id===accepted.eventId)?.active).toBe(false);expect(data.closureReview).toContain(p.episodeId);
    expect(data.episodes.find(e=>e.id===p.episodeId)?.status).toBe('closed');
  });
  it('freezes exact package bytes while later plans and backdated records change',async()=>{
    const s=await setup(),p=await s.register(),baseline=await s.baseline();
    const plan=await s.run({action:'plan',episodeId:p.episodeId,baselineStateId:baseline.id,description:'Végleges felső készítése',approved:true,prosthesisIds:[p.id],treatments:[]});
    const input=packageSchema.parse({requestKey:crypto.randomUUID(),episodeId:p.episodeId,planVersionId:plan.id,statusStateId:baseline.id,prosthesisIds:[p.id]});
    const issued=await createClinicalPackage(s.patient.id,s.doctor.id,input);
    const before=await getDbPool().query('SELECT archive,sha256 FROM clinical_document_packages WHERE id=$1',[issued.id]);
    await s.run({action:'plan',episodeId:p.episodeId,baselineStateId:baseline.id,description:'Módosított terv',approved:true,prosthesisIds:[p.id],treatments:[]});
    await s.run({action:'status',episodeId:s.episode.id,mode:'assessment',layers:{...emptyLayers(),teeth:{'11':{base:'sound'}}},occurredOn:'2026-01-10'});
    expect(await createClinicalPackage(s.patient.id,s.doctor.id,input)).toEqual(issued);
    const after=await getDbPool().query('SELECT archive,sha256 FROM clinical_document_packages WHERE id=$1',[issued.id]);
    expect(after.rows[0].archive.equals(before.rows[0].archive)).toBe(true);
    expect(createHash('sha256').update(after.rows[0].archive).digest('hex')).toBe(after.rows[0].sha256);
    expect((await s.load()).actual.teeth['11']).toEqual({base:'sound'});
  });
});
