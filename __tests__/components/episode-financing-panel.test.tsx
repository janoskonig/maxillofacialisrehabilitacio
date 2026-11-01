import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { EpisodeFinancingPanel } from '@/components/prosthesis-lifecycle/EpisodeFinancingPanel';
import { FormModeSwitch } from '@/components/prosthesis-lifecycle/FormMode';
import type { EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
const plan={episodeId:crypto.randomUUID(),clinicalPlan:{id:crypto.randomUUID(),version:2},history:[],financing:{revision:0,current:{event:null,requiresReview:false,asOf:'2026-11-01'},history:[],upcoming:[]}} as unknown as EpisodeTreatmentPlanRecord;
plan.history=[{id:plan.clinicalPlan!.id,version:2,description:'Felső pótlás',occurredOn:'2026-01-01'} as any];
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.localStorage.clear();});
function chooseMode(mode='Önköltséges',status='pending'){
  fireEvent.click(screen.getByRole('button',{name:'Finanszírozás megadása'}));
  fireEvent.click(screen.getByRole('radio',{name:mode}));
  fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:status}});
  next();
}
function next(){fireEvent.click(screen.getByRole('button',{name:'Tovább'}));}
function evidence(){
  fireEvent.change(screen.getByLabelText('Mi a rögzítés vagy a változás oka?'),{target:{value:'A beteggel egyeztetett finanszírozás'}});
  fireEvent.change(screen.getByLabelText('Honnan származik az információ?'),{target:{value:'Beteggel egyeztetés'}});
}
describe('Guided financing entry',()=>{
  it('requires explicit choices and performs no write before the final review',async()=>{
    const updated={...plan.financing,revision:1},onChanged=vi.fn(),onStateChange=vi.fn();
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:updated}),{status:200}));vi.stubGlobal('fetch',fetch);
    render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={onChanged} onStateChange={onStateChange}/>);
    expect(screen.getByText('Finanszírozás nincs rögzítve')).toBeTruthy();
    chooseMode();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Mi a rögzítés vagy a változás oka?')).toBeNull();
    fireEvent.click(screen.getByRole('radio',{name:'Még nem ismert'}));next();evidence();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));
    await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(updated));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({planVersionId:plan.clinicalPlan!.id,expectedVersion:0,mode:'self_pay',status:'pending',precision:'day',totalAmount:'',fundedAmount:'',patientAmount:'',source:'Beteggel egyeztetés'});
    await waitFor(()=>expect(onStateChange).toHaveBeenLastCalledWith({dirty:false,saving:false}));
  });
  it('explains missing decisions and unknown amounts without treating them as zero',()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás megadása'}));next();
    expect(screen.getByRole('alert').textContent).toContain('Válaszd ki, ki fizeti');
    expect((screen.getByLabelText('Hol tart a finanszírozás eldöntése?') as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('radio',{name:'Önköltséges'}));
    fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:'pending'}});next();next();
    expect(screen.getByRole('alert').textContent).toContain('ismert-e már az összeg');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks sums before review and preserves distinct decision and effective dates',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:plan.financing}),{status:200}));vi.stubGlobal('fetch',fetch);
    render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);chooseMode('Vegyes finanszírozás','approved');
    fireEvent.change(screen.getByLabelText('Mikor született a döntés vagy egyeztetés?'),{target:{value:'2026-09-10'}});
    fireEvent.click(screen.getByLabelText('Más naptól érvényes a finanszírozás'));
    fireEvent.change(screen.getByLabelText('Melyik naptól érvényes?'),{target:{value:'2026-10-01'}});
    fireEvent.click(screen.getByRole('radio',{name:'Ismert összeget rögzítek'}));
    for(const [label,value] of [['Teljes összeg','100,30'],['Finanszírozói rész','80,10'],['Beteg terhe','30,20']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
    next();expect(screen.getByRole('alert').textContent).toContain('együtt a teljes összeg');
    fireEvent.change(screen.getByLabelText('Beteg terhe'),{target:{value:'20,20'}});next();evidence();
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({occurredOn:'2026-09-10',effectiveOn:'2026-10-01',totalAmount:'100,30',fundedAmount:'80,10',patientAmount:'20,20'});
  });
  it('prevents binding funding to an unsaved clinical draft',()=>{
    render(<EpisodeFinancingPanel plan={plan} canEdit disabled onChanged={vi.fn()}/>);
    expect((screen.getByRole('button',{name:'Finanszírozás megadása'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps all entries and the review step on conflict, then retries with the refreshed revision',async()=>{
    const onChanged=vi.fn(),fresh={...plan.financing,revision:4};
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Közben módosult',_errorMeta:{code:'FINANCING_CONFLICT'}}),{status:409}))
      .mockResolvedValueOnce(new Response(JSON.stringify({financing:fresh}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({financing:{...fresh,revision:5}}),{status:200}));vi.stubGlobal('fetch',fetch);
    const {rerender}=render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={onChanged}/>);
    chooseMode();fireEvent.click(screen.getByRole('radio',{name:'Még nem ismert'}));next();evidence();
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));
    await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(fresh));
    rerender(<EpisodeFinancingPanel plan={{...plan,financing:fresh as any}} canEdit onChanged={onChanged}/>);
    expect((screen.getByLabelText('Mi a rögzítés vagy a változás oka?') as HTMLTextAreaElement).value).toBe('A beteggel egyeztetett finanszírozás');
    fireEvent.click(screen.getByRole('button',{name:'Áttekintett adatok mentése'}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2][1].body).expectedVersion).toBe(4);
  });
  it('keeps the request unchanged on a transport retry and retains input on back navigation',async()=>{
    const fetch=vi.fn().mockRejectedValueOnce(new Error('Kapcsolati hiba')).mockResolvedValue(new Response(JSON.stringify({financing:plan.financing}),{status:200}));vi.stubGlobal('fetch',fetch);
    render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);chooseMode();
    fireEvent.click(screen.getByRole('radio',{name:'Ismert összeget rögzítek'}));
    fireEvent.change(screen.getByLabelText('Teljes összeg'),{target:{value:'120000'}});
    fireEvent.click(screen.getByRole('button',{name:'A teljes összeget a beteg fizeti'}));next();evidence();
    fireEvent.click(screen.getByRole('button',{name:'Vissza'}));
    expect((screen.getByLabelText('Beteg terhe') as HTMLInputElement).value).toBe('120000');next();
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  });
  it('shows every editable field in expert mode and preserves values when returning to guided mode',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:plan.financing}),{status:200}));vi.stubGlobal('fetch',fetch);
    render(<><FormModeSwitch/><EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/></>);
    fireEvent.click(screen.getByRole('button',{name:'Szakértői'}));
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás megadása'}));
    expect(screen.queryByRole('button',{name:'Tovább'})).toBeNull();
    expect(screen.getByLabelText('Honnan származik az információ?')).toBeTruthy();
    expect(screen.getByLabelText(/Határozat \/ megállapodás hivatkozása/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio',{name:'Önköltséges'}));
    fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:'approved'}});
    fireEvent.change(screen.getByLabelText('Teljes összeg'),{target:{value:'120000'}});
    fireEvent.click(screen.getByRole('button',{name:'A teljes összeget a beteg fizeti'}));evidence();
    fireEvent.click(screen.getByRole('button',{name:'Vezetett'}));expect(screen.getByRole('button',{name:'Tovább'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Szakértői'}));
    expect((screen.getByLabelText('Teljes összeg') as HTMLInputElement).value).toBe('120000');
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({mode:'self_pay',status:'approved',patientAmount:'120000',fundedAmount:'0'});
  });
  it('allows preparing finance while editing the clinical plan, then binds the new saved version after explicit review',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:plan.financing}),{status:200}));vi.stubGlobal('fetch',fetch);
    const {rerender}=render(<><FormModeSwitch/><EpisodeFinancingPanel plan={plan} canEdit planUnsaved onChanged={vi.fn()}/></>);
    fireEvent.click(screen.getByRole('button',{name:'Szakértői'}));fireEvent.click(screen.getByRole('button',{name:'Finanszírozás megadása'}));
    fireEvent.click(screen.getByRole('radio',{name:'Egyedi méltányosság'}));fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:'approved'}});
    fireEvent.click(screen.getByRole('radio',{name:'Még nem ismert'}));evidence();fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));
    expect(fetch).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('Mentsd a kezelési tervet');
    const newId=crypto.randomUUID(),updated={...plan,clinicalPlan:{...plan.clinicalPlan!,id:newId,version:3},history:[{...plan.history![0],id:newId,version:3},...plan.history!]};
    rerender(<><FormModeSwitch/><EpisodeFinancingPanel plan={updated} canEdit onChanged={vi.fn()}/></>);
    await waitFor(()=>expect((screen.getByLabelText('Hol tart a finanszírozás eldöntése?') as HTMLSelectElement).value).toBe(''));
    expect((screen.getByLabelText('Mi a rögzítés vagy a változás oka?') as HTMLTextAreaElement).value).toBe('A beteggel egyeztetett finanszírozás');
    fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:'approved'}});
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0][1].body).planVersionId).toBe(newId);
  });
});
