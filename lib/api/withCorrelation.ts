import { NextRequest, NextResponse } from 'next/server';

/**
 * Generate correlation ID with fallback for runtime compatibility
 */
function generateCorrelationId(): string {
  // Try crypto.randomUUID() first (Node 16.7+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback: simple UUID v4 generator
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Route handler wrapper that adds correlation ID to requests and responses
 * 
 * Usage:
 * ```typescript
 * export const GET = withCorrelation(async (req, { correlationId }) => {
 *   // Your handler code
 *   // correlationId is available in the context
 *   return NextResponse.json({ data: '...' });
 * });
 * ```
 */
export function withCorrelation(
  handler: (
    req: NextRequest,
    ctx: { correlationId: string }
  ) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    // Header canonicalization: lowercase
    const correlationId =
      req.headers.get('x-correlation-id')?.toLowerCase() ||
      generateCorrelationId();
    
    const res = await handler(req, { correlationId });
    
    // Ensure correlation ID is in response header (lowercase)
    res.headers.set('x-correlation-id', correlationId);
    
    return res;
  };
}
