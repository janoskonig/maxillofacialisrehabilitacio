/**
 * Adat-plauzibilitási / konzisztencia ellenőrzések — TANÁCSADÓ figyelmeztetések
 * (nem blokkolnak). A cél a statisztikai feldolgozhatóság javítása: az olyan
 * gépelési/logikai hibák kiszűrése, amelyek elrontják az elemzést vagy a beteg
 * azonosítását (pl. hibás TAJ ellenőrzőszám, lehetetlen dátumok).
 */

export type PlausibilityWarning = {
  /** Stabil kód a géphez (UI/elemzés). */
  code: string;
  /** Mezőkulcs, amelyhez a figyelmeztetés tartozik. */
  field: string;
  /** Ember által olvasható üzenet. */
  message: string;
};

/** Csak a számjegyek. */
function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/**
 * Magyar TAJ (9 számjegy) ellenőrzőszám-validáció. A 9. számjegy az első 8-ból
 * számolható: a páratlan helyiértékűeket (1.,3.,5.,7.) 3-mal, a páros
 * helyiértékűeket (2.,4.,6.,8.) 7-tel szorozzuk, az összeg 10-es maradéka az
 * ellenőrzőszám. Üres / nem 9 jegyű TAJ-t NEM tekintünk érvénytelennek itt
 * (a kötelezőség/hossz külön szabály) — csak a 9 jegyűek ellenőrzőszámát nézzük.
 */
export function isValidTajChecksum(taj: string | null | undefined): boolean {
  const d = digits(taj);
  if (d.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const digit = d.charCodeAt(i) - 48;
    // 1-indexelt helyiérték: páratlan → 3, páros → 7.
    sum += digit * ((i % 2 === 0) ? 3 : 7);
  }
  return sum % 10 === d.charCodeAt(8) - 48;
}

/** YYYY-MM-DD (vagy ISO) → Date, vagy null ha értelmezhetetlen. */
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MAX_PLAUSIBLE_AGE_YEARS = 120;

/**
 * Plauzibilitási figyelmeztetések egy beteg adataira. Csak akkor jelez, ha az
 * adott mező jelen van és valóban gyanús — a hiányt NEM tekinti hibának
 * (azt az adat-teljességi logika kezeli).
 */
export function getPlausibilityWarnings(p: {
  taj?: string | null;
  szuletesiDatum?: string | null;
  halalDatum?: string | null;
}): PlausibilityWarning[] {
  const warnings: PlausibilityWarning[] = [];
  const now = new Date();

  // TAJ ellenőrzőszám (csak 9 jegyű, kitöltött TAJ-nál).
  if (digits(p.taj).length === 9 && !isValidTajChecksum(p.taj)) {
    warnings.push({
      code: 'taj_checksum',
      field: 'taj',
      message: 'A TAJ ellenőrzőszáma nem stimmel (elgépelés?).',
    });
  }

  const birth = parseDate(p.szuletesiDatum);
  const death = parseDate(p.halalDatum);

  if (birth) {
    if (birth.getTime() > now.getTime()) {
      warnings.push({
        code: 'birth_future',
        field: 'szuletesiDatum',
        message: 'A születési dátum a jövőben van.',
      });
    } else {
      const ageYears = (now.getTime() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears > MAX_PLAUSIBLE_AGE_YEARS) {
        warnings.push({
          code: 'age_implausible',
          field: 'szuletesiDatum',
          message: `Az életkor irreális (>${MAX_PLAUSIBLE_AGE_YEARS} év).`,
        });
      }
    }
  }

  if (birth && death && death.getTime() < birth.getTime()) {
    warnings.push({
      code: 'death_before_birth',
      field: 'halalDatum',
      message: 'A halálozási dátum a születési dátum előtt van.',
    });
  }

  return warnings;
}
