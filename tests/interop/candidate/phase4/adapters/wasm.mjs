// The WASM adapter of the phase 4 matrix, over the built package (sdks/wasm: pkg and dist). Modes:
// produce, ring, verify. Ed25519 keys reach it as the 32-byte seed.
import { readFileSync } from 'node:fs';
import { initDcp, experimentalWasmHistoricalAdapters } from '../../../../../sdks/wasm/dist/index.js';
import { PARTS, context, costInputs, counting, itemsToVerify, produceAll, ringOf, runCost, writeResult } from './common.mjs';

const [mode, run] = process.argv.slice(2);
const ctx = context(mode, run);
const dcp = await initDcp({ module_or_path: readFileSync(new URL('../../../../../sdks/wasm/pkg/dcp_ai_bg.wasm', import.meta.url)) });

function sdkKeys(k, classical) {
  const c = { kid: k.classical.kid, alg: 'ed25519', secretKeyB64: k.classical.seed32, publicKeyB64: k.classical.pk };
  return classical ? { classical: c } : { classical: c, pq: { kid: k.pq.kid, alg: 'ml-dsa-65', secretKeyB64: k.pq.sk, publicKeyB64: k.pq.pk } };
}

const api = {
  signPayload: (context, input, k) => dcp.experimentalCandidateSignPayload(context, input, k),
  signBundle: (parts, signer, options) => dcp.experimentalCandidateSignBundle(parts, signer, options),
  keys: sdkKeys,
  deriveKid: (alg, pk) => dcp.deriveKid(alg, pk),
};

function verify() {
  const verifiers = new Map();
  for (const item of itemsToVerify(ctx)) {
    const key = `${item.config.transport}|${item.config.accepted.join(',')}`;
    if (!verifiers.has(key)) {
      const c = counting(experimentalWasmHistoricalAdapters.w2TextDecoder);
      verifiers.set(key, { c, v: dcp.createExperimentalCandidateVerifier({ transport: item.config.transport, acceptedProfiles: item.config.accepted, historical: c.adapter }) });
    }
    const { c, v } = verifiers.get(key);
    c.calls = 0;
    const r = atNow(() => v.verify(item.bytes));
    writeResult(ctx, 'wasm', item, r, c.calls);
  }
}

/** The synthetic clock of the run, for one synchronous call: the bindings read Date.now. */
function atNow(fn) {
  const realNow = Date.now;
  try {
    Date.now = () => ctx.now;
    return fn();
  } finally {
    Date.now = realNow;
  }
}

/** Gate 10: today's bindings (signPayload, buildBundle, signBundle) against the candidate producer. */
async function cost() {
  const { md, k, payloads, entries } = costInputs(run);
  const keysOf = (who) => sdkKeys(k[who], false);
  const utf8 = (s) => new TextEncoder().encode(s);
  const produceV1 = () => {
    const a = {};
    for (const [name, context, who] of PARTS) {
      const x = keysOf(who);
      a[name] = dcp.signPayload(context, payloads[name], x.classical.secretKeyB64, x.classical.kid, x.pq.secretKeyB64, x.pq.kid);
    }
    const bundle = dcp.buildBundle({ rpr: a.rpr, passport: a.passport, intent: a.intent, policy: a.policy, auditEntries: entries, sessionNonce: md.session_nonce });
    bundle.manifest.session_issued_at = md.session_issued_at;
    bundle.manifest.session_expires_at = md.session_expires_at;
    const p = keysOf('principal');
    return utf8(JSON.stringify(dcp.signBundle(bundle, p.classical.secretKeyB64, p.classical.kid, p.pq.secretKeyB64, p.pq.kid)));
  };
  const produceCandidate = () => {
    const a = {};
    for (const [name, context, who] of PARTS) a[name] = { value: dcp.experimentalCandidateSignPayload(context, { value: payloads[name] }, keysOf(who)).signedPayload };
    return dcp.experimentalCandidateSignBundle({ rpr: a.rpr, passport: a.passport, intent: a.intent, policyDecision: a.policy, auditEntries: entries.map((value) => ({ value })) },
      { signerType: 'human', signerId: 'human:candidate-principal', keys: keysOf('principal') },
      { sessionNonce: md.session_nonce, sessionIssuedAt: md.session_issued_at, sessionExpiresAt: md.session_expires_at, createdAt: md.created_at }).bytes;
  };
  const verifier = dcp.createExperimentalCandidateVerifier({ transport: 'bare', acceptedProfiles: ['dcp-jcs-v1', 'dcp-jcs-v2'], historical: experimentalWasmHistoricalAdapters.w2TextDecoder });
  await runCost(ctx, 'wasm', {
    platform: 'WASM (pkg + dist, Node)', versions: { node: process.version }, produceV1, produceCandidate,
    v1Serialization: 'JSON.stringify of the result of the binding (compact, insertion order)',
    todayBoundary: 'the bytes decoded (TextDecoder) and JSON.parse, then DcpWasm.verifyBundle(object), which serializes it again for the binding: the object API, with the decode a caller of bytes needs',
    verifiers: (v1, candidate) => ({
      today: () => atNow(() => dcp.verifyBundle(JSON.parse(new TextDecoder().decode(v1)))),
      v1Path: () => atNow(() => verifier.verify(v1)),
      candidatePath: () => atNow(() => verifier.verify(candidate)),
    }),
  });
}

const modes = { cost, produce: () => produceAll(ctx, 'wasm', api), ring: () => ringOf(ctx, 'wasm', api), verify };
if (!modes[mode]) throw new Error(`unknown mode ${mode}`);
await modes[mode]();
