import { getDbPool } from './db';
import { randomBytes } from 'crypto';

const TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
const MAGIC_LINK_EXPIRY_HOURS = 48;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 168; // 7 days

/**
 * Generate a secure random token for patient portal
 */
export function generatePortalToken(): string {
  return randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Create a magic link token for existing patient login
 */
export async function createMagicLinkToken(
  patientId: string,
  ipAddress?: string | null
): Promise<string> {
  const pool = getDbPool();
  const token = generatePortalToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + MAGIC_LINK_EXPIRY_HOURS);

  await pool.query(
    `INSERT INTO patient_portal_tokens (patient_id, token, token_type, expires_at, ip_address)
     VALUES ($1, $2, 'magic_link', $3, $4)`,
    [patientId, token, expiresAt, ipAddress || null]
  );

  return token;
}

/**
 * Create an email verification token for new patient registration
 */
export async function createEmailVerificationToken(
  patientId: string,
  ipAddress?: string | null
): Promise<string> {
  const pool = getDbPool();
  const token = generatePortalToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_EXPIRY_HOURS);

  await pool.query(
    `INSERT INTO patient_portal_tokens (patient_id, token, token_type, expires_at, ip_address)
     VALUES ($1, $2, 'email_verification', $3, $4)`,
    [patientId, token, expiresAt, ipAddress || null]
  );

  return token;
}

/**
 * Verify and consume a portal token
 * Returns patient ID if token is valid, null otherwise
 */
export async function verifyPortalToken(
  token: string,
  tokenType: 'magic_link' | 'email_verification' = 'magic_link'
): Promise<{ patientId: string; isUsed: boolean } | null> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT patient_id, expires_at, used_at, token_type
     FROM patient_portal_tokens
     WHERE token = $1 AND token_type = $2`,
    [token, tokenType]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Check if expired
  if (new Date(row.expires_at) < new Date()) {
    return null;
  }

  // Check if already used (for magic_link tokens)
  if (tokenType === 'magic_link' && row.used_at) {
    return { patientId: row.patient_id, isUsed: true };
  }

  // Mark as used if it's a magic_link token
  if (tokenType === 'magic_link') {
    await pool.query(
      `UPDATE patient_portal_tokens 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE token = $1`,
      [token]
    );
  }

  return { patientId: row.patient_id, isUsed: false };
}

/**
 * Get patient ID from token without consuming it (for verification checks)
 */
export async function getPatientIdFromToken(token: string): Promise<string | null> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT patient_id, expires_at
     FROM patient_portal_tokens
     WHERE token = $1`,
    [token]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Check if expired
  if (new Date(row.expires_at) < new Date()) {
    return null;
  }

  return row.patient_id;
}

/**
 * Check rate limiting for registration attempts
 */
export async function checkRegistrationRateLimit(ipAddress: string): Promise<boolean> {
  const pool = getDbPool();
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM patient_portal_tokens
     WHERE ip_address = $1 
     AND token_type = 'email_verification'
     AND created_at > $2`,
    [ipAddress, oneHourAgo]
  );

  const count = parseInt(result.rows[0].count, 10);
  return count < 3; // Max 3 attempts per hour
}




