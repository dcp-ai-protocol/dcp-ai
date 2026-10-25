<sub>[English](AUDIT-v2.0-FINAL.md) · [中文](AUDIT-v2.0-FINAL.zh-CN.md) · **Español** · [日本語](AUDIT-v2.0-FINAL.ja.md) · [Português](AUDIT-v2.0-FINAL.pt-BR.md)</sub>

<a id="dcp-ai-v20-final-security-audit--all-13-gaps-verified-closed"></a>
<a id="dcp-ai-v20-final-security-audit-all-13-gaps-verified-closed"></a>

# Auditoría de seguridad final de DCP-AI v2.0 — las 13 carencias verificadas como cerradas

> Traducción informativa de [la versión en inglés](AUDIT-v2.0-FINAL.md), actualizada el 25/10/2026. **Registro histórico con fecha**: no describe el estado actual. Si difieren, prevalece la versión en inglés.

**Fecha de la auditoría:** 2026-02-26  
**Auditor:** DCP-AI Protocol Governance  
**Alcance:** Verificación completa del cierre de las carencias de DCP-AI v2.0, fase 3  
**Resultado:** LAS 13 CARENCIAS CERRADAS  

> **Registro histórico, conservado tal como se escribió.** Esta auditoría tiene fecha del 26/02/2026. Revisiones posteriores (octubre de 2026) matizan algunas de sus conclusiones; el estado actual está en los documentos enlazados aquí, no en este registro:
>
> - **Carencia n.º 11 y la implementación de referencia de HSM.** `HsmCryptoProvider` y `HsmProviderFactory` son un patrón simulado, no una integración con un HSM. No se exportan desde `@dcp-ai/sdk` y no tienen vinculación PKCS#11; `sign` devuelve un hash en lugar de una firma, y `verify` acepta cualquier firma de la longitud adecuada. No deben usarse para evidencia real ([docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2).
> - **Carencia n.º 1.** La recuperación de claves del SDK y `dcp recovery-setup` producen las partes de Shamir, pero no las cifran con el KEM híbrido.
> - **Carencia n.º 4.** El servidor de referencia comprueba la estructura del `composite_sig` de un aviso, no su firma; lo protege el token de operador ([server/README.md](../server/README.md)).
> - **Modo solo PQ.** `pq_only` sigue necesitando los bytes de la firma clásica en los verificadores de los SDK: la firma PQ los cubre bajo `pq_over_classical`, así que no significa que pueda omitirse el componente clásico.
> - **Carencia n.º 6.** Las ayudas de doble hash existen, pero los verificadores no recalculan `prev_hash_secondary` ni `audit_merkle_root_secondary` ([VERIFICATION.md](VERIFICATION.md), V2-11).
> - **`dcp audit gaps`** comprueba que existen archivos y que contienen marcadores, no el comportamiento. El 25/10/2026 informa de que la carencia n.º 7 está abierta, porque busca `integrations/fastapi/__init__.py`, que ahora es `sdks/python/dcp_ai/fastapi/__init__.py`.

---

<a id="gap-verification-matrix"></a>

## Matriz de verificación de las carencias

<a id="gap-1-key-recovery-m-of-n-social-recovery"></a>

### Carencia n.º 1: Recuperación de claves (recuperación social M de N)

- **Estado:** CERRADA
- **Implementación:** `sdks/typescript/src/core/key-recovery.ts`
- **CLI:** `dcp recovery-setup --threshold <M> --shares <N>`
- **Esquema:** `schemas/v2/recovery_config.schema.json`
- **Verificación:** El esquema de Shamir divide el secreto maestro en N partes con umbral M. Partes cifradas con KEM híbrido. La recuperación exige M de N partes más una autenticación fuera de banda.

<a id="gap-2-rpr-privacy--blinded-mode"></a>
<a id="gap-2-rpr-privacy-blinded-mode"></a>

### Carencia n.º 2: Privacidad del RPR — modo cegado

- **Estado:** CERRADA
- **Implementación:** `sdks/typescript/src/core/blinded-rpr.ts`
- **Tipo:** `BlindedResponsiblePrincipalRecordV2` en `sdks/typescript/src/types/v2.ts`
- **Esquema:** `schemas/v2/blinded_rpr.schema.json`
- **Verificación:** Los campos de datos personales se sustituyen por `pii_hash`. Se conservan la jurisdicción, la responsabilidad y las claves. Divulgación regulatoria mediante el RPR completo bajo demanda.

<a id="gap-3-missing-v2-artifacts"></a>

### Carencia n.º 3: Artefactos V2 que faltaban

- **Estado:** CERRADA
- **JurisdictionAttestationV2:** Tipo + esquema (`schemas/v2/jurisdiction_attestation.schema.json`)
- **HumanConfirmationV2:** Tipo + esquema (`schemas/v2/human_confirmation.schema.json`)
- **Verificación:** Ambos artefactos incluyen firmas compuestas y session_nonce para la vinculación de sesión.

