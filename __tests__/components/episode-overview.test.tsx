import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { PatientEpisodeWorkspace } from '@/components/episode-overview/PatientEpisodeWorkspace';
const mocks=vi.hoisted(()=>({router:{push:vi.fn()},confirm:vi.fn(),registered:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>mocks.router}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>({role:'admin'})}));
vi.mock('@/contexts/ToastContext',()=>({useToast:()=>({confirm:mocks.confirm,showToast:vi.fn()})}));
vi.mock('@/components/PatientHeaderBar',()=>({PatientHeaderBar:()=>null}));
vi.mock('@/components/EpisodeProviderControl',()=>({EpisodeProviderControl:({assignedProviderName}:any)=><p>{assignedProviderName}</p>}));
vi.mock('@/components/EpisodePathwayEditor',()=>({EpisodePathwayEditor:()=>null}));
vi.mock('@/components/PatientEpisodeForm',()=>({PatientEpisodeForm:()=>null}));
vi.mock('@/components/episode-overview/EpisodeClinicalReviewPanel',()=>({EpisodeClinicalReviewPanel:()=>null}));
vi.mock('@/components/OHIP14Section',()=>({OHIP14Section:()=>null}));
vi.mock('@/components/EpisodeTreatmentPlanEditor',()=>({EpisodeTreatmentPlanEditor:({episodeId,unified}:any)=><section data-testid="plan-editor">{episodeId}:{String(unified)}</section>}));
vi.mock('@/components/prosthesis-lifecycle/ClinicalEntryForm',()=>({ClinicalEntryForm:({initial}:any)=>{mocks.registered(initial);return <p>Fogpótlás rögzítése az epizódhoz</p>;}}));
const patientId=crypto.randomUUID(),upper=crypto.randomUUID(),lower=crypto.randomUUID(),device=crypto.randomUUID(),planId=crypto.randomUUID();
const episodes=[{id:upper,patientId,status:'open',caseTitle:'Felső végleges',chiefComplaint:'Felső foghiány rehabilitációja',reason:'traumás sérülés',openedAt:'2026-09-01T10:00:00Z',assignedProviderName:'Dr. Felelős'},
  {id:lower,patientId,status:'closed',caseTitle:'Alsó javítás',chiefComplaint:'Alsó lemez törése',reason:'traumás sérülés',openedAt:'2026-08-01T10:00:00Z'}];
const clinical={episodes:episodes.map(e=>({id:e.id})),prostheses:[{id:device,episode_id:upper,jaw:'felso',role:'definitive',origin:'local',label:'Felső lemezes készülék',prosthesis_type:'removable'}],episodeLinks:[{episode_id:upper,prosthesis_id:device}],repairs:[],states:[],
  episodePlans:[{episodeId:upper,jaw:'felso',treatmentPlanUpper:'Felső fogpótlás elkészítése',treatmentPlanLower:'Másik állcsont megőrzött régi szövege',clinicalPlan:{id:planId,version:2,approved:true}}],
  financingEvents:[{id:crypto.randomUUID(),episode_id:upper,plan_version_id:planId,active:true,version:1,effective_on:'2026-09-01',occurred_on:'2026-09-01',mode:'equity',status:'approved',patient_amount:'20000.00',currency:'HUF'}]};
function setup(initialEpisodeId?:string,empty=false,workspace:any=clinical){
  mocks.confirm.mockResolvedValue(true);
  const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/prosthesis-lifecycle')?(empty?{...workspace,prostheses:[],episodeLinks:[]}:workspace):url.endsWith('/episodes')?{episodes}:{patient:{id:patientId,nev:'Beteg',kezelesreErkezesIndoka:'traumás sérülés'}}),{status:200}));
  vi.stubGlobal('fetch',fetch);render(<PatientEpisodeWorkspace patientId={patientId} initialEpisodeId={initialEpisodeId}/>);return fetch;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();window.localStorage.clear();window.history.replaceState(null,'','/');});
