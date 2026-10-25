<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="interop-matrix-live-agents-across-the-four-sdks"></a>

# Matriz de interoperabilidad: agentes vivos en los cuatro SDK

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

`run.mjs` inicia un **proceso de agente por SDK** (TypeScript, Python, Go, Rust) y los hace
trabajar entre sí: un agente construido sobre un SDK crea su identidad, declara intenciones, actúa y
firma sus bundles de ciudadanía; un agente construido sobre otro SDK los verifica, como haría antes de
confiar en una contraparte. Verificar aquí significa que el bundle es coherente y está firmado por las claves que enumera; no es
confianza en la contraparte, admisión ni autorización para actuar (el escenario 2 cubre la admisión, que tampoco autoriza
ninguna acción). Los procesos no comparten nada salvo los mensajes que retransmite el orquestador,
así que cada par (16 con cuatro SDK, incluido cada SDK contra sí mismo) es una interoperación real, no
una comparación de archivos. Un quinto agente, solo de verificación, `ref`, ejecuta el verificador de referencia
`lib/verify.js` (lo que ejecutan `node bin/dcp.js verify-bundle` y el servidor de verificación): valida cada
artefacto contra `schemas/v2` antes del verificador de `@dcp-ai/sdk` (el SDK del workspace hasta que la 2.2.0 esté
en npm), algo que los verificadores de los SDK no hacen.

El orquestador es también la red intermedia: manipula los bundles en tránsito, y cada
verificador debe rechazar cada bundle manipulado de la misma forma. Cualquier veredicto inesperado, fallo o tiempo agotado
hace fallar la ejecución.

El escenario 1 (`run.mjs`) ejercita partes de DCP-01 (identidad), DCP-02 (intención y política) y DCP-03 (auditoría)
entre los SDK; no es una prueba de conformidad completa de esas especificaciones.
El escenario 2 (`admission.mjs`) cubre la admisión bajo el perfil `strict-v1`
(`spec/profiles/admission`) en los cuatro SDK. El handshake A2A de DCP-04 necesita antes trabajo en los SDK
(véase la hoja de ruta al final).

<a id="run"></a>

## Ejecución

```bash
(cd sdks/typescript && npm install && npm run build) # agents/ts imports sdks/typescript/dist
npm install                                           # agents/ref: the reference verifier, on that SDK
pip install -e sdks/python                            # dependencies of agents/py
node tools/interop-matrix/run.mjs                     # all four SDKs and the reference verifier
node tools/interop-matrix/run.mjs --agents ts,py      # a subset
node tools/interop-matrix/admission.mjs               # scenario 2, the four SDKs, with its negative control
```

Go y una toolchain estable de Rust deben estar en el `PATH`; `run.mjs` compila `agents/go` y `agents/rust`.
Opciones: `--agents a,b` (cualquiera de `ts`, `py`, `go`, `rust`, `ref`), `--python PATH` (por defecto `$INTEROP_PYTHON` o `python3`), `--timeout MS`
(por petición, por defecto 60000), `--out DIR` (por defecto `tools/interop-matrix/out`, donde se escriben el informe
y cada bundle que produjo un veredicto inesperado). `admission.mjs` acepta las mismas
opciones salvo `ref` (por defecto `--out tools/interop-matrix/out/admission`), además de
`--skip-negative-control`, `--negative-control`, `--check-negative-control` y `--replay FILE`
(véase abajo).

<a id="the-agent-protocol"></a>

## El protocolo de los agentes

Un agente lee una petición JSON por línea en stdin y escribe exactamente una línea de respuesta JSON por
petición en stdout, en orden; todo lo demás va a stderr.

```json
{"id": 1, "cmd": "identity", "args": {"owner_name": "Interop Owner", "jurisdiction": "CL"}}
{"id": 1, "ok": true, "result": {"agent_id": "agent:…", "human_id": "rpr:…", "session_nonce": "…"}}
{"id": 2, "ok": false, "error": "message"}
```

Un agente mantiene su propio estado (claves, identidad, intenciones, registros de auditoría) en memoria durante la vida del
proceso. Las claves nunca salen de él. Cada valor que el contrato fija abajo debe producirse exactamente
como está escrito; todo lo demás es asunto del propio SDK, que es lo que prueba la matriz (un
campo opcional que un SDK añade por su cuenta, como el `audit_merkle_root_secondary` SHA3 de Go, es aceptable
siempre que todos los verificadores lo acepten).

### `identity` `{owner_name, jurisdiction}` → `{agent_id, human_id, session_nonce, principal_keys, agent_keys}`

