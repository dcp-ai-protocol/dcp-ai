import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

export function generateKeys() {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
    publicKeyRaw: keyPair.publicKey,
    secretKeyRaw: keyPair.secretKey,
  };
}

export function generateHybridKeys() {
  const ed = nacl.sign.keyPair();
  const pqPublic = crypto.randomBytes(1952);
  const pqSecret = crypto.randomBytes(4032);
  return {
    classical: {
      publicKey: naclUtil.encodeBase64(ed.publicKey),
      secretKey: naclUtil.encodeBase64(ed.secretKey),
      publicKeyRaw: ed.publicKey,
      secretKeyRaw: ed.secretKey,
    },
    pq: {
      algorithm: 'ML-DSA-65',
      publicKey: naclUtil.encodeBase64(pqPublic),
      secretKey: naclUtil.encodeBase64(pqSecret),
      simulated: true,
    },
  };
}

function deriveKid(publicKeyB64) {
  return crypto
    .createHash('sha256')
    .update(publicKeyB64)
    .digest('hex')
    .slice(0, 16);
}

export function generateSessionNonce() {
  return crypto.randomBytes(32).toString('hex');
}

export function generateRPR(entityName, jurisdiction, keys, options = {}) {
  const now = new Date().toISOString();
  const kid = deriveKid(keys.publicKey || keys.classical?.publicKey);
  const sessionNonce = options.sessionNonce || generateSessionNonce();

  const revocationSecret = crypto.randomBytes(32);
  const revocationToken = crypto
    .createHash('sha256')
    .update(revocationSecret)
    .digest('hex');

  const keyEntries = [
    {
      kid,
      alg: 'ed25519',
      public_key_b64: keys.publicKey || keys.classical?.publicKey,
      created_at: now,
      expires_at: null,
      status: 'active',
    },
  ];

  if (keys.pq) {
    keyEntries.push({
      kid: deriveKid(keys.pq.publicKey),
      alg: 'ml-dsa-65',
      public_key_b64: keys.pq.publicKey,
      created_at: now,
      expires_at: null,
      status: 'active',
    });
  }

  return {
    dcp_version: '2.0',
    schema: 'responsible_principal_record_v2',
    human_id: `rpr:${crypto.randomUUID()}`,
    session_nonce: sessionNonce,
    entity_type: 'natural_person',
    entity_name: entityName,
    jurisdiction,
    binding_method: 'self_declared',
    binding_timestamp: now,
    keys: keyEntries,
    recovery: {
      method: 'shamir_sss',
      threshold: 2,
      total_shares: 3,
    },
    revocation_token: revocationToken,
    blinded: false,
  };
}

export function generatePassport(agentName, capabilities, jurisdiction, keys, rpr, options = {}) {
  const now = new Date().toISOString();
  const kid = deriveKid(keys.publicKey || keys.classical?.publicKey);
  const sessionNonce = options.sessionNonce || rpr.session_nonce || generateSessionNonce();

  const rprHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(rpr))
    .digest('hex');

  const keyEntries = [
    {
      kid,
      alg: 'ed25519',
      public_key_b64: keys.publicKey || keys.classical?.publicKey,
      created_at: now,
      expires_at: null,
      status: 'active',
    },
  ];

  if (keys.pq) {
    keyEntries.push({
      kid: deriveKid(keys.pq.publicKey),
      alg: 'ml-dsa-65',
      public_key_b64: keys.pq.publicKey,
      created_at: now,
      expires_at: null,
      status: 'active',
    });
  }

  const emergencyRevToken = `sha256:${crypto.randomBytes(32).toString('hex')}`;

  return {
    dcp_version: '2.0',
    schema: 'agent_passport_v2',
    agent_id: `agent:${crypto.randomUUID()}`,
    agent_name: agentName,
    session_nonce: sessionNonce,
    model: 'configurable',
    capabilities,
    owner_rpr_hash: `sha256:${rprHash}`,
    keys: keyEntries,
    created_at: now,
    status: 'active',
    liability_mode: 'delegated',
    jurisdiction,
    emergency_revocation_token: emergencyRevToken,
  };
}
