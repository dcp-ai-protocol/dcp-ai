/**
 * DCP-AI + OpenAI Function Calling Template
 *
 * Shows how OpenAI function calls integrate with DCP v2.0.
 * DCP tools are registered as OpenAI functions — each invocation
 * creates an Intent, gets a PolicyDecision, and logs an AuditEntry.
 */

import crypto from "node:crypto";
import OpenAI from "openai";

// ─── DCP Session Bootstrap ──────────────────────────────────────────────────
//
// Every DCP session starts with a 256-bit nonce, identity keys, and
// the ResponsiblePrincipalRecord + AgentPassport pair.

const sessionNonce = crypto.randomBytes(32).toString("hex");
const now = new Date().toISOString();
const humanId = `rpr:${crypto.randomUUID()}`;
const agentId = `agent:${crypto.randomUUID()}`;

const classicalKid = crypto.randomBytes(16).toString("hex");
const pqKid = crypto.randomBytes(16).toString("hex");

const keyEntries = [
  { kid: classicalKid, alg: "ed25519", public_key_b64: "«generated»", created_at: now, expires_at: null, status: "active" },
  { kid: pqKid, alg: "ml-dsa-65", public_key_b64: "«generated»", created_at: now, expires_at: null, status: "active" },
];

const responsiblePrincipalRecord = {
  dcp_version: "2.0",
  human_id: humanId,
  session_nonce: sessionNonce,
  legal_name: "Ada Lovelace",
  entity_type: "natural_person",
  jurisdiction: "US",
  liability_mode: "owner_responsible",
  override_rights: true,
  issued_at: now,
  expires_at: null,
  contact: "ada@example.com",
  binding_keys: keyEntries,
};

const agentPassport = {
  dcp_version: "2.0",
  agent_id: agentId,
  session_nonce: sessionNonce,
  keys: keyEntries,
  principal_binding_reference: humanId,
  capabilities: ["browse", "api_call", "send_email"],
  risk_tier: "medium",
  created_at: now,
  status: "active",
};

console.log("🔑 DCP identity created");
console.log(`   Agent: ${agentId}`);
console.log(`   Owner: Ada Lovelace (US)\n`);

// ─── DCP-Aware Audit State ──────────────────────────────────────────────────

const auditTrail = [];
const intents = [];
const policyDecisions = [];

function canonicalize(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const sorted = Object.keys(obj).sort();
  return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function hashPayload(obj) {
  const data = typeof obj === "string" ? obj : canonicalize(obj);
  return `sha256:${crypto.createHash("sha256").update(data).digest("hex")}`;
}

// ─── DCP Tool Wrappers ──────────────────────────────────────────────────────
//
// Each tool follows the DCP lifecycle:
//   1. Declare Intent (what the agent wants to do)
//   2. Get PolicyDecision (approve / escalate / block)
//   3. Execute the action
//   4. Log AuditEntry (immutable record of what happened)

function declareIntent(actionType, channel, domain, dataClasses = ["none"]) {
  const intent = {
    dcp_version: "2.0",
    intent_id: `intent:${crypto.randomUUID()}`,
    session_nonce: sessionNonce,
    agent_id: agentId,
    human_id: humanId,
    timestamp: new Date().toISOString(),
    action_type: actionType,
    target: { channel, domain },
    data_classes: dataClasses,
    estimated_impact: "low",
    requires_consent: false,
  };
  intents.push(intent);
  return intent;
}

function evaluatePolicy(intent) {
  const decision = {
    dcp_version: "2.0",
    intent_id: intent.intent_id,
    session_nonce: sessionNonce,
    decision: "approve",
    risk_score: 120,
    reasons: [`Action '${intent.action_type}' on ${intent.target.domain} within capabilities`],
    required_confirmation: null,
    applied_policy_hash: hashPayload({ name: "default-openai-policy-v2" }),
    timestamp: new Date().toISOString(),
  };
  policyDecisions.push(decision);
  return decision;
}

function logAudit(intent, policy, outcome, tool) {
  const prevHash = auditTrail.length > 0
    ? hashPayload(auditTrail[auditTrail.length - 1])
    : "sha256:" + "0".repeat(64);

  const entry = {
    dcp_version: "2.0",
    audit_id: `audit:${crypto.randomUUID()}`,
    session_nonce: sessionNonce,
    prev_hash: prevHash,
    hash_alg: "sha256",
    timestamp: new Date().toISOString(),
    agent_id: agentId,
    human_id: humanId,
    intent_id: intent.intent_id,
    intent_hash: hashPayload(intent),
    policy_decision: "approved",
    outcome,
    evidence: { tool, result_ref: outcome.slice(0, 80), evidence_hash: hashPayload(outcome) },
    pq_checkpoint_ref: null,
  };
  auditTrail.push(entry);
  return entry;
}

// ─── Tool Implementations ───────────────────────────────────────────────────

function lookupWeather(location) {
  const intent = declareIntent("api_call", "api", "weather.example.com");
  const policy = evaluatePolicy(intent);

  if (policy.decision !== "approve") return JSON.stringify({ error: "blocked by policy" });

  const result = { location, temperature: "22°C", condition: "Sunny", humidity: "45%" };
  logAudit(intent, policy, `Weather lookup: ${location}`, "openai.function.lookup_weather");
  return JSON.stringify(result);
}

function sendEmail(to, subject, body) {
  const intent = declareIntent("send_email", "email", "smtp.example.com", ["contact_info"]);
  const policy = evaluatePolicy(intent);

  if (policy.decision !== "approve") return JSON.stringify({ error: "blocked by policy" });

  const result = { sent: true, to, subject, message_id: `msg:${crypto.randomUUID()}` };
  logAudit(intent, policy, `Email sent to ${to}: "${subject}"`, "openai.function.send_email");
  return JSON.stringify(result);
}

function searchWeb(query) {
  const intent = declareIntent("browse", "web", "search.example.com");
  const policy = evaluatePolicy(intent);

  if (policy.decision !== "approve") return JSON.stringify({ error: "blocked by policy" });

  const result = { query, results: [{ title: "DCP Protocol", url: "https://dcp-ai.org", snippet: "The Digital Citizenship Protocol for AI agents." }] };
  logAudit(intent, policy, `Web search: "${query}"`, "openai.function.search_web");
  return JSON.stringify(result);
}

const toolImplementations = { lookup_weather: lookupWeather, send_email: sendEmail, search_web: searchWeb };

// ─── OpenAI Function Definitions ────────────────────────────────────────────
//
// These functions are registered with OpenAI. The model decides which to call.

const tools = [
  {
    type: "function",
    function: {
      name: "lookup_weather",
      description: "Get current weather for a location. DCP: creates Intent for api_call.",
      parameters: { type: "object", properties: { location: { type: "string", description: "City name" } }, required: ["location"] },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email. DCP: creates Intent for send_email with contact_info data class.",
      parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web. DCP: creates Intent for browse action.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
];

// ─── Conversation Loop ──────────────────────────────────────────────────────

async function runConversation() {
  console.log("💬 Starting OpenAI conversation with DCP function calling…\n");

  const messages = [
    { role: "system", content: "You are an assistant with DCP digital citizenship. Use your tools to help the user." },
    { role: "user", content: "What's the weather in San Francisco? Then search for the DCP protocol." },
  ];

  let response;

  try {
    const client = new OpenAI();
    response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
    });
  } catch {
    console.log("   (No OPENAI_API_KEY — simulating function calls)\n");

    // Simulate the tool calls the model would make
    const weatherResult = lookupWeather("San Francisco");
    console.log(`   🌤️  Weather: ${weatherResult}`);

    const searchResult = searchWeb("DCP protocol");
    console.log(`   🔍 Search: ${searchResult}\n`);

    buildAndSignBundle();
    return;
  }

  // Process tool calls from the model
  const choice = response.choices[0];

  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      const fn = toolCall.function;
      const args = JSON.parse(fn.arguments);
      const impl = toolImplementations[fn.name];

      if (!impl) {
        console.log(`   ⚠️ Unknown function: ${fn.name}`);
        continue;
      }

      console.log(`   🔧 Function call: ${fn.name}(${JSON.stringify(args)})`);
      const result = impl(...Object.values(args));
      console.log(`   📋 Result: ${result}\n`);

      messages.push(choice.message);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
    }

    // Get final response with tool results
    const finalResponse = await new OpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });
    console.log(`   🤖 ${finalResponse.choices[0].message.content}\n`);
  }

  buildAndSignBundle();
}

