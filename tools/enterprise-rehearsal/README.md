<sub>**English** · [中文](../../i18n/zh-CN/tools/enterprise-rehearsal/README.md) · [Español](../../i18n/es/tools/enterprise-rehearsal/README.md) · [日本語](../../i18n/ja/tools/enterprise-rehearsal/README.md) · [Português](../../i18n/pt-BR/tools/enterprise-rehearsal/README.md)</sub>

# Enterprise integration rehearsal

This optional, synthetic application exercises DCP with installed packages and real loopback HTTP. It is outside the protocol core, SDKs and production adapters. **Verification, admission, delegation activation and application authorization are separate decisions.** A valid signature does not authorize an action or guarantee a unique execution.

The rehearsal uses TypeScript/Express and Python/FastAPI. Direct admission uses the installed adapters; delegated admission and activation use public SDK APIs in the application. It does not claim that adapters implement delegation composition. Go/Rust interoperability belongs to the [conformance kit](../conformance/README.md); WASM does not expose composed delegation chains.

## Prerequisites

Tested on macOS arm64 with Node 22.15.0, npm 11.3.0 and CPython 3.12.2. Git, Python venv support, POSIX process groups, `/bin/ps`, and access to public npm/PyPI registries are required. Other platforms need validation. No account credentials, real principal data, running services or published development packages are needed.

Use a checkout containing this kit and the required SDK APIs. Package source must have no tracked modifications. The reviewed package source was commit `b3d41bd062ce035b537f8d3acd3e96e5b2ce310c`; the kit is an additional source deliverable. Versions alone do not identify these builds: record the source commit and artifact hashes. Do not assume that already-published versions contain the changes tested here.

## Prepare and install

Run the following blocks in the same shell, from the repository root. Every output subdirectory must be new. The temporary parent is resolved physically to avoid platform aliases such as `/tmp`.

```sh
MP05_ROOT="$(pwd -P)"
MP05_TMP="$(mktemp -d)"
MP05_TMP="$(cd "$MP05_TMP" && pwd -P)"
python3 tools/enterprise-rehearsal/prepare.py \
  --source "$MP05_ROOT" --revision "$(git rev-parse HEAD)" \
  --work "$MP05_TMP/build"
python3 tools/enterprise-rehearsal/install.py \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --work "$MP05_TMP/consumer"
```

`prepare.py` exports the three package directories from Git, builds TypeScript and Express tarballs plus a Python wheel/sdist, and records source, tools, commands and hashes. It does not modify package source or publish anything. The Express lock first downloads its published SDK 2.2.0 dependency; the script replaces it with the local SDK tarball and checks its contents **before compilation**. It preserves the original package manifests and locks when packing.

`install.py` creates isolated consumers. Node third parties are pinned by the kit lock; only local tarball integrity values change. Python third parties and build tools have version/hash locks; DCP is installed from the local wheel with `--no-deps`. Locks include registry wheel hashes, but availability on another platform still needs validation. No editable installation or SDK import from the checkout is used.

## Run the rehearsal

```sh
node tools/enterprise-rehearsal/node/rehearse.mjs \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --consumer "$MP05_TMP/consumer" --work "$MP05_TMP/run"
```

The launcher first runs the offline installation guard: artifact/content hashes, locks, import resolution, nested SDK copies, Python paths/distributions and required APIs. It then copies the kit into the Node consumer with a `STAGED.json` hash inventory. Python uses the consumer interpreter with `-I`. Servers check that inventory, SDK origin and the guard record; they do not repeat a full installation audit on every request. These checks are not an audit of all third-party dependencies.

The launcher owns the runner and servers through IPC, so a blocked runner cannot prevent managed cleanup. Servers bind only to `127.0.0.1` on ephemeral ports. There is a 900-second runner deadline, 10-second request timeouts, and a 60-second elapsed-time check after each group; the group check is **not** a hard cancellation deadline. No remote application endpoint is contacted during the rehearsal.

Exit `0` requires the complete selected plan, expected results, a successful secret scan and clean shutdown. Errors, missing observations, unexpected codes, extra effects, retained processes or failed cleanup make the command fail. Each invocation requires a new work directory; an old successful report cannot satisfy a new run. `--lanes node` or `--lanes python` selects a diagnostic subset, not the full two-lane acceptance run.

## Scenarios and expected decisions

The full plan has 100 steps per lane, 200 total. Expectations are written before requests and include HTTP status, DCP/application codes, authenticated tenant, real DCP outcomes, source calls, reservations and effects. Every group includes positive and negative controls.

| Group | What is exercised |
|---|---|
| G1 | Principal enrollment with a fingerprint supplied out of band; wrong fingerprints and altered key documents refused |
| G2 | Direct admission, session expiry, audience, application action and signed arguments |
| G3 | Tenant derived from a synthetic bearer; another tenant, missing trust, spoofed headers and extra envelope fields |
| G4 | Trust withdrawal and restoration without restarting |
| G5 | Revoked agent/key, unavailable or genuinely stale deny list, malformed date and restoration |
| G6 | Principal/agent key rotation, overlap and retirement; reissued mandates and acknowledgments |
| G7 | Delegation composition and activation, mandate revocation/time windows, missing or wrong acknowledgments, independent mandate-list failure |
| G8 | Application policy intersected with every mandate; action, domain, data classes, limits and signed arguments |
| G9 | Local single-use reservation, replay with a different request ID/serialization, and eight concurrent HTTP requests |
| G10 | Raw-byte ingress on both routes: duplicate keys at multiple depths, numeric forms, Unicode/UTF-8, declared and streamed body budgets |

