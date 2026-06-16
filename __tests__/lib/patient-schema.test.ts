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

    // Sima boolean mezők: null → default (false).
    expect(parsed.radioterapia).toBe(false);
    expect(parsed.chemoterapia).toBe(false);
    expect(parsed.nemIsmertPoziciokbanImplantatum).toBe(false);

    // Háromállapotú klinikai igen/nem mezők: a `null` (nincs adat) NEM kényszerül
    // false-ra/true-ra — ezekről aktívan nyilatkozni kell (nincs adat ≠ nemleges).
    expect(parsed.maxilladefektusVan).toBeNull();
    expect(parsed.mandibuladefektusVan).toBeNull();
    expect(parsed.nyelvmozgásokAkadályozottak).toBeNull();
    expect(parsed.gombocosBeszed).toBeNull();
    expect(parsed.felsoFogpotlasVan).toBeNull();
    expect(parsed.alsoFogpotlasVan).toBeNull();
    expect(parsed.felsoFogpotlasElegedett).toBeNull();
    expect(parsed.alsoFogpotlasElegedett).toBeNull();
  });

  it('preserves explicit true/false for tri-state clinical flags', () => {
    const yes = patientSchema.parse({
      felsoFogpotlasVan: true,
      alsoFogpotlasVan: false,
      maxilladefektusVan: true,
      gombocosBeszed: false,
    });
    expect(yes.felsoFogpotlasVan).toBe(true);
    expect(yes.alsoFogpotlasVan).toBe(false);
    expect(yes.maxilladefektusVan).toBe(true);
    expect(yes.gombocosBeszed).toBe(false);

    // undefined (hiányzó mező) is „nincs adat" → null, nem false
    const missing = patientSchema.parse({});
    expect(missing.felsoFogpotlasVan).toBeNull();
    expect(missing.alsoFogpotlasVan).toBeNull();
    expect(missing.maxilladefektusVan).toBeNull();
    expect(missing.mandibuladefektusVan).toBeNull();
    expect(missing.nyelvmozgásokAkadályozottak).toBeNull();
    expect(missing.gombocosBeszed).toBeNull();
  });
});
