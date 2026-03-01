import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DcpErrorCode,
  DcpProtocolError,
  createDcpError,
  isDcpError,
} from '../core/error-codes.js';
import { RateLimiter, AdaptiveRateLimiter } from '../core/rate-limiter.js';
import { CircuitBreaker } from '../core/circuit-breaker.js';
import { withRetry } from '../core/retry.js';

// ─── Error Codes ────────────────────────────────────────────────────────────

describe('DCP Error Codes', () => {
  it('createDcpError produces a well-formed error for every code', () => {
    for (const code of Object.values(DcpErrorCode)) {
      const err = createDcpError(code);
      expect(err.code).toBe(code);
      expect(err.message).toBeTruthy();
      expect(typeof err.retryable).toBe('boolean');
      expect(err.timestamp).toBeTruthy();
      expect(new Date(err.timestamp).getTime()).not.toBeNaN();
    }
  });

  it('createDcpError attaches details', () => {
    const details = { expected: 'sha256', got: 'sha512' };
    const err = createDcpError(DcpErrorCode.DUAL_HASH_MISMATCH, details);
    expect(err.details).toEqual(details);
  });

  it('DcpProtocolError is an Error with code and retryable getters', () => {
    const err = new DcpProtocolError(DcpErrorCode.RATE_LIMIT_EXCEEDED);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DcpProtocolError');
    expect(err.code).toBe(DcpErrorCode.RATE_LIMIT_EXCEEDED);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('DCP-E700');
  });

  it('non-retryable errors are marked correctly', () => {
    const err = new DcpProtocolError(DcpErrorCode.BUNDLE_SCHEMA_INVALID);
    expect(err.retryable).toBe(false);
  });

  it('isDcpError returns true only for DcpProtocolError', () => {
    expect(isDcpError(new DcpProtocolError(DcpErrorCode.INTERNAL_ERROR))).toBe(true);
    expect(isDcpError(new Error('plain'))).toBe(false);
    expect(isDcpError(null)).toBe(false);
    expect(isDcpError('string')).toBe(false);
  });
});

// ─── Rate Limiter ───────────────────────────────────────────────────────────

describe('RateLimiter', () => {
  it('allows requests within the limit', () => {
    const rl = new RateLimiter({ windowMs: 60000, maxRequests: 3 });
    const ctx = { agent_id: 'agent-1' };

    const r1 = rl.check(ctx);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = rl.check(ctx);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = rl.check(ctx);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('blocks requests exceeding the limit', () => {
    const rl = new RateLimiter({ windowMs: 60000, maxRequests: 2 });
    const ctx = { agent_id: 'agent-1' };

    rl.check(ctx);
    rl.check(ctx);
    const r3 = rl.check(ctx);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it('resets window after windowMs expires', () => {
    vi.useFakeTimers();
    try {
      const rl = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
      const ctx = { agent_id: 'agent-1' };

      rl.check(ctx);
      const blocked = rl.check(ctx);
      expect(blocked.allowed).toBe(false);

      vi.advanceTimersByTime(1000);

      const fresh = rl.check(ctx);
      expect(fresh.allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks different keys independently', () => {
    const rl = new RateLimiter({ windowMs: 60000, maxRequests: 1 });

    const r1 = rl.check({ agent_id: 'a' });
    const r2 = rl.check({ agent_id: 'b' });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    const r3 = rl.check({ agent_id: 'a' });
    expect(r3.allowed).toBe(false);
  });

  it('cleanup removes expired entries', () => {
    vi.useFakeTimers();
    try {
      const rl = new RateLimiter({ windowMs: 1000, maxRequests: 5 });
      rl.check({ agent_id: 'a' });

      vi.advanceTimersByTime(1500);
      rl.cleanup();

      const r = rl.check({ agent_id: 'a' });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset clears a specific key', () => {
    const rl = new RateLimiter({ windowMs: 60000, maxRequests: 1 });
    rl.check({ agent_id: 'a' });
    rl.check({ agent_id: 'a' });

    rl.reset('a');
    const r = rl.check({ agent_id: 'a' });
    expect(r.allowed).toBe(true);
  });
});

describe('AdaptiveRateLimiter', () => {
  it('applies different limits per tier', () => {
    const arl = new AdaptiveRateLimiter({
      routine: { windowMs: 60000, maxRequests: 5 },
      maximum: { windowMs: 60000, maxRequests: 1 },
    });
    const ctx = { agent_id: 'agent-1' };

    for (let i = 0; i < 5; i++) {
      expect(arl.check(ctx, 'routine').allowed).toBe(true);
    }
    expect(arl.check(ctx, 'routine').allowed).toBe(false);

    expect(arl.check(ctx, 'maximum').allowed).toBe(true);
    expect(arl.check(ctx, 'maximum').allowed).toBe(false);
  });

  it('falls back to standard tier for unknown tiers', () => {
    const arl = new AdaptiveRateLimiter();
    const ctx = { agent_id: 'agent-1' };

    const r = arl.check(ctx, 'unknown_tier');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(499);
  });
});

// ─── Circuit Breaker ────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.currentState).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('transitions closed → open after threshold failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });

    cb.onFailure();
    cb.onFailure();
    expect(cb.currentState).toBe('closed');

    cb.onFailure();
    expect(cb.currentState).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions open → half-open after resetTimeoutMs', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });

    cb.onFailure();
    expect(cb.currentState).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.currentState).toBe('half-open');
    expect(cb.canExecute()).toBe(true);
  });

  it('transitions half-open → closed on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });

    cb.onFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.currentState).toBe('half-open');

    cb.onSuccess();
    expect(cb.currentState).toBe('closed');
  });

  it('transitions half-open → open on failure', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });

    cb.onFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.currentState).toBe('half-open');

    cb.onFailure();
    expect(cb.currentState).toBe('open');
  });

  it('execute resolves on success and records it', async () => {
    const cb = new CircuitBreaker();
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.getStats().successes).toBe(1);
  });

  it('execute rejects on failure and records it', async () => {
    const cb = new CircuitBreaker();
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(cb.getStats().failures).toBe(1);
  });

  it('execute throws when circuit is open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.onFailure();
    await expect(cb.execute(async () => 1)).rejects.toThrow('Circuit breaker is open');
  });

  it('limits half-open attempts', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 2,
    });

    cb.onFailure();
    vi.advanceTimersByTime(1000);

    expect(cb.canExecute()).toBe(true);
    cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    expect(cb.canExecute()).toBe(true);
  });

  it('reset restores closed state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.onFailure();
    expect(cb.currentState).toBe('open');

    cb.reset();
    expect(cb.currentState).toBe('closed');
    expect(cb.getStats().failures).toBe(0);
    expect(cb.getStats().successes).toBe(0);
  });

  it('getStats returns current snapshot', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    cb.onSuccess();
    cb.onSuccess();
    cb.onFailure();

    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.successes).toBe(2);
    expect(stats.failures).toBe(1);
  });
});

