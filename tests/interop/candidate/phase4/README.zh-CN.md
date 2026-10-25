<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# 第 4 阶段矩阵：候选的生产方 × 消费方

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

实验性且未启用。这些测试是
[候选 README 第 18 节](../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4)的证据。
它们不会启用 `dcp-jcs-v2`，也不会改变任何默认值。

<a id="files"></a>

## 文件

| 文件 | 用途 |
|---|---|
| [`run.mjs`](run.mjs) | 运行器：矩阵、`--cost` 和 `--self-test` |
| [`phase4-specs.json`](phase4-specs.json) | 12 个规格、16 个阴性用例和预期结果 |
| `adapters/ts.mjs`, `adapters/wasm.mjs`, `adapters/py_adapter.py`, `adapters/common.mjs` | TypeScript、WASM 和 Python 适配器 |
| `sdks/go/dcp/v2/experimental_candidate_phase4_matrix_test.go` | Go 适配器，一个只在运行器下运行的测试 |
| `sdks/rust/tests/experimental_candidate_phase4_matrix.rs` | Rust 适配器，一个只在运行器下运行的测试 |

<a id="what-a-run-does"></a>

## 一次运行做什么

1. TypeScript 适配器写出本次运行的输入：
   - 新的合成密钥；
   - 每个规格的输入片段，以 JSON 文本形式给出，对每个生产方都是相同的字节。
2. 每个生产方用其公开的显式启用 API，以规格所列的模式（`S01` 至 `S10` 为 bytes 和 value，`S11` 仅
   bytes，`S12` 仅 value）对每个规格签名。它还会
   推导密钥 ID 并写出以供比较。
3. 每个生产方组装环：用下一个生产方签名的工件生成 `S01`（ts、py、go、rust、
   wasm、ts）。
4. 运行器从每个生产方新生成的输出中写出 16 个字节级阴性用例。
5. 每个消费方用第 3 阶段的验证器验证全部内容。对每一项，它报告路由、
   类别、进入的验证器、判定，以及它观察到的对其历史解码器的调用。

判定是全有或全无。它期望：

- 恰好 975 个结果：575 个阳性（115 个单元 × 5 个消费方）和 400 个阴性（16 × 5 × 5）；
- 每个步骤，以及每个结果都来自本次运行；
- 每个规格在所有生产方中的 `manifest_hash` 相同；
- 所有生产方的单元相同，ML-DSA 签名值除外，它们只在已知
  位置被遮蔽；
- 所有 SDK 的密钥 ID 相同；
- 运行在期限（`--deadline`，默认 1800 秒）之前结束。到期时，该步骤的整个进程组
  会被终止：每个步骤都在自己的 POSIX 进程组中以分离方式启动，因此在
  Windows 上不作此保证。

<a id="running-it"></a>

## 如何运行

先构建：`sdks/typescript`（`npm run build`）和 `sdks/wasm`（`npm run build:wasm` 和 `npm run build:ts`）。
Python 需要 SDK 的依赖项；Go 和 Cargo 按已安装的版本使用。从检出代码的根目录：

```bash
node tests/interop/candidate/phase4/run.mjs --self-test
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --deadline 900
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --cost
```

每次运行都会在系统临时目录下（或 `--out <dir>` 下）写入一个新目录。该目录
包含密钥、输出、结果、日志和 `summary.json`（或 `cost-summary.json`）。它只属于运行它的人：
密钥是合成的，但其中的任何内容都不打算公开。退出码 0 表示所有检查都
通过，1 表示有失败，2 表示配置无效（`--deadline` 不是正数）。

`--cost` 在每个平台的一对等价组合上测量第 10 道关卡。两侧使用相同的密钥、载荷、会话
和审计条目，并在输出上检查这一点。每个操作在 3 次预热后运行 20 次，每个平台
最多 60 秒。Go 和 Rust 的构建单独计时，Rust 在 release 配置下测量。
这些数字的局限见候选 README 第 18.3 节。
