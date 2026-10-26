# DCP-AI v2.0 wire compatibility: errata for DCP-05, DCP-08 and DCP-09

## Status

Published 25/10/2026. **Normative only for the errata E1 to E8 below and for the layer definitions of Section 2.**
Every other requirement of DCP-AI v2.0, DCP-05, DCP-08 and DCP-09 keeps its normative force unchanged. The
requirements of the canonicalization profile, the signature rules, the schemas and the prose of each specification
apply jointly: none of them overrides another, and none of them is relaxed here.

These errata correct how the specifications **name and show** V2.0 wire data (field names, signature contexts and
the format of their examples) so that they match the format that `schemas/v2/`, the four signing SDKs and the shared
vectors already use. They change no schema, no context, no canonicalization profile, no SDK behaviour and no
acceptance decision. They add no alias: a label or field name corrected here is not accepted in place of the wire
name, and records produced before these errata are neither renamed nor converted.

Compatibility here covers the current schema/SDK wire format and acceptance behaviour, not unverified behaviour of
third-party implementations. An implementation that used the superseded example labels needs an explicit migration
decision. Existing signed evidence must not be relabelled or rewritten, and these errata authorize no automatic
fallback between signature contexts.

## 1. Scope

| Erratum | Specification and sections | Subject |
|---------|---------------------------|---------|
| E1 | DCP-AI v2.0 §4.1 | Context registry rows already in use |
| E2 | DCP-05 §2, §4.4 (last sentence), §10.5, §11 item 7 | Signature context of lifecycle records |
| E3 | DCP-05 §5.1 and §6.2 | Name of the vitality field in the vitality report |
| E4 | DCP-08 §2, §9.5, §10 item 8 | Signature context of rights records |
| E5 | DCP-09 §2, §10.6, §11 item 9 | Signature contexts of delegation and awareness records |
| E6 | DCP-09 §3.6 | Field that carries a mandate's expiry |
| E7 | DCP-05 §3.3, §4.2, §6.2, §8.2, §9.2; DCP-08 §4.2, §5.2, §6.2, §8.2; DCP-09 §3.2, §4.2, §5.2, §6.2, §7.2, §9.2 | Status of the JSON examples |
| E8 | DCP-05, DCP-08, DCP-09 "Implementation notes (informative)" | Precedence sentence of the notes |

## 2. Layers

A V2.0 record is checked at four layers. The checks are not interchangeable; success at one check alone is not
proof of full conformance. Verification (layer 3) canonicalizes the record and so requires layer 1, and layer 4
requires layers 1 to 3 for the records involved.

1. **Representable**: the record is accepted by the canonicalization profile `dcp-jcs-v1`
   ([CANONICALIZATION_PROFILE.md](CANONICALIZATION_PROFILE.md)). A non-integer number is not representable.
2. **Schema-valid**: the record validates against its schema in `schemas/v2/`. A schema-valid record can still be
   unrepresentable (for example a vitality metric of `0.5`), and a schema checks shapes and ranges, not meaning.
3. **Cryptographically verified**: the composite signature verifies as DCP-AI v2.0 §5 defines, under the context the
   registry assigns: the classical signature over the domain-separated message
   `UTF8(context) || 0x00 || canonical bytes` (§4), and, with the `pq_over_classical` binding, the post-quantum
   signature over that message followed by the classical signature. It authenticates a declaration by whoever holds the keys; it does not show that what the
   record states is true or was computed as required.
4. **Functionally conformant**: the implementation meets the requirements of the specification itself (the
   calculations, signers, ceremonies, intervals and enforcement of each "Conformance" section). Layers 1 to 3 are
   necessary for the records involved and are not sufficient for this layer.

## 3. Errata

### E1. Context registry (DCP-AI v2.0 §4.1)

