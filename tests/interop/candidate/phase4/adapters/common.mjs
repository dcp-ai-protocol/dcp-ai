// Shared by the TypeScript and WASM adapters of the phase 4 matrix: reading the run's inputs, writing
// outputs and result lines in the format every adapter uses.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

export const SDKS = ['ts', 'py', 'go', 'rust', 'wasm'];
export const PARTS = [
  ['rpr', 'DCP-AI.v2.ResponsiblePrincipal', 'principal'],
  ['passport', 'DCP-AI.v2.AgentPassport', 'agent'],
  ['intent', 'DCP-AI.v2.Intent', 'agent'],
  ['policy', 'DCP-AI.v2.PolicyDecision', 'agent'],
];

export function context(mode, run) {
  const specs = JSON.parse(readFileSync(process.env.DCP_PHASE4_SPECS, 'utf8'));
  const runId = process.env.DCP_PHASE4_RUN_ID;
  if (!runId) throw new Error('DCP_PHASE4_RUN_ID is required');
  return { specs, runId, run, mode, now: Date.parse(specs.session.now) };
}

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const piece = (run, caseId, name) => new Uint8Array(readFileSync(join(run, 'inputs', caseId, `${name}.json`)));
export const meta = (run, caseId) => JSON.parse(readFileSync(join(run, 'inputs', caseId, 'meta.json'), 'utf8'));
export const keys = (run) => JSON.parse(readFileSync(join(run, 'inputs', 'keys.json'), 'utf8'));

/** S09: members an artifact and its composite_sig do not sign, added to the intent artifact. */
export function withExtensions(part) {
  if ('value' in part) {
    const a = part.value;
    return { value: { ...a, x_artifact_ext: 'unsigned', composite_sig: { ...a.composite_sig, x_sig_ext: 'unsigned' } } };
  }
  const text = new TextDecoder().decode(part.bytes);
  if (!text.startsWith('{"composite_sig":{')) throw new Error('an artifact that is not canonical');
  return { bytes: new TextEncoder().encode(`{"x_artifact_ext":"unsigned","composite_sig":{"x_sig_ext":"unsigned",${text.slice('{"composite_sig":{'.length)}`) };
}

