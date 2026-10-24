"""strict-v1 admission with dcp_ai.fastapi (docs/ADMISSION.md).

Runs offline on the shared admission vectors: their trust set, profile and bundles,
with the clock fixed at the vectors' time and a revocation source that answers
"not revoked". In a real deployment, drop `clock`, load the trust set from your own
configuration, take the tenant from your own authentication, and use
deny_list_revocation_source(url) or your own source.

    pip install "dcp-ai[fastapi]" httpx
    python integrations/fastapi/examples/strict_v1.py
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from dcp_ai.fastapi import DCPAgentContext, DCPVerifyMiddleware, require_dcp
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "admission_vectors.json").read_text()
)
CASE = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE["now"])


def revocation_source(subjects: dict, tenant: str) -> dict:
    """Every subject not revoked, as of 30 s before the vectors' time."""
    return {
        "checked_at": CASE["revocation"]["checked_at"],
        "agents": {agent_id: "not_revoked" for agent_id in subjects["agent_ids"]},
        "keys": {kid: "not_revoked" for kid in subjects["kids"]},
    }


app = FastAPI()
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=VECTORS["trust_sets"]["principal"],
    profile=VECTORS["profiles"]["strict"],
    revocation_source=revocation_source,
    clock=lambda: NOW,
)


@app.post("/agent/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)) -> dict:
    return {
        "reached": True,
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "principal_trust": agent.principal_trust,
        "profile_compliance": agent.profile_compliance,
        "recorded_decision": agent.recorded_decision,
        "action_authorized": agent.action_authorized,
    }


if __name__ == "__main__":
    client = TestClient(app)
    for name in ("base", "unknown_principal", "other_intended_verifier"):
        response = client.post("/agent/action", json={"signed_bundle": VECTORS["signed_bundles"][name]})
        body = response.json()
        shown = body if body.get("reached") else {"admitted": body["admitted"], "codes": body["codes"]}
        print(f"{name}: {response.status_code} {json.dumps(shown)}")
