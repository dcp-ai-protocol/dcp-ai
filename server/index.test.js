import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, buildMultiPartyAuthorization, createKeyRotation, createMultiPartyRequest,
  createPartyAuthorization, generateKeypair, hashObject, intentHash, signBundle,
} from "@dcp-ai/sdk";
import { buildV2Examples } from "../scripts/generate-v2-examples.js";
import { computeSecurityTier } from "../lib/security-tier.js";
import { later, newAgent, post as postTo, registry, sha256Hex, sign, signPassport, startService } from "../tests/helpers.js";

const SERVER = fileURLToPath(new URL("./index.js", import.meta.url));
const OPERATOR_TOKEN = "test-operator-token";
const asOperator = { authorization: `Bearer ${OPERATOR_TOKEN}` };
let base; // default policy, operator token set
let configured; // VERIFIER_MODE=classical_only ALLOW_V1_BUNDLES=false
let classical; // VERIFIER_MODE=classical_only, V1 bundles allowed
let procs;
let signedBundle;

before(async () => {
  ({ signedBundle } = await buildV2Examples());
  const services = await Promise.all([
    startService(SERVER, { OPERATOR_TOKEN, REGISTRATIONS_PER_HOUR: "1000" }),
    startService(SERVER, { VERIFIER_MODE: "classical_only", ALLOW_V1_BUNDLES: "false", REGISTRATIONS_PER_HOUR: "1000", OPERATOR_TOKEN }),
    startService(SERVER, { VERIFIER_MODE: "classical_only", OPERATOR_TOKEN }),
  ]);
  [base, configured, classical] = services.map((s) => s.base);
  procs = services.map((s) => s.proc);
});

after(() => procs.forEach((p) => p.kill()));

const post = (path, body, headers) => postTo(base, path, body, headers);
// Registering a new agent_id needs the operator token; re-registering does not.
const registerNew = (url, signed_passport) => postTo(url, "/v2/passport/register", { signed_passport }, asOperator);

// Rotates an agent's Ed25519 key on `url` and returns the HTTP status.
const ed25519Rotator = (url, agent) => {
  const provider = new Ed25519Provider();
  let current = { kid: agent.keys.classical.kid, secretKeyB64: agent.keys.classical.secretKeyB64 };
  return async () => {
    const next = await provider.generateKeypair();
    const rotation = await createKeyRotation(registry, {
      oldKid: current.kid, oldAlg: "ed25519", oldSecretKeyB64: current.secretKeyB64,
      newKid: next.kid, newAlg: "ed25519", newSecretKeyB64: next.secretKeyB64, newPublicKeyB64: next.publicKeyB64,
      timestamp: new Date().toISOString(), expiresAt: null,
    });
    const { status } = await postTo(url, "/v2/keys/rotate", rotation);
    if (status === 200) current = next;
    return status;
  };
};
const v1Bundle = () => JSON.parse(
  fs.readFileSync(new URL("../tests/conformance/examples/citizenship_bundle.signed.json", import.meta.url), "utf8"),
);
// A V1 bundle as anyone can make one: the example's public artifacts, the intent changed, the audit
// chain recomputed, and a signature by a key generated here, which the bundle itself declares.
const forgedV1 = (intent = {}, change = () => {}) => {
  const { bundle } = v1Bundle();
  Object.assign(bundle.intent, intent);
  change(bundle);
  let prev = "GENESIS";
  for (const entry of bundle.audit_entries) {
    Object.assign(entry, { intent_hash: intentHash(bundle.intent), prev_hash: prev });
    prev = hashObject(entry);
  }
  return signBundle(bundle, { secretKeyB64: generateKeypair().secretKeyB64 });
};

test("valid V2 bundle verifies on both endpoints", async () => {
  assert.equal((await post("/verify", { signed_bundle: signedBundle })).body.verified, true);
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: signedBundle })).body.verified, true);
});

test("server policy (hybrid_required) rejects a PQ-stripped bundle", async () => {
  const stripped = structuredClone(signedBundle);
  stripped.signature.composite_sig.pq = null;
  stripped.signature.composite_sig.binding = "classical_only";
  assert.equal((await post("/verify", { signed_bundle: stripped })).body.verified, false);
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: stripped })).body.verified, false);
});

test("the security tier follows the shared §14.2 vectors", () => {
  const { security_tier } = JSON.parse(
    fs.readFileSync(new URL("../tests/interop/v2/interop_vectors.json", import.meta.url), "utf8"),
  );
  for (const c of security_tier.cases) {
    assert.equal(computeSecurityTier(c.intent, c.policy_decision), c.expected.tier, c.name);
  }
});

test("resolved_tier: an explicit intent tier cannot lower it, risk_score comes from the policy decision", async () => {
  const withPii = structuredClone(signedBundle);
  Object.assign(withPii.bundle.intent.payload, { data_classes: ["pii"], security_tier: "routine" });
  const risky = structuredClone(signedBundle);
  Object.assign(risky.bundle.intent.payload, { action_type: "browse", data_classes: ["none"], estimated_impact: "low" });
  risky.bundle.policy_decision.payload.risk_score = 900;
  for (const path of ["/verify", "/v2/bundle/verify"]) {
    assert.equal((await post(path, { signed_bundle: withPii })).body.resolved_tier, "elevated", path);
    assert.equal((await post(path, { signed_bundle: risky })).body.resolved_tier, "maximum", path);
  }
});

test("V1 bundle on the V2 endpoint is a 400, not a 500", async () => {
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: v1Bundle() })).status, 400);
});

test("POST /verify takes a V1 bundle only where a classical-only bundle would pass", async () => {
  // The default policy is hybrid_required for every tier, and a V1 bundle has one Ed25519 signature.
  const refused = await post("/verify", { signed_bundle: forgedV1() });
  assert.equal(refused.body.verified, false);
  assert.match(refused.body.errors[0], /hybrid_required/);

  // classical_only takes its routine and standard intents, as it would a classical-only V2 bundle...
  const taken = await postTo(classical, "/verify", { signed_bundle: forgedV1() });
  assert.deepEqual([taken.body.verified, taken.body.errors], [true, []]);
  // ...but a payment is an elevated intent, which needs the post-quantum signature under any policy.
  const payment = await postTo(classical, "/verify", { signed_bundle: forgedV1({ action_type: "initiate_payment" }) });
  assert.equal(payment.body.verified, false);
  assert.match(payment.body.errors[0], /hybrid_required/);
  // A risk_tier the policy has no mode for counts as hybrid_required, not as the default mode.
  const unknownTier = forgedV1();
  unknownTier.bundle.agent_passport.risk_tier = "none";
  assert.match((await postTo(classical, "/verify", { signed_bundle: unknownTier })).body.errors[0], /hybrid_required/);
  // The V1 risk_score goes from 0 to 1: 0.9 is a decision of the maximum tier, and a decision without one is
  // not a routine one.
  for (const [change, tier] of [[(b) => { b.policy_decision.risk_score = 0.9; }, "maximum"], [(b) => { delete b.policy_decision.risk_score; }, "elevated"]]) {
    const risky = await postTo(classical, "/verify", { signed_bundle: forgedV1({}, change) });
    assert.equal(risky.body.verified, false);
    assert.match(risky.body.errors[0], new RegExp(`hybrid_required for this bundle \\(security tier ${tier}\\)`));
  }
  // The key a caller pins says whose signature it is, not that the policy takes the bundle.
  const pinned = forgedV1();
  const withKey = await post("/verify", { signed_bundle: pinned, public_key_b64: pinned.signature.signer.public_key_b64 });
  assert.equal(withKey.body.verified, false);
  assert.match(withKey.body.errors[0], /hybrid_required/);
});

test("POST /verify refuses a V1 bundle once an advisory has withdrawn its algorithm", async () => {
  const revoke = (affected_algorithms) => ({
    type: "algorithm_advisory", advisory_id: "DCP-ADV-0002", severity: "critical", affected_algorithms, action: "revoke",
    replacement_algorithms: [], effective_date: "2026-01-01T00:00:00Z", grace_period_days: 0, description: "test advisory",
    issued_at: "2026-01-01T00:00:00Z", issuer: "governance:test",
    composite_sig: { classical: { alg: "ed25519", kid: "0".repeat(32), sig_b64: "A".repeat(88) }, pq: null, binding: "classical_only" },
  });
  // Each case has its own server: an advisory changes the policy for every request that follows.
  const withAdvisory = async (mode, affected, check) => {
    const { base: url, proc } = await startService(SERVER, { VERIFIER_MODE: mode, OPERATOR_TOKEN });
    try {
      const v1 = forgedV1();
      assert.equal((await postTo(url, "/verify", { signed_bundle: v1 })).body.verified, true, mode);
      assert.equal((await postTo(url, "/v2/advisory/publish", { advisory: revoke(affected) }, asOperator)).status, 201);
      const applied = await postTo(url, "/v2/advisory/auto-apply", {}, asOperator);
      assert.deepEqual([applied.status, applied.body.removed_classical], [200, ["ed25519"]]);
      const after = await postTo(url, "/verify", { signed_bundle: v1 });
      assert.equal(after.body.verified, false, mode);
      await check(after.body.errors[0], (await (await fetch(`${url}/v2/policy`)).json()).policy, url);
    } finally {
      proc.kill();
    }
  };
  // No classical algorithm is left and a post-quantum one is: the policy becomes pq_only for every risk tier, not
  // only for bundles without one, and pq_only takes no V1 bundle.
  for (const mode of ["classical_only", "hybrid_preferred"]) {
    await withAdvisory(mode, ["ed25519"], async (error, policy, url) => {
      assert.match(error, /V1 bundles are disabled/);
      assert.deepEqual([policy.default_mode, policy.risk_overrides, policy.allow_v1_bundles, policy.accepted_classical_algs],
        ["pq_only", { high: "pq_only", medium: "pq_only", low: "pq_only" }, false, []]);
      // A hybrid bundle still verifies, on its post-quantum signature: with the risk tiers left on a mode that
      // reads the classical one, it was refused.
      assert.equal((await postTo(url, "/v2/bundle/verify", { signed_bundle: signedBundle })).body.verified, true, mode);
    });
  }
  // No algorithm is left at all, so the mode does not change: the V1 signature is still Ed25519, which the policy
  // no longer takes.
  await withAdvisory("classical_only", ["ed25519", "ml-dsa-65", "slh-dsa-192f"], (error, policy) => {
    assert.match(error, /ed25519/);
    assert.equal(policy.default_mode, "classical_only");
  });
});

