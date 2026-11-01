import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,within,waitFor } from '@testing-library/react';
import { ClinicalEntryForm } from '@/components/prosthesis-lifecycle/ClinicalEntryForm';
import { FormModeSwitch } from '@/components/prosthesis-lifecycle/FormMode';
import { emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
const episodeId=crypto.randomUUID(),upper=crypto.randomUUID(),lower=crypto.randomUUID();
const data={episodes:[{id:episodeId,status:'open',case_title:'Kiinduló kezelés'}],prostheses:[
  {id:upper,label:'Felső végleges',jaw:'felso',role:'definitive',positions:[],episode_id:episodeId},
  {id:lower,label:'Alsó ideiglenes',jaw:'also',role:'provisional',positions:[],episode_id:crypto.randomUUID()},
],states:[{id:crypto.randomUUID(),event_id:crypto.randomUUID(),occurred_on:'2026-10-01',mode:'assessment',layers:{...emptyLayers(),teeth:{'11':{base:'sound'}}}}],work:[],tasks:[],appointments:[],repairs:[],events:[],documents:[],legacyStates:[],pathways:[]} as unknown as ClinicalWorkspace;
afterEach(()=>{cleanup();window.localStorage.clear();});
function input(label:string,value:string){fireEvent.change(screen.getByLabelText(label),{target:{value}});}
function evidence(){input('Melyik napon történt?','2026-09-10');input('Mi alapján rögzíted?','Korabeli karton');}
function review(){fireEvent.click(screen.getByRole('button',{name:'Adatok ellenőrzése'}));}
function activity(index:number,pid:string,phase:string,outcome:string){
  const group=within(screen.getByRole('group',{name:`${index}. tevékenység`}));
  for(const [label,value] of [['Fogpótlás',pid],['Ellátás',phase],['Elvégzett munka',`${index}. munka`],['Eredmény',outcome],['Eredmény leírása',`${index}. dokumentált eredmény`]])fireEvent.change(group.getByLabelText(label),{target:{value}});
}
describe('Guided clinical documentation',()=>{
  it('requires an explicit jaw, type and origin, lets the user pick positions visually, and reviews before writing',async()=>{
    const save=vi.fn().mockResolvedValue(undefined);
    render(<ClinicalEntryForm data={data} initial={{action:'register'}} onSave={save} onCancel={vi.fn()} busy={false}/>);
    expect((screen.getByLabelText('Állcsont') as HTMLSelectElement).value).toBe('');
    evidence();review();expect(screen.getByRole('alert').textContent).toContain('Állcsont');expect(save).not.toHaveBeenCalled();
    for(const [label,value] of [['Megnevezés','Felső lemezes'],['Állcsont','felso'],['Eredet','local'],['Ideiglenes vagy végleges?','definitive'],['Típus','removable'],['Miért indul az új elkészítési epizód?','Felső foghiány rehabilitációja']])input(label,value);
    fireEvent.click(screen.getByText(/A pótlás helye a fogíven/));
    fireEvent.click(screen.getByRole('button',{name:/^11. fog ·/}));
    review();expect(screen.getByRole('region',{name:'Mentés előtti összefoglaló'}).textContent).toContain('11: Műfog');expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({action:'register',episodeId,jaw:'felso',role:'definitive',origin:'local',occurredOn:'2026-09-10',positions:[{tooth:11,role:'denture_tooth'}]});
  });
  it('records independent outcomes for two appliances and one shared duration without a preselected appliance or result',async()=>{
    const save=vi.fn().mockResolvedValue(undefined);
    render(<ClinicalEntryForm data={data} initial={{action:'visit'}} onSave={save} onCancel={vi.fn()} busy={false}/>);
    const first=within(screen.getByRole('group',{name:'1. tevékenység'}));
    expect((first.getByLabelText('Fogpótlás') as HTMLSelectElement).value).toBe('');expect((first.getByLabelText('Eredmény') as HTMLSelectElement).value).toBe('');
    evidence();input('Ki végezte az ellátást?','Dr. Teszt');input('Az egész alkalom klinikai ideje, percben · ha mérték','35');
    activity(1,upper,'aftercare','completed');fireEvent.click(screen.getByRole('button',{name:'Tevékenység hozzáadása'}));activity(2,lower,'construction','partial');
    review();expect(save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({clinicalMinutes:35,links:[{prosthesisId:upper,phase:'aftercare',outcome:'completed'},{prosthesisId:lower,phase:'construction',outcome:'partial'}]});
  });
  it('does not copy the present dental state into a past assessment',async()=>{
    const save=vi.fn().mockResolvedValue(undefined);
    render(<ClinicalEntryForm data={data} initial={{action:'status'}} onSave={save} onCancel={vi.fn()} busy={false}/>);evidence();
    fireEvent.click(screen.getByRole('button',{name:/^11. fog · Saját fog: Ismeretlen/}));
    input('11. saját fog','missing');input('11. implantátum','yes');review();
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].layers).toEqual({teeth:{'11':{base:'missing'}},implants:{'11':{present:true}},prostheses:{}});
  });
  it('preserves edits when switching between guided and expert mode and saves directly in expert mode',async()=>{
    const save=vi.fn().mockResolvedValue(undefined);
    render(<><FormModeSwitch/><ClinicalEntryForm data={data} initial={{action:'milestone',prosthesisId:upper}} onSave={save} onCancel={vi.fn()} busy={false}/></>);
    evidence();input('Mi történt a fogpótlással?','delivered');
    fireEvent.click(screen.getByRole('button',{name:'Szakértői'}));
    expect((screen.getByLabelText('Mi történt a fogpótlással?') as HTMLSelectElement).value).toBe('delivered');
    expect(screen.queryByRole('button',{name:'Adatok ellenőrzése'})).toBeNull();
    expect((screen.getByText('Megjegyzés és pontos időpont · opcionális').closest('details') as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Vezetett'}));review();expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Szakértői'}));
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({action:'milestone',milestone:'delivered'});
  });
  it('keeps the same command for a retry and rejects future dates locally',async()=>{
    const save=vi.fn().mockResolvedValue(undefined);
    render(<ClinicalEntryForm data={data} initial={{action:'milestone',prosthesisId:upper}} onSave={save} onCancel={vi.fn()} busy={false}/>);
    evidence();input('Mi történt a fogpótlással?','accepted');input('Melyik napon történt?','2099-01-01');review();
    expect(screen.getByRole('alert').textContent).toContain('mai vagy korábbi');expect(save).not.toHaveBeenCalled();
    input('Melyik napon történt?','2026-09-10');review();
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
  });
  it('uses the selected appointment day and prevents linking an undocumented attendance or a duplicate visit',async()=>{
    const appointmentId=crypto.randomUUID(),cancelledId=crypto.randomUUID(),documentedId=crypto.randomUUID();
    const context={...data,appointments:[{id:appointmentId,day:'2026-09-09',appointment_status:'completed'},{id:cancelledId,day:'2026-09-08',appointment_status:'cancelled_by_patient'},{id:documentedId,day:'2026-09-07',appointment_status:'completed'}],events:[{id:crypto.randomUUID(),active:true,kind:'visit',payload:{command:{appointmentId:documentedId}}}]} as ClinicalWorkspace;
    const save=vi.fn().mockResolvedValue(undefined);
    render(<ClinicalEntryForm data={context} initial={{action:'visit'}} onSave={save} onCancel={vi.fn()} busy={false}/>);
    fireEvent.click(screen.getByText('Meglévő időpont kapcsolása · ha volt foglalás'));
    expect((screen.getByRole('option',{name:'2026-09-08 · Még nincs megtörténtként lezárva'}) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole('option',{name:'2026-09-07 · Már dokumentálva'}) as HTMLOptionElement).disabled).toBe(true);
    input('Meglévő időponthoz kapcsolás',appointmentId);
    expect((screen.getByLabelText('Melyik napon történt?') as HTMLInputElement).value).toBe('2026-09-09');
    input('Mi alapján rögzíted?','Korabeli karton');input('Ki végezte az ellátást?','Dr. Teszt');activity(1,upper,'construction','completed');review();
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({appointmentId,occurredOn:'2026-09-09'});
  });
});
