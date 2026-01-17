// Sentry edge runtime configuration (middleware, edge functions)
// This file configures Sentry for Edge runtime code

import * as Sentry from '@sentry/nextjs';

// Feature flag: ENABLE_SENTRY
const ENABLE_SENTRY = process.env.ENABLE_SENTRY === 'true';
const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = process.env.NODE_ENV || 'development';

if (ENABLE_SENTRY && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,
    
    // Sampling rates (lower for edge)
    tracesSampleRate: 0.005, // 0.5% of transactions (edge is high volume)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    
    // Release tracking
    release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    
    // PII scrubbing (same as server)
    beforeSend(event, hint) {
      if (!ENABLE_SENTRY) {
        return null;
      }

      // PII scrubbing
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
      }

      if (event.request?.data) {
        event.request.data = '[Redacted - may contain PII]';
      }

      // Filter 4xx errors
      if (event.exception?.values) {
        const firstException = event.exception.values[0];
        if (firstException?.type === 'ApiError' || firstException?.value?.includes('ApiError')) {
          const statusMatch = firstException.value?.match(/status:\s*(\d+)/);
          if (statusMatch) {
            const status = parseInt(statusMatch[1], 10);
            if (status >= 400 && status < 500) {
              return null;
            }
          }
        }
      }

      if (event.tags?.status && typeof event.tags.status === 'number') {
        const status = event.tags.status;
        if (status >= 400 && status < 500) {
          return null;
        }
      }

      return event;
    },
  });
}
