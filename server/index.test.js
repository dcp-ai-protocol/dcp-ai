import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, createKeyRotation } from "@dcp-ai/sdk";
import { buildV2Examples } from "../scripts/generate-v2-examples.js";
import { computeSecurityTier } from "../lib/security-tier.js";
import { later, newAgent, post as postTo, registry, sha256Hex, sign, signPassport, startService } from "../tests/helpers.js";

const SERVER = fileURLToPath(new URL("./index.js", import.meta.url));
const OPERATOR_TOKEN = "test-operator-token";
const asOperator = { authorization: `Bearer ${OPERATOR_TOKEN}` };
let base; // default policy, operator token set
let configured; // VERIFIER_MODE=classical_only ALLOW_V1_BUNDLES=false
let procs;
let signedBundle;

before(async () => {
  ({ signedBundle } = await buildV2Examples());
  const services = await Promise.all([
    startService(SERVER, { OPERATOR_TOKEN, REGISTRATIONS_PER_HOUR: "1000" }),
    startService(SERVER, { VERIFIER_MODE: "classical_only", ALLOW_V1_BUNDLES: "false", REGISTRATIONS_PER_HOUR: "1000", OPERATOR_TOKEN }),
  ]);
  [base, configured] = services.map((s) => s.base);
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

  // Alice herself can replace the token: her current keys sign a newer passport.
  const secret = crypto.randomBytes(32).toString("hex");
  const renewed = {
    ...alice.passport,
    created_at: later(alice.passport.created_at),
    emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(secret, "hex"))}`,
  };
  assert.equal((await post("/v2/passport/register", { signed_passport: await signPassport(renewed, alice.keys) })).status, 201);

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

test("multi-party authorization verifies each party's registered composite signature", async () => {
  const owner = await newAgent("party:owner-01");
  const admin = await newAgent("party:admin-01");
  const outsider = await newAgent("party:outsider");
  for (const party of [owner, admin]) {
    assert.equal((await registerNew(base, party.signedPassport)).status, 201);
  }

  const operation_payload = { agent_id: "agent:bob-0001" };
  const authorize = async ({ keys }, party_id, role) => ({
    party_id,
    role,
    composite_sig: await sign(DCP_CONTEXTS.MultiPartyAuth, { operation: "revoke_agent", operation_payload, party_id, role }, keys),
  });
  const submit = async (...authorizations) => (await post("/v2/multi-party/authorize", {
    authorization: { type: "multi_party_authorization", operation: "revoke_agent", operation_payload, required_parties: 2, authorizations },
  })).status;

  assert.equal(await submit(await authorize(owner, "party:owner-01", "owner"), await authorize(admin, "party:admin-01", "org_admin")), 200);
  // One party signing under two roles is still one party.
  assert.equal(await submit(await authorize(owner, "party:owner-01", "owner"), await authorize(owner, "party:owner-01", "org_admin")), 403);
  // A party signing with one key in both slots is not a hybrid signature.
  const ownerOneKey = { keys: { classical: owner.keys.classical, pq: owner.keys.classical } };
  assert.equal(await submit(await authorize(ownerOneKey, "party:owner-01", "owner"), await authorize(admin, "party:admin-01", "org_admin")), 403);
  // Claiming a registered party_id with other keys fails.
  assert.equal(await submit(await authorize(owner, "party:owner-01", "owner"), await authorize(outsider, "party:admin-01", "org_admin")), 403);
});

test("VERIFIER_MODE and ALLOW_V1_BUNDLES are read from the environment", async () => {
  assert.equal((await post("/verify", { signed_bundle: v1Bundle() })).body.verified, true);

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

    // The operator removes the principal from the trust set: no restart needed.
    fs.writeFileSync(trustFile, JSON.stringify(trustSet("v2", null)));
    fs.utimesSync(trustFile, new Date(), new Date(Date.now() + 5_000));
    const removed = await admit(principal.signedBundle);
    assert.deepEqual([removed.body.admitted, removed.body.trust_set_version, removed.body.codes], [false, "v2", ["TRUST_PRINCIPAL_UNKNOWN"]]);

    // A trust set that no longer loads refuses admission.
    fs.writeFileSync(trustFile, "{");
    fs.utimesSync(trustFile, new Date(), new Date(Date.now() + 10_000));
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
  ]) {
    await assert.rejects(startService(SERVER, env), /exited/, JSON.stringify(Object.keys(env)));
  }
});
