<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="admission-profile-principal-trust-and-strict-v1"></a>

# Perfil de admisión: confianza en el principal y `strict-v1`

> Traducción informativa de [la especificación en inglés](README.md), actualizada el 28/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Borrador, v1
**Alcance:** Si un verificador admite un bundle V2 firmado como evidencia procedente de un principal en el que ya confía, bajo un perfil fijado por el operador

---

<a id="1-purpose-and-layering"></a>

## 1. Propósito y capas

[VERIFICATION.md](../../VERIFICATION.md) (V2-1 a V2-14) decide si un bundle está **verificado**: sus artefactos están intactos, son coherentes y están firmados por las claves que enumera el propio bundle. Cualquiera puede crear un responsible principal record (RPR) con cualquier `human_id` y claves propias, así que un bundle verificado prueba integridad y firma, no quién es el principal.

La admisión añade dos capas opcionales encima de la verificación, sin cambiarla:

1. **Confianza en el principal** (§3): las claves que firmaron por el principal pertenecen a un principal en el que el operador ya confía, según un conjunto de confianza que aporta el operador.
2. **El perfil `strict-v1`** (§4): requisitos fijos, elegidos por el operador (firmas híbridas, audiencia, una ventana de sesión firmada y corta, estado de revocación reciente), que una petición no puede rebajar.

Un verificador que no habilita ninguna de las dos se comporta exactamente como antes. La admisión nunca reimplementa un paso de verificación: lee lo que informa el verificador (§2.3).

La admisión decide si se admite una **evidencia**. No autoriza una acción: esta versión nunca vincula una autorización externa con una herramienta, sus argumentos o su ejecución (§7).

<a id="2-inputs"></a>

## 2. Entradas

<a id="21-clock"></a>

### 2.1 Reloj

Toda comparación de tiempo en la verificación y en la admisión usa un único instante `now`, en milisegundos desde la época Unix. Las implementaciones lo reciben como parámetro, con el reloj del sistema por defecto. Las marcas de tiempo son RFC 3339 con un desfase `Z` o `±hh:mm`, comparadas con precisión de milisegundos, como en V2-4. La tolerancia de desfase de reloj es de 30 segundos (`SKEW`), la misma que en V2-4 y DCP-04.

<a id="22-trust-set"></a>

### 2.2 Conjunto de confianza

Lo aporta solo el operador: configuración local o una fuente que eligió el operador. No debe (MUST NOT) derivarse del bundle (de sus claves, de `legal_name`, de `jurisdiction` ni de ningún otro campo autodeclarado), de un parámetro de una petición o de una herramienta, ni de una URL que nombre el RPR. Esquema: [`principal_trust_set.schema.json`](../../../schemas/v2/principal_trust_set.schema.json).

```json
{
  "trust_set_version": "2026-11-01.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active",
          "not_before": null, "expires_at": "2027-06-01T00:00:00Z" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active" }
      ]
    }
  ]
}
```

Un conjunto de confianza se valida cuando se carga. Se rechaza, con el código de error de configuración entre corchetes, cuando:

| Condición | Código |
|---|---|
| Un campo fuera del esquema, en cualquier nivel | `CONFIG_UNKNOWN_FIELD` |
| `trust_set_version` ausente o que no es una cadena no vacía; `principals` que no es un array; las `keys` de un principal que no son un array no vacío; `status` que no es `active`, `revoked` ni `expired`; `not_before` o `expires_at` que no son ni null ni RFC 3339 | `CONFIG_INVALID_VALUE` |
| `human_id` ausente, que no es una cadena o vacío | `CONFIG_TRUST_EMPTY_ID` |
| `alg` que no es `ed25519`, `ml-dsa-65` ni `slh-dsa-192f`; `public_key_b64` que no está en base64 canónico (V2-5) o que no tiene 32, 1952 o 48 bytes para ese algoritmo | `CONFIG_TRUST_MALFORMED_KEY` |
| `kid` que no es el kid derivado de `alg` y de los bytes de la clave (V2-13) | `CONFIG_TRUST_KID_NOT_DERIVED` |
| Un `human_id` listado dos veces, o un `kid` listado dos veces en todo el conjunto (bajo un principal o bajo dos) | `CONFIG_TRUST_DUPLICATE` |

