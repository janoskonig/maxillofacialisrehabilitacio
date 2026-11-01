import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { AppointmentBookingSection } from '@/components/AppointmentBookingSection';
const state=vi.hoisted(()=>({appointments:[] as Array<Record<string,unknown>>}));
vi.mock('@/hooks/useAppointmentBooking',()=>({useAppointmentBooking:()=>({
  appointments:state.appointments,availableSlots:[],availableCims:[],DEFAULT_CIM:'',loading:false,loadError:null,userRole:'admin',roleLoaded:true,
})}));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));});
afterEach(()=>{cleanup();vi.useRealTimers();state.appointments=[];});
function appointment(id:string,startTime:string,status:string|null=null){return {id,patientId:'patient',startTime,appointmentStatus:status,completionNotes:id};}
describe('patient appointment list layout',()=>{
  it('keeps booking first and shows next bookings without expanding the history',()=>{
    state.appointments=[appointment('Old visit','2025-09-01T10:00:00Z','completed'),appointment('Later visit','2026-12-01T10:00:00Z'),appointment('Next visit','2026-11-02T10:00:00Z')];
    render(<AppointmentBookingSection patientId="patient" standalone/>);
    const start=screen.getByRole('button',{name:'Új időpont foglalása'}),upcoming=screen.getByRole('region',{name:'Következő időpontok'});
    expect(start.compareDocumentPosition(upcoming)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const links=within(upcoming).getAllByRole('button',{name:'Státusz'});expect(links).toHaveLength(2);
    expect(screen.queryByText('Old visit')).not.toBeInTheDocument();
    fireEvent.click(start);
    const form=screen.getByText('Új időpont kiírása és foglalása');
    expect(form.compareDocumentPosition(upcoming)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start).toHaveAttribute('aria-expanded','true');
  });
  it('opens the newest history first and reveals more records in small pages',()=>{
    state.appointments=Array.from({length:24},(_,i)=>appointment(`Old visit ${i+1}`,`2026-09-${String(i+1).padStart(2,'0')}T10:00:00Z`,'completed'));
    render(<AppointmentBookingSection patientId="patient" standalone/>);
    const toggle=screen.getByRole('button',{name:'Korábbi és lezárt időpontok (24)'});
    expect(toggle).toHaveAttribute('aria-expanded','false');
    fireEvent.click(toggle);
    const history=screen.getByRole('region',{name:'Korábbi és lezárt időpontok'});
    expect(within(history).getAllByRole('button',{name:'Státusz'})).toHaveLength(10);
    expect(within(history).getByText('Old visit 24')).toBeInTheDocument();expect(screen.queryByText('Old visit 1')).not.toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button',{name:'További időpontok (14)'}));
    expect(within(history).getAllByRole('button',{name:'Státusz'})).toHaveLength(20);
    fireEvent.click(toggle);expect(screen.queryByText('Old visit 24')).not.toBeInTheDocument();
  });
  it('keeps unresolved past visits separate from completed and cancelled history',()=>{
    state.appointments=[appointment('Needs outcome','2026-10-28T10:00:00Z'),appointment('Resolved','2026-10-29T10:00:00Z','completed'),appointment('Cancelled future','2026-11-10T10:00:00Z','cancelled_by_patient')];
    render(<AppointmentBookingSection patientId="patient" standalone/>);
    expect(screen.getByText('Nincs következő lefoglalt időpont.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Korábbi, kimenetelre váró időpontok (1)'}));
    expect(within(screen.getByRole('region',{name:'Korábbi, kimenetelre váró időpontok'})).getAllByRole('button',{name:'Státusz'})).toHaveLength(1);
    expect(screen.getByRole('button',{name:'Korábbi és lezárt időpontok (2)'})).toHaveAttribute('aria-expanded','false');
  });
  it('shows booking immediately inside booking-only dialogs',()=>{
    render(<AppointmentBookingSection patientId="patient" standalone bookingOnly/>);
    expect(screen.getByText('Új időpont kiírása és foglalása')).toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Következő időpontok'})).not.toBeInTheDocument();
  });
});
