import axios from 'axios';
import { getTenantCreds, getTenantNamespace, TenantCreds } from './context.js';

interface TokenResponse {
  TokenType: string;
  AccessToken: string;
  ExpiresIn?: number; // not documented/returned by Mindbody — handled defensively
}

interface UserToken {
  token: string;
  expiresAt: Date;
}

const DEFAULT_API_URL = 'https://api.mindbodyonline.com/public/v6';

// Mindbody's /usertoken/issue response does NOT include an expiry field (just
// TokenType + AccessToken + User), and the tokens are valid for ~7 days. We
// cache conservatively for 6 hours; if the token is ever rejected early, the
// 401 path in the API client resets state and re-issues.
const DEFAULT_TOKEN_TTL_SECONDS = 6 * 60 * 60;

/**
 * Mindbody user-token auth, isolated per tenant.
 *
 * Tokens are cached per tenant namespace (apiKey:siteId) so a warm serverless
 * instance serving multiple studios never leaks one studio's token to another.
 */
class MindbodyAuth {
  private tokenCache = new Map<string, UserToken>();
  private tokenFailed = new Set<string>();
  // In-flight token issuance per tenant, so a burst of concurrent requests on a
  // cold cache shares ONE /usertoken/issue call instead of each firing its own.
  private inFlight = new Map<string, Promise<string | null>>();

  private hasSourceCredentials(creds: TenantCreds): boolean {
    return !!(creds.sourceName && creds.sourcePassword);
  }

  async getUserToken(): Promise<string | null> {
    const creds = getTenantCreds();
    const ns = getTenantNamespace();

    if (!this.hasSourceCredentials(creds)) {
      return null;
    }

    // If token acquisition previously failed for this tenant, don't keep retrying
    if (this.tokenFailed.has(ns)) {
      return null;
    }

    const cached = this.tokenCache.get(ns);
    if (cached && cached.expiresAt > new Date()) {
      return cached.token;
    }

    // Coalesce concurrent issuance: if a token request for this tenant is
    // already running, await it instead of starting a second one.
    const pending = this.inFlight.get(ns);
    if (pending) return pending;

    const issue = this.issueToken(ns, creds);
    this.inFlight.set(ns, issue);
    try {
      return await issue;
    } finally {
      this.inFlight.delete(ns);
    }
  }

  private async issueToken(ns: string, creds: TenantCreds): Promise<string | null> {
    try {
      const response = await axios.post<TokenResponse>(
        `${creds.apiUrl || DEFAULT_API_URL}/usertoken/issue`,
        {
          Username: creds.sourceName,
          Password: creds.sourcePassword,
        },
        {
          headers: {
            'Api-Key': creds.apiKey,
            'SiteId': creds.siteId,
            'Content-Type': 'application/json',
          },
        }
      );

      // ExpiresIn is not part of the documented response — only honor it if the
      // API actually returns a sane positive number; otherwise use the default TTL.
      const expiresIn =
        Number.isFinite(response.data.ExpiresIn) && response.data.ExpiresIn > 0
          ? response.data.ExpiresIn - 60
          : DEFAULT_TOKEN_TTL_SECONDS;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      this.tokenCache.set(ns, { token: response.data.AccessToken, expiresAt });
      this.tokenFailed.delete(ns);
      return response.data.AccessToken;
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.Error?.Message || error.message;
      console.error(`User token acquisition failed (${status}): ${message}. Falling back to API-key-only auth.`);
      this.tokenFailed.add(ns);
      return null;
    }
  }

  /** Reset token failure state for the active tenant so the next request retries. */
  resetTokenState(): void {
    const ns = getTenantNamespace();
    this.tokenFailed.delete(ns);
    this.tokenCache.delete(ns);
  }

  getHeaders(): Record<string, string> {
    const creds = getTenantCreds();
    return {
      'Api-Key': creds.apiKey,
      'SiteId': creds.siteId,
      'Content-Type': 'application/json',
    };
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    const headers = this.getHeaders();
    const token = await this.getUserToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }
}

export const mindbodyAuth = new MindbodyAuth();
