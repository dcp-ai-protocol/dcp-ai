<sub>[English](NIST_CONFORMITY.md) · [中文](NIST_CONFORMITY.zh-CN.md) · **Español** · [日本語](NIST_CONFORMITY.ja.md) · [Português](NIST_CONFORMITY.pt-BR.md)</sub>

<a id="dcp-ai-nist-post-quantum-cryptography-conformity-statement"></a>

# Declaración de conformidad de DCP-AI con la criptografía poscuántica del NIST

> Traducción informativa de [la versión en inglés](NIST_CONFORMITY.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

**Versión de la especificación:** 2.0
**Última actualización:** 25/10/2026
**Estado:** Vigente — describe los SDK de `main` el 25/10/2026; los paquetes publicados pueden ir por detrás (véase la sección *Release status* de cada SDK)

Este documento describe cómo se alinea DCP-AI con las normas de criptografía poscuántica del NIST y ofrece una evaluación de conformidad para implementadores. DCP-AI incorpora algoritmos de FIPS 203, FIPS 204 y FIPS 205 como componentes centrales de su arquitectura de seguridad poscuántica híbrida.

> **Algoritmos, no módulos validados.** Usar algoritmos que especifican FIPS 203, 204 y 205 no es una validación FIPS 140-3. La validación se aplica a un módulo criptográfico, probado e incluido en la lista del [Cryptographic Module Validation Program](https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules) del NIST. Este repositorio no tiene evidencia de que las bibliotecas de §8 sean módulos validados y no afirma nada sobre FIPS 140. Tampoco tiene integración con módulos de seguridad de hardware (HSM): véase §2.2.

---

<a id="1-standards-coverage"></a>

## 1. Cobertura de normas

| Norma del NIST | Algoritmo | Uso en DCP-AI | Incluido | Notas |
|---------------|-----------|-------------|---------|-------|
| FIPS 203 | ML-KEM-768 | KEM híbrido para sesiones A2A, cifrado de sobres | Python, Go, Rust, WASM (proveedor público); TypeScript (interno, no exportado) | Ningún SDK exporta el intercambio híbrido X25519 + ML-KEM-768; las sesiones A2A reciben una clave de sesión que deriva quien llama (§8). |
| FIPS 204 | ML-DSA-65 | Firmas poscuánticas en la vinculación compuesta | Los 5 SDK | Firma PQ principal. |
| FIPS 204 | ML-DSA-87 | Firmas poscuánticas de alta garantía | No implementado | Identificador reservado en el esquema de claves; ningún SDK tiene un proveedor. |
| FIPS 205 | SLH-DSA-192f | Esquema de firma de respaldo basado en hash | TypeScript, Python, Rust, Go, WASM | Respaldo activo (SLH-DSA-SHA2-192f). |
| FIPS 205 | SLH-DSA-256f | Firmas basadas en hash de nivel 5 | No incluido | Reservado. |
| SP 800-208 | LMS / XMSS | No se usa | No aplica | Solo contexto: DCP-AI usa SLH-DSA sin estado, no LMS/XMSS (§2.4). |

---

<a id="2-algorithm-parameter-mapping"></a>

## 2. Correspondencia de parámetros de los algoritmos

<a id="21-ml-kem-fips-203--key-encapsulation"></a>
<a id="21-ml-kem-fips-203-key-encapsulation"></a>

### 2.1 ML-KEM (FIPS 203) — Encapsulación de claves

La especificación de DCP-AI usa ML-KEM-768 en una construcción híbrida con X25519 para establecer sesiones entre agentes (A2A) y para el cifrado de sobres opcional. Ningún SDK ejecuta ese intercambio: lo realiza quien llama, que es dueño de la clave de sesión (véase el final de esta sección).

| Parámetro | Valor de FIPS 203 | Valor de DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parámetros | ML-KEM-768 | `ml-kem-768` | Nivel de seguridad 3 del NIST |
| Tamaño de la clave pública | 1184 bytes | 1184 bytes | Conforme |
| Tamaño del texto cifrado | 1088 bytes | 1088 bytes | Conforme |
| Tamaño del secreto compartido | 32 bytes | 32 bytes | Conforme |
| Construcción híbrida | N/A | X25519 + ML-KEM-768 | Secreto compartido combinado mediante HKDF-SHA256 |
| Identificador en DCP-AI | N/A | `x25519-ml-kem-768` | Identificador del KEM híbrido |
| Derivación de claves | N/A | HKDF-SHA256 (RFC 5869) | Clave de sesión A2A: `info = "DCP-AI.v2.A2A.SessionKey"` ([DCP-04](../spec/DCP-04.md) §3.4) |

**Uso en DCP-AI:**

- **Handshake A2A (DCP-04, construcción especificada):** las dos partes intercambian claves públicas efímeras del KEM híbrido. Cada parte encapsula hacia la clave de la otra. Las claves de sesión se derivan combinando ambos secretos compartidos mediante HKDF-SHA256. Estos pasos los realiza quien llama; las funciones de sesión del SDK reciben la clave resultante.
- **Recuperación de claves (§11.2 de la especificación):** la especificación cifra con el KEM híbrido las partes Shamir SSS destinadas a los contactos de recuperación. `setupKeyRecovery` del SDK y `dcp recovery-setup` producen las partes, pero no las cifran; `dcp recovery-setup` escribe cada parte en su propio archivo con modo `0600`.

**Construcción del KEM híbrido en la especificación** (tamaños de la tabla de algoritmos de [DCP-AI v2.0](../spec/DCP-AI-v2.0.md); clave de sesión de DCP-04 §3.4):

```
combined_pk = x25519_pk || ml_kem_768_pk       (1216 bytes)
combined_ct = x25519_ct || ml_kem_768_ct       (1120 bytes)
session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

**El código fuente de TypeScript tiene un KEM híbrido interno con otra codificación.** `HybridKemProvider` (con `X25519KemProvider` y `MlKem768Provider`) está en `sdks/typescript/src`, pero no se exporta desde `@dcp-ai/sdk`, así que no forma parte de la API del paquete. No es la concatenación binaria anterior:

- su clave pública combinada, su clave secreta y su texto cifrado son cada uno el base64 de un objeto JSON `{ "classical": …, "pq": … }`, cuyo componente X25519 está codificado en DER (SPKI, 44 bytes, en la clave pública y el texto cifrado; PKCS#8 en la clave secreta), no en los 32 bytes en bruto, y cuyos componentes ML-KEM-768 tienen 1184 bytes (clave pública) y 1088 bytes (texto cifrado);
- su secreto compartido es `HKDF-SHA256(ikm = x25519_ss || ml_kem_768_ss, salt = "DCP-AI.v2.HybridKEM", info = "x25519-ml-kem-768")`.

Ningún SDK ejecuta por ti el intercambio de DCP-04: la clave de sesión A2A de §3.4 la deriva quien llama y la pasa a las funciones de sesión del SDK.

<a id="22-ml-dsa-fips-204--digital-signatures"></a>
<a id="22-ml-dsa-fips-204-digital-signatures"></a>

### 2.2 ML-DSA (FIPS 204) — Firmas digitales

DCP-AI usa ML-DSA-65 como algoritmo principal de firma poscuántica en vinculación compuesta con Ed25519. ML-DSA-87 está reservado, no implementado.

<a id="ml-dsa-65-primary"></a>

#### ML-DSA-65 (principal)

| Parámetro | Valor de FIPS 204 | Valor de DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parámetros | ML-DSA-65 | `ml-dsa-65` | Nivel de seguridad 3 del NIST |
| Tamaño de la clave pública | 1952 bytes | 1952 bytes | Conforme |
| Tamaño de la clave secreta | 4032 bytes | 4032 bytes | Conforme |
| Tamaño de la firma | 3309 bytes | 3309 bytes | Conforme |
| Separación de dominios | parámetro de cadena de contexto | Prefijo con etiqueta de contexto | Véase la sección 3 |
| Firma aleatorizada | Con cobertura (por defecto) o determinista | Según el proveedor | Con cobertura en los proveedores de TypeScript (valor por defecto de `@noble/post-quantum`) y Rust (`try_sign` de `fips204`); determinista en el proveedor de Go (`SignTo` de CIRCL con `randomized = false`); Python sigue el valor por defecto de `pqcrypto`, que aquí no se comprueba. Las dos variantes son firmas FIPS 204 válidas y se verifican igual |

<a id="ml-dsa-87-high-assurance--reserved"></a>
<a id="ml-dsa-87-high-assurance-reserved"></a>

#### ML-DSA-87 (alta garantía — reservado)

ML-DSA-87 está reservado para un uso futuro de alta garantía. `ml-dsa-87` es un valor aceptado de `alg` en el esquema de claves, y los tamaños de abajo son los de FIPS 204, pero ningún SDK puede generar claves, firmar ni verificar con él, y la CLI de referencia se niega a generar sus claves.

El código fuente del SDK de TypeScript contiene `HsmCryptoProvider` (`sdks/typescript/src/providers/hsm-provider.ts`), que enumera `ml-dsa-87`. Es un **patrón simulado**, no una integración con un HSM: no se exporta ni se registra, no tiene enlace PKCS#11, genera «claves públicas» aleatorias, produce un hash donde debería ir una firma y su `verify` acepta cualquier firma de la longitud correcta. No debe usarse para firmar ni para verificar evidencia real.

| Parámetro | Valor de FIPS 204 | Valor de DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parámetros | ML-DSA-87 | `ml-dsa-87` | Nivel de seguridad 5 del NIST |
| Tamaño de la clave pública | 2592 bytes | 2592 bytes | Conforme |
| Tamaño de la clave secreta | 4896 bytes | 4896 bytes | Conforme |
| Tamaño de la firma | 4627 bytes | 4627 bytes | Conforme |
| Estado | — | Reservado | No implementado en ningún SDK. |

**Uso en DCP-AI:**

- **Firmas compuestas:** ML-DSA-65 firma la concatenación (context_tag || 0x00 || payload || classical_sig) en el modo de vinculación `pq_over_classical`.
- **Checkpoints PQ:** ML-DSA-65 firma raíces de Merkle de lotes de eventos de auditoría.
- **Firma de bundles:** las firmas compuestas a nivel de bundle combinan Ed25519 con ML-DSA-65.

<a id="23-slh-dsa-fips-205--stateless-hash-based-signatures"></a>
<a id="23-slh-dsa-fips-205-stateless-hash-based-signatures"></a>

### 2.3 SLH-DSA (FIPS 205) — Firmas basadas en hash sin estado

DCP-AI usa SLH-DSA-192f como esquema de firma poscuántica de respaldo. La seguridad de SLH-DSA se basa únicamente en supuestos sobre funciones hash, lo que aporta defensa en profundidad si se debilitan los supuestos basados en retículos (ML-DSA).

<a id="slh-dsa-192f-backup"></a>

#### SLH-DSA-192f (respaldo)

| Parámetro | Valor de FIPS 205 | Valor de DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parámetros | SLH-DSA-SHA2-192f | `slh-dsa-192f` | Nivel de seguridad 3 del NIST, variante rápida |
| Tamaño de la clave pública | 48 bytes | 48 bytes | Conforme |
| Tamaño de la clave secreta | 96 bytes | 96 bytes | Conforme |
| Tamaño de la firma | 35.664 bytes | 35.664 bytes | Conforme |
| Funciones hash | Conjunto de parámetros SHA2 (SHA-256 y SHA-512) | Conjunto de parámetros SHA2 | Conforme |

<a id="slh-dsa-256f-reserved"></a>

#### SLH-DSA-256f (reservado)

| Parámetro | Valor de FIPS 205 | Valor de DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parámetros | SLH-DSA-SHA2-256f | `slh-dsa-256f` | Nivel de seguridad 5 del NIST |
| Tamaño de la clave pública | 64 bytes | 64 bytes | Reservado para uso futuro |
| Tamaño de la firma | 49.856 bytes | 49.856 bytes | Reservado para uso futuro |

**Uso en DCP-AI:**

- **Alternativa de algoritmo:** si ML-DSA es objeto de un aviso de gobernanza que lo declara obsoleto, los verificadores pueden pasar a SLH-DSA-192f como componente PQ de las firmas compuestas.
- **Auditorías de alta garantía:** las organizaciones con una postura de seguridad conservadora pueden exigir SLH-DSA junto con ML-DSA.

<a id="24-sp-800-208-context-only"></a>

### 2.4 SP 800-208 (solo contexto)

NIST SP 800-208 cubre los esquemas de firma basados en hash con estado LMS y XMSS. Sus requisitos principales son operativos: no reutilizar nunca una clave de firma de un solo uso y mantener el estado de firma (el índice de la siguiente clave sin usar) persistente y coherente. DCP-AI no implementa LMS ni XMSS, así que SP 800-208 no se le aplica, y este documento no afirma ninguna conformidad con ella. DCP-AI usa en su lugar SLH-DSA sin estado (FIPS 205), que no tiene estado de firma que mantener. Esa elección evita el riesgo de sincronización del estado en despliegues distribuidos de agentes; no es conformidad con SP 800-208, y tampoco lo es el `kid` determinista, que solo nombra una clave pública.

---

<a id="3-domain-separation-and-context-binding"></a>

## 3. Separación de dominios y vinculación al contexto

FIPS 204 (ML-DSA) admite una cadena de contexto opcional para la separación de dominios. DCP-AI no la usa: pone la separación de dominios en el propio mensaje, así:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

La firma clásica (Ed25519) firma estos bytes tal cual. En la vinculación `pq_over_classical`, la firma PQ los firma seguidos de los bytes de la firma clásica (§2.2), así que las dos firmas no cubren el mismo mensaje. La etiqueta de contexto de DCP es un prefijo dentro del mensaje, no la cadena de contexto de FIPS 204: los proveedores de los SDK llaman a ML-DSA con un `ctx` vacío. El byte separador 0x00 evita la ambigüedad entre las etiquetas de contexto y los datos del payload.

| Etiqueta de contexto de DCP | Corresponde a |
|-----------------|---------|
| `DCP-AI.v2.AgentPassport` | Firma de la identidad del agente |
| `DCP-AI.v2.ResponsiblePrincipal` | Firma del Responsible Principal Record |
| `DCP-AI.v2.Intent` | Firma de la declaración de intención |
| `DCP-AI.v2.PolicyDecision` | Firma de la decisión de política |
| `DCP-AI.v2.AuditEvent` | Firma de checkpoints PQ y de compactación de auditoría (las entradas de auditoría V2 no se firman una a una) |
| `DCP-AI.v2.Bundle` | Firma a nivel de bundle |
| `DCP-AI.v2.Revocation` | Firma del registro de revocación |
| `DCP-AI.v2.KeyRotation` | Prueba de rotación de claves |
| `DCP-AI.v2.Governance` | Operaciones de gobernanza |

Es una selección. `DCP_CONTEXTS` en el SDK de TypeScript enumera 19 etiquetas de contexto, incluidas las de DCP-05 a DCP-09;
`DCP-AI.v2.Governance` no es una de ellas: el módulo de gobernanza de TypeScript la define como su propia constante.

---

<a id="4-test-vector-references"></a>

## 4. Referencias a vectores de prueba

<a id="41-nist-kat-directory"></a>

### 4.1 Directorio de KAT del NIST

DCP-AI mantiene vectores Known Answer Test en `tests/nist-kat/`:

```
tests/nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 Section 7.1 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

Consulta [`tests/nist-kat/README.md`](../tests/nist-kat/README.md) para ver qué comprueba cada archivo.

Las tablas de §4.3 a §4.5 y las listas de §5 indican la cobertura que debería alcanzar una implementación; no son una
certificación. Ningún archivo cubre por sí solo toda la matriz: `tests/nist-kat/` contiene los vectores enumerados arriba,
las demás filas dependen de las pruebas propias de cada SDK, que pueden no cubrirlas todas, y el directorio no tiene
ningún vector para la construcción híbrida.

### 4.2 Ed25519 (RFC 8032)

Ed25519 es determinista. Los vectores de prueba se toman directamente de la sección 7.1 de la RFC 8032. Todos los SDK de DCP-AI DEBEN producir firmas idénticas para un mismo par (secret_key, message).

### 4.3 ML-DSA-65 (FIPS 204)

ML-DSA-65 admite firma aleatorizada y determinista; los proveedores actuales de los SDK usan modos distintos, como se describe en la sección 2.2. Comparar directamente con los KAT requiere controlar la aleatoriedad de la firma, que varía entre bibliotecas criptográficas. DCP-AI ejercita las siguientes propiedades; estas comprobaciones no equivalen a una validación completa del algoritmo ni del módulo por el NIST:

| Prueba | Descripción | Requisito |
|------|-------------|------|
| Conformidad de tamaños | Clave pública = 1952 B, firma = 3309 B | DEBE pasar |
| Ida y vuelta | `verify(pk, sign(sk, msg), msg) == true` | DEBE pasar |
| Rechazo con otra clave | `verify(pk_other, sign(sk, msg), msg) == false` | DEBE pasar |
| Verificación entre SDK | Una firma del SDK A se verifica en el SDK B | DEBE pasar |
| kid determinista | `kid(alg, pk)` es idéntico en todos los SDK | DEBE pasar |
| Separación de dominios | Una firma con la etiqueta de contexto A no se verifica con la etiqueta B | DEBE pasar |
| Vinculación compuesta | Quitar la firma clásica invalida la firma PQ | DEBE pasar |

### 4.4 SLH-DSA-192f (FIPS 205)

| Prueba | Descripción | Requisito |
|------|-------------|------|
| Conformidad de tamaños | Clave pública = 48 B, firma = 35.664 B | DEBE pasar |
| Ida y vuelta | Firmar y luego verificar tiene éxito | DEBE pasar |
| Rechazo con otra clave | Verificar con otra clave falla | DEBE pasar |
| Verificación entre SDK | Interoperabilidad entre SDK | DEBE pasar |

### 4.5 ML-KEM-768 (FIPS 203)

| Prueba | Descripción | Requisito |
|------|-------------|------|
| Conformidad de tamaños | Clave pública = 1184 B, texto cifrado = 1088 B, SS = 32 B | DEBE pasar |
| Ida y vuelta | `decapsulate(encapsulate(pk)) == shared_secret` | DEBE pasar |
| Rechazo implícito | Desencapsular con otra clave devuelve un secreto compartido distinto, no un error (rechazo implícito de FIPS 203); lo mismo con un texto cifrado modificado | DEBE pasar |
| Comprobaciones de entrada | Las entradas mal formadas se rechazan con un error: longitudes incorrectas, una clave de encapsulación con coeficientes ≥ q, una clave de desencapsulación con un `H(ek)` incorrecto | DEBE pasar |
| Construcción híbrida | La salida combinada de HKDF coincide con la de referencia | DEBE pasar |

<a id="46-running-kat-tests"></a>

### 4.6 Ejecución de las pruebas KAT

```bash
# From the repository root; each line runs in a subshell, so the working directory does not change.
# They use the tools and dependencies already installed for each SDK; nothing here installs them.

# TypeScript SDK (vitest, from the SDK's own node_modules)
(cd sdks/typescript && ./node_modules/.bin/vitest run src/__tests__/nist-kat.test.ts)

# Python SDK (pytest)
(cd sdks/python && python3 -m pytest tests/test_nist_kat.py -v)

# Go SDK (conformance + interop + PQ providers in one run)
(cd sdks/go && go test ./...)

# Rust SDK (dedicated integration test)
(cd sdks/rust && cargo test --test nist_kat)
```

---

<a id="5-conformity-checklist-for-implementers"></a>

## 5. Lista de comprobación de conformidad para implementadores

Usa esta lista para verificar que tu implementación de DCP-AI es conforme con las normas poscuánticas del NIST.

<a id="51-ml-kem-768-fips-203-checklist"></a>

### 5.1 Lista de ML-KEM-768 (FIPS 203)

- [ ] El tamaño de la clave pública es exactamente de 1184 bytes
- [ ] El tamaño del texto cifrado es exactamente de 1088 bytes
- [ ] El tamaño del secreto compartido es exactamente de 32 bytes
- [ ] La encapsulación usa una implementación conforme con FIPS 203
- [ ] La desencapsulación usa una implementación conforme con FIPS 203
- [ ] La construcción híbrida combina los secretos compartidos de X25519 y ML-KEM-768 mediante HKDF-SHA256
- [ ] El parámetro info de HKDF incluye una etiqueta de contexto de DCP-AI
- [ ] Las claves efímeras se generan por sesión (secreto hacia adelante)
- [ ] Las pruebas KAT pasan para tamaño, ida y vuelta, rechazo implícito (otra clave o un texto cifrado modificado dan un secreto compartido distinto) y comprobaciones de entrada

<a id="52-ml-dsa-65-fips-204-checklist"></a>

### 5.2 Lista de ML-DSA-65 (FIPS 204)

- [ ] El tamaño de la clave pública es exactamente de 1952 bytes
- [ ] El tamaño de la firma es exactamente de 3309 bytes
- [ ] La firma usa una implementación conforme con FIPS 204
- [ ] La verificación usa una implementación conforme con FIPS 204
- [ ] Las etiquetas de contexto de separación de dominios se anteponen antes de firmar
- [ ] Vinculación compuesta: la firma PQ cubre `context || 0x00 || payload || classical_sig`
- [ ] Derivación del kid: `hex(SHA-256(UTF8("ml-dsa-65") || 0x00 || raw_pk))[0:32]`
- [ ] Las pruebas KAT pasan para tamaño, ida y vuelta, otra clave, entre SDK y separación de dominios

<a id="53-ml-dsa-87-fips-204-checklist"></a>

### 5.3 Lista de ML-DSA-87 (FIPS 204)

Para una implementación futura: hoy ningún SDK de DCP-AI implementa ML-DSA-87 (§2.2).

- [ ] El tamaño de la clave pública es exactamente de 2592 bytes
- [ ] El tamaño de la firma es exactamente de 4627 bytes
- [ ] La misma separación de dominios y la misma vinculación compuesta que ML-DSA-65
- [ ] La derivación del kid usa `"ml-dsa-87"` como identificador de algoritmo
- [ ] Las pruebas KAT pasan

<a id="54-slh-dsa-192f-fips-205-checklist"></a>

### 5.4 Lista de SLH-DSA-192f (FIPS 205)

- [ ] El tamaño de la clave pública es exactamente de 48 bytes
- [ ] El tamaño de la firma es exactamente de 35.664 bytes
- [ ] La firma usa una implementación conforme con FIPS 205
- [ ] La verificación usa una implementación conforme con FIPS 205
- [ ] El mismo patrón de separación de dominios que ML-DSA
- [ ] La derivación del kid usa `"slh-dsa-192f"` como identificador de algoritmo
- [ ] Las pruebas KAT pasan

<a id="55-general-cryptographic-checklist"></a>

### 5.5 Lista criptográfica general

- [ ] Todas las operaciones PQ usan implementaciones de tiempo constante cuando es posible
- [ ] Las claves privadas se ponen a cero después de usarlas (eliminación segura de memoria)
- [ ] Las claves privadas se guardan en un almacenamiento adecuado al riesgo del despliegue (este repositorio no proporciona integración con HSM/TPM)
- [ ] El sistema de avisos de algoritmos está implementado para la agilidad criptográfica
- [ ] Campos numéricos solo enteros (sin coma flotante) en todos los payloads firmados
- [ ] Canonicalización `dcp-jcs-v1` (basada en RFC 8785 JCS), el perfil predeterminado y el único normativo, para toda firma de JSON; el candidato experimental `dcp-jcs-v2` solo con una activación explícita

---

<a id="6-migration-path-classical-to-post-quantum"></a>

## 6. Ruta de migración: de la criptografía clásica a la poscuántica

DCP-AI define una ruta de migración en tres fases, de la seguridad solo clásica a la poscuántica.

Las fases son el plan recomendado que se escribió en abril de 2026, no una descripción de lo que hacen hoy los
verificadores. Hoy, `verifySignedBundleV2` solo acepta bundles V2; si un bundle V1 se acepta lo decide un enrutador por
versión o un middleware según su política (`allow_v1_bundles`), que puede rechazarlo pero no emite por sí mismo ninguna
advertencia de obsolescencia ([MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy)). Con `hybrid_preferred`, la ausencia de la firma PQ solo se tolera donde el modo
efectivo (el más estricto entre el modo de la política y el del nivel de riesgo) lo permite, y una firma PQ presente pero
inválida se rechaza siempre.

<a id="phase-1-hybrid-introduction"></a>

### Fase 1: introducción híbrida

| Aspecto | Estado |
|--------|-------|
| Modo de verificación por defecto | `hybrid_preferred` |
| Firmas clásicas | Obligatorias |
| Firmas PQ | Recomendadas, no obligatorias |
| Bundles V1 | Aceptados |
| Vinculación compuesta | Disponible, no obligatoria |

Acciones para implementadores:
1. Integrar un proveedor de ML-DSA-65 junto a Ed25519.
2. Generar pares de claves híbridos (Ed25519 + ML-DSA-65).
3. Producir firmas compuestas cuando sea posible.
4. Los bundles V1 siguen verificándose con normalidad.

<a id="phase-2-hybrid-required"></a>

### Fase 2: híbrido obligatorio

| Aspecto | Estado |
|--------|-------|
| Modo de verificación por defecto | `hybrid_required` |
| Firmas clásicas | Obligatorias |
| Firmas PQ | Obligatorias |
| Bundles V1 | Aceptados con advertencias |
| Vinculación compuesta | Obligatoria para V2 |

Acciones para implementadores:
1. Todos los bundles V2 DEBEN incluir firmas compuestas.
2. La política del verificador impone `min_pq >= 1`.
3. Las cadenas de doble hash (SHA-256 + SHA3-256) DEBERÍAN activarse.
4. Los bundles V1 emiten advertencias de obsolescencia.

<a id="phase-3-pq-only-future-as-a-default"></a>

### Fase 3: solo PQ (futura como valor por defecto)

El modo de verificación `pq_only` ya está implementado en los verificadores; lo que es futuro es convertirlo en el valor por defecto.

| Aspecto | Estado |
|--------|-------|
| Modo de verificación por defecto | `pq_only` |
| Firmas clásicas | Siguen formando parte de la firma compuesta; con `pq_only`, su verificación puede dejar de ser un requisito de aceptación |
| Firmas PQ | Obligatorias |
| Bundles V1 | Rechazados |
| Vinculación compuesta | Sigue siendo `pq_over_classical`: la firma PQ se verifica sobre el mensaje con separación de dominios y los bytes de la firma clásica, así que una firma sin parte clásica no es un formato admitido |

Acciones para implementadores:
1. La verificación clásica puede dejar de ser un requisito de aceptación; la firma clásica sigue en el formato compuesto.
2. Los bundles V1 se rechazan por defecto.
3. El sistema de avisos de gobernanza puede declarar obsoletos los algoritmos clásicos.
4. SLH-DSA-192f proporciona un respaldo si ML-DSA se debilita.

<a id="migration-timeline-recommended"></a>

### Calendario de migración (recomendado)

Este calendario se escribió en abril de 2026 y se conserva tal como se escribió. El 25/10/2026, la política de verificador por defecto de todos los SDK usaba `hybrid_preferred` (con `classical_only` para los pasaportes de bajo riesgo), y el servidor de referencia arrancaba en `hybrid_required`; ningún aviso de gobernanza había activado la fase 3.

```
2026 Q1-Q2    Phase 1: Hybrid Introduction  [CURRENT]
              - SDKs v2.0.x ship composite signatures
              - Verifiers accept both V1 and V2 bundles
              - Early-adopter integrations surface real-world load

2026 Q3-Q4    Phase 2: Hybrid Required
              - Verifier policies default to hybrid_required
              - V1 bundles emit deprecation warnings
              - Wider production deployments

2027+         Phase 3: PQ-Only (conditional)
              - Triggered by a governance advisory if classical
                algorithms are weakened
              - V1 bundle rejection
              - Full post-quantum operation
```

---

<a id="7-nist-pq-standards-transition-guidance-alignment"></a>

## 7. Alineación con las directrices de transición a las normas PQ del NIST

DCP-AI se alinea con las directrices de transición publicadas por el NIST para la criptografía poscuántica:

| Directriz del NIST | Implementación en DCP-AI |
|--------------|----------------------|
| Empezar pronto los despliegues híbridos | Firmas compuestas híbridas desde el lanzamiento de v2.0 |
| Usar algoritmos aprobados de FIPS 203/204/205 | ML-KEM-768, ML-DSA-65, SLH-DSA-192f (ML-DSA-87 reservado, no implementado) |
| Mantener la agilidad criptográfica | Registro de algoritmos + sistema de avisos + abstracción de proveedores |
| Planificar la obsolescencia de algoritmos | Avisos firmados por la gobernanza con respuesta automática |
| Proteger los datos de larga duración | Rastros de auditoría encadenados por hash; las cadenas de doble hash se producen, y los verificadores V2 del código fuente aún no publicado comprueban los campos secundarios presentes (todavía no los paquetes publicados) ([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)) |
| Usar construcciones híbridas durante la transición | Vinculación compuesta `pq_over_classical` |
| Módulos de seguridad de hardware para guardar las claves | No implementado: no hay integración con HSM/TPM; el `HsmCryptoProvider` del código fuente es una simulación (§2.2) |
| Probar la interoperabilidad | Validación KAT entre SDK, suite de pruebas de conformidad |

---

<a id="8-cryptographic-library-requirements"></a>

## 8. Requisitos de las bibliotecas criptográficas

Las implementaciones DEBEN usar bibliotecas criptográficas que proporcionen implementaciones de algoritmos conformes con el NIST.

<a id="libraries-used-by-each-shipped-sdk"></a>

### Bibliotecas que usa cada SDK incluido

| SDK | Biblioteca | Algoritmos |
|-----|---------|-----------|
| TypeScript (`@dcp-ai/sdk`) | `@noble/post-quantum` | ML-DSA-65, SLH-DSA-192f; ML-KEM-768 (interno, no exportado) |
| TypeScript (`@dcp-ai/sdk`) | `tweetnacl` | Ed25519 |
| TypeScript (`@dcp-ai/sdk`) | `crypto` de Node.js | SHA-256, SHA3-256, HMAC-SHA256 (HKDF); X25519 (interno, no exportado) |
| Python (`dcp-ai`) | `pqcrypto` ≥ 1.0 (crates de Rust de Backbone, sin auditoría independiente) | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Python (`dcp-ai`) | `pynacl` (libsodium) | Ed25519 |
| Go (`sdks/go/v2`) | `github.com/cloudflare/circl` | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Go (`sdks/go/v2`) | `crypto/ed25519` (biblioteca estándar) | Ed25519 |
| Rust (crate `dcp-ai`) | `fips203`, `fips204`, `fips205` (integritychain) | ML-KEM-768, ML-DSA-65, SLH-DSA-192f |
| Rust (crate `dcp-ai`) | `ed25519-dalek` | Ed25519 |
| WASM (`@dcp-ai/wasm`) | Compilado a partir del crate de Rust anterior | El mismo conjunto que Rust |

Los SDK de Python, Go y Rust exponen ML-KEM-768 como primitiva KEM (`MlKem768Provider`), y `@dcp-ai/wasm` lo expone como funciones `wasm_ml_kem_768_*`. El SDK de TypeScript tiene proveedores de ML-KEM-768, X25519 e híbridos en su código fuente, pero no los exporta. Ningún SDK ejecuta el intercambio híbrido X25519 + ML-KEM-768 de DCP-04: las dos partes derivan la clave de sesión por su cuenta y la pasan a las funciones de sesión (`create_session` en Python, `CreateSession` en Go). El módulo A2A de Rust solo cubre el descubrimiento, los mensajes del handshake y los ID de sesión.

<a id="library-audit-requirements"></a>

### Requisitos de auditoría de las bibliotecas

En despliegues de producción, las bibliotecas criptográficas DEBERÍAN:
- Haber pasado una auditoría de seguridad independiente
- Implementar operaciones de tiempo constante en las ramas que dependen de secretos
- Proporcionar API seguras para poner la memoria a cero
- Superar los vectores KAT del NIST para todos los algoritmos PQ

---

<a id="9-references"></a>

## 9. Referencias

- **FIPS 203** — NIST, «Module-Lattice-Based Key-Encapsulation Mechanism Standard», agosto de 2024.
- **FIPS 204** — NIST, «Module-Lattice-Based Digital Signature Standard», agosto de 2024.
- **FIPS 205** — NIST, «Stateless Hash-Based Digital Signature Standard», agosto de 2024.
- **SP 800-208** — NIST, «Recommendation for Stateful Hash-Based Signature Schemes», octubre de 2020.
- **RFC 5869** — Krawczyk, H. y P. Eronen, «HMAC-based Extract-and-Expand Key Derivation Function (HKDF)», mayo de 2010.
- **RFC 8032** — Josefsson, S. y I. Liusvaara, «Edwards-Curve Digital Signature Algorithm (EdDSA)», enero de 2017.
- **RFC 8785** — Rundgren, A., Jordan, B. y S. Erdtman, «JSON Canonicalization Scheme (JCS)», junio de 2020.
- **Especificación normativa de DCP-AI v2.0** — `spec/DCP-AI-v2.0.md`
- **Modelo de seguridad de DCP-AI** — `docs/SECURITY_MODEL.md`
- **README de los KAT del NIST de DCP-AI** — `tests/nist-kat/README.md`
