<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai--python-sdk"></a>
<a id="dcp-ai-python-sdk"></a>

# dcp-ai — SDK Python

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

SDK oficial em Python para o Digital Citizenship Protocol (DCP v2.0). Modelos Pydantic v2, assinaturas híbridas pós-quânticas (Ed25519 + ML-DSA-65, além de SLH-DSA-192f), a primitiva KEM ML-KEM-768, assinaturas compostas com vinculação `pq_over_classical`, assinatura e verificação de bundles V1 e V2, observabilidade com OpenTelemetry, o comportamento do DCP-04 ao DCP-09 e uma CLI completa.

<a id="installation"></a>

## Instalação

**Status de publicação.** Este README descreve o código de `main`. A última versão marcada, `v2.10.0`, tem
`dcp-ai` 2.9.0 para Python. O que o changelog lista em [`[Unreleased]`](../../CHANGELOG.md#unreleased) não está em
nenhuma versão marcada: admissão, cadeias de delegação, a janela de recepção A2A, workers de lista de bloqueio limitados e as
APIs experimentais de `dcp-jcs-v2`. Para executar os exemplos abaixo, instale a partir de uma cópia do repositório:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "dcp-ai/sdks/python"
```

A instalação pelo registro fornece a versão publicada, sem os recursos não publicados:

```bash
pip install dcp-ai
```

<a id="optional-extras"></a>

### Extras opcionais

Pelo registro (versão publicada); a partir de uma cópia do repositório valem os mesmos extras: `pip install -e "dcp-ai/sdks/python[fastapi]"`.

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
pip install "dcp-ai[otlp]"       # OpenTelemetry OTLP exporter
```

<a id="features"></a>

## Recursos

| Área | Status |
|---|---|
| Provedores Ed25519 / ML-DSA-65 (FIPS 204) | Sim |
| Provedor SLH-DSA-192f | Sim, FIPS 205 (puro, contexto vazio), interoperável com os outros SDKs |
| ML-KEM-768 | Primitiva KEM: sim (`MlKem768Provider`, FIPS 203). Troca de chaves híbrida X25519 + ML-KEM-768 do DCP-04: ainda não |
| Assinaturas compostas (`pq_over_classical`) + verificação | Sim |
| JSON canônico v2 + separação de domínio | Sim |
| Hash duplo (SHA-256 + SHA3-256) + raízes de Merkle | Sim |
| Assinatura + verificação de bundles | V1: sim. V2 (`SignedBundleV2`): sim, `BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| Descoberta A2A do DCP-04 + handshake + sessão AES-256-GCM (via `cryptography`); cada mensagem é aceita uma única vez dentro da janela (§8.4) | Sim |
| Ciclo de vida do agente do DCP-05 (comissionamento / vitalidade / descomissionamento) | Sim |
| Sucessão digital do DCP-06 (testamento, transferência de memória, cerimônia) | Sim |
| Resolução de disputas do DCP-07 + arbitragem + jurisprudência | Sim |
| Direitos do DCP-08 + obrigações + conformidade | Sim |
| Delegação do DCP-09 + cadeias de delegação verificáveis (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + limiar de atenção + espelho do principal | Sim |
| Utilitários de nonce de sessão, motor de níveis de segurança (`compute_security_tier(intent, policy_decision, mandate_chain_tier)`, spec §14.2), revogação de emergência | Sim |
| Checkpoints PQ preguiçosos + `PQCheckpointManager` | Sim |
| RPR ocultado, autorização multipartes, utilitários de avisos sobre algoritmos | Sim |
| Códigos de erro canônicos (38 compartilhados por todos os SDKs) + `detect_wire_format` | Sim |
| Exportador OpenTelemetry / OTLP (extra opcional `[otlp]`) | Sim |
| Admissão: principais confiáveis e o perfil `strict-v1` | Sim, não publicado (veja o status de publicação) |
| Candidato de canonicalização `dcp-jcs-v2` (entrada, roteador, verificador de bytes, produtores) | Experimental e opt-in, não publicado; não normativo |

<a id="quickstart"></a>

## Início rápido

Um bundle V1 assinado com Ed25519. O RPR é assinado com a chave do principal e o passaporte com a do agente,
cada um sobre o JSON canônico do objeto sem o campo `signature`; `create_audit_entry` calcula
`intent_hash` e a cadeia `prev_hash`. `verify_signed_bundle` verifica a assinatura do bundle, seus hashes e a
cadeia, não essas assinaturas internas: verifique-as você mesmo, como abaixo. Para bundles V2, veja [Bundles V2](#v2-bundles).

```python
from datetime import datetime, timezone

from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)

