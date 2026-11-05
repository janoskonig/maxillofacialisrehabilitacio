import {afterEach,expect,it} from 'vitest';
import {getDbPool} from '@/lib/db';
import {patientSelectSql} from '@/lib/patient-select';
import {PUT} from '@/app/api/patients/[id]/route';
import {authedRequest} from './helpers/auth';
import {createTestPatient,createTestUser,cleanupCreated} from './helpers/factories';
import {FIXED_TYPES,REMOVABLE_TYPES} from '@/lib/prosthesis-types';
import {COMPONENT_IDS} from '@/lib/prosthesis-components';
afterEach(cleanupCreated);
it('round-trips every detailed prosthetic element through the intake API without losing tooth findings or implant details',async()=>{
 const patient=await createTestPatient(),doctor=await createTestUser(undefined,{role:'admin'});
 const meglevoFogak={14:{base:'root_canal',periapical:true,mobility:2,description:'Korábbi lelet',surfaces:{mesial:'filling'},components:COMPONENT_IDS},16:{base:'missing',components:['position_implant','implant_single_crown_screwed']}};
 const meglevoImplantatumok={16:'REF: eredeti LOT: megőrzött'};
 const row=(await getDbPool().query('SELECT updated_at FROM patients WHERE id=$1',[patient.id])).rows[0];
 const req=await authedRequest(`http://test.local/api/patients/${patient.id}`,{method:'PUT',user:{id:doctor.id,email:doctor.email,role:'admin'},body:{nev:'Szintetikus közös elemkatalógus-teszt',meglevoFogak,meglevoImplantatumok}});
 req.headers.set('if-match',new Date(row.updated_at).toISOString());
 const response=await PUT(req,{params:{id:patient.id}});expect(response.status).toBe(200);
 const saved=(await getDbPool().query('SELECT meglevo_fogak,meglevo_implantatumok FROM patient_dental_status WHERE patient_id=$1',[patient.id])).rows[0];
 expect(saved.meglevo_fogak).toEqual(meglevoFogak);expect(saved.meglevo_implantatumok).toEqual(meglevoImplantatumok);
});
it('round-trips multiple types through the patient API and preserves them when an old client omits the array',async()=>{
 const patient=await createTestPatient(),doctor=await createTestUser(undefined,{role:'admin'});
 const types=[FIXED_TYPES[0],FIXED_TYPES[1],REMOVABLE_TYPES[0]];
 const save=async(body:unknown)=>{
  const req=await authedRequest(`http://test.local/api/patients/${patient.id}`,{method:'PUT',user:{id:doctor.id,email:doctor.email,role:'admin'},body});
  const row=(await getDbPool().query('SELECT updated_at FROM patients WHERE id=$1',[patient.id])).rows[0];req.headers.set('if-match',new Date(row.updated_at).toISOString());
  return PUT(req,{params:{id:patient.id}});
 };
 const response=await save({nev:'Többféle pótlás mintabeteg',felsoFogpotlasVan:true,felsoFogpotlasTipus:FIXED_TYPES[0],felsoFogpotlasTipusok:types});
 expect(response.status).toBe(200);
 const loaded=(await getDbPool().query('SELECT felso_fogpotlas_tipusok FROM patients_full WHERE id=$1',[patient.id])).rows[0];expect(loaded.felso_fogpotlas_tipusok).toEqual(types);
 expect((await save({nev:'Régebbi kliens',felsoFogpotlasVan:true,felsoFogpotlasTipus:FIXED_TYPES[0]})).status).toBe(200);
 expect((await getDbPool().query('SELECT felso_fogpotlas_tipusok FROM patient_dental_status WHERE patient_id=$1',[patient.id])).rows[0].felso_fogpotlas_tipusok).toEqual(types);
});

it('keeps patient reads available before the new view columns are migrated',async()=>{
 const patient=await createTestPatient(),db=await getDbPool().connect();
 try{await db.query('BEGIN');
  const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='patients_full' AND column_name NOT IN ('felso_fogpotlas_tipusok','also_fogpotlas_tipusok') ORDER BY ordinal_position")).rows.map(r=>'"'+r.column_name.replace(/"/g,'""')+'"').join(',');
  await db.query(`CREATE TEMP VIEW patients_full AS SELECT ${columns} FROM public.patients_full`);
  const row=(await db.query(patientSelectSql(),[patient.id])).rows[0];
  expect(row.id).toBe(patient.id);expect(row.felsoFogpotlasTipusok).toBeNull();expect(row.alsoFogpotlasTipusok).toBeNull();
 }finally{await db.query('ROLLBACK');db.release();}
});
