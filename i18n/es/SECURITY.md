<sub>[English](../../SECURITY.md) · [中文](../zh-CN/SECURITY.md) · **Español** · [日本語](../ja/SECURITY.md) · [Português](../pt-BR/SECURITY.md)</sub>

<a id="security-policy"></a>

# Política de seguridad

> Traducción informativa de [la versión en inglés](../../SECURITY.md), actualizada el 05/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

<a id="reporting-a-vulnerability"></a>

## Notificar una vulnerabilidad

**NO notifiques vulnerabilidades de seguridad en issues públicos de GitHub.**

Si descubres una vulnerabilidad de seguridad en el protocolo DCP-AI, en sus SDK, servicios o contratos inteligentes, notifícala de forma responsable:

- **Correo:** security@dcp-ai.org
- **GitHub:** usa [Private Vulnerability Reporting](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)

Incluye todo el detalle posible:
- Descripción de la vulnerabilidad
- Pasos para reproducirla
- Componente afectado (protocolo, SDK, servicio, contrato)
- Evaluación del impacto potencial

<a id="response-timeline"></a>

## Plazos de respuesta

| Etapa | Plazo |
|-------|-----------|
| Acuse de recibo | En 48 horas |
| Evaluación inicial | En 7 días |
| Corrección (crítica/alta) | En 30 días |
| Corrección (media/baja) | En 90 días |

<a id="scope"></a>

## Alcance

<a id="in-scope"></a>

### Dentro del alcance

- Fallos criptográficos (firmas Ed25519, hashes SHA-256, árboles de Merkle)
- Elusión de la verificación de bundles (firma, bundle_hash, merkle_root, cadenas de hashes)
- Vulnerabilidades de los SDK (TypeScript, Python, Go, Rust, WASM)
- Errores del contrato inteligente (DCPAnchor.sol)
- Vulnerabilidades de los servicios HTTP (anchor, transparency-log, revocation)
- Elusión de los middlewares (integraciones de Express y FastAPI)
- Ataques a nivel de protocolo (manipulación de esquemas, rupturas de la cadena de hashes)
- Fallos criptográficos poscuánticos (firmas ML-DSA-65/87, KEM ML-KEM-768, SLH-DSA-192f)
- Vulnerabilidades del enlace de firmas compuestas (ataques de eliminación de pq_over_classical)
- Debilidades en la derivación de claves del KEM híbrido (X25519 + ML-KEM-768)
- Vulnerabilidades del protocolo de handshake A2A (secuestro de sesión, repetición)
- Ataques de rebaja del nivel de seguridad
- Incoherencias de la doble cadena de hashes (SHA-256 + SHA3-256)
- Integridad de la cadena de checkpoints PQ
- Elusión de las etiquetas de separación de dominio
- Repetición o empalme del nonce de sesión
- Consumo desproporcionado de recursos o agotamiento algorítmico: una entrada que hace que un verificador, un SDK o un servicio de referencia use CPU, memoria o tiempo de forma desproporcionada a su tamaño, mostrada con una reproducción local acotada

<a id="out-of-scope"></a>

### Fuera del alcance

- Identidades autodeclaradas sin atestación jurisdiccional (por diseño; véase [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md))
- Operadores que ejecutan código de verificación modificado (cada operador es responsable de su propio despliegue)
- Carga o inundación contra infraestructura en producción, o cualquier otra prueba disruptiva de servicios desplegados: no está autorizada
- Ataques de ingeniería social contra las personas que custodian claves

<a id="supported-versions"></a>

## Versiones soportadas

Se reciben informes para cualquier versión publicada y para `main`. Recibir un informe no significa que una versión contenga su corrección ni que vaya a recibirla. Las correcciones se hacen en `main` y llegan a los usuarios solo en una versión posterior; no se promete ningún backport, versión de mantenimiento ni soporte a largo plazo. Los paquetes no comparten un único número de versión; los paquetes npm `@dcp-ai/*` siguen sus propias líneas de versiones.

| Versión | Estado |
|---------|--------|
| Últimas publicadas (05/11/2026): `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go `v2.13.0`, Rust `dcp-ai` 2.13.0 | Actuales. Incluyen las correcciones del verificador del 26/10/2026, las comprobaciones secundarias SHA3-256 del 28/10/2026 y las correcciones que lista el [expediente de auditoría](../../docs/conformance/AUDIT_DOSSIER.md#artifacts), entre ellas la validación de esquemas V2-2 en todos los verificadores V2 |
| `@dcp-ai/cli` 2.1.1 y los adaptadores que dependen del SDK (`@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0) | Actuales, no republicados. Obtienen las comprobaciones del 05/11/2026 solo cuando su instalación resuelve `@dcp-ai/sdk` 2.3.0; un lockfile que mantiene la 2.2.1 no las obtiene hasta que lo actualices |
| Publicadas el 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go `v2.11.1`, Rust `dcp-ai` 2.11.1 | Sustituidas: no ejecutan la validación de esquemas V2-2, así que aceptan bundles inválidos por esquema que las últimas versiones rechazan; actualiza |
| Versiones mínimas publicadas con las correcciones del verificador del 26/10/2026: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` y `@dcp-ai/cli` 2.1.0, `dcp-ai` 2.10.0 (PyPI), Go `v2.11.0`, Rust `dcp-ai` 2.11.0 | Sustituidas: no comprueban los campos secundarios SHA3-256, que sí comprueban las últimas versiones; actualiza |
| `@dcp-ai/sdk` 2.1.x | Afectadas: `verifySignedBundleV2` puede eludirse; corregido en 2.2.0 (véase la nota siguiente) |
| `@dcp-ai/express` y `@dcp-ai/openclaw` 2.0.0 | Afectadas: aceptan bundles V2 con estructura válida sin verificar sus firmas; no las uses para verificar bundles V2. Corregido en 2.1.0 |
| Integración FastAPI de `dcp-ai` 2.9.0 (PyPI) | Afectada para V2; corregida en 2.10.0 |
| Otras versiones publicadas anteriores | No evaluadas frente a estas correcciones: no se declara ninguna cobertura para ellas. Se reciben informes |
| Otros adaptadores y generadores npm: `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0; `@dcp-ai/autogen`, `@dcp-ai/w3c-did` y los generadores `create-*` 2.0.1 | Opcionales y fuera del núcleo del protocolo; sus límites están en sus README y en el [inventario npm](../../docs/NPM_RELEASES.md) |
| 1.0.x | Línea anterior: se reciben informes; no hay ninguna versión de mantenimiento programada ni prometida |
| < 1.0 | Sin soporte |

