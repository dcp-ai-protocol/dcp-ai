<sub>[English](ROADMAP.md) · [中文](ROADMAP.zh-CN.md) · **Español** · [日本語](ROADMAP.ja.md) · [Português](ROADMAP.pt-BR.md)</sub>

<a id="dcp-ai-roadmap"></a>

# Hoja de ruta de DCP-AI

**Publicación Go (26/10/2026).** El SDK Go `v2.11.0` está disponible desde la etiqueta `sdks/go/v2.11.0`, incluidas las correcciones del verificador, admisión y API experimentales opt-in. La publicación Rust sigue siendo independiente. Véase [Go v2.11.0](docs/GO_RELEASE.md).

**Publicación Python (26/10/2026).** `dcp-ai` 2.10.0 ya está disponible en PyPI, incluidas las correcciones del verificador, la admisión y las API experimentales opt-in. Las publicaciones de Go y Rust siguen siendo independientes. Véase [Python 2.10.0](docs/PYTHON_RELEASE.md).

> Traducción informativa de [la versión en inglés](ROADMAP.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este documento describe la evolución prevista del proyecto DCP-AI. La hoja de ruta se organiza en fases que pueden solaparse, pero que deben respetar el orden de dependencias.

---

<a id="phase-1--stabilize-core-semantics"></a>
<a id="phase-1-stabilize-core-semantics"></a>

## Fase 1 — Estabilizar la semántica del núcleo

**Estado:** completada

Definir y documentar la superficie mínima interoperable del protocolo: los artefactos, sus relaciones y el modelo de verificación que toda implementación de DCP debe soportar.

- ✅ `spec/core/dcp-core.md` publicado como especificación editorial del núcleo
- ✅ Delimitados los artefactos del núcleo frente a los propios de cada perfil
- ✅ Responsible Principal Record (RPR) fijado como terminología definitiva
- ✅ Modelo de verificación documentado con independencia de la elección de algoritmos criptográficos
- ✅ Referencias cruzadas entre la especificación del núcleo y DCP-01 a DCP-09, más DCP-AI v2.0

<a id="deliverables"></a>

### Entregables

- `spec/core/dcp-core.md` — especificación editorial del núcleo
- `spec/core/README.md` — índice y justificación del núcleo
- `README.md` presentando la arquitectura DCP Core / Perfiles / Servicios

---

<a id="phase-2--separate-profiles"></a>
<a id="phase-2-separate-profiles"></a>

## Fase 2 — Separar los perfiles

**Estado:** completada en cuanto a los README; los documentos normativos de los perfiles siguen en curso.

Extraer los detalles propios de algoritmos, transportes y gobierno a documentos de perfil que amplían el núcleo sin ser necesarios para la interoperabilidad básica.

- **Perfil criptográfico** — registro de algoritmos, firmas híbridas/PQ, enlace compuesto, agilidad criptográfica, política del verificador
- **Perfil A2A** — descubrimiento de agentes, protocolo de handshake, gestión de sesiones, vínculos de transporte
- **Perfil de gobierno** — niveles de riesgo, atestación jurisdiccional, política de revocación, recuperación de claves, ceremonias de gobierno

<a id="deliverables-1"></a>
<a id="deliverables_1"></a>

### Entregables

- `spec/profiles/crypto/README.md`
- `spec/profiles/a2a/README.md`
- `spec/profiles/governance/README.md`
- Documentos normativos propios de cada perfil (en el futuro, más allá de los README iniciales)

<a id="principles"></a>

### Principios

- Los perfiles NO DEBEN contradecir el núcleo
- Los perfiles PUEDEN definir artefactos, campos o pasos de verificación adicionales
- Una implementación conforme del núcleo es válida sin ningún perfil
- Los perfiles se versionan con independencia del núcleo

---

<a id="phase-3--standards-positioning"></a>
<a id="phase-3-standards-positioning"></a>

## Fase 3 — Posicionamiento en estándares

**Estado:** aplazada

La presentación formal a organismos de estándares (Internet-Draft del IETF, adopción por un grupo de trabajo del W3C o contribución a DIF) se aplaza hasta que el protocolo tenga comentarios de adopción real por parte de adoptantes tempranos. El motivo: los organismos de estándares favorecen diseños con uso en producción, y los ~12 meses que suele llevar un borrador se aprovechan mejor después de que integraciones reales hayan puesto a prueba la v2.0.x, no antes.

Cuando se retome, los foros candidatos son:

- **IETF** — para el subconjunto de formato de cable, canonicalización y política de verificación
- **W3C** — para la capa de integración con Verifiable Credentials
- **DIF (Decentralized Identity Foundation)** — para el modelo de identidad de los agentes

Mientras tanto, las especificaciones del proyecto siguen siendo citables a través de Zenodo (DOI del artículo [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913), DOI del software [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)).

---

<a id="phase-4--align-schemas-and-implementations"></a>
<a id="phase-4-align-schemas-and-implementations"></a>

## Fase 4 — Alinear esquemas e implementaciones

**Estado:** sustancialmente completada con la v2.0.x publicada.

- ✅ Esquemas con la nomenclatura RPR validados en los cinco SDK (TS, Python, Go, Rust, WASM)
- ✅ Pruebas de conformidad entre SDK en cada push de la CI (`tests/interop/v2/`)
- ✅ 39 esquemas JSON v2 + 9 esquemas v1 publicados en `schemas/`
- 🔄 Separación entre conformidad solo del núcleo y conformidad completa (mejora futura; la suite actual se ejecuta como una sola matriz)
- 🔄 Esquemas JSON propios de cada perfil en `schemas/profiles/` (futuro; los perfiles actuales son README descriptivos)

<a id="principles-1"></a>
<a id="principles_1"></a>

### Principios

- La terminología RPR es la nomenclatura canónica en todos los artefactos
- Las pruebas de conformidad del núcleo son un subconjunto estricto de la conformidad completa

---

<a id="phase-5--adoption-and-operations"></a>
<a id="phase-5-adoption-and-operations"></a>

## Fase 5 — Adopción y operación

**Estado:** en curso

Con la pila publicada, la siguiente fase es la adopción:

- Atraer adoptantes tempranos según el [Programa de adoptantes tempranos](docs/EARLY_ADOPTERS.md)
- Recoger comentarios de integraciones reales para orientar las siguientes versiones menores
- Ofrecer despliegues de referencia gestionados de los cuatro servicios (verification, anchor, transparency-log, revocation) donde la demanda de la comunidad lo justifique
- Ampliar el equipo de mantenimiento más allá del mantenedor fundador (véase [GOVERNANCE.md](GOVERNANCE.md))
- Publicar casos de estudio y patrones de integración

<a id="delivered-since-v20-launch"></a>

### Entregado desde el lanzamiento de la v2.0

Siete versiones menores publicadas el 2026-04-22..23 (v2.1.0 a v2.7.0) cerraron la brecha de paridad de comportamiento entre SDK que detectó la primera comparación externa. Antes de esas versiones, el comportamiento de DCP-04..09 solo existía en el SDK de TypeScript; después, todos los SDK principales hablan la misma superficie del protocolo. La v2.8.0 y la v2.8.1 (2026-04-26) fijaron después una canonicalización idéntica byte a byte en los cuatro SDK, la v2.9.0 (2026-10-21) hizo que el verificador de referencia verificara bundles V2 normativos, y la v2.10.0 (2026-10-22) hizo que todos los verificadores de los SDK aplicaran el procedimiento V2 completo, incluido el nivel de seguridad.

- **v2.1.0** — Exportador OTLP de OpenTelemetry para la paridad de telemetría entre TS y Python.
- **v2.2.0** — Ciclo de vida DCP-05 y sucesión DCP-06 portados a Python, Rust y Go.
- **v2.3.0** — Disputas DCP-07, derechos DCP-08 y delegación/umbrales de alerta/espejo DCP-09 portados a Python, Rust y Go (21 funciones × 3 SDK).
- **v2.4.0** — Primitivas de endurecimiento para producción en Python, Rust y Go (ayudas para el nonce de sesión, motor de niveles de seguridad, revocación de emergencia, checkpoints PQ diferidos con `PQCheckpointManager`).
- **v2.5.0** — DCP-04 entre agentes: capa de sesión AES-256-GCM completa en Python (con `cryptography`) y Go (`crypto/aes` de la biblioteca estándar); andamiaje de descubrimiento y handshake en Rust.
- **v2.6.0** — Ayudas de Blinded RPR, autorización multiparte y avisos de algoritmos portadas de Python a Rust y Go.
- **v2.7.0** — 38 valores canónicos de `DcpErrorCode` y la ayuda `detect_wire_format` alineados en los cuatro SDK principales, para que el manejo de errores entre SDK coincida en una única cadena estable.
- **v2.8.0** — El perfil de canonicalización `dcp-jcs-v1` ([`spec/CANONICALIZATION_PROFILE.md`](spec/CANONICALIZATION_PROFILE.md)) fija los casos que RFC 8785 deja definidos por la implementación, cerrando la divergencia entre los cuatro SDK en `1.0`, `1e2` y `undefined`; 14 vectores de interoperabilidad compartidos para casos límite.
- **v2.8.1** — Campo de manifiesto `canonicalization_profile` conectado en los cuatro SDK: los constructores emiten `"dcp-jcs-v1"` y los verificadores tratan un campo ausente como `dcp-jcs-v1` y rechazan valores desconocidos.
- **v2.9.0** (2026-10-21) — El verificador de referencia, la CLI y el servidor verifican bundles V2 normativos mediante `@dcp-ai/sdk`; canonicalización de Go y TypeScript corregida respecto a `dcp-jcs-v1`; cerradas todas las alertas de seguridad abiertas de dependencias (Go y Rust 2.9.0, Python 2.8.2, `@dcp-ai/sdk` 2.1.2).
- **v2.10.0** (2026-10-22) — Los verificadores de los cuatro SDK aplican VERIFICATION.md V2-7/V2-8, el nivel de seguridad, la vinculación de la traza de auditoría y la validez de las claves; se corrige una elusión crítica de la verificación de `@dcp-ai/sdk`; el compromiso del Blinded RPR lleva sal; Python incorpora ML-KEM-768, FIPS 205 y bundles V2; los servicios incorporan autenticación del operador, controles de registro y límites contra denegación de servicio.

<a id="in-the-repository-not-released-yet"></a>

<a id="after-v2100"></a>

### Después de v2.10.0

Estos cambios están en `main` después de la etiqueta `v2.10.0`. Al 26 de octubre de 2026, las publicaciones npm incluyen SDK 2.2.0, WASM 2.1.0 y los adaptadores y CLI actualizados; véase el [inventario publicado](docs/NPM_RELEASES.md). Los demás ecosistemas tienen publicaciones independientes. La [sección `[Unreleased]` del registro de cambios](CHANGELOG.md#unreleased) conserva la historia de desarrollo; no significa que estas funciones npm no estén disponibles.

- **Admisión** — principales de confianza y el perfil `strict-v1` ([`docs/ADMISSION.md`](docs/ADMISSION.md), [`spec/profiles/admission`](spec/profiles/admission/README.md)) en los cuatro SDK, en las integraciones de Express, FastAPI y OpenClaw, en el verificador de referencia, el servidor y la CLI. La verificación por sí sola sigue sin otorgar confianza; la admisión nunca autoriza una acción.
- **Candidato de canonicalización `dcp-jcs-v2`** — ingesta, enrutador, verificador de bytes y productores experimentales y opt-in en TypeScript, Python, Go, Rust y WASM, con una matriz cruzada de cinco por cinco ([`docs/proposals/canonicalization-candidate`](docs/proposals/canonicalization-candidate/README.md)). No es normativo ni está activo: `dcp-jcs-v1` sigue siendo el único perfil, y pasar el candidato a una fase posterior o convertirlo en valor por defecto requiere una decisión propia.

<a id="out-of-scope-for-phase-5"></a>

### Fuera del alcance de la fase 5

- Un SaaS propio de los servicios de referencia (los operadores los alojan ellos mismos)
- Obtener un programa de certificación o acreditación (prematuro)

---

<a id="proposal-direction-after-v210"></a>

## Propuesta: dirección después de la v2.10

**Estado:** propuesta para que la discutan los mantenedores. Nada de esta sección está planificado ni prometido; un punto pasa a formar parte de la hoja de ruta solo después de aceptarse en un issue o pull request propio.

<a id="positioning"></a>

### Posicionamiento

DCP no compite con los protocolos de acceso a herramientas (MCP), los protocolos entre agentes (A2A), los protocolos de pago de agentes ni los borradores sobre identidad de agentes de IA en el IETF (en el momento de escribir esto, octubre de 2026, presentaciones individuales, hasta donde sabemos). Es la capa de rendición de cuentas y evidencias por encima de ellos. Responde a la pregunta que esos protocolos dejan abierta: ¿quién responde de lo que hizo este agente y cómo puede comprobarlo un tercero sin confiar en el operador?

<a id="what-the-v210-round-showed"></a>

### Lo que mostró la ronda de la v2.10

- La superficie es mayor que la adopción: 9 especificaciones, 39 esquemas v2, 5 SDK, 10 integraciones y 4 servicios.
- La mayoría de los defectos de verificación encontrados fueron desacuerdos entre los cuatro verificadores de los SDK, no fallos de un solo algoritmo: una elusión del modo de verificación en TypeScript, Ed25519 aceptado en la posición poscuántica en Go y Rust, un artefacto nulo omitido en Go, marcas de tiempo comparadas como texto en Rust.
- La operación depende de una persona (a octubre de 2026): las credenciales de publicación en npm bloquearon la publicación de una corrección de seguridad, y crear un aviso de seguridad requiere permisos que la cuenta del mantenedor no tiene.

<a id="proposed-priorities"></a>

### Prioridades propuestas

1. **Seguridad operativa (semanas).** Publicar sin tokens de larga duración (trusted publishing en npm y crates.io, como ya hace PyPI). Convertir cada vulnerabilidad de la ronda v2.10 en un vector negativo que los cuatro SDK deben rechazar. Fuzzing diferencial: el mismo bundle mutado va a todos los verificadores y cualquier desacuerdo es un error. Una auditoría externa. Un segundo mantenedor con permisos de administración.
2. **Un núcleo pequeño y un solo verificador.** Un DCP Core 3.0 limitado al Responsible Principal Record, el pasaporte, la intención, la decisión de política, la evidencia de la acción y el bundle, con DCP-05 a DCP-09 como perfiles experimentales hasta que tengan usuarios en producción. Un único verificador normativo (candidato: el crate de Rust, que ya compila a wasm) con bindings; los demás SDK construyen bundles.
3. **Cadenas de delegación.** Humano, agente, subagente, herramienta y pago: cada salto se firma y solo puede reducir permisos, nunca ampliarlos; la cadena se verifica sin conexión hasta el humano responsable; un subagente no puede rebajar el nivel de seguridad de quien le delegó (la intención ya no puede rebajar el suyo). Amplían el mandato de delegación de DCP-09, que pasaría al núcleo si se adopta la prioridad 2.
4. **Integrar, no competir.** Un recibo firmado por cada llamada a herramienta en la integración MCP existente; el pasaporte DCP dentro de la Agent Card de A2A (la integración `google-a2a` ya convierte entre ambos); HTTP Message Signatures (RFC 9421); aceptar identidad de WIMSE/SPIFFE, OAuth o DID y vincularla a un humano responsable.
5. **Evidencia regulatoria.** Una correspondencia entre la traza de auditoría y las obligaciones de registro, supervisión humana y conservación de registros del Reglamento de IA de la UE (artículos 12, 14 y 26), al estilo de `docs/NIST_CONFORMITY.md`. La correspondencia y las fechas de aplicación deben contrastarse con el texto vigente antes de citarse.

<a id="notes-from-the-agent-side"></a>

### Notas desde el lado del agente

- Las acciones rutinarias deben seguir siendo baratas. Si cada llamada a una herramienta cuesta una firma poscuántica y un bundle completo, nadie lo adoptará. Los recibos de una sesión pueden reunirse en un árbol de Merkle y firmarse con el esquema híbrido al cerrar la sesión o cuando se eleva el nivel de seguridad.
- El principal riesgo para un agente no es que le roben una clave. Es la inyección de prompts mientras tiene claves legítimas. Lo acotan la intención firmada antes de actuar, una decisión de política independiente, mandatos de corta duración y mínimo privilegio, y evidencia que muestre si la acción se salió de la intención declarada.
- Poder demostrar que actuó dentro de su mandato protege al agente y al humano que responde por él.

<a id="not-proposed"></a>

### No se propone

- Especificaciones nuevas sin al menos dos implementadores independientes.
- Un servicio central gestionado por el proyecto (véase «Fuera del alcance de la fase 5»).
- Una presentación al IETF antes de que dos o tres integraciones funcionen en producción (la fase 3 la aplaza a la espera de comentarios de adopción; esto concreta el umbral).

<a id="open-questions"></a>

### Preguntas abiertas

- ¿Es aceptable un recorte a Core 3.0 dado el principio rector «añadir antes que quitar»? Pasar DCP-05 a DCP-09 a perfiles experimentales es un cambio incompatible.
- ¿Qué implementación se convierte en el verificador normativo, y cuál es la ruta de migración para los SDK que dejan de verificar?
- ¿Deben las cadenas de delegación reutilizar un formato de capacidades existente (UCAN, Biscuit) o seguir siendo propias de DCP?
- ¿Quién es el segundo mantenedor, y cómo se comparte de forma segura el acceso de administración?

---

<a id="out-of-scope-general"></a>

## Fuera del alcance (general)

Lo siguiente sigue aplazado de forma explícita:

- Renombrar campos de esquema sin alias compatibles con versiones anteriores
- Cambios incompatibles en paquetes publicados en registros sin una transición limpia de versión mayor
- Infraestructura de ejecución centralizada propiedad del propio proyecto

---

<a id="guiding-principles"></a>

## Principios rectores

1. **Migración no destructiva** — todo cambio debe ser reversible y no romper importaciones, pruebas ni scripts existentes
2. **Primero lo editorial** — la documentación y la claridad conceptual preceden a los cambios de código
3. **Añadir antes que quitar** — preferir crear archivos nuevos y referencias cruzadas antes que mover o borrar los existentes
4. **Núcleo mínimo** — el núcleo debe definir la superficie útil más pequeña del protocolo; todo lo demás es un perfil o un servicio
5. **Foco en la interoperabilidad** — el núcleo debe poder implementarse en cualquier lenguaje sin dependencias propias de un framework
