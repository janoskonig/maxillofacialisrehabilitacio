/**
 * Error taxonomy – mapServerErrorToUiAction.
 * Backend error → UI action (OverrideModal, SlotInlineBanner, toast, stb.)
 */

import { BOOKING_ERROR_CODES } from './scheduling-ui-constants';

export type UiActionKind =
  | 'override_modal'
  | 'slot_inline_banner'
  | 'row_needs_review'
  | 'toast_retry'
  | 'toast_copy_details'
  | 'hard_redirect'
  | 'form_error_inline';

export interface MapServerErrorResult {
  kind: UiActionKind;
  code: string;
  userMessage: string;
  retryable: boolean;
  debugId?: string;
  reason?: 'unknown_code' | 'missing_code' | 'non_json' | 'network';
}

export function mapServerErrorToUiAction(err: {
  status?: number;
  body?: unknown;
  code?: string;
  error?: string;
  requestId?: string;
  traceId?: string;
}): MapServerErrorResult {
  const debugId = err.requestId ?? err.traceId ?? undefined;

  if (err.code === BOOKING_ERROR_CODES.ONE_HARD_NEXT_VIOLATION) {
    return {
      kind: 'override_modal',
      code: BOOKING_ERROR_CODES.ONE_HARD_NEXT_VIOLATION,
      userMessage: err.error ?? 'Epizódnak már van jövőbeli munkafoglalása',
      retryable: true,
      debugId,
    };
  }

  if (err.code === 'SLOT_ALREADY_BOOKED' || err.code === BOOKING_ERROR_CODES.SLOT_ALREADY_BOOKED) {
    return {
      kind: 'slot_inline_banner',
      code: BOOKING_ERROR_CODES.SLOT_ALREADY_BOOKED,
      userMessage: err.error ?? 'A slot már foglalt.',
      retryable: true,
      debugId,
    };
  }

  if (err.status === 401 || err.code === 'NOT_AUTHORIZED') {
    return {
      kind: 'hard_redirect',
      code: BOOKING_ERROR_CODES.NOT_AUTHORIZED,
      userMessage: err.error ?? 'Nincs jogosultság.',
      retryable: false,
      debugId,
    };
  }

  if (err.status === 403) {
    return {
      kind: 'hard_redirect',
      code: BOOKING_ERROR_CODES.NOT_AUTHORIZED,
      userMessage: err.error ?? 'Hozzáférés megtagadva.',
      retryable: false,
      debugId,
    };
  }

  if (err.status === 400 || err.status === 422) {
    const code = err.code ?? (err.status === 400 ? 'WINDOW_INVALID' : 'UNKNOWN_SERVER_ERROR');
    return {
      kind: 'form_error_inline',
      code,
      userMessage: (typeof err.error === 'string' ? err.error : 'Érvénytelen adat') ?? 'Érvénytelen adat',
      retryable: true,
      debugId,
    };
  }

  if (err.status === 500) {
    return {
      kind: 'toast_retry',
      code: err.code ?? BOOKING_ERROR_CODES.UNKNOWN_SERVER_ERROR,
      userMessage: err.error ?? 'Szerver hiba.',
      retryable: true,
      debugId,
    };
  }

  // Known code but unmapped
  if (err.code && !['ONE_HARD_NEXT_VIOLATION', 'SLOT_ALREADY_BOOKED'].includes(err.code)) {
    return {
      kind: 'toast_copy_details',
      code: BOOKING_ERROR_CODES.UNKNOWN_SERVER_ERROR,
      userMessage: err.error ?? 'Ismeretlen hiba.',
      retryable: false,
      debugId,
      reason: 'unknown_code',
    };
  }

  // No code (proxy HTML, fetch fail)
  if (!err.code) {
    return {
      kind: 'toast_copy_details',
      code: BOOKING_ERROR_CODES.UNKNOWN_SERVER_ERROR,
      userMessage: 'Hiba történt. Próbáld újra.',
      retryable: true,
      debugId,
      reason: 'missing_code',
    };
  }

  return {
    kind: 'toast_copy_details',
    code: BOOKING_ERROR_CODES.UNKNOWN_SERVER_ERROR,
    userMessage: err.error ?? 'Ismeretlen hiba.',
    retryable: false,
    debugId,
  };
}

/**
 * Parse fetch/response error into mapServerErrorToUiAction input.
 */
export async function parseFetchError(response: Response, body?: unknown): Promise<MapServerErrorResult> {
  let parsed: { code?: string; error?: string; requestId?: string; traceId?: string } = {};
  if (body && typeof body === 'object' && 'code' in body) {
    parsed = body as typeof parsed;
  }
  return mapServerErrorToUiAction({
    status: response.status,
    body,
    code: parsed.code,
    error: parsed.error ?? (typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : undefined),
    requestId: parsed.requestId,
    traceId: parsed.traceId,
  });
}
