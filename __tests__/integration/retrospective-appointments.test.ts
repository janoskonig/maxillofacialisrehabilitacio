import { afterEach,describe,expect,it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { recordRetrospectiveAppointment,retrospectiveAppointmentSchema } from '@/lib/retrospective-appointments';
import { GET as listAppointments } from '@/app/api/appointments/route';
import { GET as calendarAppointments } from '@/app/api/appointments/calendar/route';
import { POST } from '@/app/api/patients/[id]/historical-appointments/route';
import { authedRequest } from './helpers/auth';
import { createTestPatient,createTestUser,createTestEpisode,createTestSlot,createTestAppointment,cleanupCreated } from './helpers/factories';
const patients:string[]=[];
afterEach(async()=>{
  const db=getDbPool();
  const slots=await db.query('SELECT time_slot_id AS id FROM appointments WHERE patient_id=ANY($1::uuid[])',[patients]);
  await db.query('DELETE FROM appointments WHERE patient_id=ANY($1::uuid[])',[patients]);
  if(slots.rows.length)await db.query('DELETE FROM available_time_slots WHERE id=ANY($1::uuid[])',[slots.rows.map(r=>r.id)]);
  patients.length=0;await cleanupCreated();
});
async function setup(){
  const doctor=await createTestUser(),patient=await createTestPatient();patients.push(patient.id);
  const episode=await createTestEpisode(undefined,patient.id,{status:'closed'});
  const user={...doctor,role:'fogpótlástanász' as const};
  const input=(overrides:Record<string,unknown>={})=>retrospectiveAppointmentSchema.parse({requestKey:crypto.randomUUID(),occurredOn:'2026-09-10',precision:'day',source:'Korabeli papírkarton',clinicianId:doctor.id,episodeId:episode.id,appointmentType:'munkafazis',...overrides});
  const record=(c:ReturnType<typeof input>)=>recordRetrospectiveAppointment(patient.id,{userId:doctor.id,email:doctor.email},c);
  return {doctor,user,patient,episode,input,record};
}
describe('retrospective appointments',()=>{
  it('creates an attended past appointment without pre-existing availability and exposes it in patient list and calendar',async()=>{
    const s=await setup(),input=s.input(),saved=await s.record(input);
    const r=await getDbPool().query(`SELECT a.appointment_status,a.is_future,a.episode_id,r.occurred_on::text,r.occurred_at,r.recorded_at,r.source,s.status,s.state
      FROM appointments a JOIN retrospective_appointment_records r ON r.appointment_id=a.id JOIN available_time_slots s ON s.id=a.time_slot_id WHERE a.id=$1`,[saved.appointmentId]);
    expect(r.rows[0]).toMatchObject({appointment_status:'completed',is_future:false,episode_id:s.episode.id,occurred_on:'2026-09-10',occurred_at:null,source:'Korabeli papírkarton',status:'booked',state:'booked'});
    const list=await listAppointments(await authedRequest(`http://localhost/api/appointments?patientId=${s.patient.id}`,{user:s.user}));
    expect((await list.json()).appointments).toContainEqual(expect.objectContaining({id:saved.appointmentId,timePrecision:'day',occurredOn:'2026-09-10',recordedBy:s.doctor.email}));
    for(const occurredOn of ['2026-09-09','2026-09-11'])await s.record(s.input({occurredOn}));
    const calendar=await calendarAppointments(await authedRequest('http://localhost/api/appointments/calendar?startDate=2026-09-10&endDate=2026-09-11',{user:s.user}));
    const body=await calendar.json();expect(body.appointments).toContainEqual(expect.objectContaining({id:saved.appointmentId,timePrecision:'day',occurredOn:'2026-09-10'}));
    expect(body.appointments.filter((a:{patientId:string})=>a.patientId===s.patient.id)).toHaveLength(1);
  });
  it('is idempotent and rejects another creation for the same historical encounter',async()=>{
    const s=await setup(),input=s.input(),first=await s.record(input),retry=await s.record(input);
    expect(retry.appointmentId).toBe(first.appointmentId);
    await expect(s.record(s.input())).rejects.toMatchObject({status:409});
    await expect(s.record({...input,notes:'Different content'})).rejects.toMatchObject({status:409});
    const count=await getDbPool().query('SELECT count(*)::int AS n FROM appointments WHERE patient_id=$1',[s.patient.id]);expect(count.rows[0].n).toBe(1);
  });
  it('retains the exact actual time and allows distinct visits on the same day',async()=>{
    const s=await setup();
    for(const time of ['08:00','11:00'])await s.record(s.input({precision:'exact',occurredAt:`2026-09-10T${time}:00+02:00`}));
    const rows=await getDbPool().query('SELECT occurred_at,time_precision FROM retrospective_appointment_records WHERE patient_id=$1 ORDER BY occurred_at',[s.patient.id]);
    expect(rows.rows.map(r=>new Date(r.occurred_at).toISOString())).toEqual(['2026-09-10T06:00:00.000Z','2026-09-10T09:00:00.000Z']);
  });
  it('links an existing past appointment without making a second appointment or slot',async()=>{
    const s=await setup(),start=new Date('2026-09-10T08:00:00Z');
    const slot=await createTestSlot(undefined,s.doctor.id,{startTime:start});
    const appointment=await createTestAppointment(undefined,{patientId:s.patient.id,episodeId:s.episode.id,timeSlotId:slot.id,startTime:start});
    await getDbPool().query('UPDATE appointments SET dentist_email=$2 WHERE id=$1',[appointment.id,s.doctor.email]);
    await expect(s.record(s.input())).rejects.toMatchObject({status:409});
    const saved=await s.record(s.input({existingAppointmentId:appointment.id}));expect(saved.appointmentId).toBe(appointment.id);
    const rows=await getDbPool().query('SELECT id,appointment_status FROM appointments WHERE patient_id=$1',[s.patient.id]);
    expect(rows.rows).toEqual([{id:appointment.id,appointment_status:'completed'}]);
  });
  it('rejects future dates, cross-patient episodes and cancelled appointments',async()=>{
    const s=await setup();
    await expect(s.record(s.input({occurredOn:'2099-01-01'}))).rejects.toMatchObject({status:400});
    const other=await createTestPatient();patients.push(other.id);const ep=await createTestEpisode(undefined,other.id);
    await expect(s.record(s.input({episodeId:ep.id}))).rejects.toMatchObject({status:400});
    const slot=await createTestSlot(undefined,s.doctor.id,{startTime:new Date('2026-09-10T08:00:00Z')});
    const a=await createTestAppointment(undefined,{patientId:s.patient.id,episodeId:s.episode.id,timeSlotId:slot.id,startTime:new Date('2026-09-10T08:00:00Z'),appointmentStatus:'cancelled_by_patient'});
    await expect(s.record(s.input({existingAppointmentId:a.id}))).rejects.toMatchObject({status:409});
  });
  it('enforces clinical staff roles on the new endpoint',async()=>{
    const s=await setup(),tech=await createTestUser(undefined,{role:'technikus'});
    const response=await POST(await authedRequest(`http://localhost/api/patients/${s.patient.id}/historical-appointments`,{user:{...tech,role:'technikus'},method:'POST',body:s.input()}),{params:{id:s.patient.id}});
    expect(response.status).toBe(403);
  });
});
