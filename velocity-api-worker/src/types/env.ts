export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  JUPITER_API_KEY: string;
  RPC_ENDPOINT: string;
  RPC_ENDPOINT_BACKUP: string;
  FEE_WALLET_ADDRESS: string;
  API_SECRET_KEY: string;
  ENVIRONMENT: string;
  PLATFORM_FEE_BPS: string;
  INTEGRATOR_FEE_BPS: string;
  MAX_SLIPPAGE_BPS: string;
  PRICE_POLL_INTERVAL_MS: string;
}

export interface CachedPrice {
  price: number;
  timestamp: number;
}

export interface CachedQuote {
  quote: any;
  timestamp: number;
}
