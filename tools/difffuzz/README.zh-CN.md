<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# V2 bundle 验证器的差分模糊测试器

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

`run.mjs` 将同一个经过变异的 V2 已签名 bundle 提供给四个 SDK 验证器
（TypeScript 的 `verifySignedBundleV2`、Python 的 `verify_signed_bundle_v2`、
Go 的 `VerifySignedBundleV2WithPolicy`、Rust 的 `verify_signed_bundle_v2_with_policy`），
并把 `valid` 判定上的任何不一致、任何崩溃和任何超时都视为发现。v2.10.0 结束的那一轮安全工作
几乎全部是四个验证器之间的不一致；这个工具就是在发布之前找出它们的方法。

<a id="setup"></a>

## 准备

每个 SDK 都从本检出代码运行，绝不使用已发布的软件包：

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
```

Go（`sdks/go/go.mod` 中的版本）和稳定版 Rust 工具链必须在
`PATH` 上；驱动程序会自行构建 `shims/go`（一个用 `replace` 将 SDK 替换为
`../../../../sdks/go` 的模块）和 `shims/rust`（一个对
`../../../../sdks/rust` 有路径依赖的 crate）。

<a id="usage"></a>

## 用法

```bash
node tools/difffuzz/run.mjs                       # 200 iterations, seed 1
node tools/difffuzz/run.mjs --iterations 2000 --seed 7
```

| 选项             | 默认值                          | 含义                                                           |
| ---------------- | ------------------------------- | -------------------------------------------------------------- |
| `--iterations N` | `200`                           | 要生成的变异体数量                                             |
| `--seed S`       | `1`                             | PRNG 种子；相同的种子和种子文件会生成相同的变异体             |
| `--modes a,b`    | `default,hybrid_required`       | 运行每个变异体时使用的验证器策略                               |
| `--timeout MS`   | `30000`                         | 每个判定的超时；超过即为发现                                   |
| `--python PATH`  | `$DIFFFUZZ_PYTHON` or `python3` | 安装了 Python SDK 的解释器                                     |
| `--out DIR`      | `tools/difffuzz/findings`       | 写入发现的位置                                                 |

至少有一个发现时，退出码为 1。最后的摘要
报告迭代次数、判定、一致数、发现以及变异器分布。

<a id="policies"></a>

### 策略

`default` 是每个 SDK 的默认验证器策略（`DEFAULT_VERIFIER_POLICY`、
`DefaultVerifierPolicy()`、`VerifierPolicy::default()`），它将护照的
风险等级映射为 `classical_only` / `hybrid_preferred` /
`hybrid_required`。任何其他模式名称都会应用于 `default_mode` 和
所有风险等级，与 SDK 互操作测试的做法相同，因此 `hybrid_required` 会在严格模式下运行每个
bundle。

<a id="seeds"></a>

### 种子

`tests/interop/v2/bundle_vectors.json`
（`signed_bundle`、`must_accept_bundles`、`classical_only_routine_bundle`、
`must_reject_bundles`）、`tests/interop/v2/cross_sdk_vectors.json` 以及
`tests/conformance/examples/*.json`（在那里加入 V2 已签名示例之前为空）中的
所有 V2 已签名 bundle。每个种子首先在所有模式下不经变异地验证（
基线）；基线上的不一致同样是发现。大多数种子是
所有 SDK 都已拒绝的 `must_reject` bundle，因此至少一半的
迭代从第一个模式下基线判定为有效的种子开始；摘要行会报告这一划分。

<a id="mutators"></a>

### 变异器

每次迭代在随机位置应用一个变异（70%）或两个变异（30%）：
删除一个键、把值设为 `null`、交换值的类型、交换两个同级
值、翻转 base64 字符串中的一个字符、把枚举字符串替换为
原型键（`constructor`、`__proto__`、`toString`、`valueOf` 等）、
把键重命名为原型键、添加未知键、把一个工件（或
其 `payload`、`payload_hash` 或 `composite_sig`）复制到另一位置、把
数字改写为 `1.0`、`1e2`、`-0`、`0.1`、`2^64`、`1e400` 等、把 RFC 3339 时间戳改写为
其他偏移、格式错误或远在过去或未来、超大
字符串（64 KiB 或 1 MiB）、嵌套 100 层的值，以及递归的
键重排（它绝不能改变判定，会与种子的基线判定比较）。
JavaScript 无法表示的数字会原样拼接进
序列化文本，因此每个解析器看到的都是相同的字节。

<a id="findings"></a>

## 发现

每个发现都写入 `findings/<seed>-<iteration>.json`（该目录
除 `.gitkeep` 外均被 Git 忽略），包含种子名称、变异路径、
变异体的确切文本以及按模式出现分歧的四个判定：

```json
{
  "seed": "1",
  "iteration": 42,
  "seed_name": "bundle_vectors.signed_bundle",
  "mutations": [{ "mutator": "set_null", "detail": "bundle.audit_entries" }],
  "verdicts": {
    "default": {
      "ts": { "valid": false, "errors": ["..."] },
      "py": { "crash": "exit 1: ..." },
      "go": { "valid": false, "errors": ["..."] },
      "rust": { "valid": false, "errors": ["..."] }
    }
  },
  "mutant_json": "{...}"
}
```

发现是线索，还不是缺陷。先复现它：能用确切变异体复现的
不一致或崩溃是需要解决的分歧；超时、工具链或机器的
崩溃，或无法复现的结果，在证明并非如此之前都属于基础设施问题。将复现用例最小化，
并依据规范性要求（`spec/VERIFICATION.md`、规范化配置文件）和共享测试数据
（`tests/interop/v2/`）判断哪个 SDK 是对的。当它们无法定论时，这是规范层面的
悬而未决问题，而不是可以随意挑选的修复：请记录下来，而不是默认采用
失败关闭的判定。先在出错的 SDK 中编写单元测试再修复它，绝不要为了达成一致而
削弱验证器。确切的变异体可以通过
某个 shim 重放：

```bash
node -e 'console.log(require("./tools/difffuzz/findings/1-42.json").mutant_json)' | node tools/difffuzz/shims/ts/verify.mjs
```

<a id="shims"></a>

## Shim

`shims/` 下的每个 shim 从 stdin 读取一个 JSON 文档，并向 stdout 写一行 JSON
`{"valid": bool, "errors": [string]}`；给出判定时退出码为 0，
崩溃时为其他值。使用 `--loop` 时，它每行读取一个紧凑文档
并逐一作答，驱动程序就是这样运行它们的（每个 SDK 和模式一个
长期运行的进程，崩溃或超时后重启）。第一个
位置参数选择模式，如“策略”中所述。SDK 的 JSON 解析器
拒绝的文档会得到 `valid: false` 判定。

## CI

`.github/workflows/difffuzz.yml` 在每个拉取请求上运行 300 次迭代，
每晚运行 3000 次，并在 `workflow_dispatch` 中接受 `iterations` 和 `seed` 输入。
作业失败时，发现会作为 `difffuzz-findings` 工件上传。
