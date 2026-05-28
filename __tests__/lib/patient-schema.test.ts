import { describe, expect, it } from 'vitest';
import { patientSchema } from '@/lib/types/patient';

describe('patientSchema boolean fields', () => {
  it('coerces null booleans from DB to defaults', () => {
    const parsed = patientSchema.parse({
      radioterapia: null,
      chemoterapia: null,
      maxilladefektusVan: null,
      mandibuladefektusVan: null,
      nyelvmozgásokAkadályozottak: null,
      gombocosBeszed: null,
      felsoFogpotlasVan: null,
      felsoFogpotlasElegedett: null,
      alsoFogpotlasVan: null,
      alsoFogpotlasElegedett: null,
      nemIsmertPoziciokbanImplantatum: null,
    });

    expect(parsed.radioterapia).toBe(false);
    expect(parsed.chemoterapia).toBe(false);
    expect(parsed.maxilladefektusVan).toBe(false);
    expect(parsed.mandibuladefektusVan).toBe(false);
    expect(parsed.nyelvmozgásokAkadályozottak).toBe(false);
    expect(parsed.gombocosBeszed).toBe(false);
    expect(parsed.felsoFogpotlasVan).toBe(false);
    expect(parsed.alsoFogpotlasVan).toBe(false);
    expect(parsed.nemIsmertPoziciokbanImplantatum).toBe(false);
    expect(parsed.felsoFogpotlasElegedett).toBe(true);
    expect(parsed.alsoFogpotlasElegedett).toBe(true);
  });
});
