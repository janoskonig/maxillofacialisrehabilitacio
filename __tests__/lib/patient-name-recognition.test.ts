import { describe, it, expect } from 'vitest';
import {
  recognizePatientsInText,
  buildMentionSegments,
  type PatientRosterEntry,
} from '@/lib/patient-name-recognition';

const KOVACS: PatientRosterEntry = { id: 'p1', nev: 'Kovács János', taj: '123 456 789' };
const NAGY: PatientRosterEntry = { id: 'p2', nev: 'Nagy Erzsébet', taj: '987654321' };
// Azonos nevű, eltérő TAJ → egyértelműsítendő.
const KOVACS_DUP: PatientRosterEntry = { id: 'p3', nev: 'Kovács János', taj: '111222333' };

const ROSTER = [KOVACS, NAGY, KOVACS_DUP];

describe('recognizePatientsInText — name matching', () => {
  it('recognizes a full name with accents and a Hungarian suffix', () => {
    const out = recognizePatientsInText(
      'Megbeszéltem Kovács Jánossal a kontrollt',
      [KOVACS, NAGY],
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('name');
    expect(out[0].candidates.map((c) => c.id)).toEqual(['p1']);
    expect(out[0].ambiguous).toBe(false);
    expect(out[0].matchedText).toBe('Kovács Jánossal');
  });

  it('does not match a bare first name', () => {
    const out = recognizePatientsInText('Beszéltem Jánossal ma', [KOVACS, NAGY]);
    expect(out).toHaveLength(0);
  });

  it('flags duplicate full names as ambiguous', () => {
    const out = recognizePatientsInText('Kovács János jött', ROSTER);
    expect(out).toHaveLength(1);
    expect(out[0].ambiguous).toBe(true);
    expect(out[0].candidates.map((c) => c.id).sort()).toEqual(['p1', 'p3']);
  });

  it('collapses repeated mentions of the same patient into one detection', () => {
    const out = recognizePatientsInText('Nagy Erzsébet és újra Nagy Erzsébet', [NAGY]);
    expect(out).toHaveLength(1);
    expect(out[0].candidates[0].id).toBe('p2');
  });
});

describe('recognizePatientsInText — TAJ matching', () => {
  it('recognizes a grouped TAJ number and resolves it to a single patient', () => {
    const out = recognizePatientsInText('A beteg TAJ-száma 123 456 789.', ROSTER);
    const taj = out.find((d) => d.kind === 'taj');
    expect(taj).toBeDefined();
    expect(taj!.candidates.map((c) => c.id)).toEqual(['p1']);
    expect(taj!.ambiguous).toBe(false);
  });

  it('ignores numbers that are not 9 digits', () => {
    const out = recognizePatientsInText('A szoba száma 12345.', ROSTER);
    expect(out.some((d) => d.kind === 'taj')).toBe(false);
  });
});

describe('buildMentionSegments', () => {
  it('linkifies a plain full-name occurrence', () => {
    const segs = buildMentionSegments('Kontroll: Nagy Erzsébet jövő héten', [NAGY]);
    const link = segs.find((s) => s.type === 'link');
    expect(link).toBeDefined();
    expect(link!.patientId).toBe('p2');
    expect(link!.content).toBe('Nagy Erzsébet');
  });

  it('linkifies a legacy @slug mention without any lookup', () => {
    const segs = buildMentionSegments('lásd @kovacs+janos kartonját', [KOVACS]);
    const link = segs.find((s) => s.type === 'link');
    expect(link).toBeDefined();
    expect(link!.patientId).toBe('p1');
    expect(link!.content).toBe('@kovacs+janos');
  });

  it('returns the whole text as a single segment when nothing matches', () => {
    const segs = buildMentionSegments('Nincs itt beteg neve', [KOVACS]);
    expect(segs).toEqual([{ type: 'text', content: 'Nincs itt beteg neve' }]);
  });
});
