import { useState } from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { ToothEditor } from '@/components/patient-form/odontogram/ToothEditor';
import { Odontogram } from '@/components/patient-form/odontogram/Odontogram';
import { DentalAssessmentField } from '@/components/prosthesis-lifecycle/ClinicalChartFields';
import { ProsthesisDesigner,type ProsthesisDraft } from '@/components/prosthesis-lifecycle/ProsthesisDesigner';
import { emptyLayers,type ClinicalLayers } from '@/lib/prosthesis-lifecycle/model';
import { COMPONENT_IDS,COMPONENT_CONTEXTS,PROSTHESIS_COMPONENTS,type ComponentContext } from '@/lib/prosthesis-components';
import type { ToothStatus } from '@/lib/tooth-data';

const choose=(context:ComponentContext,label:string)=>{
  fireEvent.click(screen.getByRole('button',{name:COMPONENT_CONTEXTS[context]}));
  fireEvent.click(within(screen.getByRole('group',{name:`${COMPONENT_CONTEXTS[context]} választható elemek`})).getByRole('button',{name:label}));
};
const data=()=>JSON.parse(screen.getByTestId('state').textContent!);
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});

describe('One prosthetic arsenal for intake, dated findings and appliances',()=>{
  it.each(['intake','dated','appliance'])('offers the same complete catalog in the %s editor',mode=>{
    if(mode==='intake')render(<ToothEditor fdi={14} conditions={{base:'sound',caries:false,periapical:false,mobility:0}} onChange={vi.fn()}/>);
    if(mode==='dated'){render(<DentalAssessmentField layers={emptyLayers()} onChange={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/^14. fog ·/}));}
    if(mode==='appliance'){
      const value:ProsthesisDraft={jaw:'',prosthesisType:'',role:'',label:'',positions:[],specification:{}};
      render(<ProsthesisDesigner value={value} onChange={vi.fn()} background={emptyLayers()} backgroundLabel="Minta" conflicted={false} occupiedJaws={[]}/>);
      fireEvent.click(screen.getByRole('button',{name:/^14. fog ·/}));
    }
    for(const context of Object.keys(COMPONENT_CONTEXTS) as ComponentContext[]){
      fireEvent.click(screen.getByRole('button',{name:COMPONENT_CONTEXTS[context]}));
      expect(within(screen.getByRole('group',{name:`${COMPONENT_CONTEXTS[context]} választható elemek`})).getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(COMPONENT_IDS.filter(id=>PROSTHESIS_COMPONENTS[id].context===context).map(id=>PROSTHESIS_COMPONENTS[id].label));
    }
  });
  it('keeps combined intake parts and every existing examination finding through subsequent surface edits',()=>{
    const original={base:'root_canal' as const,periapical:true,mobility:2,description:'Korábbi szabadszöveg',surfaces:{mesial:'filling' as const}};
    function Intake(){const [fogak,setFogak]=useState<Record<string,ToothStatus>>({'14':original});return <><Odontogram fogak={fogak} setFogak={setFogak} editing isViewOnly={false}/><pre data-testid="state">{JSON.stringify(fogak)}</pre></>;}
    const {container}=render(<Intake/>);
    const title=Array.from(container.querySelectorAll('rect > title')).find(node=>node.textContent==='14 fog')!;fireEvent.click(title.parentElement!);
    choose('tooth','Gyökércsapos műcsonk');choose('tooth','Szólókorona');
    expect(data()['14']).toEqual({...original,components:['tooth_post_core','tooth_single_crown']});
    fireEvent.click(screen.getByLabelText('Szuvas'));
    expect(data()['14']).toMatchObject({...original,caries:true,components:['tooth_post_core','tooth_single_crown']});
    choose('tooth','Szólókorona');expect(data()['14'].components).toEqual(['tooth_post_core']);
  });
  it('records components on an unknown tooth without inventing a healthy native tooth or a registered appliance',()=>{
    function Findings(){const [layers,setLayers]=useState(emptyLayers());return <><DentalAssessmentField layers={layers} onChange={setLayers}/><pre data-testid="state">{JSON.stringify(layers)}</pre></>;}
    render(<Findings/>);fireEvent.click(screen.getByRole('button',{name:/^14. fog ·/}));
    choose('tooth','Gyökércsapos műcsonk');choose('tooth','Szólókorona');
    expect(data().teeth).toEqual({});expect(data().implants).toEqual({});
    expect(Object.values(data().prostheses)).toEqual([{tooth:14,role:'tooth_post_core',observed:true},{tooth:14,role:'tooth_single_crown',observed:true}]);
    choose('tooth','Szólókorona');expect(Object.values(data().prostheses)).toEqual([{tooth:14,role:'tooth_post_core',observed:true}]);
  });
  it('preserves all tooth findings and implant free text when base or implant presence is edited',()=>{
    const original:ClinicalLayers={...emptyLayers(),teeth:{14:{base:'root_canal',periapical:true,mobility:2,description:'Lelet',surfaces:{mesial:'filling'}}},implants:{14:{present:true,description:'REF: régi LOT: megőrzött'}}};
    function Findings(){const [layers,setLayers]=useState(original);return <><DentalAssessmentField layers={layers} onChange={setLayers}/><pre data-testid="state">{JSON.stringify(layers)}</pre></>;}
    render(<Findings/>);fireEvent.click(screen.getByRole('button',{name:/^14. fog ·/}));
    fireEvent.change(screen.getByLabelText('14. saját fog'),{target:{value:'filled'}});
    expect(data().teeth['14']).toEqual({...original.teeth['14'] as object,base:'filled'});
    choose('implant','Locator fej');choose('position','Implantátum');
    expect(data().implants['14']).toEqual({present:false,description:'REF: régi LOT: megőrzött'});
    fireEvent.change(screen.getByLabelText('14. implantátum'),{target:{value:'yes'}});
    expect(data().implants['14']).toEqual(original.implants['14']);expect(Object.values(data().prostheses)).toContainEqual({tooth:14,role:'implant_locator_head',observed:true});
    fireEvent.change(screen.getByLabelText('14. implantátum'),{target:{value:''}});
    expect(data().implants['14']).toEqual({description:'REF: régi LOT: megőrzött'});
    expect(screen.getByRole('button',{name:/^14. fog · Saját fog: Tömött; implantátum: nem ismert/})).toBeTruthy();
  });
  it('does not erase prosthetic elements or free text when marking a whole native arch missing',()=>{
    function Intake(){const [fogak,setFogak]=useState<Record<string,ToothStatus>>({14:{base:'root_canal',components:['tooth_post_core','tooth_single_crown'],description:'Megőrzött lelet'}});return <><Odontogram fogak={fogak} setFogak={setFogak} editing isViewOnly={false}/><pre data-testid="state">{JSON.stringify(fogak)}</pre></>;}
    render(<Intake/>);fireEvent.click(screen.getByRole('button',{name:'Felső teljes fogatlanság'}));
    expect(data()['14']).toEqual({base:'missing',components:['tooth_post_core','tooth_single_crown'],description:'Megőrzött lelet'});
  });
  it('uses the same picker in the mobile dated-examination sheet and preserves edits on close',()=>{
    vi.stubGlobal('matchMedia',vi.fn((query:string)=>({matches:query==='(max-width: 767px)',addEventListener:vi.fn(),removeEventListener:vi.fn()})));
    function Findings(){const [layers,setLayers]=useState(emptyLayers());return <><DentalAssessmentField layers={layers} onChange={setLayers}/><pre data-testid="state">{JSON.stringify(layers)}</pre></>;}
    render(<Findings/>);fireEvent.click(screen.getByRole('button',{name:/^16. fog ·/}));expect(screen.getByRole('dialog',{name:'Vizsgált foghely'})).toBeTruthy();
    choose('position','Implantátum');choose('implant','Szólókorona csavarozott');fireEvent.click(screen.getByRole('button',{name:'Kész – vissza a fogívhez'}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(data().teeth).toEqual({});expect(data().implants['16']).toEqual({present:true});expect(Object.values(data().prostheses)).toHaveLength(2);
  });
});
