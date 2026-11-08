<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · [中文](../../../zh-CN/docs/conformance/SECURITY_COVERAGE.md) · **Español** · [日本語](../../../ja/docs/conformance/SECURITY_COVERAGE.md) · [Português](../../../pt-BR/docs/conformance/SECURITY_COVERAGE.md)</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# Garantías de seguridad y cobertura de conformidad

> Traducción informativa de [la versión en inglés](../../../../docs/conformance/SECURITY_COVERAGE.md), actualizada el 08/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este mapa informativo relaciona los requisitos normativos con las pruebas ejecutables del repositorio. No es un perfil nuevo, una certificación, una afirmación de que se han probado todas las entradas ni evidencia de que un despliegue concreto haya aprobado. Cada resultado corresponde a la implementación, entradas, política, instante de verificación y versión de la herramienta exactos registrados en esa ejecución.

La [lista de verificación](../../spec/VERIFICATION.md), el [perfil de canonicalización](../../spec/CANONICALIZATION_PROFILE.md) y el [perfil de admisión](../../spec/profiles/admission/README.md) siguen siendo la autoridad. Tanto una implementación de referencia como el kit de pruebas pueden contener defectos. Resuelve las discrepancias frente a la especificación y un caso reproducible; el acuerdo entre implementaciones no determina la corrección.

<a id="what-the-guarantees-mean"></a>

## Qué significan las garantías

| Capa | Qué acreditan sus comprobaciones | Qué no acreditan |
|---|---|---|
| Esquema | La entrada tiene la estructura y los valores permitidos | Firmas válidas, afirmaciones honestas, identidad del principal o autorización |
| Verificación criptográfica | Las firmas, hashes y relaciones comprobadas satisfacen las reglas aplicables para las claves, política e instante suministrados | Que se confíe en el principal nombrado, que un evento registrado haya ocurrido o que una herramienta pueda ejecutarse |
| Confianza en el principal | Los componentes verificados de la firma del principal coinciden con el conjunto de confianza suministrado fuera de banda por el operador | Identidad más allá de esa fuente de confianza o permiso para realizar una acción |
| Admisión `strict-v1` | La verificación, la confianza en el principal, las restricciones firmadas de audiencia y sesión y un estado de revocación suficientemente reciente satisfacen el perfil | Uso único, revocaciones posteriores a la instantánea o autorización de acciones |
| Aplicación por el adaptador | La integración aplica la decisión de admisión del operador antes de su handler protegido | Una propiedad que suministre el protocolo central o acredite el kit externo de conformidad |

`action_authorized` permanece en `false`. Un registro verificado o admitido de una acción bloqueada o escalada es evidencia de esa decisión registrada, no permiso para ejecutarla. El vínculo de sesión impide combinar sesiones inconsistentes; no consume el bundle ni lo convierte en un objeto de un solo uso.

<a id="reading-the-evidence"></a>

## Cómo leer la evidencia

El [README del kit](../../tools/conformance/README.md) define los comandos, contratos, campos de informe y códigos de salida. Sus superficies son diferentes:

- **Referencia:** `tools/conformance.js` llama a helpers de referencia y a `lib/verify.js`; este último valida el esquema V2 y delega la verificación criptográfica en TypeScript.
- **Primitivas externas:** el contrato `/1` ejercita canonicalización y resúmenes criptográficos mediante una implementación suministrada.
- **Evidencia externa:** el contrato `/2` ejercita raíces Merkle, firmas compuestas y verificación de bundles V2. El repositorio ofrece wrappers TypeScript, Python, Go, Rust y WASM.
- **Admisión externa:** el contrato `/3` ejercita admisión combinada y carga de configuración. El repositorio ofrece wrappers TypeScript, Python, Go y Rust; WASM no tiene API de admisión.
- **Delegación externa:** el contrato `/4` ejercita veredictos de cadenas de mandatos de DCP-09 §3.5.2. El repositorio ofrece wrappers TypeScript, Python, Go y Rust; WASM no tiene API de cadenas de mandatos.
- **Política efectiva externa:** el contrato `/5` (opt-in) ejercita la verificación de bundles V2 con el modo de verificación y el tier de seguridad que el verificador resolvió en esa misma verificación. El repositorio ofrece wrappers TypeScript, Python, Go, Rust y WASM.
- **Suites de SDK y adaptadores:** son pruebas separadas, con sus propias entradas y alcances. Que un elemento figure en el inventario del kit no significa que el kit lo ejecute.

Los contratos numerados son interfaces del ejecutor, no versiones del protocolo DCP. La identidad del wrapper es autodeclarada. Cinco wrappers no son cinco adoptantes externos independientes: WASM comparte código con Rust y todos estos wrappers pertenecen al repositorio.

Un resultado negativo solo es útil con un control positivo que funcione. Cambiar contenido firmado sin actualizar su firma puede causar el rechazo por varios motivos. Una etiqueta `spec_step` o un mensaje de error coincidente no demuestran por sí solos qué comprobación causó el rechazo. Los pares válidos e inválidos que aíslan una regla aportan evidencia más fuerte que bundles rechazados construidos por separado y con solo un control positivo de suite.

<a id="v2-verification-map"></a>

## Mapa de verificación V2

Los nombres siguientes corresponden a los [vectores de bundles](../../../../tests/interop/v2/bundle_vectors.json). `M`, `R` y `A` significan `must_reject`, `must_reject_bundles` y `must_accept_bundles`; los IDs externos tienen el prefijo `external.v2.bundle_vectors.`, seguido de `must_reject`, `must_reject_bundles` o `must_accept`, respectivamente, y después el nombre del caso. `signed_bundle` es el positivo base. Son muestras seleccionadas y trazables, no una lista exhaustiva ni una calificación de completitud.