Cualquier duplicado se rechaza, sea idéntico o no: un operador que fusiona fuentes los resuelve antes de cargarlas. Un conjunto de confianza sin principales es válido y no confía en nadie.

El estado de una clave que prevalece es el del conjunto de confianza. Un bundle que lista una clave como `active` no puede rehabilitar una que el conjunto de confianza marca como `revoked` o `expired`, o cuyo `expires_at` ya ha pasado.

La **rotación** es una actualización explícita del conjunto de confianza (una nueva `trust_set_version`): el operador añade la clave nueva, mantiene la antigua `active` durante un solapamiento si hace falta y después la retira (`revoked`, `expired`, un `expires_at` o eliminándola). Un bundle no puede autorizar su propia rotación, porque sus claves nunca son una fuente de confianza.

Las claves del agente no se registran en el conjunto de confianza. El agente queda vinculado al principal por la firma del principal sobre el manifiesto, que cubre `passport_hash` (V2-6, V2-7).

<a id="23-signer-keys-reported-by-the-verifier"></a>

### 2.3 Claves de los firmantes que informa el verificador

Para cada firma compuesta que comprueba (la firma del bundle sobre el manifiesto, los cuatro artefactos, cada checkpoint PQ), el verificador informa, por componente, de la entrada de clave que resolvió y de si ese componente se verificó:

```json
{ "signature": "bundle", "component": "classical", "kid": "…", "alg": "ed25519",
  "public_key_b64": "…", "verified": true }
```

`signature` es `bundle`, `responsible_principal_record`, `agent_passport`, `intent`, `policy_decision` o `pq_checkpoints[<checkpoint_id>]`; `component` es `classical` o `pq`. Un componente cuya clave no resolvió el verificador (una clave clásica ausente bajo `pq_only`) no se informa. Son las claves que verificaron realmente las firmas, resueltas exactamente como las resolvió el verificador; la admisión nunca resuelve las claves de otra forma. La lista se define para un bundle verificado; para uno que no se verificó, las implementaciones pueden detenerse en el primer fallo o continuar, y la admisión no la usa.

Las **firmas del principal** son `bundle` y `responsible_principal_record`.

<a id="24-revocation-snapshot"></a>

### 2.4 Instantánea de revocación

La exige `strict-v1`. El adaptador del operador la obtiene de una fuente local o remota que configuró el operador (no hace falta ningún servicio central) para los **sujetos de revocación** del bundle: el `agent_id` del pasaporte y el kid de cada clave de firmante verificada (§2.3), incluidas todas las firmas. Esquema: [`revocation_snapshot.schema.json`](../../../schemas/v2/revocation_snapshot.schema.json).

```json
{ "checked_at": "2026-11-01T00:00:20Z",
  "agents": { "agent:acme-bot": "not_revoked" },
  "keys": { "<kid>": "not_revoked", "<kid>": "not_revoked" } }
```

`checked_at` es el momento en que la fuente estableció estos estados, no cuando los leyó el adaptador. Cada estado es `revoked`, `not_revoked` o `unknown`. Una fuente que no puede responder (tiempo agotado, error, inalcanzable) no produce ninguna instantánea; un adaptador no debe (MUST NOT) convertir un fallo en `not_revoked`.

<a id="3-principal-trust"></a>

## 3. Confianza en el principal

Se evalúa solo cuando se aporta un conjunto de confianza y el bundle se verificó (V2-1 a V2-14); si no, el resultado es `not_evaluated`. Con `human_id` el `human_id` de la carga útil del RPR:

