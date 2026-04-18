// playground/js/tabs/lifecycle.js — Tab 6: Lifecycle Management (DCP-05)

import { uuid, sessionNonce, isoNow } from '../core/utils.js';
import { sha256, canonicalize } from '../core/hash.js';
import { buildCompositeSig } from '../core/signature.js';
import { renderJson } from '../ui/json-render.js';
import { renderStateMachine } from '../ui/visualizations.js';
import { state } from '../core/state.js';
import { generateKeypair } from '../core/crypto.js';

const VALID_TRANSITIONS = {
  commissioned: ['active'],
  active: ['declining', 'decommissioned'],
  declining: ['active', 'decommissioned'],
  decommissioned: [],
};

export function init() {
  window.pg_commissionAgent = commissionAgent;
  window.pg_transitionAgent = transitionAgent;
  window.pg_generateVitality = generateVitality;
  window.pg_decommissionAgent = decommissionAgent;
  renderStateMachine('lifecycle-sm', 'commissioned');
  populateAgentSelect();

  state.addEventListener('agent-created', () => populateAgentSelect());
  state.addEventListener('agent-state-change', e => {
    renderStateMachine('lifecycle-sm', e.detail.newState);
    updateCurrentStateDisplay();
  });
}

function populateAgentSelect() {
  const sel = document.getElementById('lifecycle-agent-select');
  if (!sel) return;
  const agents = Array.from(state.agents.values());
  sel.innerHTML = agents.length
    ? agents.map(a => `<option value="${a.agentId}">${a.name} (${a.state})</option>`).join('')
    : '<option value="">No agents — create one in Identity tab</option>';
}

function getSelectedAgent() {
  const sel = document.getElementById('lifecycle-agent-select');
  return sel ? state.getAgent(sel.value) : null;
}

function updateCurrentStateDisplay() {
  const agent = getSelectedAgent();
  const el = document.getElementById('lifecycle-current-state');
  if (el && agent) {
    const colors = { commissioned: '#3388ff', active: '#00d4aa', declining: '#ffaa33', decommissioned: '#ff4466' };
    el.innerHTML = `<span class="tag" style="background:${colors[agent.state]}22;color:${colors[agent.state]}">${agent.state}</span> Vitality: ${agent.vitalityScore}/1000`;
  }
}

async function ensureKeypair() {
  if (!state.keypair) {
    const kp = await generateKeypair();
    state.setKeypair(kp);
  }
  return state.keypair;
}

async function commissionAgent() {
  const kp = await ensureKeypair();
  const nonce = sessionNonce();
  const agentId = uuid();
  const humanId = state._lastRPR ? state._lastRPR.human_id : uuid();

  const cert = {
    _spec_ref: 'DCP-05 \u00a74.2',
    dcp_version: '2.0',
    agent_id: agentId,
    session_nonce: nonce,
    human_id: humanId,
    commissioning_authority: document.getElementById('lc-authority').value || 'org-admin',
    timestamp: isoNow(),
    purpose: document.getElementById('lc-purpose').value || 'General-purpose AI assistant',
    initial_capabilities: ['browse', 'api_call'],
    risk_tier: document.getElementById('lc-risk-tier').value || 'low',
    principal_binding_reference: humanId,
  };

  cert.composite_sig = await buildCompositeSig(cert, 'DCP-AI.v2.CommissioningCertificate', kp);

  state.createAgent({ agentId, humanId, state: 'commissioned', vitalityScore: 800 });
  state.addArtifact({ _type: 'commissioning_certificate', ...cert });
  renderStateMachine('lifecycle-sm', 'commissioned');
  renderJson('lifecycle-commission-output', cert);
  populateAgentSelect();
  updateCurrentStateDisplay();
}

