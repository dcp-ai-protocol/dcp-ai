<sub>[English](dcp-core.md) · [中文](dcp-core.zh-CN.md) · **Español** · [日本語](dcp-core.ja.md) · [Português](dcp-core.pt-BR.md)</sub>

<a id="dcp-core-specification"></a>

# Especificación del núcleo de DCP

> Traducción informativa de [la especificación en inglés](dcp-core.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Publicado — v2.0  
**Versión:** 2.0  
**Fecha:** 2026-03-01  

---

<a id="1-introduction"></a>

## 1. Introducción

El Digital Citizenship Protocol (DCP) define una capa portable de rendición de cuentas para agentes de IA que operan en redes abiertas. El núcleo de DCP es la superficie mínima interoperable del protocolo: el conjunto de artefactos, relaciones y reglas de verificación que toda implementación conforme debe admitir.

Un verificador que recibe un bundle de DCP puede responder cuatro preguntas sin depender de ninguna autoridad central:

1. **¿Quién es responsable** de este agente?
2. **¿Qué declaró el agente** que pretendía hacer?
3. **¿Qué resultado de política** se aplicó a esa intención?
4. **¿Qué evidencia verificable** existe de las acciones del agente?

El núcleo de DCP define la estructura y la semántica de estas respuestas. No prescribe algoritmos criptográficos concretos, mecanismos de transporte, políticas de gobernanza ni infraestructura operativa: eso corresponde a perfiles y servicios.

<a id="11-relationship-to-existing-specifications"></a>

### 1.1 Relación con las especificaciones existentes

Este documento es una especificación editorial que organiza y unifica el material ya publicado en:

- [DCP-01](../DCP-01.md) — Identidad y vinculación al principal
- [DCP-02](../DCP-02.md) — Declaración de intención y control por política
- [DCP-03](../DCP-03.md) — Cadena de auditoría y transparencia
- [BUNDLE](../BUNDLE.md) — Formato del Citizenship Bundle
- [VERIFICATION](../VERIFICATION.md) — Lista de verificación
- [DCP-AI v2.0](../DCP-AI-v2.0.md) — Especificación normativa completa, incluidas las extensiones poscuánticas

No sustituye a esos documentos. Ofrece una vista unificada del núcleo y aclara la frontera entre núcleo y perfiles.

---

<a id="2-problem-statement"></a>

## 2. Planteamiento del problema

Los agentes de IA operan cada vez más de forma autónoma en redes abiertas: llaman a API, intercambian datos, realizan transacciones y colaboran con otros agentes. Los mecanismos de autenticación existentes (claves de API, tokens OAuth, certificados mTLS) establecen el *control de acceso*, pero no la *rendición de cuentas*.

No hay una forma estandarizada de responder:

- ¿Quién desplegó este agente y acepta la responsabilidad de sus acciones?
- ¿Qué declaró el agente que haría antes de actuar?
- ¿Autorizó la acción una política?
- ¿Hay un registro, que permita detectar manipulaciones, de lo que ocurrió realmente?

El núcleo de DCP aborda esta carencia definiendo un conjunto mínimo y portable de artefactos que cualquier agente puede llevar y cualquier verificador puede evaluar.

---

<a id="3-scope"></a>

## 3. Alcance

<a id="in-scope-core"></a>

### Dentro del alcance (núcleo)

- Los seis artefactos del núcleo y sus campos obligatorios
- Las relaciones entre artefactos (vinculación, hash, encadenamiento)
- El modelo de verificación (qué debe comprobar un verificador)
- El formato del bundle (cómo se empaquetan los artefactos para el transporte)
- El requisito de firmas criptográficas (sin especificar algoritmos)
- El requisito de encadenar por hash las entradas de auditoría (sin especificar funciones hash)

<a id="out-of-scope-profiles-and-services"></a>

### Fuera del alcance (perfiles y servicios)

- Algoritmos criptográficos concretos → [perfil Crypto](../profiles/crypto/)
- Descubrimiento y comunicación entre agentes → [perfil A2A](../profiles/a2a/)
- Asignación de niveles de riesgo, jurisdicción, revocación, gobernanza → [perfil Governance](../profiles/governance/)
- Servidores de verificación, anclaje en blockchain, registros de transparencia → servicios de infraestructura
- Implementación del motor de políticas
- Despliegue de la infraestructura de gestión de claves
- Requisitos de transporte de red más allá del formato de intercambio

---

<a id="4-core-artifacts"></a>

## 4. Artefactos del núcleo

El núcleo de DCP define seis artefactos. Un Citizenship Bundle válido contiene los seis (aunque la evidencia de la acción puede contener una o más entradas).

<a id="41-responsible-principal-binding"></a>

### 4.1 Vinculación al principal responsable

Todo agente debe (MUST) estar vinculado a un principal responsable: una persona, organización o entidad jurídica que acepta rendir cuentas por las acciones del agente.

El registro de vinculación contiene:

- Un identificador único del principal
- El tipo de entidad (persona física, persona jurídica)
- La jurisdicción bajo la que opera el principal
- Material de claves criptográficas para verificar firmas
- Un compromiso de revocación (que permite una revocación de emergencia sin firma)
- La versión del protocolo y la vinculación de sesión

La vinculación establece la cadena de rendición de cuentas: si un agente se comporta mal, puede identificarse al principal responsable.

Véase [DCP-01](../DCP-01.md) para la definición normativa y `schemas/v1/responsible_principal_record.schema.json` para el esquema.

<a id="42-agent-passport"></a>

### 4.2 Pasaporte del agente

Cada agente lleva un pasaporte que establece su identidad y lo vincula con su principal responsable. El pasaporte contiene:

- Un identificador único del agente
- Un nombre legible por personas
- Las capacidades declaradas
- Un hash criptográfico del registro de vinculación del principal responsable (`owner_rpr_hash`)
- El material de claves propio del agente
- El estado (active, suspended, revoked)
- La versión del protocolo y la vinculación de sesión

El pasaporte lo firma el principal responsable. Un verificador puede confirmar que el agente está autorizado comprobando la firma del principal y el enlace por hash.

Véase [DCP-01](../DCP-01.md) para la definición normativa y `schemas/v1/agent_passport.schema.json` para el esquema.

<a id="43-intent-declaration"></a>

### 4.3 Declaración de intención

Antes de realizar cualquier acción, un agente debe (MUST) declarar su intención. La intención es una descripción estructurada de:

- Qué acción planea realizar el agente
- Cuál es el objetivo de la acción
- Qué clasificaciones de datos intervienen
- Una puntuación de riesgo evaluada

La intención sirve para dos cosas: permite el control por política (sección 4.4) y crea un registro de compromiso previo que puede compararse con el comportamiento real en el registro de auditoría.

Véase [DCP-02](../DCP-02.md) para la definición normativa y `schemas/v1/intent.schema.json` para el esquema.

<a id="44-policy-outcome"></a>

### 4.4 Resultado de política

Cada intención recibe un resultado de política de un motor de políticas. El motor de políticas es externo a DCP: el protocolo solo define el formato del resultado:

- **Decisión:** approve, escalate o block
- **Hash de la intención:** vinculación criptográfica con la intención evaluada
- **Condiciones:** restricciones opcionales de la aprobación (límites de tasa, confirmación humana, etc.)

El núcleo de DCP exige que exista un resultado de política para cada intención de un bundle. No exige ningún motor de políticas ni algoritmo de decisión concreto.

Véase [DCP-02](../DCP-02.md) para la definición normativa y `schemas/v1/policy_decision.schema.json` para el esquema.

<a id="45-action-evidence"></a>

### 4.5 Evidencia de la acción

Cada acción produce una o más entradas de auditoría que forman un registro encadenado por hash que permite detectar manipulaciones. Cada entrada contiene:

- Un identificador único del evento
- El tipo de evento
- Una referencia al agente y a la intención
- Un hash de la intención (que vincula la evidencia con la declaración)
- Un hash de la entrada de auditoría anterior (`prev_hash`), que forma una cadena inmutable
- Una marca de tiempo

La primera entrada de una cadena usa el valor centinela `"GENESIS"` como `prev_hash`. Las entradas siguientes se encadenan a su predecesora mediante `SHA-256(canonical(previous_entry))`.

Opcionalmente puede calcularse una raíz de Merkle sobre todas las entradas, lo que da un único hash que resume todo el registro de auditoría.

Véase [DCP-03](../DCP-03.md) para la definición normativa y `schemas/v1/audit_entry.schema.json` para el esquema.

<a id="46-bundle-manifest"></a>

### 4.6 Manifiesto del bundle

El Citizenship Bundle es el paquete portable que reúne todos los artefactos. Un bundle contiene exactamente:

- Un registro de vinculación al principal responsable
- Un pasaporte del agente
- Una declaración de intención
- Un resultado de política
- Una o más entradas de evidencia de la acción (registro de auditoría)

El Signed Bundle envuelve el Citizenship Bundle con una firma criptográfica, un `bundle_hash` (hash del bundle canónico) y, opcionalmente, una `merkle_root` sobre las entradas de auditoría.

Véase [BUNDLE](../BUNDLE.md) para la definición normativa y `schemas/v1/citizenship_bundle.schema.json` / `schemas/v1/signed_bundle.schema.json` para los esquemas.

---

<a id="5-verification-model"></a>

## 5. Modelo de verificación

Un verificador que recibe un Signed Bundle realiza las comprobaciones siguientes. Todas son locales: no hace falta ninguna llamada a un servidor.

1. **Validación contra el esquema** — el bundle y sus artefactos interiores se ajustan a los esquemas esperados
2. **Verificación de la firma** — la firma del bundle es válida con la clave pública del firmante
3. **Integridad del hash** — el `bundle_hash` coincide con el hash recalculado del bundle canónico
4. **Validez del principal** — el registro del principal responsable no ha caducado
5. **Estado del agente** — el estado del pasaporte del agente es `active`
6. **Vinculación con la intención** — el `intent_hash` de cada entrada de auditoría coincide con el hash de la intención declarada
7. **Integridad de la cadena de auditoría** — la cadena de `prev_hash` es válida desde `GENESIS` a través de todas las entradas
8. **Raíz de Merkle** (si está presente) — la raíz de Merkle declarada coincide con la raíz recalculada

Comprobaciones opcionales adicionales (definidas en perfiles, no en el núcleo):

- Consulta de listas de revocación (perfil Governance)
- Verificación de la atestación de jurisdicción (perfil Governance)
- Prueba de inclusión en un registro de transparencia (perfil Governance)
- Verificación del anclaje en blockchain (perfil Governance)
- Verificación de firmas compuestas / PQ (perfil Crypto)

Véase [VERIFICATION](../VERIFICATION.md) para la lista de verificación normativa completa.

---

<a id="6-security-notes"></a>

## 6. Notas de seguridad

<a id="61-algorithm-independence"></a>

### 6.1 Independencia de los algoritmos

El núcleo de DCP exige firmas criptográficas y funciones hash, pero no impone algoritmos concretos. Esta separación permite:

- Que las implementaciones empiecen con algoritmos clásicos y adopten los poscuánticos más adelante
- Que los verificadores apliquen sus propias políticas de algoritmos
- Que el protocolo sobreviva a las transiciones de algoritmos sin romper la especificación del núcleo

El [perfil Crypto](../profiles/crypto/) define los algoritmos concretos, la vinculación de firmas compuestas y los mecanismos de agilidad criptográfica usados en DCP v2.0.

<a id="62-trust-model"></a>

### 6.2 Modelo de confianza

DCP no presupone una autoridad central. La verificación es local y P2P: un verificador solo necesita el Signed Bundle y (opcionalmente) un conjunto de registros de revocación. La confianza en el principal responsable se establece mediante el registro de vinculación y su cadena de firmas, no mediante un registro centralizado.

<a id="63-privacy"></a>

### 6.3 Privacidad

El núcleo admite un modo cegado en el que los campos de datos personales de la vinculación al principal se sustituyen por un hash de compromiso con sal (`pii_hash`, véase [DCP-AI v2.0 §12.1](../DCP-AI-v2.0.md#121-blinded-rpr)). Los campos que no son datos personales (claves, jurisdicción, responsabilidad) se conservan para la verificación. El registro completo puede revelarse a las partes autorizadas cuando lo pidan.

<a id="64-replay-protection"></a>

### 6.4 Protección frente al reenvío

En DCP v2.0, un campo `session_nonce` vincula todos los artefactos de un bundle a una única sesión. Los verificadores deben comprobar que todos los artefactos comparten el mismo nonce. Esto impide los ataques de empalme de sesiones. La vinculación de sesión es normativamente obligatoria en v2.0, pero no existía en v1.0.

---

<a id="7-extensibility"></a>

## 7. Extensibilidad

El núcleo de DCP está diseñado para ampliarse mediante perfiles. Un perfil:

- No debe (MUST NOT) contradecir los requisitos del núcleo
- Puede (MAY) definir artefactos, campos o pasos de verificación adicionales
- Puede (MAY) especificar elecciones de algoritmos, vinculaciones de transporte o políticas de gobernanza
- Se versiona de forma independiente del núcleo

Una implementación conforme del núcleo es válida sin ningún perfil. Los perfiles añaden capacidades, no requisitos.

Los perfiles definidos actualmente son:

| Perfil | Alcance | Documento |
|---------|-------|----------|
| Crypto | Algoritmos, firmas compuestas, agilidad criptográfica | [spec/profiles/crypto/](../profiles/crypto/) |
| A2A | Descubrimiento de agentes, handshake, gestión de sesiones | [spec/profiles/a2a/](../profiles/a2a/) |
| Governance | Niveles de riesgo, jurisdicción, revocación, recuperación | [spec/profiles/governance/](../profiles/governance/) |

---

<a id="references"></a>

## Referencias

- [DCP-01](../DCP-01.md) — Identidad y vinculación al principal
- [DCP-02](../DCP-02.md) — Declaración de intención y control por política
- [DCP-03](../DCP-03.md) — Cadena de auditoría y transparencia
- [DCP-04](../DCP-04.md) — Comunicación entre agentes
- [BUNDLE](../BUNDLE.md) — Formato del Citizenship Bundle
- [VERIFICATION](../VERIFICATION.md) — Lista de verificación
- [DCP-AI v2.0](../DCP-AI-v2.0.md) — Especificación normativa poscuántica
- [ROADMAP](../../ROADMAP.md) — Hoja de ruta de la evolución del proyecto

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **Nombres de campos.** Algunas descripciones de §4 son conceptuales y no coinciden campo a campo con los esquemas. Ningún esquema de RPR
  tiene un campo de compromiso de revocación; el pasaporte V2 tiene un `emergency_revocation_token` opcional. Ningún esquema de pasaporte
  tiene un nombre ni un `owner_rpr_hash`: el pasaporte apunta al principal con
  `principal_binding_reference`. La puntuación de riesgo está en la decisión de política (`risk_score`), no en la intención, y la
  decisión de política se refiere a su intención por `intent_id` y enumera las condiciones en `required_confirmation`. Las entradas de auditoría
  tienen un `audit_id` y un `outcome`, no un tipo de evento.
- **V1 y V2.** El bundle de §4.6 y las comprobaciones de §5 son los de V1: una firma Ed25519 sobre el bundle y al
  menos una entrada de auditoría. Un bundle V2 lleva un manifiesto firmado que se compromete con cada artefacto, sobres `SignedPayload`
  para los cuatro artefactos principales, un nonce de sesión y firmas compuestas, y puede tener un registro de auditoría
  vacío ([VERIFICATION.md](../VERIFICATION.md), lista de verificación V2).
- **Quién firma el pasaporte.** En V2 el agente firma su propio pasaporte con las `keys` del pasaporte; queda vinculado al
  principal por la firma del principal sobre el manifiesto, hecha con las `binding_keys` del RPR (VERIFICATION.md V2-6).
- **Evidencia de auditoría (§4.5, §6).** Un registro de auditoría verificado muestra que las entradas registradas están intactas y que se
  comprometieron con las claves que enumera el bundle; no muestra que las acciones ocurrieran realmente, y la cadena no es inmutable
  frente a quien tenga esas claves y firme una nueva. Ni la verificación ni la admisión autorizan una acción por
  sí solas.
- **Confianza (§6.2).** Un bundle que se verifica prueba que sus firmas coinciden con las claves que enumera; no prueba quién
  es el principal, porque cualquiera puede crear un RPR. La confianza en un principal viene del conjunto de confianza propio del verificador:
  véase [docs/ADMISSION.md](../../docs/ADMISSION.md) y el [perfil de admisión](../profiles/admission/).
- **Perfiles (§7).** «Válida sin ningún perfil» se refiere a la interoperabilidad de los artefactos del núcleo. No exime
  a una implementación de los requisitos del núcleo, y un despliegue sigue aplicando su propia política de verificador y, cuando
  lo usa, el perfil de admisión.
