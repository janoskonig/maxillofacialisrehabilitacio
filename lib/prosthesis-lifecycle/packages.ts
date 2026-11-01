import { createHash,randomUUID } from 'crypto';
import archiver from 'archiver';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { downloadFile } from '@/lib/ftp-client';
import { safeFilename } from '@/lib/utils';
import { withNeakDownloadTimeout } from '@/lib/neak-export';
import { canonical, replayStates } from './model';
import { loadClinicalStates } from './service';
import { clinicalPlanPDF, clinicalStatusPDF } from './pdf';

export const packageSchema=z.object({
  requestKey:z.string().uuid(),episodeId:z.string().uuid(),planVersionId:z.string().uuid(),statusStateId:z.string().uuid(),
  prosthesisIds:z.array(z.string().uuid()).length(1),documentIds:z.array(z.string().uuid()).max(50).default([]),
  supplementsId:z.string().uuid().nullable().default(null),
});
export async function zipClinicalFiles(files:Array<{name:string;buffer:Buffer}>):Promise<Buffer> {
  const archive=archiver('zip',{zlib:{level:9}}), chunks:Buffer[]=[];
  const result=new Promise<Buffer>((resolve,reject)=>{archive.on('data',(chunk:Buffer)=>chunks.push(chunk));archive.on('end',()=>resolve(Buffer.concat(chunks)));archive.on('error',reject);});
  for (const f of files) archive.append(f.buffer,{name:f.name,date:new Date('2000-01-01T00:00:00Z')});
  await archive.finalize();return result;
}
/** Retains the existing NEAK export too, including every generated/uploaded byte. */
export async function preserveNeakExport(patientId:string,actor:string,files:Array<{name:string;buffer:Buffer}>) {
  const archive=await zipClinicalFiles(files),sha=createHash('sha256').update(archive).digest('hex');
  const manifest={kind:'neak_export',files:files.map(f=>({name:f.name,size:f.buffer.length,sha256:createHash('sha256').update(f.buffer).digest('hex')}))};
  const r=await getDbPool().query(`INSERT INTO clinical_document_packages(patient_id,request_key,manifest,archive,sha256,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[patientId,randomUUID(),JSON.stringify(manifest),archive,sha,actor]);
  return {id:r.rows[0].id as string,archive};
}
export async function createClinicalPackage(patientId:string,actor:string,input:z.infer<typeof packageSchema>) {
  const db=await getDbPool().connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    // Lock first: the same request cannot generate a second version or archive.
    const patient=await db.query('SELECT id,nev,taj FROM patients WHERE id=$1 FOR UPDATE',[patientId]);
    if (!patient.rows.length) throw new HttpError(404,'Beteg nem található');
    const old=await db.query('SELECT id,manifest FROM clinical_document_packages WHERE patient_id=$1 AND request_key=$2',[patientId,input.requestKey]);
    if (old.rows.length) {
      if (canonical(old.rows[0].manifest.selection)!==canonical(input)) throw new HttpError(409,'A csomagkulcs más kiválasztáshoz tartozik');
      await db.query('COMMIT');return {id:old.rows[0].id};
    }
    const plan=await db.query(`SELECT p.*,e.occurred_on::text AS approved_on,e.recorded_at,e.recorded_by FROM prosthesis_plan_versions p
      JOIN prosthesis_active_events e ON e.id=p.event_id WHERE p.patient_id=$1 AND p.id=$2 AND p.episode_id=$3 AND p.approved`,[patientId,input.planVersionId,input.episodeId]);
    if (!plan.rows.length) throw new HttpError(409,'A kiválasztott epizód jóváhagyott tervverziója szükséges');
    if (input.prosthesisIds.some(id=>!plan.rows[0].content.devices.some((p:{id:string})=>p.id===id))) throw new HttpError(409,'A pótlás nem része a kijelölt tervverziónak');
    const states=await loadClinicalStates(db,patientId), selected=states.find(s=>s.id===input.statusStateId);
    if (!selected) throw new HttpError(404,'A kijelölt státuszváltozat nem található');
    const replay=replayStates(states,selected.id);
    if (replay.conflicts.length) throw new HttpError(409,'A státusz idővonalán lévő eltérést kiadás előtt felül kell vizsgálni');
    if (input.supplementsId) {
      const previous=await db.query('SELECT id FROM clinical_document_packages WHERE patient_id=$1 AND id=$2',[patientId,input.supplementsId]);
      if (!previous.rows.length) throw new HttpError(404,'Az előző dokumentumcsomag nem található');
    }
    const evidence={status:selected,states:replay.milestones.map(m=>m.state),layers:replay.layers,plan:plan.rows[0]};
    const metadata=`Státusz: ${selected.occurred_on}; rögzítve: ${selected.recorded_at}; rögzítette: ${selected.recorder??selected.recorded_by}; forrás: ${selected.source}; esemény: ${selected.event_id}`;
    const files=[
      {name:'dental_status.pdf',buffer:await clinicalStatusPDF(patient.rows[0],replay.layers,metadata)},
      {name:'treatment_plan.pdf',buffer:await clinicalPlanPDF(patient.rows[0],plan.rows[0],`Jóváhagyás: ${plan.rows[0].approved_on}; tervazonosító: ${input.planVersionId}`)},
      {name:'clinical_evidence.json',buffer:Buffer.from(JSON.stringify(evidence,null,2))},
    ];
    const docs=await db.query('SELECT id,filename,file_path FROM patient_documents WHERE patient_id=$1 AND id=ANY($2::uuid[])',[patientId,input.documentIds]);
    if (docs.rows.length!==new Set(input.documentIds).size) throw new HttpError(400,'A melléklet nem a beteghez tartozik');
    let size=files.reduce((n,f)=>n+f.buffer.length,0);
    for (const doc of docs.rows) {
      const buffer=await withNeakDownloadTimeout(downloadFile(doc.file_path,patientId),30000);
      size+=buffer.length;
      if (!buffer.length || size>100*1024*1024) throw new HttpError(413,'Üres melléklet vagy túl nagy csomag (legfeljebb 100 MB)');
      files.push({name:`documents/${doc.id}_${safeFilename(doc.filename)}`,buffer});
    }
    const manifest={selection:input,statusDate:selected.occurred_on,planVersion:plan.rows[0].version,
      files:files.map(f=>({name:f.name,size:f.buffer.length,sha256:createHash('sha256').update(f.buffer).digest('hex')}))};
    files.push({name:'manifest.json',buffer:Buffer.from(JSON.stringify(manifest,null,2))});
    const archive=await zipClinicalFiles(files), sha=createHash('sha256').update(archive).digest('hex');
    const r=await db.query(`INSERT INTO clinical_document_packages(patient_id,episode_id,plan_version_id,status_state_id,prosthesis_ids,supplements_id,request_key,manifest,archive,sha256,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[patientId,input.episodeId,input.planVersionId,input.statusStateId,input.prosthesisIds,input.supplementsId,input.requestKey,JSON.stringify(manifest),archive,sha,actor]);
    await db.query('COMMIT');return {id:r.rows[0].id};
  } catch(e) { await db.query('ROLLBACK');throw e; } finally {db.release();}
}
