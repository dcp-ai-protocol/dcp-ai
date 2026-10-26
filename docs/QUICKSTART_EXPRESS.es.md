<sub>[English](QUICKSTART_EXPRESS.md) · [中文](QUICKSTART_EXPRESS.zh-CN.md) · **Español** · [日本語](QUICKSTART_EXPRESS.ja.md) · [Português](QUICKSTART_EXPRESS.pt-BR.md)</sub>

<a id="dcp-ai--express-quick-start"></a>
<a id="dcp-ai-express-quick-start"></a>

# DCP-AI + Express: inicio rápido

> Traducción informativa de [la versión en inglés](QUICKSTART_EXPRESS.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Verifica bundles firmados DCP en tus API de Express.js con el middleware `@dcp-ai/express`.

---

<a id="installation"></a>

## Instalación

> **Versiones (26/10/2026).** Usa `@dcp-ai/express` 2.1.0 publicado con `@dcp-ai/sdk` 2.2.0. Incluyen el verificador corregido y la admisión con principales de confianza y `strict-v1`; no hace falta compilar un checkout. Véase el [README de Express](../integrations/express/README.md).

```bash
npm install @dcp-ai/express@^2.1.0 @dcp-ai/sdk@^2.2.0 express
```

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sin configuración (alternativa)

```bash
npm create @dcp-ai/express my-api
cd my-api
npm install
```

Genera un `index.js` ejecutable con endpoints de descubrimiento y, en una ruta de ejemplo, un middleware que solo comprueba la
estructura de un bundle: no verifica ninguna firma, así que un bundle falsificado o alterado pasa (véase
[templates/express](../templates/express/README.md)). Para verificar bundles firmados, usa `@dcp-ai/express` como se indica abajo.

<a id="python-equivalent-fastapi"></a>

### Equivalente en Python (FastAPI)

Para servicios FastAPI, instala el puente Python desde PyPI 2.10.0. Incluye verificación de firmas V2 y los controles de admisión/recursos del [README de FastAPI](../integrations/fastapi/README.md). El middleware antiguo 2.9.0 comprueba la estructura V2 sin verificar firmas; actualiza antes de usarlo para V2.

```bash
pip install "dcp-ai[fastapi]>=2.10.0,<3"
```

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp

app = FastAPI()
app.add_middleware(DCPVerifyMiddleware, require_bundle=True)

@app.post("/agent/action")
async def agent_action(agent=Depends(require_dcp)):
    # agent.passport / agent.intent / agent.session_nonce are populated
    return {"ok": True, "agent": agent.agent_id}
```

---

<a id="how-dcp-integrates-with-express"></a>

## Cómo se integra DCP con Express

El middleware DCP para Express extrae y verifica los bundles firmados de las solicitudes entrantes. La identidad verificada del agente se adjunta al objeto de la solicitud para usarla después.

```
Client (AI Agent)                    Express Server
  │                                      │
  │─── Request + DCP Bundle ────────────►│
  │    (body.signed_bundle, recommended; │
  │     or X-DCP-Bundle if it fits)      │
  │                                      ├─ dcpVerify() middleware
  │                                      │  ├─ Parse bundle (V1 or V2)
  │                                      │  ├─ Verify signatures
  │                                      │  ├─ Check session binding
  │                                      │  ├─ Optional revocation check
  │                                      │  └─ Attach req.dcpAgent
  │                                      │
  │◄── Response ────────────────────────│
```

---

<a id="complete-working-example"></a>

## Ejemplo completo funcional

```typescript
import express from 'express';
import { dcpVerify, type DCPAgent } from '@dcp-ai/express';

const app = express();
// Bundles travel in the JSON body: a budget sized for them (see "Sending DCP Bundles").
app.use(express.json({ limit: '64kb' }));

// 1. Basic DCP verification — require a valid bundle on /api and every route under it
//    (a path prefix: works on Express 4 and 5, unlike a '/api/*' pattern, which Express 5 rejects)
app.use('/api', dcpVerify({ requireBundle: true }));

// 2. Access verified agent identity in your handlers (POST: the bundle comes in the body)
app.post('/api/data', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;
  
  res.json({
    message: `Hello, agent ${agent.agentId}`,
    humanPrincipal: agent.humanId,
    capabilities: agent.capabilities,
    riskTier: agent.riskTier,
    dcpVersion: agent.dcpVersion,
  });
});