now = datetime.now(timezone.utc).isoformat()
principal_keys = generate_keypair()
agent_keys = generate_keypair()

# 1. The responsible principal, signed with the principal's key (the object without "signature")
rpr_body = {
    "dcp_version": "1.0", "human_id": "human:example-001", "legal_name": "Example Principal",
    "entity_type": "natural_person", "jurisdiction": "ES", "liability_mode": "owner_responsible",
    "override_rights": True, "issued_at": now, "expires_at": None, "contact": None,
}
rpr = {**rpr_body, "signature": sign_object(rpr_body, principal_keys["secret_key_b64"])}

# 2. The agent passport, signed with the agent's key (the object without "signature")
passport_body = {
    "dcp_version": "1.0", "agent_id": "agent:example-001", "public_key": agent_keys["public_key_b64"],
    "principal_binding_reference": "human:example-001", "capabilities": ["browse", "api_call"],
    "risk_tier": "low", "created_at": now, "status": "active",
}
passport = {**passport_body, "signature": sign_object(passport_body, agent_keys["secret_key_b64"])}

# 3. Intent, policy decision and one audit entry
intent = Intent(
    intent_id="intent:example-001", agent_id="agent:example-001", human_id="human:example-001",
    timestamp=now, action_type="api_call", target={"channel": "api", "domain": "api.example.com"},
    data_classes=["none"], estimated_impact="low", requires_consent=False,
)
policy = PolicyDecision(
    intent_id="intent:example-001", decision="approve", risk_score=0.05, reasons=["low-impact call"],
)
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(**rpr))
    .agent_passport(AgentPassport(**passport))
    .intent(intent)
    .policy_decision(policy)
    .create_audit_entry(
        audit_id="audit:example-001", timestamp=now, agent_id="agent:example-001",
        human_id="human:example-001", intent_id="intent:example-001", policy_decision="approved",
        outcome="call_completed", evidence=AuditEvidence(tool="http", result_ref=None),
    )
    .build()
)

# 4. Sign with the principal's key and verify against the principal's public key
signed = sign_bundle(bundle, principal_keys["secret_key_b64"])
print(verify_signed_bundle(signed, principal_keys["public_key_b64"]))  # {'verified': True}

# 5. The inner signatures, over the same objects without "signature"
print(verify_object(rpr_body, rpr["signature"], principal_keys["public_key_b64"]))  # True
print(verify_object(passport_body, passport["signature"], agent_keys["public_key_b64"]))  # True
```

## CLI

O SDK inclui uma CLI construída com Typer. Fica disponível como `dcp` após a instalação.

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

<a id="api-reference"></a>

## Referência da API

<a id="crypto"></a>

### Criptografia

| Função | Assinatura | Descrição |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | Retorna `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | Assina e retorna base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | Verifica a assinatura |
| `canonicalize(obj)` | `(Any) -> str` | JSON determinístico |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | Deriva a chave pública |

<a id="merkle--hashing"></a>
<a id="merkle-hashing"></a>

### Merkle e hashes

| Função | Assinatura | Descrição |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | SHA-256 do JSON canonicalizado |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Raiz de Merkle |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | Raiz de Merkle das entradas de auditoria |
| `intent_hash(intent)` | `(Any) -> str` | Hash da intenção |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | Hash da entrada anterior |

<a id="schema-validation"></a>

### Validação de esquemas

| Função | Assinatura | Descrição |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | Retorna `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | Valida um bundle completo |

<a id="bundle-builder"></a>

### Construtor de bundles

```python
# Fragment: rpr, passport, intent, policy and entry are the models built in the Quickstart.
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

<a id="bundle-signing"></a>

### Assinatura de bundles

```python
# Signature (not runnable)
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

<a id="bundle-verification"></a>

### Verificação de bundles

```python
# Signature (not runnable)
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

Verifica: esquema, assinatura Ed25519, `bundle_hash`, `merkle_root`, cadeia `intent_hash` e cadeia `prev_hash`.

<a id="v2-bundles"></a>

### Bundles V2

`BundleBuilderV2`, `sign_bundle_v2` e `verify_signed_bundle_v2` (em `dcp_ai.v2`) portam `builder-v2.ts`, `signer-v2.ts` e `verify-v2.ts` do SDK TypeScript. Os artefatos são dicionários `SignedPayload` (`{"payload", "payload_hash", "composite_sig"}`); a assinatura do bundle é uma assinatura composta sobre o manifesto.