describe('Episode overview',()=>{
  it('shows the reason, appliance, clinical plan, funding and responsible doctor together without opening an editor',async()=>{
    setup(upper);await screen.findByRole('region',{name:'Az epizód áttekintése'});
    expect(screen.getByText('Felső foghiány rehabilitációja')).toBeTruthy();expect(screen.getByText('Felső lemezes készülék')).toBeTruthy();
    expect(screen.getByText('Felső fogpótlás elkészítése')).toBeTruthy();expect(screen.queryByText('Másik állcsont megőrzött régi szövege')).toBeNull();
    expect(screen.getByText('Dr. Felelős')).toBeTruthy();expect(within(screen.getByRole('region',{name:'Az epizód finanszírozásának összefoglalója'})).getByText(/Egyedi méltányosság/)).toBeTruthy();
    expect(screen.queryByTestId('plan-editor')).toBeNull();expect(screen.getByRole('link',{name:'Kezelés megnyitása'}).getAttribute('href')).toBe(`/patients/${patientId}/stages?episodeId=${upper}`);
    expect(within(screen.getByRole('navigation',{name:'Betegkarton fülök'})).getByRole('link',{name:/^Kezelés/}).getAttribute('href')).toContain(`episodeId=${upper}`);
  });
  it('keeps an explicitly chosen closed episode in context and does not silently substitute another episode',async()=>{
    setup(lower);await screen.findByText('Alsó lemez törése');expect(screen.queryByText('Felső fogpótlás elkészítése')).toBeNull();
    expect((screen.getByLabelText('Epizód kiválasztása') as HTMLSelectElement).value).toBe(lower);
    expect(screen.getByRole('link',{name:'Kezelés megnyitása'}).getAttribute('href')).toContain(lower);
  });
  it('preserves unsaved context edits while rejecting episode and tab navigation',async()=>{
    setup(upper);await screen.findByText('Felső foghiány rehabilitációja');
    fireEvent.click(screen.getByRole('button',{name:'Epizód, terv és finanszírozás szerkesztése'}));
    fireEvent.change(screen.getByLabelText('Miért indult ez az epizód?'),{target:{value:'Saját még nem mentett indok'}});mocks.confirm.mockResolvedValue(false);
    fireEvent.change(screen.getByLabelText('Epizód kiválasztása'),{target:{value:lower}});
    await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText('Epizód kiválasztása') as HTMLSelectElement).value).toBe(upper);
    expect((screen.getByLabelText('Miért indult ez az epizód?') as HTMLTextAreaElement).value).toBe('Saját még nem mentett indok');
    fireEvent.click(within(screen.getByRole('navigation',{name:'Betegkarton fülök'})).getByRole('link',{name:/^Kezelés/}));await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledTimes(2));expect(mocks.router.push).not.toHaveBeenCalled();
    mocks.confirm.mockResolvedValue(true);fireEvent.change(screen.getByLabelText('Epizód kiválasztása'),{target:{value:lower}});await screen.findByText('Alsó lemez törése');
  });
  it('adds an appliance to the chosen empty episode using the explicit existing-episode command',async()=>{
    setup(upper,true);await screen.findByText('Még nincs ehhez az epizódhoz kapcsolt fogpótlás.');
    fireEvent.click(screen.getByRole('button',{name:'Fogpótlás megadása ehhez az epizódhoz'}));
    expect(mocks.registered).toHaveBeenLastCalledWith({action:'register',episodeId:upper,episodeMode:'existing',origin:'local'});
  });
  it('offers the free jaw in the same episode and preselects it',async()=>{
    setup(upper);await screen.findByText('Felső lemezes készülék');
    fireEvent.click(screen.getByRole('button',{name:'Másik állcsont fogpótlásának megadása'}));
    expect(mocks.registered).toHaveBeenLastCalledWith({action:'register',episodeId:upper,episodeMode:'existing',origin:'local',jaw:'also'});
  });
  it('shows both appliances and their independent acceptance progress and offers no third device',async()=>{
    const lowerDevice=crypto.randomUUID();
    setup(upper,false,{...clinical,prostheses:[...clinical.prostheses,{...clinical.prostheses[0],id:lowerDevice,jaw:'also',label:'Alsó készülék'}],episodeLinks:[...clinical.episodeLinks,{episode_id:upper,prosthesis_id:lowerDevice}],events:[{active:true,prosthesis_id:device,kind:'accepted'}]});
    await screen.findByText('Alsó készülék');
    expect(screen.getByText('Ebben az epizódban: Felső klinikailag kész · Alsó még készül')).toBeTruthy();
    expect(screen.getByText(/mindkét fogpótlás klinikai elfogadása/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Másik állcsont fogpótlásának megadása'})).toBeNull();
  });
  it('reports a mismatched episode link instead of displaying an unrelated current episode',async()=>{
    setup(crypto.randomUUID());await screen.findByText(/A hivatkozott epizód nem található/);expect(screen.queryByRole('region',{name:'Az epizód áttekintése'})).toBeNull();
  });
});
