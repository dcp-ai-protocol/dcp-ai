// playground/js/tabs/delegation.js — Tab 10: Delegation & Representation (DCP-09)

import { uuid, sessionNonce, isoNow, isoFuture } from '../core/utils.js';
import { sha256, canonicalize } from '../core/hash.js';
import { buildCompositeSig } from '../core/signature.js';
import { renderJson } from '../ui/json-render.js';
import { renderDelegationChain } from '../ui/visualizations.js';
import { state } from '../core/state.js';
import { generateKeypair } from '../core/crypto.js';

export function init() {
  window.pg_createMandate = createMandate;
  window.pg_createAdvisory = createAdvisory;
  window.pg_createMirror = createMirror;
  window.pg_createThreshold = createThreshold;
  window.pg_testThreshold = testThreshold;
  populateDelegationSelects();
  state.addEventListener('agent-created', () => populateDelegationSelects());
}

function populateDelegationSelects() {
  const agents = Array.from(state.agents.values());
  const opts = agents.map(a => `<option value="${a.agentId}">${a.name}</option>`).join('');
  const none = '<option value="">No agents</option>';
  ['del-agent-select'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = agents.length ? opts : none;
  });
}

async function ensureKeypair() {
  if (!state.keypair) state.setKeypair(await generateKeypair());
  return state.keypair;
}

async function createMandate() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('del-agent-select')?.value;
  if (!agentId) { alert('Select an agent.'); return; }
  const agent = state.getAgent(agentId);
  const humanId = agent?.humanId || uuid();

  const domain = document.getElementById('del-domain')?.value || 'procurement';
  const actions = (document.getElementById('del-actions')?.value || 'negotiate,compare,recommend')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);
  const validHours = parseInt(document.getElementById('del-validity-hours')?.value) || 72;

  const mandateId = uuid();
  const mandate = {
    _spec_ref: 'DCP-09 \u00a74.1',
    dcp_version: '2.0',
    mandate_id: mandateId,
    session_nonce: sessionNonce(),
    human_id: humanId,
    agent_id: agentId,
    authority_scope: [
      {
        domain,
        actions_permitted: actions,
        data_classes: ['contact_info', 'financial_data'],
        limits: { max_transaction_value: 10000 },
      },
    ],
    valid_from: isoNow(),
    valid_until: isoFuture(validHours),
    revocable: true,
    timestamp: isoNow(),
  };

  mandate.human_composite_sig = await buildCompositeSig(mandate, 'DCP-AI.v2.DelegationMandate', kp);

  state.mandates.set(mandateId, mandate);
  state.addArtifact({ _type: 'delegation_mandate', ...mandate });
  renderJson('del-mandate-output', mandate);

  // Render delegation chain
  renderDelegationChain('del-chain-viz', [
    { type: 'human', id: humanId, scope: 'Full authority' },
    { type: 'agent', id: agentId, scope: domain + ': ' + actions.join(', ') },
  ]);
}

async function createAdvisory() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('del-agent-select')?.value;
  if (!agentId) { alert('Select an agent.'); return; }
  const agent = state.getAgent(agentId);

  const advisory = {
    _spec_ref: 'DCP-09 \u00a74.3',
    dcp_version: '2.0',
    declaration_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agentId,
    human_id: agent?.humanId || uuid(),
    significance_score: parseInt(document.getElementById('del-significance')?.value) || 750,
    action_summary: document.getElementById('del-advisory-summary')?.value || 'Vendor proposal exceeds pre-approved budget threshold',
    recommended_response: document.getElementById('del-advisory-recommend')?.value || 'Review and approve expanded budget before proceeding',
    response_deadline: isoFuture(4),
    human_response: null,
    proceeded_without_response: false,
    timestamp: isoNow(),
  };

  advisory.composite_sig = await buildCompositeSig(advisory, 'DCP-AI.v2.AdvisoryDeclaration', kp);

  state.addArtifact({ _type: 'advisory_declaration', ...advisory });
  renderJson('del-advisory-output', advisory);
}

