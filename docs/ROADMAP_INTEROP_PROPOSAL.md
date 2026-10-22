# DCP-AI — Visión y roadmap de interoperabilidad 2026-2027 (propuesta)

**Fecha:** 22/10/2026
**Versión:** 0.1 (borrador para discusión)
**Clasificación:** Información Organizacional — Ocular Solution (propuesta; pasa a Pública si se adopta en el repositorio `dcp-ai-protocol/dcp-ai`)
**Base auditada:** `main` @ `6536ddb` (release v2.10.0, 22/10/2026)
**Método:** lectura de `spec/`, `schemas/`, los cinco SDKs, `integrations/`, `server/`, `services/`, `api/`, `.github/`, vectores de `tests/`; tres auditorías delegadas (parity de SDKs y conformance, puentes al ecosistema, servicios e infraestructura de confianza) cuyos hallazgos críticos se verificaron a mano; contraste con el estado de los estándares externos a octubre de 2026. Todo hallazgo lleva ruta de archivo. Lo no verificado se marca como tal.

---

## 1. Resumen ejecutivo

**Visión.** DCP-AI debe dejar de ser una isla con formatos propios y convertirse en **la capa de rendición de cuentas (accountability) del stack de agentes que ya ganó**: identidad y credenciales W3C (DID, VC 2.0, Data Integrity, SD-JWT), firmas y claves IETF (JOSE/COSE, incluidas las compuestas ML-DSA + Ed25519), transporte HTTP firmado (RFC 9421 / Web Bot Auth), descubrimiento y mensajería A2A 1.0, llamadas a herramientas MCP, revocación por listas de estado (Token Status List / Bitstring Status List) y transparencia SCITT (RFC 9943). Lo que DCP aporta y nadie más tiene —**vínculo con un principal responsable, intención declarada → decisión de política → evidencia encadenada, criptografía híbrida post-cuántica por defecto, y la capa constitucional DCP-05..09**— se expresa *a través* de esos formatos, no *en lugar de* ellos. El JSON nativo de DCP y el perfil `dcp-jcs-v1` siguen siendo la forma canónica interna; lo que se añade son **sobres y bindings estándar** que cualquier verificador del ecosistema pueda consumir sin una librería DCP.

**Diagnóstico en una frase.** Hay un núcleo criptográfico sólido y bien vectorizado (bundle V2, canonicalización, tiers, must-reject), pero la amplitud anunciada (9 specs, 5 SDKs, 11 integraciones, 4 servicios) está muy por delante de la profundidad real: los puentes al ecosistema no son conformes con los estándares que dicen puentear, los middlewares no llaman al verificador V2, la infraestructura de confianza (revocación, transparencia, anclaje) no participa en la verificación, no existe un binding de transporte ni una prueba compacta, y ningún tercero puede ejecutar la suite de conformance. Tras ocho meses públicos: 23 stars, 1 fork, 0 issues externos, Discussions deshabilitadas.

**Cinco decisiones que propone este documento.**

1. **Profundidad antes que amplitud.** Congelar la adición de specs e integraciones hasta cerrar H0 y H1. Reclasificar el catálogo por madurez (referencia / experimental / stub) y retirar lo que no se vaya a mantener.
2. **Un núcleo que un tercero pueda verificar y certificar**: harness de conformance con contrato de driver, niveles, vectores negativos por código de error y verificador de referencia construido desde el código fuente del workspace, no desde un paquete publicado y vulnerable.
3. **Cinco perfiles de interoperabilidad normativos** (HTTP, presentación compacta JOSE/COSE, VC/DID, A2A, MCP), cada uno con vectores e implementación de referencia en TypeScript y Python.
4. **Infraestructura de confianza basada en estándares**: listas de estado para revocación, SCITT para transparencia, anclaje real o retirado.
5. **Posicionamiento en estándares por piezas pequeñas** dentro de grupos existentes (IETF webbotauth/jose/scitt, W3C CCG, registro de extensiones A2A, MCP, FIDO Agentic Authentication, NIST CAISI), no un "DCP Internet-Draft" monolítico.

---

## 2. Diagnóstico

### 2.1 Lo que funciona y hay que proteger

| Activo | Evidencia |
|---|---|
| Verificador V2 endurecido y homogéneo en TS, Python, Go, Rust y WASM: V2-3..V2-13, tier never-downgrade, validez de claves, RFC 3339 | `sdks/*/…/verify*`; 16 mutaciones `must_reject` + 21 `must_reject_bundles` en `tests/interop/v2/bundle_vectors.json`, ejecutadas por los cinco SDKs en los 4 modos |
| Perfil de canonicalización `dcp-jcs-v1` congelado, con tabla de casos límite y 19 vectores compartidos | `spec/CANONICALIZATION_PROFILE.md`, `tests/interop/v2/interop_vectors.json#canonicalization` |
| Cómputo del tier de seguridad idéntico en todos los SDKs (79 casos) y Blinded RPR con sal | `spec/DCP-AI-v2.0.md §12.1, §14.2`; vectores `security_tier`, `blinded_rpr` |
| 38 códigos de error canónicos definidos en los cuatro SDKs | `sdks/*/…/error_codes.*` |
| Servicios de referencia con endurecimiento real de entradas (límites de cuerpo, base64 canónico, registro con token de operador, gossip con claves fijadas, rate limits), con tests | `server/index.js`, `services/*/index.js`, `services/*/index.test.js` |
| Cadencia de corrección de seguridad alta y bien documentada | `CHANGELOG.md` 2.9.0 y 2.10.0; PRs #27–#37 del 22/10/2026 |
| Spec citable (DOI de artículo y de software), licencia Apache-2.0, gobernanza escrita | `CITATION.cff`, `GOVERNANCE.md` |