test("an advisory that withdraws Ed25519 reaches audit/append, and every forced change of mode is recorded", async () => {
  const { base: url, proc } = await startService(SERVER, { VERIFIER_MODE: "classical_only", OPERATOR_TOKEN });
  try {
    // An agent whose only key is Ed25519, registered while the policy took such an agent.
    const tango = await newAgent("agent:tango-001");
    const classicalOnly = { classical: tango.keys.classical };
    const passport = { ...tango.passport, keys: tango.passport.keys.filter((key) => key.kid === tango.keys.classical.kid) };
    assert.equal((await registerNew(url, await signPassport(passport, classicalOnly))).status, 201);
    let n = 0;
    const append = async (agent_id = "agent:tango-001", keys = classicalOnly) => {
      const audit_event = {
        dcp_version: "2.0", audit_id: `audit:${String(++n).padStart(4, "0")}`, session_nonce: "ab".repeat(32), prev_hash: "GENESIS",
        hash_alg: "sha256", timestamp: "2026-11-18T00:00:00Z", agent_id, human_id: "human:test-owner",
        intent_id: "intent:0001", intent_hash: `sha256:${"0".repeat(64)}`, policy_decision: "approved", outcome: "sent",
        evidence: { tool: null, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
      };
      return postTo(url, "/v2/audit/append", { audit_event, signature: await sign(DCP_CONTEXTS.AuditEvent, audit_event, keys) });
    };
    assert.equal((await append()).status, 201);
    // Where a classical signature alone is taken, an agent that registered a post-quantum key still needs it for every
    // event: its Ed25519 key alone would be a downgrade.
    const uniform = await newAgent("agent:uniform-02");
    assert.equal((await registerNew(url, uniform.signedPassport)).status, 201);
    assert.equal((await append("agent:uniform-02", { classical: uniform.keys.classical })).status, 403);
    assert.equal((await append("agent:uniform-02", uniform.keys)).status, 201);

    const advisory = {
      type: "algorithm_advisory", advisory_id: "DCP-ADV-0003", severity: "critical", affected_algorithms: ["ed25519"], action: "revoke",
      replacement_algorithms: [], effective_date: "2026-01-01T00:00:00Z", grace_period_days: 0, description: "test advisory",
      issued_at: "2026-01-01T00:00:00Z", issuer: "governance:test",
      composite_sig: { classical: { alg: "ed25519", kid: "0".repeat(32), sig_b64: "A".repeat(88) }, pq: null, binding: "classical_only" },
    };
    assert.equal((await postTo(url, "/v2/advisory/publish", { advisory }, asOperator)).status, 201);
    const policy = async () => (await fetch(`${url}/v2/policy`)).json();
    const autoApply = async () => (await postTo(url, "/v2/advisory/auto-apply", {}, asOperator)).body;
    const recorded = (await policy()).policy_history_length;
    assert.equal((await autoApply()).policy_modified, true);
    assert.deepEqual([(await policy()).mode, (await policy()).policy_history_length], ["pq_only", recorded + 1]);
    // The signature the gateway took a moment ago is one Ed25519 signature: the policy no longer takes that.
    const refused = await append();
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /does not verify/);

    // Nothing left to change: applying the advisories again modifies nothing and records nothing.
    assert.equal((await autoApply()).policy_modified, false);
    assert.equal((await policy()).policy_history_length, recorded + 1);
    // The operator puts the mode back by hand. With no classical algorithm left the next auto-apply forces pq_only
    // again, and says so: it is a change of policy like the first.
    assert.equal((await postTo(url, "/v2/policy/mode", { mode: "classical_only" }, asOperator)).status, 200);
    assert.equal((await append()).status, 403); // the mode alone does not bring Ed25519 back
    // Nor does it let a new agent in with an Ed25519 key alone, which this mode took before the advisory.
    const victor = await newAgent("agent:victor-02");
    const alone = { ...victor.passport, keys: victor.passport.keys.filter((key) => key.kid === victor.keys.classical.kid) };
    assert.equal((await registerNew(url, await signPassport(alone, { classical: victor.keys.classical }))).status, 403);
    // An agent with both keys goes on as before: its post-quantum signature is what counts now.
    assert.equal((await append("agent:uniform-02", uniform.keys)).status, 201);
    const forced = await autoApply();
    assert.deepEqual([forced.policy_modified, (await policy()).mode, (await policy()).policy_history_length], [true, "pq_only", recorded + 3]);
  } finally {
    proc.kill();
  }
});

test("a signature with no post-quantum half is taken only where the mode takes one", async () => {
  const classicalOnlyAgent = async (id) => {
    const agent = await newAgent(id);
    const keys = { classical: agent.keys.classical };
    const passport = { ...agent.passport, keys: agent.passport.keys.filter((key) => key.kid === agent.keys.classical.kid) };
    return { id, keys, signedPassport: await signPassport(passport, keys) };
  };
  const event = (agent_id) => ({
    dcp_version: "2.0", audit_id: "audit:0001", session_nonce: "ab".repeat(32), prev_hash: "GENESIS", hash_alg: "sha256",
    timestamp: "2026-11-18T00:00:00Z", agent_id, human_id: "human:test-owner", intent_id: "intent:0001",
    intent_hash: `sha256:${"0".repeat(64)}`, policy_decision: "approved", outcome: "sent",
    evidence: { tool: null, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  });
  // hybrid_required, the default: such an agent is not registered.
  const whiskey = await classicalOnlyAgent("agent:whiskey-02");
  assert.equal((await registerNew(base, whiskey.signedPassport)).status, 403);
  // hybrid_preferred takes it, to register and to append.
  const { base: url, proc } = await startService(SERVER, { VERIFIER_MODE: "hybrid_preferred", OPERATOR_TOKEN });
  try {
    const xray = await classicalOnlyAgent("agent:xray-0002");
    assert.equal((await registerNew(url, xray.signedPassport)).status, 201);
    const audit_event = event(xray.id);
    const appended = await postTo(url, "/v2/audit/append", { audit_event, signature: await sign(DCP_CONTEXTS.AuditEvent, audit_event, xray.keys) });
    assert.deepEqual([appended.status, appended.body.chain_length], [201, 1]);
    // The operator raises the mode: the same agent no longer appends with its one key.
    assert.equal((await postTo(url, "/v2/policy/mode", { mode: "hybrid_required" }, asOperator)).status, 200);
    assert.equal((await postTo(url, "/v2/audit/append", { audit_event, signature: await sign(DCP_CONTEXTS.AuditEvent, audit_event, xray.keys) })).status, 403);
  } finally {
    proc.kill();
  }
});

test("an advisory that withdraws a post-quantum algorithm reaches the signatures that use it", async () => {
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN });
  try {
    const zulu = await newAgent("agent:zulu-0002");
    assert.equal((await registerNew(url, zulu.signedPassport)).status, 201);
    let n = 0;
    const append = async () => {
      const audit_event = {
        dcp_version: "2.0", audit_id: `audit:${String(++n).padStart(4, "0")}`, session_nonce: "ab".repeat(32), prev_hash: "GENESIS",
        hash_alg: "sha256", timestamp: "2026-11-18T00:00:00Z", agent_id: "agent:zulu-0002", human_id: "human:test-owner",
        intent_id: "intent:0001", intent_hash: `sha256:${"0".repeat(64)}`, policy_decision: "approved", outcome: "sent",
        evidence: { tool: null, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
      };
      return postTo(url, "/v2/audit/append", { audit_event, signature: await sign(DCP_CONTEXTS.AuditEvent, audit_event, zulu.keys) });
    };
    assert.equal((await append()).status, 201);
    const advisory = {
      type: "algorithm_advisory", advisory_id: "DCP-ADV-0004", severity: "critical", affected_algorithms: ["ml-dsa-65"], action: "revoke",
      replacement_algorithms: [], effective_date: "2026-01-01T00:00:00Z", grace_period_days: 0, description: "test advisory",
      issued_at: "2026-01-01T00:00:00Z", issuer: "governance:test",
      composite_sig: { classical: { alg: "ed25519", kid: "0".repeat(32), sig_b64: "A".repeat(88) }, pq: null, binding: "classical_only" },
    };
    assert.equal((await postTo(url, "/v2/advisory/publish", { advisory }, asOperator)).status, 201);
    // Published and not applied, it changes nothing.
    assert.equal((await append()).status, 201);
    const applied = await postTo(url, "/v2/advisory/auto-apply", {}, asOperator);
    assert.deepEqual([applied.status, applied.body.removed_pq], [200, ["ml-dsa-65"]]);
    // The hybrid signature the gateway took a moment ago has an ML-DSA-65 half: the policy no longer takes that
    // algorithm, to append or to register.
    assert.equal((await append()).status, 403);
    const other = await newAgent("agent:zulu-0003");
    assert.equal((await registerNew(url, other.signedPassport)).status, 403);
    // A later advisory that names the withdrawn algorithm as a replacement puts it back among the accepted ones. It is
    // still an algorithm an advisory has withdrawn.
    const later = { ...advisory, advisory_id: "DCP-ADV-0005", affected_algorithms: ["slh-dsa-192f"], replacement_algorithms: ["ml-dsa-65"] };
    assert.equal((await postTo(url, "/v2/advisory/publish", { advisory: later }, asOperator)).status, 201);
    assert.equal((await postTo(url, "/v2/advisory/auto-apply", {}, asOperator)).status, 200);
    const { policy } = await (await fetch(`${url}/v2/policy`)).json();
    assert.deepEqual([policy.accepted_pq_algs.includes("ml-dsa-65"), policy.advisory_rejected_algs.includes("ml-dsa-65")], [true, true]);
    assert.equal((await append()).status, 403);
  } finally {
    proc.kill();
  }
});

