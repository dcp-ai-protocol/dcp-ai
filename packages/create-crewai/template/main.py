"""
DCP-AI + CrewAI Template

Demonstrates how a CrewAI multi-agent crew obtains digital citizenship
under the DCP v2.0 protocol. Each crew member gets its own AgentPassport,
and every action flows through Intent → PolicyDecision → AuditEntry.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field

# ─── DCP v2.0 Helpers ────────────────────────────────────────────────────────
#
# In production, use the `dcp_ai` Python SDK. These helpers illustrate
# the protocol's data structures so you can understand the flow.


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4()}"


def sha256_hash(obj: dict | str) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":")) if isinstance(obj, dict) else obj
    return f"sha256:{hashlib.sha256(raw.encode()).hexdigest()}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Step 1: Bootstrap DCP session ───────────────────────────────────────────
#
# A session nonce ties every artifact together and prevents replay / splicing.

session_nonce = uuid.uuid4().hex + uuid.uuid4().hex  # 256-bit hex
human_id = new_id("rpr:")
timestamp = now_iso()

# Simulated dual keys (Ed25519 + ML-DSA-65)
classical_kid = uuid.uuid4().hex[:32]
pq_kid = uuid.uuid4().hex[:32]

key_entries = [
    {"kid": classical_kid, "alg": "ed25519", "public_key_b64": "«generated»", "created_at": timestamp, "expires_at": None, "status": "active"},
    {"kid": pq_kid, "alg": "ml-dsa-65", "public_key_b64": "«generated»", "created_at": timestamp, "expires_at": None, "status": "active"},
]


# ─── Step 2: Create ResponsiblePrincipalRecord ───────────────────────────────────────
#
# One RPR covers the entire crew — the human owner is legally responsible
# for all agents in the crew.

responsible_principal_record: dict = {
    "dcp_version": "2.0",
    "human_id": human_id,
    "session_nonce": session_nonce,
    "legal_name": "Ada Lovelace",
    "entity_type": "natural_person",
    "jurisdiction": "US",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": timestamp,
    "expires_at": None,
    "contact": "ada@example.com",
    "binding_keys": key_entries,
}

print("🔑 DCP session initialized")
print(f"   Human:   {human_id}")
print(f"   Session: {session_nonce[:16]}…\n")


# ─── Step 3: Create AgentPassports for each crew member ──────────────────────
#
# Each CrewAI agent gets its own passport with specific capabilities.

@dataclass
class DCPCrewMember:
    """Wraps a CrewAI agent with DCP digital citizenship."""

    name: str
    role: str
    agent_id: str = field(default_factory=lambda: new_id("agent:"))
    capabilities: list[str] = field(default_factory=lambda: ["browse", "api_call"])
    risk_tier: str = "medium"
    audit_trail: list[dict] = field(default_factory=list)
    intents: list[dict] = field(default_factory=list)

    @property
    def passport(self) -> dict:
        return {
            "dcp_version": "2.0",
            "agent_id": self.agent_id,
            "session_nonce": session_nonce,
            "keys": key_entries,
            "principal_binding_reference": human_id,
            "capabilities": self.capabilities,
            "risk_tier": self.risk_tier,
            "created_at": timestamp,
            "status": "active",
        }

    def declare_intent(self, action_type: str, target_channel: str, target_domain: str) -> dict:
        """DCP-02: Declare an intent before performing an action."""
        intent = {
            "dcp_version": "2.0",
            "intent_id": new_id("intent:"),
            "session_nonce": session_nonce,
            "agent_id": self.agent_id,
            "human_id": human_id,
            "timestamp": now_iso(),
            "action_type": action_type,
            "target": {"channel": target_channel, "domain": target_domain},
            "data_classes": ["none"],
            "estimated_impact": "low",
            "requires_consent": False,
        }
        self.intents.append(intent)
        return intent

    def evaluate_policy(self, intent: dict) -> dict:
        """DCP-02: Evaluate the intent against the policy engine."""
        return {
            "dcp_version": "2.0",
            "intent_id": intent["intent_id"],
            "session_nonce": session_nonce,
            "decision": "approve",
            "risk_score": 75,
            "reasons": [f"Action '{intent['action_type']}' within capabilities for {self.role}"],
            "required_confirmation": None,
            "applied_policy_hash": sha256_hash("default-crew-policy-v2"),
            "timestamp": now_iso(),
        }

    def log_action(self, intent: dict, policy: dict, outcome: str, tool: str) -> dict:
        """DCP-03: Record an auditable action."""
        prev_hash = (
            sha256_hash(self.audit_trail[-1])
            if self.audit_trail
            else "sha256:" + "0" * 64
        )
        entry = {
            "dcp_version": "2.0",
            "audit_id": new_id("audit:"),
            "session_nonce": session_nonce,
            "prev_hash": prev_hash,
            "hash_alg": "sha256",
            "timestamp": now_iso(),
            "agent_id": self.agent_id,
            "human_id": human_id,
            "intent_id": intent["intent_id"],
            "intent_hash": sha256_hash(intent),
            "policy_decision": "approved",
            "outcome": outcome,
            "evidence": {
                "tool": tool,
                "result_ref": f"{self.name}-output",
                "evidence_hash": sha256_hash(outcome),
            },
            "pq_checkpoint_ref": None,
        }
        self.audit_trail.append(entry)
        return entry


# ─── Step 4: Define the crew ─────────────────────────────────────────────────

researcher = DCPCrewMember(
    name="Researcher",
    role="Senior Research Analyst",
    capabilities=["browse", "api_call"],
    risk_tier="low",
)

writer = DCPCrewMember(
    name="Writer",
    role="Technical Writer",
    capabilities=["api_call", "file_write"],
    risk_tier="medium",
)

reviewer = DCPCrewMember(
    name="Reviewer",
    role="Quality Reviewer",
    capabilities=["api_call"],
    risk_tier="low",
)

crew = [researcher, writer, reviewer]

for member in crew:
    print(f"🛂 Passport issued: {member.name} ({member.role})")
    print(f"   Agent ID:     {member.agent_id}")
    print(f"   Capabilities: {', '.join(member.capabilities)}")
    print(f"   Risk tier:    {member.risk_tier}")
print()


# ─── Step 5: Execute crew tasks with DCP lifecycle ───────────────────────────
#
# Each agent: declare intent → get policy decision → act → audit

def execute_agent_task(member: DCPCrewMember, task_description: str, tool: str) -> None:
    """Run a single agent task through the full DCP lifecycle."""
    print(f"── {member.name}: {task_description} ──")

    # Declare intent
    intent = member.declare_intent("api_call", "api", "api.openai.com")
    print(f"   📝 Intent:  {intent['intent_id'][:30]}…")

    # Get policy decision
    policy = member.evaluate_policy(intent)
    print(f"   ✅ Policy:  {policy['decision']} (risk: {policy['risk_score']}/1000)")

    if policy["decision"] != "approve":
        print(f"   ⛔ Blocked: {policy['reasons']}")
        return

    # Simulate task execution
    outcome = f"{member.name} completed: {task_description}"
    print(f"   🤖 Result:  {outcome}")

    # Log to audit trail
    audit = member.log_action(intent, policy, outcome, tool)
    print(f"   📒 Audit:   {audit['audit_id'][:30]}…\n")


execute_agent_task(researcher, "Research DCP protocol specifications", "crewai.WebSearch")
execute_agent_task(writer, "Draft a summary of DCP v2.0 features", "crewai.TextGeneration")
execute_agent_task(reviewer, "Review and approve the draft", "crewai.QualityCheck")


# ─── Step 6: Build and sign the CitizenshipBundle ────────────────────────────
#
# After the crew finishes, all artifacts are bundled together.
# The manifest binds RPR + passports + intents + audit Merkle root.

all_audit_entries = []
for member in crew:
    all_audit_entries.extend(member.audit_trail)

all_intents = []
for member in crew:
    all_intents.extend(member.intents)

# Use the most recent intent for the bundle (in production, one bundle per intent or session)
primary_intent = all_intents[-1] if all_intents else {}
primary_policy = crew[-1].evaluate_policy(primary_intent) if all_intents else {}

manifest = {
    "session_nonce": session_nonce,
    "rpr_hash": sha256_hash(responsible_principal_record),
    "passport_hash": sha256_hash(crew[0].passport),
    "intent_hash": sha256_hash(primary_intent),
    "policy_hash": sha256_hash(primary_policy),
    "audit_merkle_root": sha256_hash(json.dumps([sha256_hash(e) for e in all_audit_entries])),
    "audit_count": len(all_audit_entries),
}

composite_sig = {
    "classical": {"alg": "ed25519", "kid": classical_kid, "sig_b64": "«sig»"},
    "pq": {"alg": "ml-dsa-65", "kid": pq_kid, "sig_b64": "«sig»"},
    "binding": "pq_over_classical",
}

signed_bundle = {
    "bundle": {
        "dcp_bundle_version": "2.0",
        "manifest": manifest,
        "responsible_principal_record": {"payload": responsible_principal_record, "payload_hash": manifest["rpr_hash"], "composite_sig": composite_sig},
        "agent_passport": {"payload": crew[0].passport, "payload_hash": manifest["passport_hash"], "composite_sig": composite_sig},
        "intent": {"payload": primary_intent, "payload_hash": manifest["intent_hash"], "composite_sig": composite_sig},
        "policy_decision": {"payload": primary_policy, "payload_hash": manifest["policy_hash"], "composite_sig": composite_sig},
        "audit_entries": all_audit_entries,
    },
    "signature": {
        "hash_alg": "sha256",
        "created_at": now_iso(),
        "signer": {"type": "human", "id": human_id, "kids": [classical_kid, pq_kid]},
        "manifest_hash": sha256_hash(manifest),
        "composite_sig": composite_sig,
    },
}

print("🏛️  Citizenship Bundle signed")
print(f"   Bundle version:  {signed_bundle['bundle']['dcp_bundle_version']}")
print(f"   Crew members:    {len(crew)}")
print(f"   Total intents:   {len(all_intents)}")
print(f"   Audit entries:   {len(all_audit_entries)}")
print(f"   Binding:         {composite_sig['binding']}")
print("\n✅ CrewAI crew completed with full DCP digital citizenship.\n")
