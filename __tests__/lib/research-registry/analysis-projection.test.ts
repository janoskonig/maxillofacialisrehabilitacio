import { describe, it, expect } from 'vitest';
import {
  buildAnalysisRow,
  ANALYSIS_VARIABLES,
  ANALYSIS_CODEBOOK_ENTRIES,
} from '@/lib/research-registry/analysis-projection';
import { assertExportPhiSafe } from '@/lib/research-registry/phi-safety';

const rawRow = {
  id: '11111111-1111-1111-1111-111111111111',
  // PHI that MUST NOT appear in the projection:
  nev: 'Kovács Béla',
  taj: '123456788',
  email: 'beteg@example.com',
  telefonszam: '+36 30 123 4567',
  szuletesi_datum: '1968-03-02',
  iranyitoszam: '1085',
  // analysis fields:
  nem: 'ferfi',
  kezelesre_erkezes_indoka: 'onkológiai kezelés utáni állapot',
  maxilladefektus_van: true,
  mandibuladefektus_van: false,
  brown_fuggoleges_osztaly: '3',
  brown_vizszintes_komponens: 'b',
  kovacs_dobak_osztaly: null,
  tnm_staging: 'T2N0M0',
  radioterapia: true,
  radioterapia_dozis_gy: 60,
  chemoterapia: false,
  dohanyzas_szam_ertek: 20,
  ohip_t0_total: 28,
  ohip_t1_total: null,
  completeness_score: 85,
};

describe('buildAnalysisRow', () => {
  it('projects de-identified analysis fields', () => {
    const row = buildAnalysisRow(rawRow, 'salt');
    expect(row.nem).toBe('ferfi');
    expect(row.etiologia).toBe('onkológiai kezelés utáni állapot');
    expect(row.maxilladefektus).toBe(true);
    expect(row.mandibuladefektus).toBe(false);
    expect(row.brown_fuggoleges).toBe('3');
    expect(row.kovacs_dobak).toBeNull();
    expect(row.radioterapia_dozis_gy).toBe(60);
    expect(row.dohanyzas_szam_ertek).toBe(20);
    expect(row.ohip_t0_total).toBe(28);
    expect(row.completeness_score).toBe(85);
  });

  it('reduces birth date to a 5-year age band and never exposes the exact date', () => {
    const row = buildAnalysisRow(rawRow, 'salt');
    expect(typeof row.age_band_start).toBe('number');
    expect((row.age_band_start as number) % 5).toBe(0);
    expect(JSON.stringify(row)).not.toContain('1968-03-02');
  });

  it('reduces postal code to a 2-char region prefix', () => {
    expect(buildAnalysisRow(rawRow).region_prefix).toBe('10');
  });

  it('produces a stable, non-reversible anonymized key (changes with salt)', () => {
    const a = buildAnalysisRow(rawRow, 'salt-a').anonymized_subject_key;
    const b = buildAnalysisRow(rawRow, 'salt-b').anonymized_subject_key;
    expect(a).toBe(buildAnalysisRow(rawRow, 'salt-a').anonymized_subject_key);
    expect(a).not.toBe(b);
    expect(String(a)).not.toContain('1111');
  });

  it('output contains no direct identifiers and passes the PHI-safety gate', () => {
    const row = buildAnalysisRow(rawRow, 'salt');
    for (const forbidden of ['nev', 'taj', 'email', 'telefonszam', 'cim', 'name', 'patient_name']) {
      expect(forbidden in row).toBe(false);
    }
    // The exact TAJ / email / phone must not survive anywhere in the row.
    expect(() => assertExportPhiSafe([row])).not.toThrow();
  });
});

describe('ANALYSIS_VARIABLES / codebook entries', () => {
  it('has a codebook entry for every analysis variable', () => {
    expect(ANALYSIS_CODEBOOK_ENTRIES).toHaveLength(ANALYSIS_VARIABLES.length);
    const keys = new Set(ANALYSIS_CODEBOOK_ENTRIES.map((e) => e.variable));
    for (const v of ANALYSIS_VARIABLES) expect(keys.has(v.key)).toBe(true);
  });

  it('every projected key is documented in the codebook', () => {
    const row = buildAnalysisRow(rawRow);
    const documented = new Set(ANALYSIS_VARIABLES.map((v) => v.key));
    for (const key of Object.keys(row)) expect(documented.has(key)).toBe(true);
  });
});
