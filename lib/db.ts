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
    const maxConnections = parseInt(process.env.DB_POOL_MAX || '20', 10);
    const connectionTimeout = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10);
    // Idle timeout növelve Render optimalizálás miatt: 30s → 60s
    const idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '60000', 10);
    const minConnections = parseInt(process.env.DB_POOL_MIN || '2', 10);

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
      // SSL beállítások (cloud adatbázisok esetében szükséges)
      ssl: requiresSSL 
        ? { rejectUnauthorized: false } 
        : false,
    });

    // Hibakezelés
    pool.on('error', (err) => {
      console.error('Adatbázis kapcsolat hiba:', err);
    });
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

/**
 * Ellenőrzi, hogy egy hiba kapcsolat megszakadás hibája-e
 */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  
  const errorMessage = error.message.toLowerCase();
  const connectionErrors = [
    'connection terminated unexpectedly',
    'server closed the connection',
    'connection closed',
    'socket hang up',
    'econnreset',
    'epipe',
  ];
  
  return connectionErrors.some(err => errorMessage.includes(err));
}

/**
 * Query wrapper retry mechanizmussal kapcsolat hibák esetén
 * Csak nem tranzakciós query-knél használjuk
 * 
 * @param pool - A database pool
 * @param queryText - SQL query szöveg
 * @param params - Query paraméterek
 * @param maxRetries - Maximális újrapróbálkozások száma (alapértelmezett: 2)
 * @returns Query eredmény
 */
export async function queryWithRetry<T = unknown>(
  pool: Pool,
  queryText: string,
  params?: unknown[],
  maxRetries: number = 2
): Promise<{ rows: T[]; rowCount: number }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Új client lekérése a pool-ból minden próbálkozásnál
      const client = await pool.connect();
      
      try {
        const result = await client.query(queryText, params);
        return result;
      } finally {
        // Mindig elengedjük a client-et, még ha hiba történt is
        client.release();
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Ha nem kapcsolat hiba, vagy elértük a max retry-t, dobjuk a hibát
      if (!isConnectionError(error) || attempt === maxRetries) {
        throw error;
      }
      
      // Logoljuk az újrapróbálkozást
      console.warn(
        `[queryWithRetry] Kapcsolat hiba, újrapróbálkozás ${attempt + 1}/${maxRetries}:`,
        lastError.message
      );
      
      // Várunk egy kicsit az újrapróbálkozás előtt (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  
  // Ez elvileg nem futhat le, de TypeScript miatt kell
  throw lastError || new Error('Ismeretlen hiba');
}

/**
 * Tranzakció wrapper retry mechanizmussal
 * Ha megszakad, az egész tranzakciót újraindítja
 * 
 * @param pool - A database pool
 * @param transactionFn - Tranzakció függvény, ami a client-et kapja paraméterként
 * @param maxRetries - Maximális újrapróbálkozások száma (alapértelmezett: 2)
 * @returns Tranzakció eredménye
 */
export async function transactionWithRetry<T>(
  pool: Pool,
  transactionFn: (client: import('pg').PoolClient) => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      try {
        const result = await transactionFn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        // Rollback minden hiba esetén
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('[transactionWithRetry] Rollback hiba:', rollbackError);
        }
        
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Ha nem kapcsolat hiba, vagy elértük a max retry-t, dobjuk a hibát
        if (!isConnectionError(error) || attempt === maxRetries) {
          throw error;
        }
        
        // Logoljuk az újrapróbálkozást
        console.warn(
          `[transactionWithRetry] Kapcsolat hiba tranzakcióban, újrapróbálkozás ${attempt + 1}/${maxRetries}:`,
          lastError.message
        );
        
        // Várunk egy kicsit az újrapróbálkozás előtt (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    } finally {
      // Mindig elengedjük a client-et
      client.release();
    }
  }
  
  // Ez elvileg nem futhat le, de TypeScript miatt kell
  throw lastError || new Error('Ismeretlen hiba');
}

