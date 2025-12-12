import { Env } from '../types/env';

export class RPCService {
  private env: Env;
  private primaryFailed = false;
  private lastPrimaryCheck = 0;
  private readonly RETRY_INTERVAL = 30000;

  constructor(env: Env) {
    this.env = env;
  }

  async call<T>(method: string, params: any[]): Promise<T> {
    const endpoint = this.getEndpoint();
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC error: ${response.status}`);
      }

      const data = await response.json() as any;
      
      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }

      if (this.primaryFailed) {
        this.primaryFailed = false;
      }

      return data.result;
    } catch (error) {
      if (!this.primaryFailed && this.env.RPC_ENDPOINT_BACKUP) {
        this.primaryFailed = true;
        this.lastPrimaryCheck = Date.now();
        return this.call(method, params);
      }
      throw error;
    }
  }

  private getEndpoint(): string {
    if (this.primaryFailed) {
      if (Date.now() - this.lastPrimaryCheck > this.RETRY_INTERVAL) {
        this.primaryFailed = false;
      } else if (this.env.RPC_ENDPOINT_BACKUP) {
        return this.env.RPC_ENDPOINT_BACKUP;
      }
    }
    return this.env.RPC_ENDPOINT;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const result = await this.call<any>('getLatestBlockhash', [
      { commitment: 'confirmed' },
    ]);
    return {
      blockhash: result.value.blockhash,
      lastValidBlockHeight: result.value.lastValidBlockHeight,
    };
  }

  async getBalance(publicKey: string): Promise<number> {
    const result = await this.call<any>('getBalance', [
      publicKey,
      { commitment: 'confirmed' },
    ]);
    return result.value;
  }

  async getTokenAccountBalance(account: string): Promise<string> {
    try {
      const result = await this.call<any>('getTokenAccountBalance', [account]);
      return result.value.amount;
    } catch {
      return '0';
    }
  }

  async sendTransaction(serializedTransaction: string): Promise<string> {
    return this.call<string>('sendTransaction', [
      serializedTransaction,
      {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      },
    ]);
  }

  async confirmTransaction(
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number
  ): Promise<boolean> {
    const start = Date.now();
    const timeout = 60000;

    while (Date.now() - start < timeout) {
      try {
        const result = await this.call<any>('getSignatureStatuses', [[signature]]);
        const status = result.value[0];

        if (status) {
          if (status.err) return false;
          if (status.confirmationStatus === 'confirmed' || 
              status.confirmationStatus === 'finalized') {
            return true;
          }
        }

        const blockHeight = await this.call<number>('getBlockHeight', []);
        if (blockHeight > lastValidBlockHeight) {
          return false;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return false;
  }
}
