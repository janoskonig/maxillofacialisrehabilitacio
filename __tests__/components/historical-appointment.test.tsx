import '@testing-library/jest-dom/vitest';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { HistoricalAppointmentForm } from '@/components/HistoricalAppointmentForm';
import { CalendarEvent } from '@/components/CalendarEvent';
const clinician='11111111-1111-4111-8111-111111111111';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('retrospective appointment entry',()=>{
  it('saves a real day-only appointment with a source and links to its returned identifier',async()=>{
    const onSaved=vi.fn();
    const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({clinicians:[{id:clinician,name:'Dr. Teszt',email:'test@example.test'}],episodes:[],appointments:[]})})
      .mockResolvedValueOnce({ok:true,json:async()=>({appointmentId:'past-appointment'})});vi.stubGlobal('fetch',fetch);
    render(<HistoricalAppointmentForm patientId="patient" onSaved={onSaved} onCancel={()=>{}}/>);
    await screen.findByRole('button',{name:'Korábbi időpont mentése'});
    fireEvent.change(screen.getByLabelText('Mikor történt?'),{target:{value:'2026-09-10'}});
    fireEvent.click(screen.getByRole('button',{name:'Korábbi időpont mentése'}));
    await waitFor(()=>expect(onSaved).toHaveBeenCalledWith('past-appointment'));
    const input=JSON.parse(fetch.mock.calls[1][1].body);
    expect(input).toMatchObject({occurredOn:'2026-09-10',occurredAt:null,precision:'day',clinicianId:clinician,source:'Korabeli karton'});
  });
  it('shows unknown time explicitly on the calendar instead of displaying the technical storage time',()=>{
    render(<CalendarEvent appointment={{id:'a',startTime:'2026-09-09T22:00:00Z',timePrecision:'day',patientName:'Teszt Elek',patientTaj:null,dentistEmail:'doctor@example.test',appointmentStatus:'completed'}}/>);
    expect(screen.getByText('Pontos idő nem ismert')).toBeInTheDocument();expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });
});
