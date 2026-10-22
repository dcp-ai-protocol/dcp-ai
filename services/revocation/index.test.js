import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { DCP_CONTEXTS } from "@dcp-ai/sdk";
import crypto from "node:crypto";
import { later, newAgent, post as postTo, sha256Hex, sign, signPassport, startService } from "../../tests/helpers.js";
import { signObject } from "../../tools/crypto.js";

let base;
let proc;

before(async () => {
  ({ base, proc } = await startService(fileURLToPath(new URL("./index.js", import.meta.url))));
});

after(() => proc.kill());

const post = (path, body) => postTo(base, path, body);
const get = (path) => fetch(base + path);
const register = (agent) => post("/v2/register", { signed_passport: agent.signedPassport });
const checkKid = async (kid) => (await get(`/v2/check/kid/${kid}`)).json();

test("emergency revocation covers the agent's registered kids, and only those", async () => {
  const alpha = await newAgent("agent:alpha-001");
  const bravo = await newAgent("agent:bravo-001");
  for (const agent of [alpha, bravo]) assert.equal((await register(agent)).status, 201);

  const revoke = { agent_id: "agent:alpha-001", revocation_secret: alpha.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", revoke)).body.ok, true);

  const own = await checkKid(alpha.keys.pq.kid);
  assert.equal(own.revoked, true);
  assert.equal(own.agent_id, "agent:alpha-001");
  assert.equal((await checkKid(bravo.keys.classical.kid)).revoked, false);
});

test("registration is proven by the passport signature and cannot be hijacked", async () => {
  const charlie = await newAgent("agent:charlie-1");
  const tampered = structuredClone(charlie.signedPassport);
  tampered.payload.emergency_revocation_token = `sha256:${"0".repeat(64)}`;
  assert.equal((await post("/v2/register", { signed_passport: tampered })).status, 403);
  assert.equal((await register(charlie)).status, 201);

  // Mallory registers charlie's agent_id with her own keys to plant her token.
  const mallory = await newAgent("agent:charlie-1");
  assert.equal((await register(mallory)).status, 409);
  const revoke = { agent_id: "agent:charlie-1", revocation_secret: mallory.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", revoke)).status, 403);
  const unsigned = { agent_id: "agent:charlie-1", emergency_revocation_token: `sha256:${"0".repeat(64)}` };
  assert.equal((await post("/v2/register-emergency-token", unsigned)).status, 404);

  // Charlie's Ed25519 key alone, used in both composite slots, cannot replace the token.
  const oneKey = { classical: charlie.keys.classical, pq: charlie.keys.classical };
  const planted = { ...charlie.passport, emergency_revocation_token: `sha256:${"1".repeat(64)}` };
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(planted, oneKey) })).status, 403);

  // Charlie's own keys can replace the token with a newer passport.
  const secret = crypto.randomBytes(32).toString("hex");
  const renewed = {
    ...charlie.passport,
    created_at: later(charlie.passport.created_at),
    emergency_revocation_token: `sha256:${sha256Hex(Buffer.from(secret, "hex"))}`,
  };
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(renewed, charlie.keys) })).status, 201);

  // Signed passports are public: replaying the old one must not bring the old token back.
  assert.equal((await register(charlie)).status, 409);
  const oldToken = { agent_id: "agent:charlie-1", revocation_secret: charlie.revocationSecret };
  assert.equal((await post("/v2/emergency-revoke", oldToken)).status, 403);

  // A newer passport without a token keeps the registered one.
  const noToken = { ...renewed, created_at: later(renewed.created_at) };
  delete noToken.emergency_revocation_token;
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(noToken, charlie.keys) })).status, 201);
  assert.equal((await post("/v2/emergency-revoke", { agent_id: "agent:charlie-1", revocation_secret: secret })).status, 200);
});

