<sub>**English** · [中文](../../i18n/zh-CN/docs/conformance/IMPLEMENTER_GUIDE.md) · [Español](../../i18n/es/docs/conformance/IMPLEMENTER_GUIDE.md) · [日本語](../../i18n/ja/docs/conformance/IMPLEMENTER_GUIDE.md) · [Português](../../i18n/pt-BR/docs/conformance/IMPLEMENTER_GUIDE.md)</sub>

# Independent implementation and review guide

DCP is a protocol that can be implemented independently. This guide prepares an implementer or reviewer to evaluate the same evidence without adopting the repository's applications or services. It does not constitute an audit, certification, or endorsement.

## Establish the boundary first

Read the [core overview](../../spec/core/dcp-core.md), then the applicable normative documents:

1. [V1 and V2 verification checklist](../../spec/VERIFICATION.md).
2. [Canonicalization profile](../../spec/CANONICALIZATION_PROFILE.md).
3. [V2 normative specification](../../spec/DCP-AI-v2.0.md), including algorithms, composite binding and verifier policy.
4. [Admission profile](../../spec/profiles/admission/README.md), if principal trust or `strict-v1` is implemented.
5. The applicable files in [V2 schemas](../../schemas/v2/) and the specification's cited errata.

The core/profile layout organizes the specification; it does not exempt a V2 implementation from its required checks. Applications, network sources, caches and protected handlers belong to integrations. Keep their enforcement claims separate from core verification.

The specification is authoritative. Rust/WASM and the other SDKs are implementation references, not alternative normative definitions. Reusing a reference library can be appropriate, but disclose that dependency rather than calling the result an independent implementation of its verification logic.

## Freeze a reproducible input set

Use one reviewed repository revision. Record its full commit ID and whether the worktree is modified. Keep the schemas, fixtures, catalogs and runner sources from that revision together. Record your implementation version, resolved code path or artifact hash, runtime, toolchain, policy and verification time.

Catalog and fixture hashes identify bytes; they do not authenticate whoever supplied them. Obtain the revision through a source you trust. A wrapper's name and version are self-declared, so independently verify which executable or package ran.

The public kit requires Node 20 or later. An external implementation can use any language; it only needs to implement the selected stdin/stdout contract. Building the repository wrappers also requires the documented SDK toolchains and dependencies. Their build instructions and provenance checks are in the [kit README](../../tools/conformance/README.md).

## Run the relevant interfaces

From the repository root, first inspect the available cases:

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog admission --list
```

Then supply the executable and its arguments after `--`. Replace `/path/to/implementation` with your actual command:

```bash
node tools/conformance-external.js --report /tmp/dcp-primitives.json -- /path/to/implementation
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/dcp-evidence.json -- /path/to/implementation
node tools/conformance-external.js --catalog admission --report /tmp/dcp-admission.json -- /path/to/implementation
```

These commands select three different runner contracts. An implementation may support a subset, but its report must name that subset. WASM in this repository has no admission API. Do not report an unsupported operation as successful.

The evidence command explicitly selects `--assessment verdict`: it assesses normative verdicts and retains diagnostic wording separately. The legacy assessment remains available and keeps its existing default. A matching diagnostic string alone is not evidence of the intended check.

The request contains case IDs and operation inputs, not expected outcomes. Return exactly the contract's response envelope and required fields, with the same run identity and exactly one result for every requested case. Keep logging on stderr. A response followed by a failed process exit is not a successful run.

The [kit contract](../../tools/conformance/README.md) gives the exact encoding rules, limits, exit codes and report structure. Do not infer a new wire protocol from this guide.

For the opt-in schema diagnostic, replace `--catalog evidence` in the evidence command with `--catalog tools/conformance/external-schema-catalog.json`. It uses the same `/2` contract and keeps normative failures as failures; it is separate from the default evidence catalog. Consult the coverage map before interpreting a result from an SDK API alone.

### Inspect a generated report

The kit README includes a [minimal request and response](../../tools/conformance/README.md#external-implementations) and runnable [TypeScript](../../tools/conformance/wrappers/ts-sdk.mjs) and [Python](../../tools/conformance/wrappers/python_sdk.py) wrapper examples. Start with the digest exchange to check the transport contract before implementing bundle verification. Reusing these wrappers does not make their SDK verification logic independent.

After running the evidence command above, inspect the actual report instead of copying an example success:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync('/tmp/dcp-evidence.json', 'utf8'));
console.log(JSON.stringify({
  status: report.status,
  run_id: report.run.id,
  started_at: report.run.started_at,
  finished_at: report.run.finished_at,
  contract: report.kit.contract,
  catalog_sha256: report.kit.catalog_sha256,
  fixtures_sha256: report.kit.fixtures_sha256,
  implementation: report.implementation,
  totals: report.totals,
}, null, 2));
NODE
```

This prints values from your run; it does not validate the report or authenticate the implementation. Check them against the command's exit status, your run interval and the frozen catalog/fixture bytes. Record the exact installed toolchain versions as well as their minimum requirements; the native-wrapper build requirements are in the kit README.

## Interpret a result honestly

Inspect the process exit status and the report together. Confirm that the report belongs to this run, that its overall status passes, that every selected case ran, and that no required implementation was skipped. An old report file, partial results or agreement among several broken implementations is insufficient.

Read the [security coverage map](SECURITY_COVERAGE.md) before claiming compatibility. Schema validation, cryptographic verification, principal trust and admission are distinct layers. In particular, a bare SDK verifier result does not by itself establish the full V2 schema gate.

Negative cases need functioning positive controls. If a changed payload has an invalid signature as well as a semantic defect, its rejection does not isolate the semantic check. Preserve input bytes when reproducing parser or canonicalization discrepancies; parsing and rewriting them can remove the cause.

When implementations disagree:

1. Reproduce the same bytes, time and policy with a valid control.
2. Separate a protocol verdict from a process crash, missing result or timeout.
3. Reduce the case while preserving the relevant failure and the control.
4. Cite the exact normative requirement. If the specification does not decide it, report an open question instead of selecting the majority verdict.
5. Add a regression only after the expected behavior has a defensible basis.

## Prepare an independent security review

A useful review package contains the frozen revision, [security model](../SECURITY_MODEL.md), coverage map, selected contracts, exact commands, input/output hashes and unresolved questions. State which implementation and public API each claim concerns.

A core review can cover canonicalization, manifest/artifact binding, signature policy, schema validation, principal trust, admission and the reliability of the test tools. Review cryptographic dependencies and their versions as part of supply-chain exposure; known-answer tests are useful evidence, not an audit of those libraries. If their internal cryptographic implementations are excluded from an engagement, document that exclusion explicitly.

Transport, key custody, remote trust/revocation sources, caches, tenant isolation, application authorization and deployment controls require their own scope. Testing core functions cannot demonstrate those properties.

Do not submit private keys, production credentials, personal records or confidential logs as test fixtures. Use public synthetic test material. Follow the repository's [security reporting process](../../SECURITY.md) for vulnerabilities; a public test corpus is not a substitute for coordinated disclosure.

## Report implementation experience

A reproducible implementation report should state:

- The specification revision, supported wire versions and explicitly selected profiles.
- Which cryptographic or SDK implementation code is reused.
- The exact suites, assessment mode, command, implementation version and report identity.
- The recorded policy and verification time, positive controls, skipped or unsupported features and known gaps.
- Minimal discrepancies tied to normative text, with secrets removed.

The [early adopter program](../EARLY_ADOPTERS.md) describes how maintainers collect integration feedback. This guide prepares that work; it does not claim that an external implementer has reviewed or adopted DCP.
