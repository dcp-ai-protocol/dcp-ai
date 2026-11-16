<sub>[English](../../../../docs/conformance/RELEASE_VALIDATION.md) · **中文** · [Español](../../../es/docs/conformance/RELEASE_VALIDATION.md) · [日本語](../../../ja/docs/conformance/RELEASE_VALIDATION.md) · [Português](../../../pt-BR/docs/conformance/RELEASE_VALIDATION.md)</sub>

<a id="release-validation"></a>

# 发布验证

> 本文是[英文版](../../../../docs/conformance/RELEASE_VALIDATION.md)的参考译文，更新于 10/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

一次发布完成之后，[`tools/release-validation`](../../../../tools/release-validation/README.md) 会像一个新的消费者那样，从官方注册表安装已发布的包，并针对安装结果运行外部一致性目录。本页说明这能证明什么、到目前为止运行了什么，以及它不涵盖什么。如何运行该工具，请参阅它的 README。

<a id="what-it-covers"></a>

## 涵盖范围

09/11/2026 发布的六个版本（[审计档案](../../../../docs/conformance/AUDIT_DOSSIER.md#publication-of-09112026)），通过九条通道进行验证：

| 已发布的版本 | 通道 |
|---|---|
| npm `@dcp-ai/sdk` 2.4.0 | `npm-sdk` |
| npm `@dcp-ai/wasm` 2.2.0 | `npm-wasm-node`（Node）和 `npm-wasm-browser`（真实的 Chrome） |
| npm `@dcp-ai/cli` 2.2.0 | `npm-cli` |
| PyPI `dcp-ai` 2.11.0 | `pypi-wheel`（wheel）和 `pypi-sdist`（从源码构建的 sdist） |
| Go 模块 `sdks/go/v2` v2.14.0 | `go` |
| crates.io `dcp-ai` 2.14.0 | `crates-default` 和 `crates-otlp`（启用 `otlp` feature） |

每条通道都把它的包安装到一个临时目录中，并使用专门为它构建的环境；先检查下载的字节就是已发布的字节，以及安装或编译所用的正是这些字节，然后才运行以下证据：

- **60 个目录单元。** [一致性工具包](../../../../tools/conformance/README.md)的八个外部目录在六条通道上运行（SDK、两条 Python 通道、Go 和两条 Rust 通道），适用于 WebAssembly API 的六个目录在它的两条通道上运行。CLI 通道没有目录。按本修订版的目录计算，共 6142 个用例。
- 浏览器中公开 API `DcpWasm` 的 **103 个直接用例**。
- 针对已安装 CLI 的 **四个 CLI 套件**（218 个测试），以及它们的阴性对照。
- 同一次运行中的 **58 个对照**。其中一些是必须通过的阳性对照；其余的是对真实报告做了改动的副本、反转的预期、注入的故障、超时和本地来源，每一个都必须按照对它要求的方式被拒绝。

本工具不增加任何自己的目录或预期。预期来自工具包，并已提交在本仓库中。

<a id="what-a-result-means"></a>

## 结果的含义

- **PASS** 要求上述全部内容在一次运行中完成。它说明：这些制品，带有这些哈希，取自这些注册表，在本修订版的工具包和本环境下通过了这些目录。它不是认证，对未运行过的环境不作任何说明。
- **PARTIAL** 是没有失败的部分通道或目录的选择。它只是诊断，绝不会被报告为通过。
- **不一致**表示已安装的制品给出了回答，但与已提交的预期不符。
- **错误**表示没有可供判定的有效回答：原因可能是注册表、网络、工具链、不匹配的身份、不完整的报告或不属于本次运行的报告。错误绝不会被算作协议的拒绝，也绝不会被算作通过。

安装一个包并证明它来自何处并不是一致性。只有目录单元和区块才是关于行为的证据。

本工具不改变协议中的任何内容：规范化配置 `dcp-jcs-v1`、核心、各 SDK 和各目录都按原样使用。

<a id="what-has-been-run"></a>

## 已运行的内容

10/11/2026，在一份只包含公开文件的仓库副本上运行了一次完整的验证：

| 项目 | 观测结果 |
|---|---|
| 结果 | PASS：60 个单元（6142 个用例全部通过）、103 个直接用例、218 个 CLI 测试、阴性对照、58 个对照 |
| 模式 | `locked`（已提交的锁文件） |
| 主机 | Apple silicon（arm64）上的 macOS，Node 22.15.0，npm 11.3.0 |
| Python | CPython 3.12.2，arm64 |
| Go | go1.26.10，在这台主机上的构建目标是 `darwin/amd64`：经过验证的 Go 二进制文件是 amd64 |
| Rust | cargo 和 rustc 1.93.1，aarch64 |
| 浏览器 | Google Chrome 157.0.8103.50。它的 user agent 是精简过的，不能说明实际运行的是哪种架构 |
| 报告 | 运行 `dfeaa975-f449-4947-8238-32bb3f372d87`，`report.json` 的 SHA-256 为 `2b5c4c109b76038c693c73ab6485a3a3634949790fd57648637deaf9a23b7ee7` |

报告及其文件由维护者保存，不在仓库中。

另外还运行过以下内容，但它不是一次完整的验证：在 Linux x86_64 容器（Ubuntu 24.04，CPython 3.12.3，在同一台主机上模拟运行）中，以 `fresh` 和 `locked` 两种模式对两条 Python 通道运行了第一个目录。Linux 的锁文件即来源于此。

**GitHub 上的完整验证已通过。** 10/11/2026（America/Santiago），工作流在 GitHub 的 Ubuntu 24.04 x86_64 运行器上以 `locked` 模式运行了全部九条通道。独立核对保存的证据后，确认全部 60 个单元（6142 个用例）、103 个浏览器直接用例、218 个 CLI 测试、要求恰好四个失败的阴性对照以及 58 个对照均通过；工具测试也全部通过，37/37，无跳过。

| 项目 | 观测结果 |
|---|---|
| GitHub | [Release validation #42936377966](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42936377966) |
| Run | `29adf7d3-14a9-4ad8-b57b-d3f3e5bcc628` |
| UTC | `2026-11-11T01:06:03.656Z` – `2026-11-11T01:12:52.962Z` |
| Node / npm | 22.23.4 / 10.9.9 |
| Python / pip | CPython 3.12.16 x86_64 / 25.0.1 |
| Go | 1.26.10 linux/amd64 |
| Rust | cargo / rustc 1.99.1, x86_64-unknown-linux-gnu |
| Chrome | Google Chrome 156.0.8078.79 |
| `report.json` SHA-256 | `d0b5da90f06b204ae46677a8fbaeb54d6f3b1620c204f8aea2d33a7efedac84f` |

工作流在相关 PR 中运行，也支持手动运行；仅有仓库读取权限，没有发布步骤。制品保留 30 天。独立重新计算了下载文件的哈希，其源文件树摘要与 `--clean` 删除消费者之前记录的已安装文件树检查结果一致；这不表示再次直接检查了已经删除的文件。

<a id="running-it"></a>

## 如何运行

```bash
node --test tools/release-validation/release-validation.test.mjs
node tools/release-validation/run.mjs --python "/path/to/python3.12" --go "/path/to/go" --cargo "$(rustup which cargo)"
```

第一条命令不使用外部网络（其中一个测试通过环回地址上的 HTTP 服务器提供索引）。第二条命令会从 npm、PyPI、Go 代理和 crates.io 下载，并且需要 Chrome。`--lane` 和 `--catalog` 可以只选择其中一部分，此时结果为 PARTIAL。在 CI 中，请手动启动 *Release validation* 工作流。要求、选项和报告的结构见[该工具的 README](../../../../tools/release-validation/README.md)。

第三方依赖项取自已提交的锁文件（`locked`，默认），或者在运行时当场解析（`fresh`）。Python 锁文件适用于 macOS arm64 和 Linux x86_64 上的 CPython 3.12；在任何其他解释器或平台上，Python 通道需要使用 `fresh`。

<a id="not-covered"></a>

## 不涵盖的内容

- 上述六个版本之外的任何版本，以及任何未发布到这些注册表的内容：框架集成、Docker 镜像、项目模板、服务和合约。
- 未运行过的操作系统、架构、解释器和浏览器。具体来说：没有 Windows，没有 arm64 的 Go 二进制文件，没有 Chrome 之外的浏览器。
- 主机自身的工具。npm、pip、Go、cargo、rustc、C 编译器和 Chrome 都按主机上现有的版本使用并加以记录，不作固定。
- 目录本身不涵盖的性质。它们的限制见[一致性工具包](../../../../tools/conformance/README.md)和[审计档案](../../../../docs/conformance/AUDIT_DOSSIER.md#known-limits-and-exclusions)。
