import { describe, it, expect } from 'vitest';
import {
  foldAccents,
  normalizePersonName,
  resolveUniqueByName,
} from '@/lib/normalize-person-name';
import { normalizeName } from '@/lib/patient-name-recognition';
import { TOOTH_BASES } from '@/lib/tooth-base';

describe('normalizePersonName', () => {
  it('trims, lowercases and strips accents', () => {
    expect(normalizePersonName('  Dr. Kovács Béla  ')).toBe('dr. kovacs bela');
    expect(normalizePersonName('Dr. Tűz Győző')).toBe('dr. tuz gyozo');
  });

  it('treats null/undefined/blank as empty', () => {
    expect(normalizePersonName(null)).toBe('');
    expect(normalizePersonName(undefined)).toBe('');
    expect(normalizePersonName('   ')).toBe('');
  });
});

describe('foldAccents', () => {
  it('does not trim (tokenekre is használható)', () => {
    expect(foldAccents(' Á ')).toBe(' a ');
  });

  it('a chat-oldali normalizeName ugyanez a szabály', () => {
    // A patient-name-recognition re-exportál, nem újradefiniál — ha ez elromlik,
    // a beteg-felismerés és a névfeloldás megint elcsúszhat egymástól.
    expect(normalizeName).toBe(foldAccents);
  });
});

describe('resolveUniqueByName', () => {
  const rows = [
    { id: 'a', nev: 'Dr. Nagy Anna' },
    { id: 'b', nev: 'Dr. Kovács Béla' },
    { id: 'c', nev: 'dr. nagy anna' },
  ];

  it('egyértelmű találatnál visszaadja a jelöltet', () => {
    expect(resolveUniqueByName('Dr. Kovács Béla', rows, (r) => r.nev)?.id).toBe('b');
  });

  it('ékezet- és kisbetű-érzéketlenül egyezik', () => {
    expect(resolveUniqueByName('  dr. kovacs bela  ', rows, (r) => r.nev)?.id).toBe('b');
  });

  it('kétértelműnél null — sosem tippelünk', () => {
    // 'Dr. Nagy Anna' és 'dr. nagy anna' ugyanarra normalizálódik.
    expect(resolveUniqueByName('Dr. Nagy Anna', rows, (r) => r.nev)).toBeNull();
  });

  it('nulla találatnál és üres névnél null', () => {
    expect(resolveUniqueByName('Dr. Nincs Ilyen', rows, (r) => r.nev)).toBeNull();
    expect(resolveUniqueByName('   ', rows, (r) => r.nev)).toBeNull();
    expect(resolveUniqueByName(null, rows, (r) => r.nev)).toBeNull();
  });

  it('null nevű jelöltre nem illeszkedik üres név', () => {
    const withNull = [{ id: 'x', nev: null as string | null }];
    expect(resolveUniqueByName('', withNull, (r) => r.nev)).toBeNull();
  });
});

describe('TOOTH_BASES', () => {
  it('egyetlen forrás, duplikátum nélkül', () => {
    expect(new Set(TOOTH_BASES).size).toBe(TOOTH_BASES.length);
  });

  it('tartalmazza a hídtestet és a hiányzót (az isMissingBase ezekre épül)', () => {
    expect(TOOTH_BASES).toContain('missing');
    expect(TOOTH_BASES).toContain('bridge_pontic');
  });
});