The table of §4.1 gains the rows `DCP-AI.v2.MultiPartyAuth`, `DCP-AI.v2.Lifecycle`, `DCP-AI.v2.Succession`,
`DCP-AI.v2.Dispute`, `DCP-AI.v2.Rights` and `DCP-AI.v2.Awareness`, and the `DCP-AI.v2.Delegation` row also names
principal mirrors. These contexts are already defined by the four signing SDKs and covered byte for byte by
`tests/interop/v2/interop_vectors.json#domain_separation_all_contexts`; the rows document them and add no tag. The
other rows are unchanged.

### E2. Lifecycle signatures (DCP-05)

Where DCP-05 names the domain separation tag `DCP-LIFECYCLE-SIG-v2`, the V2.0 wire context is
`DCP-AI.v2.Lifecycle`, applied as DCP-AI v2.0 §4 and §5 define, to the `composite_sig` of each lifecycle record
(`commissioning_certificate`, `vitality_report`, `decommissioning_record` in `schemas/v2/`). The label
`DCP-LIFECYCLE-SIG-v2` is not a V2.0 context. The requirement of §4.4 that a commissioning certificate carry an
authority signature and a principal countersignature is unchanged (see Section 4).

### E3. Vitality field (DCP-05)

The V2.0 vitality report carries the composite vitality of §5.1 in the field `vitality_score` (integer 0–1000,
`schemas/v2/vitality_report.schema.json`); the field named `vitality` in the §6.2 example is that value. The
definition, components, weights and `floor` of §5.1 and the thresholds of §5.2 are unchanged. The schema checks the
range and the signature authenticates the declared value; neither shows that the value was computed as §5.1
requires. The `metrics` object of the V2.0 schema holds other quantities than the four component scores of §5.1, and
the SDK helpers that compute a score from those metrics use other inputs and round instead of flooring: they do not
show conformance to §5.1.

### E4. Rights signatures (DCP-08)

Where DCP-08 names the tag `DCP-RIGHTS-SIG-v2`, the V2.0 wire context is `DCP-AI.v2.Rights`, applied to the
`composite_sig` of `rights_declaration`, `obligation_record` and `rights_violation_report`. The requirement of §9.1
that a rights declaration be verified against the commissioning authority's key is unchanged.

### E5. Delegation and awareness signatures (DCP-09)

Where DCP-09 names the tags `DCP-DELEGATION-SIG-v2` and `DCP-AWARENESS-SIG-v2`, the V2.0 wire contexts are:

| Record | Signature field | Context |
|--------|----------------|---------|
| Root delegation mandate | `human_composite_sig` | `DCP-AI.v2.Delegation` (as §3.5.1 already states) |
| Sub-mandate | `delegator_composite_sig` | `DCP-AI.v2.SubMandate` (as §3.5.1 already states) |
| Principal mirror, interaction record | `composite_sig` | `DCP-AI.v2.Delegation` |
| Awareness threshold, advisory declaration | `composite_sig` | `DCP-AI.v2.Awareness` |

The mandate chain rules of §3.5 are unchanged.

### E6. Mandate expiry (DCP-09 §3.6)

"The `effective_until` timestamp passes" reads "the `valid_until` instant passes". The window of a V2.0 mandate is
`valid_from` / `valid_until` (`schemas/v2/delegation_mandate.schema.json`, required), compared as RFC 3339 instants
as §3.5.2 requires; `effective_from` / `effective_until` in the §3.2 example are those fields. A mandate that carries
`effective_until` instead of `valid_until` is refused by the schema, and by the TypeScript chain verifier as the
kit exercises it.

### E7. Examples

