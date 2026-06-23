import { getTenantNamespace } from '../api/context.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: Date;
}

export class SimpleCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL: number;

  constructor(defaultTTLMinutes: number = 5) {
    this.defaultTTL = defaultTTLMinutes * 60 * 1000; // Convert to milliseconds
  }

  // Prefix every key with the active tenant namespace so cached Mindbody data
  // is never shared across studios on a warm serverless instance.
  private nsKey(key: string): string {
    return `${getTenantNamespace()}::${key}`;
  }

  set<T>(key: string, value: T, ttlMinutes?: number): void {
    const ttl = ttlMinutes ? ttlMinutes * 60 * 1000 : this.defaultTTL;
    const expiresAt = new Date(Date.now() + ttl);

    this.cache.set(this.nsKey(key), {
      data: value,
      expiresAt,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(this.nsKey(key));

    if (!entry) {
      return null;
    }

    if (entry.expiresAt < new Date()) {
      this.cache.delete(this.nsKey(key));
      return null;
    }

    return entry.data as T;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): void {
    this.cache.delete(this.nsKey(key));
  }

  // Clean up expired entries
  cleanup(): void {
    const now = new Date();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}

// Create singleton instances for different cache purposes
export const teacherCache = new SimpleCache(60); // 1 hour for teacher data
export const classCache = new SimpleCache(5);    // 5 minutes for class data
export const generalCache = new SimpleCache(10); // 10 minutes for general data

// Run cleanup every 5 minutes
setInterval(() => {
  teacherCache.cleanup();
  classCache.cleanup();
  generalCache.cleanup();
}, 5 * 60 * 1000);
