// Sentry server-side configuration
// This file configures Sentry for the server-side code (API routes, server components)

import * as Sentry from '@sentry/nextjs';

// Feature flag: ENABLE_SENTRY
const ENABLE_SENTRY = process.env.ENABLE_SENTRY === 'true';
const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = process.env.NODE_ENV || 'development';

if (ENABLE_SENTRY && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,
    
    // Sampling rates
    tracesSampleRate: 0.01, // 1% of transactions
    replaysSessionSampleRate: 0, // No session replays initially
    replaysOnErrorSampleRate: 0, // No error replays initially
    
    // Release tracking (optional, can be set via env var)
    release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    
    // PII scrubbing and filtering
    beforeSend(event, hint) {
      // Feature flag check
      if (!ENABLE_SENTRY) {
        return null; // Drop event
      }

      // PII scrubbing: Remove sensitive user data
      if (event.user) {
        // Remove email and username (PII)
        delete event.user.email;
        delete event.user.username;
        // Keep only safe identifiers (hashes, not raw emails)
      }

      // Scrub request data (breadcrumbs, request body)
      if (event.request) {
        // Truncate request data to prevent PII leakage
        if (event.request.data) {
          // Remove or truncate request data
          event.request.data = '[Redacted - may contain PII]';
        }
        // Keep URL and method (safe)
      }

      // Scrub breadcrumbs that might contain PII
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          if (crumb.data) {
            // Scrub breadcrumb data
            const scrubbedData: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(crumb.data)) {
              // Keep safe keys, scrub potentially sensitive ones
              if (['url', 'method', 'status_code', 'correlation_id'].includes(key)) {
                scrubbedData[key] = value;
              } else {
                scrubbedData[key] = '[Redacted]';
              }
            }
            crumb.data = scrubbedData;
          }
          return crumb;
        });
      }

      // Capture policy: Filter out 4xx ApiErrors
      if (event.exception?.values) {
        const firstException = event.exception.values[0];
        if (firstException?.type === 'ApiError' || firstException?.value?.includes('ApiError')) {
          // Check if it's a 4xx error
          const statusMatch = firstException.value?.match(/status:\s*(\d+)/);
          if (statusMatch) {
            const status = parseInt(statusMatch[1], 10);
            if (status >= 400 && status < 500) {
              // Drop 4xx ApiErrors (client errors, not server errors)
              return null;
            }
          }
        }
      }

      // Check tags for status code
      if (event.tags?.status && typeof event.tags.status === 'number') {
        const status = event.tags.status;
        if (status >= 400 && status < 500) {
          // Drop 4xx errors
          return null;
        }
      }

      return event;
    },

    // Ignore specific errors (optional)
    ignoreErrors: [
      // Network errors (often not actionable)
      'NetworkError',
      'Network request failed',
      'Failed to fetch',
      // Timeout errors (handled by retry logic)
      'TimeoutError',
      'AbortError',
    ],

    // Initial scope (can be updated later)
    initialScope: {
      tags: {
        environment: ENVIRONMENT,
      },
    },
  });
}