- **T1.** `human_id` no es un principal del conjunto de confianza: `TRUST_PRINCIPAL_UNKNOWN`. Fin.
- **T2.** Para cada componente verificado de cada firma del principal (§2.3), la entrada del conjunto de confianza de ese principal con el mismo `kid`, con la primera de estas que se aplique:
  - ninguna, o un `alg` distinto o bytes de clave distintos: `TRUST_KEY_NOT_ANCHORED`;
  - `status` `revoked`: `TRUST_KEY_REVOKED`;
  - `status` `expired`, o `expires_at` anterior a `now`: `TRUST_KEY_EXPIRED`;
  - `not_before` posterior a `now`: `TRUST_KEY_NOT_YET_VALID`.

Un bundle verificado sin ningún componente verificado del principal recibe también `TRUST_KEY_NOT_ANCHORED`. El principal es `trusted` cuando T1 y T2 no añaden ningún código, y `untrusted` en caso contrario. Cuenta cada componente verificado: confiar solo en la clave Ed25519 de un principal no hace de confianza su clave PQ ni ninguna otra clave del RPR.

<a id="4-the-strict-v1-profile"></a>

## 4. El perfil `strict-v1`

<a id="41-configuration"></a>

### 4.1 Configuración

Esquema: [`admission_profile.schema.json`](../../../schemas/v2/admission_profile.schema.json).

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example",
  "max_session_duration_seconds": 300, "max_revocation_age_seconds": 300,
  "verifier_policy": { "advisory_rejected_algs": ["slh-dsa-192f"] } }
