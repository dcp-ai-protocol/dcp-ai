/**
 * DCP v2.0 Verification Cache.
 *
 * Caches bundle verification results keyed by bundle hash and, opt-in, by a caller-supplied
 * context. TTL is configurable per {@link SecurityTier} — higher tiers use shorter TTLs for
 * freshness while lower tiers cache longer to optimize throughput.
 *
 * Supports invalidation by revoked kid: when a key is revoked, all cached results whose signer
 * kids overlap are evicted, in every context. A hit is a local memo of an earlier result: it does
 * not recheck the session, trust, revocation or policy, and it is not admission or authorization.
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
  /**
   * TTL per tier in milliseconds: a number from 0 to Number.MAX_SAFE_INTEGER. `undefined` keeps
   * the default. `set` refuses a TTL whose deadline (clock reading + TTL) exceeds
   * Number.MAX_SAFE_INTEGER.
   */
  ttlByTier?: Partial<Record<SecurityTier, number>>;
  /**
   * Hard upper limit on entries to prevent unbounded growth: a safe integer from 1 to
   * Number.MAX_SAFE_INTEGER.
   */
  maxEntries?: number;
}

/** Options for {@link VerificationCache.set}. The cache derives none of them. */
export interface VerificationCacheSetOptions {
  /**
   * Agents this result is associated with, for {@link VerificationCache.invalidateByAgent}.
   * Not checked against the bundle: pass the passport agent_id of the bundle you verified.
   * Absent or empty means no explicit association.
   */
  agentIds?: readonly string[];
  /**
   * Isolation key chosen by the caller and compared as an exact string. It must change whenever
   * the content of an input to your decision changes (verifier policy, tenant, trusted principals,
   * revocation state); the cache cannot tell whether it does.
   */
  context?: string;
}

/** Options for {@link VerificationCache.get} and {@link VerificationCache.has}. */
export interface VerificationCacheLookupOptions {
  /** The context the result was stored under; absent means the legacy, context-free entries. */
  context?: string;
}

interface StoredEntry extends CacheEntry {
  context?: string;
  agentIds?: readonly string[];
  indexedKids: readonly string[];
  monotonicCreatedAt: number;
  monotonicDeadline: number;
}

interface Clocks {
  wall: number;
  monotonic: number;
}

const TIERS: readonly SecurityTier[] = ['routine', 'standard', 'elevated', 'maximum'];

const DEFAULT_TTL_BY_TIER: Record<SecurityTier, number> = {
  routine: 300_000, // 5 minutes
  standard: 120_000, // 2 minutes
  elevated: 30_000, // 30 seconds
  maximum: 10_000, // 10 seconds
};

const DEFAULT_MAX_ENTRIES = 10_000;

/** Wall clock and monotonic clock, or null when either is unavailable or not finite. */
function readClocks(): Clocks | null {
  const perf = globalThis.performance;
  if (typeof perf?.now !== 'function') return null;
  const wall = Date.now();
  const monotonic = perf.now();
  if (!Number.isFinite(wall) || !Number.isFinite(monotonic)) return null;
  return { wall, monotonic };
}

function isPlainOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkHash(bundleHash: unknown): asserts bundleHash is string {
  if (typeof bundleHash !== 'string')
    throw new TypeError('VerificationCache: bundleHash must be a string');
}

function lookupContext(options: unknown): string | undefined {
  if (options === undefined) return undefined;
  if (!isPlainOptions(options))
    throw new TypeError('VerificationCache: lookup options must be an object');
  const { context } = options;
  if (context !== undefined && typeof context !== 'string') {
    throw new TypeError('VerificationCache: context must be a string');
  }
  return context;
}

// Tagged tuples keep the legacy and context routes apart: JSON.stringify of an array of strings
// is injective, and the first element differs.
function internalKey(context: string | undefined, bundleHash: string): string {
  return context === undefined
    ? JSON.stringify(['legacy', bundleHash])
    : JSON.stringify(['context', context, bundleHash]);
}

function isLive(entry: StoredEntry, clocks: Clocks | null): boolean {
  return (
    clocks !== null &&
    entry.monotonicCreatedAt <= clocks.monotonic &&
    clocks.monotonic < entry.monotonicDeadline &&
    entry.createdAt <= clocks.wall &&
    clocks.wall < entry.expiresAt
  );
}

function addToIndex(index: Map<string, Set<string>>, id: string, key: string): void {
  let set = index.get(id);
  if (!set) {
    set = new Set();
    index.set(id, set);
  }
  set.add(key);
}

function removeFromIndex(index: Map<string, Set<string>>, id: string, key: string): void {
  const set = index.get(id);
  if (set) {
    set.delete(key);
    if (set.size === 0) index.delete(id);
  }
}

