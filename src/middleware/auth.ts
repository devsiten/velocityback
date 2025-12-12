import { Context, Next } from 'hono';
import { Env } from '../types/env';
import bs58 from 'bs58';

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const publicKey = c.req.header('X-Public-Key');
  const signature = c.req.header('X-Signature');
  const timestamp = c.req.header('X-Timestamp');

  if (!publicKey) {
    return c.json({ success: false, error: 'Missing public key', code: 'AUTH_REQUIRED' }, 401);
  }

  if (!isValidPublicKey(publicKey)) {
    return c.json({ success: false, error: 'Invalid public key', code: 'INVALID_KEY' }, 401);
  }

  if (signature && timestamp) {
    const timestampNum = parseInt(timestamp);
    const now = Date.now();
    
    if (Math.abs(now - timestampNum) > 300000) {
      return c.json({ success: false, error: 'Request expired', code: 'EXPIRED' }, 401);
    }
  }

  let user = await c.env.DB.prepare(`
    SELECT * FROM users WHERE public_key = ?
  `).bind(publicKey).first<any>();

  if (!user) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO users (id, public_key) VALUES (?, ?)
    `).bind(id, publicKey).run();
    
    user = { id, public_key: publicKey };
  } else {
    await c.env.DB.prepare(`
      UPDATE users SET last_active = unixepoch() WHERE id = ?
    `).bind(user.id).run();
  }

  c.set('userId', user.id);
  c.set('publicKey', publicKey);

  return next();
}

export function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const publicKey = c.req.header('X-Public-Key');
  
  if (publicKey && isValidPublicKey(publicKey)) {
    c.set('publicKey', publicKey);
  }
  
  return next();
}

function isValidPublicKey(key: string): boolean {
  try {
    const decoded = bs58.decode(key);
    return decoded.length === 32;
  } catch {
    return false;
  }
}
