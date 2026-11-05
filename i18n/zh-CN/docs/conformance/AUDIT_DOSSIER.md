<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · **中文** · [Español](../../../es/docs/conformance/AUDIT_DOSSIER.md) · [日本語](../../../ja/docs/conformance/AUDIT_DOSSIER.md) · [Português](../../../pt-BR/docs/conformance/AUDIT_DOSSIER.md)</sub>

<a id="audit-dossier"></a>

# 审计资料

> 本文是[英文版](../../../../docs/conformance/AUDIT_DOSSIER.md)的参考译文，更新于 05/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

这是对 DCP-AI 进行独立安全审查的入口。它说明要审查什么、如何复现仓库中的证据，以及这些证据能说明什么、不涵盖什么。它不是规范，不是认证，也不是审计报告：仓库中没有独立外部审计的报告，也不为仓库之外完成的工作提供认证。

- 规范性文本位于 [spec/](../../../../spec/README.md)。
- [安全覆盖图](SECURITY_COVERAGE.md)把每项要求对应到它的测试。
- [实现者指南](IMPLEMENTER_GUIDE.md)说明如何报告结果。

<a id="review-baseline"></a>

## 审查基准

- **源码基准：** `main` 上的提交 `45ac32f07f004e858e11dcc23ff72c3e5c7762b8`（05/11/2026，#123）。它包含[制品](#artifacts)中列出的所有修复，以及同日对 [VERIFICATION.md](../../../../spec/VERIFICATION.md) 步骤 V2-10 和 [DCP-09](../../../../spec/DCP-09.md) §3.5.2 的澄清。
- **之后的提交：** 授权书链的差分测试工具和五个 SDK 的 bundle 比较（#124）在基准之后加入，本资料也是如此。文档无法指明它自己的最终提交：请记录你审查的确切提交，并把本资料当作通往该提交的指引，而不是关于它的证据。
- **基准之外：** 容器镜像、部署和运营方配置。

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
| 算法 | [tests/nist-kat](../../../../tests/nist-kat/README.md)：Ed25519 使用 RFC 8032 向量；ML-DSA-65 使用大小、往返、错误密钥和跨 SDK 测试；ML-KEM-768 和 SLH-DSA-192f 使用 NIST ACVP 向量，并附源文件的 SHA-256。通过这些测试不等于密码模块的 NIST 验证 |

<a id="artifacts"></a>

## 制品

以下三者是不同的东西，不要把其中一个当作另一个来读：

| 制品 | 版本 | 包含 |
|---|---|---|
| 所审查的源码 | 基准处的 `main` | 下列所有修复 |
| 已准备、未发布（05/11/2026） | `@dcp-ai/sdk` 2.3.0、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0、Rust `dcp-ai` 2.13.0、`@dcp-ai/wasm` 2.1.3 | 下列所有 SDK 更改 |
| 30/10/2026 准备（#114），从未发布，已被取代 | Go v2.12.0、Rust `dcp-ai` 2.12.0、`@dcp-ai/wasm` 2.1.2 | #106（WASM）、#107、#112；不含 #103 和 #116 至 #119 |
| 已发布 | `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`@dcp-ai/cli` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 | 26/10/2026 的验证器修复和 28/10/2026 的二级 SHA3-256 检查；不含下列任何修复 |

仅凭版本号无法确定制品。`main` 上的清单文件带有 05/11/2026 候选版本的版本号，任何注册表中都没有这些版本；30/10/2026 的候选版本针对较少的更改使用了 Go 和 Rust 2.12.0 以及 `@dcp-ai/wasm` 2.1.2，这些版本号不再使用。请使用下面的注册表标识符，或你所构建之物的哈希。发布会重新构建软件包，因此发布的内容必须与经审查的候选版本比较，或重新测试。公开注册表于 05/11/2026 通过普通 TLS 读取，未发布任何内容；最新版本即上文所列：

| 注册表 | 版本 | 标识符 |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.2.1 | `sha512-HsT/4BMomZ2QVDfxLWhejoZDzSo8OH8cLT6i6fBTAejt078SyTJRKoLVeIgZp0G29I5JIyoeOPfhebfa7+W9Lw==` |
| npm `@dcp-ai/wasm` | 2.1.1 | `sha512-YUFEAMBnT0J0hZvg1MUS1yvXV0HPotijoj32kIhGDoMVaBhqZKTZvE8iV5h90WRv4duRzJav+PtlQ4fl3NcyQQ==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.1 | wheel `30a1e35bc275b20118ec3e786f3c58336fd72bd21849995bc44ac2e702400a9c`, sdist `e254091491867f122deaff6d6ccc6db6f021d721ff30b1182a4944902b8f2fc5` (SHA-256) |
| crates.io `dcp-ai` | 2.11.1 | `dfb8440a50351491fd7aa81cb5585d8d4f7c130986e504210175b62251f1bc73` (checksum) |
| Go module `sdks/go/v2` | v2.11.1 | tag `sdks/go/v2.11.1`, commit `6f9b453fbaaeb53ead225f77390bf683472be5fa` (28/10/2026) |

