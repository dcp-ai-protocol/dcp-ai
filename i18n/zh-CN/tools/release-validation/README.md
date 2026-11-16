<sub>[English](../../../../tools/release-validation/README.md) · **中文** · [Español](../../../es/tools/release-validation/README.md) · [日本語](../../../ja/tools/release-validation/README.md) · [Português](../../../pt-BR/tools/release-validation/README.md)</sub>

<a id="release-validation"></a>

# 发布验证

> 本文是[英文版](../../../../tools/release-validation/README.md)的参考译文，更新于 10/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

从官方注册表把已发布的 DCP 包安装到临时消费者中，检查它们的身份和来源，然后针对安装结果运行现有的外部一致性工具包（[`tools/conformance`](../../../../tools/conformance/README.md)）。本工具不增加任何目录、判定依据或一致性模型。面向读者的指南是 [docs/conformance/RELEASE_VALIDATION.md](../../../../docs/conformance/RELEASE_VALIDATION.md)；本文件是运行和维护该工具的参考。

PASS 只说明一件事：这些制品，带有这些哈希，取自这些注册表，在本修订版的工具包和本环境下通过了这些目录。它不是认证，也不涵盖任何未执行的内容。

```
node tools/release-validation/run.mjs [--list] [--lane <id>]... [--catalog <id>]...
                                      [--resolution locked|fresh] [--work <dir>] [--clean]
                                      [--python <exe>] [--go <exe>] [--cargo <exe>] [--chrome <exe>]
node --test tools/release-validation/release-validation.test.mjs     # no external network
```

| 退出码 | 含义 |
|---|---|
| 0 | PASS：所有通道、所有目录单元（60 个）、所有区块（3 个）、所有对照 |
| 1 | 不一致：制品给出了回答，但与已提交的预期不符 |
| 2 | 用法错误 |
| 3 | 错误：基础设施、身份、不支持、不完整或实现 |
| 4 | PARTIAL：没有失败的部分选择。只是诊断，绝不是验证 |

错误绝不会被算作拒绝，并且错误优先于不一致。安装一个包并证明其来源并不是一致性：只有单元和区块才是。

测试不使用外部网络；其中一个测试通过环回地址上的 HTTP 服务器提供包索引。

<a id="requirements"></a>

## 要求

POSIX 主机上的 Node 20 或更高版本，并需要与 `node` 位于同一目录的 `npm`、`/bin/ps`、`/usr/bin/tar`，以及 Go 通道所需的 `/usr/bin/unzip`。只使用 Node 内置模块。

Python、Go、Rust 和 Chrome 是主机上的工具：使用 `--python`、`--go`、`--cargo` 或 `--chrome` 给出的路径，或者工具自身 `PATH`（`node` 所在目录、`/usr/bin`、`/bin`）中找到的第一个 `python3`、`go` 或 `cargo`，以及该平台上通常位置的 Chrome。不会安装、更新或切换任何东西：设置了 `GOTOOLCHAIN=local`，并且拒绝 rustup 代理，因此请传入工具链自身的 cargo（`rustup which cargo`），其旁边必须有 `rustc`。Python 必须是 3.11 或更高版本（`fresh` 模式的 sdist 通道用 `tomllib` 读取 `pyproject.toml`）；已提交的锁文件针对 CPython 3.12。

<a id="lanes"></a>

## 通道

| 通道 | 已发布的制品 | 证据 |
|---|---|---|
| `npm-sdk` | npm `@dcp-ai/sdk` 2.4.0 | 8 个目录 |
| `npm-wasm-node` | npm `@dcp-ai/wasm` 2.2.0，在 Node 中 | 6 个目录 |
| `npm-wasm-browser` | 同一个包，在真实 Chrome 中的公开 API | 6 个目录和区块 `direct-sections`（103 个用例） |
| `npm-cli` | npm `@dcp-ai/cli` 2.2.0 | 没有目录：区块 `cli-suites`（218 个测试）和 `cli-negative-control` |
| `pypi-wheel` | PyPI `dcp-ai` 2.11.0，wheel | 8 个目录 |
| `pypi-sdist` | PyPI `dcp-ai` 2.11.0，sdist，在此构建 | 8 个目录 |
| `go` | Go 模块 `sdks/go/v2` v2.14.0 | 8 个目录 |
| `crates-default` | crates.io `dcp-ai` 2.14.0，默认 feature | 8 个目录 |
| `crates-otlp` | 同一个 crate，启用 `otlp` feature | 8 个目录 |

