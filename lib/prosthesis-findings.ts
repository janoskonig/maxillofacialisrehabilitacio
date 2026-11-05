import { isDetailedPositionRole, type ProsthesisComponent } from '@/lib/prosthesis-components';
import { normalizeToothData, type ToothStatus } from '@/lib/tooth-data';
import type { ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';

export function observedComponents(layers:ClinicalLayers,tooth:number):ProsthesisComponent[] {
  const roles=normalizeToothData(layers.teeth[tooth] as ToothStatus)?.components??[];
  const linked=Object.values(layers.prostheses).flatMap(value=>{
    const item=value as {tooth?:number;role?:string}|null;
    return item?.tooth===tooth&&item.role&&isDetailedPositionRole(item.role)?[item.role]:[];
  });
  const implant=(layers.implants[tooth] as {present?:boolean}|undefined)?.present===true?['position_implant' as const]:[];
  return Array.from(new Set([...roles,...linked,...implant]));
}

/** Edits only examination findings, never the appliance registry or the natural-tooth base. */
export function setObservedComponents(layers:ClinicalLayers,tooth:number,components:ProsthesisComponent[]):ClinicalLayers {
  const next=structuredClone(layers),previous=observedComponents(layers,tooth);
  for(const [key,value] of Object.entries(next.prostheses)){
    const item=value as {tooth?:number;role?:string}|null;
    if(item?.tooth===tooth&&item.role&&isDetailedPositionRole(item.role)&&!components.includes(item.role))delete next.prostheses[key];
  }
  for(const role of components){
    if(!Object.values(next.prostheses).some((value:any)=>value?.tooth===tooth&&value?.role===role))next.prostheses[`finding:${tooth}:${role}`]={tooth,role,observed:true};
  }
  const raw=normalizeToothData(next.teeth[tooth] as ToothStatus);
  if(raw?.components){
    const finding={...raw};if(components.length)finding.components=[...components];else delete finding.components;
    next.teeth[tooth]=finding;
  }
  if(components.includes('position_implant')||previous.includes('position_implant')){
    next.implants[tooth]={...(next.implants[tooth] as object??{}),present:components.includes('position_implant')};
  }
  return next;
}

/** Derive separate display layers without rewriting the original chart/snapshot. */
export function addToothComponentFindings(layers:ClinicalLayers):ClinicalLayers {
  const next=structuredClone(layers);
  for(const [key,value] of Object.entries(next.teeth)){
    const components=normalizeToothData(value as ToothStatus)?.components??[];
    for(const role of components)next.prostheses[`finding:${key}:${role}`]={tooth:Number(key),role,observed:true};
    if(components.includes('position_implant')&&next.implants[key]===undefined)next.implants[key]={present:true};
  }
  return next;
}

/** Export adapter: retain exact component identities when a layered status is exported as a chart. */
export function teethWithObservedComponents(layers:ClinicalLayers):Record<string,ToothStatus> {
  const teeth=structuredClone(layers.teeth) as Record<string,ToothStatus>;
  for(const value of Object.values(layers.prostheses)){
    const item=value as {tooth?:number;role?:string}|null;
    if(!item?.tooth||!item.role||!isDetailedPositionRole(item.role))continue;
    const finding={...(normalizeToothData(teeth[item.tooth])??{})};
    finding.components=Array.from(new Set([...(finding.components??[]),item.role]));
    teeth[item.tooth]=finding;
  }
  return teeth;
}
