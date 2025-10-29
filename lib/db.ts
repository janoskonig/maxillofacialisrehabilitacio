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

    pool = new Pool({
      connectionString,
      // Kapcsolat timeout (ms)
      connectionTimeoutMillis: 5000,
      // Maximális kapcsolatok száma a pool-ban
      max: 20,
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

