<sub>[English](QUICKSTART.md) · [中文](QUICKSTART.zh-CN.md) · [Español](QUICKSTART.es.md) · [日本語](QUICKSTART.ja.md) · **Português**</sub>

<a id="dcp-ai-quick-start-guide"></a>

# Guia de início rápido do DCP-AI

> Tradução informativa da [versão em inglês](QUICKSTART.md), atualizada em 27/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este guia mostra como produzir e verificar evidências DCP com um SDK, e quais ferramentas são demonstrações.

<a id="choose-a-path"></a>

## Escolha um caminho

- **Produzir e verificar evidências com um SDK.** Instale um SDK publicado. Os exemplos de [§3 TypeScript](#3-typescript-sdk)
  e [§4 Python](#4-python-sdk) criam bundles assinados e os verificam; [Outros SDKs](#other-sdks) traz a instalação e as
  referências de Go, Rust e WebAssembly. A verificação confere a integridade e as assinaturas; não estabelece a confiança
  no principal, a admissão nem a autorização (veja [Admissão](ADMISSION.md)).
- **Explorar com uma demonstração.** O playground e os projetos iniciais dos
  [atalhos sem instalação](#zero-install-shortcuts), e o assistente da CLI de [§1](#1-install-the-cli) e
  [§2](#2-initialize-your-agent), mostram os conceitos. Seus limites variam (chaves ou assinaturas PQ simuladas, chaves
  de exemplo, registros não assinados, verificações apenas de estrutura), e o que produzem não é evidência de
  verificação.
- **Executar um verificador sem instalar um SDK.** A imagem Docker opcional do servidor de verificação de referência,
  nos mesmos atalhos e em [Executar os serviços de referência](#run-the-reference-services), verifica bundles; não os
  cria.

As versões atuais dos pacotes estão em [Versões publicadas](README.md#published-versions).

---

<a id="prerequisites"></a>

## Pré-requisitos

Conforme o SDK que você usar:

- **Node.js** 18+ — para o SDK TypeScript, a CLI, o pacote WASM e as integrações `@dcp-ai/*`; a versão atual do LangChain.js (v1) em [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) precisa de Node.js 22+
- **Python** 3.10+ — para o SDK Python; o pacote separado `agno-dcp` em [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) precisa de 3.11+
- **Go** 1.25+ — para o SDK Go
- **Rust** estável — para o crate Rust

Você só precisa da linguagem com que vai trabalhar. Todos os SDKs implementam o mesmo formato de transmissão V2; os [vetores compartilhados](../tests/interop/v2/) e a [matriz de interoperabilidade](../tools/interop-matrix/README.md) testam a assinatura e a verificação entre SDKs, e o README de cada SDK lista o que ainda falta.

---

<a id="published-packages-and-this-guide"></a>

## Pacotes publicados e este guia

Os exemplos TypeScript usam `@dcp-ai/sdk` 2.2.0 publicado, o CLI npm é `@dcp-ai/cli` 2.1.0 e Python é `dcp-ai` 2.10.0 no PyPI. Veja [npm](NPM_RELEASES.md), [Python](PYTHON_RELEASE.md) e [SECURITY.md](../SECURITY.md#supported-versions). Go e Rust têm publicações separadas. Para desenvolvimento do código-fonte, use:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build                  # TypeScript SDK of main
cd ../../cli && npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
pip install -e /path/to/dcp-ai/sdks/python                                  # Python SDK of main
```

Os comandos de registro deste guia instalam as versões publicadas.

---

<a id="zero-install-shortcuts"></a>

## Atalhos sem instalação

Estes atalhos usam pacotes e imagens publicados, não `main`. O playground e os projetos iniciais são demonstrações e não produzem evidências de verificação de um SDK (limites abaixo); a imagem Docker executa o servidor de verificação de referência, que verifica bundles mas não os cria:

- **Playground interativo:** https://docs.dcp-ai.org/playground/ — gere identidades, construa bundles e verifique assinaturas no navegador.
- **Projeto inicial com scaffold:** execute `npm create @dcp-ai/langchain my-app` (ou `/crewai`, `/openai`, `/express`) para gerar um projeto inicial.
- **Docker numa linha:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` inicia o servidor de verificação de referência sem clonar nada.

O [playground](../playground/README.md) é uma demonstração: suas assinaturas PQ são simuladas e a canonicalização e o tratamento de Merkle são simplificados, portanto seus bundles não são evidência para a verificação dos SDKs. Os [templates iniciais](../templates/README.md) também têm limites: LangChain, CrewAI e OpenAI usam chaves e assinaturas de preenchimento; Express verifica apenas a estrutura. Use os exemplos dos SDKs abaixo para obter bundles verificáveis.

---

<a id="1-install-the-cli"></a>

## 1. Instalar a CLI

O assistente da CLI é uma demonstração para explorar: suas chaves «ML-DSA-65» são simuladas (bytes aleatórios), e o RPR e o passaporte que ele grava não são assinados nem seguem os esquemas V2. Para criar uma identidade e bundles que verifiquem, vá para a [§3](#3-typescript-sdk) ou a [§4](#4-python-sdk); os limites estão listados em [Criação de agentes](AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only).

A versão publicada, instalada ou executada diretamente:

```bash
npm install -g @dcp-ai/cli
```

```bash
npx @dcp-ai/cli init
```

A partir de uma cópia do repositório (acima), execute o assistente do repositório no diretório do seu projeto: `node /path/to/dcp-ai/cli/bin/dcp-ai.js init`.

<a id="2-initialize-your-agent"></a>

## 2. Inicializar o seu agente

```bash
npx @dcp-ai/cli init   # or: node /path/to/dcp-ai/cli/bin/dcp-ai.js init
```

Isso cria os seguintes arquivos de demonstração no seu projeto:

| Arquivo | Finalidade |
|------|---------|
| `.dcp/config.json` | Configuração e metadados do agente |
| `.dcp/keys/ed25519_public.key`, `.dcp/keys/ed25519_secret.key` | Par de chaves Ed25519 |
| `.dcp/keys/ml_dsa_65_public.key`, `.dcp/keys/ml_dsa_65_secret.key` | Par de chaves «ML-DSA-65» simulado (bytes aleatórios), quando se escolhem chaves pós-quânticas |
| `.dcp/identity.json` | Registro com forma de RPR (não assinado e fora do esquema) |
| `.dcp/passport.json` | Registro com forma de passaporte (não assinado e fora do esquema) |

Os arquivos de chaves secretas são gravados com as permissões padrão (`0644` com a umask habitual `022`): execute `chmod 600 .dcp/keys/*_secret.key` e mantenha-os fora do controle de versão adicionando `.dcp/keys/` ao seu `.gitignore`.

---

<a id="3-typescript-sdk"></a>

## 3. SDK TypeScript

Os exemplos TypeScript abaixo funcionam com o npm SDK 2.2.0 ou com um checkout de desenvolvimento (veja [Pacotes publicados e este guia](#published-packages-and-this-guide)).

Instale uma das duas:

- o SDK de `main`, compilado de um checkout, para desenvolvimento do código-fonte:

  ```bash
  npm install /path/to/dcp-ai/sdks/typescript
  ```

- ou o SDK 2.2.0 publicado, que inclui essas correções e funcionalidades:

  ```bash
  npm install @dcp-ai/sdk@^2.2.0
  ```

<a id="create-and-sign-a-bundle-v1--ed25519"></a>
<a id="create-and-sign-a-bundle-v1-ed25519"></a>

### Criar e assinar um bundle (V1 — Ed25519)

O RPR e o passaporte são assinados, cada um, sobre o objeto sem o campo `signature`. `verifySignedBundle` verifica a assinatura do bundle, seus hashes e a cadeia; as assinaturas internas são verificadas à parte.

```typescript
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, ResponsiblePrincipalRecord } from '@dcp-ai/sdk';

const now = new Date().toISOString();
const principalKeys = generateKeypair();
const agentKeys = generateKeypair();

// Each artifact is signed over the object without its `signature` field.
const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: 'human:example-001', legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible',
  override_rights: true, issued_at: now, expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, principalKeys.secretKeyB64) };

const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: 'agent:example-001', public_key: agentKeys.publicKeyB64,
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'],
  risk_tier: 'low', created_at: now, status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(rpr)
  .agentPassport(passport)
  .intent({
    dcp_version: '1.0', intent_id: 'intent:example-001', agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  })
  .policyDecision({
    dcp_version: '1.0', intent_id: 'intent:example-001', decision: 'approve', risk_score: 0.05,
    reasons: ['low-impact call'], required_confirmation: null,
  })
  .createAuditEntry({
    dcp_version: '1.0', audit_id: 'audit:example-001', timestamp: now, agent_id: passport.agent_id,
    human_id: rpr.human_id, intent_id: 'intent:example-001', policy_decision: 'approved',
    outcome: 'call_completed', evidence: { tool: 'http', result_ref: null },
  })
  .build();

const signed = signBundle(bundle, { secretKeyB64: principalKeys.secretKeyB64, signerType: 'human', signerId: rpr.human_id });
console.log(verifySignedBundle(signed, principalKeys.publicKeyB64)); // { verified: true }

// The inner signatures, over the same objects without `signature`
console.log(verifyObject(rprBody, rpr.signature, principalKeys.publicKeyB64)); // true
console.log(verifyObject(passportBody, passport.signature, agentKeys.publicKeyB64)); // true
```

<a id="verify-a-bundle"></a>

### Verificar um bundle

```typescript
import { readFileSync } from 'node:fs';
import { getDefaultRegistry, registerDefaultProviders, verifySignedBundleV2 } from '@dcp-ai/sdk';

registerDefaultProviders();
const signedBundle = JSON.parse(readFileSync('bundle.signed.json', 'utf8'));
const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
console.log(result.verified, result.errors);
```

<a id="v2--post-quantum-hybrid-signatures"></a>
<a id="v2-post-quantum-hybrid-signatures"></a>

### V2 — Assinaturas híbridas pós-quânticas

Cada artefato é um `SignedPayload` assinado no seu contexto de separação de domínio com Ed25519 + ML-DSA-65; o principal assina o RPR e o manifesto, e o agente, o passaporte, a intenção e a decisão de política.

```typescript
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign,
  generateSessionNonce, preparePayload, sha256Hex, canonicalizeV2, signBundleV2, verifySignedBundleV2,
} from '@dcp-ai/sdk';
import type {
  AgentPassportV2, AuditEventV2, CompositeKeyPair, DcpContext, IntentV2, KeyEntry, PolicyDecisionV2,
  ResponsiblePrincipalRecordV2, SignedPayload,
} from '@dcp-ai/sdk';

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function hybridKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (keys: CompositeKeyPair): KeyEntry[] => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sha256Of = (value: unknown) => `sha256:${sha256Hex(new TextEncoder().encode(canonicalizeV2(value)))}`;
async function signed<T>(payload: T, context: DcpContext, keys: CompositeKeyPair): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const principal = await hybridKeys();
const agent = await hybridKeys();
const nonce = generateSessionNonce();
const now = new Date().toISOString();

const rpr: ResponsiblePrincipalRecordV2 = {
  dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
};
const passport: AgentPassportV2 = {
  dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'low',
  created_at: now, status: 'active',
};
const intent: IntentV2 = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: passport.agent_id,
  human_id: rpr.human_id, timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};
const policy: PolicyDecisionV2 = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
  reasons: ['low-impact call'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }), timestamp: now,
};
const audit: AuditEventV2 = {
  dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: now, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
  intent_hash: sha256Of(intent), policy_decision: 'approved', outcome: 'call_completed',
  evidence: { tool: 'http', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
};

const bundle = new BundleBuilderV2(nonce)
  .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
  .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport, agent))
  .intent(await signed(intent, DCP_CONTEXTS.Intent, agent))
  .policyDecision(await signed(policy, DCP_CONTEXTS.PolicyDecision, agent))
  .addAuditEntry(audit)
  .build();

const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
const result = await verifySignedBundleV2(signedBundle, registry);
console.log(result.verified, result.errors); // true []
```

---

<a id="4-python-sdk"></a>

## 4. SDK Python

Instale uma das duas:

- um checkout para desenvolver o SDK:

  ```bash
  pip install -e /path/to/dcp-ai/sdks/python
  ```

- ou a versão publicada 2.10.0, incluindo as correções e APIs descritas aqui:

  ```bash
  pip install "dcp-ai>=2.10.0,<3"
  ```

<a id="create-and-verify-a-bundle"></a>

### Criar e verificar um bundle

```python
from datetime import datetime, timezone

from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)

now = datetime.now(timezone.utc).isoformat()
principal_keys = generate_keypair()
agent_keys = generate_keypair()

# 1. The responsible principal, signed with the principal's key (the object without "signature")
rpr_body = {
    "dcp_version": "1.0", "human_id": "human:example-001", "legal_name": "Example Principal",
    "entity_type": "natural_person", "jurisdiction": "ES", "liability_mode": "owner_responsible",
    "override_rights": True, "issued_at": now, "expires_at": None, "contact": None,
}
rpr = {**rpr_body, "signature": sign_object(rpr_body, principal_keys["secret_key_b64"])}

# 2. The agent passport, signed with the agent's key (the object without "signature")
passport_body = {
    "dcp_version": "1.0", "agent_id": "agent:example-001", "public_key": agent_keys["public_key_b64"],
    "principal_binding_reference": "human:example-001", "capabilities": ["browse", "api_call"],
    "risk_tier": "low", "created_at": now, "status": "active",
}
passport = {**passport_body, "signature": sign_object(passport_body, agent_keys["secret_key_b64"])}

# 3. Intent, policy decision and one audit entry
intent = Intent(
    intent_id="intent:example-001", agent_id="agent:example-001", human_id="human:example-001",
    timestamp=now, action_type="api_call", target={"channel": "api", "domain": "api.example.com"},
    data_classes=["none"], estimated_impact="low", requires_consent=False,
)
policy = PolicyDecision(
    intent_id="intent:example-001", decision="approve", risk_score=0.05, reasons=["low-impact call"],
)
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(**rpr))
    .agent_passport(AgentPassport(**passport))
    .intent(intent)
    .policy_decision(policy)
    .create_audit_entry(
        audit_id="audit:example-001", timestamp=now, agent_id="agent:example-001",
        human_id="human:example-001", intent_id="intent:example-001", policy_decision="approved",
        outcome="call_completed", evidence=AuditEvidence(tool="http", result_ref=None),
    )
    .build()
)

# 4. Sign with the principal's key and verify against the principal's public key
signed = sign_bundle(bundle, principal_keys["secret_key_b64"])
print(verify_signed_bundle(signed, principal_keys["public_key_b64"]))  # {'verified': True}

# 5. The inner signatures, over the same objects without "signature"
print(verify_object(rpr_body, rpr["signature"], principal_keys["public_key_b64"]))  # True
print(verify_object(passport_body, passport["signature"], agent_keys["public_key_b64"]))  # True
```

Para bundles V2 em Python, veja [V2 Bundles](../sdks/python/README.md#v2-bundles).

---

<a id="5-security-tiers"></a>

## 5. Níveis de segurança

O DCP seleciona automaticamente um nível de segurança criptográfica com base no perfil de risco da intenção:

| Nível | Nome | Modo de verificação | Intervalo de checkpoints PQ | Gatilho |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | Somente clássico (Ed25519) | A cada 50 eventos | Nenhum dos gatilhos abaixo |
| 1 | **Standard** | Híbrido preferido | A cada 10 eventos | Pontuação de risco 200–499, `estimated_impact: medium` |
| 2 | **Elevated** | Híbrido obrigatório | A cada evento | Pontuação de risco 500–799, dados pessoais, financeiros ou de saúde, pagamentos, `estimated_impact: high`, valores desconhecidos |
| 3 | **Maximum** | Híbrido obrigatório | A cada evento | Pontuação de risco ≥ 800, credenciais, dados de crianças |

A pontuação de risco é o `risk_score` da decisão de política (spec §14.2).

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent, policyDecision);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

<a id="6-telemetry--observability"></a>
<a id="6-telemetry-observability"></a>

## 6. Telemetria e observabilidade

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console', // or 'otlp'
});

// Automatic span tracking
const spanId = dcpTelemetry.startSpan('sign_bundle', { tier: 'elevated' });
// ... perform operation ...
dcpTelemetry.endSpan(spanId);

// Record metrics
dcpTelemetry.recordSignLatency(12.5, 'ed25519');

// Get summary
const summary = dcpTelemetry.getMetricsSummary();
console.log(summary.sign.p95); // p95 sign latency in ms
```

---

<a id="7-agent-to-agent-a2a-communication"></a>

## 7. Comunicação entre agentes (A2A)

```typescript
import { createHello, createWelcome, createSession, encryptMessage } from '@dcp-ai/sdk';

// Agent A initiates
const hello = createHello(bundleA, kemPublicKeyB64, ['api_call'], 'standard');

// Agent B responds
const welcome = createWelcome(bundleB, kemPubB, kemCiphertextB64, 'standard');

// Establish encrypted session
const session = createSession(sessionId, sessionKey, 'agent-a', 'agent-b', 'standard');

// Send encrypted messages
const encrypted = encryptMessage(session, { action: 'transfer', amount: 100 });
```

---

<a id="other-sdks"></a>

## Outros SDKs

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai@2.11.0
```

Os provedores de ML-DSA-65, ML-KEM-768, SLH-DSA-192f e Ed25519 ficam em `dcp_ai::providers::*`. Veja a [documentação do crate `dcp-ai` no docs.rs](https://docs.rs/dcp-ai) para a superfície completa.

<a id="webassembly-browser"></a>

### WebAssembly (navegador)

```bash
npm install @dcp-ai/wasm@^2.1.0   # the published version; for main, see the WASM SDK's Release status
```

Expõe as primitivas do SDK Rust a navegadores e ao Node.js. No Node.js, `initDcp()` precisa do arquivo `.wasm` como URL `data:`: veja [Inicialização](../sdks/wasm/README.md#initialization-browser-and-nodejs).

---

<a id="run-the-reference-services"></a>

## Executar os serviços de referência

Os quatro serviços a que a especificação se refere (servidor de verificação, anchor, log de transparência, registro de revogações) são distribuídos como imagens Docker. A partir de um diretório vazio:

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

Para hospedagem gerenciada, veja as [configurações do Fly.io em `deploy/fly/`](../deploy/) e o [guia de implantação](../deploy/README.md) para alternativas com Cloud Run, Railway ou Compose.

---

<a id="next-steps"></a>

## Próximos passos

- **[Integração com LangChain](./QUICKSTART_LANGCHAIN.md)** — Adicione o DCP a agentes LangChain
- **[Integração com CrewAI](./QUICKSTART_CREWAI.md)** — Adicione o DCP a equipes CrewAI
- **[Integração com OpenAI](./QUICKSTART_OPENAI.md)** — Adicione o DCP às chamadas de função da OpenAI
- **[Middleware Express](./QUICKSTART_EXPRESS.md)** — Verifique bundles DCP em APIs Express
- **[Referência da API](./API_REFERENCE.md)** — Documentação completa do SDK
- **[Especificação do protocolo](../spec/)** — Especificação completa do DCP v2.0
- **[Modelo de segurança](./SECURITY_MODEL.md)** — Modelo de ameaças e arquitetura de segurança
- **[Guia do operador](./OPERATOR_GUIDE.md)** — Executar serviços de verificação e ancoragem em produção
