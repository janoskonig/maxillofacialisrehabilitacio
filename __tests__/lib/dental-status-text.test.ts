import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  resolveTooth,
  isToothMissing,
  computeDentalDMFT,
  describeTooth,
  TOOTH_BASE_LABELS,
} from '@/lib/dental-status-text';
import {
  readConditions,
  computeDMFT,
  isMissingBase,
  BASE_LABELS,
} from '@/components/patient-form/odontogram/tooth-conditions';
import { generateDentalStatusPDF } from '@/lib/pdf/generateDentalStatusPDF';

// Vegyes fogtérkép: új modell (base/caries/surfaces/…), régi D/F/M és szöveges érték.
const fogak: Record<string, any> = {
  '11': { base: 'crown' },
  '16': { base: 'filled', surfaces: { occlusal: 'filling', mesial: 'caries' } },
  '21': { status: 'D' },
  '24': { status: 'F', description: 'régi amalgám' },
  '28': { status: 'M' },
  '31': 'kérdéses prognózis',
  '36': { base: 'missing' },
  '37': { base: 'bridge_pontic' },
  '41': { base: 'sound', caries: true },
  '44': { base: 'root_canal', periapical: true, mobility: 2 },
  '46': { base: 'denture_tooth' },
  '47': { base: 'implant', description: 'Straumann BLT 4.1' },
  '48': {},
};

describe('dental-status-text – paritás az odontogram feloldásával', () => {
  it('a címkék megegyeznek a felület címkéivel', () => {
    expect(TOOTH_BASE_LABELS).toEqual(BASE_LABELS);
  });

  it('minden fogra ugyanazt az állapotot oldja fel', () => {
    for (const [fdi, value] of Object.entries(fogak)) {
      const ui = readConditions(value);
      const resolved = resolveTooth(value)!;
      expect(resolved, fdi).toMatchObject({
        base: ui.base,
        caries: ui.caries,
        periapical: ui.periapical,
        mobility: ui.mobility,
        surfaces: ui.surfaces,
      });
      expect(isToothMissing(resolved), fdi).toBe(isMissingBase(ui.base));
    }
  });

  it('a DMF-T megegyezik a felületen számolttal', () => {
    expect(computeDentalDMFT(fogak)).toEqual(computeDMFT(fogak));
    expect(computeDentalDMFT(fogak)).toEqual({ d: 3, m: 4, f: 3, dmft: 10 });
  });

  it('rögzítetlen fogra null-t ad', () => {
    expect(resolveTooth(undefined)).toBeNull();
    expect(resolveTooth('  ')).toBeNull();
  });
});

describe('describeTooth', () => {
  it('megjegyzés nélküli, új modellű fogat is leír (ezek maradtak ki az exportból)', () => {
    expect(describeTooth(11, fogak['11'])).toBe('Korona');
    expect(describeTooth(36, fogak['36'])).toBe('Hiányzó');
    expect(describeTooth(37, fogak['37'])).toBe('Hídtest');
    expect(describeTooth(41, fogak['41'])).toBe('Szuvas');
  });

  it('felszíneket, gyökércsúcsi gyulladást és mobilitást is kiír', () => {
    expect(describeTooth(16, fogak['16'])).toBe('Tömött, szuvas: meziális, tömött: okkluzális');
    expect(describeTooth(44, fogak['44'])).toBe('Gyökértömött, gyökércsúcsi gyulladás, mobilitás: II');
  });

  it('a megjegyzést a lelet után fűzi', () => {
    expect(describeTooth(47, fogak['47'])).toBe('Implantátum – Straumann BLT 4.1');
  });

  it('a régi D/F/M és a szöveges értéket is kezeli', () => {
    expect(describeTooth(21, fogak['21'])).toBe('Szuvas');
    expect(describeTooth(24, fogak['24'])).toBe('Tömött – régi amalgám');
    expect(describeTooth(28, fogak['28'])).toBe('Hiányzó');
    expect(describeTooth(31, fogak['31'])).toBe('kérdéses prognózis');
  });

  it('ép, megjegyzés nélküli fogról nem ír sort', () => {
    expect(describeTooth(48, fogak['48'])).toBe('');
    expect(describeTooth(12, undefined)).toBe('');
  });
});

describe('generateDentalStatusPDF', () => {
  it('vegyes (új + régi modellű) fogtérképből részletes, kétoldalas PDF-et készít', async () => {
    const buf = await generateDentalStatusPDF({
      nev: 'Minta Péterné',
      meglevoFogak: fogak,
      fabianFejerdyProtetikaiOsztalyAlso: '2A',
    });
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(buf);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe('Fogazati státusz');
  });

  it('hosszú megjegyzést tördel, sok sornál új oldalt nyit', async () => {
    const long = 'nagyon hosszú megjegyzés a fogról '.repeat(12);
    const many: Record<string, any> = {};
    for (const q of [1, 2, 3, 4]) for (let i = 1; i <= 8; i++) many[`${q}${i}`] = { base: 'crown', description: long };
    const buf = await generateDentalStatusPDF({ nev: 'Hosszú Lista', meglevoFogak: many });
    expect((await PDFDocument.load(buf)).getPageCount()).toBeGreaterThan(1);
  });

  it('üres státusz mellett sem dob hibát', async () => {
    const buf = await generateDentalStatusPDF({ nev: 'Üres' });
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(1);
  });
});