// 3. Capability-based access control
app.post('/api/payments', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;

  if (!agent.capabilities.includes('payments')) {
    return res.status(403).json({
      error: 'Agent lacks payments capability',
      agentId: agent.agentId,
    });
  }

  // Process payment...
  res.json({ status: 'ok' });
});

app.listen(3000, () => console.log('DCP-protected API on :3000'));
```

---

<a id="configuration-options"></a>

## Opciones de configuración

```typescript
// Fragment: `app` as in the Complete Working Example
import { dcpVerify } from '@dcp-ai/express';

app.use(dcpVerify({
  // Require a DCP bundle (403 if missing). Default: true
  requireBundle: true,

  // Header the bundle may be sent in, read before body.signed_bundle. Default: 'x-dcp-bundle'.
  // Only for bundles within the header limits (Node: 16 KiB for all headers); hybrid ones go in the body.
  headerName: 'x-dcp-bundle',

  // Check agent revocation status against a service. Default: false
  checkRevocation: true,
  revocationServiceUrl: 'http://localhost:3003',
  // Refuse the request (403) when the status cannot be read. Default: false, which lets it through (fail open)
  revocationFailClosed: true,

  // Cache verification results (seconds). Default: 0 (no cache)
  cacheTtlSeconds: 60,

  // V2: Require hybrid composite signatures
  requireHybrid: true,

  // V2: Fine-grained verifier policy
  verifierPolicy: {
    default_mode: 'hybrid_required',
    require_session_binding: true,
    require_composite_binding: true,
  },

  // Custom failure handler
  onFailure: (req, res, errors) => {
    res.status(403).json({ verified: false, errors, hint: 'Send the bundle in body.signed_bundle' });
  },
}));
```

En `main`, `trustedPrincipals`, `profile`, `revocationSource` y `tenant` añaden la admisión: solo llegan a la ruta los bundles
firmados para un principal en el que confías, con sus claves de confianza. Véanse [ADMISSION.md](ADMISSION.md) y el
[README de Express](../integrations/express/README.md) para todas las opciones, incluidas las de caché, supervisión y
desconexión.

---

<a id="sending-dcp-bundles-from-a-client"></a>

## Enviar bundles DCP desde un cliente

```typescript
// Fragment: `signed` is a signed V1 or V2 bundle, built as in the TypeScript SDK's Quick Start
// (../sdks/typescript/README.md).

// Send via body (recommended, and the way for hybrid V2 bundles)
const response = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    signed_bundle: signed,
    // ... other body fields
  }),
});

