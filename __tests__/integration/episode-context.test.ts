import { afterEach,describe,expect,it,vi } from 'vitest';
import { getDbPool } from '@/lib/db';
import { saveEpisodeContext } from '@/lib/episode-context';
import { episodeContextSchema } from '@/lib/episode-overview';
import { PATCH } from '@/app/api/patients/[id]/episodes/[episodeId]/context/route';
import { authedRequest } from './helpers/auth';
import { createTestEpisode,createTestPatient,createTestUser,cleanupCreated } from './helpers/factories';
import { createOpenEpisodeWithInitialStageZero } from '@/lib/patient-episode-create';
import { syncAutoCreatedIntakeEpisode } from '@/lib/patient-intake-episode';
vi.mock('@/lib/recompute-kezeleoorvos',()=>({recomputeKezeleoorvosSilent:vi.fn()}));
vi.mock('@/lib/ohip14-patient-tasks',()=>({closeOpenOhipPatientTasksSilent:vi.fn(),closeOpenOhipEscalationTasksSilent:vi.fn()}));
const patients:string[]=[];
afterEach(async()=>{for(const patientId of patients){await getDbPool().query('DELETE FROM prosthesis_clinical_events WHERE patient_id=$1',[patientId]);await getDbPool().query('DELETE FROM patient_episodes WHERE patient_id=$1',[patientId]);}patients.length=0;await cleanupCreated();});
async function setup(){const user=await createTestUser(undefined,{role:'admin'}),patient=await createTestPatient(),episode=await createTestEpisode(undefined,patient.id);patients.push(patient.id);const row=(await getDbPool().query('SELECT chief_complaint AS "chiefComplaint",case_title AS "caseTitle",trigger_type AS "triggerType",reason,status FROM patient_episodes WHERE id=$1',[episode.id])).rows[0];return{user,patient,episode,row,command:()=>episodeContextSchema.parse({requestKey:crypto.randomUUID(),expected:{chiefComplaint:row.chiefComplaint,caseTitle:row.caseTitle,triggerType:row.triggerType},chiefComplaint:'Felső foghiány rehabilitációja',caseTitle:'Felső végleges',triggerType:'fogelvesztes'})};}
describe('Episode context without rewriting clinical history',()=>{
  it('keeps manual planning episodes open while replacing only an untouched automatic intake placeholder',async()=>{
    const s=await setup();
    const create=(autoCreated:boolean,chiefComplaint:string)=>createOpenEpisodeWithInitialStageZero(getDbPool(),{patientId:s.patient.id,reason:'traumás sérülés',chiefComplaint,caseTitle:null,parentEpisodeId:null,triggerType:null,treatmentTypeId:null,createdBy:s.user.id,autoCreated});
    const automatic=await create(true,'Felvételi helyőrző');
    const lower=await create(false,'Alsó ellátás megtervezése');
    const episodes=(await getDbPool().query('SELECT id,status FROM patient_episodes WHERE patient_id=$1',[s.patient.id])).rows;
    expect(episodes.find(e=>e.id===s.episode.id)?.status).toBe('open');
    expect(episodes.find(e=>e.id===lower.id)?.status).toBe('open');
    expect(episodes.find(e=>e.id===automatic.id)?.status).toBe('closed');
  });
  it('never overwrites a manually clarified intake indication during later patient edits',async()=>{
    const s=await setup();await getDbPool().query('UPDATE patient_episodes SET auto_created=TRUE WHERE id=$1',[s.episode.id]);
    const command=s.command();await saveEpisodeContext(s.patient.id,s.episode.id,s.user.id,command);
    expect(await syncAutoCreatedIntakeEpisode(getDbPool(),s.patient.id,{beutaloIndokolas:'Később szerkesztett betegadat'})).toBe(0);
    expect((await getDbPool().query('SELECT chief_complaint FROM patient_episodes WHERE id=$1',[s.episode.id])).rows[0].chief_complaint).toBe(command.chiefComplaint);
  });
  it('records an audited change and retries idempotently without modifying the plan or episode state',async()=>{
    const s=await setup(),command=s.command();
    await getDbPool().query("UPDATE patient_episodes SET treatment_plan_upper='Megőrzendő terv',treatment_plan_version=4 WHERE id=$1",[s.episode.id]);
    const first=await saveEpisodeContext(s.patient.id,s.episode.id,s.user.id,command);
    expect(await saveEpisodeContext(s.patient.id,s.episode.id,s.user.id,command)).toEqual(first);
    const row=(await getDbPool().query('SELECT reason,status,treatment_plan_upper,treatment_plan_version,chief_complaint,case_title FROM patient_episodes WHERE id=$1',[s.episode.id])).rows[0];
    expect(row).toMatchObject({reason:s.row.reason,status:s.row.status,treatment_plan_upper:'Megőrzendő terv',treatment_plan_version:4,chief_complaint:command.chiefComplaint,case_title:command.caseTitle});
    const events=(await getDbPool().query('SELECT kind,payload,recorded_by FROM prosthesis_clinical_events WHERE episode_id=$1',[s.episode.id])).rows;
    expect(events).toHaveLength(1);expect(events[0]).toMatchObject({kind:'episode_context_updated',recorded_by:s.user.id,payload:{before:{chiefComplaint:s.row.chiefComplaint},after:{chiefComplaint:command.chiefComplaint}}});
  });
  it('accepts only one concurrent edit and returns the current context to the rejected editor',async()=>{
    const s=await setup();const outcomes=await Promise.allSettled([saveEpisodeContext(s.patient.id,s.episode.id,s.user.id,s.command()),saveEpisodeContext(s.patient.id,s.episode.id,s.user.id,{...s.command(),chiefComplaint:'Másik szerkesztő indoka'})]);
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409,code:'EPISODE_CONTEXT_CONFLICT',details:{context:{chiefComplaint:expect.any(String)}}});
  });
  it('preserves the complete indication beyond the old title-sized limit',async()=>{
    const s=await setup(),chiefComplaint='A klinikai indok részletes leírása. '.repeat(25).trim();
    await saveEpisodeContext(s.patient.id,s.episode.id,s.user.id,{...s.command(),chiefComplaint});
    expect((await getDbPool().query('SELECT chief_complaint FROM patient_episodes WHERE id=$1',[s.episode.id])).rows[0].chief_complaint).toBe(chiefComplaint);
  });
  it('rejects another patient and persists through the authenticated endpoint',async()=>{
    const s=await setup(),other=await createTestPatient();patients.push(other.id);
    await expect(saveEpisodeContext(other.id,s.episode.id,s.user.id,s.command())).rejects.toMatchObject({status:404});
    const result=await PATCH(await authedRequest(`http://test.local/api/patients/${s.patient.id}/episodes/${s.episode.id}/context`,{method:'PATCH',user:{id:s.user.id,email:s.user.email,role:'admin'},body:s.command()}),{params:{id:s.patient.id,episodeId:s.episode.id}});
    expect(result.status).toBe(200);expect((await result.json()).context.chiefComplaint).toBe('Felső foghiány rehabilitációja');
  });
});
