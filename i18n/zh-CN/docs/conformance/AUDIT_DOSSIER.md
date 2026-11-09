<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · **中文** · [Español](../../../es/docs/conformance/AUDIT_DOSSIER.md) · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · [Português](../../../pt-BR/docs/conformance/AUDIT_DOSSIER.md)</sub>

<a id="audit-dossier"></a>

# 审计资料

> 本文是[英文版](../../../../docs/conformance/AUDIT_DOSSIER.md)的参考译文，更新于 09/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

这是对 DCP-AI 进行独立安全审查的入口。它说明要审查什么、如何复现仓库中的证据，以及这些证据能说明什么、不涵盖什么。它不是规范，不是认证，也不是审计报告：仓库中没有独立外部审计的报告，也不为仓库之外完成的工作提供认证。

- 规范性文本位于 [spec/](../../../../spec/README.md)。
- [安全覆盖图](SECURITY_COVERAGE.md)把每项要求对应到它的测试。
- [实现者指南](IMPLEMENTER_GUIDE.md)说明如何报告结果。

<a id="review-baseline"></a>

## 审查基准

- **源码基准：** `main` 上的提交 `45ac32f07f004e858e11dcc23ff72c3e5c7762b8`（05/11/2026，#123）。它包含[制品](#artifacts)中列出的所有修复，以及同日对 [VERIFICATION.md](../../../../spec/VERIFICATION.md) 步骤 V2-10 和 [DCP-09](../../../../spec/DCP-09.md) §3.5.2 的澄清。
- **之后的提交：** 授权书链的差分测试工具和五个 SDK 的 bundle 比较（#124）在基准之后加入，本资料也是如此。文档无法指明它自己的最终提交：请记录你审查的确切提交，并把本资料当作通往该提交的指引，而不是关于它的证据。
- **基准之外：** 容器镜像、部署和运营方配置。

<a id="pilot-validation-freeze-mp-06"></a>

## 试点验证冻结版（MP-06）

此后续快照与上述审查基线分开记录。**源码：**`7dd8293d6f6c3d328fc0ff3906978200e55139db`（PR #138）；树 `de40444aa1fc1bafef6ab7cf3b772664427b43dc`。这是面向限定范围试点的内部验证，不是外部审计、部署或新的注册表发布。`dcp-jcs-v1` 和现有默认值保持不变。

范围包括 TypeScript、Python、Go 和 Rust 的混合证据验证、对责任主体的显式信任、严格准入、可选启用的委托准入，以及独立的授权确认记录。WASM 通过已安装的浏览器 API 提供验证和基础能力；**不**支持授权链、准入或激活。Express 和 FastAPI 是可选适配器。操作授权、租户配置、撤销信息新鲜度、TLS 和密钥保管仍由应用或运营方负责。[运行限制](../OPERATIONAL_LIMITS.md)与[可选演练](../../../../tools/enterprise-rehearsal/README.md)说明了这一边界。

<a id="evidence-and-artifact-identity"></a>

### 证据与制品身份

[冻结修订的 CI](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42539293814)中选定的任务全部通过。因路径过滤而跳过的 SDK 和集成任务，复用已通过的 MP-03 修订 `df2df0de103777bb9e28cf70cc64d52f8df7d4b4` 的证据；生产代码子树及相关构建、测试输入完全相同。这些是复用的运行结果，不是新执行。本地安装的制品另行测试，包括 Python sdist 和浏览器中的 WASM tarball。每个完整 SDK 均通过八个公开目录；WASM 只通过其支持的六个目录。组合、确认记录、字节入口的专项测试，最初的 F1–F4 与责任主体信任回归测试，以及提供方证据，都保留与实际测试对象的对应关系。未改动的 MP-05 HTTP 演练（200/200 步）予以复用。

下列制品是**未发布的本地字节**，即使内部版本号与现有发布相同。TS、Express 和 Python 制品来自 `b3d41bd0`；其准备清单记录的全部 256 个源文件都与冻结修订一致。Go、Rust 和 WASM 从冻结导出构建。不要用版本号相同的注册表包替代它们。

