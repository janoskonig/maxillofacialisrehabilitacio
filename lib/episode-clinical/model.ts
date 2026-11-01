import { z } from 'zod';
import { REASON_VALUES, type Patient } from '@/lib/types';
import { budapestToday } from '@/lib/aftercare/model';
import { normalizeDefectRaster } from '@/lib/defect-raster';

export const reviewDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}, 'Érvénytelen dátum.');
const text = z.string().trim().max(10000).nullable();
const basicKeys = ['nev','taj','szuletesiDatum','nem','telefonszam','email','cim','varos','iranyitoszam','torvenyesKepviseloNev','torvenyesKepviseloKapcsolat','torvenyesKepviseloEmail','kezeleoorvos','kezeleoorvosIntezete'] as const;
export const BASIC_LABELS:Record<typeof basicKeys[number],string> = {
  nev:'Név',taj:'TAJ',szuletesiDatum:'Születési dátum',nem:'Nem',telefonszam:'Telefonszám',email:'Email',cim:'Cím',varos:'Város',iranyitoszam:'Irányítószám',torvenyesKepviseloNev:'Törvényes képviselő neve',torvenyesKepviseloKapcsolat:'Képviselő kapcsolata',torvenyesKepviseloEmail:'Képviselő email címe',kezeleoorvos:'Kezelőorvos az adatfelvételkor',kezeleoorvosIntezete:'Kezelőorvos intézete az adatfelvételkor',
};
export const CLINICAL_TEXT_FIELDS = [
  ['diagnozis','Diagnózis'],['bno','BNO'],['kortortenetiOsszefoglalo','Kórtörténeti összefoglaló'],
  ['szakorvosiVelemény','Szakorvosi vélemény'],
  ['beutaloOrvos','Beutaló orvos'],['beutaloIntezmeny','Beutaló intézmény'],['beutaloIndokolas','Beutalás indokolása'],
  ['alkoholfogyasztas','Alkoholfogyasztás'],['dohanyzasSzam','Dohányzás'],
  ['szovettaniDiagnozis','Szövettani diagnózis'],['tnmStaging','TNM'],
  ['radioterapiaDozis','Sugárkezelés dózisa'],['radioterapiaDatumIntervallum','Sugárkezelés időszaka'],['chemoterapiaLeiras','Kemoterápia leírása'],
  ['balesetIdopont','Baleset dátuma'],['balesetEtiologiaja','Baleset körülményei'],['balesetEgyeb','Traumás előzmények, egyéb körülmények'],
  ['nyalmirigyAllapot','Nyálmirigy állapota'],['nyakiBlokkdisszekcio','Nyaki blokkdisszekció'],
  ['brownFuggolegesOsztaly','Korábbi Brown függőleges osztály'],['brownVizszintesKomponens','Korábbi Brown vízszintes komponens'],['kovacsDobakOsztaly','Korábbi Kovács–Dobák osztály'],
  ['fabianFejerdyProtetikaiOsztalyFelso','Fábián–Fejérdy osztály, felső'],['fabianFejerdyProtetikaiOsztalyAlso','Fábián–Fejérdy osztály, alsó'],
  ['veleszuletettMutetekLeirasa','Korábbi veleszületett műtéti összefoglaló'],['primerMutetLeirasa','Korábbi primer műtéti összefoglaló'],['mutetIdeje','Korábban rögzített műtéti dátum'],
] as const;
export const CLINICAL_BOOLEAN_FIELDS = [
  ['radioterapia','Volt sugárkezelés'],['chemoterapia','Volt kemoterápia'],['maxilladefektusVan','Maxilladefektus'],['mandibuladefektusVan','Mandibuladefektus'],['nyelvmozgásokAkadályozottak','Nyelvmozgások akadályozottak'],['gombocosBeszed','Gombócos beszéd'],
] as const;
type TextKey=typeof CLINICAL_TEXT_FIELDS[number][0];
type BooleanKey=typeof CLINICAL_BOOLEAN_FIELDS[number][0];
const textShape=Object.fromEntries(CLINICAL_TEXT_FIELDS.map(([key])=>[key,text])) as Record<TextKey,typeof text>;
const booleanShape=Object.fromEntries(CLINICAL_BOOLEAN_FIELDS.map(([key])=>[key,z.boolean().nullable()])) as Record<BooleanKey,z.ZodNullable<z.ZodBoolean>>;
const basicsShape=Object.fromEntries(basicKeys.map(key=>[key,text])) as Record<typeof basicKeys[number],typeof text>;
export const surgerySchema=z.object({
  id:z.string().uuid(),occurredOn:reviewDate.nullable(),approximateDate:z.string().trim().max(200),
  procedure:z.string().trim().min(1,'A műtét megnevezése szükséges.').max(10000),
  indication:z.string().trim().max(10000),institution:z.string().trim().max(500),
  source:z.string().trim().min(1,'A műtéti adat forrása szükséges.').max(1000),
}).refine(s=>!s.occurredOn||!s.approximateDate,'Pontos nap vagy hozzávetőleges időszak adható meg.');
export const clinicalContentSchema=z.object({
  reason:z.enum(REASON_VALUES),basics:z.object({...basicsShape,nem:z.enum(['ferfi','no']).nullable(),szuletesiDatum:reviewDate.nullable(),taj:z.string().trim().max(20).nullable().refine(v=>!v||/^\d{9}$/.test(v.replace(/-/g,'')),'A TAJ 9 számjegyből állhat.')}),
  anamnesis:z.object({...textShape,...booleanShape,
    veleszuletettRendellenessegek:z.array(z.string().trim().max(200)).max(50).transform(values=>values.filter(Boolean)),
    maxillaDefektusRaszter:z.array(z.string().regex(/^r[0-5]c[0-7]$/)).max(48).refine(values=>normalizeDefectRaster('maxilla',values).length===values.length,'Érvénytelen vagy ismételt maxillaraszter-mező.'),
    mandibulaDefektusRaszter:z.array(z.string().regex(/^r[0-5]c[0-7]$/)).max(48).refine(values=>normalizeDefectRaster('mandibula',values).length===values.length,'Érvénytelen vagy ismételt mandibularaszter-mező.'),
  }),
  surgicalHistory:z.enum(['unknown','none','documented']),surgeries:z.array(surgerySchema).max(100),
  baselineStateId:z.string().uuid().nullable(),
}).superRefine((c,ctx)=>{
  if((c.surgicalHistory==='documented')!==(c.surgeries.length>0))ctx.addIssue({code:'custom',message:'Rögzített műtéti előzményhez legalább egy műtét szükséges; a nemleges vagy ismeretlen állapothoz ne maradjon műtéti sor.'});
  if(new Set(c.surgeries.map(s=>s.id)).size!==c.surgeries.length)ctx.addIssue({code:'custom',message:'Egy műtét azonosítója csak egyszer szerepelhet.'});
  if(c.anamnesis.maxilladefektusVan===false&&c.anamnesis.maxillaDefektusRaszter.length||c.anamnesis.mandibuladefektusVan===false&&c.anamnesis.mandibulaDefektusRaszter.length)ctx.addIssue({code:'custom',message:'A nemleges defektusstátuszhoz nem tartozhat bejelölt kiterjedés.'});
  for(const key of ['szuletesiDatum'] as const){const value=c.basics[key];if(value&&!reviewDate.safeParse(value).success)ctx.addIssue({code:'custom',message:'Érvénytelen születési dátum.'});}
});
export const reviewCommandSchema=z.object({
  requestKey:z.string().uuid(),expectedVersion:z.number().int().min(0),expectedReason:z.enum(REASON_VALUES),
  effectiveOn:reviewDate,source:z.string().trim().min(1,'Az adatfelvétel forrása szükséges.').max(1000),
  note:z.string().trim().max(10000),sourceReviewId:z.string().uuid().nullable(),
  reviewed:z.literal(true),content:clinicalContentSchema,
}).superRefine((c,ctx)=>{
  if(c.effectiveOn>budapestToday())ctx.addIssue({code:'custom',message:'Megtörtént adatfelvétel nem lehet jövőbeli.'});
  if(c.content.basics.szuletesiDatum&&c.content.basics.szuletesiDatum>c.effectiveOn)ctx.addIssue({code:'custom',message:'A születési dátum az adatfelvétel utánra esik.'});
  if(c.content.surgeries.some(s=>s.occurredOn&&s.occurredOn>c.effectiveOn))ctx.addIssue({code:'custom',message:'Az adatfelvételnél későbbi műtét nem lehet az akkori előzmények része.'});
});
export type EpisodeClinicalContent=z.infer<typeof clinicalContentSchema>;
export type EpisodeReviewCommand=z.infer<typeof reviewCommandSchema>;
export interface EpisodeClinicalReview {
  id:string;patientId:string;episodeId:string;version:number;effectiveOn:string;source:string;note:string;
  sourceReviewId:string|null;recordedAt:string;recordedBy:string;recorder:string;content:EpisodeClinicalContent;
}
export interface EpisodeClinicalWorkspace {
  episode:{id:string;reason:EpisodeClinicalContent['reason'];chiefComplaint:string;status:string};
  current:EpisodeClinicalReview|null;history:EpisodeClinicalReview[];latestVersion:number;
  template:EpisodeClinicalContent;templateProvenance:'legacy_unreviewed'|'review';
  availableReviews:Array<Pick<EpisodeClinicalReview,'id'|'episodeId'|'effectiveOn'|'version'|'recordedAt'>&{caseTitle:string|null}>;
}
export function clinicalTemplate(patient:Partial<Patient>,reason:EpisodeClinicalContent['reason']):EpisodeClinicalContent {
  const value=patient as Record<string,unknown>;
  const stringValue=(key:string)=>{const v=value[key];return v==null||v===''?null:v instanceof Date?v.toISOString().slice(0,10):String(v);};
  return {reason,basics:Object.fromEntries(basicKeys.map(key=>[key,stringValue(key)])) as EpisodeClinicalContent['basics'],
    anamnesis:{...Object.fromEntries(CLINICAL_TEXT_FIELDS.map(([key])=>[key,stringValue(key)])),
      ...Object.fromEntries(CLINICAL_BOOLEAN_FIELDS.map(([key])=>[key,typeof value[key]==='boolean'?value[key]:null])),
      veleszuletettRendellenessegek:patient.veleszuletettRendellenessegek??[],maxillaDefektusRaszter:patient.maxillaDefektusRaszter??[],mandibulaDefektusRaszter:patient.mandibulaDefektusRaszter??[],
    } as EpisodeClinicalContent['anamnesis'],surgicalHistory:'unknown',surgeries:[],baselineStateId:null};
}
/** Clear every episode-owned field first: absent historical data must never reveal today's chart. */
export function patientAtReview(patient:Patient,review:EpisodeClinicalReview):Patient {
  return {...patient,...review.content.basics,...review.content.anamnesis,kezelesreErkezesIndoka:review.content.reason,
    kezelesiTervFelso:[],kezelesiTervAlso:[],kezelesiTervArcotErinto:[],kezelesiTervMelleklet:null,
    meglevoFogak:{},meglevoImplantatumok:{},nemIsmertPoziciokbanImplantatum:false,nemIsmertPoziciokbanImplantatumRészletek:null,
    felsoFogpotlasVan:null,felsoFogpotlasMikor:null,felsoFogpotlasKeszito:null,felsoFogpotlasElegedett:null,felsoFogpotlasProblema:null,felsoFogpotlasTipus:null,
    alsoFogpotlasVan:null,alsoFogpotlasMikor:null,alsoFogpotlasKeszito:null,alsoFogpotlasElegedett:null,alsoFogpotlasProblema:null,alsoFogpotlasTipus:null,
  } as Patient;
}
export function clinicalReviewText(review:EpisodeClinicalReview):string{
  const c=review.content;
  return [`Epizód: ${review.episodeId}; adatfelvétel: ${review.effectiveOn}; változat: ${review.version}`,
    `Rögzítette: ${review.recorder}; rögzítve: ${review.recordedAt}; forrás: ${review.source}`,
    `Ellátási ok: ${c.reason}`,...Object.entries(BASIC_LABELS).map(([key,label])=>`${label}: ${c.basics[key as keyof typeof c.basics]||'Nincs adat'}`),
    ...CLINICAL_TEXT_FIELDS.filter(([key])=>c.anamnesis[key]).map(([key,label])=>`${label}: ${c.anamnesis[key]}`),
    ...CLINICAL_BOOLEAN_FIELDS.map(([key,label])=>`${label}: ${c.anamnesis[key]===null?'Nem ismert':c.anamnesis[key]?'Igen':'Nem'}`),
    ...c.surgeries.map(s=>`Műtét: ${s.occurredOn||s.approximateDate||'Időpontja nem ismert'}; ${s.procedure}; indok: ${s.indication||'Nincs adat'}; ${s.institution}; forrás: ${s.source}`),
    ...(c.surgeries.length?[]:[c.surgicalHistory==='none'?'Műtéti előzmény: felülvizsgálva, nem jeleztek.':'Műtéti előzmény: nem ismert.']),review.note].filter(Boolean).join('\n\n');
}
