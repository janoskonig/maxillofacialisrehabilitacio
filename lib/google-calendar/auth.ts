import { google } from 'googleapis';
import { getDbPool } from '../db';
import crypto from 'crypto';
import { withRetry } from '../retry';
import {
  extractGoogleOAuthError,
  isInvalidGrant,
  isInvalidClient,
  isRetryableTransportOrServer,
  extractHttpStatus,
} from '../google-errors';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !ENCRYPTION_KEY) {
  console.warn('Google Calendar credentials not configured. Google Calendar integration will be disabled.');
}

function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  if (ENCRYPTION_KEY.length === 64) {
    return Buffer.from(ENCRYPTION_KEY, 'hex');
  }
  
  const key = Buffer.from(ENCRYPTION_KEY, 'utf8');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters or 32 UTF-8 characters)');
  }
  
  return key;
}

export function encryptToken(token: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decryptToken(encryptedToken: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  
  const parts = encryptedToken.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

export function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    undefined
  );
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

interface RefreshResult {
  accessToken: string;
  expiryDate: number;
  refreshToken?: string;
}

const refreshLocks = new Map<string, Promise<RefreshResult>>();

const EXPIRY_LEEWAY_MS = 90 * 1000;

export class GoogleReconnectRequiredError extends Error {
  constructor(message: string, public details?: Record<string, any>) {
    super(message);
    this.name = 'GoogleReconnectRequiredError';
  }
}

async function getTokensFromDb(userId: string): Promise<{
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: Date | null;
  status: string | null;
} | null> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT 
      google_calendar_refresh_token,
      google_calendar_access_token,
      google_calendar_token_expires_at,
      google_calendar_status
    FROM users 
    WHERE id = $1 AND google_calendar_enabled = true`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0];
  
  return {
    refreshToken: row.google_calendar_refresh_token 
      ? decryptToken(row.google_calendar_refresh_token) 
      : null,
    accessToken: row.google_calendar_access_token 
      ? decryptToken(row.google_calendar_access_token) 
      : null,
    expiresAt: row.google_calendar_token_expires_at,
    status: row.google_calendar_status || 'active',
  };
}

function isExpiredSoon(expiryDateMs: number | null): boolean {
  if (!expiryDateMs) {
    return true;
  }
  return Date.now() + EXPIRY_LEEWAY_MS >= expiryDateMs;
}

async function saveTokens(
  userId: string,
  accessToken: string,
  expiryDate: Date,
  refreshToken?: string | null
): Promise<void> {
  const pool = getDbPool();
  
  if (refreshToken) {
    await pool.query(
      `UPDATE users 
       SET google_calendar_access_token = $1,
           google_calendar_token_expires_at = $2,
           google_calendar_refresh_token = $3
       WHERE id = $4`,
      [encryptToken(accessToken), expiryDate, encryptToken(refreshToken), userId]
    );
  } else {
    await pool.query(
      `UPDATE users 
       SET google_calendar_access_token = $1,
           google_calendar_token_expires_at = $2
       WHERE id = $3`,
      [encryptToken(accessToken), expiryDate, userId]
    );
  }
}

async function updateConnectionStatus(
  userId: string,
  status: 'active' | 'reconnect_required' | 'broken_config',
  errorCode?: string
): Promise<void> {
  const pool = getDbPool();
  
  if (errorCode) {
    await pool.query(
      `UPDATE users 
       SET google_calendar_status = $1,
           google_calendar_last_error_code = $2,
           google_calendar_last_error_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, errorCode, userId]
    );
  } else {
    await pool.query(
      `UPDATE users 
       SET google_calendar_status = $1,
           google_calendar_last_error_code = NULL,
           google_calendar_last_error_at = NULL
       WHERE id = $2`,
      [status, userId]
    );
  }
}

async function performTokenRefresh(userId: string, refreshToken: string): Promise<RefreshResult> {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error('OAuth2 client not configured');
  }

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token || !credentials.expiry_date) {
    throw new Error('Failed to refresh access token: missing credentials');
  }

  const expiryDate = new Date(credentials.expiry_date);
  const expiryDateMs = expiryDate.getTime();

  const newRefreshToken = credentials.refresh_token || undefined;

  await saveTokens(userId, credentials.access_token, expiryDate, newRefreshToken);

  tokenCache.set(userId, {
    accessToken: credentials.access_token,
    expiresAt: Math.min(expiryDateMs, Date.now() + CACHE_TTL_MS),
  });

  return {
    accessToken: credentials.access_token,
    expiryDate: expiryDateMs,
    refreshToken: newRefreshToken,
  };
}

