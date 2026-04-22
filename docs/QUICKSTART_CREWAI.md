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
       └─ Citizenship Bundle (all agents)
```

---

## Complete Working Example

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import tool
from dcp_ai import (
    generate_keypair,
    sign_object,
    build_bundle,
    sign_bundle,
    verify_signed_bundle,
)
import json
from datetime import datetime, timezone

# 1. Initialize shared DCP identity
keys = generate_keypair()
human_id = "crew-operator-001"
now = datetime.now(timezone.utc).isoformat()

hbr = {
    "dcp_version": "1.0",
    "human_id": human_id,
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "public_key": keys["public_key_b64"],
    "issued_at": now,
    "expires_at": None,
    "contact": None,
}


# 2. Create per-agent DCP passports
def create_passport(agent_name: str, capabilities: list[str]):
    return {
        "dcp_version": "1.0",
        "agent_id": f"crew-{agent_name}",
        "human_id": human_id,
        "public_key": keys["public_key_b64"],
        "capabilities": capabilities,
        "risk_tier": "low",
        "created_at": now,
        "status": "active",
    }


researcher_passport = create_passport("researcher", ["browse", "api_call"])
writer_passport = create_passport("writer", ["file_write"])

# 3. DCP audit state
audit_entries = []
prev_hash = "0" * 64
intent_seq = 0


# 4. Create a DCP-gated tool
@tool("search_web")
def search_web(query: str) -> str:
    """Search the web for information."""
    global prev_hash, intent_seq
    intent_seq += 1

    intent = {
        "dcp_version": "1.0",
        "intent_id": f"intent-{intent_seq}",
        "agent_id": "crew-researcher",
        "human_id": human_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action_type": "browse",
        "target": {"channel": "web", "domain": query[:50]},
        "data_classes": ["none"],
        "estimated_impact": "low",
        "requires_consent": False,
    }

    policy = {
        "dcp_version": "1.0",
        "intent_id": intent["intent_id"],
        "decision": "approve",
        "risk_score": 5,
        "reasons": ["Low-risk web search"],
        "required_confirmation": None,
        "applied_policy_hash": "sha256:crew-policy-v1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Execute
    result = f"Search results for: {query}"

    # Log audit
    audit = {
        "dcp_version": "1.0",
        "audit_id": f"audit-{intent_seq}",
        "prev_hash": prev_hash,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent_id": "crew-researcher",
        "human_id": human_id,
        "intent_id": intent["intent_id"],
        "intent_hash": sign_object(intent, keys["secret_key_b64"]),
        "policy_decision": "approved",
        "outcome": result[:200],
        "evidence": {"tool": "search_web", "result_ref": None},
    }
    prev_hash = sign_object(audit, keys["secret_key_b64"])
    audit_entries.append({"intent": intent, "policy": policy, "audit": audit})

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

# 8. Seal the DCP bundle
if audit_entries:
    last = audit_entries[-1]
    bundle = build_bundle(hbr, researcher_passport, last["intent"], last["policy"],
                          [e["audit"] for e in audit_entries])
    signed = sign_bundle(bundle, keys["secret_key_b64"])
    verification = verify_signed_bundle(signed)
    print(f"DCP Bundle verified: {verification['verified']}")
    print(f"Audit entries: {len(audit_entries)}")
```

---

## DCP Integration Points

| CrewAI Concept | DCP Mapping |
|----------------|-------------|
| Crew operator | Responsible Principal Record (RPR) |
| Agent | Agent Passport (unique per crew member) |
| Tool use | Intent → Policy Gate → Audit Entry |
| Task completion | Audit entries with evidence |
| Crew run | Citizenship Bundle (all agent activity) |

---

## Multi-Agent Audit

With CrewAI's multi-agent setup, DCP tracks which agent performed which action:

```python
# Each audit entry contains the agent_id
for entry in audit_entries:
    print(f"Agent: {entry['audit']['agent_id']}")
    print(f"Action: {entry['audit']['outcome']}")
```

This creates a complete audit trail across all crew members, bound to a single human principal.

---

## V2.0 Upgrade

DCP v2.0 adds post-quantum composite signatures, adaptive security tiers, and enhanced audit chains to CrewAI crews.

### Installation (V2)

```bash
pip install dcp-ai>=2.0.0 crewai crewai-tools
npx @dcp-ai/cli init   # generates hybrid keypairs (Ed25519 + ML-DSA-65)
```

### V2 Crew Setup with Security Tiers

