<sub>[English](QUICKSTART.md) · [中文](QUICKSTART.zh-CN.md) · [Español](QUICKSTART.es.md) · [日本語](QUICKSTART.ja.md) · **Português**</sub>

# Guia de Início Rápido do DCP-AI

Coloque o Digital Citizenship Protocol em execução em menos de 5 minutos.

---

## Pré-requisitos

Dependendo de qual SDK você usa:

- **Node.js** 18+ — para o TypeScript SDK, CLI, pacote WASM e qualquer integração `@dcp-ai/*`
- **Python** 3.10+ — para o Python SDK
- **Go** 1.22+ — para o Go SDK
- **Rust** stable — para a crate Rust

Você só precisa da linguagem com a qual planeja trabalhar. Todos os SDKs falam o mesmo protocolo, então misturar linguagens entre agentes/verificadores funciona de imediato.

---

## Atalhos sem instalação

Quer ver o DCP rodando antes de instalar qualquer coisa?

- **Playground interativo:** https://dcp-ai.org/playground/ — gere identidades, monte bundles, verifique assinaturas no navegador.
- **Starter pré-estruturado:** execute `npm create @dcp-ai/langchain my-app` (ou `/crewai`, `/openai`, `/express`) para ter um projeto funcional em aproximadamente 2 minutos.
- **Docker em uma linha:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` inicia o servidor de verificação de referência sem clonar nada.

---

## 1. Instale a CLI

```bash
npm install -g @dcp-ai/cli
# ou execute diretamente com npx
npx @dcp-ai/cli init
```

## 2. Inicialize Seu Agente

```bash
npx @dcp-ai/cli init
```

Isso cria os seguintes arquivos no seu projeto:

| Arquivo | Propósito |
|---------|-----------|
| `.dcp/config.json` | Configuração e metadados do agente |
| `.dcp/keys/` | Pares de chaves Ed25519 + ML-DSA-65 |
| `.dcp/identity.json` | Responsible Principal Record (RPR) |
| `.dcp/passport.json` | Passaporte do Agente |

---

## 3. TypeScript SDK

```bash
npm install @dcp-ai/sdk
```

### Criar e Assinar um Bundle (V1 — Ed25519)

```typescript
import {
  generateKeypair,
  signObject,
  verifyObject,
  BundleBuilder,
  signBundle,
  verifySignedBundle,
} from '@dcp-ai/sdk';

// Generate an Ed25519 keypair
const keys = generateKeypair();

// Define artifacts
const hbr = {
  dcp_version: '1.0',
  human_id: 'human-001',
  legal_name: 'Alice Johnson',
  entity_type: 'natural_person',
  jurisdiction: 'US-CA',
  liability_mode: 'owner_responsible',
  override_rights: true,
  public_key: keys.publicKeyB64,
  issued_at: new Date().toISOString(),
  expires_at: null,
  contact: 'alice@example.com',
};

const passport = {
  dcp_version: '1.0',
  agent_id: 'agent-001',
  human_id: 'human-001',
  public_key: keys.publicKeyB64,
  capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  created_at: new Date().toISOString(),
  status: 'active',
};

const intent = {
  dcp_version: '1.0',
  intent_id: 'intent-001',
  agent_id: 'agent-001',
  human_id: 'human-001',
  timestamp: new Date().toISOString(),
  action_type: 'api_call',
  target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'],
  estimated_impact: 'low',
  requires_consent: false,
};

const policy = {
  dcp_version: '1.0',
  intent_id: 'intent-001',
  decision: 'approve',
  risk_score: 15,
  reasons: ['Low risk action'],
  required_confirmation: null,
  applied_policy_hash: 'sha256:abc123',
  timestamp: new Date().toISOString(),
};

const audit = {
  dcp_version: '1.0',
  audit_id: 'audit-001',
  prev_hash: '0'.repeat(64),
  timestamp: new Date().toISOString(),
  agent_id: 'agent-001',
  human_id: 'human-001',
  intent_id: 'intent-001',
  intent_hash: signObject(intent, keys.secretKeyB64),
  policy_decision: 'approved',
  outcome: 'API call completed successfully',
  evidence: { tool: 'fetch', result_ref: 'https://api.example.com/data' },
};

// Build the bundle
const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(hbr)
  .agentPassport(passport)
  .intent(intent)
  .policyDecision(policy)
  .addAuditEntry(audit)
  .build();

// Sign the bundle
const signed = signBundle(bundle, keys.secretKeyB64);

// Verify the bundle
const result = verifySignedBundle(signed);
console.log('Verified:', result.verified); // true
```

### Verificar um Bundle

```typescript
import { verifySignedBundle } from '@dcp-ai/sdk';

const result = verifySignedBundle(signedBundle);

