# DCP-AI + CrewAI Quick Start

Add cryptographic identity, policy gating, and audit trails to your CrewAI multi-agent crews.

---

## Installation

```bash
pip install 'dcp-ai[crewai]' crewai-tools
```

The `[crewai]` extra pulls in the `crewai` runtime and unlocks `from dcp_ai.crewai import DCPCrewAgent, DCPCrew`.

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/crewai my-app
cd my-app
pip install -r requirements.txt
python main.py
```

The scaffolder produces a runnable `main.py` + `requirements.txt` with DCP identity, a two-agent crew, and an audited tool call already wired.

---

## How DCP Integrates with CrewAI

In CrewAI, each crew member (agent) gets its own DCP identity, while all agents share a common human principal through the Responsible Principal Record. Every tool call is gated by DCP policy and produces an audit entry.

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

## Complete Working Example

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import tool
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
    verify_signed_bundle,
)
from datetime import datetime, timezone


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# 1. Initialize the shared human principal: the RPR is signed with the operator's key
operator_keys = generate_keypair()
human_id = "did:human:crew-operator-001"

rpr = {
    "dcp_version": "1.0",
    "human_id": human_id,
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": now(),
    "expires_at": None,
    "signature": "",
}
rpr["signature"] = sign_object(rpr, operator_keys["secret_key_b64"])
rpr = ResponsiblePrincipalRecord(**rpr)


# 2. Create per-agent DCP passports, each with its own key
def create_passport(agent_name: str, capabilities: list[str]) -> AgentPassport:
    agent_keys = generate_keypair()
    passport = {
        "dcp_version": "1.0",
        "agent_id": f"did:agent:crew-{agent_name}",
        "public_key": agent_keys["public_key_b64"],
        "principal_binding_reference": human_id,
        "capabilities": capabilities,
        "risk_tier": "low",
        "created_at": now(),
        "status": "active",
        "signature": "",
    }
    passport["signature"] = sign_object(passport, agent_keys["secret_key_b64"])
    return AgentPassport(**passport)


researcher_passport = create_passport("researcher", ["browse", "api_call"])
writer_passport = create_passport("writer", ["file_write"])

# 3. DCP audit state: one sealed bundle per tool call
bundles = []
intent_seq = 0


# 4. Create a DCP-gated tool
@tool("search_web")
def search_web(query: str) -> str:
    """Search the web for information."""
    global intent_seq
    intent_seq += 1

    intent = Intent(
        intent_id=f"intent-{intent_seq}",
        agent_id=researcher_passport.agent_id,
        human_id=human_id,
        timestamp=now(),
        action_type="browse",
        target={"channel": "web", "domain": query[:50]},
        data_classes=["none"],
        estimated_impact="low",
        requires_consent=False,
    )

    policy = PolicyDecision(
        intent_id=intent.intent_id,
        decision="approve",
        risk_score=0.05,
        reasons=["Low-risk web search"],
    )

    # Execute
    result = f"Search results for: {query}"

    # Log the audit entry (intent_hash and the prev_hash chain are computed for you) and seal
    bundle = (
        BundleBuilder()
        .responsible_principal_record(rpr)
        .agent_passport(researcher_passport)
        .intent(intent)
        .policy_decision(policy)
        .create_audit_entry(
            audit_id=f"audit-{intent_seq}",
            timestamp=now(),
            agent_id=researcher_passport.agent_id,
            human_id=human_id,
            intent_id=intent.intent_id,
            policy_decision="approved",
            outcome=result[:200],
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
```

---

## DCP Integration Points

| CrewAI Concept | DCP Mapping |
|----------------|-------------|
| Crew operator | Responsible Principal Record (RPR) |
| Agent | Agent Passport (unique per crew member) |
| Tool use | Intent → Policy Gate → Audit Entry |
| Task completion | Audit entries with evidence |
| Crew run | Citizenship Bundles, one per tool call, all bound to the same RPR |

---

## Multi-Agent Audit

With CrewAI's multi-agent setup, DCP tracks which agent performed which action:

