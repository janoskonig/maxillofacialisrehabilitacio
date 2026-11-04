import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { EpisodeClinicalReviewPanel } from '@/components/episode-overview/EpisodeClinicalReviewPanel';
import { clinicalTemplate,type EpisodeClinicalReview,type EpisodeClinicalWorkspace } from '@/lib/episode-clinical/model';
const mocks=vi.hoisted(()=>({saved:vi.fn(),state:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock('@/contexts/ToastContext',()=>({useToast:()=>({confirm:mocks.confirm,showToast:vi.fn()})}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
vi.mock('@/components/patient-form/DefectRaster',()=>({DefectRaster:()=>null}));
const patientId=crypto.randomUUID(),episodeId=crypto.randomUUID();
const content=clinicalTemplate({nev:'Előzményből származó név'},'traumás sérülés');
function record(version:number,date:string,diagnosis:string):EpisodeClinicalReview{return{id:crypto.randomUUID(),patientId,episodeId,version,effectiveOn:date,source:'Vizsgálati lap',note:'',recordedAt:'2026-11-01T09:00:00Z',recordedBy:crypto.randomUUID(),recorder:'Dr. Vizsgáló',sourceReviewId:null,content:{...content,anamnesis:{...content.anamnesis,diagnozis:diagnosis}}};}
function setup(reviews:EpisodeClinicalReview[]=[],template=content){
  let data:EpisodeClinicalWorkspace={episode:{id:episodeId,reason:'traumás sérülés',chiefComplaint:'Baleset után',status:'open'},current:reviews[0]??null,history:reviews,latestVersion:reviews.length,template:reviews[0]?.content??template,templateProvenance:reviews.length?'review':'legacy_unreviewed',availableReviews:[]};
  const fetch=vi.fn(async(_url:string,init?:RequestInit)=>{if(_url==='/api/bno-codes')return new Response(JSON.stringify([{kod:'K0000',nev:'Anodontia'},{kod:'K0810',nev:'A fogak elvesztése'}]));if(init?.method==='POST'){const command=JSON.parse(init.body as string);const review={...record(data.latestVersion+1,command.effectiveOn,''),content:command.content};data={...data,current:review,history:[review,...data.history],latestVersion:review.version,template:review.content,templateProvenance:'review'};return new Response(JSON.stringify({review}));}return new Response(JSON.stringify(data));});
  vi.stubGlobal('fetch',fetch);render(<EpisodeClinicalReviewPanel patientId={patientId} episodeId={episodeId} canEdit states={[]} onSaved={mocks.saved} onStateChange={mocks.state}/>);return fetch;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();localStorage.clear();});
describe('Episode clinical review workflow',()=>{
  it('marks chart suggestions as unreviewed and never silently creates a past examination',async()=>{
    const fetch=setup();await screen.findByText(/Az epizód induló adatai még nincsenek felülvizsgálva/);
    expect((screen.getByLabelText('Név') as HTMLInputElement).value).toBe('Előzményből származó név');
    fireEvent.click(screen.getByRole('button',{name:'3. Műtétek és jóváhagyás'}));
    expect((screen.getByRole('button',{name:'Felülvizsgált epizódadatok mentése'}) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch.mock.calls.some(call=>call[1]?.method==='POST')).toBe(false);
  });
  it('records two surgeries in one explicitly reviewed episode observation and keeps distinct stable identities',async()=>{
    const fetch=setup();await screen.findByLabelText('Név');fireEvent.click(screen.getByRole('button',{name:'3. Műtétek és jóváhagyás'}));
    for(const procedure of ['Reszekció','Újabb rekonstrukció']){fireEvent.click(screen.getByRole('button',{name:'Újabb műtét megadása'}));const group=screen.getAllByRole('group',{name:/^\d\. műtét$/}).at(-1)!;fireEvent.change(within(group).getByLabelText('Műtét megnevezése / leírása'),{target:{value:procedure}});fireEvent.change(within(group).getByLabelText('Műtéti adat forrása'),{target:{value:'Zárójelentés'}});}
    fireEvent.change(screen.getByLabelText('Adatfelvétel tényleges napja'),{target:{value:'2026-09-10'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Felülvizsgált epizódadatok mentése'}));
    await waitFor(()=>expect(mocks.saved).toHaveBeenCalledOnce());const call=fetch.mock.calls.find(c=>c[1]?.method==='POST')!;const command=JSON.parse(call[1]!.body as string);
    expect(command.effectiveOn).toBe('2026-09-10');expect(command.content.surgeries).toHaveLength(2);expect(new Set(command.content.surgeries.map((s:any)=>s.id)).size).toBe(2);expect(command.content.surgeries.every((s:any)=>s.occurredOn===null)).toBe(true);expect(command.reviewed).toBe(true);
  });
  it('shows the selected historical observation and carries its exact identity into the document link',async()=>{
    const current=record(2,'2026-10-01','Traumás sérülés'),old=record(1,'2026-02-01','Korábbi daganat');setup([current,old]);
    await screen.findAllByText('Traumás sérülés');fireEvent.change(screen.getByLabelText('Megőrzött adatfelvételek'),{target:{value:old.id}});await screen.findAllByText('Korábbi daganat');expect(screen.queryAllByText('Traumás sérülés')).toHaveLength(0);
    expect(screen.getByRole('link',{name:'Dokumentumok és méltányossági export ezzel az adatfelvétellel'}).getAttribute('href')).toContain(`clinicalReviewId=${old.id}`);
  });

  it('shows every legacy implant in the original fields and sends the full descriptions when explicitly reviewed',async()=>{
    const positions=['12','15','22','23','24','34','35','44','45'];
    const implants=Object.fromEntries(positions.map(position=>[position,`Implantátum ${position}\nREF: ref-${position} LOT: lot-${position}`]));
    const template=clinicalTemplate({bno:'K0000',diagnozis:'Foghiány',meglevoFogak:{'12':{status:'M'}},meglevoImplantatumok:implants,nemIsmertPoziciokbanImplantatumRészletek:'Régi szabadszavas megjegyzés'},'traumás sérülés');
    const fetch=setup([],template);await screen.findByLabelText('Név');
    fireEvent.click(screen.getByRole('button',{name:'2. Anamnézis és állapot'}));
    for(const position of positions)expect((screen.getByRole('textbox',{name:`${position}. pozíció`}) as HTMLTextAreaElement).value).toBe(implants[position]);
    const bno=screen.getByRole('combobox',{name:'BNO-kód keresése'});await waitFor(()=>expect(bno.getAttribute('aria-busy')).toBe('false'));
    fireEvent.change(bno,{target:{value:'fogak elvesztese'}});fireEvent.mouseDown(screen.getByRole('option',{name:/K0810/}));
    fireEvent.change(screen.getByRole('textbox',{name:'12. pozíció'}),{target:{value:''}});
    expect((screen.getByRole('checkbox',{name:'Implantátum: 12. pozíció'}) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'3. Műtétek és jóváhagyás'}));
    fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Felülvizsgált epizódadatok mentése'}));
    await waitFor(()=>expect(mocks.saved).toHaveBeenCalledOnce());
    const command=JSON.parse(fetch.mock.calls.find(call=>call[1]?.method==='POST')![1]!.body as string);
    expect(command.content.dental.meglevoImplantatumok).toEqual({...implants,'12':''});
    expect(command.content.dental.nemIsmertPoziciokbanImplantatumRészletek).toBe('Régi szabadszavas megjegyzés');
    expect(command.content.anamnesis).toMatchObject({bno:'K0810',diagnozis:'A fogak elvesztése',radioterapia:null,chemoterapia:null});
  });
  it('opens all sections together in expert mode',async()=>{
    localStorage.setItem('clinical-form-mode','expert');setup([record(1,'2026-01-01','Már kitöltött diagnózis')]);await screen.findByLabelText('Név');expect(screen.getByLabelText('Diagnózis')).toBeTruthy();expect(screen.getByLabelText('Műtéti előzmények ismertsége')).toBeTruthy();expect(screen.queryByRole('group',{name:'Adatfelülvizsgálat lépései'})).toBeNull();
  });
  it.each(['guided','expert'])('shows only the selected reason’s fields in %s mode and preserves hidden values',async(mode)=>{
    localStorage.setItem('clinical-form-mode',mode);
    const template=clinicalTemplate({
      balesetEtiologiaja:'Mintabaleset',szovettaniDiagnozis:'Mintaszövettan',
      veleszuletettMutetekLeirasa:'Korábbi mintaműtét',radioterapia:true,radioterapiaDozis:'60 Gy',
    },'traumás sérülés');
    setup([],template);await screen.findByLabelText('Név');
    if(mode==='guided')fireEvent.click(screen.getByRole('button',{name:'2. Anamnézis és állapot'}));
    const chart=screen.getByLabelText('Epizód klinikai kartonja');
    await waitFor(()=>expect(within(chart).getByRole('combobox',{name:'BNO-kód keresése'}).getAttribute('aria-busy')).toBe('false'));
    const reason=within(chart).getByDisplayValue('traumás sérülés');
    expect(within(chart).getByDisplayValue('Mintabaleset')).toBeTruthy();
    expect(within(chart).queryByText('Tumor szövettani típusa')).toBeNull();
    expect(within(chart).queryByText('Milyen rendellenesség(ek) áll(nak) fenn?')).toBeNull();
    fireEvent.change(reason,{target:{value:'onkológiai kezelés utáni állapot'}});
    expect(within(chart).getByDisplayValue('Mintaszövettan')).toBeTruthy();
    expect(within(chart).getByDisplayValue('60 Gy')).toBeTruthy();
    expect(within(chart).queryByText('Baleset etiológiája')).toBeNull();
    expect(within(chart).queryByText('Milyen rendellenesség(ek) áll(nak) fenn?')).toBeNull();
    fireEvent.click(chart.querySelector('input[name="radioterapia"]')!);
    expect(within(chart).queryByText('Dózis (n Gy)')).toBeNull();
    fireEvent.change(reason,{target:{value:'veleszületett rendellenesség'}});
    expect(within(chart).getByDisplayValue('Korábbi mintaműtét')).toBeTruthy();
    expect(within(chart).queryByText('Tumor szövettani típusa')).toBeNull();
    expect(within(chart).queryByText('Baleset etiológiája')).toBeNull();
    fireEvent.change(reason,{target:{value:'traumás sérülés'}});
    expect(within(chart).getByDisplayValue('Mintabaleset')).toBeTruthy();
    fireEvent.change(reason,{target:{value:'onkológiai kezelés utáni állapot'}});
    expect(within(chart).getByDisplayValue('Mintaszövettan')).toBeTruthy();
    fireEvent.click(chart.querySelector('input[name="radioterapia"]')!);
    expect(within(chart).getByDisplayValue('60 Gy')).toBeTruthy();
  });
});
