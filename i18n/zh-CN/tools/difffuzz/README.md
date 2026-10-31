<sub>[English](../../../../tools/difffuzz/README.md) · **中文** · [Español](../../../es/tools/difffuzz/README.md) · [日本語](../../../ja/tools/difffuzz/README.md) · [Português](../../../pt-BR/tools/difffuzz/README.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# V2 bundle 验证器差分模糊测试工具

> 本文是[英文版本](../../../../tools/difffuzz/README.md)的参考译文，更新于 2026年10月31日。如有差异，以英文版本为准。标识符、命令和代码块保持原文。

`run.mjs` 在同一明确策略和验证时间下，将同一个经过变异的已签名 V2 bundle 送入四个 SDK 验证器：TypeScript 的 `verifySignedBundleV2`、Python 的 `verify_signed_bundle_v2`、Go 的 `VerifySignedBundleV2At` 和 Rust 的 `verify_signed_bundle_v2_at`。实现分歧、与共享向量声明相反的判定、改变判定的键重排，以及任何错误、崩溃或超时都属于发现项。v2.10.0 完成的安全修复几乎都涉及四个验证器之间的分歧；此工具用于在发布前发现这些问题。驱动模块为 `fuzz.mjs`，由 `run.mjs` 和自测共享。

<a id="setup"></a>

## 准备

所有 SDK 都从当前检出目录运行，不使用已发布的软件包：

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

`PATH` 中需要 Go（版本见 `sdks/go/go.mod`）和稳定版 Rust 工具链。驱动用 `-mod=readonly` 构建 `shims/go`（该模块通过 `replace` 将 SDK 指向 `../../../../sdks/go`），用 `--locked` 构建 `shims/rust`（依赖本地路径 `../../../../sdks/rust`）。二者都使用本次运行专属的私有临时目录，包括 Cargo 的 `CARGO_TARGET_DIR`，因此并发运行不会共享二进制文件；Rust 封装程序每次都会从头构建。不会改变清单或锁文件。使用 `--offline` 时，Go 使用 `GOPROXY=off`，Cargo 使用 `--offline`，因此模块和 crate 缓存中必须已有依赖。构建有独立的截止时间。

报告的 `build.artifacts` 按内容记录实际测量对象：四个封装程序、两个构建出的二进制文件（哈希而非临时路径）、TypeScript 的 `src` 和 `dist` 树、`package-lock.json` 与 Node 解析到的每个直接运行时依赖目录、Python SDK 源码和解释器及五个分发包版本，以及 Go、Rust SDK 源码和 Rust 锁文件。`inputs` 记录驱动（`fuzz.mjs`、`run.mjs`）和测试数据。运行结束会再次检查二者；发生变化则退出 3。`provenance_limits` 说明哈希不能证明的内容：没有验证该 `dist` 是否由该 `src` 构建，也没有验证传递依赖。

<a id="usage"></a>

## 使用

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7 --report /tmp/difffuzz.json
node tools/difffuzz/run.mjs --replay tools/difffuzz/findings/<file>.json
node --test tools/difffuzz/difffuzz.test.mjs      # self-tests of the harness (no SDK)
```

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `--iterations N` | `200` | 生成的变异输入数量（0～1,000,000） |
| `--seed S` | `1` | PRNG 种子；相同种子与测试数据产生相同变异 |
| `--modes a,b` | `default,hybrid_required` | 每个种子与变异输入使用的策略（见策略部分） |
| `--timeout MS` | `60000` | 一个批次进程的截止时间（`--timeout-ms` 相同） |
| `--python PATH` | `$DIFFFUZZ_PYTHON` 或 `python3` | 具有 Python SDK 依赖的解释器 |
| `--out DIR` | `tools/difffuzz/findings` | 发现项写入位置 |
| `--report FILE` | 无 | 完整 JSON 报告：先写 `incomplete`，每条处理路径均替换，包括使用错误；值缺失、形似选项或重复则不写入 |
| `--offline` | 关闭 | 仅使用本地缓存构建 |
| `--build-timeout-ms MS` | `600000` | 构建所有封装程序的一个截止时间 |
| `--batch-cases N`, `--batch-bytes B`, `--case-bytes B` | `64`, 16 MiB, 4 MiB | 每批用例数、整个请求的准确 UTF-8 大小、单个输入的原始字节数；种子不适配则退出 3，变异输入不适配则跳过并计数 |
| `--stdout-bytes B` | 8 MiB | 一个批次进程的输出限制 |
| `--max-findings N` | `50` | 记录的发现项数量；达到后不再运行新批次（含基线），且整次运行不能通过 |
| `--max-retries N` | `200` | 逐例重跑以定位失败批次；耗尽则退出 3 |
| `--minimize-steps N`, `--minimize-total N` | `24`, `96` | 每个发现项和整次运行的缩减预算 |

开始构建前检查所有值：未知、重复、缺失或超范围参数退出 2。退出码：0 表示无发现项、无失败批次且基线完整；1 表示至少一个发现项、失败批次或不完整基线；2 表示使用错误；3 表示基础设施或运行器故障，包括构建失败、运行中输入改变、封装程序无法启动、在批次或单例中返回协议外或不支持的响应、重试预算耗尽，或需要迭代但第一模式下没有声明有效的种子。命令集合始终恰好包含四个封装程序。

<a id="policies-and-time"></a>

### 策略与时间

每个请求明确携带策略和时间：`now_ms` 是外部一致性套件使用的 2026-10-22T00:00:00Z，因此判定不依赖运行日期。所有 SDK 的 `default` 都使用向量的 `default_verifier_policy`（TypeScript 的 `DEFAULT_VERIFIER_POLICY`）；其他模式名应用于 `default_mode` 和每个风险等级，与向量构造各模式策略的方式相同。种子的 `verifier_policy_overrides` 在每种模式下替换对应字段。此前，`default` 是各 SDK 自身的默认策略，每个封装程序读取自己的系统时钟。

<a id="seeds-and-expectations"></a>

### 种子与预期

种子来自 `tests/interop/v2/bundle_vectors.json` 的 bundle，采用 `_description` 的声明：`signed_bundle` 通过验证；其每个 `must_reject` 变异及每个 `must_reject_bundles` 在任何模式下拒绝；每个 `must_accept_bundles` 在所有模式下通过；`classical_only_routine_bundle` 使用 `verified_by_mode`，其中未声明 `default` 的判定。默认策略解析为四种模式之一，因此“所有”或“任何”模式包括它。即使四个 SDK 一致，与声明预期相反的判定仍是 `expectation` 发现项：一致绝不是正确性的判据。如果该预期与规范本身矛盾，应保留复现材料并停止使用该解释，而不是用多数结果替代。`tests/interop/v2/cross_sdk_vectors.json` 和 `tests/conformance/examples/` 的已签名 bundle 未声明预期，仅用于差分比较。

每个奇数次迭代——即至少一半，向上取整——从第一模式下声明有效的种子中随机选择；其余迭代可使用任意种子。如果需要迭代但没有这样的种子，运行退出 3。

<a id="mutators"></a>

### 变异器

每轮在随机位置施加一次（70%）或两次（30%）变异：删除键、设为 `null`、改变值类型、交换两个同级值、改变 base64 字符串中的一个字符、将枚举字符串替换为原型键（`constructor`、`__proto__`、`toString`、`valueOf` 等）、将键重命名为原型键、加入未知键、将证据对象或其 `payload`、`payload_hash`、`composite_sig` 复制到其他位置、把数字重写为 `1.0`、`1e2`、`-0`、`0.1`、`2^64`、`1e400` 等、将 RFC 3339 时间戳改为其他时区偏移、畸形格式或遥远的过去/未来、超大字符串（64 KiB 或 1 MiB）、深度 100 的嵌套值，以及递归重排键。最后一种操作不应改变判定；每个 SDK 的结果都与它自己的种子基线比较。JavaScript 无法表示的数字直接按原文插入序列化文本，使所有解析器看到相同字节。键重排保留自有 `__proto__` 键，以前会丢弃它。

<a id="judgement"></a>

## 判定

每个封装程序返回 `verdict`（`verified` 和 `errors`）、`parse_rejected`（其 JSON 解析器拒绝文档）、`error`（SDK 抛出异常或 panic）或 `unsupported`。驱动补充 `crash`（非 0 退出或信号）、`timeout`、`output_limit` 和 `protocol`（协议外响应）。SDK 按接受与否比较：`true` 接受，`false` 或解析拒绝仍视为拒绝，其他类别不计入投票。进程失败的批次会被记录，并逐个重新运行其用例来定位原因。无论重试结果如何，失败批次都会阻止整次运行通过；无法由任何单例复现的失败也是发现项（`batch_failure_not_reproduced`）。无论哪个先失败，都等待该批次所有封装程序执行结束后才结束运行。

<a id="findings"></a>

## 发现项

每项写入 `findings/<seed>-<iteration>-<mode>-<n>.json`（该目录除 `.gitkeep` 外被 Git 忽略），记录类别、种子、模式、明确策略及 `now_ms`、变异、每个 SDK 的结果和准确输入字节（`input_b64`、`input_sha256`）。发现项是线索，还不一定是缺陷。先使用 `--replay` 复现：记录的字节和缩减后的输入（如有）使用发现项自己的 `now_ms` 与策略，在四个封装程序中运行，并在同一批次包含发现项记录的原始对照。该对照是未变异种子的原始字节、哈希、策略、声明预期和基线结果，绝不替换为当前同名测试数据。运行前会进行完整类型校验：发现项种类、与自身结果推导出的类别一致的已知类别集合、四个类型明确的结果、哈希和对照。当前构建、驱动、测试数据和种子与记录逐一比较，所有差异均作为来源差异报告。复现退出码：0 表示记录的判定和对照基线均复现；1 表示未复现；3 表示发现项、对照或基础设施无法支持判定。

随后在预算内缩减变异输入的分歧、错误或崩溃；预期不符发现项本身已经是未变异种子。缩减只在具有正向对照时进行：未变异种子在该模式通过自身基线，且四个 SDK 都验证为 `true`。正确拒绝的种子不构成对照。在保持各 SDK 判定和并行测试的种子基线不变的前提下减少差异。`1e400` 等原始词元保留为字节，绝不重新解析文本。所得结果是该搜索与预算内的最小值，而非全局最小；键顺序发现项和超时不做缩减。

依据规范要求（`spec/VERIFICATION.md`、规范化配置文件）和共享测试数据（`tests/interop/v2/`）判断哪个 SDK 正确。如果它们无法解决该用例，应记录为规范开放问题，而不是默认采用预防性拒绝作为正确答案。先在错误 SDK 中加入单元测试，再修复它，绝不为达成一致而弱化验证器。

<a id="shims"></a>

## 封装程序

`--batch` 是驱动协议（`dcp-difffuzz/2`），通过外部一致性套件的 `runProcess`（位于 `tools/conformance/external.js`）为每批运行一个有限生命周期进程，具有截止时间、独立进程组、SIGTERM 后 SIGKILL、有界输出和清理。stdin 请求为 `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}`，使用随机 ID，不包含预期或种子名。stdout 响应为一个 JSON 文档 `{protocol, run_id, nonce, results}`，每个用例恰好一个结果，之后退出 0。畸形请求退出 2。Go 封装程序将 nil 的 `errors` 写为 `[]`；Rust 封装程序仅使用 `std` 解码 base64。

不带 `--batch` 时，各封装程序保留原来的手动形式：stdin 一个文档，或用 `--loop` 每行一个文档；每文档返回 `{"valid": bool, "errors": [string]}`，第一个参数可选模式，使用各 SDK 自身的默认策略和系统时钟。

## CI

`.github/workflows/difffuzz.yml` 先执行自测，再在每个 pull request 中执行 300 次迭代、每晚执行 3000 次，并通过 `workflow_dispatch` 接受 `iterations` 和 `seed`。作业失败时，发现项和报告作为 `difffuzz-findings` 构建产物上传。