async function transitionAgent(targetState) {
  const agent = getSelectedAgent();
  if (!agent) { alert('Select an agent first.'); return; }

  const valid = VALID_TRANSITIONS[agent.state] || [];
  if (!valid.includes(targetState)) {
    alert(`Invalid transition: ${agent.state} \u2192 ${targetState}.\nValid: ${valid.join(', ') || 'none'}`);
    return;
  }

  state.setAgentState(agent.agentId, targetState);
  renderStateMachine('lifecycle-sm', targetState);
  updateCurrentStateDisplay();
  populateAgentSelect();

  const el = document.getElementById('lifecycle-transition-output');
  if (el) {
    el.innerHTML = `<div class="info-box" style="border-left-color:var(--accent)">Transitioned <strong>${agent.name}</strong> to <strong>${targetState}</strong></div>`;
  }
}

async function generateVitality() {
  const agent = getSelectedAgent();
  if (!agent) { alert('Select an agent first.'); return; }
  const kp = await ensureKeypair();

  const taskRate = parseFloat(document.getElementById('lc-task-rate').value) || 0.9;
  const errorRate = parseFloat(document.getElementById('lc-error-rate').value) || 0.05;
  const satisfaction = parseFloat(document.getElementById('lc-satisfaction').value) || 0.85;
  const alignment = parseFloat(document.getElementById('lc-alignment').value) || 0.95;

  const score = Math.round(
    taskRate * 300 + (1 - errorRate) * 250 + satisfaction * 250 + alignment * 200
  );

  const prevHash = agent.vitalityReports.length > 0
    ? await sha256(canonicalize(agent.vitalityReports[agent.vitalityReports.length - 1]))
    : '0'.repeat(64);

  const report = {
    _spec_ref: 'DCP-05 \u00a74.4',
    dcp_version: '2.0',
    agent_id: agent.agentId,
    session_nonce: sessionNonce(),
    timestamp: isoNow(),
    vitality_score: score,
    state: agent.state,
    metrics: {
      task_completion_rate: taskRate,
      error_rate: errorRate,
      human_satisfaction: satisfaction,
      policy_alignment: alignment,
    },
    prev_report_hash: prevHash,
  };

  report.composite_sig = await buildCompositeSig(report, 'DCP-AI.v2.VitalityReport', kp);

  agent.vitalityScore = score;
  agent.vitalityReports.push(report);
  state.addArtifact({ _type: 'vitality_report', ...report });

  // Auto-transition if score drops
  if (score < 400 && agent.state === 'active') {
    state.setAgentState(agent.agentId, 'declining');
    renderStateMachine('lifecycle-sm', 'declining');
  }

  renderJson('lifecycle-vitality-output', report);
  updateCurrentStateDisplay();
  populateAgentSelect();
}

async function decommissionAgent() {
  const agent = getSelectedAgent();
  if (!agent) { alert('Select an agent first.'); return; }
  if (agent.state === 'decommissioned') { alert('Agent already decommissioned.'); return; }
  if (agent.state === 'commissioned') { alert('Cannot decommission a commissioned agent directly. Activate first.'); return; }

  const kp = await ensureKeypair();

  const record = {
    _spec_ref: 'DCP-05 \u00a74.6',
    dcp_version: '2.0',
    agent_id: agent.agentId,
    session_nonce: sessionNonce(),
    human_id: agent.humanId,
    timestamp: isoNow(),
    termination_mode: document.getElementById('lc-term-mode').value || 'planned_retirement',
    reason: document.getElementById('lc-term-reason').value || 'End of service period',
    final_vitality_score: agent.vitalityScore,
    successor_agent_id: null,
    data_disposition: document.getElementById('lc-data-disp').value || 'archived',
  };

  record.composite_sig = await buildCompositeSig(record, 'DCP-AI.v2.DecommissioningRecord', kp);

  state.setAgentState(agent.agentId, 'decommissioned');
  state.addArtifact({ _type: 'decommissioning_record', ...record });
  renderStateMachine('lifecycle-sm', 'decommissioned');
  renderJson('lifecycle-decommission-output', record);
  updateCurrentStateDisplay();
  populateAgentSelect();
}
