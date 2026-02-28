import { Pool } from 'pg';

let pool: Pool | null = null;

const SLOW_QUERY_THRESHOLD = parseInt(process.env.SLOW_QUERY_MS || '1000', 10);

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL környezeti változó nincs beállítva! Kérjük, adja meg a .env fájlban.');
    }

    const requiresSSL = 
      connectionString.includes('sslmode=require') ||
      connectionString.includes('render.com') ||
      connectionString.includes('amazonaws.com') ||
      process.env.NODE_ENV === 'production';

    const maxConnections = parseInt(process.env.DB_POOL_MAX || '10', 10);
    const connectionTimeout = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10);
    const idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10);
    const minConnections = parseInt(process.env.DB_POOL_MIN || '1', 10);
    const queryTimeout = parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10);

    const rawPool = new Pool({
      connectionString,
      connectionTimeoutMillis: connectionTimeout,
      min: minConnections,
      max: maxConnections,
      idleTimeoutMillis: idleTimeout,
      statement_timeout: queryTimeout,
      ssl: requiresSSL 
        ? { rejectUnauthorized: false } 
        : false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: true,
    });

    rawPool.on('error', (err: any) => {
      console.error('Adatbázis kapcsolat hiba:', err);
      if (err?.code === '53300') {
        console.error('Túl sok adatbázis kapcsolat! Várakozás...');
      }
    });

    // Wrap pool.query with slow-query logging
    const origQuery: (...a: any[]) => any = rawPool.query.bind(rawPool);
    (rawPool as any).query = function wrappedQuery(textOrConfig: any, values?: any, callback?: any): any {
      const start = performance.now();
      const queryText = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig?.text ?? '(unknown)';

      const result = origQuery(textOrConfig, values, callback);

      if (result && typeof result.then === 'function') {
        return result.then((res: any) => {
          const elapsed = performance.now() - start;
          if (elapsed > SLOW_QUERY_THRESHOLD) {
            const truncated = queryText.replace(/\s+/g, ' ').slice(0, 200);
            console.warn(`[SLOW_QUERY] ${elapsed.toFixed(0)}ms | rows=${res?.rowCount ?? '?'} | ${truncated}`);
          }
          return res;
        });
      }
      return result;
    };

    pool = rawPool;
  }

  return pool;
}

// Adatbázis kapcsolat bezárása (hasznos production környezetben)
export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Adatbázis kapcsolat tesztelése
export async function testConnection(): Promise<boolean> {
  try {
    const client = await getDbPool().connect();
    await client.query('SELECT NOW()');
    client.release();
    return true;
  } catch (error) {
    console.error('Adatbázis kapcsolat teszt sikertelen:', error);
    return false;
  }
}

// Helper function to execute queries with retry on "too many clients" error
export async function queryWithRetry<T = any>(
  queryFn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error: any) {
      lastError = error;
      
      // If it's a "too many clients" error, wait and retry
      if (error?.code === '53300' && attempt < maxRetries - 1) {
        const delay = retryDelay * (attempt + 1); // Exponential backoff
        console.warn(`Too many clients error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For other errors or last attempt, throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