```python
# Fragment, inside an async function: session_nonce, the signed artifacts (signed_rpr, signed_passport, signed_intent, signed_policy), audit_events, classical_key and pq_key come from your application.
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

O verificador também confere a assinatura composta de cada artefato (o RPR com as `binding_keys` do principal e o restante com as chaves do passaporte) e, em todos os modos de política, rejeita uma assinatura PQ presente mas inválida. O modo é o mais estrito entre o modo da política e o do nível de segurança (spec §14.3), e `details["resolved_tier"]` informa o nível.

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admissão: Trusted Principals e strict-v1 (não publicado)

Um bundle verificado é assinado pelas chaves que ele lista; isso não prova quem é o principal. A admissão aceita um bundle somente quando as assinaturas de principal foram feitas com chaves de um principal que consta no seu conjunto de confiança e, opcionalmente, sob o perfil `strict-v1` fixado pelo operador (assinaturas híbridas, audiência assinada, uma sessão de no máximo 300 s, um snapshot de revogação recente).

```python
# Fragment, inside an async function: trust_set comes from operator configuration, signed_bundle from the request, snapshot from your revocation source, registry as in V2 Bundles.
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` aceita um relógio opcional e informa `details["signer_keys"]`; sem eles, comporta-se como antes.
- `evaluate_admission_v2` avalia um resultado de verificação que você já tem (sem criptografia, sem E/S) e confia nele; `revocation_subjects` lista aquilo por que uma fonte de revogação precisa responder, e `deny_list_revocation_source(url)` lê a lista de bloqueio do serviço de revogação de referência; com `workers=DenyListWorkers(max_workers=...)` suas threads de download são contadas e limitadas até terminarem de fato (opt-in; veja o README do FastAPI).
- FastAPI: `DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`; veja [`integrations/fastapi/README.md`](../../integrations/fastapi/README.md). Guia: [`docs/ADMISSION.md`](../../docs/ADMISSION.md). Especificação e códigos: [`spec/profiles/admission`](../../spec/profiles/admission/README.md).

<a id="delegation-chains-dcp-09-35-unreleased"></a>

### Cadeias de delegação (DCP-09 §3.5, não publicado)

A pessoa assina um mandato raiz (`create_delegation_mandate`); o agente que o detém pode emitir um
submandato a outro agente (`create_sub_mandate`), assinado com as próprias chaves. `verify_mandate_chain` verifica
a cadeia a partir da raiz e offline: assinaturas até a pessoa, vínculos com o pai e profundidade, `sub_delegation`,
janelas de validade aninhadas, atenuação (ações, `data_classes` e `limits` só se restringem), o nível de segurança
mínimo e a revogação.

```python
# Fragment, inside an async function: registry as in V2 Bundles; orchestrator_classical, orchestrator_pq, root_mandate, nonce and the key entries come from your delegation setup; intent and policy_decision are V2 payloads.
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

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: candidato de canonicalização `dcp-jcs-v2` (opt-in, não publicado)

Não é normativo nem está ativo: `dcp-jcs-v1` continua sendo o único perfil de canonicalização, e nenhum padrão, construtor,
assinante ou verificador muda. `dcp_ai.v2` não reexporta os módulos; eles existem para quem os importar,
numa cópia do repositório (veja o status de publicação). Um bundle candidato verificado não concede confiança nem admissão.
Projeto e contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 entrada, §16 roteador, §17 verificador, §18 produtores).

| Módulo | API |
|---|---|
| `dcp_ai.v2.experimental_candidate_ingress` | `experimental_candidate_ingress(data)`: `CandidateIngressAccept(value, canonical, canonical_sha256)` ou `CandidateIngressReject(reject_class, offset)` |
| `dcp_ai.v2.experimental_candidate_router` | `create_router(transport=..., accepted_profiles=..., historical=...)`; decodificadores `JSON_LOADS_BYTES` e `JSON_LOADS_STRICT_DECODE`, nenhum padrão |
| `dcp_ai.v2.experimental_candidate_verify` | `create_verifier(...)` e depois `await verifier.verify(data, registry, policy=None, now_ms=None)`: a rota, o verificador em que se entrou e o resultado |
| `dcp_ai.v2.experimental_candidate_produce` | `sign_payload(registry, context, input, keys)` e `sign_bundle(registry, parts, signer, options)`, que verificam e copiam no momento da chamada e retornam um awaitable; `ExperimentalCandidateProduceError` para uma rejeição pelo domínio ou pela forma das entradas, lançada antes de chamar qualquer assinante |

