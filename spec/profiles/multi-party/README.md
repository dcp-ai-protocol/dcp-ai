# Multi-Party Authorization Profile: `mpa-v1`

**Status:** Draft, v1
**Scope:** Whether a multi-party authorization authorizes one operation on one target, for one verifier, under a policy the operator fixed

---

## 1. Purpose and layering

A multi-party authorization ([`multi_party_authorization.schema.json`](../../../schemas/v2/multi_party_authorization.schema.json)) lists the composite signatures of several parties over an operation. On its own it decides nothing: its `required_parties` is not signed, each role is written by the party that signs it, and nothing in it says which parties may speak for the object of the operation, where the authorization may be used or until when.

`mpa-v1` is an opt-in profile that makes it decide. It changes neither the schema of the record nor what a party signs. It adds:

1. **A signed request** (§2.2) inside `operation_payload`: the target, the audience and the validity window, which every party signs because they are part of what it already signs.
2. **The operator's policy** (§2.3): for each target, its parties with their roles, and for each operation how many parties it needs and with which roles.
3. **The operator's keys for the parties** (§2.4): the principal trust set of the [admission profile](../admission/README.md).

Three questions are kept apart, and only the third gives `authorized`:

| Layer | Question | Read from |
|---|---|---|
| Structure | Is the record well formed? | The record alone |
| Verification | Which parties signed exactly this request? | The keys the operator trusts for each party |
| Authorization | May the executor carry out this operation on this target now? | The operator's policy, and what the executor is about to do |

A check of the structure alone (§8) verifies no signature and authorizes nothing.

A record without the request is still a valid v2.0 record. It is never authorized under this profile: there is no legacy mode.

## 2. Inputs

### 2.1 Clock

One instant `now`, in milliseconds since the Unix epoch, taken as a parameter and defaulting to the system clock. Timestamps are RFC 3339 with a `Z` or `±hh:mm` offset, compared at millisecond precision, as in the admission profile. The clock skew allowance is 30 seconds and applies to `issued_at` only.

### 2.2 The request

Under `mpa-v1`, `operation_payload` has exactly two members. Schema: [`multi_party_request.schema.json`](../../../schemas/v2/multi_party_request.schema.json).

```json
{
  "request": {
    "profile": "mpa-v1",
    "request_id": "mpa:6f1c0a52d3b84e7f9a1c2d3e4f506172",
    "target": "agent:acme-bot",
    "audience": "verifier:acme-gateway",
    "issued_at": "2026-11-18T00:00:00Z",
    "expires_at": "2026-11-18T00:30:00Z"
  },
  "parameters": { "reason": "key_compromise" }
}
```

- `request` has exactly these six members. `request_id` is 1 to 128 characters; `target` and `audience` are 1 to 256. Lengths count Unicode code points.
- `target` names the object of the operation as the operator's policy names it. `audience` names the verifier that may act on the authorization.
- `parameters` is an object: the operation's own parameters, empty when it has none.
- Every number in `operation_payload`, read as the nearest binary64, is an integer from -(2^53 - 1) to 2^53 - 1: the integers a binary64 holds exactly. `1.0` and `1e2` are such integers, and so is a literal a binary64 cannot tell from one. Past that range, an implementation that reads JSON numbers as binary64 and one that reads them exactly write different `dcp-jcs-v1` texts for the same record, and a signature over one integer would stand for its neighbours. A larger value, such as a 64-bit identifier, goes in a string.
- Every string in `operation_payload`, member names included, is well-formed Unicode text: no unpaired surrogate, written as an escape or otherwise, and no bytes that are not UTF-8. Implementations do not read anything else alike: one puts U+FFFD in its place and another cannot read it.
- `operation_payload` nests at most 32 levels deep, itself being the first level and `parameters` the second.

What a party signs is unchanged: `UTF8("DCP-AI.v2.MultiPartyAuth") || 0x00 || dcp-jcs-v1({operation, operation_payload, party_id, role})`. The classical signature covers those bytes and the post-quantum one covers them followed by the classical signature.