```python
# Each audit entry names the agent that acted
for signed in bundles:
    for entry in signed["bundle"]["audit_entries"]:
        print(f"Agent: {entry['agent_id']}")
        print(f"Action: {entry['outcome']}")
```

This creates a complete audit trail across all crew members, bound to a single human principal.

---

## V2.0 Upgrade

DCP v2.0 adds post-quantum composite signatures, adaptive security tiers, and session-bound audit trails to CrewAI crews. The Python SDK ships the whole V2 path in `dcp_ai.v2`: hybrid keys (Ed25519 + ML-DSA-65), `BundleBuilderV2`, `sign_bundle_v2` and `verify_signed_bundle_v2`.

### Installation (V2)

```bash
pip install 'dcp-ai[crewai]' crewai-tools
```

### V2 Crew Setup with Security Tiers

```python
import asyncio
import uuid
from datetime import datetime, timezone

from crewai_tools import tool
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    DCP_CONTEXTS,
    AlgorithmRegistry,
    BundleBuilderV2,
    CompositeKeyInfo,
    canonicalize_v2,
    composite_sign,
    compute_security_tier,
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

### V2 DCP-Gated Tool with Security Tiers

The tool declares an intent, records the policy decision and writes the audit entry for every call. The artifacts are signed when the run is sealed, below.

```python
records = []  # one {"intent", "policy", "audit"} per tool call


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
        "target": {"channel": "web", "domain": query[:50]},
        "data_classes": ["none"],
        "estimated_impact": "low",
        "requires_consent": False,
    }

    # Adaptive security tier (spec §14.2): risk_score comes from the policy decision
    risk_score = 50
    tier = compute_security_tier(intent, {"risk_score": risk_score})  # "routine"
    intent["security_tier"] = tier

    policy = {
        "dcp_version": "2.0",
        "intent_id": intent["intent_id"],
        "session_nonce": session_nonce,
        "decision": "approve",
        "risk_score": risk_score,
        "reasons": ["low-impact web search"],
        "required_confirmation": None,
        "applied_policy_hash": f"sha256:{sha256_hex(b'crew-policy-v1')}",
        "timestamp": now(),
        "resolved_tier": tier,
    }

    result = f"Search results for: {query}"

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
        "policy_decision": "approved",
        "outcome": result[:200],
        "evidence": {"tool": "search_web_v2", "result_ref": None,
                     "evidence_hash": f"sha256:{sha256_hex(result.encode())}"},
        "pq_checkpoint_ref": None,
    }

    records.append({"intent": intent, "policy": policy, "audit": audit})
    return result
```

### V2 Bundle Sealing with Composite Signatures

After the crew run, each tool call becomes a citizenship bundle: its intent, policy decision and audit entry, with the RPR and the passport, bound by a manifest the operator signs with Ed25519 + ML-DSA-65.

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
        signed = await sign_bundle_v2(bundle, registry, "human", human_id, *operator_keys)
        verification = await verify_signed_bundle_v2(signed, registry)
        print(f"{record['intent']['intent_id']}: verified={verification['verified']}, "
              f"tier={record['intent']['security_tier']}")
        bundles.append(signed)
    return bundles


signed_bundles = asyncio.run(seal())
```

Each signed bundle also verifies with `dcp verify-bundle` and with the TypeScript, Go and Rust SDKs.

### V2 DCP Integration Points for CrewAI

| CrewAI Concept | DCP V1 Mapping | DCP V2 Additions |
|----------------|---------------|-----------------|
| Crew operator | RPR | RPR with `binding_keys` (Ed25519 + ML-DSA-65) |
| Agent | Agent Passport | Passport with hybrid keys |
| Tool use | Intent → Policy → Audit | + risk_score, security tier, session nonce |
| Task completion | Audit entries | + PQ checkpoints per tier |
| Crew run | Citizenship Bundle | + manifest, session_nonce, composite sig |

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading existing V1 CrewAI integrations.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — LangChain-specific guide
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