// ─── Build and Sign CitizenshipBundle ───────────────────────────────────────

function buildAndSignBundle() {
  const compositeSig = {
    classical: { alg: "ed25519", kid: classicalKid, sig_b64: "«sig»" },
    pq: { alg: "ml-dsa-65", kid: pqKid, sig_b64: "«sig»" },
    binding: "pq_over_classical",
  };

  const lastIntent = intents[intents.length - 1] || {};
  const lastPolicy = policyDecisions[policyDecisions.length - 1] || {};

  const manifest = {
    session_nonce: sessionNonce,
    rpr_hash: hashPayload(responsiblePrincipalRecord),
    passport_hash: hashPayload(agentPassport),
    intent_hash: hashPayload(lastIntent),
    policy_hash: hashPayload(lastPolicy),
    audit_merkle_root: hashPayload(auditTrail.map((e) => hashPayload(e))),
    audit_count: auditTrail.length,
  };

  const signedBundle = {
    bundle: {
      dcp_bundle_version: "2.0",
      manifest,
      responsible_principal_record: { payload: responsiblePrincipalRecord, payload_hash: manifest.rpr_hash, composite_sig: compositeSig },
      agent_passport: { payload: agentPassport, payload_hash: manifest.passport_hash, composite_sig: compositeSig },
      intent: { payload: lastIntent, payload_hash: manifest.intent_hash, composite_sig: compositeSig },
      policy_decision: { payload: lastPolicy, payload_hash: manifest.policy_hash, composite_sig: compositeSig },
      audit_entries: auditTrail,
    },
    signature: {
      hash_alg: "sha256",
      created_at: new Date().toISOString(),
      signer: { type: "human", id: humanId, kids: [classicalKid, pqKid] },
      manifest_hash: hashPayload(manifest),
      composite_sig: compositeSig,
    },
  };

  console.log("🏛️  Citizenship Bundle signed");
  console.log(`   Bundle version: ${signedBundle.bundle.dcp_bundle_version}`);
  console.log(`   Total intents:  ${intents.length}`);
  console.log(`   Audit entries:  ${auditTrail.length}`);
  console.log(`   Binding:        ${compositeSig.binding}`);

  // Show the DCP audit trail summary
  console.log("\n📒 Audit Trail:");
  for (const entry of auditTrail) {
    console.log(`   ${entry.audit_id.slice(0, 24)}… | ${entry.outcome.slice(0, 50)}`);
  }

  console.log("\n✅ OpenAI function-calling agent completed with full DCP digital citizenship.\n");
}

runConversation();
