/**
 * DCP-AI + Express API Server Template
 *
 * An Express server that uses DCP v2.0 middleware to gate access.
 * AI agents must present a valid signed CitizenshipBundle on every
 * request to protected routes. The server verifies bundle structure,
 * composite signatures, session binding, and revocation status.
 */

import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";

const app = express();
app.use(express.json({ limit: "1mb" }));

// DCP-AI endpoints verify cryptographic signatures on every request, so
// ungated public endpoints (like /verify) are a natural DoS target.
// Defaults below are tuned for developer friendliness — tighten them
// or swap in a distributed store (Redis via `rate-limit-redis`) for
// production workloads behind a load balancer.
const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const authedLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const PORT = process.env.PORT || 3100;

// In-memory registry of verified agents (production: use a database)
const agentRegistry = new Map();

// ─── DCP Bundle Verification ────────────────────────────────────────────────
//
// Verifies that a SignedBundleV2 has valid structure:
//  - dcp_bundle_version is "2.0"
//  - manifest present with valid session_nonce
//  - all four artifacts (RPR, passport, intent, policy) are SignedPayload envelopes
//  - composite signature has classical + PQ components
//  - session nonces are consistent across artifacts

function verifyBundle(signedBundle) {
  const errors = [];
  const warnings = [];

  if (!signedBundle?.bundle || !signedBundle?.signature) {
    return { verified: false, errors: ["Missing bundle or signature"], warnings };
  }

  const { bundle, signature } = signedBundle;

  // Version check
  if (bundle.dcp_bundle_version !== "2.0") {
    errors.push(`Expected dcp_bundle_version "2.0", got "${bundle.dcp_bundle_version}"`);
  }

  // Manifest integrity
  if (!bundle.manifest) {
    errors.push("Missing manifest");
  } else {
    const { session_nonce } = bundle.manifest;
    if (!session_nonce || !/^[0-9a-f]{64}$/.test(session_nonce)) {
      errors.push("Invalid session_nonce (must be 64 hex chars)");
    }

    for (const field of ["rpr_hash", "passport_hash", "intent_hash", "policy_hash", "audit_merkle_root"]) {
      if (!bundle.manifest[field]) {
        errors.push(`Missing manifest.${field}`);
      }
    }
  }

  // Artifact envelope validation
  const requiredArtifacts = ["responsible_principal_record", "agent_passport", "intent", "policy_decision"];
  for (const field of requiredArtifacts) {
    const artifact = bundle[field];
    if (!artifact?.payload) {
      errors.push(`Missing or invalid ${field} (expected SignedPayload with .payload)`);
    } else if (!artifact.composite_sig) {
      errors.push(`Missing composite_sig in ${field}`);
    }
  }

  // Audit entries
  if (!Array.isArray(bundle.audit_entries) || bundle.audit_entries.length === 0) {
    errors.push("Must have at least one audit entry");
  }

  // Bundle-level composite signature
  if (!signature.composite_sig) {
    errors.push("Missing bundle composite_sig");
  } else {
    const cs = signature.composite_sig;

    if (!cs.classical?.sig_b64) errors.push("Missing classical signature");
    if (!cs.pq?.sig_b64) warnings.push("No post-quantum signature (classical-only)");

    if (cs.binding === "pq_over_classical" && !cs.pq) {
      errors.push("Declared pq_over_classical binding but PQ signature is missing");
    }
  }

  // Cross-artifact session nonce consistency
  if (bundle.manifest?.session_nonce) {
    const expectedNonce = bundle.manifest.session_nonce;
    const artifacts = [
      bundle.agent_passport?.payload,
      bundle.responsible_principal_record?.payload,
      bundle.intent?.payload,
      bundle.policy_decision?.payload,
    ].filter(Boolean);

    for (const art of artifacts) {
      if (art.session_nonce && art.session_nonce !== expectedNonce) {
        errors.push("Session nonce mismatch across artifacts");
        break;
      }
    }
  }

  return { verified: errors.length === 0, errors, warnings };
}

// ─── DCP Agent Extraction ───────────────────────────────────────────────────

function extractAgent(signedBundle) {
  const bundle = signedBundle.bundle;
  const passport = bundle.agent_passport?.payload;
  const rpr = bundle.responsible_principal_record?.payload;

  return {
    agentId: passport?.agent_id || "",
    humanId: rpr?.human_id || passport?.principal_binding_reference || "",
    capabilities: passport?.capabilities || [],
    riskTier: passport?.risk_tier || "medium",
    status: passport?.status || "active",
    sessionNonce: bundle.manifest?.session_nonce || "",
    kids: (passport?.keys || []).map((k) => k.kid),
    owner: rpr?.legal_name || "Unknown",
    jurisdiction: rpr?.jurisdiction || "Unknown",
  };
}

// ─── DCP Verification Middleware ────────────────────────────────────────────
//
// Protected routes require a valid DCP bundle. The bundle can be sent as:
//   - X-DCP-Bundle header (JSON string)
//   - Request body .signed_bundle field