| Regla normativa | Casos o suite existentes seleccionados | Alcance y límites restantes |
|---|---|---|
| V2-1: seleccionar la versión | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | Rechazo en la entrada V2; no ejercita todos los requisitos V1 |
| V2-2: validar esquemas del sobre y artefactos | Referencia `v2.signed_bundle.schema_invalid_payload_rejected`; suites de esquemas; el catálogo opcional de validación de esquemas (57 casos) | Los verificadores de los SDK ejecutan V2-2 por sí mismos desde `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0 y Rust `dcp-ai` 2.13.0; las versiones anteriores no. Véase el límite más abajo |
| V2-3: manifiesto, hashes de payload y vínculo de auditoría | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | Muestras del vínculo de hashes y cadena; no cobertura aislada de cada campo y forma malformada |
| V2-4: sesión, tiempo y consistencia de metadatos no firmados | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | Pruebas con instante fijo; hay que distinguir política solicitada y modo efectivo |
| V2-5: estructura de firmas y codificación canónica | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | Las muestras de codificación no cubren todas las ubicaciones de firma ni combinaciones de defectos |
| V2-6: el principal firma el manifiesto | R `bundle_signed_by_agent_keys`; referencia `v2.signed_bundle.forged_classical_signature_rejected` | Muestras de firmas y vínculo de roles; no establecen confianza en un principal autodeclarado |
| V2-7: verificar firmas PQ presentes | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | El catálogo histórico de evidencia las ejecuta con su política seleccionada; afirmar todos los modos efectivos exige sus controles correspondientes |
| V2-8: verificar cada artefacto con su contexto y rol firmante | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | Muestras de artefactos y roles; no todas las combinaciones de componente, contexto y clave |
| V2-9: derivar el nivel sin que una declaración pueda reducirlo | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | Muestras de veredictos; la operación de bundle de `/2` no evalúa el nivel resuelto informado; el catálogo de política efectiva de `/5` sí lo evalúa |
| V2-10: exigir el modo efectivo y la política de algoritmos | R `classical_only_payment_from_low_risk_passport`; `classical_only_routine` en cuatro modos | Muestras de modos; el catálogo histórico de evidencia no tiene una matriz específica de listas de algoritmos permitidos y advisories |
| V2-11: verificar campos secundarios presentes | `external.v2.secondary_sha3`, de los [vectores secundarios](../../../../tests/interop/v2/secondary_sha3_vectors.json) | Controles positivos y campos malformados o no coincidentes; los enlaces ausentes son opcionales, así que aceptar no implica una cadena secundaria completa |
| V2-12: vincular y verificar checkpoints | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | Muestras de pertenencia, rango y firmas; no todas las combinaciones de rangos o componentes malformados |
| V2-13: derivar IDs de clave y exigir su validez | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | Muestras de clave, codificación y estado; no cobertura exhaustiva de políticas de claves |
| V2-14: consistencia entre artefactos | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | La consistencia de evidencia es distinta del permiso para actuar |

Las expectativas del corpus deben interpretarse con su política declarada, ajustes por caso e instante de verificación. Un bundle híbrido positivo puede verificar bajo `pq_only`; que contenga los bytes clásicos necesarios para el vínculo no lo convierte en un control negativo. Una política solicitada `classical_only` puede resolverse a un modo efectivo más estricto por el nivel de la acción.

<a id="schema-and-cryptographic-api-boundary"></a>

### Límite entre esquema y API criptográfica

V2-2 exige validación de esquemas. Desde `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0 y Rust `dcp-ai` 2.13.0, los verificadores V2 de los SDK TypeScript, Python, Go, Rust y WASM la ejecutan por sí mismos: `verifySignedBundleV2` y sus equivalentes, la API combinada de admisión, que verifica primero, y el verificador experimental del candidato; evaluar la admisión a partir de un resultado de verificación anterior no la vuelve a ejecutar. Las versiones anteriores de los SDK no la incluyen. La puerta valida el sobre del bundle firmado y los cuatro payloads (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) contra `schemas/v2`. Se ejecuta después de las comprobaciones de política y reloj del verificador, y antes de que el verificador compruebe el manifiesto, los hashes de los payloads, las claves y las firmas. Todos los SDK interpretan la misma representación generada a partir de `schemas/v2` (`tools/schema-ir/`); la CI la regenera y compara las copias.

