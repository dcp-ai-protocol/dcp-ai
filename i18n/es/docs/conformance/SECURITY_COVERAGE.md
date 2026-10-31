<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · [中文](../../../zh-CN/docs/conformance/SECURITY_COVERAGE.md) · **Español** · [日本語](../../../ja/docs/conformance/SECURITY_COVERAGE.md) · [Português](../../../pt-BR/docs/conformance/SECURITY_COVERAGE.md)</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# Garantías de seguridad y cobertura de conformidad

> Traducción informativa de [la versión en inglés](../../../../docs/conformance/SECURITY_COVERAGE.md), actualizada el 31/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

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
- **Suites de SDK y adaptadores:** son pruebas separadas, con sus propias entradas y alcances. Que un elemento figure en el inventario del kit no significa que el kit lo ejecute.

Los contratos numerados son interfaces del ejecutor, no versiones del protocolo DCP. La identidad del wrapper es autodeclarada. Cinco wrappers no son cinco adoptantes externos independientes: WASM comparte código con Rust y todos estos wrappers pertenecen al repositorio.

Un resultado negativo solo es útil con un control positivo que funcione. Cambiar contenido firmado sin actualizar su firma puede causar el rechazo por varios motivos. Una etiqueta `spec_step` o un mensaje de error coincidente no demuestran por sí solos qué comprobación causó el rechazo. Los pares válidos e inválidos que aíslan una regla aportan evidencia más fuerte que bundles rechazados construidos por separado y con solo un control positivo de suite.

<a id="v2-verification-map"></a>

## Mapa de verificación V2

Los nombres siguientes corresponden a los [vectores de bundles](../../../../tests/interop/v2/bundle_vectors.json). `M`, `R` y `A` significan `must_reject`, `must_reject_bundles` y `must_accept_bundles`; los IDs externos tienen el prefijo `external.v2.bundle_vectors.`, seguido de `must_reject`, `must_reject_bundles` o `must_accept`, respectivamente, y después el nombre del caso. `signed_bundle` es el positivo base. Son muestras seleccionadas y trazables, no una lista exhaustiva ni una calificación de completitud.

| Regla normativa | Casos o suite existentes seleccionados | Alcance y límites restantes |
|---|---|---|
| V2-1: seleccionar la versión | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | Rechazo en la entrada V2; no ejercita todos los requisitos V1 |
| V2-2: validar esquemas del sobre y artefactos | Referencia `v2.signed_bundle.schema_invalid_payload_rejected`; suites de esquemas | La operación del verificador SDK externo no es una validación completa de esquemas; véase el límite más abajo |
| V2-3: manifiesto, hashes de payload y vínculo de auditoría | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | Muestras del vínculo de hashes y cadena; no cobertura aislada de cada campo y forma malformada |
| V2-4: sesión, tiempo y consistencia de metadatos no firmados | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | Pruebas con instante fijo; hay que distinguir política solicitada y modo efectivo |
| V2-5: estructura de firmas y codificación canónica | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | Las muestras de codificación no cubren todas las ubicaciones de firma ni combinaciones de defectos |
| V2-6: el principal firma el manifiesto | R `bundle_signed_by_agent_keys`; referencia `v2.signed_bundle.forged_classical_signature_rejected` | Muestras de firmas y vínculo de roles; no establecen confianza en un principal autodeclarado |
| V2-7: verificar firmas PQ presentes | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | El catálogo histórico de evidencia las ejecuta con su política seleccionada; afirmar todos los modos efectivos exige sus controles correspondientes |
| V2-8: verificar cada artefacto con su contexto y rol firmante | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | Muestras de artefactos y roles; no todas las combinaciones de componente, contexto y clave |
| V2-9: derivar el nivel sin que una declaración pueda reducirlo | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | Muestras de veredictos; la operación externa de bundle no evalúa el nivel resuelto informado |
| V2-10: exigir el modo efectivo y la política de algoritmos | R `classical_only_payment_from_low_risk_passport`; `classical_only_routine` en cuatro modos | Muestras de modos; el catálogo histórico de evidencia no tiene una matriz específica de listas de algoritmos permitidos y advisories |
| V2-11: verificar campos secundarios presentes | `external.v2.secondary_sha3`, de los [vectores secundarios](../../../../tests/interop/v2/secondary_sha3_vectors.json) | Controles positivos y campos malformados o no coincidentes; los enlaces ausentes son opcionales, así que aceptar no implica una cadena secundaria completa |
| V2-12: vincular y verificar checkpoints | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | Muestras de pertenencia, rango y firmas; no todas las combinaciones de rangos o componentes malformados |
| V2-13: derivar IDs de clave y exigir su validez | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | Muestras de clave, codificación y estado; no cobertura exhaustiva de políticas de claves |
| V2-14: consistencia entre artefactos | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | La consistencia de evidencia es distinta del permiso para actuar |

Las expectativas del corpus deben interpretarse con su política declarada, ajustes por caso e instante de verificación. Un bundle híbrido positivo puede verificar bajo `pq_only`; que contenga los bytes clásicos necesarios para el vínculo no lo convierte en un control negativo. Una política solicitada `classical_only` puede resolverse a un modo efectivo más estricto por el nivel de la acción.

<a id="schema-and-cryptographic-api-boundary"></a>

### Límite entre esquema y API criptográfica

V2-2 exige validación de esquemas. La API criptográfica del SDK y la entrada de referencia que valida esquemas son superficies distintas. Por ejemplo, agregar una propiedad desconocida al sobre exterior no firmado puede dejar intactas las firmas: el esquema cierra ese objeto con `additionalProperties: false`, mientras las APIs de verificación de los SDK TypeScript, Python, Go, Rust y WASM por sí solas pueden seguir devolviendo `verified: true`. Es un hueco en el límite de validación, no evidencia de firmas falsificadas ni de que una aplicación protegida admitiera la entrada.

