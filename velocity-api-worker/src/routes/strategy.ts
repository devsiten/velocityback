import { Hono } from 'hono';
import { Env } from '../types/env';
import { StrategyService } from '../services/strategy';
import { authMiddleware } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rateLimit';
import { validateStrategyRequest, validateMint } from '../utils/validation';

const strategy = new Hono<{ Bindings: Env; Variables: { userId: string; publicKey: string } }>();

strategy.use('*', authMiddleware);

strategy.get('/', async (c) => {
  const userId = c.get('userId');
  const service = new StrategyService(c.env);
  
  const strategies = await service.getUserStrategies(userId);
  return c.json({ success: true, data: strategies });
});

strategy.post('/', strictRateLimiter(), async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const maxSlippage = parseInt(c.env.MAX_SLIPPAGE_BPS) || 1000;
  
  const errors = validateStrategyRequest(body, maxSlippage);
  if (errors.length > 0) {
    return c.json({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: errors }, 400);
  }

  const service = new StrategyService(c.env);
  
  const existingStrategies = await service.getUserStrategies(userId);
  const activeCount = existingStrategies.filter(s => s.status === 'active').length;
  
  if (activeCount >= 10) {
    return c.json({ success: false, error: 'Maximum 10 active strategies allowed', code: 'LIMIT_REACHED' }, 400);
  }

  const newStrategy = await service.createStrategy(userId, body);
  return c.json({ success: true, data: newStrategy });
});

strategy.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  
  const service = new StrategyService(c.env);
  const strat = await service.getStrategy(id, userId);
  
  if (!strat) {
    return c.json({ success: false, error: 'Strategy not found', code: 'NOT_FOUND' }, 404);
  }
  
  return c.json({ success: true, data: strat });
});

strategy.put('/:id/status', strictRateLimiter(), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ status: 'active' | 'paused' }>();
  
  if (!['active', 'paused'].includes(body.status)) {
    return c.json({ success: false, error: 'Invalid status', code: 'INVALID_STATUS' }, 400);
  }

  const service = new StrategyService(c.env);
  const updated = await service.updateStrategyStatus(id, userId, body.status);
  
  if (!updated) {
    return c.json({ success: false, error: 'Strategy not found', code: 'NOT_FOUND' }, 404);
  }
  
  return c.json({ success: true, data: { updated: true } });
});

strategy.delete('/:id', strictRateLimiter(), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  
  const service = new StrategyService(c.env);
  const deleted = await service.deleteStrategy(id, userId);
  
  if (!deleted) {
    return c.json({ success: false, error: 'Strategy not found', code: 'NOT_FOUND' }, 404);
  }
  
  return c.json({ success: true, data: { deleted: true } });
});

strategy.get('/:id/execute', strictRateLimiter(), async (c) => {
  const userId = c.get('userId');
  const publicKey = c.get('publicKey');
  const id = c.req.param('id');
  
  const service = new StrategyService(c.env);
  const strat = await service.getStrategy(id, userId);
  
  if (!strat) {
    return c.json({ success: false, error: 'Strategy not found', code: 'NOT_FOUND' }, 404);
  }
  
  if (strat.status !== 'triggered') {
    return c.json({ success: false, error: 'Strategy not triggered', code: 'NOT_TRIGGERED' }, 400);
  }

  try {
    const execution = await service.prepareStrategyExecution(id, publicKey);
    return c.json({ success: true, data: execution });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execution preparation failed';
    return c.json({ success: false, error: message, code: 'EXECUTION_ERROR' }, 500);
  }
});

strategy.post('/:id/confirm', strictRateLimiter(), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{ txSignature: string }>();
  
  if (!body.txSignature) {
    return c.json({ success: false, error: 'Missing transaction signature', code: 'INVALID_REQUEST' }, 400);
  }

  const service = new StrategyService(c.env);
  const strat = await service.getStrategy(id, userId);
  
  if (!strat) {
    return c.json({ success: false, error: 'Strategy not found', code: 'NOT_FOUND' }, 404);
  }

  await service.markStrategyExecuted(id, body.txSignature);
  return c.json({ success: true, data: { executed: true } });
});

export default strategy;
