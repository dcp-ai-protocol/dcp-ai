// Operator sources as the application reads them (TEST ONLY): the tenant's policy and trust set, and revocation
// snapshots built from the operator's lists. A list that cannot be read or parsed gives no snapshot (null), which the
// SDK reports as REVOCATION_UNAVAILABLE: a failure never becomes "not revoked".
import fs from 'node:fs';
import path from 'node:path';
import { parseRfc3339, revocationSnapshotFromDenyList } from '@dcp-ai/sdk';
import { isObject, readJson } from './common.mjs';

const TENANT = /^[A-Za-z0-9_-]{1,32}$/;

/** The tenant's policy and trust set (null when the tenant has none), from the operator state only. */
export function tenantConfig(state, tenant) {
  if (typeof tenant !== 'string' || !TENANT.test(tenant)) throw new Error('invalid tenant');
  const dir = path.join(state, 'operator', 'tenants', tenant);
  const trust = path.join(dir, 'trust.json');
  return { policy: readJson(path.join(dir, 'policy.json')), trust: fs.existsSync(trust) ? readJson(trust) : null };
}

export function readList(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

/**
 * A superset of the revocation subjects of a composition: every agent_id and every kid anywhere in the evidence.
 * The SDK has no helper for a composition; subjects it does not check are harmless, a missing one would be UNKNOWN.
 */
export function compositionSubjects(...values) {
  const agentIds = new Set();
  const kids = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'agent_id' && typeof x === 'string') agentIds.add(x);
        if (k === 'kid' && typeof x === 'string') kids.add(x);
        walk(x);
      }
    }
  };
  values.forEach(walk);
  return { agent_ids: [...agentIds].sort(), kids: [...kids].sort() };
}

export function agentKeySnapshot(denyList, subjects) {
  if (denyList === null) return null;
  try {
    return revocationSnapshotFromDenyList(denyList, subjects);
  } catch {
    return null;
  }
}

/** {checked_at, mandates} for every mandate id of the chain, from {updated_at, revoked_mandates: [{mandate_id}]}. */
export function mandateSnapshot(list, chain) {
  const valid =
    isObject(list) &&
    typeof list.updated_at === 'string' &&
    parseRfc3339(list.updated_at) !== undefined &&
    Array.isArray(list.revoked_mandates) &&
    list.revoked_mandates.every((r) => isObject(r) && typeof r.mandate_id === 'string');
  if (!valid) return null;
  const revoked = new Set(list.revoked_mandates.map((r) => r.mandate_id));
  const mandates = {};
  for (const m of Array.isArray(chain) ? chain : []) {
    if (isObject(m) && typeof m.mandate_id === 'string') mandates[m.mandate_id] = revoked.has(m.mandate_id) ? 'revoked' : 'not_revoked';
  }
  return { checked_at: list.updated_at, mandates };
}
