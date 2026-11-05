import { useState } from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { ProsthesisDesigner,type ProsthesisDraft } from '@/components/prosthesis-lifecycle/ProsthesisDesigner';
import { ClinicalEntryForm } from '@/components/prosthesis-lifecycle/ClinicalEntryForm';
import { emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import { FIXED_TYPES } from '@/lib/prosthesis-types';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';

const baseline={...emptyLayers(),teeth:{14:{base:'sound'},15:{base:'missing'},16:{base:'sound'}},implants:{15:{present:true,description:'Megőrzött implantátumadat'}}};
function setup(occupiedJaws:string[]=[]){
  const changed=vi.fn();
  function Editor(){const [value,setValue]=useState<ProsthesisDraft>({jaw:'',prosthesisType:'',role:'',label:'',positions:[],specification:{custom:'Megőrzött adat'}});return <ProsthesisDesigner value={value} onChange={patch=>setValue(previous=>{const next={...previous,...patch};changed(next);return next;})} background={baseline} backgroundLabel="Dokumentált státusz" conflicted={false} occupiedJaws={occupiedJaws}/>;}
  render(<Editor/>);return changed;
}
const clickTooth=(tooth:number)=>fireEvent.click(screen.getByRole('button',{name:new RegExp(`^${tooth}. fog ·`)}));
afterEach(()=>{cleanup();localStorage.clear();});
describe('Odontogram-first appliance design',()=>{
  it('infers the lower jaw from the first tooth and refuses cross-jaw positions without discarding the draft',()=>{
    const changed=setup();clickTooth(31);expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({jaw:'also',positions:[{tooth:31,role:'denture_tooth'}]}));
    clickTooth(11);expect(screen.getByRole('alert').textContent).toContain('Egy fogpótlás egy állcsonthoz');expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Kijelölés törlése'}));clickTooth(11);expect(changed.mock.lastCall?.[0].jaw).toBe('felso');
  });
  it('records pillars, pontics and implant attachments independently, without rewriting the background',()=>{
    const changed=setup();fireEvent.click(screen.getByRole('button',{name:'Pillér'}));clickTooth(14);clickTooth(16);
    fireEvent.click(screen.getByRole('button',{name:'Hídtest'}));clickTooth(15);
    fireEvent.click(screen.getByRole('button',{name:'Implantátum'}));clickTooth(15);
    expect(changed.mock.lastCall?.[0].positions).toEqual([{tooth:14,role:'abutment'},{tooth:16,role:'abutment'},{tooth:15,role:'pontic'},{tooth:15,role:'implant'}]);
    clickTooth(15);expect(changed.mock.lastCall?.[0].positions).toHaveLength(3);
    expect(baseline.teeth[15]).toEqual({base:'missing'});expect(baseline.implants[15].description).toBe('Megőrzött implantátumadat');expect(baseline.prostheses).toEqual({});
  });
  it('keeps multiple fixed devices available on a jaw that already has a removable appliance',()=>{
    const changed=setup(['felso']);clickTooth(14);fireEvent.click(screen.getByRole('button',{name:'Kivehető / zárólemez'}));
    expect((screen.getByRole('button',{name:'teljes lemezes fogpótlás'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Rögzített'}));fireEvent.click(screen.getByRole('button',{name:FIXED_TYPES[2]}));
    expect(changed.mock.lastCall?.[0]).toMatchObject({jaw:'felso',prosthesisType:'screw_retained_implant_bridge',positions:[{tooth:14,role:'denture_tooth'}],specification:{clinicalType:FIXED_TYPES[2],custom:'Megőrzött adat'}});
  });
  it('saves the detailed type and historical clinical fields under an automatic name after review',async()=>{
    const save=vi.fn().mockResolvedValue(undefined),episodeId=crypto.randomUUID();
    const data={episodes:[{id:episodeId,status:'open'}],prostheses:[],states:[],legacyStates:[],work:[],tasks:[],appointments:[],repairs:[],events:[],documents:[],pathways:[]} as unknown as ClinicalWorkspace;
    render(<ClinicalEntryForm data={data} initial={{action:'register',episodeId,episodeMode:'existing',origin:'local',specification:{custom:'Megőrzött'}}} onSave={save} onCancel={vi.fn()} busy={false}/>);
    clickTooth(14);fireEvent.click(screen.getByRole('button',{name:'Rögzített'}));fireEvent.click(screen.getByRole('button',{name:FIXED_TYPES[1]}));
    fireEvent.click(within(screen.getByRole('group',{name:'Ideiglenes vagy végleges?'})).getByRole('button',{name:'Végleges'}));
    fireEvent.click(screen.getByText('Már meglévő fogpótlás · készítés, elégedettség és panasz'));
    fireEvent.change(screen.getByLabelText('Mikor készült?'),{target:{value:'2023 tavasz'}});fireEvent.change(screen.getByLabelText('Ki / hol készült?'),{target:{value:'Korábbi klinika'}});
    fireEvent.click(within(screen.getByRole('group',{name:'Elégedett vele?'})).getByRole('button',{name:'Nem'}));fireEvent.change(screen.getByLabelText('Mi a baj vele?'),{target:{value:'Lazulás'}});
    fireEvent.click(screen.getByRole('button',{name:'Saját vizsgálat'}));fireEvent.click(screen.getByRole('button',{name:'Adatok ellenőrzése'}));
    expect(screen.getByRole('region',{name:'Mentés előtti összefoglaló'}).textContent).toContain('2023 tavasz');expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Mentés a kartonba'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({jaw:'felso',label:`Felső ${FIXED_TYPES[1]} · 14`,prosthesisType:'fixed',positions:[{tooth:14,role:'denture_tooth'}],specification:{clinicalType:FIXED_TYPES[1],madeWhen:'2023 tavasz',madeBy:'Korábbi klinika',satisfied:false,complaint:'Lazulás',custom:'Megőrzött'}});
    expect(save.mock.calls[0][0].layers).toBeUndefined();
  });
});
