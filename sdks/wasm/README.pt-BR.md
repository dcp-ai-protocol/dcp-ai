<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# @dcp-ai/wasm — SDK WebAssembly v2.0

Módulo WebAssembly completo para o Digital Citizenship Protocol (DCP) v2.0, compilado a partir do SDK Rust. Fornece assinaturas compostas pós-quânticas, geração de chaves híbrida, encapsulamento de chave ML-KEM-768, hashing duplo, construção/verificação de bundles e cálculo de nível de segurança — tudo rodando diretamente no navegador ou Node.js, sem precisar de servidor.

## Instalação

```bash
npm install @dcp-ai/wasm
```

## Build

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**Requisitos:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) e o toolchain Rust com target `wasm32-unknown-unknown`.

## Início Rápido — Wrapper TypeScript

A forma recomendada de usar o SDK é pelo wrapper TypeScript ergonômico:

```typescript
import { initDcp } from '@dcp-ai/wasm';

const dcp = await initDcp();

// Generate hybrid Ed25519 + ML-DSA-65 keypair (here it signs for both the principal and the agent)
const keys = dcp.generateHybridKeypair();
const keyEntries = [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.public_key_b64,
  created_at: new Date().toISOString(), expires_at: null, status: 'active',
}));
const sessionNonce = dcp.generateSessionNonce();

// Sign each artifact under its own context
const sign = (context: string, payload: object) =>
  dcp.signPayload(
    context, { ...payload, session_nonce: sessionNonce },
    keys.classical.secret_key_b64, keys.classical.kid!,
    keys.pq.secret_key_b64, keys.pq.kid!,
  );

// Build a V2 bundle from the signed artifacts
const bundle = dcp.buildBundle({
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', { dcp_version: '2.0', human_id: 'alice', binding_keys: keyEntries /* ... */ }),
  passport: sign('DCP-AI.v2.AgentPassport', { dcp_version: '2.0', agent_id: 'agent-001', keys: keyEntries /* ... */ }),
  intent: sign('DCP-AI.v2.Intent', { dcp_version: '2.0', intent_id: 'intent-001' /* ... */ }),
  policy: sign('DCP-AI.v2.PolicyDecision', { dcp_version: '2.0', intent_id: 'intent-001', decision: 'approve' /* ... */ }),
  auditEntries: [],
  sessionNonce,
});

// Sign the bundle with composite signature
const signed = dcp.signBundle(
  bundle,
  keys.classical.secret_key_b64, keys.classical.kid!,
  keys.pq.secret_key_b64, keys.pq.kid!,
);

// Verify the signed bundle
const result = dcp.verifyBundle(signed);
console.log(result.verified);       // true
console.log(result.classical_valid); // true
console.log(result.pq_valid);       // true
```

## Referência de API

### Inicialização

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

Inicializa o módulo WASM. Deve ser chamado uma vez antes de usar qualquer API. Opcionalmente aceita uma URL customizada para o arquivo `.wasm`.

### Geração de Par de Chaves

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `generateEd25519Keypair()` | `KeypairResult` | Par de chaves clássico Ed25519 |
| `generateMlDsa65Keypair()` | `KeypairResult` | Par de chaves de assinatura pós-quântica ML-DSA-65 |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | Par de chaves de assinatura SLH-DSA-192f (baseado em hash stateless) |
| `generateHybridKeypair()` | `HybridKeypairResult` | Par de chaves híbrido Ed25519 + ML-DSA-65 em uma única chamada |

### Encapsulamento de Chave ML-KEM-768

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `mlKem768Keygen()` | `KemKeypairResult` | Gera par de chaves de encapsulamento/desencapsulamento ML-KEM-768 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | Encapsula um segredo compartilhado usando uma chave pública |
| `mlKem768Decapsulate(ct, sk)` | `string` | Desencapsula segredo compartilhado de um ciphertext (retorna hex) |

### Assinatura Composta

| Método | Descrição |
|--------|-----------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Assinatura híbrida completa (Ed25519 + ML-DSA-65) com vínculo `pq_over_classical` |
| `classicalOnlySign(context, payload, sk, kid)` | Assinatura Ed25519 apenas clássica (modo de transição) |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Assina e embala em um envelope `SignedPayload` |

