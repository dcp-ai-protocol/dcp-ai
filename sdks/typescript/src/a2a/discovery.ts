import { createHash, randomUUID } from 'crypto';

export interface AgentDirectoryEntry {
  agent_id: string;
  agent_name: string;
  capabilities: string[];
  bundle_endpoint: string;
  a2a_endpoint: string;
  a2a_transports: ('websocket' | 'grpc' | 'http2')[];
  security_tier_minimum: 'routine' | 'standard' | 'elevated' | 'maximum';
  supported_algorithms: {
    signing: string[];
    kem: string[];
  };
  status: 'active' | 'suspended' | 'revoked';
  updated_at: string;
}

export interface AgentDirectory {
  dcp_version: '2.0';
  organization: string;
  agents: AgentDirectoryEntry[];
  directory_signature?: {
    alg: string;
    kid: string;
    sig_b64: string;
  };
}

export function createAgentDirectory(organization: string, agents: AgentDirectoryEntry[]): AgentDirectory {
  return {
    dcp_version: '2.0',
    organization,
    agents,
  };
}

export function findAgentByCapability(directory: AgentDirectory, requiredCapabilities: string[]): AgentDirectoryEntry | null {
  return directory.agents.find(agent =>
    agent.status === 'active' &&
    requiredCapabilities.every(cap => agent.capabilities.includes(cap))
  ) ?? null;
}

export function findAgentById(directory: AgentDirectory, agentId: string): AgentDirectoryEntry | null {
  return directory.agents.find(a => a.agent_id === agentId && a.status === 'active') ?? null;
}

export function validateDirectoryEntry(entry: AgentDirectoryEntry): string[] {
  const errors: string[] = [];
  if (!entry.agent_id) errors.push('Missing agent_id');
  if (!entry.agent_name) errors.push('Missing agent_name');
  if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) errors.push('capabilities must be non-empty array');
  if (!entry.bundle_endpoint) errors.push('Missing bundle_endpoint');
  if (!entry.a2a_endpoint) errors.push('Missing a2a_endpoint');
  if (!['active', 'suspended', 'revoked'].includes(entry.status)) errors.push('Invalid status');
  return errors;
}
