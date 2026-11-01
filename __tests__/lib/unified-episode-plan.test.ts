// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { episodePlanFromRow } from '@/lib/prosthesis-lifecycle/plans';

describe('reading the shared episode plan',()=>{
  const row={episodeId:'ep',patientId:'patient',version:4,jaw:'felso',prosthesisId:'p',treatmentPlan:'Korábbi közös',treatmentPlanUpper:'Régi felső',treatmentPlanLower:'Régi alsó',planId:'version4',clinicalVersion:4,approved:true,baselineStateId:'baseline',occurredOn:'2026-01-01',source:'Karton'};
  it('honours explicit clears in the immutable version instead of falling back to stale mirrors',()=>{
    expect(episodePlanFromRow({...row,episodePlanVersion:4,content:{narratives:{treatmentPlan:null,treatmentPlanUpper:null,treatmentPlanLower:null},description:'',treatments:[]}})).toMatchObject({unified:true,treatmentPlan:null,treatmentPlanUpper:null,treatmentPlanLower:null,legacyClinicalDescription:null});
  });
  it('keeps both old descriptions visible for review instead of silently discarding a conflicting legacy plan',()=>{
    expect(episodePlanFromRow({...row,episodePlanVersion:null,content:{description:'Korábbi külön klinikai terv',treatments:[]}})).toMatchObject({unified:false,treatmentPlanUpper:'Régi felső',treatmentPlanLower:'Régi alsó',legacyClinicalDescription:'Korábbi külön klinikai terv'});
  });
  it('shows an unambiguous old clinical description in the own-jaw editor without inventing another jaw',()=>{
    expect(episodePlanFromRow({...row,treatmentPlanUpper:null,episodePlanVersion:null,content:{description:'Korábbi felső klinikai terv',treatments:[]}})).toMatchObject({jaw:'felso',treatmentPlanUpper:'Korábbi felső klinikai terv',treatmentPlanLower:'Régi alsó',legacyClinicalDescription:null});
  });
});
