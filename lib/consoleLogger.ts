// Console log interceptor for capturing console messages

export interface ConsoleLogEntry {
  level: 'log' | 'error' | 'warn' | 'info' | 'debug';
  message: string;
  args: any[];
  timestamp: string;
  url: string;
}

const MAX_CONSOLE_LOGS = 100; // Maximum number of console logs to keep

// Store console logs in sessionStorage
function storeConsoleLog(entry: ConsoleLogEntry): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const existingLogs = getStoredConsoleLogs();
    existingLogs.push(entry);
    
    // Keep only last N logs
    const recentLogs = existingLogs.slice(-MAX_CONSOLE_LOGS);
    sessionStorage.setItem('consoleLogs', JSON.stringify(recentLogs));
  } catch (e) {
    // Silently fail if storage is full or unavailable
  }
}

// Get stored console logs from sessionStorage
export function getStoredConsoleLogs(): ConsoleLogEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = sessionStorage.getItem('consoleLogs');
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

// Clear stored console logs
export function clearStoredConsoleLogs(): void {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem('consoleLogs');
    } catch (e) {
      // Silently fail
    }
  }
}

// Format console logs for display/submission
export function formatConsoleLogs(logs: ConsoleLogEntry[]): string {
  if (logs.length === 0) {
    return 'Nincsenek konzol logok.';
  }

  let formatted = `=== Konzol logok (${logs.length} bejegyzés) ===\n\n`;
  
  logs.forEach((log, index) => {
    formatted += `[${index + 1}] ${log.timestamp} [${log.level.toUpperCase()}] ${log.url}\n`;
    formatted += `Message: ${log.message}\n`;
    
    if (log.args && log.args.length > 0) {
      formatted += `Arguments:\n`;
      log.args.forEach((arg, argIndex) => {
        try {
          if (typeof arg === 'object') {
            formatted += `  [${argIndex}]: ${JSON.stringify(arg, null, 2)}\n`;
          } else {
            formatted += `  [${argIndex}]: ${String(arg)}\n`;
          }
        } catch (e) {
          formatted += `  [${argIndex}]: [Object - could not stringify]\n`;
        }
      });
    }
    formatted += '\n';
  });
  
  return formatted;
}

// Get recent console logs (last N entries)
export function getRecentConsoleLogs(count: number = 50): ConsoleLogEntry[] {
  const allLogs = getStoredConsoleLogs();
  return allLogs.slice(-count);
}

// Initialize console log interceptor
export function initConsoleLogger(): () => void {
  if (typeof window === 'undefined' || typeof console === 'undefined') {
    return () => {}; // Return no-op cleanup function
  }

  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalInfo = console.info.bind(console);
  const originalDebug = console.debug?.bind(console) || console.log.bind(console);

  const createLogEntry = (
    level: ConsoleLogEntry['level'],
    ...args: any[]
  ): ConsoleLogEntry => {
    // Convert arguments to string safely
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return arg;
        }
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    return {
      level,
      message,
      args: args.map((arg) => {
        // Store a simplified version of arguments
        try {
          if (typeof arg === 'object' && arg !== null) {
            // For objects, try to create a serializable copy
            return JSON.parse(JSON.stringify(arg, (key, value) => {
              // Handle circular references and functions
              if (typeof value === 'function') {
                return '[Function]';
              }
              if (value instanceof Error) {
                return {
                  name: value.name,
                  message: value.message,
                  stack: value.stack,
                };
              }
              return value;
            }));
          }
          return arg;
        } catch {
          return String(arg);
        }
      }),
      timestamp: new Date().toISOString(),
      url: window.location.href,
    };
  };

  // Override console methods
  console.log = (...args: any[]) => {
    storeConsoleLog(createLogEntry('log', ...args));
    originalLog(...args);
  };

  console.error = (...args: any[]) => {
    storeConsoleLog(createLogEntry('error', ...args));
    originalError(...args);
  };

  console.warn = (...args: any[]) => {
    storeConsoleLog(createLogEntry('warn', ...args));
    originalWarn(...args);
  };

  console.info = (...args: any[]) => {
    storeConsoleLog(createLogEntry('info', ...args));
    originalInfo(...args);
  };

  if (console.debug) {
    console.debug = (...args: any[]) => {
      storeConsoleLog(createLogEntry('debug', ...args));
      originalDebug(...args);
    };
  }

  // Return cleanup function
  return () => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
    if (console.debug) {
      console.debug = originalDebug;
    }
  };
}