### 2.2 Brechas verificadas (ordenadas por impacto en interoperabilidad)

| # | Brecha | Evidencia |
|---|---|---|
| 1 | **El verificador de referencia de CI, el CLI, el servidor y las dos GitHub Actions usan `@dcp-ai/sdk` 2.1.1**, la versión que `SECURITY.md` declara no soportada porque `verifySignedBundleV2` se puede eludir. | `package.json:22` (`^2.1.1`), `package-lock.json` (resuelve 2.1.1), `lib/verify.js:351`, `SECURITY.md:65`, `.github/actions/verify-bundle` |
| 2 | **Ningún middleware ni plugin llama al verificador criptográfico V2.** Express y OpenClaw solo invocan `verifySignedBundle` (V1); el camino V2 es estructural. FastAPI fija `composite_sig_valid` con una comparación de cadenas y `session_binding_valid=True`. Ninguna integración Python usa `verify_signed_bundle_v2`. | `integrations/express/src/index.ts:108-202,280,308`; `integrations/openclaw/src/tools/verify.ts:79,107-240`; `sdks/python/dcp_ai/fastapi/__init__.py:219-220,225` |
| 3 | **No existe un binding de transporte normativo.** La cabecera `x-dcp-bundle` no puede transportar un bundle V2 (los vectores pesan 33–42 KB y el séptimo 624 KB; el límite por defecto de Node es 16 KB). OpenAPI usa `signed_bundle` en el cuerpo; el servidor acepta también el cuerpo desnudo; el proto define `signed_bundle_json` opaco sin implementación. No hay media type, reglas de caché ni tamaño. | `integrations/express/src/index.ts:237-255`; `sdks/python/dcp_ai/fastapi/__init__.py:149-170`; `api/openapi.yaml:178-190`; `api/proto/dcp.proto:382-388`; `spec/DCP-AI-v2.0.md §16` |
| 4 | **No hay prueba compacta ni desacoplada.** Cada llamada envía el JSON completo; §14.6 nombra modos `compact`/`reference` sin definirlos. | `spec/DCP-AI-v2.0.md:442-448` |
| 5 | **Nada en el repo habla DID, JWK, JWS, JOSE o COSE** (cero coincidencias fuera de `docs/NIST_CONFORMITY.md`). Claves solo como `kid` + base64 crudo; sobre de firma propio; descubrimiento propio. | `grep -rliE 'jwk|jws|jose|cose'` |
| 6 | **Puente W3C DID/VC no conforme**: sin `proof`; vocabulario VC 1.1 (`/2018/credentials/v1`, `issuanceDate`); contexto mal escrito `ed2519-2020`; `publicKeyMultibase` = `z` + base64url (inválido: `z` es base58btc y falta el prefijo multicodec); método `did:dcp` no registrado; tipo `PostQuantumVerificationKey2024` inexistente; lee `rpr.keys` cuando el RPR v2 usa `binding_keys`; contexto JSON-LD con ~20 términos. | `integrations/w3c-did/index.js:13-36,82-105,136-154`; `credentials/v2.jsonld` |
| 7 | **Puente Google A2A obsoleto**: tarjeta con `authentication` (pre-0.2) en vez de `securitySchemes`; sin `capabilities.extensions`; sin servir ni leer `/.well-known/agent-card.json`; sin JSON-RPC; DCP no viaja donde un peer A2A mira. "A2A" además colisiona con el protocolo propio de DCP-04. | `integrations/google-a2a/index.js:15-155` |
| 8 | **Puente MCP sin servidor ni interceptación de `tools/call`**; 9 de 11 herramientas son stubs; README documenta una API inexistente. | `integrations/anthropic-mcp/index.js:236-444` |
| 9 | **Integraciones Python no integran sus frameworks**: sin `import langchain` ni `import crewai`; `DCPCrew.kickoff` simula; intents fijos `api_call` auto-aprobados; producen logs sin firma, no bundles. AutoGen es un generador de configuración en JS para un framework Python. | `sdks/python/dcp_ai/{langchain,crewai,openai}/__init__.py`; `integrations/autogen/index.js` |
| 10 | **La revocación nunca se consulta al verificar**: ni en los SDKs (confían en el `status` autoafirmado dentro del bundle) ni en `/verify` y `/v2/bundle/verify` del propio servidor contra sus `revokedAgents`/`revokedKids`. Una revocación de emergencia no impide aceptar el bundle. | `sdks/typescript/src/core/verify-v2.ts:557-565`; `server/index.js:212-213` (usos solo en 331,560,642,800,864,969,973) |
| 11 | **No hay artefacto de revocación firmado, cacheable y verificable offline**: `dcp-revocations.json` es un agregado sin firma con `signature: "composite:<kid>"` / `"emergency_revocation"` literales; sin `Cache-Control`/validez. | `services/revocation/index.js:348,432,518-528` |
| 12 | **Log de transparencia sin pruebas de consistencia, sin recibos firmados, sin formato de checkpoint/testigo, sin persistencia**; ningún SDK verifica una prueba de inclusión. Gossip detecta forks solo a igual tamaño. | `services/transparency-log/index.js:47,140-268`; `gossip.js:141` |
| 13 | **Anclaje es un stub** (`tx_hash: null`, `onchain: false`), Merkle incompatible con el del log, contrato sin despliegue conocido. | `services/anchor/index.js:53-75,148-153`; `contracts/ethereum/DEPLOY.md` |
| 14 | **Servicios en memoria por diseño**, sin volúmenes en Fly; sin TLS en Compose; sin métricas; escrituras sin firma en el gateway (`/v2/audit/append` ignora `signature` y la rama de `prev_hash` inválido está vacía). | `server/index.js:203-234,690-719`; `deploy/fly/*.toml`; `docker/docker-compose.yml` |
| 15 | **Ningún tercero puede ejecutar la conformance**: sin contrato de driver, sin niveles (core/full, v1/v2), sin informe JSON/JUnit; "PASS" es una cadena de consola. Vectores negativos por subcadena de texto, no por código; los 38 `DcpErrorCode` no los emite ningún verificador. | `tools/conformance.js`; `ROADMAP.md:76`; `grep DCP-E` en `verify-v2.ts`, `v2/verify.py`, `verify_bundle.go`, `verify_bundle.rs` = 0 |
| 16 | **Paso V2-2 (validación de esquema) solo lo hace `lib/verify.js`**: Go/Rust/WASM no tienen código de JSON Schema; Python solo resuelve esquemas en un checkout; TS incrusta solo v1. `protocol_fingerprints.json` y `dcp integrity` cubren solo v1. | `sdks/python/dcp_ai/schema.py:16`; `sdks/typescript/src/schemas/v1.ts`; `protocol_fingerprints.json` |
| 17 | **Semántica de la política de verificación divergente**: TS/Py leen 14 + 4 campos fuera del esquema; Go/Rust solo 5 y fallan cerrado ante el resto; `intended_verifier` (audiencia) solo se aplica en TS/Py; Rust no comprueba `canonicalization_profile`. | `schemas/v2/verifier_policy.schema.json`; `sdks/go/dcp/v2/verify_bundle.go:70-80`; `sdks/rust/src/v2/verify_bundle.rs:57-72`; `sdks/rust/src/v2/types.rs:222-225` |
| 18 | **DCP-04 no es interoperable**: cero esquemas, cero vectores; Rust sin capa de sesión; **ningún SDK realiza el intercambio `x25519-ml-kem-768` que anuncia** (la clave de sesión la aporta el llamador); `directory_signature` nunca se verifica. | `sdks/typescript/src/a2a/session.ts:28-31`; `sdks/python/dcp_ai/v2/a2a.py:220-229`; `sdks/typescript/src/a2a/discovery.ts:23` |
| 19 | **Señalización de versión insuficiente**: `dcp_version`/`dcp_bundle_version` = `"2.0"` constantes a través de cambios semánticos (sal del `pii_hash`); `ml-dsa-87` y `slh-dsa-256f` válidos en esquema pero no implementados; sin registro de algoritmos legible por máquina; versiones de paquete desincronizadas (TS 2.2.0 con `__DCP_SDK_VERSION__="2.1.2"`, PyPI 2.9.0, Go/Rust 2.10.0, CLI 2.0.0, raíz `0.1.0-genesis`). | `schemas/v2/*.schema.json`; `sdks/typescript/src/observability/telemetry.ts:123-127` |
| 20 | **Tres fórmulas de `kid`** (spec/SDK/servidor vs `keys/README.md:53` vs `cli/lib/identity.js:35-41`); `@dcp-ai/cli init --hybrid` genera claves ML-DSA "simuladas" a partir de bytes aleatorios; `dcp rotate-key` envía una PoP simulada que el servidor rechaza. | `cli/lib/identity.js:15-41`; `bin/dcp.js:646-653` |
| 21 | **Promesas de wire format sin respaldo**: CBOR solo en TS y anunciado por el servidor que no lo parsea; gRPC con proto sin implementación; interceptor Go documentado inexistente. | `sdks/typescript/src/wire/cbor.ts`; `lib/http.js:26`; `docs/TECHNICAL_ARCHITECTURE.md:195` |
| 22 | **Canal de adopción roto**: `EARLY_ADOPTERS.md:97` indica abrir una GitHub Discussion y Discussions está deshabilitado; CI no ejecuta los tests indirectos de los puentes JS cuando cambian (`ci.yml:37-44`). | metadatos del repositorio; `.github/workflows/ci.yml` |