```

| Campo | Regla |
|---|---|
| `profile` | Obligatorio, `"strict-v1"` |
| `verifier_id` | Obligatorio, una cadena no vacía; el `intended_verifier` firmado del bundle debe ser igual a él |
| `max_session_duration_seconds` | Entero de 1 a 300, por defecto 300 |
| `max_revocation_age_seconds` | Entero de 1 a 300, por defecto 300 |
| `verifier_policy` | Campos opcionales de VerifierPolicy; cada uno solo puede mantener o endurecer la política del perfil (§4.2) |

El perfil fija requisitos, no valores predeterminados. Su política de verificador es:

| Campo | Valor | Qué puede fijar `verifier_policy` |
|---|---|---|
| `default_mode`, cada nivel de `risk_overrides` | `hybrid_required` | Solo `hybrid_required`. `pq_only` prescinde de la firma clásica, así que no satisface el perfil |
| `require_session_binding`, `require_composite_binding`, `require_session_expiry`, `require_audience_binding` | `true` | Solo `true` |
| `allow_v1_bundles`, `allow_classical_fallback_disable` | `false` | Solo `false` |
| `verifier_id` | el del perfil | Solo el mismo valor |
| `max_session_duration_seconds` | el del perfil | De 1 al valor del perfil; se aplica el menor |
| `min_classical`, `min_pq` | `1` | Solo `1`: una firma compuesta tiene un componente clásico y uno PQ |
| `accepted_hash_algs` | `["sha256", "sha384"]` | Solo estos dos, en cualquier orden: los verificadores comprueban el `hash_alg` del bundle según V2-4 |
| `max_key_age_days` | `365` | Solo `365`: los verificadores solo avisan sobre la antigüedad de las claves |
| `accepted_classical_algs` | `["ed25519"]` | Un subconjunto no vacío |
| `accepted_pq_algs` | `["ml-dsa-65", "slh-dsa-192f"]` | Un subconjunto no vacío |
| `advisory_rejected_algs` | `[]` | Cualquier lista de cadenas |
| `warn_classical_only_deprecated` | `false` | Cualquier booleano (solo avisos) |

Cada campo que puede cambiar `verifier_policy` es uno que todos los verificadores aplican del mismo modo, así que un perfil nunca se carga con un requisito que algún SDK ignoraría o rechazaría en silencio.

Errores de configuración, que se lanzan cuando se carga el perfil:

| Condición | Código |
|---|---|
| Un campo fuera del esquema, en el nivel superior o en `verifier_policy` | `CONFIG_UNKNOWN_FIELD` |
| Un valor de tipo erróneo; `profile` que no es `"strict-v1"` | `CONFIG_INVALID_VALUE` |
| `verifier_id` ausente o vacío; un máximo por debajo de 1 o por encima de 300; un valor de `verifier_policy` que la tabla anterior no permite | `CONFIG_PROFILE_CONTRADICTION` |

Cuando una configuración tiene varios problemas, puede informarse del código de cualquiera de ellos.

Un adaptador que habilita el perfil rechaza también, con `CONFIG_PROFILE_CONTRADICTION`, la falta de conjunto de confianza o de fuente de revocación, y cualquiera de sus propias opciones que debilitaría el perfil (aceptar peticiones sin bundle, su propia política de verificador, una comprobación de revocación que falla en abierto).

<a id="42-profile-checks"></a>

### 4.2 Comprobaciones del perfil

Con `max` la duración máxima efectiva de la sesión y `m` el manifiesto del bundle:

- **P1.** `bundle.dcp_bundle_version` no es `"2.0"`: `PROFILE_V2_REQUIRED`. Fin: no se evalúa nada más.
- **P2.** `m.intended_verifier` ausente, null, que no es una cadena o vacío: `PROFILE_AUDIENCE_MISSING`; cualquier otro valor distinto de `verifier_id`: `PROFILE_AUDIENCE_MISMATCH`.
- **P3.** `m.session_issued_at` ausente o null: `PROFILE_SESSION_START_MISSING`. `m.session_expires_at` ausente o null: `PROFILE_SESSION_EXPIRY_MISSING`. Cualquiera de los dos presente pero que no es RFC 3339, o el inicio posterior a la caducidad: `PROFILE_SESSION_TIME_INVALID`. Si no:
  - el inicio posterior a `now + SKEW`: `PROFILE_SESSION_NOT_STARTED`;
  - la caducidad anterior a `now`: `PROFILE_SESSION_EXPIRED`;
  - la caducidad menos el inicio mayor que `max` segundos: `PROFILE_SESSION_TOO_LONG`.
- **P4.** El `composite_sig` de la firma del bundle o del RPR no es `pq_over_classical` con un componente `pq`: `PROFILE_HYBRID_REQUIRED`. Tras la verificación, también cuando a alguna firma del principal le falta un componente clásico o PQ verificado, o el modo de verificación no es `hybrid_required`.

P2 y P3 repiten, con códigos, lo que la política del perfil hace que aplique V2-4, para que un bundle rechazado diga qué requisito falló. Leen el manifiesto antes de que esté autenticado; solo se admite un bundle verificado.

<a id="43-revocation-checks"></a>

### 4.3 Comprobaciones de revocación

Se evalúan cuando el bundle se verificó, con los sujetos de §2.4:

- **R1.** No hay instantánea: `REVOCATION_UNAVAILABLE`. Fin.
- **R2.** Una instantánea fuera del esquema (un campo ausente o adicional, `checked_at` que no es RFC 3339, un estado distinto de los tres), o `checked_at` posterior a `now + SKEW`: `REVOCATION_INVALID`. Fin.
- **R3.** `now - checked_at` mayor que `max_revocation_age_seconds`: `REVOCATION_STALE`.
- **R4.** Un sujeto `revoked`: `REVOCATION_REVOKED`.
- **R5.** Un sujeto ausente de la instantánea o `unknown`: `REVOCATION_UNKNOWN`.

Una instantánea antigua que marca un sujeto como revocado informa de ambos códigos. Ninguno de estos resultados cuenta como `not_revoked`.

<a id="5-admission"></a>

## 5. Admisión

<a id="51-procedure"></a>

### 5.1 Procedimiento

Dados el bundle firmado, un perfil opcional, un conjunto de confianza opcional (obligatorio con el perfil), una instantánea de revocación (evaluada solo bajo el perfil) y `now`:

1. Bajo el perfil, P1; después P2, P3 y la parte estructural de P4.
2. Verifica el bundle (V2-1 a V2-14) en `now`, bajo la política del perfil, o bajo la política de quien llama si no hay perfil. No verificado: `VERIFICATION_FAILED`.
3. Si está verificado: confianza en el principal (§3) cuando se aporta un conjunto de confianza; bajo el perfil, la parte verificada de P4 y las comprobaciones de revocación (§4.3).

Una implementación puede exponer el paso 3 por sí solo (`evaluateAdmissionV2` y sus equivalentes) para que quien llama reutilice una verificación que ya tiene. Esa función confía en el resultado de verificación que recibe y no vuelve a verificar: debe ser el resultado del paso 2 para el mismo bundle, en el mismo `now`, bajo la política del perfil cuando hay perfil. Un resultado inventado, de otro bundle o bajo una política más débil da una respuesta errónea; la función combinada (`admitSignedBundleV2`) hace ambos pasos.

<a id="52-result"></a>

### 5.2 Resultado

| Campo | Valor |
|---|---|
| `verified` | El veredicto del verificador, con su significado sin cambios |
| `verification` | El resultado completo del verificador (errores, avisos, detalles, claves de los firmantes) |
| `principal_trust` | `trusted`, `untrusted` o `not_evaluated` (sin conjunto de confianza, o no verificado) |
| `profile` | `"strict-v1"` o null |
| `profile_compliance` | `compliant`, `non_compliant` o `not_evaluated` (sin perfil) |
| `admitted` | `verified`, y `principal_trust` es `trusted` cuando se aporta un conjunto de confianza, y `profile_compliance` es `compliant` bajo el perfil |
| `action_authorized` | Siempre `false` en esta versión (§7) |
| `recorded_decision` | El `decision` de la decisión de política (`approve`, `escalate`, `block`) de un bundle verificado; si no, null |
| `trust_set_version` | La versión del conjunto de confianza, o null |
| `errors` | `{ code, message }` por cada código añadido, en el orden de §5.1 |

`profile_compliance` es `compliant` cuando el bundle se verificó y no se añadió ningún código `PROFILE_*` ni `REVOCATION_*`. Un bundle que registra una decisión `block` o `escalate` puede admitirse como evidencia de esa decisión; `action_authorized` sigue siendo `false`.

Un bundle coherente consigo mismo de un principal desconocido sigue verificado, y no se admite cuando se aporta un conjunto de confianza.

<a id="53-codes"></a>

### 5.3 Códigos

| Código | Paso |
|---|---|
| `VERIFICATION_FAILED` | §5.1 paso 2 |
| `TRUST_PRINCIPAL_UNKNOWN`, `TRUST_KEY_NOT_ANCHORED`, `TRUST_KEY_REVOKED`, `TRUST_KEY_EXPIRED`, `TRUST_KEY_NOT_YET_VALID` | §3 |
| `PROFILE_V2_REQUIRED`, `PROFILE_AUDIENCE_MISSING`, `PROFILE_AUDIENCE_MISMATCH`, `PROFILE_SESSION_START_MISSING`, `PROFILE_SESSION_EXPIRY_MISSING`, `PROFILE_SESSION_TIME_INVALID`, `PROFILE_SESSION_NOT_STARTED`, `PROFILE_SESSION_EXPIRED`, `PROFILE_SESSION_TOO_LONG`, `PROFILE_HYBRID_REQUIRED` | §4.2 |
| `REVOCATION_UNAVAILABLE`, `REVOCATION_INVALID`, `REVOCATION_STALE`, `REVOCATION_REVOKED`, `REVOCATION_UNKNOWN` | §4.3 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_PROFILE_CONTRADICTION`, `CONFIG_TRUST_EMPTY_ID`, `CONFIG_TRUST_MALFORMED_KEY`, `CONFIG_TRUST_KID_NOT_DERIVED`, `CONFIG_TRUST_DUPLICATE` | Se lanzan cuando se carga un conjunto de confianza o un perfil |

