<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="canonicalization-lab"></a>

# 规范化实验室

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](../../docs/GO_RELEASE.md).

**Python 发布 (26/10/2026).** `dcp-ai` 2.10.0 已在 PyPI 发布，包含验证器修复、准入和实验性显式启用 API。Go 和 Rust 仍独立发布。见 [Python 2.10.0](../../docs/PYTHON_RELEASE.md).

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

非规范候选 `dcp-jcs-v2` 的可执行**设计模型**，附带其语料库生成器和
运行器。它不是 SDK、验证器或一致性检查：它为其合成承诺计算 SHA-256，
但不签名任何内容，也不验证任何签名，`dcp-jcs-v1` 仍然是唯一具有规范效力的默认
规范化配置文件（SDK 的候选 API 是实验性的、需显式启用，见 [CI](#ci)）。
设计、规则以及该模型能展示和不能展示的内容见 [`docs/proposals/canonicalization-candidate/README.md`](../../docs/proposals/canonicalization-candidate/README.md)。

| 文件 | 作用 |
|---|---|
| `model.py` | 设计模型（只由 `run.py` 导入）。其可执行行为即已批准模型的行为；docstring 澄清公开路径和假定的最后重复规则 |
| `generate_corpus.py` | 写出 `docs/proposals/canonicalization-candidate/corpus.json`；预期结果为手工编写，它从不导入模型 |
| `run.py` | 完整性、新鲜度、有效性和覆盖率检查，274 个用例和 24 个阴性对照 |

在 Linux 或 macOS 上使用 Python 3.9 或更高版本（不支持 Windows），仅用标准库。命令
从检出代码的根目录运行；从其他目录运行时，请为脚本提供绝对路径。输出写入一个
新的临时目录；运行器也会拒绝已存在的输出路径。

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

## CI

[`.github/workflows/canonicalization-lab.yml`](../../.github/workflows/canonicalization-lab.yml) 在 Ubuntu 上用 Python 3.9（文档规定的最低版本）和 3.12、
仅用标准库运行相同的命令，触发条件为推送到 `main` 以及修改该工作流、本目录或
`docs/proposals/canonicalization-candidate/` 的拉取请求。每个作业写入一个新的临时目录，重新生成
语料库并逐字节比较，运行 274 个用例和 24 个阴性对照，并检查两个
计数；任何失败都会使作业失败。

它只检查**设计模型**。它不是 SDK 一致性：SDK 的显式启用候选 API
由它们各自的测试套件和[第 4 阶段矩阵](../../tests/interop/candidate/phase4/README.md)测试；没有任何
配置文件或默认验证器运行该候选，`dcp-jcs-v1` 也不会改变。绿色的运行结果只说明
模型、语料库及其预期结果彼此一致；它对任何实现都不说明什么。


TypeScript 和 WASM 的显式启用 API 已包含在 `@dcp-ai/sdk` 2.2.0 和 `@dcp-ai/wasm` 2.1.0 中；其他 SDK 的发布独立进行。
