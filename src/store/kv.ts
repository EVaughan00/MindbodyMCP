import { Redis } from '@upstash/redis';

/**
 * Minimal key-value abstraction used for tenants + OAuth state.
 *
 * Production: Upstash Redis (Vercel KV) over REST — serverless friendly.
 * Local dev / tests: in-memory fallback (no setup required, not shared across
 * processes, so it is only for local single-instance use).
 *
 * Values are JSON-encoded by this layer (automaticDeserialization disabled) so
 * behaviour is identical across backends.
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

function resolveUpstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return { url, token };
  return null;
}

class UpstashKv implements Kv {
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token, automaticDeserialization: false });
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get<string>(key);
    if (raw == null) return null;
    return JSON.parse(raw as string) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.set(key, raw, { ex: ttlSeconds });
    } else {
      await this.redis.set(key, raw);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async sadd(key: string, member: string): Promise<void> {
    await this.redis.sadd(key, member);
  }

  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(key, member);
  }

  async smembers(key: string): Promise<string[]> {
    return (await this.redis.smembers(key)) as string[];
  }
}

interface MemEntry {
  value: string;
  expiresAt?: number;
}

class MemoryKv implements Kv {
  private store = new Map<string, MemEntry>();
  private sets = new Map<string, Set<string>>();

  private alive(entry: MemEntry | undefined): entry is MemEntry {
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt < Date.now()) return false;
    return true;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!this.alive(entry)) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(entry!.value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value: JSON.stringify(value),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async sadd(key: string, member: string): Promise<void> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    this.sets.get(key)!.add(member);
  }

  async srem(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }
}

let instance: Kv | null = null;

export function getKv(): Kv {
  if (instance) return instance;

  const upstash = resolveUpstashConfig();
  if (upstash) {
    instance = new UpstashKv(upstash.url, upstash.token);
  } else {
    if (process.env.VERCEL) {
      console.warn(
        '[store] No Upstash/KV credentials found — using in-memory store. ' +
        'Data will NOT persist across serverless invocations. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'
      );
    }
    instance = new MemoryKv();
  }
  return instance;
}