已发布版本之后 `main` 上的 SDK 更改：

| 更改 | 提交 | SDK | 发布 |
|---|---|---|---|
| `VerificationCache` 的键和隔离（#103） | `e711179a` | TypeScript | 未发布，05/11 已准备 |
| WASM `dualMerkleRoot` 遵循 V2-11（#106） | `cac0a5f6` | Rust（`wasm` 特性）、WASM | 未发布，30/10 和 05/11 已准备 |
| `VerifyPayloadHash` 检查规范的带前缀哈希（#107） | `24e70d56` | Go | 未发布，30/10 和 05/11 已准备 |
| `RawAuditEventV2` 保留收到的审计条目（#112） | `6dc97d59` | Go、Rust | 未发布，30/10 和 05/11 已准备 |
| 每个 V2 验证器内部的 V2-2 模式校验（#116） | `0ebd2849` | TypeScript、Python、Go、Rust、WASM | 未发布，05/11 已准备 |
| 统一的授权书有效性辅助函数（#117） | `614b1c56` | TypeScript、Python、Go、Rust | 未发布，05/11 已准备 |
| 统一的授权书链时间检查（#118） | `7619ff95` | TypeScript、Python、Go、Rust | 未发布，05/11 已准备 |
| 拒绝单个根授权书中重复的域（#119） | `c154192f` | TypeScript、Python、Go、Rust | 未发布，05/11 已准备 |

已发布版本之后的其他更改：

- **参考透明日志。** #120（`c59ce5ba`）把 gossip 告警绑定到所见证日志的身份；#122（`d45c5a7b`）轮询运行时加入的对等节点。该服务不以软件包形式分发。
- **规范和一致性工具包。** #121（`0dcbd8dc`）加入委托目录。#123（`45ac32f0`）加入 V2-10 和 DCP-09 §3.5.2 的澄清、策略目录 2.0 和委托目录 2.0.0；没有 SDK 更改。
- **注册表用户。** 在包含这些更改的版本发布之前，用户收不到其中任何一项。

<a id="known-limits-and-exclusions"></a>

## 已知限制与排除项

- **审计记录。** [AUDIT-v2.0-FINAL.md](../../../../spec/AUDIT-v2.0-FINAL.md) 是日期为 26/02/2026 的内部历史记录，附有当前的背景说明；它不是外部审计。
- **模拟的 HSM 提供者。** `HsmCryptoProvider` 是模拟模式，不得用于真实证据（[NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)）。
- **密钥恢复。** 份额不使用混合 KEM 加密。
- **参考服务器。** 它检查公告签名的结构，而不是签名本身（[server/README.md](../../../../server/README.md)）。
- **WASM。** 不提供授权书链验证。
- **Rust。** 缺少 A2A 的 AES-256-GCM 会话加密及其重放窗口（[RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)）。
- **已发布版本。** 不包含[制品](#artifacts)中列出的更改。
- **差分和模糊测试活动。** 它们是有限的，并非穷尽；契约 `/4` 无法传给所有 SDK 的输入另行测量（[差分测试工具](../../../../tools/difffuzz/README.md#mandate-chains)）。
- **性能。** 未检查任何速度要求；[性能基准](../../../../tools/conformance/README.md#performance-baseline)和[有界工作负载的规模变化](../../../../tools/conformance/README.md#bounded-workload-scaling)是在基准提交之后加入的、关于方法的本地测量；两者都不是审计结果。
- **未涵盖。** 容器镜像、部署、服务令牌和运营方配置。

<a id="reporting"></a>

## 报告

请按照 [SECURITY.md](../../../../SECURITY.md) 的说明报告安全问题。其中列出联系方式、范围（包括有上限的本地资源耗尽复现）和奖励政策：奖励逐案决定，没有保证的或固定的金额。