export class VerificationCache {
  private readonly cache = new Map<string, StoredEntry>();
  private readonly kidIndex = new Map<string, Set<string>>();
  private readonly agentIndex = new Map<string, Set<string>>();
  private readonly unassociated = new Set<string>();
  private readonly ttlByTier: Record<SecurityTier, number>;
  private readonly maxEntries: number;

  /**
   * @throws TypeError when `options` or `ttlByTier` is not an object
   * @throws RangeError when a TTL is not a number from 0 to Number.MAX_SAFE_INTEGER, or `maxEntries`
   *                    is not a safe integer from 1 to Number.MAX_SAFE_INTEGER
   * @throws Error when `performance.now()` is unavailable (there is no fallback to `Date.now()`)
   */
  constructor(options: VerificationCacheOptions = {}) {
    if (!isPlainOptions(options as unknown))
      throw new TypeError('VerificationCache: options must be an object');
    const { ttlByTier, maxEntries } = options;
    if (ttlByTier !== undefined && !isPlainOptions(ttlByTier as unknown)) {
      throw new TypeError('VerificationCache: ttlByTier must be an object');
    }
    const ttls = { ...DEFAULT_TTL_BY_TIER };
    for (const tier of TIERS) {
      const ttl = ttlByTier?.[tier];
      if (ttl === undefined) continue;
      if (
        typeof ttl !== 'number' ||
        !Number.isFinite(ttl) ||
        ttl < 0 ||
        ttl > Number.MAX_SAFE_INTEGER
      ) {
        throw new RangeError(
          `VerificationCache: ttlByTier.${tier} must be a number from 0 to Number.MAX_SAFE_INTEGER`,
        );
      }
      ttls[tier] = ttl;
    }
    if (
      maxEntries !== undefined &&
      !(typeof maxEntries === 'number' && Number.isSafeInteger(maxEntries) && maxEntries >= 1)
    ) {
      throw new RangeError('VerificationCache: maxEntries must be a safe integer from 1 to Number.MAX_SAFE_INTEGER');
    }
    if (typeof globalThis.performance?.now !== 'function') {
      throw new Error(
        'VerificationCache: performance.now() is required for the monotonic deadline',
      );
    }
    this.ttlByTier = ttls;
    this.maxEntries = maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Look up a cached verification result by bundle hash, in the legacy route or, with
   * `options.context`, in that context only.
   * Returns a new deep copy on every hit, or `null` if not found or expired.
   */
  get(bundleHash: string, options?: VerificationCacheLookupOptions): VerifyV2Result | null {
    const entry = this.liveEntry(bundleHash, options);
    return entry ? structuredClone(entry.result) : null;
  }

  /**
   * Store a verification result in the cache. Nothing changes when it throws.
   *
   * @param bundleHash  Deterministic hash of the signed bundle
   * @param result      The verification result to cache (copied)
   * @param signerKids  Key identifiers used in the bundle signature (copied); the kids in
   *                    `result.details.signer_keys` are indexed as well
   * @param tier        Security tier governing TTL; an unknown name gets the elevated TTL
   * @param options     Opt-in agent association and context
   * @throws TypeError on an argument of the wrong type
   * @throws RangeError when a clock reading is not finite or a deadline exceeds Number.MAX_SAFE_INTEGER
   * @throws DOMException (DataCloneError) when `result` cannot be structured-cloned
   */
  set(
    bundleHash: string,
    result: VerifyV2Result,
    signerKids: string[],
    tier: SecurityTier,
    options?: VerificationCacheSetOptions,
  ): void {
    // Prepare: everything that can throw happens before the cache is touched.
    checkHash(bundleHash);
    if (typeof result !== 'object' || result === null) {
      throw new TypeError('VerificationCache: result must be an object');
    }
    // Array.from gives a dense copy, so a hole is checked as undefined instead of being skipped.
    const kids = Array.isArray(signerKids) ? Array.from(signerKids) : null;
    if (!kids || !kids.every((kid) => typeof kid === 'string')) {
      throw new TypeError('VerificationCache: signerKids must be an array of strings');
    }
    if (options !== undefined && !isPlainOptions(options as unknown)) {
      throw new TypeError('VerificationCache: set options must be an object');
    }
    const context = options?.context;
    if (context !== undefined && typeof context !== 'string') {
      throw new TypeError('VerificationCache: context must be a string');
    }
    const rawAgents = options?.agentIds;
    const agentList =
      rawAgents === undefined ? [] : Array.isArray(rawAgents) ? Array.from(rawAgents) : null;
    if (!agentList || !agentList.every((id) => typeof id === 'string' && id !== '')) {
      throw new TypeError('VerificationCache: agentIds must be an array of non-empty strings');
    }
    const agentIds = [...new Set<string>(agentList)];

    const clocks = readClocks();
    if (!clocks)
      throw new RangeError('VerificationCache: clock reading is not available or not finite');
    // An unknown tier name gets the elevated TTL; without a TTL the entry never expired.
    const ttl = this.ttlByTier[Object.hasOwn(this.ttlByTier, tier) ? tier : 'elevated'];
    const expiresAt = clocks.wall + ttl;
    const monotonicDeadline = clocks.monotonic + ttl;
    if (expiresAt > Number.MAX_SAFE_INTEGER || monotonicDeadline > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('VerificationCache: TTL deadline exceeds Number.MAX_SAFE_INTEGER');
    }

    const stored = structuredClone(result);
    const indexed = new Set<string>(kids);
    const signerKeys = stored.details?.signer_keys;
    if (Array.isArray(signerKeys)) {
      for (const use of signerKeys) {
        if (typeof use?.kid === 'string') indexed.add(use.kid);
      }
    }
    const key = internalKey(context, bundleHash);

    // Commit: only Map and Set operations from here on.
    this.evict(key);
    if (ttl === 0) return; // never stored, never a hit; the older entry above is gone

    if (this.cache.size >= this.maxEntries) {
      this.evictExpired(clocks);
      while (this.cache.size >= this.maxEntries) this.evictOldest();
    }

    const entry: StoredEntry = {
      result: stored,
      bundleHash,
      signerKids: kids,
      tier,
      createdAt: clocks.wall,
      expiresAt,
      indexedKids: [...indexed],
      monotonicCreatedAt: clocks.monotonic,
      monotonicDeadline,
    };
    if (context !== undefined) entry.context = context;
    if (agentIds.length > 0) entry.agentIds = agentIds;
    this.cache.set(key, entry);

    for (const kid of entry.indexedKids) addToIndex(this.kidIndex, kid, key);
    for (const agentId of agentIds) addToIndex(this.agentIndex, agentId, key);
    if (agentIds.length === 0) this.unassociated.add(key);
  }

  /**
   * Invalidate all cached results, in every context, whose signer kids include
   * the given revoked kid. Called when a key revocation is detected.
   */
  invalidateByKid(kid: string): number {
    const keys = this.kidIndex.get(kid);
    if (!keys) return 0;

    let count = 0;
    for (const key of [...keys]) {
      this.evict(key);
      count++;
    }
    this.kidIndex.delete(kid);
    return count;
  }

  /**
   * Invalidate, in every context, the results stored with `agentId` in `agentIds` and every
   * result stored without an explicit agent association (legacy calls, or `agentIds` absent or
   * empty): the cache cannot tell whose those are, so it evicts them deliberately. Results
   * associated only with other agents are kept. Returns the total number removed, so a non-zero
   * count does not mean the agent had entries.
   *
   * @throws TypeError when `agentId` is not a non-empty string
   */
  invalidateByAgent(agentId: string): number {
    if (typeof agentId !== 'string' || agentId === '') {
      throw new TypeError('VerificationCache: agentId must be a non-empty string');
    }
    const keys = new Set<string>(this.unassociated);
    for (const key of this.agentIndex.get(agentId) ?? []) keys.add(key);
    for (const key of keys) this.evict(key);
    return keys.size;
  }

  /** Remove all entries from the cache. */
  clear(): void {
    this.cache.clear();
    this.kidIndex.clear();
    this.agentIndex.clear();
    this.unassociated.clear();
  }

  /** Current number of entries in every context (including potentially expired). */
  get size(): number {
    return this.cache.size;
  }

  /** Check whether a given bundle hash is cached and not expired, without copying the result. */
  has(bundleHash: string, options?: VerificationCacheLookupOptions): boolean {
    return this.liveEntry(bundleHash, options) !== null;
  }

  // ── Internal ──

  private liveEntry(bundleHash: string, options: unknown): StoredEntry | null {
    checkHash(bundleHash);
    const key = internalKey(lookupContext(options), bundleHash);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Both clocks bound the lifetime. An unreadable clock, or either clock reading earlier than at
    // creation, is a miss that evicts, never a revival; a wall-clock step back that stays after
    // creation is bounded by the monotonic deadline instead.
    if (!isLive(entry, readClocks())) {
      this.evict(key);
      return null;
    }

    return entry;
  }

  private evict(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;

    for (const kid of entry.indexedKids) removeFromIndex(this.kidIndex, kid, key);
    for (const agentId of entry.agentIds ?? []) removeFromIndex(this.agentIndex, agentId, key);
    this.unassociated.delete(key);

    this.cache.delete(key);
  }

  private evictExpired(clocks: Clocks): void {
    for (const [key, entry] of this.cache.entries()) {
      if (!isLive(entry, clocks)) {
        this.evict(key);
      }
    }
  }

  // Insertion order: a replacement is deleted and re-inserted, so the first key is the oldest set.
  private evictOldest(): void {
    const first = this.cache.keys().next();
    if (!first.done) this.evict(first.value);
  }
}