- **Objetos cerrados y abiertos.** Un miembro desconocido de un objeto cerrado (`additionalProperties: false`, por ejemplo el sobre, `SignedPayload`, `composite_sig`, las entradas de auditoría y los checkpoints) se rechaza aunque los hashes y las firmas sigan siendo válidos. En un objeto abierto, como el `target` del intent o la `evidence` de auditoría, los miembros declarados conservan sus restricciones (`target.channel`, por ejemplo, es obligatorio y enumerado); solo los miembros adicionales que el esquema no describe quedan sin inspeccionar en esta capa, y los que están bajo un compromiso pueden llegar a la canonicalización. Un miembro adicional del propio objeto `bundle` se acepta: el esquema deja `bundle` abierto, el miembro no está bajo ningún compromiso (a diferencia de los artefactos firmados y del manifiesto que contiene el bundle) y ninguna comprobación posterior lo lee.
- **Ausente y `null`.** Se rechazan tanto un miembro obligatorio ausente como un `null` donde el esquema espera otro tipo, con diagnósticos distintos (`required`, `type`). `session_issued_at` y `session_expires_at` del manifiesto deben ser cadenas cuando están presentes: `null` se rechaza.
- **Diagnósticos.** Un fallo de esquema devuelve `verified: false` con errores de la forma `schema: <JSON pointer> <keyword>[ <member>]`, como mucho 16 seguidos de `schema: further errors not listed`, nunca con valores de la entrada y sin detalles criptográficos. Un rechazo que antes informaba una comprobación más profunda puede llevar ahora un diagnóstico de esquema; un fallo de esquema no demuestra que la comprobación profunda se ejecutara.
- **Superposición del candidato.** En la ruta experimental `dcp-jcs-v2`, que quien llama selecciona explícitamente, la única diferencia es el `canonicalization_profile` del manifiesto, que debe ser `dcp-jcs-v2`. El perfil por defecto y los bytes firmados no cambian.
- **`date-time`.** La comprobación de formato es la que aplica el verificador de referencia, ajv-formats 3.0.1 en modo full, con sus particularidades: cualquier espacio en blanco ECMAScript o `t` como separador, offsets `+hh` y `+hhmm`, y un segundo 60 cuando la hora trasladada por su offset es 23:59. Es una frontera de compatibilidad de la capa de esquema, no RFC 3339 estricto. Los parsers temporales de V2-4, V2-13 y V2-14 siguen siendo una capa aparte y posterior, y todavía pueden rechazar una hora que el esquema acepta.
- **Los parsers van primero.** Lo que rechaza un parser JSON nunca llega a V2-2. Go informa una raíz que no es un objeto con su error de parseo histórico; la API de Rust recibe un `serde_json::Value` ya parseado, así que los rechazos de serde_json (un surrogado solitario, `1e400`) corresponden a quien llama; el binding WASM conserva antes de V2-2 su error de parseo de la política, `JSON parse error` y la detección de versión.
- **Cambio de aceptación.** Los bundles inválidos por esquema que antes aceptaban los verificadores de los SDK devuelven ahora `verified: false`. No se añade ninguna API solo de esquema, y no cambia ningún esquema ni perfil.

Quien declare cumplir toda la lista V2 debe cubrir V2-2 además de las comprobaciones criptográficas. No debilites el esquema ni describas una API parcial como una validación completa para conseguir que pase una prueba. El kit informa esas capas por separado.

Los miembros desconocidos no están prohibidos universalmente. Algunos objetos del esquema son abiertos. Que el esquema acepte una extensión en un objeto firmado no conserva su firma anterior: al cambiar contenido firmado hay que recalcular hashes y firmas. Aquí no se define ningún mecanismo nuevo de extensiones obligatorias.

El [catálogo de validación de esquemas](../../../../tools/conformance/external-schema-validation-catalog.json), de uso explícito, ejecuta 57 casos firmados sobre una implementación: 13 positivos y 44 negativos, cada uno de los cuales cuenta solo cuando el caso base verifica en la misma ejecución. La CI lo ejecuta con los cinco wrappers de SDK. El [catálogo diagnóstico de esquemas](../../../../tools/conformance/external-schema-catalog.json), de uso explícito, conserva 15 casos de cierre: la base y las extensiones permitidas son controles positivos; las extensiones de objetos cerrados y los valores fuera de una enumeración conservan el rechazo normativo. Un caso SDK fallido sigue siendo un fallo, y superar cualquiera de los dos catálogos cubre solo sus casos. El informe separado de `tools/conformance/schema-boundary.js` distingue validación de esquemas, integridad del corpus finito y composición de esquema con SDK en el instante del corpus. Esa composición no acredita que el SDK solo implemente V2-2, y el helper de integridad no es un verificador normativo general.

<a id="verifier-policy-samples"></a>

### Muestras de política del verificador

El [catálogo de políticas](../../../../tools/conformance/external-policy-catalog.json), de selección explícita, versión 2.0, añade 108 casos en dos suites mediante el contrato `/2` existente. La primera suite mantiene los 74 casos de la versión 1.1: 10 controles positivos, 24 casos de PQ presente inválida, 14 casos de listas de algoritmos y advisories y 26 casos de tier ya versionados. La segunda ejecuta los 34 casos de la aclaración de V2-10 (abajo). Cada solicitud lleva su política e instante de verificación exactos. El catálogo de evidencia predeterminado no cambia, y la versión 1.1 está archivada byte a byte como [`external-policy-catalog-1.1.json`](../../../../tools/conformance/external-policy-catalog-1.1.json).

El nuevo control híbrido de tier routine ejercita `classical_only` efectivo y los otros tres modos. El control híbrido de tier standard eleva una solicitud `classical_only` a `hybrid_preferred`. El corpus registra esta derivación; `/2` evalúa el veredicto, no el tier ni el modo efectivo que reporte la implementación. El catálogo opt-in de política efectiva (más abajo) los evalúa con el contrato `/5`.

Los negativos PQ alteran solo la firma PQ del bundle, pasaporte o checkpoint; el componente clásico sigue siendo válido. Los casos de listas de algoritmos mantienen el mismo bundle y cambian únicamente la política. Los casos de tier reutilizan bundles versionados firmados por separado y un control routine bajo el mismo modo solicitado: no son gemelos de un solo cambio. Cada negativo exige que su control positivo pase en la misma ejecución.