---

## 3. Panorama externo (octubre 2026) y relación con DCP

| Estándar / iniciativa | Estado | Qué significa para DCP |
|---|---|---|
| **A2A 1.0** (Linux Foundation; 150+ organizaciones) | Estable; Agent Card en `/.well-known/agent-card.json` con firma JWS sobre JSON canónico RFC 8785; transportes JSON-RPC 2.0, gRPC, HTTP+JSON; mecanismo `AgentExtension` (`uri`, `required`, `params`) activado por cabecera | DCP debe ser una **extensión A2A**, no un protocolo A2A paralelo. DCP-04 compite con A2A en transporte y pierde. |
| **MCP rev. 2026-07-28** (Agentic AI Foundation, LF) | Sin sesiones; cada petición lleva versión y capacidades en `_meta`; Tasks como extensión formal; autorización OAuth endurecida | La presentación DCP cabe en `_meta`; el gate de intención se alinea con la autorización por herramienta. |
| **OpenID AuthZEN** (AARP, COAZ para autorización de herramientas MCP, 06/2026) | Working Group Drafts | La decisión de política DCP-02 puede expresarse como respuesta AuthZEN; COAZ es el punto de integración natural en MCP. |
| **W3C VC 2.0 + Data Integrity + Bitstring Status List + Controlled Identifiers** | Recomendaciones (05/2025) | Passport y RPR como VCs con proof `eddsa-jcs-2022`; revocación como Bitstring Status List. |
| **IETF SD-JWT (RFC 9901, 11/2025)**; **Token Status List** (draft-21, en cola del RFC Editor) | Publicado / casi publicado | El Blinded RPR es exactamente un caso de divulgación selectiva: SD-JWT VC. Estado de claves y passports como Token Status List. |
| **IETF SCITT (RFC 9943, 06/2026)** + SCRAPI | Publicado / en cola | El log de transparencia DCP debe ser un Transparency Service SCITT con recibos COSE verificables offline. |
| **IETF Web Bot Auth** (draft-ietf-webbotauth-httpsig-protocol-00, 09/2026; Cloudflare/Google) | WG draft, Standards Track | Firmas HTTP RFC 9421 + `Signature-Agent` + directorio JWKS en well-known: **el binding HTTP de DCP debería construirse encima**, no inventar cabeceras. |
| **IETF JOSE/COSE composite PQ sigs** (draft-ietf-jose-pq-composite-sigs-03) y LAMPS composite ML-DSA | WG drafts | Existen identificadores estándar `ML-DSA-65-Ed25519`. La construcción IETF firma ambas componentes sobre el mismo mensaje con prefijo de dominio y las concatena; no encadena la PQ sobre la clásica como `pq_over_classical`. Hay que decidir cómo mapear (ver §8). |
| **IETF WIMSE** (workload-creds-02, arch-08, 07/2026) | WG drafts | Identidad de workloads; DCP aporta la capa de responsabilidad humana que WIMSE no cubre. |
| **FIDO Alliance** (AP2 de Google + Verifiable Intent de Mastercard contribuidos el 28/04/2026; Agentic Authentication TWG) | En desarrollo | Los mandatos AP2 (Intent/Cart/Payment) son VCs; `DelegationMandate` (DCP-09) e `Intent` (DCP-02) deben mapearse a ellos. |
| **NIST CAISI AI Agent Standards Initiative** (17/02/2026; NCCoE identidad de agentes) | Sin guía final | Ventana para contribuir el modelo de principal responsable e intención declarada. |
| **AGNTCY** (LF): Agent Badge como VC sobre registros OASF; Agent Directory | Activo | Converge con el perfil VC: un Agent Passport DCP puede ser un Agent Badge. |
| **ERC-8004** (registros de identidad/reputación/validación on-chain) | Draft; adopción real baja (estudio 05/2026) | Objetivo opcional de anclaje/registro; no prioritario. |