<a id="gap-4-algorithm-deprecation-protocol"></a>

### Carencia n.º 4: Protocolo de obsolescencia de algoritmos

- **Estado:** CERRADA
- **Implementación:** `sdks/typescript/src/core/algorithm-advisory.ts`
- **Respuesta automatizada:** función `autoApplyAdvisoriesToPolicy()`
- **Verificación de gobernanza:** función `verifyGovernanceAdvisory()`
- **Esquema:** `schemas/v2/algorithm_advisory.schema.json`
- **Servidor:** `POST /v2/advisory/publish`, `GET /v2/advisory/check`, `POST /v2/advisory/auto-apply`
- **CLI:** `dcp advisory check [url]`
- **Verificación:** Los avisos los firma la gobernanza. Los verificadores eliminan automáticamente los algoritmos obsoletos o revocados, añaden los sustitutos y pasan automáticamente a pq_only cuando se eliminan todos los algoritmos clásicos.

<a id="gap-5-multi-party-authorization"></a>

### Carencia n.º 5: Autorización de varias partes

- **Estado:** CERRADA
- **Implementación:** `sdks/typescript/src/core/multi-party-auth.ts`
- **Esquema:** `schemas/v2/multi_party_authorization.schema.json`
- **Servidor:** `POST /v2/multi-party/authorize`
- **Verificación:** Se exigen firmas compuestas M de N. El rol de propietario siempre es obligatorio. Roles: owner, org_admin, recovery_contact.

<a id="gap-6-dual-hash-chains"></a>

### Carencia n.º 6: Cadenas de doble hash

- **Estado:** CERRADA
- **Implementación:** `sdks/typescript/src/core/dual-hash.ts`
- **Verificación:** SHA-256 + SHA3-256 en paralelo. AuditEventV2 incluye `prev_hash_secondary` e `intent_hash_secondary`. El manifiesto del bundle incluye `audit_merkle_root_secondary`.

<a id="gap-7-python-integrations-v2"></a>

### Carencia n.º 7: Integraciones de Python V2

- **Estado:** CERRADA
- **FastAPI:** `integrations/fastapi/__init__.py`
- **LangChain:** `integrations/langchain/`
- **OpenAI:** `integrations/openai/`
- **CrewAI:** `integrations/crewai/`
- **Verificación:** Todas las integraciones actualizadas con la configuración de identidad V2, la firma compuesta, la propagación del nonce de sesión y la verificación V2.

<a id="gap-8-grpcprotobuf-v2-messages"></a>

### Carencia n.º 8: Mensajes gRPC/Protobuf V2

- **Estado:** CERRADA
- **Implementación:** `api/proto/dcp.proto`
- **Verificación:** Tipos de mensaje V2: CompositeSignature, SignedPayload, BundleManifest, AgentPassportV2, ResponsiblePrincipalRecordV2, IntentV2, PolicyDecisionV2, AuditEventV2, PQCheckpoint, SignedBundleV2.

<a id="gap-9-cli-v2-commands"></a>

### Carencia n.º 9: Comandos V2 de la CLI

- **Estado:** CERRADA
- **Implementación:** `bin/dcp.js`
- **Comandos V2:** `keygen --hybrid`, `sign-bundle --composite`, `verify-bundle --policy`, `kid`, `recovery-setup`, `emergency-revoke`, `rotate-key`, `capabilities`, `advisory check`
- **Comandos de la fase 3:** `keys rotate`, `keys certify`, `governance ceremony`, `governance sign-advisory`, `governance verify-advisory`, `audit gaps`
- **Verificación:** Cobertura completa en la CLI de las operaciones V1, V2 y de la fase 3.

<a id="gap-10-nist-kat-validation"></a>

### Carencia n.º 10: Validación con KAT del NIST

- **Estado:** CERRADA
- **Proveedores:** `sdks/typescript/src/providers/ml-dsa-65.ts`, `slh-dsa-192f.ts`
- **Verificación:** Las implementaciones de los proveedores hacen referencia a las normas FIPS 204/205. Estructura de validación con KAT definida en el plan de pruebas. Se aplica el indicador `isConstantTime` del proveedor.

<a id="gap-11-secure-memory--hsm-provider"></a>
<a id="gap-11-secure-memory-hsm-provider"></a>

### Carencia n.º 11: Memoria segura / proveedor HSM

- **Estado:** CERRADA
- **Memoria segura:** `sdks/typescript/src/core/secure-memory.ts` — `SecureKeyGuard` con borrado seguro al desecharse
- **Proveedor HSM:** `sdks/typescript/src/providers/hsm-provider.ts` — implementación de referencia `HsmCryptoProvider`
- **Fábrica HSM:** `HsmProviderFactory` para la compatibilidad de HSM con varios algoritmos
- **Verificación:** HsmCryptoProvider implementa la interfaz CryptoProvider. Las claves privadas nunca entran en la memoria de la aplicación. Gestión de sesiones PKCS#11. Admite Ed25519, ML-DSA-65, ML-DSA-87, SLH-DSA-192f.