六个已发布版本、九条通道。六条通道各运行 8 个目录，两条 WebAssembly 通道各运行 6 个目录：共 60 个目录单元，另加 3 个区块。`manifest.json` 保存预期的身份（即审计档案中的身份）、目录和通道；`expected-blocks.json` 保存每个区块必须报告的标识符。

<a id="what-a-run-does"></a>

## 一次运行做什么

1. **工作目录。** 一个新的 `mkdtemp` 目录，或者 `--work <dir>`；后者必须尚不存在，并且必须位于检出之外。不重复使用任何东西。
2. **环境。** 每个子进程都得到由工具构建的环境。`HOME`、`TMPDIR`、各种缓存以及每个包管理器的设置都位于工作目录内。`PATH` 不在其内：它是工具自己的一份简短的主机目录列表（`node` 所在目录、`/usr/bin`、`/bin`，以及通过选项给出的工具链所在目录）。不继承任何东西：没有凭据，没有代理，没有用户或项目的配置。
3. **安装、身份和来源**，按生态系统分别进行（见下文）。每个包都必须有三个值一致：清单中的值、工具根据下载的字节计算出的哈希，以及包管理器或注册表记录的值。下载的归档必须与安装或编译所用的内容逐个文件、双向一致，只有安装程序自己写入的少数文件除外，这些文件在下文列出。
4. **单元。** 每条通道的每个目录运行一次工具包的运行器，并让工具包自己的包装器指向已安装的包。报告只有属于本次执行才算数：路径此前不存在；运行发生在观测到的时间区间内，并带有此前未见过的标识符；argv、`kit.catalog_sha256`、测试夹具哈希、套件和用例标识符与所请求的一致；状态与运行器的退出码相符。每个用例的状态必须是其类别所允许的，每个套件和整份报告的计数（包括 `executed`）必须与用例实际情况一致。
5. **区块。** 不属于目录单元的证据（CLI 套件、其阴性对照、浏览器直接测试部分）是其所在通道的区块。与单元一样，一次完整验证要求每个区块恰好出现一次：通道的安装结果或状态绝不能代替它。
6. **对照**，在同一次执行中进行。每条带有对照的通道（`npm-sdk`、`npm-cli`、`npm-wasm-browser`）只要被选中，就必须给出自己固定的一组对照：每个标识符恰好有一个 `ok === true` 的结果，且没有其他结果，否则整次验证就是错误。其中一些是必须通过的阳性对照。其余的是对真实输出做了改动的副本（结果缺失、重复和未知，陈旧的报告，不一致的计数，被改动的身份和本地来源）以及真实的运行（一个必须失败的反转预期、包装器和测试装置的故障、超时、遗留的进程、被外部停止的浏览器运行），每一个都必须按照对它要求的方式被拒绝。
7. **报告。** 工作目录中的 `report.json`，以及运行器的报告、区块的输出、日志、归档和锁文件。全部保留；`--clean` 只删除本次执行所安装的消费者和缓存。

只有当对一个进程的所有观测都正常时（没有信号、没有超过期限、没有触及输出上限、没有遗留任何东西），该进程才算运行完成；仅有退出码 0 是不够的。每个阶段都有期限，监督程序会停止整个进程树，无论其中有哪些进程组。

<a id="npm-npm-sdk-npm-wasm-node-npm-wasm-browser-npm-cli"></a>

### npm（`npm-sdk`、`npm-wasm-node`、`npm-wasm-browser`、`npm-cli`）

使用一个消费者（`consumers/npm`），其中三个包都指定精确版本，并带有锁文件。先对消费者和锁文件做静态检查（精确版本、每个条目都来自 `registry.npmjs.org` 并带有 sha512 完整性值、没有链接、每个 DCP 包只出现一次）；然后在空缓存中执行 `npm pack`，由工具计算哈希；再执行 `npm ci --ignore-scripts`（`locked`）或 `npm install --ignore-scripts`（`fresh`）；最后把归档与已安装的文件树进行比较。

`@dcp-ai/wasm` 2.2.0 包含 `pkg/package.json`，其中记录了它编译自的 Rust crate 的名称和版本（`dcp-ai` 2.14.0）。报告会同时记录这两个身份，并且从不期望它们相同。

