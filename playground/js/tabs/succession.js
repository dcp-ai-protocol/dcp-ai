// playground/js/tabs/succession.js — Tab 7: Succession & Inheritance (DCP-06)

import { uuid, sessionNonce, isoNow } from '../core/utils.js';
import { sha256, canonicalize, hashArtifact } from '../core/hash.js';
import { buildCompositeSig } from '../core/signature.js';
import { renderJson } from '../ui/json-render.js';
import { renderMemoryClassification } from '../ui/visualizations.js';
import { state } from '../core/state.js';
import { generateKeypair } from '../core/crypto.js';

export function init() {
  window.pg_createTestament = createTestament;
  window.pg_createMemoryManifest = createMemoryManifest;
  window.pg_executeSuccession = executeSuccession;
  populateSuccessionSelects();
  state.addEventListener('agent-created', () => populateSuccessionSelects());
}

function populateSuccessionSelects() {
  const agents = Array.from(state.agents.values());
  const opts = agents.map(a => `<option value="${a.agentId}">${a.name} (${a.state})</option>`).join('');
  const none = '<option value="">No agents available</option>';
  ['succ-predecessor', 'succ-successor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = agents.length ? opts : none;
  });
}

async function ensureKeypair() {
  if (!state.keypair) state.setKeypair(await generateKeypair());
  return state.keypair;
}

async function createTestament() {
  const kp = await ensureKeypair();
  const predSel = document.getElementById('succ-predecessor');
  const agent = predSel ? state.getAgent(predSel.value) : null;
  if (!agent) { alert('Select a predecessor agent.'); return; }

  const succSel = document.getElementById('succ-successor');
  const successorId = succSel ? succSel.value : null;

  const classification = {
    operational_knowledge: document.getElementById('succ-mem-operational')?.value || 'transfer',
    relational_context: document.getElementById('succ-mem-relational')?.value || 'retain',
    configuration: document.getElementById('succ-mem-config')?.value || 'transfer',
    ephemeral_cache: document.getElementById('succ-mem-ephemeral')?.value || 'destroy',
    credentials: document.getElementById('succ-mem-credentials')?.value || 'destroy',
  };

  const prevHash = state._lastTestament
    ? await sha256(canonicalize(state._lastTestament))
    : '0'.repeat(64);

  const testament = {
    _spec_ref: 'DCP-06 \u00a74.1',
    dcp_version: '2.0',
    agent_id: agent.agentId,
    session_nonce: sessionNonce(),
    created_at: isoNow(),
    last_updated: isoNow(),
    successor_preferences: successorId
      ? [{ agent_id: successorId, priority: 1, conditions: 'Default successor' }]
      : [],
    memory_classification: classification,
    human_consent_required: true,
    testament_version: (state._testamentVersion || 0) + 1,
    prev_testament_hash: prevHash,
  };

  testament.composite_sig = await buildCompositeSig(testament, 'DCP-AI.v2.DigitalTestament', kp);

  state._lastTestament = testament;
  state._testamentVersion = testament.testament_version;
  state.addArtifact({ _type: 'digital_testament', ...testament });
  renderJson('succ-testament-output', testament);
  renderMemoryClassification('succ-mem-viz', classification);
}

async function createMemoryManifest() {
  const kp = await ensureKeypair();
  const predSel = document.getElementById('succ-predecessor');
  const succSel = document.getElementById('succ-successor');
  if (!predSel?.value || !succSel?.value) { alert('Select both predecessor and successor.'); return; }

  const items = [
    { hash: await sha256('task-patterns'), category: 'operational', size: 2048 },
    { hash: await sha256('api-configs'), category: 'configuration', size: 512 },
    { hash: await sha256('workflow-rules'), category: 'operational', size: 1024 },
  ];

  const transferData = canonicalize(items);
  const transferHash = await sha256(transferData);

  const manifest = {
    _spec_ref: 'DCP-06 \u00a74.3',
    dcp_version: '2.0',
    session_nonce: sessionNonce(),
    predecessor_agent_id: predSel.value,
    successor_agent_id: succSel.value,
    timestamp: isoNow(),
    operational_memory: items,
    relational_memory_destroyed: ['user-preference-cache', 'conversation-context'],
    transfer_hash: { sha256: transferHash },
  };

  manifest.composite_sig = await buildCompositeSig(manifest, 'DCP-AI.v2.MemoryTransferManifest', kp);

  state._lastMemoryManifest = manifest;
  state.addArtifact({ _type: 'memory_transfer_manifest', ...manifest });
  renderJson('succ-manifest-output', manifest);
}

async function executeSuccession() {
  const kp = await ensureKeypair();
  const predSel = document.getElementById('succ-predecessor');
  const succSel = document.getElementById('succ-successor');
  if (!predSel?.value || !succSel?.value) { alert('Select both predecessor and successor.'); return; }

  const transType = document.getElementById('succ-transition-type')?.value || 'planned';

  const manifestHash = state._lastMemoryManifest
    ? await sha256(canonicalize(state._lastMemoryManifest))
    : '0'.repeat(64);

  const record = {
    _spec_ref: 'DCP-06 \u00a74.4',
    dcp_version: '2.0',
    predecessor_agent_id: predSel.value,
    successor_agent_id: succSel.value,
    session_nonce: sessionNonce(),
    timestamp: isoNow(),
    transition_type: transType,
    human_consent: null,
    ceremony_participants: [predSel.value, succSel.value, 'principal'],
    memory_transfer_manifest_hash: manifestHash,
  };

  record.composite_sig = await buildCompositeSig(record, 'DCP-AI.v2.SuccessionRecord', kp);

  // Update agent states
  const pred = state.getAgent(predSel.value);
  if (pred && pred.state !== 'decommissioned') {
    state.setAgentState(pred.agentId, 'decommissioned');
  }
  const succ = state.getAgent(succSel.value);
  if (succ && succ.state === 'commissioned') {
    state.setAgentState(succ.agentId, 'active');
  }

  state.addArtifact({ _type: 'succession_record', ...record });
  renderJson('succ-record-output', record);
  populateSuccessionSelects();
}