### Verificação

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Verificação criptográfica de uma assinatura composta |
| `verifyBundle(signedBundle)` | `V2VerificationResult` | Verificação completa de bundle V2 (estrutura + crypto + cadeia de hash) |

### Operações de Hash

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `dualHash(data)` | `DualHash` | Hash duplo SHA-256 + SHA3-256 |
| `sha3_256(data)` | `string` | Hash SHA3-256 (hex) |
| `hashObject(obj)` | `string` | Hash SHA-256 de um objeto JSON |
| `dualMerkleRoot(leaves)` | `DualHash` | Merkle root duplo a partir de um array de folhas `DualHash` |

### Canonicalização e Separação de Domínio

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `canonicalize(value)` | `string` | Canonicalização `dcp-jcs-v1` (baseada na RFC 8785 JCS) |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Mensagem com separação de domínio (hex) |
| `deriveKid(alg, publicKeyB64)` | `string` | ID de chave determinístico a partir de algoritmo + chave pública |

### Sessão e Segurança

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `generateSessionNonce()` | `string` | Nonce aleatório de 256 bits (64 caracteres hex) |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | Verifica consistência de nonce entre artefatos |
| `computeSecurityTier(intent)` | `SecurityTierResult` | Calcula nível de segurança adaptativo (routine/standard/elevated/maximum) |

### Preparação de Payload

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `preparePayload(payload)` | `PreparedPayload` | Canonicaliza e faz hash de um payload |

### Construção e Assinatura de Bundle

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | Constrói um bundle V2 com manifesto a partir de artefatos assinados com `signPayload` |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | Assina um bundle com assinatura composta |

### Prova de Posse

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | Gera PoP para registro de chave |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | Verifica uma PoP |

### Utilitários

| Método | Retorna | Descrição |
|--------|---------|-----------|
| `detectVersion(value)` | `string \| null` | Detecta a versão do protocolo DCP a partir de um objeto JSON |

### Tipos DCP-05–09

O SDK WASM inclui interfaces TypeScript para todos os artefatos de DCP-05 a DCP-09, espelhando os tipos do SDK Rust:

| Spec | Interfaces |
|------|-----------|
| DCP-05 Lifecycle | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 Succession | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 Disputes | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 Rights | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 Delegation | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

Contextos de separação de domínio disponíveis via `domainSeparatedMessage()`: `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

## API de Baixo Nível

Você também pode usar as funções WASM brutas diretamente (sem o wrapper TypeScript):

```javascript
import init, {
  wasm_generate_hybrid_keypair,
  wasm_composite_sign,
  wasm_composite_verify,
  wasm_build_bundle,
  wasm_sign_bundle,
  wasm_verify_signed_bundle_v2,
  wasm_ml_kem_768_keygen,
  wasm_ml_kem_768_encapsulate,
  wasm_ml_kem_768_decapsulate,
  wasm_dual_hash,
  wasm_compute_security_tier,
} from '@dcp-ai/wasm/pkg';

await init();

const keys = JSON.parse(wasm_generate_hybrid_keypair());
// ... use raw functions, all return JSON strings
```

Veja [example.html](./example.html) para um demo interativo completo no navegador.

## Níveis de Segurança

O SDK calcula níveis de segurança adaptativos com base nos perfis de risco da intenção:

| Nível | Risk Score | Modo de Verificação | Intervalo do Checkpoint |
|-------|-----------|---------------------|-------------------------|
| `routine` | < 200 | `classical_only` | 50 |
| `standard` | 200–499 | `hybrid_preferred` | 10 |
| `elevated` | 500–799 ou dados PII/financeiros | `hybrid_required` | 1 |
| `maximum` | ≥ 800 ou credenciais/biometria | `hybrid_required` | 1 |

## Algoritmos Suportados

| Categoria | Algoritmo | Padrão |
|-----------|-----------|--------|
| Assinatura clássica | Ed25519 | RFC 8032 |
| Assinatura PQ | ML-DSA-65 | FIPS 204 |
| Assinatura PQ (stateless) | SLH-DSA-192f | FIPS 205 |
| Encapsulamento de chave PQ | ML-KEM-768 | FIPS 203 |
| Hashing | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| Canonicalização | `dcp-jcs-v1` | Baseado na RFC 8785 (JCS) |

## Desenvolvimento

### Pré-requisitos

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

### Executar testes Rust WASM

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

## Licença

Apache-2.0