```python
import asyncio

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, DCP_CONTEXTS
from dcp_ai.v2.experimental_candidate_ingress import experimental_candidate_ingress
from dcp_ai.v2.experimental_candidate_produce import sign_payload

# The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
print(experimental_candidate_ingress(b'{"b":1.0,"a":[]}').canonical)  # b'{"a":[],"b":1}'
refused = experimental_candidate_ingress(b'{"a":1,"a":2}')
print(refused.reject_class, refused.offset)  # DUPLICATE_KEY 7


async def main():
    registry = AlgorithmRegistry()
    keys = {}
    for name, provider in (("classical", Ed25519Provider()), ("pq", MlDsa65Provider())):
        registry.register_signer(provider)
        kp = await provider.generate_keypair()
        keys[name] = {"kid": kp["kid"], "alg": provider.alg, "secret_key_b64": kp["secret_key_b64"], "public_key_b64": kp["public_key_b64"]}
    artifact = await sign_payload(registry, DCP_CONTEXTS["Intent"], {"bytes": b'{"intent_id":"intent:1","risk":1.0}'}, keys)
    print(artifact.signed_payload["payload_hash"])  # sha256:... of {"intent_id":"intent:1","risk":1}


asyncio.run(main())
```

<a id="pydantic-models"></a>

### Modelos Pydantic

Todos os artefatos do DCP v1 estão disponíveis como modelos Pydantic v2 com validação automática:

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**Modelos V2** (`dcp_ai.v2.models`), com os campos dos esquemas V2. Os valores enumerados (estados do ciclo de vida,
modos de encerramento, status das disputas e afins) são campos `Literal` desses modelos, não classes separadas:

- Núcleo V2: `ResponsiblePrincipalRecordV2`, `BlindedResponsiblePrincipalRecordV2`, `AgentPassportV2`, `KeyEntryV2`, `IntentV2`, `PolicyDecisionV2`, `AuditEventV2`, `PQCheckpoint`, `BundleManifest`, `VerifierPolicy`, `DcpCapabilities`
- DCP-05 — Ciclo de vida: `CommissioningCertificate`, `VitalityMetrics`, `VitalityReport`, `DecommissioningRecord`
- DCP-06 — Sucessão: `DigitalTestament`, `SuccessorPreference`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `DualHashRef`
- DCP-07 — Disputas: `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`
- DCP-08 — Direitos: `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`
- DCP-09 — Delegação: `DelegationMandate`, `SubMandate`, `SubDelegationPolicy`, `AuthorityScopeEntry`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`

```python
# Example: DCP-05 commissioning, signed with a composite (Ed25519 + ML-DSA-65) signature
import asyncio

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry, CompositeKeyInfo, create_commissioning_certificate, generate_session_nonce,
    validate_state_transition,
)
from dcp_ai.v2.models import CommissioningCertificate


async def main():
    registry = AlgorithmRegistry()
    keys = []
    for provider in (Ed25519Provider(), MlDsa65Provider()):
        registry.register_signer(provider)
        kp = await provider.generate_keypair()
        keys.append(CompositeKeyInfo(kp["kid"], provider.alg, kp["secret_key_b64"], kp["public_key_b64"]))

    cert = await create_commissioning_certificate(
        registry, *keys,
        agent_id="agent:example-001", session_nonce=generate_session_nonce(), human_id="human:example-001",
        commissioning_authority="human:example-001", purpose="Customer support triage",
        initial_capabilities=["browse", "api_call"], risk_tier="low",
        principal_binding_reference="human:example-001",
    )
    CommissioningCertificate(**cert)  # validates the fields
    print(validate_state_transition("commissioned", "active"))  # True


asyncio.run(main())
```

<a id="domain-separation-v2"></a>

### Separação de domínio (V2)

**Contextos de separação de domínio da V2:** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

<a id="development"></a>

## Desenvolvimento

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

<a id="dependencies"></a>

### Dependências

- `pynacl` — Criptografia Ed25519
- `jsonschema` — Validação de JSON Schema
- `pydantic` v2 — Modelos de dados
- `typer` — Framework de CLI
- `pqcrypto` ≥ 1.0 — ML-DSA-65, SLH-DSA-192f, ML-KEM-768 (FIPS 204/205/203)
- `cryptography` — AES-256-GCM para as sessões A2A do DCP-04

<a id="license"></a>

## Licença

Apache-2.0
