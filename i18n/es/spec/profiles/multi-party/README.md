<sub>[English](../../../../../spec/profiles/multi-party/README.md) · [中文](../../../../zh-CN/spec/profiles/multi-party/README.md) · **Español** · [日本語](../../../../ja/spec/profiles/multi-party/README.md) · [Português](../../../../pt-BR/spec/profiles/multi-party/README.md)</sub>

<a id="multi-party-authorization-profile-mpa-v1"></a>

# Perfil de autorización multiparte: `mpa-v1`

> Traducción informativa de [la especificación en inglés](../../../../../spec/profiles/multi-party/README.md), actualizada el 24/11/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Borrador, v1
**Alcance:** Si una autorización multiparte autoriza una operación sobre un objetivo, para un verificador, bajo una política que fijó el operador

---

<a id="1-purpose-and-layering"></a>

## 1. Propósito y capas

Una autorización multiparte ([`multi_party_authorization.schema.json`](../../../../../schemas/v2/multi_party_authorization.schema.json)) enumera las firmas compuestas de varias partes sobre una operación. Por sí sola no decide nada: su `required_parties` no está firmado, cada rol lo escribe la parte que lo firma, y nada en ella dice qué partes pueden hablar por el objeto de la operación, dónde puede usarse la autorización ni hasta cuándo.

`mpa-v1` es un perfil opt-in que hace que decida. No cambia el esquema del registro ni lo que firma una parte. Añade:

1. **Una petición firmada** (§2.2) dentro de `operation_payload`: el objetivo, la audiencia y la ventana de validez, que cada parte firma porque forman parte de lo que ya firma.
2. **La política del operador** (§2.3): para cada objetivo, sus partes con sus roles, y para cada operación cuántas partes necesita y con qué roles.
3. **Las claves que el operador tiene de las partes** (§2.4): el conjunto de confianza de principales del [perfil de admisión](../../../../../spec/profiles/admission/README.md).

Se mantienen separadas tres preguntas, y solo la tercera da `authorized`:

| Capa | Pregunta | Se lee de |
|---|---|---|
| Estructura | ¿Está bien formado el registro? | Solo el registro |
| Verificación | ¿Qué partes firmaron exactamente esta petición? | Las claves en las que el operador confía para cada parte |
| Autorización | ¿Puede el ejecutor llevar a cabo esta operación sobre este objetivo ahora? | La política del operador y lo que el ejecutor está a punto de hacer |

Una comprobación solo de la estructura (§8) no verifica ninguna firma y no autoriza nada.

Un registro sin la petición sigue siendo un registro v2.0 válido. Nunca se autoriza bajo este perfil: no hay modo heredado.

<a id="2-inputs"></a>

## 2. Entradas

<a id="21-clock"></a>

### 2.1 Reloj

Un único instante `now`, en milisegundos desde la época Unix, que se recibe como parámetro, con el reloj del sistema por defecto. Las marcas de tiempo son RFC 3339 con un desfase `Z` o `±hh:mm`, comparadas con precisión de milisegundos, como en el perfil de admisión. La tolerancia de desfase de reloj es de 30 segundos y se aplica solo a `issued_at`.

<a id="22-the-request"></a>

### 2.2 La petición

Bajo `mpa-v1`, `operation_payload` tiene exactamente dos miembros. Esquema: [`multi_party_request.schema.json`](../../../../../schemas/v2/multi_party_request.schema.json).

```json
{
  "request": {
    "profile": "mpa-v1",
    "request_id": "mpa:6f1c0a52d3b84e7f9a1c2d3e4f506172",
    "target": "agent:acme-bot",
    "audience": "verifier:acme-gateway",
    "issued_at": "2026-11-18T00:00:00Z",
    "expires_at": "2026-11-18T00:30:00Z"
  },
  "parameters": { "reason": "key_compromise" }
}
```

- `request` tiene exactamente estos seis miembros. `request_id` tiene de 1 a 128 caracteres; `target` y `audience`, de 1 a 256. Las longitudes cuentan puntos de código Unicode.
- `target` nombra el objeto de la operación tal como lo nombra la política del operador. `audience` nombra al verificador que puede actuar con la autorización.
- `parameters` es un objeto: los parámetros propios de la operación, vacío cuando no tiene ninguno.
- Todo número de `operation_payload` es un entero de -(2^53 - 1) a 2^53 - 1: los enteros que un binary64 guarda exactos. Fuera de ese rango, una implementación que lee los números de JSON como binary64 y otra que los lee exactos escriben textos `dcp-jcs-v1` distintos para el mismo registro, y una firma sobre un entero valdría para sus vecinos. Un valor mayor, como un identificador de 64 bits, va en una cadena.