Genera dos pares de claves compuestas (Ed25519 + ML-DSA-65): uno para el principal humano y otro para el
agente; un nonce de sesión nuevo (64 hex); `human_id` = `rpr:<uuid4>` y `agent_id` = `agent:<uuid4>`.
Entradas de clave: `{kid, alg, public_key_b64, created_at: <now RFC 3339>, expires_at: null, status: "active"}`.

- **RPR** (`schemas/v2/responsible_principal_record.schema.json`): `dcp_version "2.0"`, `human_id`,
  `session_nonce`, `legal_name` = `owner_name`, `entity_type "natural_person"`, `jurisdiction`,
  `liability_mode "owner_responsible"`, `override_rights true`, `issued_at` el instante actual, `expires_at null`,
  `contact null`, `binding_keys` = las dos entradas de clave humanas. Un `SignedPayload` con firma compuesta
  (`pq_over_classical`) de las claves **humanas** bajo el contexto `ResponsiblePrincipal`.
- **Pasaporte** (`agent_passport.schema.json`): `dcp_version "2.0"`, `agent_id`, `session_nonce`,
  `keys` = las dos entradas de clave del agente, `principal_binding_reference` = `human_id`,
  `capabilities ["api_call", "payments"]`, `risk_tier "medium"`, `created_at` el instante actual,
  `status "active"`. Con firma compuesta de las claves del **agente** bajo `AgentPassport`.

`principal_keys` y `agent_keys` son las mitades públicas, `[{kid, alg, public_key_b64}]`, la clásica
primero. El escenario 2 inscribe al principal a partir de ellas, fuera de banda.

Un segundo `identity` sustituye al primero, junto con las intenciones y los registros que iban con él.

### `intent` `{action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash}` → `{intent_id, decision, security_tier}`

- **Intención** (`intent.schema.json`): `dcp_version "2.0"`, `intent_id` = `intent:<uuid4>`,
  `session_nonce`, `agent_id`, `human_id`, `timestamp` el instante actual, `action_type`,
  `target {channel, to: null}`, `data_classes`, `estimated_impact`,
  `requires_consent` = (`estimated_impact` es `"high"`), `security_tier` = el cálculo del nivel de seguridad
  del SDK (DCP-AI v2.0 §14.2) para esta intención y `risk_score`.
- **Decisión de política** (`policy_decision.schema.json`): `dcp_version "2.0"`, `intent_id`,
  `session_nonce`, `decision` = `approve` si `risk_score` < 500, `escalate` si < 800, si no
  `block`; `risk_score`; `reasons ["interop-matrix: risk_score <n>"]`; `required_confirmation`
  `null` en approve, si no `{"type": "human_approve", "fields": ["action_type"]}`;
  `applied_policy_hash` de los argumentos; `timestamp` el instante actual; `resolved_tier` = el
  `security_tier` de la intención.

Ambas con firma compuesta de las claves del **agente** (contextos `Intent`, `PolicyDecision`).

### `act` `{intent_id, outcome, tool, result_ref}` → `{audit_id, count}`

Añade una entrada de auditoría (`audit_entry.schema.json`) al registro de esa intención: `dcp_version "2.0"`,
`audit_id` = `audit:<uuid4>`, `session_nonce`, `prev_hash` = `"GENESIS"` para la primera entrada del registro,
si no `"sha256:" + hex(sha256(canonical(previous entry)))`; `hash_alg "sha256"`;
`timestamp` el instante actual; `agent_id`; `human_id`; `intent_id`;
`intent_hash` = `"sha256:" + hex(sha256(canonical(intent payload)))`;
`policy_decision` = `approved` / `escalated` / `blocked` según la decisión; `outcome`;
`evidence {tool, result_ref, evidence_hash: "sha256:" + hex(sha256(utf8(result_ref)))}`;
`pq_checkpoint_ref null`. `count` es la longitud del registro. La entrada es un registro sintético: `act` no ejecuta nada,
y `outcome`, `tool` y `result_ref` son las cadenas que envía el orquestador.

### `bundle` `{intent_id, session_issued_at?, session_expires_at?, intended_verifier?}` → `{signed_bundle}`

