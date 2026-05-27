import Redis from 'ioredis';

let client: Redis | null = null;
let connectAttempted = false;

/**
 * Fázis 5 — opcionális Redis kliens a disztribuált rate limithez.
 * Ha `REDIS_URL` nincs beállítva, null-t ad vissza (memória fallback).
 */
export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }

  if (!connectAttempted) {
    connectAttempted = true;
    client.connect().catch(() => {
      // A hívó réteg memória fallbackre vált — ne dobjunk modul-szinten.
    });
  }

  return client;
}

/** Tesztekhez: singleton nullázása. */
export function resetRedisClientForTests(): void {
  if (client) {
    client.disconnect();
  }
  client = null;
  connectAttempted = false;
}
