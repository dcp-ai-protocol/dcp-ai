<sub>[English](API_REFERENCE.md) · [中文](API_REFERENCE.zh-CN.md) · **Español** · [日本語](API_REFERENCE.ja.md) · [Português](API_REFERENCE.pt-BR.md)</sub>

<a id="dcp-ai-api-reference"></a>

# Referencia de la API de DCP-AI

> Traducción informativa de [la versión en inglés](API_REFERENCE.md), actualizada el 28/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Referencia del SDK de TypeScript `@dcp-ai/sdk` tal como está en `main` (versión del paquete 2.2.1, protocolo DCP v2.0).

> **Versiones npm (28/10/2026).** Esta referencia de TypeScript se aplica a `@dcp-ai/sdk` 2.2.1 publicado, incluida la confianza en el principal, `strict-v1` y las API experimentales opt-in del candidato. Véanse los [paquetes npm publicados](NPM_RELEASES.md) y las [instrucciones de instalación](../sdks/typescript/README.md#installation). `dcp-jcs-v1` sigue siendo el predeterminado normativo.

Los bloques de código de esta página son declaraciones o fragmentos, no programas completos: nombres como `registry`, `keys`,
`payloadBytes` o `signedBundle` representan valores construidos como en el
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) del SDK de TypeScript. Los ejemplos completos y ejecutables están en los README de los SDK.

---

<a id="table-of-contents"></a>

## Índice

