import { useState } from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { ProsthesisDesigner,type ProsthesisDraft } from '@/components/prosthesis-lifecycle/ProsthesisDesigner';
import { ClinicalEntryForm } from '@/components/prosthesis-lifecycle/ClinicalEntryForm';
import { emptyLayers,type Position } from '@/lib/prosthesis-lifecycle/model';
import { FIXED_TYPES } from '@/lib/prosthesis-types';
import { COMPONENT_CONTEXTS,COMPONENT_IDS,PROSTHESIS_COMPONENTS,type ComponentContext } from '@/lib/prosthesis-components';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';

const baseline={...emptyLayers(),teeth:{14:{base:'sound'},15:{base:'missing'},16:{base:'sound'}},implants:{15:{present:true,description:'Megőrzött implantátumadat'}}};
function setup(occupiedJaws:string[]=[],positions:Position[]=[]){
  const changed=vi.fn();
  function Editor(){const [value,setValue]=useState<ProsthesisDraft>({jaw:positions.length?'felso':'',prosthesisType:'',role:'',label:'',positions,specification:{custom:'Megőrzött adat'}});return <ProsthesisDesigner value={value} onChange={patch=>setValue(previous=>{const next={...previous,...patch};changed(next);return next;})} background={baseline} backgroundLabel="Dokumentált státusz" conflicted={false} occupiedJaws={occupiedJaws}/>;}
  render(<Editor/>);return changed;
}
const clickTooth=(tooth:number)=>fireEvent.click(screen.getByRole('button',{name:new RegExp(`^${tooth}. fog ·`)}));
function choose(context:ComponentContext,label:string){
  fireEvent.click(screen.getByRole('button',{name:COMPONENT_CONTEXTS[context]}));
  fireEvent.click(within(screen.getByRole('group',{name:`${COMPONENT_CONTEXTS[context]} választható elemek`})).getByRole('button',{name:label}));
}
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
describe('Odontogram components supplied by the clinician',()=>{
  it('starts with a tooth selection and does not add an unspecified component',()=>{
    const changed=setup();clickTooth(31);expect(changed).not.toHaveBeenCalled();
    choose('position','Műfog');expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({jaw:'also',positions:[{tooth:31,role:'position_denture_tooth'}]}));
    clickTooth(11);choose('position','Műfog');expect(screen.getByRole('alert').textContent).toContain('Egy fogpótlás egy állcsonthoz');expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Összes elem törlése'}));choose('position','Műfog');expect(changed.mock.lastCall?.[0].jaw).toBe('felso');
  });
  it('offers exactly the 18 supplied components in the three separate contexts',()=>{
    setup();clickTooth(14);
    for(const context of Object.keys(COMPONENT_CONTEXTS) as ComponentContext[]){
      fireEvent.click(screen.getByRole('button',{name:COMPONENT_CONTEXTS[context]}));
      const group=within(screen.getByRole('group',{name:`${COMPONENT_CONTEXTS[context]} választható elemek`}));
      const expected=COMPONENT_IDS.filter(id=>PROSTHESIS_COMPONENTS[id].context===context).map(id=>PROSTHESIS_COMPONENTS[id].label);
      expect(group.getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(expected);
    }
    expect(COMPONENT_IDS).toHaveLength(18);
  });
  it('keeps a post/core and crown on the same tooth, and an implant and screwed crown separately',()=>{
    const changed=setup();clickTooth(14);choose('tooth','Gyökércsapos műcsonk');choose('tooth','Szólókorona');
    clickTooth(15);choose('position','Implantátum');choose('implant','Szólókorona csavarozott');
    expect(changed.mock.lastCall?.[0].positions).toEqual([{tooth:14,role:'tooth_post_core'},{tooth:14,role:'tooth_single_crown'},{tooth:15,role:'position_implant'},{tooth:15,role:'implant_single_crown_screwed'}]);
    choose('implant','Szólókorona csavarozott');expect(changed.mock.lastCall?.[0].positions).toHaveLength(3);
    expect(baseline.teeth[15]).toEqual({base:'missing'});expect(baseline.implants[15].description).toBe('Megőrzött implantátumadat');expect(baseline.prostheses).toEqual({});
  });
  it('preserves old general annotations without guessing a new category for them',()=>{
    const changed=setup([],[{tooth:14,role:'abutment'}]);clickTooth(14);choose('tooth','Horgonykorona');
    expect(changed.mock.lastCall?.[0].positions).toEqual([{tooth:14,role:'abutment'},{tooth:14,role:'tooth_anchor_crown'}]);
    expect(screen.getByText(/A korábbi általános jelölések megmaradtak/)).toBeTruthy();
  });
  it('applies an element to selected teeth without duplicates or a 32-position truncation',()=>{
    const changed=setup();fireEvent.click(screen.getByRole('button',{name:'Összes felső foghely'}));
    choose('tooth','Szólókorona');choose('tooth','Gyökércsapos műcsonk');choose('tooth','Primer teleszkóp');
    expect(changed.mock.lastCall?.[0].positions).toHaveLength(48);
    choose('tooth','Primer teleszkóp');expect(changed.mock.lastCall?.[0].positions).toHaveLength(32);
  });
  it('keeps additional fixed appliances available when a jaw already has a removable appliance',()=>{
    const changed=setup(['felso']);clickTooth(14);choose('tooth','Horgonykorona');fireEvent.click(screen.getByRole('button',{name:'Kivehető / zárólemez'}));
    expect((screen.getByRole('button',{name:'teljes lemezes fogpótlás'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Rögzített'}));fireEvent.click(screen.getByRole('button',{name:FIXED_TYPES[0]}));
    expect(changed.mock.lastCall?.[0]).toMatchObject({jaw:'felso',prosthesisType:'fixed',positions:[{tooth:14,role:'tooth_anchor_crown'}],specification:{clinicalType:FIXED_TYPES[0],custom:'Megőrzött adat'}});
  });
  it('edits mobile components in a sheet and keeps them in the draft after closing it',()=>{
    vi.stubGlobal('matchMedia',vi.fn((query:string)=>({matches:query==='(max-width: 767px)',addEventListener:vi.fn(),removeEventListener:vi.fn()})));
    const changed=setup();clickTooth(14);expect(screen.getByRole('dialog',{name:'Foghely elemei'})).toBeTruthy();
    choose('tooth','Szólókorona');fireEvent.click(screen.getByRole('button',{name:'Kész – vissza a fogívhez'}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(changed.mock.lastCall?.[0].positions).toEqual([{tooth:14,role:'tooth_single_crown'}]);
  });
  it('saves the component identities and existing-appliance details after review',async()=>{
    const save=vi.fn().mockResolvedValue(undefined),episodeId=crypto.randomUUID();
    const data={episodes:[{id:episodeId,status:'open'}],prostheses:[],states:[],legacyStates:[],work:[],tasks:[],appointments:[],repairs:[],events:[],documents:[],pathways:[]} as unknown as ClinicalWorkspace;
    render(<ClinicalEntryForm data={data} initial={{action:'register',episodeId,episodeMode:'existing',origin:'local',specification:{custom:'Megőrzött'}}} onSave={save} onCancel={vi.fn()} busy={false}/>);
    clickTooth(14);choose('tooth','Gyökércsapos műcsonk');choose('tooth','Szólókorona');
    fireEvent.click(screen.getByRole('button',{name:'Rögzített'}));fireEvent.click(screen.getByRole('button',{name:FIXED_TYPES[0]}));
    fireEvent.click(within(screen.getByRole('group',{name:'Ideiglenes vagy végleges?'})).getByRole('button',{name:'Végleges'}));
    fireEvent.click(screen.getByText('Már meglévő fogpótlás · készítés, elégedettség és panasz'));
    fireEvent.change(screen.getByLabelText('Mikor készült?'),{target:{value:'2023 tavasz'}});fireEvent.change(screen.getByLabelText('Ki / hol készült?'),{target:{value:'Korábbi klinika'}});
    fireEvent.click(within(screen.getByRole('group',{name:'Elégedett vele?'})).getByRole('button',{name:'Nem'}));fireEvent.change(screen.getByLabelText('Mi a baj vele?'),{target:{value:'Lazulás'}});
    fireEvent.click(screen.getByRole('button',{name:'Saját vizsgálat'}));fireEvent.click(screen.getByRole('button',{name:'Adatok ellenőrzése'}));
    const summary=screen.getByRole('region',{name:'Mentés előtti összefoglaló'});expect(summary.textContent).toContain('Gyökércsapos műcsonk');expect(summary.textContent).toContain('Szólókorona');expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({jaw:'felso',label:`Felső ${FIXED_TYPES[0]} · 14`,prosthesisType:'fixed',positions:[{tooth:14,role:'tooth_post_core'},{tooth:14,role:'tooth_single_crown'}],specification:{clinicalType:FIXED_TYPES[0],madeWhen:'2023 tavasz',madeBy:'Korábbi klinika',satisfied:false,complaint:'Lazulás',custom:'Megőrzött'}});
    expect(save.mock.calls[0][0].layers).toBeUndefined();
  });
});