test("a body or a V1 key that is not what it should be gets an answer, not a 500", async () => {
  // The JSON value null is not a body: every route reads members of it.
  const raw = (path, body) => fetch(`${classical}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
  for (const path of ["/verify", "/v2/bundle/verify", "/v2/passport/register", "/v2/audit/append", "/v2/keys/rotate"]) {
    for (const body of ["null", "7", '"text"', "true"]) {
      assert.equal((await raw(path, body)).status, 400, `${path} ${body}`);
    }
  }
  // A V1 bundle declares its own key. One of another size, or that is not base64, is a signature that does not
  // verify: the Ed25519 code throws on it.
  for (const key of [Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), "not base64!"]) {
    const bundle = forgedV1();
    bundle.signature.signer.public_key_b64 = key;
    const declared = await postTo(classical, "/verify", { signed_bundle: bundle });
    assert.deepEqual([declared.status, declared.body.verified], [200, false], key);
    const pinned = await postTo(classical, "/verify", { signed_bundle: forgedV1(), public_key_b64: key });
    assert.deepEqual([pinned.status, pinned.body.verified], [200, false], key);
  }
});

test("POST /verify warns when a V1 signature was checked against the key the bundle declares", async () => {
  const forged = forgedV1();
  const selfDeclared = await postTo(classical, "/verify", { signed_bundle: forged });
  assert.equal(selfDeclared.body.verified, true);
  assert.equal(selfDeclared.body.warnings?.length, 1);
  const pinned = await postTo(classical, "/verify", {
    signed_bundle: forged, public_key_b64: forged.signature.signer.public_key_b64,
  });
  assert.deepEqual([pinned.body.verified, pinned.body.warnings], [true, []]);
});

test("admin endpoints require the operator token", async () => {
  for (const path of ["/v2/policy/mode", "/v2/governance/register", "/v2/advisory/publish", "/v2/advisory/auto-apply"]) {
    assert.equal((await post(path, { mode: "classical_only" })).status, 401, path);
    assert.equal((await post(path, { mode: "classical_only" }, { authorization: "Bearer wrong" })).status, 401, path);
  }
  assert.equal((await post("/v2/policy/mode", { mode: "hybrid_required" }, asOperator)).status, 200);
  // Valid in every field but the signature, which the schema requires.
  const unsigned = {
    type: "algorithm_advisory", advisory_id: "DCP-ADV-0001", severity: "low", affected_algorithms: ["ed448"],
    action: "warn", replacement_algorithms: [], effective_date: "2026-01-01T00:00:00Z", grace_period_days: 0,
    description: "test advisory", issued_at: "2026-01-01T00:00:00Z", issuer: "governance:test",
  };
  assert.equal((await post("/v2/advisory/publish", { advisory: unsigned }, asOperator)).status, 400);
  const composite_sig = { classical: { alg: "ed25519", kid: "0".repeat(32), sig_b64: "A".repeat(88) }, pq: null, binding: "classical_only" };
  assert.equal((await post("/v2/advisory/publish", { advisory: { ...unsigned, composite_sig } }, asOperator)).status, 201);
});

test("passport registration checks the self-signature and blocks agent hijacking", async () => {
  const alice = await newAgent("agent:alice-001");
  assert.equal((await registerNew(base, alice.signedPassport)).status, 201);

  const tampered = structuredClone(alice.signedPassport);
  tampered.payload.capabilities = ["browse", "payments"];
  assert.equal((await post("/v2/passport/register", { signed_passport: tampered })).status, 403);

  // Mallory re-registers alice's agent_id with her own keys to plant her token.
  const mallory = await newAgent("agent:alice-001");
  assert.equal((await post("/v2/passport/register", { signed_passport: mallory.signedPassport })).status, 409);
  const revoke = { agent_id: "agent:alice-001", revocation_secret: mallory.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", revoke)).status, 403);

  // Alice replaces the token: her current keys sign a newer passport, and she shows the secret of
  // the registered token.
  const secret = crypto.randomBytes(32).toString("hex");
  const renewed = {
    ...alice.passport,
    created_at: later(alice.passport.created_at),
    emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(secret, "hex"))}`,
  };
  const signedRenewed = await signPassport(renewed, alice.keys);
  const withSecret = (current_revocation_secret) =>
    post("/v2/passport/register", { signed_passport: signedRenewed, current_revocation_secret });
  assert.equal((await withSecret(secret)).status, 403); // the new token's secret is not the registered one's
  assert.equal((await withSecret(alice.revocationSecret)).status, 201);

  // Signed passports are public: replaying the old one must not bring the old token back.
  assert.equal((await post("/v2/passport/register", { signed_passport: alice.signedPassport })).status, 409);
  const oldToken = { agent_id: "agent:alice-001", revocation_secret: alice.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", oldToken)).status, 403);

  // Listing alice's public key in another passport proves nothing: only signer keys register.
  const squatter = await newAgent("agent:squatter");
  squatter.passport.keys.push(alice.passport.keys[0]);
  const squat = await registerNew(base, await signPassport(squatter.passport, squatter.keys));
  assert.equal(squat.status, 201);
  assert.deepEqual(squat.body.registered_kids, [squatter.keys.classical.kid, squatter.keys.pq.kid]);
  const owner = await (await fetch(`${base}/v2/keys/${alice.keys.classical.kid}`)).json();
  assert.equal(owner.agent_id, "agent:alice-001");
});

test("replacing an emergency revocation token takes its secret or the operator, not the agent's keys alone", async () => {
  const victor = await newAgent("agent:victor-01");
  const whiskey = await newAgent("agent:whiskey-1");
  for (const agent of [victor, whiskey]) assert.equal((await registerNew(base, agent.signedPassport)).status, 201);
  const secret = "22".repeat(32);
  const withNewToken = (agent) => signPassport({
    ...agent.passport,
    created_at: later(agent.passport.created_at),
    emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(secret, "hex"))}`,
  }, agent.keys);

  // The keys are what a compromise gives away, and the token exists for that case: a passport they
  // sign does not replace it, and the principal's secret still revokes the agent.
  assert.equal((await post("/v2/passport/register", { signed_passport: await withNewToken(victor) })).status, 403);
  const principal = { agent_id: "agent:victor-01", revocation_secret: victor.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", principal)).status, 200);

  // The operator can replace it, for a principal who has lost the secret.
  assert.equal((await post("/v2/passport/register", { signed_passport: await withNewToken(whiskey) }, asOperator)).status, 201);
  assert.equal((await post("/v2/emergency-revoke", { agent_id: "agent:whiskey-1", revocation_secret: secret })).status, 200);
});

test("POST /v2/audit/append takes a schema-valid event signed by the registered agent's active keys", async () => {
  const oscar = await newAgent("agent:oscar-001");
  const papa = await newAgent("agent:papa-0001");
  for (const agent of [oscar, papa]) assert.equal((await registerNew(base, agent.signedPassport)).status, 201);
  const event = (fields) => ({
    dcp_version: "2.0", audit_id: "audit:0001", session_nonce: "ab".repeat(32), prev_hash: "GENESIS",
    hash_alg: "sha256", timestamp: "2026-11-18T00:00:00Z", agent_id: "agent:oscar-001", human_id: "human:test-owner",
    intent_id: "intent:0001", intent_hash: `sha256:${"0".repeat(64)}`, policy_decision: "approved", outcome: "sent",
    evidence: { tool: null, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null, ...fields,
  });
  const append = async (audit_event, keys) => post("/v2/audit/append", {
    audit_event, ...(keys && { signature: await sign(DCP_CONTEXTS.AuditEvent, audit_event, keys) }),
  });

  assert.deepEqual((await append(event(), oscar.keys)).body, { ok: true, audit_id: "audit:0001", chain_length: 1 });
  const second = await append(event({ audit_id: "audit:0002" }), oscar.keys);
  assert.deepEqual([second.status, second.body.chain_length], [201, 2]);

  // Not signed, signed by another registered agent, or with one of the agent's two keys only.
  assert.equal((await append(event())).status, 403);
  assert.equal((await append(event(), papa.keys)).status, 403);
  assert.equal((await append(event(), { classical: oscar.keys.classical })).status, 403);
  // An event that names no agent, or one that is not registered, belongs to nobody's chain.
  const { agent_id: _omitted, ...anonymous } = event();
  assert.equal((await append(anonymous, oscar.keys)).status, 400);
  assert.equal((await append(event({ agent_id: "agent:nobody-01" }), oscar.keys)).status, 400);
  // The event is the V2 audit entry of the schema, nothing else.
  assert.equal((await append(event({ note: "extra" }), oscar.keys)).status, 400);
  // Refused events do not count.
  assert.equal((await append(event({ audit_id: "audit:0003" }), oscar.keys)).body.chain_length, 3);
});

test("POST /v2/audit/append: the context, the keys in force, the post-quantum key and each agent's count", async () => {
  // Its own server: the shared one is close to the limits of its client.
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN, REGISTRATIONS_PER_HOUR: "1000" });
  try {
    const quebec = await newAgent("agent:quebec-01");
    const romeo = await newAgent("agent:romeo-001");
    for (const agent of [quebec, romeo]) assert.equal((await registerNew(url, agent.signedPassport)).status, 201);
    let n = 0;
    const event = (agent_id, fields) => ({
      dcp_version: "2.0", audit_id: `audit:${String(++n).padStart(4, "0")}`, session_nonce: "ab".repeat(32), prev_hash: "GENESIS",
      hash_alg: "sha256", timestamp: "2026-11-18T00:00:00Z", agent_id, human_id: "human:test-owner",
      intent_id: "intent:0001", intent_hash: `sha256:${"0".repeat(64)}`, policy_decision: "approved", outcome: "sent",
      evidence: { tool: null, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null, ...fields,
    });
    const append = async (agent_id, keys, { context = DCP_CONTEXTS.AuditEvent, fields } = {}) => {
      const audit_event = event(agent_id, fields);
      return postTo(url, "/v2/audit/append", { audit_event, signature: await sign(context, audit_event, keys) });
    };

    // Each agent has its own count.
    assert.equal((await append("agent:quebec-01", quebec.keys)).body.chain_length, 1);
    assert.equal((await append("agent:quebec-01", quebec.keys)).body.chain_length, 2);
    assert.equal((await append("agent:romeo-001", romeo.keys)).body.chain_length, 1);
    // A signature under another context is not a signature of an audit event.
    assert.equal((await append("agent:quebec-01", quebec.keys, { context: DCP_CONTEXTS.Intent })).status, 403);
    // The answer to an event that is not the schema's lists at most 50 problems, whatever the event carries.
    const unknown = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`extra_${i}`, i]));
    const invalid = await append("agent:quebec-01", quebec.keys, { fields: unknown });
    assert.deepEqual([invalid.status, invalid.body.details.length], [400, 50]);

    // A key that was rotated out no longer signs for its agent; the one that replaced it does.
    const provider = new Ed25519Provider();
    const rotate = async (from, to) => (await postTo(url, "/v2/keys/rotate", await createKeyRotation(registry, {
      oldKid: from.kid, oldAlg: from.alg, oldSecretKeyB64: from.secretKeyB64,
      newKid: to.kid, newAlg: "ed25519", newSecretKeyB64: to.secretKeyB64, newPublicKeyB64: to.publicKeyB64,
      timestamp: new Date().toISOString(), expiresAt: null,
    }))).status;
    const next = async () => ({ alg: "ed25519", ...(await provider.generateKeypair()) });
    const renewed = await next();
    assert.equal(await rotate(quebec.keys.classical, renewed), 200);
    assert.equal((await append("agent:quebec-01", quebec.keys)).status, 403);
    assert.equal((await append("agent:quebec-01", { classical: renewed, pq: quebec.keys.pq })).body.chain_length, 3);

    // An agent that registered a post-quantum key needs one for every event, also when the registry no longer
    // has that key: whoever holds it alone rotates it into Ed25519 keys of their own until its entry is dropped.
    let current = quebec.keys.pq;
    for (let i = 0; i < 5; i++) {
      const mine = await next();
      assert.equal(await rotate(current, mine), 200);
      current = mine;
    }
    assert.equal((await (await fetch(`${url}/v2/keys/${quebec.keys.pq.kid}`)).json()).key, null);
    for (const classical of [current, renewed]) {
      assert.equal((await append("agent:quebec-01", { classical })).status, 403);
    }
  } finally {
    proc.kill();
  }

  // An agent whose keys were classical from the start signs with one. Only a classical_only policy registers it.
  const sierra = await newAgent("agent:sierra-01");
  const classicalOnly = { classical: sierra.keys.classical };
  const passport = { ...sierra.passport, keys: sierra.passport.keys.filter((key) => key.kid === sierra.keys.classical.kid) };
  assert.equal((await registerNew(classical, await signPassport(passport, classicalOnly))).status, 201);
  const audit_event = {
    dcp_version: "2.0", audit_id: "audit:0001", session_nonce: "ab".repeat(32), prev_hash: "GENESIS", hash_alg: "sha256",
    timestamp: "2026-11-18T00:00:00Z", agent_id: "agent:sierra-01", human_id: "human:test-owner", intent_id: "intent:0001",
    intent_hash: `sha256:${"0".repeat(64)}`, policy_decision: "approved", outcome: "sent",
    evidence: { tool: null, result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  };
  const alone = await postTo(classical, "/v2/audit/append", { audit_event, signature: await sign(DCP_CONTEXTS.AuditEvent, audit_event, classicalOnly) });
  assert.deepEqual([alone.status, alone.body.chain_length], [201, 1]);
});

test("an emergency revocation token is kept by a passport without one, and first set by the agent's keys", async () => {
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN });
  try {
    const tango = await newAgent("agent:tango-001");
    assert.equal((await registerNew(url, tango.signedPassport)).status, 201);
    const { emergency_revocation_token: _dropped, ...withoutToken } = { ...tango.passport, created_at: later(tango.passport.created_at) };
    assert.equal((await postTo(url, "/v2/passport/register", { signed_passport: await signPassport(withoutToken, tango.keys) })).status, 201);
    assert.equal((await postTo(url, "/v2/emergency-revoke", { agent_id: "agent:tango-001", revocation_secret: tango.revocationSecret })).status, 200);

    // An agent registered without a token sets its first one with its keys: there is none to replace.
    const uniform = await newAgent("agent:uniform-01", { emergencyToken: false });
    assert.equal((await registerNew(url, uniform.signedPassport)).status, 201);
    const secret = "33".repeat(32);
    const first = {
      ...uniform.passport, created_at: later(uniform.passport.created_at),
      emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(secret, "hex"))}`,
    };
    assert.equal((await postTo(url, "/v2/passport/register", { signed_passport: await signPassport(first, uniform.keys) })).status, 201);
    assert.equal((await postTo(url, "/v2/emergency-revoke", { agent_id: "agent:uniform-01", revocation_secret: secret })).status, 200);
  } finally {
    proc.kill();
  }
});

