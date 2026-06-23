#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import dotenv from 'dotenv';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { createMcpServer } from './server.js';

// Load environment variables
dotenv.config();

/**
 * Local CLI entry point (stdio / SSE).
 *
 * This is for single-tenant local development and Claude Desktop, where one
 * studio's credentials live in process.env. The multi-tenant Vercel deployment
 * uses the serverless functions in /api instead (see api/mcp.ts).
 */

// Validate required environment variables for local single-tenant use
const requiredEnvVars = [
  'MINDBODY_API_KEY',
  'MINDBODY_SITE_ID',
  'MINDBODY_SOURCE_NAME',
  'MINDBODY_SOURCE_PASSWORD',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    console.error('Please copy .env.example to .env and fill in your credentials');
    process.exit(1);
  }
}

const server = createMcpServer();

// Parse command-line arguments
function parseArgs(): { transport: 'stdio' | 'sse'; port?: number; host?: string; sslCert?: string; sslKey?: string } {
  const args = process.argv.slice(2);
  let transport: 'stdio' | 'sse' = 'stdio';
  let port: number | undefined;
  let host: string | undefined;
  let sslCert: string | undefined;
  let sslKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--transport' || arg === '-t') {
      const value = args[++i];
      if (value === 'sse' || value === 'stdio') {
        transport = value;
      }
    } else if (arg === '--port' || arg === '-p') {
      port = parseInt(args[++i], 10);
    } else if (arg === '--host' || arg === '-h') {
      host = args[++i];
    } else if (arg === '--ssl-cert') {
      sslCert = args[++i];
    } else if (arg === '--ssl-key') {
      sslKey = args[++i];
    }
  }

  if (process.env.MCP_TRANSPORT) {
    transport = process.env.MCP_TRANSPORT.toLowerCase() as 'stdio' | 'sse';
  }
  if (!port && process.env.MCP_PORT) {
    port = parseInt(process.env.MCP_PORT, 10);
  }
  if (!host && process.env.MCP_HOST) {
    host = process.env.MCP_HOST;
  }
  if (!sslCert && process.env.MCP_SSL_CERT) {
    sslCert = process.env.MCP_SSL_CERT;
  }
  if (!sslKey && process.env.MCP_SSL_KEY) {
    sslKey = process.env.MCP_SSL_KEY;
  }

  return { transport, port, host, sslCert, sslKey };
}

// Start SSE server (legacy local transport)
async function startSSEServer(config: { port?: number; host?: string; sslCert?: string; sslKey?: string }) {
  const port = config.port || 3000;
  const host = config.host || '0.0.0.0';

  let httpServer: http.Server | https.Server;

  if (config.sslCert && config.sslKey) {
    try {
      const sslOptions = {
        cert: fs.readFileSync(config.sslCert),
        key: fs.readFileSync(config.sslKey),
      };
      httpServer = https.createServer(sslOptions);
      console.error(`Starting HTTPS SSE server on ${host}:${port}`);
    } catch (error) {
      console.error('Failed to load SSL certificates:', error);
      console.error('Falling back to HTTP server');
      httpServer = http.createServer();
    }
  } else {
    httpServer = http.createServer();
    console.error(`Starting HTTP SSE server on ${host}:${port}`);
  }

  httpServer.on('request', async (req, res) => {
    const corsOrigin = process.env.MCP_CORS_ORIGIN || '*';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin });
      res.end(JSON.stringify({
        status: 'healthy',
        server: 'mindbody-mcp',
        version: process.env.MCP_SERVER_VERSION || '2.0.0',
        transport: 'sse',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (req.url === '/sse' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': corsOrigin,
        'X-Accel-Buffering': 'no',
      });

      const transport = new SSEServerTransport('/sse', res as any);
      await server.connect(transport);
      req.on('close', () => transport.close());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      console.error(`Mindbody MCP Server v2.0 (SSE) listening on ${host}:${port}`);
      resolve();
    });
    httpServer.on('error', reject);
  });

  const shutdown = async () => {
    console.error('\nShutting down SSE server gracefully...');
    await server.close();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startStdioServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mindbody MCP Server v2.0 started (STDIO) - Complete yoga studio management');
}

async function main() {
  const config = parseArgs();
  console.error('Starting Mindbody MCP Server v2.0');
  console.error(`Transport: ${config.transport.toUpperCase()}`);

  if (config.transport === 'sse') {
    await startSSEServer(config);
  } else {
    await startStdioServer();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
