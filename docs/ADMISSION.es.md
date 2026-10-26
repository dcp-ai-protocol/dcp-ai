<sub>[English](ADMISSION.md) · [中文](ADMISSION.zh-CN.md) · **Español** · [日本語](ADMISSION.ja.md) · [Português](ADMISSION.pt-BR.md)</sub>

<a id="admission-trusted-principals-and-the-strict-v1-profile"></a>

# Admisión: principales de confianza y el perfil strict-v1

> Traducción informativa de [la versión en inglés](ADMISSION.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Un bundle verificado prueba su integridad y que fue firmado por las claves que enumera. Cualquiera puede crear un registro de principal responsable con cualquier `human_id` y claves propias, así que la verificación por sí sola no te dice **quién** es el principal.

La admisión añade lo que un operador necesita para aceptar evidencias solo de principales en los que ya confía:

- **Principales de confianza.** El operador proporciona un conjunto de confianza: el `human_id` de cada principal y las claves públicas con las que puede firmar. Un bundle se admite solo si las claves que realmente verificaron las firmas del principal (el RPR y el manifiesto del bundle, clásica y poscuántica) son claves de confianza de ese principal, activas y dentro de su ventana de validez.
- **El perfil strict-v1.** Opcional, versionado y fijado por el operador: firmas híbridas en todos los niveles de riesgo, un `intended_verifier` firmado igual al `verifier_id` del operador, una ventana de sesión firmada de 300 segundos como máximo y una instantánea de revocación con 300 segundos de antigüedad como máximo.

> **Estado de publicación (26/10/2026).** La admisión y `strict-v1` están publicados en `@dcp-ai/sdk` 2.2.0 y los adaptadores Express/OpenClaw 2.1.0. Véanse las [versiones npm](NPM_RELEASES.md). La publicación de Python, Go y Rust es independiente; usa sus checkouts para las API descritas aquí hasta que sus versiones las incluyan. El servidor de referencia y el CLI raíz siguen ejecutándose desde un checkout.

La definición normativa, con todas las reglas y códigos de error, es [`spec/profiles/admission`](../spec/profiles/admission/README.md). Los vectores de prueba compartidos están en [`tests/interop/v2/admission_vectors.json`](../tests/interop/v2/admission_vectors.json).

<a id="it-is-opt-in"></a>

## Es opt-in

La admisión se aplica solo al código que establece un conjunto de confianza o un perfil, y `verified` conserva su significado. Los verificadores también ganan un reloj opcional e informan de las claves que usaron, en la misma verificación. Esos mismos cambios alteran también la propia verificación, al margen de la admisión: véase [Compatibilidad](#compatibility).

<a id="the-trust-set"></a>

## El conjunto de confianza

Lo escribe el operador; nunca procede de un bundle, una solicitud, un parámetro de una herramienta ni una URL de un RPR. Esquema: [`schemas/v2/principal_trust_set.schema.json`](../schemas/v2/principal_trust_set.schema.json).

```json
{
  "trust_set_version": "2026-11-02.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active", "expires_at": "2027-06-01T00:00:00Z" }
      ]
    }
  ]
}
```

Se rechaza al cargarlo si un kid no se deriva de su clave, una clave está mal formada, un identificador está vacío o un `human_id` o un kid aparece dos veces. Los campos `status`, `not_before` y `expires_at` del conjunto de confianza son los que cuentan: un bundle que enumere una clave como `active` no puede restablecer una que el operador revocó.

**Rotación.** Añade las claves nuevas (con `not_before` si quieres), mantén las antiguas `active` durante el solapamiento y después retíralas (`revoked`, `expired`, un `expires_at` o eliminándolas), cada vez con un `trust_set_version` nuevo. Un bundle no puede rotar sus propias claves.

**Las claves del agente** no se enumeran: la firma del principal sobre el manifiesto cubre el hash del pasaporte, y eso vincula al agente y sus claves con el principal.

<a id="the-strict-v1-profile"></a>

## El perfil strict-v1

Esquema: [`schemas/v2/admission_profile.schema.json`](../schemas/v2/admission_profile.schema.json).

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example" }
```

| Requisito | Valor |
|---|---|
| Versión del bundle | Solo V2 |
| Firmas | Clásica y PQ, ambas válidas, en todos los niveles de riesgo (`hybrid_required`; `pq_only` no lo satisface) |
| Principal | De confianza (arriba), con ambos componentes de la firma anclados |
| Vinculación de sesión | Obligatoria |
| Ventana de sesión | `session_issued_at` y `session_expires_at` firmados en el manifiesto; como máximo `max_session_duration_seconds` (por defecto y como máximo 300); iniciada dentro de 30 s de desfase de reloj; no caducada |
| Audiencia | `intended_verifier` firmado igual a `verifier_id` |
| Revocación | Una instantánea del agente y de cada clave firmante verificada, con una antigüedad de como máximo `max_revocation_age_seconds` (por defecto y como máximo 300); ninguna revocada ni desconocida |

El perfil fija requisitos, no valores por defecto. `max_session_duration_seconds`, `max_revocation_age_seconds` y el `verifier_policy` opcional solo pueden endurecerlo; un valor que lo relajaría (`allow_v1_bundles: true`, `require_*: false`, un modo clásico o `pq_only`, una sesión más larga, otro `verifier_id`) es un error de configuración. Los adaptadores también rechazan sus propias opciones que lo relajarían.

<a id="revocation-sources"></a>

## Fuentes de revocación

La revocación la resuelve una fuente que elige el operador; no hace falta ningún servicio central. Una fuente recibe los sujetos (`agent_ids` y `kids`) y devuelve una instantánea:

```json
{ "checked_at": "2026-11-02T10:00:30Z", "agents": { "agent:acme-bot": "not_revoked" }, "keys": { "<kid>": "not_revoked" } }
```

`checked_at` es el momento en que la fuente estableció los estados. Una fuente que agota el tiempo, falla o no devuelve nada hace fallar la solicitud con `REVOCATION_UNAVAILABLE`; nada se trata nunca como no revocado por defecto.

`denyListRevocationSource` (integraciones de TypeScript, el verificador de referencia) y `deny_list_revocation_source` (Python) leen una lista de denegación completa en el formato de `/.well-known/dcp-revocations.json` del servicio de revocación de referencia, con la URL y las cabeceras del operador, un tiempo de espera, sin redirecciones y con 16 MiB como máximo. La URL debe ser `https` (`http` simple solo hacia un host de loopback). Si falta `revocations` o `kid_revocations` (cualquiera de los dos campos), la lista es inválida, no vacía: puede haberse truncado.

<a id="results"></a>

## Resultados

| Campo | Significado |
|---|---|
| `verified` | El veredicto del verificador, sin cambios |
| `principal_trust` | `trusted`, `untrusted` o `not_evaluated` (sin conjunto de confianza, o no verificado) |
| `profile` / `profile_compliance` | `strict-v1` o null / `compliant`, `non_compliant`, `not_evaluated` |
| `admitted` | La decisión final con esta configuración |
| `action_authorized` | Siempre `false`: la admisión no autoriza ninguna acción |
| `recorded_decision` | La decisión de política que registra el bundle (`approve`, `escalate`, `block`) |
| `trust_set_version` | El conjunto de confianza que se usó |
| `errors` | `{ code, message }`; los códigos se enumeran en la especificación, § 5.3 |

Un bundle que registra una decisión `block` o `escalate` puede admitirse: es evidencia de esa decisión, no un permiso.

<a id="using-it"></a>

## Uso

### TypeScript (`@dcp-ai/sdk`)

```ts
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson);           // throws AdmissionConfigError
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
if (!result.admitted) throw new Error(result.errors.map((e) => e.code).join(', '));
```

`evaluateAdmissionV2` toma un resultado de verificación que ya tienes (sin criptografía ni E/S) y confía en él: pásale solo el resultado de verificar ese mismo bundle, en el mismo `now`, con la política del perfil. `revocationSubjects` indica a una fuente por qué debe responder. Python, Go y Rust exponen las mismas funciones; véase la especificación, § 8.

### Express (`@dcp-ai/express`)

```ts
import { dcpVerify, denyListRevocationSource } from '@dcp-ai/express';

app.use('/api/agents', dcpVerify({
  trustedPrincipals: trustSetJson,                               // or ({ tenant }) => trust set
  profile: { profile: 'strict-v1', verifier_id: 'api.acme.example' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
  tenant: (req) => req.auth.tenant,                              // from your own authentication
  cacheTtlSeconds: 60,
}));
```

Una solicitud llega a la ruta solo cuando el bundle se admite; `req.dcpAgent.admission` lleva el resultado. Una función de confianza que lanza una excepción, o que devuelve `undefined`, `null` o cualquier cosa que no sea un conjunto de confianza válido (por ejemplo, un inquilino para el que no tiene entrada), rechaza la solicitud con `503`: nunca significa «sin requisito de confianza». La caché guarda solo la verificación criptográfica, indexada por el bundle, la política del verificador y el inquilino; la confianza, las comprobaciones del perfil y la revocación se evalúan en cada solicitud, así que retirar un principal o revocar una clave surte efecto en la siguiente. Ejecutable: [`integrations/express/examples/strict-v1.mjs`](../integrations/express/examples/strict-v1.mjs).

### FastAPI (`dcp_ai.fastapi`)

`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=deny_list_revocation_source(url), tenant=...)`, con las mismas reglas (`require_bundle` vale `False` por defecto en FastAPI y debe ser `True` con principales de confianza); véase [`integrations/fastapi/README.md`](../integrations/fastapi/README.md).

### OpenClaw (`@dcp-ai/openclaw`)

```ts
configureVerifier({ trustedPrincipals, profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' }, revocationSource });
```

`dcp_verify_bundle` informa entonces de `admitted` y nombra al agente solo para un bundle admitido. Con el perfil se rechaza el parámetro `verifier_policy` del modelo, y se ignoran los parámetros que la herramienta no define. Ejecutable: [`integrations/openclaw/examples/strict-v1.mjs`](../integrations/openclaw/examples/strict-v1.mjs).

<a id="reference-server-and-cli"></a>

### Servidor de referencia y CLI

El servidor de verificación (`npm run server`) expone `POST /v2/admit` cuando el operador define `DCP_TRUSTED_PRINCIPALS_FILE` (que se vuelve a cargar cada vez que cambia su contenido) y, para strict-v1, también `DCP_ADMISSION_PROFILE_FILE` y `DCP_REVOCATION_LIST_URL` (con un `DCP_REVOCATION_LIST_AUTHORIZATION` opcional). Se niega a arrancar con una configuración contradictoria o con una variable de admisión definida pero vacía. Sin conexión:

```bash
# the reference CLI of a checkout; it reads only files in the current directory
node /path/to/dcp-ai/bin/dcp.js admit-bundle bundle.signed.json --trust trust.json --profile profile.json --revocation snapshot.json
```

<a id="compatibility"></a>

## Compatibilidad

- **API de verificación.** `verifySignedBundleV2` / `verify_signed_bundle_v2` / `VerifySignedBundleV2WithPolicy` / `verify_signed_bundle_v2_with_policy` conservan sus firmas. Las claves firmantes son `details.signer_keys` en TypeScript y Python y el nuevo campo `SignerKeys` en Go. En Rust, `V2VerificationResult` conserva sus diez campos, así que el código que lo construye completo o lo desestructura sin `..` sigue compilando; las claves firmantes proceden del nuevo `verify_signed_bundle_v2_at`, que devuelve `V2VerificationDetails` (`result` y `signer_keys`) y es lo que toma la admisión. El código escrito contra la API de admisión antes de su publicación lee `verification.result.verified` en lugar de `verification.verified`.
- **Comportamiento de la verificación.** Los mismos cambios alteran el comportamiento de la verificación, al margen de la admisión. Ahora se rechazan las firmas Ed25519 con S >= L. Por otro lado, los verificadores de Go y Rust aplican ahora `accepted_classical_algs` y `accepted_pq_algs` de una política, que antes rechazaban por no estar implementados: con una política así, un bundle fuera de las listas falla, y uno dentro de ellas ahora puede verificarse. El [CHANGELOG](../CHANGELOG.md) enumera todos los cambios.
- **Bundles.** Ningún cambio en el formato de transmisión. strict-v1 necesita bundles firmados con `session_issued_at`, `session_expires_at` e `intended_verifier` en el manifiesto, que todos los firmantes de los SDK escriben cuando se les da una caducidad y una audiencia.
- **Con un conjunto de confianza, los bundles V1 se rechazan**: no llevan ninguna firma de principal que anclar.
- **Opciones de las integraciones.** Nuevas y opcionales. Con principales de confianza, `requireBundle: false` (Express) y `require_bundle=False` (FastAPI) son errores de configuración: una solicitud sin bundle llegaría a la ruta. Con el perfil también lo son `verifierPolicy`, `requireHybrid: false` y las opciones `checkRevocation` (Express), `verifier_policy` (FastAPI) y `verifierPolicy` (OpenClaw).

<a id="limits"></a>

## Límites

- **Repetición.** El nonce de sesión, la audiencia y la caducidad acotan dónde y durante cuánto tiempo puede repetirse un bundle; no lo hacen de un solo uso. Un verificador que necesite un solo uso mantiene su propio registro de nonces o hashes de bundles consumidos; la admisión no los consume.
- **Autorización.** `action_authorized` es siempre `false`. Vincular una autorización externa a una herramienta, sus argumentos y su ejecución es una fase posterior.
- **La identidad** es tan buena como el conjunto de confianza y el proceso que lo mantiene.
- **La revocación** es tan reciente como la instantánea: una revocación posterior a `checked_at` se ve con la siguiente instantánea.