Nota: los nombres exactos de campos y cabeceras de A2A 1.0, MCP 2026-07-28 y Web Bot Auth deben confirmarse contra las especificaciones oficiales al implementar; en esta sesión el acceso directo a esos sitios estaba bloqueado y se contrastaron fuentes secundarias.

---

## 4. Visión y principios

**Enunciado.** *DCP es la capa de rendición de cuentas portable para agentes: quién responde, qué se declaró, qué política se aplicó y qué evidencia existe, verificable sin autoridad central, con criptografía híbrida post-cuántica, y expresada en los formatos que el ecosistema ya sabe verificar.*

**Principios de diseño para 2026-2027.**

1. **Forma canónica interna, sobres estándar fuera.** El bundle JSON `dcp-jcs-v1` sigue siendo la fuente de verdad; se añaden envolturas JOSE/COSE/VC y bindings de transporte. Nunca dos verdades.
2. **No competir con lo que ya ganó.** Transporte: A2A/MCP/HTTP-sig. Identidad: DID/VC. Claves: JWK/COSE_Key/Multikey. Revocación: listas de estado. Transparencia: SCITT. DCP aporta semántica, no plomería.
3. **Interoperable = verificable por un tercero sin nuestra librería** para al menos la presentación compacta y las credenciales. Si solo nuestros SDKs pueden verificarlo, no es interoperable.
4. **Conformance ejecutable antes que marketing.** Nada entra al catálogo de "integraciones" sin verificación criptográfica real, tests en CI y nivel de madurez declarado.
5. **Fail-closed y honestidad.** Los documentos dicen lo que el código hace. Lo que no se implementa se marca experimental o se retira.

