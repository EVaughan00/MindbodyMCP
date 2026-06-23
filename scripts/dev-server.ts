/**
 * Local dev server that emulates the Vercel runtime for the /api functions.
 *
 *   npm run dev:http
 *
 * It wires up the same routes as vercel.json + file-based routing and adds the
 * Vercel req/res helpers (req.query, req.body, res.status/json/send) so the
 * serverless handlers run unchanged. Use this to exercise the full OAuth +
 * admin + MCP flow locally before deploying. NOT used in production.
 */
import http, { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

import mcp from '../api/mcp.js';
import protectedResource from '../api/well-known/protected-resource.js';
import authorizationServer from '../api/well-known/authorization-server.js';
import register from '../api/oauth/register.js';
import authorize from '../api/oauth/authorize.js';
import token from '../api/oauth/token.js';
import admin from '../api/admin.js';
import adminTenants from '../api/admin/tenants.js';

type Handler = (req: any, res: any) => any;

const routes: Array<{ test: (path: string) => boolean; handler: Handler }> = [
  { test: (p) => p === '/.well-known/oauth-protected-resource' || p.startsWith('/.well-known/oauth-protected-resource/'), handler: protectedResource },
  { test: (p) => p === '/.well-known/oauth-authorization-server' || p.startsWith('/.well-known/oauth-authorization-server/'), handler: authorizationServer },
  { test: (p) => p === '/api/oauth/register', handler: register },
  { test: (p) => p === '/api/oauth/authorize', handler: authorize },
  { test: (p) => p === '/api/oauth/token', handler: token },
  { test: (p) => p === '/api/admin/tenants', handler: adminTenants },
  { test: (p) => p === '/admin' || p === '/api/admin', handler: admin },
  { test: (p) => p === '/mcp' || p === '/api/mcp', handler: mcp },
];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function parseBody(raw: string, contentType: string): any {
  if (!raw) return undefined;
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return undefined; }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try { return JSON.parse(raw); } catch { return raw; }
}

function augment(req: any, res: any, url: URL, body: any) {
  req.query = Object.fromEntries(url.searchParams);
  req.body = body;
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (obj: any) => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  res.send = (data: any) => { res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); return res; };
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const route = routes.find((r) => r.test(path));

  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found', path }));
    return;
  }

  let body: any;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const raw = await readBody(req);
    body = parseBody(raw, (req.headers['content-type'] as string) || '');
  }

  augment(req, res, url, body);
  try {
    await route.handler(req, res);
  } catch (err: any) {
    console.error('Handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'internal_error', message: err?.message }));
    }
  }
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, () => {
  console.log(`Dev server (Vercel emulation) running at http://localhost:${port}`);
  console.log(`  Admin portal:   http://localhost:${port}/admin`);
  console.log(`  MCP endpoint:   http://localhost:${port}/mcp`);
  console.log(`  Discovery:      http://localhost:${port}/.well-known/oauth-authorization-server`);
});
