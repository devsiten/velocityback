import { Env } from '../types/env';
import { SOL_MINT } from '../types/shared';

// Updated API endpoints (December 2025)
const JUPITER_SWAP_API = "https://api.jup.ag/swap/v1";
const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";
const JUPITER_TOKEN_API = "https://lite-api.jup.ag/tokens/v2";

const PRICE_CACHE_TTL = 2000; // 2 seconds

// USDC mint for USD price calculation
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  userPublicKey?: string;
}

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  platformFee: any;
  routePlan: any[];
  contextSlot: number;
  // USD prices (calculated)
  inAmountUsd?: number;
  outAmountUsd?: number;
  [key: string]: any;
}

export interface SwapRequest {
  quoteResponse: any;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  computeUnitPriceMicroLamports?: number;
  prioritizationFeeLamports?: string | number;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  tags?: string[];
  dailyVolume?: number;
}

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

    // Add fee account if configured
    if (this.env.FEE_WALLET_ADDRESS) {
      params.append('feeAccount', this.env.FEE_WALLET_ADDRESS);
    }

    const response = await fetch(`${JUPITER_SWAP_API}/quote?${params}`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Quote failed: ${error}`);
    }

    const quote = await response.json() as any;

    // Fetch USD prices for input and output tokens
    let inAmountUsd: number | undefined;
    let outAmountUsd: number | undefined;

    try {
      const prices = await this.getUsdPrices([request.inputMint, request.outputMint]);

      const inputDecimals = await this.getTokenDecimals(request.inputMint);
      const outputDecimals = await this.getTokenDecimals(request.outputMint);

      if (prices[request.inputMint]) {
        inAmountUsd = (parseFloat(quote.inAmount) / Math.pow(10, inputDecimals)) * prices[request.inputMint];
      }
      if (prices[request.outputMint]) {
        outAmountUsd = (parseFloat(quote.outAmount) / Math.pow(10, outputDecimals)) * prices[request.outputMint];
      }
    } catch (e) {
      console.error('Failed to fetch USD prices:', e);
    }

    return {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
      platformFee: quote.platformFee || null,
      routePlan: quote.routePlan || [],
      contextSlot: quote.contextSlot,
      inAmountUsd,
      outAmountUsd,
      // Pass through the full quote for swap
      ...quote
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

    const body: any = {
      quoteResponse: request.quoteResponse,
      userPublicKey: request.userPublicKey,
      wrapAndUnwrapSol: request.wrapAndUnwrapSol ?? true,
      computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports,
      prioritizationFeeLamports: request.prioritizationFeeLamports ?? 'auto',
      dynamicComputeUnitLimit: true,
    };

    if (this.env.FEE_WALLET_ADDRESS) {
      body.feeAccount = this.env.FEE_WALLET_ADDRESS;
    }

    const response = await fetch(`${JUPITER_SWAP_API}/swap`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Swap build failed: ${error}`);
    }

    const swap = await response.json() as any;

    return {
      swapTransaction: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
      prioritizationFeeLamports: swap.prioritizationFeeLamports
    };
  }

  // Get USD prices using the Price API V3 (December 2025)
  async getUsdPrices(mints: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    if (mints.length === 0) return prices;

    try {
      const params = new URLSearchParams({
        ids: mints.join(',')
      });

      const response = await fetch(`${JUPITER_PRICE_API}?${params}`, {
        headers: this.getHeaders()
      });

      if (!response.ok) {
        console.error('Price API error:', response.status);
        return prices; // Return empty prices instead of throwing
      }

      const data = await response.json() as any;

      // V3 format: data.data[mint].usdPrice
      for (const mint of mints) {
        if (data.data?.[mint]?.usdPrice) {
          prices[mint] = parseFloat(data.data[mint].usdPrice);
        } else if (data.data?.[mint]?.price) {
          // Fallback to price field for backward compatibility
          prices[mint] = parseFloat(data.data[mint].price);
        }
      }
    } catch (e) {
      console.error('Price fetch error:', e);
      // Return empty prices on error
    }

    return prices;
  }

  // Get price in SOL (for backward compatibility)
  async getPrice(mint: string): Promise<number> {
    const cacheKey = `price:${mint}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as any;

    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    try {
      const prices = await this.getUsdPrices([mint, SOL_MINT]);
      const mintPriceUsd = prices[mint] || 0;
      const solPriceUsd = prices[SOL_MINT] || 1;

      // Convert to SOL price
      const priceInSol = solPriceUsd > 0 ? mintPriceUsd / solPriceUsd : 0;

      await this.env.CACHE.put(cacheKey, JSON.stringify({
        price: priceInSol,
        priceUsd: mintPriceUsd,
        timestamp: Date.now()
      }), { expirationTtl: 60 });

      return priceInSol;
    } catch (e) {
      if (cached) return cached.price;
      throw new Error('Price fetch failed');
    }
  }

  // Get multiple prices
  async getPrices(mints: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    const uncached: string[] = [];

    // Check cache first
    for (const mint of mints) {
      const cached = await this.env.CACHE.get(`price:${mint}`, 'json') as any;
      if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
        prices[mint] = cached.price;
      } else {
        uncached.push(mint);
      }
    }

    if (uncached.length > 0) {
      // Add SOL to get conversion rate
      if (!uncached.includes(SOL_MINT)) {
        uncached.push(SOL_MINT);
      }

      try {
        const usdPrices = await this.getUsdPrices(uncached);
        const solPriceUsd = usdPrices[SOL_MINT] || 150; // fallback SOL price

        for (const mint of uncached) {
          if (mint === SOL_MINT) continue;

          const mintPriceUsd = usdPrices[mint] || 0;
          const priceInSol = solPriceUsd > 0 ? mintPriceUsd / solPriceUsd : 0;

          prices[mint] = priceInSol;

          await this.env.CACHE.put(`price:${mint}`, JSON.stringify({
            price: priceInSol,
            priceUsd: mintPriceUsd,
            timestamp: Date.now()
          }), { expirationTtl: 60 });
        }
      } catch (e) {
        console.error('Failed to fetch prices:', e);
      }
    }

    return prices;
  }

  // Get trending tokens
  async getTrendingTokens(limit: number = 20): Promise<TokenInfo[]> {
    const cacheKey = `trending:${limit}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as TokenInfo[] | null;
    if (cached) return cached;

    // Try the tradable mints with sorting
    const response = await fetch(
      `${JUPITER_TOKEN_API}/mints/tradable`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      // Fallback: return popular tokens
      return this.getPopularTokens();
    }

    const data = await response.json() as any[];

    // Sort by daily volume if available, take top tokens
    const sorted = data
      .filter((t: any) => t.daily_volume > 0)
      .sort((a: any, b: any) => (b.daily_volume || 0) - (a.daily_volume || 0))
      .slice(0, limit);

    const tokens: TokenInfo[] = sorted.map((t: any) => ({
      address: t.address || t.id,
      symbol: t.symbol || 'UNKNOWN',
      name: t.name || 'Unknown',
      decimals: t.decimals || 9,
      logoURI: t.logoURI || t.icon || null,
      tags: t.tags || [],
      dailyVolume: t.daily_volume || 0
    }));

    await this.env.CACHE.put(cacheKey, JSON.stringify(tokens), {
      expirationTtl: 300 // 5 minutes
    });

    return tokens;
  }

  // Fallback popular tokens list
  private async getPopularTokens(): Promise<TokenInfo[]> {
    const popularMints = [
      { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9 },
      { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 },
      { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6 },
      { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5 },
      { mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", name: "Marinade SOL", decimals: 9 },
      { mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", name: "Jito Staked SOL", decimals: 9 },
      { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6 },
      { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", name: "Pyth Network", decimals: 6 },
      { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6 },
      { mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "ETH", name: "Ethereum (Wormhole)", decimals: 8 },
    ];

    return popularMints.map((t) => ({
      address: t.mint,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoURI: `https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/${t.mint}/logo.png`,
      dailyVolume: 0
    }));
  }

  async searchTokens(query: string): Promise<TokenInfo[]> {
    const cacheKey = `tokens:search:${query.toLowerCase()}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as TokenInfo[] | null;
    if (cached) return cached;

    const response = await fetch(
      `${JUPITER_TOKEN_API}/search?query=${encodeURIComponent(query)}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) return [];

    const tokens = await response.json() as any[];

    const filtered: TokenInfo[] = tokens.slice(0, 20).map((t: any) => ({
      address: t.id || t.address,
      symbol: t.symbol || 'UNKNOWN',
      name: t.name || 'Unknown',
      decimals: t.decimals || 9,
      logoURI: t.icon || t.logoURI || null,
      tags: t.tags || [],
      dailyVolume: t.daily_volume || 0
    }));

    await this.env.CACHE.put(cacheKey, JSON.stringify(filtered), {
      expirationTtl: 300
    });

    return filtered;
  }

  async getTokenInfo(mint: string): Promise<TokenInfo | null> {
    const cacheKey = `token:${mint}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as TokenInfo | null;
    if (cached) return cached;

    // Search by mint address
    const response = await fetch(
      `${JUPITER_TOKEN_API}/search?query=${mint}`,
      { headers: this.getHeaders() }
    );

    let token: TokenInfo | null = null;

    if (response.ok) {
      const tokens = await response.json() as any[];
      const found = tokens.find((t: any) => (t.id || t.address) === mint);

      if (found) {
        token = {
          address: found.id || found.address,
          symbol: found.symbol || 'UNKNOWN',
          name: found.name || 'Unknown',
          decimals: found.decimals || 9,
          logoURI: found.icon || found.logoURI || null,
          tags: found.tags || [],
          dailyVolume: found.daily_volume || 0
        };
      }
    }

    // Fallback for unknown tokens
    if (!token) {
      token = {
        address: mint,
        symbol: mint.slice(0, 6),
        name: `Token ${mint.slice(0, 8)}...`,
        decimals: 9,
        logoURI: null
      };
    }

    await this.env.CACHE.put(cacheKey, JSON.stringify(token), {
      expirationTtl: 3600
    });

    return token;
  }

  // Helper to get token decimals
  private async getTokenDecimals(mint: string): Promise<number> {
    // Common tokens
    const knownDecimals: Record<string, number> = {
      'So11111111111111111111111111111111111111112': 9, // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6, // USDT
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 6, // JUP
    };

    if (knownDecimals[mint]) {
      return knownDecimals[mint];
    }

    const tokenInfo = await this.getTokenInfo(mint);
    return tokenInfo?.decimals || 9;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    if (this.env.JUPITER_API_KEY) {
      headers['x-api-key'] = this.env.JUPITER_API_KEY;
    }

    return headers;
  }
}
