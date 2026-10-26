<sub>[English](QUICKSTART_CREWAI.md) · [中文](QUICKSTART_CREWAI.zh-CN.md) · [Español](QUICKSTART_CREWAI.es.md) · **日本語** · [Português](QUICKSTART_CREWAI.pt-BR.md)</sub>

<a id="dcp-ai--crewai-quick-start"></a>
<a id="dcp-ai-crewai-quick-start"></a>

# DCP-AI + CrewAI クイックスタート

> [英語版](QUICKSTART_CREWAI.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

CrewAI のマルチエージェントのクルーに、暗号学的なアイデンティティ、ポリシーによる制御、監査証跡を追加します。

---

<a id="installation"></a>

## インストール

```bash
pip install "dcp-ai[crewai]>=2.10.0,<3"
```

`[crewai]` の extra は `crewai` のランタイムをインストールします。以下の例ではコア SDK を直接使います。SDK 独自の CrewAI 用ヘルパーである `dcp_ai.crewai` の `DCPCrewAgent` と `DCPCrew` については、[integrations/crewai](../integrations/crewai/README.md) で説明しています。

<a id="zero-config-scaffold-alternative"></a>

### 設定不要の雛形（代替手段）

```bash
npm create @dcp-ai/crewai my-app
cd my-app
python main.py
```

スキャフォルダーは、3 つのエージェントからなるクルーで DCP の流れ（セッションの nonce、パスポート、意図、ポリシー判断、監査エントリ）をたどる入門用の `main.py` を、プレースホルダーの鍵と署名で生成し、依存関係がコメントアウトされた `requirements.txt` も生成します。CrewAI も SDK もなしで動きます。プレースホルダーを以下の SDK の呼び出しに置き換えてください。

---

<a id="how-dcp-integrates-with-crewai"></a>

## DCP と CrewAI の統合のしかた

CrewAI では、クルーの各メンバー（エージェント）が独自の DCP のアイデンティティを持ち、すべてのエージェントは Responsible Principal Record を通じて共通の人間のプリンシパルを共有します。すべてのツールの呼び出しは DCP のポリシーで制御され、監査エントリを生成します。

```
Crew
  ├─ Agent A (DCP Passport A)
  │    └─ Task → Tool → DCP intent/audit
  ├─ Agent B (DCP Passport B)
  │    └─ Task → Tool → DCP intent/audit
  └─ Shared RPR (human principal)
       └─ Citizenship Bundle per tool call (RPR + the acting agent's passport)
```

---

<a id="complete-working-example"></a>

## 動作する完全な例

```python
import uuid
from datetime import datetime, timezone

from crewai import Agent, Task, Crew, Process
from crewai.tools import tool
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


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# 1. Initialize the shared human principal: the RPR is signed with the operator's key,
#    over the object without its "signature" field
operator_keys = generate_keypair()
human_id = "did:human:crew-operator-001"

rpr_body = {
    "dcp_version": "1.0",
    "human_id": human_id,
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": now(),
    "expires_at": None,
    "contact": None,
}
rpr = ResponsiblePrincipalRecord(**rpr_body, signature=sign_object(rpr_body, operator_keys["secret_key_b64"]))


# 2. Create per-agent DCP passports, each with its own key
def create_passport(agent_name: str, capabilities: list[str]) -> AgentPassport:
    agent_keys = generate_keypair()
    passport_body = {
        "dcp_version": "1.0",
        "agent_id": f"did:agent:crew-{agent_name}",
        "public_key": agent_keys["public_key_b64"],
        "principal_binding_reference": human_id,
        "capabilities": capabilities,
        "risk_tier": "low",
        "created_at": now(),
        "status": "active",
    }
    # Signed over the object without its "signature" field
    return AgentPassport(**passport_body, signature=sign_object(passport_body, agent_keys["secret_key_b64"]))


researcher_passport = create_passport("researcher", ["browse", "api_call"])
writer_passport = create_passport("writer", ["file_write"])  # for the writer's own DCP-gated tools


# 3. The policy gate: your rules decide before the tool runs
def evaluate_policy(intent: Intent) -> PolicyDecision:
    """Approve low-impact actions on public data; anything else waits for a human."""
    low_risk = intent.estimated_impact == "low" and intent.data_classes == ["none"]
    return PolicyDecision(
        intent_id=intent.intent_id,
        decision="approve" if low_risk else "escalate",
        risk_score=0.05 if low_risk else 0.6,
        reasons=["low-impact action on public data" if low_risk else "needs human approval"],
        required_confirmation=None if low_risk else {"type": "human_approve", "fields": ["action_type"]},
    )


bundles = []  # one sealed bundle per tool call


# 4. Create a DCP-gated tool
@tool("search_web")
def search_web(query: str) -> str:
    """Search the web for information."""
    intent = Intent(
        intent_id=f"intent:{uuid.uuid4()}",
        agent_id=researcher_passport.agent_id,
        human_id=human_id,
        timestamp=now(),
        action_type="browse",
        target={"channel": "web"},  # the query itself stays out of the record
        data_classes=["none"],
        estimated_impact="low",
        requires_consent=False,
    )

    policy = evaluate_policy(intent)
    # Your own policy may also return "block": the audit entry records each decision as it is
    audit_decision, outcome = {
        "approve": ("approved", "search_completed"),
        "escalate": ("escalated", "awaiting_human_approval"),
        "block": ("blocked", "action_blocked"),
    }[policy.decision]

    # Execute only what the policy approved
    result = f"Search results for: {query}" if policy.decision == "approve" else f"Not run (DCP policy: {policy.decision})."

    # Log the audit entry (intent_hash and the prev_hash chain are computed for you) and seal the bundle
    bundle = (
        BundleBuilder()
        .responsible_principal_record(rpr)
        .agent_passport(researcher_passport)
        .intent(intent)
        .policy_decision(policy)
        .create_audit_entry(
            audit_id=f"audit:{uuid.uuid4()}",
            timestamp=now(),
            agent_id=researcher_passport.agent_id,
            human_id=human_id,
            intent_id=intent.intent_id,
            policy_decision=audit_decision,
            outcome=outcome,
            evidence=AuditEvidence(tool="search_web", result_ref=None),
        )
        .build()
    )
    bundles.append(sign_bundle(bundle, operator_keys["secret_key_b64"]))

    return result


# 5. Define CrewAI agents
researcher = Agent(
    role="Research Analyst",
    goal="Find accurate information on the given topic",
    backstory="You are a thorough researcher with DCP-verified identity.",
    tools=[search_web],
    verbose=True,
)

writer = Agent(
    role="Content Writer",
    goal="Write clear, concise content based on research",
    backstory="You produce DCP-audited content with full traceability.",
    verbose=True,
)

# 6. Define tasks
research_task = Task(
    description="Research the topic: {topic}",
    agent=researcher,
    expected_output="A summary of findings",
)

writing_task = Task(
    description="Write a brief article based on the research",
    agent=writer,
    expected_output="A short article",
)

# 7. Run the crew
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
    verbose=True,
)

result = crew.kickoff(inputs={"topic": "post-quantum cryptography"})

# 8. Verify the sealed DCP bundles
for signed in bundles:
    verification = verify_signed_bundle(signed, operator_keys["public_key_b64"])  # pin the operator's key
    print(f"{signed['bundle']['intent']['intent_id']}: verified={verification['verified']}")
print(f"Bundles: {len(bundles)}")

# verify_signed_bundle does not check the RPR and passport signatures: check them over the objects
# without their "signature" field, against the operator's and the agent's keys
print(verify_object(rpr.model_dump(exclude={"signature"}), rpr.signature, operator_keys["public_key_b64"]))
print(verify_object(researcher_passport.model_dump(exclude={"signature"}), researcher_passport.signature, researcher_passport.public_key))
```

---

<a id="dcp-integration-points"></a>

## DCP の統合ポイント

| CrewAI の概念 | DCP での対応 |
|----------------|-------------|
| クルーのオペレーター | Responsible Principal Record（RPR） |
| エージェント | Agent Passport（クルーのメンバーごとに固有） |
| ツールの使用 | 意図 → ポリシーによる制御 → 監査エントリ |
| タスクの完了 | 証拠を伴う監査エントリ |
| クルーの実行 | ツールの呼び出しごとに 1 つずつの Citizenship Bundle。すべて同じ RPR に結び付く |

---

<a id="multi-agent-audit"></a>

## マルチエージェントの監査

各監査エントリには、行動したエージェントの名前が記録されます。ツールを使うクルーの各メンバーに独自のパスポートと DCP で制御されたツールを与えれば、どのエージェントが何をしたかがバンドルからわかり、それらはすべて同じ人間のプリンシパルに結び付きます。

```python
# Each audit entry names the agent that acted and what came of it
for signed in bundles:
    for entry in signed["bundle"]["audit_entries"]:
        print(f"Agent: {entry['agent_id']}")
        print(f"Outcome: {entry['outcome']}")
```

---

<a id="v20-upgrade"></a>

## V2.0 へのアップグレード

DCP v2.0 は、CrewAI のクルーにポスト量子の複合署名、適応型のセキュリティティア、セッションに結び付いた監査証跡を追加します。Python SDK はバージョン 2.9.0 から V2 の経路を提供しています。`dcp_ai.providers` のハイブリッド鍵（Ed25519 + ML-DSA-65）と、`dcp_ai.v2` の `BundleBuilderV2`、`sign_bundle_v2`、`verify_signed_bundle_v2` です。

<a id="installation-v2"></a>

### インストール（V2）

```bash
pip install "dcp-ai[crewai]>=2.10.0,<3"
```

<a id="v2-crew-setup-with-security-tiers"></a>

### セキュリティティアを伴う V2 のクルーの設定

```python
import asyncio
import base64
import uuid
from datetime import datetime, timezone

from crewai import Agent, Crew, Task
from crewai.tools import tool
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    DCP_CONTEXTS,
    DEFAULT_VERIFIER_POLICY,
    AlgorithmRegistry,
    BundleBuilderV2,
    CompositeKeyInfo,
    canonicalize_v2,
    composite_sign,
    compute_security_tier,
    derive_kid,
    generate_session_expiry,
    generate_session_nonce,
    prepare_payload,
    sha256_hex,
    sign_bundle_v2,
    verify_signed_bundle_v2,
)

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def hybrid_keys() -> list[CompositeKeyInfo]:
    """[classical, pq]: an Ed25519 key and an ML-DSA-65 key."""
    keys = []
    for alg in ("ed25519", "ml-dsa-65"):
        k = await registry.get_signer(alg).generate_keypair()
        keys.append(CompositeKeyInfo(k["kid"], alg, k["secret_key_b64"], k["public_key_b64"]))
    return keys


def key_entries(keys: list[CompositeKeyInfo], at: str) -> list[dict]:
    return [
        {"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64,
         "created_at": at, "expires_at": None, "status": "active"}
        for k in keys
    ]


async def sign(payload: dict, context: str, keys: list[CompositeKeyInfo]) -> dict:
    """A SignedPayload: the payload, its hash and a composite signature under its context."""
    canonical, payload_hash = prepare_payload(payload)
    sig = await composite_sign(registry, DCP_CONTEXTS[context], canonical, *keys)
    return {"payload": payload, "payload_hash": payload_hash, "composite_sig": sig}


# Both key pairs live in one process here; in production the operator signs on its own side.
operator_keys = asyncio.run(hybrid_keys())    # the crew operator signs the RPR and the bundles
researcher_keys = asyncio.run(hybrid_keys())  # the researcher agent signs its passport, intents and decisions
session_nonce = generate_session_nonce()      # every artifact of this crew run carries it
human_id = "rpr:crew-operator-001"
agent_id = "agent:crew-researcher"
at = now()

rpr = {
    "dcp_version": "2.0",
    "human_id": human_id,
    "session_nonce": session_nonce,
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": at,
    "expires_at": None,
    "binding_keys": key_entries(operator_keys, at),
}

researcher_passport = {
    "dcp_version": "2.0",
    "agent_id": agent_id,
    "session_nonce": session_nonce,
    "keys": key_entries(researcher_keys, at),
    "principal_binding_reference": human_id,
    "capabilities": ["browse"],
    "risk_tier": "low",
    "created_at": at,
    "status": "active",
}
```

<a id="v2-dcp-gated-tool-with-security-tiers"></a>

### セキュリティティアを伴う、DCP で制御された V2 のツール

ツールは意図を宣言し、ポリシーによる制御に問い合わせ、承認されたものだけを実行し、監査エントリを書き込みます。アーティファクトは、以下で実行を封印するときに署名されます。行動の前に各意図に署名するには、ツールの中で自分のイベントループから `sign` を呼び出してください。

```python
records = []  # one {"intent", "policy", "audit"} per tool call


def evaluate_policy(intent: dict) -> tuple[str, int]:
    """Your policy engine: (decision, risk_score in 0..1000)."""
    if intent["estimated_impact"] == "low" and intent["data_classes"] == ["none"]:
        return "approve", 50
    return "escalate", 600


@tool("search_web_v2")
def search_web_v2(query: str) -> str:
    """Search the web with a DCP V2 audit trail."""
    intent = {
        "dcp_version": "2.0",
        "intent_id": f"intent:{uuid.uuid4()}",
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "human_id": human_id,
        "timestamp": now(),
        "action_type": "browse",
        "target": {"channel": "web"},  # the query itself stays out of the record
        "data_classes": ["none"],
        "estimated_impact": "low",
        "requires_consent": False,
    }

    decision, risk_score = evaluate_policy(intent)
    # Adaptive security tier (spec §14.2) from the intent and the policy's risk score
    tier = compute_security_tier(intent, {"risk_score": risk_score})  # "routine" here
    intent["security_tier"] = tier

    policy = {
        "dcp_version": "2.0",
        "intent_id": intent["intent_id"],
        "session_nonce": session_nonce,
        "decision": decision,
        "risk_score": risk_score,
        "reasons": [{"approve": "low-impact action on public data", "escalate": "needs human approval", "block": "not allowed"}[decision]],
        "required_confirmation": {"type": "human_approve", "fields": ["action_type"]} if decision == "escalate" else None,
        "applied_policy_hash": f"sha256:{sha256_hex(b'crew-policy-v1')}",
        "timestamp": now(),
        "resolved_tier": tier,
    }

    # Execute only what the policy approved; your own policy may also return "block"
    audit_decision, outcome = {
        "approve": ("approved", "search_completed"),
        "escalate": ("escalated", "awaiting_human_approval"),
        "block": ("blocked", "action_blocked"),
    }[decision]
    result = f"Search results for: {query}" if decision == "approve" else f"Not run (DCP policy: {decision})."

    audit = {
        "dcp_version": "2.0",
        "audit_id": f"audit:{uuid.uuid4()}",
        "session_nonce": session_nonce,
        "prev_hash": "GENESIS",  # first entry of this intent's trail
        "hash_alg": "sha256",
        "timestamp": now(),
        "agent_id": agent_id,
        "human_id": human_id,
        "intent_id": intent["intent_id"],
        "intent_hash": f"sha256:{sha256_hex(canonicalize_v2(intent).encode())}",
        "policy_decision": audit_decision,
        "outcome": outcome,
        # A real tool's output hash goes in evidence_hash; this toy result would reveal the query.
        "evidence": {"tool": "search_web_v2", "result_ref": None, "evidence_hash": None},
        "pq_checkpoint_ref": None,
    }

    records.append({"intent": intent, "policy": policy, "audit": audit})
    return result


researcher = Agent(
    role="Research Analyst",
    goal="Find accurate information on the given topic",
    backstory="You are a thorough researcher with a DCP V2 identity.",
    tools=[search_web_v2],
)
research_task = Task(
    description="Research the topic: {topic}",
    agent=researcher,
    expected_output="A summary of findings",
)
Crew(agents=[researcher], tasks=[research_task]).kickoff(inputs={"topic": "post-quantum cryptography"})
```

<a id="v2-bundle-sealing-with-composite-signatures"></a>

### 複合署名による V2 バンドルの封印

クルーの実行後、各ツールの呼び出しは citizenship bundle になります。その意図、ポリシー判断、監査エントリを、RPR とパスポートとともに、オペレーターが Ed25519 + ML-DSA-65 で署名するマニフェストで束ねたものです。

```python
async def seal() -> list[dict]:
    signed_rpr = await sign(rpr, "ResponsiblePrincipal", operator_keys)
    signed_passport = await sign(researcher_passport, "AgentPassport", researcher_keys)
    bundles = []
    for record in records:
        bundle = (
            BundleBuilderV2(session_nonce)
            .responsible_principal_record(signed_rpr)
            .agent_passport(signed_passport)
            .intent(await sign(record["intent"], "Intent", researcher_keys))
            .policy_decision(await sign(record["policy"], "PolicyDecision", researcher_keys))
            .add_audit_entry(record["audit"])
            .build()
        )
        bundles.append(await sign_bundle_v2(
            bundle, registry, "human", human_id, *operator_keys,
            session_expires_at=generate_session_expiry(tier=record["intent"]["security_tier"]),
        ))
    return bundles


signed_bundles = asyncio.run(seal())
```

<a id="v2-verification-pinned-to-the-operator"></a>

### オペレーターに固定した V2 の検証

`verify_signed_bundle_v2` はバンドル自身が持つ鍵でバンドルを確認するため、他人が自分の鍵で署名したバンドルも、それ自体としては一貫しています。クルーのバンドルを検証する側は署名者を固定します。オペレーターは自分の RPR のハッシュと kid を公開し、バンドルはその RPR を持ち、それらの kid を指定していなければなりません。さらに、各 kid はその公開鍵から導出されていなければなりません（spec/VERIFICATION.md V2-13）。公開済みの dcp-ai 2.10.0 はこの結び付きを検証しますが、2.9.0 は検証しませんでした。本ガイドは明示的な検査とオペレーターの固定を維持します。既定のポリシーは routine ティアで Ed25519 の署名だけでも受け入れるため、`hybrid_required` のポリシーで両方の署名を要求します。また、バンドルはセッションの有効期限を持たなければなりません。

`verified` が対象とするのは完全性と署名者です。アクションが承認されたかどうかは、バンドル内のポリシー判断が示します。

```python
# What the operator publishes to anyone who verifies the crew's bundles
TRUSTED_RPR_HASH = prepare_payload(rpr)[1]
TRUSTED_KIDS = [k.kid for k in operator_keys]

HYBRID_REQUIRED = {
    **DEFAULT_VERIFIER_POLICY,
    "default_mode": "hybrid_required",
    "risk_overrides": dict.fromkeys(("low", "medium", "high"), "hybrid_required"),
    "require_session_expiry": True,
}


def kid_matches_key(entry: dict) -> bool:
    """spec/VERIFICATION.md V2-13: a kid is derived from its algorithm and public key."""
    try:
        public_key = base64.b64decode(entry["public_key_b64"], validate=True)
        return entry["kid"] == derive_kid(entry["alg"], public_key)
    except Exception:
        return False


async def verify_crew_bundle(signed: dict) -> bool:
    """Valid, signed with both algorithms, and signed by the operator."""
    result = await verify_signed_bundle_v2(signed, registry, HYBRID_REQUIRED)
    if not result["verified"]:
        return False
    # Verified under hybrid_required, so both signatures are there: check whose they are.
    bundle = signed["bundle"]
    composite = signed["signature"]["composite_sig"]
    keys = bundle["agent_passport"]["payload"]["keys"] + bundle["responsible_principal_record"]["payload"]["binding_keys"]
    return (
        bundle["responsible_principal_record"]["payload_hash"] == TRUSTED_RPR_HASH
        and [composite["classical"]["kid"], composite["pq"]["kid"]] == TRUSTED_KIDS
        and all(kid_matches_key(k) for k in keys)
    )


for signed in signed_bundles:
    intent = signed["bundle"]["intent"]["payload"]
    decision = signed["bundle"]["policy_decision"]["payload"]["decision"]
    print(f"{intent['intent_id']}: verified={asyncio.run(verify_crew_bundle(signed))}, "
          f"decision={decision}, tier={intent['security_tier']}")
```

Python 以外では、バンドルを JSON として保存し、オペレーターの Ed25519 の公開鍵（`operator_keys[0].public_key_b64`）をファイルに固定します。リファレンス CLI は、このリポジトリのチェックアウトで `npm install` を実行した後に動きます。`pip install dcp-ai` がインストールする `dcp` コマンドは Python の CLI で、`verify-bundle` はありません。

```bash
node bin/dcp.js verify-bundle --policy hybrid_required bundle.json operator_ed25519_pub.txt
```

同じバンドルは、TypeScript、Go、Rust の SDK でも検証できます。

<a id="v2-dcp-integration-points-for-crewai"></a>

### CrewAI のための DCP V2 の統合ポイント

| CrewAI の概念 | DCP V1 での対応 | DCP V2 での追加 |
|----------------|---------------|-----------------|
| クルーのオペレーター | RPR | `binding_keys`（Ed25519 + ML-DSA-65）を持つ RPR |
| エージェント | Agent Passport | ハイブリッド鍵を持つパスポート |
| ツールの使用 | 意図 → ポリシー → 監査 | + 整数の risk_score、セキュリティティア、セッションの nonce |
| タスクの完了 | 監査エントリ | + ティアごとの PQ チェックポイント |
| クルーの実行 | ツールの呼び出しごとに 1 つずつの Citizenship Bundle | + マニフェスト、session_nonce、複合署名、セッションの有効期限 |

既存の V1 の CrewAI 統合をアップグレードするには、[MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) を参照してください。

---

<a id="next-steps"></a>

## 次のステップ

- **[メインのクイックスタート](./QUICKSTART.md)** — SDK の基本的な使い方
- **[LangChain との統合](./QUICKSTART_LANGCHAIN.md)** — LangChain 向けのガイド
- **[API リファレンス](./API_REFERENCE.md)** — SDK の完全なドキュメント