El bundle de ciudadanía de esa intención (`signed_bundle.schema.json`): el RPR, el pasaporte,
la intención y la decisión de política firmados, el registro completo de la intención y el manifiesto: `session_nonce`,
`rpr_hash` / `passport_hash` / `intent_hash` / `policy_hash` (los hashes de las cargas útiles),
`audit_merkle_root` (`"sha256:"` + la raíz de Merkle de auditoría del SDK), `audit_count`,
`canonicalization_profile "dcp-jcs-v1"`. La firma: `hash_alg "sha256"`, `created_at` el instante actual,
`signer {type: "human", id: human_id, kids: [human classical kid, human pq kid]}`,
`manifest_hash`, `composite_sig` de las claves **humanas** bajo el contexto `Bundle`. Usa el
constructor y el firmante de bundles del SDK. Los constructores de Go y Rust también escriben `audit_merkle_root_secondary`.
Los argumentos opcionales entran en el manifiesto antes de firmarlo, exactamente como se dan.

### `verify` `{signed_bundle, mode}` → `{valid, errors}`

El verificador de bundles V2 del SDK. El `mode` `""` es la política de verificador predeterminada; cualquier otro valor es un
modo de verificación aplicado a `default_mode` y a todos los niveles de riesgo, como hacen las pruebas de interoperabilidad. Un
bundle malformado es un resultado `valid: false`, nunca una respuesta de error.

### `rotate_principal` `{}` → `{human_id, principal_keys}`

Un nuevo par de claves compuestas para el principal y un nuevo RPR con el mismo `human_id`, `issued_at`
el instante actual y las nuevas `binding_keys`, firmado por las nuevas claves. Los bundles posteriores las usan.

<a id="configure-tenant-trust_set-profile---or-config_error"></a>
<a id="configure-tenant-trust_set-profile-or-config_error"></a>

### `configure` `{tenant, trust_set, profile}` → `{}` o `{config_error}`

La configuración de operador de un inquilino, cargada con los cargadores propios del SDK: el conjunto de confianza
(`createPrincipalTrustStore` y sus equivalentes) y el perfil `strict-v1`
(`resolveStrictV1Profile`). Un error de configuración es `{config_error: <CONFIG_* code>}`.

<a id="admit-tenant-signed_bundle-revocation-now_ms--the-admission-result"></a>
<a id="admit-tenant-signed_bundle-revocation-now_ms-the-admission-result"></a>

### `admit` `{tenant, signed_bundle, revocation, now_ms}` → el resultado de la admisión

La API combinada de admisión del SDK (`admitSignedBundleV2` y sus equivalentes) con el
perfil y el conjunto de confianza del inquilino, la instantánea de revocación y el reloj. El resultado es la forma JSON propia del SDK
(spec §8) sin `verification`, más `verification_errors`.

### `shutdown` `{}` → `{}`

El agente termina después de responder.

<a id="scenario-1-dcp-01-to-dcp-03"></a>

## Escenario 1: de DCP-01 a DCP-03

Para cada SDK como **productor**: `identity`; una intención rutinaria (`api_call`, canal `api`,
`["none"]`, impacto `low`, riesgo 100) con tres `act`; una intención de pago (`initiate_payment`,
canal `payments`, `["financial_data"]`, impacto `high`, riesgo 900, así que bloqueada) con un `act`
(el rechazo también es evidencia); `bundle` para ambas. Después cada SDK como **verificador** comprueba ambos
bundles bajo la política predeterminada y `hybrid_required`: ambos deben verificarse.

Luego el orquestador manipula el bundle rutinario en tránsito, y cada verificador debe rechazar
cada copia, en ambos modos salvo que se indique:

| Ataque | Qué cambia |
|---|---|
| `intent_changed` | `intent.payload.estimated_impact` pasa a `high` después de firmar |
| `audit_reordered` | las dos primeras entradas de auditoría intercambian su lugar |
| `audit_entry_dropped` | se elimina la última entrada de auditoría y se mantiene el manifiesto |
| `session_spliced` | se sustituye el `session_nonce` del manifiesto |
| `bundle_signature_swapped` | la firma del bundle viene del bundle del pago |
| `passport_swapped` | el pasaporte es el de otro agente (el productor del SDK siguiente) |
| `pq_stripped` | se elimina el hueco `pq` de la firma del bundle (`classical_only`); solo `hybrid_required` |
| `intent_from_other_bundle` | la intención y la decisión de política vienen del bundle del pago (misma sesión y firmante) |
| `trail_from_other_bundle` | el registro de auditoría viene del bundle del pago (misma sesión y firmante) |

Un agente que falla, agota el tiempo o responde fuera de turno se detiene y cada petición posterior a él
falla de inmediato, así que un agente roto aparece como fallos, nunca como una ejecución colgada.

