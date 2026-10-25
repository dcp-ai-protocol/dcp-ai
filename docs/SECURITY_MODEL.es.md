<sub>[English](SECURITY_MODEL.md) · [中文](SECURITY_MODEL.zh-CN.md) · **Español** · [日本語](SECURITY_MODEL.ja.md) · [Português](SECURITY_MODEL.pt-BR.md)</sub>

<a id="security-model"></a>

# Modelo de seguridad

> Traducción informativa de [la versión en inglés](SECURITY_MODEL.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Cómo protege el protocolo frente a los ataques, desde los bundles falsificados hasta las bifurcaciones del protocolo.

---

<a id="design-principle"></a>

## Principio de diseño

La verificación es local. No es una debilidad; es la propiedad de seguridad central. La verificación local significa:

- **Ningún punto único de compromiso.** No hay un servidor central que, si se compromete, invalide a todos los agentes. Cada verificador ejecuta su propio código y comprueba sus propias matemáticas.
- **Las garantías criptográficas no dependen del lugar.** Las firmas Ed25519 y los hashes SHA-256 dan el mismo resultado en cualquier máquina. No se pueden «hackear las matemáticas».
- **El verificador no confía en el agente.** El agente presenta un bundle; el verificador lo comprueba con sus propias herramientas. Un agente comprometido no puede hacer que un verificador acepte un bundle no válido.

La verificación dice que un bundle está intacto y firmado por las claves que nombra. Confiar en esas claves, y actuar según el bundle, es una decisión aparte: la admisión frente a los principales de confianza del operador ([ADMISSION.md](ADMISSION.md), sin publicar), más la autorización propia del operador.

La seguridad procede de **capas de protección**, cada una dirigida a un vector de ataque distinto.

---

<a id="attack-vectors-and-protections"></a>

## Vectores de ataque y protecciones

<a id="1-forged-bundle-tampered-content"></a>

### 1. Bundle falsificado (contenido manipulado)

**Ataque:** un atacante modifica un campo de un Signed Bundle (p. ej., cambia `agent_passport.status` de `"revoked"` a `"active"`).

**Protección:** la firma Ed25519 cubre el JSON canónico de todo el bundle (`dcp-jcs-v1`). Cualquier cambio en el contenido firmado —un valor, una clave, un elemento— invalida la firma. Los cambios que dejan igual la forma canónica, como los espacios en blanco o el orden de las claves, no son cambios del contenido firmado y siguen verificándose. El verificador recalcula `bundle_hash = SHA-256(canonical(bundle))` y lo compara con el hash firmado. Ambas comprobaciones fallan si el contenido se modificó.

**Solidez:** criptográfica. Romper Ed25519 exige resolver el problema del logaritmo discreto en Curve25519; no se conoce ningún ataque práctico.

<a id="2-forged-identity-fake-rpr"></a>

### 2. Identidad falsificada (RPR falso)

**Ataque:** un atacante crea un Responsible Principal Record que dice ser «Google» o «el Gobierno de EE. UU.» y firma un bundle con su propia clave. La firma es válida, pero la identidad es falsa.

**Protección:**

- **Jurisdiction Attestation** (véase [spec/DCP-01.md](../spec/DCP-01.md)): un gobierno o una autoridad acreditada firma el hash del RPR y certifica la identidad. Un verificador que exija atestación rechazará los bundles que no la tengan.
- **Vinculación de la clave pública:** el verificador puede exigir que la clave pública del firmante sea conocida (p. ej., publicada por la entidad). Un bundle falso de «Google» no tendrá la clave pública real de Google.
- **Registro de transparencia:** si el `bundle_hash` de la entidad real está en el registro y el falso no, la falsificación es detectable.

**Solidez:** depende de si se exige atestación. Sin atestación, la identidad es autodeclarada (como un certificado autofirmado). Con atestación, la identidad está respaldada por una autoridad.

<a id="3-stolen-signing-key"></a>

### 3. Clave de firma robada

**Ataque:** un atacante roba la clave secreta de un usuario y crea bundles válidos en su nombre.

**Protección:**

- **Revocación:** el titular de la clave (o la jurisdicción) publica un RevocationRecord firmado. Todos los verificadores que consultan la lista de revocaciones rechazarán los bundles firmados con la clave comprometida.
- **Lista de revocaciones jurisdiccional:** el gobierno publica una lista firmada de agentes revocados en una URL conocida. Los verificadores la descargan y la guardan en caché.
- **Rotación de claves:** genera un par de claves nuevo (`dcp keygen`), vuelve a firmar los bundles y revoca la clave antigua.

**Solidez:** depende de la propagación de la revocación y de lo que hace el verificador cuando no puede obtener un estado reciente. Un TTL de caché por sí solo no es una cota: una clave robada sigue siendo útil hasta que el titular publica la revocación y, después, hasta que cada verificador descarga una lista que la incluya. Con una lista en caché (p. ej., un TTL de 1 hora), la ventana tras la publicación es de aproximadamente una hora solo para un verificador que la actualiza a tiempo y falla cerrado cuando no puede descargar la lista. Un verificador que sigue usando una lista obsoleta, o que omite la revocación cuando la fuente no está disponible, no tiene cota. El perfil de admisión strict-v1 exige una instantánea de revocación con 300 segundos de antigüedad como máximo y falla cuando la fuente no está disponible ([ADMISSION.md](ADMISSION.md#revocation-sources)).

<a id="4-modified-verifier-compromised-verification-code"></a>

### 4. Verificador modificado (código de verificación comprometido)

**Ataque:** un atacante (o un implementador descuidado) modifica el código de verificación para que siempre devuelva `verified: true`, saltándose todas las comprobaciones.

**Protección:**

- **Límite de confianza.** Un verificador comprometido afecta a su operador y a los clientes que dependen de sus resultados. Los verificadores ejecutados de forma independiente no heredan esos resultados; una dependencia compartida comprometida puede afectar a varios operadores.
- **Comprobación de las huellas de los esquemas:** `dcp integrity` compara los esquemas V1 locales con las huellas del `protocol_fingerprints.json` local (véase más abajo). Detecta un esquema V1 cambiado sin su huella; no comprueba el código de verificación.
- **Pruebas de conformidad:** `npm run conformance` valida la implementación contra fixtures que se sabe que son correctos. Una implementación modificada que cambia los resultados con esos fixtures no supera la conformidad; un cambio fuera de lo que ejercitan los fixtures puede pasar igualmente.

**Solidez:** el impacto depende de cómo se distribuya el código comprometido y de quién dependa de sus resultados. La verificación independiente limita la dependencia de otro verificador; no elimina el riesgo de la cadena de suministro.

<a id="5-protocol-fork-the-real-threat"></a>

### 5. Bifurcación del protocolo (la amenaza real)

**Ataque:** alguien bifurca el protocolo, debilita los esquemas (elimina campos obligatorios, relaja la validación) y afirma ser compatible con DCP. Si se adopta ampliamente, esto erosiona la confianza en el ecosistema.

**Protección:**

- **Huellas del protocolo:** el archivo `protocol_fingerprints.json` de la raíz del repositorio contiene el hash SHA-256 de cada archivo de esquema V1. Cualquier implementación puede comprobar sus esquemas V1 contra ellas. Si alguien modifica un esquema, su hash cambia.
- **Comando `dcp integrity`:** compara los esquemas V1 de `schemas/v1/` con las huellas del `protocol_fingerprints.json` local:

  ```bash
  dcp integrity
  # ✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.
  ```

- **Evidencia de conformidad:** superar `npm run conformance` con esquemas obtenidos de una fuente de confianza demuestra el acuerdo en los casos que cubre esa suite. No prueba que se traten correctamente todos los requisitos del protocolo ni todas las entradas; revisa también la implementación y la cobertura de la especificación aplicable.
- **Versión a nivel de bundle:** cada artefacto incluye `dcp_version: "1.0"`. Un verificador comprueba la versión y usa los esquemas correspondientes. Una bifurcación con esquemas distintos necesitaría otra versión, lo que la haría distinguible.

**Solidez:** limitada. Las huellas detectan un esquema V1 que difiere del archivo de huellas que tiene al lado. No autentican ese archivo (no está firmado, y una bifurcación puede cambiar ambos), no cubren los esquemas V2 y no dicen nada del código. Una coincidencia no es una certificación de la implementación. Compara con huellas obtenidas de una fuente en la que confíes, y ejecuta la suite de conformidad, para juzgar una implementación.

<a id="6-retroactive-modification-bundle-changed-after-anchoring"></a>

### 6. Modificación retroactiva (bundle cambiado después del anclaje)

**Ataque:** un atacante modifica un bundle después de que se anclara en una blockchain o se registrara en un registro de transparencia.

**Protección:**

- **Inmutabilidad del anclaje:** el `bundle_hash` en Bitcoin (OP_RETURN) o Ethereum (evento) es inmutable. El atacante no puede cambiar el hash on-chain.
- **Verificación:** el verificador recalcula `bundle_hash` a partir del bundle y lo compara con el anclaje. Si el bundle se modificó, el hash no coincide.
- **Prueba del registro de transparencia:** el registro guardó el `bundle_hash` original. Una prueba de inclusión de Merkle vincula el hash con la raíz firmada. Si el bundle se modificó, la prueba falla.

**Solidez:** criptográfica + inmutabilidad de la blockchain. La modificación retroactiva es detectable mientras exista el anclaje o la entrada del registro.

---

<a id="protection-layers-summary"></a>

## Capas de protección (resumen)

```
Layer 1: Cryptography (Ed25519 + SHA-256)
  Forged bundles are detected by signature and hash checks.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities are detected if attestation is required.

Layer 3: Revocation (signed lists by jurisdiction)
  Fresh status and fail-closed handling bound acceptance after revocation;
  a cache TTL alone is not a propagation guarantee.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications are detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum)
  Provides immutable, public proof of bundle existence at a point in time.
```

Las capas 1–4 están disponibles hoy en este repositorio. La capa 5 tiene un servicio de referencia (`services/transparency-log/`, en memoria). La capa 6 está diseñada ([docs/STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)) y tiene un contrato de Ethereum (`contracts/ethereum/`), pero el servicio de anclaje de referencia todavía no envía a ninguna cadena; las implementaciones de producción son específicas de cada operador.

---

<a id="protocol-fingerprints"></a>

## Huellas del protocolo

El archivo `protocol_fingerprints.json` de la raíz del repositorio contiene el hash SHA-256 de los bytes de cada archivo de esquema de `schemas/v1/`. Formato:

```json
{
  "protocol": "DCP-AI",
  "version": "1.0",
  "schema_fingerprints": {
    "responsible_principal_record": "sha256:<hex>",
    "agent_passport": "sha256:<hex>",
    ...
  }
}
```

Cualquier implementación —en cualquier lenguaje y plataforma— puede calcular el SHA-256 de sus archivos de esquema y compararlo con estas huellas. Una coincidencia significa que sus archivos de esquema V1 son idénticos byte a byte a los que tienen huella; no prueba que su código verifique correctamente, y el archivo de huellas solo es tan fiable como el lugar de donde lo obtuviste.

**Verificar localmente:**

```bash
dcp integrity
```

---

<a id="what-the-protocol-does-not-protect-against"></a>

## Frente a qué NO protege el protocolo

- **Una persona malintencionada detrás de un bundle válido.** DCP puede transportar una vinculación con un principal y evidencia que se comprueba contra la configuración de confianza del operador. No establece automáticamente una identidad del mundo real ni garantiza que el principal actúe éticamente. El cumplimiento de la ley y la regulación quedan fuera de la verificación criptográfica.
- **Un verificador comprometido que acepta bundles no válidos.** Cada entidad es responsable de ejecutar código de verificación correcto. El protocolo proporciona huellas y pruebas de conformidad; usarlas es responsabilidad del operador.
- **Denegación de servicio.** La limitación de tasa se especifica por endpoint en la API (véase `x-ratelimit` en [`api/openapi.yaml`](../api/openapi.yaml)). La mitigación de DDoS a nivel de infraestructura es responsabilidad del operador.
- **Repetición de un bundle válido.** Un bundle firmado puede presentarse de nuevo; véase [Repetición entre artefactos](#9-cross-artifact-replay) para lo que la acota.

---

---

<a id="v20-security-enhancements"></a>

## Mejoras de seguridad de V2.0

DCP v2.0 refuerza considerablemente el modelo de seguridad con criptografía poscuántica, firmas compuestas, niveles de seguridad adaptativos y seguridad entre agentes.

<a id="7-post-quantum-threat-model"></a>

### 7. Modelo de amenazas poscuántico

**Ataque:** un adversario cuántico con acceso a un ordenador cuántico a gran escala (o con una estrategia de «recolectar ahora, descifrar después») ataca las firmas Ed25519 y los intercambios de claves.

**Protección:**
- **Firmas compuestas híbridas:** una firma compuesta V2 combina Ed25519 (clásica) con ML-DSA-65 (poscuántica, FIPS 204). La firma PQ cubre la firma clásica (vinculación `pq_over_classical`), así que romper solo una de ellas no basta. Una firma V2 también puede ser `classical_only`; que se acepte depende del modo de verificación (§8).
- **KEM híbrido:** el intercambio de claves de DCP-04 usa X25519 + ML-KEM-768 (FIPS 203), así que las claves de sesión siguen siendo seguras mientras resista cualquiera de los dos algoritmos. Los SDK no ejecutan este intercambio: quien llama deriva la clave de sesión ([NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.1).
- **Cadenas de hash dobles:** el diseño usa SHA-256 y SHA3-256 en paralelo para mantener la continuidad si una familia de hash se ve comprometida, siempre que se verifiquen ambas cadenas. Los verificadores actuales de bundles V2 no recalculan la cadena de auditoría secundaria opcional ni la raíz de Merkle secundaria; por tanto, un resultado exitoso no acredita esta protección adicional ([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).

**Solidez:** seguridad poscuántica de nivel 3 del NIST para las firmas comprobadas en modo `hybrid_required` (el modo de los niveles elevated y maximum): un atacante debe romper tanto el algoritmo clásico como el poscuántico.

<a id="8-stripping-attacks-composite-signature"></a>

### 8. Ataques de eliminación (firma compuesta)

**Ataque:** un atacante intercepta un bundle firmado y elimina el componente de firma poscuántico, presentando solo la firma clásica.

**Protección:** el protocolo de vinculación `pq_over_classical` garantiza:
1. `classical_sig = Ed25519.sign(context || 0x00 || payload)`
2. `pq_sig = ML-DSA-65.sign(context || 0x00 || payload || classical_sig)`

La firma PQ cubre la firma clásica, así que una firma clásica modificada, o una firma PQ trasladada a otro payload, no supera la verificación. Eliminar por completo la firma PQ deja una firma `classical_only`, sobre la que decide solo el modo efectivo: `hybrid_required` (y `pq_only`) la rechaza, mientras que `hybrid_preferred` la acepta con un aviso y `classical_only` la acepta.

**Solidez:** criptográfica en modo `hybrid_required`. Con `hybrid_preferred` o `classical_only`, la eliminación es visible (el aviso, la vinculación `classical_only`), pero no se rechaza.

<a id="9-cross-artifact-replay"></a>

### 9. Repetición entre artefactos

**Ataque:** un atacante toma una intención válida de una sesión y la repite en otra sesión o con otro bundle.

**Protección:**
- **Separación de dominio:** cada firma incluye una etiqueta de contexto (p. ej., `DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle`). Las firmas de un tipo de artefacto no pueden repetirse para otro.
- **Nonce de sesión:** cada bundle incluye un nonce de sesión aleatorio de 256 bits. El manifiesto vincula todos los artefactos a ese nonce. Repetir artefactos de una sesión en otra rompe el hash del manifiesto.

El nonce no impide que el mismo bundle vuelva a presentarse: un bundle completo se repite tal cual. Una caducidad de sesión firmada y un `intended_verifier` firmado (ambos exigidos por el perfil de admisión strict-v1) acotan dónde y durante cuánto tiempo puede repetirse un bundle; no lo hacen de un solo uso. Un verificador que necesite un solo uso mantiene su propio registro de nonces o hashes de bundles consumidos ([ADMISSION.md](ADMISSION.md#limits)).

**Solidez:** separación de dominio criptográfica + vinculación de sesión, contra la mezcla de artefactos; no contra la repetición de un bundle completo.

<a id="10-security-tier-downgrade"></a>

### 10. Rebaja del nivel de seguridad

**Ataque:** un agente malintencionado declara un nivel de seguridad bajo (p. ej., `routine`) para evitar los requisitos de firma PQ en una operación de alto riesgo.

**Protección:**
- **Política decidida por el verificador:** el verificador determina el nivel mínimo, no el agente. Verifica cada bundle según el más estricto entre el modo de su política y el modo del nivel (spec §14.3), así que un pasaporte que declara `risk_tier: "low"` no puede obtener `classical_only` para una intención de pago. Los verificadores pueden subir niveles, pero NO DEBEN bajarlos.
- **Cálculo automático del nivel:** el SDK calcula los niveles a partir del `risk_score` de la decisión de política y de los `data_classes`, `action_type` y `estimated_impact` de la intención (spec §14.2). Los valores desconocidos o ausentes fallan cerrados a `elevated`, y el agente no puede rebajar el nivel calculado.
- **Regla de no rebaja:** si la intención resulta en `elevated` pero el agente declara `routine`, el verificador resuelve a `elevated`.

**Solidez:** aplicación de la política a nivel del verificador.

<a id="11-a2a-session-security"></a>

### 11. Seguridad de las sesiones A2A

**Ataque:** un atacante intercepta o secuestra una sesión de comunicación entre agentes.

**Protección:**
- **Verificación mutua de bundles:** ambos agentes verifican el bundle del otro antes de establecer una sesión.
- **Intercambio de claves con KEM híbrido:** las claves efímeras proporcionan secreto hacia adelante. Comprometer las claves de larga duración no revela las claves de sesión pasadas. Los SDK dejan este intercambio a quien llama.
- **Cifrado AES-256-GCM:** todos los mensajes de la sesión se cifran con cifrado autenticado.
- **Números de secuencia monótonos:** impiden la repetición y el reordenamiento dentro de una sesión.
- **Cambio periódico de clave:** la sesión indica cuándo toca cambiar de clave (`needsRekeying`); quien llama deriva la clave nueva.
- **Atención a la revocación:** la especificación termina una sesión cuando cualquiera de los agentes se revoca. Los SDK no vigilan la revocación durante una sesión: la aplicación debe comprobarla y cerrar la sesión.

**Solidez:** secreto hacia adelante poscuántico + cifrado autenticado, cuando quien llama ejecuta el intercambio híbrido y el cambio de clave.

<a id="12-lifecycle-state-manipulation-dcp-05"></a>

### 12. Manipulación del estado del ciclo de vida (DCP-05)

**Ataque:** un actor malintencionado intenta saltarse las transiciones de estado del ciclo de vida, p. ej., reactivando un agente retirado u omitiendo el estado «declining» para evitar los procedimientos de disposición de los datos.

**Protección (especificación y SDK):**
- **Máquina de estados:** `commissioned → active → declining → decommissioned`; las transiciones no válidas se rechazan.
- **Registros del ciclo de vida firmados:** cada transición de estado (certificado de puesta en servicio, informe de vitalidad, registro de retirada) lleva una firma compuesta, y los informes de vitalidad están encadenados por hash.
- **Retirada definitiva:** una vez que un agente llega a `decommissioned`, no hay más transiciones posibles. El registro de retirada indica la disposición de los datos.

**En el servidor de referencia:** los endpoints del ciclo de vida rechazan las transiciones no válidas (409), pero no verifican las firmas de los registros y no necesitan autenticación; un nuevo certificado de puesta en servicio para un agente retirado lo restablece a `commissioned` ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

**Solidez:** donde se verifican las firmas de los registros (con las funciones del SDK o con un servicio que las llame), la máquina de estados más el rastro firmado. El servidor de referencia por sí solo no da ninguna de las dos.

<a id="13-unauthorized-succession-dcp-06"></a>

### 13. Sucesión no autorizada (DCP-06)

**Ataque:** una parte no autorizada crea un testamento digital o inicia la sucesión de un agente que no controla, transfiriendo la memoria y la autoridad a un sucesor ilegítimo.

**Protección:**
- **Firma del testamento:** los testamentos digitales llevan una firma compuesta que vincula el `agent_id` y las `successor_preferences`. El servidor de referencia guarda los testamentos sin verificarla.
- **Clasificación de la memoria:** las transferencias de memoria usan niveles de acceso clasificados. Solo se transfieren las entradas que corresponden a la habilitación del sucesor.
- **Manifiestos de doble hash:** los manifiestos de transferencia de memoria usan referencias de doble hash (SHA-256 + SHA3-256) para impedir la manipulación de los datos transferidos.

**Solidez:** vinculación criptográfica de la autoridad de sucesión + control de acceso a la memoria clasificada, para un verificador que compruebe las firmas.

<a id="14-delegation-abuse--authority-escalation-dcp-09"></a>
<a id="14-delegation-abuse-authority-escalation-dcp-09"></a>

### 14. Abuso de la delegación y escalada de autoridad (DCP-09)

**Ataque:** un agente con autoridad delegada intenta superar el alcance de su delegación, o se falsifica un mandato de delegación para conceder capacidades no autorizadas.

**Protección:**
- **Mandatos de delegación con alcance:** cada mandato especifica un `authority_scope` con dominios y acciones explícitos. Las acciones fuera de alcance se rechazan.
- **Umbrales de atención:** umbrales configurables disparan alertas o exigen confirmación humana cuando los parámetros de la delegación superan los límites definidos (puntuación de riesgo, importe económico, sensibilidad de los datos).
- **Espejos del principal:** el registro `PrincipalMirror` mantiene una instantánea verificable de las preferencias del principal, lo que evita que la autoridad delegada se aleje de la intención del principal.
- **Registro de interacciones:** las interacciones pueden registrarse como entradas `InteractionRecord` firmadas; registrarlas depende de la aplicación.

**Solidez:** autorización con alcance + supervisión por umbrales + rastro de auditoría criptográfico, para un verificador que compruebe los mandatos y sus firmas. El servidor de referencia guarda los mandatos sin verificar sus firmas y permite que cualquiera revoque uno revocable ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

<a id="updated-protection-layers-v20"></a>

### Capas de protección actualizadas (V2.0)

```
Layer 1: Cryptography (Ed25519 + ML-DSA-65 composite, SHA-256 + SHA3-256 dual hash)
  Forged bundles detected. Post-quantum resistant.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities detected if attestation is required.

Layer 3: Revocation (lists + emergency revocation via pre-image)
  Stolen keys are refused by verifiers that fetch fresh status and fail closed.
  Emergency revocation: revealing the pre-image revokes all keys without a signature,
  effective for each verifier once it learns of it.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum L2)
  Immutable, public proof of bundle existence.

Layer 7: Security Tiers (V2.0)
  Risk-adaptive cryptographic requirements. High-risk = full PQ.

Layer 8: A2A Security (DCP-04)
  Mutual authentication + encrypted channels between agents.

Layer 9: Observability (V2.0)
  Telemetry, metrics, and alerting for anomalous behavior.

Layer 10: Lifecycle Governance (DCP-05)
  Signed lifecycle records and a state machine, where the signatures are verified.

Layer 11: Succession Security (DCP-06)
  Signed testaments and classified memory transfers protect succession integrity.

Layer 12: Dispute Resolution (DCP-07)
  Structured escalation prevents unresolved conflicts from compromising operations.

Layer 13: Rights Enforcement (DCP-08)
  Declared rights and obligations create verifiable compliance boundaries.

Layer 14: Delegation Control (DCP-09)
  Scoped mandates and awareness thresholds prevent authority escalation.
```

Para los detalles de conformidad con la criptografía poscuántica del NIST, véase [NIST_CONFORMITY.md](NIST_CONFORMITY.md).
Para migrar desde el modelo de seguridad de V1.0, véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md).

---

<a id="operational-security-requirements"></a>

## Requisitos de seguridad operativa

<a id="private-key-storage"></a>

### Almacenamiento de claves privadas

| Nivel de seguridad | Requisito |
|---|---|
| **Routine** | Archivos de claves con permisos 0600, cifrados en reposo (a nivel del sistema operativo) |
| **Standard** | Almacén de claves cifrado con frase de contraseña (PKCS#8 o similar) |
| **Elevated** | Integración con HSM/TPM (DEBERÍA). Integración con el llavero del sistema operativo |
| **Maximum** | Integración con HSM/TPM (DEBE). Ceremonia aislada (air-gapped) para la generación de claves |

Este repositorio no tiene integración con HSM/TPM: el `HsmCryptoProvider` del código TypeScript es un patrón simulado que no debe usarse para evidencias reales ([NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.2). Las filas elevated y maximum necesitan una integración propia.

La CLI de referencia (`bin/dcp.js`) y la CLI del SDK de Python escriben los archivos de claves secretas con modo `0600` (lectura y escritura para el propietario, sin permisos para el grupo ni para otros). El `@dcp-ai/cli init` interactivo no lo hace: los escribe con los permisos por defecto (`0644` con la umask habitual `022`), así que ejecuta `chmod 600 .dcp/keys/*_secret.key`. Los operadores NO DEBEN relajar estos permisos.

<a id="revocation-propagation-slas"></a>

### SLA de propagación de la revocación

| Nivel de seguridad | Latencia máxima aceptable |
|---|---|
| **Routine** | 24 horas |
| **Standard** | 1 hora |
| **Elevated** | 15 minutos |
| **Maximum** | Inmediata (notificación push + grapado al estilo OCSP) |

Son objetivos para los operadores. El repositorio no tiene notificaciones push ni grapado; lo más parecido es el perfil de admisión strict-v1, que exige una instantánea de revocación con 300 segundos de antigüedad como máximo. Los operadores DEBERÍAN configurar el TTL de la caché de la lista de revocaciones según el nivel más alto que atiendan, y fallar cerrados cuando no puedan descargar la lista.

<a id="api-security"></a>

### Seguridad de la API

Todos los despliegues en producción DEBEN:
- Imponer TLS 1.3 (TLS 1.2 como mínimo)
- Exigir autenticación en todos los endpoints que modifican datos (token Bearer o clave de API)
- Configurar la limitación de tasa según las especificaciones `x-ratelimit` de `openapi.yaml`
- Establecer las cabeceras de seguridad: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- Restringir CORS a orígenes de confianza
- Usar `Cache-Control: no-store` en las respuestas de verificación

<a id="v1-to-v2-downgrade-prevention"></a>

### Prevención de la rebaja de V2 a V1

Cuando un agente tiene claves V2 registradas, los verificadores DEBERÍAN rechazar los bundles V1 de ese agente (fijación de capacidades). El indicador de política `allow_v1_bundles` vale `true` por defecto durante la migración, pero DEBERÍA fijarse a `false` una vez completada.

<a id="supply-chain-security"></a>

### Seguridad de la cadena de suministro

Los operadores que despliegan DCP DEBEN:
- Fijar todas las versiones de las bibliotecas criptográficas en los archivos de bloqueo
- Verificar la integridad de las dependencias con hashes SRI
- Vigilar compromisos en las bibliotecas de origen (`@noble/post-quantum`, `tweetnacl`, etc.)
- Usar compilaciones reproducibles para los componentes criptográficos

---

<a id="known-limitations-and-mitigations"></a>

## Limitaciones conocidas y mitigaciones

| Limitación | Mitigación |
|---|---|
| Identidad autodeclarada en el nivel `routine` | Exigir atestación, o admisión frente a un conjunto de confianza, para los niveles `standard` y superiores; los verificadores no lo imponen por sí mismos |
| La caché de verificación puede servir resultados obsoletos | La caché DEBE invalidarse cuando se actualiza la lista de revocaciones. El `VerificationCache` de TypeScript se indexa solo por el hash del bundle y su `invalidateByAgent` no hace nada, así que vacíala o no uses la caché a través de cambios de confianza o de revocación ([API_REFERENCE.md](API_REFERENCE.md)) |
| Los verificadores de bundles V2 no recalculan la cadena de auditoría secundaria opcional ni la raíz de Merkle secundaria | Confía solo en las comprobaciones que realmente se hacen: los compromisos SHA-256 primarios y las firmas. No atribuyas a un resultado satisfactorio la protección adicional especificada en V2-11; el candidato experimental reutiliza estas comprobaciones ([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)) |
| La persistencia del `agent_id` permite el rastreo | Considerar la rotación de seudónimos en escenarios de alta privacidad |
| BlindedRPR expone `entity_type` y `jurisdiction` | Futuro: presentación de credenciales basada en ZKP |
| Ningún SDK ejecuta el intercambio X25519 + ML-KEM-768 de DCP-04 | Quien llama deriva la clave de sesión A2A. Python, Go, Rust y WASM exponen ML-KEM-768 como primitiva; los proveedores KEM de TypeScript son internos |
| ML-DSA-87 no está implementado | El identificador está reservado en el esquema de claves; ningún SDK puede usarlo, y el patrón HSM simulado que lo enumera no es una implementación |
| Los endpoints de DCP-05–09 del servidor de referencia no tienen autenticación y no verifican firmas | No los expongas a clientes que no sean de confianza ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)) |

Las siguientes limitaciones, que aparecían en borradores anteriores, se han **cerrado**:

- *La criptografía PQ de la CLI estaba simulada (marcador HMAC)*: resuelto; la CLI de referencia (`bin/dcp.js`) usa ahora ML-DSA-65 real mediante `@noble/post-quantum` para generar claves y firmar.
- *El Shamir SSS de la CLI era un marcador (partes aleatorias)*: resuelto; la CLI usa `secrets.js-grempe`, una biblioteca real de reparto de secretos de Shamir, para las operaciones de recuperación de claves.
- *El comportamiento de DCP-04..09 solo existía en TypeScript*: resuelto en 2.2.0..2.7.0; el ciclo de vida, la sucesión, la resolución de disputas, el arbitraje, los derechos y obligaciones, la delegación, el umbral de atención y el espejo del principal están disponibles en Python, Rust y Go con la misma semántica que la referencia de TypeScript. Los mensajes de handshake A2A y la capa de sesión AES-256-GCM están en Python y Go; Rust cubre el descubrimiento, los mensajes de handshake y los ID de sesión. Véase [CHANGELOG.md](../CHANGELOG.md#210---2026-04-22) para el desglose versión a versión.
- *La taxonomía canónica de errores solo existía en TypeScript*: resuelto en 2.7.0; 38 valores de `DcpErrorCode` con identificadores estables `DCP-E###` están ahora alineados entre TypeScript, Python, Rust y Go, de modo que el tratamiento de errores entre SDK coincide en una única cadena.
- *El `keygen` de la CLI de Python escribía la clave secreta con el modo de archivo por defecto*: resuelto; `sdks/python/dcp_ai/cli.py` crea ahora `secret_key.txt` de forma atómica con modo 0600 desde la propia llamada a `os.open` (sin ventana de carrera de chmod) y pone el directorio que lo contiene en modo 0700.

---

<a id="reference"></a>

## Referencias

- Lista de comprobación de la verificación: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Huellas del protocolo: [protocol_fingerprints.json](../protocol_fingerprints.json)
- DCP-01 (atestación): [spec/DCP-01.md](../spec/DCP-01.md)
- Almacenamiento, anclaje, revocación: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Arquitectura técnica: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
