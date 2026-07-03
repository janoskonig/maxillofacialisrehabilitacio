import { describe, it, expect } from 'vitest';
import {
  normalizeTaj,
  isSearchableTaj,
  normalizePatientName,
  namesSimilar,
  levenshtein,
  maskedPatientLabel,
} from '@/lib/patient-duplicate-check';

describe('normalizeTaj / isSearchableTaj', () => {
  it('csak számjegyeket tart meg', () => {
    expect(normalizeTaj('123-456-789')).toBe('123456789');
    expect(normalizeTaj(' 123 456 789 ')).toBe('123456789');
    expect(normalizeTaj(null)).toBe('');
  });

  it('csak teljes (9 jegyű) TAJ kereshető', () => {
    expect(isSearchableTaj('123-456-789')).toBe(true);
    expect(isSearchableTaj('123-456')).toBe(false);
    expect(isSearchableTaj('')).toBe(false);
    expect(isSearchableTaj(undefined)).toBe(false);
  });
});

describe('normalizePatientName', () => {
  it('kisbetűsít, ékezetet és írásjelet eltávolít', () => {
    expect(normalizePatientName('Kovács Ágnes')).toEqual(['kovacs', 'agnes']);
    expect(normalizePatientName('  Szabó-Kiss   Éva ')).toEqual(['szabo', 'kiss', 'eva']);
  });

  it('titulusokat elhagyja', () => {
    expect(normalizePatientName('Dr. Kovács Ágnes')).toEqual(['kovacs', 'agnes']);
    expect(normalizePatientName('Prof. Dr. Nagy Béla')).toEqual(['nagy', 'bela']);
  });

  it('üres / hiányzó névre üres lista', () => {
    expect(normalizePatientName(null)).toEqual([]);
    expect(normalizePatientName('   ')).toEqual([]);
  });
});

describe('levenshtein', () => {
  it('alapesetek', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', 'ab')).toBe(2);
    expect(levenshtein('kovacs', 'kovacz')).toBe(1);
  });
});

describe('namesSimilar', () => {
  it('pontos egyezés ékezet- és kisbetű-függetlenül', () => {
    expect(namesSimilar('Kovács Ágnes', 'KOVACS AGNES')).toBe(true);
  });

  it('szórend-független (magyar vs. nyugati névsorrend)', () => {
    expect(namesSimilar('Kovács Ágnes', 'Ágnes Kovács')).toBe(true);
  });

  it('titulus nem számít', () => {
    expect(namesSimilar('Dr. Kovács Ágnes', 'Kovács Ágnes')).toBe(true);
  });

  it('kis elgépelést tolerál', () => {
    expect(namesSimilar('Kovács Ágnes', 'Kovácz Ágnes')).toBe(true);
    expect(namesSimilar('Szabó Katalin', 'Szabo Katalim')).toBe(true);
  });

  it('különböző neveket nem jelez', () => {
    expect(namesSimilar('Kovács Ágnes', 'Nagy Béla')).toBe(false);
    expect(namesSimilar('Kiss Éva', 'Kiss Pál')).toBe(false);
  });

  it('rövid neveknél szigorúbb a küszöb', () => {
    // 'kiss eva' vs 'kis eva' — 1 távolság, rövid névnél még belefér
    expect(namesSimilar('Kiss Éva', 'Kis Éva')).toBe(true);
    // 2 távolság rövid névnél már nem
    expect(namesSimilar('Kiss Éva', 'Kósa Éva')).toBe(false);
  });

  it('üres név sosem hasonló', () => {
    expect(namesSimilar('', 'Kovács Ágnes')).toBe(false);
    expect(namesSimilar(null, null)).toBe(false);
  });
});

describe('maskedPatientLabel', () => {
  it('monogram + születési év', () => {
    expect(maskedPatientLabel('Kovács Ágnes', '1948-03-12')).toBe('K. Á. (szül. 1948)');
  });

  it('hiányzó dátumnál csak monogram', () => {
    expect(maskedPatientLabel('Kovács Ágnes', null)).toBe('K. Á.');
  });

  it('hiányzó névre placeholder', () => {
    expect(maskedPatientLabel(null, '1948-03-12')).toBe('Ismeretlen név (szül. 1948)');
  });
});
