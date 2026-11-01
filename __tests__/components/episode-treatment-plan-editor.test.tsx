import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EpisodeTreatmentPlanEditor, EpisodeTreatmentPlanDisclosure } from '@/components/EpisodeTreatmentPlanEditor';
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const saved = { episodeId: 'ep1', treatmentPlan: null as string | null, treatmentPlanUpper: 'Eredeti terv', treatmentPlanLower: 'Alsó terv', version: 3 };
const response = (plan:any = saved, status = 200, code?: string) => new Response(JSON.stringify({ plan, code }), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });
async function mount(canEdit = true) {
  render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit={canEdit} />);
  await screen.findByText(canEdit ? 'Mentett kezelési terv' : 'Eredeti terv');
}
describe('Episode treatment plan editor', () => {
  it('loads and explicitly saves the ep-specific draft with its version', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...saved, treatmentPlanUpper: 'Új terv', version: 4 }));
    vi.stubGlobal('fetch', fetch);
    await mount();
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'), { target: { value: 'Új terv' } });
    expect(screen.getByText('Nem mentett módosítások')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési terv mentése' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0]).toBe('/api/episodes/ep1/treatment-plan');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ treatmentPlanUpper: 'Új terv', treatmentPlanLower: 'Alsó terv', expectedVersion: 3,clinical:{baselineStateId:null,treatments:[],approved:false,source:'Klinikai dokumentáció'} });
    await screen.findByText('Mentett kezelési terv');
  });
  it('reviews both devices without treating the server warning as an unsaved user edit',async()=>{
    const pending={...saved,jaw:null,requiresDeviceReview:true,devices:[{id:'u',jaw:'felso',label:'Felső',positions:[]},{id:'l',jaw:'also',label:'Alsó',positions:[]}],clinicalPlan:{id:'v3',version:3,approved:true,baselineStateId:'baseline',treatments:[]}};
    const fetch=vi.fn().mockResolvedValueOnce(response(pending)).mockResolvedValueOnce(response({...pending,version:4,requiresDeviceReview:false,clinicalPlan:{...pending.clinicalPlan,version:4,approved:true}}));
    vi.stubGlobal('fetch',fetch);const state=vi.fn();
    render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit unified onStateChange={state}/>);
    await screen.findByText(/A fogpótlások köre megváltozott/);
    expect(screen.getByLabelText('Felső állcsont kezelési terve')).toBeTruthy();expect(screen.getByLabelText('Alsó állcsont kezelési terve')).toBeTruthy();
    expect(state).toHaveBeenLastCalledWith({dirty:false,saving:false});
    expect((screen.getByRole('button',{name:'Kezelési terv mentése'}) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Ezt a tervváltozatot jóváhagyom') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Ezt a tervváltozatot jóváhagyom'));
    fireEvent.click(screen.getByRole('button',{name:'Kezelési terv mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({treatmentPlanUpper:'Eredeti terv',treatmentPlanLower:'Alsó terv',clinical:{approved:true}});
  });
  it('preserves a failed draft for retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Mentési hiba' }), { status: 500 })));
    await mount();
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'), { target: { value: 'Saját terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési terv mentése' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Felső állcsont kezelési terve') as HTMLTextAreaElement).value).toBe('Saját terv');
  });
  it('keeps local text on conflict and displays the other saved version', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...saved, treatmentPlanUpper: 'Másik orvos terve', version: 4 }, 409, 'TREATMENT_PLAN_CONFLICT')).mockResolvedValueOnce(response({ ...saved, treatmentPlanUpper: 'Áttekintett közös terv', version: 5 }));
    vi.stubGlobal('fetch', fetch);
    await mount();
    const input = screen.getByLabelText('Felső állcsont kezelési terve') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Saját terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési terv mentése' }));
    await screen.findByText('Másik orvos terve');
    expect(input.value).toBe('Saját terv');
    fireEvent.change(input, { target: { value: 'Áttekintett közös terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áttekintett terv mentése' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2][1].body).expectedVersion).toBe(4);
  });
  it('shows a read-only saved plan without edit controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    await mount(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Kezelési terv mentése')).toBeNull();
  });
  it('loads a previous episode plan only when requested', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    render(<EpisodeTreatmentPlanDisclosure episodeId="ep1" canEdit={false} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Kezelési tervek megtekintése' }));
    await screen.findByText('Eredeti terv');
  });
  it('notifies the parent about unsaved changes and allows discarding them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const onStateChange = vi.fn();
    render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit onStateChange={onStateChange} />);
    await screen.findByText('Mentett kezelési terv');
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'), { target: { value: 'Módosított terv' } });
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ dirty: true, saving: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások elvetése' }));
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ dirty: false, saving: false }));
  });
  it('edits the lower plan independently and does not guess the jaw of legacy text', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...saved, treatmentPlan: 'Régi közös szöveg', treatmentPlanUpper: '', treatmentPlanLower: '' }));
    vi.stubGlobal('fetch', fetch);
    render(<EpisodeTreatmentPlanEditor episodeId="ep1" canEdit />);
    await screen.findByText('Régi közös szöveg');
    const upper = screen.getByLabelText('Felső állcsont kezelési terve') as HTMLTextAreaElement;
    const lower = screen.getByLabelText('Alsó állcsont kezelési terve') as HTMLTextAreaElement;
    expect(upper.value).toBe('');
    expect(lower.value).toBe('');
    fireEvent.change(lower, { target: { value: 'Új alsó terv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hozzáadás az alsó tervhez' }));
    expect(lower.value).toBe('Új alsó terv\n\nRégi közös szöveg');
    expect(upper.value).toBe('');
  });
  it('edits only the appliance jaw and sends clinical details and approval with the same text save',async()=>{
    const plan={...saved,jaw:'also',prosthesisId:'device1',prosthesisLabel:'Alsó végleges',states:[{id:'baseline1',occurred_on:'2026-01-01',source:'Vizsgálat'}],clinicalPlan:{id:'plan1',version:3,baselineStateId:null,treatments:[],approved:false}};
    const fetch=vi.fn().mockResolvedValue(response(plan));vi.stubGlobal('fetch',fetch);
    await mount();
    expect(screen.queryByLabelText('Felső állcsont kezelési terve')).toBeNull();
    fireEvent.change(screen.getByLabelText('Alsó állcsont kezelési terve'),{target:{value:'Új alsó közös terv'}});
    fireEvent.change(screen.getByLabelText('Ellátás előtti dokumentált státusz'),{target:{value:'baseline1'}});
    fireEvent.click(screen.getByRole('button',{name:'Beavatkozás hozzáadása'}));
    expect((screen.getByLabelText('1. beavatkozás fogszáma') as HTMLInputElement).value).toBe('31');
    fireEvent.click(screen.getByLabelText('Ezt a tervváltozatot jóváhagyom'));
    fireEvent.click(screen.getByRole('button',{name:'Kezelési terv mentése'}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({expectedVersion:3,treatmentPlanUpper:'Eredeti terv',treatmentPlanLower:'Új alsó közös terv',clinical:{baselineStateId:'baseline1',approved:true,treatments:[{toothNumber:31,treatmentCode:'huzas'}]}});
  });
  it('requires explicit approval of a changed version and reuses the save key on a transport retry',async()=>{
    const plan={...saved,prosthesisId:'p',clinicalPlan:{id:'plan',version:3,baselineStateId:'b',treatments:[],approved:true}};
    const fetch=vi.fn().mockResolvedValueOnce(response(plan)).mockRejectedValueOnce(new Error('Kapcsolati hiba')).mockResolvedValue(response(plan));vi.stubGlobal('fetch',fetch);
    await mount();expect((screen.getByLabelText('Ezt a tervváltozatot jóváhagyom') as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'),{target:{value:'Módosítás'}});
    fireEvent.click(screen.getByRole('button',{name:'Kezelési terv mentése'}));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'Kezelési terv mentése'}));
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));
    const first=JSON.parse(fetch.mock.calls[1][1].body),retry=JSON.parse(fetch.mock.calls[2][1].body);
    expect(first.clinical.approved).toBe(false);expect(retry).toEqual(first);
  });

  it('edits plan and financing together in expert mode and binds funding to the new saved plan without losing the draft',async()=>{
    const id=crypto.randomUUID(),oldId=crypto.randomUUID(),newId=crypto.randomUUID();
    const initial={...saved,episodeId:id,jaw:'felso',clinicalPlan:{id:oldId,version:3,approved:false,baselineStateId:null,treatments:[]},history:[],financing:{revision:0,current:{event:null,requiresReview:false},history:[],upcoming:[]}};
    const changed={...initial,version:4,treatmentPlanUpper:'Módosított felső terv',clinicalPlan:{...initial.clinicalPlan,id:newId,version:4}};
    const fetch=vi.fn().mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(changed))
      .mockResolvedValueOnce(new Response(JSON.stringify({financing:{...initial.financing,revision:1}}),{status:200}));vi.stubGlobal('fetch',fetch);
    render(<EpisodeTreatmentPlanEditor episodeId={id} canEdit/>);await screen.findByText('Mentett kezelési terv');
    fireEvent.click(screen.getByRole('button',{name:'Szakértői'}));
    fireEvent.change(screen.getByLabelText('Felső állcsont kezelési terve'),{target:{value:'Módosított felső terv'}});
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás megadása'}));
    fireEvent.click(screen.getByRole('radio',{name:'Önköltséges'}));
    fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:'pending'}});
    fireEvent.click(screen.getByRole('radio',{name:'Még nem ismert'}));
    fireEvent.change(screen.getByLabelText('Mi a rögzítés vagy a változás oka?'),{target:{value:'Az új terv finanszírozása'}});
    fireEvent.change(screen.getByLabelText('Honnan származik az információ?'),{target:{value:'Beteggel egyeztetés'}});
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Kezelési terv mentése'}));
    await waitFor(()=>expect((screen.getByLabelText('Hol tart a finanszírozás eldöntése?') as HTMLSelectElement).value).toBe(''));
    expect((screen.getByLabelText('Mi a rögzítés vagy a változás oka?') as HTMLTextAreaElement).value).toBe('Az új terv finanszírozása');
    fireEvent.change(screen.getByLabelText('Hol tart a finanszírozás eldöntése?'),{target:{value:'pending'}});
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[1][0]).toBe(`/api/episodes/${id}/treatment-plan`);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({planVersionId:newId,mode:'self_pay',reason:'Az új terv finanszírozása'});
  });

});
