// The TypeScript adapter of the phase 4 matrix, over the built package (sdks/typescript/dist). Modes:
// inputs (the run's synthetic keys and input pieces, generated once), produce, ring, verify.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AlgorithmRegistry,
  BundleBuilderV2,
  Ed25519Provider,
  MlDsa65Provider,
  canonicalizeV2,
  compositeSign,
  createExperimentalCandidateVerifier,
  deriveKid,
  dualHashCanonical,
  dualMerkleRoot,
  experimentalCandidateIngress,
  experimentalCandidateSignBundle,
  experimentalCandidateSignPayload,
  experimentalHistoricalAdapters,
  generateSessionNonce,
  preparePayload,
  sha256Hex,
  signBundleV2,
  verifySignedBundleV2,
} from '../../../../../sdks/typescript/dist/index.js';
import { PARTS, context, costInputs, counting, itemsToVerify, produceAll, ringOf, runCost, writeResult } from './common.mjs';

const [mode, run] = process.argv.slice(2);
const ctx = context(mode, run);
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
const registry = new AlgorithmRegistry();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
const utf8 = (s) => new TextEncoder().encode(s);

function sdkKeys(k, classical) {
  const c = { kid: k.classical.kid, alg: 'ed25519', secretKeyB64: k.classical.sk64, publicKeyB64: k.classical.pk };
  return classical ? { classical: c } : { classical: c, pq: { kid: k.pq.kid, alg: 'ml-dsa-65', secretKeyB64: k.pq.sk, publicKeyB64: k.pq.pk } };
}

async function inputs() {
  const pair = async () => {
    const c = await ed25519.generateKeypair();
    const p = await mlDsa65.generateKeypair();
    return {
      classical: { alg: 'ed25519', kid: c.kid, pk: c.publicKeyB64, sk64: c.secretKeyB64, seed32: Buffer.from(c.secretKeyB64, 'base64').subarray(0, 32).toString('base64') },
      pq: { alg: 'ml-dsa-65', kid: p.kid, pk: p.publicKeyB64, sk: p.secretKeyB64 },
    };
  };
  const k = { principal: await pair(), agent: await pair() };
  mkdirSync(join(run, 'inputs'), { recursive: true });
  writeFileSync(join(run, 'inputs', 'keys.json'), JSON.stringify(k, null, 2));
  const hashOf = (bytes) => {
    const r = experimentalCandidateIngress(bytes);
    if (r.status !== 'accept') throw new Error(`an input outside the domain: ${r.class}`);
    return `sha256:${sha256Hex(Buffer.from(canonicalizeV2(r.value), 'utf8'))}`;
  };
  for (const c of ctx.specs.cases) {
    const dir = join(run, 'inputs', c.id);
    mkdirSync(dir, { recursive: true });
    const write = (name, s) => writeFileSync(join(dir, `${name}.json`), s);
    const nonce = generateSessionNonce();
    const pk = sdkKeys(k.principal, c.classical);
    const ak = sdkKeys(k.agent, c.classical);
    const entries = (keyset, expires) => [keyset.classical, ...(keyset.pq ? [keyset.pq] : [])].map((x) => ({
      kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: expires, status: 'active',
    }));
    const rpr = { dcp_version: '2.0', human_id: 'human:candidate-principal', session_nonce: nonce, legal_name: 'Candidate Principal',
      entity_type: 'natural_person', jurisdiction: 'US-CA', liability_mode: 'owner_responsible', override_rights: true,
      issued_at: '2026-10-21T00:00:00Z', expires_at: null, contact: null, binding_keys: entries(pk, null) };
    const passport = { dcp_version: '2.0', agent_id: 'agent:candidate-bot', session_nonce: nonce, keys: entries(ak, '2099-12-31T18:59:59-05:00'),
      principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: c.routine ? 'low' : 'medium',
      created_at: '2026-10-21T00:00:00Z', status: 'active' };
    const target = c.routine ? { channel: 'web' } : { channel: 'email', to: 'bob@example.com', domain: 'example.com' };
    const intentBase = { dcp_version: '2.0', intent_id: 'intent:candidate-001', session_nonce: nonce, agent_id: passport.agent_id, human_id: rpr.human_id,
      timestamp: '2026-10-21T12:00:00Z', action_type: c.routine ? 'browse' : 'send_email', target: '@TARGET@',
      data_classes: c.routine ? ['none'] : ['contact_info'], estimated_impact: c.routine ? 'low' : 'medium', requires_consent: false };
    // The target's extra members are raw JSON text, kept as written (literals, escapes, member names).
    const targetText = c.target_json ? `${JSON.stringify(target).slice(0, -1)},${c.target_json.slice(1)}` : JSON.stringify(target);
    const intentText = JSON.stringify(intentBase).replace('"@TARGET@"', targetText);
    const policy = { dcp_version: '2.0', intent_id: intentBase.intent_id, session_nonce: nonce, decision: 'approve', risk_score: c.routine ? 0 : 450,
      reasons: ['Known recipient domain'], required_confirmation: null, applied_policy_hash: `sha256:${sha256Hex(Buffer.from(canonicalizeV2({ policy: 'default' }), 'utf8'))}`,
      timestamp: '2026-10-21T12:00:01Z' };
    write('rpr', JSON.stringify(rpr));
    write('passport', JSON.stringify(passport));
    write('intent', intentText);
    write('policy', JSON.stringify(policy));
    const intentHash = hashOf(utf8(intentText));
    const list = [];
    for (let i = 0; i < 2; i++) {
      const e = { dcp_version: '2.0', audit_id: `audit:candidate-00${i + 1}`, session_nonce: nonce,
        prev_hash: i === 0 ? 'GENESIS' : hashOf(utf8(JSON.stringify(list[i - 1]))), hash_alg: 'sha256', timestamp: `2026-10-21T12:0${i + 1}:00Z`,
        agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intentBase.intent_id, intent_hash: intentHash, policy_decision: 'approved',
        outcome: 'email_sent', evidence: { tool: 'smtp', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
        ...(c.extensions && i === 1 ? { x_entry_ext: 'kept' } : {}) };
      list.push(e);
      write(`entry-${i}`, JSON.stringify(e));
    }
    if (c.checkpoint) {
      const root = dualMerkleRoot(list.map((e) => dualHashCanonical(canonicalizeV2(e))));
      const cp = { checkpoint_id: 'ckpt-candidate-001', session_nonce: nonce, merkle_root: `sha256:${root.sha256}`,
        event_range: { from_audit_id: list[0].audit_id, to_audit_id: list[1].audit_id, count: 2 }, ...(c.extensions ? { x_checkpoint_ext: [1, 2] } : {}) };
      const signed = await experimentalCandidateSignPayload(registry, 'DCP-AI.v2.AuditEvent', { value: cp }, sdkKeys(k.agent, false));
      write('checkpoint-0', JSON.stringify({ ...cp, composite_sig: signed.signedPayload.composite_sig }));
    }
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({
      id: c.id, modes: c.modes, classical: !!c.classical, dual_hash: !!c.dual_hash, extensions: !!c.extensions, checkpoint: !!c.checkpoint,
      session_nonce: nonce, session_issued_at: ctx.specs.session.issued_at, session_expires_at: ctx.specs.session.expires_at,
      created_at: ctx.specs.session.created_at, entries: ['entry-0', 'entry-1'],
    }, null, 2));
  }
}