- **`npm-cli`。** `cli/__tests__` 的四个套件和工具包的 `negative-control.mjs` 针对已安装的 CLI（`DCP_CLI_ROOT`）运行：使用它的二进制文件、它的 `lib/`，以及 npm 为它安装的依赖项。工具会先检查已安装的 CLI 将加载的是那个唯一经过验证的 `@dcp-ai/sdk`。阴性对照自己给出的结论不会被直接采信：它的输出必须表明，恰好是那四个被反转的用例失败，每个都失败于断言，而其余 214 个通过。
- **`npm-wasm-browser`。** 工具包的 `wasm-browser.mjs` 在带有临时配置文件的真实 Chrome 中驱动公开 API `DcpWasm`。它提供的文件被固定到一份 `SHA256SUMS` 上，该文件由工具根据已安装的文件树写出。每个单元和直接测试部分都必须附带包装器自己为该次运行写出的浏览器记录：它是新的，带有该次运行的标识符，位于观测到的时间区间内，提供的是已安装的文件，并且浏览器作出了回答、已经退出、其配置文件已被删除。

<a id="python-pypi-wheel-pypi-sdist"></a>

### Python（`pypi-wheel`、`pypi-sdist`）

每条通道都有自己的虚拟环境。Python 以 `-I -B` 运行；pip 以 `--isolated` 运行，不使用缓存，不使用配置文件，并以 `https://pypi.org/simple/` 作为唯一的索引。

- **Wheel。** 执行 `pip download`；在安装任何东西之前先检查 SHA-256；然后执行 `pip install --only-binary :all:`；pip 自己的报告给出它所安装内容的哈希，并表明每个文件都来自 `files.pythonhosted.org`。wheel 与已安装的发行版进行双向比较：每个模块文件都必须相同，并且不得安装任何其他内容。只有 pip 自己在 `*.dist-info` 中写入的文件不参与比较：`RECORD`（被重写）、`INSTALLER` 和 `REQUESTED`；在这里出现 `direct_url.json` 则视为问题。比较文件树时不存在字节码（`--no-compile`、`-B`）。`import dcp_ai` 必须从该 site-packages 加载，不启用 user site，也不包含工作目录和解释器之外的任何路径。
- **Sdist。** 文件先由 `fetch-pypi.mjs` 作为字节下载，该脚本不解包也不运行任何东西；然后把它的 SHA-256 与清单比较；索引为该文件声明的值另行记录，不予采信。只有在此之后才解包、安装构建依赖项，并使用 `--no-index --no-build-isolation` 从本地文件构建 wheel。构建出的 wheel 在报告中是一个单独的制品；它的模块文件必须与 sdist 的模块文件完全一致，双向皆然。它被安装到一个干净的环境中，并按 wheel 通道的方式比较，不同之处在于：这里应当存在 `direct_url.json`（因为安装的是本地 wheel），并且它必须指向工作目录内部。
- **锁文件。** `consumers/python/<platform>/` 中有 `wheel.txt`（wheel 及其运行时依赖项）、`sdist.txt` 和 `build.txt`（构建依赖项），全部用哈希固定，另有 `platform.json`。每个平台一个目录，由实际运行的解释器选择：`cpython-3.12-darwin-arm64` 和 `cpython-3.12-linux-x86_64`。在任何其他解释器或平台上，`locked` 会被作为不支持而拒绝，而不会去尝试。

<a id="go-go"></a>

### Go（`go`）

逐字节使用工具包的 `main.go`，配合已提交的 `go.mod` 和 `go.sum`（`consumers/go`，没有 `replace`），以 `-mod=readonly`、`GOPROXY=https://proxy.golang.org`、`GOSUMDB=sum.golang.org`、`GOENV=off`、`GOWORK=off` 构建。模块先在任何模块之外下载，因此 go 会对照校验和数据库检查它。工具自己根据下载的 zip 中的文件计算 `h1`，把 zip 与 go 编译时使用的目录进行比较，并读取二进制文件的构建信息：模块、其版本和 `h1`，且没有任何替换。报告会记录 go 工具的构建目标架构，它不一定与主机的架构相同。

<a id="rust-crates-default-crates-otlp"></a>