- [Tipos básicos (V1)](#core-types-v1)
- [Tipos básicos (V2)](#core-types-v2)
- [Funciones criptográficas (V1)](#crypto-functions-v1)
- [Operaciones de firma compuesta V2](#v2-composite-signature-operations)
- [Constructor y firmante de bundles V2](#v2-bundle-builder--signer)
- [Verificación V2](#v2-verification)
- [Motor de niveles de seguridad](#security-tier-engine)
- [Protocolo A2A (DCP-04)](#a2a-protocol-dcp-04)
- [Telemetría y observabilidad](#telemetry--observability)
- [Hashes y árboles de Merkle](#hashing--merkle-trees)
- [Validación de esquemas](#schema-validation)
- [DCP-05: ciclo de vida del agente](#dcp-05-agent-lifecycle)
- [DCP-06: sucesión](#dcp-06-succession)
- [DCP-07: resolución de disputas](#dcp-07-dispute-resolution)
- [DCP-08: derechos y obligaciones](#dcp-08-rights--obligations)
- [DCP-09: delegación y representación](#dcp-09-delegation--representation)
- [Separación de dominio](#domain-separation)
- [Nonces de sesión](#session-nonces)
- [Recuperación de claves](#key-recovery)
- [Revocación de emergencia](#emergency-revocation)
- [Presentación del bundle](#bundle-presentation)
- [Caché de verificación](#verification-cache)
- [Formato de transmisión CBOR](#cbor-wire-format)
- [Proveedores criptográficos](#crypto-providers)
- [Detección de versión](#version-detection)
- [Experimental: candidato de canonicalización](#experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased)

---

<a id="core-types-v1"></a>

## Tipos básicos (V1)

Se importan de `@dcp-ai/sdk`:

### ResponsiblePrincipalRecord

Vincula un principal humano con un agente. Por sí solo es una vinculación declarada y firmada, no una raíz de confianza:
un verificador la evalúa frente a la confianza configurada fuera del bundle (véase [ADMISSION.md](ADMISSION.md)).

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

Documento de identidad de un agente de IA, vinculado a un principal humano.

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

Declaración de una acción que el agente quiere realizar.

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

Resultado de la evaluación de una intención por el motor de políticas.

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

Registro de una acción ejecutada. El tipo no lo hace inmutable: una alteración se vuelve detectable cuando la entrada
está cubierta por la cadena de hash y el bundle firmado (V1) o el manifiesto firmado (V2) y esa cobertura se verifica.

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

Los tipos V2 añaden soporte criptográfico poscuántico, vinculación de sesión y cadenas de doble hash.

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

Variante del RPR con los datos personales protegidos, para despliegues sensibles a la privacidad.

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

Utilidades (exportadas por `@dcp-ai/sdk` 2.2.0 y posteriores):

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

Vinculación criptográfica de todos los hashes de los artefactos de un bundle.

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

Sobre que envuelve cualquier artefacto con su firma compuesta.

```typescript
interface SignedPayload<T = unknown> {
  payload: T;
  payload_hash: string;
  composite_sig: CompositeSignature;
}
```

### VerifierPolicy

Política decidida por el verificador que controla qué firmas se exigen.

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

## Funciones criptográficas (V1)

Se importan de `@dcp-ai/sdk`:

### `generateKeypair()`

Genera un par de claves Ed25519 nuevo.

```typescript
function generateKeypair(): Keypair;
```

**Devuelve:** `{ publicKeyB64: string, secretKeyB64: string }`

```typescript
import { generateKeypair } from '@dcp-ai/sdk';

const keys = generateKeypair();
console.log(keys.publicKeyB64); // Base64-encoded Ed25519 public key
```

### `signObject(obj, secretKeyB64)`

Firma un objeto JSON con Ed25519 (firma separada). El objeto se canonicaliza antes de firmarlo.

```typescript
function signObject(obj: unknown, secretKeyB64: string): string;
```

| Parámetro | Tipo | Descripción |
|-------|------|-------------|
| `obj` | `unknown` | Objeto serializable a JSON que se va a firmar |
| `secretKeyB64` | `string` | Clave secreta Ed25519 codificada en base64 |

**Devuelve:** la firma separada codificada en base64.

```typescript
const sig = signObject({ action: 'transfer', amount: 100 }, keys.secretKeyB64);
```

### `verifyObject(obj, signatureB64, publicKeyB64)`

Verifica una firma separada Ed25519 sobre un objeto JSON.

```typescript
function verifyObject(obj: unknown, signatureB64: string, publicKeyB64: string): boolean;
```

| Parámetro | Tipo | Descripción |
|-------|------|-------------|
| `obj` | `unknown` | Objeto JSON original |
| `signatureB64` | `string` | Firma codificada en base64 |
| `publicKeyB64` | `string` | Clave pública Ed25519 codificada en base64 |

**Devuelve:** `true` si la firma se verifica y `false` si no. Con entradas mal formadas puede lanzar una excepción en
lugar de devolver `false`: un objeto que no se puede canonicalizar, una firma o clave que no es base64 válido, o una firma
o clave decodificada con una longitud incorrecta.

```typescript
const valid = verifyObject({ action: 'transfer', amount: 100 }, sig, keys.publicKeyB64);
```

### `canonicalize(obj)`

Serialización JSON canónica con un orden de claves determinista.

```typescript
function canonicalize(obj: unknown): string;
```

### `publicKeyFromSecret(secretKeyB64)`

Deriva la clave pública Ed25519 a partir de una clave secreta.

```typescript
function publicKeyFromSecret(secretKeyB64: string): string;
```

---

<a id="v2-composite-signature-operations"></a>

## Operaciones de firma compuesta V2

Se importan de `@dcp-ai/sdk`:

### `compositeSign(registry, context, canonicalPayloadBytes, keys)`

Produce una firma híbrida con vinculación compuesta en la que la firma PQ cubre la firma clásica, así que la firma clásica
no puede sustituirse sin invalidar la PQ. Quitar la firma PQ (con la vinculación reetiquetada como `classical_only`) solo
se rechaza donde el modo efectivo es `hybrid_required` o `pq_only`; `classical_only` y `hybrid_preferred` lo aceptan
(véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#step-4-switch-to-composite-signatures)).

**Protocolo de vinculación:**
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

| Parámetro | Tipo | Descripción |
|-------|------|-------------|
| `registry` | `AlgorithmRegistry` | Registro de algoritmos con los proveedores registrados |
| `context` | `DcpContext \| string` | Contexto de separación de dominio |
| `canonicalPayloadBytes` | `Uint8Array` | Bytes canónicos que se van a firmar |
| `keys` | `CompositeKeyPair` | Par de claves clásica + PQ |

```typescript
import { registerDefaultProviders, getDefaultRegistry, compositeSign, DCP_CONTEXTS } from '@dcp-ai/sdk';

registerDefaultProviders();
const registry = getDefaultRegistry();

const sig = await compositeSign(registry, DCP_CONTEXTS.Bundle, payloadBytes, keys);
// sig.binding === 'pq_over_classical'
```

### `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)`

Verifica una firma híbrida con vinculación compuesta.

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

| Parámetro | Tipo | Descripción |
|-------|------|-------------|
| `strategy` | `'parallel' \| 'pq_first'` | `parallel` (por defecto): ambas se verifican a la vez. `pq_first`: primero se verifica la PQ y, si falla, se omite la clásica. |

**Devuelve:**

```typescript
interface CompositeVerifyResult {
  valid: boolean;           // pq_over_classical: both signatures valid; classical_only: the classical one (pq_valid false).
                            // Not by itself a policy-mode, trust or admission decision
  classical_valid: boolean;
  pq_valid: boolean;
}
```

### `classicalOnlySign(registry, context, canonicalPayloadBytes, key)`

Produce una firma compuesta solo clásica (modo de transición).

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

## Constructor y firmante de bundles V2

### BundleBuilderV2

Constructor fluido de Citizenship Bundles V2 que calcula el manifiesto y valida el nonce de sesión.

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

El constructor:
- Valida la coherencia del nonce de sesión en todos los artefactos
- Calcula el `BundleManifest` con los hashes SHA-256 de cada artefacto
- Calcula la raíz de Merkle de la auditoría (+ la raíz secundaria SHA3-256 opcional)
- Lanza una excepción si falta algún artefacto obligatorio

### `signBundleV2(bundle, options)`

Firma un bundle V2 con una firma compuesta (híbrida) sobre el manifiesto.

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

Firma un bundle V2 con una firma solo clásica (modo de transición).

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

## Verificación V2

### `verifySignedBundleV2(signedBundle, registry, policy?, options?)`

Verificación de bundles V2 firmados con una política decidida por el verificador. El verificador comprueba la cadena de auditoría primaria y la raíz de Merkle y, desde 2.2.1, también los `prev_hash_secondary`, `intent_hash_secondary` y `audit_merkle_root_secondary` secundarios que estén presentes (los ausentes no se exigen, así que un resultado satisfactorio no muestra una cadena secundaria completa; 2.2.0 no los comprueba, así que con él un resultado satisfactorio no establece su coherencia) ([estado de la implementación](STORAGE_AND_ANCHORING.md#dual-hash-chains)). La verificación tampoco concede admisión ni autorización de acciones.

```typescript
async function verifySignedBundleV2(
  signedBundle: SignedBundleV2,
  registry: AlgorithmRegistry,
  policy?: VerifierPolicy,
  options?: VerifyV2Options, // { now?: number }: the instant every time check uses (ms since the epoch); default Date.now()
): Promise<VerifyV2Result>;
```

| Parámetro | Tipo | Descripción |
|-------|------|-------------|
| `signedBundle` | `SignedBundleV2` | El bundle firmado que se va a verificar |
| `registry` | `AlgorithmRegistry` | Registro de algoritmos con los proveedores |
| `policy` | `VerifierPolicy` | Política del verificador (por defecto, `DEFAULT_VERIFIER_POLICY`) |
| `options.now` | `number` | El instante que usa cada comprobación de tiempo, en milisegundos desde la época (por defecto, `Date.now()`) |

**Devuelve:**

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

`verification_mode` es el modo con el que se comprobó el bundle y `resolved_tier`, el nivel de seguridad calculado a partir de su intención y su decisión de política.

**Canal de verificación:**

1. Comprobación de versión y esquema: solo se aceptan bundles v2.0 y se rechazan las demás versiones; dirigir los bundles v1.0 a `verifySignedBundle` corresponde a quien llama ([MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy))
2. Verificación del hash del payload de todos los artefactos firmados
3. Coherencia del nonce de sesión en todos los artefactos
4. Integridad del manifiesto (se recalculan todos los hashes de los artefactos + la raíz de Merkle de la auditoría)
5. Modo de verificación: el más estricto entre el modo de la política (`default_mode`, o la entrada de `risk_overrides` para el `risk_tier` del pasaporte) y el modo del nivel de seguridad (spec §14.3); una política `pq_only` sigue siendo `pq_only`
6. Validación de los algoritmos según la política
7. Verificación de la firma compuesta sobre el manifiesto y sobre el `SignedPayload` de cada artefacto (el RPR con sus `binding_keys`; el pasaporte, la intención y la decisión de política con las `keys` del pasaporte)
8. Aplicación del modo de la política (hybrid_required, hybrid_preferred, classical_only, pq_only); una firma PQ presente debe verificarse en todos los modos, y solo se tolera una ausente, con hybrid_preferred y classical_only
9. Validación de la cadena de hashes de la auditoría (enlaces prev_hash)
10. Comprobaciones de validez de las claves (revocación, caducidad, antigüedad) para las claves del pasaporte y las `binding_keys` del RPR

> `@dcp-ai/sdk` 2.1.2 y anteriores omiten las firmas por artefacto del paso 7 (VERIFICATION.md, paso V2-8) y, con `hybrid_preferred`, aceptan con un aviso una firma PQ presente pero no válida (paso V2-7).

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

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admisión: principales de confianza y strict-v1

Definida en [`spec/profiles/admission`](../spec/profiles/admission/README.md); guía en [ADMISSION.md](ADMISSION.md).

| Función | Descripción |
|----------|-------------|
| `createPrincipalTrustStore(trustSet)` | Valida un conjunto de confianza y devuelve un almacén; lanza `AdmissionConfigError` (`code`) |
| `resolveStrictV1Profile(config)` | Valida una configuración strict-v1 y devuelve el perfil congelado con su `policy` |
| `admitSignedBundleV2(signedBundle, registry, { profile?, policy?, trust?, revocation?, now? })` | Verifica (con la política del perfil, si hay uno) y evalúa la admisión |
| `evaluateAdmissionV2({ signedBundle, verification, profile?, trust?, revocation?, now })` | Evalúa la admisión a partir de un resultado del verificador; sin criptografía ni E/S. Confía en `verification`: pásale solo el resultado de `verifySignedBundleV2` sobre ese bundle, en ese `now`, con `profile.policy` |
| `revocationSubjects(signedBundle, verification)` | El id del agente y los kids firmantes verificados por los que debe responder una fuente de revocación |
| `revocationSnapshotFromDenyList(document, subjects)` | Una instantánea a partir de una lista de denegación completa (el `/.well-known/dcp-revocations.json` del servicio de revocación) |

El resultado: `verified`, `verification`, `principal_trust`, `profile`, `profile_compliance`, `admitted`, `action_authorized` (siempre `false`), `recorded_decision`, `trust_set_version`, `errors: [{ code, message }]`.

### `DEFAULT_VERIFIER_POLICY`

La política de verificador por defecto:

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

Verifica un bundle V1 firmado con Ed25519. Sin `publicKeyB64`, se usa la clave de `signature.signer.public_key_b64`.

```typescript
function verifySignedBundle(signedBundle: SignedBundle, publicKeyB64?: string): VerificationResult;

interface VerificationResult {
  verified: boolean;
  errors?: string[];
}
```

---

<a id="security-tier-engine"></a>

## Motor de niveles de seguridad

### `computeSecurityTier(intent, policyDecision?, mandateChainTier?)`

Calcula el nivel de seguridad (spec §14.2) a partir de la intención y de la decisión de política del bundle. `mandateChainTier`,
el `effective_tier` de una cadena de delegación verificada (`verifyMandateChain`), solo puede elevar el resultado.

```typescript
function computeSecurityTier(
  intent: IntentV2,
  policyDecision?: Pick<PolicyDecisionV2, 'risk_score'> | null,
  mandateChainTier?: SecurityTier | null,
): SecurityTier;
```

**Lógica de decisión** (`risk_score` procede de la decisión de política y debe ser un entero de 0 a 1000; sin decisión de política vale 0):

| Condición | Nivel |
|-----------|------|
| `risk_score >= 800`, o `credentials` / `children_data` | `'maximum'` |
| `risk_score >= 500`, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: 'high'`, o un valor desconocido o ausente de `action_type`, `estimated_impact` o `data_classes`, o un `risk_score` de la decisión de política ausente o que no sea un entero de 0 a 1000 | `'elevated'` |
| `risk_score >= 200` o `estimated_impact: 'medium'` | `'standard'` |
| en otro caso | `'routine'` |

Un `intent.security_tier` explícito solo puede elevar el resultado; un valor desconocido cuenta como `'elevated'`. Un `risk_score` puesto en la intención se ignora.

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const tier = computeSecurityTier(bundle.intent.payload, bundle.policy_decision.payload);
// 'routine' | 'standard' | 'elevated' | 'maximum'
```

### `tierToVerificationMode(tier)`

Asigna a un nivel de seguridad su modo de verificación.

```typescript
function tierToVerificationMode(tier: SecurityTier): VerificationMode;
```

| Nivel | Modo de verificación |
|------|------------------|
| `routine` | `'classical_only'` |
| `standard` | `'hybrid_preferred'` |
| `elevated` | `'hybrid_required'` |
| `maximum` | `'hybrid_required'` |

### `tierToCheckpointInterval(tier)`

Asigna a un nivel de seguridad el intervalo de checkpoints PQ.

```typescript
function tierToCheckpointInterval(tier: SecurityTier): number;
```

| Nivel | Intervalo (eventos) |
|------|--------------------|
| `routine` | 50 |
| `standard` | 10 |
| `elevated` | 1 |
| `maximum` | 1 |

### `maxTier(a, b)`

Devuelve el más estricto (de rango más alto) de dos niveles. Útil para combinar un nivel calculado automáticamente con uno explícito.

```typescript
function maxTier(a: SecurityTier, b: SecurityTier): SecurityTier;

maxTier('routine', 'elevated'); // 'elevated'
maxTier('maximum', 'standard'); // 'maximum'
```

### `effectiveVerificationMode(policyMode, tier)`

El modo que aplica un verificador (spec §14.3): el más estricto entre el modo de su política y el del nivel, con `classical_only` < `hybrid_preferred` < `hybrid_required`. El nivel solo añade un requisito PQ, así que una política `pq_only` sigue siendo `pq_only`; un modo de política desconocido cuenta como `'hybrid_required'`. `verifySignedBundleV2` lo aplica a todos los bundles.

```typescript
function effectiveVerificationMode(policyMode: VerificationMode, tier: SecurityTier): VerificationMode;

effectiveVerificationMode('classical_only', 'elevated'); // 'hybrid_required'
effectiveVerificationMode('hybrid_required', 'routine'); // 'hybrid_required'
effectiveVerificationMode('pq_only', 'maximum'); // 'pq_only'
```

---

<a id="a2a-protocol-dcp-04"></a>

## Protocolo A2A (DCP-04)

Protocolo de sesión entre agentes, diseñado en torno a un intercambio de claves híbrido X25519 + ML-KEM-768. Estas
funciones no realizan ese intercambio: quien llama lo realiza y pasa la clave de sesión resultante a `createSession`.

### `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)`

Crea un mensaje de handshake A2A_HELLO (lado del iniciador).

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

Crea un mensaje de handshake A2A_WELCOME (lado del respondedor).

```typescript
function createWelcome(
  responderBundle: Record<string, unknown>,
  kemPublicKeyB64: string,
  kemCiphertextB64: string,
  resolvedTier: string,
): A2AWelcome;
```

### `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)`

Crea una sesión A2A cifrada nueva una vez completado el handshake.

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

Cifra un mensaje dentro de una sesión A2A con AES-256-GCM y datos asociados.

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

Descifra un mensaje A2A entrante. Cada secuencia se acepta una sola vez (DCP-04 §8.4): con `R` =
`message_counter_recv` (la secuencia más alta recibida más uno), se rechaza una secuencia ya recibida, una inferior a
`R − 1000`, una igual o superior a `R + 1000`, o una que no sea un entero no negativo. La entrega desordenada dentro de la ventana funciona. Una secuencia se registra
solo después de verificar la etiqueta GCM, así que un mensaje falsificado no puede consumirla. Una sesión restaurada sin
`received_sequences` cuenta como recibidas todas las secuencias de la ventana por debajo de `message_counter_recv`.

```typescript
function decryptMessage(
  session: A2ASession,
  message: EncryptedMessage,
): Record<string, unknown>;
```

### `needsRekeying(session)`

Comprueba si la sesión necesita cambiar de clave según el número de mensajes.

```typescript
function needsRekeying(session: A2ASession): boolean;
```

### `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)`

Deriva de forma determinista un ID de sesión a partir de los ID de los agentes, los nonces y la clave de sesión.

```typescript
function deriveSessionId(
  agentIdA: string, agentIdB: string,
  nonceA: string, nonceB: string,
  sessionKey: Uint8Array,
): string;
```

### `generateResumeProof(session, lastSeenSequence)` / `verifyResumeProof(...)`

Genera y verifica pruebas de reanudación de sesión basadas en HMAC.

```typescript
function generateResumeProof(session: A2ASession, lastSeenSequence: number): string;
function verifyResumeProof(session: A2ASession, lastSeenSequence: number, proof: string): boolean;
```

### `deriveRekeyedSessionKey(oldSessionKey, newSharedSecret, sessionId)`

Deriva una clave de sesión nueva para las operaciones de cambio de clave.

```typescript
function deriveRekeyedSessionKey(
  oldSessionKey: Uint8Array,
  newSharedSecret: Uint8Array,
  sessionId: string,
): Uint8Array;
```

### `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)`

Crea un mensaje A2A_CLOSE.

```typescript
function createCloseMessage(
  sessionId: string,
  reason: 'complete' | 'timeout' | 'error' | 'revocation' | 'policy_violation',
  finalSequence: number,
  auditSummaryHash: string,
): A2AClose;
```

### `generateNonce()`

Genera un nonce aleatorio criptográfico de 32 bytes (codificado en hexadecimal).

```typescript
function generateNonce(): string;
```

---

<a id="telemetry--observability"></a>
<a id="telemetry-observability"></a>

## Telemetría y observabilidad

### `dcpTelemetry`

Instancia única de telemetría del SDK de DCP.

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';
```

### `dcpTelemetry.init(config)`

Inicializa la telemetría con la configuración indicada.

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

Con `exporterType: 'otlp'`, la Promise también se resuelve cuando falla la configuración de OTLP: el fallo llega a los
listeners de `onEvent` como un evento `error` con `operation: 'telemetry.init_otlp'`. Los eventos emitidos antes de que
termine la configuración no se reenvían a OTLP, y una Promise resuelta no garantiza la entrega al backend. La
instrumentación es explícita: las funciones de firma y verificación del SDK no llaman a los registradores, así que los
spans y las métricas solo proceden de las llamadas a `startSpan` y `record*` que haga tu código (véase [OBSERVABILITY.md](OBSERVABILITY.md)).

### `dcpTelemetry.startSpan(name, attributes?)` / `endSpan(spanId, status?, error?)`

Crea y completa spans de trazas para las operaciones.

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

Registra la latencia de una operación de firma.

```typescript
recordSignLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordVerifyLatency(durationMs, algorithm)`

Registra la latencia de una operación de verificación.

```typescript
recordVerifyLatency(durationMs: number, algorithm: string): void;
```

### `dcpTelemetry.recordKemLatency(durationMs, operation)`

Registra la latencia de una operación KEM (encapsulación de claves).

```typescript
recordKemLatency(durationMs: number, operation: 'encapsulate' | 'decapsulate'): void;
```

### `dcpTelemetry.recordCheckpointLatency(durationMs, tier)`

Registra la latencia de creación de un checkpoint PQ.

```typescript
recordCheckpointLatency(durationMs: number, tier: string): void;
```

### `dcpTelemetry.recordBundleVerify(durationMs, success, tier)`

Registra una operación de verificación de un bundle.

```typescript
recordBundleVerify(durationMs: number, success: boolean, tier: string): void;
```

### `dcpTelemetry.recordCacheHit()` / `recordCacheMiss()`

Registra la proporción de aciertos y fallos de la caché de verificación.

```typescript
recordCacheHit(): void;
recordCacheMiss(): void;
```

### `dcpTelemetry.recordA2ASession()` / `recordA2AMessage()`

Registra el uso del protocolo A2A.

```typescript
recordA2ASession(): void;
recordA2AMessage(): void;
```

### `dcpTelemetry.recordError(operation, error)`

Registra que se ha producido un error.

```typescript
recordError(operation: string, error: string): void;
```

### `dcpTelemetry.getMetricsSummary()`

Obtiene un resumen de todas las métricas recogidas con estadísticas de percentiles.

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

Se suscribe a los eventos de telemetría. Devuelve una función para cancelar la suscripción.

```typescript
onEvent(listener: (event: TelemetryEvent) => void): () => void;

interface TelemetryEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}
```

### `dcpTelemetry.reset()`

Restablece todos los spans y métricas recogidos.

```typescript
reset(): void;
```

---

<a id="hashing--merkle-trees"></a>
<a id="hashing-merkle-trees"></a>

## Hashes y árboles de Merkle

### `hashObject(obj)`

Hash SHA-256 de un objeto JSON canonicalizado.

```typescript
function hashObject(obj: unknown): string;
```

### `merkleRootFromHexLeaves(leaves)`

Calcula una raíz de Merkle a partir de hashes de hojas codificados en hexadecimal.

```typescript
function merkleRootFromHexLeaves(leaves: string[]): string | null; // null for no leaves
```

### `merkleRootForAuditEntries(auditEntries)`

Calcula una raíz de Merkle para un array de entradas de auditoría (`null` para un array vacío).

```typescript
function merkleRootForAuditEntries(auditEntries: unknown[]): string | null;
```

### `intentHash(intent)`

Calcula el hash de un objeto de intención.

```typescript
function intentHash(intent: unknown): string;
```

### `prevHashForEntry(prevEntry)`

Calcula el `prev_hash` de la siguiente entrada de auditoría a partir de la entrada anterior.

```typescript
function prevHashForEntry(prevEntry: unknown): string;
```

### `sha256Hex(data)` / `sha3_256Hex(data)`

Hashes codificados en hexadecimal.

```typescript
function sha256Hex(data: Uint8Array | Buffer | string): string;
function sha3_256Hex(data: Uint8Array | Buffer | string): string;
```

### `dualHash(data)` / `dualHashCanonical(canonicalJson)` / `dualMerkleRoot(leaves)`

Operaciones de doble hash (SHA-256 + SHA3-256) para V2. `dualHashCanonical` recibe una cadena JSON ya canonicalizada; `dualMerkleRoot` devuelve `null` si no hay hojas.

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

Calcula la raíz de Merkle SHA-256 de los eventos de auditoría V2.

```typescript
function auditEventsMerkleRoot(events: AuditEventV2[]): string;
```

---

<a id="schema-validation"></a>

## Validación de esquemas

### `validateSchema(schemaName, data)`

Valida un artefacto DCP contra su JSON Schema.

```typescript
function validateSchema(schemaName: string, data: unknown): ValidationResult;
```

### `validateBundle(bundle)`

Valida un citizenship bundle completo.

```typescript
function validateBundle(bundle: unknown): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

---

<a id="dcp-05-agent-lifecycle"></a>

## DCP-05: ciclo de vida del agente

Se importan de `@dcp-ai/sdk`:

### `validateStateTransition(from, to)`

Comprueba si una transición de estado del ciclo de vida es válida.

```typescript
function validateStateTransition(from: LifecycleState, to: LifecycleState): boolean;

type LifecycleState = 'commissioned' | 'active' | 'declining' | 'decommissioned';
```

Transiciones válidas: `commissioned→active`, `commissioned→decommissioned`, `active→declining`, `active→decommissioned` (fallo repentino), `declining→active`, `declining→decommissioned`. Solo comprueba la arista, no la aprobación del principal que la especificación exige para reactivar desde `declining` ni ninguna otra autorización.

### `computeVitalityScore(metrics)`

Calcula una puntuación de vitalidad ponderada (0-1000) a partir de las métricas que la componen.

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

Crea artefactos firmados del ciclo de vida. Todos requieren `AlgorithmRegistry` y `CompositeKeyPair`.

```typescript
type TerminationMode = 'planned_retirement' | 'termination_for_cause' | 'organizational_restructuring' | 'sudden_failure';
type DataDisposition = 'transferred' | 'archived' | 'destroyed';
```

---

<a id="dcp-06-succession"></a>

## DCP-06: sucesión

### `createDigitalTestament(...)` / `updateDigitalTestament(...)`

Crea o actualiza un testamento digital con preferencias de sucesor y clasificación de la memoria.

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

Ejecuta una ceremonia de sucesión y crea el manifiesto de transferencia de memoria.

```typescript
type TransitionType = 'planned' | 'forced' | 'emergency';
```

### `classifyMemory(entries, classification)`

Clasifica las entradas de memoria en operativas (transferibles) y relacionales (por destruir). Devuelve
`{ operational, relationalDestroyed }`, donde `relationalDestroyed` enumera solo los hashes de las entradas clasificadas
como `destroy` (también el valor por defecto de una categoría sin entrada); no borra nada, y destruir de verdad esa
memoria corresponde a quien llama. Las entradas clasificadas como `retain` no aparecen en ninguna de las dos salidas.

---

<a id="dcp-07-dispute-resolution"></a>

## DCP-07: resolución de disputas

### `createDispute(...)` / `escalateDispute(...)` / `resolveDispute(...)`

Gestiona el ciclo de vida de una disputa.

```typescript
type DisputeType = 'resource_conflict' | 'directive_conflict' | 'capability_conflict' | 'policy_conflict';
type EscalationLevel = 'direct_negotiation' | 'contextual_arbitration' | 'human_appeal';
type DisputeStatus = 'open' | 'in_negotiation' | 'arbitrated' | 'appealed' | 'resolved';
```

### `createObjection(...)`

Crea una objeción formal de un agente a una directiva.

```typescript
type ObjectionType = 'ethical' | 'safety' | 'policy_violation' | 'capability_mismatch';
```

### `createArbitrationPanel(...)` / `submitResolution(...)` / `buildJurisprudenceBundle(...)`

Gestiona los paneles de arbitraje y el registro de precedentes.

```typescript
type AuthorityLevel = 'local' | 'organizational' | 'cross_org';
```

### `lookupPrecedent(jurisprudence, category, context?)`

Devuelve los bundles de jurisprudencia de una categoría, opcionalmente filtrados por contexto.

```typescript
function lookupPrecedent(jurisprudence: JurisprudenceBundle[], category: string, context?: string): JurisprudenceBundle[];
```

---

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

## DCP-08: derechos y obligaciones

### `declareRights(...)` / `recordObligation(...)` / `reportViolation(...)`

Gestiona los derechos del agente y el cumplimiento de las obligaciones.

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

Comprueba si las obligaciones respetan una declaración de derechos.

```typescript
function checkRightsCompliance(
  declaration: RightsDeclaration,
  obligations: ObligationRecord[],
): { compliant: boolean; violations: string[] };
```

---

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

## DCP-09: delegación y representación

### `createDelegationMandate(...)` / `verifyMandateValidity(mandate, revokedMandateIds)` / `revokeDelegation(mandate, revokedMandateIds)`

Crea, valida y revoca delegaciones de autoridad de una persona a un agente. Quien llama mantiene el conjunto de ids de mandatos revocados:
`verifyMandateValidity` lo comprueba (junto con la ventana de validez), y `revokeDelegation` añade el mandato a él cuando
el mandato es revocable.

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

Cadenas de delegación (DCP-09 §3.5): el agente que tiene `parent` emite un submandato a otro agente, firmado con sus
propias claves en el contexto `DCP-AI.v2.SubMandate`. `verifyMandateChain` recibe la cadena empezando por la raíz, los ids de mandatos
revocados, las entradas de claves de la persona y las de cada agente delegante por `agent_id`, y el momento de la
verificación; comprueba la firma de cada salto hasta la persona, el enlace con el padre y la profundidad, `sub_delegation`, las ventanas
de validez anidadas, la atenuación (las acciones, las clases de datos y los límites solo pueden restringirse: una entrada hija repite los
`data_classes` del padre como subconjunto, y los límites numéricos solo se comparan como enteros dentro de ±(2^53−1)), el nivel mínimo `minimum_security_tier`
y la revocación (un ancestro revocado invalida a todos sus descendientes), y falla cerrado ante cualquier cosa desconocida.

```typescript
interface MandateChainKeys { human_keys: KeyEntry[]; agent_keys: Record<string, KeyEntry[]> }
interface MandateChainResult { valid: boolean; errors: string[]; depth: number; effective_tier: SecurityTier | null }
```

`computeSecurityTier(intent, policyDecision?, mandateChainTier?)` toma el `effective_tier` de la cadena como un mínimo
que solo puede elevar el nivel (spec §14.2). Python: `create_sub_mandate`, `verify_mandate_chain`; Go:
`CreateSubMandate`, `VerifyMandateChain`; Rust: `create_sub_mandate`, `verify_mandate_chain`.

### `evaluateSignificance(context)` / `shouldNotifyHuman(significance, thresholds)`

Evalúa la relevancia de una acción y determina si debe notificarse a la persona.

```typescript
type ThresholdOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
type ThresholdAction = 'notify' | 'escalate' | 'block';
```

### `createAdvisoryDeclaration(...)` / `createAwarenessThreshold(...)`

Crea declaraciones de asesoramiento del agente y configura los umbrales de notificación.

### `generateMirror(...)`

Genera, a partir de una cadena de auditoría, una narración legible del espejo del principal.

### `generateInteractionRecord(...)`

Crea un registro de interacción entre agentes de doble capa (términos públicos + hash de la deliberación privada).

---

<a id="domain-separation"></a>

## Separación de dominio

### `DCP_CONTEXTS`

Contextos de separación de dominio predefinidos para las distintas operaciones de DCP.

```typescript
const DCP_CONTEXTS: Record<string, DcpContext>;
// 19 contexts: AgentPassport, ResponsiblePrincipal, Intent, PolicyDecision,
// AuditEvent, Bundle, Revocation, KeyRotation, ProofOfPossession,
// JurisdictionAttestation, HumanConfirmation, MultiPartyAuth,
// Lifecycle (DCP-05), Succession (DCP-06), Dispute (DCP-07),
// Rights (DCP-08), Delegation (DCP-09), Awareness (DCP-09), SubMandate (DCP-09)
```

### `domainSeparatedMessage(context, canonicalPayloadBytes)`

Construye el mensaje que se firma: `UTF8(context) || 0x00 || canonicalPayloadBytes`. Lanza una excepción ante una etiqueta de contexto desconocida.

```typescript
function domainSeparatedMessage(context: DcpContext | string, canonicalPayloadBytes: Uint8Array): Uint8Array;
```

---

<a id="session-nonces"></a>

## Nonces de sesión

### `generateSessionNonce()`

Genera un nonce de sesión criptográfico para protegerse contra el empalme (splicing).

```typescript
function generateSessionNonce(): string;
```

### `isValidSessionNonce(nonce)`

Valida que una cadena sea un nonce de sesión válido de 64 caracteres hexadecimales.

```typescript
function isValidSessionNonce(nonce: string): boolean;
```

### `verifySessionBinding(artifacts)`

Verifica que todos los artefactos comparten el mismo nonce de sesión.

```typescript
function verifySessionBinding(artifacts: Array<{ session_nonce?: string }>): {
  valid: boolean;
  nonce?: string;
  error?: string;
};
```

---

<a id="key-recovery"></a>

## Recuperación de claves

### `shamirSplit(secret, threshold, totalShares)`

Divide una clave secreta en partes Shamir M de N.

```typescript
function shamirSplit(secret: Uint8Array, threshold: number, totalShares: number): ShamirShare[];

interface ShamirShare {
  index: number;
  data: Uint8Array;
}
```

### `shamirReconstruct(shares)`

Reconstruye un secreto a partir de partes Shamir.

```typescript
function shamirReconstruct(shares: ShamirShare[]): Uint8Array;
```

### `setupKeyRecovery({ humanId, masterSecret, threshold, holders })`

Configura la recuperación de claves con una configuración de recuperación social M de N. Devuelve la configuración que se publica y una parte por custodio para distribuir.

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

## Revocación de emergencia

### `generateEmergencyRevocationToken()`

Genera un secreto de revocación y su token de compromiso para la revocación de emergencia de un agente.

```typescript
function generateEmergencyRevocationToken(): EmergencyRevocationTokenPair;

interface EmergencyRevocationTokenPair {
  revocation_secret: string;           // 64 hex chars; kept offline by the human principal
  emergency_revocation_token: string;  // "sha256:<hex>"; embedded in the agent passport
}
```

### `verifyEmergencyRevocationSecret(revocationSecret, commitmentToken)`

Verifica un secreto de revocación de emergencia contra el token de compromiso del pasaporte.

```typescript
function verifyEmergencyRevocationSecret(revocationSecret: string, commitmentToken: string): boolean;
```

### `buildEmergencyRevocation({ agentId, humanId, revocationSecret })`

Construye una solicitud de revocación de emergencia.

```typescript
function buildEmergencyRevocation(params: {
  agentId: string;
  humanId: string;
  revocationSecret: string;
}): EmergencyRevocation;
```

---

<a id="bundle-presentation"></a>

## Presentación del bundle

### `suggestPresentationMode(tier, opts)`

Sugiere un modo de presentación: `full` en el primer contacto o en `elevated`/`maximum`; en `routine`/`standard`, `reference` con una relación de confianza existente y `compact` en otro caso.

```typescript
function suggestPresentationMode(
  tier: SecurityTier,
  opts: { isFirstContact: boolean; hasTrustRelationship: boolean },
): PresentationMode;

type PresentationMode = 'full' | 'incremental' | 'reference' | 'compact';
```

### `presentFull(bundle)` / `presentCompact(bundle, pqCheckpointRef)` / `presentReference(bundle, verificationEndpoint)` / `presentIncremental(baseBundle, updatedBundle, baseAuditCount)`

Genera distintos formatos de presentación para transmitir el bundle. `presentCompact` elimina la firma PQ y, en su lugar, hace referencia a un checkpoint PQ; `presentReference` envía solo el hash del bundle, el nonce de sesión y un endpoint de verificación; `presentIncremental` envía las entradas de auditoría posteriores a `baseAuditCount`, los checkpoints PQ, el manifiesto actualizado y su firma.

La referencia al checkpoint no sustituye una firma PQ que el modo efectivo exija, y ninguna presentación autoriza ni
admite nada. Solo el `bundle` de una presentación completa o compacta es un `SignedBundleV2` que `verifySignedBundleV2`
acepta directamente (uno compacto solo pasa donde el modo efectivo tolera la ausencia de la firma PQ); una presentación
por referencia o incremental debe resolverse antes al bundle firmado completo.

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

Calcula el hash de un bundle firmado para las presentaciones por referencia.

```typescript
function computeBundleHash(bundle: SignedBundleV2): string;
```

---

<a id="verification-cache"></a>

## Caché de verificación

### `VerificationCache`

Caché en memoria de resultados de verificación, indexada por hash del bundle, con un TTL por nivel de seguridad.

- **La clave es solo el hash del bundle.** La caché no separa inquilinos ni políticas de verificador, y un acierto no
  vuelve a comprobar la ventana de sesión, la validez de las claves, la confianza en el principal ni una instantánea de revocación reciente. No reutilices un
  resultado en caché para la admisión, ni con otra política u otro inquilino, sin volver a verificar.
- **Invalidación:** `invalidateByKid(kid)` elimina las entradas cuyos kids firmantes incluyen `kid`; `clear()` elimina
  todo. `invalidateByAgent(agentId)` actualmente no elimina nada y devuelve 0, así que no revoca las entradas
  de un agente: usa `invalidateByKid` con cada kid del agente, o `clear()`.

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

## Formato de transmisión CBOR

Serialización binaria compacta para los bundles DCP.

### `cborEncode(value)` / `cborDecode(data)`

```typescript
function cborEncode(value: unknown): Uint8Array;
function cborDecode(data: Uint8Array): unknown;
```

### `jsonToCborPayload(json)` / `cborPayloadToJson(cbor)`

Convierte, de forma recursiva, un payload DCP entre su forma JSON (campos `*_b64` en base64) y su forma apta para CBOR (cadenas de bytes en bruto). Codifica el resultado con `cborEncode`.

```typescript
function jsonToCborPayload(json: Record<string, unknown>): Record<string, unknown>;
function cborPayloadToJson(cbor: Record<string, unknown>): Record<string, unknown>;
```

### `detectWireFormat(data)`

Detecta si los datos están codificados en JSON o en CBOR.

```typescript
function detectWireFormat(data: Uint8Array): 'cbor' | 'json';
```

---

<a id="crypto-providers"></a>

## Proveedores criptográficos

### `registerDefaultProviders()`

Registra los proveedores por defecto Ed25519 + ML-DSA-65 + SLH-DSA-192f.

```typescript
function registerDefaultProviders(): void;
```

### `getDefaultRegistry()`

Obtiene el `AlgorithmRegistry` por defecto con todos los proveedores registrados.

```typescript
function getDefaultRegistry(): AlgorithmRegistry;
```

### `AlgorithmRegistry`

Registro de proveedores de algoritmos.

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

### Proveedores disponibles

| Proveedor | Algoritmo | Tipo |
|----------|-----------|------|
| `Ed25519Provider` | `ed25519` | Firma clásica |
| `MlDsa65Provider` | `ml-dsa-65` | Firma poscuántica (NIST ML-DSA) |
| `SlhDsa192fProvider` | `slh-dsa-192f` | Firma poscuántica (NIST SLH-DSA) |

<a id="cryptoprovider-interface"></a>

### Interfaz `CryptoProvider`

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

## Detección de versión

### `detectDcpVersion(artifact)`

Detecta la versión de DCP de un artefacto o de un bundle.

```typescript
function detectDcpVersion(artifact: Record<string, unknown>): '1.0' | '2.0' | null;
```

---

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: candidato de canonicalización `dcp-jcs-v2` (opt-in)

Experimental y desactivado por defecto: `dcp-jcs-v1` sigue siendo el perfil de canonicalización predeterminado y el único
normativo, y los constructores, firmantes y verificadores habituales no cambian. Estas exportaciones existen para quien opte por usarlas; un bundle candidato verificado no otorga
confianza ni admisión. El contrato completo está en
[`docs/proposals/canonicalization-candidate`](proposals/canonicalization-candidate/README.md) (§15 entrada, §16
enrutador, §17 verificador, §18 productores).

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

- `ExperimentalCandidateIngressResult`: `{ status: 'accept', value, canonical, canonicalSha256 }` o
  `{ status: 'reject', class, offset }`.
- `verify` devuelve `{ route, entered, verification }`: la ruta (`reject`, `v1_path` o `candidate`), el
  verificador al que entró (`none`, `dcp-jcs-v1` o `dcp-jcs-v2`, como máximo uno) y el resultado de ese verificador tal cual.
- `ExperimentalCandidateInput` es `{ bytes }` (bytes originales, comprobados por la entrada) o `{ value }` (un valor
  del host, comprobado de forma estricta).
- `ExperimentalCandidateProduceError` (`class`, `part`, `path`, `offset`) es un rechazo por el dominio o la
  forma de las entradas, lanzado antes de llamar a cualquier firmante; los errores de clave, registro y proveedor siguen siendo los actuales.
- Errores del enrutador y del verificador: `ExperimentalCandidateConfigError` (configuración),
  `ExperimentalCandidateAdapterError` (un decodificador histórico que falló por algo distinto de rechazar los datos) y
  `ExperimentalCandidateInternalError`.