Los mensajes están acotados y nunca contienen claves privadas, tokens ni la configuración del operador más allá de los identificadores que se comparan.

<a id="6-adapters-and-caching"></a>

## 6. Adaptadores y caché

Las funciones del núcleo son deterministas y no hacen ninguna llamada de red. Los adaptadores (middleware, herramientas, servidores) resuelven la configuración del operador, llaman a las fuentes de confianza y de revocación y aplican la decisión:

- **A1.** Una petición llega al manejador protegido solo cuando `admitted` es verdadero. Un adaptador nunca continúa solo con `verified` una vez configurados la confianza o un perfil, y rechaza en la configuración (`CONFIG_PROFILE_CONTRADICTION`) una opción que permitiría que una petición sin bundle llegue al manejador. Cuando el operador configuró una fuente de confianza, cada respuesta se carga como un conjunto de confianza (§2.2): una fuente que falla, o que no responde nada (`undefined`, `null`) o algo que no es un conjunto de confianza válido, rechaza la petición. Nunca equivale a «sin conjunto de confianza», que la evaluación de §5.1 interpreta como admisión sin confianza en el principal.
- **A2.** El perfil, el conjunto de confianza o su fuente, la fuente de revocación, su URL y sus credenciales, y el inquilino salen del código y de la configuración del operador. Ningún campo, cabecera ni parámetro de herramienta de una petición los selecciona ni los cambia. Una fuente remota se obtiene por TLS (HTTP sin cifrar solo hacia un host de loopback), sin seguir redirecciones, con un tamaño y un tiempo acotados.
- **A3.** Una caché puede (MAY) guardar el resultado del verificador (paso 2 de §5.1), con la clave del SHA-256 del bundle firmado canónico, del SHA-256 de la política de verificador efectiva canónica y del inquilino derivado por el operador, y conservado como máximo hasta el primero de su TTL, `session_expires_at`, el `expires_at` del RPR y el `expires_at` de cada clave. La confianza en el principal, las comprobaciones del perfil y la revocación se evalúan en cada admisión, en el `now` actual, con el conjunto de confianza actual y una instantánea de revocación reciente. Por tanto, una aceptación en caché nunca sobrevive a un cambio del conjunto de confianza, a una revocación, a una política distinta ni a un inquilino distinto.

