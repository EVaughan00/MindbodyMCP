import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { mindbodyAuth } from './auth.js';
import { getTenantCreds } from './context.js';

const DEFAULT_API_URL = 'https://api.mindbodyonline.com/public/v6';

class MindbodyApiClient {
  private client: AxiosInstance;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  constructor() {
    this.client = axios.create({
      timeout: 30000,
    });

    // Add request interceptor to set the per-tenant base URL + auth headers
    this.client.interceptors.request.use(async (config) => {
      config.baseURL = getTenantCreds().apiUrl || DEFAULT_API_URL;
      const headers = await mindbodyAuth.getAuthHeaders();
      Object.assign(config.headers, headers);
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && !error.config._retried) {
          // Token might be expired, reset and retry once
          error.config._retried = true;
          mindbodyAuth.resetTokenState();
          const headers = await mindbodyAuth.getAuthHeaders();
          Object.assign(error.config.headers, headers);
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  async request<T>(config: AxiosRequestConfig, retries = 0): Promise<T> {
    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error: any) {
      if (retries < this.maxRetries && this.shouldRetry(error)) {
        // Honor Retry-After on 429s; otherwise exponential backoff.
        const retryAfter = this.retryAfterMs(error);
        const wait = retryAfter ?? this.retryDelay * Math.pow(2, retries);
        await this.delay(wait);
        return this.request<T>(config, retries + 1);
      }

      throw this.formatError(error);
    }
  }

  private shouldRetry(error: any): boolean {
    // Retry on network errors, 5xx errors, or 429 rate limits — but NOT on
    // 401/403 auth errors. 429 matters for heavy paginating tools (e.g. the
    // milestone scan), which can otherwise burst past the 2000 req/hr cap.
    if (!error.response) return true;
    const status = error.response.status;
    return status === 429 || status >= 500;
  }

  // Cap any single retry wait. Mindbody's 429 Retry-After can be the seconds
  // until the hourly-quota reset (hundreds/thousands of seconds); honoring that
  // verbatim would hang every in-flight worker past the 60s serverless limit and
  // return an opaque timeout. We cap the wait so the request instead exhausts its
  // retries quickly and surfaces a readable rate-limit error.
  private readonly maxRetryWaitMs = 8000;

  private retryAfterMs(error: any): number | null {
    if (error.response?.status !== 429) return null;
    const header = error.response.headers?.['retry-after'];
    const seconds = Number(header);
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000;
    return Math.min(wait, this.maxRetryWaitMs);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatError(error: any): Error {
    if (error.response?.data?.Error) {
      const mbError = error.response.data.Error;
      return new Error(`Mindbody API Error: ${mbError.Message} (Code: ${mbError.Code})`);
    }

    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      if (status === 401 || status === 403) {
        return new Error(
          `Mindbody Auth Error (${status}): ${statusText}. ` +
          `Check that the tenant's Mindbody API key is valid and activated for site ${getTenantCreds().siteId}. ` +
          `If using source credentials, verify the source name and password are correct.`
        );
      }
      return new Error(`API Error: ${status} - ${statusText}`);
    }

    return new Error(`Network Error: ${error.message}`);
  }

  // Convenience methods
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }
}

export const mindbodyClient = new MindbodyApiClient();
