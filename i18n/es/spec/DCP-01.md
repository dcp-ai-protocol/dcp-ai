<sub>[English](../../../spec/DCP-01.md) · [中文](../../zh-CN/spec/DCP-01.md) · **Español** · [日本語](../../ja/spec/DCP-01.md) · [Português](../../pt-BR/spec/DCP-01.md)</sub>

<a id="dcp-01--identity--principal-binding"></a>
<a id="dcp-01-identity-principal-binding"></a>

# DCP-01 — Identidad y vinculación al principal

> Traducción informativa de [la especificación en inglés](../../../spec/DCP-01.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Las personas preceden a los agentes. Ningún agente existe sin una vinculación explícita a una persona o entidad jurídica que asume la responsabilidad. DCP-01 define los artefactos que vinculan la identidad del agente con la identidad humana.

<a id="normative-artifacts"></a>

## Artefactos normativos

| Artefacto | Descripción | Esquema |
|----------|-------------|--------|
| **Responsible Principal Record (RPR)** | Registro que declara quién es la persona u organización, la jurisdicción, el modo de responsabilidad y la validez. | `schemas/v1/responsible_principal_record.schema.json` |
| **Agent Passport (AP)** | Pasaporte del agente: identidad, clave pública, referencia al RPR, estado (active/revoked/suspended). | `schemas/v1/agent_passport.schema.json` |
| **Revocation Record** | Registro de la revocación de un agente: quién revoca, cuándo y por qué. | `schemas/v1/revocation_record.schema.json` |

**$id** de los esquemas: `https://dcp-ai.org/schemas/v1/<name>.schema.json`

<a id="validation"></a>

## Validación

Valida un objeto contra su esquema:

```bash
dcp validate schemas/v1/responsible_principal_record.schema.json <hbr.json>
dcp validate schemas/v1/agent_passport.schema.json <ap.json>
dcp validate schemas/v1/revocation_record.schema.json <revocation.json>
```

Un Citizenship Bundle (que incluye el RPR y el AP) se valida con:

```bash
dcp validate-bundle <citizenship_bundle.json>
```

<a id="examples"></a>

## Ejemplos

- [tests/conformance/examples/responsible_principal_record.json](../../../tests/conformance/examples/responsible_principal_record.json)
- [tests/conformance/examples/agent_passport.json](../../../tests/conformance/examples/agent_passport.json)

La fuente de verdad para los campos y los enums es el JSON Schema; este documento es la especificación normativa que los referencia.

---

<a id="jurisdiction-attestation-optional"></a>

## Atestación de jurisdicción (opcional)

Una **atestación de jurisdicción** es un objeto opcional que certifica que el Responsible Principal Record de un agente es válido en una jurisdicción concreta. La produce una autoridad de la jurisdicción (gobierno, organismo regulador o emisor acreditado) y puede incluirse en el Signed Bundle o presentarse junto a él.

<a id="object-format"></a>

### Formato del objeto

```json
{
  "type": "jurisdiction_attestation",
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "rpr_hash": "sha256:<hex>",
  "agent_id": "agent-uuid-here",
  "attested_at": "2026-02-07T00:00:00Z",
  "expires_at": "2027-02-07T00:00:00Z",
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

<a id="fields"></a>

### Campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `type` | string | Siempre `"jurisdiction_attestation"`. |
| `issuer` | string | Identificador de la autoridad emisora. |
| `jurisdiction` | string | Código de país ISO 3166-1 alfa-2 (p. ej., `"US"`, `"EU"`, `"JP"`). |
| `rpr_hash` | string | `sha256:<hex>` — SHA-256 del JSON canónico del Responsible Principal Record que se atesta. |
| `agent_id` | string | El agent_id del Agent Passport. |
| `attested_at` | string | Fecha y hora ISO 8601 en que se emitió la atestación. |
| `expires_at` | string o null | Fecha y hora ISO 8601 en que caduca la atestación; `null` si no caduca. |
| `signature` | object | Firma Ed25519 sobre el JSON canónico de todos los campos salvo el propio `signature`. `alg`, `public_key_b64`, `sig_b64`. |

<a id="how-it-works"></a>

### Cómo funciona

1. El creador del agente (o quien lo tiene) calcula `rpr_hash` = SHA-256(canonical(responsible_principal_record)).
2. El creador envía `rpr_hash` + `agent_id` al servicio de atestación de la jurisdicción (o a un proceso presencial o fuera de línea).
3. La autoridad verifica el RPR (identidad, jurisdicción, validez) y firma la atestación.
4. La atestación se devuelve a quien tiene el agente y se guarda junto al Signed Bundle o dentro de él.

<a id="verification"></a>

### Verificación

Un verificador comprueba la atestación:

1. Calculando `rpr_hash` a partir del `responsible_principal_record` del bundle y comparándolo con el `rpr_hash` de la atestación.
2. Verificando la firma Ed25519 con la clave pública del emisor (obtenida de la URL well-known de la jurisdicción o de un conjunto de confianza de claves de emisores).
3. Comprobando que `attested_at` está en el pasado y que `expires_at` es `null` o está en el futuro.

Véase el paso 10 de [VERIFICATION.md](../../../spec/VERIFICATION.md).

<a id="issuer-public-keys"></a>

### Claves públicas de los emisores

El protocolo sugiere (pero no impone) que las jurisdicciones publiquen sus claves públicas de atestación en una URL well-known:

`https://<authority>/.well-known/dcp-attestation-keys.json`

Formato:

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "keys": [
    { "key_id": "key-2026-01", "public_key_b64": "...", "valid_from": "2026-01-01T...", "valid_until": "2027-01-01T..." }
  ]
}
```

Es una convención; cualquier método de distribución de las claves de los emisores es aceptable (entre pares, registro, URL well-known, etc.).

---

<a id="jurisdictional-revocation-list"></a>

## Lista de revocación jurisdiccional

Una jurisdicción puede publicar una **lista de revocación firmada**: un archivo JSON que enumera los agentes revocados en esa jurisdicción. Véase [docs/STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md) para el formato, la convención de publicación y cómo la usan los verificadores.

---

<a id="reference"></a>

## Referencia

- Lista de verificación: [VERIFICATION.md](../../../spec/VERIFICATION.md)
- Almacenamiento y anclaje (listas de revocación, registro de transparencia): [docs/STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Los artefactos y los comandos anteriores son los **V1** (`schemas/v1/`). El RPR y el pasaporte V2
  (`schemas/v2/`, especificados en [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md)) llevan listas de claves (`binding_keys`, `keys`), un
  `session_nonce` y firmas compuestas en sobres `SignedPayload`; el pasaporte V2 añade los estados de ciclo de vida de
  DCP-05 y un `emergency_revocation_token` opcional.
- `<hbr.json>`, `<ap.json>` y los demás nombres entre ángulos son marcadores de posición para tus propios archivos.
- El objeto de atestación de jurisdicción mostrado arriba no tiene JSON Schema V1.
  `schemas/v2/jurisdiction_attestation.schema.json` define una forma V2 que exige `dcp_version` y un `composite_sig`
  y, con `additionalProperties: false`, no permite el miembro `signature` mostrado arriba. Los verificadores de referencia
  (`lib/verify.js`, los verificadores de los SDK, `dcp verify-bundle`) no comprueban atestaciones; un verificador que las usa realiza
  él mismo las comprobaciones de esta sección.
- Tanto `schemas/v1/signed_bundle.schema.json` como `schemas/v2/signed_bundle.schema.json` solo permiten `bundle` y
  `signature` (`additionalProperties: false`). Con las formas actuales, una atestación viaja junto al Signed
  Bundle, presentada por separado; añadirla como miembro adicional hace que el Signed Bundle no supere la validación contra el esquema.
