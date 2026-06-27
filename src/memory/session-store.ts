/**
 * In-memory key-value store for session data and caching.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SessionStore {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic cleanup every 60 seconds
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
    if (typeof this.cleanupTimer.unref === "function") this.cleanupTimer.unref();
  }

  set<T>(key: string, value: T, ttlMs = 300_000): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    this.evictExpired();
    return this.store.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

export const sessionStore = new SessionStore();