Quien declare cumplir toda la lista V2 debe cubrir V2-2 además de las comprobaciones criptográficas. No debilites el esquema ni describas una API parcial como una validación completa para conseguir que pase una prueba. El kit debe informar esas capas por separado.

Los miembros desconocidos no están prohibidos universalmente. Algunos objetos del esquema son abiertos. Que el esquema acepte una extensión en un objeto firmado no conserva su firma anterior: al cambiar contenido firmado hay que recalcular hashes y firmas. Aquí no se define ningún mecanismo nuevo de extensiones obligatorias.

El [catálogo diagnóstico de esquemas](../../../../tools/conformance/external-schema-catalog.json), de uso explícito, hace ejecutable este límite: la base y las extensiones permitidas son controles positivos; las extensiones de objetos cerrados y los valores fuera de una enumeración conservan el rechazo normativo. Un caso SDK fallido sigue siendo un fallo. El informe separado de `tools/conformance/schema-boundary.js` distingue validación de esquemas, integridad del corpus finito y composición de esquema con SDK en el instante del corpus. Esa composición no acredita que el SDK solo implemente V2-2, y el helper de integridad no es un verificador normativo general.

<a id="verifier-policy-samples"></a>

### Muestras de política del verificador

El [catálogo de políticas](../../../../tools/conformance/external-policy-catalog.json), de selección explícita, añade 74 casos mediante el contrato `/2` existente: 10 controles positivos, 24 casos de PQ presente inválida, 14 casos de listas de algoritmos y advisories y 26 casos de tier ya versionados. Cada solicitud lleva su política e instante de verificación exactos. El catálogo de evidencia predeterminado no cambia.

El nuevo control híbrido de tier routine ejercita `classical_only` efectivo y los otros tres modos. El control híbrido de tier standard eleva una solicitud `classical_only` a `hybrid_preferred`. El corpus registra esta derivación; `/2` evalúa el veredicto, no el tier ni el modo efectivo que reporte la implementación.

Los negativos PQ alteran solo la firma PQ del bundle, pasaporte o checkpoint; el componente clásico sigue siendo válido. Los casos de listas de algoritmos mantienen el mismo bundle y cambian únicamente la política. Los casos de tier reutilizan bundles versionados firmados por separado y un control routine bajo el mismo modo solicitado: no son gemelos de un solo cambio. Cada negativo exige que su control positivo pase en la misma ejecución.

Las exclusiones de algoritmos clásicos bajo `pq_only` siguen omitidas hasta aclarar su interpretación, sin veredicto esperado. El corpus registra casos diferidos y preguntas de interpretación; una combinación no probada no demuestra por sí sola una contradicción en la especificación. Estas muestras no cierran el hueco de esquemas ni establecen conformidad V2 completa.

<a id="structural-samples"></a>

### Muestras estructurales

El [catálogo estructural](../../../../tools/conformance/external-structural-catalog.json), de selección explícita, añade 16 casos mediante `/2`: dos controles positivos y 14 negativos sobre codificación de firmas, componentes y rangos de checkpoints, compromisos del manifiesto, un payload con fracción, orden temporal de sesión y una firma clásica del bundle invalidada con su firma PQ recalculada correctamente. El modo efectivo es `hybrid_preferred`; estos negativos clásicos no afirman nada sobre `pq_only`.

Los cuatro casos de codificación conservan los bytes decodificados de la firma. Los rangos de checkpoints usan posiciones reales de la traza, con identificadores deliberadamente desordenados. Las mutaciones del manifiesto se vuelven a firmar. La sesión invertida tiene un gemelo positivo separado dentro de la tolerancia de reloj. Cada negativo exige que sus controles pasen en la misma ejecución.

El aislamiento tiene límites explícitos: una fracción no tiene representación `dcp-jcs-v1`, por lo que sus hashes y firmas anteriores quedan obsoletos; un rango invertido no tiene una raíz válida para ese rango. Las comprobaciones de componentes documentan los defectos previstos, pero no identifican qué comprobación del SDK causó el rechazo. Estas muestras no cierran el hueco de esquemas ni prueban conformidad completa.

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
| DCP-05 a DCP-09 | Las comprobaciones declaradas de las suites internas de esquemas e intercambio | Semántica completa de ciclo de vida, derechos o delegación |
| `dcp-jcs-v2` experimental | Sus pruebas experimentales seleccionadas por separado | Estado normativo o predeterminado; `dcp-jcs-v1` no cambia |

El resultado de un subconjunto debe identificarlo y explicar sus límites. No conviertas `unsupported`, un caso ausente, una caída, un tiempo agotado o una matriz omitida en un caso aprobado. Una prueba SDK reservada que retorna sin ejecutar su matriz no acredita que la matriz se haya ejecutado.

<a id="further-validation"></a>

## Validación adicional

La [guía del implementador](IMPLEMENTER_GUIDE.md) explica cómo reproducir e informar resultados de forma independiente. Una implementación externa y una revisión independiente de seguridad son hitos adicionales; las pruebas de este repositorio no los sustituyen.

Las mediciones de rendimiento usan su propio [ejecutor documentado](../../tools/conformance/README.md#performance-baseline). Medir el tiempo de extremo a extremo no atribuye el coste a una primitiva criptográfica ni demuestra la ausencia de salidas anticipadas. Optimiza solo tras medir un coste concreto y conservando las decisiones de verificación y la compatibilidad.
