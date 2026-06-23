import axios from 'axios';
import { getTenantCreds, getTenantNamespace, TenantCreds } from './context.js';

interface TokenResponse {
  TokenType: string;
  AccessToken: string;
  ExpiresIn: number;
}

interface UserToken {
  token: string;
  expiresAt: Date;
}

const DEFAULT_API_URL = 'https://api.mindbodyonline.com/public/v6';

/**
 * Mindbody user-token auth, isolated per tenant.
 *
 * Tokens are cached per tenant namespace (apiKey:siteId) so a warm serverless
 * instance serving multiple studios never leaks one studio's token to another.
 */
class MindbodyAuth {
  private tokenCache = new Map<string, UserToken>();
  private tokenFailed = new Set<string>();

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

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + response.data.ExpiresIn - 60);

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
