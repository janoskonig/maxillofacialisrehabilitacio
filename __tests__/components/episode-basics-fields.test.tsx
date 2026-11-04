import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useState} from 'react';
import {EpisodeBasicsFields} from '@/components/episode-overview/EpisodeBasicsFields';
import {clinicalTemplate} from '@/lib/episode-clinical/model';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(birth:string,doctor:string|null=null,institution:string|null=null){
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({users:[{displayName:'Dr. Minta',intezmeny:'Minta Klinika'}]}))));
 const change=vi.fn();
 function Form(){const [value,setValue]=useState<ReturnType<typeof clinicalTemplate>['basics']>({...clinicalTemplate({},'traumás sérülés').basics,szuletesiDatum:birth,kezeleoorvos:doctor,kezeleoorvosIntezete:institution,torvenyesKepviseloNev:'Megőrzött képviselő'});return <EpisodeBasicsFields value={value} effectiveOn="2026-11-04" onChange={v=>{setValue(v);change(v);}}/>;}
 render(<Form/>);return change;
}
describe('Episode basics',()=>{
 it('hides guardian fields at 18 and shows them before the birthday without clearing preserved data',()=>{
  const change=setup('2008-11-04');expect(screen.queryByLabelText('Törvényes képviselő neve')).toBeNull();
  fireEvent.change(screen.getByLabelText('Születési dátum'),{target:{value:'2008-11-05'}});
  expect((screen.getByLabelText('Törvényes képviselő neve') as HTMLInputElement).value).toBe('Megőrzött képviselő');
  fireEvent.change(screen.getByLabelText('Születési dátum'),{target:{value:'1980-01-01'}});
  expect(screen.queryByLabelText('Törvényes képviselő neve')).toBeNull();expect(change.mock.lastCall?.[0].torvenyesKepviseloNev).toBe('Megőrzött képviselő');
 });
 it('fills a missing institution after the doctor directory loads and updates it on name selection',async()=>{
  setup('1980-01-01','Dr. Minta');
  await waitFor(()=>expect((screen.getByLabelText('Kezelőorvos intézete az adatfelvételkor') as HTMLInputElement).value).toBe('Minta Klinika'));
  fireEvent.change(screen.getByLabelText('Kezelőorvos intézete az adatfelvételkor'),{target:{value:'Kézzel rögzített intézet'}});
  fireEvent.change(screen.getByLabelText('Kezelőorvos az adatfelvételkor'),{target:{value:' dr. minta '}});
  expect((screen.getByLabelText('Kezelőorvos intézete az adatfelvételkor') as HTMLInputElement).value).toBe('Minta Klinika');
 });
 it('preserves a recorded institution when the directory loads',async()=>{
  setup('1980-01-01','Dr. Minta','Korabeli intézet');await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
  expect((screen.getByLabelText('Kezelőorvos intézete az adatfelvételkor') as HTMLInputElement).value).toBe('Korabeli intézet');
 });
});
