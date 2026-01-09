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
    const connectionTimeout = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10); // Increased to 10s
    const idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '60000', 10); // Increased to 60s for long-running operations
    const minConnections = parseInt(process.env.DB_POOL_MIN || '2', 10);
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