---

## 5. Roadmap por horizontes

Las fechas son propuestas; el orden sí es una dependencia: H0 → H1 → H2 → H3.

### H0 — Inmediato (próximas 2 semanas): integridad del verificador y honestidad del catálogo

**Objetivo:** que ninguna ruta de verificación publicada por el proyecto acepte un bundle inválido, y que el catálogo refleje la realidad.

| Entregable | Detalle |
|---|---|
| H0.1 Subir `@dcp-ai/sdk` a 2.2.0 en la raíz | `package.json`, `package-lock.json`; afecta `lib/verify.js`, `bin/dcp.js`, `server/`, ambas GitHub Actions, `integrations/express`, `integrations/openclaw`. Añadir un test en CI que falle si la versión resuelta es una no soportada en `SECURITY.md`. Evaluar que el job `conformance` use el SDK del workspace (`npm link`/workspace) en lugar del paquete publicado. |
| H0.2 Verificación V2 real en middlewares y plugins | Express `checkV2Bundle` → `verifySignedBundleV2`; FastAPI → `verify_signed_bundle_v2` (eliminar `composite_sig_valid`/`session_binding_valid` fabricados); OpenClaw `dcp_verify_bundle` V2; MCP `handleVerifyBundle`. Tests end-to-end con los vectores `must_reject_bundles`. |
| H0.3 El servidor consulta revocación y verifica escrituras | `/verify` y `/v2/bundle/verify` rechazan `agent_id`/`kid` en `revokedAgents`/`revokedKids`; `/v2/audit/append` verifica `signature` y rechaza `prev_hash` inválido; compaction/governance/DCP-05..09 verifican firmas o se marcan como "almacenamiento no verificado". |
| H0.4 Una sola fórmula de `kid` y claves reales en el CLI | Corregir `cli/lib/identity.js`, `keys/README.md`; `@dcp-ai/cli init --hybrid` usa el registro de algoritmos del SDK; `dcp rotate-key` usa `KeyRotationRecord` real o se retira en favor de `dcp keys rotate`. |
| H0.5 Catálogo con niveles de madurez | README y `docs/`: cada SDK, integración y servicio con nivel **Referencia** (verifica criptográficamente, tests en CI, vectores), **Experimental** (funciona, sin garantías de compatibilidad) o **Stub** (demostración). Hoy: Referencia = SDKs core + WASM verify + Express/FastAPI tras H0.2; Experimental = OpenClaw, DCP-04, DCP-05..09; Stub = W3C DID, Google A2A, MCP, AutoGen, anchor, CBOR (fuera de TS), gRPC. |
| H0.6 Canal de adopción | Habilitar Discussions (o cambiar `EARLY_ADOPTERS.md` a issues con plantilla); plantillas de issue "Interop report" y "Conformance result". |
| H0.7 Pequeñas inconsistencias que rompen interop | Rust: comprobación de `canonicalization_profile` + vector; `__DCP_SDK_VERSION__` sincronizado con `package.json`; `ci.yml` ejecuta los tests de puentes cuando cambian `integrations/**`; `dcp integrity` cubre `schemas/v2`. |

**Criterio de salida:** CI verde con SDK 2.2.0 desde el workspace; los vectores `must_reject_bundles` fallan en Express, FastAPI, OpenClaw y el servidor; README con niveles de madurez; Discussions o issues con plantillas operativos.

### H1 — Q4 2026 / Q1 2027: núcleo verificable y certificable por terceros ("DCP Core 2.1")

**Objetivo:** que una implementación externa pueda ejecutar la suite, obtener un informe y reclamar un nivel de conformance; que los cuatro SDKs apliquen exactamente la misma política.

