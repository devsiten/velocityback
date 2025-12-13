import { Env } from '../types/env';

// Use the new Jupiter Swap API
const JUPITER_SWAP_API = "https://api.jup.ag/swap/v1";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface StakingPool {
    id: string;
    name: string;
    symbol: string;
    apy: number;
    tvl: number;
    description: string;
    logo: string;
    tokenMint: string;
    exchangeRate: number;
}

export interface StakeResult {
    swapTransaction: string;
    quote: any;
    pool: StakingPool;
}

export class StakingService {
    private env: Env;

    constructor(env: Env) {
        this.env = env;
    }

    // Marinade mSOL staking info
    async getMarinadeInfo(): Promise<{ tvl: number; apy: number; msolPrice: number }> {
        try {
            const response = await fetch('https://api.marinade.finance/tlv');
            if (!response.ok) throw new Error('Marinade API error');
            const data = await response.json() as any;
            return {
                tvl: data.tvl || 0,
                apy: data.apy || 7.2,
                msolPrice: data.msolPrice || 1.08
            };
        } catch (e) {
            return { tvl: 0, apy: 7.2, msolPrice: 1.08 };
        }
    }

    // JitoSOL staking info
    async getJitoInfo(): Promise<{ apy: number; jitosolPrice: number }> {
        // Jito doesn't have a simple public API, use estimates
        return {
            apy: 7.8,
            jitosolPrice: 1.09
        };
    }

    // Get available staking pools
    async getPools(): Promise<StakingPool[]> {
        const [marinade, jito] = await Promise.all([
            this.getMarinadeInfo(),
            this.getJitoInfo()
        ]);

        return [
            {
                id: 'marinade',
                name: 'Marinade',
                symbol: 'mSOL',
                apy: marinade.apy,
                tvl: marinade.tvl,
                description: 'Liquid staking with mSOL',
                logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png',
                tokenMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
                exchangeRate: marinade.msolPrice
            },
            {
                id: 'jito',
                name: 'Jito',
                symbol: 'JitoSOL',
                apy: jito.apy,
                tvl: 0,
                description: 'Liquid staking with MEV rewards',
                logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn/logo.png',
                tokenMint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
                exchangeRate: jito.jitosolPrice
            }
        ];
    }

    // Build stake transaction using Jupiter swap (SOL -> mSOL/JitoSOL)
    async buildStakeTransaction(pool: string, amount: string, userPublicKey: string): Promise<StakeResult> {
        const pools = await this.getPools();
        const selectedPool = pools.find(p => p.id === pool);

        if (!selectedPool) {
            throw new Error('Invalid staking pool');
        }

        // Get quote from Jupiter - using NEW API
        const quoteParams = new URLSearchParams({
            inputMint: SOL_MINT,
            outputMint: selectedPool.tokenMint,
            amount: amount,
            slippageBps: '50'
        });

        const quoteResponse = await fetch(`${JUPITER_SWAP_API}/quote?${quoteParams}`);

        if (!quoteResponse.ok) {
            const error = await quoteResponse.text();
            throw new Error(`Quote failed: ${error}`);
        }

        const quote = await quoteResponse.json();

        if ((quote as any).error) {
            throw new Error((quote as any).error);
        }

        // Build swap transaction - using NEW API
        const swapResponse = await fetch(`${JUPITER_SWAP_API}/swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: quote,
                userPublicKey,
                wrapAndUnwrapSol: true,
                prioritizationFeeLamports: 'auto',
                dynamicComputeUnitLimit: true
            })
        });

        if (!swapResponse.ok) {
            const error = await swapResponse.text();
            throw new Error(`Swap build failed: ${error}`);
        }

        const swapData = await swapResponse.json() as any;

        return {
            swapTransaction: swapData.swapTransaction,
            quote,
            pool: selectedPool
        };
    }

    // Build unstake transaction using Jupiter swap (mSOL/JitoSOL -> SOL)
    async buildUnstakeTransaction(pool: string, amount: string, userPublicKey: string): Promise<StakeResult> {
        const pools = await this.getPools();
        const selectedPool = pools.find(p => p.id === pool);

        if (!selectedPool) {
            throw new Error('Invalid staking pool');
        }

        // Get quote from Jupiter - using NEW API
        const quoteParams = new URLSearchParams({
            inputMint: selectedPool.tokenMint,
            outputMint: SOL_MINT,
            amount: amount,
            slippageBps: '50'
        });

        const quoteResponse = await fetch(`${JUPITER_SWAP_API}/quote?${quoteParams}`);

        if (!quoteResponse.ok) {
            const error = await quoteResponse.text();
            throw new Error(`Quote failed: ${error}`);
        }

        const quote = await quoteResponse.json();

        if ((quote as any).error) {
            throw new Error((quote as any).error);
        }

        // Build swap transaction - using NEW API
        const swapResponse = await fetch(`${JUPITER_SWAP_API}/swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: quote,
                userPublicKey,
                wrapAndUnwrapSol: true,
                prioritizationFeeLamports: 'auto',
                dynamicComputeUnitLimit: true
            })
        });

        if (!swapResponse.ok) {
            const error = await swapResponse.text();
            throw new Error(`Swap build failed: ${error}`);
        }

        const swapData = await swapResponse.json() as any;

        return {
            swapTransaction: swapData.swapTransaction,
            quote,
            pool: selectedPool
        };
    }
}
