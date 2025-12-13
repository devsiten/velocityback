import { Env, CachedPrice } from '../types/env';
import { QuoteRequest, QuoteResponse, SwapRequest, SwapResponse, SOL_MINT } from '../types/shared';

// Jupiter Quote API v6 with authentication (December 2025)
const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';
const PRICE_CACHE_TTL = 2000;

export class JupiterService {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const platformFeeBps = parseInt(this.env.PLATFORM_FEE_BPS) || 30;
    const integratorFeeBps = parseInt(this.env.INTEGRATOR_FEE_BPS) || 50;
    const totalFeeBps = platformFeeBps + integratorFeeBps;

    const params = new URLSearchParams({
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amount: request.amount,
      slippageBps: request.slippageBps.toString(),
      platformFeeBps: totalFeeBps.toString(),
    });

    const response = await fetch(`${JUPITER_API_BASE}/quote?${params}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();

      if (response.status === 401) {
        throw new Error('Jupiter API authentication failed. Please verify JUPITER_API_KEY is set in environment secrets.');
      }

      throw new Error(`Quote failed: ${error}`);
    }

    const quote = await response.json() as any;

    return {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
      platformFee: quote.platformFee?.amount || '0',
      routePlan: quote.routePlan || [],
      contextSlot: quote.contextSlot,
    };
  }

  async buildSwapTransaction(request: SwapRequest): Promise<SwapResponse> {
    const maxSlippage = parseInt(this.env.MAX_SLIPPAGE_BPS) || 1000;
    const quoteSlippage = request.quoteResponse.routePlan?.[0]?.swapInfo
      ? parseInt(request.quoteResponse.priceImpactPct) * 100
      : 100;

    if (quoteSlippage > maxSlippage) {
      throw new Error(`Slippage too high: ${quoteSlippage / 100}%`);
    }

    const body = {
      quoteResponse: request.quoteResponse,
      userPublicKey: request.userPublicKey,
      wrapAndUnwrapSol: request.wrapAndUnwrapSol ?? true,
      computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports,
      prioritizationFeeLamports: request.prioritizationFeeLamports ?? 'auto',
      dynamicComputeUnitLimit: true,
      feeAccount: this.env.FEE_WALLET_ADDRESS,
    };

    const response = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Swap build failed: ${error}`);
    }

    const swap = await response.json() as any;

    return {
      swapTransaction: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
      prioritizationFeeLamports: swap.prioritizationFeeLamports,
    };
  }

  async getPrice(mint: string): Promise<number> {
    const cacheKey = `price:${mint}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as CachedPrice | null;

    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    const params = new URLSearchParams({
      ids: mint,
      vsToken: SOL_MINT,
    });

    const response = await fetch(`https://price.jup.ag/v6/price?${params}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      if (cached) return cached.price;
      throw new Error('Price fetch failed');
    }

    const data = await response.json() as any;
    const price = data.data?.[mint]?.price || 0;

    await this.env.CACHE.put(cacheKey, JSON.stringify({
      price,
      timestamp: Date.now(),
    }), { expirationTtl: 60 });

    return price;
  }

  async getPrices(mints: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    const uncached: string[] = [];

    for (const mint of mints) {
      const cached = await this.env.CACHE.get(`price:${mint}`, 'json') as CachedPrice | null;
      if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
        prices[mint] = cached.price;
      } else {
        uncached.push(mint);
      }
    }

    if (uncached.length > 0) {
      const params = new URLSearchParams({
        ids: uncached.join(','),
        vsToken: SOL_MINT,
      });

      const response = await fetch(`https://price.jup.ag/v6/price?${params}`, {
        headers: this.getHeaders(),
      });

      if (response.ok) {
        const data = await response.json() as any;
        for (const mint of uncached) {
          const price = data.data?.[mint]?.price || 0;
          prices[mint] = price;
          await this.env.CACHE.put(`price:${mint}`, JSON.stringify({
            price,
            timestamp: Date.now(),
          }), { expirationTtl: 60 });
        }
      }
    }

    return prices;
  }

  async searchTokens(query: string): Promise<any[]> {
    const cacheKey = `tokens:search:${query.toLowerCase()}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as any[] | null;

    if (cached) return cached;

    const response = await fetch(
      `https://token.jup.ag/strict?search=${encodeURIComponent(query)}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) return [];

    const tokens = await response.json() as any[];
    const filtered = tokens.slice(0, 20);

    await this.env.CACHE.put(cacheKey, JSON.stringify(filtered), {
      expirationTtl: 300,
    });

    return filtered;
  }

  async getTokenInfo(mint: string): Promise<any | null> {
    const cacheKey = `token:${mint}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json');

    if (cached) return cached;

    // Try the strict list first (verified tokens)
    let response = await fetch(
      `https://token.jup.ag/strict?address=${mint}`,
      { headers: this.getHeaders() }
    );

    let tokens = response.ok ? await response.json() as any[] : [];
    let token = tokens[0] || null;

    // If not found in strict, try the all tokens list
    if (!token) {
      response = await fetch(
        `https://token.jup.ag/all?address=${mint}`,
        { headers: this.getHeaders() }
      );
      tokens = response.ok ? await response.json() as any[] : [];
      token = tokens[0] || null;
    }

    // If still not found, create a basic token object from mint
    if (!token) {
      token = {
        address: mint,
        symbol: mint.slice(0, 6),
        name: `Token ${mint.slice(0, 8)}...`,
        decimals: 9,
        logoURI: null,
      };
    }

    await this.env.CACHE.put(cacheKey, JSON.stringify(token), {
      expirationTtl: 3600,
    });

    return token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.env.JUPITER_API_KEY) {
      headers['Authorization'] = `Bearer ${this.env.JUPITER_API_KEY}`;
    }

    return headers;
  }
}