<a id="gap-12-version--capability-negotiation"></a>
<a id="gap-12-version-capability-negotiation"></a>

### Carencia n.º 12: Negociación de versión y capacidades

- **Estado:** CERRADA
- **Servidor:** `GET /.well-known/dcp-capabilities.json`
- **Cabeceras:** admite la cabecera `DCP-Version`
- **CLI:** `dcp capabilities <endpoint>`
- **Verificación:** El documento de capacidades incluye las versiones, los algoritmos, los formatos de intercambio y las funcionalidades admitidos, y el hash de la política de verificador.

<a id="gap-13-emergency-revocation-panic-button"></a>

### Carencia n.º 13: Revocación de emergencia (botón del pánico)

- **Estado:** CERRADA
- **Implementación:** `sdks/typescript/src/core/emergency-revocation.ts`
- **Esquema:** `schemas/v2/emergency_revocation.schema.json`
- **Servidor:** `POST /v2/emergency-revoke` con limitación de tasa
- **CLI:** `dcp emergency-revoke --agent <id> --token <secret>`
- **Verificación:** Token de revocación registrado previamente (compromiso SHA-256). Revelar la preimagen revoca todas las claves del agente. Un solo uso. Con limitación de tasa.

---

<a id="phase-3-specific-verifications"></a>

## Verificaciones específicas de la fase 3

<a id="pq-only-mode"></a>

### Modo solo PQ

- **Verificador:** preajuste `PQ_ONLY_VERIFIER_POLICY` en `verify-v2.ts`
- **Servidor:** `POST /v2/policy/mode` para cambiar de modo en tiempo de ejecución
- **Verificación:** Las firmas clásicas son opcionales. Los bundles V1 se rechazan. Avisos de obsolescencia en los bundles solo clásicos.

<a id="key-rotation-ceremony"></a>

### Ceremonia de rotación de claves

- **CLI:** `dcp keys rotate --key-dir <dir> --new-alg <alg>`
- **CLI:** `dcp keys certify --key-dir <dir> --endpoint <url>`
- **SDK:** `proof-of-possession.ts` — `createKeyRotation()` y `verifyKeyRotation()`
- **Verificación:** Prueba de posesión de la clave nueva + autorización de la clave antigua. Admite periodo de gracia. Certificación por la pasarela.

<a id="algorithm-deprecation-protocol--automated-response"></a>
<a id="algorithm-deprecation-protocol-automated-response"></a>

### Protocolo de obsolescencia de algoritmos — respuesta automatizada

- **SDK:** `autoApplyAdvisoriesToPolicy()` en `algorithm-advisory.ts`
- **Servidor:** `POST /v2/advisory/auto-apply`
- **Verificación:** Eliminación automática de algoritmos obsoletos o revocados. Inyección del algoritmo sustituto. Paso automático a pq_only cuando se eliminan todos los clásicos. Registro de auditoría de los cambios de política.

<a id="hsmtpm-reference-implementation"></a>

### Implementación de referencia de HSM/TPM

- **SDK:** `HsmCryptoProvider` en `providers/hsm-provider.ts`
- **Fábrica:** `HsmProviderFactory` para sesiones HSM con varios algoritmos
- **Verificación:** Implementa la interfaz CryptoProvider. Ciclo de vida de las sesiones PKCS#11. Las claves privadas nunca están en la memoria de la aplicación.

<a id="governance-key-ceremony"></a>

### Ceremonia de claves de gobernanza

- **SDK:** `governance.ts` — `generateGovernanceParticipant()`, `executeGovernanceCeremony()`, `signAdvisoryAsGovernance()`
- **CLI:** `dcp governance ceremony`, `dcp governance sign-advisory`, `dcp governance verify-advisory`
- **Servidor:** `POST /v2/governance/register`, `GET /.well-known/governance-keys.json`
- **Verificación:** Firmas compuestas M de N. Cada participante tiene Ed25519 + ML-DSA-65. Aplicación del umbral.

<a id="normative-specification"></a>

### Especificación normativa

- **Documento:** `spec/DCP-AI-v2.0.md`
- **Verificación:** Especificación completa que cubre todos los aspectos del protocolo: algoritmos, gestión de claves, firmas, verificación, privacidad, gobernanza, modelo de amenazas y requisitos de conformidad.

---

<a id="audit-conclusion"></a>

## Conclusión de la auditoría

Las 13 carencias identificadas en el plan de actualización del protocolo poscuántico de DCP-AI v2.0 se han verificado como cerradas. Las incorporaciones de la fase 3 (modo pq_only, ceremonia de rotación de claves, respuesta automática a la obsolescencia de algoritmos, proveedor HSM, ceremonia de gobernanza) están completamente implementadas.

El protocolo DCP-AI v2.0 está listo para su publicación.

**Auditoría verificada por:** el comando de la CLI `dcp audit gaps`  
**Ejecución:** `node bin/dcp.js audit gaps` desde la raíz del repositorio
