import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomToken } from '../../src/oauth/index.js';
import { getClient, saveAuthCode, verifyTenantLogin, type AuthCode } from '../../src/store/index.js';
import { applyCors } from '../../src/http.js';

/**
 * Authorization endpoint.
 *  - GET:  render a per-tenant login form (studio enters tenant id + password)
 *  - POST: validate login, mint an authorization code, redirect back to Claude
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  const params = req.method === 'POST' ? (req.body as Record<string, string>) : (req.query as Record<string, string>);

  const clientId = str(params.client_id);
  const redirectUri = str(params.redirect_uri);
  const state = str(params.state);
  const scope = str(params.scope) || 'mcp';
  const codeChallenge = str(params.code_challenge);
  const codeChallengeMethod = str(params.code_challenge_method);
  const responseType = str(params.response_type) || 'code';

  // --- Validate the client + redirect_uri before trusting anything ----------
  const client = await getClient(clientId);
  if (!client) {
    return res.status(400).send(errorPage('Unknown client_id. Re-add the connector in Claude.'));
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return res.status(400).send(errorPage('redirect_uri does not match the registered client.'));
  }
  if (responseType !== 'code') {
    return redirectError(res, redirectUri, state, 'unsupported_response_type');
  }

  // --- GET: show the login form --------------------------------------------
  if (req.method !== 'POST') {
    return res.status(200).setHeader('Content-Type', 'text/html').send(
      loginPage({ clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, clientName: client.clientName })
    );
  }

  // --- POST: process login --------------------------------------------------
  const tenantId = str(params.tenant_id).trim();
  const password = str(params.password);

  const tenant = await verifyTenantLogin(tenantId, password);
  if (!tenant) {
    return res.status(401).setHeader('Content-Type', 'text/html').send(
      loginPage(
        { clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, clientName: client.clientName },
        'Invalid tenant ID or password.'
      )
    );
  }

  const code = randomToken(32);
  const authCode: AuthCode = {
    tenantId: tenant.id,
    clientId,
    redirectUri,
    codeChallenge: codeChallenge || undefined,
    codeChallengeMethod: codeChallengeMethod || undefined,
    scope,
  };
  await saveAuthCode(code, authCode);

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
}

function str(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  return v == null ? '' : String(v);
}

function redirectError(res: VercelResponse, redirectUri: string, state: string, error: string) {
  try {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (state) url.searchParams.set('state', state);
    res.statusCode = 302;
    res.setHeader('Location', url.toString());
    res.end();
  } catch {
    res.status(400).send(errorPage(error));
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface FormCtx {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientName?: string;
}

function loginPage(ctx: FormCtx, error?: string): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${esc(value)}">`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Mindbody MCP</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#1a1d24;border:1px solid #2a2f3a;border-radius:14px;padding:32px;width:340px;box-shadow:0 8px 40px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 4px}
  p.sub{color:#9aa0aa;font-size:13px;margin:0 0 20px}
  label{display:block;font-size:12px;color:#9aa0aa;margin:14px 0 6px}
  input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #2a2f3a;background:#0f1115;color:#e8eaed;font-size:14px}
  button{margin-top:22px;width:100%;padding:11px;border:0;border-radius:8px;background:#4f8cff;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#3d7bef}
  .err{background:#3a1d22;border:1px solid #5a2a32;color:#ffb4bd;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:8px}
  .app{color:#4f8cff}
</style></head>
<body>
  <form class="card" method="POST" action="/api/oauth/authorize">
    <h1>Connect your studio</h1>
    <p class="sub">${ctx.clientName ? `<span class="app">${esc(ctx.clientName)}</span> wants` : 'Claude wants'} to access your Mindbody account.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <label for="tenant_id">Tenant ID</label>
    <input id="tenant_id" name="tenant_id" type="text" autocomplete="username" autofocus required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    ${hidden('client_id', ctx.clientId)}
    ${hidden('redirect_uri', ctx.redirectUri)}
    ${hidden('state', ctx.state)}
    ${hidden('scope', ctx.scope)}
    ${hidden('code_challenge', ctx.codeChallenge)}
    ${hidden('code_challenge_method', ctx.codeChallengeMethod)}
    ${hidden('response_type', 'code')}
    <button type="submit">Authorize</button>
  </form>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorization error</title>
<style>body{font-family:-apple-system,sans-serif;background:#0f1115;color:#e8eaed;display:flex;min-height:100vh;align-items:center;justify-content:center}
.box{max-width:420px;padding:28px;background:#1a1d24;border:1px solid #2a2f3a;border-radius:12px}</style></head>
<body><div class="box"><h2>Authorization error</h2><p>${esc(message)}</p></div></body></html>`;
}
