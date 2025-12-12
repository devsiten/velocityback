import { Hono } from 'hono';
import { Env } from '../types/env';
import { PointsService } from '../services/points';
import { authMiddleware, optionalAuth } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimit';

const points = new Hono<{ Bindings: Env; Variables: { userId: string; publicKey: string } }>();

points.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const service = new PointsService(c.env);
  
  const userPoints = await service.getUserPoints(userId);
  
  if (!userPoints) {
    return c.json({ 
      success: true, 
      data: {
        totalPoints: 0,
        tradeCount: 0,
        volumeUsd: 0,
        weeklyPoints: 0,
        rank: null,
      }
    });
  }
  
  return c.json({ success: true, data: userPoints });
});

points.get('/leaderboard', rateLimiter({ maxRequests: 30, windowMs: 60000, keyPrefix: 'rl:leaderboard' }), async (c) => {
  const weekly = c.req.query('weekly') === 'true';
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  
  const service = new PointsService(c.env);
  const leaderboard = await service.getLeaderboard(limit, weekly);
  
  return c.json({ 
    success: true, 
    data: {
      leaderboard,
      type: weekly ? 'weekly' : 'all_time',
    }
  });
});

export default points;