### Rust（`crates-default`、`crates-otlp`）

逐字节使用工具包的 `src/main.rs`，在两个消费者中构建，它们各有自己的 `Cargo.toml` 和 `Cargo.lock`（`consumers/rust-default`、`consumers/rust-otlp`）、`CARGO_HOME` 和 target 目录。消费者的 `Cargo.toml` 必须逐行等于工具所期望的那一份清单。执行 `cargo fetch --locked` 之后，在编译任何东西之前，先计算 `.crate` 的哈希，并与清单和锁文件比较；`cargo metadata` 必须表明 `dcp-ai` 来自 crates.io，位于工作目录内的某个目录中，并带有该通道的 feature；`.crate` 与该目录进行双向比较，只有 cargo 自己的标记文件 `.cargo-ok` 除外；然后执行 `cargo build --locked`。

<a id="locked-and-fresh"></a>

## `locked` 和 `fresh`

- `locked`（默认）：第三方依赖项取自已提交的锁文件。依赖项的选择是可重现的；主机上的工具（npm、pip、Go、cargo、rustc、C 编译器、Chrome）不被固定，只被记录。
- `fresh`：当场解析，就像一个新的消费者会得到的那样。得到的锁文件保存在工作目录中：`package-lock.fresh.json` 位于其根目录，其余的位于 `locks/` 之下。此时在 sdist 通道中，构建依赖项会被记录，但不被固定。

两种模式都要求六个 DCP 身份。

## CI

`.github/workflows/release-validation.yml` 在 `ubuntu-24.04` 上运行该工具，可以手动触发（`workflow_dispatch`），也会在修改此工具或一致性工具包输入的 PR 中运行。PR 运行完整验证（`all`、`locked`）。它只有对仓库的读取权限，不使用任何机密，也没有任何发布步骤。它的输入是通道（`all` 或某一条通道）和解析模式。结果由 `ci.mjs` 决定：只有 `all` 且退出码为 0 才是 PASS；只有单条通道且退出码为 4 才是作为诊断报告的 PARTIAL；任何其他组合都会使作业失败。无论哪种情况，工作目录都会作为制品上传。

<a id="updating-for-another-release"></a>

## 为另一次发布进行更新

本工具不发布任何东西。在一次发布完成、其标识符已记录到审计档案之后：

1. 把新的版本和标识符填入 `manifest.json` 以及固定这些值的测试中。包的文件名（`file`）和 `@dcp-ai/wasm` 内部 crate 的版本也随之改变。
2. 更新消费者：`consumers/npm/package.json`、`consumers/go/go.mod` 和两份 `Cargo.toml` 中的版本，以及 Python 锁文件中的 DCP 行。
3. 在每个有锁文件的平台上用 `--resolution fresh` 重新生成锁文件，并从工作目录中复制出来：位于其根目录的 `package-lock.fresh.json`，以及 `locks/python/<platform>/`、`locks/go/`、`locks/rust-default/` 和 `locks/rust-otlp/`。Python 锁文件只能通过在该平台上运行来生成。
4. 如果工具包的 CLI 套件或直接测试部分有变化，更新 `expected-blocks.json`。
5. 运行测试，然后以 `locked` 模式运行完整的验证。

<a id="limits"></a>

## 限制

- 一次完整验证对应一个环境。已执行的内容记录在指南中；除此之外不作任何声明。
- 包装器和运行器来自检出；被测的包来自注册表。模块解析没有被插桩：来源检查依据的是锁文件、已安装的文件树以及包装器报告的路径。
- Python 锁文件覆盖两个平台。一份锁文件中的哈希对任何其他平台都不说明任何问题。
- 浏览器的版本和 user agent 按浏览器报告的内容记录。user agent 是精简过的，不能说明实际运行的是哪种架构。
- 进程清理依靠读取进程表。如果父进程在一个轮询间隔（250 ms）内退出，被它分离出去的进程不会被看到；如果工具本身被 SIGKILL 杀死，则不会清理任何东西；如果 `ps` 失败，则不发送任何信号，报告会说明清理未得到确认。被外部停止的浏览器运行会把它的临时配置文件留在工作目录中。
- 没有代理：为子进程构建的环境中没有任何代理变量。
- 报告包含主机的绝对路径，除工具自己构建的环境值之外，不包含任何其他环境值。
