import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,renderHook,waitFor } from '@testing-library/react';
import { useAppointmentBooking } from '@/hooks/useAppointmentBooking';
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>({email:'doctor@example.test',role:'admin'})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps recent and future appointments that occur beyond the first API page',async()=>{
  const fetch=vi.fn(async(input:string)=>{
    if(input.includes('/api/time-slots'))return {ok:true,json:async()=>({timeSlots:[],pagination:{totalPages:1}})};
    if(input.includes('/api/appointments?')){
      const page=new URL(input,'http://localhost').searchParams.get('page');
      return {ok:true,json:async()=>({appointments:page==='2'?[{id:'next',startTime:'2099-01-01T10:00:00Z'}]:[{id:'old',startTime:'2020-01-01T10:00:00Z'}],pagination:{totalPages:2}})};
    }
    return {ok:true,json:async()=>({})};
  });vi.stubGlobal('fetch',fetch);
  const {result}=renderHook(()=>useAppointmentBooking('patient'));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.appointments.map(a=>a.id)).toEqual(['old','next']);
  expect(fetch.mock.calls.some(([url])=>url.includes('page=2'))).toBe(true);
});
