import { Hono } from 'hono';
import { Env } from '../types/env';
import { LendingService } from '../services/lending';
import { authMiddleware, optionalAuth } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rateLimit';

const defi = new Hono<{ Bindings: Env; Variables: { userId: string; publicKey: string } }>();

// ==================== LENDING ENDPOINTS ====================

// Get lending pools
defi.get('/lend/pools', async (c) => {
    const service = new LendingService(c.env);
    const pools = await service.getLendingPools();
    return c.json({ success: true, data: pools });
});

// Get user lending positions
defi.get('/lend/positions', authMiddleware, async (c) => {
    const publicKey = c.get('publicKey');
    const service = new LendingService(c.env);
    const positions = await service.getUserPositions(publicKey);
    return c.json({ success: true, data: positions });
});

// Build supply transaction
defi.post('/lend/supply', authMiddleware, strictRateLimiter(), async (c) => {
    const body = await c.req.json<{ pool: string; amount: string }>();
    const publicKey = c.get('publicKey');

    if (!body.pool || !body.amount) {
        return c.json({ success: false, error: 'Missing pool or amount', code: 'INVALID_REQUEST' }, 400);
    }

    const service = new LendingService(c.env);

    try {
        const result = await service.buildSupplyTransaction(body.pool, body.amount, publicKey);
        return c.json({ success: true, data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Supply failed';
        return c.json({ success: false, error: message, code: 'SUPPLY_ERROR' }, 500);
    }
});

// Build withdraw transaction
defi.post('/lend/withdraw', authMiddleware, strictRateLimiter(), async (c) => {
    const body = await c.req.json<{ pool: string; amount: string }>();
    const publicKey = c.get('publicKey');

    if (!body.pool || !body.amount) {
        return c.json({ success: false, error: 'Missing pool or amount', code: 'INVALID_REQUEST' }, 400);
    }

    const service = new LendingService(c.env);

    try {
        const result = await service.buildWithdrawTransaction(body.pool, body.amount, publicKey);
        return c.json({ success: true, data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Withdraw failed';
        return c.json({ success: false, error: message, code: 'WITHDRAW_ERROR' }, 500);
    }
});

// ==================== BORROWING ENDPOINTS ====================

// Build borrow transaction
defi.post('/borrow', authMiddleware, strictRateLimiter(), async (c) => {
    const body = await c.req.json<{ pool: string; amount: string }>();
    const publicKey = c.get('publicKey');

    if (!body.pool || !body.amount) {
        return c.json({ success: false, error: 'Missing pool or amount', code: 'INVALID_REQUEST' }, 400);
    }

    const service = new LendingService(c.env);

    try {
        const result = await service.buildBorrowTransaction(body.pool, body.amount, publicKey);
        return c.json({ success: true, data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Borrow failed';
        return c.json({ success: false, error: message, code: 'BORROW_ERROR' }, 500);
    }
});

// Build repay transaction
defi.post('/repay', authMiddleware, strictRateLimiter(), async (c) => {
    const body = await c.req.json<{ pool: string; amount: string }>();
    const publicKey = c.get('publicKey');

    if (!body.pool || !body.amount) {
        return c.json({ success: false, error: 'Missing pool or amount', code: 'INVALID_REQUEST' }, 400);
    }

    const service = new LendingService(c.env);

    try {
        const result = await service.buildRepayTransaction(body.pool, body.amount, publicKey);
        return c.json({ success: true, data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Repay failed';
        return c.json({ success: false, error: message, code: 'REPAY_ERROR' }, 500);
    }
});

export default defi;
