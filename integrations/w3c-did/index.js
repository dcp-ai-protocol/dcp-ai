/**
 * DCP-AI ↔ W3C DID/VC Bridge
 * 
 * Converts between DCP artifacts and W3C Decentralized Identifiers
 * and Verifiable Credentials formats.
 */

/**
 * Convert a DCP Responsible Principal Record to a W3C DID Document.
 * @param {object} rpr - DCP Responsible Principal Record
 * @returns {object} W3C DID Document
 */
export function rprToDIDDocument(rpr) {
  const did = `did:dcp:${rpr.human_id.replace('rpr:', '')}`;
  
  const verificationMethods = (rpr.keys || []).map((key, i) => ({
    id: `${did}#key-${i}`,
    type: key.alg === 'ed25519' ? 'Ed25519VerificationKey2020' : 'PostQuantumVerificationKey2024',
    controller: did,
    publicKeyMultibase: `z${Buffer.from(key.public_key_b64, 'base64').toString('base64url')}`,
  }));

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed2519-2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: verificationMethods,
    authentication: verificationMethods.map(vm => vm.id),
    assertionMethod: verificationMethods.map(vm => vm.id),
    created: rpr.binding_timestamp,
    updated: new Date().toISOString(),
  };
}

/**
 * Convert a W3C DID Document back to a DCP RPR skeleton.
 * @param {object} didDoc - W3C DID Document
 * @returns {object} DCP Responsible Principal Record skeleton
 */
export function didDocumentToRPR(didDoc) {
  const humanId = `rpr:${didDoc.id.replace('did:dcp:', '')}`;
  
  const keys = (didDoc.verificationMethod || []).map(vm => {
    const alg = vm.type === 'Ed25519VerificationKey2020' ? 'ed25519' : 'ml-dsa-65';
    const publicKeyB64 = vm.publicKeyMultibase
      ? Buffer.from(vm.publicKeyMultibase.slice(1), 'base64url').toString('base64')
      : '';
    
    return {
      kid: '',
      alg,
      public_key_b64: publicKeyB64,
      created_at: didDoc.created || new Date().toISOString(),
      expires_at: null,
      status: 'active',
    };
  });

  return {
    dcp_version: '2.0',
    schema: 'responsible_principal_record_v2',
    human_id: humanId,
    entity_type: 'natural_person',
    entity_name: didDoc.id,
    jurisdiction: 'unknown',
    binding_method: 'did_import',
    binding_timestamp: didDoc.created || new Date().toISOString(),
    keys,
    blinded: false,
  };
}

/**
 * Convert a DCP Agent Passport to a W3C Verifiable Credential.
 * @param {object} passport - DCP Agent Passport
 * @param {string} issuerDid - DID of the credential issuer
 * @returns {object} W3C Verifiable Credential
 */
export function passportToVC(passport, issuerDid) {
  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://dcp-ai.dev/credentials/v2',
    ],
    type: ['VerifiableCredential', 'DCPAgentPassport'],
    issuer: issuerDid,
    issuanceDate: passport.created_at,
    credentialSubject: {
      id: `did:dcp:agent:${passport.agent_id.replace('agent:', '')}`,
      type: 'AIAgent',
      name: passport.agent_name,
      model: passport.model,
      capabilities: passport.capabilities,
      jurisdiction: passport.jurisdiction,
      liabilityMode: passport.liability_mode,
      ownerRprHash: passport.owner_rpr_hash,
      status: passport.status,
    },
  };
}

/**
 * Convert a W3C Verifiable Credential back to a DCP Agent Passport skeleton.
 * @param {object} vc - W3C Verifiable Credential
 * @returns {object} DCP Agent Passport skeleton
 */
export function vcToPassport(vc) {
  const subject = vc.credentialSubject;
  return {
    dcp_version: '2.0',
    schema: 'agent_passport_v2',
    agent_id: subject.id ? `agent:${subject.id.replace('did:dcp:agent:', '')}` : `agent:${crypto.randomUUID()}`,
    agent_name: subject.name || 'imported-agent',
    model: subject.model || 'unknown',
    capabilities: subject.capabilities || [],
    owner_rpr_hash: subject.ownerRprHash || '',
    keys: [],
    created_at: vc.issuanceDate || new Date().toISOString(),
    status: subject.status || 'active',
    liability_mode: subject.liabilityMode || 'delegated',
    jurisdiction: subject.jurisdiction || 'unknown',
  };
}

/**
 * Create a DCP-signed Verifiable Presentation wrapping a bundle.
 * @param {object} signedBundle - Signed DCP Citizenship Bundle
 * @param {string} holderDid - DID of the presentation holder
 * @returns {object} W3C Verifiable Presentation
 */
export function bundleToVP(signedBundle, holderDid) {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiablePresentation', 'DCPBundlePresentation'],
    holder: holderDid,
    verifiableCredential: [{
      type: ['VerifiableCredential', 'DCPCitizenshipBundle'],
      credentialSubject: {
        bundleVersion: signedBundle.bundle?.dcp_bundle_version || '2.0',
        manifestHash: signedBundle.signature?.manifest_hash,
        securityTier: signedBundle.bundle?.intent?.payload?.security_tier || 'standard',
      },
    }],
    dcpBundle: signedBundle,
    created: new Date().toISOString(),
  };
}
