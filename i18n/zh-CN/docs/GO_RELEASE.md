<a id="published-go-module"></a>

# 已发布的 Go 模块

> [英文版](../../../docs/GO_RELEASE.md)的参考译文，更新于 28/10/2026。如有差异，以英文版为准。

28/10/2026 已确认：Go SDK `v2.11.1` 已通过[标签 `sdks/go/v2.11.1`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go)发布，公共模块代理和 checksum 数据库均已提供该版本。上一个版本 `v2.11.0`（[`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)）于 26/10/2026 确认，其说明保留在下文。模块和导入路径保留 `/v2`。SDK 版本与 DCP 线格式/规范版本独立。Go 无需额外注册表令牌，使用方通过 Go 模块系统解析仓库标签。

<a id="install"></a>

## 安装

需要 Go 1.25 或更高版本。在应用模块中执行，并更新及提交应用的 `go.mod` 和 `go.sum`：

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
go mod verify
```

<a id="what-changed-in-v2111"></a>

## v2.11.1 的更新内容

在 [VERIFICATION.md 的 V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`（按主树方式构建的 SHA3-256 树；空记录为 `sha3-256:` 后接 64 个零）、每个 `prev_hash_secondary`（第一个条目为 `"GENESIS"`，之后为 bundle 中原样的前一条目的 SHA3-256）以及每个 `intent_hash_secondary`（意图载荷的 SHA3-256）。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链。存在的字段如果是 `null`、不是字符串或不一致，则被拒绝：对于带有这些字段的证据，这是相对于 v2.11.0 的接受范围变更（v2.11.0 曾接受它们）。API、结果字段、`dcp-jcs-v1`、实验性且需显式启用的 `dcp-jcs-v2` API 以及 `hash_alg` 的处理均不变。验证仍然不等于对主体的信任、准入或授权。 SDK 遥测报告 `2.11.1`。

<a id="upgrade-and-compatibility"></a>

## 升级与兼容性

v2.11.0（2026 年 10 月 26 日）包含、v2.11.1 予以保留的内容：V1 无效密钥长度错误处理、修复后的 V2 责任主体/密钥/产物/检查点验证、责任主体显式信任与 `strict-v1`、委托链，以及具备重放保护的并发 A2A 会话。v2.11.0 的 SDK 遥测报告 `2.11.0`。见 [SDK README](../../../sdks/go/README.md)、[准入指南](../../../docs/ADMISSION.md) 和[安全策略](../../../SECURITY.md)。

验证比 v2.10.0 更严格：之前接受的格式错误或不一致证据可能被拒绝。请保留历史证据，不要重写。`dcp-jcs-v1` 仍是规范性默认值；`dcp-jcs-v2` API 仍为实验性、非规范性且须显式启用。验证不等于责任主体信任、准入或授权。在 v2.11.0 中，可选的次级 SHA3-256 字段不在验证器的检查范围内；v2.11.1 会在它们存在时检查。

<a id="validation"></a>

## 验证

对于 v2.11.1，代理提供的模块 zip 中的 84 个文件与 `main` 一致（Go 会在 zip 中加入仓库根目录的 `LICENSE`），代理和 checksum 数据库确认了该版本。一个不使用本地 `replace`、从代理解析 `v2.11.1` 的外部使用方通过了 189 项测试。

对于 v2.11.0（2026 年 10 月 26 日），默认套件和 `-race -tags otlp` 套件各通过 1,154 项测试/子测试；一项测试有意留给独立的实时生产者/消费者矩阵。`go mod tidy -diff`、构建和 vet 均通过。外部使用方通过 137 项测试/子测试，其负对照按预期失败。已通过公开代理与 checksum 验证将发布模块下载到新缓存，源码与审核提交一致。随后外部使用方在没有本地 `replace` 指令的情况下通过测试。Rust 的独立发布见 [Rust](../../../docs/RUST_RELEASE.md)。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](../../../docs/README.md#published-versions)。其他发布说明：[npm 软件包](../../../docs/NPM_RELEASES.md)、[Python 2.10.1](../../../docs/PYTHON_RELEASE.md)、[Rust 2.11.1](../../../docs/RUST_RELEASE.md)。