export function writeProduced(ctx, sdk, name, bytes, index) {
  const dir = join(ctx.run, 'produced', sdk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.bin`), bytes);
  index.push({ case: name, sha256: sha256(bytes), run_id: ctx.runId, created_at: new Date().toISOString() });
}

export function writeIndex(ctx, sdk, file, index) {
  writeFileSync(join(ctx.run, 'produced', sdk, file), JSON.stringify(index, null, 2));
}

export function writeKids(ctx, sdk, derive) {
  const k = keys(ctx.run);
  const lines = [];
  for (const who of ['principal', 'agent']) for (const c of ['classical', 'pq']) lines.push(`${who}.${c} ${derive(k[who][c].alg, k[who][c].pk)}`);
  mkdirSync(join(ctx.run, 'kids'), { recursive: true });
  writeFileSync(join(ctx.run, 'kids', `${sdk}.json`), `${lines.join('\n')}\n`);
}

const text = (b) => new TextDecoder().decode(b);
const input = (run, caseId, m, name) => (m === 'bytes' ? { bytes: piece(run, caseId, name) } : { value: JSON.parse(text(piece(run, caseId, name))) });

/**
 * A bundle of one case, from its signed artifacts. `api` is the SDK under test: signPayload(context,
 * input, keys), signBundle(parts, signer, options), keys(pair, classicalOnly), deriveKid(alg, pkB64).
 */
async function assemble(ctx, api, caseId, m, artifacts) {
  const md = meta(ctx.run, caseId);
  const k = keys(ctx.run);
  return api.signBundle({
    rpr: artifacts.rpr, passport: artifacts.passport, intent: md.extensions ? withExtensions(artifacts.intent) : artifacts.intent, policyDecision: artifacts.policy,
    auditEntries: md.entries.map((e) => input(ctx.run, caseId, m, e)),
    ...(md.checkpoint ? { pqCheckpoints: [input(ctx.run, caseId, m, 'checkpoint-0')] } : {}),
  }, { signerType: 'human', signerId: 'human:candidate-principal', keys: api.keys(k.principal, md.classical) }, {
    sessionNonce: md.session_nonce, sessionIssuedAt: md.session_issued_at, sessionExpiresAt: md.session_expires_at, createdAt: md.created_at, dualHash: md.dual_hash,
  });
}

/** Every case in each of its modes; S01-bytes also leaves its four artifacts for the ring. */
export async function produceAll(ctx, sdk, api) {
  writeKids(ctx, sdk, api.deriveKid);
  const k = keys(ctx.run);
  const index = [];
  for (const c of ctx.specs.cases) {
    const md = meta(ctx.run, c.id);
    for (const m of c.modes) {
      const artifacts = {};
      for (const [name, ctxName, who] of PARTS) {
        const r = await api.signPayload(ctxName, input(ctx.run, c.id, m, name), api.keys(k[who], md.classical));
        artifacts[name] = m === 'bytes' ? { bytes: r.bytes } : { value: r.signedPayload };
        if (c.id === 'S01' && m === 'bytes') {
          mkdirSync(join(ctx.run, 'produced', sdk, 'artifacts'), { recursive: true });
          writeFileSync(join(ctx.run, 'produced', sdk, 'artifacts', `${name}.bin`), r.bytes);
        }
      }
      writeProduced(ctx, sdk, `${c.id}-${m}`, (await assemble(ctx, api, c.id, m, artifacts)).bytes, index);
    }
  }
  writeIndex(ctx, sdk, 'index.json', index);
}

/** The ring: S01 assembled from the artifacts the next producer signed. */
export async function ringOf(ctx, sdk, api) {
  const next = SDKS[(SDKS.indexOf(sdk) + 1) % SDKS.length];
  const artifacts = Object.fromEntries(PARTS.map(([name]) => [name, { bytes: new Uint8Array(readFileSync(join(ctx.run, 'produced', next, 'artifacts', `${name}.bin`))) }]));
  const index = [];
  writeProduced(ctx, sdk, 'R', (await assemble(ctx, api, 'S01', 'bytes', artifacts)).bytes, index);
  writeIndex(ctx, sdk, 'ring.json', index);
}

/** Every item a consumer verifies: each producer's units, then its negatives with their configuration. */
export function itemsToVerify(ctx) {
  const items = [];
  for (const producer of SDKS) {
    const dir = join(ctx.run, 'produced', producer);
    for (const file of ['index.json', 'ring.json']) {
      if (!existsSync(join(dir, file))) continue;
      for (const e of JSON.parse(readFileSync(join(dir, file), 'utf8'))) {
        items.push({ producer, case: e.case, bytes: new Uint8Array(readFileSync(join(dir, `${e.case}.bin`))), config: { transport: 'bare', accepted: ['dcp-jcs-v2'] } });
      }
    }
    const neg = join(ctx.run, 'negatives', producer, 'index.json');
    if (!existsSync(neg)) continue;
    for (const e of JSON.parse(readFileSync(neg, 'utf8'))) {
      items.push({ producer, case: e.case, bytes: new Uint8Array(readFileSync(join(ctx.run, 'negatives', producer, `${e.case}.bin`))), config: e.config });
    }
  }
  return items;
}

/**
 * A historical adapter that counts its calls; `calls` is read and reset by the adapter around each
 * verification, so the number reported is the one observed, never inferred from the case.
 */
export function counting(adapter) {
  const c = { calls: 0 };
  c.adapter = { ...adapter, decode: (u) => (c.calls++, adapter.decode(u)) };
  return c;
}

export function writeResult(ctx, consumer, item, r, decoderCalls) {
  const dir = join(ctx.run, 'results');
  mkdirSync(dir, { recursive: true });
  const line = {
    run_id: ctx.runId, consumer, producer: item.producer, case: item.case, created_at: new Date().toISOString(),
    outcome: r.route.outcome, class: r.route.class ?? null, entered: r.entered,
    verified: r.verification ? r.verification.verified : null, decoder_calls: decoderCalls, errors: (r.verification?.errors ?? []).slice(0, 3),
  };
  appendFileSync(join(dir, `${consumer}.jsonl`), `${JSON.stringify(line)}\n`);
}

// ── Cost (gate 10): equivalent pairs, N = 20 after 3 warm-ups, median and p90 ──

export const COST = { n: 20, warmup: 3 };

/** The S01 values both producers sign: the same keys, payloads and session. */
export function costInputs(run) {
  const md = meta(run, 'S01');
  const val = (name) => JSON.parse(text(piece(run, 'S01', name)));
  return { md, k: keys(run), payloads: Object.fromEntries(PARTS.map(([n]) => [n, val(n)])), entries: md.entries.map(val) };
}

/**
 * What makes the two outputs a pair: the same four payload hashes, the same session (nonce, start,
 * expiry) in the manifest and the same audit entries, compared as values. The rest may differ (below).
 */
export function costChecks(v1, candidate) {
  const parts = (u) => [u.bundle.responsible_principal_record, u.bundle.agent_passport, u.bundle.intent, u.bundle.policy_decision].map((x) => x.payload_hash);
  const session = (u) => ['session_nonce', 'session_issued_at', 'session_expires_at'].map((k) => u.bundle.manifest[k]);
  const stable = (x) => (Array.isArray(x) ? `[${x.map(stable).join(',')}]` : x !== null && typeof x === 'object'
    ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}` : JSON.stringify(x));
  return {
    same_payload_hashes: stable(parts(v1)) === stable(parts(candidate)) && parts(v1).every((h) => typeof h === 'string'),
    same_session: stable(session(v1)) === stable(session(candidate)) && session(v1).every((x) => typeof x === 'string'),
    same_entries: stable(v1.bundle.audit_entries) === stable(candidate.bundle.audit_entries),
  };
}

