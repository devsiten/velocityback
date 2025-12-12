import { Env } from '../types/env';

// Marinade and JitoSOL staking integration
export class StakingService {
    constructor(private env: Env) { }

    // Marinade mSOL staking
    async getMarinadeInfo() {
        const response = await fetch('https://api.marinade.finance/tlv');
        const data = await response.json();
        return {
            tvl: data.tvl,
            apy: data.apy || 7.2, // Approximate APY
            msolPrice: data.msolPrice || 1.08,
        };
    }

    // JitoSOL staking  
    async getJitoInfo() {
        // Jito staking info
        return {
            apy: 7.8, // Approximate APY including MEV rewards
            jitosolPrice: 1.09,
        };
    }

    // Get available staking pools
    async getPools() {
        const [marinade, jito] = await Promise.all([
            this.getMarinadeInfo().catch(() => ({ tvl: 0, apy: 7.2, msolPrice: 1.08 })),
            this.getJitoInfo().catch(() => ({ apy: 7.8, jitosolPrice: 1.09 })),
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
                exchangeRate: marinade.msolPrice,
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
                exchangeRate: jito.jitosolPrice,
            },
        ];
    }

    // Build stake transaction using Jupiter swap (SOL -> mSOL/JitoSOL)
    async buildStakeTransaction(pool: string, amount: string, userPublicKey: string) {
        const pools = await this.getPools();
        const selectedPool = pools.find(p => p.id === pool);

        if (!selectedPool) {
            throw new Error('Invalid staking pool');
        }

        // Use Jupiter to swap SOL to mSOL or JitoSOL
        const quoteResponse = await fetch('https://quote-api.jup.ag/v6/quote?' + new URLSearchParams({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: selectedPool.tokenMint,
            amount: amount,
            slippageBps: '50',
        }));

        const quote = await quoteResponse.json();

        if (quote.error) {
            throw new Error(quote.error);
        }

        // Build swap transaction
        const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: quote,
                userPublicKey,
                wrapAndUnwrapSol: true,
            }),
        });

        const swapData = await swapResponse.json();

        return {
            swapTransaction: swapData.swapTransaction,
            quote,
            pool: selectedPool,
        };
    }

    // Build unstake transaction using Jupiter swap (mSOL/JitoSOL -> SOL)
    async buildUnstakeTransaction(pool: string, amount: string, userPublicKey: string) {
        const pools = await this.getPools();
        const selectedPool = pools.find(p => p.id === pool);

        if (!selectedPool) {
            throw new Error('Invalid staking pool');
        }

        // Use Jupiter to swap mSOL/JitoSOL back to SOL
        const quoteResponse = await fetch('https://quote-api.jup.ag/v6/quote?' + new URLSearchParams({
            inputMint: selectedPool.tokenMint,
            outputMint: 'So11111111111111111111111111111111111111112',
            amount: amount,
            slippageBps: '50',
        }));

        const quote = await quoteResponse.json();

        if (quote.error) {
            throw new Error(quote.error);
        }

        // Build swap transaction
        const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: quote,
                userPublicKey,
                wrapAndUnwrapSol: true,
            }),
        });

        const swapData = await swapResponse.json();

        return {
            swapTransaction: swapData.swapTransaction,
            quote,
            pool: selectedPool,
        };
    }
}
