import { NextResponse } from 'next/server';
import { logger } from './logger';

export interface ApiError {
  message: string;
  statusCode: number;
  details?: unknown;
}

/**
 * Strukturált error response envelope
 */
export interface ApiErrorResponse {
  error: {
    name: string;
    status: number;
    code?: string;
    message: string;
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
  
  const errorResponse: ApiErrorResponse['error'] = {
    name: 'ApiError',
    status: 500,
    message: defaultMessage,
    correlationId,
  };
  
  // Zod validation error
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError' && 'errors' in error) {
    errorResponse.name = 'ValidationError';
    errorResponse.status = 400;
    errorResponse.message = 'Érvénytelen adatok';
    errorResponse.details = (error as { errors: unknown }).errors;
    
    const response = NextResponse.json(
      { error: errorResponse },
      { status: 400 }
    );
    if (correlationId) {
      response.headers.set('x-correlation-id', correlationId);
    }
    return response;
  }
  
  // PostgreSQL error
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string; detail?: string; constraint?: string; message?: string };
    
    // Unique constraint violation
    if (pgError.code === '23505') {
      errorResponse.name = 'ConflictError';
      errorResponse.status = 409;
      errorResponse.code = 'UNIQUE_VIOLATION';
      errorResponse.message = 'Már létezik ilyen rekord';
      errorResponse.details = pgError.detail;
      
      const response = NextResponse.json(
        { error: errorResponse },
        { status: 409 }
      );
      if (correlationId) {
        response.headers.set('x-correlation-id', correlationId);
      }
      return response;
    }
    
    // Foreign key violation
    if (pgError.code === '23503') {
      errorResponse.name = 'ValidationError';
      errorResponse.status = 400;
      errorResponse.code = 'FOREIGN_KEY_VIOLATION';
      errorResponse.message = 'Hivatkozott rekord nem található';
      errorResponse.details = pgError.detail;
      
      const response = NextResponse.json(
        { error: errorResponse },
        { status: 400 }
      );
      if (correlationId) {
        response.headers.set('x-correlation-id', correlationId);
      }
      return response;
    }
    
    // Not null violation
    if (pgError.code === '23502') {
      errorResponse.name = 'ValidationError';
      errorResponse.status = 400;
      errorResponse.code = 'NOT_NULL_VIOLATION';
      errorResponse.message = 'Kötelező mező hiányzik';
      errorResponse.details = pgError.detail;
      
      const response = NextResponse.json(
        { error: errorResponse },
        { status: 400 }
      );
      if (correlationId) {
        response.headers.set('x-correlation-id', correlationId);
      }
      return response;
    }
    
    logger.error('PostgreSQL error:', {
      code: pgError.code,
      detail: pgError.detail,
      constraint: pgError.constraint,
    });
  }
  
  // Standard Error object
  if (error instanceof Error) {
    // Don't expose internal error messages in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    errorResponse.message = isDevelopment ? error.message : defaultMessage;
    errorResponse.name = error.name || 'ApiError';
    
    // Check if error has status property (custom ApiError)
    if ('status' in error && typeof (error as any).status === 'number') {
      errorResponse.status = (error as any).status;
    }
    if ('code' in error && (error as any).code) {
      errorResponse.code = (error as any).code;
    }
    if ('details' in error && (error as any).details) {
      errorResponse.details = (error as any).details;
    }
    
    const response = NextResponse.json(
      { error: errorResponse },
      { status: errorResponse.status }
    );
    if (correlationId) {
      response.headers.set('x-correlation-id', correlationId);
    }
    return response;
  }
  
  // Unknown error
  const response = NextResponse.json(
    { error: errorResponse },
    { status: 500 }
  );
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

