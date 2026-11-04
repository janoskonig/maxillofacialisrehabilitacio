import { describe, expect, it } from 'vitest';
import { clinicalTemplate, clinicalContentSchema, patientAtReview, dentalLayers, clinicalReviewText, type EpisodeClinicalReview } from '@/lib/episode-clinical/model';
import type { Patient } from '@/lib/types';
const legacy:Partial<Patient>={bno:'K0000',diagnozis:'Foghiány',meglevoFogak:{'11':{},'12':{status:'M'}},
  meglevoImplantatumok:{'12':'Straumann BLX\nREF: 061.4310 LOT: LPZP9','35':''},
  nemIsmertPoziciokbanImplantatumRészletek:'További implantátumok, ismeretlen pozícióban',
  felsoFogpotlasVan:true,felsoFogpotlasTipus:'teljes lemezes fogpótlás'};
function review(content=clinicalTemplate(legacy,'veleszületett rendellenesség')):EpisodeClinicalReview {
 return {id:'review',patientId:'patient',episodeId:'episode',version:1,effectiveOn:'2026-01-01',source:'Vizsgálati lap',note:'',sourceReviewId:null,recordedAt:'2026-11-04T09:00:00Z',recordedBy:'user',recorder:'Orvos',content};
}
describe('Legacy dental data in episode reviews',()=>{
 it('carries all dental fields into the review template and schema without dropping blank implants or free text',()=>{
  const content=clinicalContentSchema.parse(clinicalTemplate(legacy,'veleszületett rendellenesség'));
  expect(content.dental?.meglevoImplantatumok).toEqual(legacy.meglevoImplantatumok);
  expect(content.dental?.meglevoFogak).toEqual(legacy.meglevoFogak);
  expect(content.dental?.nemIsmertPoziciokbanImplantatumRészletek).toBe(legacy.nemIsmertPoziciokbanImplantatumRészletek);
  expect(content.dental?.felsoFogpotlasVan).toBe(true);
 });
 it('freezes the reviewed values independently of later shared-chart changes',()=>{
  const record=review();legacy.meglevoImplantatumok!['12']='Changed shared chart';
  const exported=patientAtReview({...legacy,meglevoImplantatumok:{'44':'New implant'}} as Patient,record);
  expect(exported.meglevoImplantatumok).toEqual({'12':'Straumann BLX\nREF: 061.4310 LOT: LPZP9','35':''});
  expect(exported.meglevoFogak?.['11']).toEqual({});
  legacy.meglevoImplantatumok!['12']='Straumann BLX\nREF: 061.4310 LOT: LPZP9';
 });
 it('never fills an older review without a dental snapshot from today’s patient record',()=>{
  const {dental,...historical}=clinicalTemplate(legacy,'traumás sérülés');
  const parsed=clinicalContentSchema.parse(historical);
  expect(parsed.dental).toBeUndefined();
  const exported=patientAtReview(legacy as Patient,review(parsed));
  expect(exported.meglevoImplantatumok).toEqual({});expect(exported.meglevoFogak).toEqual({});
 });
 it('keeps native tooth loss and implants separate without declaring unspecified teeth healthy',()=>{
  const layers=dentalLayers(clinicalTemplate(legacy,'traumás sérülés').dental!);
  expect(layers.teeth['11']).toEqual({});expect(layers.teeth['12']).toEqual({status:'M'});
  expect(layers.implants['12']).toEqual({present:true,description:legacy.meglevoImplantatumok!['12']});
  expect(layers.implants['35']).toEqual({present:true,description:''});expect(layers.teeth['13']).toBeUndefined();
 });
 it('includes the saved REF/LOT and unpositioned notes in the preserved clinical text',()=>{
  const text=clinicalReviewText(review());expect(text).toContain('REF: 061.4310 LOT: LPZP9');
  expect(text).toContain('További implantátumok, ismeretlen pozícióban');
 });
});
