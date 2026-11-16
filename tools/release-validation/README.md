# Release validation

Installs the published DCP packages from their official registries into temporary consumers, checks
their identity and origin, and runs the existing external conformance kit
([`tools/conformance`](../conformance/README.md)) against what was installed. It adds no catalog, no
oracle and no conformance model. The guide for readers is
[docs/conformance/RELEASE_VALIDATION.md](../../docs/conformance/RELEASE_VALIDATION.md); this file is the
reference for running and maintaining the tool.

A PASS states only this: these artifacts, with these hashes, obtained from these registries, passed
these catalogs with the kit at this revision in this environment. It is not a certification and covers
nothing that was not executed.

```
node tools/release-validation/run.mjs [--list] [--lane <id>]... [--catalog <id>]...
                                      [--resolution locked|fresh] [--work <dir>] [--clean]
                                      [--python <exe>] [--go <exe>] [--cargo <exe>] [--chrome <exe>]
node --test tools/release-validation/release-validation.test.mjs     # no external network
```

| Exit | Meaning |
|---|---|
| 0 | PASS: every lane, every catalog cell (60), every block (3), every control |
| 1 | a discrepancy: an artifact answered and the committed expectation does not match |
| 2 | usage |
| 3 | error: infrastructure, identity, unsupported, incomplete or implementation |
| 4 | PARTIAL: a selection without failures. A diagnostic, never a validation |

An error is never counted as a rejection, and it outranks a discrepancy. Installing a package and
proving its origin is not conformance: only the cells and blocks are.

The tests use no external network; one of them serves a package index from a loopback HTTP server.

## Requirements

Node 20 or later on a POSIX host, with the `npm` next to `node`, `/bin/ps`, `/usr/bin/tar` and, for the
Go lane, `/usr/bin/unzip`. Built-in Node modules only.

Python, Go, Rust and Chrome are tools of the host: the path given with `--python`, `--go`, `--cargo` or
`--chrome`, or the first `python3`, `go` or `cargo` on the tool's own `PATH` (the directory of `node`,
`/usr/bin`, `/bin`) and the usual Chrome of the platform. Nothing is installed, updated or switched:
`GOTOOLCHAIN=local`, and a rustup proxy is refused, so pass the toolchain's own cargo
(`rustup which cargo`), which must have `rustc` next to it. Python must be 3.11 or later (the `fresh`
sdist lane reads `pyproject.toml` with `tomllib`); the committed locks are for CPython 3.12.

## Lanes

| Lane | Published artifact | Evidence |
|---|---|---|
| `npm-sdk` | npm `@dcp-ai/sdk` 2.4.0 | 8 catalogs |
| `npm-wasm-node` | npm `@dcp-ai/wasm` 2.2.0, in Node | 6 catalogs |
| `npm-wasm-browser` | the same package, public API in a real Chrome | 6 catalogs and the block `direct-sections` (103 cases) |
| `npm-cli` | npm `@dcp-ai/cli` 2.2.0 | no catalog: the blocks `cli-suites` (218 tests) and `cli-negative-control` |
| `pypi-wheel` | PyPI `dcp-ai` 2.11.0, wheel | 8 catalogs |
| `pypi-sdist` | PyPI `dcp-ai` 2.11.0, sdist, built here | 8 catalogs |
| `go` | Go module `sdks/go/v2` v2.14.0 | 8 catalogs |
| `crates-default` | crates.io `dcp-ai` 2.14.0, default features | 8 catalogs |
| `crates-otlp` | the same crate with the `otlp` feature | 8 catalogs |

Six published versions and nine lanes. Six lanes run 8 catalogs and the two WebAssembly lanes run 6:
60 catalog cells, plus 3 blocks. `manifest.json` holds the expected identities (those of the audit
dossier), the catalogs and the lanes; `expected-blocks.json` holds the ids each block must report.

## What a run does

1. **Work directory.** A new `mkdtemp` directory, or `--work <dir>`, which must not exist and must be
   outside the checkout. Nothing is reused.
2. **Environment.** Every subprocess gets an environment built by the tool. `HOME`, `TMPDIR`, the
   caches and each package manager's settings are inside the work directory. `PATH` is not: it is the
   tool's own short list of host directories (the directory of `node`, `/usr/bin`, `/bin`, and the
   directory of a toolchain given by option). Nothing is inherited: no credentials, no proxy, no user
   or project configuration.
3. **Installation, identity and origin**, per ecosystem (below). Three values must agree for every
   package: the manifest's, the hash the tool computes from the downloaded bytes, and the one the
   package manager or registry records. The downloaded archive must equal, file by file and both ways,
   what is installed or compiled, apart from the few files an installer writes itself, which are named
   below.
