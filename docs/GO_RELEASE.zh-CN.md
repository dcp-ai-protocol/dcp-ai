<a id="published-go-module"></a>

# 已发布的 Go 模块

> [英文版](GO_RELEASE.md)的参考译文，更新于 26/10/2026。如有差异，以英文版为准。

26/10/2026 已确认：Go SDK `v2.11.0` 已通过[标签 `sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)发布。模块和导入路径保留 `/v2`。SDK 版本与 DCP 线格式/规范版本独立。Go 无需额外注册表令牌，使用方通过 Go 模块系统解析仓库标签。

<a id="install"></a>

## 安装

需要 Go 1.25 或更高版本。在应用模块中执行，并更新及提交应用的 `go.mod` 和 `go.sum`：

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
go mod verify
```

<a id="upgrade-and-compatibility"></a>

## 升级与兼容性

包含 V1 无效密钥长度错误处理、修复后的 V2 责任主体/密钥/产物/检查点验证、责任主体显式信任与 `strict-v1`、委托链，以及具备重放保护的并发 A2A 会话。SDK 遥测报告 `2.11.0`。见 [SDK README](../sdks/go/README.md)、[准入指南](ADMISSION.md) 和[安全策略](../SECURITY.md)。

验证比 v2.10.0 更严格：之前接受的格式错误或不一致证据可能被拒绝。请保留历史证据，不要重写。`dcp-jcs-v1` 仍是规范性默认值；`dcp-jcs-v2` API 仍为实验性、非规范性且须显式启用。验证不等于责任主体信任、准入或授权。可选的次级 SHA3-256 审计链仍不在验证器文档所列的检查范围内。

<a id="validation"></a>

## 验证

默认套件和 `-race -tags otlp` 套件各通过 1,154 项测试/子测试；一项测试有意留给独立的实时生产者/消费者矩阵。`go mod tidy -diff`、构建和 vet 均通过。外部使用方通过 137 项测试/子测试，其负对照按预期失败。已通过公开代理与 checksum 验证将发布模块下载到新缓存，源码与审核提交一致。随后外部使用方在没有本地 `replace` 指令的情况下通过测试。Rust 发布仍单独待办；本次 Go 发布未重新发布 npm、Python 或容器。
