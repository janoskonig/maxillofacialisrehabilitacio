import { NextRequest } from 'next/server';
import { getDbPool } from './db';
import { logger } from './logger';

/**
 * Központi activity logolási helper függvény
 * 
 * @param request NextRequest objektum az IP cím kinyeréséhez
 * @param userEmail Felhasználó email címe
 * @param action Activity action típusa (pl. 'patient_viewed', 'patient_created')
 * @param detail Opcionális részletek az activity-ről
 * @returns Promise<boolean> - true ha sikeres, false ha hiba történt
 */
export async function logActivity(
  request: NextRequest,
  userEmail: string,
  action: string,
  detail?: string
): Promise<boolean> {
  try {
    const pool = getDbPool();
    const ipHeader = request.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;

    await pool.query(
      `INSERT INTO activity_logs (user_email, action, detail, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [userEmail, action, detail || null, ipAddress]
    );

    return true;
  } catch (error) {
    // Nem kritikus hiba, csak logoljuk - ne akadályozza meg a fő műveletet
    logger.error('Failed to log activity:', {
      userEmail,
      action,
      detail,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Activity logolás auth nélkül (ha már van userEmail)
 * Hasznos olyan helyeken, ahol már megvan az auth objektum
 */
export async function logActivityWithAuth(
  request: NextRequest,
  auth: { email: string } | null,
  action: string,
  detail?: string
): Promise<boolean> {
  if (!auth) {
    return false;
  }
  return logActivity(request, auth.email, action, detail);
}

