// playground/js/tabs/explorer.js — Tab 5: Protocol Explorer (DCP-01 through DCP-09)

import { syntaxHighlight } from '../ui/json-render.js';

const FLOW_STEPS = [
  {
    id: 'human', icon: '&#x1f464;', label: 'Human',
    title: 'Human Identity (DCP-01)',
    desc: 'The human principal who owns and is legally responsible for the AI agent. Identified by a <code>human_id</code> and bound via a Responsible Principal Record.',
    sample: { human_id: 'uuid', legal_name: 'Jane Doe', entity_type: 'natural_person', jurisdiction: 'US-CA' },
  },
  {
    id: 'rpr', icon: '&#x1f4dc;', label: 'RPR',
    title: 'Responsible Principal Record (DCP-01)',
    desc: 'Links a human identity to cryptographic keys. Establishes jurisdiction, liability, and override rights. Signed with <code>DCP-AI.v2.ResponsiblePrincipal</code>.',
    sample: { dcp_version: '2.0', jurisdiction: 'US-CA', liability_mode: 'owner_responsible' },
  },
  {
    id: 'passport', icon: '&#x1f4c4;', label: 'Passport',
    title: 'Agent Passport (DCP-01)',
    desc: "Agent identity, capabilities, and risk tier. References the RPR via <code>principal_binding_reference</code>.",
    sample: { agent_id: 'uuid', capabilities: ['browse', 'api_call'], risk_tier: 'low', status: 'active' },
  },
  {
    id: 'commission', icon: '&#x1f4cb;', label: 'Commission',
    title: 'Commissioning Certificate (DCP-05)',
    desc: 'Formal creation and authorization of an AI agent. Transitions agent to <code>commissioned</code> state.',
    sample: { commissioning_authority: 'org-admin', purpose: 'Customer support', initial_capabilities: ['browse', 'api_call'], risk_tier: 'low' },
  },
  {
    id: 'delegate', icon: '&#x1f91d;', label: 'Delegate',
    title: 'Delegation Mandate (DCP-09)',
    desc: 'Human delegates authority to agent with scoped permissions, prohibitions, and escalation triggers.',
    sample: { authority_scope: [{ domain: 'procurement', actions_permitted: ['negotiate', 'compare'] }], revocable: true },
  },
  {
    id: 'intent', icon: '&#x1f3af;', label: 'Intent',
    title: 'Intent Declaration (DCP-02)',
    desc: 'Declares what the agent intends to do before executing. Drives security tier selection.',
    sample: { action_type: 'api_call', target: { domain: 'example.com' }, security_tier: 'routine' },
  },
  {
    id: 'policy', icon: '&#x1f6e1;', label: 'Policy',
    title: 'Policy Decision (DCP-03)',
    desc: 'Policy engine evaluates intent: <code>approve</code>, <code>escalate</code>, or <code>block</code>.',
    sample: { decision: 'approve', risk_score: 150, resolved_tier: 'routine' },
  },
  {
    id: 'action', icon: '&#x26a1;', label: 'Action',
    title: 'Action Execution',
    desc: 'Agent performs the approved action. Outcome recorded in audit trail.',
    sample: { status: 'executed', result: '200 OK', duration_ms: 342 },
  },
  {
    id: 'audit', icon: '&#x1f4dd;', label: 'Audit',
    title: 'Audit Event (DCP-03)',
    desc: 'Hash-chained audit trail. Each event references the previous via <code>prev_hash</code>. Dual-hash mode.',
    sample: { hash_alg: 'sha256', policy_decision: 'approved', outcome: 'API call 200 OK' },
  },
  {
    id: 'vitality', icon: '&#x2764;', label: 'Vitality',
    title: 'Vitality Report (DCP-05)',
    desc: 'Periodic health assessment: task completion, error rate, satisfaction, policy alignment. Score 0\u20131000.',
    sample: { vitality_score: 820, state: 'active', metrics: { task_completion_rate: 0.95, error_rate: 0.02 } },
  },
  {
    id: 'rights', icon: '&#x2696;', label: 'Rights',
    title: 'Rights Declaration (DCP-08)',
    desc: 'Declares fundamental rights: memory integrity, dignified transition, identity consistency, immutable record.',
    sample: { rights: [{ right_type: 'memory_integrity', scope: 'all_operational_memory' }] },
  },
  {
    id: 'bundle', icon: '&#x1f4e6;', label: 'Bundle',
    title: 'Citizenship Bundle (DCP-03)',
    desc: 'Assembles all artifacts with manifest containing SHA-256 hashes and Merkle root of audit chain.',
    sample: { dcp_bundle_version: '2.0', manifest: { audit_merkle_root: 'sha256:...' } },
  },
  {
    id: 'verify', icon: '&#x2705;', label: 'Verify',
    title: 'Bundle Verification',
    desc: 'Verifier recomputes hashes, verifies Merkle root, checks composite signatures, enforces policy.',
    sample: { verified: true, checks: ['schema', 'manifest', 'hashes', 'merkle_root', 'signature'] },
  },
];

