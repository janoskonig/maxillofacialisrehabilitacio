import { afterEach,describe,expect,it,vi } from 'vitest';
import { createHash } from 'crypto';
import { getDbPool } from '@/lib/db';
import { clinicalCommandSchema,emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import { executeClinicalCommand,loadClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { financingCommandSchema } from '@/lib/episode-financing/model';
import { loadEpisodeFinancing,saveEpisodeFinancing } from '@/lib/episode-financing/service';
import { createClinicalPackage,packageSchema } from '@/lib/prosthesis-lifecycle/packages';
import { loadEpisodeTreatmentPlan } from '@/lib/prosthesis-lifecycle/plans';
import { loadNeakTreatmentSources } from '@/lib/neak-treatment-sources';
import { buildTreatmentExportContent } from '@/lib/neak-treatment-content';
import { GET,POST } from '@/app/api/episodes/[id]/financing/route';
import { authedRequest } from './helpers/auth';
import { createTestEpisode,createTestPatient,createTestUser,cleanupCreated } from './helpers/factories';
vi.mock('@/lib/ftp-client',()=>({downloadFile:vi.fn(async()=>Buffer.from('Döntési melléklet változatlan tartalma'))}));
const patients:string[]=[];
afterEach(async()=>{
  const db=getDbPool();
  for(const id of patients){
    for(const table of ['clinical_document_packages','episode_financing_events','prosthesis_plan_versions','episode_prosthesis_goals','clinical_followup_tasks','prosthesis_repair_cases','clinical_dental_states','prosthesis_clinical_events','patient_documents'])await db.query(`DELETE FROM ${table} WHERE patient_id=$1`,[id]);
    await db.query('DELETE FROM prosthesis_episode_links WHERE prosthesis_id IN(SELECT id FROM prostheses WHERE patient_id=$1)',[id]);
    await db.query('DELETE FROM prostheses WHERE patient_id=$1',[id]);
    await db.query('DELETE FROM patient_episodes WHERE patient_id=$1',[id]);
  }
  patients.length=0;await cleanupCreated();
});
async function setup(){
  const doctor=await createTestUser(undefined,{role:'admin'}),patient=await createTestPatient();patients.push(patient.id);
  const parent=await createTestEpisode(undefined,patient.id);
  const run=(input:Record<string,unknown>)=>executeClinicalCommand(patient.id,doctor.id,clinicalCommandSchema.parse({requestKey:crypto.randomUUID(),occurredOn:'2026-01-01',source:'Korabeli karton',...input}));
  const device=await run({action:'register',episodeId:parent.id,jaw:'felso',role:'definitive',origin:'local',prosthesisType:'removable',label:'Felső végleges'});
  const episode={id:(await getDbPool().query('SELECT episode_id FROM prostheses WHERE id=$1',[device.id])).rows[0].episode_id as string};
  const base=await run({action:'status',episodeId:episode.id,mode:'assessment',layers:emptyLayers()});
  const plan=await run({action:'plan',episodeId:episode.id,baselineStateId:base.id,description:'Felső pótlás készítése',approved:true,prosthesisIds:[device.id],treatments:[]});
  const command=(fields:Record<string,unknown>={})=>financingCommandSchema.parse({action:'financing',requestKey:crypto.randomUUID(),episodeId:episode.id,expectedVersion:0,
    occurredOn:'2026-09-01',effectiveOn:'2026-09-01',source:'Döntési dokumentum',planVersionId:plan.id,mode:'equity',status:'approved',reason:'Méltányossági támogatás elfogadva',totalAmount:'1000',fundedAmount:'800',patientAmount:'200',...fields});
  const finance=(fields:Record<string,unknown>={})=>saveEpisodeFinancing(patient.id,doctor.id,command(fields));
  const load=()=>loadEpisodeFinancing(getDbPool(),episode.id,plan.id);
  return {doctor,patient,episode,device,base,plan,run,command,finance,load};
}
describe('Episode financing with clinical plan changes',()=>{
  it('changes financing within the same episode, leaves clinical data untouched, and exports the selected decision',async()=>{
    const s=await setup(),db=getDbPool(),before=await loadClinicalWorkspace(s.patient.id);
    await s.finance();
    await s.finance({expectedVersion:1,occurredOn:'2026-10-01',effectiveOn:'2026-10-01',mode:'self_pay',fundedAmount:'0',patientAmount:'1000',reason:'Támogatás helyett önköltséges ellátás'});
    const after=await loadClinicalWorkspace(s.patient.id);
    expect(after.episodes).toEqual(before.episodes);expect(after.prostheses).toEqual(before.prostheses);
    expect(after.plans).toEqual(before.plans);expect(after.work).toEqual(before.work);expect(after.appointments).toEqual(before.appointments);expect(after.actual).toEqual(before.actual);
    expect(after.financingEvents).toHaveLength(2);
    expect((await s.load()).current).toMatchObject({requiresReview:false,event:{mode:'self_pay',patient_amount:'1000.00',prosthesis_id:s.device.id}});
    const text=buildTreatmentExportContent({},await loadNeakTreatmentSources(db,s.patient.id)).sections.flatMap(s=>s.lines).join('\n');
    expect(text).toContain('Önköltséges');expect(text).toContain('Támogatás helyett önköltséges ellátás');
  });
  it('requires financial review after a new plan, preserves old approval and resolves it with a new decision',async()=>{
    const s=await setup(),db=getDbPool();await s.finance();
    const old=(await db.query('SELECT content FROM prosthesis_plan_versions WHERE id=$1',[s.plan.id])).rows[0].content;
    const next=await s.run({action:'plan',episodeId:s.episode.id,description:'Új klinikai megoldás',approved:true,occurredOn:'2026-10-01',expectedVersion:1});
    let record=await loadEpisodeTreatmentPlan(db,s.episode.id,true);
    expect(record?.clinicalPlan).toMatchObject({id:next.id,approved:true});expect(record?.financing?.current.requiresReview).toBe(true);
    await expect(createClinicalPackage(s.patient.id,s.doctor.id,packageSchema.parse({requestKey:crypto.randomUUID(),episodeId:s.episode.id,planVersionId:next.id,statusStateId:s.base.id,prosthesisIds:[s.device.id]}))).rejects.toMatchObject({status:409});
    expect((await db.query('SELECT content FROM prosthesis_plan_versions WHERE id=$1',[s.plan.id])).rows[0].content).toEqual(old);
    expect((await db.query('SELECT content FROM prosthesis_plan_versions WHERE id=$1',[next.id])).rows[0].content.financing.requiresReview).toBe(true);
    await s.finance({expectedVersion:1,planVersionId:next.id,occurredOn:'2026-10-02',effectiveOn:'2026-10-02',status:'pending',reason:'Módosított terv újraelbírálása'});
    record=await loadEpisodeTreatmentPlan(db,s.episode.id,true);
    expect(record?.financing?.current).toMatchObject({requiresReview:false,event:{plan_version_id:next.id,status:'pending'}});
  });
  it('places late entries by effective date and keeps future decisions separate',async()=>{
    const s=await setup();await s.finance({occurredOn:'2026-10-01',effectiveOn:'2026-10-01',mode:'self_pay',fundedAmount:'0',patientAmount:'1000'});
    const backdated=await s.finance({expectedVersion:1});
    await s.finance({expectedVersion:2,occurredOn:'2026-10-15',effectiveOn:'2099-01-01',status:'pending'});
    const loaded=await s.load();expect(loaded.current.event?.mode).toBe('self_pay');expect(loaded.upcoming).toHaveLength(1);
    const entry=loaded.history.find(e=>e.id===backdated.id)!;
    expect(entry.occurred_on).toBe('2026-09-01');expect(entry.recorded_at.slice(0,10)>entry.occurred_on).toBe(true);
    await expect(s.finance({expectedVersion:3,occurredOn:'2099-01-01'})).rejects.toMatchObject({status:400});
  });
  it('appends immutable corrections, retries without duplication and rejects reused keys with different content',async()=>{
    const s=await setup(),first=await s.finance(),c=s.command({expectedVersion:1,correctsId:first.id,patientAmount:'300',fundedAmount:'700',reason:'Hibás összeg helyesbítése'});
    const corrected=await saveEpisodeFinancing(s.patient.id,s.doctor.id,c);
    expect(await saveEpisodeFinancing(s.patient.id,s.doctor.id,c)).toEqual(corrected);
    const loaded=await s.load();expect(loaded.history).toHaveLength(2);expect(loaded.history.find(e=>e.id===first.id)?.active).toBe(false);expect(loaded.current.event?.patient_amount).toBe('300.00');
    await expect(getDbPool().query('UPDATE episode_financing_events SET reason=$2 WHERE id=$1',[first.id,'Felülírás'])).rejects.toMatchObject({code:'23514'});
    await expect(saveEpisodeFinancing(s.patient.id,s.doctor.id,{...c,reason:'Más tartalom'})).rejects.toMatchObject({status:409});
  });
  it('allows one concurrent writer and rejects decisions for another patient or a later plan',async()=>{
    const s=await setup(),other=await setup();
    const attempts=await Promise.allSettled([s.finance(),s.finance({reason:'Második szerkesztő'})]);
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((attempts.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409,code:'FINANCING_CONFLICT'});
    await expect(s.finance({expectedVersion:1,planVersionId:other.plan.id})).rejects.toMatchObject({status:400});
    await expect(s.finance({expectedVersion:1,documentIds:[crypto.randomUUID()]})).rejects.toMatchObject({status:400});
    await expect(s.finance({expectedVersion:1,occurredOn:'2025-01-01',effectiveOn:'2025-01-01'})).rejects.toMatchObject({status:409});
  });
  it('archives exact financial decisions and supporting documents while later changes leave old bytes unchanged',async()=>{
    const s=await setup(),db=getDbPool();
    const document=(await db.query(`INSERT INTO patient_documents(patient_id,filename,file_path,file_size,mime_type,uploaded_by) VALUES($1,'hatarozat.txt','test/hatarozat.txt',50,'text/plain',$2) RETURNING id`,[s.patient.id,s.doctor.id])).rows[0];
    const first=await s.finance({documentIds:[document.id]});
    const input=packageSchema.parse({requestKey:crypto.randomUUID(),episodeId:s.episode.id,planVersionId:s.plan.id,statusStateId:s.base.id,prosthesisIds:[s.device.id]});
    const issued=await createClinicalPackage(s.patient.id,s.doctor.id,input);
    const read=async(id:string)=>(await db.query('SELECT archive,sha256,manifest FROM clinical_document_packages WHERE id=$1',[id])).rows[0];
    const old=await read(issued.id);expect(old.manifest.financing.event.id).toBe(first.id);
    expect(old.manifest.files.some((f:any)=>f.name.includes(document.id))).toBe(true);
    const next=await s.finance({expectedVersion:1,occurredOn:'2026-10-01',effectiveOn:'2026-10-01',mode:'self_pay',fundedAmount:'0',patientAmount:'1000'});
    expect(await createClinicalPackage(s.patient.id,s.doctor.id,input)).toEqual(issued);
    expect((await read(issued.id)).archive.equals(old.archive)).toBe(true);
    expect(createHash('sha256').update(old.archive).digest('hex')).toBe(old.sha256);
    const newer=await createClinicalPackage(s.patient.id,s.doctor.id,{...input,requestKey:crypto.randomUUID()});
    expect((await read(newer.id)).manifest.financing.event.id).toBe(next.id);
    const historical=await createClinicalPackage(s.patient.id,s.doctor.id,{...input,requestKey:crypto.randomUUID(),financingEventId:first.id});
    expect((await read(historical.id)).manifest.financing).toMatchObject({historical:true,event:{id:first.id}});
  });
  it('persists through the authenticated API and reports a revision conflict to the caller',async()=>{
    const s=await setup(),user={id:s.doctor.id,email:s.doctor.email,role:'admin' as const};
    const call=async(body:unknown)=>POST(await authedRequest(`http://test.local/api/episodes/${s.episode.id}/financing`,{user,method:'POST',body}),{params:{id:s.episode.id}});
    expect((await call(s.command())).status).toBe(200);
    const conflict=await call(s.command());expect(conflict.status).toBe(409);expect((await conflict.json())._errorMeta.code).toBe('FINANCING_CONFLICT');
    const loaded=await GET(await authedRequest(`http://test.local/api/episodes/${s.episode.id}/financing`,{user}),{params:{id:s.episode.id}});
    expect((await loaded.json()).financing.current.event.status).toBe('approved');
  });
  it('records repair financing in its own episode for the same durable appliance, preserving construction funding',async()=>{
    const s=await setup();await s.finance();
    await s.run({action:'milestone',prosthesisId:s.device.id,milestone:'delivered',occurredOn:'2026-02-01'});
    const repair=await s.run({action:'repair',prosthesisId:s.device.id,baselineStateId:s.base.id,reason:'Törés',plan:'Javítás',occurredOn:'2026-10-01'});
    const ep=(await getDbPool().query('SELECT episode_id FROM prosthesis_repair_cases WHERE id=$1',[repair.id])).rows[0].episode_id;
    expect((await loadEpisodeFinancing(getDbPool(),ep,null)).current.event).toBeNull();
    const repairPlan=await s.run({action:'plan',episodeId:ep,description:'Lemez javítása',baselineStateId:s.base.id,approved:true,occurredOn:'2026-10-01'});
    await s.finance({episodeId:ep,planVersionId:repairPlan.id,occurredOn:'2026-10-02',effectiveOn:'2026-10-02',mode:'self_pay',fundedAmount:'0',patientAmount:'1000',reason:'Javítás önköltségen'});
    expect((await s.load()).current.event?.mode).toBe('equity');
    expect((await loadEpisodeFinancing(getDbPool(),ep,repairPlan.id)).current.event).toMatchObject({prosthesis_id:s.device.id,mode:'self_pay'});
  });
});
