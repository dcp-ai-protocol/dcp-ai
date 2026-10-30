<a id="published-rust-crate"></a>

# 已发布的 Rust crate

> [英文原文](../../../docs/RUST_RELEASE.md)的参考译文。更新于 30/10/2026；标识符与代码示例保持原样。

28/10/2026 已确认：[`dcp-ai` 2.11.1](https://crates.io/crates/dcp-ai/2.11.1) 已在 crates.io 发布。上一个版本 [2.11.0](https://crates.io/crates/dcp-ai/2.11.0) 于 26/10/2026 确认，其说明保留在下文。crate 版本独立于 DCP 线格式/规范版本。Rust crate 与 npm、Python、Go 和容器独立发布。

<a id="install"></a>

## 安装

请使用当前稳定版 Rust 工具链，在应用 crate 中运行，并提交更新后的 `Cargo.toml` 和 `Cargo.lock`。这些示例允许兼容的 2.x 更新；如需精确固定版本，请在 manifest 中使用 `=2.11.1`。

```bash
cargo add dcp-ai@2.11.1
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.1"
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

对于 2.11.1，发布工作流发布了该 crate；注册表中的 crate 除记录 `main` 上干净提交的 `.cargo_vcs_info.json` 外，所有文件都与审核版本一致。一个从 crates.io 解析 2.11.1 的外部使用方通过了 73 项测试。

对于 2.11.0（2026 年 10 月 26 日），默认套件通过 261 项测试，全功能套件通过 267 项（包含 doctest）。WASM 库和测试已针对 `wasm32-unknown-unknown` 编译；这不是浏览器运行测试。Cargo 成功打包并验证 71 个文件，发布 dry-run 通过。外部使用方针对解压 crate 通过 72 项测试，涵盖准入、兼容性、候选入口/路由器和验证器回归；反转的负对照按预期失败。发布后，新注册表缓存精确解析到 2.11.0，无本地路径或 patch，同样的 72 项测试通过。公开归档 checksum 和打包源码字节与审核版本一致。测试的共享 fixture 来自仓库，应用不需要这些 fixture。

<a id="prepared-not-published-2120"></a>

## 已准备、尚未发布：2.12.0

2.12.0 已于 30/10/2026 在仓库中准备好，但尚未在 crates.io 发布。上面的安装命令仍为 2.11.1。与 2.11.1 相比，2.12.0：

- **新增 `dcp_ai::v2::types::RawAuditEventV2` 和 `RawAuditEventError`。** `RawAuditEventV2` 以解码后的 `serde_json::Value` 保存收到的审计条目，因此每个成员（包括未知成员）都保持其是否存在以及是否为 `null`。它保存的是解码后的值，而不是原始文本：对它序列化或用 `dcp-jcs-v1` 规范化，得到的是该值的字节。`typed()` 是有损视图；`AuditEventV2` 的行为不变。整个 bundle 的解析、验证和规范化均不变。
- **修正 `wasm_dual_merkle_root`（启用 `wasm` 特性时）。** 它现在按 bundle 验证器使用的 [VERIFICATION.md 的 V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 归约计算双 Merkle 根（使用 32 字节原始摘要，奇数层复制最后一个节点）；对不是 32 字节十六进制摘要的叶节点返回错误，而不是接受格式错误的输入。由此 crate 构建的 npm 包是 `@dcp-ai/wasm` 2.1.2，同样已准备、尚未发布（见 [npm 包](../../../docs/NPM_RELEASES.md)）。

其他 API、`dcp-jcs-v1` 以及实验性且需显式启用的 `dcp-jcs-v2` API 均不变；实验性候选的新测试不改变任何默认值。遥测报告 `2.12.0`。crate 不再包含翻译版 README，它们现在位于仓库的 `i18n/` 目录树中。参见 [SDK README](../../../sdks/rust/README.md) 和[变更日志](../../../CHANGELOG.md)。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](../../../docs/README.md#published-versions)。其他发布说明：[npm 软件包](../../../docs/NPM_RELEASES.md)、[Python 2.10.1](../../../docs/PYTHON_RELEASE.md)、[Go v2.11.1](../../../docs/GO_RELEASE.md)。
