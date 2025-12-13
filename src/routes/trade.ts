import { Hono } from 'hono';
import { JupiterService } from '../services/jupiter';
import { PointsService } from '../services/points';
import { authMiddleware } from '../middleware/auth';
import { strictRateLimiter, quoteLimiter } from '../middleware/rateLimit';
import { validateMint, validateQuoteRequest, sanitizeString } from '../utils/validation';
import { Env } from '../types/env';

const trade = new Hono<{ Bindings: Env; Variables: { userId: string; publicKey: string } }>();

// Search tokens
trade.get('/tokens/search', quoteLimiter(), async (c) => {
  const query = c.req.query('q');

  if (!query || query.length < 1) {
    return c.json({ success: false, error: 'Query required', code: 'INVALID_QUERY' }, 400);
  }

  const jupiter = new JupiterService(c.env);
  const tokens = await jupiter.searchTokens(sanitizeString(query, 50));

  return c.json({ success: true, data: tokens });
});

// Get trending tokens - FIXED
trade.get('/trending', quoteLimiter(), async (c) => {
  try {
    const jupiter = new JupiterService(c.env);
    const trendingTokens = await jupiter.getTrendingTokens(20);

    const formatted = trendingTokens.map((token, index) => ({
      rank: index + 1,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      logoURI: token.logoURI || '',
      decimals: token.decimals,
      dailyVolume: token.dailyVolume || 0
    }));

    return c.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Trending error:', error);
    return c.json({ success: false, error: 'Trending fetch failed', code: 'TRENDING_ERROR' }, 500);
  }
});

// Get token info by mint
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

// Get price for a token (in SOL)
trade.get('/price/:mint', quoteLimiter(), async (c) => {
  const mint = c.req.param('mint');

  if (!validateMint(mint)) {
    return c.json({ success: false, error: 'Invalid mint address', code: 'INVALID_MINT' }, 400);
  }

  const jupiter = new JupiterService(c.env);

  try {
    const priceInSol = await jupiter.getPrice(mint);
    const usdPrices = await jupiter.getUsdPrices([mint]);

    return c.json({
      success: true,
      data: {
        mint,
        price: priceInSol,
        priceUsd: usdPrices[mint] || null,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    return c.json({ success: false, error: 'Price fetch failed', code: 'PRICE_ERROR' }, 500);
  }
});

// Get multiple prices - FIXED with USD prices
trade.post('/prices', quoteLimiter(), async (c) => {
  const body = await c.req.json();

  if (!Array.isArray(body.mints) || body.mints.length === 0 || body.mints.length > 20) {
    return c.json({ success: false, error: 'Provide 1-20 mint addresses', code: 'INVALID_MINTS' }, 400);
  }

  for (const mint of body.mints) {
    if (!validateMint(mint)) {
      return c.json({ success: false, error: `Invalid mint: ${mint}`, code: 'INVALID_MINT' }, 400);
    }
  }

  const jupiter = new JupiterService(c.env);

  try {
    const [pricesInSol, pricesUsd] = await Promise.all([
      jupiter.getPrices(body.mints),
      jupiter.getUsdPrices(body.mints)
    ]);

    // Combine both price types
    const combinedPrices: Record<string, { sol: number; usd: number }> = {};
    for (const mint of body.mints) {
      combinedPrices[mint] = {
        sol: pricesInSol[mint] || 0,
        usd: pricesUsd[mint] || 0
      };
    }

    return c.json({
      success: true,
      data: {
        prices: combinedPrices,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    return c.json({ success: false, error: 'Prices fetch failed', code: 'PRICE_ERROR' }, 500);
  }
});

// Get quote - FIXED with USD amounts
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

    return c.json({
      success: true,
      data: {
        ...quote,
        // Ensure USD amounts are included
        inAmountUsd: quote.inAmountUsd || null,
        outAmountUsd: quote.outAmountUsd || null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote failed';
    return c.json({ success: false, error: message, code: 'QUOTE_ERROR' }, 500);
  }
});

// Build swap transaction
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
      body.quoteResponse.priceImpactPct || '0',
      body.quoteResponse.platformFee?.amount || '0'
    ).run();

    return c.json({
      success: true,
      data: {
        ...swap,
        tradeId
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Swap build failed';
    return c.json({ success: false, error: message, code: 'SWAP_ERROR' }, 500);
  }
});

// Confirm trade
trade.post('/confirm', authMiddleware, strictRateLimiter(), async (c) => {
  const body = await c.req.json();
  const userId = c.get('userId');

  if (!body.tradeId || !body.txSignature) {
    return c.json({ success: false, error: 'Missing trade ID or signature', code: 'INVALID_REQUEST' }, 400);
  }

  const tradeRecord = await c.env.DB.prepare(`
    SELECT * FROM trades WHERE id = ? AND user_id = ? AND status = 'pending'
  `).bind(body.tradeId, userId).first();

  if (!tradeRecord) {
    return c.json({ success: false, error: 'Trade not found', code: 'NOT_FOUND' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE trades SET status = 'confirmed', tx_signature = ? WHERE id = ?
  `).bind(body.txSignature, body.tradeId).run();

  // Calculate volume in USD (approximate)
  const jupiter = new JupiterService(c.env);
  let volumeUsd = 0;

  try {
    const prices = await jupiter.getUsdPrices([tradeRecord.input_mint as string]);
    const tokenInfo = await jupiter.getTokenInfo(tradeRecord.input_mint as string);
    const decimals = tokenInfo?.decimals || 9;
    volumeUsd = (parseFloat(tradeRecord.in_amount as string) / Math.pow(10, decimals)) * (prices[tradeRecord.input_mint as string] || 0);
  } catch (e) {
    // Fallback estimation
    volumeUsd = parseFloat(tradeRecord.in_amount as string) / 1e9 * 150;
  }

  const points = new PointsService(c.env);
  const earnedPoints = await points.awardTradePoints(userId, volumeUsd);

  return c.json({
    success: true,
    data: {
      confirmed: true,
      pointsEarned: earnedPoints,
      volumeUsd
    }
  });
});

// Get trade history
trade.get('/history', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const trades = await c.env.DB.prepare(`
    SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all();

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
      platformFee: t.platform_fee
    }))
  });
});

export default trade;
