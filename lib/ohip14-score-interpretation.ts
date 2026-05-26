/**
 * OHIP-14 pontszámértelmezés (0–56 összpont, dimenziónként 0–8).
 * Alacsonyabb pontszám = kevesebb szájhigiénés életminőség-re hatás.
 */

export type Ohip14ImpactLevel =
  | 'minimal'
  | 'mild'
  | 'moderate'
  | 'severe'
  | 'very_severe';

export interface Ohip14ImpactBand {
  level: Ohip14ImpactLevel;
  min: number;
  max: number;
  label: string;
  description: string;
}

export const OHIP14_TOTAL_MAX = 56;
export const OHIP14_DIMENSION_MAX = 8;

export const OHIP14_IMPACT_BANDS: Ohip14ImpactBand[] = [
  {
    level: 'minimal',
    min: 0,
    max: 8,
    label: 'Alacsony hatás',
    description: 'Minimális vagy elhanyagolható szájhigiénés életminőség-re hatás.',
  },
  {
    level: 'mild',
    min: 9,
    max: 18,
    label: 'Enyhe–közepes hatás',
    description: 'Enyhe, időnként zavaró hatás; általában jól kompenzálható.',
  },
  {
    level: 'moderate',
    min: 19,
    max: 28,
    label: 'Közepes hatás',
    description: 'Közepes mértékű, rendszeres életminőség-csökkenés egy vagy több dimenzióban.',
  },
  {
    level: 'severe',
    min: 29,
    max: 42,
    label: 'Jelentős hatás',
    description: 'Kifejezett hatás a mindennapi funkciókra, komfortra vagy társas érintettségre.',
  },
  {
    level: 'very_severe',
    min: 43,
    max: 56,
    label: 'Nagyon jelentős hatás',
    description: 'Súlyos, gyakori korlátozás; kiemelt klinikai figyelmet érdemel.',
  },
];

export const OHIP14_DIMENSION_LABELS: Record<string, string> = {
  functionalLimitationScore: 'Funkcionális korlátozás',
  physicalPainScore: 'Fizikai fájdalom',
  psychologicalDiscomfortScore: 'Pszichológiai kellemetlenség',
  physicalDisabilityScore: 'Fizikai fogyatékosság',
  psychologicalDisabilityScore: 'Pszichológiai fogyatékosság',
  socialDisabilityScore: 'Társasági fogyatékosság',
  handicapScore: 'Hátrány',
};

const DIMENSION_KEYS = [
  'functionalLimitationScore',
  'physicalPainScore',
  'psychologicalDiscomfortScore',
  'physicalDisabilityScore',
  'psychologicalDisabilityScore',
  'socialDisabilityScore',
  'handicapScore',
] as const;

export type Ohip14DimensionScoreKey = (typeof DIMENSION_KEYS)[number];

export function getOhip14ImpactBand(score: number): Ohip14ImpactBand {
  const clamped = Math.max(0, Math.min(OHIP14_TOTAL_MAX, Math.round(score)));
  return (
    OHIP14_IMPACT_BANDS.find((b) => clamped >= b.min && clamped <= b.max) ??
    OHIP14_IMPACT_BANDS[OHIP14_IMPACT_BANDS.length - 1]
  );
}

/** Rövid címke (konzilium / lista) */
export function getOhip14ImpactLabel(score: number): string {
  return getOhip14ImpactBand(score).label.toLowerCase();
}

/** Dimenzió részpont (0–8) rövid értelmezése */
export function getOhip14DimensionImpactLabel(score: number): string {
  const s = Math.max(0, Math.min(OHIP14_DIMENSION_MAX, Math.round(score)));
  if (s === 0) return 'nincs';
  if (s <= 2) return 'enyhe';
  if (s <= 4) return 'közepes';
  if (s <= 6) return 'jelentős';
  return 'nagyon jelentős';
}

export function getOhip14DimensionScores(
  response: Partial<Record<Ohip14DimensionScoreKey, number | null | undefined>>,
): Array<{ key: Ohip14DimensionScoreKey; label: string; score: number; impact: string }> {
  return DIMENSION_KEYS.map((key) => {
    const raw = response[key];
    const score = raw != null ? raw : 0;
    return {
      key,
      label: OHIP14_DIMENSION_LABELS[key] ?? key,
      score,
      impact: getOhip14DimensionImpactLabel(score),
    };
  });
}

export function getTopOhip14Dimensions(
  response: Partial<Record<Ohip14DimensionScoreKey, number | null | undefined>>,
  limit = 3,
): Array<{ label: string; score: number }> {
  return getOhip14DimensionScores(response)
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ label, score }) => ({ label, score }));
}
