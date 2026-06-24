import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomToken } from '../../src/oauth/index.js';
import { saveClient, type OAuthClient } from '../../src/store/index.js';
import { applyCors } from '../../src/http.js';

/**
 * Dynamic Client Registration (RFC 7591).
 * Claude calls this automatically to register itself before the OAuth flow.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body || {}) as Record<string, any>;
  const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

  if (redirectUris.length === 0) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'At least one redirect_uri is required',
    });
  }

  // Only allow https callbacks (or http on loopback for local dev). Prevents an
  // attacker from registering a client that exfiltrates a studio's auth code.
  const isAllowedRedirect = (u: string): boolean => {
    try {
      const url = new URL(u);
      if (url.protocol === 'https:') return true;
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
      return false;
    } catch {
      return false;
    }
  };
  if (!redirectUris.every(isAllowedRedirect)) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must be https (or http://localhost for development)',
    });
  }

  const requestedAuthMethod: string = body.token_endpoint_auth_method || 'none';
  const tokenEndpointAuthMethod = requestedAuthMethod === 'none' ? 'none' : 'client_secret_post';

  const client: OAuthClient = {
    clientId: randomToken(16),
    clientSecret: tokenEndpointAuthMethod === 'none' ? undefined : randomToken(32),
    redirectUris,
    clientName: body.client_name,
    tokenEndpointAuthMethod,
    createdAt: new Date().toISOString(),
  };

  await saveClient(client);

  return res.status(201).json({
    client_id: client.clientId,
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: client.clientName,
  });
}
