<sub>[English](../../../playground/README.md) · **Español** · [Português](../../pt-BR/playground/README.md) · [日本語](../../ja/playground/README.md) · [中文](../../zh-CN/playground/README.md)</sub>

<a id="dcp-ai-playground"></a>

# Playground de DCP-AI

> Traducción informativa de [la versión en inglés](../../../playground/README.md), actualizada el 25/10/2026. Si hay diferencias, prevalece el original inglés. Los identificadores y los bloques de código, incluidos los comentarios, se conservan sin traducir.

Demostración interactiva en el navegador del Digital Citizenship Protocol (DCP-01 a DCP-09), alojada en [docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/).

Es una demostración: sus firmas poscuánticas están simuladas y su forma canónica y raíz Merkle están simplificadas, por lo que lo que construye no constituye evidencia ni tiene por qué superar la verificación de los SDK (consulta [Limitaciones](#limitations)).

<a id="quick-start"></a>

## Inicio rápido

```bash
cd playground
python3 -m http.server 8080
# Open http://localhost:8080
```

Los módulos ES requieren un servidor HTTP; `file://` no funciona.

<a id="architecture"></a>

## Arquitectura

El playground es una aplicación modular, sin paso de compilación, que utiliza módulos ES (`<script type="module">`).

```
playground/
  index.html                    # Shell: CDN scripts, CSS, navigation, containers
  js/
    core/
      crypto.js                 # Ed25519 keygen, signing, verification, kid
      hash.js                   # SHA-256 (Web Crypto), canonicalize (JCS), Merkle root
      state.js                  # Central state (keypairs, agents, session)
      signature.js              # Composite signature builder (classical + PQ simulated)
      utils.js                  # uuid, sessionNonce (64-char hex), isoNow, hex/b64 encode/decode
    ui/
      tabs.js                   # Two-level tab navigation (group bar + tab bar)
      json-render.js            # Syntax highlighting, JSON display, copy
      forms.js                  # Form helpers, cards, notifications
      visualizations.js         # State machine, escalation flow, delegation chain, rights matrix (SVG)
    tabs/
      identity.js               # Tab 1: Identity Generator (DCP-01)
      builder.js                # Tab 2: Bundle Builder (DCP-01/02/03)
      verifier.js               # Tab 3: Bundle Verifier
      tiers.js                  # Tab 4: Tier Comparison
      explorer.js               # Tab 5: Protocol Explorer (DCP-01 through DCP-09)
      lifecycle.js              # Tab 6: Lifecycle Management (DCP-05)
      succession.js             # Tab 7: Succession & Inheritance (DCP-06)
      disputes.js               # Tab 8: Dispute Resolution (DCP-07)
      rights.js                 # Tab 9: Rights & Obligations (DCP-08)
      delegation.js             # Tab 10: Delegation & Representation (DCP-09)
      workflows.js              # Tab 11: Cross-Spec Workflows
```

20 módulos JS (unas 2700 líneas al 25/10/2026).

<a id="navigation"></a>

## Navegación

Navegación en dos niveles:

| Grupo | Pestañas |
|-------|------|
| **Protocolo central** | Identidad, constructor de bundles, verificador, niveles, explorador |
| **Ciclo de vida** | Ciclo de vida del agente (DCP-05), sucesión (DCP-06) |
| **Gobernanza** | Disputas (DCP-07), derechos (DCP-08), delegación (DCP-09) |
| **Flujos de trabajo** | Flujos entre especificaciones |

<a id="spec-coverage"></a>

## Cobertura de especificaciones

| Especificación | Funciones demostradas |
|------|----------------------|
| DCP-01 | RPR, pasaporte del agente, generación de pares de claves Ed25519 |
| DCP-02 | Declaraciones de intención, puntuación de riesgo, selección del nivel de seguridad |
| DCP-03 | Decisiones de política, entradas de auditoría, registro de auditoría encadenado por hashes, manifiesto del bundle, raíz Merkle |
| DCP-05 | Máquina de estados (commissioned/active/declining/decommissioned), informes de vitalidad, certificados de puesta en servicio, registros de retirada de servicio |
| DCP-06 | Testamentos digitales, clasificación de memoria, manifiestos de transferencia de memoria, ceremonias de sucesión |
| DCP-07 | Registros de disputas, escalamiento de tres niveles, resoluciones arbitrales, bundles de jurisprudencia, registros de objeciones |
| DCP-08 | Declaraciones de derechos, registros de obligaciones, informes de infracciones, matriz de derechos, presentación automática de disputas |
| DCP-09 | Mandatos de delegación, umbrales de consciencia, declaraciones consultivas, espejos del principal, visualización de cadenas de delegación |

<a id="cross-spec-workflows"></a>

## Flujos entre especificaciones

Cuatro flujos guiados:

1. **Ciclo de vida completo del agente** (DCP-01 + 05 + 06): desde la creación de identidad hasta la sucesión
2. **Acción delegada con disputa** (DCP-01 + 09 + 02 + 07): desde la delegación hasta la resolución de la disputa
3. **Escalamiento de infracciones de derechos** (DCP-08 + 07 + 05): desde la detección de la infracción hasta su impacto en el ciclo de vida
4. **Supervisión del principal** (DCP-09 + 02 + 03): desde la configuración de umbrales hasta los informes de supervisión

<a id="how-it-works"></a>

## Funcionamiento

Todas las operaciones criptográficas se ejecutan **íntegramente en el navegador**:

- **Firmas Ed25519** mediante [tweetnacl](https://github.com/dchest/tweetnacl-js), cargado desde una CDN
- **Hash SHA-256** mediante la API Web Crypto (`crypto.subtle.digest`)
- **Identificadores de clave (kid)** derivados según la especificación: `hex(SHA-256(UTF8(alg) || 0x00 || pubkey_bytes))[0:32]`
- **Separación de dominios** aplicada a todas las firmas: `UTF8(context_tag) || 0x00 || canonical_payload`
- **Canonicalización** con claves ordenadas para obtener hashes deterministas (una forma simplificada, no el perfil completo `dcp-jcs-v1`)
- **Firmas compuestas**: formato `{ classical, pq, binding }` según `composite_signature.schema.json`
- **Nonces de sesión**: hexadecimal de 64 caracteres (`crypto.getRandomValues(32)`)

<a id="key-corrections-from-previous-playground"></a>

## Correcciones principales respecto al playground anterior

- `session_nonce`: pasó de UUID a hexadecimal de 64 caracteres (según el esquema `^[0-9a-f]{64}$`)
- `composite_sig`: pasó de `{ entries[] }` a `{ classical, pq, binding }` (formato del esquema v2)
- Todos los artefactos generados incluyen `_spec_ref` con la referencia a la sección de la especificación
- El explorador del protocolo se amplió para cubrir DCP-01 a DCP-09

<a id="limitations"></a>

## Limitaciones

- **Las firmas poscuánticas están simuladas**: ML-DSA-65 utiliza un sustituto basado en HMAC. Ed25519 es real. Para firmas PQ reales, utiliza un SDK (para el navegador, el SDK WASM en `sdks/wasm/`).
- El cálculo de la raíz Merkle utiliza concatenación simplificada
- No hay formato de transmisión CBOR (solo JSON)
- La verificación de firmas se limita a claves Ed25519 del pasaporte del bundle
- La vinculación de sesión entre pestañas utiliza estado compartido (sin persistencia en almacenamiento)

<a id="dependencies"></a>

## Dependencias

- `tweetnacl@1.0.3` + `tweetnacl-util@0.15.1` (CDN)
- API Web Crypto (nativa)
- Sin framework ni paso de compilación
