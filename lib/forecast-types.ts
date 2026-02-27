/**
 * Forecast API types — shared between batch API, aggregate, and intake.
 */

export interface EpisodeForecastItem {
  status: 'ready' | 'blocked';
  assumptions: string[];
  remainingVisitsP50?: number;
  remainingVisitsP80?: number;
  completionWindowStart?: string;
  completionWindowEnd?: string;
  stepCode?: string;
  nextStepWindow?: { start: string; end: string };
}

export interface EpisodeForecastBatchResponse {
  forecasts: Record<string, EpisodeForecastItem>;
  meta: {
    serverNow: string;
    fetchedAt: string;
    timezone: 'Europe/Budapest';
    dateDomain: 'TIMESTAMPTZ_INCLUSIVE';
    episodeCountRequested: number;
    episodeCountReturned: number;
    limit: 100;
    limitApplied: boolean;
  };
}

export interface DoctorWipForecast {
  providerId: string | null;
  providerName: string | null;
  providerEmail: string | null;
  wipCount: number;
  wipCompletionP50Max: string | null;
  wipCompletionP80Max: string | null;
  wipVisitsRemainingP50Sum: number;
  wipVisitsRemainingP80Sum: number;
}

export interface ForecastAggregateResponse {
  wipCount: number;
  wipCompletionP50Max: string | null;
  wipCompletionP80Max: string | null;
  wipVisitsRemainingP50Sum: number;
  wipVisitsRemainingP80Sum: number;
  byDoctor: DoctorWipForecast[];
  meta: {
    serverNow: string;
    fetchedAt: string;
    timezone: 'Europe/Budapest';
    dateDomain: 'TIMESTAMPTZ_INCLUSIVE';
    queryEcho: { horizonDays: number };
    episodeCountIncluded: number;
  };
}

export interface IntakeRecommendationResponse {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reasons: string[];
  explain: {
    busynessScore: number;
    nearCriticalIfNewStarts: boolean;
    source: 'MAX_OVER_DOCTORS';
    wipCount: number;
    wipCompletionP80Max: string | null;
    wipP80DaysFromNow: number | null;
  };
  meta: {
    serverNow: string;
    fetchedAt: string;
    policyVersion: number;
  };
}
