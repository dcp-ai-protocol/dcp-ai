"""
E5 gaps found in MP-03 P4: an operator configuration error is a typed error, never a result, through two public
functions whose own tests did not reach it. Mirrors sdks/typescript/src/__tests__/e5-config-errors.test.ts.

- admit_signed_bundle_v2_from_bytes: on bytes its ingress accepts, AdmissionConfigError with the code
  admit_signed_bundle_v2 gives for the same options. On bytes the ingress rejects, the ingress decides first (scanner,
  domain, parser, then admission, where the configuration is read): a result with the rejection and no admission.
- evaluate_delegation_activation_v2: the 6 config_cases of delegated_admission_vectors.json give the
  AdmissionConfigError and code admit_delegated_bundle_v2 gives (test_delegated_admission.py), before any evidence.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, SlhDsa192fProvider
from dcp_ai.v2 import (
    AdmissionConfigError,
    AlgorithmRegistry,
    admit_signed_bundle_v2,
    admit_signed_bundle_v2_from_bytes,
    evaluate_delegation_activation_v2,
)
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

ROOT = Path(__file__).resolve().parents[3]
V = json.loads((ROOT / "tests" / "interop" / "v2" / "delegated_admission_vectors.json").read_text())
NOW = rfc3339_epoch_ms(V["now"])
REGISTRY = AlgorithmRegistry()
for _p in (Ed25519Provider(), MlDsa65Provider(), SlhDsa192fProvider()):
    REGISTRY.register_signer(_p)


def bundle_bytes() -> bytes:
    return json.dumps(V["signed_bundles"]["orch"], separators=(",", ":")).encode("utf-8")


def strict() -> dict:
    return {
        "profile": copy.deepcopy(V["profiles"]["strict"]),
        "trust": copy.deepcopy(V["trust_sets"]["base"]),
        "revocation": copy.deepcopy(V["revocations"]["all_not_revoked"]),
        "now_ms": NOW,
    }


def with_policy() -> dict:
    return {**strict(), "policy": copy.deepcopy(V["policies"]["weak_classical"])}


def without_trust() -> dict:
    o = strict()
    del o["trust"]
    return o


BAD = {"a profile with a verifier policy": with_policy, "a profile without a trust set": without_trust}


@pytest.mark.asyncio
async def test_from_bytes_control_is_admitted():
    r = await admit_signed_bundle_v2_from_bytes(bundle_bytes(), REGISTRY, **strict())
    assert r["ingress"]["accepted"] is True
    assert r["admission"]["admitted"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(BAD))
async def test_from_bytes_config_error_on_accepted_bytes(name):
    with pytest.raises(AdmissionConfigError) as obj:
        await admit_signed_bundle_v2(copy.deepcopy(V["signed_bundles"]["orch"]), REGISTRY, **BAD[name]())
    assert obj.value.code == "CONFIG_PROFILE_CONTRADICTION"
    with pytest.raises(AdmissionConfigError) as raw:
        await admit_signed_bundle_v2_from_bytes(bundle_bytes(), REGISTRY, **BAD[name]())
    assert raw.value.code == obj.value.code


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(BAD))
async def test_from_bytes_ingress_rejection_comes_first(name):
    r = await admit_signed_bundle_v2_from_bytes(b"{", REGISTRY, **BAD[name]())
    assert r["ingress"]["accepted"] is False
    assert r["ingress"]["layer"] == "scanner"
    assert r["admission"] is None


def test_six_config_cases():
    assert len(V["config_cases"]) == 6


@pytest.mark.asyncio
@pytest.mark.parametrize("case", V["config_cases"], ids=[c["name"] for c in V["config_cases"]])
async def test_activation_config_error(case):
    o = case["operator"]
    operator = {
        "revocation": copy.deepcopy(V["revocations"]["all_not_revoked"]),
        "mandate_revocation": copy.deepcopy(V["mandate_revocations"]["all_not_revoked"]),
        "now_ms": NOW,
    }
    for key, table in (("trust", "trust_sets"), ("profile", "profiles"), ("policy", "policies")):
        if key in o:
            operator[key] = copy.deepcopy(V[table][o[key]])
    if "max_revocation_age_seconds" in o:
        operator["max_revocation_age_seconds"] = o["max_revocation_age_seconds"]
    evidence = {
        "signed_bundle": copy.deepcopy(V["signed_bundles"]["orch"]),
        "mandate_chain": [copy.deepcopy(V["mandates"]["root"])],
        "delegator_bundles": [],
        "acknowledgments": [],
        "awareness_thresholds": [],
    }
    with pytest.raises(AdmissionConfigError) as info:
        await evaluate_delegation_activation_v2(evidence, REGISTRY, operator)
    assert info.value.code == case["expected_code"]
