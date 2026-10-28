<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-aiwasm-webassembly-sdk-v20"></a>

# @dcp-ai/wasm — SDK WebAssembly v2.0

> Tradução informativa do [README em inglês](README.md), atualizada em 26/10/2026. Os identificadores e os blocos de código, incluindo seus comentários, foram preservados para manter os exemplos testados.

Módulo WebAssembly para o Digital Citizenship Protocol (DCP) v2.0, compilado a partir do SDK de Rust. Oferece assinaturas compostas pós-quânticas, geração de chaves híbridas, encapsulamento de chaves ML-KEM-768, hashes duplos, construção e verificação de bundles e cálculo do nível de segurança. Tudo é executado diretamente no navegador ou no Node.js, sem servidor.

<a id="installation"></a>

## Instalação

**Publicado no npm (26/10/2026).** `@dcp-ai/wasm` 2.1.0 foi publicado como `latest` nessa data e incluía as APIs descritas aqui, inclusive as experimentais de `dcp-jcs-v2`. Publicá-las não ativou o candidato: ele continuou opt-in e não normativo, sem mudanças em `dcp-jcs-v1`. O crate Rust tem um ciclo de publicação separado.

**`@dcp-ai/wasm` 2.1.1.** Esta versão também verifica os campos secundários SHA3-256 do [VERIFICATION.md V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` e cada `intent_hash_secondary`. Os campos ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa; um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1` nem o tratamento de `hash_alg`. A versão 2.1.0 não verifica esses campos. Os comandos de instalação abaixo indicam esta versão; para a disponibilidade dela no registro, veja [Versões publicadas](../../docs/README.md#published-versions).

```bash
npm install @dcp-ai/wasm@^2.1.1
```

Veja o [inventário de publicações npm](../../docs/NPM_RELEASES.md) para todas as versões.

Para desenvolver a partir de uma cópia do repositório, compile e instale o pacote local:

```bash
# Build in sdks/wasm first (see Build)
npm install /path/to/dcp-ai/sdks/wasm
```

<a id="build"></a>

## Compilação

```bash
# Build WASM + TypeScript wrapper
npm run build

# WASM only (browser target)
npm run build:wasm

# WASM only (Node.js target)
npm run build:wasm:node
```

**Requisitos:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) e a cadeia de ferramentas de Rust com o alvo `wasm32-unknown-unknown`.

<a id="initialization-browser-and-nodejs"></a>

## Inicialização: navegador e Node.js

`initDcp(wasmUrl?)` carrega `dcp_ai_bg.wasm` uma única vez.

- **Navegador** (ou um empacotador que sirva `pkg/`): `await initDcp()` busca o arquivo ao lado de `pkg/dcp_ai.js`. Também é possível passar sua URL: `await initDcp('/assets/dcp_ai_bg.wasm')`.
- **Node.js:** o `fetch` do Node não consegue ler uma URL `file:`, portanto `initDcp()` sem argumento falha nesse ambiente. Leia o arquivo e passe-o como URL `data:`:

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

// The .wasm file sits next to the `@dcp-ai/wasm/pkg` entry point.
const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);
```

O wasm-bindgen pode avisar que essa forma do parâmetro está obsoleta; ainda assim, ela inicializa o módulo.

<a id="quickstart--typescript-wrapper"></a>

<a id="quickstart-typescript-wrapper"></a>

## Início rápido — Camada TypeScript

A forma recomendada de usar o SDK é por meio da camada TypeScript. Neste bundle V2, o principal assina o RPR e o manifesto; o agente assina o passaporte, a intenção e a decisão de política. Cada um usa chaves híbridas Ed25519 + ML-DSA-65. O exemplo é executado no Node.js; em um navegador, substitua a inicialização por `await initDcp()`.

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

const principal = dcp.generateHybridKeypair();
const agent = dcp.generateHybridKeypair();
type Hybrid = ReturnType<typeof dcp.generateHybridKeypair>;
const keyEntries = (keys: Hybrid) => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, public_key_b64: k.public_key_b64,
  created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sign = (context: string, payload: object, keys: Hybrid) =>
  dcp.signPayload(
    context, payload,
    keys.classical.secret_key_b64, keys.classical.kid ?? dcp.deriveKid('ed25519', keys.classical.public_key_b64),
    keys.pq.secret_key_b64, keys.pq.kid ?? dcp.deriveKid('ml-dsa-65', keys.pq.public_key_b64),
  );

const nonce = dcp.generateSessionNonce();
const now = new Date().toISOString();
const intent = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: 'agent:example-001',
  human_id: 'human:example-001', timestamp: now, action_type: 'browse', target: { channel: 'web' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};

const bundle = dcp.buildBundle({
  rpr: sign('DCP-AI.v2.ResponsiblePrincipal', {
    dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
    entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
    issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
  }, principal),
  passport: sign('DCP-AI.v2.AgentPassport', {
    dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
    principal_binding_reference: 'human:example-001', capabilities: ['browse'], risk_tier: 'low',
    created_at: now, status: 'active',
  }, agent),
  intent: sign('DCP-AI.v2.Intent', intent, agent),
  policy: sign('DCP-AI.v2.PolicyDecision', {
    dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
    reasons: ['low-impact browse'], required_confirmation: null,
    applied_policy_hash: dcp.preparePayload({ policy: 'default' }).payload_hash, timestamp: now,
  }, agent),
  auditEntries: [{
    dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
    timestamp: now, agent_id: 'agent:example-001', human_id: 'human:example-001', intent_id: intent.intent_id,
    intent_hash: dcp.preparePayload(intent).payload_hash, policy_decision: 'approved', outcome: 'page_read',
    evidence: { tool: 'browser', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
  }],
  sessionNonce: nonce,
});

// The principal signs the manifest with a composite signature.
const signed = dcp.signBundle(
  bundle,
  principal.classical.secret_key_b64, principal.classical.kid ?? dcp.deriveKid('ed25519', principal.classical.public_key_b64),
  principal.pq.secret_key_b64, principal.pq.kid ?? dcp.deriveKid('ml-dsa-65', principal.pq.public_key_b64),
);

const result = dcp.verifyBundle(signed);
console.log(result.verified, result.classical_valid, result.pq_valid); // true true true
```

