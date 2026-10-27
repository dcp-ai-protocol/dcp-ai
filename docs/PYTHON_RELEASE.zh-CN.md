<a id="published-python-package"></a>

# 已发布的 Python 软件包

> [英文版](PYTHON_RELEASE.md)的参考译文，更新于 27/10/2026。如有差异，以英文版为准。

26/10/2026 已确认：[`dcp-ai` 2.10.0](https://pypi.org/project/dcp-ai/2.10.0/) 已在 PyPI 发布。Python 软件包版本与 DCP 线格式/规范版本独立。本次未发布 Go、Rust、npm 软件包或容器。

<a id="install"></a>

## 安装

需要 Python 3.10 或更高版本。请更新环境或锁定文件。可选集成 extras 仍与协议核心分离：

```bash
pip install --upgrade "dcp-ai>=2.10.0,<3"
pip install "dcp-ai[fastapi]>=2.10.0,<3"
pip install "dcp-ai[langchain]>=2.10.0,<3"
pip install "dcp-ai[openai]>=2.10.0,<3"
pip install "dcp-ai[crewai]>=2.10.0,<3"
pip install "dcp-ai[otlp]>=2.10.0,<3"
```

<a id="what-changed"></a>

## 更新内容

包含 V2 验证器修复、委托人信任与 `strict-v1`、显式启用的来源期限/容量限制、FastAPI 正文预算和断开处理、桥接验证修复及实验性规范化 API。还修复了 Python 3.10 在等待吊销列表 worker 时的取消竞态：取消请求不得在 worker 完成前释放名额。

2.9.0 的 FastAPI 在不验证签名的情况下接受结构有效的 V2 bundle。用于 V2 验证前请升级到 2.10.0。见 [SECURITY](../SECURITY.md)、[准入](ADMISSION.md) 和 [Python SDK README](../sdks/python/README.md)。

<a id="compatibility-and-verification"></a>

## 兼容性与验证

`dcp-jcs-v1` 仍是唯一规范性默认值。`dcp-jcs-v2` 仍为实验性、非规范性且须显式启用。验证、信任、准入和授权各不相同；安装此版本不会自动配置你的信任策略。更严格的验证可能拒绝 2.9.0 接受的证据。请保留历史证据，不要重写。

已安装 wheel 在 Python 3.12 上通过 1,866 项测试；已安装源码分发在 Python 3.10 上通过 1,863 项测试，预期跳过 3 项 Python 3.12 专属任务工厂测试。两种分发均通过元数据检查，全部 59 个 Python 源模块匹配。CI 覆盖 Python 3.10 和 3.12。

ML-DSA 依赖在有界签名尝试耗尽时可能抛出 `ValueError`。一个 CI fixture 在创建签名时遇到了此失败；验证并未被绕过。调用方须将失败视为错误，不得视为已签名证据。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](README.md#published-versions)。其他发布说明：[npm 软件包](NPM_RELEASES.md)、[Go v2.11.0](GO_RELEASE.md)、[Rust 2.11.0](RUST_RELEASE.md)。
