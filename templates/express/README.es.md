<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--express-api-server-template"></a>
<a id="dcp-ai-express-api-server-template"></a>

# Plantilla DCP-AI + servidor de API Express

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Una API de Express que muestra dónde van las comprobaciones de bundles de DCP en un servidor.

> **No verifica firmas.** El `verifyBundle` de la plantilla solo comprueba la estructura de un bundle (versión, campos del manifiesto, la presencia de firmas compuestas, nonces de sesión). No verifica ninguna firma, así que un bundle falsificado o alterado pasa. Úsala para ver las rutas y el flujo, no como verificador. Para verificar bundles, usa [`@dcp-ai/express`](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/integrations/express/README.md) (desde un checkout hasta su próxima versión) o `verifySignedBundleV2` del SDK, como en [docs/QUICKSTART_EXPRESS.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_EXPRESS.md).

<a id="quick-start"></a>

## Inicio rápido

1. Instala las dependencias:
   ```bash
   npm install
   ```

2. Inicia el servidor:
   ```bash
   node index.js
   ```

La plantilla no lee `.dcp/`, así que no hace falta `npx @dcp-ai/cli init` (y ese asistente es una demostración: [Creación de agentes](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)).

<a id="what-this-template-does"></a>

## Qué hace esta plantilla

- Ejecuta un servidor de API Express con un middleware de DCP que comprueba la **estructura** de los bundles (véase arriba)
- Los agentes presentan un Citizenship Bundle para llegar a las rutas protegidas
- Limita la tasa de peticiones de las rutas públicas y protegidas
- Mantiene un registro en memoria de los agentes nombrados por los bundles que superaron la comprobación estructural: su `agent_id` y
  sus capacidades son autodeclarados y no verificados, y el registro se pierde al reiniciar
- `/agents/action` no ejecuta nada: comprueba la acción contra las capacidades autodeclaradas del bundle y devuelve
  un `action_id`
- Proporciona `/verify`, `/health`, `/agents/*` y `/.well-known/dcp-capabilities.json`

## Endpoints

| Método | Ruta               | Autenticación | Descripción                        |
|--------|--------------------|----------|------------------------------------|
| GET    | `/health`          | Ninguna  | Comprobación de estado             |
| POST   | `/verify`          | Ninguna  | Comprobación estructural de un bundle de DCP (sin verificación de firmas) |
| POST   | `/agents/action`   | DCP      | Confirmación simulada: comprobación de capacidades contra el bundle, sin ejecutar ninguna acción (requiere bundle) |
| GET    | `/agents/registry` | DCP      | Lista los agentes registrados      |
| GET    | `/.well-known/dcp-capabilities.json` | Ninguna | Descubrimiento de capacidades |

<a id="files"></a>

## Archivos

- `index.js` — servidor Express con el middleware de DCP
- `package.json` — dependencias
