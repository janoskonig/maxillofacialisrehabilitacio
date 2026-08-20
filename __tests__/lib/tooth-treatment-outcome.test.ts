import { describe, it, expect } from 'vitest';
import {
  applyTreatmentOutcome,
  outcomeBaseFor,
  projectFogakWithTreatments,
  KNOWN_TREATMENT_CODES,
  TREATMENT_OUTCOME_RULES,
} from '@/lib/tooth-treatment-outcome';
import { isMissingBase } from '@/components/patient-form/odontogram/tooth-conditions';
import { TOOTH_BASES } from '@/lib/tooth-base';

describe('outcomeBaseFor', () => {
  it('maps the clinical treatment codes to their resulting base', () => {
    expect(outcomeBaseFor('huzas')).toBe('missing');
    expect(outcomeBaseFor('implantacio')).toBe('implant');
    expect(outcomeBaseFor('korona')).toBe('crown');
    expect(outcomeBaseFor('tomes')).toBe('filled');
    expect(outcomeBaseFor('gyokerkezeles')).toBe('root_canal');
    expect(outcomeBaseFor('hid_pillerkezeles')).toBe('bridge_abutment');
  });

  it('returns null for codes without an automatic status change', () => {
    expect(outcomeBaseFor('csiszolas')).toBeNull();
    expect(outcomeBaseFor('nem_letezik')).toBeNull();
  });
});

describe('applyTreatmentOutcome', () => {
  it('extraction makes the tooth missing and clears caries/periapical/mobility', () => {
    const { changed, next } = applyTreatmentOutcome(
      { base: 'sound', caries: true, periapical: true, mobility: 2 },
      'huzas',
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'missing' });
  });

  it('filling a carious tooth becomes filled and clears caries', () => {
    const { changed, next } = applyTreatmentOutcome({ base: 'sound', caries: true }, 'tomes');
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'filled' });
  });

  it('root canal keeps existing caries but clears periapical', () => {
    const { next } = applyTreatmentOutcome(
      { base: 'sound', caries: true, periapical: true },
      'gyokerkezeles',
    );
    expect(next).toEqual({ base: 'root_canal', caries: true });
  });

  it('resolves the legacy D/F/M status shape before applying', () => {
    const { changed, next } = applyTreatmentOutcome({ status: 'D' }, 'tomes');
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'filled' });
  });

  it('csiszolás and unknown codes leave the tooth unchanged', () => {
    expect(applyTreatmentOutcome({ base: 'crown' }, 'csiszolas').changed).toBe(false);
    expect(applyTreatmentOutcome({ base: 'crown' }, 'whatever').changed).toBe(false);
  });

  it('reports no change when the result already matches', () => {
    expect(applyTreatmentOutcome({ base: 'missing' }, 'huzas').changed).toBe(false);
  });
});

describe('projectFogakWithTreatments', () => {
  it('applies every planned treatment without mutating the input', () => {
    const input = { '11': { base: 'sound', caries: true }, '21': { base: 'sound' } };
    const out = projectFogakWithTreatments(input, [
      { toothNumber: 11, treatmentCode: 'tomes' },
      { toothNumber: '21', treatmentCode: 'huzas' },
    ]);
    expect(out).toEqual({ '11': { base: 'filled' }, '21': { base: 'missing' } });
    // input untouched
    expect(input['11']).toEqual({ base: 'sound', caries: true });
  });
});

// ─── Protetikai szerepek (079) ──────────────────────────────────────────────

describe('protetikai szerepek vetítése', () => {
  it('hézagfog → hídtest, a fog-szintű jelzők törlődnek', () => {
    const { changed, next } = applyTreatmentOutcome(
      { base: 'missing', caries: true, periapical: true, mobility: 2 },
      'hezagfog',
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ base: 'bridge_pontic' });
  });

  it('kapocstartó korona → korona', () => {
    expect(outcomeBaseFor('kapocstarto_korona')).toBe('crown');
  });

  it('műfog → denture_tooth, és hiányzó természetes fognak számít', () => {
    const { next } = applyTreatmentOutcome({ base: 'missing' }, 'mufog');
    expect(next).toEqual({ base: 'denture_tooth' });
    // Ezen múlik, hogy a DMF-T és az ív-összegzés helyes marad: a pótlás nem tesz
    // vissza fogat, csak kitölti a helyét.
    expect(isMissingBase('denture_tooth')).toBe(true);
  });

  it('a támfog és a rejtett elhorgonyzás nem írja át az alapállapotot', () => {
    expect(applyTreatmentOutcome({ base: 'sound' }, 'kapocstarto_tamfog').changed).toBe(false);
    expect(applyTreatmentOutcome({ base: 'sound' }, 'rejtett_elhorgonyzas').changed).toBe(false);
    expect(outcomeBaseFor('kapocstarto_tamfog')).toBeNull();
    expect(outcomeBaseFor('rejtett_elhorgonyzas')).toBeNull();
  });

  it('a fedett alapállapotok elnyelik a felszín-jelöléseket', () => {
    const { next } = applyTreatmentOutcome(
      { base: 'missing', surfaces: { occlusal: 'caries' } },
      'mufog',
    );
    expect(next).toEqual({ base: 'denture_tooth' });
  });

  it('15/16/17 híd egy menetben: horgonykorona – hídtest – horgonykorona', () => {
    const out = projectFogakWithTreatments(
      { '15': { base: 'sound' }, '16': { base: 'missing' }, '17': { base: 'sound' } },
      [
        { toothNumber: 15, treatmentCode: 'hid_pillerkezeles' },
        { toothNumber: 16, treatmentCode: 'hezagfog' },
        { toothNumber: 17, treatmentCode: 'hid_pillerkezeles' },
      ],
    );
    expect(out).toEqual({
      '15': { base: 'bridge_abutment' },
      '16': { base: 'bridge_pontic' },
      '17': { base: 'bridge_abutment' },
    });
  });
});

describe('a registry mint lefedettségi referencia', () => {
  it('a hatás nélküli kódok EXPLICIT null-lal szerepelnek, nem hiányzó kulcsként', () => {
    // Enélkül a katalógus-lefedettség ellenőrzője (lib/catalog-coverage.ts) ezeket
    // állandó „unmapped" hamis riasztásként jelentené.
    for (const code of ['csiszolas', 'kapocstarto_tamfog', 'rejtett_elhorgonyzas']) {
      expect(code in TREATMENT_OUTCOME_RULES).toBe(true);
      expect(TREATMENT_OUTCOME_RULES[code]).toBeNull();
    }
  });

  it('a KNOWN_TREATMENT_CODES a 079 utáni teljes katalógust lefedi', () => {
    for (const code of [
      'tomes', 'gyokerkezeles', 'huzas', 'implantacio', 'korona', 'csiszolas',
      'hid_pillerkezeles', 'devitalizalas', 'csonk_felepites',
      'hezagfog', 'kapocstarto_korona', 'kapocstarto_tamfog', 'rejtett_elhorgonyzas', 'mufog',
    ]) {
      expect(KNOWN_TREATMENT_CODES).toContain(code);
    }
  });

  it('minden szabály érvényes alapállapotra mutat', () => {
    for (const [code, rule] of Object.entries(TREATMENT_OUTCOME_RULES)) {
      if (rule) expect(TOOTH_BASES, `${code} → ${rule.base}`).toContain(rule.base);
    }
  });

  it('ismeretlen kód továbbra is csendes no-op', () => {
    expect(applyTreatmentOutcome({ base: 'crown' }, 'nem_letezik').changed).toBe(false);
  });
});