Lo que firma una parte no cambia: `UTF8("DCP-AI.v2.MultiPartyAuth") || 0x00 || dcp-jcs-v1({operation, operation_payload, party_id, role})`. La firma clásica cubre esos bytes y la poscuántica los cubre seguidos de la firma clásica.

<a id="23-policy-set"></a>

### 2.3 Conjunto de políticas

Lo aporta solo el operador: configuración local o una fuente que eligió el operador. No debe (MUST NOT) derivarse del registro, de un parámetro de una petición o de una herramienta, ni de un registro en el que las peticiones puedan escribir. Esquema: [`multi_party_policy_set.schema.json`](../../../../../schemas/v2/multi_party_policy_set.schema.json).

```json
{
  "policy_set_version": "2026-11-18.1",
  "profile": "mpa-v1",
  "audience": "verifier:acme-gateway",
  "max_validity_seconds": 1800,
  "subjects": [
    {
      "target": "agent:acme-bot",
      "parties": [
        { "party_id": "human:alice", "role": "owner" },
        { "party_id": "human:bob", "role": "org_admin" },
        { "party_id": "human:carol", "role": "recovery_contact" }
      ],
      "operations": {
        "revoke_agent": {
          "required_parties": 2,
          "allowed_roles": ["owner", "org_admin", "recovery_contact"],
          "required_roles": ["owner"]
        }
      }
    }
  ]
}
```

Un conjunto de políticas se valida al cargarlo. Se rechaza, con el código de configuración de la tabla, cuando:

| Condición | Código |
|---|---|
| Un campo fuera del esquema en cualquier nivel | `CONFIG_UNKNOWN_FIELD` |
| Falta `policy_set_version` o está vacío; `profile` no es `mpa-v1`; `audience` no es una cadena de 1 a 256 caracteres; `max_validity_seconds` no es un entero de 1 a 86400; un rol o una operación fuera de las listas; `parties` vacío; `allowed_roles` vacío o con un rol repetido; `required_parties` menor que 2; `required_roles` que no está entre los `allowed_roles` | `CONFIG_INVALID_VALUE` |
| Un objetivo listado dos veces, o una parte listada dos veces para un mismo objetivo | `CONFIG_MPA_DUPLICATE` |
| `required_parties` mayor que el número de partes con un rol permitido, o un rol obligatorio que ninguna de esas partes tiene | `CONFIG_MPA_UNSATISFIABLE` |

Cuando un conjunto de políticas tiene varios de estos problemas, puede informarse el código de cualquiera de ellos.

No hay valores por defecto. Una operación que el operador no lista para un objetivo no se autoriza, y un conjunto de políticas sin sujetos es válido y no autoriza nada. Una parte tiene un rol por objetivo.

<a id="24-trust-set"></a>

### 2.4 Conjunto de confianza

