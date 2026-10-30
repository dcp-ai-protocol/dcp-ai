<sub>[English](../../../docs/MIGRATION_V1_V2.md) · [中文](../../zh-CN/docs/MIGRATION_V1_V2.md) · [Español](../../es/docs/MIGRATION_V1_V2.md) · [日本語](../../ja/docs/MIGRATION_V1_V2.md) · **Português**</sub>

<a id="migration-guide-dcp-ai-v10-to-v20"></a>

# Guia de migração: do DCP-AI v1.0 para o v2.0

> Tradução informativa da [versão em inglês](../../../docs/MIGRATION_V1_V2.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

**Versão da especificação:** 2.0
**Última atualização:** outubro de 2026
**Aplica-se a:** os SDKs de `main` e `@dcp-ai/sdk` 2.2.1 publicado. As versões npm foram verificadas em 28/10/2026; veja [NPM_RELEASES.md](../../../docs/NPM_RELEASES.md) e [SECURITY.md](../../../SECURITY.md#supported-versions). As versões dos outros SDKs estão em [Versões publicadas](../../../docs/README.md#published-versions).

Este guia conduz você na migração de uma integração existente do DCP-AI v1.0 para o v2.0. A migração introduz assinaturas compostas pós-quânticas, cadeias de hash duplo, vinculação de sessão, níveis de segurança adaptativos e comunicação entre agentes, enquanto os bundles v1.0 válidos continuam sendo verificados onde a política do verificador os permitir (veja 1.2).

---

<a id="1-what-changed-in-v20"></a>

## 1. O que mudou na v2.0

<a id="11-summary-of-changes"></a>

### 1.1 Resumo das mudanças

| Recurso | v1.0 | v2.0 |
|---------|------|------|
| **Assinaturas** | Somente Ed25519 | Compostas: Ed25519 + ML-DSA-65 (PQ) |
| **Cadeias de hash** | Somente SHA-256 | Duplas: SHA-256 + SHA3-256 |
| **Vinculação de sessão** | Nenhuma | `session_nonce` em cada artefato |
| **Níveis de segurança** | Nenhum | Adaptativos: routine / standard / elevated / maximum |
| **Manifesto do bundle** | `bundle_hash` + `merkle_root` | Manifesto completo com hashes por artefato, raiz de Merkle secundária e checkpoints PQ |
| **Formato de assinatura** | `{ alg, public_key_b64, sig_b64 }` | `{ composite_sig: { classical, pq, binding } }` |
| **Comunicação A2A** | Não especificada | DCP-04: descoberta, handshake, sessões cifradas |
| **Política de verificação** | Declarada pelo agente | Decidida pelo verificador |
| **Separação de domínio** | Nenhuma | Tags de contexto em todas as assinaturas |
| **Derivação do kid** | Específica de cada implementação | Determinística: `hex(SHA-256(alg || 0x00 || pk))[0:32]` |
| **Campos numéricos** | Mistos (int/float) | Somente inteiros (float proibido) |
| **Privacidade** | Somente RPR completo | Modo de RPR ocultado disponível |
| **Recuperação de chaves** | Não especificada | Recuperação social M de N (Shamir SSS) |
| **Revogação de emergência** | Não especificada | Token de revogação pré-registrado |
| **Governança de algoritmos** | Não especificada | Avisos assinados com resposta automática |
| **Formato de transmissão** | Somente JSON | JSON (padrão) + CBOR (opcional) |

<a id="12-breaking-changes"></a>

### 1.2 Mudanças incompatíveis

O formato v1.0 continua válido, com estes limites:

- Um verificador que lida com as duas versões aceita um bundle v1.0 válido quando a política dele tem `allow_v1_bundles: true`
  (o padrão) e o modo efetivo tolera uma assinatura somente clássica (abaixo). O próprio `verifySignedBundleV2`
  aceita somente a v2.0: encaminhe os bundles v1.0 ao verificador V1 (veja 3.2).
- A aceitação é mais estrita do que em versões anteriores: por exemplo, agora é rejeitada uma assinatura Ed25519 cujo `S` não seja menor que a
  ordem do grupo `L` (veja [`[Unreleased]`](../../../CHANGELOG.md#unreleased) do changelog), então um
  bundle v1.0 armazenado que um verificador anterior aceitava pode deixar de ser verificado.
- Os verificadores v1.0 rejeitam bundles v2.0 (`"unsupported dcp_version 2.0"`).

Um bundle v1.0 tem uma assinatura Ed25519 e nenhuma pós-quântica, então os middlewares de verificação (`@dcp-ai/express`, `@dcp-ai/openclaw`, `dcp_ai.fastapi`) só o aceitam onde um bundle v2.0 somente clássico passaria (VERIFICATION.md V2-10): o mais estrito entre o modo da política para o `risk_tier` do passaporte V1 e o modo do nível de segurança calculado a partir da intenção e da decisão de política V1 (o `risk_score` V1, de 0 a 1, multiplicado por 1000; se ausente, conta como `elevated`) precisa ser `classical_only` ou `hybrid_preferred`. Sob a política padrão, um bundle V1 com uma intenção routine ou standard passa, e um com pagamento, dados sensíveis, impacto estimado alto ou pontuação de risco de 0.5 ou mais é recusado; `requireHybrid` do Express recusa todos os bundles V1.

A migração é **aditiva**: a v2.0 introduz campos e estruturas novos ao lado do formato v1.0. Você pode migrar produtores (agentes) e consumidores (verificadores) de forma independente.

---

<a id="2-step-by-step-migration"></a>

## 2. Migração passo a passo

<a id="step-1-update-sdk"></a>

### Etapa 1: atualizar o SDK

Os exemplos funcionam com TypeScript SDK 2.2.1, Python `dcp-ai` 2.10.1, Go `v2.11.1` e Rust `dcp-ai` 2.11.1 publicados. Veja as notas de [Python](../../../docs/PYTHON_RELEASE.md), [Go](../../../docs/GO_RELEASE.md) e [Rust](../../../docs/RUST_RELEASE.md), e os limites documentados no README de cada SDK.

**TypeScript** (publicado: 2.2.1 em 28/10/2026):

```bash
npm install @dcp-ai/sdk@^2.2.1
```

**Python:**

```bash
pip install -e /path/to/dcp-ai/sdks/python     # main
# or the published version, with optional framework extras: pip install --upgrade 'dcp-ai[fastapi]'
```

**Go** (observe o sufixo de versão maior v2 exigido pelos módulos Go):

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

**Rust:**

```toml
dcp-ai = "2.11.1"
```

**WebAssembly:** compile `sdks/wasm` a partir de uma cópia do repositório (`npm run build`) e depois `npm install /path/to/dcp-ai/sdks/wasm`.

<a id="step-2-generate-hybrid-key-pairs"></a>

### Etapa 2: gerar pares de chaves híbridos

Esta migração híbrida usa pares de chaves clássicos (Ed25519) e pós-quânticos (ML-DSA-65). A aceitação de assinaturas somente clássicas continua sujeita ao modo efetivo de verificação (1.2).

**TypeScript:**

```typescript
import { getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

registerDefaultProviders(); // Ed25519, ML-DSA-65, SLH-DSA-192f into the default registry
const registry = getDefaultRegistry();

const classicalKp = await registry.getSigner('ed25519').generateKeypair();
const pqKp = await registry.getSigner('ml-dsa-65').generateKeypair();
// each: { kid, publicKeyB64, secretKeyB64 }; kid = deriveKid(alg, publicKey)
```

**Python:**

```python
import asyncio
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider

async def generate_hybrid():
    return await Ed25519Provider().generate_keypair(), await MlDsa65Provider().generate_keypair()

classical, pq = asyncio.run(generate_hybrid())
# each: {"kid", "public_key_b64", "secret_key_b64"}
```

O SDK Python constrói, assina e verifica bundles V2 com `dcp_ai.v2` (`BundleBuilderV2`, `sign_bundle_v2`,
`verify_signed_bundle_v2`; veja 5.2).

**CLI** (`bin/dcp.js` numa cópia do repositório):

```bash
dcp keygen --hybrid ./keys/
# Creates: ed25519_{public_key,secret_key,kid}.txt and ml_dsa_65_{public_key,secret_key,kid}.txt
```

<a id="step-3-update-artifact-construction"></a>

### Etapa 3: atualizar a construção dos artefatos

Cada um dos quatro artefatos V2 (RPR, passaporte, intenção e decisão de política) recebe `dcp_version: "2.0"` e o `session_nonce` do bundle, e é assinado separadamente como um
`SignedPayload` (etapa 4). As chaves passam para dentro dos artefatos: o RPR lista as chaves do principal em `binding_keys`,
e o passaporte lista as do agente em `keys`, cada uma com `kid`, `alg`, `public_key_b64`, `created_at`,
`expires_at` e `status`.

**Antes (RPR v1.0):** uma `signature` Ed25519 separada sobre o objeto sem ela.

```json
{
  "dcp_version": "1.0",
  "human_id": "human:example-001",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "signature": "<base64 Ed25519 signature>"
}
```

**Depois (payload do RPR v2.0):** sem campo `signature`; a assinatura composta fica ao lado do payload (etapa 4).

```json
{
  "dcp_version": "2.0",
  "human_id": "human:example-001",
  "session_nonce": "<64 hex characters>",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "binding_keys": [
    { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" },
    { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" }
  ]
}
```

Principais diferenças:
- `dcp_version` é `"2.0"`, e `session_nonce` (64 caracteres hexadecimais, 256 bits aleatórios) é o mesmo em todos os
  artefatos do bundle.
- O passaporte substitui `public_key` por `keys` (entradas Ed25519 e ML-DSA-65), e o `risk_score` da decisão de política
  passa a ser um inteiro de 0 a 1000 (spec §14.2).
- As assinaturas saem dos payloads.

<a id="step-4-switch-to-composite-signatures"></a>

### Etapa 4: passar para assinaturas compostas

Cada um desses quatro artefatos V2 é um `SignedPayload`: o payload, o hash dele e uma assinatura composta no contexto de separação de domínio
do artefato (o RPR com as chaves do principal; o passaporte, a intenção e a decisão de política com as do
agente).

```json
{
  "payload": { "dcp_version": "2.0", "...": "..." },
  "payload_hash": "sha256:<hex of the canonical payload>",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

Principais diferenças:
- Cada componente nomeia sua chave pelo `kid` (determinístico, etapa 2) em vez de trazer a chave pública.
- `binding: "pq_over_classical"`: a assinatura PQ cobre a assinatura clássica, então a assinatura clássica não pode
  ser substituída sem invalidar a PQ. A própria assinatura PQ ainda pode ser removida e a vinculação reetiquetada como
  `classical_only`: os verificadores aceitam isso nos modos `classical_only` e `hybrid_preferred` (neste último, com um
  aviso) e recusam em `hybrid_required` e `pq_only`. Uma assinatura PQ presente, mas inválida, é recusada em todos os modos.

**SDK TypeScript** (um fragmento; o
[Quick Start (V2)](../../../sdks/typescript/README.md#quick-start-v2) do SDK TypeScript é o fluxo completo e executável):

```typescript
import { compositeSign, preparePayload, DCP_CONTEXTS } from '@dcp-ai/sdk';

// payload: a V2 artifact payload; registry and agentKeys (a CompositeKeyPair) as in Step 2
const { canonicalBytes, payloadHash } = preparePayload(payload);
const signedIntent = {
  payload,
  payload_hash: payloadHash,
  composite_sig: await compositeSign(registry, DCP_CONTEXTS.Intent, canonicalBytes, agentKeys),
};
```

<a id="step-5-add-domain-separation"></a>

### Etapa 5: adicionar a separação de domínio

Cada assinatura V2 é calculada sobre `UTF8(context) || 0x00 || canonical_bytes`, com o contexto do artefato
(`DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle` e assim por diante, `DCP_CONTEXTS`). `compositeSign`, `signBundleV2` e seus
equivalentes nos outros SDKs fazem isso por você. Se você mesmo montar a mensagem, use a canonicalização V2
(`dcp-jcs-v1`):

```typescript
import { canonicalizeV2, domainSeparatedMessage, DCP_CONTEXTS } from '@dcp-ai/sdk';

// manifest: the bundle manifest (Step 7)
const message = domainSeparatedMessage(DCP_CONTEXTS.Bundle, new TextEncoder().encode(canonicalizeV2(manifest)));
// classical signature over `message`; the PQ signature over `message || classical signature bytes`
```

<a id="step-6-update-audit-entries"></a>

### Etapa 6: atualizar as entradas de auditoria

**Antes (v1.0):**

```json
{
  "dcp_version": "1.0",
  "audit_id": "audit:example-001",
  "prev_hash": "GENESIS",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "<hex>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null }
}
```

**Depois (v2.0):**

```json
{
  "dcp_version": "2.0",
  "audit_id": "audit:example-001",
  "session_nonce": "<the bundle's nonce>",
  "prev_hash": "GENESIS",
  "hash_alg": "sha256",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "sha256:<hex of the canonical intent payload>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null, "evidence_hash": null },
  "pq_checkpoint_ref": null
}
```

Campos novos: `session_nonce`, `hash_alg`, `evidence.evidence_hash` e `pq_checkpoint_ref`; os hashes levam o
prefixo `sha256:`. Uma cadeia de hash duplo acrescenta `prev_hash_secondary` (SHA3-256) e `hash_alg: "sha256+sha3-256"`.
Os verificadores V2 desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1, incluindo o candidato experimental, verificam os elos secundários, os hashes de intenção e `audit_merkle_root_secondary` que estejam presentes; os ausentes não são exigidos e as versões anteriores não os verificam, então produzir esses campos só comprova a proteção adicional quando tanto o produtor quanto o verificador a incluem
([STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)).
As entradas de auditoria não são assinadas uma a uma: o manifesto se compromete com elas por meio da raiz de Merkle da auditoria, e os checkpoints
PQ assinam intervalos delas.

<a id="step-7-construct-bundle-manifest"></a>

### Etapa 7: construir o manifesto do bundle

A V1 assina o bundle inteiro (`signature.bundle_hash`); a V2 assina um manifesto que se compromete com cada artefato.

**Antes (bundle assinado v1.0):**

```json
{
  "bundle": {
    "responsible_principal_record": { "...": "..." },
    "agent_passport": { "...": "..." },
    "intent": { "...": "..." },
    "policy_decision": { "...": "..." },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "alg": "ed25519",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "public_key_b64": "..." },
    "bundle_hash": "sha256:<hex>",
    "merkle_root": "sha256:<hex>",
    "sig_b64": "..."
  }
}
```

**Depois (bundle assinado v2.0):**

```json
{
  "bundle": {
    "dcp_bundle_version": "2.0",
    "manifest": {
      "session_nonce": "<64 hex>",
      "rpr_hash": "sha256:...",
      "passport_hash": "sha256:...",
      "intent_hash": "sha256:...",
      "policy_hash": "sha256:...",
      "audit_merkle_root": "sha256:...",
      "audit_count": 1,
      "canonicalization_profile": "dcp-jcs-v1"
    },
    "responsible_principal_record": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "agent_passport": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "intent": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "policy_decision": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "hash_alg": "sha256",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "kids": ["<classical kid>", "<pq kid>"] },
    "manifest_hash": "sha256:<hex of the canonical manifest>",
    "composite_sig": { "classical": { "...": "..." }, "pq": { "...": "..." }, "binding": "pq_over_classical" }
  }
}
```

O manifesto:
- tem um hash por artefato (o `payload_hash` de cada artefato) e a raiz de Merkle da auditoria;
- pode acrescentar `audit_merkle_root_secondary` (SHA3-256), `pq_checkpoints`, a janela de sessão assinada
  (`session_issued_at`, `session_expires_at`), `intended_verifier` e `canonicalization_profile`;
- é assinado pelo principal responsável com uma assinatura composta no contexto `DCP-AI.v2.Bundle`.

<a id="step-8-update-verifier-configuration"></a>

### Etapa 8: atualizar a configuração do verificador

A verificação V2 recebe uma política de verificador decidida pelo verificador, não pelo bundle. Parta do
`DEFAULT_VERIFIER_POLICY` e altere o que precisar: os campos que você omitir não são preenchidos com os padrões
(sem `max_key_age_days`, por exemplo, nenhum aviso de idade de chave é produzido; essa verificação avisa, não rejeita).

```typescript
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '@dcp-ai/sdk';
import type { VerifierPolicy } from '@dcp-ai/sdk';

const policy: VerifierPolicy = {
  ...DEFAULT_VERIFIER_POLICY,
  default_mode: 'hybrid_required',
  risk_overrides: { high: 'hybrid_required', medium: 'hybrid_required', low: 'hybrid_preferred' },
  allow_v1_bundles: true,
};
// signedBundle and registry as in the TypeScript SDK's Quick Start (V2)
const result = await verifySignedBundleV2(signedBundle, registry, policy);
```

Os campos estão na [referência da API](../../../docs/API_REFERENCE.md#verifierpolicy). Mantenha `allow_v1_bundles: true` durante o
período de transição. Os bundles V1 continuam precisando de um modo que tolere uma assinatura somente clássica: com esta política
(`hybrid_required` para os níveis medium e high), os middlewares de verificação só aceitam bundles V1 de
passaportes de baixo risco com intenções routine ou standard.

<a id="step-9-add-security-tier-support-optional"></a>

### Etapa 9: adicionar suporte aos níveis de segurança (opcional)

Calcule o nível de segurança a partir da intenção e da decisão de política, que traz o `risk_score`:

```typescript
// Fragment: the intent and the policy decision are V2 payloads, shortened here.
import { computeSecurityTier } from '@dcp-ai/sdk';
import type { IntentV2, PolicyDecisionV2 } from '@dcp-ai/sdk';

const intent = {
  intent_id: 'intent:...',
  action_type: 'api_call',
  data_classes: ['pii'],
  estimated_impact: 'medium',
  // ...
} as IntentV2;
const policyDecision = { risk_score: 350 /* , ... */ } as PolicyDecisionV2;

const tier = computeSecurityTier(intent, policyDecision);
// tier = "elevated" (pii is sensitive data; risk_score 350 alone would give "standard")
```

<a id="step-10-run-conformance-tests"></a>

### Etapa 10: executar os testes de conformidade

A partir da raiz de uma cópia do repositório (cada comando no próprio subshell):

```bash
# TypeScript
(cd sdks/typescript && npm test)

# Python
(cd sdks/python && pytest)

# NIST KAT compliance only
(cd sdks/typescript && npx vitest run src/__tests__/nist-kat.test.ts)

# Protocol conformance (V1 + V2)
npm run conformance
```

---

<a id="3-backward-compatibility"></a>

## 3. Compatibilidade com versões anteriores

<a id="31-compatibility-matrix"></a>

### 3.1 Matriz de compatibilidade

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true and the effective mode
                                    for the bundle is classical_only or hybrid_preferred)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

<a id="32-coexistence-strategy"></a>

### 3.2 Estratégia de coexistência

Durante a migração, seu sistema pode lidar com bundles v1.0 e v2.0 encaminhando-os pela versão:

```typescript
// Fragment: signedBundle comes from the request; v1PublicKeyB64, registry and policy from configuration.
import { detectDcpVersion, verifySignedBundle, verifySignedBundleV2 } from '@dcp-ai/sdk';

const version = detectDcpVersion(signedBundle);  // '2.0', '1.0', or null for anything else
let result;
if (version === '2.0') {
  result = await verifySignedBundleV2(signedBundle, registry, policy);  // composite verification, tier enforcement
} else if (version === '1.0' && policy.allow_v1_bundles) {
  result = verifySignedBundle(signedBundle, v1PublicKeyB64);           // the Ed25519 signature, hashes and chain
} else {
  result = { verified: false, errors: ['unsupported or disallowed bundle version'] };
}
```

Isso só encaminha formatos. O ramo V1 não aplica ao bundle V1 os modos da política V2 nem o nível de segurança
(VERIFICATION.md V2-10), e nenhum dos ramos decide a confiança: o primeiro papel cabe aos middlewares de verificação, e
o segundo, à [admissão](../../../docs/ADMISSION.md). `verifySignedBundleV2` só aceita bundles v2.0; a CLI de referência
(`dcp verify-bundle`) e os middlewares encaminham pela versão por conta própria.

<a id="33-schema-routing"></a>

### 3.3 Seleção de esquemas

Um verificador encaminha pela versão do bundle antes de verificar o esquema dele:

- um bundle assinado V2 tem `bundle.dcp_bundle_version: "2.0"` e um `bundle.manifest` → `schemas/v2/*.schema.json`;
- os artefatos de um bundle V1 trazem `dcp_version: "1.0"` → `schemas/v1/*.schema.json`.

<a id="34-when-to-drop-v1-support"></a>

### 3.4 Quando deixar de suportar a V1

Segundo a especificação, os verificadores V2 DEVEM suportar bundles V1 indefinidamente. No entanto, cada implantação pode definir uma política que rejeite bundles V1 após um período de transição:

```json
{
  "verifier_policy": {
    "allow_v1_bundles": false
  }
}
```

Isso só deve ser feito depois que todos os agentes do seu ecossistema tiverem migrado para a v2.0.

---

<a id="4-bundle-format-changes-detailed"></a>

## 4. Mudanças no formato do bundle (em detalhe)

<a id="41-signed-bundle-envelope"></a>

### 4.1 Envelope do bundle assinado

Os envelopes V1 e V2 completos estão na [etapa 7](#step-7-construct-bundle-manifest). Principais diferenças estruturais:

- **Assinatura individual dos artefatos:** o RPR, o passaporte, a intenção e a decisão de política são, cada um, um `SignedPayload`
  (`payload`, `payload_hash`, `composite_sig`) assinado no próprio contexto. As entradas de auditoria continuam sem assinatura e
  são comprometidas por meio da raiz de Merkle da auditoria.
- **Manifesto:** `bundle.manifest` se compromete com o hash de cada artefato e com a raiz de Merkle da auditoria; ele substitui o
  `signature.bundle_hash` da V1.
- **Nonce de sessão:** o mesmo `session_nonce` em cada artefato, cada entrada de auditoria e no manifesto.
- **Assinatura do bundle:** `signature.composite_sig` assina o manifesto (`signature.manifest_hash`), não o bundle
  inteiro; `signature.signer.kids` nomeia as chaves em vez de trazer uma chave pública.
- **Marcador de versão:** `bundle.dcp_bundle_version: "2.0"`.

<a id="42-composite-signature-object"></a>

### 4.2 Objeto de assinatura composta

```json
{
  "composite_sig": {
    "classical": {
      "alg": "ed25519",
      "kid": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "sig_b64": "<base64-encoded Ed25519 signature>"
    },
    "pq": {
      "alg": "ml-dsa-65",
      "kid": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "sig_b64": "<base64-encoded ML-DSA-65 signature>"
    },
    "binding": "pq_over_classical"
  }
}
```

<a id="43-audit-entry-changes"></a>

### 4.3 Mudanças nas entradas de auditoria

| Campo | v1.0 | v2.0 |
|-------|------|------|
| `dcp_version` | `"1.0"` | `"2.0"` |
| `session_nonce` | Ausente | Obrigatório |
| `prev_hash` | SHA-256 em hexadecimal da entrada anterior, ou `"GENESIS"` | `sha256:<hex>` da entrada anterior, ou `"GENESIS"` |
| `hash_alg` | Ausente | Obrigatório: `sha256`, ou `sha256+sha3-256` com uma cadeia de hash duplo |
| `prev_hash_secondary` | Ausente | Opcional: `sha3-256:<hex>` (cadeia de hash duplo) |
| `intent_hash` | SHA-256 em hexadecimal | `sha256:<hex>` |
| `intent_hash_secondary` | Ausente | Opcional: `sha3-256:<hex>` |
| `evidence.evidence_hash` | Ausente | Presente, pode ser `null` |
| `pq_checkpoint_ref` | Ausente | Obrigatório, pode ser `null` |
| Assinatura | Nenhuma por entrada; a assinatura do bundle as cobre | Nenhuma por entrada; a raiz de Merkle da auditoria do manifesto se compromete com elas, e os checkpoints PQ assinam intervalos delas |

---

<a id="5-sdk-api-changes"></a>

## 5. Mudanças na API dos SDKs

<a id="51-typescript-sdk"></a>

### 5.1 SDK TypeScript

| API v1.0 | API v2.0 | Observações |
|----------|----------|-------|
| `signBundle(bundle, secretKey)` | `signBundleV2(bundle, { registry, signerType, signerId, keys })` | Assinatura composta sobre o manifesto |
| `verifySignedBundle(sb, publicKey)` | `verifySignedBundleV2(sb, registry, policy?)` | Verificação orientada pela política |
| `new BundleBuilder()…build()` | `new BundleBuilderV2(sessionNonce)…build()` | Nonce de sessão obrigatório; os artefatos são `SignedPayload`s |
| `hashObject(obj)` | `hashObject(obj)` (inalterado) | Continua SHA-256 + JCS |
| N/A | `dualHashCanonical(canonicalJson)` | SHA-256 + SHA3-256 |
| N/A | `registerDefaultProviders()` + `getDefaultRegistry()` | Ed25519, ML-DSA-65 e SLH-DSA-192f via o registro de algoritmos |
| N/A | `computeSecurityTier(intent, policyDecision?)` | Cálculo adaptativo do nível (spec §14.2) |
| N/A | `deriveKid(alg, publicKeyBytes)` | kid determinístico |
| N/A | `compositeSign(registry, context, payloadBytes, keys)` | Assinatura composta manual |
| N/A | `compositeVerify(registry, context, payloadBytes, sig, classicalPk, pqPk?)` | Verificação composta manual |

<a id="52-python-sdk"></a>

### 5.2 SDK Python

| API v1.0 | API v2.0 | Observações |
|----------|----------|-------|
| `sign_bundle(bundle, secret_key)` | `prepare_payload` + `await composite_sign(registry, context, payload_bytes, classical_key, pq_key)` por artefato, depois `BundleBuilderV2(session_nonce)…build()` + `await sign_bundle_v2(bundle, registry, signer_type, signer_id, classical_key, pq_key)` (`dcp_ai.v2`) | Assinaturas compostas sobre cada artefato e sobre o manifesto |
| `verify_signed_bundle(sb, public_key)` | `await verify_signed_bundle_v2(signed_bundle, registry, policy=None)` (`dcp_ai.v2`) | Orientada pela política |
| N/A | `Ed25519Provider` / `MlDsa65Provider` (`dcp_ai.providers`), `generate_keypair()` assíncrono | Chaves híbridas |
| N/A | `compute_security_tier(intent, policy_decision=None)` (`dcp_ai.v2`) | Nível adaptativo (spec §14.2) |
| N/A | `derive_kid(alg, public_key_bytes)` (`dcp_ai.v2`) | kid determinístico |

<a id="53-go-sdk"></a>

### 5.3 SDK Go

| API v1.0 | API v2.0 | Observações |
|----------|----------|-------|
| `SignObject(bundle, secretKeyB64)` | `v2.SignPayload(registry, context, payload, classicalKey, pqKey)` por artefato, depois `v2.BuildBundleV2(input)` + `v2.SignBundleV2(registry, bundle, classicalKey, pqKey)` | Assinaturas compostas sobre cada artefato e sobre o manifesto |
| `VerifySignedBundle(sb, publicKeyB64)` | `v2.VerifySignedBundleV2(registry, signedBundleJSON)` | Orientada pela política |
| N/A | `GenerateKeypair()` em `providers.Ed25519Provider` / `providers.MlDsa65Provider` | Chaves híbridas |
| N/A | `v2.ComputeSecurityTier(input)`, `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Nível adaptativo (spec §14.2) |
| N/A | `v2.DeriveKid(alg, publicKey)` | kid determinístico |

<a id="54-rust-sdk"></a>

### 5.4 SDK Rust

| API v1.0 | API v2.0 | Observações |
|----------|----------|-------|
| `sign_object(bundle, secret_key_b64)` | `prepare_payload` (`dcp_ai::v2::signed_payload`) + `composite_sign(ed, pq, context, payload_bytes, classical_key, pq_key)` (`dcp_ai::v2::composite_ops`) por artefato, depois `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` + `sign_bundle_v2(bundle, &classical_key, &pq_key)` (`dcp_ai::v2::bundle`) | Assinaturas compostas sobre cada artefato e sobre o manifesto |
| `verify_signed_bundle(sb, public_key_b64)` | `verify_signed_bundle_v2_with_policy(&signed_bundle, &policy)` (`dcp_ai::v2::verify_bundle`) | Orientada pela política |

<a id="55-cli-changes"></a>

### 5.5 Mudanças na CLI

| Comando v1.0 | Comando v2.0 | Observações |
|-------------|-------------|-------|
| `dcp keygen [out_dir]` | `dcp keygen --hybrid [out_dir]` | Gera os dois tipos de chave |
| `dcp sign-bundle` | `dcp sign-bundle --composite <bundle_v2.json> <ed25519_sk> <ml_dsa_65_sk> [out]` | Assinatura composta via `@dcp-ai/sdk` |
| `dcp verify-bundle` | `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` | Verificação V2 completa; `<mode>` é `classical_only`, `hybrid_preferred`, `hybrid_required` ou `pq_only`; a chave fixa o assinante clássico |
| N/A | `dcp kid <public_key_file> --alg <algorithm>` | Calcula o kid |
| N/A | `dcp recovery-setup --threshold <M> --shares <N> [out]` | Recuperação social M de N |
| N/A | `dcp emergency-revoke --agent <id> --token <secret>` | Revogação de botão de pânico |
| N/A | `dcp rotate-key --old-kid <kid> --new-alg <alg>` | Rotação de chaves com prova de posse |
| N/A | `dcp capabilities <endpoint_url>` | Consulta as capacidades de um endpoint |
| N/A | `dcp advisory check [url]` | Verifica os avisos sobre algoritmos |

---

<a id="6-testing-your-migration"></a>

## 6. Testar a migração

<a id="61-verification-checklist"></a>

### 6.1 Checklist de verificação

Percorra este checklist para confirmar que a migração está completa:

- [ ] **Geração de chaves**: os pares de chaves híbridos (Ed25519 + ML-DSA-65) são gerados com sucesso
- [ ] **Derivação do kid**: `deriveKid('ed25519', pk)` corresponde ao valor esperado
- [ ] **Derivação do kid**: `deriveKid('ml-dsa-65', pk)` corresponde ao valor esperado
- [ ] **Construção do RPR**: o RPR v2.0 inclui `dcp_version`, `session_nonce` e os dois tipos de chave
- [ ] **Construção do passaporte**: o passaporte v2.0 inclui `dcp_version` e `session_nonce`
- [ ] **Construção da intenção**: a intenção v2.0 inclui `dcp_version` e `session_nonce` (e, opcionalmente, um `security_tier` que só pode elevar o nível calculado)
- [ ] **Assinatura composta**: `signBundleV2` produz assinaturas compostas válidas
- [ ] **Separação de domínio**: as assinaturas incluem tags de contexto
- [ ] **Vinculação composta**: a assinatura PQ cobre os bytes da assinatura clássica
- [ ] **Cadeia de hash duplo**: as entradas de auditoria incluem `prev_hash_secondary` (SHA3-256); os verificadores desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 verificam cada elo presente (passo 6); as versões anteriores não
- [ ] **Manifesto**: o manifesto do bundle contém todos os hashes dos artefatos e, com uma cadeia de hash duplo, a raiz de Merkle secundária, que os verificadores desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 verificam quando presente
- [ ] **Nonce de sessão**: todos os artefatos de um bundle compartilham o mesmo nonce
- [ ] **Verificação V2**: `verifySignedBundleV2` (ou `dcp verify-bundle`) passa com bundles v2.0 assinados corretamente
- [ ] **Compatibilidade V1**: os bundles v1.0 continuam sendo verificados com a função V1 `verifySignedBundle` (que só aceita a v1.0), com `dcp verify-bundle` ou com um roteador por versão como o de 3.2; a função V2 `verifySignedBundleV2` só aceita a v2.0
- [ ] **Detecção de adulteração**: modificar qualquer campo de um artefato faz a verificação falhar
- [ ] **Detecção de remoção**: remover a assinatura PQ (com a vinculação reetiquetada como `classical_only`) falha com `hybrid_required` e `pq_only` e é aceito com `classical_only` e `hybrid_preferred`; uma assinatura PQ presente, mas inválida, falha em todos os modos
- [ ] **NIST KAT**: todas as operações criptográficas passam na validação KAT
- [ ] **Entre SDKs**: bundles assinados por um SDK são verificados em outro

<a id="62-common-migration-issues"></a>

### 6.2 Problemas comuns de migração

**Problema: «kid mismatch» durante a verificação**

A derivação do kid na v2.0 é determinística: `hex(SHA-256(UTF8(alg) || 0x00 || raw_pk))[0:32]`. Se a sua implementação v1.0 usava outro esquema de kid, regenere os kids com a fórmula da v2.0. A função `deriveKid` do SDK cuida disso.

**Problema: «session_nonce mismatch» entre artefatos**

Todos os artefatos de um mesmo bundle DEVEM compartilhar o mesmo `session_nonce`. Gere o nonce uma vez por criação de bundle e passe-o a todos os construtores de artefatos.

**Problema: «composite_sig.pq verification failed»**

A assinatura PQ assina `context || 0x00 || payload || classical_sig`. Garanta que os bytes da assinatura clássica (brutos, não em base64) sejam acrescentados à mensagem assinada antes da assinatura PQ.

**Problema: «unsupported dcp_version 2.0» vindo de um verificador v1.0**

Isso é esperado. Verificadores v1.0 não conseguem processar bundles v2.0. O verificador de origem precisa ser atualizado para um SDK compatível com a v2.0.

**Problema: valores float em payloads assinados**

A v2.0 proíbe números de ponto flutuante em todos os payloads assinados (ambiguidade de canonicalização). Substitua `risk_score: 0.75` por uma escala inteira: `risk_score: 750` (0-1000).

**Problema: bundles grandes**

Os bundles v2.0 são maiores, principalmente por causa das assinaturas ML-DSA-65 (3309 B cada). Meça seus maiores
bundles no formato que seu verificador realmente lê e dê ao corpo da requisição um orçamento de tamanho explícito
(veja [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#security-tiers-in-verification)). O servidor de verificação de referência só lê corpos JSON, embora seu
documento de capacidades liste `application/cbor`, e só o SDK TypeScript tem um codificador CBOR (`cborEncode`);
este repositório não publica nenhuma redução de tamanho medida para ele. `presentCompact` remove a assinatura PQ
(vinculação `classical_only`), então esse bundle só passa onde o modo efetivo é `classical_only` ou
`hybrid_preferred`. O tamanho no transporte não é motivo para baixar um nível de segurança.

<a id="63-validating-migrated-bundles"></a>

### 6.3 Validar os bundles migrados

A CLI não tem um verificador de migração da v1.0 para a v2.0. Em vez disso, verifique cada bundle migrado com o verificador V2:

```bash
dcp verify-bundle --policy hybrid_required signed_bundle_v2.json
```

Ele verifica os hashes do manifesto, a vinculação de sessão, as assinaturas compostas e a cadeia de auditoria. `risk_score` pertence à decisão de política, como inteiro de 0 a 1000; o esquema de intenção V2 não o permite (spec §14.2).

---

<a id="7-recommended-migration-order"></a>

## 7. Ordem de migração recomendada

Para equipes que migram um sistema em produção, a ordem recomendada é:

1. **Atualizar o SDK** para a versão mais recente com suporte à v2.0.
2. **Atualizar primeiro os verificadores** com `allow_v1_bundles: true`. Isso garante que seus verificadores lidem com bundles v1.0 e v2.0 durante a transição.
3. **Gerar pares de chaves híbridos** para todos os agentes e pessoas.
4. **Atualizar a construção dos artefatos** para incluir `dcp_version: "2.0"`, `session_nonce` e entradas de chaves duplas.
5. **Passar para assinaturas compostas** com as APIs de assinatura da v2.0.
6. **Adicionar cadeias de hash duplo** às entradas de auditoria.
7. **Implementar a estrutura do manifesto do bundle**.
8. **Assinar as intenções sensíveis com assinaturas híbridas.** Os verificadores V2 aplicam o nível de segurança (spec §14.3): um bundle `classical_only` é rejeitado para um pagamento, dados sensíveis, impacto alto ou um `risk_score` da decisão de política de 500 ou mais.
9. **Executar os testes de conformidade completos**, inclusive a validação com NIST KAT.
10. **Desativar a aceitação de bundles v1.0** quando todos os agentes do seu ecossistema tiverem migrado.

---

<a id="8-timeline-and-support"></a>

## 8. Cronograma e suporte

| Fase | Cronograma | Ações |
|-------|----------|---------|
| **Preparação** | Semanas 1-2 | Atualizar o SDK, gerar chaves híbridas, revisar este guia |
| **Atualização dos verificadores** | Semanas 2-3 | Implantar verificadores v2.0 compatíveis com a v1 |
| **Migração dos agentes** | Semanas 3-6 | Atualizar a construção dos artefatos, passar para assinaturas compostas |
| **Validação** | Semanas 6-8 | Executar testes de conformidade e de interoperabilidade entre SDKs |
| **Virada** | Semana 8 em diante | Definir `allow_v1_bundles: false` quando estiver pronto |

Para suporte à migração:
- Issues ou Discussions do GitHub: [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai)
- Relatórios privados de vulnerabilidades pela interface de avisos de segurança do GitHub
- E-mail aos mantenedores conforme [GOVERNANCE.md](../../../GOVERNANCE.md)

No momento não há Slack, Discord nem horários de atendimento dedicados. Veja [EARLY_ADOPTERS.md](../../../docs/EARLY_ADOPTERS.md) para o modelo de suporte atual.

---

<a id="references"></a>

## Referências

- [Especificação normativa DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md)
- [DCP-04: comunicação entre agentes](../../../spec/DCP-04.md)
- [Modelo de segurança](../../../docs/SECURITY_MODEL.md)
- [Declaração de conformidade com o NIST](../../../docs/NIST_CONFORMITY.md)
- [Vetores de teste NIST KAT](../../../tests/nist-kat/README.md)
- [Arquitetura técnica](../../../docs/TECHNICAL_ARCHITECTURE.md)
