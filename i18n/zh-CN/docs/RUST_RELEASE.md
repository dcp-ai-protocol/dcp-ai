<a id="published-rust-crate"></a>

# 已发布的 Rust crate

> [英文原文](../../../docs/RUST_RELEASE.md)的参考译文。更新于 09/11/2026；标识符与代码示例保持原样。

05/11/2026 已确认：[`dcp-ai` 2.13.0](https://crates.io/crates/dcp-ai/2.13.0) 已在 crates.io 发布（[更新内容](#what-changed-in-2130)）。之前的版本 [2.11.1](https://crates.io/crates/dcp-ai/2.11.1)（28/10/2026 确认）和 [2.11.0](https://crates.io/crates/dcp-ai/2.11.0)（26/10/2026 确认）的说明保留在下文。crate 版本独立于 DCP 线格式/规范版本。Rust crate 与 npm、Python、Go 和容器独立发布。

<a id="install"></a>

## 安装

请使用当前稳定版 Rust 工具链，在应用 crate 中运行，并提交更新后的 `Cargo.toml` 和 `Cargo.lock`。这些示例允许兼容的 2.x 更新；如需精确固定版本，请在 manifest 中使用 `=2.13.0`。

```bash
cargo add dcp-ai@2.13.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.13.0"
```

可选 OTLP 导出和 WebAssembly 绑定分别通过 `otlp` 和 `wasm` 启用。仅启用目标所需的功能。本次 Rust 发布不会重新发布独立的 npm WASM 包。

<a id="what-changed-in-2111"></a>

## 2.11.1 的更新内容

在 [VERIFICATION.md 的 V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`（按主树方式构建的 SHA3-256 树；空记录为 `sha3-256:` 后接 64 个零）、每个 `prev_hash_secondary`（第一个条目为 `"GENESIS"`，之后为 bundle 中原样的前一条目的 SHA3-256）以及每个 `intent_hash_secondary`（意图载荷的 SHA3-256）。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链。存在的字段如果是 `null`、不是字符串或不一致，则被拒绝：对于带有这些字段的证据，这是相对于 2.11.0 的接受范围变更（2.11.0 曾接受它们）。API、结果字段、`dcp-jcs-v1`、实验性且需显式启用的 `dcp-jcs-v2` API 以及 `hash_alg` 的处理均不变。验证仍然不等于对主体的信任、准入或授权。 遥测报告 `2.11.1`。

<a id="upgrade-and-compatibility"></a>

## 升级与兼容性

2.11.0（2026 年 10 月 26 日）包含、2.11.1 予以保留的内容：V2 责任主体、密钥、工件和检查点验证修复，显式信任与 `strict-v1`、委托链、V2 bundle 构建/签名以及实验性候选 API。保留 `V2VerificationResult` 十个字段的 API 兼容性；签名者详情单独提供。2.11.0 的遥测报告 `2.11.0`。见 [SDK README](../../../sdks/rust/README.md)、[准入指南](../../../docs/ADMISSION.md) 和 [安全政策](../../../SECURITY.md)。

验证比 2.10.0 更严格，可能拒绝此前接受的格式错误或不一致证据。请保留历史证据，不要改写。`dcp-jcs-v1` 仍为规范性默认配置；`dcp-jcs-v2` 为非规范性实验候选，必须显式启用。验证不赋予责任主体信任、准入或授权。Rust 仍未实现 A2A AES-256-GCM 会话加密及其重放窗口，V2 构建器不生成 PQ 检查点。2.11.0 的验证器检查主审计链，但不检查可选的次级 SHA3-256 字段；2.11.1 会在它们存在时检查。

<a id="validation"></a>

## 验证

对于 2.13.0，发布工作流从 `main`（`46b142bd`）发布了该 crate。注册表中 crate 的每个文件都与发布前测试过的制品一致，唯一例外是 `.cargo_vcs_info.json`，它记录的是该提交而不是候选版本的构建提交。在全新的 Cargo home 中、不使用 path 依赖或 patch、从 crates.io 解析 2.13.0 的使用方，通过了外部一致性套件（七个目录中的 697 个用例）和默认配置检查：golden `dcp-jcs-v1` bundle 验证通过，而声明 `dcp-jcs-v2` 的同一 bundle 被拒绝。

对于 2.11.1，发布工作流发布了该 crate；注册表中的 crate 除记录 `main` 上干净提交的 `.cargo_vcs_info.json` 外，所有文件都与审核版本一致。一个从 crates.io 解析 2.11.1 的外部使用方通过了 73 项测试。

对于 2.11.0（2026 年 10 月 26 日），默认套件通过 261 项测试，全功能套件通过 267 项（包含 doctest）。WASM 库和测试已针对 `wasm32-unknown-unknown` 编译；这不是浏览器运行测试。Cargo 成功打包并验证 71 个文件，发布 dry-run 通过。外部使用方针对解压 crate 通过 72 项测试，涵盖准入、兼容性、候选入口/路由器和验证器回归；反转的负对照按预期失败。发布后，新注册表缓存精确解析到 2.11.0，无本地路径或 patch，同样的 72 项测试通过。公开归档 checksum 和打包源码字节与审核版本一致。测试的共享 fixture 来自仓库，应用不需要这些 fixture。

<a id="what-changed-in-2130"></a>

## 2.13.0 的更新内容

2.13.0 已于 05/11/2026 由发布工作流从 `main`（`46b142bd`）发布到 crates.io。它取代了下面从未发布的 2.12.0。与 2.11.1 相比，2.13.0：

- **执行 V2-2 模式校验（接受范围变化）。** `verify_signed_bundle_v2`、`…_with_policy` 和 `…_at`（包括 WASM 构建）在任何哈希、密钥或签名检查之前，先按 `schemas/v2` 校验已签名 bundle 的信封和四个载荷。以前被接受的模式无效 bundle 现在会以 `schema: <pointer> <keyword>` 诊断失败。
- **新增 `RawAuditEventV2` 和 `RawAuditEventError`**，与下面的 2.12.0 相同。
- **修正 `wasm_dual_merkle_root`**（启用 `wasm` 特性时），与下面的 2.12.0 相同。用旧函数计算的根按记录保留；见[迁移 `dualMerkleRoot` 的结果](../../../docs/NPM_RELEASES.md#migrating-dualmerkleroot-results)。
- **统一授权书检查。** `verify_mandate_validity` 将窗口作为时刻而不再作为文本比较，`verify_mandate_validity_at`（新增）接收验证时间。`verify_mandate_chain` 拒绝重复某个领域的根授权书。

遥测报告 `2.13.0`。传输格式、签名、配置文件、作为规范默认值的 `dcp-jcs-v1` 以及实验性显式启用的 `dcp-jcs-v2` API 均不变，crate 现在包含 Apache-2.0 `LICENSE`。由这份 Rust 源代码构建的 npm 包是 `@dcp-ai/wasm` 2.1.3，同样于 05/11/2026 发布（见 [npm 包](../../../docs/NPM_RELEASES.md)）。已发布的 crate 中的 README 是发布前准备的版本，写着“prepared, not published”；已发布的 crate 无法更改。见 [SDK README](../../../sdks/rust/README.md) 和[变更日志](../../../CHANGELOG.md#unreleased)。

<a id="prepared-not-published-2120"></a>

## 已准备、尚未发布：2.12.0

2.12.0 已于 30/10/2026 在仓库中准备好，但尚未在 crates.io 发布。准备时，安装命令仍为 2.11.1；当前的命令见上文，指定的是 2.13.0。与 2.11.1 相比，2.12.0：

- **新增 `dcp_ai::v2::types::RawAuditEventV2` 和 `RawAuditEventError`。** `RawAuditEventV2` 以解码后的 `serde_json::Value` 保存收到的审计条目，因此每个成员（包括未知成员）都保持其是否存在以及是否为 `null`。它保存的是解码后的值，而不是原始文本：对它序列化或用 `dcp-jcs-v1` 规范化，得到的是该值的字节。`typed()` 是有损视图；`AuditEventV2` 的行为不变。整个 bundle 的解析、验证和规范化均不变。
- **修正 `wasm_dual_merkle_root`（启用 `wasm` 特性时）。** 它现在按 bundle 验证器使用的 [VERIFICATION.md 的 V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 归约计算双 Merkle 根（使用 32 字节原始摘要，奇数层复制最后一个节点）；对不是 32 字节十六进制摘要的叶节点返回错误，而不是接受格式错误的输入。由此 crate 构建的 npm 包是 `@dcp-ai/wasm` 2.1.2，同样已准备、尚未发布（见 [npm 包](../../../docs/NPM_RELEASES.md)）。

其他 API、`dcp-jcs-v1` 以及实验性且需显式启用的 `dcp-jcs-v2` API 均不变；实验性候选的新测试不改变任何默认值。遥测报告 `2.12.0`。crate 不再包含翻译版 README，它们现在位于仓库的 `i18n/` 目录树中。参见 [SDK README](../../../sdks/rust/README.md) 和[变更日志](../../../CHANGELOG.md)。

> **说明（05/11/2026）。** 上面的比较写于 30/10/2026，针对已准备的 2.12.0，该版本仍未发布。此后 `main` 改变了验证：所有 V2 验证器（包括 WASM 构建）都执行 V2-2 模式校验（#116，02/11/2026），授权书有效性辅助函数、链的时间检查和重复根域检查也已更改（#117 至 #119）。这些更改不在上述 2.12.0 中；2.12.0 从未发布，上面的 2.13.0 包含这些更改并取代了它，`main` 上的清单文件带有 2.13.0。见[审计资料](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts)。

<a id="prepared-not-published-2140"></a>

## 已准备、未发布：2.14.0

于 08/11/2026 准备，未发布；在 2.14.0 发布并核对之前，上面的安装命令仍指向 2.13.0。

- **新增（显式启用）。** `admit_delegated_bundle_v2`、`admit_signed_bundle_v2_from_bytes`、`create_mandate_acknowledgment` 和 `evaluate_delegation_activation_v2`（[变更日志](../../../CHANGELOG.md#unreleased)）。
- **接受范围变化。** V1 对象验证和默认的 V2 Ed25519 提供方中的 P-ED-1；启用 `wasm` 特性时，提供原始导出 `wasm_canonicalize_v2_result`。
- **`otlp` 特性。** 它要求导出器带入依赖图的 `anyhow` 1.0.103 或更高版本以及 `tokio` 1.53.3 或更高版本（RUSTSEC-2026-0190、RUSTSEC-2026-0386）；默认构建和 `wasm` 构建都不会选择这两个 crate。crate 自身的 `Cargo.lock` 不约束其使用方：锁文件启用了 `otlp` 的项目需运行 `cargo update -p anyhow -p tokio`。启用 `otlp` 时，该最低版本也会排除已修复的 tokio 1.51.x 分支（1.51.6 或更高版本）；这并不意味着 1.51.6 存在漏洞，只是 Cargo 无法同时允许两个分支。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](../../../docs/README.md#published-versions)。其他发布说明：[npm 软件包](../../../docs/NPM_RELEASES.md)、[Python 2.10.2](../../../docs/PYTHON_RELEASE.md)、[Go v2.13.0](../../../docs/GO_RELEASE.md)。