test("re-registration needs every active key, even where VERIFIER_MODE allows classical-only", async () => {
  // classical_only accepts classical-only passports from new agents; it must not let one
  // stolen Ed25519 key re-register an agent that also holds a PQ key.
  const erin = await newAgent("agent:erin-0001");
  assert.equal((await registerNew(configured, erin.signedPassport)).status, 201);
  const planted = {
    ...erin.passport,
    created_at: later(erin.passport.created_at),
    emergency_revocation_token: `sha256:${sha256Hex(Buffer.from("11".repeat(32), "hex"))}`,
  };
  const classicalOnly = await signPassport(planted, { classical: erin.keys.classical });
  assert.equal((await postTo(configured, "/v2/passport/register", { signed_passport: classicalOnly })).status, 409);

  // Nor once its PQ key has expired: an agent that registered a PQ key needs an active one.
  const kilo = await newAgent("agent:kilo-0001");
  kilo.passport.keys[1].expires_at = "2020-01-01T00:00:00Z";
  const registered = await signPassport(kilo.passport, kilo.keys);
  assert.equal((await registerNew(configured, registered)).status, 201);
  const kiloPlanted = { ...planted, agent_id: "agent:kilo-0001", keys: [kilo.passport.keys[0]], created_at: later(kilo.passport.created_at) };
  const kiloClassicalOnly = await signPassport(kiloPlanted, { classical: kilo.keys.classical });
  assert.equal((await postTo(configured, "/v2/passport/register", { signed_passport: kiloClassicalOnly })).status, 409);
});

test("one key in both composite slots is not a hybrid signature", async () => {
  const dave = await newAgent("agent:dave-0001");
  assert.equal((await registerNew(base, dave.signedPassport)).status, 201);

  // Holding only dave's Ed25519 key must not be enough to replace his emergency token.
  const oneKey = { classical: dave.keys.classical, pq: dave.keys.classical };
  const renewed = { ...dave.passport, emergency_revocation_token: `sha256:${"1".repeat(64)}` };
  assert.equal((await post("/v2/passport/register", { signed_passport: await signPassport(renewed, oneKey) })).status, 403);
});

test("key rotation needs proof of possession by the new key and authorization by the old", async () => {
  const bob = await newAgent("agent:bob-0001");
  assert.equal((await registerNew(base, bob.signedPassport)).status, 201);

  const ed25519 = new Ed25519Provider();
  const next = await ed25519.generateKeypair();
  const stranger = await ed25519.generateKeypair();
  const params = {
    oldKid: bob.keys.classical.kid, oldAlg: "ed25519", oldSecretKeyB64: bob.keys.classical.secretKeyB64,
    newKid: next.kid, newAlg: "ed25519", newSecretKeyB64: next.secretKeyB64, newPublicKeyB64: next.publicKeyB64,
    timestamp: new Date().toISOString(), expiresAt: null,
  };
  const forgedPop = await createKeyRotation(registry, { ...params, newSecretKeyB64: stranger.secretKeyB64 });
  assert.equal((await post("/v2/keys/rotate", forgedPop)).status, 403);
  const unauthorized = await createKeyRotation(registry, { ...params, oldSecretKeyB64: stranger.secretKeyB64 });
  assert.equal((await post("/v2/keys/rotate", unauthorized)).status, 403);

  const rotation = await createKeyRotation(registry, params);
  assert.equal((await post("/v2/keys/rotate", rotation)).status, 200);
  assert.equal((await post("/v2/keys/rotate", rotation)).status, 403, "old key is retired");
});

