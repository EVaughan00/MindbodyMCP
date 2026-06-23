import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { getKv } from './kv.js';
import type { TenantCreds } from '../api/context.js';

// ---------------------------------------------------------------------------
// Password hashing (used for per-tenant OAuth login passwords)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  mindbodyApiKey: string;
  mindbodySiteId: string;
  mindbodySourceName?: string;
  mindbodySourcePassword?: string;
  mindbodyApiUrl?: string;
  passwordHash: string;
  createdAt: string;
}

/** Tenant fields safe to expose to the admin UI (no secrets). */
export interface TenantPublic {
  id: string;
  name: string;
  mindbodySiteId: string;
  mindbodySourceName?: string;
  mindbodyApiUrl?: string;
  hasApiKey: boolean;
  hasSourcePassword: boolean;
  createdAt: string;
}

const TENANT_INDEX = 'tenants:index';
const tenantKey = (id: string) => `tenant:${id}`;

export function tenantToPublic(t: Tenant): TenantPublic {
  return {
    id: t.id,
    name: t.name,
    mindbodySiteId: t.mindbodySiteId,
    mindbodySourceName: t.mindbodySourceName,
    mindbodyApiUrl: t.mindbodyApiUrl,
    hasApiKey: !!t.mindbodyApiKey,
    hasSourcePassword: !!t.mindbodySourcePassword,
    createdAt: t.createdAt,
  };
}

export function tenantToCreds(t: Tenant): TenantCreds {
  return {
    apiKey: t.mindbodyApiKey,
    siteId: t.mindbodySiteId,
    sourceName: t.mindbodySourceName,
    sourcePassword: t.mindbodySourcePassword,
    apiUrl: t.mindbodyApiUrl,
  };
}

export async function getTenant(id: string): Promise<Tenant | null> {
  return getKv().get<Tenant>(tenantKey(id));
}

export async function listTenants(): Promise<Tenant[]> {
  const ids = await getKv().smembers(TENANT_INDEX);
  const tenants = await Promise.all(ids.map((id) => getTenant(id)));
  return tenants.filter((t): t is Tenant => t !== null);
}

export async function saveTenant(t: Tenant): Promise<void> {
  const kv = getKv();
  await kv.set(tenantKey(t.id), t);
  await kv.sadd(TENANT_INDEX, t.id);
}

export async function deleteTenant(id: string): Promise<void> {
  const kv = getKv();
  await kv.del(tenantKey(id));
  await kv.srem(TENANT_INDEX, id);
}

export async function verifyTenantLogin(id: string, password: string): Promise<Tenant | null> {
  const tenant = await getTenant(id);
  if (!tenant) return null;
  if (!verifyPassword(password, tenant.passwordHash)) return null;
  return tenant;
}

// ---------------------------------------------------------------------------
// OAuth records (clients, authorization codes, tokens)
// ---------------------------------------------------------------------------

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
  tokenEndpointAuthMethod: string;
  createdAt: string;
}

export interface AuthCode {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scope?: string;
}

export interface AccessToken {
  tenantId: string;
  clientId: string;
  scope?: string;
}

export interface RefreshToken {
  tenantId: string;
  clientId: string;
  scope?: string;
}

const clientKey = (id: string) => `oauth:client:${id}`;
const codeKey = (code: string) => `oauth:code:${code}`;
const accessKey = (token: string) => `oauth:access:${token}`;
const refreshKey = (token: string) => `oauth:refresh:${token}`;

export const AUTH_CODE_TTL = 600; // 10 minutes
export const ACCESS_TOKEN_TTL = 3600; // 1 hour
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

export async function saveClient(client: OAuthClient): Promise<void> {
  await getKv().set(clientKey(client.clientId), client);
}
export async function getClient(clientId: string): Promise<OAuthClient | null> {
  return getKv().get<OAuthClient>(clientKey(clientId));
}

export async function saveAuthCode(code: string, data: AuthCode): Promise<void> {
  await getKv().set(codeKey(code), data, AUTH_CODE_TTL);
}
export async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  const kv = getKv();
  const data = await kv.get<AuthCode>(codeKey(code));
  if (data) await kv.del(codeKey(code));
  return data;
}

export async function saveAccessToken(token: string, data: AccessToken): Promise<void> {
  await getKv().set(accessKey(token), data, ACCESS_TOKEN_TTL);
}
export async function getAccessToken(token: string): Promise<AccessToken | null> {
  return getKv().get<AccessToken>(accessKey(token));
}

export async function saveRefreshToken(token: string, data: RefreshToken): Promise<void> {
  await getKv().set(refreshKey(token), data, REFRESH_TOKEN_TTL);
}
export async function consumeRefreshToken(token: string): Promise<RefreshToken | null> {
  const kv = getKv();
  const data = await kv.get<RefreshToken>(refreshKey(token));
  if (data) await kv.del(refreshKey(token));
  return data;
}