| Entregable | Detalle |
|---|---|
| H1.1 Harness de conformance con contrato de driver | Contrato "verificador bajo prueba": entrada = signed bundle + verifier policy (JSON), salida = `{verified, resolved_tier, errors: [DcpErrorCode...], warnings}`; invocable como proceso (`dcp conformance run --driver "<cmd>"`) o HTTP. Informe JSON + JUnit; niveles **Core-V1**, **Core-V2**, **Profile-Crypto**, **Profile-Governance** (A2A cuando exista); insignia por nivel y versión de vectores. Los cinco SDKs pasan por el mismo harness (adiós a los cinco loaders a mano). |
| H1.2 Vectores negativos por código y matriz por modo | Los verificadores emiten `DcpErrorCode`; `must_reject` se afirma por código, no por subcadena; matriz bundle × modo (`classical_only`, `hybrid_preferred`, `hybrid_required`, `pq_only`); cobertura de V2-1, V2-2, V2-6, V2-9, V2-11, V2-12; vectores para DCP-05..09 (hoy cero). |
| H1.3 Producción de vectores en CI, matriz productor × consumidor | Generadores en `scripts/` y en el workflow; Go y Rust producen vectores; cada SDK verifica lo que producen los otros tres; `_generated_at` y hash de vectores versionados; fallo de CI ante deriva. |
| H1.4 Paso V2-2 en todos los SDKs | Esquemas v2 empaquetados en wheel/crate/módulo Go/npm; validación JSON Schema en el verificador V2 de los cinco; test de deriva incrustado-vs-repo; `protocol_fingerprints.json` v2. |
| H1.5 Política de verificación única | `verifier_policy.schema.json` como única fuente; eliminar o implementar `min_classical`, `min_pq`, `accepted_hash_algs`, `allow_v1_bundles`; añadir al esquema `intended_verifier`/`verifier_id`, `require_session_expiry`, `max_session_duration_seconds` y aplicarlos en Go, Rust y WASM; comportamiento definido ante campos desconocidos (recomendado: rechazar). |
| H1.6 Señalización de versión y registro de algoritmos | Campo `spec_revision` (o `profile`) en el manifiesto con semántica definida (p. ej. `dcp-core-2.1`); `spec/registry/algorithms.json` legible por máquina consumido por los SDKs y los esquemas; `ml-dsa-87`/`slh-dsa-256f` como RESERVED hasta implementarse; una sola línea de versión de protocolo y tabla de mapeo a paquetes en `SECURITY.md`. |
| H1.7 Decisión sobre DCP-04 | Recomendación: reclasificar DCP-04 como **Experimental** y reconstruirlo en H2 como binding "DCP sobre A2A 1.0" (descubrimiento = Agent Card, sesión = transporte A2A). Si se mantiene el handshake propio: implementar el KEM híbrido real en los cuatro SDKs (TS ya tiene `core/hybrid-kem.ts`), esquemas y vectores de handshake, verificación de `directory_signature`. |
| H1.8 Higiene de paquetes | Versiones alineadas o tabla explícita; `@dcp-ai/cli` reescrito sobre el SDK (hoy no llama al verificador y emite un sobre pre-normativo); retirar `bin/dcp.js` o `cli/` para dejar un solo CLI. |

**Criterio de salida:** un verificador externo (p. ej. uno escrito ad hoc en otro lenguaje, o uno de los SDKs ejecutado como proceso negro) obtiene un informe de conformance Core-V2 desde la herramienta oficial; los cuatro SDKs pasan la misma matriz de política; vectores regenerados en CI sin deriva.

### H2 — H1 2027: hablar los idiomas del ecosistema ("DCP 2.2: perfiles de interoperabilidad")

**Objetivo:** que un bundle, una credencial o una presentación DCP sean verificables por librerías estándar y viajen por A2A, MCP y HTTP de forma normativa. Cinco documentos normativos cortos, cada uno con vectores e implementación de referencia en TypeScript y Python.

| Perfil | Contenido |
|---|---|
| **P1 — Binding HTTP** (`spec/profiles/transport/http.md`) | Media types `application/dcp-bundle+json` (y `+cbor` solo si se implementa en los cuatro SDKs); bundle por referencia (`DCP-Bundle` con URL + hash) o en el cuerpo, nunca en cabecera por encima de ~4 KB; firma de la petición con **RFC 9421 HTTP Message Signatures** siguiendo Web Bot Auth (`Signature-Agent`, directorio JWKS en well-known) donde el componente cubierto incluye el hash del bundle y la clave es la del passport; reglas de caché por tier (§14.5), límites de tamaño, códigos de error. Mismo binding en Express, FastAPI, servidor de referencia y OpenAPI. |
| **P2 — Presentación compacta** (`spec/profiles/presentation.md`) | Define por fin `compact` y `reference` (§14.6): manifiesto + claves del firmante + firma compuesta, codificado como **JWS/COSE_Sign1** con los identificadores de algoritmo compuesto del IETF (`ML-DSA-65-Ed25519`) o, si se conserva `pq_over_classical`, con un identificador registrado y documentado; el bundle completo se obtiene por hash. Verificable por una librería JOSE/COSE estándar para la componente clásica como mínimo. |
| **P3 — Perfil VC/DID** (`spec/profiles/credentials.md`) | Identificadores `did:web`/`did:key` para principales y agentes (registrar `did:dcp` solo si hay una razón que `did:web` no cubra); claves como **JWK/Multikey correctos** (multicodec `ed25519-pub`, y el códec que se acuerde para ML-DSA); **Agent Passport como VC 2.0** (`/ns/credentials/v2`, `validFrom`) con proof Data Integrity `eddsa-jcs-2022`; **Intent + PolicyDecision como "credencial de rendición de cuentas"** mapeable a los mandatos AP2/Verifiable Intent (DCP-09 `DelegationMandate` ≈ AP2 Intent Mandate); **Blinded RPR como SD-JWT VC** (RFC 9901) con divulgación selectiva de `legal_name`/`contact`; contexto JSON-LD completo para todos los artefactos; revocación referenciada por **Bitstring Status List** o **Token Status List**. Reemplaza `integrations/w3c-did`. |
| **P4 — Binding A2A** (`spec/profiles/a2a-binding.md`) | DCP como `AgentExtension` con URI estable (p. ej. `https://dcp-ai.org/ext/a2a/v1`), `params` con hash del passport, URL del bundle y tier mínimo; Agent Card servida y firmada en `/.well-known/agent-card.json`; presentación compacta en `metadata` de `Message`/`Task`; mapeo Task → Intent/AuditEntry; `securitySchemes` real. Implementación con el SDK oficial de A2A (`@a2a-js/sdk` y el de Python). Sustituye `integrations/google-a2a` y, según H1.7, el transporte de DCP-04. |
| **P5 — Binding MCP** (`spec/profiles/mcp-binding.md`) | Servidor/middleware real con el SDK oficial de MCP (rev. 2026-07-28): presentación compacta en `_meta` de cada petición; `tools/call` → declaración de intención + decisión de política (alineada con AuthZEN COAZ) + entrada de auditoría firmada; verificación del lado servidor; retirar los 9 stubs. |
| **Frameworks de verdad** | LangChain: `BaseCallbackHandler` real que gatea `on_tool_start` y wrapper de `BaseTool`; OpenAI: guardrails del Agents SDK o eliminar; CrewAI: hooks reales o retirar; AutoGen: extra Python real o retirar. Cada uno produce un `SignedBundleV2` firmado vía SDK, no logs. |