### 2.3 Policy set

Supplied only by the operator: local configuration or a source the operator chose. It MUST NOT be derived from the record, from a request or tool parameter, or from a registry that requests can write to. Schema: [`multi_party_policy_set.schema.json`](../../../schemas/v2/multi_party_policy_set.schema.json).

```json
{
  "policy_set_version": "2026-11-18.1",
  "profile": "mpa-v1",
  "audience": "verifier:acme-gateway",
  "max_validity_seconds": 1800,
  "subjects": [
    {
      "target": "agent:acme-bot",
      "parties": [
        { "party_id": "human:alice", "role": "owner" },
        { "party_id": "human:bob", "role": "org_admin" },
        { "party_id": "human:carol", "role": "recovery_contact" }
      ],
      "operations": {
        "revoke_agent": {
          "required_parties": 2,
          "allowed_roles": ["owner", "org_admin", "recovery_contact"],
          "required_roles": ["owner"]
        }
      }
    }
  ]
}
```

A policy set is validated when it is loaded. It is rejected, with the configuration code in the table, when:

| Condition | Code |
|---|---|
| A field outside the schema at any level | `CONFIG_UNKNOWN_FIELD` |
| `policy_set_version` missing or empty; `profile` not `mpa-v1`; `audience` not a string of 1 to 256 characters; `max_validity_seconds` not an integer from 1 to 86400; a role or an operation outside the lists; `parties` empty; `allowed_roles` empty or repeating a role; `required_parties` below 2; `required_roles` not among `allowed_roles` | `CONFIG_INVALID_VALUE` |
| A target listed twice, or a party listed twice for one target | `CONFIG_MPA_DUPLICATE` |
| `required_parties` greater than the number of parties with an allowed role, or greater than 16, the most authorizations a record holds; or a required role that no such party holds | `CONFIG_MPA_UNSATISFIABLE` |

When a policy set has several of these problems, the code of any one of them may be reported.

There are no defaults. An operation the operator does not list for a target is not authorized, and a policy set with no subjects is valid and authorizes nothing. A party has one role per target.

### 2.4 Trust set

The keys of the parties come from the operator's principal trust set ([admission profile §2.2](../admission/README.md#22-trust-set)), loaded by the same validator: a party is a `human_id` of that set. A kid is derived from its key, and a kid listed twice is rejected when the set loads (`CONFIG_TRUST_DUPLICATE`). So one key cannot be attributed to two parties, and one signer cannot count twice. The evaluation takes only a trust set that loaded.

The two are loaded separately. A party of the policy that the trust set does not have is not a configuration error: its signatures get `MPA_KEY_NOT_ANCHORED`.

## 3. What the executor states

The executor gives the operation, the target and the parameters it is about to carry out. They must be an operation of the list, a target of 1 to 256 characters of well-formed text, and an object that is data of §2.2: numbers in its range, well-formed text and at most 31 levels deep, since `parameters` is the second level of `operation_payload`. Otherwise the call is refused as a configuration error (`CONFIG_INVALID_VALUE`) and gives no result. The authorization must be for exactly those.

## 4. Evaluation

Five phases. A phase that adds a code stops the next ones, so no signature of a malformed, foreign or expired request is verified. The first phase stops at its first failure, in the order below; the others add every code that applies. The evaluation is strict: an authorization that fails refuses the record, even when the others meet the threshold.

