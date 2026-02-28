import { NextResponse } from 'next/server';
import { logger } from './logger';

export interface ApiError {
  message: string;
  statusCode: number;
  details?: unknown;
}

/**
 * Error response envelope – `error` is always a human-readable string so
 * client code can safely do `alert(data.error)`.  Structured metadata lives
 * in the optional `_errorMeta` field for debugging / logging consumers.
 */
export interface ApiErrorResponse {
  error: string;
  _errorMeta?: {
    name: string;
    status: number;
    code?: string;
    details?: unknown;
    correlationId?: string;
  };
}

/**
 * Közös error handler API route-okhoz
 * Strukturált error envelope-t ad vissza correlationId-vel
 */
export function handleApiError(
  error: unknown,
  defaultMessage: string = 'Hiba történt',
  correlationId?: string
): NextResponse {
  logger.error('API Error:', error);

  let name = 'ApiError';
  let status = 500;
  let message = defaultMessage;
  let code: string | undefined;
  let details: unknown;

  // Zod validation error
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError' && 'errors' in error) {
    name = 'ValidationError';
    status = 400;
    message = 'Érvénytelen adatok';
    details = (error as { errors: unknown }).errors;
  }
  // PostgreSQL error
  else if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string; detail?: string; constraint?: string; message?: string };

    if (pgError.code === '23505') {
      name = 'ConflictError';
      status = 409;
      code = 'UNIQUE_VIOLATION';
      message = 'Már létezik ilyen rekord';
      details = pgError.detail;
    } else if (pgError.code === '23503') {
      name = 'ValidationError';
      status = 400;
      code = 'FOREIGN_KEY_VIOLATION';
      message = 'Hivatkozott rekord nem található';
      details = pgError.detail;
    } else if (pgError.code === '23502') {
      name = 'ValidationError';
      status = 400;
      code = 'NOT_NULL_VIOLATION';
      message = 'Kötelező mező hiányzik';
      details = pgError.detail;
    } else {
      logger.error('PostgreSQL error:', {
        code: pgError.code,
        detail: pgError.detail,
        constraint: pgError.constraint,
      });
    }
  }
  // Standard Error object
  else if (error instanceof Error) {
    const isDevelopment = process.env.NODE_ENV === 'development';
    message = isDevelopment ? error.message : defaultMessage;
    name = error.name || 'ApiError';

    if ('status' in error && typeof (error as any).status === 'number') {
      status = (error as any).status;
    }
    if ('code' in error && (error as any).code) {
      code = (error as any).code;
    }
    if ('details' in error && (error as any).details) {
      details = (error as any).details;
    }
  }

  const body: ApiErrorResponse = {
    error: message,
    _errorMeta: { name, status, code, details, correlationId },
  };

  const response = NextResponse.json(body, { status });
  if (correlationId) {
    response.headers.set('x-correlation-id', correlationId);
  }
  return response;
}

/**
 * Wrapper függvény API route-okhoz, ami automatikusan kezeli a hibákat
 * @deprecated Use withCorrelation from lib/api/withCorrelation instead for correlationId support
 */
export function withErrorHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
  defaultErrorMessage: string = 'Hiba történt',
  correlationId?: string
) {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error, defaultErrorMessage, correlationId);
    }
  };
}

