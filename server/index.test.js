import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DCP_CONTEXTS, Ed25519Provider, createKeyRotation } from "@dcp-ai/sdk";
import { buildV2Examples } from "../scripts/generate-v2-examples.js";
import { newAgent, post as postTo, registry, sha256Hex, sign, signPassport, startService } from "../tests/helpers.js";

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
    startService(SERVER, { OPERATOR_TOKEN }),
    startService(SERVER, { VERIFIER_MODE: "classical_only", ALLOW_V1_BUNDLES: "false" }),
  ]);
  [base, configured] = services.map((s) => s.base);
  procs = services.map((s) => s.proc);
});

after(() => procs.forEach((p) => p.kill()));

const post = (path, body, headers) => postTo(base, path, body, headers);
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

test("V1 bundle on the V2 endpoint is a 400, not a 500", async () => {
  assert.equal((await post("/v2/bundle/verify", { signed_bundle: v1Bundle() })).status, 400);
});

test("admin endpoints require the operator token", async () => {
  for (const path of ["/v2/policy/mode", "/v2/governance/register", "/v2/advisory/publish", "/v2/advisory/auto-apply"]) {
    assert.equal((await post(path, { mode: "classical_only" })).status, 401, path);
    assert.equal((await post(path, { mode: "classical_only" }, { authorization: "Bearer wrong" })).status, 401, path);
  }
  assert.equal((await post("/v2/policy/mode", { mode: "hybrid_required" }, asOperator)).status, 200);
  const unsigned = { type: "algorithm_advisory", advisory_id: "DCP-ADV-0001", affected_algorithms: ["ed25519"], action: "revoke" };
  assert.equal((await post("/v2/advisory/publish", { advisory: unsigned }, asOperator)).status, 400);
});

test("passport registration checks the self-signature and blocks agent hijacking", async () => {
  const alice = await newAgent("agent:alice-001");
  assert.equal((await post("/v2/passport/register", { signed_passport: alice.signedPassport })).status, 201);

  const tampered = structuredClone(alice.signedPassport);
  tampered.payload.capabilities = ["browse", "payments"];
  assert.equal((await post("/v2/passport/register", { signed_passport: tampered })).status, 403);

  // Mallory re-registers alice's agent_id with her own keys to plant her token.
  const mallory = await newAgent("agent:alice-001");
  assert.equal((await post("/v2/passport/register", { signed_passport: mallory.signedPassport })).status, 409);
  const revoke = { agent_id: "agent:alice-001", revocation_secret: mallory.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", revoke)).status, 403);

  // Alice herself can replace the token: her current keys sign the new passport.
  const secret = crypto.randomBytes(32).toString("hex");
  const renewed = { ...alice.passport, emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(secret, "hex"))}` };
  assert.equal((await post("/v2/passport/register", { signed_passport: await signPassport(renewed, alice.keys) })).status, 201);

  // Listing alice's public key in another passport proves nothing: only signer keys register.
  const squatter = await newAgent("agent:squatter");
  squatter.passport.keys.push(alice.passport.keys[0]);
  const squat = await post("/v2/passport/register", { signed_passport: await signPassport(squatter.passport, squatter.keys) });
  assert.equal(squat.status, 201);
  assert.deepEqual(squat.body.registered_kids, [squatter.keys.classical.kid, squatter.keys.pq.kid]);
  const owner = await (await fetch(`${base}/v2/keys/${alice.keys.classical.kid}`)).json();
  assert.equal(owner.agent_id, "agent:alice-001");
});

test("key rotation needs proof of possession by the new key and authorization by the old", async () => {
  const bob = await newAgent("agent:bob-0001");
  assert.equal((await post("/v2/passport/register", { signed_passport: bob.signedPassport })).status, 201);

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

test("multi-party authorization verifies each party's registered composite signature", async () => {
  const owner = await newAgent("party:owner-01");
  const admin = await newAgent("party:admin-01");
  const outsider = await newAgent("party:outsider");
  for (const party of [owner, admin]) {
    assert.equal((await post("/v2/passport/register", { signed_passport: party.signedPassport })).status, 201);
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
