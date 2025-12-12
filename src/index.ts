import { Hono } from 'hono';
import { Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { rateLimiter } from './middleware/rateLimit';
import trade from './routes/trade';
import strategy from './routes/strategy';
import points from './routes/points';
import stake from './routes/stake';
import defi from './routes/defi';
import { StrategyService } from './services/strategy';

const app = new Hono<{ Bindings: Env }>();

app.use('*', corsMiddleware);

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
  });
});

app.route('/api/v1/trade', trade);
app.route('/api/v1/strategy', strategy);
app.route('/api/v1/points', points);
app.route('/api/v1/stake', stake);
app.route('/api/v1/defi', defi);

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not found',
      code: 'NOT_FOUND',
    },
    404
  );
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const service = new StrategyService(env);

    try {
      const triggers = await service.checkTriggers();
      const triggered = triggers.filter(t => t.shouldTrigger);

      if (triggered.length > 0) {
        console.log(`Triggered ${triggered.length} strategies`);
      }
    } catch (error) {
      console.error('Strategy check failed:', error);
    }
  },
};
