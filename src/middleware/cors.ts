import { Context, Next } from 'hono';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://velocity.trade',
  'https://app.velocity.trade',
  'https://velocity-dxg.pages.dev',
];

export async function corsMiddleware(c: Context, next: Next) {
  const origin = c.req.header('Origin');
  
  if (origin && (ALLOWED_ORIGINS.includes(origin) || c.env.ENVIRONMENT === 'development')) {
    c.header('Access-Control-Allow-Origin', origin);
  }
  
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Public-Key, X-Signature, X-Timestamp');
  c.header('Access-Control-Max-Age', '86400');
  c.header('Access-Control-Allow-Credentials', 'true');

  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }

  return next();
}
