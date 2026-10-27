<a id="published-rust-crate"></a>

# 已发布的 Rust crate

> [英文原文](RUST_RELEASE.md)的参考译文。更新于 26/10/2026；标识符与代码示例保持原样。

26/10/2026 已确认：[`dcp-ai` 2.11.0](https://crates.io/crates/dcp-ai/2.11.0) 已在 crates.io 发布。crate 版本独立于 DCP 线格式/规范版本。本次只更新 Rust；npm、Python、Go 和容器均独立发布。

<a id="install"></a>

## 安装

请使用当前稳定版 Rust 工具链，在应用 crate 中运行，并提交更新后的 `Cargo.toml` 和 `Cargo.lock`。这些示例允许兼容的 2.x 更新；如需精确固定版本，请在 manifest 中使用 `=2.11.0`。

```bash
cargo add dcp-ai@2.11.0
cargo check --locked
```

```toml
[dependencies]
dcp-ai = "2.11.0"
```

可选 OTLP 导出和 WebAssembly 绑定分别通过 `otlp` 和 `wasm` 启用。仅启用目标所需的功能。本次 Rust 发布不会重新发布独立的 npm WASM 包。

<a id="upgrade-and-compatibility"></a>

## 升级与兼容性

本版本包含 V2 责任主体、密钥、工件和检查点验证修复，显式信任与 `strict-v1`、委托链、V2 bundle 构建/签名以及实验性候选 API。保留 `V2VerificationResult` 十个字段的 API 兼容性；签名者详情单独提供。遥测报告 `2.11.0`。见 [SDK README](../sdks/rust/README.md)、[准入指南](ADMISSION.md) 和 [安全政策](../SECURITY.md)。

验证比 2.10.0 更严格，可能拒绝此前接受的格式错误或不一致证据。请保留历史证据，不要改写。`dcp-jcs-v1` 仍为规范性默认配置；`dcp-jcs-v2` 为非规范性实验候选，必须显式启用。验证不赋予责任主体信任、准入或授权。Rust 仍未实现 A2A AES-256-GCM 会话加密及其重放窗口，V2 构建器不生成 PQ 检查点。验证器检查主审计链，但不重新计算可选的次级 SHA3-256 链/根。

<a id="validation"></a>

## 验证

默认套件通过 261 项测试，全功能套件通过 267 项（包含 doctest）。WASM 库和测试已针对 `wasm32-unknown-unknown` 编译；这不是浏览器运行测试。Cargo 成功打包并验证 71 个文件，发布 dry-run 通过。外部使用方针对解压 crate 通过 72 项测试，涵盖准入、兼容性、候选入口/路由器和验证器回归；反转的负对照按预期失败。发布后，新注册表缓存精确解析到 2.11.0，无本地路径或 patch，同样的 72 项测试通过。公开归档 checksum 和打包源码字节与审核版本一致。测试的共享 fixture 来自仓库，应用不需要这些 fixture。