| 制品 | 本地版本 | SHA-256 |
|---|---|---|
| `Go module zip` | `v2.13.0` | `a2e113c663b791c3b0908e135f2a1e2433ffea1301b1be2540a2fa3539c6ca41` |
| `Rust .crate` | `2.13.0` | `192d58c182e9c115b5fa7e6af17dd790eaa37a68a4501e4985dc11ae5b157d39` |
| `@dcp-ai/wasm tarball` | `2.1.3` | `501d24d7ae9a2923931edf4e9e8df902f353a87ff911906901f34b33d1ac052d` |
| `@dcp-ai/sdk tarball` | `2.3.0` | `1e4b27bb82c70ab327227f5bb029eb2b01b0cdc643aeec206327bdaf5a94dd9c` |
| `@dcp-ai/express tarball` | `2.1.0` | `bf2b6de539b9e3687ffd272c7015d9ff0a6288fdd65f86ce7662838b50ead969` |
| `Python wheel` | `2.10.2` | `e20473aecf6f75ff6e01db4a9ce12bd33ef59000607b9cba47f197b4b2e8d317` |
| `Python sdist` | `2.10.2` | `ad0e17c7850916777a5df379c6217e16eb1fcc82b2b465b53624c9eb985919fa` |


Go 通过不含 `replace` 的本地文件代理消费；Rust 通过指向已解压 `.crate` 的路径依赖消费；npm 和 Python 通过已安装包消费。Go 验证使用已修补的 1.26.10 工具链，未改变模块或依赖。试点应保留确切制品、依赖清单、命令和报告：哈希可以识别字节，却不会让临时制品变得可下载。重新构建后必须检查并重新测试；尚未确认 WASM 字节的可复现性。公开复现以[符合性套件](../../../../tools/conformance/README.md)和[演练说明](../../../../tools/enterprise-rehearsal/README.md)为起点，并明确修订及已安装包路径。本页概述内部证据，并不声称每个本地探针都是已发布的测试工具。

<a id="limits-and-remaining-release-work"></a>

### 限制与发布前剩余工作