**Criterio de salida:** (a) una librería Data Integrity estándar verifica el Passport-VC; (b) una librería JOSE estándar verifica la componente clásica de la presentación compacta; (c) un cliente A2A 1.0 de referencia descubre la extensión DCP y el servidor la aplica; (d) un cliente MCP de referencia ve rechazada una herramienta por política DCP; (e) Express/FastAPI/servidor comparten el mismo binding HTTP y pasan los mismos vectores.

### H3 — H2 2027: infraestructura de confianza y posicionamiento en estándares

| Entregable | Detalle |
|---|---|
| **Revocación por listas de estado** | El principal o la jurisdicción emite Token Status List (JWT/CWT) o Bitstring Status List; `KeyEntry`/passport referencian su entrada; los verificadores de los cinco SDKs la consultan con caché por tier y modo fail-closed configurable; la revocación de emergencia alimenta la lista; `dcp-revocations.json` queda como formato legado firmado o se retira. |
| **Transparencia SCITT** | El log se reimplementa como Transparency Service RFC 9943: declaraciones firmadas COSE_Sign1 sobre el manifiesto, recibos COSE con prueba de inclusión en `/add`, pruebas de consistencia, checkpoints firmados con testigos (formato de nota C2SP), persistencia (SQLite/Postgres o Trillian/Tessera); los SDKs verifican recibos offline. |
| **Anclaje real o retirado** | Cliente de cadena real contra el contrato desplegado en una L2 (Base/Optimism) con recibos verificables y Merkle compatible con el log, o anclar solo la raíz del log SCITT (p. ej. OpenTimestamps/Bitcoin, que la propia spec prefiere) y retirar `services/anchor`. |
| **Descubrimiento unificado** | `dcp-capabilities.json` publica URLs de listas de estado, log y contrato; documento del principal = DID Document `did:web`; documento del agente = Agent Card A2A + DID; `dcp-agent-directory.json` se retira o se vuelve una lista firmada de Agent Cards. |
| **Servicios de grado producción** | Persistencia con volúmenes, TLS en Compose, imágenes sin root, SBOM + firma cosign + provenance, métricas OTLP, auth en todas las escrituras, registros sincronizados entre gateway y revocación. O etiqueta explícita "solo referencia". |
| **Posicionamiento en estándares (fase 3 del ROADMAP actual, concretada)** | IETF: contribución a webbotauth (binding P1) y, si procede, un draft individual "DCP accountability extension for HTTP signatures / WIMSE"; JOSE/COSE: alineación con composite sigs; SCITT: perfil de recibos DCP. W3C CCG: perfil "DCP Accountability Credential" y, solo si es necesario, registro de método DID. A2A: entrada en el registro de extensiones. MCP: extensión. FIDO Agentic Authentication TWG: mapeo con Verifiable Intent/AP2. NIST CAISI/NCCoE: respuesta con el modelo de principal responsable. Entregar tres perfiles pequeños en grupos existentes, no un draft monolítico. |
| **Comunidad y gobernanza** | Segundo mantenedor; programa de early adopters con canal real; informe trimestral de interop; reducir el arrastre de i18n (traducir solo README y QUICKSTART, o generar el resto); dos adoptantes faro (uno puede ser un piloto interno en Ocular Solution, a definir con el área responsable). |

**Criterio de salida:** un verificador rechaza un bundle cuyo kid aparece en una lista de estado; un recibo SCITT emitido por el log se verifica offline con un SDK; al menos un documento DCP adoptado o en discusión formal en un grupo externo; ≥ 2 adoptantes externos con issues/informes de conformance publicados.

---

## 6. Qué dejar de hacer

- Añadir specs (DCP-10+), integraciones o lenguajes antes de cerrar H1.
- Construir transporte, descubrimiento, método DID o formato de clave propios cuando exista un estándar.
- Anunciar capacidades que solo existen en un SDK (CBOR, gRPC, HSM, KEM en DCP-04) sin marcarlas como tales.
- Mantener el puente AutoGen en JS y la simulación de CrewAI: retirar o reescribir en H2.
- Depender de paquetes publicados para el verificador de referencia de CI.

---

## 7. Métricas de éxito

