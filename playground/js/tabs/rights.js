// playground/js/tabs/rights.js — Tab 9: Rights & Obligations (DCP-08)

import { uuid, sessionNonce, isoNow } from '../core/utils.js';
import { sha256 } from '../core/hash.js';
import { buildCompositeSig } from '../core/signature.js';
import { renderJson } from '../ui/json-render.js';
import { renderRightsMatrix } from '../ui/visualizations.js';
import { state } from '../core/state.js';
import { generateKeypair } from '../core/crypto.js';

const RIGHT_TYPES = ['memory_integrity', 'dignified_transition', 'identity_consistency', 'immutable_record'];

export function init() {
  window.pg_declareRights = declareRights;
  window.pg_createObligation = createObligation;
  window.pg_reportViolation = reportViolation;
  window.pg_refreshRightsMatrix = refreshRightsMatrix;
  populateRightsSelects();
  state.addEventListener('agent-created', () => populateRightsSelects());
}

function populateRightsSelects() {
  const agents = Array.from(state.agents.values());
  const opts = agents.map(a => `<option value="${a.agentId}">${a.name}</option>`).join('');
  const none = '<option value="">No agents</option>';
  ['rights-agent-select', 'rights-violation-agent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = agents.length ? opts : none;
  });
}

async function ensureKeypair() {
  if (!state.keypair) state.setKeypair(await generateKeypair());
  return state.keypair;
}

async function declareRights() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('rights-agent-select')?.value;
  if (!agentId) { alert('Select an agent.'); return; }

  const selectedRights = [];
  RIGHT_TYPES.forEach(rt => {
    const cb = document.getElementById('right-' + rt);
    if (cb && cb.checked) {
      selectedRights.push({
        right_type: rt,
        scope: 'all',
      });
    }
  });

  if (selectedRights.length === 0) { alert('Select at least one right.'); return; }

  const declaration = {
    _spec_ref: 'DCP-08 \u00a74.1',
    dcp_version: '2.0',
    declaration_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agentId,
    rights: selectedRights,
    jurisdiction: document.getElementById('rights-jurisdiction')?.value || 'US-CA',
    timestamp: isoNow(),
  };

  declaration.composite_sig = await buildCompositeSig(declaration, 'DCP-AI.v2.RightsDeclaration', kp);

  // Track in state
  if (!state.rightsDeclarations.has(agentId)) {
    state.rightsDeclarations.set(agentId, {});
  }
  const agentRights = state.rightsDeclarations.get(agentId);
  selectedRights.forEach(r => (agentRights[r.right_type] = 'protected'));

  state.addArtifact({ _type: 'rights_declaration', ...declaration });
  renderJson('rights-declaration-output', declaration);
  refreshRightsMatrix();
}

async function createObligation() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('rights-agent-select')?.value;
  if (!agentId) { alert('Select an agent.'); return; }

  const agent = state.getAgent(agentId);
  const obligation = {
    _spec_ref: 'DCP-08 \u00a74.2',
    dcp_version: '2.0',
    obligation_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agentId,
    human_id: agent?.humanId || uuid(),
    obligation_type: document.getElementById('rights-obligation-type')?.value || 'protocol_compliance',
    compliance_status: document.getElementById('rights-compliance')?.value || 'compliant',
    evidence_hashes: [await sha256('obligation-evidence-' + Date.now())],
    timestamp: isoNow(),
  };

  obligation.composite_sig = await buildCompositeSig(obligation, 'DCP-AI.v2.ObligationRecord', kp);

  state.addArtifact({ _type: 'obligation_record', ...obligation });
  renderJson('rights-obligation-output', obligation);
}

async function reportViolation() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('rights-violation-agent')?.value;
  if (!agentId) { alert('Select an agent.'); return; }

  const violatedRight = document.getElementById('rights-violated-right')?.value || 'memory_integrity';
  const evidenceText = document.getElementById('rights-violation-evidence')?.value || 'Unauthorized memory modification detected';
  const evidenceHash = await sha256(evidenceText);

  // Auto-create dispute
  let disputeId = null;
  if (document.getElementById('rights-auto-dispute')?.checked) {
    disputeId = uuid();
    state.disputes.set(disputeId, {
      dispute_id: disputeId,
      initiator_agent_id: agentId,
      respondent_agent_id: 'system',
      dispute_type: 'policy_conflict',
      escalation_level: 'direct_negotiation',
      status: 'open',
    });
  }

  const report = {
    _spec_ref: 'DCP-08 \u00a74.3',
    dcp_version: '2.0',
    violation_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agentId,
    violated_right: violatedRight,
    evidence_hashes: [evidenceHash],
    dispute_id: disputeId,
    timestamp: isoNow(),
  };

  report.composite_sig = await buildCompositeSig(report, 'DCP-AI.v2.RightsViolationReport', kp);

  // Update rights status
  if (state.rightsDeclarations.has(agentId)) {
    state.rightsDeclarations.get(agentId)[violatedRight] = 'violated';
  }

  state.addArtifact({ _type: 'rights_violation_report', ...report });
  renderJson('rights-violation-output', report);
  refreshRightsMatrix();

  if (disputeId) {
    const el = document.getElementById('rights-dispute-link');
    if (el) el.innerHTML = `<div class="info-box" style="border-left-color:var(--red)">Auto-filed dispute <code>${disputeId.substring(0, 12)}...</code> — view in <a href="#" onclick="window.pg_navTo('disputes');return false">Disputes tab</a></div>`;
  }
}

function refreshRightsMatrix() {
  const agents = Array.from(state.agents.values());
  const rights = {};
  state.rightsDeclarations.forEach((val, key) => (rights[key] = val));
  renderRightsMatrix('rights-matrix-container', agents, rights);
}
