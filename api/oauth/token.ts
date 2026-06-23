import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomToken, verifyPkce } from '../../src/oauth/index.js';
import {
  ACCESS_TOKEN_TTL,
  consumeAuthCode,
  consumeRefreshToken,
  getClient,
  saveAccessToken,
  saveRefreshToken,
} from '../../src/store/index.js';
import { applyCors } from '../../src/http.js';

/**
 * Token endpoint. Supports the authorization_code and refresh_token grants.
 * Public (PKCE) and confidential clients are both accepted.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'invalid_request', error_description: 'POST required' });
  }

  const body = (req.body || {}) as Record<string, string>;
  const grantType = body.grant_type;
  const { clientId, clientSecret } = extractClientCreds(req, body);

  const client = await getClient(clientId);
  if (!client) {
    return res.status(401).json({ error: 'invalid_client' });
  }
  // Confidential clients must present their secret.
  if (client.tokenEndpointAuthMethod !== 'none' && client.clientSecret !== clientSecret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  if (grantType === 'authorization_code') {
    return handleAuthCode(res, client.clientId, body);
  }
  if (grantType === 'refresh_token') {
    return handleRefresh(res, client.clientId, body);
  }
  return res.status(400).json({ error: 'unsupported_grant_type' });
}

async function handleAuthCode(res: VercelResponse, clientId: string, body: Record<string, string>) {
  const code = body.code;
  if (!code) return res.status(400).json({ error: 'invalid_request', error_description: 'code required' });

  const authCode = await consumeAuthCode(code);
  if (!authCode) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'code invalid or expired' });
  }
  if (authCode.clientId !== clientId) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'client mismatch' });
  }
  if (body.redirect_uri && body.redirect_uri !== authCode.redirectUri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }
  if (!verifyPkce(body.code_verifier || '', authCode.codeChallenge, authCode.codeChallengeMethod)) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }

  return issueTokens(res, authCode.tenantId, clientId, authCode.scope);
}

async function handleRefresh(res: VercelResponse, clientId: string, body: Record<string, string>) {
  const refreshToken = body.refresh_token;
  if (!refreshToken) return res.status(400).json({ error: 'invalid_request' });

  const data = await consumeRefreshToken(refreshToken);
  if (!data || data.clientId !== clientId) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token invalid' });
  }
  return issueTokens(res, data.tenantId, clientId, data.scope);
}

async function issueTokens(res: VercelResponse, tenantId: string, clientId: string, scope?: string) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);

  await saveAccessToken(accessToken, { tenantId, clientId, scope });
  await saveRefreshToken(refreshToken, { tenantId, clientId, scope });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: scope || 'mcp',
  });
}

function extractClientCreds(req: VercelRequest, body: Record<string, string>): { clientId: string; clientSecret?: string } {
  const auth = req.headers.authorization || '';
  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx >= 0) {
      return {
        clientId: decodeURIComponent(decoded.slice(0, idx)),
        clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
      };
    }
  }
  return { clientId: body.client_id || '', clientSecret: body.client_secret };
}