The JSON examples of the sections listed in Section 1 illustrate the content of each record; they are not the V2.0
wire format and are not fixtures; as written they are not valid V2.0 wire records, for two separate reasons. Their
`signature` / `countersignature` / `agent_acknowledgment` blocks with `alg`, `kid`, `sig_b64` and `domain_sep`, the
fields `record_type`, `prev_hash_secondary` and `merkle_root` where the schema has none, and other field names that
differ from the schema make a record schema-invalid, even where it canonicalizes. Non-integer values (for example
`error_rate_percent: 0.3`, `capacity_threshold: 0.80`, `threshold: 0.3`, `confidence: 0.95`) are not representable
under `dcp-jcs-v1`. For a record that has a published schema in `schemas/v2/`, its wire format is that schema
together with `dcp-jcs-v1` canonicalization, signed as E2, E4 and E5 state. Some listed examples have no published
schema of their own: the DCP-05 transition record of §3.3, and the audit entries of DCP-05 §9.2, DCP-08 §8.2 and
DCP-09 §9.2, which do not match `schemas/v2/audit_entry.schema.json` either. Such an example does not define a
schema, and these errata do not make it a valid wire record. The requirements stated in the prose of those
sections are unchanged.

### E8. Implementation notes

The sentence "Where they differ, the normative text above stands." of the informative notes of DCP-05, DCP-08 and
DCP-09 reads "Where they differ, the normative text above stands, as corrected by the errata of
[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md)."

## 4. Requirements the V2.0 structures do not represent directly

These requirements stay normative. The V2.0 schemas of the records listed below carry a single signature per record
or a closed value set, so those records do not represent these requirements directly, and the SDK helpers on their
own do not meet them. Whether a mechanism outside these records can meet them depends on showing the functional
requirements themselves; these errata neither establish nor assume it. Representing them inside the records needs an
explicit, versioned design (a new schema version or a profile); none is defined or enabled by these errata.

| Requirement | Why the V2.0 record does not carry it |
|-------------|--------------------------------------|
| DCP-05 §4.4: authority signature and principal countersignature | One `composite_sig`; no field for a second signer |
| DCP-05 §5.1 component scores | The schema's `metrics` are other quantities; only `vitality_score` is carried |
| DCP-05 §6 fractional metrics | `dcp-jcs-v1` accepts integers only, so the schema's [0, 1] metrics are representable as 0 or 1 only |
| DCP-08 §4.3 organizational rights in reverse-domain notation | `right_type` is a closed enum of the four foundational rights |
| DCP-08 §9.1 signature by the commissioning authority | The record does not identify its signer's role; the helpers do not check it |
| DCP-09 §3.3 agent acknowledgment; §6.3 principal signature on a mirror | One signature per record |

The vitality score helpers of the SDKs also differ from one another on ties when given fractional inputs (for
`task_completion_rate` 0, `error_rate` 1, `human_satisfaction` 0.002 and `policy_alignment` 0, the TypeScript helper
returns 1 and the Python helper 0). Those inputs are not representable in a signed report; the divergence is a
separate pending item and is not a protocol requirement.

## 5. Evidence

| Erratum | References |
|---------|-----------|
| E1 | `sdks/typescript/src/core/domain-separation.ts`; `interop_vectors.json#domain_separation_all_contexts`; kit case `ext.wire.contexts.registry_documented` |
| E2, E4, E5 | `schemas/v2/{commissioning_certificate,vitality_report,decommissioning_record,rights_declaration,obligation_record,rights_violation_report,delegation_mandate,principal_mirror,interaction_record,awareness_threshold,advisory_declaration}.schema.json`; kit cases `ext.wire.dcp0*.*.signed`, `ext.wire.context.*` |
| E3 | `schemas/v2/vitality_report.schema.json#/properties/vitality_score`; kit cases `ext.wire.dcp05.vitality_field_name.schema_rejected`, `ext.wire.tamper.vitality_score_changed` |
| E6 | `schemas/v2/delegation_mandate.schema.json#/required`; `tests/interop/v2/mandate_chain_vectors.json` (`expired_at_verification_time`, `validity_*`); kit cases `ext.wire.dcp09.effective_until.*` |
| E7, Section 4 | kit cases `ext.wire.dcp05.fractional_metric.*`, `ext.wire.dcp08.extension_signed_but_schema_invalid`, `ext.wire.dcp05.countersignature.schema_rejected`, `ext.wire.fixture.*` |

The kit cases belong to the suite `ext.dcp05_09.wire` of [`tools/conformance`](../tools/conformance/README.md).
