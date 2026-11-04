import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {EpisodeFinancingPanel} from '@/components/prosthesis-lifecycle/EpisodeFinancingPanel';
import {COST_COMPONENTS} from '@/lib/episode-financing/model';
import type {EpisodeTreatmentPlanRecord} from '@/lib/episode-treatment-plan';
const quote=crypto.randomUUID();
const plan={episodeId:crypto.randomUUID(),patientId:crypto.randomUUID(),clinicalPlan:{id:crypto.randomUUID(),version:2},history:[],documents:[{id:quote,filename:'Minta árajánlat.pdf'}],financing:{revision:0,current:{event:null,requiresReview:false,asOf:'2026-11-04'},history:[],upcoming:[]}} as unknown as EpisodeTreatmentPlanRecord;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function open(){fireEvent.click(screen.getByRole('button',{name:'Finanszírozás megadása'}));}
function region(key:keyof typeof COST_COMPONENTS){return within(screen.getByRole('region',{name:COST_COMPONENTS[key]}));}
function disableOtherCosts(){fireEvent.click(region('clinical').getByRole('checkbox',{name:'Van ilyen költség'}));}
describe('Three-part episode financing',()=>{
 it('shows the three costs directly and records preparation with unknown amounts and no quotes',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:plan.financing})));vi.stubGlobal('fetch',fetch);
  render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);
  for(const label of Object.values(COST_COMPONENTS))expect(screen.getByRole('region',{name:label})).toBeTruthy();
  open();fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({status:'pending',totalAmount:null,costBreakdown:{laboratory:{enabled:true,totalAmount:null},clinical:{enabled:true,neakCategory:null},implant:{enabled:false}}});
 });
 it('calculates category 04 as patient-paid and refuses approval without every required quote',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);open();
  fireEvent.click(screen.getByRole('radio',{name:'Önköltséges'}));fireEvent.click(screen.getByRole('radio',{name:'Jóváhagyva'}));
  fireEvent.click(screen.getByRole('button',{name:'04 · Fizetős ellátás'}));
  fireEvent.change(screen.getByLabelText('NEAK térítési kategória: Költség'),{target:{value:'10000'}});
  expect((screen.getByLabelText('NEAK térítési kategória: Beteg fizeti') as HTMLInputElement).value).toBe('10000');
  expect((screen.getByLabelText('NEAK térítési kategória: Támogatás') as HTMLInputElement).readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));expect(fetch).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('csatolt árajánlat');
 });
 it('attaches a quote to the correct cost and sends exact aggregate amounts',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({financing:plan.financing})));vi.stubGlobal('fetch',fetch);render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);open();disableOtherCosts();
  fireEvent.click(screen.getByRole('radio',{name:'Önköltséges'}));fireEvent.click(screen.getByRole('radio',{name:'Jóváhagyva'}));
  fireEvent.change(screen.getByLabelText('Fogtechnikai költség: Költség'),{target:{value:'120 000,30'}});fireEvent.click(region('laboratory').getByRole('button',{name:'Beteg fizeti'}));
  fireEvent.click(region('laboratory').getByRole('checkbox',{name:'Minta árajánlat.pdf'}));fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));
  await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({totalAmount:'120000.30',patientAmount:'120000.30',fundedAmount:'0.00',costBreakdown:{laboratory:{quoteDocumentIds:[quote]}}});
 });
 it('keeps input and request key on a transport failure',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new Error('Kapcsolati hiba')).mockResolvedValue(new Response(JSON.stringify({financing:plan.financing})));vi.stubGlobal('fetch',fetch);render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);open();
  fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
 });
 it('uploads to the patient document store and attaches the returned document to its component',async()=>{
  const uploaded=crypto.randomUUID();const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({document:{id:uploaded,filename:'Új árajánlat.pdf'}}))).mockResolvedValueOnce(new Response(JSON.stringify({financing:plan.financing})));vi.stubGlobal('fetch',fetch);render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={vi.fn()}/>);open();
  fireEvent.change(screen.getByLabelText('Fogtechnikai költség: Árajánlat feltöltése'),{target:{files:[new File(['quote'],'Új árajánlat.pdf',{type:'application/pdf'})]}});
  await screen.findByRole('link',{name:'Új árajánlat.pdf'});expect(fetch.mock.calls[0][0]).toBe(`/api/patients/${plan.patientId}/documents`);
  fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(JSON.parse(fetch.mock.calls[1][1].body).costBreakdown.laboratory.quoteDocumentIds).toEqual([uploaded]);
 });
 it('preserves the draft on conflict and retries against the refreshed revision',async()=>{
  const changed=vi.fn(),fresh={...plan.financing,revision:3};const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Ütközés',_errorMeta:{code:'FINANCING_CONFLICT'}}),{status:409})).mockResolvedValueOnce(new Response(JSON.stringify({financing:fresh}))).mockResolvedValueOnce(new Response(JSON.stringify({financing:fresh})));vi.stubGlobal('fetch',fetch);
  const {rerender}=render(<EpisodeFinancingPanel plan={plan} canEdit onChanged={changed}/>);open();fireEvent.click(screen.getByRole('button',{name:'Finanszírozás mentése'}));await waitFor(()=>expect(changed).toHaveBeenCalledWith(fresh));
  rerender(<EpisodeFinancingPanel plan={{...plan,financing:fresh as any}} canEdit onChanged={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Áttekintett adatok mentése'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));expect(JSON.parse(fetch.mock.calls[2][1].body).expectedVersion).toBe(3);
 });
});
