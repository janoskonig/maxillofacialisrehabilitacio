import { afterEach,describe,expect,it,vi } from 'vitest';
import { clinicalCommandSchema,emptyLayers,type StateEvidence } from '@/lib/prosthesis-lifecycle/model';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
import { CLINICAL_PROSTHESIS_TYPES,prosthesisCategory,registrationBackground,suggestedProsthesisLabel,prosthesisDetails } from '@/lib/prosthesis-registration';
import { FIXED_TYPES } from '@/lib/prosthesis-types';

const state=(day:string,base:string):StateEvidence=>({id:crypto.randomUUID(),event_id:crypto.randomUUID(),occurred_on:day,occurred_at:null,recorded_at:`${day}T12:00:00Z`,mode:'assessment',expected_before:null,layers:{...emptyLayers(),teeth:{11:{base}}}});
const data=(overrides:Record<string,unknown>={})=>({states:[],legacyStates:[],...overrides} as unknown as ClinicalWorkspace);
afterEach(()=>vi.useRealTimers());
describe('Prosthesis registration context',()=>{
  it.each(CLINICAL_PROSTHESIS_TYPES)('preserves %s exactly in a compatible clinical command',clinicalType=>{
    const prosthesisType=prosthesisCategory(clinicalType);
    const command={action:'register',requestKey:crypto.randomUUID(),occurredOn:'2026-01-01',source:'Korabeli karton',episodeId:crypto.randomUUID(),jaw:'felso',origin:'local',role:'definitive',label:'Részletes készülék',prosthesisType,specification:{clinicalType,madeWhen:'2023 tavasz',madeBy:'Korábbi rendelő',satisfied:false,complaint:'Instabil',historicalCustom:'Megőrzött adat'}};
    expect(clinicalCommandSchema.parse(command).action).toBe('register');
    expect(clinicalCommandSchema.parse(command)).toMatchObject({prosthesisType,specification:command.specification});
  });
  it('distinguishes tooth-supported, cemented and screwed fixed appliances',()=>{
    expect(FIXED_TYPES.map(prosthesisCategory)).toEqual(['fixed','fixed','screw_retained_implant_bridge']);
    const command={action:'register',requestKey:crypto.randomUUID(),occurredOn:'2026-01-01',source:'Saját vizsgálat',episodeId:crypto.randomUUID(),jaw:'felso',origin:'local',role:'definitive',label:'Híd',prosthesisType:'removable',specification:{clinicalType:FIXED_TYPES[2]}};
    expect(clinicalCommandSchema.safeParse(command).success).toBe(false);
  });
  it('uses the exact-day background without copying later tooth findings',()=>{
    const older=state('2026-01-01','missing'),later=state('2026-09-01','sound');
    const result=registrationBackground(data({states:[older,later]}),'2026-02-01');
    expect(result.layers.teeth[11]).toEqual({base:'missing'});expect(result.layers.teeth[12]).toBeUndefined();
    expect(older.layers.teeth[11]).toEqual({base:'missing'});
    expect(registrationBackground(data({states:[later]}),'2026-02-01').layers).toEqual(emptyLayers());
  });
  it('keeps current undated legacy teeth and implants visible with explicit provenance, never in an older event',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const workspace=data({legacyDental:{meglevoFogak:{11:{base:'missing'}},meglevoImplantatumok:{11:'Korábbi REF és LOT'}}});
    const current=registrationBackground(workspace,'2026-11-05');
    expect(current.label).toContain('dátumuk nem igazolt');expect(current.layers.implants[11]).toEqual({present:true,description:'Korábbi REF és LOT'});
    expect(registrationBackground(workspace,'2026-02-01').layers).toEqual(emptyLayers());
  });
  it('can use an actual dated legacy snapshot for a historical registration',()=>{
    const workspace=data({legacyStates:[{effective_date:'2026-01-01',fogak:{11:{status:'M'}}},{effective_date:'2026-10-01',fogak:{11:{base:'sound'}}}]});
    expect(registrationBackground(workspace,'2026-03-01').layers.teeth[11]).toEqual({status:'M'});
  });
  it('suggests a bounded detailed name with unique sorted teeth and preserves unknown satisfaction',()=>{
    const draft={jaw:'felso',role:'provisional',prosthesisType:'fixed',positions:[{tooth:16,role:'abutment' as const},{tooth:14,role:'pontic' as const},{tooth:16,role:'implant' as const}],specification:{clinicalType:FIXED_TYPES[1]}};
    expect(suggestedProsthesisLabel(draft)).toBe(`Felső ideiglenes ${FIXED_TYPES[1]} · 14, 16`);
    expect(suggestedProsthesisLabel({...draft,specification:{clinicalType:'x'.repeat(160)}}).length).toBeLessThanOrEqual(160);
    expect(prosthesisDetails({satisfied:null})).toEqual([]);expect(prosthesisDetails({satisfied:false})).toEqual([{label:'Elégedett vele?',value:'Nem'}]);
  });
});