<a id="scenario-2-admission-under-strict-v1"></a>

## Escenario 2: admisión bajo `strict-v1`

Cada SDK como **productor**: `identity`, una intención rutinaria (riesgo 100, así que `approve`) con un `act`,
y tres bundles cuyos manifiestos firman la ventana de sesión `[T0, T0 + 300 s]` (el
máximo del perfil): uno para este verificador (`verifier:interop-admission`), uno para otra audiencia y,
tras `rotate_principal`, uno firmado con las claves rotadas del principal.

El orquestador es el operador. Inscribe a cada principal a partir de las claves públicas que informó el productor
(nunca a partir de un bundle en admisión), construye los conjuntos de confianza y sirve las instantáneas de
revocación: el agente y las claves del productor, `checked_at` 10 s antes del reloj. Cada admisión se ejecuta
en el instante fijo `T0 + 120 s` (el caso de caducidad, en la caducidad más 1 ms). Los inquilinos A y B son
una selección de configuración de operador hecha por el arnés; no interviene ninguna integración ni caché.

Cada SDK como **consumidor** ejecuta los 13 casos de abajo para cada productor, en este orden, en un
solo proceso. Los valores esperados de `verified`, `principal_trust`, `profile`, `profile_compliance`, `admitted`,
`action_authorized` (siempre `false`), `recorded_decision`, `trust_set_version` y el conjunto de códigos
vienen de la especificación, escritos en `admission.mjs`, nunca de un SDK.

| Caso | Configuración | Esperado |
|---|---|---|
| `trusted_admitted` | el inquilino A confía en todos los principales inscritos | admitido |
| `trust_withdrawn` | el inquilino A sin este principal, el mismo bundle | `TRUST_PRINCIPAL_UNKNOWN` |
| `trust_restored` | el inquilino A como antes, el mismo bundle | admitido |
| `tenant_b_empty_trust` | el inquilino B, conjunto de confianza vacío | `TRUST_PRINCIPAL_UNKNOWN` |
| `principal_key_revoked` | una instantánea reciente revoca una clave del principal | `REVOCATION_REVOKED` |
| `agent_key_revoked` | una instantánea reciente revoca una clave del agente | `REVOCATION_REVOKED` |
| `other_audience` | el bundle firmado para otro verificador | `PROFILE_AUDIENCE_MISMATCH`, `VERIFICATION_FAILED` |
| `session_expired` | el reloj 1 ms después de la caducidad firmada | `PROFILE_SESSION_EXPIRED`, `VERIFICATION_FAILED` |
| `rotation_new_keys_not_enrolled` | bundle rotado, conjunto de confianza sin actualizar | `TRUST_KEY_NOT_ANCHORED` |
| `rotation_overlap_new_keys` | claves antiguas y nuevas activas | admitido |
| `rotation_overlap_old_keys` | lo mismo, bundle original | admitido |
| `rotation_old_keys_retired` | claves antiguas `revoked`, bundle original | `TRUST_KEY_REVOKED` |
| `rotation_new_keys_after_retirement` | lo mismo, bundle rotado | admitido |

Una discrepancia escribe una reproducción mínima en el directorio de salida: todo lo que se le dio al consumidor
para esa admisión, incluidos el conjunto de confianza y el perfil **efectivos** del inquilino (los últimos
cargados, también cuando los cargó un caso anterior, con `configuration_loaded_in`), y lo que
devolvió. Solo material público: ninguna clave privada.

```bash
node tools/interop-matrix/admission.mjs --replay tools/interop-matrix/out/admission/<producer>-<consumer>-<case>.json
```

`--replay` inicia un consumidor nuevo del SDK registrado, configura el inquilino registrado, admite el
bundle registrado en el reloj registrado y exige exactamente la salida registrada: cada clave de
ambos lados (los campos normalizados, los códigos, los errores del verificador y `error` cuando una llamada
falló), y una clave presente en un solo lado es una diferencia, así que dos errores distintos nunca cuentan
como una reproducción. Sale con 0 cuando se reproduce, 1 cuando difiere y 2 cuando el registro está incompleto.