export async function refreshAccessTokenIfNeeded(userId: string): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }

  const cached = tokenCache.get(userId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.accessToken;
  }

  const tokens = await getTokensFromDb(userId);
  if (!tokens || !tokens.refreshToken) {
    tokenCache.delete(userId);
    return null;
  }

  const expiresAtMs = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : null;

  if (tokens.accessToken && expiresAtMs && !isExpiredSoon(expiresAtMs)) {
    tokenCache.set(userId, {
      accessToken: tokens.accessToken,
      expiresAt: Math.min(expiresAtMs, now + CACHE_TTL_MS),
    });
    return tokens.accessToken;
  }

  const existingLock = refreshLocks.get(userId);
  if (existingLock) {
    try {
      const result = await existingLock;
      return result.accessToken;
    } catch (err) {
      if (err instanceof GoogleReconnectRequiredError) {
        throw err;
      }
    }
  }

  const refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const result = await withRetry(
        () => performTokenRefresh(userId, tokens.refreshToken!),
        {
          retries: 3,
          baseDelayMs: 500,
          maxDelayMs: 4000,
          shouldRetry: (err) => {
            if (isInvalidGrant(err) || isInvalidClient(err)) {
              return false;
            }
            return isRetryableTransportOrServer(err);
          },
          onRetry: ({ attempt, delayMs, err, retryAfter }) => {
            const ex = extractGoogleOAuthError(err);
            console.warn(
              `[refreshAccessTokenIfNeeded] Retry ${attempt} for user ${userId}`,
              {
                delayMs,
                retryAfter,
                error: ex.error,
                description: ex.description,
              }
            );
          },
        }
      );

      await updateConnectionStatus(userId, 'active');

      console.log(`[refreshAccessTokenIfNeeded] Token refreshed successfully for user ${userId}`, {
        expiry_date: result.expiryDate,
        rotated: Boolean(result.refreshToken),
      });

      return result;
    } catch (err) {
      const ex = extractGoogleOAuthError(err);
      const status = extractHttpStatus(err);

      if (isInvalidGrant(err)) {
        console.warn(
          `[refreshAccessTokenIfNeeded] Invalid refresh token (invalid_grant) for user ${userId}; reconnect required`,
          { error: ex.error, description: ex.description }
        );
        await updateConnectionStatus(userId, 'reconnect_required', 'invalid_grant');
        throw new GoogleReconnectRequiredError(
          'Google authorization expired or revoked; reconnect required.',
          { error: ex.error, description: ex.description }
        );
      }

      if (isInvalidClient(err)) {
        console.error(
          `[refreshAccessTokenIfNeeded] Invalid OAuth client for user ${userId}; configuration issue`,
          { error: ex.error, description: ex.description }
        );
        await updateConnectionStatus(userId, 'broken_config', ex.error || 'invalid_client');
        throw new Error('Google OAuth client misconfiguration.');
      }

      console.error(
        `[refreshAccessTokenIfNeeded] Token refresh failed (non-fatal) for user ${userId}`,
        {
          error: ex.error,
          description: ex.description,
          status,
          message: err instanceof Error ? err.message : 'Unknown error',
        }
      );
      throw err;
    } finally {
      refreshLocks.delete(userId);
    }
  })();

  refreshLocks.set(userId, refreshPromise);

  try {
    const result = await refreshPromise;
    return result.accessToken;
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError) {
      throw err;
    }
    return null;
  }
}

export async function callGoogleCalendar<T>(
  userId: string,
  doRequest: (accessToken: string) => Promise<T>
): Promise<T> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google Calendar credentials not configured');
  }

  let accessToken: string | null;
  try {
    accessToken = await refreshAccessTokenIfNeeded(userId);
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError) {
      throw err;
    }
    throw new Error(`Failed to get access token: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  if (!accessToken) {
    throw new Error('Failed to get access token');
  }

  try {
    return await withRetry(
      () => doRequest(accessToken!),
      {
        retries: 2,
        baseDelayMs: 400,
        maxDelayMs: 2500,
        shouldRetry: (err) => isRetryableTransportOrServer(err),
        onRetry: ({ attempt, delayMs, err, retryAfter }) => {
          const status = extractHttpStatus(err);
          console.warn(`[callGoogleCalendar] Retry ${attempt} for user ${userId}`, {
            delayMs,
            retryAfter,
            status,
          });
        },
      }
    );
  } catch (err: any) {
    const status = extractHttpStatus(err);

    if (status === 401) {
      console.warn(`[callGoogleCalendar] 401 error for user ${userId}; attempting one refresh then retry`);

      try {
        const newAccessToken = await refreshAccessTokenIfNeeded(userId);
        if (!newAccessToken) {
          throw new Error('Failed to refresh access token after 401');
        }

        return await doRequest(newAccessToken);
      } catch (refreshErr) {
        if (refreshErr instanceof GoogleReconnectRequiredError) {
          throw refreshErr;
        }
        console.error(
          `[callGoogleCalendar] Auth loop guard: refresh after 401 failed for user ${userId}`,
          {
            refreshError: refreshErr instanceof Error ? refreshErr.message : 'Unknown error',
          }
        );
        throw new Error('Authentication failed after refresh attempt');
      }
    }

    throw err;
  }
}
