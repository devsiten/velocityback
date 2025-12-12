import { Hono } from 'hono';
import { Env } from '../types/env';
import { StakingService } from '../services/staking';
import { authMiddleware } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rateLimit';
import { validateMint } from '../utils/validation';

const stake = new Hono<{ Bindings: Env; Variables: { userId: string; publicKey: string } }>();

// Get staking pools info
stake.get('/pools', async (c) => {
    const service = new StakingService(c.env);
    const pools = await service.getPools();
    return c.json({ success: true, data: pools });
});

// Build stake transaction
stake.post('/stake', authMiddleware, strictRateLimiter(), async (c) => {
    const body = await c.req.json<{ pool: string; amount: string }>();
    const publicKey = c.get('publicKey');

    if (!body.pool || !body.amount) {
        return c.json({ success: false, error: 'Missing pool or amount', code: 'INVALID_REQUEST' }, 400);
    }

    if (!['marinade', 'jito'].includes(body.pool)) {
        return c.json({ success: false, error: 'Invalid pool', code: 'INVALID_POOL' }, 400);
    }

    const service = new StakingService(c.env);

    try {
        const result = await service.buildStakeTransaction(body.pool, body.amount, publicKey);
        return c.json({ success: true, data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Stake failed';
        return c.json({ success: false, error: message, code: 'STAKE_ERROR' }, 500);
    }
});

// Build unstake transaction
stake.post('/unstake', authMiddleware, strictRateLimiter(), async (c) => {
    const body = await c.req.json<{ pool: string; amount: string }>();
    const publicKey = c.get('publicKey');

    if (!body.pool || !body.amount) {
        return c.json({ success: false, error: 'Missing pool or amount', code: 'INVALID_REQUEST' }, 400);
    }

    if (!['marinade', 'jito'].includes(body.pool)) {
        return c.json({ success: false, error: 'Invalid pool', code: 'INVALID_POOL' }, 400);
    }

    const service = new StakingService(c.env);

    try {
        const result = await service.buildUnstakeTransaction(body.pool, body.amount, publicKey);
        return c.json({ success: true, data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unstake failed';
        return c.json({ success: false, error: message, code: 'UNSTAKE_ERROR' }, 500);
    }
});

export default stake;
