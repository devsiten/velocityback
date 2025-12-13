import { Hono } from 'hono';
import { Env } from '../types/env';
import { JupiterService } from '../services/jupiter';
import { PointsService } from '../services/points';
import { authMiddleware } from '../middleware/auth';
import { quoteLimiter, strictRateLimiter } from '../middleware/rateLimit';
import { validateQuoteRequest, validateMint, sanitizeString } from '../utils/validation';

const trade = new Hono<{ Bindings: Env; Variables: { userId: string; publicKey: string } }>();

trade.get('/tokens/search', quoteLimiter(), async (c) => {
  const query = c.req.query('q');

  if (!query || query.length < 1) {
    return c.json({ success: false, error: 'Query required', code: 'INVALID_QUERY' }, 400);
  }

  const jupiter = new JupiterService(c.env);
  const tokens = await jupiter.searchTokens(sanitizeString(query, 50));

  return c.json({ success: true, data: tokens });
});

// GET /trending - Fetch trending tokens from Jupiter
trade.get('/trending', quoteLimiter(), async (c) => {
  try {
    const response = await fetch('https://api.jup.ag/tokens/v1/trending');

    if (!response.ok) {
      // Fallback to strict token list if trending fails
      const fallbackRes = await fetch('https://token.jup.ag/strict');
      const allTokens = await fallbackRes.json();

      const popularMints = [
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        'RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a',
      ];

      const formatted = popularMints.map((mint, index) => {
        const token = allTokens.find((t: any) => t.address === mint);
        return {
          rank: index + 1,
          address: mint,
          symbol: token?.symbol || 'UNKNOWN',
          name: token?.name || 'Unknown',
          logoURI: token?.logoURI || '',
          decimals: token?.decimals || 9,
          dailyVolume: 0,
        };
      });

      return c.json({ success: true, data: formatted });
    }

    const tokens = await response.json();

    const formatted = tokens.slice(0, 10).map((token: any, index: number) => ({
      rank: index + 1,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      logoURI: token.logoURI,
      decimals: token.decimals || 9,
      dailyVolume: token.dailyVolume || 0,
    }));

    return c.json({ success: true, data: formatted });
  } catch (error) {
    return c.json({ success: false, error: 'Trending fetch failed', code: 'TRENDING_ERROR' }, 500);
  }
});

trade.get('/tokens/:mint', quoteLimiter(), async (c) => {
  const mint = c.req.param('mint');

  if (!validateMint(mint)) {
    return c.json({ success: false, error: 'Invalid mint address', code: 'INVALID_MINT' }, 400);
  }

  const jupiter = new JupiterService(c.env);
  const token = await jupiter.getTokenInfo(mint);

  if (!token) {
    return c.json({ success: false, error: 'Token not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ success: true, data: token });
});

trade.get('/price/:mint', quoteLimiter(), async (c) => {
  const mint = c.req.param('mint');

  if (!validateMint(mint)) {
    return c.json({ success: false, error: 'Invalid mint address', code: 'INVALID_MINT' }, 400);
  }

  const jupiter = new JupiterService(c.env);
  const price = await jupiter.getPrice(mint);

  return c.json({ success: true, data: { mint, price, timestamp: Date.now() } });
});

trade.post('/prices', quoteLimiter(), async (c) => {
  const body = await c.req.json<{ mints: string[] }>();

  if (!Array.isArray(body.mints) || body.mints.length === 0 || body.mints.length > 20) {
    return c.json({ success: false, error: 'Provide 1-20 mint addresses', code: 'INVALID_MINTS' }, 400);
  }

  for (const mint of body.mints) {
    if (!validateMint(mint)) {
      return c.json({ success: false, error: `Invalid mint: ${mint}`, code: 'INVALID_MINT' }, 400);
    }
  }

  const jupiter = new JupiterService(c.env);
  const prices = await jupiter.getPrices(body.mints);

  return c.json({ success: true, data: { prices, timestamp: Date.now() } });
});

trade.post('/quote', quoteLimiter(), async (c) => {
  const body = await c.req.json();
  const maxSlippage = parseInt(c.env.MAX_SLIPPAGE_BPS) || 1000;

  const errors = validateQuoteRequest(body, maxSlippage);
  if (errors.length > 0) {
    return c.json({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: errors }, 400);
  }

  const jupiter = new JupiterService(c.env);

  try {
    const quote = await jupiter.getQuote(body);
    return c.json({ success: true, data: quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote failed';
    return c.json({ success: false, error: message, code: 'QUOTE_ERROR' }, 500);
  }
});

trade.post('/swap', authMiddleware, strictRateLimiter(), async (c) => {
  const body = await c.req.json();
  const userId = c.get('userId');

  if (!body.quoteResponse || !body.userPublicKey) {
    return c.json({ success: false, error: 'Missing quote or user public key', code: 'INVALID_REQUEST' }, 400);
  }

  if (!validateMint(body.userPublicKey)) {
    return c.json({ success: false, error: 'Invalid user public key', code: 'INVALID_KEY' }, 400);
  }

  const jupiter = new JupiterService(c.env);

  try {
    const swap = await jupiter.buildSwapTransaction(body);

    const tradeId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO trades (id, user_id, input_mint, output_mint, input_symbol, output_symbol, in_amount, out_amount, status, price_impact_pct, platform_fee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      tradeId,
      userId,
      body.quoteResponse.inputMint,
      body.quoteResponse.outputMint,
      body.inputSymbol || 'Unknown',
      body.outputSymbol || 'Unknown',
      body.quoteResponse.inAmount,
      body.quoteResponse.outAmount,
      body.quoteResponse.priceImpactPct,
      body.quoteResponse.platformFee
    ).run();

    return c.json({
      success: true,
      data: {
        ...swap,
        tradeId,
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Swap build failed';
    return c.json({ success: false, error: message, code: 'SWAP_ERROR' }, 500);
  }
});

trade.post('/confirm', authMiddleware, strictRateLimiter(), async (c) => {
  const body = await c.req.json<{ tradeId: string; txSignature: string }>();
  const userId = c.get('userId');

  if (!body.tradeId || !body.txSignature) {
    return c.json({ success: false, error: 'Missing trade ID or signature', code: 'INVALID_REQUEST' }, 400);
  }

  const trade = await c.env.DB.prepare(`
    SELECT * FROM trades WHERE id = ? AND user_id = ? AND status = 'pending'
  `).bind(body.tradeId, userId).first<any>();

  if (!trade) {
    return c.json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE trades SET status = 'confirmed', tx_signature = ? WHERE id = ?
  `).bind(body.txSignature, body.tradeId).run();

  const volumeUsd = parseFloat(trade.in_amount) / 1e9 * 150;
  const points = new PointsService(c.env);
  const earnedPoints = await points.awardTradePoints(userId, volumeUsd);

  return c.json({
    success: true,
    data: {
      confirmed: true,
      pointsEarned: earnedPoints,
    }
  });
});

trade.get('/history', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const trades = await c.env.DB.prepare(`
    SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all<any>();

  return c.json({
    success: true,
    data: trades.results.map((t: any) => ({
      id: t.id,
      inputMint: t.input_mint,
      outputMint: t.output_mint,
      inputSymbol: t.input_symbol,
      outputSymbol: t.output_symbol,
      inAmount: t.in_amount,
      outAmount: t.out_amount,
      txSignature: t.tx_signature,
      status: t.status,
      timestamp: t.created_at,
      priceImpactPct: t.price_impact_pct,
      platformFee: t.platform_fee,
    }))
  });
});

export default trade;
