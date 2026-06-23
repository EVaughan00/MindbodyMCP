import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request Mindbody credentials for a single tenant (studio).
 *
 * On Vercel each MCP request resolves its tenant from the OAuth bearer token
 * and runs the tool inside `runWithTenant(...)`. Local stdio/SSE usage has no
 * async context, so `getTenantCreds()` falls back to process.env (single-tenant).
 */
export interface TenantCreds {
  /** Mindbody Api-Key header value */
  apiKey: string;
  /** Mindbody SiteId header value */
  siteId: string;
  /** Source/staff username for user-token auth (optional) */
  sourceName?: string;
  /** Source/staff password for user-token auth (optional) */
  sourcePassword?: string;
  /** Override the Mindbody API base URL (optional) */
  apiUrl?: string;
}

const storage = new AsyncLocalStorage<TenantCreds>();

/** Run `fn` with the given tenant credentials available to auth/client/cache. */
export function runWithTenant<T>(creds: TenantCreds, fn: () => Promise<T>): Promise<T> {
  return storage.run(creds, fn);
}

/** Resolve the active tenant credentials, falling back to env for local use. */
export function getTenantCreds(): TenantCreds {
  const ctx = storage.getStore();
  if (ctx) return ctx;

  return {
    apiKey: process.env.MINDBODY_API_KEY || '',
    siteId: process.env.MINDBODY_SITE_ID || '',
    sourceName: process.env.MINDBODY_SOURCE_NAME,
    sourcePassword: process.env.MINDBODY_SOURCE_PASSWORD,
    apiUrl: process.env.MINDBODY_API_URL,
  };
}

/** Stable per-tenant namespace used for token + cache isolation. */
export function getTenantNamespace(): string {
  const creds = getTenantCreds();
  return `${creds.apiKey}:${creds.siteId}`;
}
