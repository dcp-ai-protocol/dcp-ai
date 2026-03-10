// playground/js/tabs/builder.js — Tab 2: Bundle Builder (DCP-01/02/03)

import { generateKeypair } from '../core/crypto.js';
import { uuid, sessionNonce, isoNow, b64encode } from '../core/utils.js';
import { sha256, canonicalize, computeMerkleRoot, hashArtifact } from '../core/hash.js';
import { signPayload, buildCompositeSig } from '../core/signature.js';
import { signDetached } from '../core/crypto.js';
import { renderJson } from '../ui/json-render.js';
import { state } from '../core/state.js';

let bs = {};

export function init() {
  window.pg_builderInit = builderInit;
  window.pg_builderStep = builderStep;
  window.pg_builderBuild = builderBuild;
  window.pg_copyBundle = copyBundle;
}

async function builderInit() {
  if (!state.keypair) {
    const kp = await generateKeypair();
    state.setKeypair(kp);
  }
  const kp = state.keypair;
  bs = {
    sessionNonce: sessionNonce(),
    humanId: uuid(),
    agentId: uuid(),
    keypair: kp,
    kid: kp.kid,
    pubB64: kp.pubB64,
  };
  state.builderState = bs;
  renderJson('builder-init-output', {
    session_nonce: bs.sessionNonce,
    human_id: bs.humanId,
    agent_id: bs.agentId,
    kid: bs.kid,
    public_key: bs.pubB64,
  });
}

function makeKeyEntry() {
  return {
    kid: bs.kid,
    alg: 'ed25519',
    public_key_b64: bs.pubB64,
    created_at: isoNow(),
    expires_at: null,
    status: 'active',
  };
}

function computeTier(riskScore, dataClass) {
  const hvData = ['credentials', 'children_data'].includes(dataClass);
  const sensitiveData = ['pii', 'financial_data', 'health_data', 'credentials', 'children_data'].includes(dataClass);
  if (riskScore >= 800 || hvData) return 'maximum';
  if (riskScore >= 500 || sensitiveData) return 'elevated';
  if (riskScore >= 200) return 'standard';
  return 'routine';
}

async function builderStep(step) {
  if (!bs.sessionNonce) {
    alert('Please initialize the session first (Step 1).');
    return;
  }

  if (step === 'rpr') {
    const rpr = {
      _spec_ref: 'DCP-01 \u00a74.1',
      dcp_version: '2.0',
      human_id: bs.humanId,
      session_nonce: bs.sessionNonce,
      legal_name: document.getElementById('builder-rpr-name').value || 'Jane Doe',
      entity_type: 'natural_person',
      jurisdiction: document.getElementById('builder-rpr-jur').value || 'US-CA',
      liability_mode: 'owner_responsible',
      override_rights: true,
      issued_at: isoNow(),
      expires_at: null,
      contact: null,
      binding_keys: [makeKeyEntry()],
    };
    bs.rpr = signPayload(rpr, 'DCP-AI.v2.ResponsiblePrincipal', bs.keypair);
    renderJson('builder-rpr-output', bs.rpr);
  }

  if (step === 'passport') {
    const passport = {
      _spec_ref: 'DCP-01 \u00a74.2',
      dcp_version: '2.0',
      agent_id: bs.agentId,
      session_nonce: bs.sessionNonce,
      keys: [makeKeyEntry()],
      principal_binding_reference: bs.humanId,
      capabilities: ['browse', 'api_call'],
      risk_tier: 'low',
      created_at: isoNow(),
      status: 'active',
    };
    bs.passport = signPayload(passport, 'DCP-AI.v2.AgentPassport', bs.keypair);
    renderJson('builder-passport-output', bs.passport);
  }

  if (step === 'intent') {
    const riskScore = parseInt(document.getElementById('builder-risk').value) || 150;
    const intent = {
      _spec_ref: 'DCP-02 \u00a74.1',
      dcp_version: '2.0',
      intent_id: uuid(),
      session_nonce: bs.sessionNonce,
      agent_id: bs.agentId,
      human_id: bs.humanId,
      timestamp: isoNow(),
      action_type: document.getElementById('builder-action-type').value,
      target: {
        channel: 'api',
        domain: document.getElementById('builder-target').value || 'api.example.com',
      },
      data_classes: [document.getElementById('builder-data-class').value],
      estimated_impact: riskScore >= 500 ? 'high' : riskScore >= 200 ? 'medium' : 'low',
      requires_consent: riskScore >= 500,
      security_tier: computeTier(riskScore, document.getElementById('builder-data-class').value),
    };
    bs.intentId = intent.intent_id;
    bs.riskScore = riskScore;
    bs.intent = signPayload(intent, 'DCP-AI.v2.Intent', bs.keypair);
    renderJson('builder-intent-output', bs.intent);
  }

  if (step === 'policy') {
    if (!bs.intent) {
      alert('Please build an intent first (Step 4).');
      return;
    }
    const score = bs.riskScore || 150;
    const decision = score >= 800 ? 'block' : score >= 500 ? 'escalate' : 'approve';
    const policyHash = await sha256('default-policy-v2');
    const policy = {
      _spec_ref: 'DCP-03 \u00a74.1',
      dcp_version: '2.0',
      intent_id: bs.intentId,
      session_nonce: bs.sessionNonce,
      decision,
      risk_score: score,
      reasons:
        decision === 'approve'
          ? ['Risk score within acceptable range']
          : decision === 'escalate'
            ? ['Elevated risk \u2014 human confirmation required']
            : ['Risk score exceeds maximum threshold'],
      required_confirmation: decision === 'escalate' ? { type: 'human_approve' } : null,
      applied_policy_hash: 'sha256:' + policyHash,
      timestamp: isoNow(),
      resolved_tier: computeTier(score, 'none'),
    };
    bs.policy = signPayload(policy, 'DCP-AI.v2.PolicyDecision', bs.keypair);
    renderJson('builder-policy-output', bs.policy);
  }

  if (step === 'audit') {
    if (!bs.intent) {
      alert('Please build an intent first.');
      return;
    }
    const prevHash =
      bs.auditEntries && bs.auditEntries.length > 0
        ? await sha256(canonicalize(bs.auditEntries[bs.auditEntries.length - 1]))
        : '0'.repeat(64);
    const audit = {
      _spec_ref: 'DCP-03 \u00a74.3',
      dcp_version: '2.0',
      audit_id: uuid(),
      session_nonce: bs.sessionNonce,
      prev_hash: prevHash,
      hash_alg: 'sha256',
      timestamp: isoNow(),
      agent_id: bs.agentId,
      human_id: bs.humanId,
      intent_id: bs.intentId,
      intent_hash: await sha256(canonicalize(bs.intent.payload)),
      policy_decision: bs.policy
        ? bs.policy.payload.decision === 'approve'
          ? 'approved'
          : bs.policy.payload.decision === 'escalate'
            ? 'escalated'
            : 'blocked'
        : 'approved',
      outcome: document.getElementById('builder-outcome').value || 'Action completed',
      evidence: { tool: 'playground-demo', result_ref: null, evidence_hash: null },
      pq_checkpoint_ref: null,
    };
    if (!bs.auditEntries) bs.auditEntries = [];
    bs.auditEntries.push(audit);
    renderJson('builder-audit-output', audit);
  }
}