Las claves de las partes salen del conjunto de confianza de principales del operador ([perfil de admisión, §2.2](../../../../../spec/profiles/admission/README.md#22-trust-set)), cargado por el mismo validador: una parte es un `human_id` de ese conjunto. Un kid se deriva de su clave, y un kid listado dos veces se rechaza al cargar el conjunto (`CONFIG_TRUST_DUPLICATE`). Así, una clave no puede atribuirse a dos partes, y un firmante no puede contar dos veces. La evaluación solo acepta un conjunto de confianza que se cargó.

Los dos se cargan por separado. Una parte de la política que el conjunto de confianza no tiene no es un error de configuración: sus firmas reciben `MPA_KEY_NOT_ANCHORED`.

<a id="3-what-the-executor-states"></a>

## 3. Lo que declara el ejecutor

El ejecutor da la operación, el objetivo y los parámetros que está a punto de llevar a cabo. Tienen que ser una operación de la lista, un objetivo de 1 a 256 caracteres y un objeto de datos JSON cuyos números sean enteros del rango de §2.2. Si no, la llamada se rechaza como error de configuración (`CONFIG_INVALID_VALUE`) y no da ningún resultado. La autorización tiene que ser exactamente para eso.

<a id="4-evaluation"></a>

## 4. Evaluación

Cinco fases. Una fase que añade un código detiene las siguientes, así que no se verifica ninguna firma de una petición mal formada, ajena o caducada. La primera fase se detiene en su primer fallo, en el orden de abajo; las demás añaden todos los códigos que apliquen. La evaluación es estricta: una autorización que falla hace rechazar el registro, aunque las demás alcancen el umbral.

| Fase | Comprobación | Código |
|---|---|---|
| 1. Estructura | El registro cumple su esquema | `MPA_SCHEMA_INVALID` |
| | `operation_payload` tiene un miembro `request` | `MPA_REQUEST_MISSING` |
| | `operation_payload` cumple §2.2, con instantes RFC 3339 | `MPA_REQUEST_INVALID` |
| | `operation_payload` es representable en `dcp-jcs-v1` y todos sus números están en el rango de §2.2 | `MPA_NOT_REPRESENTABLE` |
| | Como máximo 16 autorizaciones | `MPA_TOO_MANY_AUTHORIZATIONS` |
| 2. Vínculo | `operation` es la que declara el ejecutor | `MPA_OPERATION_MISMATCH` |
| | `request.target` es el que declara el ejecutor | `MPA_TARGET_MISMATCH` |
| | `parameters` son los que declara el ejecutor, comparados en forma canónica | `MPA_PARAMETERS_MISMATCH` |
| | `request.audience` es la `audience` del conjunto de políticas | `MPA_AUDIENCE_MISMATCH` |
| | `issued_at` no es posterior a `now` más la tolerancia | `MPA_NOT_YET_VALID` |
| | `expires_at` es posterior a `now` | `MPA_EXPIRED` |
| | `expires_at` es posterior a `issued_at`, como máximo en `max_validity_seconds` | `MPA_VALIDITY_INVALID` |
| | El conjunto de políticas tiene un sujeto para `request.target` | `MPA_TARGET_UNKNOWN` |
| | Ese sujeto lista la operación | `MPA_OPERATION_NOT_ALLOWED` |
| 3. Partes | Cada `party_id` es una parte del sujeto | `MPA_PARTY_UNKNOWN` |
| | Cada `party_id` aparece una vez | `MPA_PARTY_DUPLICATE` |
| | El rol firmado es el que el operador da a la parte | `MPA_ROLE_MISMATCH` |
| | Ese rol está permitido para la operación | `MPA_ROLE_NOT_ALLOWED` |
| 4. Verificación | Vínculo `pq_over_classical`, un algoritmo clásico en el hueco clásico y uno poscuántico en el otro | `MPA_HYBRID_REQUIRED` |
| | Cada kid es una clave de esa parte en el conjunto de confianza, con ese algoritmo | `MPA_KEY_NOT_ANCHORED` |
| | Esa clave no está revocada, no está caducada y ya es válida en `now` | `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID` |
| | Las dos firmas están en base64 canónico y verifican sobre los bytes de §2.2 | `MPA_SIGNATURE_INVALID` |
| 5. Decisión | Autorizaron al menos las `required_parties` de la política | `MPA_THRESHOLD_NOT_MET` |
| | Cada rol de `required_roles` lo tiene una parte que autorizó | `MPA_REQUIRED_ROLE_MISSING` |

- `required_parties` del registro no está firmado y nunca se lee.
- En la fase 3 el rol que cuenta es el del operador: `MPA_ROLE_MISMATCH` cuando el firmado es otro, `MPA_ROLE_NOT_ALLOWED` cuando el del operador no está permitido para la operación. Pueden aplicarse los dos. Una parte desconocida recibe `MPA_PARTY_UNKNOWN` y nada más.
- En la fase 4 cada clave recibe el primero que aplique de no anclada, revocada, caducada (`status` `expired`, o `expires_at` anterior a `now`) y aún no válida (`not_before` posterior a `now`). Una firma se verifica solo cuando las dos claves pueden contar.

<a id="5-result"></a>

## 5. Resultado

<a id="51-verdicts"></a>

### 5.1 Veredictos

`structure` es `valid` o `invalid`. `verification` es `verified`, `failed`, o `not_evaluated` cuando no se llegó a la fase 4. `authorized` es verdadero solo cuando ninguna fase añadió un código.

<a id="52-fields"></a>

### 5.2 Campos

| Campo | Valor |
|---|---|
| `profile` | `"mpa-v1"` |
| `structure`, `verification`, `authorized` | §5.1 |
| `operation`, `target`, `request_id`, `expires_at` | Los firmados de un registro bien formado; si no, null |
| `parties` | Uno por autorización: `party_id`, `role` (el firmado) y `verified` (null cuando no se llegó a la fase 4) |
| `parties_counted` | Las autorizaciones sin ningún código en la fase 4; null cuando no se llegó a ella |
| `required_parties` | El umbral del operador; null cuando no se encontró ninguna regla para la operación sobre el objetivo |
| `policy_set_version`, `trust_set_version` | Las versiones de la configuración usada |
| `errors` | `{ code, message }` en el orden de las fases; dentro de una fase no se fija ningún orden |

<a id="53-codes"></a>

### 5.3 Códigos

| Código | Fase |
|---|---|
| `MPA_SCHEMA_INVALID`, `MPA_REQUEST_MISSING`, `MPA_REQUEST_INVALID`, `MPA_NOT_REPRESENTABLE`, `MPA_TOO_MANY_AUTHORIZATIONS` | 1 |
| `MPA_OPERATION_MISMATCH`, `MPA_TARGET_MISMATCH`, `MPA_PARAMETERS_MISMATCH`, `MPA_AUDIENCE_MISMATCH`, `MPA_NOT_YET_VALID`, `MPA_EXPIRED`, `MPA_VALIDITY_INVALID`, `MPA_TARGET_UNKNOWN`, `MPA_OPERATION_NOT_ALLOWED` | 2 |
| `MPA_PARTY_UNKNOWN`, `MPA_PARTY_DUPLICATE`, `MPA_ROLE_MISMATCH`, `MPA_ROLE_NOT_ALLOWED` | 3 |
| `MPA_HYBRID_REQUIRED`, `MPA_KEY_NOT_ANCHORED`, `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID`, `MPA_SIGNATURE_INVALID` | 4 |
| `MPA_THRESHOLD_NOT_MET`, `MPA_REQUIRED_ROLE_MISSING` | 5 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_MPA_DUPLICATE`, `CONFIG_MPA_UNSATISFIABLE` | Se lanzan al cargar un conjunto de políticas, o por lo que declara el ejecutor (§3) |
| `CONFIG_TRUST_*` | Se lanzan al cargar el conjunto de confianza (perfil de admisión, §2.2) |

Los mensajes tienen como máximo 300 caracteres y nunca contienen claves privadas, tokens ni la configuración del operador más allá de los identificadores que se comparan.

<a id="6-adapters"></a>

## 6. Adaptadores

Las funciones del núcleo son deterministas, no hacen ninguna llamada de red y no guardan estado. Un adaptador (un servidor, una herramienta, un middleware) resuelve la configuración del operador y aplica la decisión:

- **A1.** La operación se ejecuta solo cuando `authorized` es verdadero, y es la operación, sobre el objetivo y con los parámetros que se dieron a la evaluación.
- **A2.** El conjunto de políticas, el conjunto de confianza, sus fuentes, la audiencia y el inquilino salen del código y de la configuración del operador. Ningún campo, cabecera ni parámetro de herramienta de una petición los selecciona ni los cambia.
- **A3.** Una operación que no es idempotente es de un solo uso, y hacerlo cumplir le toca al adaptador (§7).

<a id="7-guarantees-and-limits"></a>

## 7. Garantías y límites

Con `authorized` verdadero:

- cada autorización la firmó, con los dos componentes, una parte distinta con claves que el conjunto de confianza del operador enumera para ella, utilizables en `now`;
- cada parte tiene sobre ese objetivo el rol que firmó, y el operador permite ese rol para la operación;
- la autorizaron al menos tantas partes como el operador exige para esa operación sobre ese objetivo, y los roles obligatorios están entre ellas;
- todas firmaron la operación, el objetivo y los parámetros que declaró el ejecutor, para este verificador, dentro de una ventana que el operador acepta.

**No** garantiza:

- **Un solo uso.** La evaluación no guarda estado y no consume `request_id`: dos evaluaciones de la misma petición, también simultáneas, dan las dos `authorized`. Un ejecutor cuya operación no es idempotente registra el `request_id` que ha consumido hasta `expires_at`, y consume y ejecuta de forma atómica: en una transacción, o reservando el identificador antes de ejecutar y no ejecutando cuando la reserva ya existía. Comprobar primero y registrar después deja pasar dos ejecuciones concurrentes.
- **Que lo autorizado sea lo que se ejecuta.** El ejecutor declara lo que está a punto de hacer; hacer exactamente eso es cosa suya.
- **Identidad más allá de la configuración.** La decisión es exactamente tan buena como el conjunto de confianza del operador, el conjunto de políticas y sus fuentes.
- **Competencia o independencia de las partes.** Dos claves no son dos personas, y una firma no demuestra que se revisara nada.
- **Una revocación más reciente que el conjunto de confianza que se cargó.**

<a id="8-api-correspondence"></a>

## 8. Correspondencia de API

| Concepto | TypeScript (`@dcp-ai/sdk`) | Python (`dcp_ai.v2`) | Go (`dcp/v2`) | Rust (`dcp_ai::v2::multi_party_auth`) |
|---|---|---|---|---|
| Comprobar la estructura | `checkMultiPartyAuthorizationStructure(record, policy?)` | `check_multi_party_authorization_structure(record, policy=None)` | `CheckMultiPartyAuthorizationStructure(record, policy)` | `check_multi_party_authorization_structure(&record, policy)` |
| Cargar un conjunto de políticas | `createMultiPartyPolicyStore(json)` | `create_multi_party_policy_store(json)` | `NewMultiPartyPolicyStore(json)` | `MultiPartyPolicyStore::from_json(&json)` |
| Evaluar | `evaluateMultiPartyAuthorization(record, registry, { policy, trust, expected, now? })` | `evaluate_multi_party_authorization(record, registry, policy=…, trust=…, expected=…, now_ms=…)` | `EvaluateMultiPartyAuthorization(registry, json, options)` | `evaluate_multi_party_authorization(&record, &options)` |
| Construir la petición | `createMultiPartyRequest(input)` | `create_multi_party_request(…)` | `NewMultiPartyRequest(input)` | `create_multi_party_request(&input)` |
| Firmar como parte | `createPartyAuthorization(…)` | `create_party_authorization(…)` | `CreatePartyAuthorization(…)` | `create_party_authorization(…)` |
| Error de configuración | `MultiPartyConfigError` (`code`) | `MultiPartyConfigError` (`code`) | `*MultiPartyConfigError` (`Code`) | `MultiPartyConfigError` (`code`) |

Los campos del resultado conservan los nombres de §5.2 en la forma JSON de cada SDK.

La comprobación de la estructura mira el número de autorizaciones, sus roles y la presencia de un `composite_sig`, contra una política de forma propia. No verifica ninguna firma, no conoce a ninguna parte y no lee ninguna política del operador. En Python, Go y Rust se publicó como `verify_multi_party_authorization` / `VerifyMultiPartyAuthorization`; ese nombre está obsoleto y da el mismo resultado.

<a id="9-test-vectors"></a>

## 9. Vectores de prueba

[`tests/interop/v2/multi_party_vectors.json`](../../../../../tests/interop/v2/multi_party_vectors.json) contiene los casos compartidos: registros, conjuntos de confianza, un conjunto de políticas, lo que declara el ejecutor, `now`, y para cada caso los valores esperados de `authorized`, `structure`, `verification`, `parties_counted`, `required_parties` y el conjunto de códigos, con la regla que comprueba. Los casos de configuración dan un conjunto de políticas, o un conjunto de confianza, y el código esperado. Todos los SDK los ejecutan; el criterio no es que los SDK coincidan entre sí, sino los valores esperados. [`generate-multi-party-vectors.mjs`](../../../../../tests/interop/v2/generate-multi-party-vectors.mjs) escribe el archivo y comprueba cada expectativa contra un evaluador propio, escrito sin código de los SDK.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 18/11/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> el código de referencia de `main` se relaciona con este texto. Donde difieran, prevalece el texto normativo anterior.

- **Dónde está implementado.** Los cuatro SDK de `main` implementan este perfil. Ninguna versión publicada lo tiene: el SDK de TypeScript publicado exporta solo los tipos del registro, y los SDK de Python, Go y Rust publicados tienen únicamente la comprobación de la estructura, con su nombre anterior.
- **El servidor de referencia.** `POST /v2/multi-party/authorize` aplica este perfil bajo el conjunto de políticas del operador (`DCP_MULTI_PARTY_POLICY_FILE`) y no existe sin él. Solo responde al token del operador y no ejecuta nada: véase [server/README.md](../../../../../server/README.md).
- **Ninguna operación consume una autorización.** Nada en este repositorio lleva a cabo `revoke_agent`, `rotate_org_key`, `change_jurisdiction` ni `modify_recovery_config` a partir de una autorización multiparte. El perfil decide; un adaptador ejecuta.
- **Quién revisó los vectores.** El evaluador del generador y las cuatro implementaciones tienen el mismo autor. Que coincidan no es una revisión independiente.
