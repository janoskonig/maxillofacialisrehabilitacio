/**
 * Event logger utility - PHI-mentes, fire-and-forget event logging
 * 
 * Usage:
 * ```typescript
 * import { logEvent } from '@/lib/event-logger';
 * 
 * logEvent('autosave_attempt', { source: 'auto', patientId: '...' });
 * ```
 */

// Whitelist of allowed event types
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

export type EventType = typeof ALLOWED_EVENT_TYPES[number];

interface EventMetadata {
  source?: 'auto' | 'manual';
  durationMs?: number;
  status?: number;
  errorName?: string;
  code?: string;
  patientId?: string; // Will be hashed
  correlationId?: string;
  [key: string]: unknown; // Allow additional metadata
}

/**
 * Hash a patient ID for privacy (simple hash, not cryptographic)
 */
function hashPatientId(patientId: string): string {
  // Simple hash function (not cryptographic, just for anonymization)
  let hash = 0;
  for (let i = 0; i < patientId.length; i++) {
    const char = patientId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get current page path (client-side only)
 */
function getCurrentPage(): string {
  if (typeof window === 'undefined') return 'unknown';
  return window.location.pathname;
}

/**
 * Get app version (if available from env or package.json)
 */
function getAppVersion(): string | undefined {
  // Could be set via env var or build-time injection
  if (typeof window !== 'undefined' && (window as any).__APP_VERSION__) {
    return (window as any).__APP_VERSION__;
  }
  return undefined;
}

/**
 * Log an event (fire-and-forget, never throws)
 * 
 * @param type - Event type (must be in whitelist)
 * @param metadata - Event metadata (PHI-free)
 * @param correlationId - Optional correlation ID from response headers
 */
export function logEvent(
  type: EventType,
  metadata: EventMetadata = {},
  correlationId?: string
): void {
  // Fire-and-forget: don't block execution
  // Use setTimeout to ensure it doesn't block the main thread
  setTimeout(() => {
    try {
      // Validate event type
      if (!ALLOWED_EVENT_TYPES.includes(type)) {
        console.warn(`[EventLogger] Invalid event type: ${type}`);
        return;
      }

      // Prepare event payload
      const eventPayload: {
        type: EventType;
        timestamp: string;
        page: string;
        appVersion?: string;
        correlationId?: string;
        metadata: Omit<EventMetadata, 'patientId' | 'correlationId'> & {
          patientIdHash?: string;
        };
      } = {
        type,
        timestamp: new Date().toISOString(),
        page: getCurrentPage(),
        metadata: {
          ...metadata,
        },
      };

      // Add app version if available
      const appVersion = getAppVersion();
      if (appVersion) {
        eventPayload.appVersion = appVersion;
      }

      // Add correlation ID (from parameter or metadata)
      const finalCorrelationId = correlationId || metadata.correlationId;
      if (finalCorrelationId) {
        eventPayload.correlationId = finalCorrelationId;
      }

      // Hash patient ID if present
      if (metadata.patientId) {
        eventPayload.metadata.patientIdHash = hashPatientId(metadata.patientId);
        delete eventPayload.metadata.patientId;
      }

      // Remove correlationId from metadata (it's in the root)
      if (eventPayload.metadata.correlationId) {
        delete eventPayload.metadata.correlationId;
      }

      // Send event (fire-and-forget, swallow errors)
      fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(eventPayload),
      }).catch((error) => {
        // Silently swallow errors - event logging should never break the app
        if (process.env.NODE_ENV === 'development') {
          console.debug('[EventLogger] Failed to send event:', error);
        }
      });
    } catch (error) {
      // Silently swallow all errors - event logging should never break the app
      if (process.env.NODE_ENV === 'development') {
        console.debug('[EventLogger] Error in logEvent:', error);
      }
    }
  }, 0);
}
