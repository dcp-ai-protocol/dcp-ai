<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# dcp-ai — SDK Python

SDK Python oficial para o Digital Citizenship Protocol (DCP v2.0). Modelos Pydantic v2, assinaturas híbridas pós-quânticas (Ed25519 + ML-DSA-65, além de SLH-DSA-192f), a primitiva KEM ML-KEM-768, assinaturas compostas com binding `pq_over_classical`, assinatura e verificação de bundles V1 e V2, observabilidade OpenTelemetry, comportamento DCP-04 a DCP-09 e uma CLI completa.

## Instalação

```bash
pip install dcp-ai
```

### Extras opcionais

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
pip install "dcp-ai[otlp]"       # OpenTelemetry OTLP exporter
```

## Recursos

| Área | Status |
|---|---|
| Provedores Ed25519 / ML-DSA-65 (FIPS 204) | Sim |
| Provedor SLH-DSA-192f | Sim, FIPS 205 (puro, contexto vazio), interoperável com os outros SDKs |
| ML-KEM-768 | Primitiva KEM: sim (`MlKem768Provider`, FIPS 203). Troca de chaves híbrida X25519 + ML-KEM-768 do DCP-04: ainda não |
| Assinaturas compostas (`pq_over_classical`) + verificação | Sim |
| JSON canônico v2 + separação de domínio | Sim |
| Dual hash (SHA-256 + SHA3-256) + Merkle roots | Sim |
| Assinatura + verificação de bundles | V1: sim. V2 (`SignedBundleV2`): sim, `BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| DCP-04 descoberta A2A + handshake + sessão AES-256-GCM (via `cryptography`); cada mensagem é aceita uma única vez dentro da janela (§8.4) | Sim |
| DCP-05 ciclo de vida de agentes (commissioning / vitality / decommissioning) | Sim |
| DCP-06 sucessão digital (testamento digital, transferência de memória, cerimônia) | Sim |
| DCP-07 resolução de disputas + arbitragem + jurisprudência | Sim |
| DCP-08 direitos + obrigações + conformidade | Sim |
| DCP-09 delegação + cadeias de delegação verificáveis (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + limiar de consciência + espelho do principal | Sim |
| Helpers de nonce de sessão, motor de tier de segurança (`compute_security_tier(intent, policy_decision, mandate_chain_tier)`, spec §14.2), revogação de emergência | Sim |
| Checkpoints PQ lazy + `PQCheckpointManager` | Sim |
| Helpers de RPR blindado, autorização multi-parte, advisory de algoritmo | Sim |
| Códigos de erro canônicos (38 compartilhados entre todos os SDKs) + `detect_wire_format` | Sim |
| Exportador OpenTelemetry / OTLP (extra opcional `[otlp]`) | Sim |

## Início Rápido

```python
from dcp_ai import (
    BundleBuilder,
    sign_bundle,
    verify_signed_bundle,
    generate_keypair,
    ResponsiblePrincipalRecord,
    AgentPassport,
    Intent,
    IntentTarget,
    PolicyDecision,
)

# 1. Generate Ed25519 keypair
keys = generate_keypair()

# 2. Build a Citizenship Bundle
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(
        dcp_version="1.0",
        human_id="human-001",
        entity_type="natural_person",
        jurisdiction="ES",
        liability_mode="full",
        created_at="2025-01-01T00:00:00Z",
        expires_at=None,
    ))
    .agent_passport(AgentPassport(
        dcp_version="1.0",
        agent_id="agent-001",
        human_id="human-001",
        agent_name="MyAgent",
        capabilities=["browse", "api_call"],
        risk_tier="medium",
        status="active",
        created_at="2025-01-01T00:00:00Z",
        expires_at=None,
    ))
    .intent(Intent(
        dcp_version="1.0",
        agent_id="agent-001",
        human_id="human-001",
        timestamp="2025-01-01T00:00:00Z",
        action_type="api_call",
        target=IntentTarget(channel="api", endpoint="https://api.example.com/data"),
        data_classes=["public"],
        estimated_impact="low",
    ))
    .policy_decision(PolicyDecision(
        dcp_version="1.0",
        agent_id="agent-001",
        human_id="human-001",
        timestamp="2025-01-01T00:00:00Z",
        decision="allow",
        matched_rules=["default-allow"],
    ))
    .build()
)

# 3. Sign
signed = sign_bundle(bundle, keys["secret_key_b64"])

# 4. Verify
result = verify_signed_bundle(signed, keys["public_key_b64"])
print(result)  # {"verified": True, "errors": []}
```

## CLI

O SDK inclui uma CLI construída com Typer. Disponível como `dcp` após a instalação.

```bash
# Version
dcp version

# Generate Ed25519 keypair
dcp keygen [out_dir]

# Validate an object against a DCP schema
dcp validate <schema_name> <json_path>

# Validate a complete Citizenship Bundle
dcp validate-bundle <bundle_path>

# Verify a Signed Bundle
dcp verify <signed_path> [public_key_path]

# Compute bundle hash (SHA-256)
dcp bundle-hash <bundle_path>

# Compute Merkle root of audit entries
dcp merkle-root <bundle_path>

# Compute intent_hash
dcp intent-hash-cmd <intent_path>
```

## Referência de API

### Crypto

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `generate_keypair()` | `() -> dict[str, str]` | Retorna `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | Assina, retorna base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | Verifica assinatura |
| `canonicalize(obj)` | `(Any) -> str` | JSON determinístico |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | Deriva a chave pública |

### Merkle e Hashing

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `hash_object(obj)` | `(Any) -> str` | SHA-256 do JSON canonicalizado |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Merkle root |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | Merkle root das entradas de auditoria |
| `intent_hash(intent)` | `(Any) -> str` | Hash da intenção |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | Hash da entrada anterior |

### Validação de Schema

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | Retorna `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | Valida um bundle completo |

### Bundle Builder

```python
bundle = (
    BundleBuilder()
    .responsible_principal_record(rpr)
    .agent_passport(passport)
    .intent(intent)
    .policy_decision(policy)
    .add_audit_entry(entry)       # Manual
    .create_audit_entry(...)      # Auto-computes hashes
    .build()                      # => CitizenshipBundle
)
```

### Assinatura de Bundle

```python
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

### Verificação de Bundle

```python
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

Verifica: schema, assinatura Ed25519, `bundle_hash`, `merkle_root`, cadeia de `intent_hash`, cadeia de `prev_hash`.

### Bundles V2

`BundleBuilderV2`, `sign_bundle_v2` e `verify_signed_bundle_v2` (em `dcp_ai.v2`) portam `builder-v2.ts`, `signer-v2.ts` e `verify-v2.ts` do SDK TypeScript. Os artefatos são dicts `SignedPayload` (`{"payload", "payload_hash", "composite_sig"}`); a assinatura do bundle é uma assinatura composta sobre o manifest.

```python
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, BundleBuilderV2, sign_bundle_v2, verify_signed_bundle_v2

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())

bundle = (
    BundleBuilderV2(session_nonce)
    .responsible_principal_record(signed_rpr)
    .agent_passport(signed_passport)
    .intent(signed_intent)
    .policy_decision(signed_policy)
    .add_audit_entries(audit_events)
    .build()
)
signed = await sign_bundle_v2(bundle, registry, "human", "human-001", classical_key, pq_key)
result = await verify_signed_bundle_v2(signed, registry)  # DEFAULT_VERIFIER_POLICY
# {"verified": bool, "errors": [...], "warnings": [...], "details": {...}}
```

O verificador também confere a assinatura composta de cada artefato (o RPR com as `binding_keys` do principal, o restante com as chaves do passaporte) e rejeita, em qualquer modo de política, uma assinatura PQ presente mas inválida. O modo é o mais estrito entre o da política e o do nível de segurança (spec §14.3), e `details["resolved_tier"]` informa o nível.

### Admissão: Principais Confiáveis e strict-v1

Um bundle verificado é assinado pelas chaves que ele mesmo lista; isso não prova quem é o principal. A admissão aceita um bundle somente quando as assinaturas do principal foram feitas com chaves de um principal que o seu conjunto de confiança lista, e opcionalmente sob o perfil `strict-v1`, fixado pelo operador (assinaturas híbridas, audiência assinada, uma sessão de no máximo 300 s e um snapshot de revogação recente).

```python
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` aceita um relógio opcional e informa `details["signer_keys"]`; sem eles se comporta como antes.
- `evaluate_admission_v2` avalia um resultado do verificador que você já tem (sem criptografia nem E/S) e confia nele; `revocation_subjects` lista o que uma fonte de revogação deve responder, e `deny_list_revocation_source(url)` lê a lista de revogações do serviço de referência.
- FastAPI: `DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`; veja [`integrations/fastapi/README.md`](../../integrations/fastapi/README.md). Guia: [`docs/ADMISSION.md`](../../docs/ADMISSION.md). Especificação e códigos: [`spec/profiles/admission`](../../spec/profiles/admission/README.md).

### Cadeias de Delegação (DCP-09 §3.5)

Um mandato raiz é assinado pelo humano (`create_delegation_mandate`); o agente que o detém pode emitir um
submandato para outro agente (`create_sub_mandate`), assinado com suas próprias chaves. `verify_mandate_chain` verifica
a cadeia começando pela raiz e offline: assinaturas até o humano, vínculos com o pai e profundidade, `sub_delegation`,
janelas de validade aninhadas, atenuação (ações, `data_classes` e `limits` só se restringem), o piso de nível
de segurança e a revogação.

```python
from dcp_ai.v2 import create_sub_mandate, verify_mandate_chain, compute_security_tier

sub = await create_sub_mandate(
    registry, orchestrator_classical, orchestrator_pq, root_mandate,
    mandate_id="mandate:sub-1", session_nonce=nonce, agent_id="agent:subagent",
    authority_scope=[{"domain": "email", "actions_permitted": ["read"], "data_classes": ["contact_info"]}],
    valid_from="2026-03-01T00:00:00Z", valid_until="2026-06-01T00:00:00Z", revocable=True,
)
result = await verify_mandate_chain(
    registry, [root_mandate, sub], set(),
    {"human_keys": human_key_entries, "agent_keys": {"agent:orchestrator": orchestrator_key_entries}},
)
# {"valid", "errors", "depth", "effective_tier"}; the tier floor can only raise an action's tier.
tier = compute_security_tier(intent, policy_decision, result["effective_tier"] if result["valid"] else None)
```

### Modelos Pydantic

Todos os artefatos DCP v1 estão disponíveis como modelos Pydantic v2 com validação automática:

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**Modelos V2 (DCP-05–09):**

DCP-05 — Ciclo de Vida: `LifecycleState`, `TerminationMode`, `DataDisposition`, `VitalityMetrics`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`

DCP-06 — Sucessão: `TransitionType`, `MemoryDisposition`, `MemoryClassification`, `SuccessorPreference`, `DigitalTestament`, `SuccessionRecord`, `MemoryTransferEntry`, `DualHashRef`, `MemoryTransferManifest`

DCP-07 — Disputas: `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel`, `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`

DCP-08 — Direitos: `RightType`, `ComplianceStatus`, `RightEntry`, `RightsDeclaration`, `ObligationRecord`, `RightsViolationReport`

DCP-09 — Delegação: `AuthorityScopeEntry`, `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction`, `AwarenessThreshold`

```python
# Example: Lifecycle management
from dcp_ai.v2.models import CommissioningCertificate, LifecycleState

cert = CommissioningCertificate(
    certificate_id="cert-001",
    agent_id="agent-001",
    commissioned_by="human-001",
    commissioned_at="2026-03-01T00:00:00Z",
    initial_state=LifecycleState.COMMISSIONED,
    conditions=["Must complete onboarding within 30 days"],
)
```

### Separação de Domínio (V2)

**Contextos V2 de separação de domínio:** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

## Desenvolvimento

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

### Dependências

- `pynacl` — Criptografia Ed25519
- `jsonschema` — Validação JSON Schema
- `pydantic` v2 — Modelos de dados
- `typer` — Framework de CLI
- `pqcrypto` ≥ 1.0 — ML-DSA-65, SLH-DSA-192f, ML-KEM-768 (FIPS 204/205/203)
- `cryptography` — AES-256-GCM para as sessões A2A do DCP-04

## Licença

Apache-2.0
