# DCP-AI + CrewAI Quick Start

Add cryptographic identity, policy gating, and audit trails to your CrewAI multi-agent crews.

---

## Installation

```bash
pip install 'dcp-ai[crewai]'
```

The `[crewai]` extra installs the `crewai` runtime. The examples below use the core SDK directly; the SDK's own CrewAI helpers, `DCPCrewAgent` and `DCPCrew` in `dcp_ai.crewai`, are described in [integrations/crewai](../integrations/crewai/README.md).

### Zero-config scaffold (alternative)

```bash
npm create @dcp-ai/crewai my-app
cd my-app
python main.py
```

The scaffolder produces a starter `main.py` that walks a three-agent crew through the DCP flow (session nonce, passports, intents, policy decisions, audit entries) with placeholder keys and signatures, and a `requirements.txt` whose dependencies are commented out. It runs without CrewAI or the SDK; replace the placeholders with the SDK calls below.

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
    verify_signed_bundle,
)


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
    "contact": None,
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
    approved = policy.decision == "approve"

    # Execute only what the policy approved
    result = f"Search results for: {query}" if approved else "Blocked: this search needs human approval."

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
            policy_decision="approved" if approved else "escalated",
            outcome="search_completed" if approved else "awaiting_human_approval",
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

Each audit entry names the agent that acted. Give every crew member that uses tools its own passport and DCP-gated tools, and the bundles show which agent did what, all bound to the same human principal:

```python
# Each audit entry names the agent that acted and what came of it
for signed in bundles:
    for entry in signed["bundle"]["audit_entries"]:
        print(f"Agent: {entry['agent_id']}")
        print(f"Outcome: {entry['outcome']}")
```

---

## V2.0 Upgrade

DCP v2.0 adds post-quantum composite signatures, adaptive security tiers, and session-bound audit trails to CrewAI crews. The Python SDK ships the V2 path from version 2.9.0: hybrid keys (Ed25519 + ML-DSA-65) in `dcp_ai.providers`, and `BundleBuilderV2`, `sign_bundle_v2` and `verify_signed_bundle_v2` in `dcp_ai.v2`.

### Installation (V2)

```bash
pip install 'dcp-ai[crewai]>=2.9.0'
```

### V2 Crew Setup with Security Tiers

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

### V2 DCP-Gated Tool with Security Tiers

The tool declares an intent, asks the policy gate, runs only what it approved and writes the audit entry. The artifacts are signed when the run is sealed, below; to sign each intent before acting, call `sign` from your own event loop inside the tool.

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
        "reasons": ["low-impact action on public data" if decision == "approve" else "needs human approval"],
        "required_confirmation": None if decision == "approve" else {"type": "human_approve", "fields": ["action_type"]},
        "applied_policy_hash": f"sha256:{sha256_hex(b'crew-policy-v1')}",
        "timestamp": now(),
        "resolved_tier": tier,
    }

    # Execute only what the policy approved
    approved = decision == "approve"
    result = f"Search results for: {query}" if approved else "Blocked: this search needs human approval."

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
        "policy_decision": "approved" if approved else "escalated",
        "outcome": "search_completed" if approved else "awaiting_human_approval",
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
        bundles.append(await sign_bundle_v2(
            bundle, registry, "human", human_id, *operator_keys,
            session_expires_at=generate_session_expiry(tier=record["intent"]["security_tier"]),
        ))
    return bundles


signed_bundles = asyncio.run(seal())
```

### V2 Verification Pinned to the Operator

`verify_signed_bundle_v2` checks a bundle against the keys the bundle itself carries, so a bundle someone else signed with their own keys is also self-consistent. Whoever verifies the crew's bundles pins the signer: the operator publishes the hash of its RPR and its kids, and a bundle must carry that RPR and name those kids. Every kid must also be derived from its public key (spec/VERIFICATION.md V2-13). The verifier in this repository checks it, but the dcp-ai 2.9.0 release on PyPI does not, so the guide checks it too. A `hybrid_required` policy demands both signatures, since the default policy accepts Ed25519 alone at the routine tier, and the bundles must carry a session expiry.

`verified` covers integrity and the signer; whether the action was approved is the policy decision inside the bundle.

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

Outside Python, save a bundle as JSON and pin the operator's Ed25519 public key (`operator_keys[0].public_key_b64`) in a file. The reference CLI runs from a checkout of this repository after `npm install`; the `dcp` command that `pip install dcp-ai` installs is the Python CLI, which has no `verify-bundle`:

```bash
node bin/dcp.js verify-bundle --policy hybrid_required bundle.json operator_ed25519_pub.txt
```

The same bundles verify with the TypeScript, Go and Rust SDKs.

### V2 DCP Integration Points for CrewAI

| CrewAI Concept | DCP V1 Mapping | DCP V2 Additions |
|----------------|---------------|-----------------|
| Crew operator | RPR | RPR with `binding_keys` (Ed25519 + ML-DSA-65) |
| Agent | Agent Passport | Passport with hybrid keys |
| Tool use | Intent → Policy → Audit | + integer risk_score, security tier, session nonce |
| Task completion | Audit entries | + PQ checkpoints per tier |
| Crew run | Citizenship Bundles, one per tool call | + manifest, session_nonce, composite sig, session expiry |

See [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) for upgrading existing V1 CrewAI integrations.

---

## Next Steps

- **[Main Quick Start](./QUICKSTART.md)** — Core SDK usage
- **[LangChain Integration](./QUICKSTART_LANGCHAIN.md)** — LangChain-specific guide
- **[API Reference](./API_REFERENCE.md)** — Complete SDK documentation