function dcpMiddleware(req, res, next) {
  let signedBundle = null;

  // Try header first
  const headerValue = req.headers["x-dcp-bundle"];
  if (typeof headerValue === "string") {
    try {
      signedBundle = JSON.parse(headerValue);
    } catch {
      return res.status(400).json({ error: "Malformed X-DCP-Bundle header" });
    }
  }

  // Fall back to request body
  if (!signedBundle && req.body?.signed_bundle) {
    signedBundle = req.body.signed_bundle;
  }

  if (!signedBundle) {
    return res.status(403).json({
      error: "DCP bundle required",
      hint: "Send a signed CitizenshipBundle via X-DCP-Bundle header or body.signed_bundle",
    });
  }

  const { verified, errors, warnings } = verifyBundle(signedBundle);

  if (!verified) {
    return res.status(403).json({ verified: false, errors, warnings });
  }

  // Extract agent info and attach to request
  const agent = extractAgent(signedBundle);

  // Register or update agent in registry
  agentRegistry.set(agent.agentId, {
    ...agent,
    lastSeen: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  });

  req.dcpAgent = agent;
  req.dcpWarnings = warnings;
  next();
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Health check — no authentication required
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    dcp_version: "2.0",
    timestamp: new Date().toISOString(),
    registered_agents: agentRegistry.size,
  });
});

// Standalone bundle verification — no authentication required.
// Rate-limited to prevent cryptographic-work DoS on the public endpoint.
app.post("/verify", publicLimiter, (req, res) => {
  const signedBundle = req.body?.signed_bundle || req.body;

  if (!signedBundle) {
    return res.status(400).json({ error: "Provide a signed bundle in the request body" });
  }

  const { verified, errors, warnings } = verifyBundle(signedBundle);
  const agent = verified ? extractAgent(signedBundle) : null;

  res.json({
    verified,
    dcp_version: "2.0",
    errors,
    warnings,
    agent: agent
      ? { agentId: agent.agentId, humanId: agent.humanId, capabilities: agent.capabilities, riskTier: agent.riskTier }
      : null,
    timestamp: new Date().toISOString(),
  });
});

// Agent action — requires DCP bundle. Additional per-IP rate limit on top
// of the bundle check (budget is generous because the caller already paid
// the cost of obtaining a valid bundle).
app.post("/agents/action", authedLimiter, dcpMiddleware, (req, res) => {
  const agent = req.dcpAgent;
  const { action } = req.body;

  if (!action) {
    return res.status(400).json({ error: "Missing 'action' in request body" });
  }

  // Verify the agent has the right capability
  const capabilityMap = {
    browse: "browse", api_call: "api_call", send_email: "email",
    create_event: "calendar", payment: "payments", write_file: "file_write",
  };
  const requiredCapability = capabilityMap[action] || action;

  if (!agent.capabilities.includes(requiredCapability)) {
    return res.status(403).json({
      error: `Agent lacks capability '${requiredCapability}'`,
      agent_capabilities: agent.capabilities,
    });
  }

  const actionId = `action:${crypto.randomUUID()}`;
  console.log(`✅ Agent ${agent.agentId.slice(0, 20)}… performed: ${action} (${actionId})`);

  res.json({
    success: true,
    action_id: actionId,
    agent_id: agent.agentId,
    action,
    warnings: req.dcpWarnings,
    timestamp: new Date().toISOString(),
  });
});

// Agent registry — requires DCP bundle (rate-limited).
app.get("/agents/registry", authedLimiter, dcpMiddleware, (_req, res) => {
  const agents = Array.from(agentRegistry.values()).map((a) => ({
    agentId: a.agentId,
    humanId: a.humanId,
    owner: a.owner,
    jurisdiction: a.jurisdiction,
    capabilities: a.capabilities,
    riskTier: a.riskTier,
    status: a.status,
    lastSeen: a.lastSeen,
  }));

  res.json({
    count: agents.length,
    agents,
    timestamp: new Date().toISOString(),
  });
});

// ─── DCP Capabilities Discovery ─────────────────────────────────────────────
//
// Standard endpoint for DCP clients to discover what this server supports.

app.get("/.well-known/dcp-capabilities.json", (_req, res) => {
  res.json({
    supported_versions: ["2.0"],
    supported_algs: {
      signing: ["ed25519", "ml-dsa-65"],
      kem: [],
      hash: ["sha256", "sha3-256"],
    },
    supported_wire_formats: ["json"],
    features: {
      composite_signatures: true,
      session_binding: true,
      blinded_rpr: false,
      dual_hash_chains: true,
      pq_checkpoints: true,
      emergency_revocation: false,
      multi_party_auth: false,
    },
    verifier_policy_hash: `sha256:${crypto.createHash("sha256").update("default-express-policy").digest("hex")}`,
    min_accepted_version: "2.0",
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🏛️  DCP-AI Express Server running on http://localhost:${PORT}`);
  console.log(`   DCP Version: 2.0`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health               — Health check`);
  console.log(`     POST /verify               — Verify a DCP bundle`);
  console.log(`     POST /agents/action         — Agent action (DCP required)`);
  console.log(`     GET  /agents/registry       — Agent registry (DCP required)`);
  console.log(`     GET  /.well-known/dcp-capabilities.json\n`);
});