- 冻结的 Express tarball 缺少 `LICENSE`，分发前须包含许可证。本地 WASM 二进制包含构建缓存路径；发布前须重映射路径并审查重建字节。此处不将这两项作为发布版本下载提供。
- 依赖审查是带日期的快照，而非保证。Rust 的可选 OTLP 依赖图选择了受 [RUSTSEC-2026-0190](https://osv.dev/vulnerability/RUSTSEC-2026-0190) 和 [RUSTSEC-2026-0386](https://osv.dev/vulnerability/RUSTSEC-2026-0386) 影响的 `anyhow`/`tokio` 版本；默认和 WASM 构建不选择这些 crate。本次冻结验证不覆盖 OTLP，使用前须另行修复相关依赖。
- CodeQL #58/#59 在符合性自测中仍未关闭；分诊发现的是固定语料的十六进制哈希插值，而非已经证明的远程生产攻击路径。Dependabot 未报告开放告警。secret scanning API 不可用；这是覆盖缺失，不代表零发现。
- 本资料此前的排除范围继续有效：尚未解决的规范矛盾、可选扩展、运营方基础设施和未经测试的环境，不会因本次冻结而成为受支持范围。有限测试不能证明不存在漏洞。
- 发布基线之后的变更前，仍需完成打包修复、新版本安排、从注册表安装的验证，并取得明确发布授权。镜像和部署需要各自验证。合并文档不会发布包。

> **注（09/11/2026）。** 上述各项描述的是 MP-06 快照及其本地制品，它们保持不变。对于 09/11/2026 发布的版本，WASM 路径重映射、CLI 的 `LICENSE` 和 OTLP 最低版本都已就位；参见[09/11/2026 的发布](#publication-of-09112026)。`@dcp-ai/express` 2.1.0 没有重新发布。

<a id="publication-of-09112026"></a>

## 09/11/2026 的发布

**来源：** `main` 上的 `cdb7099b8b6dc2a78b54928250752fd0bbd9c770`（[PR #140](https://github.com/dcp-ai-protocol/dcp-ai/pull/140)），树 `af69307b663381ce776ad3115f76fe82f225a789`，即候选版本经审查的导出所对应的树。[该提交的 CI](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42557635924) 已通过，重新构建并发布 [PyPI](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559171389) 和 [crates.io](https://github.com/dcp-ai-protocol/dcp-ai/actions/runs/42559174109) 文件的发布工作流也已成功；这些运行是项目自身的检查，不是外部审计。由此发布了六个版本：npm 上的 `@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0 和 `@dcp-ai/cli` 2.2.0，PyPI 上的 `dcp-ai` 2.11.0，crates.io 上的 Rust `dcp-ai` 2.14.0，以及 Go 模块 v2.14.0。这是内部验证之后的注册表发布，不是外部审计或认证。`@dcp-ai/express` 2.1.0 和其他 npm 适配器没有重新发布。

| 注册表 | 版本 | 标识符 |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.4.0 | `sha512-4IsY/ctFqLf5vvOS6bWUdN63NCbMoi6N0qnAceYG8AINnqm7+cRyG5stO+P4ZM8ROM2uyhI09AlcQDhdJVhIeQ==` |
| npm `@dcp-ai/wasm` | 2.2.0 | `sha512-eu9NiNXl99hCKz/xpUPteaZGF+ea0+WTQ/6mZu2RIkuP2eTMsym0Bbp7gTbqB1LaaGMGuRFYAjK8wSVIGt/AAA==` |
| npm `@dcp-ai/cli` | 2.2.0 | `sha512-/UR5K7/PctZX8Do6CULz1ua1eEwt19Jo/Q/adkMq806uRjZ2gh10W0FnfrzJVJPjskadK/tma2aXisU+z1Hx7Q==` |
| PyPI `dcp-ai` | 2.11.0 | wheel `2e7776e1c3675f9f4a3c088d6115b728d6e33c72c69a2e624b1771ab9fa45f53`，sdist `9d4a545376e2a9a0afa61b0845ef5bf992b9c92ac5390da95a35333327397da7`（SHA-256） |
| crates.io `dcp-ai` | 2.14.0 | `704028282d977973fc84e6fbaa495159e43ecec5951cf2f1b5ea9d3e70515424`（校验和） |
| Go 模块 `sdks/go/v2` | v2.14.0 | 标签 `sdks/go/v2.14.0`，提交 `cdb7099b8b6dc2a78b54928250752fd0bbd9c770`，`h1:9O4n7vn3YqOhKlyUg/cm0OnouQi4QbU7mHbIh1BM5Z8=` |

- **与测试过的制品一致。** npm tarball 就是发布前测试过的文件，`sha512` 完整性相同。PyPI 的 wheel 和 sdist 以及 crate 由发布工作流从 `main` 重新构建，包含与测试过的制品相同的源文件；Python 文件只在元数据上不同（Metadata-Version 2.5 和 hatchling 1.33.0，之前为 2.4 和 1.27.0，并重新计算了 RECORD），crate 增加了指向 `main` 的 `.cargo_vcs_info.json`。代理提供的 Go 模块与测试过的模块具有相同的 106 个文件和相同的 `h1`；只有 zip 压缩不同。
- **从注册表安装。** 全新的使用方按名称和版本安装了每个包，没有使用 `file:`、路径依赖、`replace`、`[patch]` 或 overrides：PyPI 的 wheel 和 sdist（sdist 由 pip 构建）、启用默认和 `otlp` feature 的 crate、与 `@dcp-ai/express` 2.1.0 一起安装的 npm SDK、CLI 和 WASM（解析到同一个 `@dcp-ai/sdk` 2.4.0），以及在启用校验和数据库的情况下用 Go 1.26.10 通过 `proxy.golang.org` 获取的 Go 模块。组合、确认、入口和 P-ED-1 检查、CLI 测试套件以及 WASM 检查的结果与在测试过的制品上相同。
- **MP-06 冻结中的打包事项。** 对于这些版本，WASM 二进制文件在构建时不含本地构建路径，并由发布门禁检查打包的文件；`@dcp-ai/cli` 包含 `LICENSE`；Rust 的 `otlp` feature 要求 `anyhow` 1.0.103 和 `tokio` 1.53.3 或更高版本，默认和 `wasm` 构建都不选择它们。添加到 `integrations/express` 的 `LICENSE` 仅存在于仓库中：已发布的 `@dcp-ai/express` 2.1.0 tarball 中仍然没有。
- **未覆盖。** 上述 MP-06 冻结以及[已知限制和排除项](#known-limits-and-exclusions)中的排除项仍然适用，但此处已为这些版本关闭的打包和依赖事项除外：WASM 构建路径、CLI 的 `LICENSE` 和 OTLP 最低版本。上述 MP-06 快照按记录时的样子保留。有限的检查不能证明不存在漏洞。

<a id="reproduce"></a>

## 复现

在所审查提交的检出目录中，使用 Node 22、Python 3.10+、Go（`sdks/go/go.mod` 中的版本）和稳定版 Rust 工具链（WASM 还需要 `wasm32-unknown-unknown` 和 wasm-pack）。安装在有已提交锁文件的地方使用锁文件。Python SDK 没有锁文件：`pip install -e ".[dev]"` 会解析安装时可用的版本。

在基准提交上：

```bash
(cd sdks/typescript && npm ci && npm run build && npm test) && npm ci --ignore-scripts
npm run conformance
(cd sdks/python && pip install -e ".[dev]" && pytest)
(cd sdks/go && go test ./...)
(cd sdks/rust && cargo test --locked)
(cd sdks/wasm && npm ci && npm run build && npm test)
node tools/conformance/wrappers/build.mjs all
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog delegation --report /tmp/delegation-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
```

仅自 #124 起（这些命令在基准中不存在）：

```bash
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
node tools/difffuzz/run-mandates.mjs --iterations 120 --report /tmp/mandates.json
```

- **通过说明什么。** 一次运行只说明这些用例在所运行的 argv 下通过。
- **WASM。** `sdks/wasm` 中的 `npm test` 只编译 TypeScript 层，并需要 `npm run build` 生成的 `pkg/dcp_ai_bg.wasm`。
- **其他命令。** [一致性工具包](../../../../tools/conformance/README.md)列出所有目录和包装器；[差分测试工具](../../../../tools/difffuzz/README.md)给出它的上限。
- **参考运行。** CI 在 `.github/workflows/ci.yml` 和 `difffuzz.yml` 中运行相同的测试套件。

<a id="record-what-you-ran"></a>

## 记录你运行了什么

- **源码。** 确切的提交（`git rev-parse HEAD`），以及工作树是否与之不同（`git status --porcelain`；如不同，附 `git diff`）。
- **工具链和制品。** 工具链版本，以及所运行制品的版本和哈希：TypeScript `dist`、构建的二进制文件、WASM 包，以及解析出的 Python 包（`python -m pip freeze`）。一致性工具包和差分测试工具会在报告中记录其中大部分。
- **报告。** 连同哈希一起保存报告文件。
- **来源。** 包装器在报告中声明的 `implementation` 名称和版本是包装器自己的声明，不是经过认证的来源。证据是你所构建并运行之物的哈希。

<a id="what-to-review"></a>

## 审查什么

| 层 | 路径 | 通过不能证明什么 |
|---|---|---|
| 协议核心和配置文件 | `spec/`、`schemas/`；规范化 `dcp-jcs-v1` | 规范性文本。`dcp-jcs-v2` 是实验性的、需显式启用，从不是默认值 |
| SDK 验证器 | `sdks/typescript`、`sdks/python`、`sdks/go`、`sdks/rust`、`sdks/wasm` | 已验证的 bundle 不等于委托人信任、准入或授权，它们是各自独立的 API（[ADMISSION.md](../../../../docs/ADMISSION.md)） |
| 一致性与差分工具 | `tools/conformance`、`tools/difffuzz`、`tests/` | 测试基础设施，不属于协议 |
| 参考服务 | `server/`、`services/`（锚定、透明日志、撤销） | 部署选择，不具规范性；验证器不依赖它们即可工作 |
| 适配器和项目脚手架 | `integrations/`、`packages/`、Python SDK 中的 FastAPI 集成 | 可选；部分已发布版本受影响（[SECURITY.md](../../../../SECURITY.md#supported-versions)） |
| 运营方 | 密钥、信任锚、准入配置、服务令牌、部署 | 仓库对这些不作任何保证 |

<a id="requirements-to-tests"></a>

## 要求与测试

| 领域 | 对应关系所在 |
|---|---|
| V2 验证，V2-1 至 V2-14 | [V2 验证图](SECURITY_COVERAGE.md#v2-verification-map)及其[模式边界](SECURITY_COVERAGE.md#schema-and-cryptographic-api-boundary) |
| 验证者策略，包括 V2-10 的澄清 | [验证者策略样例](SECURITY_COVERAGE.md#verifier-policy-samples) |
| 结构规则 | [结构样例](SECURITY_COVERAGE.md#structural-samples) |
| 准入与 `strict-v1` | [准入图](SECURITY_COVERAGE.md#admission-map) |
| DCP-09 授权书链 | [委托图](SECURITY_COVERAGE.md#delegation-map) |
| SDK 之间的一致 | [差分样例](SECURITY_COVERAGE.md#differential-samples) |
| 算法 | [tests/nist-kat](../../../../tests/nist-kat/README.md)：Ed25519 使用 RFC 8032 向量；ML-DSA-65 使用大小、往返、错误密钥和跨 SDK 测试，以及 204 个上下文为空的验证用例（NIST ACVP tc39 和 203 个 C2SP Wycheproof 用例，后者不是 NIST 来源），在四个 SDK 和 wasm32 上运行；ML-KEM-768 和 SLH-DSA-192f 使用 NIST ACVP 向量，并附源文件的 SHA-256。通过这些测试不等于密码模块的 NIST 验证 |

<a id="artifacts"></a>

## 制品

以下三者是不同的东西，不要把其中一个当作另一个来读：

| 制品 | 版本 | 包含 |
|---|---|---|
| 所审查的源码 | 基准处的 `main` | 下列所有修复 |
| 已发布（09/11/2026） | `@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0、`dcp-ai` 2.11.0（PyPI）、Go v2.14.0、Rust `dcp-ai` 2.14.0 | 下列所有 SDK 变更，以及 P-ED-1 和显式启用的委托准入 API（[09/11/2026 的发布](#publication-of-09112026)） |
| 已发布（05/11/2026） | `@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0、Rust `dcp-ai` 2.13.0 | 下列所有 SDK 更改 |
| 30/10/2026 准备（#114），从未发布，已被取代 | Go v2.12.0、Rust `dcp-ai` 2.12.0、`@dcp-ai/wasm` 2.1.2 | #106（WASM）、#107、#112；不含 #103 和 #116 至 #119 |
| 此前发布（28/10/2026） | `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`@dcp-ai/cli` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 | 26/10/2026 的验证器修复和 28/10/2026 的二级 SHA3-256 检查；不含下列任何修复 |

仅凭版本号无法确定制品。`main` 上的清单文件带有 09/11/2026 发布的版本号；30/10/2026 的候选版本针对较少的更改使用了 Go 和 Rust 2.12.0 以及 `@dcp-ai/wasm` 2.1.2，这些版本号不再使用。请使用下面的注册表标识符，或你所构建之物的哈希。对于 05/11/2026 的版本，npm tarball 就是发布前测试过的文件；PyPI 文件和 crate 是从 `main` 重新构建的，包含与测试过的制品相同的文件，唯一例外是 crate 的 `.cargo_vcs_info.json`，它指向 `main`。发布之后，于 05/11/2026 通过普通 TLS 再次读取了公开注册表：最新版本即上文所列，标识符如下：

| 注册表 | 版本 | 标识符 |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.3.0 | `sha512-5IsrDMKE3NM8e5jVLFIaigNFHIni/aIzD9Q4zNYZu6sTLfsPk/zqRxi9ccjtGSTiaftTba3LD/1JA4Gi0uS1bw==` |
| npm `@dcp-ai/wasm` | 2.1.3 | `sha512-ToL7ZE+8mEvKJCO5DXxJm+GS2nrQ2tInHYJn+cWqLWxT+eMss9ka9MVp30LNmopO+MTqgwBs1hmAy6TOI5wDIA==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.2 | wheel `825de9d6dce5ec2737d38534e7c3d357edbded437912605a549cde75518f198b`, sdist `6005f342a0a24bee331c30be2fb2bc89a1306a21de399051cd1cef3cc96297e4` (SHA-256) |
| crates.io `dcp-ai` | 2.13.0 | `579f070ad23c531147ef91287d610c6dc317bef997e2791a24a5070a4c0c13a1` (checksum) |
| Go module `sdks/go/v2` | v2.13.0 | tag `sdks/go/v2.13.0`, commit `46b142bd7e42601acd912f156bbfcd9f5204a4be` (05/11/2026), `h1:bRkqSUWHQ/qTywPmKWRdzg2bBWI0RG1ZZAlb6IafnyU=` |

28/10/2026 版本之后的 SDK 更改（于 05/11/2026 发布）：

| 更改 | 提交 | SDK | 发布 |
|---|---|---|---|
| `VerificationCache` 的键和隔离（#103） | `e711179a` | TypeScript | 已发布，05/11/2026 |
| WASM `dualMerkleRoot` 遵循 V2-11（#106） | `cac0a5f6` | Rust（`wasm` 特性）、WASM | 已发布，05/11/2026（30/10/2026 已准备） |
| `VerifyPayloadHash` 检查规范的带前缀哈希（#107） | `24e70d56` | Go | 已发布，05/11/2026（30/10/2026 已准备） |
| `RawAuditEventV2` 保留收到的审计条目（#112） | `6dc97d59` | Go、Rust | 已发布，05/11/2026（30/10/2026 已准备） |
| 每个 V2 验证器内部的 V2-2 模式校验（#116） | `0ebd2849` | TypeScript、Python、Go、Rust、WASM | 已发布，05/11/2026 |
| 统一的授权书有效性辅助函数（#117） | `614b1c56` | TypeScript、Python、Go、Rust | 已发布，05/11/2026 |
| 统一的授权书链时间检查（#118） | `7619ff95` | TypeScript、Python、Go、Rust | 已发布，05/11/2026 |
| 拒绝单个根授权书中重复的域（#119） | `c154192f` | TypeScript、Python、Go、Rust | 已发布，05/11/2026 |

28/10/2026 版本之后的其他更改：

- **参考透明日志。** #120（`c59ce5ba`）把 gossip 告警绑定到所见证日志的身份；#122（`d45c5a7b`）轮询运行时加入的对等节点。该服务不以软件包形式分发。
- **规范和一致性工具包。** #121（`0dcbd8dc`）加入委托目录。#123（`45ac32f0`）加入 V2-10 和 DCP-09 §3.5.2 的澄清、策略目录 2.0 和委托目录 2.0.0；没有 SDK 更改。
- **注册表用户。** 上表中的 SDK 更改随 05/11/2026 的版本到达用户；更早的版本保留此处列出的限制。透明日志、规范和一致性套件不属于这些软件包，需从仓库使用。

<a id="known-limits-and-exclusions"></a>

## 已知限制与排除项

- **审计记录。** [AUDIT-v2.0-FINAL.md](../../../../spec/AUDIT-v2.0-FINAL.md) 是日期为 26/02/2026 的内部历史记录，附有当前的背景说明；它不是外部审计。
- **没有 HSM 提供者。** 模拟的 `HsmCryptoProvider` 已于 06/11/2026 从 TypeScript 源码中移除；没有任何 SDK 提供 HSM 提供者，参考服务器声明 `hsm_provider: false`，`dcp audit gaps` 始终把第 11 号缺口报告为未关闭（[NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)）。
- **密钥恢复。** 份额不使用混合 KEM 加密。
- **参考服务器。** 它检查公告签名的结构，而不是签名本身（[server/README.md](../../../../server/README.md)）。
- **WASM。** 不提供授权书链验证。
- **Rust。** 缺少 A2A 的 AES-256-GCM 会话加密及其重放窗口（[RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)）。
- **05/11/2026 之前发布的版本。** 不包含[制品](#artifacts)中列出的更改。
- **09/11/2026 之前发布的版本。** 不包含 P-ED-1（Python SDK 所用的官方 PyNaCl 构建原本就拒绝这些签名的情况除外），也不包含显式启用的委托准入 API。
- **差分和模糊测试活动。** 它们是有限的，并非穷尽；契约 `/4` 无法传给所有 SDK 的输入另行测量（[差分测试工具](../../../../tools/difffuzz/README.md#mandate-chains)）。
- **性能。** 未检查任何速度要求；[性能基准](../../../../tools/conformance/README.md#performance-baseline)和[有界工作负载的规模变化](../../../../tools/conformance/README.md#bounded-workload-scaling)是在基准提交之后加入的、关于方法的本地测量；两者都不是审计结果。
- **未涵盖。** 容器镜像、部署、服务令牌和运营方配置。

<a id="reporting"></a>

## 报告

请按照 [SECURITY.md](../../../../SECURITY.md) 的说明报告安全问题。其中列出联系方式、范围（包括有上限的本地资源耗尽复现）和奖励政策：奖励逐案决定，没有保证的或固定的金额。
