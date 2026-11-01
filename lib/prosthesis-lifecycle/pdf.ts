import { rgb } from 'pdf-lib';
import type { Patient } from '@/lib/types';
import { ClinicalDocument } from '@/lib/pdf/clinical-document';
import { LAYOUT } from '@/lib/pdf/layout';
import { BASE_LABELS, UPPER_ROW, LOWER_ROW } from '@/components/patient-form/odontogram/tooth-conditions';
import type { ClinicalLayers } from './model';

export function describeClinicalValue(v:unknown):string {
  if (v==null) return 'Nincs dokumentált adat';
  if (typeof v==='string') return v;
  if (typeof v!=='object') return String(v);
  const o=v as Record<string,unknown>;
  return Object.entries(o).map(([k,x])=>k==='base' ? (BASE_LABELS[x as keyof typeof BASE_LABELS]??String(x)) : `${k}: ${typeof x==='object'?JSON.stringify(x):String(x)}`).join('; ');
}
export async function writeClinicalLayers(doc:ClinicalDocument,layers:ClinicalLayers) {
  doc.text('A hiányzó bejegyzés ismeretlen állapotot jelent. A saját fog, az implantátum és a pótlás külön réteg.',9);
  for (const [label,numbers] of [['Felső állcsont',UPPER_ROW],['Alsó állcsont',LOWER_ROW]] as const) {
    doc.ensureSpace(100);doc.heading(label);
    const top=doc.state.y, width=LAYOUT.contentWidth/16;
    numbers.forEach((n,i)=>{
      const tooth=layers.teeth[String(n)] as {base?:string}|undefined;
      const implant=layers.implants[String(n)];
      const devices=Object.values(layers.prostheses).filter(v=>v && typeof v==='object' && (v as {tooth?:number}).tooth===n);
      const code=tooth?.base==='missing'?'M':tooth?'F':'?';
      doc.state.page.drawRectangle({x:LAYOUT.margin+i*width,y:top-46,width,height:46,borderWidth:0.5,borderColor:rgb(.7,.75,.8),color:rgb(.97,.98,.99)});
      for (const [text,y] of [[String(n),12],[code,26],[`${implant?'I':''}${devices.length?' P':''}`,39]] as const)
        doc.state.page.drawText(text,{x:LAYOUT.margin+i*width+5,y:top-y,size:8,font:doc.font});
    });
    doc.gap(56);doc.text('F: dokumentált sajátfog-adat; M: hiányzó saját fog; I: implantátum; P: fogpótlás; ?: ismeretlen.',8);
    for (const n of numbers) {
      const key=String(n), roles=Object.values(layers.prostheses).filter(v=>v && typeof v==='object' && (v as {tooth?:number}).tooth===n);
      if (layers.teeth[key]!==undefined || layers.implants[key]!==undefined || roles.length) {
        doc.text(`${n}: saját fog: ${describeClinicalValue(layers.teeth[key])}; implantátum: ${describeClinicalValue(layers.implants[key])}`,9);
        for (const role of roles) doc.text(`Pótlás: ${describeClinicalValue(role)}`,9);
      }
    }
  }
}
export async function clinicalStatusPDF(patient:Partial<Patient>, layers:ClinicalLayers, metadata:string) {
  const doc=await ClinicalDocument.create('Dátumhoz kötött fogazati státusz',patient);
  doc.text(metadata,9);await writeClinicalLayers(doc,layers);return doc.finish();
}
export async function clinicalPlanPDF(patient:Partial<Patient>, plan:{version:number;content:any}, metadata:string) {
  const doc=await ClinicalDocument.create(`Kezelési terv - ${plan.version}. változat`,patient);
  doc.text(metadata,9);doc.heading('Klinikai terv');doc.text(plan.content.description);
  doc.heading('Beavatkozások sorrendben');
  if (!plan.content.treatments.length) doc.text('Nincs külön fogszintű beavatkozás megadva.');
  for (const t of plan.content.treatments) doc.text(`${t.toothNumber}. fog: ${t.treatmentCode}`);
  doc.heading('Fogpótlások és pozíciók');
  for (const p of plan.content.devices) {
    doc.text(`${p.label} | ${p.id} | ${p.jaw} | ${p.role} | ${p.prosthesis_type}`,10,true);
    doc.text(describeClinicalValue(p.specification),9);
    for (const position of p.positions) doc.text(`${position.tooth}: ${position.role}`,9);
  }
  doc.heading('Munkafázisok');
  for (const w of plan.content.workPhases) doc.text(`${w.custom_label??w.work_phase_code} | pótlások: ${(w.prosthesis_ids??[]).join(', ')||'epizódszintű / ellenőrzendő'}`,9);
  doc.heading('Tervezett célállapot');await writeClinicalLayers(doc,plan.content.target);return doc.finish();
}
