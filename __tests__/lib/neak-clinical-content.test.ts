import { describe, expect, it } from 'vitest';
import { buildDentalExportContent, dentalProsthesisLines } from '@/lib/neak-dental-content';
import { buildTreatmentExportContent, treatmentContentToText, treatmentLabel } from '@/lib/neak-treatment-content';
import { neakClinicalPatient as patient, neakClinicalSources as sources } from '../fixtures/neak-clinical';

describe('NEAK dental content', () => {
  const content = buildDentalExportContent(patient);
  const row = (number: number) => content.rows.find((r) => r.number === number)!;
  it('preserves modern base conditions, legacy status, surfaces and clinical annotations', () => {
    expect(row(11).detail).toContain('Korona');
    expect(row(12).detail).toContain('Gyökértömött; Periapikális elváltozás');
    expect(row(13).detail).toContain('Horgonykorona');
    expect(row(14).detail).toContain('Hídtest');
    expect(row(15).detail).toContain('Mobilitás: 2');
    expect(row(15).detail).toContain('szuvas: meziális');
    expect(row(15).detail).toContain('tömött: okkluzális');
    expect(row(17).detail).toContain('Hiányzó');
    expect(row(21).detail).toContain('Implantátum');
    expect(row(24).detail).toContain('Műfog');
    expect(row(27).detail).toContain('Kérdéses megtarthatóság');
    expect(row(27).code).toBe('?');
    expect(row(26).code).toBe('D');
    expect(row(26).detail).not.toContain('Ép');
  });
  it('uses the modern count rules without double counting a filled carious tooth', () => {
    expect(content.index).toEqual({ d: 3, f: 5, m: 3, dmft: 11 });
  });
  it('distinguishes undocumented teeth and an entirely missing status', () => {
    expect(row(32).explicit).toBe(false);
    expect(row(32).code).toBe('É*');
    const empty = buildDentalExportContent({});
    expect(empty.hasStatus).toBe(false);
    expect(empty.rows.every((r) => r.code === '?')).toBe(true);
    expect(empty.notes).toContain('Nincs rögzített fogazati státusz.');
  });
  it('prints prostheses, negative answers and classification even with no tooth annotations', () => {
    expect(dentalProsthesisLines(patient, 'upper')).toContain('Elégedett vele: nem');
    expect(dentalProsthesisLines(patient, 'lower')).toContain('Meglévő fogpótlás: nincs');
    expect(dentalProsthesisLines(patient, 'lower')).toContain('Fábián-Fejérdy foghiányosztály: 0');
    expect(dentalProsthesisLines({}, 'upper')).toEqual(['Meglévő fogpótlás: nincs adat']);
  });
  it('ignores invalid FDI entries in the summary', () => {
    expect(buildDentalExportContent({ meglevoFogak: { '99': { status: 'M' } } }).index.dmft).toBe(0);
  });
});

describe('NEAK treatment content', () => {
  const content = buildTreatmentExportContent(patient, sources);
  const text = treatmentContentToText(patient, content);
  it('resolves code-only plans, includes facial plans, free text, dates and completion state', () => {
    expect(text).toContain('Teljes lemezes fogpótlás');
    expect(text).toContain('2026.12.10.');
    expect(text).toContain('Korábban rögzített fogpótlás; állapot: elkészült');
    expect(text).toContain('orrepitézis; állapot: tervezett; elhorgonyzás: mágnes');
    expect(text).toContain(patient.kezelesiTervMelleklet);
    expect(text).not.toContain('N/A');
  });
  it('separates completed tooth treatments and prints notes and episode context', () => {
    expect(content.sections.find((s) => s.title === 'Fogankénti kezelési igények')?.lines.join('\n')).toContain('12. fog: Gyökérkezelés; állapot: epizódhoz kapcsolt igény');
    const done = content.sections.find((s) => s.title === 'Elkészült fogankénti kezelések')!;
    expect(done.lines).toEqual(['36. fog: Tömés; állapot: elkészült; elkészült: 2026.09.20.']);
    expect(text).toContain('A rögzített felszíni igényhez kapcsolódó megjegyzés.');
    expect(text).toContain('Felső rehabilitáció; kezelés: Teljes lemezes fogpótlás');
  });
  it('exports upper and lower clinical plans under separate episode headings', () => {
    const result = buildTreatmentExportContent({}, { ...sources, toothTreatments: [], episodes: [
      { id: 'e1', caseTitle: 'Rehabilitáció', status: 'open', treatmentPlanUpper: 'Felső terv.\nIndoklás.', treatmentPlanLower: 'Alsó terv.' },
      { id: 'e2', status: 'closed', treatmentPlanUpper: 'Lezárt terv' },
    ] });
    expect(result.sections[0]).toEqual({ title: 'Rehabilitáció - felső állcsont kezelési terve', lines: ['Felső terv.\nIndoklás.'] });
    expect(result.sections[1]).toEqual({ title: 'Rehabilitáció - alsó állcsont kezelési terve', lines: ['Alsó terv.'] });
    expect(JSON.stringify(result)).not.toContain('Lezárt terv');
  });
  it('preserves an unclassified older plan without claiming it belongs to either jaw', () => {
    const result = buildTreatmentExportContent({}, { ...sources, toothTreatments: [], episodes: [{ id: 'e1', chiefComplaint: 'Nyitott epizód', status: 'open', treatmentPlan: 'Korábbi közös terv' }] });
    expect(result.sections[0].lines).toEqual(['Nincs rögzített felső kezelési terv.']);
    expect(result.sections[1].lines).toEqual(['Nincs rögzített alsó kezelési terv.']);
    expect(result.sections[2].lines).toEqual(['Korábbi közös terv']);
  });
  it('does not repeat an older plan when its exact text has been assigned to a jaw', () => {
    const result = buildTreatmentExportContent({}, { ...sources, toothTreatments: [], episodes: [{ id: 'e1', status: 'open', treatmentPlan: 'Régi terv', treatmentPlanUpper: 'Régi terv' }] });
    expect(result.sections.some((section) => section.title.includes('állcsontmegjelölés nélküli'))).toBe(false);
  });

  it('preserves unknown codes visibly and falls back to legacy labels', () => {
    expect(treatmentLabel({ treatmentTypeCode: 'unknown' }, sources.labels)).toBe('Ismeretlen kezeléstípus (unknown)');
    expect(treatmentLabel({ treatmentTypeCode: 'unknown', tipus: 'Régi megnevezés' }, sources.labels)).toBe('Régi megnevezés');
  });
  it('does not silently claim all sources are available', () => {
    const empty = buildTreatmentExportContent({}, { labels: new Map(), toothTreatments: [], episodes: [], warnings: ['Adatforrás hiányzik'] });
    expect(empty.notes).toContain('Adatforrás hiányzik');
  });
});
