import { getRedisClient } from './redis-client';
import type { RateLimitOptions, RateLimitResult } from './rate-limit';

/**
 * Fázis 5 — Redis sliding-window rate limit (sorted set).
 * Egy kulcson (`ratelimit:{key}`) tároljuk az esemény időbélyegeit.
 */
export async function checkRedisRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis client not configured');
  }

  const now = Date.now();
  const windowStart = now - opts.windowMs;
  const redisKey = `ratelimit:${opts.key}`;

  const multi = redis.multi();
  multi.zremrangebyscore(redisKey, 0, windowStart);
  multi.zcard(redisKey);
  multi.zrange(redisKey, 0, 0, 'WITHSCORES');
  const results = await multi.exec();

  if (!results) {
    throw new Error('Redis MULTI failed');
  }

  const count = (results[1]?.[1] as number) ?? 0;
  const oldestEntry = results[2]?.[1] as string[] | undefined;
  const oldestScore =
    oldestEntry && oldestEntry.length >= 2 ? Number(oldestEntry[1]) : now;
  const resetAt = oldestScore + opts.windowMs;

  if (count >= opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      used: count,
    };
  }

  const member = `${now}:${Math.random().toString(36).slice(2)}`;
  await redis
    .multi()
    .zadd(redisKey, now, member)
    .pexpire(redisKey, opts.windowMs)
    .exec();

  return {
    allowed: true,
    remaining: opts.limit - count - 1,
    resetAt,
    used: count + 1,
  };
}
