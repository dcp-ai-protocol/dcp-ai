<sub>[English](QUICKSTART.md) · [中文](QUICKSTART.zh-CN.md) · **Español** · [日本語](QUICKSTART.ja.md) · [Português](QUICKSTART.pt-BR.md)</sub>

<a id="dcp-ai-quick-start-guide"></a>

# Guía de inicio rápido de DCP-AI

> Traducción informativa de [la versión en inglés](QUICKSTART.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Empieza a usar el Digital Citizenship Protocol en menos de 5 minutos.

---

<a id="prerequisites"></a>

## Requisitos previos

Según el SDK que uses:

- **Node.js** 18+ — para el SDK de TypeScript, la CLI, el paquete WASM y las integraciones `@dcp-ai/*`; la versión actual de LangChain.js (v1) de [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) necesita Node.js 22+
- **Python** 3.10+ — para el SDK de Python; el paquete independiente `agno-dcp` de [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) necesita 3.11+
- **Go** 1.25+ — para el SDK de Go
- **Rust** estable — para el crate de Rust

Solo necesitas el lenguaje con el que vayas a trabajar. Todos los SDK hablan el mismo protocolo, así que mezclar lenguajes entre agentes y verificadores funciona sin más.

---

<a id="published-packages-and-this-guide"></a>

## Paquetes publicados y esta guía

Los ejemplos siguen el código de `main`. El 25/10/2026, el `latest` de `@dcp-ai/sdk` en el registro de npm era 2.1.1, sin las correcciones del verificador de 2.2.0 ([`SECURITY.md`](../SECURITY.md#supported-versions)) ni las funciones de [`[Unreleased]`](../CHANGELOG.md#unreleased) del registro de cambios; los demás paquetes tienen sus propias versiones (el README de cada SDK tiene una sección *Release status*). Para ejecutar los ejemplos tal como están escritos, usa una copia del repositorio:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build                  # TypeScript SDK of main
cd ../../cli && npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
pip install -e /path/to/dcp-ai/sdks/python                                  # Python SDK of main
```

Los comandos de registro de esta guía instalan las versiones publicadas.

---

<a id="zero-install-shortcuts"></a>

## Atajos sin instalación

¿Quieres ver DCP en marcha antes de instalar nada? Estos usan paquetes e imágenes publicados, no `main`:

- **Playground interactivo:** https://docs.dcp-ai.org/playground/ — genera identidades, construye bundles y verifica firmas en el navegador.
- **Proyecto inicial con scaffold:** ejecuta `npm create @dcp-ai/langchain my-app` (o `/crewai`, `/openai`, `/express`) para tener un proyecto funcionando en unos 2 minutos.
- **Docker en una línea:** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` arranca el servidor de verificación de referencia sin clonar nada.

El [playground](../playground/README.md) es una demostración: sus firmas PQ están simuladas y su canonicalización y manejo de Merkle están simplificados, así que sus bundles no son evidencia para la verificación de los SDK. Las [plantillas iniciales](../templates/README.md) también tienen límites: LangChain, CrewAI y OpenAI usan claves y firmas de relleno; Express solo comprueba la estructura. Usa los ejemplos de los SDK de abajo para obtener bundles verificables.

---

<a id="1-install-the-cli"></a>

## 1. Instalar la CLI

El asistente de la CLI es una demo para explorar: sus claves «ML-DSA-65» están simuladas (bytes aleatorios), y el RPR y el pasaporte que escribe no están firmados ni cumplen los esquemas V2. Para crear una identidad y bundles que verifiquen, salta a [§3](#3-typescript-sdk) o [§4](#4-python-sdk); los límites se enumeran en [Creación de agentes](AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only).

La versión publicada, instalada o ejecutada directamente:

```bash
npm install -g @dcp-ai/cli
```

```bash
npx @dcp-ai/cli init
```

Desde una copia del repositorio (arriba), ejecuta el asistente del repositorio en el directorio de tu proyecto: `node /path/to/dcp-ai/cli/bin/dcp-ai.js init`.

<a id="2-initialize-your-agent"></a>

## 2. Inicializar tu agente

```bash
npx @dcp-ai/cli init   # or: node /path/to/dcp-ai/cli/bin/dcp-ai.js init
```

Esto crea los siguientes archivos de demostración en tu proyecto:

| Archivo | Propósito |
|------|---------|
| `.dcp/config.json` | Configuración y metadatos del agente |
| `.dcp/keys/ed25519_public.key`, `.dcp/keys/ed25519_secret.key` | Par de claves Ed25519 |
| `.dcp/keys/ml_dsa_65_public.key`, `.dcp/keys/ml_dsa_65_secret.key` | Par de claves «ML-DSA-65» simulado (bytes aleatorios), cuando se eligen claves poscuánticas |
| `.dcp/identity.json` | Registro con forma de RPR (sin firmar y sin cumplir el esquema) |
| `.dcp/passport.json` | Registro con forma de pasaporte (sin firmar y sin cumplir el esquema) |

Los archivos de claves secretas se escriben con los permisos por defecto (`0644` con la umask habitual `022`): ejecuta `chmod 600 .dcp/keys/*_secret.key` y mantenlos fuera del control de versiones añadiendo `.dcp/keys/` a tu `.gitignore`.

---

<a id="3-typescript-sdk"></a>

## 3. SDK de TypeScript

Los ejemplos siguientes siguen `main`: instala el SDK compilado desde una copia del repositorio (véase [Paquetes publicados y esta guía](#published-packages-and-this-guide)).

Instala una de las dos:

- el SDK de `main`, que necesitan los ejemplos siguientes:

  ```bash
  npm install /path/to/dcp-ai/sdks/typescript
  ```

- o la versión publicada (2.1.1 el 25/10/2026), sin las correcciones de 2.2.0 ni las funciones sin publicar:

  ```bash
  npm install @dcp-ai/sdk
  ```

<a id="create-and-sign-a-bundle-v1--ed25519"></a>
<a id="create-and-sign-a-bundle-v1-ed25519"></a>

### Crear y firmar un bundle (V1 — Ed25519)

El RPR y el pasaporte se firman cada uno sobre el objeto sin su campo `signature`. `verifySignedBundle` comprueba la firma del bundle, sus hashes y la cadena; las firmas internas se comprueban aparte.

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

### Verificar un bundle

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

### V2 — Firmas híbridas poscuánticas

Cada artefacto es un `SignedPayload` firmado en su contexto de separación de dominio con Ed25519 + ML-DSA-65; el principal firma el RPR y el manifiesto, y el agente, el pasaporte, la intención y la decisión de política.

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

## 4. SDK de Python

Instala una de las dos:

- el SDK de `main`, que usa el ejemplo siguiente:

  ```bash
  pip install -e /path/to/dcp-ai/sdks/python
  ```

- o la versión publicada, sin las funciones sin publicar:

  ```bash
  pip install dcp-ai
  ```

<a id="create-and-verify-a-bundle"></a>

### Crear y verificar un bundle

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

Para bundles V2 en Python, véase [V2 Bundles](../sdks/python/README.md#v2-bundles).

---

<a id="5-security-tiers"></a>

## 5. Niveles de seguridad

DCP selecciona automáticamente un nivel de seguridad criptográfica según el perfil de riesgo de la intención:

| Nivel | Nombre | Modo de verificación | Intervalo de checkpoints PQ | Desencadenante |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | Solo clásico (Ed25519) | Cada 50 eventos | Ninguno de los desencadenantes siguientes |
| 1 | **Standard** | Híbrido preferido | Cada 10 eventos | Puntuación de riesgo 200–499, `estimated_impact: medium` |
| 2 | **Elevated** | Híbrido obligatorio | Cada evento | Puntuación de riesgo 500–799, datos personales, financieros o de salud, pagos, `estimated_impact: high`, valores desconocidos |
| 3 | **Maximum** | Híbrido obligatorio | Cada evento | Puntuación de riesgo ≥ 800, credenciales, datos de menores |

La puntuación de riesgo es el `risk_score` de la decisión de política (spec §14.2).

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent, policyDecision);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

<a id="6-telemetry--observability"></a>
<a id="6-telemetry-observability"></a>

## 6. Telemetría y observabilidad

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

## 7. Comunicación entre agentes (A2A)

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

## Otros SDK

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@latest   # the latest tagged version; @main for main
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai   # the published crate; for main, see the Rust SDK's Release status
```

Los proveedores de ML-DSA-65, ML-KEM-768, SLH-DSA-192f y Ed25519 están en `dcp_ai::providers::*`. Consulta la [documentación del crate `dcp-ai` en docs.rs](https://docs.rs/dcp-ai) para ver toda la superficie.

<a id="webassembly-browser"></a>

### WebAssembly (navegador)

```bash
npm install @dcp-ai/wasm   # the published version; for main, see the WASM SDK's Release status
```

Expone las primitivas del SDK de Rust a navegadores y a Node.js. En Node.js, `initDcp()` necesita el archivo `.wasm` como URL `data:`: véase [Inicialización](../sdks/wasm/README.md#initialization-browser-and-nodejs).

---

<a id="run-the-reference-services"></a>

## Ejecutar los servicios de referencia

Los cuatro servicios a los que hace referencia la especificación (servidor de verificación, anchor, registro de transparencia, registro de revocaciones) se distribuyen como imágenes Docker. Desde un directorio vacío:

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

Para alojamiento gestionado, consulta las [configuraciones de Fly.io en `deploy/fly/`](../deploy/) y la [guía de despliegue](../deploy/README.md) para alternativas con Cloud Run, Railway o Compose.

---

<a id="next-steps"></a>

## Siguientes pasos

- **[Integración con LangChain](./QUICKSTART_LANGCHAIN.md)** — Añade DCP a agentes de LangChain
- **[Integración con CrewAI](./QUICKSTART_CREWAI.md)** — Añade DCP a equipos de CrewAI
- **[Integración con OpenAI](./QUICKSTART_OPENAI.md)** — Añade DCP a las llamadas a funciones de OpenAI
- **[Middleware de Express](./QUICKSTART_EXPRESS.md)** — Verifica bundles DCP en API de Express
- **[Referencia de la API](./API_REFERENCE.md)** — Documentación completa del SDK
- **[Especificación del protocolo](../spec/)** — Especificación completa de DCP v2.0
- **[Modelo de seguridad](./SECURITY_MODEL.md)** — Modelo de amenazas y arquitectura de seguridad
- **[Guía del operador](./OPERATOR_GUIDE.md)** — Ejecutar servicios de verificación y anclaje en producción
