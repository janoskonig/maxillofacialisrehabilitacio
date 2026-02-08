import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { withCorrelation } from '@/lib/api/withCorrelation';
import { handleApiError } from '@/lib/api-error-handler';

// Whitelist of allowed event types (must match lib/event-logger.ts)
const ALLOWED_EVENT_TYPES = [
  'autosave_attempt',
  'autosave_success',
  'autosave_fail',
  'manualsave_attempt',
  'manualsave_success',
  'manualsave_fail',
  'neak_export_attempt',
  'neak_export_success',
  'neak_export_fail',
] as const;

type EventType = typeof ALLOWED_EVENT_TYPES[number];

interface EventPayload {
  type: string;
  timestamp: string;
  page: string;
  appVersion?: string;
  correlationId?: string;
  metadata: {
    source?: 'auto' | 'manual';
    durationMs?: number;
    status?: number;
    errorName?: string;
    code?: string;
    patientIdHash?: string;
    [key: string]: unknown;
  };
}

// Max metadata size: 5 KB (JSON stringified)
const MAX_METADATA_SIZE = 5 * 1024;

/**
 * Hash user email for privacy (simple hash, not cryptographic)
 */
function hashUserId(userEmail: string): string {
  let hash = 0;
  for (let i = 0; i < userEmail.length; i++) {
    const char = userEmail.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export const POST = withCorrelation(async (req: NextRequest, { correlationId }) => {
  try {
    // Optional auth (events can be logged even without auth for some events)
    const auth = await verifyAuth(req);
    const userEmail = auth?.email;
    const userIdHash = userEmail ? hashUserId(userEmail) : null;

    const body: EventPayload = await req.json();

    // Validate event type
    if (!ALLOWED_EVENT_TYPES.includes(body.type as EventType)) {
      return NextResponse.json(
        {
          error: {
            name: 'ValidationError',
            status: 400,
            message: `Invalid event type: ${body.type}. Allowed types: ${ALLOWED_EVENT_TYPES.join(', ')}`,
            correlationId,
          },
        },
        { status: 400 }
      );
    }

    // Validate metadata size
    const metadataSize = JSON.stringify(body.metadata).length;
    if (metadataSize > MAX_METADATA_SIZE) {
      return NextResponse.json(
        {
          error: {
            name: 'ValidationError',
            status: 400,
            message: `Metadata too large: ${metadataSize} bytes (max: ${MAX_METADATA_SIZE} bytes)`,
            correlationId,
          },
        },
        { status: 400 }
      );
    }

    // Store event in database
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO events (type, metadata, correlation_id, user_id_hash, patient_id_hash, page, app_version, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)`,
      [
        body.type,
        JSON.stringify(body.metadata),
        body.correlationId || correlationId,
        userIdHash,
        body.metadata.patientIdHash || null,
        body.page || 'unknown',
        body.appVersion || null,
        body.timestamp ? new Date(body.timestamp) : new Date(),
      ]
    );

    // Return 204 No Content (success, no body needed)
    const response = NextResponse.json(null, { status: 204 });
    response.headers.set('x-correlation-id', correlationId);
    return response;
  } catch (error: any) {
    console.error('Error logging event:', error);
    return handleApiError(error, 'Hiba az event logolása során', correlationId);
  }
});