**Control negativo.** Tras la matriz, el ejecutor se inicia a sí mismo con `--negative-control` sobre el
par `ts`, en un directorio temporal nuevo y con un nuevo id de ejecución, durante 120 s como máximo. Esa ejecución invierte el
`admitted` esperado de `trust_withdrawn`. El control pasa solo si el hijo sale con 1 y su
informe es el que escribió en esta ejecución (mismo id de ejecución) con `negative_control_run: true`, el único
par `ts>ts` con 12 de 13, y exactamente un fallo, el campo `admitted` de `trust_withdrawn`.
`--check-negative-control` prueba el propio control: debe aceptar una ejecución correcta y rechazar un
hijo que no puede iniciarse (sin informe, y con un informe dejado por una ejecución anterior en el mismo directorio)
y un hijo que se cuelga (detenido al llegar al límite de tiempo). `--negative-control-case NAME` invierte otro
caso en su lugar, para producir a propósito un archivo de reproducción.

Primera ejecución: 16 pares × 13 casos = 208 resultados según lo esperado, y el control negativo falló como
se requería.

<a id="what-the-first-run-found"></a>

## Qué encontró la primera ejecución

Los 16 pares de SDK y el verificador de referencia coinciden en cada bundle y en cada ataque. Escribir los
agentes sacó a la luz estas carencias de los SDK, ninguna de ellas una divergencia de veredicto entre los verificadores de los SDK:

- **`SignBundleV2` de Go dejaba vacío `signature.signer.id`**: no recibía ningún id de firmante. Los cuatro
  verificadores de los SDK aceptaban ese bundle; el verificador de referencia, la CLI y el servidor lo rechazaban
  (`signer/id must NOT have fewer than 6 characters`). Corregido: el firmante es ahora el `human_id` del RPR del bundle,
  y el agente de Go usa `SignBundleV2` tal cual. El bloque `signature.signer` (`id`, `kids`),
  `created_at` y `manifest_hash` son metadatos no autenticados fuera del manifiesto firmado: ningún
  verificador los contrasta con el RPR ni recalcula `manifest_hash` (los cinco aceptan ceros);
  solo el esquema limita su forma.
- **Los tipos de carga útil de Go carecían de campos de nivel**: `IntentV2` no tenía `security_tier` y
  `PolicyDecisionV2` no tenía `resolved_tier`. Ahora existen ambos. (`contact` y `target.to` son opcionales en
  el esquema, así que los mapas del agente de Go escriben `null` solo para ajustarse al contrato.)
- **La API nativa de Rust no tenía constructor ni firmante de bundles**, así que el agente de Rust montaba el manifiesto
  y lo firmaba a partir de las primitivas. Corregido: `build_bundle_v2` y `sign_bundle_v2`
  (`dcp_ai::v2::bundle`), que el agente usa ahora. `wasm_build_bundle` y
  `wasm_sign_bundle` de la feature `wasm` los llaman ahora; antes, `wasm_sign_bundle` escribía `created_at ""` y ningún
  `signer.id`, así que el verificador de referencia rechazaba todos los bundles que firmaba.
- **Un registro de auditoría vacío**: todos los verificadores aceptan un bundle firmado válidamente sin entradas de auditoría,
  como permite `spec/VERIFICATION.md` (raíz de 64 ceros); las ayudas `auditEventsMerkleRoot`, que
  sirven a los checkpoints PQ, rechazan una lista vacía en los cuatro SDK por igual.

> **Nota (25/10/2026).** Los hallazgos anteriores se conservan tal como se registraron en la primera ejecución. El primero ya no se cumple
> en `main`: los cuatro verificadores de los SDK comprueban ahora el bloque `signature` sin firmar contra lo que está firmado
> (`spec/VERIFICATION.md` V2-4): `signer.id` debe ser el `human_id` del RPR, `signer.kids` los kids de la firma
> compuesta, `manifest_hash` el SHA-256 del manifiesto canónico y `hash_alg` un valor permitido, así que los ceros se
> rechazan. `signature.created_at` sigue siendo un metadato sin firmar que ningún verificador autentica.

<a id="roadmap"></a>

## Hoja de ruta

1. Escenarios 1 (de DCP-01 a 03) y 2 (admisión), en CI.
2. DCP-04: hoy todos los SDK construyen `A2A_HELLO` y `A2A_WELCOME`, pero ninguno implementa
   `A2A_CONFIRM` / `A2A_ESTABLISHED` ni la derivación de la clave de sesión de DCP-04 §3.4, solo TypeScript
   tiene el KEM híbrido X25519 + ML-KEM-768 que anuncian los mensajes, y Rust no tiene capa de sesión.
   Cuando lo hagan, el protocolo ganará `hello`, `welcome`, `confirm`, `send` y `receive`, y el
   orquestador reenviará, reordenará y empalmará mensajes entre los dos agentes.
3. Cadenas de mandatos de DCP-09 construidas salto a salto por agentes de distintos SDK.
