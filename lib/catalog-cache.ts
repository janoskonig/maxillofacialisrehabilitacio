/**
 * Simple in-memory TTL cache for catalog/reference data that rarely changes.
 * Replaces per-request DB hits with cached lookups. Invalidated on mutation.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(key: string): void {
  store.delete(key);
}

export function invalidateCachePrefix(prefix: string): void {
  const keys = Array.from(store.keys());
  for (const key of keys) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export const CATALOG_TTL = FIVE_MINUTES;
export const BNO_TTL = ONE_HOUR;
export const INSTITUTION_TTL = ONE_HOUR;