4. **Cells.** One run of the kit's runner per lane and catalog, with the kit's own wrapper pointed at
   the installed package. A report counts only if it is this execution's: a path that did not exist, a
   run inside the observed interval with an id not seen before, the argv, `kit.catalog_sha256`, fixture
   hashes, suites and case ids that were asked, and a status that agrees with the runner's exit code.
   Every case must have a status its class allows, and the counts of every suite and of the report
   (`executed` included) must be those of the cases.
5. **Blocks.** Evidence that is not a catalog cell (the CLI suites, their negative control, the direct
   browser sections) is a block of its lane. The campaign needs each block exactly once, like a cell:
   a lane's installation or status never stands in for it.
6. **Controls**, in the same execution. Each lane that brings controls (`npm-sdk`, `npm-cli`,
   `npm-wasm-browser`) owes its own fixed set whenever it is selected: exactly one result with
   `ok === true` for each id and no other, or the campaign is an error. Some are positives that must
   pass. The others are altered copies of the real outputs (missing, duplicated and unknown results,
   stale reports, inconsistent counts, altered identities and local origins) and real runs (an inverted
   expectation that must fail, wrapper and harness faults, timeouts, a process left behind, a browser
   run stopped from outside), each of which must be refused in the way that is required of it.
7. **Report.** `report.json` in the work directory, with the runner's reports, block outputs, logs,
   archives and locks. Everything is kept; `--clean` removes only the installed consumers and caches of
   this execution.

A process counts as having run only if every observation of it is clean (no signal, no deadline, no
output limit, nothing left behind); exit 0 alone is not enough. Every phase has a deadline, and the
supervisor stops the whole process tree, whatever its process groups.

### npm (`npm-sdk`, `npm-wasm-node`, `npm-wasm-browser`, `npm-cli`)

One consumer (`consumers/npm`) with the three packages at exact versions and a lock. Static check of
the consumer and lock (exact versions, every entry from `registry.npmjs.org` with a sha512 integrity, no
links, each DCP package once); `npm pack` into an empty cache, hashed by the tool; then
`npm ci --ignore-scripts` (`locked`) or `npm install --ignore-scripts` (`fresh`); then the archive
against the installed tree.

`@dcp-ai/wasm` 2.2.0 contains `pkg/package.json` with the name and version of the Rust crate it was
compiled from (`dcp-ai` 2.14.0). The report records both identities and never expects them to be equal.

- **`npm-cli`.** The four suites of `cli/__tests__` and the kit's `negative-control.mjs` run against
  the installed CLI (`DCP_CLI_ROOT`): its binary, its `lib/` and its dependencies as npm installed
  them. The tool first checks that the installed CLI would load the one verified `@dcp-ai/sdk`. The
  negative control's own verdict is not taken on trust: its output must show exactly the four inverted
  cases failing, each on an assertion, and the other 214 passing.
- **`npm-wasm-browser`.** The kit's `wasm-browser.mjs` drives the public `DcpWasm` API in a real
  Chrome with a temporary profile. The files it serves are pinned to a `SHA256SUMS` the tool writes from
  the installed tree. Every cell and the direct sections must come with the wrapper's own browser
  record of that run: new, with the run's id, inside the observed interval, serving the installed
  files, with a browser that answered, exited and whose profile was removed.

### Python (`pypi-wheel`, `pypi-sdist`)

Each lane has its own virtual environments. Python runs with `-I -B`, pip with `--isolated`, no cache,
no configuration file, and `https://pypi.org/simple/` as the only index.

- **Wheel.** `pip download`; the SHA-256 is checked before anything is installed; then
  `pip install --only-binary :all:`; pip's own report gives the hash it installed and shows every file
  came from `files.pythonhosted.org`. The wheel and the installed distribution are compared both ways:
  every module file must be equal and nothing else may be installed. Left out are only the files pip
  writes itself in `*.dist-info`: `RECORD` (rewritten), `INSTALLER` and `REQUESTED`; a
  `direct_url.json` is a problem here. No bytecode exists when the trees are compared (`--no-compile`,
  `-B`). `import dcp_ai` must load from that site-packages, with no user site and no path outside the
  work directory and the interpreter.
- **Sdist.** The file is first downloaded as bytes by `fetch-pypi.mjs`, which unpacks and runs
  nothing, and its SHA-256 is compared with the manifest; what the index declares for it is recorded
  apart and is not trusted. Only then is it unpacked, the build dependencies installed, and the wheel
  built from the local file with `--no-index --no-build-isolation`. The built wheel is a separate
  artifact in the report; its module files must be exactly the sdist's, both ways. It is installed in
  a clean environment and compared like the wheel lane, except that `direct_url.json` is expected
  there (a local wheel was installed) and must point inside the work directory.
