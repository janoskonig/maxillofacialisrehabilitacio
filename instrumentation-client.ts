/**
 * Next.js client-side instrumentation (Turbopack compatible)
 * This file is automatically called by Next.js for client-side code
 * 
 * Note: This is a client-side entry point, not the instrumentation hook
 * The instrumentation hook (instrumentation.ts) handles server/edge init
 * This file is for client-side initialization only
 * 
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

// Only run in browser
if (typeof window !== 'undefined') {
  // Feature flag check
  if (process.env.NEXT_PUBLIC_ENABLE_SENTRY === 'true') {
    const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
    
    if (SENTRY_DSN) {
      // Dynamically import Sentry to avoid bundling issues
      import('@sentry/nextjs').then((Sentry) => {
        const ENVIRONMENT = process.env.NODE_ENV || 'development';

        Sentry.init({
          dsn: SENTRY_DSN,
          environment: ENVIRONMENT,
          
          // Sampling rates
          tracesSampleRate: 0.01, // 1% of transactions
          replaysSessionSampleRate: 0, // No session replays initially
          replaysOnErrorSampleRate: 0, // No error replays initially
          
          // Release tracking (optional, can be set via env var)
          release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
          
          // PII scrubbing and filtering
          beforeSend(event, hint) {
            // Feature flag check
            if (process.env.NEXT_PUBLIC_ENABLE_SENTRY !== 'true') {
              return null; // Drop event
            }

            // PII scrubbing: Remove sensitive user data
            if (event.user) {
              // Remove email and username (PII)
              delete event.user.email;
              delete event.user.username;
              // Keep only safe identifiers
              // event.user.id can stay if it's a hash (not raw email/UUID)
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

            // Capture policy: Filter out 4xx ApiErrors (except 401/403 if needed)
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
            // Browser extensions
            'top.GLOBALS',
            'originalCreateNotification',
            'canvas.contentDocument',
            'MyApp_RemoveAllHighlights',
            'atomicFindClose',
            'fb_xd_fragment',
            'bmi_SafeAddOnload',
            'EBCallBackMessageReceived',
            'conduitPage',
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
      }).catch((error) => {
        // Silently fail if Sentry can't be loaded (shouldn't break the app)
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Sentry] Failed to initialize client-side:', error);
        }
      });
    }
  }
}

// Export router transition hook for Next.js instrumentation
// This is required by Sentry for navigation tracking
// @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
export const onRouterTransitionStart = async (
  url: string,
  navigationType: 'push' | 'replace' | 'traverse'
) => {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_ENABLE_SENTRY === 'true') {
    try {
      const Sentry = await import('@sentry/nextjs');
      if (Sentry.captureRouterTransitionStart) {
        Sentry.captureRouterTransitionStart(url, navigationType);
      }
    } catch (error) {
      // Silently fail if Sentry can't be loaded
    }
  }
};
