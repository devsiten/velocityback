import { Context, Next } from 'hono';
import { Env } from '../types/env';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60000,
  maxRequests: 60,
  keyPrefix: 'rl',
};

export function rateLimiter(config: Partial<RateLimitConfig> = {}) {
  const { windowMs, maxRequests, keyPrefix } = { ...DEFAULT_CONFIG, ...config };

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') || 
               c.req.header('X-Forwarded-For')?.split(',')[0] || 
               'unknown';
    
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const cached = await c.env.CACHE.get(key, 'json') as { count: number; start: number } | null;

    if (!cached || cached.start < windowStart) {
      await c.env.CACHE.put(key, JSON.stringify({ count: 1, start: now }), {
        expirationTtl: Math.ceil(windowMs / 1000),
      });
      return next();
    }

    if (cached.count >= maxRequests) {
      return c.json(
        { success: false, error: 'Rate limit exceeded', code: 'RATE_LIMIT' },
        429
      );
    }

    await c.env.CACHE.put(key, JSON.stringify({ count: cached.count + 1, start: cached.start }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });

    return next();
  };
}

export function strictRateLimiter() {
  return rateLimiter({ maxRequests: 10, windowMs: 60000, keyPrefix: 'rl:strict' });
}

export function quoteLimiter() {
  return rateLimiter({ maxRequests: 120, windowMs: 60000, keyPrefix: 'rl:quote' });
}
