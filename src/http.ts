import type { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';

/** Apply permissive CORS headers. Returns true if the request was a preflight. */
export function applyCors(req: { method?: string }, res: ServerResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Gate an admin route behind HTTP Basic auth (username ignored, password checked
 * against ADMIN_PASSWORD). Returns true if authorized; otherwise responds 401.
 */
export function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('ADMIN_PASSWORD is not configured on the server.');
    return false;
  }

  const auth = (req.headers['authorization'] as string) || '';
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (m) {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (safeEqual(pass, expected)) return true;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Mindbody MCP Admin"');
  res.statusCode = 401;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Authentication required.');
  return false;
}