test("rotation keeps at most four retired keys per agent", async () => {
  const lima = await newAgent("agent:lima-0001");
  assert.equal((await registerNew(base, lima.signedPassport)).status, 201);
  const registeredKeys = async () => (await (await fetch(`${base}/health`)).json()).registered_keys;
  const before = await registeredKeys();

  const ed25519 = new Ed25519Provider();
  let current = { kid: lima.keys.classical.kid, secretKeyB64: lima.keys.classical.secretKeyB64 };
  const retired = [];
  for (let i = 0; i < 6; i++) {
    const next = await ed25519.generateKeypair();
    const rotation = await createKeyRotation(registry, {
      oldKid: current.kid, oldAlg: "ed25519", oldSecretKeyB64: current.secretKeyB64,
      newKid: next.kid, newAlg: "ed25519", newSecretKeyB64: next.secretKeyB64, newPublicKeyB64: next.publicKeyB64,
      timestamp: new Date().toISOString(), expiresAt: null,
    });
    assert.equal((await post("/v2/keys/rotate", rotation)).status, 200);
    retired.push(current.kid);
    current = next;
  }

  // Six rotations retired six keys; the two oldest are dropped instead of filling the registry.
  assert.equal(await registeredKeys(), before + 4);
  assert.equal((await (await fetch(`${base}/v2/keys/${retired[5]}`)).json()).key.status, "revoked");
  // A dropped key still reads as revoked, and nobody can register it again as an active key.
  const dropped = await (await fetch(`${base}/v2/keys/${retired[0]}`)).json();
  assert.equal(dropped.revoked, true);
  assert.equal(dropped.agent_id, "agent:lima-0001");
  const reuse = await newAgent("agent:lima-reuse");
  reuse.passport.keys[0] = lima.passport.keys[0];
  const reused = await signPassport(reuse.passport, { classical: lima.keys.classical, pq: reuse.keys.pq });
  assert.equal((await registerNew(base, reused)).status, 409);
});

test("MAX_KEYS_PER_AGENT caps the keys an agent registers over its lifetime", async () => {
  const { base: own, proc } = await startService(SERVER, { OPERATOR_TOKEN, MAX_KEYS_PER_AGENT: "8" });
  try {
    const mike = await newAgent("agent:mike-life");
    assert.equal((await registerNew(own, mike.signedPassport)).status, 201);
    const rotate = ed25519Rotator(own, mike);
    // 2 registered keys + 6 rotations = 8 keys.
    for (let i = 0; i < 6; i++) assert.equal(await rotate(), 200, `rotation ${i + 1}`);
    assert.equal(await rotate(), 409);
  } finally {
    proc.kill();
  }
});

test("MAX_REGISTERED_KEYS caps the registry, and a rotation that retires a key still fits", async () => {
  const { base: small, proc } = await startService(SERVER, { OPERATOR_TOKEN, MAX_REGISTERED_KEYS: "6" });
  try {
    const victor = await newAgent("agent:victor-01");
    assert.equal((await registerNew(small, victor.signedPassport)).status, 201);
    const rotate = ed25519Rotator(small, victor);
    // 2 active + 4 retired keys fill the registry.
    for (let i = 0; i < 4; i++) assert.equal(await rotate(), 200, `rotation ${i + 1}`);
    assert.equal((await registerNew(small, (await newAgent("agent:whiskey-1")).signedPassport)).status, 507);
    // The next rotation drops victor's oldest retired key before the cap check.
    assert.equal(await rotate(), 200);
  } finally {
    proc.kill();
  }
});

test("new registrations are rate limited per client", async () => {
  const { base: limited, proc } = await startService(SERVER, { REGISTRATIONS_PER_HOUR: "2", OPERATOR_TOKEN });
  try {
    const statuses = [];
    for (const id of ["agent:mike-0001", "agent:mike-0002", "agent:mike-0003"]) {
      const { signedPassport } = await newAgent(id);
      statuses.push((await registerNew(limited, signedPassport)).status);
    }
    assert.deepEqual(statuses, [201, 201, 429]);
  } finally {
    proc.kill();
  }
});