| Phase | Check | Code |
|---|---|---|
| 1. Structure | The record conforms to its schema | `MPA_SCHEMA_INVALID` |
| | `operation_payload` has a `request` member | `MPA_REQUEST_MISSING` |
| | `operation_payload` conforms to §2.2, with RFC 3339 instants | `MPA_REQUEST_INVALID` |
| | `operation_payload` is data of §2.2 (numbers in its range, well-formed text, at most 32 levels deep) and is representable in `dcp-jcs-v1` | `MPA_NOT_REPRESENTABLE` |
| | At most 16 authorizations | `MPA_TOO_MANY_AUTHORIZATIONS` |
| 2. Binding | `operation` is the one the executor states | `MPA_OPERATION_MISMATCH` |
| | `request.target` is the one the executor states | `MPA_TARGET_MISMATCH` |
| | `parameters` are the ones the executor states, compared in canonical form | `MPA_PARAMETERS_MISMATCH` |
| | `request.audience` is the policy set's `audience` | `MPA_AUDIENCE_MISMATCH` |
| | `issued_at` is not later than `now` plus the allowance | `MPA_NOT_YET_VALID` |
| | `expires_at` is later than `now` | `MPA_EXPIRED` |
| | `expires_at` is later than `issued_at`, by at most `max_validity_seconds` | `MPA_VALIDITY_INVALID` |
| | The policy set has a subject for `request.target` | `MPA_TARGET_UNKNOWN` |
| | That subject lists the operation | `MPA_OPERATION_NOT_ALLOWED` |
| 3. Parties | Each `party_id` is a party of the subject | `MPA_PARTY_UNKNOWN` |
| | Each `party_id` appears once | `MPA_PARTY_DUPLICATE` |
| | The signed role is the one the operator gives the party | `MPA_ROLE_MISMATCH` |
| | That role is allowed for the operation | `MPA_ROLE_NOT_ALLOWED` |
| 4. Verification | Binding `pq_over_classical`, a classical algorithm in the classical slot and a post-quantum one in the other | `MPA_HYBRID_REQUIRED` |
| | Each kid is a key of that party in the trust set, with that algorithm | `MPA_KEY_NOT_ANCHORED` |
| | That key is not revoked, not expired and already valid at `now` | `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID` |
| | Both signatures are canonical base64 and verify over the bytes of §2.2 | `MPA_SIGNATURE_INVALID` |
| 5. Decision | At least `required_parties` of the policy authorized | `MPA_THRESHOLD_NOT_MET` |
| | Every role of `required_roles` is held by a party that authorized | `MPA_REQUIRED_ROLE_MISSING` |

- `required_parties` in the record is not signed and is never read.
- In phase 3 the role that counts is the operator's: `MPA_ROLE_MISMATCH` when the signed one is another, `MPA_ROLE_NOT_ALLOWED` when the operator's is not allowed for the operation. Both can apply. An unknown party gets `MPA_PARTY_UNKNOWN` and nothing else.
- In phase 4 each key gets the first that applies of not anchored, revoked, expired (`status` `expired`, or `expires_at` before `now`) and not yet valid (`not_before` after `now`). A signature is verified only when both keys can count.
- The algorithms of phase 4 are the profile's: `ed25519` in the classical slot, `ml-dsa-65` or `slh-dsa-192f` in the other. They are not read from a verifier policy, which can change.
- Instants are compared in milliseconds: digits past the third of a fraction are dropped, and a `now` with a finer resolution is truncated.
- Text that is not well formed is refused outside `operation_payload` too: a record with it in any string, a `party_id` or the name of an algorithm, does not conform to its schema (`MPA_SCHEMA_INVALID`), and a policy set with it in any string does not load (`CONFIG_INVALID_VALUE`).

## 5. Result

### 5.1 Verdicts

`structure` is `valid` or `invalid`. `verification` is `verified`, `failed`, or `not_evaluated` when phase 4 was not reached. `authorized` is true only when no phase added a code.

### 5.2 Fields

| Field | Value |
|---|---|
| `profile` | `"mpa-v1"` |
| `structure`, `verification`, `authorized` | §5.1 |
| `operation`, `target`, `request_id`, `expires_at` | The signed ones of a well-formed record, else null |
| `parties` | One per authorization: `party_id`, `role` (the signed one) and `verified` (null when phase 4 was not reached) |
| `parties_counted` | The authorizations with no code in phase 4; null when it was not reached |
| `required_parties` | The operator's threshold; null when no rule was found for the operation on the target |
| `policy_set_version`, `trust_set_version` | The versions of the configuration used |
| `errors` | `{ code, message }` in the order of the phases; within one phase no order is fixed |

