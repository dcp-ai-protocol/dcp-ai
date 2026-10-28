/**
 * VerificationCache: options, internal keys and contexts, indexes after replacement, copies,
 * negative results, atomic set, agent association and the two clocks
 * (docs/API_REFERENCE.md#verificationcache).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerificationCache } from '../core/verification-cache.js';
import type { CacheEntry, VerificationCacheOptions } from '../core/verification-cache.js';
import type { SecurityTier } from '../core/security-tier.js';
import type { VerifyV2Result } from '../core/verify-v2.js';

const ok = (): VerifyV2Result => ({ verified: true, errors: [], warnings: [] });

// Both clocks under the test's control: wall = Date.now(), monotonic = performance.now().
function controlClocks(wall: number, monotonic: number) {
  const clock = { wall, monotonic };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.wall);
  vi.spyOn(performance, 'now').mockImplementation(() => clock.monotonic);
  return {
    clock,
    advance(ms: number) {
      clock.wall += ms;
      clock.monotonic += ms;
    },
  };
}

// The private kid index, read only to measure that it does not grow.
const kidIndexSize = (cache: VerificationCache) =>
  (cache as unknown as { kidIndex: Map<string, Set<string>> }).kidIndex.size;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VerificationCache options', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -1],
    ['string', '1000'],
    ['beyond MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 2],
  ])('refuses a %s TTL', (_label, ttl) => {
    expect(
      () => new VerificationCache({ ttlByTier: { routine: ttl as number } }),
    ).toThrow(RangeError);
  });

  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -5],
    ['fraction', 1.5],
    ['string', '2'],
  ])('refuses a %s maxEntries', (_label, max) => {
    expect(() => new VerificationCache({ maxEntries: max as number })).toThrow(RangeError);
  });

  it('refuses options and ttlByTier that are not objects', () => {
    expect(() => new VerificationCache(null as unknown as VerificationCacheOptions)).toThrow(TypeError);
    expect(
      () => new VerificationCache({ ttlByTier: 5 as unknown as VerificationCacheOptions['ttlByTier'] }),
    ).toThrow(TypeError);
  });

  it('takes the default for an explicit undefined and ignores unknown keys', () => {
    const { advance } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache({
      ttlByTier: { routine: undefined, bogus: 5 } as unknown as VerificationCacheOptions['ttlByTier'],
      maxEntries: undefined,
    });
    cache.set('r', ok(), ['k'], 'routine');
    cache.set('b', ok(), ['k'], 'bogus' as SecurityTier);
    advance(10);
    expect(cache.has('b')).toBe(true); // the unknown key 'bogus: 5' is ignored
    advance(29_990);
    expect(cache.has('b')).toBe(false); // the unknown tier gets the elevated TTL
    advance(269_999);
    expect(cache.has('r')).toBe(true);
    advance(1);
    expect(cache.has('r')).toBe(false); // undefined took the 5-minute default, not "never"
  });

  it('requires performance.now() and has no Date.now() fallback', () => {
    vi.stubGlobal('performance', undefined);
    expect(() => new VerificationCache()).toThrow(Error);
  });
});

describe('VerificationCache keys and contexts', () => {
  const awkward = ['', '\u0000', '|', ':', '"', '\\', '[', ']', '\u0000["ctx","h"]', '["legacy","h"]',
    '["context","ctx","h"]', 'ctx","h', '\ud800'];

  it('keeps legacy hashes and context entries apart, whatever the strings', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', { ...ok(), warnings: ['ctx'] }, ['k'], 'routine', { context: 'ctx' });
    for (const hash of awkward) {
      expect(cache.get(hash), JSON.stringify(hash)).toBeNull();
      cache.set(hash, { ...ok(), warnings: [`legacy:${hash}`] }, ['k'], 'routine');
    }
    expect(cache.get('h', { context: 'ctx' })?.warnings).toEqual(['ctx']);
    for (const hash of awkward) {
      expect(cache.get(hash)?.warnings).toEqual([`legacy:${hash}`]);
      for (const context of awkward) {
        if (context === 'ctx' && hash === 'h') continue;
        expect(cache.has(hash, { context })).toBe(false);
      }
    }
  });

  it('does not cross between context A, context B and the legacy route', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', { ...ok(), warnings: ['A'] }, ['k'], 'routine', { context: 'A' });
    expect(cache.get('h')).toBeNull();
    expect(cache.get('h', { context: 'B' })).toBeNull();
    cache.set('h', { ...ok(), warnings: ['legacy'] }, ['k'], 'routine');
    expect(cache.get('h', { context: 'A' })?.warnings).toEqual(['A']);
    expect(cache.get('h')?.warnings).toEqual(['legacy']);
    expect(cache.size).toBe(2);
  });

  it('validates the lookup context and the hash type', () => {
    const cache = new VerificationCache();
    expect(() => cache.get('h', { context: 5 as unknown as string })).toThrow(TypeError);
    expect(() => cache.has('h', 'ctx' as unknown as { context: string })).toThrow(TypeError);
    expect(() => cache.get(123 as unknown as string)).toThrow(TypeError);
  });

  it('invalidateByKid evicts in every route', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', ok(), ['k'], 'routine');
    cache.set('h', ok(), ['k'], 'routine', { context: 'A' });
    cache.set('h', ok(), ['other'], 'routine', { context: 'B' });
    expect(cache.invalidateByKid('k')).toBe(2);
    expect(cache.has('h', { context: 'B' })).toBe(true);
  });
});

describe('VerificationCache indexes and capacity', () => {
  it('a replacement leaves no stale kid in the index', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', ok(), ['kid-old'], 'routine');
    cache.set('h', ok(), ['kid-new'], 'routine');
    expect(cache.invalidateByKid('kid-old')).toBe(0);
    expect(cache.has('h')).toBe(true);
  });

  it('repeated replacements with fresh kids do not grow the index', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    for (let i = 0; i < 1000; i++) cache.set('h', ok(), [`kid-${i}`], 'routine');
    expect(cache.size).toBe(1);
    expect(kidIndexSize(cache)).toBe(1);
  });

  it('a replacement in a full cache does not evict another entry', () => {
    const { advance } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ maxEntries: 2 });
    cache.set('a', ok(), ['k'], 'routine');
    advance(1);
    cache.set('b', ok(), ['k'], 'routine');
    advance(1);
    cache.set('b', ok(), ['k'], 'routine');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(true);
  });

  it("keeps '' a valid hash and still bounds the cache", () => {
    const { advance } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ maxEntries: 1 });
    cache.set('', ok(), ['k'], 'routine');
    expect(cache.has('')).toBe(true);
    for (let i = 0; i < 50; i++) {
      advance(1);
      cache.set(`h${i}`, ok(), ['k'], 'routine');
    }
    expect(cache.size).toBe(1);
    expect(cache.has('')).toBe(false);
  });

  it('indexes the kids of details.signer_keys as well as the caller kids', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    const result: VerifyV2Result = {
      ...ok(),
      details: {
        signer_keys: [
          { signature: 'bundle', component: 'pq', kid: 'pq-kid', alg: 'ml-dsa-65', public_key_b64: 'x', verified: true },
        ],
      },
    };
    cache.set('h', result, ['classical-kid'], 'routine');
    expect(cache.invalidateByKid('pq-kid')).toBe(1);
    expect(cache.has('h')).toBe(false);
  });
});

describe('VerificationCache copies', () => {
  it('stores a copy: changing the original after set changes nothing', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    const result: VerifyV2Result = { verified: false, errors: ['signature invalid'], warnings: [] };
    const kids = ['k1'];
    cache.set('h', result, kids, 'routine');
    result.verified = true;
    result.errors.length = 0;
    kids.push('k2');
    expect(cache.get('h')).toEqual({ verified: false, errors: ['signature invalid'], warnings: [] });
    expect(cache.invalidateByKid('k2')).toBe(0);
    expect(cache.invalidateByKid('k1')).toBe(1);
  });

  it('returns a new mutable copy on every hit', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', { verified: false, errors: ['x'], warnings: [] }, ['k'], 'routine');
    const first = cache.get('h')!;
    first.verified = true;
    first.errors.push('mutated');
    const second = cache.get('h')!;
    expect(second).not.toBe(first);
    expect(second).toEqual({ verified: false, errors: ['x'], warnings: [] });
  });

  it('caches and returns negative results as given', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', { verified: false, errors: ['x'], warnings: [] }, ['k'], 'routine');
    expect(cache.get('h')?.verified).toBe(false);
  });
});

describe('VerificationCache atomic set', () => {
  function primed() {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', { ...ok(), warnings: ['before'] }, ['k-before'], 'routine', { agentIds: ['agent-a'] });
    return cache;
  }
  function expectIntact(cache: VerificationCache) {
    expect(cache.get('h')?.warnings).toEqual(['before']);
    expect(cache.size).toBe(1);
    expect(cache.invalidateByAgent('agent-a')).toBe(1); // the agent index survived
  }

  it('a result that cannot be cloned leaves the previous entry and indexes', () => {
    const cache = primed();
    const bad = { ...ok(), details: { fn: () => 1 } } as unknown as VerifyV2Result;
    expect(() => cache.set('h', bad, ['k-new'], 'routine')).toThrow(/clone/i);
    expect(cache.invalidateByKid('k-new')).toBe(0);
    expectIntact(cache);
  });

  it.each([
    ['context', { context: 5 }],
    ['agentIds not an array', { agentIds: 'agent-b' }],
    ['empty agent id', { agentIds: [''] }],
    ['options not an object', 'ctx'],
  ])('an invalid %s leaves the previous entry', (_label, options) => {
    const cache = primed();
    expect(() =>
      cache.set('h', ok(), ['k-new'], 'routine', options as unknown as Parameters<VerificationCache['set']>[4]),
    ).toThrow(TypeError);
    expectIntact(cache);
  });

  it.each([
    ['a sparse agentIds', new Array(1)],
    ['an agentIds with a hole between ids', ['agent-b', , 'agent-c']], // eslint-disable-line no-sparse-arrays
  ])('%s is refused, not stored as an association, and leaves the previous entry', (_label, agentIds) => {
    const cache = primed();
    expect(() =>
      cache.set('h', ok(), ['k-new'], 'routine', { agentIds: agentIds as unknown as string[] }),
    ).toThrow(TypeError);
    expectIntact(cache);
  });

  it.each([
    ['signerKids not an array', 'k'],
    ['a signer kid that is not a string', [1]],
    ['a sparse signerKids', new Array(1)],
    ['a signerKids with a hole', ['k1', , 'k2']], // eslint-disable-line no-sparse-arrays
  ])('%s leaves the previous entry', (_label, kids) => {
    const cache = primed();
    expect(() => cache.set('h', ok(), kids as unknown as string[], 'routine')).toThrow(TypeError);
    expectIntact(cache);
  });

  it('a non-finite clock reading refuses the set and leaves the previous entry', () => {
    const cache = primed();
    vi.spyOn(Date, 'now').mockReturnValue(NaN);
    expect(() => cache.set('h', ok(), ['k-new'], 'routine')).toThrow(RangeError);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expectIntact(cache);
  });

  it('a deadline beyond MAX_SAFE_INTEGER is refused before commit', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ ttlByTier: { routine: Number.MAX_SAFE_INTEGER } });
    cache.set('h', ok(), ['k'], 'elevated');
    expect(() => cache.set('h', ok(), ['k'], 'routine')).toThrow(RangeError);
    expect(cache.has('h')).toBe(true);
  });

  it('copies and deduplicates agentIds before commit', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    const agents = ['agent-a', 'agent-a'];
    cache.set('h', ok(), ['k'], 'routine', { agentIds: agents });
    agents[0] = 'agent-z';
    expect(cache.invalidateByAgent('agent-z')).toBe(0);
    expect(cache.invalidateByAgent('agent-a')).toBe(1);
  });
});

describe('VerificationCache invalidateByAgent', () => {
  it('evicts the agent entries and every unassociated entry, keeps other agents', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('a1', ok(), ['k'], 'routine', { agentIds: ['agent-a'] });
    cache.set('a2', ok(), ['k'], 'routine', { agentIds: ['agent-a', 'agent-b'], context: 'C' });
    cache.set('b1', ok(), ['k'], 'routine', { agentIds: ['agent-b'] });
    cache.set('legacy', ok(), ['k'], 'routine');
    cache.set('empty', ok(), ['k'], 'routine', { agentIds: [] });
    expect(cache.invalidateByAgent('agent-a')).toBe(4);
    expect(cache.has('b1')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('removes legacy entries even when no entry names the agent', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h1', { ...ok(), details: { session_nonce: 'n1' } }, ['agent-kid'], 'routine');
    cache.set('h2', ok(), ['agent-kid'], 'routine');
    expect(cache.invalidateByAgent('agent-1')).toBe(2);
    expect(cache.size).toBe(0);
  });

  it('refuses an agentId that is not a non-empty string', () => {
    const cache = new VerificationCache();
    expect(() => cache.invalidateByAgent('')).toThrow(TypeError);
    expect(() => cache.invalidateByAgent(undefined as unknown as string)).toThrow(TypeError);
  });
});

describe('VerificationCache clocks', () => {
  it('misses at exactly createdAt + ttl', () => {
    const { advance } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ ttlByTier: { routine: 1000 } });
    cache.set('h', ok(), ['k'], 'routine');
    advance(999);
    expect(cache.has('h')).toBe(true);
    advance(1);
    expect(cache.has('h')).toBe(false);
  });

  it('never stores or hits with a TTL of 0, and removes the older entry at that key', () => {
    controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ ttlByTier: { routine: 0 } });
    cache.set('h', ok(), ['k'], 'elevated');
    cache.set('h', ok(), ['k'], 'routine');
    expect(cache.size).toBe(0);
    expect(cache.has('h')).toBe(false);
  });

  it('a wall-clock step back before creation is a miss', () => {
    const { clock } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ ttlByTier: { maximum: 10_000 } });
    cache.set('h', ok(), ['k'], 'maximum');
    clock.wall -= 3_600_000;
    expect(cache.has('h')).toBe(false);
    clock.wall += 3_600_000;
    expect(cache.has('h')).toBe(false); // evicted, not revived
  });

  it('a partial wall-clock step back does not extend the real lifetime', () => {
    const { clock, advance } = controlClocks(1000, 0);
    const cache = new VerificationCache({ ttlByTier: { routine: 1000 } });
    cache.set('h', ok(), ['k'], 'routine');
    advance(500);
    expect(cache.has('h')).toBe(true);
    clock.wall = 1400; // step back of 100 ms; monotonic time keeps running
    advance(499);
    expect(cache.has('h')).toBe(true);
    advance(1); // 1000 ms of monotonic time since set; the wall clock reads 1900
    expect(cache.has('h')).toBe(false);
  });

  it('a monotonic clock going back is a miss and does not revive the entry', () => {
    const { clock } = controlClocks(1_000_000, 5_000);
    const cache = new VerificationCache();
    cache.set('h', ok(), ['k'], 'routine');
    clock.monotonic = 4_000;
    expect(cache.has('h')).toBe(false);
    clock.monotonic = 5_001;
    expect(cache.has('h')).toBe(false);
  });

  it('the wall-clock limit still applies when the monotonic clock does not advance', () => {
    const { clock } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache({ ttlByTier: { routine: 1000 } });
    cache.set('h', ok(), ['k'], 'routine');
    clock.wall += 1000; // as across a suspend that the monotonic clock does not count
    expect(cache.has('h')).toBe(false);
  });

  it('a non-finite reading on lookup is a miss and evicts', () => {
    const { clock } = controlClocks(1_000_000, 0);
    const cache = new VerificationCache();
    cache.set('h', ok(), ['k'], 'routine');
    clock.monotonic = NaN;
    expect(cache.get('h')).toBeNull();
    clock.monotonic = 1;
    expect(cache.size).toBe(0);
  });

  it('works under vitest fake timers, which advance both clocks', () => {
    vi.useFakeTimers();
    const cache = new VerificationCache({ ttlByTier: { elevated: 30_000 } });
    cache.set('h', ok(), ['k'], 'elevated');
    vi.advanceTimersByTime(29_999);
    expect(cache.has('h')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(cache.has('h')).toBe(false);
  });

  it('under fake timers, setSystemTime back does not extend the lifetime', () => {
    vi.useFakeTimers();
    const cache = new VerificationCache({ ttlByTier: { routine: 1000 } });
    const t0 = Date.now();
    cache.set('h', ok(), ['k'], 'routine');
    vi.advanceTimersByTime(500);
    vi.setSystemTime(t0 + 400);
    vi.advanceTimersByTime(500);
    expect(cache.has('h')).toBe(false);
  });
});

describe('VerificationCache public types', () => {
  it('CacheEntry keeps exactly its six fields', () => {
    const entry: CacheEntry = {
      result: ok(),
      bundleHash: 'h',
      signerKids: ['k'],
      tier: 'routine',
      createdAt: 0,
      expiresAt: 1,
    };
    // @ts-expect-error CacheEntry has no internal fields
    const extra: CacheEntry = { ...entry, monotonicDeadline: 1 };
    expect(Object.keys(entry).sort()).toEqual(
      ['bundleHash', 'createdAt', 'expiresAt', 'result', 'signerKids', 'tier'],
    );
    expect(extra.bundleHash).toBe('h');
  });
});