- **Locks.** `consumers/python/<platform>/` holds `wheel.txt` (the wheel and its runtime
  dependencies), `sdist.txt` and `build.txt` (the build dependencies), all pinned with hashes, and
  `platform.json`. There is one directory per platform, chosen by the interpreter that runs:
  `cpython-3.12-darwin-arm64` and `cpython-3.12-linux-x86_64`. On any other interpreter or platform
  `locked` is refused as unsupported rather than attempted.

### Go (`go`)

The kit's `main.go`, byte for byte, with the committed `go.mod` and `go.sum` (`consumers/go`, no
`replace`), built with `-mod=readonly`, `GOPROXY=https://proxy.golang.org`, `GOSUMDB=sum.golang.org`,
`GOENV=off`, `GOWORK=off`. The module is first downloaded outside any module, so go checks it against
the checksum database. The tool computes `h1` itself over the files of the downloaded zip, compares the
zip with the directory go compiles from, and reads the build information of the binary: the module,
its version and `h1`, nothing replaced. The report records the architecture the go tool builds for,
which need not be the host's.

### Rust (`crates-default`, `crates-otlp`)

The kit's `src/main.rs`, byte for byte, in two consumers with their own `Cargo.toml` and `Cargo.lock`
(`consumers/rust-default`, `consumers/rust-otlp`), `CARGO_HOME` and target directory. The consumer's
`Cargo.toml` must be, line for line, the one manifest the tool expects. After `cargo fetch --locked`
the `.crate` is hashed and compared with the manifest and the lock before anything is compiled;
`cargo metadata` must say `dcp-ai` comes from crates.io, from a directory inside the work directory,
with the features of the lane; the `.crate` is compared both ways with that directory, apart from
cargo's own `.cargo-ok` marker; then `cargo build --locked`.

## `locked` and `fresh`

- `locked` (the default): third-party dependencies come from the committed locks. The selection is
  reproducible; the host's tools (npm, pip, Go, cargo, rustc, the C compiler, Chrome) are not pinned,
  only recorded.
- `fresh`: resolved now, as a new consumer would get them. The resulting locks are kept in the work
  directory: `package-lock.fresh.json` at its root, the others under `locks/`. In the sdist lane the
  build dependencies are then recorded but not pinned.

The six DCP identities are required in both modes.

## CI

`.github/workflows/release-validation.yml` runs the tool on `ubuntu-24.04`, manually
(`workflow_dispatch`) or on pull requests that change this tool or its conformance inputs. Pull requests
run the complete campaign (`all`, `locked`). It has read access to the repository, no secret and no
publishing step. Its manual inputs
are a lane (`all` or one lane) and the resolution. `ci.mjs` decides the result: PASS only for `all`
with exit 0; PARTIAL, reported as a diagnostic, only for one lane with exit 4; any other combination
fails the job. The work directory is uploaded as an artifact in every case.

## Updating for another release

This tool publishes nothing. After a release has been published and its identifiers recorded in the
audit dossier:

1. Put the new versions and identifiers in `manifest.json` and in the test that freezes them. A
   package's file names (`file`) and the inner crate version of `@dcp-ai/wasm` change with it.
2. Update the consumers: the versions in `consumers/npm/package.json`, `consumers/go/go.mod` and the two
   `Cargo.toml`, and the DCP lines of the Python locks.
3. Regenerate the locks with `--resolution fresh` on each platform that has one, and copy them from
   the work directory: `package-lock.fresh.json`, which is at its root, and `locks/python/<platform>/`,
   `locks/go/`, `locks/rust-default/` and `locks/rust-otlp/`. A Python lock is only produced by
   running on that platform.
4. If the kit's CLI suites or direct sections changed, update `expected-blocks.json`.
5. Run the tests, then the complete campaign in `locked` mode.

## Limits

- One campaign is one environment. What has been executed is in the guide; nothing else is claimed.
- The wrappers and the runner are the checkout's; the package under test is the registry's. Module
  resolution is not instrumented: the origin check is the lock, the installed tree and the path the
  wrapper reports.
- The Python locks cover two platforms. The hashes a lock holds say nothing about any other.
- The browser's version and user agent are recorded as the browser reports them. The user agent is a
  reduced one and does not say which architecture ran.
- Process cleanup reads the process table. A process detached by a parent that dies within one polling
  interval (250 ms) is not seen, nothing is cleaned if the tool itself is killed with SIGKILL, and if
  `ps` fails nothing is signalled and the report says the cleanup was not confirmed. A browser run
  stopped from outside leaves its temporary profile in the work directory.
- No proxy: the environment built for subprocesses has no proxy variable.
- The report contains absolute paths of the host, and no environment value other than the ones the
  tool built.
