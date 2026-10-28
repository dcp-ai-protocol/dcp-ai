<a id="published-python-package"></a>

# 已发布的 Python 软件包

> [英文版](PYTHON_RELEASE.md)的参考译文，更新于 28/10/2026。如有差异，以英文版为准。

28/10/2026 已确认：[`dcp-ai` 2.10.1](https://pypi.org/project/dcp-ai/2.10.1/) 已在 PyPI 发布。Python 软件包版本与 DCP 线格式/规范版本独立。Python 软件包与 Go、Rust、npm 软件包和容器独立发布。上一个版本 [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/) 于 26/10/2026 确认，其说明保留在下文。

<a id="install"></a>

## 安装

需要 Python 3.10 或更高版本。请更新环境或锁定文件。可选集成 extras 仍与协议核心分离：

```bash
pip install --upgrade "dcp-ai>=2.10.1,<3"
pip install "dcp-ai[fastapi]>=2.10.1,<3"
pip install "dcp-ai[langchain]>=2.10.1,<3"
pip install "dcp-ai[openai]>=2.10.1,<3"
pip install "dcp-ai[crewai]>=2.10.1,<3"
pip install "dcp-ai[otlp]>=2.10.1,<3"
```

<a id="what-changed-in-2101"></a>

## 2.10.1 的更新内容

在 [VERIFICATION.md 的 V2-11](../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`（按主树方式构建的 SHA3-256 树；空记录为 `sha3-256:` 后接 64 个零）、每个 `prev_hash_secondary`（第一个条目为 `"GENESIS"`，之后为 bundle 中原样的前一条目的 SHA3-256）以及每个 `intent_hash_secondary`（意图载荷的 SHA3-256）。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链。存在的字段如果是 `null`、不是字符串或不一致，则被拒绝：对于带有这些字段的证据，这是相对于 2.10.0 的接受范围变更（2.10.0 曾接受它们）。API、结果字段、`dcp-jcs-v1`、实验性且需显式启用的 `dcp-jcs-v2` API 以及 `hash_alg` 的处理均不变。验证仍然不等于对主体的信任、准入或授权。

<a id="what-changed"></a>

## 更新内容

2.10.0（2026 年 10 月 26 日）的更新内容，2.10.1 予以保留：

包含 V2 验证器修复、委托人信任与 `strict-v1`、显式启用的来源期限/容量限制、FastAPI 正文预算和断开处理、桥接验证修复及实验性规范化 API。还修复了 Python 3.10 在等待吊销列表 worker 时的取消竞态：取消请求不得在 worker 完成前释放名额。

2.9.0 的 FastAPI 在不验证签名的情况下接受结构有效的 V2 bundle。用于 V2 验证前请升级到 2.10.0。见 [SECURITY](../SECURITY.md)、[准入](ADMISSION.md) 和 [Python SDK README](../sdks/python/README.md)。

<a id="compatibility-and-verification"></a>

## 兼容性与验证

`dcp-jcs-v1` 仍是唯一规范性默认值。`dcp-jcs-v2` 仍为实验性、非规范性且须显式启用。验证、信任、准入和授权各不相同；安装此版本不会自动配置你的信任策略。更严格的验证可能拒绝 2.9.0 接受的证据。请保留历史证据，不要重写。

对于 2.10.1，发布工作流发布到 PyPI 的 wheel 和源码分发与发布前审核的产物逐字节一致，注册表中的 checksum 也已确认。发布前，这些产物在检出目录之外的新环境中安装后，通过了共享的二级 SHA3-256 向量（各 103 项测试）和一套独立的使用方测试（各 86 项测试）。

发布后，从 PyPI 将 wheel 和源码分发分别安装到新环境，两者均通过了 86 项独立检查；注册表的 wheel 还通过了 103 项共享向量测试。

对于 2.10.0（2026 年 10 月 26 日），已安装 wheel 在 Python 3.12 上通过 1,866 项测试；已安装源码分发在 Python 3.10 上通过 1,863 项测试，预期跳过 3 项 Python 3.12 专属任务工厂测试。两种分发均通过元数据检查，全部 59 个 Python 源模块匹配。CI 覆盖 Python 3.10 和 3.12。

ML-DSA 依赖在有界签名尝试耗尽时可能抛出 `ValueError`。一个 CI fixture 在创建签名时遇到了此失败；验证并未被绕过。调用方须将失败视为错误，不得视为已签名证据。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](README.md#published-versions)。其他发布说明：[npm 软件包](NPM_RELEASES.md)、[Go v2.11.1](GO_RELEASE.md)、[Rust 2.11.1](RUST_RELEASE.md)。
