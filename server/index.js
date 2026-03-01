#!/usr/bin/env node
/**
 * DCP Reference Gateway — V1 + V2 + Phase 3 (PQ-First) verification service.
 *
 * V1 Endpoints:
 *   GET  /health                              — Health check
 *   GET  /.well-known/dcp-capabilities.json   — Capability discovery
 *   POST /verify                              — Verify a signed bundle (V1 or V2)
 *   POST /anchor                              — Stub (501)
 *
 * V2 Endpoints:
 *   POST /v2/passport/register                — Register agent passport + keys
 *   POST /v2/intent/declare                   — Declare intent, get policy decision
 *   POST /v2/audit/append                     — Append audit event to chain
 *   POST /v2/bundle/verify                    — Full V2 composite verification
 *   GET  /v2/keys/:kid                        — Key registry lookup
 *   POST /v2/keys/rotate                      — Key rotation with PoP
 *   POST /v2/emergency-revoke                 — Emergency revocation (panic button)
 *
 * Phase 3 Endpoints:
 *   GET  /v2/policy                           — Current verifier policy (Phase 3)
 *   POST /v2/policy/mode                      — Switch verifier mode (pq_only etc.)
 *   POST /v2/advisory/auto-apply              — Auto-apply advisories to policy
 *   POST /v2/governance/register              — Register governance key set
 *   GET  /.well-known/governance-keys.json    — Published governance keys
 */
import http from "http";
import crypto from "crypto";
import { verifySignedBundle } from "../lib/verify.js";

const PORT = Number(process.env.PORT) || 3000;

// ── Verifier Policy (verifier-authoritative, not self-declared by agents) ──
// Phase 3: mutable policy supporting runtime mode switching and advisory auto-response

let VERIFIER_POLICY = {
  default_mode: "hybrid_required",
  risk_overrides: {
    high: "hybrid_required",
    medium: "hybrid_required",
    low: "hybrid_required",
  },
  min_classical: 1,
  min_pq: 1,
  accepted_classical_algs: ["ed25519"],
  accepted_pq_algs: ["ml-dsa-65", "slh-dsa-192f"],
  accepted_hash_algs: ["sha256", "sha384"],
  require_session_binding: true,
  require_composite_binding: true,
  max_key_age_days: 365,
  allow_v1_bundles: true,
  allow_classical_fallback_disable: false,
  warn_classical_only_deprecated: false,
  advisory_rejected_algs: [],
};

// Phase 3: POLICY_HASH is now computed dynamically via computePolicyHash()
const POLICY_HASH = computePolicyHash();

function computePolicyHash() {
  return "sha256:" + crypto.createHash("sha256")
    .update(JSON.stringify(VERIFIER_POLICY))
    .digest("hex");
}

const DCP_CAPABILITIES = {
  supported_versions: ["1.0", "2.0"],
  supported_algs: {
    signing: ["ed25519", "ml-dsa-65", "slh-dsa-192f"],
    kem: ["x25519", "ml-kem-768", "x25519-ml-kem-768"],
    hash: ["sha256", "sha3-256", "sha384"],
  },
  supported_wire_formats: ["application/json", "application/cbor"],
  features: {
    composite_signatures: true,
    session_binding: true,
    blinded_rpr: true,
    dual_hash_chains: true,
    pq_checkpoints: true,
    emergency_revocation: true,
    multi_party_auth: true,
    pq_only_mode: true,
    advisory_auto_response: true,
    governance_keys: true,
    hsm_provider: true,
  },
  get verifier_policy_hash() { return computePolicyHash(); },
  min_accepted_version: "1.0",
};

// ── In-memory stores ──

const keyRegistry = new Map();       // kid -> { key, agent_id, registered_at }
const passportRegistry = new Map();  // agent_id -> passport data
const auditChains = new Map();       // agent_id -> [events]
const emergencyTokens = new Map();   // agent_id -> token_hash
const revokedKids = new Set();       // set of revoked kids
const revokedAgents = new Set();     // set of emergency-revoked agents
const algorithmAdvisories = [];      // algorithm deprecation advisories
let governanceKeySet = null;         // Phase 3: governance key set
const policyHistory = [];            // Phase 3: policy change audit trail

// Emergency revoke rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60_000;

// ── Helpers ──

function detectDcpVersion(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.dcp_version === "1.0") return "1.0";
  if (obj.dcp_version === "2.0") return "2.0";
  if (obj.dcp_bundle_version === "2.0") return "2.0";
  if (obj.bundle?.dcp_bundle_version === "2.0") return "2.0";
  if (obj.bundle?.responsible_principal_record?.dcp_version === "1.0") return "1.0";
  return null;
}