test("only the operator can register a new agent_id on the gateway", async () => {
  // A passport is only self-signed: anyone could otherwise claim a victim's agent_id first.
  const sierra = await newAgent("agent:sierra-gw");
  assert.equal((await post("/v2/passport/register", { signed_passport: sierra.signedPassport })).status, 401);
  assert.equal((await post("/v2/passport/register", { signed_passport: sierra.signedPassport }, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await registerNew(base, sierra.signedPassport)).status, 201);
  const renewed = { ...sierra.passport, created_at: later(sierra.passport.created_at) };
  assert.equal((await post("/v2/passport/register", { signed_passport: await signPassport(renewed, sierra.keys) })).status, 201);
});

test("base64 keys must be canonical and the size of their algorithm", async () => {
  // Lenient decoders skip whitespace, so a padded key used to verify and be stored as sent.
  const tango = await newAgent("agent:tango-gw");
  const padded = structuredClone(tango.passport);
  padded.keys[1].public_key_b64 += " ".repeat(10_000);
  assert.equal((await registerNew(base, await signPassport(padded, tango.keys))).status, 400);

  assert.equal((await registerNew(base, tango.signedPassport)).status, 201);
  const next = await new MlDsa65Provider().generateKeypair();
  const rotation = await createKeyRotation(registry, {
    oldKid: tango.keys.pq.kid, oldAlg: "ml-dsa-65", oldSecretKeyB64: tango.keys.pq.secretKeyB64,
    newKid: next.kid, newAlg: "ml-dsa-65", newSecretKeyB64: next.secretKeyB64,
    newPublicKeyB64: next.publicKeyB64 + " ".repeat(10_000),
    timestamp: new Date().toISOString(), expiresAt: null,
  });
  assert.equal((await post("/v2/keys/rotate", rotation)).status, 400);
});

test("expired keys cannot re-register, extend their expiry or authorize a rotation", async () => {
  const carol = await newAgent("agent:carol-001");
  for (const key of carol.passport.keys) key.expires_at = "2020-01-01T00:00:00Z";
  assert.equal((await registerNew(base, await signPassport(carol.passport, carol.keys))).status, 201);

  const extended = structuredClone(carol.passport);
  extended.created_at = later(carol.passport.created_at);
  for (const key of extended.keys) key.expires_at = null;
  assert.equal((await post("/v2/passport/register", { signed_passport: await signPassport(extended, carol.keys) })).status, 409);
  assert.equal((await (await fetch(`${base}/v2/keys/${carol.keys.classical.kid}`)).json()).expired, true);

  const next = await new Ed25519Provider().generateKeypair();
  const rotation = await createKeyRotation(registry, {
    oldKid: carol.keys.classical.kid, oldAlg: "ed25519", oldSecretKeyB64: carol.keys.classical.secretKeyB64,
    newKid: next.kid, newAlg: "ed25519", newSecretKeyB64: next.secretKeyB64, newPublicKeyB64: next.publicKeyB64,
    timestamp: new Date().toISOString(), expiresAt: null,
  });
  assert.equal((await post("/v2/keys/rotate", rotation)).status, 403);
});

// ── Multi-party authorization: the mpa-v1 profile under the operator's configuration (spec/profiles/multi-party) ──

const MPA_TARGET = "agent:bob-0001";
const MPA_AUDIENCE = "verifier:reference-server";
const trustedParty = (human_id, { keys }) => ({
  human_id,
  keys: Object.values(keys).map((k) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, status: "active" })),
});
const mpaPolicy = (parties) => ({
  policy_set_version: "test-1",
  profile: "mpa-v1",
  audience: MPA_AUDIENCE,
  max_validity_seconds: 600,
  subjects: [{
    target: MPA_TARGET,
    parties,
    operations: { revoke_agent: { required_parties: 2, allowed_roles: ["owner", "org_admin"], required_roles: ["owner"] } },
  }],
});
const temporary = []; // directories this suite made, removed when it ends
after(() => temporary.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const writeJson = async (prefix, files) => {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return Object.fromEntries(Object.entries(files).map(([name, value]) => {
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return [name, file];
  }));
};
const capabilities = async (url) => (await (await fetch(`${url}/.well-known/dcp-capabilities.json`)).json()).features;
// The route is for the operator's executor: its token is checked when the server starts, by the rule of the demo
// gate (an RFC 6750 b64token of at least 32 characters), and on every request.
const MPA_OPERATOR_TOKEN = "multi-party-test-operator-token-0123456789"; // TEST ONLY
const asMpaOperator = { authorization: `Bearer ${MPA_OPERATOR_TOKEN}` };
/** The server must not start with `env`. If it does, it is stopped before the test fails. */
const refusesToStart = async (env, reason) => {
  let started;
  try {
    started = await startService(SERVER, env);
  } catch (e) {
    return assert.match(e.message, reason, JSON.stringify(env));
  }
  started.proc.kill();
  assert.fail(`the server started with ${JSON.stringify(env)}`);
};

test("multi-party authorization: without the operator's policy there is no endpoint", async () => {
  const anything = { authorization: {}, expected: { operation: "revoke_agent", target: MPA_TARGET, parameters: {} } };
  for (const headers of [{}, asOperator]) {
    const answer = await post("/v2/multi-party/authorize", anything, headers);
    assert.deepEqual([answer.status, answer.body], [404, { error: "Not found" }]);
  }
  assert.equal((await capabilities(base)).multi_party_auth, false);
});

test("multi-party authorization: the operator's parties, roles and threshold decide", async () => {
  const [owner, admin, contact, eve, frank] = await Promise.all(
    ["party:owner-01", "party:admin-01", "party:contact-01", "party:eve", "party:frank"].map((id) => newAgent(id)));
  const files = await writeJson("dcp-multi-party-", {
    trust: { trust_set_version: "test-1", principals: [trustedParty("human:owner", owner), trustedParty("human:admin", admin), trustedParty("human:contact", contact), trustedParty("human:eve", eve), trustedParty("human:frank", frank)] },
    policy: mpaPolicy([{ party_id: "human:owner", role: "owner" }, { party_id: "human:admin", role: "org_admin" }, { party_id: "human:contact", role: "recovery_contact" }]),
  });
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, REGISTRATIONS_PER_HOUR: "1000", DCP_TRUSTED_PRINCIPALS_FILE: files.trust, DCP_MULTI_PARTY_POLICY_FILE: files.policy });
  try {
    assert.equal((await capabilities(url)).multi_party_auth, true);

    const parameters = { reason: "key_compromise" };
    const expected = { operation: "revoke_agent", target: MPA_TARGET, parameters };
    const payload = createMultiPartyRequest({ target: MPA_TARGET, audience: MPA_AUDIENCE, parameters, validitySeconds: 300 });
    const by = ({ keys }, party_id, role, signed = payload) => createPartyAuthorization(registry, "revoke_agent", signed, party_id, role, keys);
    const submit = async (authorizations, { stated = expected, signed = payload, required = 2 } = {}) => {
      const answer = await postTo(url, "/v2/multi-party/authorize", { authorization: buildMultiPartyAuthorization("revoke_agent", signed, authorizations, required), expected: stated }, asMpaOperator);
      const codes = [...new Set((answer.body.errors ?? []).map((e) => e.code))].sort();
      return { status: answer.status, authorized: answer.body.authorized, required: answer.body.required_parties, counted: answer.body.parties_counted, codes, text: JSON.stringify(answer.body) };
    };
    const refused = (answer, ...codes) => {
      assert.deepEqual([answer.status, answer.authorized], [403, false], answer.text);
      for (const code of codes) assert.ok(answer.codes.includes(code), `${code} in ${answer.text}`);
    };
    const byOwner = await by(owner, "human:owner", "owner");
    const byAdmin = await by(admin, "human:admin", "org_admin");

    // A number a double does not hold is not a parameter of the profile. As JSON text, 2^53 + 1 reads here as 2^53:
    // stated, it is the caller's mistake, and in a record it decides nothing, whoever signed it.
    const raw = async (text) => {
      const res = await fetch(`${url}/v2/multi-party/authorize`, { method: "POST", headers: { "content-type": "application/json", ...asMpaOperator }, body: text });
      return { status: res.status, body: await res.json() };
    };
    const valid = JSON.stringify({ authorization: buildMultiPartyAuthorization("revoke_agent", payload, [byOwner, byAdmin]), expected });
    assert.deepEqual([(await raw(valid)).status, valid.split('"reason":"key_compromise"').length], [200, 3]);
    const inTheRecord = await raw(valid.replace('"reason":"key_compromise"', '"reason":9007199254740993'));
    assert.deepEqual([inTheRecord.status, inTheRecord.body.errors.map((e) => e.code)], [403, ["MPA_NOT_REPRESENTABLE"]]);
    const statedAt = valid.lastIndexOf('"reason":"key_compromise"');
    const stated = await raw(`${valid.slice(0, statedAt)}"reason":9007199254740993${valid.slice(statedAt + '"reason":"key_compromise"'.length)}`);
    assert.deepEqual([stated.status, stated.body.code], [400, "CONFIG_INVALID_VALUE"]);

    const ok = await submit([byOwner, byAdmin]);
    assert.deepEqual([ok.status, ok.authorized, ok.required, ok.counted, ok.codes], [200, true, 2, 2, []], ok.text);
    // The operator's threshold, whatever the record says of itself.
    const more = await submit([byOwner, byAdmin], { required: 5 });
    assert.deepEqual([more.status, more.authorized, more.required], [200, true, 2], more.text);
    // No key and no signature comes back.
    for (const secret of [owner.keys.classical.publicKeyB64, byOwner.composite_sig.classical.sig_b64]) assert.ok(!ok.text.includes(secret));

    // Two identities registered on this server, with valid hybrid signatures, who are not parties of the target.
    for (const party of [eve, frank]) assert.equal((await postTo(url, "/v2/passport/register", { signed_passport: party.signedPassport }, asMpaOperator)).status, 201);
    refused(await submit([await by(eve, "party:eve", "owner"), await by(frank, "party:frank", "org_admin")]), "MPA_PARTY_UNKNOWN");
    // The same two, named as the operator's trust set names them: known signers, still not parties.
    refused(await submit([await by(eve, "human:eve", "owner"), await by(frank, "human:frank", "org_admin")]), "MPA_PARTY_UNKNOWN");
    // A role is the operator's, not the signer's: the recovery contact signs as owner.
    refused(await submit([await by(contact, "human:contact", "owner"), byAdmin]), "MPA_ROLE_MISMATCH");
    // One party under two roles is one party.
    refused(await submit([byOwner, await by(owner, "human:owner", "org_admin")]), "MPA_PARTY_DUPLICATE");
    // One key in both slots is not a hybrid signature.
    refused(await submit([await by({ keys: { classical: owner.keys.classical, pq: owner.keys.classical } }, "human:owner", "owner"), byAdmin]), "MPA_HYBRID_REQUIRED");
    // A party's name over someone else's keys.
    refused(await submit([byOwner, await by(eve, "human:admin", "org_admin")]), "MPA_KEY_NOT_ANCHORED");
    // One party is not two.
    refused(await submit([byOwner]), "MPA_THRESHOLD_NOT_MET");
    // Signed for one target, stated for another; and signed for another target altogether.
    refused(await submit([byOwner, byAdmin], { stated: { ...expected, target: "agent:carol-0001" } }), "MPA_TARGET_MISMATCH");
    const elsewhere = createMultiPartyRequest({ target: "agent:carol-0001", audience: MPA_AUDIENCE, parameters, validitySeconds: 300 });
    refused(await submit([await by(owner, "human:owner", "owner", elsewhere), await by(admin, "human:admin", "org_admin", elsewhere)], { signed: elsewhere, stated: { ...expected, target: "agent:carol-0001" } }), "MPA_TARGET_UNKNOWN");
    // A record without the request block is a valid v2.0 record and authorizes nothing.
    const bare = { agent_id: MPA_TARGET };
    refused(await submit([await by(owner, "human:owner", "owner", bare), await by(admin, "human:admin", "org_admin", bare)], { signed: bare }), "MPA_REQUEST_MISSING");

    // What the caller is about to do is required: without it there is nothing to authorize.
    const record = buildMultiPartyAuthorization("revoke_agent", payload, [byOwner, byAdmin]);
    for (const body of [{ authorization: record }, { authorization: record, expected: { operation: "revoke_agent", target: MPA_TARGET } }, { authorization: record, expected: { ...expected, operation: "launch" } }]) {
      const answer = await postTo(url, "/v2/multi-party/authorize", body, asMpaOperator);
      assert.deepEqual([answer.status, answer.body.authorized, answer.body.code], [400, false, "CONFIG_INVALID_VALUE"], JSON.stringify(answer.body));
    }
    const nothing = await postTo(url, "/v2/multi-party/authorize", { expected }, asMpaOperator);
    assert.deepEqual([nothing.status, nothing.body.authorized, nothing.body.structure], [403, false, "invalid"]);

    // Without the operator's token nothing is evaluated and nothing of the operator's policy comes back: not for
    // the record that was just authorized, and not for a well-formed one that nobody signed, whose answer would
    // otherwise name the role the operator gives each party.
    const unsigned = { ...record, authorizations: record.authorizations.map((a) => ({ ...a, role: "recovery_contact" })) };
    for (const headers of [{}, asOperator, { authorization: MPA_OPERATOR_TOKEN }, { authorization: `Basic ${MPA_OPERATOR_TOKEN}` }]) {
      for (const authorization of [record, unsigned]) {
        const res = await fetch(`${url}/v2/multi-party/authorize`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ authorization, expected }) });
        assert.deepEqual(
          [res.status, res.headers.get("www-authenticate"), await res.json()],
          [401, "Bearer", { error: "Operator token required (Authorization: Bearer <OPERATOR_TOKEN>)" }],
          JSON.stringify(headers),
        );
      }
    }
  } finally {
    proc.kill();
  }
});

test("multi-party authorization: the server refuses to start with an unusable policy", async () => {
  const good = mpaPolicy([{ party_id: "human:owner", role: "owner" }, { party_id: "human:admin", role: "org_admin" }]);
  const files = await writeJson("dcp-multi-party-bad-", {
    trust: { trust_set_version: "v1", principals: [] },
    policy: good,
    notJson: "{",
    anotherProfile: { ...good, profile: "mpa-v2" },
    unknownField: { ...good, default_threshold: 1 },
    unsatisfiable: mpaPolicy([{ party_id: "human:owner", role: "owner" }]),
  });
  const usable = { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, DCP_TRUSTED_PRINCIPALS_FILE: files.trust };
  for (const env of [
    { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, DCP_MULTI_PARTY_POLICY_FILE: files.policy },
    { ...usable, DCP_MULTI_PARTY_POLICY_FILE: "" },
    { ...usable, DCP_MULTI_PARTY_POLICY_FILE: `${files.policy}.missing` },
    { ...usable, DCP_MULTI_PARTY_POLICY_FILE: files.notJson },
    { ...usable, DCP_MULTI_PARTY_POLICY_FILE: files.anotherProfile },
    { ...usable, DCP_MULTI_PARTY_POLICY_FILE: files.unknownField },
    { ...usable, DCP_MULTI_PARTY_POLICY_FILE: files.unsatisfiable },
  ]) {
    await refusesToStart(env, /exited/);
  }
  // A route nobody could call, or one a guessable token opens, is not started: the token is the demo gate's.
  for (const OPERATOR_TOKEN of [undefined, "", MPA_OPERATOR_TOKEN.slice(0, 31), `${MPA_OPERATOR_TOKEN.slice(0, 20)} ${MPA_OPERATOR_TOKEN.slice(20)}`]) {
    await refusesToStart({ ...usable, OPERATOR_TOKEN, DCP_MULTI_PARTY_POLICY_FILE: files.policy }, /DCP_MULTI_PARTY_POLICY_FILE needs OPERATOR_TOKEN/);
  }
  // The control: the same policy with its trust set and a usable token starts.
  const { proc } = await startService(SERVER, { ...usable, DCP_MULTI_PARTY_POLICY_FILE: files.policy });
  proc.kill();
});