/** What differs inside a pair, read from the outputs: these are not canonicalization alone. */
export function costDifferences(v1, candidate, v1Serialization) {
  const secondary = (u) => typeof u.bundle.manifest.audit_merkle_root_secondary === 'string';
  return {
    secondary_root: { v1: secondary(v1), candidate: secondary(candidate) },
    profile: { v1: v1.bundle.manifest.canonicalization_profile ?? null, candidate: candidate.bundle.manifest.canonicalization_profile },
    serialization: { v1: v1Serialization, candidate: 'canonical bytes (dcp-jcs, from the producer)' },
  };
}

export const COST_BOUNDARIES = {
  produce_v1: "the four artifacts signed with today's signer, the v1 builder, the bundle signed, serialized to bytes",
  produce_candidate: 'the four artifacts signed by the candidate producer (value inputs), the bundle assembled and signed, canonical bytes',
  verify_v1_path: 'the bytes into the phase 3 verifier (accepting dcp-jcs-v1 and dcp-jcs-v2): ingress, route, the historical decoder, today\'s verifier',
  verify_candidate: 'the bytes into the same verifier: ingress, route, the candidate verifier',
};

/** Timings of `fn` in ms: COST.warmup calls discarded, then COST.n samples. */
export async function measure(fn) {
  for (let i = 0; i < COST.warmup; i++) await fn();
  const samples = [];
  for (let i = 0; i < COST.n; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  const s = [...samples].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { median_ms: median, p90_ms: s[Math.ceil(0.9 * s.length) - 1], samples_ms: samples };
}

/**
 * One platform's cost: the pair is produced once, kept in cost/ and checked (costChecks, and each
 * verification verified on its own route), then every operation is measured. `p` gives produceV1,
 * produceCandidate (both to bytes), verifiers(v1, candidate) → { today, v1Path, candidatePath },
 * v1Serialization and todayBoundary (what verify_today includes).
 */
export async function runCost(ctx, sdk, p) {
  const v1 = await p.produceV1();
  const candidate = await p.produceCandidate();
  mkdirSync(join(ctx.run, 'cost'), { recursive: true });
  writeFileSync(join(ctx.run, 'cost', `${sdk}-v1.bin`), v1);
  writeFileSync(join(ctx.run, 'cost', `${sdk}-candidate.bin`), candidate);
  const v = p.verifiers(v1, candidate);
  const [a, b, c] = [await v.today(), await v.v1Path(), await v.candidatePath()];
  const checks = costChecks(JSON.parse(text(v1)), JSON.parse(text(candidate)));
  Object.assign(checks, {
    today_verified: a.verified === true,
    v1_path: b.entered === 'dcp-jcs-v1' && b.verification?.verified === true,
    candidate: c.entered === 'dcp-jcs-v2' && c.verification?.verified === true,
  });
  if (!Object.values(checks).every((x) => x === true)) throw new Error(`the pair is not equivalent: ${JSON.stringify(checks)}`);
  const t0 = performance.now();
  const ops = {
    produce_v1: await measure(p.produceV1),
    produce_candidate: await measure(p.produceCandidate),
    verify_today: await measure(v.today),
    verify_v1_path: await measure(v.v1Path),
    verify_candidate: await measure(v.candidatePath),
  };
  const report = { sdk, run_id: ctx.runId, created_at: new Date().toISOString(), ...COST, platform: p.platform, versions: p.versions, cpu: cpus()[0]?.model ?? null,
    bytes: { v1: v1.length, candidate: candidate.length }, differences: costDifferences(JSON.parse(text(v1)), JSON.parse(text(candidate)), p.v1Serialization),
    boundaries: { ...COST_BOUNDARIES, verify_today: p.todayBoundary }, checks, ops, measured_ms: performance.now() - t0 };
  writeFileSync(join(ctx.run, 'cost', `${sdk}.json`), JSON.stringify(report, null, 2));
}