```python
from dcp_ai import (
    generate_hybrid_keypair,
    BundleBuilderV2,
    sign_bundle_v2,
    verify_signed_bundle_v2,
    compute_security_tier,
)

# V2: Hybrid keypair (Ed25519 + ML-DSA-65)
keys = generate_hybrid_keypair()
now = datetime.now(timezone.utc).isoformat()

# V2: Dual hash chain state
prev_hash = "0" * 64
prev_hash_secondary = "0" * 64
intent_seq = 0
audit_entries = []

hbr = {
    "dcp_version": "2.0",
    "human_id": "crew-operator-001",
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "keys": [
        {"kid": keys["classical_kid"], "alg": "ed25519", "public_key_b64": keys["classical_pub"]},
        {"kid": keys["pq_kid"], "alg": "ml-dsa-65", "public_key_b64": keys["pq_pub"]},
    ],
    "issued_at": now,
    "revocation_token": keys["revocation_token"],
}

# V2: Per-agent passport with security tier
def create_passport_v2(agent_name: str, capabilities: list[str]):
    return {
        "dcp_version": "2.0",
        "agent_id": f"crew-{agent_name}",
        "owner_rpr_hash": f"sha256:{keys['rpr_hash']}",
        "keys": [
            {"kid": keys["classical_kid"], "alg": "ed25519", "public_key_b64": keys["classical_pub"]},
            {"kid": keys["pq_kid"], "alg": "ml-dsa-65", "public_key_b64": keys["pq_pub"]},
        ],
        "capabilities": capabilities,
        "created_at": now,
        "status": "active",
    }
```

### V2 DCP-Gated Tool with Composite Signatures

```python
@tool("search_web_v2")
def search_web_v2(query: str) -> str:
    """Search the web with PQ-secured audit trail."""
    global prev_hash, prev_hash_secondary, intent_seq
    intent_seq += 1

    # V2: Intent with risk scoring
    intent = {
        "dcp_version": "2.0",
        "intent_id": f"intent-{intent_seq}",
        "agent_id": "crew-researcher",
        "action_type": "browse",
        "target": {"channel": "web", "domain": query[:50]},
        "data_classes": ["none"],
        "risk_score": 50,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # V2: Automatic security tier computation
    tier = compute_security_tier(intent)  # → "standard"

    policy = {
        "dcp_version": "2.0",
        "intent_id": intent["intent_id"],
        "decision": "approve",
        "risk_score": intent["risk_score"],
        "resolved_tier": tier,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    result = f"Search results for: {query}"

    # V2: Dual hash chain audit entry
    from dcp_ai import hash_object, hash_object_secondary

    audit = {
        "dcp_version": "2.0",
        "audit_id": f"audit-{intent_seq}",
        "prev_hash": prev_hash,                        # SHA-256
        "prev_hash_secondary": prev_hash_secondary,    # SHA3-256
        "agent_id": "crew-researcher",
        "intent_id": intent["intent_id"],
        "outcome": result[:200],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    prev_hash = hash_object(audit)
    prev_hash_secondary = hash_object_secondary(audit)
    audit_entries.append({"intent": intent, "policy": policy, "audit": audit})

    return result
```

### V2 Bundle Sealing with Composite Signatures

```python
# After crew execution, seal with V2 composite signature
builder = BundleBuilderV2()
builder.responsible_principal_record(hbr)
builder.agent_passport(researcher_passport)
builder.intent(last_intent)
builder.policy_decision(last_policy)
for entry in audit_entries:
    builder.add_audit_entry(entry["audit"])

bundle = builder.build()  # includes manifest with session_nonce
signed = sign_bundle_v2(bundle, keys)  # Ed25519 + ML-DSA-65 composite
verification = verify_signed_bundle_v2(signed)

print(f"DCP V2 Bundle verified: {verification['verified']}")
print(f"Security tier: {verification['resolved_tier']}")
print(f"PQ signature: {verification['checks']['pq_sig']}")
```

### V2 DCP Integration Points for CrewAI

| CrewAI Concept | DCP V1 Mapping | DCP V2 Additions |
|----------------|---------------|-----------------|
| Crew operator | RPR | RPR with `keys[]` + revocation token |
| Agent | Agent Passport | Passport with hybrid keypairs |
| Tool use | Intent → Policy → Audit | + risk_score, security tier, dual hash |
| Task completion | Audit entries | + PQ checkpoints per tier |
| Crew run | Citizenship Bundle | + manifest, session_nonce, composite sig |

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading existing V1 CrewAI integrations.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — LangChain-specific guide
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
