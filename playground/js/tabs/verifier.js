// playground/js/tabs/verifier.js — Tab 3: Bundle Verifier

import { sha256, canonicalize, computeMerkleRoot } from '../core/hash.js';
import { verifyDetached } from '../core/crypto.js';
import { syntaxHighlight } from '../ui/json-render.js';
import { state } from '../core/state.js';

export function init() {
  window.pg_verifyBundle = verifyBundle;
  window.pg_loadSample = loadSampleBundle;
}

async function verifyBundle() {
  const input = document.getElementById('verify-input').value.trim();
  if (!input) { alert('Please paste a bundle JSON.'); return; }

  let parsed;
  try { parsed = JSON.parse(input); } catch (e) { alert('Invalid JSON: ' + e.message); return; }

  const checks = [];
  let bundle, signature;

  if (parsed.bundle && parsed.signature) {
    bundle = parsed.bundle;
    signature = parsed.signature;
  } else if (parsed.dcp_bundle_version) {
    bundle = parsed;
  }

  if (!bundle) {
    checks.push({ pass: false, text: 'Not a valid DCP bundle structure' });
  } else {
    checks.push({
      pass: bundle.dcp_bundle_version === '2.0',
      text: `Schema version: ${bundle.dcp_bundle_version || 'missing'}`,
    });

    const hasManifest = !!bundle.manifest;
    checks.push({ pass: hasManifest, text: 'Bundle manifest ' + (hasManifest ? 'present' : 'missing') });

    if (hasManifest) {
      const m = bundle.manifest;
      checks.push({
        pass: !!m.session_nonce,
        text: 'Session nonce: ' + (m.session_nonce ? m.session_nonce.substring(0, 12) + '...' : 'missing'),
      });

      // Check nonce format (should be 64-char hex)
      if (m.session_nonce) {
        const validNonce = /^[0-9a-f]{64}$/.test(m.session_nonce);
        checks.push({
          pass: validNonce,
          text: validNonce ? 'Session nonce format: valid (64-char hex)' : 'Session nonce format: UUID detected (should be 64-char hex)',
          warn: !validNonce,
        });
      }

      // RPR hash
      if (bundle.responsible_principal_record) {
        const payload = bundle.responsible_principal_record.payload || bundle.responsible_principal_record;
        const computed = 'sha256:' + await sha256(canonicalize(payload));
        const match = computed === m.rpr_hash;
        checks.push({ pass: match, text: 'RPR hash ' + (match ? 'matches manifest' : 'MISMATCH') });
      } else {
        checks.push({ pass: false, text: 'RPR missing' });
      }

      // Passport hash
      if (bundle.agent_passport) {
        const payload = bundle.agent_passport.payload || bundle.agent_passport;
        const computed = 'sha256:' + await sha256(canonicalize(payload));
        const match = computed === m.passport_hash;
        checks.push({ pass: match, text: 'Passport hash ' + (match ? 'matches manifest' : 'MISMATCH') });
      } else {
        checks.push({ pass: false, text: 'Agent Passport missing' });
      }

      // Intent hash
      if (bundle.intent) {
        const payload = bundle.intent.payload || bundle.intent;
        const computed = 'sha256:' + await sha256(canonicalize(payload));
        const match = computed === m.intent_hash;
        checks.push({ pass: match, text: 'Intent hash ' + (match ? 'matches manifest' : 'MISMATCH') });
      } else {
        checks.push({ pass: false, text: 'Intent missing' });
      }

      // Policy hash
      if (bundle.policy_decision) {
        const payload = bundle.policy_decision.payload || bundle.policy_decision;
        const computed = 'sha256:' + await sha256(canonicalize(payload));
        const match = computed === m.policy_hash;
        checks.push({ pass: match, text: 'Policy hash ' + (match ? 'matches manifest' : 'MISMATCH') });
      } else {
        checks.push({ pass: false, text: 'Policy Decision missing' });
      }

      // Audit Merkle root
      if (bundle.audit_entries && bundle.audit_entries.length > 0) {
        checks.push({ pass: true, text: `Audit entries: ${bundle.audit_entries.length} event(s)` });
        const merkle = await computeMerkleRoot(bundle.audit_entries);
        const match = ('sha256:' + merkle) === m.audit_merkle_root;
        checks.push({ pass: match, text: 'Audit Merkle root ' + (match ? 'matches manifest' : 'MISMATCH') });
        checks.push({
          pass: bundle.audit_entries.length === m.audit_count,
          text: `Audit count: ${bundle.audit_entries.length} (manifest says ${m.audit_count})`,
        });
      } else {
        checks.push({ pass: false, text: 'No audit entries found' });
      }
    }

    // Signature verification
    if (signature) {
      const hasSig = !!(signature.composite_sig);
      checks.push({ pass: hasSig, text: 'Bundle signature ' + (hasSig ? 'present' : 'missing') });
      checks.push({
        pass: !!signature.manifest_hash,
        text: 'Manifest hash in signature: ' + (signature.manifest_hash ? signature.manifest_hash.substring(0, 24) + '...' : 'missing'),
      });

      // Check composite_sig format (v2: { classical, pq, binding })
      if (signature.composite_sig) {
        const cs = signature.composite_sig;
        if (cs.classical && cs.hasOwnProperty('binding')) {
          checks.push({ pass: true, text: 'Composite signature format: v2 (classical/pq/binding)' });
        } else if (cs.entries) {
          checks.push({ pass: null, text: 'Composite signature format: legacy (entries[])' });
        }
      }

      if (signature.signer) {
        checks.push({ pass: true, text: `Signer: ${signature.signer.type} \u2014 ${(signature.signer.id || '').substring(0, 8)}...` });
      }

      // Manifest hash integrity
      if (signature.composite_sig && bundle.manifest) {
        const manifestCanonical = canonicalize(bundle.manifest);
        const computedManifestHash = 'sha256:' + await sha256(manifestCanonical);
        const mhMatch = computedManifestHash === signature.manifest_hash;
        checks.push({ pass: mhMatch, text: 'Manifest hash integrity ' + (mhMatch ? 'verified' : 'MISMATCH') });

        // Ed25519 signature verification
        const cs = signature.composite_sig;
        const entry = cs.classical || (cs.entries && cs.entries[0]);
        if (entry && entry.alg === 'ed25519' && bundle.agent_passport) {
          const passport = bundle.agent_passport.payload || bundle.agent_passport;
          const keyEntry = (passport.keys || []).find(k => k.kid === entry.kid);
          if (keyEntry) {
            try {
              const pubKey = nacl.util.decodeBase64(keyEntry.public_key_b64);
              const sigBytes = nacl.util.decodeBase64(entry.sig_b64);
              const valid = verifyDetached(manifestCanonical, 'DCP-AI.v2.Bundle', sigBytes, pubKey);
              checks.push({ pass: valid, text: 'Ed25519 signature ' + (valid ? 'VALID' : 'INVALID') });
            } catch (e) {
              checks.push({ pass: false, text: 'Signature verification error: ' + e.message });
            }
          } else {
            checks.push({ pass: null, text: 'Signer key not found in passport' });
          }
        }
      }
    } else {
      checks.push({ pass: null, text: 'No bundle-level signature (unsigned)' });
    }

    // Security tier
    if (bundle.intent) {
      const iPayload = bundle.intent.payload || bundle.intent;
      checks.push({ pass: true, text: `Security tier: ${iPayload.security_tier || 'unknown'}` });
    }
  }

  // Render results
  const listEl = document.getElementById('verify-checks');
  listEl.innerHTML = checks
    .map(c => {
      const icon =
        c.pass === true
          ? '<span class="check-icon check-pass">&#x2713;</span>'
          : c.pass === false
            ? '<span class="check-icon check-fail">&#x2717;</span>'
            : '<span class="check-icon check-warn">?</span>';
      return `<li>${icon} ${c.text}</li>`;
    })
    .join('');

  document.getElementById('verify-results').style.display = 'block';

  if (bundle && bundle.manifest) {
    const detailEl = document.getElementById('verify-detail-output');
    const json = JSON.stringify(bundle.manifest, null, 2);
    detailEl.innerHTML = `<div class="card"><h3>Manifest Detail</h3><div class="json-output"><button class="copy-btn" onclick="window.__copyJson(this)">Copy</button><pre>${syntaxHighlight(json)}</pre></div></div>`;
  }
}

async function loadSampleBundle() {
  // Trigger a full bundle build if none exists
  if (!state.builderState.signedBundle) {
    await window.pg_builderInit();
    await window.pg_builderStep('rpr');
    await window.pg_builderStep('passport');
    await window.pg_builderStep('intent');
    await window.pg_builderStep('policy');
    await window.pg_builderStep('audit');
    await window.pg_builderBuild();
  }
  if (state.builderState.signedBundle) {
    document.getElementById('verify-input').value = JSON.stringify(state.builderState.signedBundle, null, 2);
  }
}