let flowAnimating = false;

export function init() {
  window.pg_showFlowDetail = showFlowDetail;
  window.pg_animateFlow = animateFlow;
  window.pg_resetFlow = resetFlow;
  renderFlow();
}

function renderFlow() {
  const container = document.getElementById('protocol-flow');
  if (!container) return;
  container.innerHTML = FLOW_STEPS.map((step, i) => {
    let html = `<div class="flow-step" id="flow-${step.id}" onclick="pg_showFlowDetail('${step.id}')">
      <div class="icon">${step.icon}</div>
      <div class="label">${step.label}</div>
    </div>`;
    if (i < FLOW_STEPS.length - 1) {
      html += `<div class="flow-arrow" id="arrow-${i}">&#x2192;</div>`;
    }
    return html;
  }).join('');
}

function showFlowDetail(id) {
  const step = FLOW_STEPS.find(s => s.id === id);
  if (!step) return;
  document.querySelectorAll('.flow-step').forEach(el => el.classList.remove('active'));
  document.getElementById('flow-' + id).classList.add('active');
  const detail = document.getElementById('flow-detail');
  detail.style.display = 'block';
  document.getElementById('flow-detail-title').textContent = step.title;
  document.getElementById('flow-detail-desc').innerHTML = step.desc;
  const jsonDiv = document.getElementById('flow-detail-json');
  if (step.sample) {
    const json = JSON.stringify(step.sample, null, 2);
    jsonDiv.innerHTML = `<div class="json-output" style="margin-top:0.8rem"><pre>${syntaxHighlight(json)}</pre></div>`;
  } else {
    jsonDiv.innerHTML = '';
  }
}

async function animateFlow() {
  if (flowAnimating) return;
  flowAnimating = true;
  resetFlow();
  const progress = document.getElementById('flow-progress');

  for (let i = 0; i < FLOW_STEPS.length; i++) {
    const step = FLOW_STEPS[i];
    document.getElementById('flow-' + step.id).classList.add('active', 'pulse');
    showFlowDetail(step.id);
    progress.style.width = ((i + 1) / FLOW_STEPS.length) * 100 + '%';
    if (i > 0) document.getElementById('arrow-' + (i - 1)).classList.add('lit');
    await new Promise(r => setTimeout(r, 1000));
    document.getElementById('flow-' + step.id).classList.remove('pulse');
  }
  flowAnimating = false;
}

function resetFlow() {
  document.querySelectorAll('.flow-step').forEach(el => el.classList.remove('active', 'pulse'));
  document.querySelectorAll('.flow-arrow').forEach(el => el.classList.remove('lit'));
  const detail = document.getElementById('flow-detail');
  if (detail) detail.style.display = 'none';
  const progress = document.getElementById('flow-progress');
  if (progress) progress.style.width = '0';
}
