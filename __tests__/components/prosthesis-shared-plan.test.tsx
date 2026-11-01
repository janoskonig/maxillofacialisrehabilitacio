import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { ProsthesisLifecycle } from '@/components/prosthesis-lifecycle/ProsthesisLifecycle';
vi.mock('@/contexts/ToastContext',()=>({useToast:()=>({confirm:vi.fn().mockResolvedValue(true)})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('offers the single treatment editor and shows old text without a second plan creation form',async()=>{
  const data={patientName:'Tesztbeteg',episodes:[{id:'ep',case_title:'Felső epizód',status:'open'}],
    prostheses:[{id:'p',episode_id:'ep',label:'Felső végleges',jaw:'felso',role:'definitive',origin:'local'}],
    episodePlans:[{episodeId:'ep',jaw:'felso',treatmentPlanUpper:'Korábban mentett klinikai terv'}],
    events:[],conflicts:[],closureReview:[],episodeLinks:[{episode_id:'ep',prosthesis_id:'p',purpose:'construction'}],plans:[]};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})));
  render(<ProsthesisLifecycle patientId="patient"/>);
  const link=await screen.findByRole('link',{name:'Kezelési terv szerkesztése'});
  expect(link.getAttribute('href')).toBe('/patients/patient/stages?episodeId=ep&view=plan&plan=1#kezelesi-terv');
  expect(screen.queryByRole('button',{name:'Új tervverzió'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/^Kezelési tervek$/}));
  expect(await screen.findByText('Korábban mentett klinikai terv')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
