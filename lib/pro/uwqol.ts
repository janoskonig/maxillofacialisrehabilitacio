/**
 * UW-QOL v4 (University of Washington Quality of Life, 4. verzió) — fej-nyak
 * onkológiai életminőség mérőeszköz, a maxillofaciális onko-rehabilitációs
 * populációra standard.
 *
 * SZERZŐI JOG: a kérdések és válaszopciók szövege, valamint az opció→pontszám
 * leképezés a University of Washington tulajdona — ezeket NEM építjük be ide.
 * Itt csak a doménenkénti, már kiszámolt 0–100 pontszámot tároljuk (amit a
 * klinikus/beteg a hivatalos, licencelt eszközből nyer), és ebből számoljuk a
 * standard összegzőket:
 *   - Physical function alskála  = a fizikai domének átlaga (0–100),
 *   - Social-emotional alskála   = a szociális-érzelmi domének átlaga (0–100),
 *   - Composite                  = mind a 12 domén átlaga (0–100).
 * (Magasabb = jobb életminőség.)
 *
 * Alskála-tagság: Rogers et al. (UW-QOL v4) szerint.
 */

export type UwqolSubscale = 'physical' | 'social_emotional';

export interface UwqolDomain {
  key: string;
  label: string;
  subscale: UwqolSubscale;
}

/** A 12 UW-QOL v4 domén (semleges, leíró címkékkel — nem a védett kérdésszöveg). */
export const UWQOL_DOMAINS: UwqolDomain[] = [
  { key: 'pain', label: 'Fájdalom', subscale: 'social_emotional' },
  { key: 'appearance', label: 'Megjelenés', subscale: 'physical' },
  { key: 'activity', label: 'Aktivitás', subscale: 'social_emotional' },
  { key: 'recreation', label: 'Szabadidő', subscale: 'social_emotional' },
  { key: 'swallowing', label: 'Nyelés', subscale: 'physical' },
  { key: 'chewing', label: 'Rágás', subscale: 'physical' },
  { key: 'speech', label: 'Beszéd', subscale: 'physical' },
  { key: 'shoulder', label: 'Vállfunkció', subscale: 'social_emotional' },
  { key: 'taste', label: 'Ízérzés', subscale: 'physical' },
  { key: 'saliva', label: 'Nyáltermelés', subscale: 'physical' },
  { key: 'mood', label: 'Hangulat', subscale: 'social_emotional' },
  { key: 'anxiety', label: 'Szorongás', subscale: 'social_emotional' },
];

export const UWQOL_DOMAIN_KEYS = UWQOL_DOMAINS.map((d) => d.key);
export const UWQOL_INSTRUMENT_CODE = 'UWQOL';

export interface UwqolScores {
  /** Fizikai funkció alskála (a fizikai domének átlaga), null ha egyik sincs kitöltve. */
  physicalSubscale: number | null;
  /** Szociális-érzelmi alskála (a szoc.-érzelmi domének átlaga), null ha egyik sincs. */
  socialEmotionalSubscale: number | null;
  /** Kompozit (mind a 12 domén átlaga), null ha egyik sincs. */
  composite: number | null;
  /** Hány érvényes domén-pontszám szerepelt. */
  answeredDomains: number;
}

/** Érvényes domén-pontszám: 0 és 100 közötti szám. */
export function isValidDomainScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(m * 100) / 100;
}

/**
 * UW-QOL pontszámok a doménenkénti 0–100 értékekből. Csak az érvényes (0–100
 * szám) doméneket veszi figyelembe; a hiányzókat kihagyja (nem 0-ként számolja).
 */
export function scoreUwqol(answers: Record<string, unknown>): UwqolScores {
  const present: { domain: UwqolDomain; score: number }[] = [];
  for (const domain of UWQOL_DOMAINS) {
    const v = answers[domain.key];
    if (isValidDomainScore(v)) present.push({ domain, score: v });
  }

  const physical = present.filter((p) => p.domain.subscale === 'physical').map((p) => p.score);
  const social = present.filter((p) => p.domain.subscale === 'social_emotional').map((p) => p.score);

  return {
    physicalSubscale: mean(physical),
    socialEmotionalSubscale: mean(social),
    composite: mean(present.map((p) => p.score)),
    answeredDomains: present.length,
  };
}
