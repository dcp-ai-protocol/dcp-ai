<sub>[English](QUICKSTART.md) · [中文](QUICKSTART.zh-CN.md) · **Español** · [日本語](QUICKSTART.ja.md) · [Português](QUICKSTART.pt-BR.md)</sub>

# Guía de Inicio Rápido de DCP-AI

Pon en marcha el Digital Citizenship Protocol en menos de 5 minutos.

---

## Prerrequisitos

Según el SDK que uses:

- **Node.js** 18+ — para el SDK TypeScript, el CLI, el paquete WASM y cualquier integración `@dcp-ai/*`
- **Python** 3.10+ — para el SDK Python
- **Go** 1.22+ — para el SDK Go
- **Rust** stable — para el crate de Rust

Solo necesitas el lenguaje con el que planeas construir. Todos los SDKs hablan el mismo protocolo, así que mezclar lenguajes entre agentes/verificadores funciona sin configuración adicional.

---

## Atajos sin instalación

¿Quieres ver DCP en funcionamiento antes de instalar nada?

- **Playground interactivo:** https://dcp-ai.org/playground/ — genera identidades, construye bundles, verifica firmas en el navegador.
- **Starter con scaffolding:** ejecuta `npm create @dcp-ai/langchain my-app` (o `/crewai`, `/openai`, `/express`) para obtener un proyecto funcional en ~2 minutos.
- **Docker en una línea:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` inicia el servidor de verificación de referencia sin clonar nada.

---

## 1. Instala el CLI

```bash
npm install -g @dcp-ai/cli
# or run directly with npx
npx @dcp-ai/cli init
```

## 2. Inicializa tu Agente

```bash
npx @dcp-ai/cli init
```

Esto crea los siguientes archivos en tu proyecto:

| Archivo | Propósito |
|------|---------|
| `.dcp/config.json` | Configuración y metadatos del agente |
| `.dcp/keys/` | Pares de claves Ed25519 + ML-DSA-65 |
| `.dcp/identity.json` | Responsible Principal Record (RPR) |
| `.dcp/passport.json` | Pasaporte del Agente |

---

## 3. SDK TypeScript

```bash
npm install @dcp-ai/sdk
```

### Crear y Firmar un Bundle (V1 — Ed25519)

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

### Verificar un Bundle

```typescript
import { verifySignedBundle } from '@dcp-ai/sdk';

const result = verifySignedBundle(signedBundle);

if (result.verified) {
  console.log('Bundle is valid');
} else {
  console.error('Verification failed:', result.errors);
}
```

### V2 — Firmas Híbridas Post-Cuánticas

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

## 4. SDK Python

```bash
pip install dcp-ai
```

### Crear y Verificar un Bundle

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

## 5. Niveles de Seguridad

DCP selecciona automáticamente un nivel de seguridad criptográfica con base en el perfil de riesgo de la intención:

| Nivel | Nombre | Modo de Verificación | Intervalo de Checkpoint post-cuántico | Disparador |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | Solo clásico (Ed25519) | Cada 50 eventos | Risk score < 200 |
| 1 | **Standard** | Híbrido preferido | Cada 10 eventos | Risk score 200–499 |
| 2 | **Elevated** | Híbrido requerido | Cada evento | Risk score 500–799, PII, pagos |
| 3 | **Maximum** | Híbrido requerido + verificación inmediata | Cada evento | Risk score ≥ 800, credenciales |

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

## 6. Telemetría y Observabilidad

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

## 7. Comunicación Entre Agentes (A2A)

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

## Otros SDKs

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

Los providers para ML-DSA-65, ML-KEM-768, SLH-DSA-192f, Ed25519 viven bajo `dcp_ai::providers::*`. Consulta los [docs del crate `dcp-ai` en docs.rs](https://docs.rs/dcp-ai) para la superficie completa.

### WebAssembly (navegador)

```bash
npm install @dcp-ai/wasm
```

Expone las mismas primitivas criptográficas de Rust a cualquier contexto JS del navegador. El [playground](https://dcp-ai.org/playground/) es un consumidor de referencia de este paquete.

---

## Ejecuta los servicios de referencia

Los cuatro servicios a los que la spec hace referencia (servidor de verificación, anclaje, log de transparencia, registro de revocación) se distribuyen como imágenes Docker. Desde un directorio vacío:

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

Para hosting administrado, consulta las [configuraciones de Fly.io en `deploy/fly/`](../deploy/) y la [guía de despliegue](../deploy/README.md) para alternativas Cloud Run / Railway / Compose.

---

## Próximos Pasos

- **[Integración con LangChain](./QUICKSTART_LANGCHAIN.md)** — Agrega DCP a agentes LangChain
- **[Integración con CrewAI](./QUICKSTART_CREWAI.md)** — Agrega DCP a crews CrewAI
- **[Integración con OpenAI](./QUICKSTART_OPENAI.md)** — Agrega DCP al function calling de OpenAI
- **[Middleware Express](./QUICKSTART_EXPRESS.md)** — Verifica bundles DCP en APIs Express
- **[Referencia de API](./API_REFERENCE.md)** — Documentación completa del SDK
- **[Especificación del Protocolo](../spec/)** — Especificación completa de DCP v2.0
- **[Modelo de Seguridad](./SECURITY_MODEL.md)** — Modelo de amenazas y arquitectura de seguridad
- **[Guía del Operador](./OPERATOR_GUIDE.md)** — Operación de servicios de verificación y anclaje en producción
