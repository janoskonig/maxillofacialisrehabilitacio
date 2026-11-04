import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {ProsthesisTypeChoices} from '@/components/patient-form/ProsthesisTypeChoices';
import {existingProsthesisTypesSchema,FIXED_TYPES,REMOVABLE_TYPES} from '@/lib/prosthesis-types';
afterEach(cleanup);
it('keeps multiple fixed choices and replaces only the removable choice',()=>{
 const change=vi.fn();function Form(){const [v,setV]=useState<string[]>([]);return <ProsthesisTypeChoices jaw="Felső" disabled={false} value={v} onChange={v=>{setV(v);change(v);}}/>;}render(<Form/>);
 for(const type of [FIXED_TYPES[0],FIXED_TYPES[1],REMOVABLE_TYPES[0],REMOVABLE_TYPES[1]])fireEvent.click(screen.getByRole('button',{name:`Felső: ${type}`}));
 expect(change.mock.lastCall?.[0]).toEqual([FIXED_TYPES[0],FIXED_TYPES[1],REMOVABLE_TYPES[1]]);
 expect(existingProsthesisTypesSchema.safeParse(change.mock.lastCall?.[0]).success).toBe(true);
 expect(existingProsthesisTypesSchema.safeParse([REMOVABLE_TYPES[0],REMOVABLE_TYPES[1]]).success).toBe(false);
});
