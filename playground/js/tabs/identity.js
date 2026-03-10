// playground/js/tabs/identity.js — Tab 1: Identity Generator (DCP-01)

import { generateKeypair } from '../core/crypto.js';
import { uuid, sessionNonce, isoNow, b64encode } from '../core/utils.js';
import { buildCompositeSig } from '../core/signature.js';
import { renderJson } from '../ui/json-render.js';
import { state } from '../core/state.js';

let secretRevealed = false;

export function init() {
  window.pg_generateKeypair = doGenerateKeypair;
  window.pg_toggleSecret = toggleSecretKey;
  window.pg_generateRPR = generateRPR;
  window.pg_generatePassport = generatePassport;
}

async function doGenerateKeypair() {
  const kp = await generateKeypair();
  state.setKeypair(kp);

  document.getElementById('pub-key-display').textContent = kp.pubB64;
  document.getElementById('sec-key-display').textContent = kp.secB64;
  document.getElementById('sec-key-display').style.filter = 'blur(4px)';
  document.getElementById('kid-display').textContent = kp.kid;
  document.getElementById('keypair-output').style.display = 'block';
  secretRevealed = false;
}

function toggleSecretKey(btn) {
  secretRevealed = !secretRevealed;
  const span = document.getElementById('sec-key-display');
  span.style.filter = secretRevealed ? 'none' : 'blur(4px)';
  btn.textContent = secretRevealed ? 'hide' : 'show';
}

async function generateRPR() {
  if (!state.keypair) await doGenerateKeypair();
  const kp = state.keypair;
  const nonce = sessionNonce();
  const rpr = {
    _spec_ref: 'DCP-01 \u00a74.1',
    dcp_version: '2.0',
    human_id: uuid(),
    session_nonce: nonce,
    legal_name: document.getElementById('rpr-name').value || 'Jane Doe',
    entity_type: document.getElementById('rpr-entity-type').value,
    jurisdiction: document.getElementById('rpr-jurisdiction').value || 'US-CA',
    liability_mode: 'owner_responsible',
    override_rights: true,
    issued_at: isoNow(),
    expires_at: null,
    contact: document.getElementById('rpr-contact').value || null,
    binding_keys: [
      {
        kid: kp.kid,
        alg: 'ed25519',
        public_key_b64: kp.pubB64,
        created_at: isoNow(),
        expires_at: null,
        status: 'active',
      },
    ],
  };

  const compositeSig = await buildCompositeSig(rpr, 'DCP-AI.v2.ResponsiblePrincipal', kp);
  rpr.composite_sig = compositeSig;
  state._lastRPR = rpr;
  state.addArtifact({ _type: 'rpr', ...rpr });
  renderJson('rpr-output', rpr);
}

async function generatePassport() {
  if (!state.keypair) await doGenerateKeypair();
  const kp = state.keypair;
  const nonce = state._lastRPR ? state._lastRPR.session_nonce : sessionNonce();
  const agentId = uuid();

  const passport = {
    _spec_ref: 'DCP-01 \u00a74.2',
    dcp_version: '2.0',
    agent_id: agentId,
    session_nonce: nonce,
    keys: [
      {
        kid: kp.kid,
        alg: 'ed25519',
        public_key_b64: kp.pubB64,
        created_at: isoNow(),
        expires_at: null,
        status: 'active',
      },
    ],
    principal_binding_reference: state._lastRPR ? state._lastRPR.human_id : uuid(),
    capabilities: Array.from(document.getElementById('passport-caps').selectedOptions).map(o => o.value),
    risk_tier: document.getElementById('passport-risk').value,
    created_at: isoNow(),
    status: 'active',
  };

  const compositeSig = await buildCompositeSig(passport, 'DCP-AI.v2.AgentPassport', kp);
  passport.composite_sig = compositeSig;
  state._lastPassport = passport;

  // Register agent in state
  state.createAgent({
    agentId,
    humanId: state._lastRPR ? state._lastRPR.human_id : passport.principal_binding_reference,
    capabilities: passport.capabilities,
    riskTier: passport.risk_tier,
  });

  state.addArtifact({ _type: 'passport', ...passport });
  renderJson('passport-output', passport);
}
