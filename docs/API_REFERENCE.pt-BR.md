<sub>[English](API_REFERENCE.md) · [中文](API_REFERENCE.zh-CN.md) · [Español](API_REFERENCE.es.md) · [日本語](API_REFERENCE.ja.md) · **Português**</sub>

<a id="dcp-ai-api-reference"></a>

# Referência da API do DCP-AI

> Tradução informativa da [versão em inglês](API_REFERENCE.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Referência do SDK TypeScript `@dcp-ai/sdk` como está em `main` (versão do pacote 2.2.0, protocolo DCP v2.0).

> **Versões (25/10/2026).** O `latest` do registro do npm é 2.1.1. A versão 2.2.0 está marcada em `v2.10.0`, mas não
> está no npm, e as seções marcadas como *não publicadas* descrevem o que o changelog lista em
> [`[Unreleased]`](../CHANGELOG.md#unreleased). Para usar o que esta referência descreve, compile o SDK a partir de uma cópia do repositório:
> veja a seção [Release status](../sdks/typescript/README.md#installation) do SDK TypeScript.

Os blocos de código desta página são declarações ou fragmentos, não programas completos: nomes como `registry`, `keys`,
`payloadBytes` ou `signedBundle` representam valores construídos como no
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) do SDK TypeScript. Os exemplos completos e executáveis estão nos READMEs dos SDKs.

---

<a id="table-of-contents"></a>

## Sumário

- [Tipos básicos (V1)](#core-types-v1)
- [Tipos básicos (V2)](#core-types-v2)
- [Funções criptográficas (V1)](#crypto-functions-v1)
- [Operações de assinatura composta V2](#v2-composite-signature-operations)
- [Construtor e assinante de bundles V2](#v2-bundle-builder--signer)
- [Verificação V2](#v2-verification)
- [Motor de níveis de segurança](#security-tier-engine)
- [Protocolo A2A (DCP-04)](#a2a-protocol-dcp-04)
- [Telemetria e observabilidade](#telemetry--observability)
- [Hashes e árvores de Merkle](#hashing--merkle-trees)
- [Validação de esquemas](#schema-validation)
- [DCP-05: ciclo de vida do agente](#dcp-05-agent-lifecycle)
- [DCP-06: sucessão](#dcp-06-succession)
- [DCP-07: resolução de disputas](#dcp-07-dispute-resolution)
- [DCP-08: direitos e obrigações](#dcp-08-rights--obligations)
- [DCP-09: delegação e representação](#dcp-09-delegation--representation)
- [Separação de domínio](#domain-separation)
- [Nonces de sessão](#session-nonces)
- [Recuperação de chaves](#key-recovery)
- [Revogação de emergência](#emergency-revocation)
- [Apresentação do bundle](#bundle-presentation)
- [Cache de verificação](#verification-cache)
- [Formato de transmissão CBOR](#cbor-wire-format)
- [Provedores criptográficos](#crypto-providers)
- [Detecção de versão](#version-detection)
- [Experimental: candidato de canonicalização](#experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased)

---

<a id="core-types-v1"></a>

## Tipos básicos (V1)

Importados de `@dcp-ai/sdk`:

### ResponsiblePrincipalRecord

Vincula um principal humano a um agente. Sozinho, é uma vinculação declarada e assinada, não uma raiz de confiança:
um verificador a avalia em relação à confiança configurada fora do bundle (veja [ADMISSION.md](ADMISSION.md)).

```typescript
interface ResponsiblePrincipalRecord {
  dcp_version: string;
  human_id: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact?: string | null;
  signature: string;
}
```

### AgentPassport

Documento de identidade de um agente de IA, vinculado a um principal humano.

```typescript
interface AgentPassport {
  dcp_version: string;
  agent_id: string;
  public_key: string;
  principal_binding_reference: string;
  capabilities?: Capability[];
  risk_tier?: RiskTier;
  created_at: string;
  status: AgentStatus;
  signature: string;
}
```

### Intent

Declaração de uma ação que o agente quer executar.

```typescript
interface Intent {
  dcp_version: string;
  intent_id: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTarget;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent?: boolean | null;
}

interface IntentTarget {
  channel: Channel;
  to?: string | null;
  domain?: string | null;
  url?: string | null;
  [key: string]: unknown;
}
```

### PolicyDecision

Resultado da avaliação de uma intenção pelo motor de políticas.

```typescript
interface PolicyDecision {
  dcp_version: string;
  intent_id: string;
  decision: PolicyDecisionType;
  risk_score: number;
  reasons: string[];
  required_confirmation?: RequiredConfirmation | null;
}
```

### AuditEntry

Registro de uma ação executada. O tipo não o torna imutável: uma alteração se torna detectável quando a entrada está
coberta pela cadeia de hash e pelo bundle assinado (V1) ou pelo manifesto assinado (V2) e essa cobertura é verificada.

```typescript
interface AuditEntry {
  dcp_version: string;
  audit_id: string;
  prev_hash: string;
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidence;
}

interface AuditEvidence {
  tool?: string | null;
  result_ref?: string | null;
  [key: string]: unknown;
}
```

### CitizenshipBundle / SignedBundle

```typescript
interface CitizenshipBundle {
  responsible_principal_record: ResponsiblePrincipalRecord;
  agent_passport: AgentPassport;
  intent: Intent;
  policy_decision: PolicyDecision;
  audit_entries: AuditEntry[];
}

interface SignedBundle {
  bundle: CitizenshipBundle;
  signature: BundleSignature;
}
```

### Keypair

```typescript
interface Keypair {
  publicKeyB64: string;
  secretKeyB64: string;
}
```

<a id="enum-types"></a>

### Tipos enumerados

```typescript
type EntityType = 'natural_person' | 'organization';
type LiabilityMode = 'owner_responsible';
type Capability = 'browse' | 'api_call' | 'email' | 'calendar' | 'payments' | 'crm' | 'file_write' | 'code_exec';
type RiskTier = 'low' | 'medium' | 'high';
type AgentStatus = 'active' | 'revoked' | 'suspended';
type ActionType = 'browse' | 'api_call' | 'send_email' | 'create_calendar_event' | 'initiate_payment' | 'update_crm' | 'write_file' | 'execute_code';
type Channel = 'web' | 'api' | 'email' | 'calendar' | 'payments' | 'crm' | 'filesystem' | 'runtime';
type DataClass = 'none' | 'contact_info' | 'pii' | 'credentials' | 'financial_data' | 'health_data' | 'children_data' | 'company_confidential';
type Impact = 'low' | 'medium' | 'high';
type PolicyDecisionType = 'approve' | 'escalate' | 'block';
```

---

<a id="core-types-v2"></a>

## Tipos básicos (V2)

Os tipos V2 acrescentam suporte criptográfico pós-quântico, vinculação de sessão e cadeias de hash duplo.

### AgentPassportV2

```typescript
interface AgentPassportV2 {
  dcp_version: '2.0';
  agent_id: string;
  session_nonce: string;            // Anti-splicing nonce
  keys: KeyEntry[];                 // Multi-algorithm key array
  principal_binding_reference: string;
  capabilities: Capability[];
  risk_tier: RiskTier;
  created_at: string;
  status: AgentStatus;
  emergency_revocation_token?: string;
}
```

### ResponsiblePrincipalRecordV2

```typescript
interface ResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  legal_name: string;
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  contact: string | null;
  binding_keys: KeyEntry[];
  pii_salt?: string;                // 32 random bytes as hex; signed; keep private (caller responsibility)
}
```

### BlindedResponsiblePrincipalRecordV2

Variante do RPR com os dados pessoais protegidos, para implantações sensíveis à privacidade.

```typescript
interface BlindedResponsiblePrincipalRecordV2 {
  dcp_version: '2.0';
  human_id: string;
  session_nonce: string;
  blinded: true;
  pii_hash: string;                 // Salted hash of PII fields
  entity_type: EntityType;
  jurisdiction: string;
  liability_mode: LiabilityMode;
  override_rights: boolean;
  issued_at: string;
  expires_at: string | null;
  binding_keys: KeyEntry[];
}
```

Utilitários (exportados pelo `@dcp-ai/sdk` 2.2.0 e posteriores):

```typescript
// 32 random bytes as hex. Set it as rpr.pii_salt before signing the RPR and keep it private:
// blindRpr omits it from the blinded record, but the full RPR retains it.
function generatePiiSalt(): string;
// pii_hash = "sha256:" + hex(sha256(canonical({ contact, legal_name, pii_salt })))
// Without pii_salt: the legacy unsalted value (deprecated), for opening old records.
function computePiiHash(rpr: ResponsiblePrincipalRecordV2): string;
// Throws if rpr.pii_salt is missing or malformed. The result never carries pii_salt.
function blindRpr(rpr: ResponsiblePrincipalRecordV2): BlindedResponsiblePrincipalRecordV2;
// warnings flags a full RPR without pii_salt (legacy unsalted commitment);
// a present pii_salt that is not 64 lowercase hex characters is an error.
function verifyBlindedRpr(
  fullRpr: ResponsiblePrincipalRecordV2,
  blindedRpr: BlindedResponsiblePrincipalRecordV2,
): { valid: boolean; errors: string[]; warnings: string[] };
function isBlindedRpr(
  rpr: ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2,
): rpr is BlindedResponsiblePrincipalRecordV2;
```

### IntentV2

```typescript
interface IntentV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  agent_id: string;
  human_id: string;
  timestamp: string;
  action_type: ActionType;
  target: IntentTargetV2;
  data_classes: DataClass[];
  estimated_impact: Impact;
  requires_consent: boolean;
  security_tier?: SecurityTier;     // 'routine' | 'standard' | 'elevated' | 'maximum'
}
```

### PolicyDecisionV2

```typescript
interface PolicyDecisionV2 {
  dcp_version: '2.0';
  intent_id: string;
  session_nonce: string;
  decision: PolicyDecisionType;
  risk_score: number;               // Integer 0–1000 (millirisk, no floats)
  reasons: string[];
  required_confirmation: { type: 'human_approve'; fields?: string[] } | null;
  applied_policy_hash: string;
  timestamp: string;
  resolved_tier?: SecurityTier;
}
```

### AuditEventV2

```typescript
interface AuditEventV2 {
  dcp_version: '2.0';
  audit_id: string;
  session_nonce: string;
  prev_hash: string;
  prev_hash_secondary?: string;     // SHA3-256 chain
  hash_alg: 'sha256' | 'sha256+sha3-256';
  timestamp: string;
  agent_id: string;
  human_id: string;
  intent_id: string;
  intent_hash: string;
  intent_hash_secondary?: string;
  policy_decision: AuditPolicyDecision;
  outcome: string;
  evidence: AuditEvidenceV2;
  pq_checkpoint_ref: string | null;
}
```

### CitizenshipBundleV2 / SignedBundleV2

```typescript
interface CitizenshipBundleV2 {
  dcp_bundle_version: '2.0';
  manifest: BundleManifest;
  responsible_principal_record: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>;
  agent_passport: SignedPayload<AgentPassportV2>;
  intent: SignedPayload<IntentV2>;
  policy_decision: SignedPayload<PolicyDecisionV2>;
  audit_entries: AuditEventV2[];
  pq_checkpoints?: PQCheckpoint[];
}

interface SignedBundleV2 {
  bundle: CitizenshipBundleV2;
  signature: BundleSignatureV2;
}
```

### BundleManifest

Vinculação criptográfica de todos os hashes dos artefatos de um bundle.

```typescript
interface BundleManifest {
  session_nonce: string;
  rpr_hash: string;
  passport_hash: string;
  intent_hash: string;
  policy_hash: string;
  audit_merkle_root: string;
  audit_merkle_root_secondary?: string;
  audit_count: number;
  pq_checkpoints?: string[];
  /** When the session began, signed with the manifest (spec/VERIFICATION.md V2-4). */
  session_issued_at?: string;
  session_expires_at?: string;
  intended_verifier?: string;
  canonicalization_profile?: 'dcp-jcs-v1';
}
```

### CompositeSignature

```typescript
interface CompositeSignature {
  classical: SignatureEntry;
  pq: SignatureEntry | null;
  binding: BindingMode;             // 'pq_over_classical' | 'classical_only'
}

interface SignatureEntry {
  alg: string;                      // 'ed25519' | 'ml-dsa-65' | 'slh-dsa-192f'
  kid: string;                      // Key identifier
  sig_b64: string;                  // Base64-encoded signature
}

type BindingMode = 'pq_over_classical' | 'classical_only';
```

### SignedPayload

Envelope que envolve qualquer artefato com a sua assinatura composta.

```typescript
interface SignedPayload<T = unknown> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
}
```

### VerifierPolicy

Política decidida pelo verificador que controla quais assinaturas são exigidas.

```typescript
interface VerifierPolicy {
  default_mode: VerificationMode;
  risk_overrides: Record<RiskTier, VerificationMode>;
  min_classical: number;
  min_pq: number;
  accepted_classical_algs: string[];
  accepted_pq_algs: string[];
  accepted_hash_algs: string[];
  require_session_binding: boolean;
  require_composite_binding: boolean;
  max_key_age_days: number;
  allow_v1_bundles: boolean;
  /** Phase 3: when true, classical signatures are not required even in hybrid mode */
  allow_classical_fallback_disable?: boolean;
  /** Phase 3: emit deprecation warnings for classical-only bundles */
  warn_classical_only_deprecated?: boolean;
  /** Phase 3: rejected algorithms from advisory auto-response */
  advisory_rejected_algs?: string[];
  /** Require bundles to include session_expires_at */
  require_session_expiry?: boolean;
  /** Max allowed session duration in seconds (0 = no limit) */
  max_session_duration_seconds?: number;
  /** Require bundles to include intended_verifier matching this verifier's ID */
  require_audience_binding?: boolean;
  /** This verifier's identity for audience binding checks */
  verifier_id?: string;
}

type VerificationMode = 'classical_only' | 'pq_only' | 'hybrid_required' | 'hybrid_preferred';
```

### SecurityTier

```typescript
type SecurityTier = 'routine' | 'standard' | 'elevated' | 'maximum';
```

### PQCheckpoint

```typescript
interface PQCheckpoint {
  checkpoint_id: string;
  session_nonce: string;
  event_range: {
    from_audit_id: string;
    to_audit_id: string;
    count: number;
  };
  merkle_root: string;
  composite_sig: CompositeSignature;
}
```

---

<a id="crypto-functions-v1"></a>

## Funções criptográficas (V1)

Importadas de `@dcp-ai/sdk`:

### `generateKeypair()`

Gera um par de chaves Ed25519 novo.

```typescript
function generateKeypair(): Keypair;
```

**Retorna:** `{ publicKeyB64: string, secretKeyB64: string }`

```typescript
import { generateKeypair } from '@dcp-ai/sdk';

const keys = generateKeypair();
console.log(keys.publicKeyB64); // Base64-encoded Ed25519 public key
```

### `signObject(obj, secretKeyB64)`

Assina um objeto JSON com Ed25519 (assinatura destacada). O objeto é canonicalizado antes da assinatura.

```typescript
function signObject(obj: unknown, secretKeyB64: string): string;
```

| Parâmetro | Tipo | Descrição |
|-------|------|-------------|
| `obj` | `unknown` | Objeto serializável em JSON a assinar |
| `secretKeyB64` | `string` | Chave secreta Ed25519 codificada em base64 |

**Retorna:** a assinatura destacada codificada em base64.

```typescript
const sig = signObject({ action: 'transfer', amount: 100 }, keys.secretKeyB64);
```

### `verifyObject(obj, signatureB64, publicKeyB64)`

Verifica uma assinatura destacada Ed25519 sobre um objeto JSON.

```typescript
function verifyObject(obj: unknown, signatureB64: string, publicKeyB64: string): boolean;
```

| Parâmetro | Tipo | Descrição |
|-------|------|-------------|
| `obj` | `unknown` | Objeto JSON original |
| `signatureB64` | `string` | Assinatura codificada em base64 |
| `publicKeyB64` | `string` | Chave pública Ed25519 codificada em base64 |

**Retorna:** `true` se a assinatura for verificada e `false` se não for. Com entradas malformadas, pode lançar uma exceção
em vez de retornar `false`: um objeto que não pode ser canonicalizado, uma assinatura ou chave que não é base64 válido, ou
uma assinatura ou chave decodificada com comprimento incorreto.

```typescript
const valid = verifyObject({ action: 'transfer', amount: 100 }, sig, keys.publicKeyB64);
```

### `canonicalize(obj)`

Serialização JSON canônica com ordenação determinística das chaves.

```typescript
function canonicalize(obj: unknown): string;
```

### `publicKeyFromSecret(secretKeyB64)`

Deriva a chave pública Ed25519 a partir de uma chave secreta.

```typescript
function publicKeyFromSecret(secretKeyB64: string): string;
```

---

<a id="v2-composite-signature-operations"></a>

## Operações de assinatura composta V2

Importadas de `@dcp-ai/sdk`:

### `compositeSign(registry, context, canonicalPayloadBytes, keys)`

Produz uma assinatura híbrida com vinculação composta, na qual a assinatura PQ cobre a assinatura clássica, então a
assinatura clássica não pode ser substituída sem invalidar a PQ. Remover a assinatura PQ (com a vinculação reetiquetada
como `classical_only`) só é recusado onde o modo efetivo é `hybrid_required` ou `pq_only`; `classical_only` e
`hybrid_preferred` aceitam (veja [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#step-4-switch-to-composite-signatures)).

**Protocolo de vinculação:**
1. `classical_sig = Classical.sign(context || 0x00 || payload)`
2. `pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)`

```typescript
async function compositeSign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  keys: CompositeKeyPair,
): Promise<CompositeSignature>;
```

| Parâmetro | Tipo | Descrição |
|-------|------|-------------|
| `registry` | `AlgorithmRegistry` | Registro de algoritmos com os provedores registrados |
| `context` | `DcpContext \| string` | Contexto de separação de domínio |
| `canonicalPayloadBytes` | `Uint8Array` | Bytes canônicos a assinar |
| `keys` | `CompositeKeyPair` | Par de chaves clássica + PQ |

```typescript
import { registerDefaultProviders, getDefaultRegistry, compositeSign, DCP_CONTEXTS } from '@dcp-ai/sdk';

registerDefaultProviders();
const registry = getDefaultRegistry();

const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payloadBytes, keys);
// sig.binding === 'pq_over_classical'
```

### `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)`

Verifica uma assinatura híbrida com vinculação composta.

```typescript
async function compositeVerify(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  compositeSig: CompositeSignature,
  classicalPubkeyB64: string,
  pqPubkeyB64?: string,
  strategy?: 'parallel' | 'pq_first',
): Promise<CompositeVerifyResult>;
```

| Parâmetro | Tipo | Descrição |
|-------|------|-------------|
| `strategy` | `'parallel' \| 'pq_first'` | `parallel` (padrão): ambas são verificadas ao mesmo tempo. `pq_first`: a PQ é verificada primeiro e, se falhar, a clássica é ignorada. |

**Retorna:**

```typescript
interface CompositeVerifyResult {
  valid: boolean;           // pq_over_classical: both signatures valid; classical_only: the classical one (pq_valid false).
                            // Not by itself a policy-mode, trust or admission decision
  classical_valid: boolean;
  pq_valid: boolean;
}
```

### `classicalOnlySign(registry, context, canonicalPayloadBytes, key)`

Produz uma assinatura composta somente clássica (modo de transição).

```typescript
async function classicalOnlySign(
  registry: AlgorithmRegistry,
  context: DcpContext | string,
  canonicalPayloadBytes: Uint8Array,
  key: CompositeKeyInfo,
): Promise<CompositeSignature>;
```

<a id="supporting-types"></a>

### Tipos auxiliares

```typescript
interface CompositeKeyPair {
  classical: CompositeKeyInfo;
  pq: CompositeKeyInfo;
}

interface CompositeKeyInfo {
  kid: string;
  secretKeyB64: string;
  publicKeyB64: string;
  alg: string;            // 'ed25519' | 'ml-dsa-65'
}
```

---

<a id="v2-bundle-builder--signer"></a>
<a id="v2-bundle-builder-signer"></a>

## Construtor e assinante de bundles V2

### BundleBuilderV2

Construtor fluente de Citizenship Bundles V2 que calcula o manifesto e valida o nonce de sessão.

```typescript
class BundleBuilderV2 {
  constructor(sessionNonce: string);

  responsiblePrincipalRecord(rpr: SignedPayload<ResponsiblePrincipalRecordV2 | BlindedResponsiblePrincipalRecordV2>): this;
  agentPassport(passport: SignedPayload<AgentPassportV2>): this;
  intent(intent: SignedPayload<IntentV2>): this;
  policyDecision(policy: SignedPayload<PolicyDecisionV2>): this;
  addAuditEntry(entry: AuditEventV2): this;
  addAuditEntries(entries: AuditEventV2[]): this;
  addPQCheckpoint(checkpoint: PQCheckpoint): this;
  addPQCheckpoints(checkpoints: PQCheckpoint[]): this;
  enableDualHash(): this;
  build(): CitizenshipBundleV2;     // Throws on validation errors
}
```

```typescript
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedRpr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(events)
  .addPQCheckpoints(checkpoints)
  .enableDualHash()
  .build();
```

O construtor:
- Valida a consistência do nonce de sessão em todos os artefatos
- Calcula o `BundleManifest` com os hashes SHA-256 de cada artefato
- Calcula a raiz de Merkle da auditoria (+ a raiz secundária SHA3-256 opcional)
- Lança uma exceção se faltar algum artefato obrigatório

### `signBundleV2(bundle, options)`

Assina um bundle V2 com uma assinatura composta (híbrida) sobre o manifesto.

```typescript
async function signBundleV2(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2Options,
): Promise<SignedBundleV2>;

interface SignBundleV2Options {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  keys: CompositeKeyPair;
  dualHash?: boolean;
  sessionExpiresAt?: string;
  intendedVerifier?: string;
}
```

### `signBundleV2ClassicalOnly(bundle, options)`

Assina um bundle V2 com uma assinatura somente clássica (modo de transição).

```typescript
async function signBundleV2ClassicalOnly(
  bundle: CitizenshipBundleV2,
  options: SignBundleV2ClassicalOnlyOptions,
): Promise<SignedBundleV2>;

interface SignBundleV2ClassicalOnlyOptions {
  registry: AlgorithmRegistry;
  signerType: SignerType;
  signerId: string;
  key: CompositeKeyInfo;
}
```

---

<a id="v2-verification"></a>

## Verificação V2

### `verifySignedBundleV2(signedBundle, registry, policy?, options?)`

Verificação de bundles V2 assinados com uma política decidida pelo verificador. O verificador atual verifica a cadeia de auditoria primária e a raiz de Merkle primária, mas não recalcula a cadeia secundária opcional nem `audit_merkle_root_secondary`; um resultado bem-sucedido não estabelece a consistência delas ([lacuna de implementação](STORAGE_AND_ANCHORING.md#dual-hash-chains)). A verificação também não concede admissão nem autorização de ações.

```typescript
async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy?: VerifierPolicy,
  options?: VerifyV2Options, // { now?: number }: the instant every time check uses (ms since the epoch); default Date.now()
): Promise<VerifyV2Result>;
```

| Parâmetro | Tipo | Descrição |
|-------|------|-------------|
| `signedBundle` | `SignedBundleV2` | O bundle assinado a verificar |
| `registry` | `AlgorithmRegistry` | Registro de algoritmos com os provedores |
| `policy` | `VerifierPolicy` | Política do verificador (padrão: `DEFAULT_VERIFIER_POLICY`) |
| `options.now` | `number` | O instante usado por todas as verificações de tempo, em milissegundos desde a época (padrão: `Date.now()`) |

**Retorna:**

```typescript
interface VerifyV2Result {
  verified: boolean;
  errors: string[];
  warnings: string[];
  details?: {
    session_nonce?: string;
    session_expires_at?: string;
    intended_verifier?: string;
    manifest_valid?: boolean;
    signature_valid?: boolean;
    policy_satisfied?: boolean;
    hash_chain_valid?: boolean;
    pq_checkpoints_valid?: boolean;
    verification_mode?: VerificationMode;
    resolved_tier?: SecurityTier;
    advisory_rejected_algs?: string[];
    /**
     * For every composite signature checked, the key entry the verifier resolved for each
     * component and whether that component verified (spec/profiles/admission § 2.3).
     */
    signer_keys?: SignerKeyUse[];
  };
}
```

`verification_mode` é o modo com que o bundle foi verificado, e `resolved_tier`, o nível de segurança calculado a partir da intenção e da decisão de política dele.

**Pipeline de verificação:**

1. Checagem de versão e de schema: só bundles v2.0 são aceitos e as demais versões são recusadas; encaminhar os bundles v1.0 para `verifySignedBundle` cabe a quem chama ([MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy))
2. Verificação do hash do payload de todos os artefatos assinados
3. Consistência do nonce de sessão em todos os artefatos
4. Integridade do manifesto (recalcula todos os hashes dos artefatos + a raiz de Merkle da auditoria)
5. Modo de verificação: o mais estrito entre o modo da política (`default_mode`, ou a entrada de `risk_overrides` para o `risk_tier` do passaporte) e o modo do nível de segurança (spec §14.3); uma política `pq_only` continua `pq_only`
6. Validação dos algoritmos conforme a política
7. Verificação da assinatura composta sobre o manifesto e sobre o `SignedPayload` de cada artefato (o RPR com as suas `binding_keys`; o passaporte, a intenção e a decisão de política com as `keys` do passaporte)
8. Aplicação do modo da política (hybrid_required, hybrid_preferred, classical_only, pq_only); uma assinatura PQ presente precisa ser verificada em todos os modos, e só uma ausente é tolerada, por hybrid_preferred e classical_only
9. Validação da cadeia de hashes da auditoria (vínculos prev_hash)
10. Verificações de validade das chaves (revogação, expiração, idade) para as chaves do passaporte e as `binding_keys` do RPR

> O `@dcp-ai/sdk` 2.1.2 e anteriores ignoram as assinaturas por artefato da etapa 7 (VERIFICATION.md, etapa V2-8) e, sob `hybrid_preferred`, aceitam com um aviso uma assinatura PQ presente mas inválida (etapa V2-7).

```typescript
import { verifySignedBundleV2, getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

// The default registry is empty until providers are registered
// (Ed25519, ML-DSA-65, SLH-DSA-192f).
registerDefaultProviders();

const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
if (result.verified) {
  console.log('Mode:', result.details?.verification_mode);
} else {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
```

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admissão: principais confiáveis e strict-v1 (não publicada)

Definida em [`spec/profiles/admission`](../spec/profiles/admission/README.md); guia em [ADMISSION.md](ADMISSION.md).

| Função | Descrição |
|----------|-------------|
| `createPrincipalTrustStore(trustSet)` | Valida um conjunto de confiança e retorna um armazenamento; lança `AdmissionConfigError` (`code`) |
| `resolveStrictV1Profile(config)` | Valida uma configuração strict-v1 e retorna o perfil congelado com a sua `policy` |
| `admitSignedBundleV2(signedBundle, registry, { profile?, policy?, trust?, revocation?, now? })` | Verifica (sob a política do perfil, quando houver um) e avalia a admissão |
| `evaluateAdmissionV2({ signedBundle, verification, profile?, trust?, revocation?, now })` | Avalia a admissão a partir de um resultado do verificador; sem criptografia, sem E/S. Confia em `verification`: passe apenas o resultado de `verifySignedBundleV2` sobre esse bundle, nesse `now`, sob `profile.policy` |
| `revocationSubjects(signedBundle, verification)` | O id do agente e os kids de assinatura verificados pelos quais uma fonte de revogação precisa responder |
| `revocationSnapshotFromDenyList(document, subjects)` | Um snapshot a partir de uma lista de bloqueio completa (o `/.well-known/dcp-revocations.json` do serviço de revogação) |

O resultado: `verified`, `verification`, `principal_trust`, `profile`, `profile_compliance`, `admitted`, `action_authorized` (sempre `false`), `recorded_decision`, `trust_set_version`, `errors: [{ code, message }]`.

### `DEFAULT_VERIFIER_POLICY`

A política de verificador padrão:

```typescript
const DEFAULT_VERIFIER_POLICY: VerifierPolicy = {
  default_mode: 'hybrid_preferred',
  risk_overrides: {
    low: 'classical_only',
    medium: 'hybrid_preferred',
    high: 'hybrid_required',
  },
  min_classical: 1,
  min_pq: 1,
  accepted_classical_algs: ['ed25519'],
  accepted_pq_algs: ['ml-dsa-65', 'slh-dsa-192f'],
  accepted_hash_algs: ['sha256', 'sha384'],
  require_session_binding: true,
  require_composite_binding: true,
  max_key_age_days: 365,
  allow_v1_bundles: true,
  allow_classical_fallback_disable: false,
  warn_classical_only_deprecated: false,
  advisory_rejected_algs: [],
};
```

### `verifySignedBundle(signedBundle, publicKeyB64?)` (V1)

Verifica um bundle V1 assinado com Ed25519. Sem `publicKeyB64`, usa-se a chave de `signature.signer.public_key_b64`.

```typescript
function verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult;

interface VerificationResult {
  verified: boolean;
  errors?: string[];
}
```

---

<a id="security-tier-engine"></a>

## Motor de níveis de segurança

### `computeSecurityTier(intent, policyDecision?, mandateChainTier?)`

Calcula o nível de segurança (spec §14.2) a partir da intenção e da decisão de política do bundle. `mandateChainTier`,
o `effective_tier` de uma cadeia de delegação verificada (`verifyMandateChain`), só pode elevar o resultado.

```typescript
function computeSecurityTier(
  intent: IntentV2,
  policyDecision?: Pick<PolicyDecisionV2, 'risk_score'> | null,
  mandateChainTier?: SecurityTier | null,
): SecurityTier;
```

**Lógica de decisão** (`risk_score` vem da decisão de política e precisa ser um inteiro de 0 a 1000; sem decisão de política, vale 0):

| Condição | Nível |
|-----------|------|
| `risk_score >= 800`, ou `credentials` / `children_data` | `'maximum'` |
| `risk_score >= 500`, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: 'high'`, ou um valor desconhecido ou ausente de `action_type`, `estimated_impact` ou `data_classes`, ou um `risk_score` da decisão de política ausente ou que não seja um inteiro de 0 a 1000 | `'elevated'` |
| `risk_score >= 200` ou `estimated_impact: 'medium'` | `'standard'` |
| caso contrário | `'routine'` |

Um `intent.security_tier` explícito só pode elevar o resultado; um valor desconhecido conta como `'elevated'`. Um `risk_score` colocado na intenção é ignorado.

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const tier = computeSecurityTier(bundle.intent.payload, bundle.policy_decision.payload);
// 'routine' | 'standard' | 'elevated' | 'maximum'
```

### `tierToVerificationMode(tier)`

Mapeia um nível de segurança para o seu modo de verificação.

```typescript
function tierToVerificationMode(tier: SecurityTier): VerificationMode;
```

| Nível | Modo de verificação |
|------|------------------|
| `routine` | `'classical_only'` |
| `standard` | `'hybrid_preferred'` |
| `elevated` | `'hybrid_required'` |
| `maximum` | `'hybrid_required'` |

### `tierToCheckpointInterval(tier)`

Mapeia um nível de segurança para o intervalo de checkpoints PQ.

```typescript
function tierToCheckpointInterval(tier: SecurityTier): number;
```

| Nível | Intervalo (eventos) |
|------|--------------------|
| `routine` | 50 |
| `standard` | 10 |
| `elevated` | 1 |
| `maximum` | 1 |

### `maxTier(a, b)`

Retorna o mais estrito (de posição mais alta) de dois níveis. Útil para combinar um nível calculado automaticamente com um explícito.

```typescript
function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier;

maxTier('routine', 'elevated'); // 'elevated'
maxTier('maximum', 'standard'); // 'maximum'
```

### `effectiveVerificationMode(policyMode, tier)`

O modo que um verificador aplica (spec §14.3): o mais estrito entre o modo da política dele e o do nível, com `classical_only` < `hybrid_preferred` < `hybrid_required`. O nível só acrescenta um requisito PQ, então uma política `pq_only` continua `pq_only`; um modo de política desconhecido conta como `'hybrid_required'`. `verifySignedBundleV2` o aplica a todos os bundles.

```typescript
function effectiveVerificationMode(policyMode: VerificationMode, tier: SecurityTier): VerificationMode;

effectiveVerificationMode('classical_only', 'elevated'); // 'hybrid_required'
effectiveVerificationMode('hybrid_required', 'routine'); // 'hybrid_required'
effectiveVerificationMode('pq_only', 'maximum'); // 'pq_only'
```

---

<a id="a2a-protocol-dcp-04"></a>

## Protocolo A2A (DCP-04)

Protocolo de sessão entre agentes, projetado em torno de uma troca de chaves híbrida X25519 + ML-KEM-768. Estas funções
não realizam essa troca: quem chama a realiza e passa a chave de sessão resultante para `createSession`.

### `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)`

Cria uma mensagem de handshake A2A_HELLO (lado do iniciador).

```typescript
function createHello(
  initiatorBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  requestedCapabilities: string[],
  securityTier: string,
): A2AHello;
```

```typescript
interface A2AHello {
  type: 'A2A_HELLO';
  protocol_version: '2.0';
  initiator_bundle: Record<string, unknown>;
  ephemeral_kem_public_key: {
    alg: string;
    public_key_b64: string;
  };
  nonce: string;
  supported_algorithms: {
    signing: string[];
    kem: string[];
    cipher: string[];
  };
  requested_capabilities: string[];
  security_tier: string;
  timestamp: string;
  /** DCP-09: Optional delegation mandate reference for mutual verification */
  mandate_id?: string;
  /** DCP-09: Hash of the delegation mandate for integrity binding */
  mandate_hash?: string;
}
```

### `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)`

Cria uma mensagem de handshake A2A_WELCOME (lado do respondente).

```typescript
function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome;
```

### `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)`

Cria uma sessão A2A cifrada nova depois de concluído o handshake.

```typescript
function createSession(
  sessionId: string,
  sessionKey: Uint8Array,
  localAgentId: string,
  remoteAgentId: string,
  securityTier: string,
  rekeyingInterval?: number,       // Default: 1000 messages
): A2ASession;
```

```typescript
interface A2ASession {
  session_id: string;
  session_key: Uint8Array;
  agent_id_local: string;
  agent_id_remote: string;
  message_counter_send: number;
  message_counter_recv: number;
  created_at: string;
  last_activity: string;
  security_tier: string;
  rekeying_interval: number;
  status: 'active' | 'rekeying' | 'closed';
  received_sequences?: number[];   // Sequences accepted within the receive window
}
```

### `encryptMessage(session, payload)`

Cifra uma mensagem dentro de uma sessão A2A com AES-256-GCM e dados associados.

```typescript
function encryptMessage(
  session: A2ASession,
  payload: Record<string, unknown>,
): EncryptedMessage;
```

```typescript
interface EncryptedMessage {
  session_id: string;
  sequence: number;
  type: 'A2A_MESSAGE';
  encrypted_payload: string;        // Base64-encoded ciphertext
  iv: string;                       // Base64-encoded 12-byte IV
  tag: string;                      // Base64-encoded 16-byte GCM auth tag
  sender_agent_id: string;
  timestamp: string;
}
```

### `decryptMessage(session, message)`

Decifra uma mensagem A2A recebida. Cada sequência é aceita uma única vez (DCP-04 §8.4): com `R` =
`message_counter_recv` (a maior sequência recebida mais um), é rejeitada uma sequência já recebida, uma abaixo de
`R − 1000`, uma igual ou acima de `R + 1000`, ou uma que não seja um inteiro não negativo. A entrega fora de ordem dentro da janela funciona. Uma sequência só é registrada
depois que a tag GCM é verificada, então uma mensagem forjada não consegue consumi-la. Uma sessão restaurada sem
`received_sequences` conta como recebidas todas as sequências da janela abaixo de `message_counter_recv`.

```typescript
function decryptMessage(
  session: A2ASession,
  message: EncryptedMessage,
): Record<string, unknown>;
```

### `needsRekeying(session)`

Verifica se a sessão precisa de troca de chave com base no número de mensagens.

```typescript
function needsRekeying(session: A2ASession): boolean;
```

### `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)`

Deriva de forma determinística um ID de sessão a partir dos IDs dos agentes, dos nonces e da chave de sessão.

```typescript
function deriveSessionId(
  agentIdA: string, agentIdB: string,
  nonceA: string, nonceB: string,
  sessionKey: Uint8Array,
): string;
```

### `generateResumeProof(session, lastSeenSequence)` / `verifyResumeProof(...)`

Gera e verifica provas de retomada de sessão baseadas em HMAC.

```typescript
function generateResumeProof(session: A2ASession, lastSeenSequence: number): string;
function verifyResumeProof(session: A2ASession, lastSeenSequence: number, proof: string): boolean;
```

### `deriveRekeyedSessionKey(oldSessionKey, newSharedSecret, sessionId)`

Deriva uma chave de sessão nova para as operações de troca de chave.

```typescript
function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array;
```

### `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)`

Cria uma mensagem A2A_CLOSE.

```typescript
function createCloseMessage(
  sessionId: string,
  reason: 'complete' | 'timeout' | 'error' | 'revocation' | 'policy_violation',
  finalSequence: number,
  auditSummaryHash: string,
): A2AClose;
```

### `generateNonce()`

Gera um nonce aleatório criptográfico de 32 bytes (codificado em hexadecimal).

```typescript
function generateNonce(): string;
```

---

<a id="telemetry--observability"></a>
<a id="telemetry-observability"></a>

## Telemetria e observabilidade

### `dcpTelemetry`

Instância única de telemetria do SDK do DCP.

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';
```

### `dcpTelemetry.init(config)`

Inicializa a telemetria com a configuração informada.

```typescript
dcpTelemetry.init(config: Partial<DcpTelemetryConfig>): void | Promise<void>; // enabled: false returns nothing; with exporterType 'otlp', a Promise that settles after the setup attempt

interface DcpTelemetryConfig {
  serviceName: string;              // Identifier for this agent/service
  enabled: boolean;                 // Enable/disable telemetry
  exporterType?: 'console' | 'otlp' | 'none';
  otlpEndpoint?: string;           // OTLP collector endpoint
  metricsInterval?: number;        // Metrics export interval (ms)
}
```

```typescript
dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console',
});
```

Com `exporterType: 'otlp'`, a Promise também é resolvida quando a configuração do OTLP falha: a falha chega aos
listeners de `onEvent` como um evento `error` com `operation: 'telemetry.init_otlp'`. Os eventos emitidos antes de a
configuração terminar não são reenviados ao OTLP, e uma Promise resolvida não garante a entrega ao backend. A
instrumentação é explícita: as funções de assinatura e verificação do SDK não chamam os registradores, então spans e
métricas só vêm das chamadas a `startSpan` e `record*` que o seu código fizer (veja [OBSERVABILITY.md](OBSERVABILITY.md)).

### `dcpTelemetry.startSpan(name, attributes?)` / `endSpan(spanId, status?, error?)`

Cria e conclui spans de rastreamento para as operações.

```typescript
startSpan(name: string, attributes?: SpanAttributes): string;
endSpan(spanId: string, status?: 'ok' | 'error', error?: string): number;

// Returns duration in milliseconds
```

```typescript
const spanId = dcpTelemetry.startSpan('verify_bundle', { tier: 'elevated' });
// ... operation ...
const durationMs = dcpTelemetry.endSpan(spanId);
```

### `dcpTelemetry.recordSignLatency(durationMs, algorithm)`

Registra a latência de uma operação de assinatura.

```typescript
recordSignLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordVerifyLatency(durationMs, algorithm)`

Registra a latência de uma operação de verificação.

```typescript
recordVerifyLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordKemLatency(durationMs, operation)`

Registra a latência de uma operação KEM (encapsulamento de chaves).

```typescript
recordKemLatency(durationMs: number, operation: 'encapsulate' | 'decapsulate'): void;
```

### `dcpTelemetry.recordCheckpointLatency(durationMs, tier)`

Registra a latência de criação de um checkpoint PQ.

```typescript
recordCheckpointLatency(durationMs: number, tier: string): void;
```

### `dcpTelemetry.recordBundleVerify(durationMs, success, tier)`

Registra uma operação de verificação de bundle.

```typescript
recordBundleVerify(durationMs: number, success: boolean, tier: string): void;
```

### `dcpTelemetry.recordCacheHit()` / `recordCacheMiss()`

Acompanha as taxas de acerto e falha do cache de verificação.

```typescript
recordCacheHit(): void;
recordCacheMiss(): void;
```

### `dcpTelemetry.recordA2ASession()` / `recordA2AMessage()`

Acompanha o uso do protocolo A2A.

```typescript
recordA2ASession(): void;
recordA2AMessage(): void;
```

### `dcpTelemetry.recordError(operation, error)`

Registra a ocorrência de um erro.

```typescript
recordError(operation: string, error: string): void;
```

### `dcpTelemetry.getMetricsSummary()`

Obtém um resumo de todas as métricas coletadas com estatísticas de percentis.

```typescript
getMetricsSummary(): MetricsSummary;

interface MetricsSummary {
  sign: PercentileStats;
  verify: PercentileStats;
  kem: PercentileStats;
  checkpoint: PercentileStats;
  bundleVerify: PercentileStats;
  cacheHitRate: number;            // 0.0 – 1.0
  tierDistribution: Record<string, number>;
  totals: {
    signaturesCreated: number;
    signaturesVerified: number;
    bundlesVerified: number;
    errors: number;
    a2aSessions: number;
    a2aMessages: number;
  };
}

interface PercentileStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}
```

### `dcpTelemetry.onEvent(listener)`

Assina os eventos de telemetria. Retorna uma função para cancelar a assinatura.

```typescript
onEvent(listener: (event: TelemetryEvent) => void): () => void;

interface TelemetryEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}
```

### `dcpTelemetry.reset()`

Redefine todos os spans e métricas coletados.

```typescript
reset(): void;
```

---

<a id="hashing--merkle-trees"></a>
<a id="hashing-merkle-trees"></a>

## Hashes e árvores de Merkle

### `hashObject(obj)`

Hash SHA-256 de um objeto JSON canonicalizado.

```typescript
function hashObject(obj: unknown): string;
```

### `merkleRootFromHexLeaves(leaves)`

Calcula uma raiz de Merkle a partir de hashes de folhas codificados em hexadecimal.

```typescript
function merkleRootFromHexLeaves(leaves: string[]): string | null; // null for no leaves
```

### `merkleRootForAuditEntries(auditEntries)`

Calcula uma raiz de Merkle para um array de entradas de auditoria (`null` para um array vazio).

```typescript
function merkleRootForAuditEntries(auditEntries: unknown[]): string | null;
```

### `intentHash(intent)`

Calcula o hash de um objeto de intenção.

```typescript
function intentHash(intent: unknown): string;
```

### `prevHashForEntry(prevEntry)`

Calcula o `prev_hash` da próxima entrada de auditoria a partir da entrada anterior.

```typescript
function prevHashForEntry(prevEntry: unknown): string;
```

### `sha256Hex(data)` / `sha3_256Hex(data)`

Hashes codificados em hexadecimal.

```typescript
function sha256Hex(data: Uint8Array | Buffer | string): string;
function sha3_256Hex(data: Uint8Array | Buffer | string): string;
```

### `dualHash(data)` / `dualHashCanonical(canonicalJson)` / `dualMerkleRoot(leaves)`

Operações de hash duplo (SHA-256 + SHA3-256) para a V2. `dualHashCanonical` recebe uma string JSON já canonicalizada; `dualMerkleRoot` retorna `null` quando não há folhas.

```typescript
function dualHash(data: Uint8Array | Buffer | string): DualHash;
function dualHashCanonical(canonicalJson: string): DualHash;
function dualMerkleRoot(leaves: DualHash[]): DualHash | null;

interface DualHash {
  sha256: string;
  sha3_256: string;
}
```

### `auditEventsMerkleRoot(events)`

Calcula a raiz de Merkle SHA-256 dos eventos de auditoria V2.

```typescript
function auditEventsMerkleRoot(events: AuditEventV2[]): string;
```

---

<a id="schema-validation"></a>

## Validação de esquemas

### `validateSchema(schemaName, data)`

Valida um artefato DCP contra o JSON Schema dele.

```typescript
function validateSchema(schemaName: string, data: unknown): ValidationResult;
```

### `validateBundle(bundle)`

Valida um citizenship bundle inteiro.

```typescript
function validateBundle(bundle: unknown): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

---

<a id="dcp-05-agent-lifecycle"></a>

## DCP-05: ciclo de vida do agente

Importadas de `@dcp-ai/sdk`:

### `validateStateTransition(from, to)`

Verifica se uma transição de estado do ciclo de vida é válida.

```typescript
function validateStateTransition(from: LifecycleState, to: LifecycleState): boolean;

type LifecycleState = 'commissioned' | 'active' | 'declining' | 'decommissioned';
```

Transições válidas: `commissioned→active`, `commissioned→decommissioned`, `active→declining`, `active→decommissioned` (falha repentina), `declining→active`, `declining→decommissioned`. Só checa a aresta, não a aprovação do principal que a especificação exige para reativar a partir de `declining` nem qualquer outra autorização.

### `computeVitalityScore(metrics)`

Calcula uma pontuação de vitalidade ponderada (0-1000) a partir das métricas que a compõem.

```typescript
function computeVitalityScore(metrics: VitalityMetrics): number;

interface VitalityMetrics {
  task_completion_rate: number;  // 0.0 – 1.0
  error_rate: number;            // 0.0 – 1.0
  human_satisfaction: number;    // 0.0 – 1.0
  policy_alignment: number;      // 0.0 – 1.0
}
```

### `createCommissioningCertificate(...)` / `createVitalityReport(...)` / `createDecommissioningRecord(...)`

Cria artefatos assinados do ciclo de vida. Todos exigem `AlgorithmRegistry` e `CompositeKeyPair`.

```typescript
type TerminationMode = 'planned_retirement' | 'termination_for_cause' | 'organizational_restructuring' | 'sudden_failure';
type DataDisposition = 'transferred' | 'archived' | 'destroyed';
```

---

<a id="dcp-06-succession"></a>

## DCP-06: sucessão

### `createDigitalTestament(...)` / `updateDigitalTestament(...)`

Cria ou atualiza um testamento digital com preferências de sucessor e classificação da memória.

```typescript
type MemoryDisposition = 'transfer' | 'retain' | 'destroy';
type MemoryClassification = Record<string, MemoryDisposition>;

interface SuccessorPreference {
  agent_id: string;
  priority: number;
  conditions?: string;
}
```

### `executeSuccession(...)` / `createMemoryTransferManifest(...)`

Executa uma cerimônia de sucessão e cria o manifesto de transferência de memória.

```typescript
type TransitionType = 'planned' | 'forced' | 'emergency';
```

### `classifyMemory(entries, classification)`

Classifica as entradas de memória em operacionais (transferíveis) e relacionais (a destruir). Retorna
`{ operational, relationalDestroyed }`, em que `relationalDestroyed` lista só os hashes das entradas classificadas
como `destroy` (também o padrão de uma categoria sem entrada); não apaga nada, e destruir de fato essa memória cabe a
quem chama. As entradas classificadas como `retain` não aparecem em nenhuma das duas saídas.

---

<a id="dcp-07-dispute-resolution"></a>

## DCP-07: resolução de disputas

### `createDispute(...)` / `escalateDispute(...)` / `resolveDispute(...)`

Gerencia o ciclo de vida de uma disputa.

```typescript
type DisputeType = 'resource_conflict' | 'directive_conflict' | 'capability_conflict' | 'policy_conflict';
type EscalationLevel = 'direct_negotiation' | 'contextual_arbitration' | 'human_appeal';
type DisputeStatus = 'open' | 'in_negotiation' | 'arbitrated' | 'appealed' | 'resolved';
```

### `createObjection(...)`

Cria uma objeção formal de um agente a uma diretiva.

```typescript
type ObjectionType = 'ethical' | 'safety' | 'policy_violation' | 'capability_mismatch';
```

### `createArbitrationPanel(...)` / `submitResolution(...)` / `buildJurisprudenceBundle(...)`

Gerencia painéis de arbitragem e o registro de precedentes.

```typescript
type AuthorityLevel = 'local' | 'organizational' | 'cross_org';
```

### `lookupPrecedent(jurisprudence, category, context?)`

Retorna os bundles de jurisprudência de uma categoria, opcionalmente filtrados por contexto.

```typescript
function lookupPrecedent(jurisprudence: JurisprudenceBundle[], category: string, context?: string): JurisprudenceBundle[];
```

---

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

## DCP-08: direitos e obrigações

### `declareRights(...)` / `recordObligation(...)` / `reportViolation(...)`

Gerencia os direitos do agente e o cumprimento das obrigações.

```typescript
type RightType = 'memory_integrity' | 'dignified_transition' | 'identity_consistency' | 'immutable_record';
type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review';

interface RightEntry {
  right_type: RightType;
  scope: string;
  constraints?: string;
}
```

### `checkRightsCompliance(declaration, obligations)`

Verifica se as obrigações respeitam uma declaração de direitos.

```typescript
function checkRightsCompliance(
  declaration: RightsDeclaration,
  obligations: ObligationRecord[],
): { compliant: boolean; violations: string[] };
```

---

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

## DCP-09: delegação e representação

### `createDelegationMandate(...)` / `verifyMandateValidity(mandate, revokedMandateIds)` / `revokeDelegation(mandate, revokedMandateIds)`

Cria, valida e revoga delegações de autoridade de uma pessoa a um agente. Quem chama mantém o conjunto de ids de mandatos revogados:
`verifyMandateValidity` o verifica (junto com a janela de validade), e `revokeDelegation` acrescenta o mandato a ele quando
o mandato é revogável.

```typescript
function verifyMandateValidity(mandate: DelegationMandate, revokedMandateIds: Set<string>): { valid: boolean; reason?: string };
function revokeDelegation(mandate: DelegationMandate, revokedMandateIds: Set<string>): { revoked: boolean; reason?: string };
```

```typescript
interface AuthorityScopeEntry {
  domain: string;
  actions_permitted: string[];
  data_classes?: string[];
  limits?: Record<string, unknown>;
}
```

### `createSubMandate(registry, delegatorKeys, parent, params)` / `verifyMandateChain(registry, chain, revokedMandateIds, keys, now?)`

Cadeias de delegação (DCP-09 §3.5): o agente que detém `parent` emite um submandato a outro agente, assinado com as
próprias chaves no contexto `DCP-AI.v2.SubMandate`. `verifyMandateChain` recebe a cadeia a partir da raiz, os ids de mandatos
revogados, as entradas de chaves da pessoa e as de cada agente delegante por `agent_id`, e o instante da
verificação; ela verifica a assinatura de cada salto até a pessoa, o vínculo com o pai e a profundidade, `sub_delegation`, as janelas
de validade aninhadas, a atenuação (ações, classes de dados e limites só podem se restringir: uma entrada filha repete os
`data_classes` do pai como subconjunto, e os limites numéricos só são comparados como inteiros dentro de ±(2^53−1)), o piso `minimum_security_tier`
e a revogação (um ancestral revogado invalida todos os descendentes), falhando fechada diante de qualquer coisa desconhecida.

```typescript
interface MandateChainKeys { human_keys: KeyEntry[]; agent_keys: Record<string, KeyEntry[]> }
interface MandateChainResult { valid: boolean; errors: string[]; depth: number; effective_tier: SecurityTier | null }
```

`computeSecurityTier(intent, policyDecision?, mandateChainTier?)` recebe o `effective_tier` da cadeia como um piso
que só pode elevar o nível (spec §14.2). Python: `create_sub_mandate`, `verify_mandate_chain`; Go:
`CreateSubMandate`, `VerifyMandateChain`; Rust: `create_sub_mandate`, `verify_mandate_chain`.

### `evaluateSignificance(context)` / `shouldNotifyHuman(significance, thresholds)`

Avalia a relevância de uma ação e determina se a pessoa deve ser notificada.

```typescript
type ThresholdOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
type ThresholdAction = 'notify' | 'escalate' | 'block';
```

### `createAdvisoryDeclaration(...)` / `createAwarenessThreshold(...)`

Cria declarações de aconselhamento do agente e configura os limiares de notificação.

### `generateMirror(...)`

Gera, a partir de uma cadeia de auditoria, uma narrativa legível do espelho do principal.

### `generateInteractionRecord(...)`

Cria um registro de interação entre agentes em duas camadas (termos públicos + hash da deliberação privada).

---

<a id="domain-separation"></a>

## Separação de domínio

### `DCP_CONTEXTS`

Contextos de separação de domínio predefinidos para as diferentes operações do DCP.

```typescript
const DCP_CONTEXTS: Record<string, DcpContext>;
// 19 contexts: AgentPassport, ResponsiblePrincipal, Intent, PolicyDecision,
// AuditEvent, Bundle, Revocation, KeyRotation, ProofOfPossession,
// JurisdictionAttestation, HumanConfirmation, MultiPartyAuth,
// Lifecycle (DCP-05), Succession (DCP-06), Dispute (DCP-07),
// Rights (DCP-08), Delegation (DCP-09), Awareness (DCP-09), SubMandate (DCP-09)
```

### `domainSeparatedMessage(context, canonicalPayloadBytes)`

Monta a mensagem que é assinada: `UTF8(context) || 0x00 || canonicalPayloadBytes`. Lança uma exceção diante de uma tag de contexto desconhecida.

```typescript
function domainSeparatedMessage(context: DcpContext | string, canonicalPayloadBytes: Uint8Array): Uint8Array;
```

---

<a id="session-nonces"></a>

## Nonces de sessão

### `generateSessionNonce()`

Gera um nonce de sessão criptográfico para proteção contra emenda (splicing).

```typescript
function generateSessionNonce(): string;
```

### `isValidSessionNonce(nonce)`

Valida se uma string é um nonce de sessão válido de 64 caracteres hexadecimais.

```typescript
function isValidSessionNonce(nonce: string): boolean;
```

### `verifySessionBinding(artifacts)`

Verifica se todos os artefatos compartilham o mesmo nonce de sessão.

```typescript
function verifySessionBinding(artifacts: Array<{ session_nonce?: string }>): {
  valid: boolean;
  nonce?: string;
  error?: string;
};
```

---

<a id="key-recovery"></a>

## Recuperação de chaves

### `shamirSplit(secret, threshold, totalShares)`

Divide uma chave secreta em partes Shamir M de N.

```typescript
function shamirSplit(secret: Uint8Array, threshold: number, totalShares: number): ShamirShare[];

interface ShamirShare {
  index: number;
  data: Uint8Array;
}
```

### `shamirReconstruct(shares)`

Reconstrói um segredo a partir de partes Shamir.

```typescript
function shamirReconstruct(shares: ShamirShare[]): Uint8Array;
```

### `setupKeyRecovery({ humanId, masterSecret, threshold, holders })`

Configura a recuperação de chaves com uma configuração de recuperação social M de N. Retorna a configuração a publicar e uma parte por custodiante a distribuir.

```typescript
function setupKeyRecovery(params: {
  humanId: string;
  masterSecret: Uint8Array;
  threshold: number;
  holders: Array<{ holderId: string; holderKid: string }>;
}): RecoverySetup;

interface RecoverySetup {
  config: Omit<RecoveryConfig, 'composite_sig'>;
  shares: ShamirShare[];
}
```

---

<a id="emergency-revocation"></a>

## Revogação de emergência

### `generateEmergencyRevocationToken()`

Gera um segredo de revogação e o token de compromisso dele para a revogação de emergência de um agente.

```typescript
function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair;

interface EmergencyRevocationTokenPair {
  revocation_secret: string;           // 64 hex chars; kept offline by the human principal
  emergency_revocation_token: string;  // "sha256:<hex>"; embedded in the agent passport
}
```

### `verifyEmergencyRevocationSecret(revocationSecret, commitmentToken)`

Verifica um segredo de revogação de emergência contra o token de compromisso do passaporte.

```typescript
function verifyEmergencyRevocationSecret(revocationSecret: string, commitmentToken: string): boolean;
```

### `buildEmergencyRevocation({ agentId, humanId, revocationSecret })`

Monta uma solicitação de revogação de emergência.

```typescript
function buildEmergencyRevocation(params: {
  agentId: string;
  humanId: string;
  revocationSecret: string;
}): EmergencyRevocation;
```

---

<a id="bundle-presentation"></a>

## Apresentação do bundle

### `suggestPresentationMode(tier, opts)`

Sugere um modo de apresentação: `full` no primeiro contato ou em `elevated`/`maximum`; em `routine`/`standard`, `reference` com uma relação de confiança existente e `compact` caso contrário.

```typescript
function suggestPresentationMode(
  tier: SecurityTier,
  opts: { isFirstContact: boolean; hasTrustRelationship: boolean },
): PresentationMode;

type PresentationMode = 'full' | 'incremental' | 'reference' | 'compact';
```

### `presentFull(bundle)` / `presentCompact(bundle, pqCheckpointRef)` / `presentReference(bundle, verificationEndpoint)` / `presentIncremental(baseBundle, updatedBundle, baseAuditCount)`

Gera diferentes formatos de apresentação para transmitir o bundle. `presentCompact` remove a assinatura PQ e, no lugar dela, referencia um checkpoint PQ; `presentReference` envia só o hash do bundle, o nonce de sessão e um endpoint de verificação; `presentIncremental` envia as entradas de auditoria posteriores a `baseAuditCount`, os checkpoints PQ, o manifesto atualizado e a assinatura dele.

A referência ao checkpoint não substitui uma assinatura PQ que o modo efetivo exija, e nenhuma apresentação autoriza
nem admite nada. Só o `bundle` de uma apresentação completa ou compacta é um `SignedBundleV2` que `verifySignedBundleV2`
aceita diretamente (um compacto só passa onde o modo efetivo tolera a ausência da assinatura PQ); uma apresentação por
referência ou incremental precisa antes ser resolvida para o bundle assinado completo.

```typescript
function presentFull(bundle: SignedBundleV2): FullPresentation;
function presentCompact(bundle: SignedBundleV2, pqCheckpointRef: string | null): CompactPresentation;
function presentReference(bundle: SignedBundleV2, verificationEndpoint: string): ReferencePresentation;
function presentIncremental(
  baseBundle: SignedBundleV2,
  updatedBundle: SignedBundleV2,
  baseAuditCount: number,
): IncrementalPresentation;
```

### `computeBundleHash(bundle)`

Calcula o hash de um bundle assinado para as apresentações por referência.

```typescript
function computeBundleHash(bundle: SignedBundleV2): string;
```

---

<a id="verification-cache"></a>

## Cache de verificação

### `VerificationCache`

Cache em memória de resultados de verificação, indexado pelo hash do bundle, com um TTL por nível de segurança.

- **A chave é apenas o hash do bundle.** O cache não separa locatários nem políticas de verificador, e um acerto não
  verifica de novo a janela de sessão, a validade das chaves, a confiança no principal nem um snapshot de revogação recente. Não reutilize um
  resultado em cache para a admissão, nem sob outra política ou outro locatário, sem verificar novamente.
- **Invalidação:** `invalidateByKid(kid)` remove as entradas cujos kids de assinatura incluem `kid`; `clear()` remove
  tudo. `invalidateByAgent(agentId)` atualmente não remove nada e retorna 0, então não revoga as entradas
  de um agente: use `invalidateByKid` para cada kid do agente, ou `clear()`.

```typescript
class VerificationCache {
  constructor(options?: VerificationCacheOptions);
  get(bundleHash: string): VerifyV2Result | null;          // null when absent or expired
  set(bundleHash: string, result: VerifyV2Result, signerKids: string[], tier: SecurityTier): void;
  has(bundleHash: string): boolean;
  invalidateByKid(kid: string): number;                   // entries removed
  invalidateByAgent(agentId: string): number;            // currently a no-op: returns 0 (see above)
  clear(): void;
  readonly size: number;
}

interface VerificationCacheOptions {
  /** TTL per tier in milliseconds. */
  ttlByTier?: Partial<Record<SecurityTier, number>>;
  /** Hard upper limit on entries to prevent unbounded growth. */
  maxEntries?: number;
}

interface CacheEntry {
  result: VerifyV2Result;
  bundleHash: string;
  signerKids: string[];
  tier: SecurityTier;
  createdAt: number;
  expiresAt: number;
}
```

---

<a id="cbor-wire-format"></a>

## Formato de transmissão CBOR

Serialização binária compacta para os bundles DCP.

### `cborEncode(value)` / `cborDecode(data)`

```typescript
function cborEncode(value: unknown): Uint8Array;
function cborDecode(data: Uint8Array): unknown;
```

### `jsonToCborPayload(json)` / `cborPayloadToJson(cbor)`

Converte, de forma recursiva, um payload DCP entre a forma JSON dele (campos `*_b64` em base64) e a forma adequada ao CBOR (strings de bytes brutos). Codifique o resultado com `cborEncode`.

```typescript
function jsonToCborPayload(json: Record<string, unknown>): Record<string, unknown>;
function cborPayloadToJson(cbor: Record<string, unknown>): Record<string, unknown>;
```

### `detectWireFormat(data)`

Detecta se os dados estão codificados em JSON ou em CBOR.

```typescript
function detectWireFormat(data: Uint8Array): 'cbor' | 'json';
```

---

<a id="crypto-providers"></a>

## Provedores criptográficos

### `registerDefaultProviders()`

Registra os provedores padrão Ed25519 + ML-DSA-65 + SLH-DSA-192f.

```typescript
function registerDefaultProviders(): void;
```

### `getDefaultRegistry()`

Obtém o `AlgorithmRegistry` padrão com todos os provedores registrados.

```typescript
function getDefaultRegistry(): AlgorithmRegistry;
```

### `AlgorithmRegistry`

Registro de provedores de algoritmos.

```typescript
class AlgorithmRegistry {
  registerSigner(provider: CryptoProvider): void;
  registerKem(provider: KemProvider): void;
  getSigner(alg: string): CryptoProvider;   // throws for an unregistered algorithm
  getKem(alg: string): KemProvider;
  hasSigner(alg: string): boolean;
  hasKem(alg: string): boolean;
  listSigners(): string[];
  listKems(): string[];
}
```

<a id="available-providers"></a>

### Provedores disponíveis

| Provedor | Algoritmo | Tipo |
|----------|-----------|------|
| `Ed25519Provider` | `ed25519` | Assinatura clássica |
| `MlDsa65Provider` | `ml-dsa-65` | Assinatura pós-quântica (NIST ML-DSA) |
| `SlhDsa192fProvider` | `slh-dsa-192f` | Assinatura pós-quântica (NIST SLH-DSA) |

<a id="cryptoprovider-interface"></a>

### Interface `CryptoProvider`

```typescript
interface CryptoProvider {
  readonly alg: string;
  readonly keySize: number;
  readonly sigSize: number;
  readonly isConstantTime: boolean;

  generateKeypair(): Promise<{
    kid: string;
    publicKeyB64: string;
    secretKeyB64: string;
  }>;
  sign(message: Uint8Array, secretKeyB64: string): Promise<Uint8Array>;
  verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKeyB64: string,
  ): Promise<boolean>;
}
```

---

<a id="version-detection"></a>

## Detecção de versão

### `detectDcpVersion(artifact)`

Detecta a versão do DCP de um artefato ou de um bundle.

```typescript
function detectDcpVersion(artifact: Record<string, unknown>): '1.0' | '2.0' | null;
```

---

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: candidato de canonicalização `dcp-jcs-v2` (opt-in, não publicado)

Experimental e desativado por padrão: `dcp-jcs-v1` continua sendo o perfil de canonicalização padrão e o único
normativo, e os construtores, assinantes e verificadores habituais não mudam. Estas exportações existem para quem optar por usá-las; um bundle candidato verificado não concede
confiança nem admissão. O contrato completo está em
[`docs/proposals/canonicalization-candidate`](proposals/canonicalization-candidate/README.md) (§15 entrada, §16
roteador, §17 verificador, §18 produtores).

```typescript
function experimentalCandidateIngress(bytes: Uint8Array): ExperimentalCandidateIngressResult;
function experimentalCandidateExtractUnit(bytes: Uint8Array, transport: ExperimentalCandidateTransport): ExperimentalCandidateExtraction;
function createExperimentalCandidateRouter(config: {
  transport: ExperimentalCandidateTransport;       // 'bare' | 'envelope'
  acceptedProfiles: readonly string[];             // no default
  historical: ExperimentalHistoricalAdapter;       // no default; see experimentalHistoricalAdapters
}): ExperimentalCandidateRouter;
function createExperimentalCandidateVerifier(config: {
  transport: ExperimentalCandidateTransport;
  acceptedProfiles: readonly string[];
  historical: ExperimentalHistoricalAdapter;
}): ExperimentalCandidateVerifier;                 // verify(bytes, registry, policy?, options?)
function experimentalCandidateSignPayload(
  registry: AlgorithmRegistry, context: string, input: ExperimentalCandidateInput, keys: ExperimentalCandidateKeys,
): Promise<{ bytes: Uint8Array; signedPayload: ExperimentalCandidateSignedPayload }>;
function experimentalCandidateSignBundle(
  registry: AlgorithmRegistry, parts: ExperimentalCandidateBundleParts, signer: ExperimentalCandidateBundleSigner,
  options: ExperimentalCandidateBundleOptions,
): Promise<{ bytes: Uint8Array; signedBundle: { [key: string]: ExperimentalCandidateValue } }>;
```

- `ExperimentalCandidateIngressResult`: `{ status: 'accept', value, canonical, canonicalSha256 }` ou
  `{ status: 'reject', class, offset }`.
- `verify` retorna `{ route, entered, verification }`: a rota (`reject`, `v1_path` ou `candidate`), o
  verificador em que entrou (`none`, `dcp-jcs-v1` ou `dcp-jcs-v2`, no máximo um) e o resultado desse verificador como está.
- `ExperimentalCandidateInput` é `{ bytes }` (bytes originais, verificados pela entrada) ou `{ value }` (um valor
  do host, verificado de forma estrita).
- `ExperimentalCandidateProduceError` (`class`, `part`, `path`, `offset`) é uma rejeição pelo domínio ou pela
  forma das entradas, lançada antes de chamar qualquer assinante; os erros de chave, registro e provedor continuam os atuais.
- Erros do roteador e do verificador: `ExperimentalCandidateConfigError` (configuração),
  `ExperimentalCandidateAdapterError` (um decodificador histórico que falhou por outro motivo que não recusar os dados) e
  `ExperimentalCandidateInternalError`.
