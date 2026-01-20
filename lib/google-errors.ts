/**
 * Google OAuth és API hiba-detektálás helper függvények
 */

type GoogleOAuthErrorShape = {
  response?: {
    status?: number;
    data?: {
      error?: string;
      error_description?: string;
    };
    headers?: Record<string, string>;
  };
  code?: string;
  message?: string;
};

type GoogleApiErrorShape = {
  response?: {
    status?: number;
    data?: {
      error?: {
        errors?: Array<{
          reason?: string;
          message?: string;
          domain?: string;
        }>;
        code?: number;
        message?: string;
      };
    };
    headers?: Record<string, string>;
  };
  code?: string;
  message?: string;
};

/**
 * Google OAuth error response kinyerése
 */
export function extractGoogleOAuthError(err: unknown): {
  status?: number;
  error?: string;
  description?: string;
} {
  const e = err as GoogleOAuthErrorShape;
  const status = e?.response?.status;
  const data = e?.response?.data;
  const error = data?.error;
  const description = data?.error_description;
  return { status, error, description };
}

/**
 * Invalid grant hiba detektálása (user visszavonta hozzáférést, refresh token lejárt/érvénytelen)
 */
export function isInvalidGrant(err: unknown): boolean {
  const { error } = extractGoogleOAuthError(err);
  return error === 'invalid_grant';
}

/**
 * Invalid client vagy unauthorized client hiba detektálása (konfigurációs hiba)
 */
export function isInvalidClient(err: unknown): boolean {
  const { error } = extractGoogleOAuthError(err);
  return error === 'invalid_client' || error === 'unauthorized_client';
}

/**
 * Retry-álható transport vagy server hiba detektálása
 * - 429 (rate limiting)
 * - 5xx (server errors)
 * - Hálózati/timeout hibák (ETIMEDOUT, ECONNRESET, stb.)
 */
export function isRetryableTransportOrServer(err: unknown): boolean {
  const e = err as any;
  const status = e?.response?.status;

  // 429 (rate limiting)
  if (status === 429) {
    return true;
  }

  // 5xx server errors
  if (typeof status === 'number' && status >= 500) {
    return true;
  }

  // Hálózati/timeout hibák
  const code = e?.code;
  const retryableCodes = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'ECONNABORTED',
    'ETIMEDOUT',
  ]);

  if (code && retryableCodes.has(code)) {
    return true;
  }

  // Connection terminated, timeout jellegű üzenetek
  const message = e?.message || '';
  if (
    message.includes('Connection terminated') ||
    message.includes('timeout') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT')
  ) {
    return true;
  }

  return false;
}

/**
 * Google API error reason kinyerése (pl. 'insufficientPermissions', 'rateLimitExceeded')
 * Hasznos 403/429 hibák esetén a pontos ok meghatározásához
 */
export function extractGoogleApiReason(err: unknown): string | null {
  const e = err as GoogleApiErrorShape;
  const error = e?.response?.data?.error;
  
  if (!error) {
    return null;
  }

  // Google API errors[0].reason mező
  if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    const reason = error.errors[0].reason;
    if (reason) {
      return reason;
    }
  }

  return null;
}

/**
 * Google API error message kinyerése
 */
export function extractGoogleApiMessage(err: unknown): string | null {
  const e = err as GoogleApiErrorShape;
  const error = e?.response?.data?.error;
  
  if (!error) {
    return null;
  }

  if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors[0].message || null;
  }

  return error.message || null;
}

/**
 * HTTP status code kinyerése error-ból
 */
export function extractHttpStatus(err: unknown): number | null {
  const e = err as any;
  const status = e?.response?.status;
  return typeof status === 'number' ? status : null;
}