test("multi-party authorization: admission and a long token do not make the endpoint", async () => {
  const files = await writeJson("dcp-multi-party-", { trust: { trust_set_version: "v1", principals: [] } });
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, DCP_TRUSTED_PRINCIPALS_FILE: files.trust });
  try {
    const anything = { authorization: {}, expected: { operation: "revoke_agent", target: MPA_TARGET, parameters: {} } };
    for (const headers of [{}, asMpaOperator]) {
      const answer = await postTo(url, "/v2/multi-party/authorize", anything, headers);
      assert.deepEqual([answer.status, answer.body], [404, { error: "Not found" }]);
    }
    assert.equal((await capabilities(url)).multi_party_auth, false);
  } finally {
    proc.kill();
  }
});

test("multi-party authorization: a request brings no threshold, policy set, trust set or clock of its own", async () => {
  const [owner, admin, contact, eve] = await Promise.all(
    ["party:owner-02", "party:admin-02", "party:contact-02", "party:eve-02"].map((id) => newAgent(id)));
  const parties = [{ party_id: "human:owner", role: "owner" }, { party_id: "human:admin", role: "org_admin" }, { party_id: "human:contact", role: "recovery_contact" }];
  const everyRole = ["owner", "org_admin", "recovery_contact"];
  const THREE = "agent:carol-0001"; // a target for which the operator asks for three parties
  const policy = mpaPolicy(parties);
  policy.subjects.push({ target: THREE, parties, operations: { revoke_agent: { required_parties: 3, allowed_roles: everyRole, required_roles: ["owner"] } } });
  const files = await writeJson("dcp-multi-party-", {
    trust: { trust_set_version: "trust-of-the-operator", principals: [trustedParty("human:owner", owner), trustedParty("human:admin", admin), trustedParty("human:contact", contact)] },
    policy,
  });
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, DCP_TRUSTED_PRINCIPALS_FILE: files.trust, DCP_MULTI_PARTY_POLICY_FILE: files.policy });
  try {
    const parameters = { reason: "key_compromise" };
    // One record per call. `signers` are [agent, party_id, role]; `extra` is whatever else the request carries.
    const ask = async (target, signers, { issuedAt = Date.now(), required = 2, extra = {} } = {}) => {
      const payload = createMultiPartyRequest({ target, audience: MPA_AUDIENCE, parameters, validitySeconds: 300, issuedAt });
      const authorizations = await Promise.all(signers.map(([{ keys }, party_id, role]) => createPartyAuthorization(registry, "revoke_agent", payload, party_id, role, keys)));
      const body = { authorization: buildMultiPartyAuthorization("revoke_agent", payload, authorizations, required), expected: { operation: "revoke_agent", target, parameters }, ...extra };
      const answer = await postTo(url, "/v2/multi-party/authorize", body, asMpaOperator);
      return {
        status: answer.status, authorized: answer.body.authorized, required: answer.body.required_parties, counted: answer.body.parties_counted,
        versions: [answer.body.policy_set_version, answer.body.trust_set_version],
        codes: [...new Set((answer.body.errors ?? []).map((e) => e.code))].sort(),
      };
    };
    const byOwner = [owner, "human:owner", "owner"];
    const byAdmin = [admin, "human:admin", "org_admin"];
    const byContact = [contact, "human:contact", "recovery_contact"];
    const operators = ["test-1", "trust-of-the-operator"];

    // The threshold is the operator's: two valid parties where it asks for three, in a record that says it needs two.
    assert.deepEqual(await ask(THREE, [byOwner, byAdmin, byContact], { required: 3 }), { status: 200, authorized: true, required: 3, counted: 3, versions: operators, codes: [] });
    assert.deepEqual(await ask(THREE, [byOwner, byAdmin], { required: 2 }), { status: 403, authorized: false, required: 3, counted: 2, versions: operators, codes: ["MPA_THRESHOLD_NOT_MET"] });

    // A policy set in the request is not the operator's: this one would let the two who signed authorize.
    const lenient = { ...policy, policy_set_version: "from-the-request", subjects: [{ target: MPA_TARGET, parties, operations: { revoke_agent: { required_parties: 2, allowed_roles: everyRole, required_roles: ["org_admin"] } } }] };
    const withoutOwner = await ask(MPA_TARGET, [byAdmin, byContact]);
    assert.deepEqual([withoutOwner.status, withoutOwner.codes, withoutOwner.versions], [403, ["MPA_ROLE_NOT_ALLOWED"], operators]);
    assert.deepEqual(await ask(MPA_TARGET, [byAdmin, byContact], { extra: { policy: lenient } }), withoutOwner);

    // Nor is a trust set: this one names the keys that signed as the owner's.
    const impostor = [eve, "human:owner", "owner"];
    const forged = await ask(MPA_TARGET, [impostor, byAdmin]);
    assert.deepEqual([forged.status, forged.codes, forged.versions], [403, ["MPA_KEY_NOT_ANCHORED"], operators]);
    const trustOfTheRequest = { trust_set_version: "from-the-request", principals: [trustedParty("human:owner", eve), trustedParty("human:admin", admin)] };
    assert.deepEqual(await ask(MPA_TARGET, [impostor, byAdmin], { extra: { trust: trustOfTheRequest } }), forged);

    // Nor a clock: an expired request stays expired, whatever time the request says it is.
    const issuedAt = Date.now() - 900_000;
    const expired = await ask(MPA_TARGET, [byOwner, byAdmin], { issuedAt });
    assert.deepEqual([expired.status, expired.codes], [403, ["MPA_EXPIRED"]]);
    assert.deepEqual(await ask(MPA_TARGET, [byOwner, byAdmin], { issuedAt, extra: { now: issuedAt + 1000 } }), expired);
  } finally {
    proc.kill();
  }
});

test("multi-party authorization: the whole token, and before the body is read", async () => {
  const http = await import("node:http");
  const files = await writeJson("dcp-multi-party-", {
    trust: { trust_set_version: "v1", principals: [] },
    policy: mpaPolicy([{ party_id: "human:owner", role: "owner" }, { party_id: "human:admin", role: "org_admin" }]),
  });
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, DCP_TRUSTED_PRINCIPALS_FILE: files.trust, DCP_MULTI_PARTY_POLICY_FILE: files.policy });
  // A client that would keep the connection open: what closes it is the server's own header.
  const agent = new http.Agent({ keepAlive: true });
  const send = (headers, body) => new Promise((resolve, reject) => {
    const req = http.request(`${url}/v2/multi-party/authorize`, { method: "POST", agent, headers: { "content-type": "application/json", ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve([res.statusCode, res.headers["www-authenticate"], res.headers.connection]));
    });
    req.on("error", reject);
    req.end(body);
  });
  try {
    // Without the token the body is not looked at: this is not the 400 of a body that is not JSON.
    for (const body of ["{", "", JSON.stringify({ authorization: {}, expected: {} })]) {
      assert.deepEqual(await send({}, body), [401, "Bearer", "close"], JSON.stringify(body));
    }
    // The control: with the token, that body is read and refused for what it is.
    assert.equal((await send(asMpaOperator, "{"))[0], 400);
    // A token that begins like the operator's, or differs from it in its length, its case or its last character.
    for (const token of [MPA_OPERATOR_TOKEN.slice(0, 8), MPA_OPERATOR_TOKEN.slice(0, -1), `${MPA_OPERATOR_TOKEN}0`, `${MPA_OPERATOR_TOKEN.slice(0, -1)}X`, MPA_OPERATOR_TOKEN.toUpperCase()]) {
      assert.equal((await send({ authorization: `Bearer ${token}` }, "{}"))[0], 401, token);
    }
  } finally {
    agent.destroy();
    proc.kill();
  }
});

test("multi-party authorization: the trust set is the file as it is now", async () => {
  const [owner, admin] = await Promise.all(["party:owner-03", "party:admin-03"].map((id) => newAgent(id)));
  const trustSet = (version, ownerStatus) => JSON.stringify({
    trust_set_version: version,
    principals: [
      { human_id: "human:owner", keys: trustedParty("human:owner", owner).keys.map((key) => ({ ...key, status: ownerStatus })) },
      trustedParty("human:admin", admin),
    ],
  });
  const files = await writeJson("dcp-multi-party-", {
    trust: trustSet("first", "active"),
    policy: mpaPolicy([{ party_id: "human:owner", role: "owner" }, { party_id: "human:admin", role: "org_admin" }]),
  });
  const { base: url, proc } = await startService(SERVER, { OPERATOR_TOKEN: MPA_OPERATOR_TOKEN, DCP_TRUSTED_PRINCIPALS_FILE: files.trust, DCP_MULTI_PARTY_POLICY_FILE: files.policy });
  try {
    const expected = { operation: "revoke_agent", target: MPA_TARGET, parameters: {} };
    const payload = createMultiPartyRequest({ target: MPA_TARGET, audience: MPA_AUDIENCE, validitySeconds: 300 });
    const authorization = buildMultiPartyAuthorization("revoke_agent", payload, [
      await createPartyAuthorization(registry, "revoke_agent", payload, "human:owner", "owner", owner.keys),
      await createPartyAuthorization(registry, "revoke_agent", payload, "human:admin", "org_admin", admin.keys),
    ]);
    // The same record every time: only the operator's file changes.
    const decide = async () => {
      const { status, body } = await postTo(url, "/v2/multi-party/authorize", { authorization, expected }, asMpaOperator);
      return [status, body.authorized, body.trust_set_version, [...new Set((body.errors ?? []).map((e) => e.code))].sort()];
    };
    assert.deepEqual(await decide(), [200, true, "first", []]);
    // The operator withdraws the owner's keys: the record stops counting, with no restart.
    fs.writeFileSync(files.trust, trustSet("second", "revoked"));
    assert.deepEqual(await decide(), [403, false, "second", ["MPA_KEY_REVOKED"]]);
    // A file that no longer loads decides nothing: not the last one that did.
    fs.writeFileSync(files.trust, "{");
    const broken = await postTo(url, "/v2/multi-party/authorize", { authorization, expected }, asMpaOperator);
    assert.deepEqual([broken.status, broken.body], [503, { authorized: false, error: "Trusted principals unavailable" }]);
    fs.writeFileSync(files.trust, trustSet("third", "active"));
    assert.deepEqual(await decide(), [200, true, "third", []]);
  } finally {
    proc.kill();
  }
});