const api = {
  signPayload: (context, input, k) => experimentalCandidateSignPayload(registry, context, input, k),
  signBundle: (parts, signer, options) => experimentalCandidateSignBundle(registry, parts, signer, options),
  keys: sdkKeys,
  deriveKid: (alg, pk) => deriveKid(alg, Buffer.from(pk, 'base64')),
};
const produce = () => produceAll(ctx, 'ts', api);
const ring = () => ringOf(ctx, 'ts', api);

async function verify() {
  const verifiers = new Map();
  for (const item of itemsToVerify(ctx)) {
    const key = `${item.config.transport}|${item.config.accepted.join(',')}`;
    if (!verifiers.has(key)) {
      const c = counting(experimentalHistoricalAdapters.bufferUtf8JsonParse);
      verifiers.set(key, { c, v: createExperimentalCandidateVerifier({ transport: item.config.transport, acceptedProfiles: item.config.accepted, historical: c.adapter }) });
    }
    const { c, v } = verifiers.get(key);
    c.calls = 0;
    const r = await v.verify(item.bytes, registry, undefined, { now: ctx.now });
    writeResult(ctx, 'ts', item, r, c.calls);
  }
}

/** Gate 10: today's v1 builder and signer against the candidate producer, and the three verifications. */
async function cost() {
  const { md, k, payloads, entries } = costInputs(run);
  const keysOf = (who) => sdkKeys(k[who], false);
  const signer = { signerType: 'human', signerId: 'human:candidate-principal' };
  const produceV1 = async () => {
    const a = {};
    for (const [name, context, who] of PARTS) {
      const { canonicalBytes, payloadHash } = preparePayload(payloads[name]);
      a[name] = { payload: payloads[name], payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keysOf(who)) };
    }
    const bundle = new BundleBuilderV2(md.session_nonce).responsiblePrincipalRecord(a.rpr).agentPassport(a.passport).intent(a.intent)
      .policyDecision(a.policy).addAuditEntries(entries).build();
    bundle.manifest.session_issued_at = md.session_issued_at;
    const signed = await signBundleV2(bundle, { registry, ...signer, keys: keysOf('principal'), sessionExpiresAt: md.session_expires_at });
    return utf8(JSON.stringify(signed));
  };
  const produceCandidate = async () => {
    const a = {};
    for (const [name, context, who] of PARTS) a[name] = { value: (await experimentalCandidateSignPayload(registry, context, { value: payloads[name] }, keysOf(who))).signedPayload };
    return (await experimentalCandidateSignBundle(registry, { rpr: a.rpr, passport: a.passport, intent: a.intent, policyDecision: a.policy, auditEntries: entries.map((value) => ({ value })) },
      { ...signer, keys: keysOf('principal') }, { sessionNonce: md.session_nonce, sessionIssuedAt: md.session_issued_at, sessionExpiresAt: md.session_expires_at, createdAt: md.created_at })).bytes;
  };
  const verifier = createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1', 'dcp-jcs-v2'], historical: experimentalHistoricalAdapters.bufferUtf8JsonParse });
  await runCost(ctx, 'ts', {
    platform: 'TypeScript (dist)', versions: { node: process.version }, produceV1, produceCandidate,
    v1Serialization: 'JSON.stringify (compact, insertion order)',
    todayBoundary: 'the bytes decoded (TextDecoder) and JSON.parse, then verifySignedBundleV2(object): the object API, with the decode a caller of bytes needs',
    verifiers: (v1, candidate) => ({
      today: () => verifySignedBundleV2(JSON.parse(new TextDecoder().decode(v1)), registry, undefined, { now: ctx.now }),
      v1Path: () => verifier.verify(v1, registry, undefined, { now: ctx.now }),
      candidatePath: () => verifier.verify(candidate, registry, undefined, { now: ctx.now }),
    }),
  });
}

const modes = { inputs, produce, ring, verify, cost };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