test("revocations must be signed by the agent's registered keys", async () => {
  const delta = await newAgent("agent:delta-001");
  const echo = await newAgent("agent:echo-0001");
  for (const agent of [delta, echo]) assert.equal((await register(agent)).status, 201);

  const record = {
    dcp_version: "2.0", agent_id: "agent:delta-001", human_id: "human:test-owner",
    revoked_kid: delta.keys.pq.kid, timestamp: new Date().toISOString(), reason: "key_compromise",
  };
  const signedBy = async (rec, keys) => ({ ...rec, composite_sig: await sign(DCP_CONTEXTS.Revocation, rec, keys) });
  assert.equal((await post("/v2/revoke", await signedBy(record, echo.keys))).status, 403);
  const foreignKid = { ...record, agent_id: "agent:echo-0001" };
  assert.equal((await post("/v2/revoke", await signedBy(foreignKid, echo.keys))).status, 403);
  const oneKey = { classical: delta.keys.classical, pq: delta.keys.classical };
  assert.equal((await post("/v2/revoke", await signedBy(record, oneKey))).status, 403);
  assert.equal((await checkKid(delta.keys.pq.kid)).revoked, false);
  assert.equal((await post("/v2/revoke", await signedBy(record, delta.keys))).status, 201);
  assert.equal((await checkKid(delta.keys.pq.kid)).revoked, true);

  const v1 = {
    dcp_version: "1.0", agent_id: "agent:echo-0001", human_id: "human:test-owner",
    timestamp: new Date().toISOString(), reason: "retired",
  };
  assert.equal((await post("/revoke", { ...v1, signature: signObject(v1, delta.keys.classical.secretKeyB64) })).status, 403);
  assert.equal((await post("/revoke", { ...v1, signature: signObject(v1, echo.keys.classical.secretKeyB64) })).status, 201);
});

test("key expiry comes from the signed passport, not an unauthenticated call", async () => {
  const foxtrot = await newAgent("agent:foxtrot-1");
  foxtrot.passport.keys[1].expires_at = "2020-01-01T00:00:00Z";
  const signed = await signPassport(foxtrot.passport, foxtrot.keys);
  assert.equal((await post("/v2/register", { signed_passport: signed })).status, 201);
  assert.equal((await checkKid(foxtrot.keys.pq.kid)).reason, "expired");

  // An expired key cannot sign a passport that extends its own expiry.
  const extended = structuredClone(foxtrot.passport);
  extended.created_at = later(foxtrot.passport.created_at);
  extended.keys[1].expires_at = null;
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(extended, foxtrot.keys) })).status, 409);
  assert.equal((await checkKid(foxtrot.keys.pq.kid)).reason, "expired");

  const unsigned = { kid: foxtrot.keys.classical.kid, expires_at: "2020-01-01T00:00:00Z" };
  assert.equal((await post("/v2/register-key-expiry", unsigned)).status, 404);
  assert.equal((await checkKid(foxtrot.keys.classical.kid)).revoked, false);
});

test("a newer passport signed by all active keys renews expired keys", async () => {
  // hotel's PQ key has expired; its active Ed25519 key and a new PQ key sign a newer passport.
  const hotel = await newAgent("agent:hotel-001");
  hotel.passport.keys[1].expires_at = "2020-01-01T00:00:00Z";
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(hotel.passport, hotel.keys) })).status, 201);

  const fresh = await newAgent("agent:hotel-001");
  const keys = { classical: hotel.keys.classical, pq: fresh.keys.pq };
  const renewal = { ...hotel.passport, created_at: later(hotel.passport.created_at), keys: [hotel.passport.keys[0], fresh.passport.keys[1]] };
  const renewed = await post("/v2/register", { signed_passport: await signPassport(renewal, keys) });
  assert.equal(renewed.status, 201);
  assert.deepEqual(renewed.body.registered_kids, [hotel.keys.classical.kid, fresh.keys.pq.kid]);
  assert.equal((await checkKid(hotel.keys.pq.kid)).reason, "expired");

  // The new kid is the agent's now: it can be revoked by kid.
  const record = {
    dcp_version: "2.0", agent_id: "agent:hotel-001", human_id: "human:test-owner",
    revoked_kid: fresh.keys.pq.kid, timestamp: new Date().toISOString(), reason: "key_rotation",
  };
  const composite_sig = await sign(DCP_CONTEXTS.Revocation, record, keys);
  assert.equal((await post("/v2/revoke", { ...record, composite_sig })).status, 201);
  assert.equal((await checkKid(fresh.keys.pq.kid)).revoked, true);

  // With no active key left, nobody can re-register the agent.
  const india = await newAgent("agent:india-001");
  for (const key of india.passport.keys) key.expires_at = "2020-01-01T00:00:00Z";
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(india.passport, india.keys) })).status, 201);
  const takeover = await newAgent("agent:india-001");
  takeover.passport.created_at = later(india.passport.created_at);
  assert.equal((await post("/v2/register", { signed_passport: await signPassport(takeover.passport, takeover.keys) })).status, 409);
});

test("malformed percent-encoding returns 400 instead of crashing the service", async () => {
  assert.equal((await get("/v2/check/kid/%E0")).status, 400);
  assert.equal((await get("/check/%E0")).status, 400);
  assert.equal((await get("/health")).status, 200);
});