// ─── Retry ──────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on first success', async () => {
    const result = await withRetry(async () => 'ok', { maxRetries: 3 });
    expect(result).toBe('ok');
  });

  it('retries on failure and eventually succeeds', async () => {
    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt < 3) throw new Error('fail');
      return 'recovered';
    };

    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
    });

    // Drain first retry delay
    await vi.advanceTimersByTimeAsync(200);
    // Drain second retry delay
    await vi.advanceTimersByTimeAsync(400);

    const result = await promise;
    expect(result).toBe('recovered');
    expect(attempt).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    vi.useRealTimers();
    let attempt = 0;
    const fn = async () => {
      attempt++;
      throw new Error('persistent');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 5,
        backoffMultiplier: 1,
      }),
    ).rejects.toThrow('persistent');
    expect(attempt).toBe(3);
    vi.useFakeTimers();
  });

  it('respects retryableCheck — non-retryable errors are thrown immediately', async () => {
    let attempt = 0;
    const fn = async () => {
      attempt++;
      throw new Error('fatal');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 5,
        baseDelayMs: 100,
        retryableCheck: () => false,
      }),
    ).rejects.toThrow('fatal');

    expect(attempt).toBe(1);
  });

  it('retries when retryableCheck returns true', async () => {
    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt < 2) throw new Error('transient');
      return 'ok';
    };

    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 50,
      maxDelayMs: 500,
      backoffMultiplier: 2,
      retryableCheck: (err) => err instanceof Error && err.message === 'transient',
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe('ok');
    expect(attempt).toBe(2);
  });

  it('applies exponential backoff with jitter', async () => {
    vi.useRealTimers();

    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms && ms > 0) delays.push(ms);
      return originalSetTimeout(fn, 0);
    }) as typeof globalThis.setTimeout);

    let attempt = 0;
    await withRetry(
      async () => {
        attempt++;
        if (attempt <= 3) throw new Error('fail');
        return 'ok';
      },
      { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 10000, backoffMultiplier: 2 },
    );

    expect(delays.length).toBe(3);
    // Each delay ≈ baseDelayMs * 2^attempt + jitter, so monotonically increasing
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }

    vi.restoreAllMocks();
  });
});
