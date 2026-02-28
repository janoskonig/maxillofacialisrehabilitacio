import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '../api-error-handler';

/**
 * Generate correlation ID with fallback for runtime compatibility
 */
function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type CorrelationContext = { correlationId: string };

/**
 * Route handler wrapper that:
 *  1. Generates / propagates a correlation ID
 *  2. Catches any thrown error and delegates to handleApiError
 *
 * Usage:
 * ```typescript
 * export const GET = withCorrelation(async (req, { correlationId }) => {
 *   const auth = await requireAuth(req);   // throws HttpError(401) if missing
 *   return NextResponse.json({ data: '...' });
 * });
 * ```
 */
export function withCorrelation(
  handler: (
    req: NextRequest,
    ctx: CorrelationContext
  ) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const correlationId =
      req.headers.get('x-correlation-id')?.toLowerCase() ||
      generateCorrelationId();

    try {
      const res = await handler(req, { correlationId });
      res.headers.set('x-correlation-id', correlationId);
      return res;
    } catch (error) {
      return handleApiError(error, 'Hiba történt', correlationId);
    }
  };
}