La aclaración del paso V2-10 de [VERIFICATION.md](../../../../spec/VERIFICATION.md) (05/11/2026) resuelve las tres preguntas del corpus. [`verifier_policy_clarification_vectors.json`](../../../../tests/interop/v2/verifier_policy_clarification_vectors.json) contiene sus casos, con bases routine para que cada modo solicitado sea el efectivo:

- **Q1.** Bajo `pq_only`, las exclusiones de listas y advisories clásicos aceptan un bundle híbrido; bajo `hybrid_required` las mismas políticas lo rechazan.
- **Q2.** En la firma del bundle, el pasaporte y el checkpoint, un componente clásico que falla mientras el componente PQ verifica sobre esos bytes clásicos se acepta bajo `pq_only` y se rechaza en los otros tres modos. Un `sig_b64` clásico no canónico y un kid clásico desconocido se rechazan bajo `pq_only`.
- **Q3.** Las exclusiones de listas y advisories PQ aceptan el bundle solo clásico bajo `classical_only` y `hybrid_preferred`, y rechazan el bundle híbrido bajo la misma política.

`verifier_policy_vectors.json` conserva como historia sus casos Q1 omitidos. Los casos son una muestra de estas reglas: no cubren todas las ubicaciones, algoritmos o estados de clave. Una combinación no probada no demuestra por sí sola una contradicción en la especificación. Son muestras de política: la validación de esquemas (V2-2) tiene su propio catálogo y se ejecuta dentro de los verificadores de los SDK desde las versiones del 05/11/2026, no en las anteriores. Las muestras no establecen conformidad V2 completa.

<a id="structural-samples"></a>

### Muestras estructurales

El [catálogo estructural](../../../../tools/conformance/external-structural-catalog.json), de selección explícita, añade 16 casos mediante `/2`: dos controles positivos y 14 negativos sobre codificación de firmas, componentes y rangos de checkpoints, compromisos del manifiesto, un payload con fracción, orden temporal de sesión y una firma clásica del bundle invalidada con su firma PQ recalculada correctamente. El modo efectivo es `hybrid_preferred`; estos negativos clásicos no afirman nada sobre `pq_only`.

Los cuatro casos de codificación conservan los bytes decodificados de la firma. Los rangos de checkpoints usan posiciones reales de la traza, con identificadores deliberadamente desordenados. Las mutaciones del manifiesto se vuelven a firmar. La sesión invertida tiene un gemelo positivo separado dentro de la tolerancia de reloj. Cada negativo exige que sus controles pasen en la misma ejecución.

El aislamiento tiene límites explícitos: una fracción no tiene representación `dcp-jcs-v1`, por lo que sus hashes y firmas anteriores quedan obsoletos; un rango invertido no tiene una raíz válida para ese rango. Las comprobaciones de componentes documentan los defectos previstos, pero no identifican qué comprobación del SDK causó el rechazo. Son muestras estructurales: la validación de esquemas (V2-2) tiene su propio catálogo y se ejecuta dentro de los verificadores de los SDK desde las versiones del 05/11/2026, no en las anteriores. Las muestras no prueban conformidad completa.

<a id="effective-mode-and-tier"></a>

### Modo y tier efectivos

El [catálogo de política efectiva](../../../../tools/conformance/external-effective-policy-catalog.json), opt-in, ejecuta 130 casos con el contrato `/5`: el veredicto, y el modo de verificación y el tier de seguridad que el verificador de la implementación resolvió en esa misma verificación, tal como se devuelven y sin que el kit los recalcule nunca. 112 casos exigen ambos valores: los 94 casos de política del verificador y de la aclaración cuyos bundles pasan V2-2, 17 casos firmados que añaden positivos válidos en los tiers elevated y maximum bajo cada modo solicitado, fronteras de `risk_score`, suelos de `security_tier` explícito y declarado y overrides del pasaporte que sustituyen al valor por defecto, y un control. En 14 casos cuyos bundles fallan V2-2, y en 4 rechazos anteriores, los valores pueden faltar; los valores informados deben seguir siendo conocidos y coherentes. Los SDK difieren en si resuelven los valores después de un fallo anterior, y ambas conductas se admiten. Implementaciones controladas muestran que el juez hace fallar a un wrapper que informa el modo solicitado o el modo por defecto, solo el suelo del tier, un tier declarado o el `resolved_tier` de la decisión de política. No se cubren el suelo de la cadena DCP-09, la API JavaScript de `@dcp-ai/wasm` ni los navegadores, y un pase cubre solo estos casos.

<a id="admission-map"></a>

## Mapa de admisión

Los [vectores compartidos de admisión](../../../../tests/interop/v2/admission_vectors.json) y el [catálogo externo de admisión](../../../../tools/conformance/external-admission-catalog.json) ejercitan los siguientes grupos mediante la API de admisión combinada y los cargadores de configuración. Lee la `rule`, las entradas y los campos esperados exactos de cada caso; el nombre del grupo no prueba cobertura exhaustiva.

