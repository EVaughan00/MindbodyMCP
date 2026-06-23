# Hosting the multi-tenant Mindbody MCP on Vercel

This deployment turns the server into a **remote MCP connector** that any number of
studios can connect to from Claude. Each studio ("tenant") brings its own Mindbody
API access; you (the operator) register them in an admin portal. Access is gated by
OAuth, exactly the way Claude's remote connectors expect.

## How it fits together

```
Claude  ──OAuth (discovery → DCR → authorize → token)──▶  /api/oauth/*
   │                                                        │ token ↔ tenant
   └────────── MCP (Streamable HTTP, Bearer token) ───────▶ /api/mcp ──▶ Mindbody API
                                                            ▲
You ── /admin (password) ── create tenants (Mindbody creds + login password)
```

- **Storage:** Upstash Redis (Vercel KV) holds tenants + OAuth state.
- **Auth:** the OAuth access token is bound to one tenant; `/api/mcp` resolves it and
  loads that tenant's Mindbody credentials into request-scoped context, so the existing
  tool code talks to the right studio.

## Endpoints

| Path | Purpose |
|------|---------|
| `/api/mcp` (alias `/mcp`) | MCP Streamable HTTP endpoint (Bearer token required) |
| `/.well-known/oauth-protected-resource` | OAuth resource metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | OAuth AS metadata (RFC 8414) |
| `/api/oauth/register` | Dynamic Client Registration (RFC 7591) |
| `/api/oauth/authorize` | Login + authorization code |
| `/api/oauth/token` | Token + refresh |
| `/admin` (alias `/api/admin`) | Admin portal (HTTP Basic, `ADMIN_PASSWORD`) |
| `/api/admin/tenants` | Tenant CRUD API |

## One-time deploy

1. **Provision storage.** In the Vercel dashboard → your project → **Storage** → add
   **Upstash Redis** (Marketplace). It auto-sets `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.
2. **Set env vars** (Project → Settings → Environment Variables):
   - `ADMIN_PASSWORD` — your admin portal password.
   - (Upstash vars are added automatically by step 1.)
3. **Deploy:** `vercel --prod` (or connect the GitHub repo for auto-deploys).

## Onboard a studio (tenant)

1. Go to `https://<your-app>/admin`, log in with `ADMIN_PASSWORD`.
2. Add a tenant:
   - **Tenant ID** — a short slug the studio types when connecting (e.g. `downtown-yoga`).
   - **Login password** — what the studio enters during the Claude OAuth login.
   - **Mindbody API Key / Site ID / Source name / Source password** — the studio's own
     Mindbody API access.
3. Give the studio: the **MCP URL** (`https://<your-app>/mcp`), their **Tenant ID**, and
   their **password**.

## Connect from Claude

In Claude → **Settings → Connectors → Add custom connector**, paste
`https://<your-app>/mcp`. Claude runs the OAuth flow automatically; the studio enters
their Tenant ID + password on the login screen, and the connector goes live.

## Local development

```bash
npm install
cp .env.example .env          # set ADMIN_PASSWORD; Upstash optional (in-memory fallback)
npm run dev:http              # full stack at http://localhost:3000 (Vercel emulation)
```

Then exercise it: open `http://localhost:3000/admin`, or replay the OAuth flow with curl.
Without Upstash creds the store is in-memory (not persisted) — fine for local testing.

> Single-tenant stdio mode for Claude Desktop still works via `npm run dev` with the
> `MINDBODY_*` vars in `.env`.
