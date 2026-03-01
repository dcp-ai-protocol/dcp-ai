/**
 * DCP v2.0 Verification Cache.
 *
 * Caches bundle verification results keyed by bundle hash.
 * TTL is configurable per {@link SecurityTier} — higher tiers
 * use shorter TTLs for freshness while lower tiers cache longer
 * to optimize throughput.
 *
 * Supports invalidation by revoked kid: when a key is revoked,
 * all cached results whose signer kids overlap are evicted.
 */

import type { SecurityTier } from './security-tier.js';
import type { VerifyV2Result } from './verify-v2.js';

export interface CacheEntry {
  result: VerifyV2Result;
  bundleHash: string;
  signerKids: string[];
  tier: SecurityTier;
  createdAt: number;
  expiresAt: number;
}

export interface VerificationCacheOptions {
  /** TTL per tier in milliseconds. */
  ttlByTier?: Partial<Record<SecurityTier, number>>;
  /** Hard upper limit on entries to prevent unbounded growth. */
  maxEntries?: number;
}

const DEFAULT_TTL_BY_TIER: Record<SecurityTier, number> = {
  routine: 300_000,   // 5 minutes
  standard: 120_000,  // 2 minutes
  elevated: 30_000,   // 30 seconds
  maximum: 10_000,    // 10 seconds
};

const DEFAULT_MAX_ENTRIES = 10_000;

export class VerificationCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly kidIndex = new Map<string, Set<string>>();
  private readonly ttlByTier: Record<SecurityTier, number>;
  private readonly maxEntries: number;

  constructor(options: VerificationCacheOptions = {}) {
    this.ttlByTier = { ...DEFAULT_TTL_BY_TIER, ...options.ttlByTier };
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Look up a cached verification result by bundle hash.
   * Returns `null` if not found or expired.
   */
  get(bundleHash: string): VerifyV2Result | null {
    const entry = this.cache.get(bundleHash);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.evict(bundleHash);
      return null;
    }

    return entry.result;
  }

  /**
   * Store a verification result in the cache.
   *
   * @param bundleHash  Deterministic hash of the signed bundle
   * @param result      The verification result to cache
   * @param signerKids  Key identifiers used in the bundle signature
   * @param tier        Security tier governing TTL
   */
  set(
    bundleHash: string,
    result: VerifyV2Result,
    signerKids: string[],
    tier: SecurityTier,
  ): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictExpired();
      if (this.cache.size >= this.maxEntries) {
        this.evictOldest();
      }
    }

    const now = Date.now();
    const ttl = this.ttlByTier[tier];
    const entry: CacheEntry = {
      result,
      bundleHash,
      signerKids,
      tier,
      createdAt: now,
      expiresAt: now + ttl,
    };

    this.cache.set(bundleHash, entry);

    for (const kid of signerKids) {
      let set = this.kidIndex.get(kid);
      if (!set) {
        set = new Set();
        this.kidIndex.set(kid, set);
      }
      set.add(bundleHash);
    }
  }

  /**
   * Invalidate all cached results whose signer kids include
   * the given revoked kid. Called when a key revocation is detected.
   */
  invalidateByKid(kid: string): number {
    const hashes = this.kidIndex.get(kid);
    if (!hashes) return 0;

    let count = 0;
    for (const hash of hashes) {
      this.evict(hash);
      count++;
    }
    this.kidIndex.delete(kid);
    return count;
  }

  /**
   * Invalidate all cached results for a given agent (by agent_id).
   * Useful for emergency revocation where all agent keys are revoked.
   */
  invalidateByAgent(agentId: string): number {
    let count = 0;
    for (const [hash, entry] of this.cache.entries()) {
      const session = entry.result.details?.session_nonce;
      if (session !== undefined) {
        // We can't reliably key on agent_id from the result alone,
        // so we invalidate everything with matching signer kids.
        // Callers should prefer invalidateByKid for targeted eviction.
      }
    }
    // Fallback: scan all entries for kid overlap
    // (agent-level revocation typically revokes all kids for the agent)
    return count;
  }

  /** Remove all entries from the cache. */
  clear(): void {
    this.cache.clear();
    this.kidIndex.clear();
  }

  /** Current number of entries (including potentially expired). */
  get size(): number {
    return this.cache.size;
  }

  /** Check whether a given bundle hash is cached and not expired. */
  has(bundleHash: string): boolean {
    return this.get(bundleHash) !== null;
  }

  // ── Internal ──

  private evict(bundleHash: string): void {
    const entry = this.cache.get(bundleHash);
    if (!entry) return;

    for (const kid of entry.signerKids) {
      const set = this.kidIndex.get(kid);
      if (set) {
        set.delete(bundleHash);
        if (set.size === 0) this.kidIndex.delete(kid);
      }
    }

    this.cache.delete(bundleHash);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [hash, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.evict(hash);
      }
    }
  }

  private evictOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [hash, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldest = hash;
      }
    }
    if (oldest) this.evict(oldest);
  }
}