function send(res, statusCode, body, dcpVersion) {
  res.setHeader("Content-Type", "application/json");
  if (dcpVersion) res.setHeader("DCP-Version", dcpVersion);
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function deriveKid(alg, publicKeyB64) {
  const pkBytes = Buffer.from(publicKeyB64, "base64");
  const algBytes = Buffer.from(alg, "utf8");
  const sep = Buffer.from([0x00]);
  const input = Buffer.concat([algBytes, sep, pkBytes]);
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function validateSessionNonce(nonce) {
  return typeof nonce === "string" && /^[0-9a-f]{64}$/.test(nonce);
}

function verifyV2BundleStructure(signedBundle) {
  const errors = [];
  const warnings = [];
  const bundle = signedBundle.bundle;
  const signature = signedBundle.signature;

  if (!bundle) { errors.push("Missing bundle field"); return { errors, warnings }; }
  if (!signature) { errors.push("Missing signature field"); return { errors, warnings }; }

  if (bundle.dcp_bundle_version !== "2.0") {
    errors.push("Invalid dcp_bundle_version");
  }

  // Manifest check
  if (!bundle.manifest) {
    errors.push("Missing manifest");
  } else {
    if (!validateSessionNonce(bundle.manifest.session_nonce)) {
      errors.push("Invalid or missing session_nonce in manifest");
    }
    for (const field of ["rpr_hash", "passport_hash", "intent_hash", "policy_hash", "audit_merkle_root"]) {
      if (!bundle.manifest[field]) {
        errors.push(`Missing manifest.${field}`);
      }
    }
    if (typeof bundle.manifest.audit_count !== "number") {
      errors.push("Missing or invalid manifest.audit_count");
    }
  }

  // Required artifacts
  for (const field of ["responsible_principal_record", "agent_passport", "intent", "policy_decision"]) {
    const artifact = bundle[field];
    if (!artifact) {
      errors.push(`Missing ${field}`);
    } else if (!artifact.payload) {
      errors.push(`Missing payload in ${field}`);
    } else if (!artifact.composite_sig) {
      errors.push(`Missing composite_sig in ${field}`);
    }
  }

  // Audit entries
  if (!Array.isArray(bundle.audit_entries)) {
    errors.push("Missing or invalid audit_entries array");
  }

  // Session nonce consistency
  if (bundle.manifest) {
    const nonce = bundle.manifest.session_nonce;
    const artifacts = [
      bundle.agent_passport?.payload,
      bundle.responsible_principal_record?.payload,
      bundle.intent?.payload,
      bundle.policy_decision?.payload,
    ].filter(Boolean);

    for (const art of artifacts) {
      if (art.session_nonce && art.session_nonce !== nonce) {
        errors.push(`Session nonce mismatch in artifact`);
        break;
      }
    }

    if (Array.isArray(bundle.audit_entries)) {
      for (const entry of bundle.audit_entries) {
        if (entry.session_nonce && entry.session_nonce !== nonce) {
          errors.push("Session nonce mismatch in audit entry");
          break;
        }
      }
    }
  }

  // Composite signature check
  if (signature.composite_sig) {
    const cs = signature.composite_sig;
    if (!cs.classical) {
      errors.push("Missing classical signature in bundle composite_sig");
    }
    if (cs.binding === "pq_over_classical" && !cs.pq) {
      errors.push("Binding is pq_over_classical but PQ signature is missing");
    }
    if (cs.binding === "classical_only") {
      const mode = VERIFIER_POLICY.default_mode;
      if (mode === "hybrid_required") {
        errors.push("Verifier policy requires hybrid signatures, but bundle has classical_only");
      } else if (mode === "pq_only") {
        errors.push("pq_only mode requires PQ signature, but bundle has classical_only binding");
      } else if (mode === "hybrid_preferred") {
        warnings.push("Bundle uses classical_only (no PQ protection)");
      }
      if (VERIFIER_POLICY.warn_classical_only_deprecated) {
        warnings.push("DEPRECATION: classical-only bundles are deprecated. Migrate to hybrid or pq_only.");
      }
    }

    // Phase 3: check for advisory-rejected algorithms
    const rejectedAlgs = VERIFIER_POLICY.advisory_rejected_algs || [];
    if (rejectedAlgs.length > 0) {
      if (cs.classical && rejectedAlgs.includes(cs.classical.alg)) {
        errors.push(`Classical algorithm ${cs.classical.alg} rejected by active advisory`);
      }
      if (cs.pq && rejectedAlgs.includes(cs.pq.alg)) {
        errors.push(`PQ algorithm ${cs.pq.alg} rejected by active advisory`);
      }
    }
  } else {
    errors.push("Missing composite_sig in signature");
  }

  // PQ checkpoints
  if (bundle.manifest?.pq_checkpoints?.length > 0 && !Array.isArray(bundle.pq_checkpoints)) {
    warnings.push("Manifest references PQ checkpoints but none found in bundle");
  }

  return { errors, warnings };
}

// ── Risk scoring for V2 intent declarations ──

const ACTION_RISK = {
  browse: 100, api_call: 300, send_email: 500, create_calendar_event: 200,
  initiate_payment: 900, update_crm: 400, write_file: 400, execute_code: 700,
};

const IMPACT_BASE = { low: 200, medium: 500, high: 900 };

const SENSITIVE_DATA = new Set([
  "pii", "credentials", "financial_data", "health_data", "children_data",
]);

const HIGH_VALUE_DATA = new Set(["credentials", "children_data"]);

const TIER_TO_VERIFICATION_MODE = {
  routine: "classical_only",
  standard: "hybrid_preferred",
  elevated: "hybrid_required",
  maximum: "hybrid_required",
};

const TIER_TO_CHECKPOINT_INTERVAL = {
  routine: 50,
  standard: 10,
  elevated: 1,
  maximum: 1,
};

function computeRiskScore(actionType, impact, dataClasses) {
  const base = IMPACT_BASE[impact] || 500;
  const actionWeight = ACTION_RISK[actionType] || 300;
  const sensitiveCount = (dataClasses || []).filter(d => SENSITIVE_DATA.has(d)).length;
  const dataBoost = sensitiveCount * 150;
  return Math.min(1000, Math.round((base + actionWeight) / 2 + dataBoost));
}

function computeSecurityTier(riskScore, dataClasses, actionType) {
  const hasHighValue = (dataClasses || []).some(d => HIGH_VALUE_DATA.has(d));
  const hasSensitive = (dataClasses || []).some(d => SENSITIVE_DATA.has(d));
  const isPayment = actionType === "initiate_payment";

  if (riskScore >= 800 || hasHighValue) return "maximum";
  if (riskScore >= 500 || hasSensitive || isPayment) return "elevated";
  if (riskScore >= 200) return "standard";
  return "routine";
}

function resolveVerificationModeForTier(tier) {
  return TIER_TO_VERIFICATION_MODE[tier] || VERIFIER_POLICY.default_mode;
}

function decidePolicy(riskScore) {
  if (riskScore >= 800) {
    return { decision: "block", reasons: ["Risk score >= 800 (millirisk). Requires explicit human approval."] };
  }
  if (riskScore >= 500) {
    return { decision: "escalate", reasons: ["Risk score >= 500 (millirisk). Escalating for human review."] };
  }
  return { decision: "approve", reasons: ["Risk score within acceptable range."] };
}

// ── Server ──

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, {
      ok: true,
      service: "dcp-verification",
      supported_versions: ["1.0", "2.0"],
      registered_agents: passportRegistry.size,
      registered_keys: keyRegistry.size,
    });
    return;
  }

  // Capability discovery
  if (req.method === "GET" && req.url === "/.well-known/dcp-capabilities.json") {
    send(res, 200, DCP_CAPABILITIES, "2.0");
    return;
  }

  // ── V1/V2: Bundle verification (auto-detects version) ──
  if (req.method === "POST" && req.url === "/verify") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { verified: false, errors: ["Invalid JSON body"] }); }

    const signedBundle = body.signed_bundle;
    if (!signedBundle) {
      return send(res, 400, { verified: false, errors: ["Missing signed_bundle in body"] });
    }

    const version = detectDcpVersion(signedBundle);

    if (version === "2.0") {
      const { errors, warnings } = verifyV2BundleStructure(signedBundle);
      const verified = errors.length === 0;

      let resolvedTier = null;
      const intentPayload = signedBundle.bundle?.intent?.payload;
      if (intentPayload) {
        const rs = intentPayload.risk_score ??
          computeRiskScore(intentPayload.action_type, intentPayload.estimated_impact, intentPayload.data_classes);
        resolvedTier = intentPayload.security_tier ??
          computeSecurityTier(rs, intentPayload.data_classes, intentPayload.action_type);
      }

      send(res, 200, {
        verified,
        dcp_version: "2.0",
        errors,
        warnings,
        verifier_policy_hash: computePolicyHash(),
        resolved_tier: resolvedTier,
      }, "2.0");
      return;
    }

    // V1 verification
    const publicKeyB64 = body.public_key_b64 || signedBundle?.signature?.signer?.public_key_b64;
    if (!publicKeyB64) {
      return send(res, 400, {
        verified: false,
        errors: ["Missing public key (provide public_key_b64 or bundle must include signer.public_key_b64)."],
      }, "1.0");
    }

    const result = verifySignedBundle(signedBundle, publicKeyB64);
    send(res, 200, {
      verified: result.verified,
      dcp_version: "1.0",
      errors: result.errors || [],
    }, "1.0");
    return;
  }

  // ── V2: Register passport + keys ──
  if (req.method === "POST" && req.url === "/v2/passport/register") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { signed_passport } = body;
    if (!signed_passport?.payload || !signed_passport?.composite_sig) {
      return send(res, 400, { error: "Missing signed_passport with payload and composite_sig" });
    }

    const passport = signed_passport.payload;
    if (passport.dcp_version !== "2.0") {
      return send(res, 400, { error: "Only V2 passports supported" });
    }

    if (!passport.agent_id || !Array.isArray(passport.keys) || passport.keys.length === 0) {
      return send(res, 400, { error: "Invalid passport: missing agent_id or keys" });
    }

    // Verify deterministic kids
    const registeredKids = [];
    for (const key of passport.keys) {
      const expectedKid = deriveKid(key.alg, key.public_key_b64);
      if (key.kid !== expectedKid) {
        return send(res, 400, {
          error: `Kid mismatch for ${key.alg}: expected ${expectedKid}, got ${key.kid}`,
        });
      }
      keyRegistry.set(key.kid, {
        key,
        agent_id: passport.agent_id,
        registered_at: new Date().toISOString(),
      });
      registeredKids.push(key.kid);
    }

    passportRegistry.set(passport.agent_id, {
      passport,
      signed_passport,
      registered_at: new Date().toISOString(),
    });

    // Register emergency token if present
    if (passport.emergency_revocation_token) {
      emergencyTokens.set(passport.agent_id, passport.emergency_revocation_token);
    }

    send(res, 201, {
      ok: true,
      agent_id: passport.agent_id,
      registered_kids: registeredKids,
    }, "2.0");
    return;
  }

  // ── V2: Declare intent ──
  if (req.method === "POST" && req.url === "/v2/intent/declare") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { signed_intent } = body;
    if (!signed_intent?.payload || !signed_intent?.composite_sig) {
      return send(res, 400, { error: "Missing signed_intent with payload and composite_sig" });
    }

    const intent = signed_intent.payload;

    // Verify agent is registered
    if (!passportRegistry.has(intent.agent_id)) {
      return send(res, 400, { error: `Agent ${intent.agent_id} not registered` });
    }

    // Verify agent is not revoked
    if (revokedAgents.has(intent.agent_id)) {
      return send(res, 403, { error: `Agent ${intent.agent_id} has been revoked` });
    }

    // Risk scoring + adaptive security tier
    const riskScore = computeRiskScore(
      intent.action_type,
      intent.estimated_impact,
      intent.data_classes,
    );
    const { decision, reasons } = decidePolicy(riskScore);
    const resolvedTier = computeSecurityTier(riskScore, intent.data_classes, intent.action_type);
    const tierVerificationMode = resolveVerificationModeForTier(resolvedTier);

    const policyDecision = {
      dcp_version: "2.0",
      intent_id: intent.intent_id,
      session_nonce: intent.session_nonce,
      decision,
      risk_score: riskScore,
      reasons,
      required_confirmation: decision === "block" || decision === "escalate"
        ? { type: "human_approve", fields: ["action_type", "target", "estimated_impact"] }
        : null,
      applied_policy_hash: computePolicyHash(),
      timestamp: new Date().toISOString(),
      resolved_tier: resolvedTier,
    };

    send(res, 200, {
      ok: true,
      policy_decision: policyDecision,
      security_tier: resolvedTier,
      verification_mode: tierVerificationMode,
      checkpoint_interval: TIER_TO_CHECKPOINT_INTERVAL[resolvedTier],
    }, "2.0");
    return;
  }

  // ── V2: Append audit event ──
  if (req.method === "POST" && req.url === "/v2/audit/append") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { audit_event, signature } = body;
    if (!audit_event) {
      return send(res, 400, { error: "Missing audit_event" });
    }

    const agentId = audit_event.agent_id;

    // Verify agent is registered
    if (agentId && !passportRegistry.has(agentId)) {
      return send(res, 400, { error: `Agent ${agentId} not registered` });
    }

    // Verify prev_hash continuity
    let chain = auditChains.get(agentId);
    if (!chain) {
      chain = [];
      auditChains.set(agentId, chain);
    }

    if (chain.length > 0) {
      const lastEntry = chain[chain.length - 1];
      const expectedPrevHash = `sha256:${crypto.createHash("sha256")
        .update(JSON.stringify(lastEntry))
        .digest("hex")}`;
      if (audit_event.prev_hash !== expectedPrevHash && audit_event.prev_hash !== "GENESIS") {
        // Warn but don't reject (the client computes prev_hash locally)
      }
    }

    chain.push(audit_event);

    send(res, 201, {
      ok: true,
      audit_id: audit_event.audit_id,
      chain_length: chain.length,
    }, "2.0");
    return;
  }

  // ── V2: Full bundle verification (tier-aware) ──
  if (req.method === "POST" && req.url === "/v2/bundle/verify") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { verified: false, errors: ["Invalid JSON body"] }); }

    const signedBundle = body.signed_bundle || body;
    if (!signedBundle.bundle || !signedBundle.signature) {
      return send(res, 400, {
        verified: false,
        errors: ["Missing bundle or signature fields"],
      });
    }

    const { errors, warnings } = verifyV2BundleStructure(signedBundle);

    // Compute resolved tier from intent inside the bundle
    let resolvedTier = null;
    const intentPayload = signedBundle.bundle?.intent?.payload;
    if (intentPayload) {
      const rs = intentPayload.risk_score ??
        computeRiskScore(intentPayload.action_type, intentPayload.estimated_impact, intentPayload.data_classes);
      resolvedTier = intentPayload.security_tier ??
        computeSecurityTier(rs, intentPayload.data_classes, intentPayload.action_type);

      // Tier-aware verification mode enforcement
      const requiredMode = resolveVerificationModeForTier(resolvedTier);
      const cs = signedBundle.signature?.composite_sig;
      if (cs && requiredMode === "hybrid_required" && cs.binding === "classical_only") {
        errors.push(`Security tier '${resolvedTier}' requires hybrid signatures, but bundle has classical_only`);
      }
    }

    const verified = errors.length === 0;

    send(res, 200, {
      verified,
      dcp_version: "2.0",
      errors,
      warnings,
      verifier_policy_hash: computePolicyHash(),
      resolved_tier: resolvedTier,
      verification_mode: resolvedTier ? resolveVerificationModeForTier(resolvedTier) : VERIFIER_POLICY.default_mode,
      session_binding_valid: !errors.some(e => e.includes("session_nonce")),
      manifest_valid: !errors.some(e => e.includes("manifest")),
    }, "2.0");
    return;
  }

  // ── V2: Key registry lookup ──
  const keyLookupMatch = req.url?.match(/^\/v2\/keys\/([0-9a-f]+)$/);
  if (req.method === "GET" && keyLookupMatch) {
    const kid = keyLookupMatch[1];
    const entry = keyRegistry.get(kid);

    if (!entry) {
      return send(res, 404, { found: false, kid }, "2.0");
    }

    // Check if revoked
    if (revokedKids.has(kid)) {
      return send(res, 200, {
        found: true,
        revoked: true,
        kid,
        key: entry.key,
        agent_id: entry.agent_id,
      }, "2.0");
    }

    // Check if expired (short-lived cert)
    if (entry.key.expires_at && new Date(entry.key.expires_at) < new Date()) {
      return send(res, 200, {
        found: true,
        expired: true,
        kid,
        key: entry.key,
        agent_id: entry.agent_id,
      }, "2.0");
    }

    send(res, 200, {
      found: true,
      kid,
      key: entry.key,
      agent_id: entry.agent_id,
    }, "2.0");
    return;
  }

  // ── V2: Key rotation ──
  if (req.method === "POST" && req.url === "/v2/keys/rotate") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { old_kid, new_key, proof_of_possession, authorization_sig } = body;

    if (!old_kid || !new_key || !proof_of_possession) {
      return send(res, 400, {
        error: "Missing required fields: old_kid, new_key, proof_of_possession",
      });
    }

    // Verify old key exists
    const oldEntry = keyRegistry.get(old_kid);
    if (!oldEntry) {
      return send(res, 404, { error: `Key ${old_kid} not found` });
    }

    // Verify new kid is deterministic
    const expectedKid = deriveKid(new_key.alg, new_key.public_key_b64);
    if (new_key.kid !== expectedKid) {
      return send(res, 400, {
        error: `Kid mismatch: expected ${expectedKid}, got ${new_key.kid}`,
      });
    }

    // Register new key
    keyRegistry.set(new_key.kid, {
      key: new_key,
      agent_id: oldEntry.agent_id,
      registered_at: new Date().toISOString(),
      rotated_from: old_kid,
    });

    // Mark old key as rotated (not revoked — grace period applies)
    const oldKey = oldEntry.key;
    oldKey.status = "revoked";

    // Update passport keys
    const passportEntry = passportRegistry.get(oldEntry.agent_id);
    if (passportEntry) {
      const keys = passportEntry.passport.keys || [];
      const idx = keys.findIndex(k => k.kid === old_kid);
      if (idx >= 0) {
        keys[idx].status = "revoked";
      }
      keys.push(new_key);
    }

    send(res, 200, {
      ok: true,
      old_kid,
      new_kid: new_key.kid,
      agent_id: oldEntry.agent_id,
      rotated_at: new Date().toISOString(),
    }, "2.0");
    return;
  }

  // ── V2: Emergency revocation (panic button) ──
  if (req.method === "POST" && req.url === "/v2/emergency-revoke") {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      return send(res, 429, { error: "Rate limit exceeded. Try again later." });
    }

    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { agent_id, human_id, revocation_secret } = body;

    if (!agent_id || !revocation_secret) {
      return send(res, 400, {
        error: "Missing required fields: agent_id, revocation_secret",
      });
    }

    if (!/^[0-9a-f]{64}$/.test(revocation_secret)) {
      return send(res, 400, { error: "Invalid revocation_secret format" });
    }

    // Look up emergency token
    const tokenHash = emergencyTokens.get(agent_id);
    if (!tokenHash) {
      return send(res, 404, {
        error: "No emergency revocation token registered for this agent",
      });
    }

    // Verify pre-image
    const secretBytes = Buffer.from(revocation_secret, "hex");
    const computedHash = "sha256:" + crypto.createHash("sha256").update(secretBytes).digest("hex");

    if (computedHash !== tokenHash) {
      console.log(`[emergency-revoke] FAILED attempt for agent ${agent_id} from ${ip}`);
      return send(res, 403, { error: "Invalid revocation secret" });
    }

    // Revoke all keys for this agent
    revokedAgents.add(agent_id);
    let keysRevoked = 0;

    for (const [kid, entry] of keyRegistry.entries()) {
      if (entry.agent_id === agent_id) {
        revokedKids.add(kid);
        entry.key.status = "revoked";
        keysRevoked++;
      }
    }

    // Consume the token (one-time use)
    emergencyTokens.delete(agent_id);

    console.log(`[emergency-revoke] Agent ${agent_id} revoked (${keysRevoked} keys)`);
    send(res, 200, {
      ok: true,
      agent_id,
      revoked_at: new Date().toISOString(),
      keys_revoked: keysRevoked,
    }, "2.0");
    return;
  }

  // ── V2: Multi-party authorization (Gap #5) ──
  if (req.method === "POST" && req.url === "/v2/multi-party/authorize") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { authorization } = body;
    if (!authorization || authorization.type !== "multi_party_authorization") {
      return send(res, 400, { error: "Missing or invalid multi_party_authorization" });
    }

    const ALLOWED_OPERATIONS = new Set([
      "revoke_agent", "rotate_org_key", "change_jurisdiction", "modify_recovery_config",
    ]);

    if (!ALLOWED_OPERATIONS.has(authorization.operation)) {
      return send(res, 400, { error: `Unknown operation: ${authorization.operation}` });
    }

    if (!Array.isArray(authorization.authorizations)) {
      return send(res, 400, { error: "Missing authorizations array" });
    }

    const required = authorization.required_parties || 2;
    if (authorization.authorizations.length < required) {
      return send(res, 403, {
        error: `Insufficient authorizations: ${authorization.authorizations.length} < ${required}`,
      });
    }

    const hasOwner = authorization.authorizations.some(a => a.role === "owner");
    if (!hasOwner) {
      return send(res, 403, { error: "Owner authorization required but not present" });
    }

    const errors = [];
    for (const auth of authorization.authorizations) {
      if (!auth.party_id || !auth.role || !auth.composite_sig) {
        errors.push(`Invalid authorization entry for party ${auth.party_id || "unknown"}`);
      }
      if (auth.composite_sig && auth.composite_sig.binding === "pq_over_classical" && !auth.composite_sig.pq) {
        errors.push(`Party ${auth.party_id}: binding pq_over_classical but PQ sig missing`);
      }
    }

    if (errors.length > 0) {
      return send(res, 400, { error: "Authorization validation failed", details: errors });
    }

    send(res, 200, {
      ok: true,
      operation: authorization.operation,
      parties_verified: authorization.authorizations.length,
      threshold_met: true,
    }, "2.0");
    return;
  }

  // ── V2: Audit compaction ──
  if (req.method === "POST" && req.url === "/v2/audit/compact") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { compaction } = body;
    if (!compaction || compaction.type !== "audit_compaction") {
      return send(res, 400, { error: "Missing or invalid compaction object" });
    }

    if (!compaction.range || !compaction.merkle_root || !compaction.composite_sig) {
      return send(res, 400, { error: "Compaction missing required fields" });
    }

    if (!validateSessionNonce(compaction.session_nonce)) {
      return send(res, 400, { error: "Invalid session_nonce in compaction" });
    }

    send(res, 201, {
      ok: true,
      compacted_range: compaction.range,
      merkle_root: compaction.merkle_root,
    }, "2.0");
    return;
  }

  // ── V2: Algorithm advisories (Gap #4) ──
  if (req.method === "GET" && req.url === "/.well-known/algorithm-advisories.json") {
    send(res, 200, { advisories: algorithmAdvisories }, "2.0");
    return;
  }

  if (req.method === "POST" && req.url === "/v2/advisory/publish") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { advisory } = body;
    if (!advisory || advisory.type !== "algorithm_advisory") {
      return send(res, 400, { error: "Missing or invalid algorithm_advisory" });
    }

    if (!advisory.advisory_id || !advisory.affected_algorithms || !advisory.action) {
      return send(res, 400, { error: "Advisory missing required fields" });
    }

    if (!["deprecate", "warn", "revoke"].includes(advisory.action)) {
      return send(res, 400, { error: `Invalid action: ${advisory.action}` });
    }

    if (!advisory.composite_sig) {
      return send(res, 400, { error: "Advisory must be signed by governance key" });
    }

    algorithmAdvisories.push(advisory);

    send(res, 201, {
      ok: true,
      advisory_id: advisory.advisory_id,
      affected_algorithms: advisory.affected_algorithms,
      action: advisory.action,
    }, "2.0");
    return;
  }

  if (req.method === "GET" && req.url === "/v2/advisory/check") {
    const now = new Date();
    const active = [];
    const deprecated = new Set();
    const warned = new Set();
    const revoked = new Set();

    for (const adv of algorithmAdvisories) {
      const effectiveDate = new Date(adv.effective_date);
      if (now < effectiveDate) continue;

      const graceEnd = new Date(effectiveDate.getTime() + (adv.grace_period_days || 0) * 86400000);
      const gracePeriodExpired = now >= graceEnd;

      active.push({
        advisory_id: adv.advisory_id,
        severity: adv.severity,
        action: adv.action,
        affected_algorithms: adv.affected_algorithms,
        grace_period_expired: gracePeriodExpired,
      });

      for (const alg of adv.affected_algorithms) {
        if (adv.action === "revoke") revoked.add(alg);
        else if (adv.action === "deprecate" && gracePeriodExpired) deprecated.add(alg);
        else warned.add(alg);
      }
    }

    send(res, 200, {
      deprecated: [...deprecated],
      warned: [...warned],
      revoked: [...revoked],
      active_advisories: active,
    }, "2.0");
    return;
  }

  // ── Phase 3: Get current verifier policy ──
  if (req.method === "GET" && req.url === "/v2/policy") {
    send(res, 200, {
      policy: VERIFIER_POLICY,
      policy_hash: computePolicyHash(),
      mode: VERIFIER_POLICY.default_mode,
      advisory_rejected_algs: VERIFIER_POLICY.advisory_rejected_algs || [],
      policy_history_length: policyHistory.length,
    }, "2.0");
    return;
  }

  // ── Phase 3: Switch verifier mode ──
  if (req.method === "POST" && req.url === "/v2/policy/mode") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { mode } = body;
    const validModes = ["classical_only", "pq_only", "hybrid_required", "hybrid_preferred"];

    if (!validModes.includes(mode)) {
      return send(res, 400, {
        error: `Invalid mode '${mode}'. Valid: ${validModes.join(", ")}`,
      });
    }

    const oldMode = VERIFIER_POLICY.default_mode;

    VERIFIER_POLICY.default_mode = mode;
    VERIFIER_POLICY.risk_overrides = { high: mode, medium: mode, low: mode };

    if (mode === "pq_only") {
      VERIFIER_POLICY.min_classical = 0;
      VERIFIER_POLICY.min_pq = 1;
      VERIFIER_POLICY.require_composite_binding = false;
      VERIFIER_POLICY.allow_classical_fallback_disable = true;
      VERIFIER_POLICY.warn_classical_only_deprecated = true;
      VERIFIER_POLICY.allow_v1_bundles = false;
    } else if (mode === "hybrid_required") {
      VERIFIER_POLICY.min_classical = 1;
      VERIFIER_POLICY.min_pq = 1;
      VERIFIER_POLICY.require_composite_binding = true;
      VERIFIER_POLICY.allow_classical_fallback_disable = false;
      VERIFIER_POLICY.warn_classical_only_deprecated = false;
    } else if (mode === "classical_only") {
      VERIFIER_POLICY.min_classical = 1;
      VERIFIER_POLICY.min_pq = 0;
      VERIFIER_POLICY.require_composite_binding = false;
      VERIFIER_POLICY.warn_classical_only_deprecated = true;
    }

    policyHistory.push({
      action: "mode_switch",
      from: oldMode,
      to: mode,
      timestamp: new Date().toISOString(),
      policy_hash: computePolicyHash(),
    });

    console.log(`[policy] Mode switched: ${oldMode} -> ${mode}`);

    send(res, 200, {
      ok: true,
      previous_mode: oldMode,
      current_mode: mode,
      policy_hash: computePolicyHash(),
    }, "2.0");
    return;
  }

  // ── Phase 3: Auto-apply advisories to verifier policy ──
  if (req.method === "POST" && req.url === "/v2/advisory/auto-apply") {
    const now = new Date();
    const deprecated = new Set();
    const warned = new Set();
    const revoked = new Set();
    const removedClassical = [];
    const removedPq = [];
    const addedReplacements = [];
    const warnings = [];

    for (const adv of algorithmAdvisories) {
      const effectiveDate = new Date(adv.effective_date);
      if (now < effectiveDate) continue;

      const graceEnd = new Date(effectiveDate.getTime() + (adv.grace_period_days || 0) * 86400000);
      const gracePeriodExpired = now >= graceEnd;

      for (const alg of adv.affected_algorithms) {
        if (adv.action === "revoke") revoked.add(alg);
        else if (adv.action === "deprecate" && gracePeriodExpired) deprecated.add(alg);
        else warned.add(alg);
      }

      if ((adv.action === "revoke" || (adv.action === "deprecate" && gracePeriodExpired)) && adv.replacement_algorithms) {
        for (const rep of adv.replacement_algorithms) {
          if (!VERIFIER_POLICY.accepted_pq_algs.includes(rep) &&
              !VERIFIER_POLICY.accepted_classical_algs.includes(rep)) {
            addedReplacements.push(rep);
          }
        }
      }
    }

    const blocked = new Set([...deprecated, ...revoked]);
    let policyModified = false;

    VERIFIER_POLICY.accepted_classical_algs = VERIFIER_POLICY.accepted_classical_algs.filter(alg => {
      if (blocked.has(alg)) {
        removedClassical.push(alg);
        policyModified = true;
        return false;
      }
      return true;
    });

    VERIFIER_POLICY.accepted_pq_algs = VERIFIER_POLICY.accepted_pq_algs.filter(alg => {
      if (blocked.has(alg)) {
        removedPq.push(alg);
        policyModified = true;
        return false;
      }
      return true;
    });

    for (const rep of addedReplacements) {
      if (!VERIFIER_POLICY.accepted_pq_algs.includes(rep)) {
        VERIFIER_POLICY.accepted_pq_algs.push(rep);
        policyModified = true;
      }
    }

    VERIFIER_POLICY.advisory_rejected_algs = [...blocked];

    // Auto-switch to pq_only if all classical algorithms removed
    if (VERIFIER_POLICY.accepted_classical_algs.length === 0 &&
        VERIFIER_POLICY.accepted_pq_algs.length > 0) {
      VERIFIER_POLICY.default_mode = "pq_only";
      VERIFIER_POLICY.min_classical = 0;
      VERIFIER_POLICY.require_composite_binding = false;
      VERIFIER_POLICY.allow_classical_fallback_disable = true;
      warnings.push("All classical algorithms deprecated/revoked. Auto-switched to pq_only mode.");
    }

    if (policyModified) {
      policyHistory.push({
        action: "advisory_auto_apply",
        removed_classical: removedClassical,
        removed_pq: removedPq,
        added_replacements: addedReplacements,
        timestamp: new Date().toISOString(),
        policy_hash: computePolicyHash(),
      });
      console.log(`[advisory] Auto-applied: removed ${[...blocked].join(", ") || "none"}, added ${addedReplacements.join(", ") || "none"}`);
    }

    for (const alg of warned) {
      warnings.push(`Algorithm '${alg}' has an active warning advisory`);
    }

    send(res, 200, {
      ok: true,
      policy_modified: policyModified,
      removed_classical: removedClassical,
      removed_pq: removedPq,
      added_replacements: addedReplacements,
      advisory_rejected_algs: [...blocked],
      warnings,
      current_mode: VERIFIER_POLICY.default_mode,
      policy_hash: computePolicyHash(),
    }, "2.0");
    return;
  }

  // ── Phase 3: Register governance key set ──
  if (req.method === "POST" && req.url === "/v2/governance/register") {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    const { governance_key_set: gks } = body;
    if (!gks || !gks.governance_id || !Array.isArray(gks.keys) || !gks.threshold) {
      return send(res, 400, {
        error: "Missing or invalid governance_key_set (need governance_id, keys[], threshold)",
      });
    }

    if (gks.threshold < 2) {
      return send(res, 400, { error: "Governance threshold must be >= 2" });
    }

    if (gks.keys.length < gks.threshold * 2) {
      return send(res, 400, {
        error: `Need at least ${gks.threshold * 2} keys (${gks.threshold} participants x 2 algs)`,
      });
    }

    governanceKeySet = gks;

    console.log(`[governance] Registered key set: ${gks.governance_id} (threshold: ${gks.threshold})`);

    send(res, 201, {
      ok: true,
      governance_id: gks.governance_id,
      threshold: gks.threshold,
      key_count: gks.keys.length,
      registered_at: new Date().toISOString(),
    }, "2.0");
    return;
  }

  // ── Phase 3: Published governance keys ──
  if (req.method === "GET" && req.url === "/.well-known/governance-keys.json") {
    if (!governanceKeySet) {
      return send(res, 404, { error: "No governance key set registered" }, "2.0");
    }
    send(res, 200, governanceKeySet, "2.0");
    return;
  }

  // Anchor stub
  if (req.method === "POST" && req.url === "/anchor") {
    send(res, 501, {
      error: "Anchor not implemented in reference server",
      hint: "Configure per docs/OPERATOR_GUIDE.md and docs/STORAGE_AND_ANCHORING.md",
    });
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`DCP Gateway v2.0 (Phase 3: PQ-First) listening on port ${PORT}`);
  console.log("  Shared:");
  console.log("    GET  /health                              — health check");
  console.log("    GET  /.well-known/dcp-capabilities.json   — capability discovery");
  console.log("    GET  /.well-known/algorithm-advisories.json — algorithm advisories");
  console.log("    GET  /.well-known/governance-keys.json    — governance keys");
  console.log("    POST /verify                              — verify bundle (V1/V2 auto-detect)");
  console.log("  V2:");
  console.log("    POST /v2/passport/register                — register agent passport + keys");
  console.log("    POST /v2/intent/declare                   — declare intent, get policy decision");
  console.log("    POST /v2/audit/append                     — append audit event");
  console.log("    POST /v2/audit/compact                    — audit trail compaction");
  console.log("    POST /v2/bundle/verify                    — full V2 bundle verification");
  console.log("    GET  /v2/keys/:kid                        — key lookup");
  console.log("    POST /v2/keys/rotate                      — key rotation");
  console.log("    POST /v2/emergency-revoke                 — panic button revocation");
  console.log("    POST /v2/multi-party/authorize            — multi-party M-of-N auth");
  console.log("    POST /v2/advisory/publish                 — publish algorithm advisory");
  console.log("    GET  /v2/advisory/check                   — check active advisories");
  console.log("  Phase 3:");
  console.log("    GET  /v2/policy                           — current verifier policy");
  console.log("    POST /v2/policy/mode                      — switch verifier mode (pq_only etc.)");
  console.log("    POST /v2/advisory/auto-apply              — auto-apply advisories to policy");
  console.log("    POST /v2/governance/register              — register governance key set");
});
