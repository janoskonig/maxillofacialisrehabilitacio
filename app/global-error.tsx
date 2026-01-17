'use client';

/**
 * Global error boundary for React render errors
 * This catches errors that occur during rendering, lifecycle methods, and constructors
 * 
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error-handling
 */

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Log error to Sentry (only if enabled)
    if (process.env.NEXT_PUBLIC_ENABLE_SENTRY === 'true') {
      Sentry.captureException(error, {
        tags: {
          error_boundary: 'global',
        },
        extra: {
          digest: error.digest,
        },
      });
    }
  }, [error]);

  return (
    <html>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#dc2626' }}>
            Valami hiba történt
          </h1>
          <p style={{ marginBottom: '2rem', color: '#6b7280', textAlign: 'center', maxWidth: '600px' }}>
            Sajnáljuk, váratlan hiba történt az alkalmazásban. A hiba automatikusan jelentve lett a fejlesztőknek.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '500',
            }}
          >
            Újrapróbálás
          </button>
          {process.env.NODE_ENV === 'development' && (
            <details style={{ marginTop: '2rem', maxWidth: '800px', width: '100%' }}>
              <summary style={{ cursor: 'pointer', color: '#6b7280', marginBottom: '1rem' }}>
                Fejlesztői információk
              </summary>
              <pre style={{
                padding: '1rem',
                backgroundColor: '#f3f4f6',
                borderRadius: '0.5rem',
                overflow: 'auto',
                fontSize: '0.875rem',
                color: '#1f2937',
              }}>
                {error.message}
                {error.stack && `\n\n${error.stack}`}
                {error.digest && `\n\nDigest: ${error.digest}`}
              </pre>
            </details>
          )}
        </div>
      </body>
    </html>
  );
}
