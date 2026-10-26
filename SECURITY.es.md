<sub>[English](SECURITY.md) · [中文](SECURITY.zh-CN.md) · **Español** · [日本語](SECURITY.ja.md) · [Português](SECURITY.pt-BR.md)</sub>

<a id="security-policy"></a>

# Política de seguridad

> Traducción informativa de [la versión en inglés](SECURITY.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

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

<a id="out-of-scope"></a>

### Fuera del alcance

- Identidades autodeclaradas sin atestación jurisdiccional (por diseño; véase [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md))
- Operadores que ejecutan código de verificación modificado (cada operador es responsable de su propio despliegue)
- Denegación de servicio (cuestión de infraestructura, no del protocolo)
- Ataques de ingeniería social contra las personas que custodian claves

<a id="supported-versions"></a>

## Versiones soportadas

Los paquetes no comparten un único número de versión; los paquetes npm `@dcp-ai/*` siguen sus propias líneas de versiones.

| Versión | Soportada |
|---------|-----------|
| 2.10.x (`dcp-ai` en PyPI / crates.io, módulo Go `sdks/go/v2`) | Sí |
| 2.9.x (`dcp-ai` en PyPI y crates.io, módulo Go `sdks/go/v2`) | Sí |
| 2.8.x (`dcp-ai` en PyPI y crates.io, módulo Go `sdks/go/v2`) | Sí |
| 2.2.x (`@dcp-ai/sdk`) | Sí |
| 2.1.x (`@dcp-ai/sdk`) | No: `verifySignedBundleV2` puede eludirse; la corrección está en 2.2.x (véase la nota siguiente) |
| 2.1.x (`@dcp-ai/wasm`, `@dcp-ai/cli`, `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp`, `@dcp-ai/google-a2a`) | Sí |
| 2.0.x (`@dcp-ai/wasm`, `@dcp-ai/cli` y los demás paquetes npm `@dcp-ai/*`) | Sí |
| 1.0.x   | Sí (mantenimiento) |
| < 1.0   | No        |

`@dcp-ai/sdk` 2.2.0 se publicó en npm el 26/10/2026 y es `latest`. Incluye las correcciones del verificador; actualiza con `npm install @dcp-ai/sdk@^2.2.0` y renueva el lockfile. Las versiones anteriores afectadas no reciben las correcciones automáticamente. Véase el [inventario de paquetes npm publicados](docs/NPM_RELEASES.md).

**Integraciones afectadas y corregidas (26/10/2026).** `@dcp-ai/express` 2.0.0 y `@dcp-ai/openclaw` 2.0.0 aceptan bundles V2 con estructura válida sin verificar sus firmas. Ambos están corregidos en la versión npm 2.1.0, con `@dcp-ai/sdk` `^2.2.0`. No uses 2.0.0 para verificar bundles V2. La integración FastAPI de `dcp-ai` 2.9.0 sigue afectada; la implementación corregida ya está publicada en PyPI 2.10.0. Véanse las [notas de actualización Python](docs/PYTHON_RELEASE.md). Véanse [Express](integrations/express/README.md), [OpenClaw](integrations/openclaw/README.md) y [FastAPI](integrations/fastapi/README.md). El soporte de un paquete no significa que todas sus compilaciones antiguas incluyan las correcciones.

<a id="disclosure-policy"></a>

## Política de divulgación

- Seguimos una divulgación coordinada: las correcciones se desarrollan en privado y se publican antes de la divulgación pública.
- Quienes notifiquen aparecerán en el aviso de seguridad (salvo que prefieran el anonimato).
- No emprenderemos acciones legales contra investigadores que sigan esta política.

<a id="bug-bounty"></a>

## Programa de recompensas

DCP-AI tiene un programa de recompensas por vulnerabilidades de seguridad:

| Gravedad | Recompensa |
|----------|--------|
| Crítica (ruptura de la criptografía PQ, elusión de firmas) | $5,000 - $15,000 |
| Alta (elusión de la verificación, fuga de claves) | $1,000 - $5,000 |
| Media (rebaja del nivel, manipulación de la cadena) | $500 - $1,000 |
| Baja (divulgación de información, DoS) | $100 - $500 |

> **Nota (25/10/2026): los documentos no coinciden.** Esta tabla da rangos de recompensa fijos, mientras que [GOVERNANCE.md](GOVERNANCE.md) y [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) dicen que las recompensas se deciden caso por caso, sin tramos fijos. Los textos se mantienen tal como están hasta que un mantenedor confirme cuál se aplica; mientras tanto, considera cualquier recompensa como no confirmada y pregunta a los mantenedores.

Consulta [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) para conocer todos los detalles del programa.

<a id="security-model"></a>

## Modelo de seguridad

Para un análisis detallado de la arquitectura de seguridad del protocolo, sus vectores de ataque y sus capas de protección, véanse [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) y [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md).

<a id="protocol-integrity"></a>

## Integridad del protocolo

Compara los archivos de esquema V1 locales con el manifiesto local de huellas:

```bash
dcp integrity
```

Esto compara los bytes de los esquemas V1 con `protocol_fingerprints.json`. No comprueba los esquemas V2, el comportamiento de la implementación ni la conformidad, y el manifiesto local no es un ancla de confianza autenticada. Véase [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints) para más detalles.
