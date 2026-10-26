<sub>[English](V2-WIRE-COMPATIBILITY.md) · [中文](V2-WIRE-COMPATIBILITY.zh-CN.md) · **Español** · [日本語](V2-WIRE-COMPATIBILITY.ja.md) · [Português](V2-WIRE-COMPATIBILITY.pt-BR.md)</sub>

<a id="dcp-ai-v20-wire-compatibility-errata-for-dcp-05-dcp-08-and-dcp-09"></a>

# Compatibilidad del formato de intercambio de DCP-AI v2.0: erratas de DCP-05, DCP-08 y DCP-09

> Traducción informativa de [la especificación en inglés](V2-WIRE-COMPATIBILITY.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado

Publicado el 25/10/2026. **Es normativo solo para las erratas E1 a E8 que siguen y para las definiciones de capas de
la sección 2.** Todos los demás requisitos de DCP-AI v2.0, DCP-05, DCP-08 y DCP-09 conservan su fuerza normativa sin
cambios. Los requisitos del perfil de canonicalización, las reglas de firma, los esquemas y la prosa de cada
especificación se aplican conjuntamente: ninguno anula a otro y aquí no se relaja ninguno.

Estas erratas corrigen cómo las especificaciones **nombran y muestran** los datos del formato de intercambio V2.0
(nombres de campos, contextos de firma y el formato de sus ejemplos) para que coincidan con el formato que ya usan
`schemas/v2/`, los cuatro SDK que firman y los vectores compartidos. No cambian ningún esquema, contexto, perfil de
canonicalización, comportamiento de los SDK ni decisión de aceptación. No añaden ningún alias: una etiqueta o un
nombre de campo corregido aquí no se acepta en lugar del nombre del formato de intercambio, y los registros producidos
antes de estas erratas no se renombran ni se convierten.

La compatibilidad aquí se refiere al formato y al comportamiento de aceptación de los esquemas y SDK actuales, no al
comportamiento sin comprobar de implementaciones externas. Una implementación que haya usado las etiquetas antiguas
de los ejemplos necesita una decisión explícita de migración. La evidencia ya firmada no debe cambiar de etiqueta ni
reescribirse, y estas erratas no autorizan probar automáticamente otros contextos de firma como alternativa.

<a id="1-scope"></a>

## 1. Alcance

| Errata | Especificación y secciones | Asunto |
|--------|----------------------------|--------|
| E1 | DCP-AI v2.0 §4.1 | Filas del registro de contextos ya en uso |
| E2 | DCP-05 §2, §4.4 (última frase), §10.5, §11 punto 7 | Contexto de firma de los registros del ciclo de vida |
| E3 | DCP-05 §5.1 y §6.2 | Nombre del campo de vitalidad en el informe de vitalidad |
| E4 | DCP-08 §2, §9.5, §10 punto 8 | Contexto de firma de los registros de derechos |
| E5 | DCP-09 §2, §10.6, §11 punto 9 | Contextos de firma de los registros de delegación y de conciencia |
| E6 | DCP-09 §3.6 | Campo que lleva la caducidad de un mandato |
| E7 | DCP-05 §3.3, §4.2, §6.2, §8.2, §9.2; DCP-08 §4.2, §5.2, §6.2, §8.2; DCP-09 §3.2, §4.2, §5.2, §6.2, §7.2, §9.2 | Carácter de los ejemplos JSON |
| E8 | DCP-05, DCP-08, DCP-09, «Notas de implementación (informativas)» | Frase de precedencia de las notas |

<a id="2-layers"></a>

## 2. Capas

Un registro V2.0 se comprueba en cuatro capas. Las comprobaciones no son intercambiables; superar una sola no prueba
la conformidad completa. La verificación (capa 3) canonicaliza el registro y, por tanto, requiere la capa 1, y la
capa 4 requiere las capas 1 a 3 para los registros implicados.

1. **Representable**: el perfil de canonicalización `dcp-jcs-v1` acepta el registro
   ([CANONICALIZATION_PROFILE.md](CANONICALIZATION_PROFILE.md)). Un número no entero no es representable.
2. **Válido según el esquema**: el registro valida contra su esquema de `schemas/v2/`. Un registro válido según el
   esquema puede no ser representable (por ejemplo, una métrica de vitalidad de `0.5`), y un esquema comprueba formas
   y rangos, no significado.
3. **Verificado criptográficamente**: la firma compuesta verifica como define DCP-AI v2.0 §5, con el contexto que
   asigna el registro de contextos: la firma clásica sobre el mensaje con separación de dominio `UTF8(context) || 0x00 || canonical bytes` (§4) y, con el enlace `pq_over_classical`, la firma poscuántica sobre ese mensaje seguido de la firma
   clásica. Autentica una declaración de quien tenga las claves; no muestra que lo que afirma el registro sea cierto
   ni que se haya calculado como se exige.
4. **Funcionalmente conforme**: la implementación cumple los requisitos de la propia especificación (los cálculos,
   firmantes, ceremonias, intervalos y aplicación de cada sección de «Conformidad»). Las capas 1 a 3 son necesarias
   para los registros implicados y no bastan para esta capa.

<a id="3-errata"></a>

## 3. Erratas

<a id="e1-context-registry-dcp-ai-v20-41"></a>

### E1. Registro de contextos (DCP-AI v2.0 §4.1)

La tabla de §4.1 gana las filas `DCP-AI.v2.MultiPartyAuth`, `DCP-AI.v2.Lifecycle`, `DCP-AI.v2.Succession`,
`DCP-AI.v2.Dispute`, `DCP-AI.v2.Rights` y `DCP-AI.v2.Awareness`, y la fila `DCP-AI.v2.Delegation` nombra también los
espejos del principal. Estos contextos ya los definen los cuatro SDK que firman y los cubre byte a byte
`tests/interop/v2/interop_vectors.json#domain_separation_all_contexts`; las filas los documentan y no añaden ninguna
etiqueta. Las demás filas no cambian.

<a id="e2-lifecycle-signatures-dcp-05"></a>

### E2. Firmas del ciclo de vida (DCP-05)

Donde DCP-05 nombra la etiqueta de separación de dominio `DCP-LIFECYCLE-SIG-v2`, el contexto del formato de
intercambio V2.0 es `DCP-AI.v2.Lifecycle`, aplicado como definen DCP-AI v2.0 §4 y §5 a la `composite_sig` de cada
registro del ciclo de vida (`commissioning_certificate`, `vitality_report`, `decommissioning_record` en `schemas/v2/`).
La etiqueta `DCP-LIFECYCLE-SIG-v2` no es un contexto V2.0. El requisito de §4.4 de que un certificado de puesta en
servicio lleve una firma de la autoridad y un refrendo del principal no cambia (véase la sección 4).

<a id="e3-vitality-field-dcp-05"></a>

### E3. Campo de vitalidad (DCP-05)

El informe de vitalidad V2.0 lleva la vitalidad compuesta de §5.1 en el campo `vitality_score` (entero de 0 a 1000,
`schemas/v2/vitality_report.schema.json`); el campo llamado `vitality` en el ejemplo de §6.2 es ese valor. La
definición, los componentes, los pesos y el `floor` de §5.1 y los umbrales de §5.2 no cambian. El esquema comprueba el
rango y la firma autentica el valor declarado; ninguno muestra que el valor se haya calculado como exige §5.1. El
objeto `metrics` del esquema V2.0 contiene magnitudes distintas de las cuatro puntuaciones de componentes de §5.1, y
los helpers de los SDK que calculan una puntuación a partir de esas métricas usan otras entradas y redondean en lugar
de truncar: no muestran conformidad con §5.1.

<a id="e4-rights-signatures-dcp-08"></a>

### E4. Firmas de derechos (DCP-08)

Donde DCP-08 nombra la etiqueta `DCP-RIGHTS-SIG-v2`, el contexto del formato de intercambio V2.0 es
`DCP-AI.v2.Rights`, aplicado a la `composite_sig` de `rights_declaration`, `obligation_record` y
`rights_violation_report`. El requisito de §9.1 de verificar una declaración de derechos contra la clave de la
autoridad de puesta en servicio no cambia.

<a id="e5-delegation-and-awareness-signatures-dcp-09"></a>

### E5. Firmas de delegación y de conciencia (DCP-09)

Donde DCP-09 nombra las etiquetas `DCP-DELEGATION-SIG-v2` y `DCP-AWARENESS-SIG-v2`, los contextos del formato de
intercambio V2.0 son:

| Registro | Campo de firma | Contexto |
|----------|----------------|----------|
| Mandato de delegación raíz | `human_composite_sig` | `DCP-AI.v2.Delegation` (como ya indica §3.5.1) |
| Submandato | `delegator_composite_sig` | `DCP-AI.v2.SubMandate` (como ya indica §3.5.1) |
| Espejo del principal, registro de interacción | `composite_sig` | `DCP-AI.v2.Delegation` |
| Umbral de conciencia, declaración de aviso | `composite_sig` | `DCP-AI.v2.Awareness` |

Las reglas de la cadena de mandatos de §3.5 no cambian.

<a id="e6-mandate-expiry-dcp-09-36"></a>

### E6. Caducidad del mandato (DCP-09 §3.6)

«Se alcanza la marca de tiempo `effective_until`» se lee «se supera el instante `valid_until`». La ventana de un
mandato V2.0 es `valid_from` / `valid_until` (`schemas/v2/delegation_mandate.schema.json`, obligatorios), comparados
como instantes RFC 3339 tal como exige §3.5.2; `effective_from` / `effective_until` en el ejemplo de §3.2 son esos
campos. Un mandato que lleva `effective_until` en lugar de `valid_until` lo rechaza el esquema y, tal como lo ejercita
el kit, el verificador de cadenas de TypeScript.

<a id="e7-examples"></a>

### E7. Ejemplos

Los ejemplos JSON de las secciones listadas en la sección 1 ilustran el contenido de cada registro; no son el formato
de intercambio V2.0 ni fixtures, y tal como están escritos no son registros V2.0 válidos, por dos motivos distintos.
Sus bloques `signature` / `countersignature` / `agent_acknowledgment` con `alg`, `kid`, `sig_b64` y `domain_sep`, los
campos `record_type`, `prev_hash_secondary` y `merkle_root` donde el esquema no los tiene, y otros nombres de campo
que difieren del esquema hacen que un registro no sea válido según el esquema, aunque se canonicalice. Los valores no
enteros (por ejemplo `error_rate_percent: 0.3`, `capacity_threshold: 0.80`, `threshold: 0.3`, `confidence: 0.95`) no
son representables con `dcp-jcs-v1`. Para un registro que tiene un esquema publicado en `schemas/v2/`, su formato de
intercambio es ese esquema junto con la canonicalización `dcp-jcs-v1`, firmado como indican E2, E4 y E5. Algunos de
los ejemplos listados no tienen un esquema publicado propio: el registro de transición de DCP-05 §3.3 y las entradas
de auditoría de DCP-05 §9.2, DCP-08 §8.2 y DCP-09 §9.2, que tampoco se ajustan a
`schemas/v2/audit_entry.schema.json`. Un ejemplo así no define un esquema, y estas erratas no lo convierten en un
registro válido del formato de intercambio. Los requisitos que establece la prosa de esas secciones no cambian.

<a id="e8-implementation-notes"></a>

### E8. Notas de implementación

La frase «Donde difieren, prevalece el texto normativo anterior.» de las notas informativas de DCP-05, DCP-08 y
DCP-09 se lee «Donde difieren, prevalece el texto normativo anterior, con las correcciones de las erratas de
[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).»

<a id="4-requirements-the-v20-structures-do-not-represent-directly"></a>

## 4. Requisitos que las estructuras V2.0 no representan directamente

Estos requisitos siguen siendo normativos. Los esquemas V2.0 de los registros listados abajo llevan una única firma
por registro o un conjunto cerrado de valores, así que esos registros no representan directamente estos requisitos, y
los helpers de los SDK por sí solos no los cumplen. Que un mecanismo externo a estos registros pueda cumplirlos depende
de demostrar los propios requisitos funcionales; estas erratas ni lo establecen ni lo presuponen. Representarlos
dentro de los registros requiere un diseño explícito y versionado (una nueva versión de esquema o un perfil); estas
erratas no definen ni activan ninguno.

| Requisito | Por qué el registro V2.0 no lo lleva |
|-----------|--------------------------------------|
| DCP-05 §4.4: firma de la autoridad y refrendo del principal | Una única `composite_sig`; ningún campo para un segundo firmante |
| Puntuaciones de componentes de DCP-05 §5.1 | Las `metrics` del esquema son otras magnitudes; solo se lleva `vitality_score` |
| Métricas fraccionarias de DCP-05 §6 | `dcp-jcs-v1` solo acepta enteros, así que las métricas [0, 1] del esquema solo son representables como 0 o 1 |
| Derechos de la organización con notación de dominio inverso de DCP-08 §4.3 | `right_type` es un enum cerrado de los cuatro derechos fundamentales |
| DCP-08 §9.1: firma de la autoridad de puesta en servicio | El registro no identifica el papel de quien firma; los helpers no lo comprueban |
| DCP-09 §3.3: acuse del agente; §6.3: firma del principal en un espejo | Una firma por registro |

Los helpers de puntuación de vitalidad de los SDK también difieren entre sí en los empates cuando reciben entradas
fraccionarias (para `task_completion_rate` 0, `error_rate` 1, `human_satisfaction` 0.002 y `policy_alignment` 0, el
helper de TypeScript devuelve 1 y el de Python 0). Esas entradas no son representables en un informe firmado; la
divergencia es un asunto pendiente aparte y no es un requisito del protocolo.

<a id="5-evidence"></a>

## 5. Evidencias

| Errata | Referencias |
|--------|-------------|
| E1 | `sdks/typescript/src/core/domain-separation.ts`; `interop_vectors.json#domain_separation_all_contexts`; caso del kit `ext.wire.contexts.registry_documented` |
| E2, E4, E5 | `schemas/v2/{commissioning_certificate,vitality_report,decommissioning_record,rights_declaration,obligation_record,rights_violation_report,delegation_mandate,principal_mirror,interaction_record,awareness_threshold,advisory_declaration}.schema.json`; casos del kit `ext.wire.dcp0*.*.signed`, `ext.wire.context.*` |
| E3 | `schemas/v2/vitality_report.schema.json#/properties/vitality_score`; casos del kit `ext.wire.dcp05.vitality_field_name.schema_rejected`, `ext.wire.tamper.vitality_score_changed` |
| E6 | `schemas/v2/delegation_mandate.schema.json#/required`; `tests/interop/v2/mandate_chain_vectors.json` (`expired_at_verification_time`, `validity_*`); casos del kit `ext.wire.dcp09.effective_until.*` |
| E7, sección 4 | casos del kit `ext.wire.dcp05.fractional_metric.*`, `ext.wire.dcp08.extension_signed_but_schema_invalid`, `ext.wire.dcp05.countersignature.schema_rejected`, `ext.wire.fixture.*` |

Los casos del kit pertenecen a la suite `ext.dcp05_09.wire` de [`tools/conformance`](../tools/conformance/README.md).
