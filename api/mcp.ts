import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../src/server.js';
import { runWithTenant } from '../src/api/context.js';
import { getAccessToken, getTenant, tenantToCreds } from '../src/store/index.js';
import { getBaseUrl } from '../src/oauth/index.js';
import { applyCors } from '../src/http.js';

/**
 * Multi-tenant MCP endpoint (Streamable HTTP, stateless).
 *
 * Each request must carry an OAuth bearer token. The token resolves to a tenant
 * whose Mindbody credentials are loaded into request-scoped context, so the
 * existing tool code transparently talks to the right studio's Mindbody account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  // --- Authenticate ---------------------------------------------------------
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return unauthorized(req, res);

  const tokenData = await getAccessToken(match[1]);
  if (!tokenData) return unauthorized(req, res);

  const tenant = await getTenant(tokenData.tenantId);
  if (!tenant) return unauthorized(req, res);

  // --- Serve MCP within the tenant's credential context ---------------------
  await runWithTenant(tenantToCreds(tenant), async () => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}

function unauthorized(req: VercelRequest, res: VercelResponse) {
  const baseUrl = getBaseUrl(req);
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({
    error: 'invalid_token',
    error_description: 'Missing or invalid access token. Authorize via OAuth first.',
  });
}
