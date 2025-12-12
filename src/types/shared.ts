export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  price?: number;
}

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  userPublicKey: string;
}

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  platformFee: string;
  routePlan: RoutePlan[];
  contextSlot: number;
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface SwapRequest {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  computeUnitPriceMicroLamports?: number;
  prioritizationFeeLamports?: number | 'auto';
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

export interface Strategy {
  id: string;
  userId: string;
  tokenMint: string;
  tokenSymbol: string;
  type: 'buy_dip' | 'take_profit';
  triggerPrice: number;
  amount: string;
  slippageBps: number;
  status: 'active' | 'paused' | 'triggered' | 'executed' | 'failed';
  createdAt: number;
  updatedAt: number;
  executedAt?: number;
  txSignature?: string;
}

export interface StrategyCreateRequest {
  tokenMint: string;
  tokenSymbol: string;
  type: 'buy_dip' | 'take_profit';
  triggerPrice: number;
  amount: string;
  slippageBps: number;
}

export interface UserPoints {
  userId: string;
  totalPoints: number;
  tradeCount: number;
  volumeUsd: number;
  weeklyPoints: number;
  weekStart: number;
  rank?: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  publicKey: string;
  points: number;
  tradeCount: number;
  volumeUsd: number;
}

export interface TradeHistory {
  id: string;
  userId: string;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inAmount: string;
  outAmount: string;
  txSignature: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  priceImpactPct: string;
  platformFee: string;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const PRESET_AMOUNTS = [
  { label: '0.1 SOL', value: '100000000' },
  { label: '0.5 SOL', value: '500000000' },
  { label: '1 SOL', value: '1000000000' },
  { label: '5 SOL', value: '5000000000' },
];

export const SLIPPAGE_PRESETS = [
  { label: '0.5%', value: 50 },
  { label: '1%', value: 100 },
  { label: '2%', value: 200 },
  { label: '5%', value: 500 },
];