test("VERIFIER_MODE and ALLOW_V1_BUNDLES are read from the environment", async () => {
  assert.equal((await postTo(classical, "/verify", { signed_bundle: v1Bundle() })).body.verified, true);

  const policy = await (await fetch(`${configured}/v2/policy`)).json();
  assert.equal(policy.mode, "classical_only");
  const v1 = await postTo(configured, "/verify", { signed_bundle: v1Bundle() });
  assert.equal(v1.body.verified, false);
  assert.match(v1.body.errors[0], /V1 bundles are disabled/);
});

test("rate limiting ignores a spoofed X-Forwarded-For", async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const body = { agent_id: "agent:nobody-01", revocation_secret: "0".repeat(64) };
    statuses.push((await postTo(configured, "/v2/emergency-revoke", body, { "x-forwarded-for": `203.0.113.${i}` })).status);
  }
  assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429]);
});

// ── POST /v2/admit: trusted principals and strict-v1 (spec/profiles/admission) ──

test("admission: off unless the operator configures it", async () => {
  const r = await post("/v2/admit", { signed_bundle: signedBundle });
  assert.equal(r.status, 501);
});

test("admission: strict-v1 against the operator's trust set, revocation list and audience", async () => {
  const { createServer } = await import("node:http");
  const os = await import("node:os");
  const path = await import("node:path");
  const VERIFIER = "verifier:reference-server";
  const fresh = (intendedVerifier = VERIFIER) =>
    buildV2Examples({ sessionExpiresAt: new Date(Date.now() + 240_000).toISOString(), intendedVerifier });
  const principal = await fresh();
  const stranger = await fresh();
  const elsewhere = await fresh("verifier:another-server");
  const trustSet = (version, rpr) => ({
    trust_set_version: version,
    principals: rpr ? [{ human_id: rpr.human_id, keys: rpr.binding_keys.map(({ kid, alg, public_key_b64 }) => ({ kid, alg, public_key_b64, status: "active" })) }] : [],
  });

  // The operator's deny list, which the test changes between requests.
  let denyList = () => ({ status: 200, body: { updated_at: new Date().toISOString(), revocations: [], kid_revocations: [] } });
  let seenAuthorization;
  const listServer = createServer((req, res) => {
    seenAuthorization = req.headers.authorization;
    const { status, body } = denyList();
    res.statusCode = status;
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => listServer.listen(0, "127.0.0.1", r));
  const listUrl = `http://127.0.0.1:${listServer.address().port}/.well-known/dcp-revocations.json`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-admission-"));
  temporary.push(dir);
  const trustFile = path.join(dir, "trust.json");
  const profileFile = path.join(dir, "profile.json");
  fs.writeFileSync(trustFile, JSON.stringify(trustSet("v1", principal.rpr)));
  fs.writeFileSync(profileFile, JSON.stringify({ profile: "strict-v1", verifier_id: VERIFIER }));
  const env = {
    DCP_TRUSTED_PRINCIPALS_FILE: trustFile,
    DCP_ADMISSION_PROFILE_FILE: profileFile,
    DCP_REVOCATION_LIST_URL: listUrl,
    DCP_REVOCATION_LIST_AUTHORIZATION: "Bearer list-reader",
  };
  const { base: strict, proc } = await startService(SERVER, env);
  const admit = (signed_bundle, extra = {}) => postTo(strict, "/v2/admit", { signed_bundle, ...extra });
  try {
    const ok = await admit(principal.signedBundle);
    assert.equal(ok.status, 200);
    assert.deepEqual(
      { admitted: ok.body.admitted, trust: ok.body.principal_trust, compliance: ok.body.profile_compliance, codes: ok.body.codes, authorized: ok.body.action_authorized },
      { admitted: true, trust: "trusted", compliance: "compliant", codes: [], authorized: false },
    );
    assert.equal(seenAuthorization, "Bearer list-reader");

    // buildV2Examples always names the same human_id: a self-consistent bundle that claims the
    // trusted principal with someone else's keys. The body cannot make those keys trusted.
    const impostor = await admit(stranger.signedBundle, { trusted_principals: trustSet("x", stranger.rpr), profile: null, verifier_id: "verifier:another-server" });
    assert.deepEqual([impostor.body.verified, impostor.body.admitted, impostor.body.codes], [true, false, ["TRUST_KEY_NOT_ANCHORED"]]);

    const audience = await admit(elsewhere.signedBundle);
    assert.equal(audience.body.admitted, false);
    assert.ok(audience.body.codes.includes("PROFILE_AUDIENCE_MISMATCH"));

    // The agent appears on the deny list; then the list cannot be read.
    denyList = () => ({ status: 200, body: { updated_at: new Date().toISOString(), revocations: [{ agent_id: principal.passport.agent_id }], kid_revocations: [] } });
    assert.deepEqual((await admit(principal.signedBundle)).body.codes, ["REVOCATION_REVOKED"]);
    denyList = () => ({ status: 500, body: {} });
    assert.deepEqual((await admit(principal.signedBundle)).body.codes, ["REVOCATION_UNAVAILABLE"]);
    denyList = () => ({ status: 200, body: { updated_at: new Date(Date.now() - 301_000).toISOString(), revocations: [], kid_revocations: [] } });
    assert.deepEqual((await admit(principal.signedBundle)).body.codes, ["REVOCATION_STALE"]);
    denyList = () => ({ status: 200, body: { updated_at: new Date().toISOString(), revocations: [], kid_revocations: [] } });

    // The operator removes the principal from the trust set: no restart needed, and a
    // replacement that keeps the file's mtime is not missed.
    const { atime, mtime } = fs.statSync(trustFile);
    fs.writeFileSync(trustFile, JSON.stringify(trustSet("v2", null)));
    fs.utimesSync(trustFile, atime, mtime);
    const removed = await admit(principal.signedBundle);
    assert.deepEqual([removed.body.admitted, removed.body.trust_set_version, removed.body.codes], [false, "v2", ["TRUST_PRINCIPAL_UNKNOWN"]]);

    // A trust set that no longer loads refuses admission.
    fs.writeFileSync(trustFile, "{");
    assert.equal((await admit(principal.signedBundle)).status, 503);
  } finally {
    proc.kill();
    listServer.close();
  }
});

test("admission: the server refuses to start with a contradictory or invalid configuration", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-admission-bad-"));
  temporary.push(dir);
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const profile = write("profile.json", { profile: "strict-v1", verifier_id: "verifier:x" });
  const weak = write("weak.json", { profile: "strict-v1", verifier_id: "verifier:x", verifier_policy: { allow_v1_bundles: true } });
  const trust = write("trust.json", { trust_set_version: "v1", principals: [] });
  const fakeKid = write("fake.json", { trust_set_version: "v1", principals: [{ human_id: "human:x", keys: [{ kid: "0".repeat(32), alg: "ed25519", public_key_b64: Buffer.alloc(32, 1).toString("base64"), status: "active" }] }] });
  const url = "http://127.0.0.1:9/list.json";
  for (const env of [
    { DCP_ADMISSION_PROFILE_FILE: profile, DCP_REVOCATION_LIST_URL: url },
    { DCP_ADMISSION_PROFILE_FILE: profile, DCP_TRUSTED_PRINCIPALS_FILE: trust },
    { DCP_ADMISSION_PROFILE_FILE: weak, DCP_TRUSTED_PRINCIPALS_FILE: trust, DCP_REVOCATION_LIST_URL: url },
    { DCP_TRUSTED_PRINCIPALS_FILE: fakeKid },
    { DCP_TRUSTED_PRINCIPALS_FILE: trust, DCP_REVOCATION_LIST_URL: url },
    { DCP_ADMISSION_PROFILE_FILE: profile, DCP_TRUSTED_PRINCIPALS_FILE: trust, DCP_REVOCATION_LIST_URL: "http://revocation.example.com/list.json" },
    { DCP_ADMISSION_PROFILE_FILE: "", DCP_TRUSTED_PRINCIPALS_FILE: trust },
    { DCP_TRUSTED_PRINCIPALS_FILE: trust, DCP_REVOCATION_LIST_AUTHORIZATION: "Bearer x" },
  ]) {
    await assert.rejects(startService(SERVER, env), /exited/, JSON.stringify(Object.keys(env)));
  }
});

test("capabilities do not advertise an HSM provider", async () => {
  const res = await fetch(`${base}/.well-known/dcp-capabilities.json`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).features.hsm_provider, false);
});
