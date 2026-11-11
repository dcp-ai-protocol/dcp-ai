# Release validation

After a release is published, [`tools/release-validation`](../../tools/release-validation/README.md)
installs the published packages from their official registries, as a new consumer would, and runs the
external conformance catalogs against what was installed. This page says what that shows, what has
been run so far, and what it does not cover. The tool's README is the reference for running it.

## What it covers

The six versions published on 09/11/2026 ([audit dossier](AUDIT_DOSSIER.md#publication-of-09112026)),
through nine lanes:

| Published version | Lanes |
|---|---|
| npm `@dcp-ai/sdk` 2.4.0 | `npm-sdk` |
| npm `@dcp-ai/wasm` 2.2.0 | `npm-wasm-node` (Node) and `npm-wasm-browser` (a real Chrome) |
| npm `@dcp-ai/cli` 2.2.0 | `npm-cli` |
| PyPI `dcp-ai` 2.11.0 | `pypi-wheel` (the wheel) and `pypi-sdist` (the sdist, built from source) |
| Go module `sdks/go/v2` v2.14.0 | `go` |
| crates.io `dcp-ai` 2.14.0 | `crates-default` and `crates-otlp` (with the `otlp` feature) |

Each lane installs its package into a temporary directory with an environment built for it, checks
that the bytes downloaded are the published ones and that what is installed or compiled is those
bytes, and only then runs the evidence:

- **60 catalog cells.** The eight external catalogs of the
  [conformance kit](../../tools/conformance/README.md) on six lanes (the SDK, the two Python lanes, Go
  and the two Rust lanes), and the six that apply to the WebAssembly API on its two lanes. The CLI lane
  has no catalog. That is 6142 cases with the catalogs at this revision.
- **103 direct cases** of the public `DcpWasm` API in the browser.
- **The four CLI suites** (218 tests) against the installed CLI, and their negative control.
- **58 controls** in the same run. Some are positives that must pass; the others are altered copies of
  the real reports, inverted expectations, injected faults, timeouts and local origins, each of which
  must be refused in the way required of it.

It adds no catalog and no expectation of its own. The expectations are the kit's, committed in this
repository.

## What a result means

- **PASS** needs all of the above in one run. It states that these artifacts, with these hashes,
  obtained from these registries, passed these catalogs with the kit at this revision in this
  environment. It is not a certification, and it says nothing about an environment that was not run.
- **PARTIAL** is a selection of lanes or catalogs without failures. It is a diagnostic and is never
  reported as a pass.
- **A discrepancy** means an installed artifact answered and the committed expectation does not match.
- **An error** means there was no valid answer to judge: the registry, the network, a toolchain, an
  identity that does not match, a report that is incomplete or not of this run. An error is never
  counted as a rejection by the protocol, and never as a pass.

Installing a package and proving where it came from is not conformance. Only the catalog cells and
blocks are evidence about behavior.

The tool changes nothing in the protocol: the canonicalization profile `dcp-jcs-v1`, the core, the
SDKs and the catalogs are used as they are.

## What has been run

One complete campaign, on 10/11/2026, from a copy of the repository with only its public files:

| Item | Observed |
|---|---|
| Result | PASS: 60 cells (6142 of 6142 cases), 103 direct cases, 218 CLI tests, the negative control, 58 controls |
| Mode | `locked` (the committed locks) |
| Host | macOS on Apple silicon (arm64), Node 22.15.0, npm 11.3.0 |
| Python | CPython 3.12.2, arm64 |
| Go | go1.26.10, which on this host builds `darwin/amd64`: the Go binary that was validated is amd64 |
| Rust | cargo and rustc 1.93.1, aarch64 |
| Browser | Google Chrome 157.0.8103.50. Its user agent is a reduced one and does not say which architecture ran |
| Report | run `dfeaa975-f449-4947-8238-32bb3f372d87`, `report.json` SHA-256 `2b5c4c109b76038c693c73ab6485a3a3634949790fd57648637deaf9a23b7ee7` |

The report and its files are kept by the maintainers; they are not in the repository.

Also run, and not a campaign: the two Python lanes with the first catalog in a Linux x86_64 container
(Ubuntu 24.04, CPython 3.12.3, emulated on the same host), in `fresh` and in `locked` mode. That is
where the Linux lock comes from.

**The CI workflow has not been run.** `.github/workflows/release-validation.yml` runs the same
campaign on `ubuntu-24.04` on demand; no run of it exists yet, and nothing here claims a Linux
campaign.

## Running it

```bash
node --test tools/release-validation/release-validation.test.mjs
node tools/release-validation/run.mjs --python "/path/to/python3.12" --go "/path/to/go" --cargo "$(rustup which cargo)"
```

The first command uses no external network (one test serves an index from a loopback HTTP server).
The second downloads from npm, PyPI, the Go proxy and crates.io, and needs Chrome. `--lane` and
`--catalog` select a part of it, which ends as PARTIAL. In CI, start the *Release validation* workflow
by hand. Requirements, options and the layout of the report are in the
[tool's README](../../tools/release-validation/README.md).

Third-party dependencies come from committed locks (`locked`, the default) or are resolved at that
moment (`fresh`). The Python locks exist for CPython 3.12 on macOS arm64 and on Linux x86_64; on any
other interpreter or platform the Python lanes need `fresh`.

## Not covered

- Any version other than the six above, and anything not published to those registries: the framework
  integrations, the Docker images, the project templates, the services and the contracts.
- Operating systems, architectures, interpreters and browsers that were not run. In particular: no
  Windows, no complete campaign on Linux, no Go binary for arm64, no browser other than Chrome.
- The host's own tools. npm, pip, Go, cargo, rustc, the C compiler and Chrome are used as found and
  recorded, not pinned.
- The properties the catalogs themselves do not cover. Their limits are in the
  [conformance kit](../../tools/conformance/README.md) and in the
  [audit dossier](AUDIT_DOSSIER.md#known-limits-and-exclusions).
