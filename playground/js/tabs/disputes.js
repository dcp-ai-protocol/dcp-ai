// playground/js/tabs/disputes.js — Tab 8: Dispute Resolution (DCP-07)

import { uuid, sessionNonce, isoNow } from '../core/utils.js';
import { sha256 } from '../core/hash.js';
import { buildCompositeSig } from '../core/signature.js';
import { renderJson } from '../ui/json-render.js';
import { renderEscalationFlow } from '../ui/visualizations.js';
import { state } from '../core/state.js';
import { generateKeypair } from '../core/crypto.js';

export function init() {
  window.pg_fileDispute = fileDispute;
  window.pg_escalateDispute = escalateDispute;
  window.pg_resolveDispute = resolveDispute;
  window.pg_createJurisprudence = createJurisprudence;
  window.pg_fileObjection = fileObjection;
  renderEscalationFlow('disputes-esc-flow', 'direct_negotiation');
  populateDisputeAgentSelects();
  state.addEventListener('agent-created', () => populateDisputeAgentSelects());
}

function populateDisputeAgentSelects() {
  const agents = Array.from(state.agents.values());
  const opts = agents.map(a => `<option value="${a.agentId}">${a.name}</option>`).join('');
  const none = '<option value="">No agents</option>';
  ['disp-initiator', 'disp-respondent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = agents.length ? opts : none;
  });
}

async function ensureKeypair() {
  if (!state.keypair) state.setKeypair(await generateKeypair());
  return state.keypair;
}

async function fileDispute() {
  const kp = await ensureKeypair();
  const init = document.getElementById('disp-initiator')?.value;
  const resp = document.getElementById('disp-respondent')?.value;
  if (!init || !resp) { alert('Select initiator and respondent agents.'); return; }
  if (init === resp) { alert('Initiator and respondent must be different.'); return; }

  const disputeId = uuid();
  const evidenceText = document.getElementById('disp-evidence')?.value || 'Conflicting API access patterns';
  const evidenceHash = await sha256(evidenceText);

  const record = {
    _spec_ref: 'DCP-07 \u00a74.1',
    dcp_version: '2.0',
    dispute_id: disputeId,
    session_nonce: sessionNonce(),
    initiator_agent_id: init,
    respondent_agent_id: resp,
    dispute_type: document.getElementById('disp-type')?.value || 'resource_conflict',
    evidence_hashes: [evidenceHash],
    escalation_level: 'direct_negotiation',
    status: 'open',
    timestamp: isoNow(),
  };

  record.composite_sig = await buildCompositeSig(record, 'DCP-AI.v2.DisputeRecord', kp);

  state.disputes.set(disputeId, {
    ...record,
    escalation_level: 'direct_negotiation',
    status: 'open',
  });
  state.addArtifact({ _type: 'dispute_record', ...record });
  renderJson('disputes-file-output', record);
  renderEscalationFlow('disputes-esc-flow', 'direct_negotiation');
  populateDisputeSelect();
}

function populateDisputeSelect() {
  const sel = document.getElementById('disp-active-select');
  if (!sel) return;
  const disputes = Array.from(state.disputes.values());
  sel.innerHTML = disputes.length
    ? disputes.map(d => `<option value="${d.dispute_id}">${d.dispute_id.substring(0, 8)}... (${d.status})</option>`).join('')
    : '<option value="">No active disputes</option>';
}

const ESCALATION_ORDER = ['direct_negotiation', 'contextual_arbitration', 'human_appeal'];

async function escalateDispute() {
  const sel = document.getElementById('disp-active-select');
  const disputeId = sel?.value;
  if (!disputeId) { alert('Select a dispute first.'); return; }

  const dispute = state.disputes.get(disputeId);
  if (!dispute) return;

  const idx = ESCALATION_ORDER.indexOf(dispute.escalation_level);
  if (idx >= ESCALATION_ORDER.length - 1) {
    alert('Already at maximum escalation level (human_appeal).');
    return;
  }

  dispute.escalation_level = ESCALATION_ORDER[idx + 1];
  dispute.status = idx + 1 === 1 ? 'in_negotiation' : 'appealed';
  renderEscalationFlow('disputes-esc-flow', dispute.escalation_level);

  const el = document.getElementById('disputes-escalate-output');
  if (el) {
    el.innerHTML = `<div class="info-box" style="border-left-color:var(--yellow)">Escalated to <strong>${dispute.escalation_level.replace(/_/g, ' ')}</strong></div>`;
  }
  populateDisputeSelect();
}

async function resolveDispute() {
  const kp = await ensureKeypair();
  const sel = document.getElementById('disp-active-select');
  const disputeId = sel?.value;
  if (!disputeId) { alert('Select a dispute first.'); return; }

  const dispute = state.disputes.get(disputeId);
  if (!dispute) return;

  const resolution = {
    _spec_ref: 'DCP-07 \u00a74.3',
    dcp_version: '2.0',
    dispute_id: disputeId,
    session_nonce: sessionNonce(),
    arbitrator_ids: ['arbitrator-' + uuid().substring(0, 8)],
    resolution: document.getElementById('disp-resolution-text')?.value || 'Time-sharing arrangement for contested resource',
    binding: true,
    precedent_references: [],
    timestamp: isoNow(),
  };

  resolution.composite_sig = await buildCompositeSig(resolution, 'DCP-AI.v2.ArbitrationResolution', kp);

  dispute.status = 'resolved';
  state.addArtifact({ _type: 'arbitration_resolution', ...resolution });
  renderJson('disputes-resolve-output', resolution);
  populateDisputeSelect();
}

async function createJurisprudence() {
  const kp = await ensureKeypair();
  const sel = document.getElementById('disp-active-select');
  const disputeId = sel?.value;
  if (!disputeId) { alert('Select a dispute.'); return; }

  const bundle = {
    _spec_ref: 'DCP-07 \u00a74.5',
    dcp_version: '2.0',
    jurisprudence_id: uuid(),
    session_nonce: sessionNonce(),
    dispute_id: disputeId,
    resolution_id: uuid(),
    category: document.getElementById('disp-juris-category')?.value || 'resource_conflict',
    precedent_summary: document.getElementById('disp-juris-summary')?.value || 'Time-sharing resolves concurrent resource access conflicts between peer agents',
    applicable_contexts: ['multi-agent resource access', 'concurrent API usage'],
    authority_level: 'organizational',
    timestamp: isoNow(),
  };

  bundle.composite_sig = await buildCompositeSig(bundle, 'DCP-AI.v2.JurisprudenceBundle', kp);

  state.addArtifact({ _type: 'jurisprudence_bundle', ...bundle });
  renderJson('disputes-juris-output', bundle);
}

async function fileObjection() {
  const kp = await ensureKeypair();
  const agents = Array.from(state.agents.values());
  if (agents.length === 0) { alert('Create an agent first.'); return; }

  const objection = {
    _spec_ref: 'DCP-07 \u00a74.6',
    dcp_version: '2.0',
    objection_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agents[0].agentId,
    directive_hash: await sha256('directive-' + Date.now()),
    objection_type: document.getElementById('disp-obj-type')?.value || 'safety',
    reasoning: document.getElementById('disp-obj-reason')?.value || 'Requested action exceeds safety thresholds defined in policy',
    proposed_alternative: document.getElementById('disp-obj-alt')?.value || null,
    human_escalation_required: true,
    timestamp: isoNow(),
  };

  objection.composite_sig = await buildCompositeSig(objection, 'DCP-AI.v2.ObjectionRecord', kp);

  state.addArtifact({ _type: 'objection_record', ...objection });
  renderJson('disputes-objection-output', objection);
}
