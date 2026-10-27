<sub>[English](VERIFICATION.md) · [中文](VERIFICATION.zh-CN.md) · **Español** · [日本語](VERIFICATION.ja.md) · [Português](VERIFICATION.pt-BR.md)</sub>

<a id="verification-checklist--signed-bundle"></a>
<a id="verification-checklist-signed-bundle"></a>

# Lista de verificación — Signed Bundle

> Traducción informativa de [la especificación en inglés](VERIFICATION.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Todos los pasos son **locales**; no hace falta ninguna llamada a una API ni a un servidor. Un verificador solo necesita el Signed Bundle (y opcionalmente un conjunto de RevocationRecords firmados, procedentes de un par, de un archivo o de una lista anclada).

<a id="normative-checklist"></a>

## Lista de verificación normativa

Al verificar un Signed Bundle, realiza lo siguiente en orden:

1. **Valida contra el esquema** el Signed Bundle y el Citizenship Bundle interior contra `schemas/v1/signed_bundle.schema.json` y `schemas/v1/citizenship_bundle.schema.json` (o usa `dcp validate-bundle` sobre el bundle interior y valida contra el esquema el envoltorio firmado).

2. **Verifica la firma:**  
   - Recalcula `bundle_hash` = SHA-256(canonical(bundle)); compáralo con `signature.bundle_hash` (deben coincidir, p. ej., `sha256:<hex>`).  
   - Verifica `signature.sig_b64` con `signature.signer.public_key_b64` sobre el bundle canónico (Ed25519 separada).  
   - Usa `dcp verify-bundle <signed.json> <public_key.txt>` para realizar este paso.

3. **Verifica el RPR:** no caducado — `responsible_principal_record.expires_at` es `null` o una fecha y hora ISO 8601 futura. Opcional: verifica la firma del RPR si el registro se guarda firmado.

4. **Verifica el AP:** `agent_passport.status` = `"active"`. Opcional: comprueba el firmante o el agent_id contra un **conjunto local de RevocationRecords firmados** (de un par, de un archivo o de una lista anclada), sin ninguna API central.

5. **Verifica intent_hash:** Para cada AuditEntry de `bundle.audit_entries`, `intent_hash` debe (MUST) ser igual a SHA-256(canonical(intent)) (hex), donde la intención es la del bundle identificada por el `intent_id` de esa entrada (normalmente la única `intent` del bundle). Usa `dcp intent-hash <intent.json>` o la ayuda de referencia `intentHash()`.

6. **Verifica la cadena de auditoría:**  
   - Primera entrada: `prev_hash` = `"GENESIS"`.  
   - Para cada entrada posterior en el índice n (n ≥ 1): `prev_hash` debe (MUST) ser igual a SHA-256(canonical(entry_{n-1})) (hex).

7. **Opcional — merkle_root:** Si `signature.merkle_root` está presente (no es null), verifica que es igual a la raíz de Merkle de `bundle.audit_entries` (p. ej., `dcp merkle-root` sobre el bundle interior).

8. **Opcional — anchor_receipt:** Si se aporta un anchor_receipt junto al bundle (p. ej., cadena, tx_id, referencia de bloque), verifica que `bundle_hash` aparece en la cadena o en el índice del registro indicados usando **solo datos públicos** (p. ej., obteniendo la transacción de un explorador de bloques público o de un nodo). No interviene ningún servidor central; la verificación usa solo datos públicos.

9. **Opcional — lista de revocación jurisdiccional:** Si el verificador tiene acceso a una lista de revocación firmada para la jurisdicción del agente (según `responsible_principal_record.jurisdiction`), obtén la lista o usa la que tengas en caché, verifica la firma Ed25519 del emisor y comprueba el `agent_passport.agent_id` del bundle (o el firmante) contra las entradas de la lista. Si aparece, el agente está revocado y la verificación falla. Véase [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) para el formato de la lista y la convención de URL well-known.

10. **Opcional — atestación de jurisdicción:** Si el bundle incluye (o va acompañado de) un objeto `JurisdictionAttestation`, verifica la firma de la atestación sobre `rpr_hash` con la clave pública del atestador. La clave pública del atestador puede obtenerse de una URL well-known publicada por la jurisdicción (p. ej., `https://<authority>/.well-known/dcp-attestation-keys.json`). Véase [DCP-01.md](DCP-01.md) para el formato del objeto de atestación.

11. **Opcional — prueba del registro de transparencia:** Si quien tiene el bundle aporta una prueba de inclusión en un registro (`log_url`, `log_index`, `merkle_proof`), verifica la inclusión Merkle de `bundle_hash` en la raíz firmada del registro. Si la raíz del registro está anclada en cadena, verifica opcionalmente el anclaje. Véase [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) para la API del registro y el formato de la prueba.

---

<a id="v2-verification-checklist"></a>

## Lista de verificación V2

Al verificar un Signed Bundle V2 (`dcp_bundle_version: "2.0"`), realiza los pasos siguientes. Amplían la lista de verificación V1 con la verificación de firmas compuestas, la vinculación de sesión y la integridad del manifiesto.

Implementación de referencia: `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` (o `verifySignedBundle` en `lib/verify.js`), que valida los esquemas y delega las comprobaciones criptográficas en `verifySignedBundleV2` de `@dcp-ai/sdk`. La clave pública opcional fija el firmante clásico.

<a id="step-v2-1-detect-version"></a>

### Paso V2-1: Detectar la versión

Inspecciona `bundle.dcp_bundle_version`. Si es `"2.0"`, usa esta lista V2. Si falta o es `"1.0"`, usa la lista V1 anterior.

<a id="step-v2-2-schema-validate"></a>

### Paso V2-2: Validar contra el esquema

Valida el Signed Bundle contra `schemas/v2/signed_bundle.schema.json`, que define el bundle interior y referencia `bundle_manifest`, `signed_payload`, `audit_entry` y `pq_checkpoint`. Valida cada `SignedPayload.payload` contra el esquema de su artefacto: `responsible_principal_record`, `agent_passport`, `intent` y `policy_decision` en `schemas/v2/`.

<a id="step-v2-3-validate-manifest"></a>

### Paso V2-3: Validar el manifiesto

El bundle debe (MUST) contener un objeto `manifest` con los siguientes campos obligatorios:

- `session_nonce` — cadena hexadecimal de 64 caracteres
- `rpr_hash`, `passport_hash`, `intent_hash`, `policy_hash` — hashes SHA-256 de los artefactos respectivos
- `audit_merkle_root` — raíz de Merkle de las entradas de auditoría
- `audit_count` — número entero de entradas de auditoría

Recalcula el hash de cada artefacto a partir de la representación canónica de su `payload` y verifica que coincide con el valor del manifiesto y con el `payload_hash` del propio artefacto. Un hash del manifiesto que falta, o una carga útil que falta o que no puede canonicalizarse, hace fallar la verificación.

Vincula el registro de auditoría al manifiesto: `audit_count` debe (MUST) ser igual al número de `audit_entries`, `audit_merkle_root` debe (MUST) ser igual a la raíz de Merkle recalculada a partir de ellas, el `prev_hash` de la primera entrada debe (MUST) ser `GENESIS`, y el `prev_hash` de cada entrada posterior debe (MUST) ser el hash de la entrada anterior. Un registro de auditoría vacío tiene la raíz `sha256:` seguida de 64 ceros, que admite el patrón del esquema del manifiesto; un constructor de bundles que acepta cero entradas de auditoría escribe ese valor (lo hacen `BuildBundleV2` de Go y `build_bundle_v2` de Rust, al que llama `wasm_build_bundle` de la feature `wasm`; los constructores de TypeScript y Python exigen al menos una entrada). La ayuda `auditEventsMerkleRoot` de todos los SDK, que sirve a los checkpoints PQ, rechaza en cambio una lista vacía.

<a id="step-v2-4-verify-session-nonce-consistency"></a>

### Paso V2-4: Verificar la coherencia del nonce de sesión

Todos los artefactos (`responsible_principal_record.payload`, `agent_passport.payload`, `intent.payload`, `policy_decision.payload`) y todas las `audit_entries` que incluyen un campo `session_nonce` deben (MUST) compartir el mismo nonce que `manifest.session_nonce`.

Si `manifest.session_expires_at` está presente y ya ha pasado, rechaza el bundle.

`manifest.session_issued_at`, cuando está presente, es el momento en que empezó la sesión, firmado con el resto del manifiesto. Rechaza el bundle cuando no es una marca de tiempo RFC 3339, cuando está más de 30 segundos después del momento de verificación (el desfase de reloj que también permite [DCP-04](DCP-04.md)) o cuando es posterior a `session_expires_at`. El `max_session_duration_seconds` de una política de verificador acota `session_expires_at` menos `session_issued_at`: bajo esa política, un bundle sin alguno de los dos se rechaza, nunca se mide desde un momento sin firmar ni se trata como una sesión que nunca termina. Los bundles firmados antes de que existiera `session_issued_at` se verifican como antes bajo una política sin duración máxima de sesión; bajo una con máximo se rechazan y deben firmarse de nuevo.

El bloque `signature` fuera de `composite_sig` (`hash_alg`, `created_at`, `signer`, `manifest_hash`) no está firmado: cualquiera puede cambiarlo sin romper ninguna firma. No debe (MUST NOT) sustituir a datos firmados, como hizo una vez `created_at` con el inicio de la sesión. Tampoco debe (MUST NOT) contradecir lo que está firmado: `signer.id` es el `human_id` del RPR, `signer.kids` son los kids de `composite_sig` (el clásico y después el PQ cuando está presente), `manifest_hash` es `sha256:` seguido del SHA-256 del manifiesto canónico, y `hash_alg` es `sha256` o `sha256+sha3-256`.

Las marcas de tiempo de estas comprobaciones (`session_expires_at` aquí, el `expires_at` de una clave en el paso V2-13) son fechas y horas RFC 3339 con un desfase `Z` o `±hh:mm`, como `2026-10-22T06:05:03-05:00`. Compáralas como instantes, con precisión de milisegundos (los dígitos más allá de los milisegundos se descartan), nunca como cadenas: el orden de dos marcas de tiempo con desfases distintos como cadenas no es su orden temporal. Los años 0000 a 9999 son todos válidos. Ausente o `null` significa sin caducidad. Cualquier otro valor que no sea una marca de tiempo así (una fecha sin hora, una hora sin desfase, una fecha u hora imposibles, algo que no es una cadena) debe (MUST) rechazarse. La categoría `rfc3339` de `tests/interop/v2/interop_vectors.json` enumera el instante de cada caso aceptado y los rechazados.

<a id="step-v2-5-verify-composite-signature-structure"></a>

### Paso V2-5: Verificar la estructura de la firma compuesta

La `signature` del bundle debe (MUST) contener un objeto `composite_sig` con:

- `classical` — objeto con `alg`, `kid`, `sig_b64`
- `binding` — uno de `pq_over_classical`, `classical_only` (`schemas/v2/composite_signature.schema.json`)
- `pq` — (obligatorio si binding es `pq_over_classical`) objeto con `alg`, `kid`, `sig_b64`

Cada `sig_b64`, en la firma del bundle, en las de los artefactos y en las de los checkpoints, debe (MUST) estar en base64 canónico (RFC 4648 § 4: con relleno, bits finales a cero, ningún otro carácter), para que todos los verificadores decodifiquen los mismos bytes y una firma tenga una única codificación. En caso contrario, rechaza el bundle.

<a id="step-v2-6-verify-classical-signature"></a>

### Paso V2-6: Verificar la firma clásica

Reconstruye el mensaje firmado: `context_tag || 0x00 || canonical(manifest)`, donde `context_tag` es `"DCP-AI.v2.Bundle"`. Verifica `composite_sig.classical.sig_b64` contra la clave pública identificada por `composite_sig.classical.kid` usando el algoritmo indicado en `composite_sig.classical.alg` (normalmente Ed25519).

El firmante del bundle es el principal responsable: busca el kid solo en las `binding_keys` del RPR. La firma del principal sobre el manifiesto, que se compromete con `passport_hash`, es lo que vincula a este agente y sus claves con el principal; el agente firma su propio pasaporte, así que una clave que solo figura en el pasaporte no debe (MUST NOT) verificar la firma del bundle. De lo contrario, cualquiera podría emparejar un RPR publicado y firmado con un pasaporte y unas claves propias.

Esto vincula al agente con quien tenga las `binding_keys` del RPR. No prueba quién es: cualquiera puede crear un RPR con cualquier `human_id` y claves propias. Un verificador que necesita la identidad del principal fija sus claves (como hace `dcp verify-bundle` con una clave pública), comprueba una atestación de jurisdicción o las resuelve a partir de una fuente en la que confía.

<a id="step-v2-7-verify-pq-signature-if-present"></a>

### Paso V2-7: Verificar la firma PQ (si está presente)

Si `composite_sig.binding` es `pq_over_classical`:

1. Reconstruye el mensaje firmado PQ: `context_tag || 0x00 || canonical(manifest) || classical_sig_bytes`
2. Verifica `composite_sig.pq.sig_b64` contra la clave pública identificada por `composite_sig.pq.kid` en las `binding_keys` del RPR, usando el algoritmo PQ (p. ej., ML-DSA-65).

Una firma PQ presente debe (MUST) verificarse en todos los modos, incluidos `hybrid_preferred` y `classical_only`; una inválida hace fallar la verificación.

Si binding es `classical_only`, la firma PQ está ausente. Esto puede (MAY) ser aceptable según el modo efectivo (paso V2-9): `hybrid_preferred` lo acepta con un aviso; `hybrid_required` y `pq_only` lo rechazan.

<a id="step-v2-8-verify-per-artifact-composite-signatures"></a>

### Paso V2-8: Verificar las firmas compuestas de cada artefacto

Cada artefacto (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) va envuelto en un sobre `SignedPayload` con su propio `composite_sig`. Verifica la firma compuesta de cada artefacto con el mismo proceso de los pasos V2-6 y V2-7, con la etiqueta de contexto que corresponde a cada tipo de artefacto. El principal firma el RPR con sus `binding_keys`; el agente firma el pasaporte, la intención y la decisión de política con las `keys` del pasaporte.

<a id="step-v2-9-compute-the-security-tier-and-the-effective-mode"></a>

### Paso V2-9: Calcular el nivel de seguridad y el modo efectivo

Calcula el nivel de seguridad a partir de `intent.payload` y `policy_decision.payload` como en [DCP-AI-v2.0.md § 14.2](DCP-AI-v2.0.md): `risk_score` sale de la decisión de política, nunca de la intención; un valor de `action_type`, `estimated_impact` o `data_classes` ausente, de tipo erróneo o desconocido, o un `risk_score` de la decisión de política ausente o que no sea un entero de 0 a 1000, falla de forma cerrada a `elevated`; `intent.security_tier` solo puede elevar el nivel.

El modo efectivo es el más estricto entre el modo de la política (`default_mode`, o la entrada de `risk_overrides` para el `risk_tier` del pasaporte) y el modo del nivel: `routine` → `classical_only`, `standard` → `hybrid_preferred`, `elevated` y `maximum` → `hybrid_required`, con `classical_only` < `hybrid_preferred` < `hybrid_required`. Una política `pq_only` sigue siendo `pq_only`. Informa del nivel resuelto con el resultado.

<a id="step-v2-10-enforce-verifier-policy"></a>

### Paso V2-10: Aplicar la política del verificador

Aplica el modo efectivo (paso V2-9) y la configuración de la política del verificador a la firma del bundle y a cada firma de artefacto (pasos V2-6 a V2-8):

- Si el modo efectivo es `hybrid_required`, rechaza los bundles con binding `classical_only`.
- Si el modo efectivo es `pq_only`, rechaza los bundles sin firma PQ.
- Comprueba `accepted_classical_algs` y `accepted_pq_algs`: rechaza si el bundle usa un algoritmo que no está en esas listas.
- Comprueba `advisory_rejected_algs`: rechaza si el bundle usa un algoritmo bloqueado por un aviso activo.

Por tanto, un bundle `classical_only` con una intención `initiate_payment` se rechaza aunque su pasaporte declare `risk_tier: "low"`.

<a id="step-v2-11-verify-dual-hash-audit-chain-if-present"></a>

### Paso V2-11: Verificar la cadena de auditoría de doble hash (si está presente)

Si las entradas de auditoría incluyen `prev_hash_secondary`, verifica la cadena de hash secundaria:

- Primera entrada: `prev_hash_secondary` = `"GENESIS"`
- Entradas siguientes: `prev_hash_secondary` = SHA3-256(canonical(previous_entry))

> **Errata (27/10/2026, normativa).** Aclara el paso anterior y los campos secundarios; no cambia ningún hash, ninguna
> canonicalización ni ningún otro paso.
>
> - Cada campo secundario es OPCIONAL y solo se comprueba cuando está presente; `hash_alg` no hace obligatorio ninguno.
> - `prev_hash_secondary`: en la primera entrada, si está presente, DEBE ser el literal `"GENESIS"`. En cualquier entrada
>   posterior, si está presente, DEBE ser `sha3-256:` seguido del SHA3-256 en hexadecimal minúsculo de los bytes
>   `dcp-jcs-v1` de la entrada inmediatamente anterior tal como figura en el bundle, lleve o no esa entrada su propio campo
>   secundario. Una entrada que lo omite no es incoherente; un bundle que omite algunos enlaces no contiene una cadena
>   secundaria completa.
> - `intent_hash_secondary`, si está presente, DEBE ser `sha3-256:` seguido del SHA3-256 de los bytes `dcp-jcs-v1` del
>   payload de la intención.
> - `audit_merkle_root_secondary`, si está presente en el manifiesto, DEBE ser `sha3-256:` seguido de la raíz de Merkle
>   SHA3-256 de las entradas de auditoría, calculada como `audit_merkle_root` (hojas sobre los bytes `dcp-jcs-v1` de cada
>   entrada, pares sobre los digests de 32 bytes concatenados, el último nodo duplicado en una capa impar, orden del
>   bundle); para una traza vacía es `sha3-256:` seguido de 64 ceros.
> - Un valor presente que sea `null` o no sea una cadena hace fallar la verificación. Donde se espera un hash, el valor DEBE
>   ser `sha3-256:` seguido de 64 dígitos hexadecimales en minúscula e igual al calculado; el único otro valor admitido es el
>   literal `"GENESIS"` para `prev_hash_secondary` en la primera entrada.

<a id="step-v2-12-verify-pq-checkpoints-if-present"></a>

### Paso V2-12: Verificar los checkpoints PQ (si están presentes)

Si el manifiesto enumera `pq_checkpoints` o el bundle lleva alguno, verifícalos:

1. El bundle debe (MUST) llevar exactamente los checkpoints que enumera el manifiesto, una vez cada uno, por `checkpoint_id`. Un checkpoint enumerado que falta, o uno que se lleva y que el manifiesto no enumera, hace fallar la verificación: el manifiesto está firmado; los cuerpos de los checkpoints, no.
2. El `event_range` de un checkpoint nombra un tramo contiguo de `audit_entries`, desde la entrada cuyo `audit_id` es `from_audit_id` hasta aquella cuyo `audit_id` es `to_audit_id`, con `count` entradas. Su `merkle_root` debe (MUST) ser `sha256:` seguido de la raíz de Merkle de esas entradas, calculada como la calcula `auditEventsMerkleRoot`.
3. Su `composite_sig` es del agente: verifícalo con las `keys` del pasaporte, bajo el contexto `DCP-AI.v2.AuditEvent`, sobre el checkpoint canónico sin `composite_sig`. Tanto la firma clásica como la PQ deben (MUST) estar presentes y ser válidas (en modo `pq_only`, la PQ); un checkpoint existe para llevar la firma PQ.
4. Su `session_nonce` debe (MUST) ser el del manifiesto.

<a id="step-v2-13-key-validity-checks"></a>

### Paso V2-13: Comprobaciones de validez de las claves

Para cada identificador de clave (`kid`) referenciado en las firmas compuestas (la del bundle, la de cada artefacto y la de cada checkpoint):

- El kid debe (MUST) derivarse de la clave que verifica la firma: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`, con `alg` y `raw_public_key` de esa entrada de clave. En caso contrario, rechaza el bundle. Así un kid nombra una sola clave, en cualquier lista que la contenga; sin esta comprobación, una lista de claves puede reclamar el kid de otra parte para una clave propia.
- El `public_key_b64` de esa clave debe (MUST) estar en base64 canónico (RFC 4648 § 4, con relleno y bits finales a cero), para que todos los verificadores decodifiquen los mismos bytes.
- Opcionalmente, comprueba el estado de la clave contra un servicio de revocación o una lista local de revocación.

Rechaza el bundle si alguna clave que pueda firmarlo, en las `keys` del pasaporte o en las `binding_keys` del RPR, tiene `status` `"revoked"` o `"expired"` (`schemas/v2/key_entry.schema.json` permite ambos), o un `expires_at` que ya ha pasado o que no es una marca de tiempo RFC 3339 (paso V2-4).

<a id="step-v2-14-cross-artifact-consistency"></a>

### Paso V2-14: Coherencia entre artefactos

Las firmas prueban quién firmó cada artefacto; estas comprobaciones hacen que los artefactos describan una acción, de un agente, para un principal. Trasladan a V2 las comprobaciones V1 sobre el RPR, el pasaporte y `intent_hash`. Rechaza el bundle cuando:

- `agent_passport.status` no es ni `active` ni `declining`: un agente `commissioned`, `suspended`, `revoked` o `decommissioned` no realiza ninguna acción ([DCP-05](DCP-05.md) § 3.1);
- el `expires_at` del RPR ya ha pasado o no es una marca de tiempo RFC 3339 (paso V2-4); `null` nunca caduca;
- `agent_passport.principal_binding_reference` no es el `human_id` del RPR;
- `intent.agent_id` no es el `agent_id` del pasaporte, o `intent.human_id` no es el `human_id` del RPR;
- `policy_decision.intent_id` no es `intent.intent_id`;
- el `intent_id` de una entrada de auditoría no es `intent.intent_id`, su `intent_hash` no es el hash de la carga útil de la intención (el `intent_hash` del manifiesto), su `agent_id` no es el del pasaporte o su `human_id` no es el del RPR;
- el `policy_decision` de una entrada de auditoría no registra la decisión de política: `approved` para `approve`, `escalated` para `escalate`, `blocked` para `block`.

Un bundle que registra una acción escalada o bloqueada es evidencia válida de ella: nada de esto exige que la decisión sea `approve`. Las comprobaciones de estado y de caducidad, como las de claves del paso V2-13, se aplican en el momento de la verificación; verificar evidencia archivada con respecto a un momento anterior aún no está definido.

<a id="verification-time-and-signer-keys"></a>

### Momento de verificación y claves de los firmantes

Todas las comparaciones de tiempo de V2-1 a V2-14 usan un único instante de verificación. Las implementaciones lo reciben como parámetro opcional, con el reloj del sistema por defecto, para que un veredicto pueda reproducirse en un momento dado. Para cada firma compuesta que comprueban, los verificadores informan de la entrada de clave que resolvieron para cada componente y de si se verificó (`signer_keys`); es lo que lee el perfil de admisión.

<a id="beyond-verification-admission"></a>

### Más allá de la verificación: admisión

Los pasos V2-1 a V2-14 deciden si un bundle está verificado: intacto, coherente y firmado por las claves que enumera. No deciden quién es el principal. Si un bundle verificado viene de un principal en el que el verificador ya confía, y los requisitos `strict-v1` fijados por el operador, los define el perfil de admisión, [`profiles/admission`](profiles/admission/README.md), por encima de estos pasos y sin cambiarlos.

---

<a id="protocol-integrity"></a>

## Integridad del protocolo

Antes de verificar bundles, un verificador debería (SHOULD) verificar que sus propios esquemas coinciden con el protocolo canónico:

```bash
dcp integrity
```

Esto comprueba el hash SHA-256 de cada esquema local contra las huellas canónicas de [`protocol_fingerprints.json`](../protocol_fingerprints.json) (en la raíz del repositorio). Si algún esquema se ha modificado (p. ej., en una bifurcación del protocolo), la comprobación falla. Véase [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md) para el modelo de seguridad completo.

<a id="reference"></a>

## Referencia

- Formato del bundle: [BUNDLE.md](BUNDLE.md)
- Cadena de auditoría e intent_hash: [DCP-03.md](DCP-03.md)
- Modelo de seguridad: [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)
- Almacenamiento, anclaje, listas de revocación, registros de transparencia: [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)
- Guía del operador: [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md)

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Superar estos pasos muestra que un bundle está verificado tal como se define aquí: intacto, coherente y firmado por las claves que
  enumera. No certifica al agente ni la identidad del principal, no muestra el cumplimiento de ninguna normativa ni
  autoriza una acción; la confianza en el principal corresponde al perfil de admisión ([docs/ADMISSION.md](../docs/ADMISSION.md)).
- Los pasos V1 opcionales 8 a 11 (recibo de anclaje, lista de revocación jurisdiccional, atestación de jurisdicción,
  prueba del registro de transparencia) no los ejecutan `dcp verify-bundle`, `lib/verify.js` ni los verificadores de los SDK; un verificador que
  los quiera los ejecuta él mismo. Las instantáneas de revocación las lee el perfil de admisión, no estos pasos.
- Paso V2-11: en el código fuente aún no publicado (27/10/2026), los verificadores de los SDK comprueban los campos secundarios presentes, como indica la errata, y `lib/verify.js` también cuando usa el SDK compilado desde ese código fuente; los paquetes publicados son anteriores y no lo hacen: con ellos, un bundle que lleva los campos secundarios se verifica solo con la cadena y la raíz SHA-256, y un verificador que necesite la cadena secundaria la comprueba él mismo.
- El paso 10 describe la firma de la atestación como hecha «sobre `rpr_hash`», mientras que [DCP-01](DCP-01.md) la describe sobre
  el JSON canónico de todos los campos salvo `signature`, y el esquema V2 usa un `composite_sig`. Esta nota registra
  la diferencia; no decide cuál se aplica.
