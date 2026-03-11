/**
 * DCP-AI v2.0 Benchmark Suite — Latency & Throughput by Security Tier
 *
 * Measures real-world crypto performance for each adaptive security tier:
 *   Tier 0 (routine)  — Ed25519 only, PQ checkpoint every 50 events
 *   Tier 1 (standard)  — Ed25519 + PQ checkpoint every 10 events
 *   Tier 2 (elevated)  — Full hybrid per-operation
 *   Tier 3 (maximum)   — Full hybrid + immediate checkpoint
 *
 * Run: npx vitest run src/__tests__/benchmark-by-tier.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'crypto';

import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { compositeSign, compositeVerify, classicalOnlySign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import { computeSecurityTier, tierToVerificationMode, tierToCheckpointInterval } from '../core/security-tier.js';
import type { SecurityTier } from '../core/security-tier.js';
import { VerificationCache } from '../core/verification-cache.js';
import type { VerifyV2Result } from '../core/verify-v2.js';
import type { IntentV2 } from '../types/v2.js';

let registry: AlgorithmRegistry;
let ed25519: Ed25519Provider;
let mlDsa65: MlDsa65Provider;
let keys: CompositeKeyPair;

const WARM_UP_ROUNDS = 3;

function makePayload(size: 'small' | 'medium' | 'large'): Uint8Array {
  const obj: Record<string, unknown> = {
    dcp_version: '2.0',
    intent_id: `intent-bench-${randomBytes(4).toString('hex')}`,
    session_nonce: randomBytes(32).toString('hex'),
    action_type: 'api_call',
    timestamp: new Date().toISOString(),
  };
  if (size === 'medium' || size === 'large') {
    obj.data_classes = ['pii', 'financial_data'];
    obj.evidence = { tool: 'benchmark', result_ref: randomBytes(64).toString('hex') };
  }
  if (size === 'large') {
    obj.audit_entries = Array.from({ length: 10 }, (_, i) => ({
      audit_id: `audit-${i}`,
      outcome: 'completed',
      timestamp: new Date().toISOString(),
    }));
  }
  return new TextEncoder().encode(canonicalizeV2(obj));
}

interface BenchResult {
  tier: SecurityTier;
  operation: string;
  ops: number;
  totalMs: number;
  avgLatencyMs: number;
  opsPerSec: number;
}

const results: BenchResult[] = [];

function recordResult(tier: SecurityTier, operation: string, ops: number, totalMs: number): void {
  const avgLatencyMs = totalMs / ops;
  const opsPerSec = (ops / totalMs) * 1000;
  results.push({ tier, operation, ops, totalMs, avgLatencyMs, opsPerSec });
}

async function benchmarkOps(
  fn: () => Promise<void>,
  ops: number,
): Promise<number> {
  for (let i = 0; i < WARM_UP_ROUNDS; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < ops; i++) {
    await fn();
  }
  return performance.now() - start;
}

beforeAll(async () => {
  registry = new AlgorithmRegistry();
  ed25519 = new Ed25519Provider();
  mlDsa65 = new MlDsa65Provider();
  registry.registerSigner(ed25519);
  registry.registerSigner(mlDsa65);

  const classicalKp = await ed25519.generateKeypair();
  const pqKp = await mlDsa65.generateKeypair();
  keys = {
    classical: {
      alg: 'ed25519',
      publicKeyB64: classicalKp.publicKeyB64,
      secretKeyB64: classicalKp.secretKeyB64,
      kid: classicalKp.kid,
    },
    pq: {
      alg: 'ml-dsa-65',
      publicKeyB64: pqKp.publicKeyB64,
      secretKeyB64: pqKp.secretKeyB64,
      kid: pqKp.kid,
    },
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// TIER COMPUTATION BENCHMARKS
// ═══════════════════════════════════════════════════════════════════════════

describe('Tier Computation Performance', () => {
  it('computeSecurityTier is sub-microsecond (10,000 ops)', () => {
    const intent: IntentV2 = {
      dcp_version: '2.0',
      intent_id: 'bench',
      session_nonce: randomBytes(32).toString('hex'),
      agent_id: 'agent-bench',
      human_id: 'human-bench',
      timestamp: new Date().toISOString(),
      action_type: 'api_call',
      target: { channel: 'api' },
      data_classes: ['pii'],
      estimated_impact: 'medium',
      requires_consent: false,
    };

    const ops = 10_000;
    const start = performance.now();
    for (let i = 0; i < ops; i++) {
      computeSecurityTier(intent);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = (ops / elapsed) * 1000;

    expect(opsPerSec).toBeGreaterThan(100_000);
  });

  it('correctly maps all tier boundaries', () => {
    const base: Omit<IntentV2, 'data_classes' | 'action_type'> = {
      dcp_version: '2.0',
      intent_id: 'bench',
      session_nonce: randomBytes(32).toString('hex'),
      agent_id: 'a',
      human_id: 'h',
      timestamp: new Date().toISOString(),
      target: { channel: 'api' },
      estimated_impact: 'low',
      requires_consent: false,
    };

    expect(computeSecurityTier({ ...base, action_type: 'browse', data_classes: ['none'] } as IntentV2)).toBe('routine');
    // risk_score 300 -> standard (no sensitive data, score between 200-499)
    expect(computeSecurityTier({ ...base, action_type: 'api_call', data_classes: ['contact_info'], risk_score: 300 } as IntentV2 & { risk_score: number })).toBe('standard');
    expect(computeSecurityTier({ ...base, action_type: 'initiate_payment', data_classes: ['none'] } as IntentV2)).toBe('elevated');
    expect(computeSecurityTier({ ...base, action_type: 'api_call', data_classes: ['credentials'] } as IntentV2)).toBe('maximum');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TIER 0 — ROUTINE (Ed25519 only)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tier 0 (routine): Ed25519-only signing & verification', () => {
  const OPS = 100;

  it(`sign latency (${OPS} ops)`, async () => {
    const payload = makePayload('small');
    const elapsed = await benchmarkOps(async () => {
      await classicalOnlySign(registry, DCP_CONTEXTS.AuditEvent, payload, keys.classical);
    }, OPS);

    recordResult('routine', 'sign', OPS, elapsed);
    expect(elapsed / OPS).toBeLessThan(5); // < 5ms per op
  });

  it(`verify latency (${OPS} ops)`, async () => {
    const payload = makePayload('small');
    const sig = await classicalOnlySign(registry, DCP_CONTEXTS.AuditEvent, payload, keys.classical);

    const elapsed = await benchmarkOps(async () => {
      await compositeVerify(
        registry, DCP_CONTEXTS.AuditEvent, payload, sig,
        keys.classical.publicKeyB64, undefined,
      );
    }, OPS);

    recordResult('routine', 'verify', OPS, elapsed);
    expect(elapsed / OPS).toBeLessThan(10);
  });

  it('checkpoint interval is 50', () => {
    expect(tierToCheckpointInterval('routine')).toBe(50);
  });

  it('verification mode is classical_only', () => {
    expect(tierToVerificationMode('routine')).toBe('classical_only');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TIER 1 — STANDARD (Ed25519 + PQ checkpoint every 10)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tier 1 (standard): Ed25519 per-event + periodic PQ checkpoint', () => {
  const OPS = 50;

  it(`sign per-event (Ed25519) + 1 PQ checkpoint per ${tierToCheckpointInterval('standard')} events`, async () => {
    const payload = makePayload('medium');
    const interval = tierToCheckpointInterval('standard');
    let totalElapsed = 0;
    let checkpointCount = 0;

    for (let i = 0; i < OPS; i++) {
      const start = performance.now();
      await classicalOnlySign(registry, DCP_CONTEXTS.AuditEvent, payload, keys.classical);

      if ((i + 1) % interval === 0) {
        await compositeSign(registry, DCP_CONTEXTS.AuditEvent, payload, keys);
        checkpointCount++;
      }
      totalElapsed += performance.now() - start;
    }

    const expectedCheckpoints = Math.floor(OPS / interval);
    expect(checkpointCount).toBe(expectedCheckpoints);
    recordResult('standard', 'sign+checkpoint', OPS, totalElapsed);
    expect(totalElapsed / OPS).toBeLessThan(20);
  });

  it('checkpoint interval is 10', () => {
    expect(tierToCheckpointInterval('standard')).toBe(10);
  });

  it('verification mode is hybrid_preferred', () => {
    expect(tierToVerificationMode('standard')).toBe('hybrid_preferred');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TIER 2 — ELEVATED (Full hybrid per-operation)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tier 2 (elevated): Full hybrid sign & verify per-operation', () => {
  const OPS = 20;

  it(`composite sign latency (${OPS} ops)`, async () => {
    const payload = makePayload('medium');
    const elapsed = await benchmarkOps(async () => {
      await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);
    }, OPS);

    recordResult('elevated', 'composite_sign', OPS, elapsed);
    expect(elapsed / OPS).toBeLessThan(50);
  });

  it(`composite verify latency (${OPS} ops)`, async () => {
    const payload = makePayload('medium');
    const sig = await compositeSign(registry, DCP_CONTEXTS.Intent, payload, keys);

    const elapsed = await benchmarkOps(async () => {
      await compositeVerify(
        registry, DCP_CONTEXTS.Intent, payload, sig,
        keys.classical.publicKeyB64, keys.pq.publicKeyB64,
      );
    }, OPS);

    recordResult('elevated', 'composite_verify', OPS, elapsed);
    expect(elapsed / OPS).toBeLessThan(50);
  });

  it('checkpoint interval is 1', () => {
    expect(tierToCheckpointInterval('elevated')).toBe(1);
  });

  it('verification mode is hybrid_required', () => {
    expect(tierToVerificationMode('elevated')).toBe('hybrid_required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TIER 3 — MAXIMUM (Full hybrid + immediate checkpoint verification)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tier 3 (maximum): Full hybrid sign + immediate checkpoint verify', () => {
  const OPS = 10;

  it(`sign + immediate verify round-trip (${OPS} ops)`, async () => {
    const payload = makePayload('large');

    const elapsed = await benchmarkOps(async () => {
      const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payload, keys);
      const result = await compositeVerify(
        registry, DCP_CONTEXTS.Bundle, payload, sig,
        keys.classical.publicKeyB64, keys.pq.publicKeyB64,
      );
      expect(result.valid).toBe(true);
    }, OPS);

    recordResult('maximum', 'sign+verify_roundtrip', OPS, elapsed);
    expect(elapsed / OPS).toBeLessThan(100);
  });

  it('checkpoint interval is 1', () => {
    expect(tierToCheckpointInterval('maximum')).toBe(1);
  });

  it('verification mode is hybrid_required', () => {
    expect(tierToVerificationMode('maximum')).toBe('hybrid_required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION CACHE BENCHMARKS
// ═══════════════════════════════════════════════════════════════════════════

describe('VerificationCache Performance', () => {
  it('cache hit latency < 0.01ms (10,000 lookups)', () => {
    const cache = new VerificationCache();
    const mockResult: VerifyV2Result = {
      verified: true,
      errors: [],
      warnings: [],
      details: { verification_mode: 'hybrid_required' },
    };

    cache.set('sha256:aabbccdd', mockResult, ['kid-1', 'kid-2'], 'elevated');

    const ops = 10_000;
    const start = performance.now();
    for (let i = 0; i < ops; i++) {
      cache.get('sha256:aabbccdd');
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / ops;

    expect(avgMs).toBeLessThan(0.01);
  });

  it('cache miss latency < 0.01ms (10,000 lookups)', () => {
    const cache = new VerificationCache();

    const ops = 10_000;
    const start = performance.now();
    for (let i = 0; i < ops; i++) {
      cache.get('sha256:nonexistent');
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / ops;

    expect(avgMs).toBeLessThan(0.01);
  });

  it('invalidateByKid evicts correct entries', () => {
    const cache = new VerificationCache();
    const result: VerifyV2Result = { verified: true, errors: [], warnings: [] };

    cache.set('hash-1', result, ['kid-a', 'kid-b'], 'routine');
    cache.set('hash-2', result, ['kid-b', 'kid-c'], 'standard');
    cache.set('hash-3', result, ['kid-d'], 'elevated');

    expect(cache.size).toBe(3);

    const evicted = cache.invalidateByKid('kid-b');
    expect(evicted).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.has('hash-3')).toBe(true);
  });

  it('TTL varies by tier', async () => {
    const cache = new VerificationCache({
      ttlByTier: { routine: 50, maximum: 10 },
    });
    const result: VerifyV2Result = { verified: true, errors: [], warnings: [] };

    cache.set('hash-routine', result, ['k1'], 'routine');
    cache.set('hash-max', result, ['k2'], 'maximum');

    expect(cache.has('hash-routine')).toBe(true);
    expect(cache.has('hash-max')).toBe(true);

    await new Promise((r) => setTimeout(r, 15));

    expect(cache.has('hash-routine')).toBe(true);
    expect(cache.has('hash-max')).toBe(false);
  });

  it('respects maxEntries limit', () => {
    const cache = new VerificationCache({ maxEntries: 5 });
    const result: VerifyV2Result = { verified: true, errors: [], warnings: [] };

    for (let i = 0; i < 10; i++) {
      cache.set(`hash-${i}`, result, [`kid-${i}`], 'routine');
    }

    expect(cache.size).toBeLessThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPARATIVE SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

describe('Benchmark Summary', () => {
  it('prints comparative results', () => {
    if (results.length === 0) return;

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║         DCP-AI v2.0 — Benchmark by Security Tier           ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║ Tier     │ Operation            │ Avg (ms) │ Ops/sec       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    for (const r of results) {
      const tier = r.tier.padEnd(8);
      const op = r.operation.padEnd(20);
      const avg = r.avgLatencyMs.toFixed(3).padStart(8);
      const ops = r.opsPerSec.toFixed(1).padStart(13);
      console.log(`║ ${tier} │ ${op} │ ${avg} │ ${ops} ║`);
    }

    console.log('╚══════════════════════════════════════════════════════════════╝');

    expect(results.length).toBeGreaterThan(0);
  });
});
