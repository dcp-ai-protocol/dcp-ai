<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# dcp-ai — Python SDK

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Digital Citizenship Protocol（DCP v2.0）の公式 Python SDK です。Pydantic v2 のモデル、ポスト量子のハイブリッド署名（Ed25519 + ML-DSA-65、および SLH-DSA-192f）、ML-KEM-768 の KEM プリミティブ、`pq_over_classical` バインディングを持つ複合署名、V1 と V2 のバンドルの署名と検証、OpenTelemetry によるオブザーバビリティ、DCP-04 から DCP-09 までの動作、そして充実した CLI を備えています。

<a id="installation"></a>

## インストール

**リリース状況。** この README は `main` のソースを説明しています。最新のタグ付きリリース `v2.10.0` には
Python 向けの `dcp-ai` 2.9.0 が含まれます。変更履歴の [`[Unreleased]`](../../CHANGELOG.md#unreleased) に挙げられている内容は、
どのタグ付きリリースにも含まれていません：アドミッション、委任チェーン、A2A の受信ウィンドウ、上限付きの拒否リストのワーカー、
実験的な `dcp-jcs-v2` API。以下の例を実行するには、チェックアウトからインストールします。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "dcp-ai/sdks/python"
```

レジストリからインストールすると、未リリースの機能を含まない公開済みのバージョンになります。

```bash
pip install dcp-ai
```

<a id="optional-extras"></a>

### オプションの extras

レジストリから（公開済みのバージョン）。チェックアウトからでも同じ extras が使えます：`pip install -e "dcp-ai/sdks/python[fastapi]"`。

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
pip install "dcp-ai[otlp]"       # OpenTelemetry OTLP exporter
```

<a id="features"></a>

## 機能

| 分野 | 状況 |
|---|---|
| Ed25519 / ML-DSA-65（FIPS 204）のプロバイダー | あり |
| SLH-DSA-192f のプロバイダー | あり。FIPS 205（pure、空のコンテキスト）で、ほかの SDK と相互運用可能 |
| ML-KEM-768 | KEM プリミティブ：あり（`MlKem768Provider`、FIPS 203）。DCP-04 の X25519 + ML-KEM-768 ハイブリッド鍵交換：未対応 |
| 複合署名（`pq_over_classical`）+ 検証 | あり |
| 正規 JSON v2 + ドメイン分離 | あり |
| 二重ハッシュ（SHA-256 + SHA3-256）+ マークルルート | あり |
| バンドルの署名 + 検証 | V1：あり。V2（`SignedBundleV2`）：あり、`BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| DCP-04 の A2A ディスカバリー + ハンドシェイク + AES-256-GCM セッション（`cryptography` 経由）。各メッセージはウィンドウ内で一度だけ受け付けられる（§8.4） | あり |
| DCP-05 のエージェントのライフサイクル（稼働開始 / 稼働状況 / 稼働終了） | あり |
| DCP-06 のデジタル継承（遺言、メモリーの移転、セレモニー） | あり |
| DCP-07 の紛争解決 + 仲裁 + 判例 | あり |
| DCP-08 の権利 + 義務 + 遵守 | あり |
| DCP-09 の委任 + 検証可能な委任チェーン（`create_sub_mandate`、`verify_mandate_chain`、§3.5）+ 注意の閾値 + プリンシパルのミラー | あり |
| セッション nonce のユーティリティ、セキュリティティアのエンジン（`compute_security_tier(intent, policy_decision, mandate_chain_tier)`、仕様 §14.2）、緊急失効 | あり |
| 遅延 PQ チェックポイント + `PQCheckpointManager` | あり |
| ブラインド化された RPR、複数当事者による承認、アルゴリズムに関する勧告のユーティリティ | あり |
| 正規のエラーコード（全 SDK で共通の 38 個）+ `detect_wire_format` | あり |
| OpenTelemetry / OTLP エクスポーター（オプションの `[otlp]` extra） | あり |
| アドミッション：信頼済みのプリンシパルと `strict-v1` プロファイル | あり、未リリース（リリース状況を参照） |
| 正規化の候補 `dcp-jcs-v2`（入口、ルーター、バイト列の検証器、生成器） | 実験的でオプトイン、未リリース。規範ではない |

<a id="quickstart"></a>

## クイックスタート

Ed25519 で署名した V1 バンドルです。RPR はプリンシパルの鍵で、パスポートはエージェントの鍵で署名され、
いずれも `signature` フィールドを除いたオブジェクトの正規 JSON が対象です。`create_audit_entry` は
`intent_hash` と `prev_hash` のチェーンを計算します。`verify_signed_bundle` が確認するのはバンドルの署名、ハッシュ、
チェーンであり、これらの内部の署名ではありません。内部の署名は以下のように自分で確認してください。V2 バンドルについては [V2 バンドル](#v2-bundles)を参照してください。

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

SDK には Typer で構築された CLI が含まれています。インストール後は `dcp` として使えます。

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

## API リファレンス

<a id="crypto"></a>

### 暗号

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | `{"public_key_b64": ..., "secret_key_b64": ...}` を返す |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | 署名し、base64 を返す |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | 署名を検証する |
| `canonicalize(obj)` | `(Any) -> str` | 決定的な JSON |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | 公開鍵を導出する |

<a id="merkle--hashing"></a>
<a id="merkle-hashing"></a>

### マークルとハッシュ

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | 正規化した JSON の SHA-256 |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | マークルルート |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | 監査エントリのマークルルート |
| `intent_hash(intent)` | `(Any) -> str` | 意図のハッシュ |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | 直前のエントリのハッシュ |

<a id="schema-validation"></a>

### スキーマの検証

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | `{"valid": bool, "errors": [...]}` を返す |
| `validate_bundle(bundle)` | `(dict) -> dict` | バンドル全体を検証する |

<a id="bundle-builder"></a>

### バンドルビルダー

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

### バンドルの署名

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

### バンドルの検証

```python
# Signature (not runnable)
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

検証内容：スキーマ、Ed25519 署名、`bundle_hash`、`merkle_root`、`intent_hash` のチェーン、`prev_hash` のチェーン。

<a id="v2-bundles"></a>

### V2 バンドル

`BundleBuilderV2`、`sign_bundle_v2`、`verify_signed_bundle_v2`（`dcp_ai.v2` 内）は、TypeScript SDK の `builder-v2.ts`、`signer-v2.ts`、`verify-v2.ts` を移植したものです。アーティファクトは `SignedPayload` の dict（`{"payload", "payload_hash", "composite_sig"}`）で、バンドルの署名はマニフェストに対する複合署名です。

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

検証器は各アーティファクト自身の複合署名も確認します（RPR はプリンシパルの `binding_keys` で、それ以外はパスポートの鍵で）。また、どのポリシーモードでも、存在するが無効な PQ 署名は拒否します。モードはポリシーのモードとセキュリティティアのモードのうち厳しいほうで（仕様 §14.3）、`details["resolved_tier"]` がティアを報告します。

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### アドミッション：Trusted Principals と strict-v1（未リリース）

検証済みのバンドルは、そこに列挙された鍵で署名されています。それはプリンシパルが誰であるかを証明しません。アドミッションは、プリンシパルの署名が信頼セットに載っているプリンシパルの鍵で行われている場合にのみバンドルを受け入れます。オプションで、オペレーターが固定する `strict-v1` プロファイル（ハイブリッド署名、署名されたオーディエンス、最長 300 秒のセッション、新しい失効スナップショット）も適用できます。

```python
# Fragment, inside an async function: trust_set comes from operator configuration, signed_bundle from the request, snapshot from your revocation source, registry as in V2 Bundles.
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` はオプションのクロックを受け取り、`details["signer_keys"]` を報告します。それらがなければ従来どおりに動作します。
- `evaluate_admission_v2` は、手元にある検証結果を評価し（暗号処理も I/O も行いません）、それを信頼します。`revocation_subjects` は、失効情報の提供元が答えるべき対象を列挙します。`deny_list_revocation_source(url)` はリファレンスの失効サービスの拒否リストを読み込みます。`workers=DenyListWorkers(max_workers=...)` を指定すると、そのダウンロードスレッドは実際に終了するまで数えられ、上限が設けられます（オプトイン。FastAPI の README を参照）。
- FastAPI：`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`。[`integrations/fastapi/README.md`](../../integrations/fastapi/README.md) を参照してください。ガイド：[`docs/ADMISSION.md`](../../docs/ADMISSION.md)。仕様とコード：[`spec/profiles/admission`](../../spec/profiles/admission/README.md)。

<a id="delegation-chains-dcp-09-35-unreleased"></a>

### 委任チェーン（DCP-09 §3.5、未リリース）

ルートの委任状には人間が署名します（`create_delegation_mandate`）。それを持つエージェントは、自身の鍵で署名した
サブ委任状を別のエージェントに発行できます（`create_sub_mandate`）。`verify_mandate_chain` は
ルートから順に、オフラインでチェーンを確認します：人間までの署名、親とのリンクと深さ、`sub_delegation`、
入れ子になった有効期間、権限の縮小（アクション、`data_classes`、`limits` は狭まるのみ）、セキュリティティアの
下限、失効。

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

### 実験的：正規化の候補 `dcp-jcs-v2`（オプトイン、未リリース）

規範ではなく、有効でもありません。`dcp-jcs-v1` が唯一の正規化プロファイルであり続け、既定値、ビルダー、
署名器、検証器はいずれも変わりません。これらのモジュールは `dcp_ai.v2` から再エクスポートされず、ソースのチェックアウトで
自らインポートする呼び出し側のためだけに存在します（リリース状況を参照）。検証済みの候補バンドルは、信頼もアドミッションも与えません。
設計と契約：[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
（§15 入口、§16 ルーター、§17 検証器、§18 生成器）。

| モジュール | API |
|---|---|
| `dcp_ai.v2.experimental_candidate_ingress` | `experimental_candidate_ingress(data)`：`CandidateIngressAccept(value, canonical, canonical_sha256)` または `CandidateIngressReject(reject_class, offset)` |
| `dcp_ai.v2.experimental_candidate_router` | `create_router(transport=..., accepted_profiles=..., historical=...)`。デコーダーは `JSON_LOADS_BYTES` と `JSON_LOADS_STRICT_DECODE` で、いずれも既定ではない |
| `dcp_ai.v2.experimental_candidate_verify` | `create_verifier(...)` の後に `await verifier.verify(data, registry, policy=None, now_ms=None)`：ルート、入った検証器、その結果 |
| `dcp_ai.v2.experimental_candidate_produce` | `sign_payload(registry, context, input, keys)` と `sign_bundle(registry, parts, signer, options)`。呼び出し時点で確認とコピーを行い、awaitable を返す。`ExperimentalCandidateProduceError` は入力の値域や形式による拒否で、署名器が呼ばれる前に送出される |

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

### Pydantic のモデル

DCP v1 のすべてのアーティファクトは、自動検証付きの Pydantic v2 モデルとして利用できます。

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**V2 のモデル**（`dcp_ai.v2.models`）は、V2 スキーマのフィールドを持ちます。列挙値（ライフサイクルの状態、
終了モード、紛争の状態など）は、別のクラスではなく、これらのモデルの `Literal` フィールドです。

- コア V2：`ResponsiblePrincipalRecordV2`, `BlindedResponsiblePrincipalRecordV2`, `AgentPassportV2`, `KeyEntryV2`, `IntentV2`, `PolicyDecisionV2`, `AuditEventV2`, `PQCheckpoint`, `BundleManifest`, `VerifierPolicy`, `DcpCapabilities`
- DCP-05 — ライフサイクル：`CommissioningCertificate`, `VitalityMetrics`, `VitalityReport`, `DecommissioningRecord`
- DCP-06 — 継承：`DigitalTestament`, `SuccessorPreference`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `DualHashRef`
- DCP-07 — 紛争：`DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`
- DCP-08 — 権利：`RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`
- DCP-09 — 委任：`DelegationMandate`, `SubMandate`, `SubDelegationPolicy`, `AuthorityScopeEntry`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`

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

### ドメイン分離（V2）

**V2 のドメイン分離コンテキスト：** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

<a id="development"></a>

## 開発

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

<a id="dependencies"></a>

### 依存関係

- `pynacl` — Ed25519 暗号
- `jsonschema` — JSON Schema の検証
- `pydantic` v2 — データモデル
- `typer` — CLI フレームワーク
- `pqcrypto` ≥ 1.0 — ML-DSA-65、SLH-DSA-192f、ML-KEM-768（FIPS 204/205/203）
- `cryptography` — DCP-04 の A2A セッション用の AES-256-GCM

<a id="license"></a>

## ライセンス

Apache-2.0