if (result.verified) {
  console.log('Bundle is valid');
} else {
  console.error('Verification failed:', result.errors);
}
```

### V2 — Assinaturas Híbridas Pós-Quânticas

```typescript
import {
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  compositeVerify,
  BundleBuilderV2,
  computeSecurityTier,
  type CompositeKeyPair,
} from '@dcp-ai/sdk';

// Register Ed25519 + ML-DSA-65 providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate composite keypair
const ed = await registry.getSigner('ed25519').generateKeyPair();
const pq = await registry.getSigner('ml-dsa-65').generateKeyPair();

const keys: CompositeKeyPair = {
  classical: { kid: 'ed-01', alg: 'ed25519', ...ed },
  pq: { kid: 'pq-01', alg: 'ml-dsa-65', ...pq },
};

// Compute the security tier for your intent
const tier = computeSecurityTier(intentV2);
console.log('Security tier:', tier); // 'routine' | 'standard' | 'elevated' | 'maximum'

// Build a V2 bundle with the fluent builder
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedHbr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(auditEvents)
  .enableDualHash()
  .build();
```

---

## 4. Python SDK

```bash
pip install dcp-ai
```

### Criar e Verificar um Bundle

```python
from dcp_ai import (
    generate_keypair,
    sign_object,
    verify_object,
    build_bundle,
    sign_bundle,
    verify_signed_bundle,
)

# Generate Ed25519 keypair
keys = generate_keypair()

# Define artifacts
hbr = {
    "dcp_version": "1.0",
    "human_id": "human-001",
    "legal_name": "Alice Johnson",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "public_key": keys["public_key_b64"],
    "issued_at": "2025-01-01T00:00:00Z",
    "expires_at": None,
    "contact": "alice@example.com",
}

passport = {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "public_key": keys["public_key_b64"],
    "capabilities": ["browse", "api_call"],
    "risk_tier": "low",
    "created_at": "2025-01-01T00:00:00Z",
    "status": "active",
}

# Sign and build
signed = sign_bundle(
    build_bundle(hbr, passport, intent, policy, [audit]),
    keys["secret_key_b64"],
)

# Verify
result = verify_signed_bundle(signed)
assert result["verified"] is True
```

---

## 5. Níveis de Segurança

O DCP seleciona automaticamente um nível de segurança criptográfica com base no perfil de risco da intenção:

| Nível | Nome | Modo de Verificação | Intervalo do Checkpoint PQ | Gatilho |
|-------|------|--------------------|---------------------------|---------|
| 0 | **Routine** | Apenas clássico (Ed25519) | A cada 50 eventos | Risk score < 200 |
| 1 | **Standard** | Híbrido preferencial | A cada 10 eventos | Risk score 200–499 |
| 2 | **Elevated** | Híbrido obrigatório | Cada evento | Risk score 500–799, PII, pagamentos |
| 3 | **Maximum** | Híbrido obrigatório + verificação imediata | Cada evento | Risk score ≥ 800, credenciais |

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

## 6. Telemetria e Observabilidade

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

## 7. Comunicação Entre Agentes (A2A)

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

## Outros SDKs

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai
```

Providers para ML-DSA-65, ML-KEM-768, SLH-DSA-192f, Ed25519 residem em `dcp_ai::providers::*`. Consulte a [documentação da crate `dcp-ai` em docs.rs](https://docs.rs/dcp-ai) para a superfície completa.

### WebAssembly (navegador)

```bash
npm install @dcp-ai/wasm
```

Expõe as mesmas primitivas criptográficas Rust para qualquer contexto JS de navegador. O [playground](https://dcp-ai.org/playground/) é um consumidor de referência deste pacote.

---

## Execute os serviços de referência

Todos os quatro serviços que a spec menciona (servidor de verificação, âncora, log de transparência, registro de revogação) são distribuídos como imagens Docker. A partir de um diretório vazio:

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

Para hospedagem gerenciada, veja as [configurações de Fly.io em `deploy/fly/`](../deploy/) e o [guia de implantação](../deploy/README.md) para alternativas Cloud Run / Railway / Compose.

---

## Próximos Passos

- **[Integração com LangChain](./QUICKSTART_LANGCHAIN.md)** — Adicione DCP a agentes LangChain
- **[Integração com CrewAI](./QUICKSTART_CREWAI.md)** — Adicione DCP a crews CrewAI
- **[Integração com OpenAI](./QUICKSTART_OPENAI.md)** — Adicione DCP ao function calling da OpenAI
- **[Middleware Express](./QUICKSTART_EXPRESS.md)** — Verifique bundles DCP em APIs Express
- **[Referência de API](./API_REFERENCE.md)** — Documentação completa do SDK
- **[Especificação do Protocolo](../spec/)** — Especificação completa do DCP v2.0
- **[Modelo de Segurança](./SECURITY_MODEL.md)** — Modelo de ameaças e arquitetura de segurança
- **[Guia do Operador](./OPERATOR_GUIDE.md)** — Execução de serviços de verificação e ancoragem em produção
