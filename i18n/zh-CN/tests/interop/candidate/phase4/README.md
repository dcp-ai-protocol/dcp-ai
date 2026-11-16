<sub>[English](../../../../../../tests/interop/candidate/phase4/README.md) · **中文** · [Español](../../../../../es/tests/interop/candidate/phase4/README.md) · [日本語](../../../../../ja/tests/interop/candidate/phase4/README.md) · [Português](../../../../../pt-BR/tests/interop/candidate/phase4/README.md)</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# 第 4 阶段矩阵：候选的生产方 × 消费方

> 本文是[英文版](../../../../../../tests/interop/candidate/phase4/README.md)的参考译文，更新于 02/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

实验性且未启用。这些测试是
[候选 README 第 18 节](../../../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4)的证据。
它们不会启用 `dcp-jcs-v2`，也不会改变任何默认值。

<a id="files"></a>

## 文件

| 文件 | 用途 |
|---|---|
| [`run.mjs`](../../../../../../tests/interop/candidate/phase4/run.mjs) | 运行器：矩阵、`--cost` 和 `--self-test` |
| [`phase4-specs.json`](../../../../../../tests/interop/candidate/phase4/phase4-specs.json) | 12 个规格、16 个阴性用例和预期结果 |
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

- 恰好 975 个结果（115 个单元 × 5 个消费方，以及 16 × 5 × 5 个字节级阴性）：525 个阳性和 450 个阴性，即 400 个
  字节级阴性和 V2-2 拒绝的 `S09` 的 50 个结果（见下文）。在 V2-2 之前，所有单元都是阳性：575 和 400；
- 每个步骤，以及每个结果都来自本次运行；
- 每个规格在所有生产方中的 `manifest_hash` 相同；
- 所有生产方的单元相同，ML-DSA 签名值除外，它们只在已知
  位置被遮蔽；
- 所有 SDK 的密钥 ID 相同；
- 运行在期限（`--deadline`，默认 1800 秒）之前结束。到期时，该步骤的整个进程组
  会被终止：每个步骤都在自己的 POSIX 进程组中以分离方式启动，因此在
  Windows 上不作此保证。

<a id="s09-under-v2-2"></a>

### V2-2 下的 `S09`

V2-2 是每个 SDK 验证器中的模式验证。在候选路径上，它在解析器和配置文件策略之后、验证器检查载荷哈希和签名之前执行。
它封闭了审计条目、检查点、`SignedPayload` 信封及其 `composite_sig`。
`S09` 在其中每一处都放入了生产方不认识的成员，因此它的 50 个结果（5 个生产方 × 2 种模式 × 5 个消费方）在候选路径上被拒绝。
规格及其字节不变；期望写在运行器中（`run.mjs` 中的 `V2_2_CLOSED_MEMBERS`）：

- 路径 `candidate`，进入验证器 `dcp-jcs-v2`，`verified` 为 false，没有类别，也没有解码器调用；
- 每个 SDK 都返回以下四条诊断，顺序如下：
  - `schema: /bundle/audit_entries/1 additionalProperties x_entry_ext`
  - `schema: /bundle/intent additionalProperties x_artifact_ext`
  - `schema: /bundle/intent/composite_sig additionalProperties x_sig_ext`
  - `schema: /bundle/pq_checkpoints/0 additionalProperties x_checkpoint_ext`

  适配器只记录一个结果的前三个错误，因此矩阵精确比较这三个。每个 SDK 的生产方测试（bundle 生成）断言全部四条；
- 只有当同一消费方验证了同一生产方、同一模式的 `S04` 单元（不含这些成员的检查点）时，每次拒绝才计入。

`S09` 加入 intent 的 target 中的成员是开放的，不产生任何诊断。只要有任何 `S09` 结果被接受或以其他方式被拒绝，或者任何其他
阳性被拒绝，运行就失败。

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
