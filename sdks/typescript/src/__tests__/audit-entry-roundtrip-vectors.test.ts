/**
 * Contrast with the shared vectors tests/interop/v2/audit_entry_roundtrip_vectors.json (RawAuditEventV2 lives in the
 * Rust and Go SDKs; TypeScript keeps JSON values as they are). canonicalizeV2 must reproduce each hand-written
 * dcp-jcs-v1 text, and string_evidence_bundle must verify while each of its mutations is rejected.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AlgorithmRegistry,
  canonicalizeV2,
  Ed25519Provider,
  MlDsa65Provider,
  verifySignedBundleV2,
} from '../index.js';

const ROOT = new URL('../../../../', import.meta.url);
const V = JSON.parse(readFileSync(new URL('tests/interop/v2/audit_entry_roundtrip_vectors.json', ROOT), 'utf8'));

describe('audit_entry_roundtrip_vectors', () => {
  it('canonicalizeV2 reproduces every hand-written dcp-jcs-v1 text and its SHA-256', () => {
    expect(V.entries).toHaveLength(14);
    for (const c of V.entries) {
      const value = c.entry ?? JSON.parse(c.entry_json);
      expect(canonicalizeV2(value), c.name).toBe(c.canonical);
      expect(createHash('sha256').update(c.canonical, 'utf8').digest('hex'), c.name).toBe(c.canonical_sha256);
    }
  });

  it('string_evidence_bundle verifies and each mutation is rejected', async () => {
    const registry = new AlgorithmRegistry();
    registry.registerSigner(new Ed25519Provider());
    registry.registerSigner(new MlDsa65Provider());
    const s = V.string_evidence_bundle;
    const now = Date.parse(s.verification_time);
    const base = await verifySignedBundleV2(s.signed_bundle, registry, s.verifier_policy, { now });
    expect(base.errors).toEqual([]);
    expect(base.verified).toBe(true);
    expect(s.mutations).toHaveLength(8);
    for (const m of s.mutations) {
      const mutated = structuredClone(s.signed_bundle);
      let node = mutated.bundle.audit_entries[m.entry_index];
      for (const key of m.path.slice(0, -1)) node = node[key];
      const last = m.path.at(-1);
      if (m.op === 'set') node[last] = m.value;
      else {
        expect(last in node, m.name).toBe(true);
        delete node[last];
      }
      const r = await verifySignedBundleV2(mutated, registry, s.verifier_policy, { now });
      expect(r.verified, m.name).toBe(false);
      expect(r.errors.length, m.name).toBeGreaterThan(0);
    }
  });
});
