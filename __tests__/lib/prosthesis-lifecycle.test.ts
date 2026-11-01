import { describe,expect,it } from 'vitest';
import { canonical,clinicalCommandSchema,emptyLayers,projectClinicalPlan,replayStates,type StateEvidence } from '@/lib/prosthesis-lifecycle/model';
import { clinicalDependencyWindows } from '@/lib/prosthesis-lifecycle/scheduling';
const evidence=(id:string,day:string,layers:StateEvidence['layers'],extra:Partial<StateEvidence>={}):StateEvidence=>({id,event_id:id,occurred_on:day,occurred_at:null,recorded_at:'2026-10-01',mode:'assessment',layers,expected_before:null,...extra});
describe('clinical prosthesis timeline',()=>{
  it('delays the other jaw only through an explicit dependency',()=>{
    const base=new Date('2026-01-01T10:00:00Z');
    const row={workPhaseCode:'trial',defaultDaysOffset:14,status:'pending' as const,completedAt:null,bookedStart:null,clinicalScope:'prosthesis'};
    const upper={...row,rowKey:'upper',bookedStart:new Date('2026-04-01T10:00:00Z')},lower={...row,rowKey:'lower'};
    const independent=clinicalDependencyWindows([upper,lower],base);
    expect(independent.get('lower')?.expectedDate.toISOString().slice(0,10)).toBe('2026-01-15');
    const dependent=clinicalDependencyWindows([upper,{...lower,requiresPhaseIds:['upper']}],base);
    expect(dependent.get('lower')?.expectedDate.toISOString().slice(0,10)).toBe('2026-04-15');
  });
  it('keeps tooth loss, implants and artificial teeth in separate layers',()=>{
    const baseline={...emptyLayers(),teeth:{'11':{base:'missing'},'12':{base:'sound'}}};
    const result=projectClinicalPlan(baseline,[{toothNumber:11,treatmentCode:'implantacio'},{toothNumber:11,treatmentCode:'mufog'}],[{id:'device',positions:[{tooth:11,role:'pontic'}]}]);
    expect(result.teeth['11']).toEqual({base:'missing'});expect(result.implants['11']).toEqual({present:true,planned:true});
    expect(Object.values(result.prostheses)).toHaveLength(1);expect(baseline.implants).toEqual({});
  });
  it('replays clinical rather than recording dates and preserves later examinations',()=>{
    const base=evidence('baseline','2026-09-01',{...emptyLayers(),teeth:{'11':{base:'sound'}}});
    const later=evidence('later','2026-10-01',{...emptyLayers(),teeth:{'11':{base:'filled'}}});
    const backdated=evidence('late-entry','2026-09-10',{...emptyLayers(),teeth:{'11':{base:'missing'}}},{mode:'change',recorded_at:'2026-11-01',expected_before:base.layers});
    const result=replayStates([later,backdated,base]);
    expect(result.milestones.map(s=>s.state.id)).toEqual(['baseline','late-entry','later']);
    expect(result.layers.teeth['11']).toEqual({base:'filled'});expect(result.conflicts).toHaveLength(1);
  });
  it('never fills in unknown historic teeth from current status',()=>{
    const result=replayStates([evidence('partial','2026-09-01',{...emptyLayers(),teeth:{'11':{base:'missing'}}})]);
    expect(result.layers.teeth['12']).toBeUndefined();
  });
  it('validates real dates and explicit time precision',()=>{
    const input={action:'milestone',requestKey:crypto.randomUUID(),prosthesisId:crypto.randomUUID(),source:'Old chart',milestone:'delivered',occurredOn:'2026-02-30'};
    expect(clinicalCommandSchema.safeParse(input).success).toBe(false);
    expect(clinicalCommandSchema.safeParse({...input,occurredOn:'2026-09-10',precision:'exact'}).success).toBe(false);
    expect(clinicalCommandSchema.safeParse({...input,occurredOn:'2026-09-10'}).success).toBe(true);
  });
  it('canonicalizes object order without conflating array sequence',()=>{
    expect(canonical({b:1,a:2})).toBe(canonical({a:2,b:1}));expect(canonical([1,2])).not.toBe(canonical([2,1]));
  });
});
