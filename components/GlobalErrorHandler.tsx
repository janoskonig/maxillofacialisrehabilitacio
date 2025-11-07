'use client';

import { useEffect } from 'react';
import { logError } from '@/lib/errorLogger';
import { initConsoleLogger } from '@/lib/consoleLogger';

export default function GlobalErrorHandler() {
  useEffect(() => {
    // Initialize console logger to capture console messages
    const cleanupConsoleLogger = initConsoleLogger();

    // Cleanup on unmount
    return () => {
      cleanupConsoleLogger();
    };
  }, []);

  useEffect(() => {
    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error 
        ? event.reason 
        : new Error(String(event.reason));
      
      logError(error, {
        type: 'unhandledRejection',
        reason: event.reason,
      });

      console.error('Unhandled promise rejection:', event.reason);
    };

    // Handle uncaught errors
    const handleError = (event: ErrorEvent) => {
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Unknown error');

      logError(error, {
        type: 'uncaughtError',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });

      console.error('Uncaught error:', event.error);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return null;
}