On admitted/active evidence, the actual DCP result still has `action_authorized=false`. The application separately returns `application_authorized` and records its effect. A missing acknowledgment can leave evidence admitted but delegation inactive; no effect follows. An old list is served with its original date, never silently refreshed by receipt. The operator explicitly publishes fresh snapshots.

The application authenticates the tenant, selects its trust set out of band, and accepts the bundle only in the JSON body. It rejects `X-DCP-Bundle` to prevent authorizing a different body from the evidence admitted via a header. This is a kit decision, not removal of header support from the adapters. Unknown envelope fields are rejected before source calls; that rejection is not itself proof of a trust failure in the SDK.

## Evidence and retention

Keep `build/artifacts.json`, `consumer/installed.json`, and `run/verify.json`, `stage.json`, `supervision.json` and the fresh `run-*/report.json`/`plan.json`. Per-lane evidence records observations, source queries, reservations and effects. Reports contain local filesystem paths. Preserve the kit source or its file hashes with the package commit; artifact versions can coincide with registry versions while containing different source.

Fixtures generate **TEST ONLY** private keys and bearer tokens in restricted directories. The runner scans evidence for known byte/hex/base64 representations, then deletes its secret directories. The external supervisor also scans and removes secrets left by a killed runner within its own new work directory. It preserves evidence and refuses deletion through links outside that directory. The scanner is not general-purpose DLP. Never substitute real keys, tokens or personal data.

Managed timeouts and interrupts are covered; `SIGKILL` of the launcher itself, power loss and concurrent filesystem tampering cannot guarantee cleanup. After such an interruption, inspect the work directory and dispose of remaining synthetic secrets under your retention policy. The HTTP rehearsal removes its secret directories. The focused fixture tests below retain TEST ONLY material under `$MP05_TMP/helper-tests` until their final cleanup command runs.

## Focused tests

These controls use temporary fixtures and installed consumers. The first two commands cover preparation failures and installation tampering; the tampering occurs only in a disposable copy. A synthetic SDK lacking APIs is rejected by its content before execution, not solely by an API check.

```sh
python3 -B -m unittest discover -s tools/enterprise-rehearsal -p test_prepare.py -v
python3 tools/enterprise-rehearsal/negative_controls.py \
  --manifest "$MP05_TMP/build/artifacts.json" --work "$MP05_TMP/consumer"
node --test tools/enterprise-rehearsal/process.test.mjs tools/enterprise-rehearsal/secrets.test.mjs
REHEARSAL_PYTHON="$MP05_TMP/consumer/python/bin/python" \
REHEARSAL_WORK="$MP05_TMP/helper-tests" \
  node --test "$MP05_TMP/consumer/node/rehearsal/node/test/"*.test.mjs
"$MP05_TMP/consumer/python/bin/python" -I -m unittest discover \
  -s "$MP05_TMP/consumer/node/rehearsal/python" -p 'test_*.py' -v
rm -rf -- "$MP05_TMP/helper-tests"
```

The raw ingress corpus also runs independently of HTTP. Copy these test helpers next to the installed Node packages; do not run them against an SDK in the checkout.

```sh
mkdir "$MP05_TMP/consumer/node/ingress-controls"
for name in ingress-node.mjs ingress_python.py ingress-cases.json test-ingress.mjs test_ingress.py; do
  cp "$MP05_ROOT/tools/enterprise-rehearsal/$name" "$MP05_TMP/consumer/node/ingress-controls/$name"
done
node "$MP05_TMP/consumer/node/ingress-controls/test-ingress.mjs" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
"$MP05_TMP/consumer/python/bin/python" -I \
  "$MP05_TMP/consumer/node/ingress-controls/test_ingress.py" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
```

Runner controls reject inverted expectations, missing observations/groups, duplicates, infrastructure errors and stale report reuse. Supervisor controls cover blocked/abruptly terminated runners, noncooperative servers, malformed requests, startup failures, process-table failures and leftover secrets, alongside a clean positive run.

## Boundaries for a real integration

- **Protocol:** identity evidence, verification, admission and opt-in activation. `dcp-jcs-v1` is unchanged. The application reuses the experimental scanner for its byte-ingress policy; it does not activate a new canonicalization profile.
- **Adapters:** direct strict-v1 admission with opt-in body/source budgets, cancellation and per-tenant supervision. Delegated routes use separate bounded HTTP sources in the application; they do not demonstrate the adapters' source quotas for composed chains.
- **Application:** tenant authentication, trust administration, action/argument policy and the local ledger. SKU, currency and `max_amount` semantics are application rules; attenuation between mandates remains a protocol rule.
- **Operator:** real onboarding, authentication, TLS, key custody/HSM/KMS, revocation publication, retention and deployment controls. Synthetic bearers/fingerprints are not OIDC, a human PKI or proof that an agent is online. Loopback is not a production TLS test.
- **Ledger:** atomic local reservation means at most one attempt. It does not guarantee exactly-once execution, a transaction with an external service, distributed coordination or physical durability after a crash. Administrative changes are serialized. Eight concurrent HTTP requests do not imply eight parallel cryptographic verifications; source timeouts do not cancel synchronous cryptography.

The reviewed rehearsal passed 200/200 steps in an independent public-only copy, with four clean server exits and synthetic secrets removed. Its four independently built package artifacts were byte-identical to the first preparation. This is reproducible integration evidence, not certification of production readiness or an external security audit. See [admission](../../docs/ADMISSION.md) and [operational limits](../../docs/OPERATIONAL_LIMITS.md) for the supported boundaries. Publishing packages and validating a pilot deployment are separate steps.
