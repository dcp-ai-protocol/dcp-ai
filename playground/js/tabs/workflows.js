// playground/js/tabs/workflows.js — Tab 11: Cross-Spec Workflows

import { state } from '../core/state.js';
import { navigateTo } from '../ui/tabs.js';
import { renderJson } from '../ui/json-render.js';
import { notify } from '../ui/forms.js';

const WORKFLOWS = [
  {
    id: 'full-lifecycle',
    title: 'Full Agent Lifecycle',
    specs: 'DCP-01 + DCP-05 + DCP-06',
    desc: 'Create agent \u2192 Commission \u2192 Vitality monitoring \u2192 Decline \u2192 Testament \u2192 Succession \u2192 Decommission',
    steps: [
      { label: 'Generate Identity', tab: 'identity', action: 'pg_generateKeypair', desc: 'Generate Ed25519 keypair' },
      { label: 'Create RPR', tab: 'identity', action: 'pg_generateRPR', desc: 'Create Responsible Principal Record' },
      { label: 'Create Passport', tab: 'identity', action: 'pg_generatePassport', desc: 'Create Agent Passport' },
      { label: 'Commission Agent', tab: 'lifecycle', action: 'pg_commissionAgent', desc: 'Issue commissioning certificate (DCP-05)' },
      { label: 'Activate Agent', tab: 'lifecycle', action: () => window.pg_transitionAgent('active'), desc: 'Transition to active state' },
      { label: 'Vitality Report', tab: 'lifecycle', action: 'pg_generateVitality', desc: 'Generate vitality report (DCP-05)' },
      { label: 'Create Testament', tab: 'succession', action: 'pg_createTestament', desc: 'Prepare digital testament (DCP-06)' },
      { label: 'Decommission', tab: 'lifecycle', action: 'pg_decommissionAgent', desc: 'Decommission agent (DCP-05)' },
    ],
  },
  {
    id: 'delegated-dispute',
    title: 'Delegated Action with Dispute',
    specs: 'DCP-01 + DCP-09 + DCP-02 + DCP-07',
    desc: 'Delegate authority \u2192 Intent declaration \u2192 Conflict detected \u2192 Dispute filed \u2192 Resolution',
    steps: [
      { label: 'Generate Identity', tab: 'identity', action: 'pg_generateKeypair', desc: 'Generate keypair' },
      { label: 'Create RPR + Passport', tab: 'identity', action: async () => { await window.pg_generateRPR(); await window.pg_generatePassport(); }, desc: 'Create identity artifacts' },
      { label: 'Create Mandate', tab: 'delegation', action: 'pg_createMandate', desc: 'Delegate authority (DCP-09)' },
      { label: 'Set Thresholds', tab: 'delegation', action: 'pg_createThreshold', desc: 'Configure awareness thresholds' },
      { label: 'Build Intent', tab: 'builder', action: async () => { await window.pg_builderInit(); await window.pg_builderStep('intent'); }, desc: 'Declare intent (DCP-02)' },
      { label: 'File Dispute', tab: 'disputes', action: 'pg_fileDispute', desc: 'File dispute (DCP-07)' },
      { label: 'Resolve', tab: 'disputes', action: 'pg_resolveDispute', desc: 'Resolve dispute' },
    ],
  },
  {
    id: 'rights-violation',
    title: 'Rights Violation Escalation',
    specs: 'DCP-08 + DCP-07 + DCP-05',
    desc: 'Declare rights \u2192 Violation detected \u2192 Auto-file dispute \u2192 Escalation \u2192 Lifecycle impact',
    steps: [
      { label: 'Generate Identity', tab: 'identity', action: async () => { await window.pg_generateKeypair(); await window.pg_generateRPR(); await window.pg_generatePassport(); }, desc: 'Create identity' },
      { label: 'Commission', tab: 'lifecycle', action: 'pg_commissionAgent', desc: 'Commission agent' },
      { label: 'Declare Rights', tab: 'rights', action: 'pg_declareRights', desc: 'Declare agent rights (DCP-08)' },
      { label: 'Report Violation', tab: 'rights', action: 'pg_reportViolation', desc: 'Report rights violation \u2192 auto-dispute' },
      { label: 'View Dispute', tab: 'disputes', action: null, desc: 'Check auto-filed dispute in Disputes tab' },
      { label: 'Escalate', tab: 'disputes', action: 'pg_escalateDispute', desc: 'Escalate to arbitration' },
    ],
  },
  {
    id: 'principal-oversight',
    title: 'Principal Oversight',
    specs: 'DCP-09 + DCP-02 + DCP-03',
    desc: 'Configure thresholds \u2192 Agent acts \u2192 Advisory triggered \u2192 Principal mirror \u2192 Adjust mandate',
    steps: [
      { label: 'Generate Identity', tab: 'identity', action: async () => { await window.pg_generateKeypair(); await window.pg_generateRPR(); await window.pg_generatePassport(); }, desc: 'Create identity' },
      { label: 'Create Mandate', tab: 'delegation', action: 'pg_createMandate', desc: 'Delegate authority (DCP-09)' },
      { label: 'Set Thresholds', tab: 'delegation', action: 'pg_createThreshold', desc: 'Configure thresholds' },
      { label: 'Test Threshold', tab: 'delegation', action: 'pg_testThreshold', desc: 'Simulate threshold trigger' },
      { label: 'Issue Advisory', tab: 'delegation', action: 'pg_createAdvisory', desc: 'Agent issues advisory (DCP-09)' },
      { label: 'Principal Mirror', tab: 'delegation', action: 'pg_createMirror', desc: 'Generate principal mirror report' },
    ],
  },
];

