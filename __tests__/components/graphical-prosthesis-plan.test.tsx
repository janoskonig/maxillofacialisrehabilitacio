import { afterEach,describe,expect,it,vi } from 'vitest';
import { useState } from 'react';
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { ClinicalArch } from '@/components/prosthesis-lifecycle/ClinicalArch';
import { EpisodePlanVisual } from '@/components/prosthesis-lifecycle/EpisodePlanVisual';
import { ProsthesisOverview } from '@/components/prosthesis-lifecycle/ProsthesisOverview';
import { StatusComparison } from '@/components/prosthesis-lifecycle/StatusComparison';
import { emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import type { EpisodeTreatmentPlanRecord } from '@/lib/episode-treatment-plan';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
afterEach(cleanup);

describe('graphical prosthesis planning',()=>{
  it('keeps unknown teeth unknown and shows a missing natural tooth alongside implant and prosthesis layers',()=>{
    const layers={...emptyLayers(),teeth:{11:{base:'missing'},13:{status:'M'},14:{},15:'Korabeli leírás'},implants:{11:{present:true}},prostheses:{a:{tooth:11,role:'denture_tooth',prosthesisId:'p'}}};
    render(<ClinicalArch jaw="felso" layers={layers} label="Vizsgálati státusz"/>);
    expect(screen.getByRole('img',{name:/^11. fog · Saját fog: Hiányzó; implantátum: jelen; fogpótlás: Műfog/})).toBeTruthy();
    expect(screen.getByRole('img',{name:/^12. fog · Saját fog: Ismeretlen/}).querySelector('svg text')?.textContent).toBe('?');
    expect(screen.getByRole('img',{name:/^13. fog · Saját fog: Hiányzó/})).toBeTruthy();
    expect(screen.getByRole('img',{name:/^14. fog/}).querySelector('svg text')?.textContent).toBe('?');
    expect(screen.getByRole('img',{name:/^15. fog/}).querySelector('svg text')?.textContent).toBe('?');
  });
  it('adds selected teeth once, preserves treatment order and previews the plan without changing the baseline',()=>{
    const baseline={...emptyLayers(),teeth:{11:{base:'missing'},12:{base:'sound'},13:{base:'sound'}}};
    const plan:EpisodeTreatmentPlanRecord={episodeId:'ep',version:0,treatmentPlan:null,treatmentPlanUpper:null,treatmentPlanLower:null,jaw:'felso',device:{id:'p',positions:[{tooth:11,role:'denture_tooth'}]},states:[{id:'b',occurred_on:'2026-01-01',layers:baseline}]};
    const changed=vi.fn();
    function Editor(){const [treatments,setTreatments]=useState<Array<{toothNumber:number;treatmentCode:string}>>([]);return <EpisodePlanVisual plan={plan} baselineStateId="b" treatments={treatments} onChange={t=>{changed(t);setTreatments(t);}}/>;}
    render(<Editor/>);
    fireEvent.click(screen.getByRole('button',{name:/^12. fog/}));fireEvent.click(screen.getByRole('button',{name:/^13. fog/}));
    fireEvent.click(screen.getByRole('button',{name:'Hozzáadás a tervhez · 2 fog'}));
    expect(changed).toHaveBeenLastCalledWith([{toothNumber:12,treatmentCode:'huzas'},{toothNumber:13,treatmentCode:'huzas'}]);
    fireEvent.click(screen.getByRole('button',{name:/^12. fog/}));fireEvent.click(screen.getByRole('button',{name:'Hozzáadás a tervhez · 1 fog'}));
    expect(changed.mock.lastCall?.[0]).toHaveLength(2);
    fireEvent.click(screen.getByRole('button',{name:'1. beavatkozás hátrébb'}));
    expect(changed.mock.lastCall?.[0].map((t:{toothNumber:number})=>t.toothNumber)).toEqual([13,12]);
    fireEvent.click(screen.getByRole('button',{name:'Célállapot előnézete'}));
    expect(screen.getByRole('img',{name:/^12. fog · Saját fog: Hiányzó/})).toBeTruthy();
    expect(baseline.teeth[12]).toEqual({base:'sound'});
  });
  it('compares the selected tooth on both sides and switches between planned and actual states',()=>{
    const before={...emptyLayers(),teeth:{12:{base:'sound'}}},target={...emptyLayers(),teeth:{12:{base:'missing'}}};
    const data={plans:[{id:'plan',version:1,content:{description:'Terv',baseline:before,target},approved:true}],actual:before,milestones:[],states:[{id:'s'}],events:[]} as unknown as ClinicalWorkspace;
    render(<StatusComparison data={data}/>);
    fireEvent.click(screen.getByRole('button',{name:'Terv ↔ megvalósult'}));
    fireEvent.click(screen.getAllByRole('button',{name:/^12. fog/})[0]);
    expect(screen.getByRole('status').textContent).toContain('Saját fog: Hiányzó');
    expect(screen.getByRole('status').textContent).toContain('Saját fog: Ép');
  });
  it('does not invent an undocumented laboratory milestone from an accepted or delivered prosthesis',()=>{
    const data={prostheses:[{id:'p',label:'Felső',jaw:'felso',role:'definitive',positions:[]}],episodes:[],events:[{active:true,kind:'accepted',prosthesis_id:'p',occurred_on:'2026-01-10'},{active:true,kind:'delivered',prosthesis_id:'p',occurred_on:'2026-01-11'}]} as unknown as ClinicalWorkspace;
    const {rerender}=render(<ProsthesisOverview data={data} patientId="patient" onAction={vi.fn()}/>);
    const steps=within(screen.getByRole('list',{name:'Felső mérföldkövei'})).getAllByRole('listitem');
    expect(steps[0].textContent).toContain('Nincs rögzítve');expect(steps[1].textContent).toContain('2026-01-10');
    expect(steps[3].textContent).toContain('Nincs rögzítve');
    const historical={...data,legacyEncounters:[{phase:'aftercare',occurred_on:'2026-02-01',links:[{prosthesisId:'p'}]}]} as unknown as ClinicalWorkspace;
    rerender(<ProsthesisOverview data={historical} patientId="patient" onAction={vi.fn()}/>);
    expect(within(screen.getByRole('list',{name:'Felső mérföldkövei'})).getAllByRole('listitem')[3].textContent).toContain('2026-02-01');
  });
});