<a id="api-reference"></a>

## Referência da API

<a id="initialization"></a>

### Inicialização

#### `initDcp(wasmUrl?: string): Promise<DcpWasm>`

Inicializa o módulo WASM. Deve ser chamada uma vez antes de usar qualquer API. Opcionalmente, recebe uma URL para o arquivo `.wasm`; no Node.js, passe-a como URL `data:` (consulte [Inicialização](#initialization-browser-and-nodejs)).

<a id="keypair-generation"></a>

### Geração de pares de chaves

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `generateEd25519Keypair()` | `KeypairResult` | Par de chaves clássicas Ed25519 |
| `generateMlDsa65Keypair()` | `KeypairResult` | Par de chaves de assinatura pós-quântica ML-DSA-65 |
| `generateSlhDsa192fKeypair()` | `KeypairResult` | Par de chaves de assinatura SLH-DSA-192f baseada em hashes e sem estado |
| `generateHybridKeypair()` | `HybridKeypairResult` | Par de chaves híbridas Ed25519 + ML-DSA-65 em uma única chamada |

<a id="ml-kem-768-key-encapsulation"></a>

### Encapsulamento de chaves ML-KEM-768

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `mlKem768Keygen()` | `KemKeypairResult` | Gera um par de chaves de encapsulamento e desencapsulamento ML-KEM-768 |
| `mlKem768Encapsulate(pk)` | `KemEncapsulateResult` | Encapsula um segredo compartilhado usando uma chave pública |
| `mlKem768Decapsulate(ct, sk)` | `string` | Desencapsula o segredo compartilhado a partir do texto cifrado; retorna hexadecimal |

<a id="composite-signing"></a>

### Assinatura composta

| Método | Descrição |
|--------|-------------|
| `compositeSign(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Assinatura híbrida completa Ed25519 + ML-DSA-65 com vínculo `pq_over_classical` |
| `classicalOnlySign(context, payload, sk, kid)` | Assinatura apenas clássica Ed25519, no modo de transição |
| `signPayload(context, payload, classicalSk, classicalKid, pqSk, pqKid)` | Assina e envolve o conteúdo em um envelope `SignedPayload` |

<a id="verification"></a>

### Verificação

A verificação não concede confiança no principal, admissão ou autorização para agir. O verificador V2 confere a cadeia de auditoria primária e a raiz Merkle primária; desde a 2.1.1 também verifica os elos secundários opcionais, os hashes de intenção e `audit_merkle_root_secondary` que estejam presentes, enquanto a 2.1.0 não ([cadeias de hash duplo](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)). O candidato experimental reutiliza essas verificações.

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `compositeVerify(context, payload, sig, classicalPk, pqPk?)` | `CompositeVerifyResult` | Verificação criptográfica de uma assinatura composta |
| `verifyBundle(signedBundle, policy?)` | `V2VerificationResult` | Verifica um bundle V2 —estrutura, criptografia e cadeia de hashes primária— usando o mais restritivo entre o modo da política e o do nível de segurança (spec §14.3); informa `resolved_tier` e `verification_mode`. `policy` só pode diferir dos padrões em `default_mode`, `risk_overrides`, nos campos da fase 3 (`advisory_rejected_algs`, `warn_classical_only_deprecated`, `allow_classical_fallback_disable`), em `max_session_duration_seconds` (medida desde o `session_issued_at` assinado, gravado por `signBundle` quando o manifesto contém `session_expires_at`), em `require_session_expiry` (rejeita um manifesto sem `session_expires_at`) e em `require_audience_binding` com `verifier_id` (rejeita um manifesto sem `intended_verifier` ou com valor diferente de `verifier_id`). Quando uma política é fornecida, bundles V1 são rejeitados |

<a id="hash-operations"></a>

### Operações de hash

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `dualHash(data)` | `DualHash` | Hash duplo SHA-256 + SHA3-256 |
| `sha3_256(data)` | `string` | Hash SHA3-256 em hexadecimal |
| `hashObject(obj)` | `string` | Hash SHA-256 de um objeto JSON |
| `dualMerkleRoot(leaves)` | `DualHash` | Raiz Merkle dupla de um array de folhas `DualHash` |

<a id="canonicalization-domain-separation"></a>

### Canonicalização e separação de domínios

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `canonicalize(value)` | `string` | Canonicalização `dcp-jcs-v1`, baseada na RFC 8785 JCS |
| `domainSeparatedMessage(context, payloadHex)` | `string` | Mensagem com separação de domínios, em hexadecimal |
| `deriveKid(alg, publicKeyB64)` | `string` | Identificador de chave determinístico a partir do algoritmo e da chave pública |

<a id="session-security"></a>

### Sessão e segurança

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `generateSessionNonce()` | `string` | Nonce aleatório de 256 bits, representado por 64 caracteres hexadecimais |
| `verifySessionBinding(artifacts)` | `SessionBindingResult` | Verifica a consistência do nonce entre artefatos |
| `computeSecurityTier(intent, policyDecision?)` | `SecurityTierResult` | Calcula o nível de segurança adaptativo: routine/standard/elevated/maximum; `risk_score` vem da decisão de política |

<a id="payload-preparation"></a>

### Preparação do conteúdo

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `preparePayload(payload)` | `PreparedPayload` | Canonicaliza o conteúdo e calcula seu hash |

<a id="bundle-building-signing"></a>

### Construção e assinatura de bundles

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `buildBundle(opts)` | `CitizenshipBundleV2` | Constrói um bundle V2 com manifesto a partir de artefatos assinados com `signPayload`; `sessionNonce` usa por padrão o `session_nonce` do RPR |
| `signBundle(bundle, classicalSk, classicalKid, pqSk, pqKid)` | `SignedBundleV2` | Assina um bundle com assinatura composta; `signer.id` é o `human_id` do RPR. Um manifesto com `session_expires_at` e sem `session_issued_at` recebe em `session_issued_at` o instante da assinatura |

<a id="proof-of-possession"></a>

### Prova de posse

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `generateRegistrationPop(challenge, sk, alg)` | `SignatureEntry` | Gera uma prova de posse (PoP) para registrar uma chave |
| `verifyRegistrationPop(challenge, pop, pk, alg)` | `PopResult` | Verifica uma PoP |

<a id="utility"></a>

### Utilitários

| Método | Retorno | Descrição |
|--------|---------|-------------|
| `detectVersion(value)` | `string \| null` | Detecta a versão do protocolo DCP em um objeto JSON |

<a id="dcp-0509-types"></a>

### Tipos DCP-05–09

O SDK WASM inclui interfaces TypeScript para todos os artefatos DCP-05 a DCP-09, correspondentes aos tipos do SDK de Rust:

| Especificação | Interfaces |
|------|-----------|
| DCP-05 Ciclo de vida | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 Sucessão | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 Disputas | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 Direitos | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 Delegação | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry`, `ThresholdOperator`, `ThresholdAction` |

Contextos de separação de domínios disponíveis por `domainSeparatedMessage()`: `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`.

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

## Experimental: candidato de canonicalização `dcp-jcs-v2` (ativação explícita)

Não é normativo nem está ativado: `dcp-jcs-v1` continua sendo o único perfil de canonicalização, e nenhum padrão, construtor, assinador ou verificador é alterado. Esses métodos estão disponíveis para quem os habilitar explicitamente inclusive no npm WASM 2.1.0. As interfaces WASM recebem apenas bytes; os valores do ambiente hospedeiro são verificados primeiro em JavaScript. Um bundle verificado pelo candidato não concede confiança ou admissão. Projeto e contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md) (§15 entrada, §16 roteador, §17 verificador, §18 produtores).

| Método | Descrição |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | `{ status: 'accept', canonical, ... }` ou `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | Unidade de um transporte `bare` ou `envelope` |
| `createExperimentalCandidateRouter(config)` | Roteia bytes; `historical` é um dos `experimentalWasmHistoricalAdapters` (`w1…` para objetos por `JSON.stringify`, `w2…` para texto); nenhum é escolhido por padrão |
| `createExperimentalCandidateVerifier(config).verify(bytes, policy?)` | Verifica os bytes originais com no máximo um verificador; lê o relógio de `Date.now` |
| `experimentalCandidateSignPayload(context, input, keys)` | Assina um artefato a partir de `{ bytes }` ou `{ value }` |
| `experimentalCandidateSignBundle(parts, signer, options)` | Monta e assina um bundle cujo manifesto identifica `dcp-jcs-v2` |
| `ExperimentalWasmCandidateProduceError` | Rejeição do domínio ou formato das entradas, antes de qualquer interface WASM assinar |

```typescript
import { readFileSync } from 'node:fs';
import { initDcp } from '@dcp-ai/wasm';

const wasmFile = new URL('dcp_ai_bg.wasm', import.meta.resolve('@dcp-ai/wasm/pkg'));
const dcp = await initDcp(`data:application/wasm;base64,${readFileSync(wasmFile).toString('base64')}`);

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = dcp.experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const h = dcp.generateHybridKeypair();
const key = (k: typeof h.classical) => ({
  kid: k.kid ?? dcp.deriveKid(k.alg, k.public_key_b64), alg: k.alg, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64,
});
const artifact = dcp.experimentalCandidateSignPayload(
  'DCP-AI.v2.Intent', { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') },
  { classical: key(h.classical), pq: key(h.pq) },
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

<a id="low-level-api"></a>

## API de baixo nível

Também é possível usar diretamente as funções WASM, sem a camada TypeScript:

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

Consulte [example.html](./example.html) para uma demonstração interativa completa no navegador.

<a id="security-tiers"></a>

## Níveis de segurança

`computeSecurityTier(intent, policyDecision?)` calcula o nível de segurança adaptativo (spec §14.2). `risk_score` vem da decisão de política (0 quando nenhuma é fornecida); um valor desconhecido ou ausente de `action_type`, `estimated_impact` ou `data_classes`, ou um `risk_score` ausente ou que não seja um inteiro de 0 a 1000, é considerado `elevated`. `intent.security_tier` só pode elevar o resultado. Aplica-se o nível mais alto correspondente.

| Nível | Condição (qualquer uma) | Modo de verificação | Intervalo de checkpoints |
|------|---------------|-------------------|---------------------|
| `routine` | Nenhuma das condições abaixo | `classical_only` | 50 |
| `standard` | `risk_score` 200–499, `estimated_impact: medium` | `hybrid_preferred` | 10 |
| `elevated` | `risk_score` 500–799, `pii` / `financial_data` / `health_data`, `initiate_payment`, `estimated_impact: high`, valores desconhecidos | `hybrid_required` | 1 |
| `maximum` | `risk_score` ≥ 800, `credentials` / `children_data` | `hybrid_required` | 1 |

<a id="algorithms-supported"></a>

## Algoritmos suportados

| Categoria | Algoritmo | Padrão |
|----------|-----------|----------|
| Assinatura clássica | Ed25519 | RFC 8032 |
| Assinatura pós-quântica | ML-DSA-65 | FIPS 204 |
| Assinatura pós-quântica sem estado | SLH-DSA-192f | FIPS 205 |
| Encapsulamento de chaves pós-quântico | ML-KEM-768 | FIPS 203 |
| Hashes | SHA-256 + SHA3-256 | FIPS 180-4, FIPS 202 |
| Canonicalização | `dcp-jcs-v1` | Baseada na RFC 8785 (JCS) |

<a id="development"></a>

## Desenvolvimento

<a id="prerequisites"></a>

### Pré-requisitos

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target
rustup target add wasm32-unknown-unknown
```

<a id="run-rust-wasm-tests"></a>

### Executar os testes WASM de Rust

```bash
cd ../rust
wasm-pack test --headless --chrome -- --features wasm
```

<a id="license"></a>

## Licença

Apache-2.0
