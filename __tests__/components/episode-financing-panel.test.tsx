import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { EpisodeFinancingPanel } from '@/components/prosthesis-lifecycle/EpisodeFinancingPanel';
import type { EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
const plan={episodeId:crypto.randomUUID(),clinicalPlan:{id:crypto.randomUUID(),version:2},history:[],financing:{revision:0,current:{event:null,requiresReview:false,asOf:'2026-11-01'},history:[],upcoming:[]}} as unknown as EpisodeTreatmentPlanRecord;
plan.history=[{id:plan.clinicalPlan!.id,version:2,description:'Felső pótlás'} as any];
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('Financing panel',()=>{
  it('shows missing funding explicitly and binds an independent change to the chosen plan',async()=>{
    const updated={...plan.financing,revision:1},onChanged=vi.fn(),onStateChange=vi.fn();
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:updated}),{status:200}));vi.stubGlobal('fetch',fetch);
    render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={onChanged} onStateChange={onStateChange}/>);
    expect(screen.getByText('Finanszírozás nincs rögzítve')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás rögzítése'}));
    fireEvent.change(screen.getByLabelText('Finanszírozási mód'),{target:{value:'self_pay'}});
    fireEvent.change(screen.getByLabelText('A rögzítés vagy változás indoka'),{target:{value:'Méltányosság helyett önköltséges ellátás'}});
    expect((screen.getByLabelText('Finanszírozási döntés állapota') as HTMLSelectElement).value).toBe('pending');
    await waitFor(()=>expect(onStateChange).toHaveBeenLastCalledWith({dirty:true,saving:false}));
    fireEvent.submit(screen.getByRole('form',{name:'Finanszírozási változás rögzítése'}));
    await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(updated));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`/api/episodes/${plan.episodeId}/financing`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({episodeId:plan.episodeId,planVersionId:plan.clinicalPlan!.id,expectedVersion:0,mode:'self_pay',status:'pending',precision:'day',totalAmount:''});
    await waitFor(()=>expect(onStateChange).toHaveBeenLastCalledWith({dirty:false,saving:false}));
  });
  it('prevents binding financing to an unsaved clinical draft',()=>{
    render(<EpisodeFinancingPanel plan={plan} canEdit disabled onChanged={vi.fn()}/>);
    expect((screen.getByRole('button',{name:'Finanszírozás rögzítése'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps local draft on a conflict and refreshes the financial revision for an explicit retry',async()=>{
    const onChanged=vi.fn(),fresh={...plan.financing,revision:4};
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Közben módosult',_errorMeta:{code:'FINANCING_CONFLICT'}}),{status:409}))
      .mockResolvedValueOnce(new Response(JSON.stringify({financing:fresh}),{status:200}));vi.stubGlobal('fetch',fetch);
    const {rerender}=render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={onChanged}/>);
    fireEvent.click(screen.getByRole('button',{name:'Finanszírozás rögzítése'}));
    fireEvent.change(screen.getByLabelText('A rögzítés vagy változás indoka'),{target:{value:'Megőrzendő saját indok'}});
    fireEvent.submit(screen.getByRole('form',{name:'Finanszírozási változás rögzítése'}));
    await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(fresh));
    rerender(<EpisodeFinancingPanel plan={{...plan,financing:fresh as any}} canEdit onChanged={onChanged}/>);
    expect((screen.getByLabelText('A rögzítés vagy változás indoka') as HTMLTextAreaElement).value).toBe('Megőrzendő saját indok');
    expect(screen.getByRole('button',{name:'Áttekintett finanszírozási változás mentése'})).toBeTruthy();
  });
});
