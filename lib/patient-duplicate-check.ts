/**
 * Lehetséges beteg-duplikátumok felismerése a gyors felvétel közben.
 *
 * Két jelzési szint:
 *  - 'taj': a normalizált TAJ pontosan egyezik egy meglévő beteggel
 *    (a mentést a POST /api/patients amúgy is 409-cel blokkolja);
 *  - 'nev_datum': azonos születési dátum ÉS hasonló (normalizált) név —
 *    ez csak figyelmeztetés, a mentést nem blokkolja. Az elgépelt vagy
 *    hiányzó TAJ-jal újra rögzített beteget hivatott elkapni.
 */

export type DuplicateMatchType = 'taj' | 'nev_datum';

export interface DuplicateMatch {
  matchType: DuplicateMatchType;
  /** Maszkolt találatnál nincs id (a hívó nem nyithatja meg a kartont). */
  patientId: string | null;
  /** Megjelenítendő címke: teljes név, vagy maszkolt (monogram + születési év). */
  displayLabel: string;
  masked: boolean;
}

/** TAJ normalizálás: csak számjegyek maradnak. */
export function normalizeTaj(taj: string | null | undefined): string {
  return (taj ?? '').replace(/\D/g, '');
}

/** A normalizált TAJ akkor kereshető, ha teljes (9 számjegy). */
export function isSearchableTaj(taj: string | null | undefined): boolean {
  return normalizeTaj(taj).length === 9;
}

// Titulusok, amik nem részei az azonosító névnek.
const NAME_STOPWORDS = new Set(['dr', 'prof', 'ifj', 'id', 'ozv']);

/**
 * Név normalizálás összehasonlításhoz: kisbetű, ékezetek eltávolítása,
 * írásjelek szóközre cserélése, titulusok elhagyása.
 */
export function normalizePatientName(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter(token => token.length > 0 && !NAME_STOPWORDS.has(token));
}

/** Levenshtein-távolság (kis stringekre; a nevek rövidek). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Két név hasonló-e: normalizált tokenek szórend-függetlenül (rendezve)
 * összefűzve egyeznek, vagy a Levenshtein-távolság kicsi (hossz-arányos
 * küszöb: 1 hiba rövid névnél, 2 hosszabbnál).
 */
export function namesSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const tokensA = normalizePatientName(a);
  const tokensB = normalizePatientName(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const joinedA = [...tokensA].sort().join(' ');
  const joinedB = [...tokensB].sort().join(' ');
  if (joinedA === joinedB) return true;

  const maxLen = Math.max(joinedA.length, joinedB.length);
  const threshold = maxLen >= 10 ? 2 : 1;
  return levenshtein(joinedA, joinedB) <= threshold;
}

/** Monogram + születési év a maszkolt (beutaló orvosnak szánt) találathoz. */
export function maskedPatientLabel(nev: string | null | undefined, szuletesiDatum: string | Date | null | undefined): string {
  const initials = (nev ?? '')
    .split(/\s+/)
    .filter(part => part.length > 0)
    .map(part => `${part[0].toUpperCase()}.`)
    .join(' ');
  const year = szuletesiDatum ? String(szuletesiDatum).slice(0, 4) : null;
  const label = initials || 'Ismeretlen név';
  return year ? `${label} (szül. ${year})` : label;
}