<a id="7-guarantees-and-limits"></a>

## 7. Garantías y límites

Bajo `strict-v1`, un bundle admitido:

- se verificó según V2-1 a V2-14 con ambos componentes de firma válidos en cada firma;
- se firmó para el principal (RPR y manifiesto, ambos componentes) con claves que el conjunto de confianza del operador enumera para ese `human_id`, activas y dentro de su periodo de validez en `now`;
- nombra a este verificador en su `intended_verifier` firmado;
- tiene una ventana de sesión firmada de como máximo `max_session_duration_seconds`, iniciada (dentro de `SKEW`) y no caducada en `now`;
- tiene un agente y unas claves de firmante verificadas que una instantánea de revocación de como mucho `max_revocation_age_seconds` de antigüedad informa como no revocados.

**No** garantiza:

- **Un solo uso.** Un nonce de sesión compartido, la audiencia y la caducidad acotan dónde y durante cuánto tiempo puede reenviarse un bundle; no lo hacen de un solo uso. Un verificador que necesite un solo uso mantiene su propio registro de nonces o hashes de bundle consumidos; la verificación y la admisión no los consumen.
- **La autorización de una acción.** `action_authorized` es siempre `false`. La admisión dice que la evidencia es auténtica y viene de un principal de confianza; si una herramienta puede ejecutarse con unos argumentos dados es una fase posterior.
- **Identidad más allá del conjunto de confianza.** La confianza es exactamente tan buena como el conjunto de confianza del operador y su fuente.
- **Una revocación más reciente que la instantánea.** Una revocación hecha después de `checked_at` no se ve hasta la siguiente instantánea.

