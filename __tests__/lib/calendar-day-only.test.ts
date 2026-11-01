import { expect,it } from 'vitest';
import { generateIcsFile } from '@/lib/calendar';
it('exports a day-only retrospective appointment as a calendar date, without inventing a clinical time',async()=>{
  const file=(await generateIcsFile({patientName:'Teszt',patientTaj:null,surgeonName:'Orvos',startTime:new Date('2026-09-09T22:00:00Z'),dayOnly:'2026-09-10'})).toString();
  expect(file).toContain('DTSTART;VALUE=DATE:20260910');expect(file).toContain('DTEND;VALUE=DATE:20260911');
  expect(file).not.toMatch(/DTSTART:.*T/);
});
