# @dcp-ai/express — Express Middleware

Middleware de verificacion DCP para Express.js. Verifica Signed Bundles automaticamente en cada request e inyecta los datos del agente verificado.

## Instalacion

```bash
npm install @dcp-ai/express @dcp-ai/sdk
```

**Peer dependency:** Express 4.18+ o 5.x

## Quickstart

```typescript
import express from "express";
import { dcpVerify } from "@dcp-ai/express";

const app = express();
app.use(express.json());

// Verificar DCP en todas las rutas
app.use(dcpVerify());

app.post("/api/action", (req, res) => {
  // El agente verificado esta disponible en req.dcpAgent
  const agent = req.dcpAgent;
  console.log(`Agente ${agent.agentId} (humano: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

### Enviar un bundle desde el cliente

El bundle se envia como JSON en el header `X-DCP-Bundle` o en `req.body.signed_bundle`:

```bash
# Via header
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'

# Via body
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'
```

## API Reference

### `dcpVerify(options?)`

Funcion factory que retorna un middleware Express.

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

### Opciones (`DCPVerifyOptions`)

| Opcion | Tipo | Default | Descripcion |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | Requiere bundle en cada request. Si `false`, requests sin bundle pasan sin verificacion. |
| `checkRevocation` | `boolean` | `false` | Verifica si el agente esta revocado (placeholder). |
| `cacheTtlSeconds` | `number` | `0` | Segundos para cachear resultados de verificacion. `0` desactiva cache. |
| `headerName` | `string` | `"x-dcp-bundle"` | Nombre del header HTTP donde se envia el bundle. |
| `onFailure` | `function` | `undefined` | Handler custom para errores de verificacion. Recibe `(req, res, errors)`. |

### `req.dcpAgent`

Despues de verificacion exitosa, `req.dcpAgent` contiene:

```typescript
interface DCPAgent {
  agentId: string;      // ID del agente
  humanId: string;      // ID del humano responsable
  publicKey: string;    // Clave publica Ed25519
  capabilities: string[];  // Capacidades declaradas
  riskTier: string;     // Nivel de riesgo (low/medium/high)
  status: string;       // Estado (active/suspended/revoked)
}
```

### Comportamiento

1. Extrae el signed bundle del header `X-DCP-Bundle` (JSON) o de `req.body.signed_bundle`
2. Verifica usando `verifySignedBundle()` del `@dcp-ai/sdk`
3. Si es valido: inyecta `req.dcpAgent` y llama `next()`
4. Si falla: responde `403` con errores (o usa `onFailure` si esta configurado)
5. Si ocurre un error interno: responde `500`

### Cache

Cuando `cacheTtlSeconds > 0`, los resultados se cachean usando `signature.sig_b64` como clave. Esto evita re-verificar el mismo bundle en requests consecutivos.

## Ejemplo avanzado — Rutas protegidas selectivamente

```typescript
import express from "express";
import { dcpVerify } from "@dcp-ai/express";

const app = express();
app.use(express.json());

// Rutas publicas (sin verificacion)
app.get("/health", (req, res) => res.json({ ok: true }));

// Rutas protegidas (requieren DCP)
const protected = express.Router();
protected.use(dcpVerify({ cacheTtlSeconds: 60 }));

protected.post("/agent/action", (req, res) => {
  res.json({ agent: req.dcpAgent.agentId });
});

protected.get("/agent/profile", (req, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protected);
app.listen(3000);
```

## Desarrollo

```bash
# Instalar dependencias
npm install

# Build (ESM + CJS)
npx tsup src/index.ts --format esm,cjs --dts

# Type check
npx tsc --noEmit
```

### Dependencias

- `@dcp-ai/sdk` — SDK de verificacion DCP
- `express` (peer) — Framework HTTP

## Licencia

Apache-2.0