// Or via header, only for a bundle that fits the header limits of the server and every proxy
const response2 = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: {
    'X-DCP-Bundle': JSON.stringify(signed),
    'Content-Type': 'application/json',
  },
});
```

Un bundle V2 híbrido (Ed25519 + ML-DSA-65) ocupa unos 33 KB, mientras que Node acepta por defecto 16 KiB de cabeceras
de solicitud: en `X-DCP-Bundle` se rechaza con `431` antes de que se ejecute Express. No subas
el límite de cabeceras para esto; envíalo en el cuerpo. El `limit` del analizador del cuerpo es tu presupuesto, una decisión
de tu despliegue y no un límite del protocolo: mide tu bundle más grande, deja margen y mantén
cualquier proxy situado delante al menos igual de permisivo. Un cuerpo mayor recibe `413` antes del middleware.
`integrations/express/examples/strict-v1-body.mjs` recorre toda la ruta sobre HTTP real con
admisión `strict-v1`.

---

<a id="v2-bundle-verification"></a>

## Verificación de bundles V2

El middleware detecta automáticamente los bundles V1 y V2. Un bundle V2 se acepta solo si `verifySignedBundleV2` de `@dcp-ai/sdk` lo acepta con la política de verificador del middleware (`verifierPolicy` sobre el `DEFAULT_VERIFIER_POLICY` del SDK y, después, `requireHybrid`). Verifica:

- **Firmas compuestas** — la firma Ed25519 + ML-DSA-65 del principal sobre el manifiesto, con las `binding_keys` del RPR, y la firma propia de cada artefacto, en el más estricto entre el modo de la política para el nivel de riesgo del pasaporte y el modo del nivel de seguridad de la intención; una firma PQ presente debe verificarse
- **Integridad del manifiesto** — Todos los hashes de los artefactos y la raíz de Merkle de la auditoría coinciden
- **Vinculación de sesión** — Coherencia del nonce de sesión en todos los artefactos, y caducidad de la sesión
- **Cadena de hashes de la auditoría** y validez de las claves (claves revocadas o caducadas)

Un bundle V1 no tiene firma poscuántica, así que solo se acepta donde se aceptaría un bundle solo clásico (VERIFICATION.md V2-10): con la política por defecto, un bundle V1 con una intención routine o standard pasa, y uno con un pago, datos sensibles, un impacto estimado alto o una puntuación de riesgo de 0.5 o más se rechaza. `requireHybrid` y `allow_v1_bundles: false` rechazan todos los bundles V1.

Un bundle verificado es coherente internamente y está firmado por las claves que él mismo enumera; no prueba quién es el principal. Para aceptar bundles solo de principales en los que confías, configura la admisión (`trustedPrincipals`; véase [ADMISSION.md](ADMISSION.md)). Véase el README del paquete para la vinculación de audiencia contra la repetición.

```typescript
// Fragment: continues the Complete Working Example (`app`, `express`, `DCPAgent`)
// V2-specific agent properties
app.get('/api/secure', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;

  if (agent.dcpVersion === '2.0') {
    console.log('Key IDs:', agent.kids);
    console.log('Session:', agent.sessionNonce);
  }

  res.json({ verified: true, version: agent.dcpVersion });
});
```

---

<a id="dcpagent-interface"></a>

## Interfaz DCPAgent

La identidad verificada del agente adjunta a `req.dcpAgent`:

```typescript
interface DCPAgent {
  agentId: string;
  humanId: string;
  publicKey: string;
  capabilities: string[];
  riskTier: string;
  status: string;
  dcpVersion: '1.0' | '2.0';
  /** V2: Key identifiers of the passport keys. */
  kids?: string[];
  /** V2: Session nonce for the bundle. */
  sessionNonce?: string;
  /** DCP-05: Agent lifecycle state. */
  lifecycleState?: string;
  /** DCP-09: Active delegation mandate ID. */
  mandateId?: string;
  /** V2: Warnings of the SDK verifier for an accepted bundle (e.g. a classical-only signature). */
  warnings?: string[];
  /** V2: The verification mode the bundle was verified in. */
  verificationMode?: VerificationMode;
  /** V2: The security tier of the bundle's intent and policy decision (spec §14.2). */
  securityTier?: SecurityTier;
  /** With trustedPrincipals: the admission of the bundle (spec/profiles/admission § 5.2). */
  admission?: {
    admitted: true;
    principalTrust: PrincipalTrust;
    profile: 'strict-v1' | null;
    profileCompliance: ProfileCompliance;
    /** The decision the bundle records (approve, escalate, block): evidence, not a permission. */
    recordedDecision: string | null;
    trustSetVersion: string | null;
    /** Always false: admitting the evidence does not authorize an action. */
    actionAuthorized: false;
  };
}
```

---

<a id="next-steps"></a>

## Siguientes pasos

- **[Inicio rápido principal](./QUICKSTART.md)** — Uso básico del SDK
- **[Integración con LangChain](./QUICKSTART_LANGCHAIN.md)** — Envuelve herramientas de LangChain
- **[Referencia de la API](./API_REFERENCE.md)** — Documentación completa del SDK
