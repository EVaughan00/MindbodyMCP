import { createHash, randomBytes } from 'crypto';
import type { IncomingMessage } from 'http';

/** Generate a URL-safe random token / id. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Verify a PKCE code_verifier against a stored code_challenge. */
export function verifyPkce(verifier: string, challenge?: string, method?: string): boolean {
  if (!challenge) return true; // no PKCE was used
  if (method === 'plain') {
    return verifier === challenge;
  }
  // default + 'S256'
  const hashed = createHash('sha256').update(verifier).digest('base64url');
  return hashed === challenge;
}

/**
 * Resolve the public base URL of the deployment.
 * Prefers PUBLIC_BASE_URL; otherwise derives from forwarded headers (Vercel).
 */
export function getBaseUrl(req: IncomingMessage): string {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  const headers = req.headers;
  const proto = (headers['x-forwarded-proto'] as string)?.split(',')[0] || 'https';
  const host = (headers['x-forwarded-host'] as string) || (headers['host'] as string) || 'localhost:3000';
  return `${proto}://${host}`;
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728). */
export function protectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
  };
}

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    registration_endpoint: `${baseUrl}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  };
}
