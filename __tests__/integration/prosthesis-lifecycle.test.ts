import { afterEach,describe,expect,it } from 'vitest';
import { createHash } from 'crypto';
import { getDbPool } from '@/lib/db';
import { clinicalCommandSchema,emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import { executeClinicalCommand,loadClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { createClinicalPackage,packageSchema } from '@/lib/prosthesis-lifecycle/packages';
import { createOpenEpisodeWithInitialStageZero } from '@/lib/patient-episode-create';
import { createTestEpisode,createTestPatient,createTestUser,createTestSlot,createTestAppointment,cleanupCreated } from './helpers/factories';
import { PATCH as savePlanRoute,GET as getPlanRoute } from '@/app/api/episodes/[id]/treatment-plan/route';
import { authedRequest } from './helpers/auth';
import { loadNeakTreatmentSources } from '@/lib/neak-treatment-sources';
import { buildTreatmentExportContent } from '@/lib/neak-treatment-content';
import { clinicalTemplate,reviewCommandSchema } from '@/lib/episode-clinical/model';
import { saveEpisodeReview } from '@/lib/episode-clinical/service';
import { financingCommandSchema } from '@/lib/episode-financing/model';
import { saveEpisodeFinancing } from '@/lib/episode-financing/service';
const patientIds:string[]=[];
afterEach(async()=>{
  const db=getDbPool();
  for(const id of patientIds) {
    await db.query('DELETE FROM clinical_document_packages WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM episode_clinical_reviews WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM clinical_episode_closures WHERE episode_id IN (SELECT id FROM patient_episodes WHERE patient_id=$1)',[id]);
    await db.query('DELETE FROM clinical_followup_tasks WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM episode_financing_events WHERE patient_id=$1',[id]);
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
async function editorSave(s:Awaited<ReturnType<typeof setup>>,episodeId:string,body:unknown){
  return savePlanRoute(await authedRequest(`http://test.local/api/episodes/${episodeId}/treatment-plan`,{
    user:{id:s.doctor.id,email:s.doctor.email,role:'fogpótlástanász'},method:'PATCH',body,
  }),{params:{id:episodeId}});
}
describe('prosthesis lifecycle with clinical dates',()=>{
  it('attaches an upper and a lower appliance to the selected episode and rejects a third or duplicate jaw',async()=>{
    const s=await setup(),requestKey=crypto.randomUUID();
    const input={action:'register',episodeId:s.episode.id,episodeMode:'existing',requestKey,jaw:'felso',role:'definitive',origin:'local',prosthesisType:'removable',label:'Tervezett felső fogpótlás'};
    const first=await s.run(input);expect(await s.run(input)).toEqual(first);
    const workspace=await s.load();expect(workspace.episodes).toHaveLength(1);expect(workspace.prostheses[0]).toMatchObject({id:first.id,episode_id:s.episode.id});
    const lower=await s.run({...input,requestKey:crypto.randomUUID(),jaw:'also',label:'Alsó készülék'});
    expect(lower.id).not.toBe(first.id);
    for(const jaw of ['felso','also'])await expect(s.run({...input,requestKey:crypto.randomUUID(),jaw,label:'Harmadik készülék'})).rejects.toMatchObject({status:409});
    expect((await s.load()).prostheses).toHaveLength(2);expect((await s.load()).episodes).toHaveLength(1);
  });
  it('keeps an episode indication distinct from its appliance name and preserves a long repair reason',async()=>{
    const s=await setup();
    await getDbPool().query('UPDATE patient_episodes SET chief_complaint=$2 WHERE id=$1',[s.episode.id,'Felső foghiány rehabilitációja']);
    const p=await s.register();
    const construction=(await getDbPool().query('SELECT chief_complaint,case_title FROM patient_episodes WHERE id=$1',[p.episodeId])).rows[0];
    expect(construction.chief_complaint).toBe('Felső foghiány rehabilitációja');expect(construction.case_title).not.toBe(construction.chief_complaint);
    const base=await s.baseline();await s.milestone(p.id,'delivered','2026-02-01');
    const reason='A lemez törése és illeszkedési panasza. '.repeat(30);
    const repair=await s.run({action:'repair',prosthesisId:p.id,baselineStateId:base.id,reason,plan:'Javítás',occurredOn:'2026-02-05'});
    const row=(await getDbPool().query('SELECT e.chief_complaint FROM patient_episodes e JOIN prosthesis_repair_cases r ON r.episode_id=e.id WHERE r.id=$1',[repair.id])).rows[0];
    expect(row.chief_complaint).toBe(reason.trim());
  });
  it('does not close existing episodes when another starts and rejects a duplicate jaw at the database boundary',async()=>{
    const s=await setup(),p=await s.register();
    await createOpenEpisodeWithInitialStageZero(getDbPool(),{patientId:s.patient.id,reason:'traumás sérülés',chiefComplaint:'Új, külön ellátás',caseTitle:null,parentEpisodeId:null,triggerType:'egyeb',treatmentTypeId:null,createdBy:s.doctor.id});
    expect((await s.load()).episodes.find(e=>e.id===p.episodeId)?.status).toBe('open');
    await expect(getDbPool().query(`INSERT INTO prostheses(patient_id,episode_id,jaw,prosthesis_type,label,baseline,original_plan,created_by,origin,role)
      VALUES($1,$2,'felso','removable','Második felső pótlás','{}','{}',$3,'local','definitive')`,[s.patient.id,p.episodeId,s.doctor.id])).rejects.toMatchObject({code:'23514'});
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
  it('retains explicitly separate episodes, including provisional appliances, and their own clinical acceptance',async()=>{
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
    const content=clinicalTemplate({diagnozis:'Kiadáskor dokumentált diagnózis'},'traumás sérülés');
    const reviewCommand=reviewCommandSchema.parse({requestKey:crypto.randomUUID(),expectedVersion:0,expectedReason:'traumás sérülés',effectiveOn:'2026-01-01',source:'Vizsgálat',note:'',reviewed:true,sourceReviewId:null,content});
    const firstReview=await saveEpisodeReview(s.patient.id,p.episodeId,s.doctor.id,reviewCommand);
    const issued=await createClinicalPackage(s.patient.id,s.doctor.id,input);
    const before=await getDbPool().query('SELECT archive,sha256,manifest FROM clinical_document_packages WHERE id=$1',[issued.id]);
    expect(before.rows[0].manifest.clinicalReviewId).toBe(firstReview.review.id);
    await saveEpisodeReview(s.patient.id,p.episodeId,s.doctor.id,{...reviewCommand,requestKey:crypto.randomUUID(),expectedVersion:1,effectiveOn:'2026-02-01',content:{...content,anamnesis:{...content.anamnesis,diagnozis:'Későbbi diagnózis'}}});
    const edited=await editorSave(s,p.episodeId,{treatmentPlanUpper:'Módosított terv',treatmentPlanLower:null,expectedVersion:1});
    expect(edited.status).toBe(200);
    expect((await edited.json()).plan.clinicalPlan.approved).toBe(false);
    await s.run({action:'status',episodeId:s.episode.id,mode:'assessment',layers:{...emptyLayers(),teeth:{'11':{base:'sound'}}},occurredOn:'2026-01-10'});
    expect(await createClinicalPackage(s.patient.id,s.doctor.id,input)).toEqual(issued);
    const after=await getDbPool().query('SELECT archive,sha256 FROM clinical_document_packages WHERE id=$1',[issued.id]);
    expect(after.rows[0].archive.equals(before.rows[0].archive)).toBe(true);
    expect(createHash('sha256').update(after.rows[0].archive).digest('hex')).toBe(after.rows[0].sha256);
    expect((await s.load()).actual.teeth['11']).toEqual({base:'sound'});
  });
});

describe('one shared episode treatment plan',()=>{
  it('uses the same approved version in the editor, lifecycle, projection and export; retries do not duplicate it',async()=>{
    const s=await setup(),p=await s.register(),base=await s.baseline();
    const body={treatmentPlanUpper:'Felső pótlás és a 12-es eltávolítása.',treatmentPlanLower:null,expectedVersion:0,
      clinical:{baselineStateId:base.id,treatments:[{toothNumber:12,treatmentCode:'huzas'}],approved:true,occurredOn:'2026-01-05',source:'Korabeli kezelési terv',requestKey:crypto.randomUUID()}};
    const first=await editorSave(s,p.episodeId,body);expect(first.status).toBe(200);
    const record=(await first.json()).plan;
    const retry=await editorSave(s,p.episodeId,body);expect(retry.status).toBe(200);
    expect((await retry.json()).plan.clinicalPlan.id).toBe(record.clinicalPlan.id);
    const workspace=await s.load();expect(workspace.plans).toHaveLength(1);
    expect(workspace.plans[0]).toMatchObject({id:record.clinicalPlan.id,version:1,episode_plan_version:1,approved:true,content:{description:body.treatmentPlanUpper,narratives:{treatmentPlanUpper:body.treatmentPlanUpper}}});
    expect(workspace.plans[0].content.target.teeth['12']).toMatchObject({base:'missing'});
    expect(workspace.actual.teeth['12']).toBeUndefined();
    const mirror=(await getDbPool().query('SELECT treatment_plan_upper,treatment_plan_version FROM patient_episodes WHERE id=$1',[p.episodeId])).rows[0];
    expect(mirror).toEqual({treatment_plan_upper:body.treatmentPlanUpper,treatment_plan_version:1});
    const sources=await loadNeakTreatmentSources(getDbPool(),s.patient.id);
    expect(sources.episodes.find(e=>e.id===p.episodeId)).toMatchObject({planVersionId:record.clinicalPlan.id,treatmentPlanUpper:body.treatmentPlanUpper,planApproved:true});
    const content=buildTreatmentExportContent({},sources);
    expect(content.sections.flatMap(section=>section.lines).join('\n')).toContain(body.treatmentPlanUpper);
    expect(content.sections.some(section=>section.title.includes('tervezett beavatkozások')&&section.lines[0].includes('12. fog: Eltávolítás'))).toBe(true);
    expect(content.sections.some(section=>section.title.startsWith('Felső fogpótlás')&&section.title.includes('alsó állcsont'))).toBe(false);
  });
  it('keeps old texts, saves incomplete drafts, rejects the other jaw and does not resurrect cleared mirror text',async()=>{
    const s=await setup(),p=await s.register();
    await getDbPool().query("UPDATE patient_episodes SET treatment_plan='Régi közös terv',treatment_plan_upper='Régi felső terv',treatment_plan_lower='Megőrzendő alsó terv' WHERE id=$1",[p.episodeId]);
    const draft=await editorSave(s,p.episodeId,{treatmentPlanUpper:'Új felső terv',treatmentPlanLower:'Megőrzendő alsó terv',expectedVersion:0});
    expect(draft.status).toBe(200);expect((await draft.json()).plan.clinicalPlan).toMatchObject({approved:false,baselineStateId:null});
    let workspace=await s.load();expect(workspace.plans[0].content.target).toBeNull();
    expect(workspace.plans[0].content.previousNarratives).toEqual({treatmentPlan:'Régi közös terv',treatmentPlanUpper:'Régi felső terv',treatmentPlanLower:'Megőrzendő alsó terv'});
    const wrong=await editorSave(s,p.episodeId,{treatmentPlanUpper:'Új felső terv',treatmentPlanLower:'Másik állcsont átírása',expectedVersion:1});
    expect(wrong.status).toBe(400);expect((await s.load()).plans).toHaveLength(1);
    const approved=await editorSave(s,p.episodeId,{treatmentPlanUpper:'Új felső terv',treatmentPlanLower:'Megőrzendő alsó terv',expectedVersion:1,clinical:{baselineStateId:null,treatments:[],approved:true,occurredOn:'2026-01-05',source:'Vizsgálat',requestKey:crypto.randomUUID()}});
    expect(approved.status).toBe(409);
    expect((await editorSave(s,p.episodeId,{treatmentPlanUpper:null,treatmentPlanLower:'Megőrzendő alsó terv',expectedVersion:1})).status).toBe(200);
    await getDbPool().query("UPDATE patient_episodes SET treatment_plan_upper='Elavult tükörszöveg' WHERE id=$1",[p.episodeId]);
    const res=await getPlanRoute(await authedRequest(`http://test.local/api/episodes/${p.episodeId}/treatment-plan`,{user:{id:s.doctor.id,email:s.doctor.email,role:'fogpótlástanász'}}),{params:{id:p.episodeId}});
    const current=(await res.json()).plan;expect(current.treatmentPlanUpper).toBeNull();expect(current.history).toHaveLength(2);
    const sources=await loadNeakTreatmentSources(getDbPool(),s.patient.id);expect(sources.episodes.find(e=>e.id===p.episodeId)?.treatmentPlanUpper).toBeNull();
    workspace=await s.load();expect(workspace.plans[1].content.description).toBe('Új felső terv');
  });
  it('includes closed appliance episodes in document sources and keeps compatibility writers in the same version history',async()=>{
    const s=await setup(),p=await s.register('also'),base=await s.baseline();
    await s.run({action:'plan',episodeId:p.episodeId,baselineStateId:base.id,description:'Alsó terv a korábbi kliensből',approved:true,prosthesisIds:[p.id],treatments:[]});
    const saved=await editorSave(s,p.episodeId,{treatmentPlanUpper:null,treatmentPlanLower:'Friss közös alsó terv',expectedVersion:1});
    expect(saved.status).toBe(200);expect((await saved.json()).plan.clinicalPlan.version).toBe(2);
    await s.milestone(p.id,'accepted');
    const sources=await loadNeakTreatmentSources(getDbPool(),s.patient.id);
    const ep=sources.episodes.find(e=>e.id===p.episodeId);expect(ep).toMatchObject({status:'closed',treatmentPlanLower:'Friss közös alsó terv',planVersion:2});
    expect(buildTreatmentExportContent({},sources).sections.flatMap(section=>section.lines)).toContain('Friss közös alsó terv');
    expect((await s.load()).plans).toHaveLength(2);
  });
});

describe('one upper and one lower appliance in an episode',()=>{
  const attach=(s:Awaited<ReturnType<typeof setup>>,jaw:string,role='definitive')=>s.run({action:'register',episodeId:s.episode.id,episodeMode:'existing',jaw,role,origin:'local',prosthesisType:'removable',label:`${jaw} ${role}`,positions:[{tooth:jaw==='felso'?11:31,role:'denture_tooth'}]});

  it('waits for both clinical acceptances, including a provisional appliance, with the actual last acceptance date',async()=>{
    const s=await setup(),upper=await attach(s,'felso','provisional'),lower=await attach(s,'also');
    await s.milestone(upper.id,'lab_completed','2026-01-10');
    await s.milestone(upper.id,'accepted','2026-02-03');
    expect((await s.load()).episodes.find(e=>e.id===s.episode.id)?.status).toBe('open');
    await expect(getDbPool().query("UPDATE patient_episodes SET status='closed' WHERE id=$1",[s.episode.id])).rejects.toMatchObject({code:'23514'});
    await s.milestone(lower.id,'accepted','2026-02-08');
    const data=await s.load();expect(data.episodes.find(e=>e.id===s.episode.id)?.status).toBe('closed');
    const closure=(await getDbPool().query('SELECT c.acceptance_events,e.occurred_on::text FROM clinical_episode_closures c JOIN prosthesis_clinical_events e ON e.id=c.event_id WHERE c.episode_id=$1',[s.episode.id])).rows[0];
    expect(closure.occurred_on).toBe('2026-02-08');expect(closure.acceptance_events).toHaveLength(2);
    expect(new Set(closure.acceptance_events.map((e:any)=>e.prosthesis_id))).toEqual(new Set([upper.id,lower.id]));
    await expect(attach(s,'felso')).rejects.toMatchObject({status:409});
  });

  it('keeps one plan/export row, projects both devices and requires a new version when the second jaw is added',async()=>{
    const s=await setup(),upper=await attach(s,'felso'),baseline=await s.baseline();
    const first=await editorSave(s,s.episode.id,{treatmentPlanUpper:'Felső terv',treatmentPlanLower:null,expectedVersion:0,clinical:{baselineStateId:baseline.id,treatments:[],approved:true,occurredOn:'2026-01-02',source:'Terv',requestKey:crypto.randomUUID()}});
    expect(first.status).toBe(200);const original=(await first.json()).plan;
    const finance=(planId:string,expectedVersion:number)=>saveEpisodeFinancing(s.patient.id,s.doctor.id,financingCommandSchema.parse({action:'financing',episodeId:s.episode.id,requestKey:crypto.randomUUID(),expectedVersion,occurredOn:'2026-01-06',effectiveOn:'2026-01-06',source:'Határozat',reason:'Terv finanszírozása',planVersionId:planId,mode:'equity',status:'approved'}));
    await finance(original.clinicalPlan.id,0);
    const lower=await attach(s,'also');
    const read=await getPlanRoute(await authedRequest(`http://test.local/api/episodes/${s.episode.id}/treatment-plan`,{user:{id:s.doctor.id,email:s.doctor.email,role:'fogpótlástanász'}}),{params:{id:s.episode.id}});
    const pending=(await read.json()).plan;expect(pending.devices).toHaveLength(2);expect(pending.jaw).toBeNull();expect(pending.requiresDeviceReview).toBe(true);expect(pending.financing.current.requiresReview).toBe(true);
    expect((await s.load()).episodePlans).toHaveLength(1);
    const missingLower=await editorSave(s,s.episode.id,{treatmentPlanUpper:'Felső terv',treatmentPlanLower:null,expectedVersion:1,clinical:{baselineStateId:baseline.id,treatments:[],approved:true,occurredOn:'2026-01-05',source:'Terv',requestKey:crypto.randomUUID()}});
    expect(missingLower.status).toBe(409);
    const updated=await editorSave(s,s.episode.id,{treatmentPlanUpper:'Felső terv',treatmentPlanLower:'Alsó terv',expectedVersion:1,clinical:{baselineStateId:baseline.id,treatments:[{toothNumber:12,treatmentCode:'mufog'},{toothNumber:32,treatmentCode:'mufog'}],approved:true,occurredOn:'2026-01-05',source:'Két állcsont terve',requestKey:crypto.randomUUID()}});
    expect(updated.status).toBe(200);const plan=(await updated.json()).plan;expect(plan.requiresDeviceReview).toBe(false);
    const workspace=await s.load(),version=workspace.plans.find(p=>p.id===plan.clinicalPlan.id)!;
    expect(version.content.devices.map((p:any)=>p.id)).toEqual([upper.id,lower.id]);
    expect(Object.values(version.content.target.prostheses).map((p:any)=>p.prosthesisId)).toEqual(expect.arrayContaining([upper.id,lower.id]));
    expect(version.content.target.prostheses[`${lower.id}:32:denture_tooth`]).toMatchObject({prosthesisId:lower.id,tooth:32});
    expect(workspace.actual.prostheses).toEqual({});
    const sources=await loadNeakTreatmentSources(getDbPool(),s.patient.id);expect(sources.episodes).toHaveLength(1);expect(sources.episodes[0]).toMatchObject({planApproved:true,treatmentPlanUpper:'Felső terv',treatmentPlanLower:'Alsó terv'});
    const f=await finance(plan.clinicalPlan.id,1);expect((await getDbPool().query('SELECT prosthesis_id FROM episode_financing_events WHERE id=$1',[f.id])).rows[0].prosthesis_id).toBeNull();
    const input=packageSchema.parse({requestKey:crypto.randomUUID(),episodeId:s.episode.id,planVersionId:plan.clinicalPlan.id,statusStateId:baseline.id,prosthesisIds:[upper.id,lower.id]});
    const issued=await createClinicalPackage(s.patient.id,s.doctor.id,input);expect(await createClinicalPackage(s.patient.id,s.doctor.id,input)).toEqual(issued);
    const stored=(await getDbPool().query('SELECT prosthesis_ids,archive FROM clinical_document_packages WHERE id=$1',[issued.id])).rows[0];expect(stored.prosthesis_ids).toEqual([upper.id,lower.id]);expect(stored.archive.length).toBeGreaterThan(100);
    expect((await s.load()).plans.find(p=>p.id===original.clinicalPlan.id)?.content.devices).toHaveLength(1);
  });

  it('keeps shared work pending until each appliance has its own completed result, without delaying independent work',async()=>{
    const s=await setup(),upper=await attach(s,'felso'),lower=await attach(s,'also');
    const shared=await s.run({action:'work',episodeId:s.episode.id,label:'Közös próba',scope:'prosthesis',prosthesisIds:[upper.id,lower.id]});
    const independent=await s.run({action:'work',episodeId:s.episode.id,label:'Önálló felső munka',scope:'prosthesis',prosthesisIds:[upper.id]});
    await s.run({action:'visit',occurredOn:'2026-02-01',clinician:s.doctor.email,clinicalMinutes:40,links:[
      {prosthesisId:upper.id,phase:'construction',workPhaseId:shared.id,activity:'Felső próba',outcome:'completed',result:'Megfelelő'},
      {prosthesisId:lower.id,phase:'construction',workPhaseId:shared.id,activity:'Alsó próba',outcome:'unsuccessful',result:'Ismétlés szükséges'},
      {prosthesisId:upper.id,phase:'construction',workPhaseId:independent.id,activity:'Önálló munka',outcome:'completed',result:'Elkészült'},
    ]});
    let data=await s.load();expect(data.work.find(w=>w.id===shared.id)?.status).toBe('pending');expect(data.work.find(w=>w.id===independent.id)?.status).toBe('completed');
    expect(data.events.filter(e=>e.kind==='visit')).toHaveLength(1);
    await s.run({action:'visit',occurredOn:'2026-02-08',clinician:s.doctor.email,clinicalMinutes:20,links:[{prosthesisId:lower.id,phase:'construction',workPhaseId:shared.id,activity:'Alsó ismételt próba',outcome:'completed',result:'Megfelelő'}]});
    data=await s.load();expect(data.work.find(w=>w.id===shared.id)?.status).toBe('completed');
  });

  it('serializes competing registrations and rejects same-jaw and cross-patient links at the database boundary',async()=>{
    const s=await setup();const outcomes=await Promise.allSettled([attach(s,'felso'),attach(s,'felso')]);
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await s.load()).prostheses).toHaveLength(1);
    const upper=(await s.load()).prostheses[0],lower=await attach(s,'also');
    await expect(getDbPool().query("UPDATE prostheses SET jaw='felso' WHERE id=$1",[lower.id])).rejects.toMatchObject({code:'23514'});
    const other=await createTestPatient();patientIds.push(other.id);const ep=await createTestEpisode(undefined,other.id);
    await expect(getDbPool().query("INSERT INTO prosthesis_episode_links(episode_id,prosthesis_id,purpose) VALUES($1,$2,'repair')",[ep.id,upper.id])).rejects.toMatchObject({code:'23514'});
    expect((await s.load()).prostheses.find(p=>p.id===lower.id)?.jaw).toBe('also');
  });
});