async function createMirror() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('del-agent-select')?.value;
  if (!agentId) { alert('Select an agent.'); return; }
  const agent = state.getAgent(agentId);

  const mirror = {
    _spec_ref: 'DCP-09 \u00a74.4',
    dcp_version: '2.0',
    mirror_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agentId,
    human_id: agent?.humanId || uuid(),
    period: {
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: isoNow(),
    },
    narrative: document.getElementById('del-mirror-narrative')?.value || 'Agent managed procurement workflow: evaluated 3 vendor proposals, conducted 2 negotiation rounds, and prepared comparison report for principal review.',
    action_count: 47,
    decision_summary: 'Completed vendor evaluation within delegated scope. One advisory issued for budget threshold. All actions within mandate parameters.',
    audit_chain_hash: await sha256('audit-chain-' + agentId),
    timestamp: isoNow(),
  };

  mirror.composite_sig = await buildCompositeSig(mirror, 'DCP-AI.v2.PrincipalMirror', kp);

  state.addArtifact({ _type: 'principal_mirror', ...mirror });
  renderJson('del-mirror-output', mirror);
}

async function createThreshold() {
  const kp = await ensureKeypair();
  const agentId = document.getElementById('del-agent-select')?.value;
  if (!agentId) { alert('Select an agent.'); return; }
  const agent = state.getAgent(agentId);

  // Build rules from form
  const rules = [];
  document.querySelectorAll('.threshold-rule-row').forEach(row => {
    const dim = row.querySelector('.thr-dimension')?.value;
    const op = row.querySelector('.thr-operator')?.value;
    const val = parseFloat(row.querySelector('.thr-value')?.value);
    const action = row.querySelector('.thr-action')?.value;
    if (dim && op && !isNaN(val) && action) {
      rules.push({ dimension: dim, operator: op, value: val, action_if_triggered: action });
    }
  });

  if (rules.length === 0) {
    rules.push(
      { dimension: 'risk_score', operator: 'gt', value: 500, action_if_triggered: 'notify' },
      { dimension: 'transaction_value', operator: 'gt', value: 5000, action_if_triggered: 'escalate' },
      { dimension: 'confidence', operator: 'lt', value: 0.7, action_if_triggered: 'block' }
    );
  }

  const threshold = {
    _spec_ref: 'DCP-09 \u00a74.5',
    dcp_version: '2.0',
    threshold_id: uuid(),
    session_nonce: sessionNonce(),
    agent_id: agentId,
    human_id: agent?.humanId || uuid(),
    threshold_rules: rules,
    timestamp: isoNow(),
  };

  threshold.composite_sig = await buildCompositeSig(threshold, 'DCP-AI.v2.AwarenessThreshold', kp);

  state._lastThreshold = threshold;
  state.addArtifact({ _type: 'awareness_threshold', ...threshold });
  renderJson('del-threshold-output', threshold);
}

function testThreshold() {
  const threshold = state._lastThreshold;
  if (!threshold) { alert('Create a threshold first.'); return; }

  const testValue = parseFloat(document.getElementById('del-test-value')?.value) || 600;
  const testDimension = document.getElementById('del-test-dimension')?.value || 'risk_score';

  const results = [];
  for (const rule of threshold.threshold_rules) {
    if (rule.dimension !== testDimension) continue;
    let triggered = false;
    switch (rule.operator) {
      case 'gt': triggered = testValue > rule.value; break;
      case 'lt': triggered = testValue < rule.value; break;
      case 'gte': triggered = testValue >= rule.value; break;
      case 'lte': triggered = testValue <= rule.value; break;
      case 'eq': triggered = testValue === rule.value; break;
    }
    results.push({ rule, triggered, action: triggered ? rule.action_if_triggered : 'none' });
  }

  const el = document.getElementById('del-test-output');
  if (el) {
    const html = results
      .map(r => {
        const color = r.triggered ? (r.action === 'block' ? 'var(--red)' : r.action === 'escalate' ? 'var(--yellow)' : 'var(--accent)') : 'var(--text-muted)';
        return `<div style="padding:0.5rem;border-left:3px solid ${color};margin:0.3rem 0;background:var(--surface);border-radius:0 var(--radius) var(--radius) 0">
          <strong style="color:${color}">${r.triggered ? 'TRIGGERED' : 'OK'}</strong>
          ${r.rule.dimension} ${r.rule.operator} ${r.rule.value} \u2192 ${r.action}
        </div>`;
      })
      .join('');
    el.innerHTML = html || '<div class="info-box">No rules match this dimension.</div>';
  }
}
