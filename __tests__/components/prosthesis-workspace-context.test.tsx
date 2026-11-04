import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { ProsthesisLifecycle } from '@/components/prosthesis-lifecycle/ProsthesisLifecycle';

const mocks=vi.hoisted(()=>({confirm:vi.fn(),initial:vi.fn()}));
vi.mock('@/contexts/ToastContext',()=>({useToast:()=>({confirm:mocks.confirm})}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
vi.mock('@/components/prosthesis-lifecycle/ProsthesisOverview',()=>({ProsthesisOverview:({data}:any)=><section aria-label="Készülékek">{data.prostheses.map((p:any)=><p key={p.id}>{p.label}</p>)}</section>}));
vi.mock('@/components/prosthesis-lifecycle/ClinicalEntryForm',()=>({ACTION_LABELS:{milestone:'Mérföldkő',set_goal:'Cél',work:'Munka',remake:'Újrakészítés'},ClinicalEntryForm:({initial,onDirtyChange,onCancel}:any)=>{mocks.initial(initial);return <div><button onClick={()=>onDirtyChange(true)}>Piszkozat módosítása</button><button onClick={onCancel}>Piszkozat bezárása</button></div>;}}));
const workspace={patientName:'Minta beteg',episodes:[{id:'construction',status:'open'},{id:'repair',status:'closed'},{id:'other',status:'open'}],
  prostheses:[{id:'one',episode_id:'construction',label:'Kiválasztott készülék'},{id:'two',episode_id:'other',label:'Más epizód készüléke'}],
  episodeLinks:[{episode_id:'repair',prosthesis_id:'one'}],events:[],conflicts:[],closureReview:[],legacyEncounters:[],states:[],plans:[],tasks:[],repairs:[],packages:[],documents:[],work:[]};
function setup(episodeId='construction',onStateChange=vi.fn()){
  mocks.confirm.mockResolvedValue(true);vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(workspace),{status:200})));
  render(<ProsthesisLifecycle patientId="patient" selectedEpisodeId={episodeId} embedded onStateChange={onStateChange}/>);return onStateChange;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();localStorage.clear();});
describe('Integrated prosthesis workspace context',()=>{
  it('shows the selected episode appliances and explicitly reveals other episodes',async()=>{
    setup();await screen.findByText('Kiválasztott készülék');expect(screen.queryByText('Más epizód készüléke')).toBeNull();
    fireEvent.click(screen.getByLabelText('Más epizódok fogpótlásainak megjelenítése is'));
    expect(screen.getByText('Más epizód készüléke')).toBeTruthy();
  });
  it('keeps a linked appliance visible in its repair episode',async()=>{
    setup('repair');await screen.findByText('Kiválasztott készülék');expect(screen.queryByText('Más epizód készüléke')).toBeNull();
  });
  it('registers into the selected open episode and reports unsaved edits to the shared workspace',async()=>{
    const onStateChange=setup();await screen.findByText('Kiválasztott készülék');
    fireEvent.click(screen.getByRole('button',{name:'Fogpótlás felvétele'}));
    await screen.findByRole('button',{name:'Piszkozat módosítása'});
    expect(mocks.initial).toHaveBeenLastCalledWith({action:'register',episodeId:'construction',episodeMode:'existing',origin:'local'});
    fireEvent.click(screen.getByRole('button',{name:'Piszkozat módosítása'}));
    await waitFor(()=>expect(onStateChange).toHaveBeenLastCalledWith({dirty:true,saving:false}));
    mocks.confirm.mockResolvedValue(false);fireEvent.click(screen.getByRole('button',{name:'Piszkozat bezárása'}));
    await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledOnce());expect(screen.getByRole('button',{name:'Piszkozat módosítása'})).toBeTruthy();
  });
});
