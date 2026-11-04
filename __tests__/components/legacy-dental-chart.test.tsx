import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusComparison } from '@/components/prosthesis-lifecycle/StatusComparison';
import { clinicalTemplate } from '@/lib/episode-clinical/model';
import { emptyLayers } from '@/lib/prosthesis-lifecycle/model';
import { positionDescription } from '@/components/prosthesis-lifecycle/ClinicalArch';
import type { ClinicalWorkspace } from '@/lib/prosthesis-lifecycle/service';
afterEach(cleanup);
describe('Existing chart visible without any new episode records',()=>{
 it('shows all nine original implant notes directly instead of two empty comparisons',()=>{
  const implants=Object.fromEntries(['12','15','22','23','24','34','35','44','45'].map(position=>[position,`Implantátum ${position}\nREF: ref-${position} LOT: lot-${position}`]));
  const dental=clinicalTemplate({meglevoImplantatumok:implants},'traumás sérülés').dental!;
  const data={states:[],plans:[],milestones:[],events:[],actual:emptyLayers(),legacyDental:dental} as unknown as ClinicalWorkspace;
  render(<StatusComparison data={data}/>);
  expect(screen.getByRole('region',{name:'Korábban rögzített fogazati karton'})).toBeTruthy();
  for(const position of Object.keys(implants))expect((screen.getByRole('textbox',{name:`${position}. pozíció`}) as HTMLTextAreaElement).value).toBe(implants[position]);
  expect(screen.queryByText('0 eltérő fogpozíció')).toBeNull();
  expect(screen.queryByText('Nincs rögzített implantátum.')).toBeNull();
 });
 it('shows the full saved description with the implant on a clinical arch',()=>{
  expect(positionDescription({...emptyLayers(),implants:{'12':{present:true,description:'REF: 061.4310 LOT: LPZP9'}}},12)).toContain('REF: 061.4310 LOT: LPZP9');
 });
});
