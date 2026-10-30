<sub>[English](../../../docs/QUICKSTART_CREWAI.md) · **中文** · [Español](../../es/docs/QUICKSTART_CREWAI.md) · [日本語](../../ja/docs/QUICKSTART_CREWAI.md) · [Português](../../pt-BR/docs/QUICKSTART_CREWAI.md)</sub>

<a id="dcp-ai--crewai-quick-start"></a>
<a id="dcp-ai-crewai-quick-start"></a>

# DCP-AI + CrewAI 快速开始

> 本文是[英文版](../../../docs/QUICKSTART_CREWAI.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

为你的 CrewAI 多智能体团队加入密码学身份、策略管控和审计轨迹。

---

<a id="installation"></a>

## 安装

```bash
pip install "dcp-ai[crewai]>=2.10.1,<3"
```

`[crewai]` extra 会安装 `crewai` 运行时。下面的示例直接使用核心 SDK；SDK 自带的 CrewAI 辅助工具，即 `dcp_ai.crewai` 中的 `DCPCrewAgent` 和 `DCPCrew`，在 [integrations/crewai](../../../integrations/crewai/README.md) 中介绍。

<a id="zero-config-scaffold-alternative"></a>

### 零配置脚手架（替代方案）

```bash
npm create @dcp-ai/crewai my-app
cd my-app
python main.py
```

脚手架会生成一个入门用的 `main.py`，用占位符密钥和签名带一个三智能体团队走完 DCP 流程（会话 nonce、护照、意图、策略决定、审计条目），还会生成一个依赖项已被注释掉的 `requirements.txt`。它不需要 CrewAI 或 SDK 即可运行；请把占位符替换为下面的 SDK 调用。

---

<a id="how-dcp-integrates-with-crewai"></a>

## DCP 如何与 CrewAI 集成

在 CrewAI 中，每个团队成员（智能体）都有自己的 DCP 身份，而所有智能体通过 Responsible Principal Record 共享同一个人类委托人。每次工具调用都受 DCP 策略管控，并产生一条审计条目。

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

## 完整的可运行示例

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

## DCP 集成点

| CrewAI 概念 | DCP 对应 |
|----------------|-------------|
| 团队运营方 | Responsible Principal Record（RPR） |
| 智能体 | Agent Passport（每个团队成员唯一） |
| 工具使用 | 意图 → 策略管控 → 审计条目 |
| 任务完成 | 带证据的审计条目 |
| 团队运行 | Citizenship Bundle，每次工具调用一个，全部绑定到同一个 RPR |

---

<a id="multi-agent-audit"></a>

## 多智能体审计

每条审计条目都会写明采取行动的智能体。为每个使用工具的团队成员分配自己的护照和受 DCP 管控的工具，bundle 就能显示哪个智能体做了什么，而且它们都绑定到同一个人类委托人：

```python
# Each audit entry names the agent that acted and what came of it
for signed in bundles:
    for entry in signed["bundle"]["audit_entries"]:
        print(f"Agent: {entry['agent_id']}")
        print(f"Outcome: {entry['outcome']}")
```

---

<a id="v20-upgrade"></a>

## 升级到 V2.0

DCP v2.0 为 CrewAI 团队增加了后量子复合签名、自适应安全等级和与会话绑定的审计轨迹。Python SDK 从 2.9.0 版本起提供 V2 路径：`dcp_ai.providers` 中的混合密钥（Ed25519 + ML-DSA-65），以及 `dcp_ai.v2` 中的 `BundleBuilderV2`、`sign_bundle_v2` 和 `verify_signed_bundle_v2`。

<a id="installation-v2"></a>

### 安装（V2）

```bash
pip install "dcp-ai[crewai]>=2.10.1,<3"
```

<a id="v2-crew-setup-with-security-tiers"></a>

### 带安全等级的 V2 团队设置

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

### 带安全等级、受 DCP 管控的 V2 工具

该工具声明一个意图，询问策略管控，只运行获批的内容，并写入审计条目。构件在下面封装运行结果时签名；如果想在行动之前就签署每个意图，请在工具内部从你自己的事件循环中调用 `sign`。

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

### 使用复合签名封装 V2 bundle

团队运行结束后，每次工具调用都会变成一个 citizenship bundle：它的意图、策略决定和审计条目，连同 RPR 和护照，由运营方用 Ed25519 + ML-DSA-65 签署的清单绑定在一起。

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

### 固定到运营方的 V2 验证

`verify_signed_bundle_v2` 用 bundle 自身携带的密钥来检查 bundle，因此别人用自己的密钥签署的 bundle 本身也是自洽的。验证团队 bundle 的一方需要固定签名者：运营方公布其 RPR 的哈希和它的 kid，bundle 必须携带该 RPR 并指明这些 kid。此外，每个 kid 都必须由其公钥导出（spec/VERIFICATION.md V2-13）。已发布的 dcp-ai 2.10.0 验证此绑定；2.9.0 未执行该检查。本指南保留显式检查和运营方固定。由于默认策略允许 routine 等级仅使用 Ed25519 签名，`hybrid_required` 策略要求两种签名，并且 bundle 必须带有会话过期时间。

`verified` 涵盖的是完整性和签名者；操作是否获批，由 bundle 中的策略决定说明。

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

在 Python 之外，把 bundle 保存为 JSON，并把运营方的 Ed25519 公钥（`operator_keys[0].public_key_b64`）固定在一个文件中。参考 CLI 在本仓库的检出副本中执行 `npm install` 之后运行；`pip install dcp-ai` 安装的 `dcp` 命令是 Python CLI，它没有 `verify-bundle`：

```bash
node bin/dcp.js verify-bundle --policy hybrid_required bundle.json operator_ed25519_pub.txt
```

同样的 bundle 也能用 TypeScript、Go 和 Rust SDK 验证。

<a id="v2-dcp-integration-points-for-crewai"></a>

### 面向 CrewAI 的 DCP V2 集成点

| CrewAI 概念 | DCP V1 对应 | DCP V2 新增 |
|----------------|---------------|-----------------|
| 团队运营方 | RPR | 带 `binding_keys`（Ed25519 + ML-DSA-65）的 RPR |
| 智能体 | Agent Passport | 带混合密钥的护照 |
| 工具使用 | 意图 → 策略 → 审计 | + 整数 risk_score、安全等级、会话 nonce |
| 任务完成 | 审计条目 | + 按等级的 PQ 检查点 |
| 团队运行 | Citizenship Bundle，每次工具调用一个 | + 清单、session_nonce、复合签名、会话过期时间 |

升级现有的 V1 CrewAI 集成，参见 [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md)。

---

<a id="next-steps"></a>

## 后续步骤

- **[主快速开始](../../../docs/QUICKSTART.md)** — SDK 的基本用法
- **[LangChain 集成](../../../docs/QUICKSTART_LANGCHAIN.md)** — LangChain 专用指南
- **[API 参考](../../../docs/API_REFERENCE.md)** — 完整的 SDK 文档