| Métrica | Hoy | Objetivo H1 | Objetivo H2 | Objetivo H3 |
|---|---|---|---|---|
| Implementaciones externas con informe de conformance | 0 | 1 | 2 | 4 |
| Artefactos DCP verificables por librerías no-DCP | 0 | 0 | Passport-VC y presentación compacta | + recibos SCITT y listas de estado |
| Bindings normativos con vectores | 0 | 0 | 5 (HTTP, presentación, VC/DID, A2A, MCP) | 5 + revocación + transparencia |
| Rutas de verificación publicadas que llaman al verificador V2 | 5 de 9 | 9 de 9 | 9 de 9 | 9 de 9 |
| Vectores negativos afirmados por `DcpErrorCode` | 0 | 100 % | 100 % | 100 % |
| Adoptantes externos con issues/informes | 0 | 1 | 2 | ≥ 4 |
| Documentos en grupos de estándares | 0 | 0 | 1 borrador | 3 contribuciones |

---

## 8. Riesgos y decisiones abiertas

1. **Firma compuesta: `pq_over_classical` vs. composite IETF.** Conservar la construcción DCP internamente y usar los identificadores IETF solo en el sobre JOSE/COSE requiere registrar un algoritmo propio o aceptar que la componente PQ no sea verificable por librerías estándar hasta que existan. Alternativa: migrar el sobre a la construcción IETF en un perfil `dcp-core-2.2` manteniendo `pq_over_classical` solo dentro del bundle. Decisión de spec con impacto en los cinco SDKs.
2. **`did:dcp` vs. `did:web`/`did:key`.** Registrar un método DID exige resolver, documento de método y mantenimiento. Recomendación: `did:web` para principales/organizaciones, `did:key` para agentes efímeros; `did:dcp` solo si aparece un requisito que no cubran.
3. **Futuro de DCP-04.** Mantener un handshake propio con KEM híbrido es defendible técnicamente (A2A no ofrece PQ end-to-end), pero fragmenta. Recomendación: binding sobre A2A con la presentación compacta y dejar el canal cifrado PQ como perfil opcional sobre el transporte A2A/gRPC, no como protocolo paralelo.
4. **Anclaje on-chain.** Coste de mantenimiento alto y valor marginal frente a SCITT + anclaje de raíz. Recomendación: retirar `services/anchor` salvo que un adoptante lo pida.
5. **Alcance de la capa constitucional (DCP-05..09).** 31 endpoints y 22 artefactos sin vectores cruzados ni consumidores externos. Recomendación: congelar como Experimental, no expandir, y expresar `DelegationMandate` en el perfil VC (donde sí hay demanda: AP2/Verifiable Intent).
6. **Capacidad.** Un solo mantenedor y cinco SDKs. H2 se propone solo en TypeScript y Python; Go, Rust y WASM reciben los perfiles en H3 o por contribución externa.

---

## 9. Próximos pasos propuestos (esta semana)

1. Abrir una PR **H0.1** (bump a `@dcp-ai/sdk` 2.2.0 + test de versión soportada) — cambio pequeño, impacto crítico.
2. Abrir una PR **H0.2 + H0.3** (verificación V2 real en Express/FastAPI/OpenClaw/MCP; revocación y firmas en el servidor), con los vectores `must_reject_bundles` como tests.
3. Convertir este documento, una vez discutido, en el nuevo `ROADMAP.md` y en milestones H0–H3 con issues por entregable.
4. Decidir §8.1 y §8.3 (composite y DCP-04) antes de empezar H2; ambas condicionan el diseño de P2 y P4.

---

## Anexo A — Fuentes externas consultadas (22/10/2026)

- A2A 1.0 y gobernanza en Linux Foundation; Agent Card en `/.well-known/agent-card.json` con firma JWS/JCS: artículos de API7 y Tyk; a2a-protocol.org (no accesible desde esta sesión).
- MCP, revisión 2026-07-28: changelog oficial en modelcontextprotocol.io; análisis de Descope y TrueFoundry.
- IETF: `draft-ietf-webbotauth-httpsig-protocol-00` (09/2026); `draft-ietf-wimse-workload-creds-02` y `draft-ietf-wimse-arch-08` (07/2026); `draft-ietf-jose-pq-composite-sigs-03`; `draft-ietf-lamps-pq-composite-sigs-13`; RFC 9943 (SCITT, 06/2026); RFC 9901 (SD-JWT, 11/2025); `draft-ietf-oauth-status-list-21` (en cola del RFC Editor).
- W3C: familia VC 2.0 como Recomendación (05/2025); Bitstring Status List v1.0 (15/05/2025).
- OpenID Foundation: AuthZEN AARP y COAZ (06/2026); whitepaper AI Identity Management (10/2025).
- FIDO Alliance: contribución de AP2 y Verifiable Intent (28/04/2026).
- NIST CAISI: AI Agent Standards Initiative (17/02/2026); NCCoE identidad de agentes.
- AGNTCY (LF): identidad con Agent Badge VC y OASF.
- ERC-8004: estado draft y estudio de adopción (arXiv, 05/2026).
- Agentic AI Foundation (LF, 12/2025): MCP, goose, AGENTS.md.
