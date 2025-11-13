import { NextResponse } from 'next/server';
import { logger } from './logger';

export interface ApiError {
  message: string;
  statusCode: number;
  details?: unknown;
}

/**
 * Közös error handler API route-okhoz
 */
export function handleApiError(error: unknown, defaultMessage: string = 'Hiba történt'): NextResponse {
  logger.error('API Error:', error);
  
  // Zod validation error
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError' && 'errors' in error) {
    return NextResponse.json(
      { error: 'Érvénytelen adatok', details: (error as { errors: unknown }).errors },
      { status: 400 }
    );
  }
  
  // PostgreSQL error
  if (error && typeof error === 'object' && 'code' in error) {
    const pgError = error as { code?: string; detail?: string; constraint?: string; message?: string };
    
    // Unique constraint violation
    if (pgError.code === '23505') {
      return NextResponse.json(
        { error: 'Már létezik ilyen rekord', details: pgError.detail },
        { status: 409 }
      );
    }
    
    // Foreign key violation
    if (pgError.code === '23503') {
      return NextResponse.json(
        { error: 'Hivatkozott rekord nem található', details: pgError.detail },
        { status: 400 }
      );
    }
    
    // Not null violation
    if (pgError.code === '23502') {
      return NextResponse.json(
        { error: 'Kötelező mező hiányzik', details: pgError.detail },
        { status: 400 }
      );
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
    const message = isDevelopment ? error.message : defaultMessage;
    
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
  
  // Unknown error
  return NextResponse.json(
    { error: defaultMessage },
    { status: 500 }
  );
}

/**
 * Wrapper függvény API route-okhoz, ami automatikusan kezeli a hibákat
 */
export function withErrorHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
  defaultErrorMessage: string = 'Hiba történt'
) {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error, defaultErrorMessage);
    }
  };
}