| Requisito | Superficie ejercitada | Límite |
|---|---|---|
| T1–T2: principal y claves de componentes anclados en la confianza del operador | `external.admission.outcomes` | La confianza se suministra fuera de banda; el kit no establece una identidad del mundo real |
| P1–P4: V2, audiencia firmada, ventana de sesión firmada y firmas híbridas del principal | Resultados y casos compuestos | Las comprobaciones estructurales y verificadas son distintas; no se enumeran todas las combinaciones de valores malformados |
| R1–R5: disponibilidad, forma y antigüedad de instantáneas, y estado del sujeto | Resultados | Una instantánea reciente no acredita eventos de revocación posteriores a su `checked_at` |
| Configuración: rechazar campos desconocidos, confianza malformada y debilitamiento del perfil | `external.admission.config` | Los casos con varios defectos pueden permitir más de un error normativo; el texto incidental del mensaje no es la regla |
| Procedimiento combinado y resultado | Resultados y casos compuestos | Se evalúan `action_authorized:false`, decisiones registradas y resultados de confianza y perfil; no se compara directamente la salida completa de `signer_keys` |
| A1–A3: handler protegido, configuración del operador, fuentes, tenant y caché | Pruebas separadas de adaptadores | Fuera de este kit externo; un resultado SDK no prueba la aplicación efectiva por la integración |

Un evaluador que acepta un resultado de verificación precalculado confía en que quien lo llama suministra el resultado del mismo bundle, política e instante. La operación externa de admisión usa la API combinada. Que una prueba combinada pase no hace seguro cualquier objeto de verificación suministrado por un llamador.

<a id="delegation-map"></a>

## Mapa de delegación

El [catálogo externo de delegación](../../../../tools/conformance/external-delegation-catalog.json), versión 2.0.0, ejecuta los vectores versionados de [cadenas de mandatos](../../../../tests/interop/v2/mandate_chain_vectors.json), [tiempos de cadena](../../../../tests/interop/v2/mandate_chain_time_vectors.json) y [dominios repetidos](../../../../tests/interop/v2/mandate_domain_vectors.json) mediante `verify_mandate_chain`. Cada caso normativo nombra su regla de [DCP-09 §3.5.2](../../../../spec/DCP-09.md); se juzgan el veredicto y, para una cadena aceptada, el nivel efectivo.

| Requisito | Superficie ejercitada | Límite |
|---|---|---|
| Reglas 1–2: firmas de raíz y submandato, roles y contextos de los firmantes, enlaces con el padre, profundidad y `human_id` | `external.delegation.chain` | Las claves se dan en la petición; el kit no establece que sean las del principal o de los agentes |
| Regla 3: permiso de subdelegación y profundidad máxima | `external.delegation.chain` | Las cadenas versionadas, no todas las profundidades |
| Regla 4: ventanas de validez, su anidamiento y la hora de verificación como instantes RFC 3339, comparados en milisegundos | `external.delegation.chain`, `external.delegation.chain_time` | La precisión de milisegundos es normativa desde la aclaración de §3.5.2 (05/11/2026); la versión 1.0.0 del catálogo, archivada, mantenía informativos esos tres casos |
| Reglas 1–2: cada clave firmante activa, con su `expires_at` ausente, `null` o no anterior a la hora de verificación (aclaración del 05/11/2026) | `external.delegation.chain_time` | Siete casos sobre `expires_at`; ningún caso tiene una clave cuyo `status` no sea `active`. La versión 1.0.0 mantenía informativos estos siete |
| Regla 5: atenuación de acciones, clases de datos y límites; límites dentro de ±(2^53 − 1); un dominio repetido en un mismo mandato | `external.delegation.chain`, `external.delegation.domains` | Los textos de error son diagnósticos; un rechazo se juzga por su veredicto |
| Regla 6: nivel mínimo y nivel efectivo | `external.delegation.chain` | El nivel efectivo se juzga en las cadenas aceptadas; `tier_floor` (`computeSecurityTier`) queda fuera del catálogo |
| Regla 7: revocación de la raíz o de un mandato intermedio | `external.delegation.chain` | La revocación es el conjunto local de ids revocados de la petición, no una fuente de revocación |

Un rechazo cuenta solo con su control, una cadena aceptada normativa cuya relación con él (`same_chain`, `single_mandate`, `same_shape` o `suite`) se comprueba sobre los bytes. Ninguna de esas relaciones muestra que los dos casos difieran en un único defecto. Una cadena verificada no es admisión ni autorización.

La versión 1.0.0 del catálogo, archivada byte a byte como [`external-delegation-catalog-1.0.0.json`](../../../../tools/conformance/external-delegation-catalog-1.0.0.json), juzga 87 casos e informa aparte de diez informativos; la versión 2.0.0 juzga los 97. El runner fija la clasificación de cada versión, así que un informe 1.0.0 es evidencia solo de la 1.0.0.

<a id="differential-samples"></a>

### Muestras diferenciales

Los [arneses diferenciales](../../../../tools/difffuzz/README.md) comparan los SDK sobre los mismos bytes; el acuerdo nunca es el oráculo.

- **Cadenas de mandatos.** `run-mandates.mjs` envía cadenas DCP-09 re-firmadas a los cuatro verificadores de cadenas mediante el contrato `/4`: cada ejecución cubre 73 variantes en cada profundidad a la que se aplican (167 casos) y después mutantes aleatorios acotados. Solo los casos anclados en §3.5.2, el perfil de canonicalización o RFC 8259 cuentan como evidencia de regla. Las observaciones y los casos cuya atribución limita un valor no firmable o la representación numérica se informan aparte; un desacuerdo entre ellos sigue siendo un hallazgo.
- **Bundles con WASM.** `run.mjs --sdks five` añade a los cuatro verificadores de bundles el SDK de Rust compilado a WASM, ejecutado por Node. Los hallazgos de cuatro SDK nunca se leen como evidencia de cinco.

Una campaña finita muestra que estos casos coinciden o registra dónde no; no es exhaustiva. WASM no verifica cadenas de mandatos, y las entradas que el contrato `/4` no lleva a todos los SDK (un token `NaN`, una marca de orden de bytes, `1e400`) se miden con una sonda de transporte aparte: la negativa de un wrapper nunca cuenta como rechazo del SDK, y el rechazo que devuelven los SDK de TypeScript y Python ante `1e400` no acredita ninguna regla semántica.