`@dcp-ai/sdk` 2.2.0 se publicó en npm el 26/10/2026 como `latest`, con las correcciones del verificador. Las versiones anteriores afectadas no reciben las correcciones automáticamente.

**Campos secundarios SHA3-256 (28/10/2026).** `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 y Rust `dcp-ai` 2.11.1 verifican los campos secundarios SHA3-256 opcionales de [V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes; las versiones anteriores, incluidas 2.2.0, 2.1.0, 2.10.0 y 2.11.0, no lo hacen. Actualiza con `npm install @dcp-ai/sdk@^2.2.1` o el equivalente de tu ecosistema, y renueva el lockfile. Los adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` y `@dcp-ai/google-a2a` 2.1.0 no se volvieron a publicar: dependen de `@dcp-ai/sdk` `^2.2.0` y obtienen las comprobaciones secundarias cuando tu lockfile resuelve `@dcp-ai/sdk` 2.2.1 o posterior. Véanse el [inventario de paquetes npm publicados](../../docs/NPM_RELEASES.md) y [Versiones publicadas](../../docs/README.md#published-versions).

**Integraciones afectadas y corregidas (26/10/2026).** `@dcp-ai/express` 2.0.0 y `@dcp-ai/openclaw` 2.0.0 aceptan bundles V2 con estructura válida sin verificar sus firmas. Ambos están corregidos en la versión npm 2.1.0, con `@dcp-ai/sdk` `^2.2.0`. No uses 2.0.0 para verificar bundles V2. La integración FastAPI de `dcp-ai` 2.9.0 sigue afectada; la implementación corregida ya está publicada en PyPI 2.10.0. Véanse las [notas de actualización Python](../../docs/PYTHON_RELEASE.md). Véanse [Express](../../integrations/express/README.md), [OpenClaw](../../integrations/openclaw/README.md) y [FastAPI](../../integrations/fastapi/README.md). El soporte de un paquete no significa que todas sus compilaciones antiguas incluyan las correcciones.

<a id="disclosure-policy"></a>

## Política de divulgación

- Seguimos una divulgación coordinada: las correcciones se desarrollan en privado y se publican antes de la divulgación pública.
- Quienes notifiquen aparecerán en el aviso de seguridad (salvo que prefieran el anonimato).
- No emprenderemos acciones legales contra investigadores que sigan esta política.

<a id="rewards"></a>

## Recompensas

No hay un programa de recompensas con importes fijos, y ninguna recompensa está garantizada. Los mantenedores pueden ofrecer una recompensa caso por caso por un informe; solo un acuerdo explícito con ellos la compromete. El reconocimiento en el aviso se describe en Política de divulgación.

> **Nota (05/11/2026).** Hasta esta fecha esta sección listaba rangos fijos de recompensa por gravedad, marcados explícitamente como no confirmados porque [GOVERNANCE.md](../../GOVERNANCE.md) y [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md) describían recompensas caso por caso. Esta página indica ahora recompensas caso por caso, como esos dos documentos.

Consulta [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md#security-disclosure) para ver cómo encaja la divulgación de seguridad en el programa de primeros adoptantes.

<a id="security-model"></a>

## Modelo de seguridad

Para un análisis detallado de la arquitectura de seguridad del protocolo, sus vectores de ataque y sus capas de protección, véanse [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md) y [docs/NIST_CONFORMITY.md](../../docs/NIST_CONFORMITY.md). Para una revisión independiente, empieza por el [expediente de auditoría](../../docs/conformance/AUDIT_DOSSIER.md): su base, sus comandos de reproducción, sus artefactos y sus límites conocidos.

<a id="protocol-integrity"></a>

## Integridad del protocolo

Compara los archivos de esquema V1 locales con el manifiesto local de huellas:

```bash
dcp integrity
```

Esto compara los bytes de los esquemas V1 con `protocol_fingerprints.json`. No comprueba los esquemas V2, el comportamiento de la implementación ni la conformidad, y el manifiesto local no es un ancla de confianza autenticada. Véase [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md#protocol-fingerprints) para más detalles.
