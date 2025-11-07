// Error logging utility for capturing and reporting errors
import { getRecentConsoleLogs, formatConsoleLogs } from './consoleLogger';

export interface ErrorLog {
  message: string;
  stack?: string;
  name?: string;
  timestamp: string;
  url: string;
  userAgent: string;
  userId?: string;
  additionalInfo?: Record<string, any>;
  consoleLogs?: string; // Formatted console logs
}

// Store errors in sessionStorage for later reporting
export function logError(error: Error | string, additionalInfo?: Record<string, any>): ErrorLog {
  // Get recent console logs to attach to error
  let consoleLogsText = '';
  try {
    const recentLogs = getRecentConsoleLogs(50); // Get last 50 console logs
    if (recentLogs.length > 0) {
      consoleLogsText = formatConsoleLogs(recentLogs);
    }
  } catch (e) {
    // Silently fail if we can't get console logs
  }

  const errorLog: ErrorLog = {
    message: typeof error === 'string' ? error : error.message,
    stack: typeof error === 'object' && error.stack ? error.stack : undefined,
    name: typeof error === 'object' && error.name ? error.name : undefined,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    additionalInfo,
    consoleLogs: consoleLogsText || undefined,
  };

  // Store in sessionStorage (limited to recent errors)
  if (typeof window !== 'undefined') {
    try {
      const existingLogs = getStoredErrors();
      existingLogs.push(errorLog);
      
      // Keep only last 10 errors
      const recentLogs = existingLogs.slice(-10);
      sessionStorage.setItem('errorLogs', JSON.stringify(recentLogs));
    } catch (e) {
      console.error('Failed to store error log:', e);
    }
  }

  return errorLog;
}

// Get stored errors from sessionStorage
export function getStoredErrors(): ErrorLog[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = sessionStorage.getItem('errorLogs');
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to read stored errors:', e);
    return [];
  }
}

// Clear stored errors
export function clearStoredErrors(): void {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem('errorLogs');
    } catch (e) {
      console.error('Failed to clear stored errors:', e);
    }
  }
}

// Get the most recent error
export function getMostRecentError(): ErrorLog | null {
  const errors = getStoredErrors();
  return errors.length > 0 ? errors[errors.length - 1] : null;
}

// Format error log for display/submission
export function formatErrorLog(errorLog: ErrorLog): string {
  let formatted = `Timestamp: ${errorLog.timestamp}\n`;
  formatted += `URL: ${errorLog.url}\n`;
  formatted += `User Agent: ${errorLog.userAgent}\n`;
  
  if (errorLog.name) {
    formatted += `Error Name: ${errorLog.name}\n`;
  }
  
  formatted += `Message: ${errorLog.message}\n`;
  
  if (errorLog.stack) {
    formatted += `\nStack Trace:\n${errorLog.stack}\n`;
  }
  
  if (errorLog.additionalInfo && Object.keys(errorLog.additionalInfo).length > 0) {
    formatted += `\nAdditional Info:\n${JSON.stringify(errorLog.additionalInfo, null, 2)}\n`;
  }
  
  if (errorLog.consoleLogs) {
    formatted += `\n\n${errorLog.consoleLogs}\n`;
  }
  
  return formatted;
}

