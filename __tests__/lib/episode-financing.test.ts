import { describe,expect,it } from 'vitest';
import { financingAt,financingCommandSchema,financingForPlan,financingSummary,type FinancingEvent } from '@/lib/episode-financing/model';
const plan='11111111-1111-4111-8111-111111111111';
const command={action:'financing',episodeId:crypto.randomUUID(),requestKey:crypto.randomUUID(),expectedVersion:0,occurredOn:'2026-09-10',effectiveOn:'2026-09-10',source:'Korabeli határozat',planVersionId:plan,mode:'equity',status:'approved',reason:'Kérelem elbírálva'};
const event=(fields:Partial<FinancingEvent>):FinancingEvent=>({id:crypto.randomUUID(),version:1,effective_on:'2026-09-10',occurred_on:'2026-09-10',active:true,plan_version_id:plan,mode:'equity',status:'approved',...fields} as FinancingEvent);
describe('Dated financing decisions',()=>{
  it('preserves unknown amounts separately from a documented zero and normalizes decimal input exactly',()=>{
    expect(financingCommandSchema.parse({...command,totalAmount:'',fundedAmount:'0',patientAmount:'0,00'})).toMatchObject({totalAmount:null,fundedAmount:'0.00',patientAmount:'0.00'});
    expect(financingCommandSchema.parse({...command,totalAmount:'1 000,30',fundedAmount:'1000.10',patientAmount:'0,20'})).toMatchObject({totalAmount:'1000.30',fundedAmount:'1000.10',patientAmount:'0.20'});
  });
  it.each([
    {totalAmount:'1.00',fundedAmount:'0.10',patientAmount:'0.20'},
    {totalAmount:'10',patientAmount:'11'},
    {totalAmount:'-1'}, {totalAmount:'0.001'}, {totalAmount:'NaN'},
    {mode:'self_pay',fundedAmount:'1'}, {mode:'other',payer:''},
    {status:'approved',planVersionId:null}, {status:'approved',mode:'unknown'},
    {precision:'exact',occurredAt:null}, {precision:'day',occurredAt:'2026-09-10T08:00:00Z'},
    {precision:'exact',occurredAt:'2026-09-09T08:00:00Z'},
  ])('rejects invalid financial or dating data: %j',fields=>expect(financingCommandSchema.safeParse({...command,...fields}).success).toBe(false));
  it('allows an undecided episode-level discussion and future effective dates',()=>{
    expect(financingCommandSchema.safeParse({...command,planVersionId:null,status:'pending',effectiveOn:'2027-01-01'}).success).toBe(true);
  });
  it('orders by effective date rather than entry order and excludes future and corrected entries',()=>{
    const september=event({version:3}),october=event({version:2,effective_on:'2026-10-01',occurred_on:'2026-09-25',mode:'self_pay'});
    const future=event({version:4,effective_on:'2027-01-01'}),corrected=event({version:5,effective_on:'2026-10-15',active:false});
    expect(financingAt([september,future,corrected,october],'2026-11-01',plan).event?.id).toBe(october.id);
    expect(financingAt([september,october],'2026-09-15',plan).event?.id).toBe(september.id);
  });
  it('requires financing review after a plan change and never revives an earlier approval after withdrawal',()=>{
    const approval=event({}),withdrawal=event({version:2,effective_on:'2026-10-01',status:'withdrawn'});
    expect(financingAt([approval],'2026-11-01',crypto.randomUUID()).requiresReview).toBe(true);
    expect(financingForPlan([approval,withdrawal],'2026-11-01',plan).event?.status).toBe('withdrawn');
    expect(financingSummary(financingAt([approval],'2026-11-01',crypto.randomUUID()))).not.toContain('jóváhagyva');
  });
  it('uses the known decision time when two decisions share an effective day and a decision day',()=>{
    const early=event({version:3,occurred_at:'2026-09-10T08:00:00Z'}),late=event({version:2,occurred_at:'2026-09-10T10:00:00Z'});
    expect(financingAt([early,late],'2026-11-01',plan).event?.id).toBe(late.id);
  });
});