let currentWorkflow = null;
let currentStepIdx = 0;

export function init() {
  window.pg_startWorkflow = startWorkflow;
  window.pg_workflowNext = workflowNext;
  window.pg_workflowReset = workflowReset;
  renderWorkflowList();
}

function renderWorkflowList() {
  const container = document.getElementById('workflow-list');
  if (!container) return;
  container.innerHTML = WORKFLOWS.map(
    w => `
    <div class="card" style="cursor:pointer" onclick="pg_startWorkflow('${w.id}')">
      <h3>${w.title}</h3>
      <div style="font-size:0.75rem;color:var(--accent);margin-bottom:0.5rem">${w.specs}</div>
      <p style="font-size:0.8rem;color:var(--text-dim)">${w.desc}</p>
      <div style="margin-top:0.5rem;font-size:0.72rem;color:var(--text-muted)">${w.steps.length} steps</div>
    </div>`
  ).join('');
}

function startWorkflow(id) {
  const wf = WORKFLOWS.find(w => w.id === id);
  if (!wf) return;
  currentWorkflow = wf;
  currentStepIdx = 0;
  renderWorkflowRunner();
}

function renderWorkflowRunner() {
  const container = document.getElementById('workflow-runner');
  if (!container || !currentWorkflow) return;

  const wf = currentWorkflow;
  const progress = ((currentStepIdx) / wf.steps.length) * 100;

  let html = `
    <div class="card">
      <h3>${wf.title}</h3>
      <div style="font-size:0.75rem;color:var(--accent);margin-bottom:1rem">${wf.specs}</div>
      <div class="progress-track" style="margin-bottom:1rem">
        <div class="progress-fill" style="width:${progress}%"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem">`;

  wf.steps.forEach((step, i) => {
    const done = i < currentStepIdx;
    const active = i === currentStepIdx;
    const color = done ? 'var(--accent)' : active ? 'var(--blue)' : 'var(--text-muted)';
    const bg = active ? 'var(--surface-hover)' : 'transparent';
    const icon = done ? '&#x2713;' : active ? '&#x25B6;' : (i + 1);

    html += `
      <div style="display:flex;align-items:center;gap:0.8rem;padding:0.6rem 0.8rem;border-radius:var(--radius);background:${bg};border-left:3px solid ${color}">
        <span style="width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;background:${color}22;color:${color};flex-shrink:0">${icon}</span>
        <div>
          <div style="font-size:0.85rem;font-weight:${active ? '600' : '400'};color:${active ? 'var(--text)' : 'var(--text-dim)'}">${step.label}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">${step.desc}</div>
        </div>
        ${active ? `<span class="tag tag-blue" style="margin-left:auto">${step.tab}</span>` : ''}
      </div>`;
  });

  const allDone = currentStepIdx >= wf.steps.length;
  html += `</div>`;

  if (allDone) {
    html += `<div class="info-box" style="margin-top:1rem;border-left-color:var(--accent)">Workflow complete! All ${wf.steps.length} steps executed successfully.</div>`;
  }

  html += `
      <div class="btn-group" style="margin-top:1rem">
        ${!allDone ? `<button class="btn btn-primary" onclick="pg_workflowNext()">Execute Step ${currentStepIdx + 1}: ${wf.steps[currentStepIdx]?.label || ''}</button>` : ''}
        <button class="btn btn-secondary" onclick="pg_workflowReset()">Back to Workflows</button>
      </div>
    </div>`;

  // Artifacts generated during this workflow
  html += `<div id="workflow-step-output"></div>`;
  container.innerHTML = html;
}

async function workflowNext() {
  if (!currentWorkflow || currentStepIdx >= currentWorkflow.steps.length) return;

  const step = currentWorkflow.steps[currentStepIdx];

  try {
    if (step.action) {
      if (typeof step.action === 'function') {
        await step.action();
      } else if (typeof window[step.action] === 'function') {
        await window[step.action]();
      }
    }
    currentStepIdx++;
    renderWorkflowRunner();
    notify(`Step ${currentStepIdx}/${currentWorkflow.steps.length}: ${step.label} complete`, 'success');
  } catch (e) {
    notify('Step failed: ' + e.message, 'error');
    console.error('Workflow step error:', e);
  }
}

function workflowReset() {
  currentWorkflow = null;
  currentStepIdx = 0;
  const runner = document.getElementById('workflow-runner');
  if (runner) runner.innerHTML = '';
  renderWorkflowList();
}