<a id="8-api-correspondence"></a>

## 8. Correspondencia de API

| Concepto | TypeScript (`@dcp-ai/sdk`) | Python (`dcp_ai.v2`) | Go (`dcp/v2`) | Rust (`dcp_ai::v2`) |
|---|---|---|---|---|
| Verificar en `now` | `verifySignedBundleV2(b, registry, policy, { now })` | `verify_signed_bundle_v2(b, registry, policy, now_ms=…)` | `VerifySignedBundleV2At(registry, json, policy, now)` | `verify_signed_bundle_v2_at(&b, &policy, now_ms)` |
| Claves de los firmantes (§2.3) | `details.signer_keys` | `details["signer_keys"]` | `SignerKeys` | `V2VerificationDetails.signer_keys` |
| Cargar un conjunto de confianza | `createPrincipalTrustStore(json)` | `create_principal_trust_store(json)` | `NewPrincipalTrustStore(json)` | `PrincipalTrustStore::from_json(&json)` |
| Cargar un perfil | `resolveStrictV1Profile(json)` | `resolve_strict_v1_profile(json)` | `ResolveStrictV1Profile(json)` | `resolve_strict_v1_profile(&json)` |
| Sujetos de revocación | `revocationSubjects(b, verification)` | `revocation_subjects(b, verification)` | `RevocationSubjects(b, verification)` | `revocation_subjects(&b, &verification)` |
| Evaluar (sin criptografía) | `evaluateAdmissionV2(input)` | `evaluate_admission_v2(…)` | `EvaluateAdmissionV2(…)` | `evaluate_admission_v2(…)` |
| Verificar y evaluar | `admitSignedBundleV2(b, registry, options)` | `admit_signed_bundle_v2(b, registry, …)` | `AdmitSignedBundleV2(registry, json, options)` | `admit_signed_bundle_v2(&b, &options)` |
| Error de configuración | `AdmissionConfigError` (`code`) | `AdmissionConfigError` (`code`) | `*AdmissionConfigError` (`Code`) | `AdmissionConfigError` (`code`) |

Los campos del resultado conservan los nombres de §5.2 en la forma JSON de cada SDK.

<a id="9-test-vectors"></a>

## 9. Vectores de prueba

[`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json) contiene los casos compartidos: bundles firmados, conjuntos de confianza, perfiles, instantáneas de revocación, `now` y, para cada caso, los valores esperados de `verified`, `principal_trust`, `profile_compliance`, `admitted` y el conjunto de códigos, con la regla que comprueba. Los casos de configuración dan la configuración y el código de error esperado. Todos los SDK los ejecutan; el criterio no es el acuerdo entre los SDK, sino los valores esperados.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Las referencias a V2-1 a V2-14 remiten a la lista de verificación normativa de [VERIFICATION.md](../../VERIFICATION.md). Los paquetes de los SDK anteriores a `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 y Rust `dcp-ai` 2.11.1 no comprueban los campos secundarios SHA3-256 de V2-11, así que con ellos «se verificó según V2-1 a V2-14» (§7) vale con ese límite; desde esas versiones los verificadores de los SDK comprueban los campos secundarios presentes, y los ausentes no se exigen. Siguen aplicándose todas las demás comprobaciones de verificación, la confianza en el principal y todas las
  comprobaciones de `strict-v1`; la cadena SHA-256 por sí sola nunca admite un bundle.
- El JSON de §2.2, §2.3, §2.4 y §4.1 ilustra las formas, con marcadores de posición (`…`, `<kid>`) para claves e
  identificadores; no es un fixture y no se carga tal cual. Las dos entradas `<kid>` de §2.4 representan dos kids reales
  distintos: una instantánea adaptada no tiene claves JSON duplicadas. Los casos compartidos y ejecutables están en
  [`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json) (§9).
- Las API de §8 están en los SDK de `main` y aún no están en una versión publicada.
