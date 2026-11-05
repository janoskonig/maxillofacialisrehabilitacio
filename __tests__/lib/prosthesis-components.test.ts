import { describe,expect,it } from 'vitest';
import { COMPONENT_IDS,COMPONENT_CONTEXTS,PROSTHESIS_COMPONENTS,LEGACY_POSITION_LABELS,positionLabel } from '@/lib/prosthesis-components';
import { positionsSchema,emptyLayers,projectClinicalPlan } from '@/lib/prosthesis-lifecycle/model';
import { describeClinicalValue } from '@/lib/prosthesis-lifecycle/pdf';

describe('Clinician-supplied prosthetic component catalog',()=>{
  it('has the exact three contexts and 14 / 3 / 8 entries',()=>{
    expect(Object.values(COMPONENT_CONTEXTS)).toEqual(['Fogakra','Fogak helyére','Implantátumra']);
    expect(['tooth','position','implant'].map(context=>COMPONENT_IDS.filter(id=>PROSTHESIS_COMPONENTS[id].context===context).length)).toEqual([14,3,8]);
    expect(COMPONENT_IDS.map(id=>PROSTHESIS_COMPONENTS[id].label)).toEqual(['Szólókorona','Horgonykorona','Inlay/onlay (betét)','Hézagfog (pontic)','Kapocstartó korona','Gyökércsapos műcsonk','Gyökércsapos műcsonk gömbretenciós felépítménnyel','Primer teleszkóp','Héj','Overlay / részleges korona','Endokorona','Szekunder teleszkóp','Kapocs','Rejtett elhorgonyzási eszköz','Műfog','Implantátum','Stégtest','Szólókorona cementezett','Szólókorona csavarozott','Horgonykorona cementezett','Horgonykorona csavarozott','Hézagfog','Gömbretenciós fej','Locator fej','Stéghorgony']);
  });
  it.each(COMPONENT_IDS)('preserves the exact identity of %s through command validation',role=>{
    expect(positionsSchema.parse([{tooth:14,role}])).toEqual([{tooth:14,role}]);
  });
  it('keeps old generic roles readable without assigning a new subtype',()=>{
    for(const [role,label] of Object.entries(LEGACY_POSITION_LABELS)){
      expect(positionsSchema.parse([{tooth:14,role}])[0].role).toBe(role);
      expect(positionLabel(role,true)).toBe(`${label} · általános jelölés`);
    }
  });
  it('preserves two pontic contexts and multiple distinct parts on one site but rejects duplicates',()=>{
    const positions=[{tooth:14,role:'tooth_pontic'},{tooth:14,role:'implant_pontic'},{tooth:14,role:'tooth_post_core'},{tooth:14,role:'tooth_single_crown'}];
    expect(positionsSchema.parse(positions)).toEqual(positions);
    expect(positionsSchema.safeParse([...positions,positions[0]]).success).toBe(false);
    expect(positionsSchema.safeParse([{tooth:19,role:'tooth_single_crown'}]).success).toBe(false);
    expect(positionsSchema.safeParse([{tooth:14,role:'guessed_other'}]).success).toBe(false);
  });
  it('projects all elements into plan snapshots without changing natural tooth or implant findings',()=>{
    const baseline={...emptyLayers(),teeth:{14:{base:'sound'},16:{base:'missing'}},implants:{16:{present:false}}};
    const positions=positionsSchema.parse([{tooth:14,role:'tooth_post_core'},{tooth:14,role:'tooth_single_crown'},{tooth:16,role:'position_implant'},{tooth:16,role:'implant_locator_head'}]);
    const projected=projectClinicalPlan(baseline,[],[{id:'device',jaw:'felso',positions}]);
    expect(Object.keys(projected.prostheses)).toHaveLength(4);
    for(const position of positions)expect(projected.prostheses[`device:${position.tooth}:${position.role}`]).toMatchObject({...position,planned:true});
    expect(projected.teeth).toEqual(baseline.teeth);expect(projected.implants).toEqual(baseline.implants);expect(baseline.prostheses).toEqual({});
  });
  it('prints professional element names and contexts in exports, including legacy provenance',()=>{
    expect(describeClinicalValue({tooth:14,role:'implant_locator_head'})).toContain('Implantátumra · Locator fej');
    expect(describeClinicalValue({role:'tooth_post_core_ball'})).toContain('Gyökércsapos műcsonk gömbretenciós felépítménnyel');
    expect(describeClinicalValue({role:'abutment'})).toContain('általános jelölés');
  });
});
