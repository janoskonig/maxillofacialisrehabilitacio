import { computeStepWindow } from '@/lib/step-window';
import type { PhaseWindowChainResult,VisitAwareChainRow } from '@/lib/phase-window-chain';

export interface ClinicalChainRow extends VisitAwareChainRow { clinicalScope?:string; requiresPhaseIds?:string[] }
/** Only explicit dependencies connect managed jobs; sharing a jaw never does. */
export function clinicalDependencyWindows(rows:ClinicalChainRow[],baseline:Date,legacy=new Map<string,PhaseWindowChainResult>()) {
  const out=new Map<string,PhaseWindowChainResult>(),visiting=new Set<string>();
  const groups=new Map<string,ClinicalChainRow[]>(),byId=new Map(rows.map(r=>[r.rowKey,r]));
  const groupKey=(r:ClinicalChainRow)=>r.visitId??r.rowKey;
  for(const row of rows){const key=groupKey(row);groups.set(key,[...(groups.get(key)??[]),row]);}
  function calculate(row:ClinicalChainRow):PhaseWindowChainResult {
    const known=out.get(row.rowKey);if(known)return known;
    const key=groupKey(row),members=groups.get(key)!;
    if(visiting.has(key))throw new Error('Körkörös vizitfüggőség: a munkafázisok kapcsolatait felül kell vizsgálni');
    visiting.add(key);
    let anchor=new Date(baseline);
    for(const member of members)for(const requiredId of member.requiresPhaseIds??[]){
      const required=byId.get(requiredId);if(!required||groupKey(required)===key)continue;
      const hard=required.completedAt??required.bookedStart;
      const projected=hard??(required.clinicalScope&&required.clinicalScope!=='review'?calculate(required).expectedDate:legacy.get(requiredId)?.expectedDate);
      if(projected&&projected>anchor)anchor=new Date(projected);
    }
    const offset=Math.max(...members.map(r=>r.visitDaysOffset??r.defaultDaysOffset));
    const result=computeStepWindow(anchor,offset);
    const hard=members.map(r=>r.completedAt??r.bookedStart).filter((d):d is Date=>!!d).sort((a,b)=>b.getTime()-a.getTime())[0];
    const value={...result,expectedDate:hard??result.expectedDate,earliestAllowedStart:result.windowStart};
    for(const member of members)out.set(member.rowKey,value);
    visiting.delete(key);return value;
  }
  for(const row of rows)if(row.clinicalScope&&row.clinicalScope!=='review')calculate(row);
  return out;
}
