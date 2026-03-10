import { OHIP14Question, OHIP14Dimension, OHIP14Response } from './types';

/**
 * OHIP-14 kérdések és dimenziók
 * Oral Health Impact Profile - 14 kérdéses verzió
 */

export const ohip14Questions: OHIP14Question[] = [
  // Funkcionális korlátozás (Functional limitation)
  {
    id: 'q1',
    questionNumber: 1,
    question: 'Volt-e a szavak kiejtésével kapcsolatos gondja a fogak, a száj, vagy a protézis problémája miatt?',
    dimension: 'functional_limitation',
    dimensionHungarian: 'Funkcionális korlátozás',
  },
  {
    id: 'q2',
    questionNumber: 2,
    question: 'Észlelte-e, hogy az ízérzékelése romlott a fogak, a száj, vagy a protézis problémája miatt?',
    dimension: 'functional_limitation',
    dimensionHungarian: 'Funkcionális korlátozás',
  },
  // Fizikai fájdalom (Physical pain)
  {
    id: 'q3',
    questionNumber: 3,
    question: 'Érzett-e fokozott fájdalmat a szájában?',
    dimension: 'physical_pain',
    dimensionHungarian: 'Fizikai fájdalom',
  },
  {
    id: 'q4',
    questionNumber: 4,
    question: 'Előfordult, hogy kellemetlennek találta az evést a fogak, a száj, vagy a protézis problémája miatt?',
    dimension: 'physical_pain',
    dimensionHungarian: 'Fizikai fájdalom',
  },
  // Pszichológiai kellemetlenség (Psychological discomfort)
  {
    id: 'q5',
    questionNumber: 5,
    question: 'Érezte magát az elmúlt hónapokban zavarban a fogai, szája, vagy a protézise miatt?',
    dimension: 'psychological_discomfort',
    dimensionHungarian: 'Pszichológiai kellemetlenség',
  },
  {
    id: 'q6',
    questionNumber: 6,
    question: 'Érezte-e feszültnek magát a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémái miatt?',
    dimension: 'psychological_discomfort',
    dimensionHungarian: 'Pszichológiai kellemetlenség',
  },
  // Fizikai fogyatékosság (Physical disability)
  {
    id: 'q7',
    questionNumber: 7,
    question: 'Előfordult, hogy étrendje nem volt kielégítő a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'physical_disability',
    dimensionHungarian: 'Fizikai fogyatékosság',
  },
  {
    id: 'q8',
    questionNumber: 8,
    question: 'Abba kellett hagynia az étkezést a fogakkal, a szájjal, a protézissel kapcsolatos problémája miatt?',
    dimension: 'physical_disability',
    dimensionHungarian: 'Fizikai fogyatékosság',
  },
  // Pszichológiai fogyatékosság (Psychological disability)
  {
    id: 'q9',
    questionNumber: 9,
    question: 'Előfordult, hogy nehezen tudott feloldódni a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'psychological_disability',
    dimensionHungarian: 'Pszichológiai fogyatékosság',
  },
  {
    id: 'q10',
    questionNumber: 10,
    question: 'Feszélyezett volt-e a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'psychological_disability',
    dimensionHungarian: 'Pszichológiai fogyatékosság',
  },
  // Társasági fogyatékosság (Social disability)
  {
    id: 'q11',
    questionNumber: 11,
    question: 'Ingerlékenyebb volt-e másokkal a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'social_disability',
    dimensionHungarian: 'Társasági fogyatékosság',
  },
  {
    id: 'q12',
    questionNumber: 12,
    question: 'Voltak nehézségei a szokásos munkavégzésben a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'social_disability',
    dimensionHungarian: 'Társasági fogyatékosság',
  },
  // Hátrány (Handicap)
  {
    id: 'q13',
    questionNumber: 13,
    question: 'Érezte-e úgy, hogy Ön számára az élet kevésbé elfogadható a fogakkal, a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'handicap',
    dimensionHungarian: 'Hátrány',
  },
  {
    id: 'q14',
    questionNumber: 14,
    question: 'Előfordult, hogy teljesen képtelen volt bármit is csinálni a szájjal, vagy a protézissel kapcsolatos problémája miatt?',
    dimension: 'handicap',
    dimensionHungarian: 'Hátrány',
  },
];

export const ohip14Dimensions: OHIP14Dimension[] = [
  {
    id: 'functional_limitation',
    name: 'Functional limitation',
    nameHungarian: 'Funkcionális korlátozás',
    questions: ohip14Questions.filter((q) => q.dimension === 'functional_limitation'),
  },
  {
    id: 'physical_pain',
    name: 'Physical pain',
    nameHungarian: 'Fizikai fájdalom',
    questions: ohip14Questions.filter((q) => q.dimension === 'physical_pain'),
  },
  {
    id: 'psychological_discomfort',
    name: 'Psychological discomfort',
    nameHungarian: 'Pszichológiai kellemetlenség',
    questions: ohip14Questions.filter((q) => q.dimension === 'psychological_discomfort'),
  },
  {
    id: 'physical_disability',
    name: 'Physical disability',
    nameHungarian: 'Fizikai fogyatékosság',
    questions: ohip14Questions.filter((q) => q.dimension === 'physical_disability'),
  },
  {
    id: 'psychological_disability',
    name: 'Psychological disability',
    nameHungarian: 'Pszichológiai fogyatékosság',
    questions: ohip14Questions.filter((q) => q.dimension === 'psychological_disability'),
  },
  {
    id: 'social_disability',
    name: 'Social disability',
    nameHungarian: 'Társasági fogyatékosság',
    questions: ohip14Questions.filter((q) => q.dimension === 'social_disability'),
  },
  {
    id: 'handicap',
    name: 'Handicap',
    nameHungarian: 'Hátrány',
    questions: ohip14Questions.filter((q) => q.dimension === 'handicap'),
  },
];

/**
 * Helper függvények a score számításhoz
 */
export function calculateOHIP14Scores(response: Partial<OHIP14Response>): {
  totalScore: number;
  functionalLimitationScore: number;
  physicalPainScore: number;
  psychologicalDiscomfortScore: number;
  physicalDisabilityScore: number;
  psychologicalDisabilityScore: number;
  socialDisabilityScore: number;
  handicapScore: number;
} {
  const getValue = (val: number | null | undefined): number => (val !== null && val !== undefined ? val : 0);

  const functionalLimitationScore =
    getValue(response.q1_functional_limitation) + getValue(response.q2_functional_limitation);
  const physicalPainScore = getValue(response.q3_physical_pain) + getValue(response.q4_physical_pain);
  const psychologicalDiscomfortScore =
    getValue(response.q5_psychological_discomfort) + getValue(response.q6_psychological_discomfort);
  const physicalDisabilityScore =
    getValue(response.q7_physical_disability) + getValue(response.q8_physical_disability);
  const psychologicalDisabilityScore =
    getValue(response.q9_psychological_disability) + getValue(response.q10_psychological_disability);
  const socialDisabilityScore =
    getValue(response.q11_social_disability) + getValue(response.q12_social_disability);
  const handicapScore = getValue(response.q13_handicap) + getValue(response.q14_handicap);

  const totalScore =
    functionalLimitationScore +
    physicalPainScore +
    psychologicalDiscomfortScore +
    physicalDisabilityScore +
    psychologicalDisabilityScore +
    socialDisabilityScore +
    handicapScore;

  return {
    totalScore,
    functionalLimitationScore,
    physicalPainScore,
    psychologicalDiscomfortScore,
    physicalDisabilityScore,
    psychologicalDisabilityScore,
    socialDisabilityScore,
    handicapScore,
  };
}
