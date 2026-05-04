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
  /** Ha nincs hozzárendelt orvos: a kapcsolódó betegek nevei (egyedi, ABC). */
  unassignedPatientNames?: string[];
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

/**
 * Intake-javaslat nézőpontja:
 * - `PERSONAL`: a bejelentkezett kezelő orvos saját kapacitása alapján.
 *   Címke a felületen pl. „Fogadhatsz új beteget?".
 * - `TEAM`: a teljes fogpótlástanász csapat aggregált (MAX) terhelése alapján.
 *   Beutaló orvosok és saját adat nélküli adminok kapják. Címke pl.
 *   „Beutalhatsz új beteget?".
 */
export type IntakeViewMode = 'PERSONAL' | 'TEAM';

export interface IntakeRecommendationResponse {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reasons: string[];
  explain: {
    viewMode: IntakeViewMode;
    busynessScore: number;
    nearCriticalIfNewStarts: boolean;
    wipCount: number;
    wipCompletionP80Max: string | null;
    wipP80DaysFromNow: number | null;
    /**
     * Becsült legkorábbi dátum (ISO), amikor új beteg fogadása/beutalása újra
     * javasolt (CAUTION → GO, ill. STOP → CAUTION/GO). Hibrid heurisztika:
     * MAX(legterheltebb releváns orvos jelenleg foglalt perceinek 50%-os
     * kifutási dátuma, releváns WIP completion P80 − 28 nap). GO esetén `null`.
     */
    nextIntakeDate: string | null;
  };
  meta: {
    serverNow: string;
    fetchedAt: string;
    policyVersion: number;
  };
}
