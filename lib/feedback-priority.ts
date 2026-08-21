export type FeedbackPriority = 'critical' | 'high' | 'medium' | 'low';

export type FeedbackPriorityInput = {
  type: string;
  title?: string | null;
  description?: string | null;
  errorLog?: string | null;
  errorStack?: string | null;
};

export type FeedbackPriorityResult = {
  priority: FeedbackPriority;
  score: number;
  reasons: string[];
};

const TYPE_SCORES: Record<string, number> = {
  crash: 70,
  error: 55,
  bug: 40,
  other: 25,
  suggestion: 15,
};

const SIGNALS: Array<{ pattern: RegExp; points: number; reason: string }> = [
  {
    pattern: /adatveszt[eé]s|data loss|adatsziv[aá]rg[aá]s|data breach|biztons[aá]gi incidens|security breach/i,
    points: 40,
    reason: 'adatbiztonsági vagy adatvesztési jelzés',
  },
  {
    pattern: /teljes le[aá]ll[aá]s|rendszer le[aá]llt|system down|service unavailable|nem el[eé]rhet[oő]/i,
    points: 25,
    reason: 'szolgáltatáskiesésre utaló jelzés',
  },
  {
    pattern: /nem lehet bel[eé]pni|cannot log in|bejelentkez[eé]s nem m[uű]k[oö]dik|minden felhaszn[aá]l[oó]|all users/i,
    points: 20,
    reason: 'széles felhasználói hatásra utaló jelzés',
  },
  {
    pattern: /jogosulatlan|unauthori[sz]ed|forbidden|permission denied/i,
    points: 15,
    reason: 'hozzáférési vagy jogosultsági probléma',
  },
];

export function priorityFromScore(score: number): FeedbackPriority {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export function scoreForPriority(priority: FeedbackPriority): number {
  return { critical: 90, high: 65, medium: 40, low: 15 }[priority];
}

export function classifyFeedbackPriority(input: FeedbackPriorityInput): FeedbackPriorityResult {
  const baseScore = TYPE_SCORES[input.type] ?? TYPE_SCORES.other;
  const reasons = [`típus: ${input.type}`];
  const searchable = [input.title, input.description, input.errorLog, input.errorStack]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');

  let score = baseScore;
  for (const signal of SIGNALS) {
    if (signal.pattern.test(searchable)) {
      score += signal.points;
      reasons.push(signal.reason);
    }
  }

  score = Math.min(100, score);
  return { priority: priorityFromScore(score), score, reasons };
}

export const FEEDBACK_PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  critical: 'Kritikus',
  high: 'Magas',
  medium: 'Közepes',
  low: 'Alacsony',
};
