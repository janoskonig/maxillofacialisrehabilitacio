import { describe,expect,it } from 'vitest';
import { COMPONENT_IDS,positionLabel } from '@/lib/prosthesis-components';
import { normalizeToothData } from '@/lib/tooth-data';
import { patientSchema } from '@/lib/types';
import { readConditions,writeConditions,patchToothConditions,computeDMFT } from '@/components/patient-form/odontogram/tooth-conditions';
import { clinicalTemplate,dentalLayers,clinicalReviewText,type EpisodeClinicalReview } from '@/lib/episode-clinical/model';
import { observedComponents,setObservedComponents,teethWithObservedComponents } from '@/lib/prosthesis-findings';
import { emptyLayers,projectClinicalPlan } from '@/lib/prosthesis-lifecycle/model';
import { buildDentalExportContent } from '@/lib/neak-dental-content';
import { describeClinicalValue } from '@/lib/prosthesis-lifecycle/pdf';
import { applyTreatmentOutcome } from '@/lib/tooth-treatment-outcome';

describe('Detailed prostheses survive all status boundaries',()=>{
  it.each(COMPONENT_IDS)('round-trips %s through patient validation and the odontogram serializer',role=>{
    const finding={base:'root_canal' as const,caries:true,periapical:true,mobility:2,description:'Korábbi megjegyzés',surfaces:{mesial:'filling' as const},components:[role]};
    const dental=patientSchema.pick({meglevoFogak:true}).parse({meglevoFogak:{14:finding}});
    expect(dental.meglevoFogak?.['14']).toEqual(finding);expect(writeConditions(readConditions(finding))).toEqual(finding);
    expect(normalizeToothData({components:[role]})).toEqual({components:[role]});
  });
  it('rejects duplicate and unknown components instead of silently discarding them',()=>{
    const schema=patientSchema.pick({meglevoFogak:true});
    expect(schema.safeParse({meglevoFogak:{14:{components:['tooth_single_crown','tooth_single_crown']}}}).success).toBe(false);
    expect(schema.safeParse({meglevoFogak:{14:{components:['unknown_crown']}}}).success).toBe(false);
  });
  it('does not infer a healthy base and preserves legacy free text during component-only edits',()=>{
    expect(patchToothConditions(undefined,{components:['position_implant','implant_locator_head']})).toEqual({components:['position_implant','implant_locator_head']});
    expect(patchToothConditions('Régi szabad szöveg',{components:['tooth_post_core']})).toEqual({description:'Régi szabad szöveg',components:['tooth_post_core']});
    expect(patchToothConditions({status:'M',description:'Megőrzött'},{components:['position_denture_tooth']})).toEqual({status:'M',description:'Megőrzött',components:['position_denture_tooth']});
    expect(patchToothConditions({base:'crown',components:['tooth_post_core']},{components:[]})).toEqual({base:'crown'});
    expect(patchToothConditions({components:['implant_locator_head']},{periapical:true})).toEqual({components:['implant_locator_head'],periapical:true});
  });
  it('carries exact findings through episode review, separate layers and chart/text export',()=>{
    const finding={base:'missing' as const,description:'A hiány oka nincs megadva',components:['position_implant' as const,'implant_single_crown_screwed' as const]};
    const content=clinicalTemplate({meglevoFogak:{16:finding},meglevoImplantatumok:{16:'REF: megőrzött LOT: eredeti'}},'traumás sérülés');
    const layers=dentalLayers(content.dental!);expect(layers.teeth['16']).toEqual(finding);expect(layers.implants['16']).toEqual({present:true,description:'REF: megőrzött LOT: eredeti'});
    expect(observedComponents(layers,16)).toEqual(finding.components);
    const exported=buildDentalExportContent({meglevoFogak:teethWithObservedComponents(layers)}).rows.find(row=>row.number===16)!;
    expect(exported.detail).toContain('Implantátumra · Szólókorona csavarozott');expect(exported.detail).toContain('Hiányzó');
    expect(computeDMFT({16:finding})).toEqual({d:0,m:1,f:0,dmft:1});
    const review={episodeId:'episode',effectiveOn:'2026-01-01',version:1,recorder:'Orvos',recordedAt:'2026-01-01',source:'Vizsgálat',content,note:''} as EpisodeClinicalReview;
    expect(clinicalReviewText(review)).toContain('Implantátumra · Szólókorona csavarozott');expect(describeClinicalValue(finding)).toContain('Implantátumra · Szólókorona csavarozott');
  });
  it('exports every standalone examination component even when there is no registered appliance',()=>{
    let layers=emptyLayers();for(let i=0;i<COMPONENT_IDS.length;i++)layers=setObservedComponents(layers,14,COMPONENT_IDS.slice(0,i+1));
    expect(layers.teeth).toEqual({});const teeth=teethWithObservedComponents(layers);expect((teeth[14] as any).components).toEqual(COMPONENT_IDS);expect((teeth[14] as any).base).toBeUndefined();
    const detail=buildDentalExportContent({meglevoFogak:teeth}).rows.find(row=>row.number===14)!.detail;
    for(const role of COMPONENT_IDS)expect(detail).toContain(positionLabel(role,true));
  });
  it('retains prosthetic components through unrelated treatment and plan projection',()=>{
    const components=['tooth_post_core' as const,'tooth_single_crown' as const],finding={base:'root_canal',components,description:'Megőrzött'};
    expect(applyTreatmentOutcome(finding,'tomes').next).toMatchObject({components,description:'Megőrzött'});
    expect(applyTreatmentOutcome({components},'csiszolas').next).toEqual({components});
    const baseline={...emptyLayers(),teeth:{14:finding}},projected=projectClinicalPlan(baseline,[],[]);
    expect(projected.prostheses['finding:14:tooth_post_core']).toMatchObject({tooth:14,role:'tooth_post_core'});
    expect(projected.prostheses['finding:14:tooth_single_crown']).toMatchObject({tooth:14,role:'tooth_single_crown'});expect(baseline.prostheses).toEqual({});
  });
  it('keeps restoration counts consistent with the old crown/inlay markers and never counts an implant crown as a natural filling',()=>{
    expect(computeDMFT({14:{base:'sound',components:['tooth_post_core','tooth_single_crown']},16:{base:'missing',components:['position_implant','implant_single_crown_screwed']}})).toEqual({d:0,m:1,f:1,dmft:2});
    expect(computeDMFT({14:{base:'crown'},16:{base:'missing'}})).toEqual({d:0,m:1,f:1,dmft:2});
  });
});
