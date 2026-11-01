import { afterEach,describe,expect,it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { reviewCommandSchema,clinicalTemplate,type EpisodeClinicalContent } from '@/lib/episode-clinical/model';
import { loadEpisodeClinical,saveEpisodeReview } from '@/lib/episode-clinical/service';
import { GET,POST } from '@/app/api/patients/[id]/episodes/[episodeId]/clinical/route';
import { authedRequest } from './helpers/auth';
import { createTestUser,createTestPatient,createTestEpisode,cleanupCreated } from './helpers/factories';
import { getOhipPatientContext } from '@/lib/ohip14-stage';
import { GET as getOhip } from '@/app/api/patients/[id]/ohip14/route';
const patients:string[]=[];
afterEach(async()=>{for(const id of patients){await getDbPool().query('DELETE FROM ohip14_responses WHERE patient_id=$1',[id]);await getDbPool().query('DELETE FROM episode_clinical_reviews WHERE patient_id=$1',[id]);await getDbPool().query('DELETE FROM prosthesis_clinical_events WHERE patient_id=$1',[id]);}patients.length=0;await cleanupCreated();});
async function setup(){
  const user=await createTestUser(undefined,{role:'admin'}),patient=await createTestPatient();patients.push(patient.id);
  const episode=await createTestEpisode(undefined,patient.id,{reason:'onkológiai kezelés utáni állapot'});
  const content=clinicalTemplate({nev:'Felülvizsgált név',diagnozis:'Korábbi daganat',radioterapia:true},'onkológiai kezelés utáni állapot');
  const command=(overrides:Record<string,unknown>={})=>reviewCommandSchema.parse({requestKey:crypto.randomUUID(),expectedVersion:0,expectedReason:'onkológiai kezelés utáni állapot',effectiveOn:'2026-01-15',source:'Korabeli vizsgálati lap',note:'Alapadatok ellenőrizve',sourceReviewId:null,reviewed:true,content,...overrides});
  return {user,patient,episode,content,command,save:(c:ReturnType<typeof command>)=>saveEpisodeReview(patient.id,episode.id,user.id,c),load:()=>loadEpisodeClinical(patient.id,episode.id)};
}
describe('Episode as the clinical observation unit',()=>{
  it('reads a selected closed episode questionnaire without substituting an open episode or unassigned legacy response',async()=>{
    const s=await setup(),newer=await createTestEpisode(undefined,s.patient.id);await getDbPool().query("UPDATE patient_episodes SET status='closed',closed_at=now() WHERE id=$1",[s.episode.id]);
    await getDbPool().query("INSERT INTO ohip14_responses(patient_id,episode_id,timepoint,notes) VALUES($1,$2,'T0','Korábbi epizód'),($1,$3,'T0','Másik nyitott epizód'),($1,NULL,'T1','Nem megfeleltetett régi válasz')",[s.patient.id,s.episode.id,newer.id]);
    expect((await getOhipPatientContext(getDbPool(),s.patient.id,s.episode.id)).episodeId).toBe(s.episode.id);
    const response=await getOhip(await authedRequest(`http://test.local/api/patients/${s.patient.id}/ohip14?episodeId=${s.episode.id}`,{user:{id:s.user.id,email:s.user.email,role:'admin'}}),{params:{id:s.patient.id}});
    const result=await response.json();expect(response.status).toBe(200);expect(result.responses).toHaveLength(1);expect(result.responses[0].notes).toBe('Korábbi epizód');expect(result.context.activeEpisodeId).toBe(s.episode.id);
    const other=await setup();await expect(getOhipPatientContext(getDbPool(),other.patient.id,s.episode.id)).rejects.toMatchObject({status:404});
  });
  it('keeps historical episodes and their reviewed anamnesis separate when a later episode is traumatic',async()=>{
    const s=await setup();await s.save(s.command());
    const later=await createTestEpisode(undefined,s.patient.id,{reason:'traumás sérülés'});
    const draft=clinicalTemplate({diagnozis:'Mandibulatörés',radioterapia:true},'traumás sérülés');
    await saveEpisodeReview(s.patient.id,later.id,s.user.id,s.command({expectedReason:'traumás sérülés',effectiveOn:'2026-03-01',content:draft}));
    expect((await s.load()).current?.content.anamnesis.diagnozis).toBe('Korábbi daganat');
    expect((await loadEpisodeClinical(s.patient.id,later.id)).current?.content).toMatchObject({reason:'traumás sérülés',anamnesis:{diagnozis:'Mandibulatörés',radioterapia:true}});
    await getDbPool().query("UPDATE patient_anamnesis SET diagnozis='Mai közös kartonadat' WHERE patient_id=$1",[s.patient.id]);
    expect((await s.load()).current?.content.anamnesis.diagnozis).toBe('Korábbi daganat');
    expect((await getDbPool().query('SELECT reason FROM patient_episodes WHERE id=$1',[s.episode.id])).rows[0].reason).toBe('onkológiai kezelés utáni állapot');
  });
  it('preserves repeated surgeries with stable identities and an immutable review history',async()=>{
    const s=await setup();const surgeries=['Reszekció','Rekonstrukció'].map((procedure,index)=>({id:crypto.randomUUID(),occurredOn:`2025-0${index+1}-01`,approximateDate:'',procedure,indication:'Onkológiai rehabilitáció',institution:'Műtéti osztály',source:'Zárójelentés'}));
    const first=await s.save(s.command({content:{...s.content,surgicalHistory:'documented',surgeries}}));
    const changed={...first.review.content,surgeries:first.review.content.surgeries.map((r,index)=>index===1?{...r,procedure:'Rekonstrukció, pontosított leírás'}:r)};
    await s.save(s.command({expectedVersion:1,effectiveOn:'2026-02-01',sourceReviewId:first.review.id,content:changed}));
    const result=await s.load();expect(result.history).toHaveLength(2);expect(result.history[1].content.surgeries[1].procedure).toBe('Rekonstrukció');expect(result.current?.content.surgeries[1].id).toBe(surgeries[1].id);
    await expect(getDbPool().query("UPDATE episode_clinical_reviews SET note='Átírás' WHERE id=$1",[first.review.id])).rejects.toMatchObject({code:'23514'});
  });
  it('places retrospective observations on clinical dates without replacing later documented state',async()=>{
    const s=await setup();await s.save(s.command({effectiveOn:'2026-03-01',content:{...s.content,reason:'traumás sérülés'}}));
    const past=await s.save(s.command({expectedVersion:1,expectedReason:'traumás sérülés',effectiveOn:'2026-01-01'}));
    const data=await s.load();expect(data.current?.effectiveOn).toBe('2026-03-01');expect(data.current?.content.reason).toBe('traumás sérülés');expect(data.latestVersion).toBe(2);
    expect(past.review.recordedBy).toBe(s.user.id);expect(past.review.recordedAt.slice(0,10)).not.toBe(past.review.effectiveOn);
    expect((await getDbPool().query('SELECT reason FROM patient_episodes WHERE id=$1',[s.episode.id])).rows[0].reason).toBe('traumás sérülés');
  });
  it('is idempotent and accepts only one of two concurrent revisions',async()=>{
    const s=await setup(),command=s.command();const first=await s.save(command);expect(await s.save(command)).toEqual(first);
    const outcomes=await Promise.allSettled([s.save(s.command({expectedVersion:1})),s.save(s.command({expectedVersion:1,note:'Másik orvos'}))]);
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409,code:'EPISODE_CLINICAL_CONFLICT'});
    expect((await s.load()).history).toHaveLength(2);await expect(s.save({...command,note:'Más tartalom azonos kulccsal'})).rejects.toMatchObject({status:409});
  });
  it('requires explicit review and validates surgery chronology and duplicate identities',()=>{
    const content=clinicalTemplate({},'traumás sérülés');const surgery={id:crypto.randomUUID(),occurredOn:'2026-03-01',approximateDate:'',procedure:'Rekonstrukció',indication:'',institution:'',source:'Zárójelentés'};
    const command={requestKey:crypto.randomUUID(),expectedVersion:0,expectedReason:'traumás sérülés',effectiveOn:'2026-02-01',source:'Vizsgálat',note:'',sourceReviewId:null,reviewed:true,content:{...content,surgicalHistory:'documented',surgeries:[surgery]}};
    expect(reviewCommandSchema.safeParse(command).success).toBe(false);expect(reviewCommandSchema.safeParse({...command,effectiveOn:'2026-03-02',reviewed:false}).success).toBe(false);
    expect(reviewCommandSchema.safeParse({...command,effectiveOn:'2026-03-02',content:{...command.content,surgeries:[surgery,surgery]}}).success).toBe(false);
  });
  it('never invents historical clinical records from the current chart and exposes the authenticated API',async()=>{
    const s=await setup();await getDbPool().query("UPDATE patients SET szuletesi_datum='1970-01-01' WHERE id=$1",[s.patient.id]);
    const data=await s.load();expect(data.template.basics.szuletesiDatum).toBe('1970-01-01');expect(data.current).toBeNull();expect(data.history).toEqual([]);expect(data.templateProvenance).toBe('legacy_unreviewed');
    const request=(method:string,body?:unknown)=>authedRequest(`http://test.local/api/patients/${s.patient.id}/episodes/${s.episode.id}/clinical`,{method,user:{id:s.user.id,email:s.user.email,role:'admin'},body});
    expect((await GET(await request('GET'),{params:{id:s.patient.id,episodeId:s.episode.id}})).status).toBe(200);
    expect((await POST(await request('POST',s.command()),{params:{id:s.patient.id,episodeId:s.episode.id}})).status).toBe(200);
    expect((await s.load()).history).toHaveLength(1);
  });
  it('rejects cross-patient episode and source references',async()=>{
    const s=await setup(),other=await setup();const source=await other.save(other.command());
    await expect(loadEpisodeClinical(s.patient.id,other.episode.id)).rejects.toMatchObject({status:404});
    await expect(s.save(s.command({sourceReviewId:source.review.id}))).rejects.toMatchObject({status:400});
    const badContent:EpisodeClinicalContent={...s.content,baselineStateId:crypto.randomUUID()};await expect(s.save(s.command({content:badContent}))).rejects.toMatchObject({status:400});
  });
});
