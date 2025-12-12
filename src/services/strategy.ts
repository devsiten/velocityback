import { Env } from '../types/env';
import { Strategy, StrategyCreateRequest, SOL_MINT } from '../types/shared';
import { JupiterService } from './jupiter';

export class StrategyService {
  private env: Env;
  private jupiter: JupiterService;

  constructor(env: Env) {
    this.env = env;
    this.jupiter = new JupiterService(env);
  }

  async createStrategy(userId: string, request: StrategyCreateRequest): Promise<Strategy> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await this.env.DB.prepare(`
      INSERT INTO strategies (id, user_id, token_mint, token_symbol, type, trigger_price, amount, slippage_bps, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(
      id,
      userId,
      request.tokenMint,
      request.tokenSymbol,
      request.type,
      request.triggerPrice,
      request.amount,
      request.slippageBps,
      now,
      now
    ).run();

    return {
      id,
      userId,
      tokenMint: request.tokenMint,
      tokenSymbol: request.tokenSymbol,
      type: request.type,
      triggerPrice: request.triggerPrice,
      amount: request.amount,
      slippageBps: request.slippageBps,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  }

  async getUserStrategies(userId: string): Promise<Strategy[]> {
    const results = await this.env.DB.prepare(`
      SELECT * FROM strategies WHERE user_id = ? ORDER BY created_at DESC
    `).bind(userId).all<any>();

    return results.results.map(this.mapStrategy);
  }

  async getStrategy(id: string, userId: string): Promise<Strategy | null> {
    const result = await this.env.DB.prepare(`
      SELECT * FROM strategies WHERE id = ? AND user_id = ?
    `).bind(id, userId).first<any>();

    return result ? this.mapStrategy(result) : null;
  }

  async updateStrategyStatus(id: string, userId: string, status: Strategy['status']): Promise<boolean> {
    const result = await this.env.DB.prepare(`
      UPDATE strategies SET status = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?
    `).bind(status, id, userId).run();

    return result.meta.changes > 0;
  }

  async deleteStrategy(id: string, userId: string): Promise<boolean> {
    const result = await this.env.DB.prepare(`
      DELETE FROM strategies WHERE id = ? AND user_id = ?
    `).bind(id, userId).run();

    return result.meta.changes > 0;
  }

  async checkTriggers(): Promise<{ strategyId: string; shouldTrigger: boolean; currentPrice: number }[]> {
    const activeStrategies = await this.env.DB.prepare(`
      SELECT * FROM strategies WHERE status = 'active'
    `).all<any>();

    if (activeStrategies.results.length === 0) return [];

    const tokenMints = [...new Set(activeStrategies.results.map((s: any) => s.token_mint))];
    const prices = await this.jupiter.getPrices(tokenMints as string[]);

    const results: { strategyId: string; shouldTrigger: boolean; currentPrice: number }[] = [];

    for (const strategy of activeStrategies.results) {
      const currentPrice = prices[strategy.token_mint] || 0;
      if (currentPrice === 0) continue;

      let shouldTrigger = false;

      if (strategy.type === 'buy_dip') {
        shouldTrigger = currentPrice <= strategy.trigger_price;
      } else if (strategy.type === 'take_profit') {
        shouldTrigger = currentPrice >= strategy.trigger_price;
      }

      results.push({
        strategyId: strategy.id,
        shouldTrigger,
        currentPrice,
      });

      if (shouldTrigger) {
        await this.env.DB.prepare(`
          UPDATE strategies SET status = 'triggered', updated_at = unixepoch() WHERE id = ?
        `).bind(strategy.id).run();

        await this.env.DB.prepare(`
          INSERT INTO strategy_executions (id, strategy_id, trigger_price, actual_price, status, created_at)
          VALUES (?, ?, ?, ?, 'triggered', unixepoch())
        `).bind(crypto.randomUUID(), strategy.id, strategy.trigger_price, currentPrice).run();
      }
    }

    return results;
  }

  async prepareStrategyExecution(strategyId: string, userPublicKey: string) {
    const strategy = await this.env.DB.prepare(`
      SELECT * FROM strategies WHERE id = ? AND status = 'triggered'
    `).bind(strategyId).first<any>();

    if (!strategy) {
      throw new Error('Strategy not found or not in triggered state');
    }

    const inputMint = strategy.type === 'buy_dip' ? SOL_MINT : strategy.token_mint;
    const outputMint = strategy.type === 'buy_dip' ? strategy.token_mint : SOL_MINT;

    const quote = await this.jupiter.getQuote({
      inputMint,
      outputMint,
      amount: strategy.amount,
      slippageBps: strategy.slippage_bps,
      userPublicKey,
    });

    const swap = await this.jupiter.buildSwapTransaction({
      quoteResponse: quote as any,
      userPublicKey,
    });

    return {
      strategy: this.mapStrategy(strategy),
      quote,
      swap,
    };
  }

  async markStrategyExecuted(strategyId: string, txSignature: string): Promise<void> {
    await this.env.DB.prepare(`
      UPDATE strategies 
      SET status = 'executed', executed_at = unixepoch(), tx_signature = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(txSignature, strategyId).run();

    await this.env.DB.prepare(`
      UPDATE strategy_executions 
      SET status = 'executed', tx_signature = ?
      WHERE strategy_id = ? AND status = 'triggered'
    `).bind(txSignature, strategyId).run();
  }

  async markStrategyFailed(strategyId: string, error: string): Promise<void> {
    await this.env.DB.prepare(`
      UPDATE strategies SET status = 'failed', updated_at = unixepoch() WHERE id = ?
    `).bind(strategyId).run();

    await this.env.DB.prepare(`
      UPDATE strategy_executions 
      SET status = 'failed', error_message = ?
      WHERE strategy_id = ? AND status = 'triggered'
    `).bind(error, strategyId).run();
  }

  private mapStrategy(row: any): Strategy {
    return {
      id: row.id,
      userId: row.user_id,
      tokenMint: row.token_mint,
      tokenSymbol: row.token_symbol,
      type: row.type,
      triggerPrice: row.trigger_price,
      amount: row.amount,
      slippageBps: row.slippage_bps,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      executedAt: row.executed_at,
      txSignature: row.tx_signature,
    };
  }
}
