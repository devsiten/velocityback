import bs58 from 'bs58';

export function validateMint(mint: string): boolean {
  try {
    const decoded = bs58.decode(mint);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function validateAmount(amount: string): boolean {
  const num = BigInt(amount);
  return num > 0n && num <= BigInt('18446744073709551615');
}

export function validateSlippage(slippageBps: number, maxBps: number): boolean {
  return Number.isInteger(slippageBps) && slippageBps >= 1 && slippageBps <= maxBps;
}

export function validatePrice(price: number): boolean {
  return typeof price === 'number' && price > 0 && isFinite(price);
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateQuoteRequest(body: any, maxSlippage: number): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!body.inputMint || !validateMint(body.inputMint)) {
    errors.push({ field: 'inputMint', message: 'Invalid input mint address' });
  }

  if (!body.outputMint || !validateMint(body.outputMint)) {
    errors.push({ field: 'outputMint', message: 'Invalid output mint address' });
  }

  if (!body.amount || !validateAmount(body.amount)) {
    errors.push({ field: 'amount', message: 'Invalid amount' });
  }

  if (body.slippageBps === undefined || !validateSlippage(body.slippageBps, maxSlippage)) {
    errors.push({ field: 'slippageBps', message: `Slippage must be between 1 and ${maxSlippage} bps` });
  }

  if (!body.userPublicKey || !validateMint(body.userPublicKey)) {
    errors.push({ field: 'userPublicKey', message: 'Invalid user public key' });
  }

  return errors;
}

export function validateStrategyRequest(body: any, maxSlippage: number): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!body.tokenMint || !validateMint(body.tokenMint)) {
    errors.push({ field: 'tokenMint', message: 'Invalid token mint address' });
  }

  if (!body.tokenSymbol || typeof body.tokenSymbol !== 'string' || body.tokenSymbol.length > 20) {
    errors.push({ field: 'tokenSymbol', message: 'Invalid token symbol' });
  }

  if (!['buy_dip', 'take_profit'].includes(body.type)) {
    errors.push({ field: 'type', message: 'Type must be buy_dip or take_profit' });
  }

  if (!validatePrice(body.triggerPrice)) {
    errors.push({ field: 'triggerPrice', message: 'Invalid trigger price' });
  }

  if (!body.amount || !validateAmount(body.amount)) {
    errors.push({ field: 'amount', message: 'Invalid amount' });
  }

  if (body.slippageBps === undefined || !validateSlippage(body.slippageBps, maxSlippage)) {
    errors.push({ field: 'slippageBps', message: `Slippage must be between 1 and ${maxSlippage} bps` });
  }

  return errors;
}

export function sanitizeString(str: string, maxLength = 100): string {
  return str.replace(/[<>'"]/g, '').slice(0, maxLength);
}