### 5.3 Codes

| Code | Phase |
|---|---|
| `MPA_SCHEMA_INVALID`, `MPA_REQUEST_MISSING`, `MPA_REQUEST_INVALID`, `MPA_NOT_REPRESENTABLE`, `MPA_TOO_MANY_AUTHORIZATIONS` | 1 |
| `MPA_OPERATION_MISMATCH`, `MPA_TARGET_MISMATCH`, `MPA_PARAMETERS_MISMATCH`, `MPA_AUDIENCE_MISMATCH`, `MPA_NOT_YET_VALID`, `MPA_EXPIRED`, `MPA_VALIDITY_INVALID`, `MPA_TARGET_UNKNOWN`, `MPA_OPERATION_NOT_ALLOWED` | 2 |
| `MPA_PARTY_UNKNOWN`, `MPA_PARTY_DUPLICATE`, `MPA_ROLE_MISMATCH`, `MPA_ROLE_NOT_ALLOWED` | 3 |
| `MPA_HYBRID_REQUIRED`, `MPA_KEY_NOT_ANCHORED`, `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID`, `MPA_SIGNATURE_INVALID` | 4 |
| `MPA_THRESHOLD_NOT_MET`, `MPA_REQUIRED_ROLE_MISSING` | 5 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_MPA_DUPLICATE`, `CONFIG_MPA_UNSATISFIABLE` | Raised when a policy set is loaded, or for what the executor states (§3) |
| `CONFIG_TRUST_*` | Raised when the trust set is loaded (admission profile §2.2) |

Messages are at most 300 characters and never contain private keys or tokens. A result does describe the operator's configuration: its codes, messages and fields say what the policy set asks for (a target, an operation, a party and its role, a threshold, the longest validity) and what the trust set holds for a party (a key that is not anchored, revoked or expired, by its `kid`), and phases 2 and 3 say it before any signature is verified. See A4 in §6.

## 6. Adapters

The core functions are deterministic, make no network call and keep no state. An adapter (a server, a tool, a middleware) resolves the operator's configuration and enforces the decision:

- **A1.** The operation runs only when `authorized` is true, and it is the operation, on the target, with the parameters that were given to the evaluation.
- **A2.** The policy set, the trust set, their sources, the audience and the tenant come from the operator's code and configuration. No request field, header or tool parameter selects or changes them.
- **A3.** An operation that is not idempotent is single use, and that is the adapter's to enforce (§7).
- **A4.** A result describes the operator's policy set and trust set to whoever reads it, also for a record no one signed. An adapter MUST return it only to callers the operator lets learn that; to anyone else it returns at most whether the operation was authorized.

## 7. Guarantees and limits

With `authorized` true:

- every authorization was signed, with both components, by a different party with keys the operator's trust set lists for it, usable at `now`;
- every party holds on that target the role it signed, and the operator allows that role for the operation;
- at least as many parties as the operator requires for that operation on that target authorized it, and the required roles are among them;
- all of them signed the operation, the target and the parameters the executor stated, for this verifier, within a window the operator accepts.

It does **not** guarantee:

- **Single use.** The evaluation keeps no state and does not consume `request_id`: two evaluations of the same request, simultaneous ones included, both give `authorized`. An executor whose operation is not idempotent records the `request_id` it has consumed until `expires_at`, and consumes and executes atomically: in one transaction, or by reserving the identifier before executing and not executing when the reservation already existed. Checking first and recording afterwards lets two concurrent executions through.
- **That what was authorized is what runs.** The executor states what it is about to do; doing exactly that is its own.
- **Identity beyond the configuration.** The decision is exactly as good as the operator's trust set, policy set and their sources.
- **Competence or independence of the parties.** Two keys are not two people, and a signature does not show that anything was reviewed.
- **Revocation fresher than the trust set that was loaded.**

## 8. API correspondence

| Concept | TypeScript (`@dcp-ai/sdk`) | Python (`dcp_ai.v2`) | Go (`dcp/v2`) | Rust (`dcp_ai::v2::multi_party_auth`) |
|---|---|---|---|---|
| Check the structure | `checkMultiPartyAuthorizationStructure(record, policy?)` | `check_multi_party_authorization_structure(record, policy=None)` | `CheckMultiPartyAuthorizationStructure(record, policy)` | `check_multi_party_authorization_structure(&record, policy)` |
| Load a policy set | `createMultiPartyPolicyStore(json)` | `create_multi_party_policy_store(json)` | `NewMultiPartyPolicyStore(json)` | `MultiPartyPolicyStore::from_json(&json)` |
| Evaluate | `evaluateMultiPartyAuthorization(record, registry, { policy, trust, expected, now? })` | `evaluate_multi_party_authorization(record, registry, policy=…, trust=…, expected=…, now_ms=…)` | `EvaluateMultiPartyAuthorization(registry, json, options)` | `evaluate_multi_party_authorization(&record, &options)` |
| Build the request | `createMultiPartyRequest(input)` | `create_multi_party_request(…)` | `NewMultiPartyRequest(input)` | `create_multi_party_request(&input)` |
| Sign as a party | `createPartyAuthorization(…)` | `create_party_authorization(…)` | `CreatePartyAuthorization(…)` | `create_party_authorization(…)` |
| Configuration error | `MultiPartyConfigError` (`code`) | `MultiPartyConfigError` (`code`) | `*MultiPartyConfigError` (`Code`) | `MultiPartyConfigError` (`code`) |

Result fields keep the names of §5.2 in every SDK's JSON form.

The structure check looks at the number of authorizations, their roles and the presence of a `composite_sig`, against a shape policy of its own. It verifies no signature, knows no party and reads no operator policy. In Python, Go and Rust it was published as `verify_multi_party_authorization` / `VerifyMultiPartyAuthorization`; that name is deprecated and gives the same result.

## 9. Test vectors

[`tests/interop/v2/multi_party_vectors.json`](../../../tests/interop/v2/multi_party_vectors.json) holds the shared cases: records, trust sets, a policy set, what the executor states, `now`, and for each case the expected `authorized`, `structure`, `verification`, `parties_counted`, `required_parties` and set of codes, with the rule it checks. Configuration cases give a policy set, or a trust set, and the expected code. Every SDK runs them; agreement between SDKs is not the criterion, the expected values are. [`generate-multi-party-vectors.mjs`](../../../tests/interop/v2/generate-multi-party-vectors.mjs) writes the file and checks every expectation against an evaluator of its own, written without SDK code.

## Implementation notes (informative)

> **Added 18/11/2026. Not normative.** These notes add no requirement and change nothing above: they describe how
> the reference code on `main` relates to this text. Where they differ, the normative text above stands.

- **Where it is implemented.** The four SDKs on `main` implement this profile. No published version has it: the published TypeScript SDK exports only the types of the record, and the published Python, Go and Rust SDKs have the structure check alone, under its former name.
- **The reference server.** `POST /v2/multi-party/authorize` applies this profile under the operator's policy set (`DCP_MULTI_PARTY_POLICY_FILE`) and does not exist without it. It answers only to the operator token, and it executes nothing: see [server/README.md](../../../server/README.md).
- **No operation consumes an authorization.** Nothing in this repository carries out `revoke_agent`, `rotate_org_key`, `change_jurisdiction` or `modify_recovery_config` from a multi-party authorization. The profile decides; an adapter executes.
- **Who reviewed the vectors.** The generator's evaluator and the four implementations have the same author. Their agreement is not an independent review.
