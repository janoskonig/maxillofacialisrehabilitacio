import { Pool } from 'pg';

// Adatbázis kapcsolat pool létrehozása
// A pool újrahasznosítja a kapcsolatokat, ami hatékonyabb
let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL környezeti változó nincs beállítva! Kérjük, adja meg a .env fájlban.');
    }

    // SSL beállítások detection - Render és más cloud provider-ek esetében
    const requiresSSL = 
      connectionString.includes('sslmode=require') ||
      connectionString.includes('render.com') ||
      connectionString.includes('amazonaws.com') ||
      process.env.NODE_ENV === 'production';

    // Pool beállítások környezeti változókból vagy alapértelmezett értékekből
    // Reduced max connections to prevent "too many clients" error
    // PostgreSQL free tier typically allows ~20-25 connections
    const maxConnections = parseInt(process.env.DB_POOL_MAX || '10', 10);
    const connectionTimeout = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10); // 10s
    const idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10); // Reduced to 30s to close idle connections faster
    const minConnections = parseInt(process.env.DB_POOL_MIN || '1', 10);
    const queryTimeout = parseInt(process.env.DB_QUERY_TIMEOUT || '300000', 10); // 5 minutes for long queries

    pool = new Pool({
      connectionString,
      // Kapcsolat timeout (ms)
      connectionTimeoutMillis: connectionTimeout,
      // Minimális kapcsolatok száma a pool-ban
      min: minConnections,
      // Maximális kapcsolatok száma a pool-ban
      max: maxConnections,
      // Idle timeout (ms) - mennyi ideig lehet egy kapcsolat tétlen
      idleTimeoutMillis: idleTimeout,
      // Statement timeout (ms) - hosszú futásidejű lekérdezésekhez
      statement_timeout: queryTimeout,
      // SSL beállítások (cloud adatbázisok esetében szükséges)
      ssl: requiresSSL 
        ? { rejectUnauthorized: false } 
        : false,
      // Keep connections alive
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000, // 10 seconds
      // Allow exit on idle - close pool when no connections are in use
      allowExitOnIdle: true,
    });

    // Hibakezelés
    pool.on('error', (err: any) => {
      console.error('Adatbázis kapcsolat hiba:', err);
      // Ha "too many clients" hiba, próbáljuk meg újra kapcsolatot létrehozni
      if (err?.code === '53300') {
        console.error('Túl sok adatbázis kapcsolat! Várakozás...');
      }
    });

    // Log pool stats periodically in development
    if (process.env.NODE_ENV === 'development' && pool) {
      setInterval(() => {
        if (pool) {
          console.log(`DB Pool stats: total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}`);
        }
      }, 30000); // Every 30 seconds
    }
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