<a id="local-source-additions-07112026"></a>

## Añadidos del código fuente local (07/11/2026)

Estas filas describen el código fuente local de los SDK de TypeScript, Python, Go y Rust, no un paquete publicado. Cada una se
ejercita con vectores compartidos que ejecutan las cuatro suites de los SDK; el kit externo todavía no tiene un contrato para
ellas, así que un resultado del kit no dice nada sobre estas reglas. Ninguna es una afirmación de conformidad completa ni
de preparación empresarial.

**Superficies opcionales.** Solo las usa el código que las llama.

| Requisito | Superficie ejercitada | Límite |
|---|---|---|
| Admisión delegada ([perfil de admisión § 10](../../../../spec/profiles/admission/README.md#10-delegated-admission-opt-in)) | [`delegated_admission_vectors.json`](../../../../tests/interop/v2/delegated_admission_vectors.json): 71 casos y 6 casos de configuración | Se comprueba solo en `now`; `delegation_active` y `action_authorized` son `false`; sin API en WASM |
| Admisión desde bytes (§ 11) | [`v1_ingress_vectors.json`](../../../../tests/interop/v2/v1_ingress_vectors.json): 26 casos y 30 diferencias de dominio | Los presupuestos de tamaño y de tiempo quedan fuera; las funciones sobre valores ya analizados no pueden recuperar lo que su parser perdió |
| Acuse de mandato y activación ([DCP-09 § 3.3.1](../../../../spec/DCP-09.md#331-mandate-acknowledgment-opt-in), § 12) | [`mandate_acknowledgment_vectors.json`](../../../../tests/interop/v2/mandate_acknowledgment_vectors.json): 93 casos en TypeScript y Python; 89 en Go y Rust, que excluyen explícitamente los 4 casos cuyos contenedores no son listas, porque su API tipada no puede llevarlos | Declaraciones firmadas, no prueba de cronología ni de comprensión; sin autorización; sin comprobación global contra la reproducción; sin activación desde bytes; sin API en WASM |

**Verificación Ed25519 (perfil criptográfico).** Se aplica a toda firma Ed25519 que comprueban los verificadores de los SDK.

| Requisito | Superficie ejercitada | Límite |
|---|---|---|
| [P-ED-1](../../../../spec/profiles/crypto/README.md#p-ed-1-ed25519-acceptance-criterion) en objetos V1 y en el proveedor V2 por defecto | [`ed25519_ped1_vectors.json`](../../../../tests/interop/v2/ed25519_ped1_vectors.json) y su comprobador, en las cuatro suites de los SDK; el proveedor de Rust ejecutado en `wasm32` | Desde el 08/11/2026, también el verificador de referencia, la ruta V1 de la CLI y el playground, y WASM en Node y en Chrome: ver [Interfaces públicas](#public-interfaces-mp-03-08112026), que indica quién lo hereda de un SDK instalado. Un proveedor propio es responsabilidad del operador |

<a id="public-interfaces-mp-03-08112026"></a>

## Interfaces públicas (MP-03, 08/11/2026)

Esta sección también describe el código fuente local, no paquetes publicados. Para cada capacidad nombra la función
pública por la que pasa y la evidencia que la alcanza en ella.

- **WASM** es la clase `DcpWasm` de `@dcp-ai/wasm`.
- **Crudo** se refiere a sus exports de wasm-bindgen (`@dcp-ai/wasm/pkg`), ejecutados en Node.
- Las corridas en **Chrome** pasan por el [wrapper de navegador](../../tools/conformance/README.md#browser-wrapper-dcpwasm-in-chrome) del kit.

| Capacidad | TypeScript, Python, Go, Rust | WASM | No se afirma |
|---|---|---|---|
| Bytes canónicos `dcp-jcs-v1` y digests | Kit `/1` (38) | `/1` en crudo (38). En Chrome, `/1` (38): la canonicalización por `DcpWasm.canonicalize` después de `JSON.parse`, los digests por `dualHash` y `sha3_256` sobre el texto | Bytes que un parser ya cambió (ver la tabla de parsing más abajo) |
| Verificación V2: bundles, raíces Merkle, firmas compuestas | Kit `/2` (241: 211 casos de bundle, 24 compuestos y 6 Merkle), política (108), estructura (16), esquema (57), `/5` (130) | Los mismos catálogos en crudo (552 casos; 590 con `/1`). En Chrome, cada uno por su propio método de `DcpWasm`: los bundles por `verifyBundle`, los casos compuestos por `compositeVerify`, los casos Merkle por `dualMerkleRoot` | Admisión, confianza, autorización |
| Firmas compuestas, separación de dominio, nivel de seguridad | Casos compuestos del kit `/2` (24); vectores de interop en las suites de los SDK | Llamadas directas en Chrome (103): `domainSeparatedMessage` 20 (los 19 contextos de los vectores de interop y `MandateAcknowledgment`), `computeSecurityTier` 79, 2 ciclos híbridos de firma y verificación con negativos de payload, contexto y firma, y las 2 preimágenes compuestas de P-ED-1 | `/5` no ejercita `computeSecurityTier`: lee el modo y el nivel que informa `verifyBundle` |
| P-ED-1 | El corpus en las cuatro suites de los SDK | El proveedor de Rust en `wasm32` sobre Node: 67 casos de proveedor, 4 objetos V1 y 2 casos compuestos con una clave ML-DSA-65 real. En Chrome: las 2 preimágenes compuestas a través de `compositeVerify`, con un binding `classical_only` | El corpus completo a través de `DcpWasm`, que no tiene un método Ed25519 crudo |
| Admisión `strict-v1` | Kit `/3` (140) | Sin soporte | — |
| Cadenas de mandatos | Kit `/4` (97) | Sin soporte | — |
| Admisión delegada, admisión desde bytes, activación | Las suites de los SDK de arriba, y los errores de configuración de las funciones de bytes y de activación | Sin soporte | Un contrato del kit |

WASM no tiene API de cadenas de mandatos, de admisión ni de activación. Es el alcance del piloto (D-04), no un límite
de los navegadores: el backend de una aplicación de navegador comprueba las delegaciones y admite con uno de los cuatro
SDK. Una admisión calculada en un navegador a partir de entradas que controla el cliente no autoriza nada en un
servidor.

**P-ED-1 fuera de los SDK.** Un verificador que calcula Ed25519 él mismo con TweetNaCl comprueba primero P-ED-1. Usa
una de tres copias idénticas de un helper de bytes: `tools/`, `cli/lib/` y `playground/js/core/ed25519-ped1.js`. Todos
los demás verificadores obtienen P-ED-1 solo del SDK que cargan.

| Verificador | Ruta Ed25519 | P-ED-1 |
|---|---|---|
| V1 de referencia (`verifyObject` de `tools/crypto.js`): V1 de `lib/verify.js` y `bin/dcp.js`, gossip del transparency log, servicio de revocación | Su propia comprobación y después TweetNaCl | En el código fuente; `tools/ed25519-ped1-consumers.test.mjs` |
| `dcp-ai verify` sobre ficheros V1 | Su propia comprobación (`cli/lib/ed25519-ped1.js`) | En el código fuente; no en el `@dcp-ai/cli` publicado |
| `dcp-ai verify` sobre ficheros V2, V2 de referencia, servidor | El `@dcp-ai/sdk` instalado | Solo con un SDK que lo tenga. La CI compila e instala el SDK del workspace. Ningún `@dcp-ai/sdk` publicado lo tiene (2.3.0 y anteriores), ni las copias instaladas a partir de ellos |
| Playground (una demo cuyas firmas PQ son simuladas) | Su propia comprobación | En el código fuente |
| Express, OpenClaw | `@dcp-ai/sdk` fijado en 2.2.0 | No con el lock; la CI también ejecuta sus pruebas con el SDK del workspace |
| Anthropic MCP, Google A2A | `@dcp-ai/sdk` fijado en 2.2.0 | No se aplica (un límite registrado) |
| FastAPI, LangChain, OpenAI, CrewAI | El SDK de Python de este árbol | Se aplica |

**Errores, rechazos y resultados ausentes.** Cada función pública conserva su propio contrato de errores; ninguno se
normaliza. P-ED-1 solo rechaza entradas que superaron las comprobaciones previas de tipo, tamaño y decodificación de la
función: lo que era un error sigue siéndolo. En el kit y en el arnés de navegador, un `error`, `unsupported`, un caso
ausente, una caída o un plazo vencido nunca satisfacen un rechazo esperado.

| Función | Rechazado | Error |
|---|---|---|
| Proveedor Ed25519, `verifyObject` de V1 (SDK, referencia, CLI, playground) | `false`: S >= L, P-ED-1 o la ecuación | Cada uno el suyo, y base64 inválido solo donde la función decodifica base64 (la clave de un proveedor, la firma y la clave de `verifyObject`). TypeScript y el verificador de referencia lanzan un error ante base64 inválido y ante una firma o una clave decodificadas de tamaño incorrecto; el `verifyDetached` del playground recibe bytes y lanza un error ante un tamaño incorrecto o un valor que no es un `Uint8Array`. Python lanza el `ValueError` de PyNaCl ante un tamaño incorrecto. Go devuelve `false` ante una longitud de firma incorrecta y un error ante una longitud de clave incorrecta. Rust devuelve errores ante cualquiera de las dos longitudes y ante una clave que no se descomprime. La CLI sale con 1 ante INVALID y ante errores, y con 0 solo ante VALID |
| `compositeVerify` | `valid: false`, con el veredicto de cada componente | La falta de firma PQ con `pq_over_classical` es un error en Rust y a través de WASM; TypeScript, Python y Go devuelven booleanos |
| Verificación de bundles | `verified: false` con diagnósticos, también para entradas malformadas | El `verifyBundle` de WASM informa igual de sus propios errores de parseo del JSON y de la política |
| Admisión `strict-v1` (`admitSignedBundleV2`) | `admitted: false` y códigos; `action_authorized` es siempre `false` | `AdmissionConfigError` (en Go, `*AdmissionConfigError`). Un perfil inválido, o un perfil pasado junto con una política de verificador, se rechaza antes de verificar el bundle. Dónde se detectan los demás errores de configuración depende del SDK: un perfil sin trust set, por ejemplo, durante la admisión después de la verificación en TypeScript (`evaluateAdmissionV2`), y antes de ella en Rust. En cualquier caso, un error y ningún resultado |
| Admisión delegada, activación | Admisión delegada: `admitted: false` y códigos. Activación: `composition` (el resultado de la admisión delegada), `activation`, `delegation_active` y los códigos `ACK_*`. `action_authorized` es siempre `false` | `AdmissionConfigError` ante una configuración del operador inválida, antes de leer ninguna evidencia |
| Admisión desde bytes | El rechazo del ingreso es un resultado: `ingress.accepted: false`, con su capa y su clase, y sin admisión | Decide primero el ingreso, y los bytes aceptados se admiten después como en `admitSignedBundleV2`, con sus errores de configuración (en Rust, `IngressError::Config`). Una entrada que no son bytes es un `TypeError` en TypeScript y Python |
| Métodos de `DcpWasm` | Según lo informa el binding | `Error('<method>: …')`. `canonicalize` lee el `wasm_canonicalize_v2_result` etiquetado; `hashObject` y `deriveKid` solo devuelven su formato hexadecimal. Los exports crudos mantienen `{"error": …}` en banda, y `wasm_canonicalize_v2` no puede distinguirlo de un valor cuya forma canónica es ese objeto |

Las pruebas que respaldan esta tabla:

- las pruebas del corpus P-ED-1 de cada SDK;
- `sdks/wasm/test/interface-errors.mjs` y `sdks/wasm/test/schema-v2.mjs`;
- las pruebas de errores de configuración `e5-config-errors.test.ts`, `test_e5_config_errors.py`, `e5_config_errors_test.go` y
  `tests/e5_config_errors.rs`.

**Quién parsea.** Ninguna función repara la entrada de otra: cada una lee lo que produjo su parser.

| Función | Parser | Comprobaciones antes del parser |
|---|---|---|
| `verifySignedBundleV2`, `admitSignedBundleV2` y sus equivalentes de Python y Rust | El de quien llama (`JSON.parse`, `json.loads`, `serde_json`) | Ninguna |
| `VerifySignedBundleV2At` y `AdmitSignedBundleV2` de Go | El `encoding/json` del SDK, sobre `[]byte` | Ninguna: recibir bytes no es el ingreso de la [admisión § 11](../../../../spec/profiles/admission/README.md#11-admission-from-bytes-opt-in) |
| La función de admisión `FromBytes` de cada SDK | El SDK | El ingreso: escáner, dominio portable y después la comparación del parser, antes de la admisión |
| Métodos de `DcpWasm` | El `JSON.parse` de quien llama, y después `serde_json` sobre lo que escribe `JSON.stringify` | Ninguna, y ninguna es posible: el valor de JavaScript ya está parseado |
| Exports crudos de WASM | `serde_json` sobre el texto | Ninguna |
| `experimentalCandidateIngress` y sus equivalentes | El del propio candidato experimental | Su escáner. No es el ingreso del § 11 y no cambia nada en `dcp-jcs-v1` |

<a id="claims-for-core-and-profiles"></a>

## Afirmaciones sobre el núcleo y los perfiles

| Superficie | Qué puede informarse a partir del kit | Qué debe mantenerse separado |
|---|---|---|
| Representación de datos del núcleo | Bytes canónicos y resúmenes `dcp-jcs-v1` exactos que se probaron | Entradas no probadas y el candidato experimental |
| Verificación de evidencia V2 | Resultados de los casos seleccionados de bundle, Merkle y firmas | Cumplimiento completo de V2, especialmente cobertura de esquemas, salvo que se acredite por separado |
| Primitivas criptográficas | Separación de dominios, verificación de componentes y vínculos que se probaron | Política del verificador, confianza en el principal y admisión |
| Admisión `strict-v1` | Resultados de los casos seleccionados de admisión y configuración | Aplicación de las reglas en el despliegue y autorización de acciones |
| V1 | Comprobaciones de esquema e integridad de referencia sobre fixtures versionados | Conformidad V1 independiente de terceros |
| A2A y gobernanza | Solo las reglas concretas ejercitadas por una suite identificada | Conformidad funcional completa de cualquiera de los perfiles |
| DCP-05 a DCP-08 | Las comprobaciones declaradas de las suites internas de esquemas e intercambio | Semántica completa de ciclo de vida, derechos u otra de estos documentos |
| DCP-09 | Las comprobaciones declaradas de las suites internas de esquemas e intercambio, y los veredictos de los casos seleccionados de cadenas de mandatos del catálogo externo de delegación | Semántica completa de delegación, la función auxiliar de vigencia, la confianza en las claves, la admisión o la autorización de acciones |
| `dcp-jcs-v2` experimental | Sus pruebas experimentales seleccionadas por separado | Estado normativo o predeterminado; `dcp-jcs-v1` no cambia |

El resultado de un subconjunto debe identificarlo y explicar sus límites. No conviertas `unsupported`, un caso ausente, una caída, un tiempo agotado o una matriz omitida en un caso aprobado. Una prueba SDK reservada que retorna sin ejecutar su matriz no acredita que la matriz se haya ejecutado.

<a id="further-validation"></a>

## Validación adicional

El [expediente de auditoría](AUDIT_DOSSIER.md) da la base de la revisión, los comandos de reproducción, la procedencia de los artefactos y los límites conocidos. La [guía del implementador](IMPLEMENTER_GUIDE.md) explica cómo reproducir e informar resultados de forma independiente. Una implementación externa y una revisión independiente de seguridad son hitos adicionales; las pruebas de este repositorio no los sustituyen.

Las mediciones de rendimiento usan su propio [ejecutor documentado](../../tools/conformance/README.md#performance-baseline). Medir el tiempo de extremo a extremo no atribuye el coste a una primitiva criptográfica ni demuestra la ausencia de salidas anticipadas. Optimiza solo tras medir un coste concreto y conservando las decisiones de verificación y la compatibilidad.
