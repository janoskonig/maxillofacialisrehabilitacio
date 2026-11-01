import { z } from 'zod';
import { clinicalDay } from '@/lib/prosthesis-lifecycle/model';

export const FINANCING_MODES={unknown:'Nincs meghatározva',neak:'NEAK / közfinanszírozás',equity:'Egyedi méltányosság',self_pay:'Önköltséges',mixed:'Vegyes finanszírozás',other:'Egyéb finanszírozó'} as const;
export const FINANCING_STATUSES={unknown:'Nem ismert',pending:'Egyeztetés / elbírálás alatt',approved:'Elfogadva / jóváhagyva',rejected:'Elutasítva',withdrawn:'Visszavonva / megszűnt'} as const;
const amount=z.preprocess(v=>v===''?null:v,z.string().trim().transform(v=>v.replace(/\s/g,'').replace(',','.')).refine(v=>/^\d{1,12}(\.\d{1,2})?$/.test(v),'Legfeljebb két tizedesjegyű, nem negatív összeg szükséges').transform(v=>{const [whole,decimal='']=v.split('.');return `${BigInt(whole)}.${decimal.padEnd(2,'0')}`;}).nullable());
const cents=(v:string)=>BigInt(v.replace('.',''));
export const financingCommandSchema=z.object({
  action:z.literal('financing'),episodeId:z.string().uuid(),requestKey:z.string().uuid(),expectedVersion:z.number().int().min(0).max(2147483646),
  occurredOn:clinicalDay,occurredAt:z.string().datetime({offset:true}).nullable().default(null),precision:z.enum(['day','exact']).default('day'),
  source:z.string().trim().min(1).max(500),note:z.string().trim().max(10000).default(''),
  effectiveOn:clinicalDay,planVersionId:z.string().uuid().nullable(),
  mode:z.enum(['unknown','neak','equity','self_pay','mixed','other']),status:z.enum(['unknown','pending','approved','rejected','withdrawn']),
  payer:z.string().trim().max(200).default(''),currency:z.enum(['HUF','EUR']).default('HUF'),
  totalAmount:amount.default(null),fundedAmount:amount.default(null),patientAmount:amount.default(null),
  reason:z.string().trim().min(1).max(2000),decisionReference:z.string().trim().max(200).default(''),
  documentIds:z.array(z.string().uuid()).max(50).default([]),correctsId:z.string().uuid().optional(),
}).superRefine((c,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(c.status==='approved'&&(!c.planVersionId||c.mode==='unknown'))fail('Elfogadott finanszírozáshoz konkrét tervváltozat és finanszírozási mód szükséges');
  if(c.mode==='other'&&!c.payer)fail('Az egyéb finanszírozó megnevezése szükséges');
  if(c.mode==='self_pay'&&c.fundedAmount!==null&&cents(c.fundedAmount)>BigInt(0))fail('Önköltséges ellátásnál a finanszírozói rész nem lehet pozitív; részleges támogatáshoz vegyes finanszírozást válasszon');
  if((c.precision==='exact')!==!!c.occurredAt)fail('A döntés időpontjának pontossága és időbélyege eltér');
  if(c.occurredAt&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date(c.occurredAt))!==c.occurredOn)fail('A döntés időpontja és napja eltér');
  if(c.totalAmount!==null){
    if(c.fundedAmount!==null&&cents(c.fundedAmount)>cents(c.totalAmount))fail('A finanszírozói rész meghaladja a teljes összeget');
    if(c.patientAmount!==null&&cents(c.patientAmount)>cents(c.totalAmount))fail('A beteg terhe meghaladja a teljes összeget');
    if(c.fundedAmount!==null&&c.patientAmount!==null&&cents(c.fundedAmount)+cents(c.patientAmount)!==cents(c.totalAmount))fail('A finanszírozói rész és a beteg terhe együtt a teljes összeg legyen');
  }
});
export type FinancingCommand=z.infer<typeof financingCommandSchema>;
export interface FinancingEvent {
  id:string;event_id:string;patient_id:string;episode_id:string;prosthesis_id:string|null;plan_version_id:string|null;version:number;
  effective_on:string;occurred_on:string;occurred_at:string|null;time_precision:'day'|'exact';recorded_at:string;recorded_by:string;recorder:string;
  source:string;note:string;mode:keyof typeof FINANCING_MODES;status:keyof typeof FINANCING_STATUSES;payer:string;currency:'HUF'|'EUR';
  total_amount:string|null;funded_amount:string|null;patient_amount:string|null;reason:string;decision_reference:string;document_ids:string[];corrects_id:string|null;active:boolean;
}
export interface FinancingSnapshot {asOf:string;event:FinancingEvent|null;requiresReview:boolean;historical?:boolean}
export interface EpisodeFinancing {revision:number;current:FinancingSnapshot;history:FinancingEvent[];upcoming:FinancingEvent[]}
export function financingAt(history:FinancingEvent[],asOf:string,planVersionId:string|null):FinancingSnapshot {
  const event=history.filter(e=>e.active&&e.effective_on<=asOf).sort((a,b)=>b.effective_on.localeCompare(a.effective_on)||b.occurred_on.localeCompare(a.occurred_on)||
    (a.occurred_at&&b.occurred_at?new Date(b.occurred_at).getTime()-new Date(a.occurred_at).getTime():0)||b.version-a.version)[0]??null;
  return {asOf,event,requiresReview:!!event&&event.plan_version_id!==null&&event.plan_version_id!==planVersionId};
}
export function financingForPlan(history:FinancingEvent[],asOf:string,planVersionId:string):FinancingSnapshot {
  return financingAt(history,asOf,planVersionId);
}
export function financingSummary(snapshot:FinancingSnapshot|undefined):string {
  if(!snapshot?.event)return 'Finanszírozás nincs rögzítve';
  const e=snapshot.event;
  return `${snapshot.historical?'Korábbi döntés: ':e.effective_on>snapshot.asOf?'Jövőben hatályos: ':''}${FINANCING_MODES[e.mode]} · ${snapshot.requiresReview?'Másik tervváltozatra szól · felülvizsgálandó':FINANCING_STATUSES[e.status]}`;
}
export function formatFinancingAmount(amount:string|null,currency:string):string {
  return amount===null?'Nem rögzített':new Intl.NumberFormat('hu-HU',{style:'currency',currency,maximumFractionDigits:2}).format(Number(amount));
}
export function financingLines(snapshot:FinancingSnapshot|undefined):string[] {
  if(!snapshot?.event)return ['Finanszírozás nincs rögzítve; jóváhagyás nem állapítható meg.'];
  const e=snapshot.event;
  return [financingSummary(snapshot),`Döntés napja: ${e.occurred_on}; hatályos: ${e.effective_on}; rögzítve: ${e.recorded_at}; rögzítette: ${e.recorder}`,
    `Finanszírozó: ${e.payer||'Nincs megadva'}; hivatkozás: ${e.decision_reference||'Nincs megadva'}`,
    `Teljes összeg: ${formatFinancingAmount(e.total_amount,e.currency)}; finanszírozói rész: ${formatFinancingAmount(e.funded_amount,e.currency)}; beteg terhe: ${formatFinancingAmount(e.patient_amount,e.currency)}`,
    `Indok: ${e.reason}; forrás: ${e.source}`,`Finanszírozási változat: ${e.version}; döntésazonosító: ${e.id}; tervváltozat: ${e.plan_version_id||'Epizódszintű egyeztetés'}`];
}
