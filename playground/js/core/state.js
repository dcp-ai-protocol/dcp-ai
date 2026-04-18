// playground/js/core/state.js — Central state (keypairs, agents, session)

import { uuid, sessionNonce, isoNow } from './utils.js';

class PlaygroundState extends EventTarget {
  constructor() {
    super();
    this.keypair = null;
    this.agents = new Map();
    this.currentAgentId = null;
    this.artifacts = [];
    this.workflows = new Map();
    this.builderState = {};
    this.disputes = new Map();
    this.mandates = new Map();
    this.rightsDeclarations = new Map();
  }

  setKeypair(kp) {
    this.keypair = kp;
    this.emit('keypair-change', kp);
  }

  createAgent(opts = {}) {
    const agentId = opts.agentId || uuid();
    const agent = {
      agentId,
      humanId: opts.humanId || uuid(),
      sessionNonce: sessionNonce(),
      state: opts.state || 'commissioned',
      createdAt: isoNow(),
      vitalityScore: opts.vitalityScore || 800,
      vitalityReports: [],
      name: opts.name || `Agent-${agentId.substring(0, 6)}`,
      capabilities: opts.capabilities || ['browse', 'api_call'],
      riskTier: opts.riskTier || 'low',
    };
    this.agents.set(agentId, agent);
    this.currentAgentId = agentId;
    this.emit('agent-created', agent);
    return agent;
  }

  getAgent(id) {
    return this.agents.get(id || this.currentAgentId);
  }

  getCurrentAgent() {
    return this.agents.get(this.currentAgentId);
  }

  setAgentState(agentId, newState) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const old = agent.state;
    agent.state = newState;
    this.emit('agent-state-change', { agentId, oldState: old, newState });
  }

  addArtifact(artifact) {
    this.artifacts.push(artifact);
    this.emit('artifact-created', artifact);
  }

  getArtifacts(type) {
    if (!type) return this.artifacts;
    return this.artifacts.filter(a => a._type === type);
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

export const state = new PlaygroundState();