async function builderBuild() {
  if (!bs.rpr || !bs.passport || !bs.intent || !bs.policy || !bs.auditEntries || bs.auditEntries.length === 0) {
    alert('Please complete all steps (1\u20136) before building the bundle.');
    return;
  }

  const rprHash = await hashArtifact(bs.rpr.payload);
  const passportHash = await hashArtifact(bs.passport.payload);
  const intentHash = await hashArtifact(bs.intent.payload);
  const policyHash = await hashArtifact(bs.policy.payload);
  const merkleRoot = await computeMerkleRoot(bs.auditEntries);

  const manifest = {
    session_nonce: bs.sessionNonce,
    rpr_hash: rprHash,
    passport_hash: passportHash,
    intent_hash: intentHash,
    policy_hash: policyHash,
    audit_merkle_root: 'sha256:' + merkleRoot,
    audit_count: bs.auditEntries.length,
  };

  const bundle = {
    dcp_bundle_version: '2.0',
    manifest,
    responsible_principal_record: bs.rpr,
    agent_passport: bs.passport,
    intent: bs.intent,
    policy_decision: bs.policy,
    audit_entries: bs.auditEntries,
  };

  const manifestCanonical = canonicalize(manifest);
  const manifestHash = await sha256(manifestCanonical);
  const sig = signDetached(manifest, 'DCP-AI.v2.Bundle', bs.keypair.secretKey);

  const signedBundle = {
    _spec_ref: 'DCP-03 \u00a75',
    bundle,
    signature: {
      hash_alg: 'sha256',
      created_at: isoNow(),
      signer: { type: 'human', id: bs.humanId, kids: [bs.kid] },
      manifest_hash: 'sha256:' + manifestHash,
      composite_sig: {
        classical: { alg: 'ed25519', kid: bs.kid, sig_b64: nacl.util.encodeBase64(sig) },
        pq: null,
        binding: 'classical_only',
      },
    },
  };

  bs.signedBundle = signedBundle;
  state.addArtifact({ _type: 'signed_bundle', ...signedBundle });
  renderJson('builder-bundle-output', signedBundle);
}

function copyBundle() {
  if (!bs.signedBundle) {
    alert('Build the bundle first.');
    return;
  }
  document.getElementById('verify-input').value = JSON.stringify(bs.signedBundle, null, 2);
  window.pg_navTo('verifier');
}
