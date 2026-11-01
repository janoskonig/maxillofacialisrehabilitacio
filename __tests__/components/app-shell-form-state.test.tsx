import { afterEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import { AppShell } from '@/components/layout/AppShell';
const m=vi.hoisted(()=>({getUser:vi.fn(),router:{replace:vi.fn(),push:vi.fn()}}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
vi.mock('@/lib/auth',()=>({getCurrentUser:m.getUser,logout:vi.fn()}));
vi.mock('@/components/FeedbackContext',()=>({useFeedback:()=>({openModal:vi.fn()})}));
vi.mock('@/hooks/useStaffTaskSummary',()=>({useStaffTaskSummary:()=>({summary:null})}));
vi.mock('@/hooks/useStaffInboxSummary',()=>({useStaffInboxSummary:()=>({summary:null})}));
vi.mock('@/components/layout/Sidebar',()=>({Sidebar:()=> <aside>Bejelentkezett felhasználó</aside>}));
vi.mock('@/components/CommandPalette',()=>({CommandPalette:()=>null}));
vi.mock('@/components/mobile/MobileBottomNav',()=>({MobileBottomNav:()=>null}));
vi.mock('@/components/ui/PageHeader',()=>({PageHeader:()=>null}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('keeps an edited form mounted when the authenticated sidebar arrives',async()=>{
  let resolveUser!:(value:unknown)=>void;
  m.getUser.mockReturnValue(new Promise(resolve=>{resolveUser=resolve;}));
  render(<AppShell title="Kezelés"><label>Terv<input defaultValue="Eredeti terv"/></label></AppShell>);
  fireEvent.change(screen.getByLabelText('Terv'),{target:{value:'Folyamatban lévő szerkesztés'}});
  await act(async()=>resolveUser({id:'u',email:'test@example.test',role:'admin'}));
  expect(await screen.findByText('Bejelentkezett felhasználó')).toBeTruthy();
  expect((screen.getByLabelText('Terv') as HTMLInputElement).value).toBe('Folyamatban lévő szerkesztés');
});
