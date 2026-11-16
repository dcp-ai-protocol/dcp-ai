<sub>[English](../../../../tools/difffuzz/README.md) · **中文** · [Español](../../../es/tools/difffuzz/README.md) · [日本語](../../../ja/tools/difffuzz/README.md) · [Português](../../../pt-BR/tools/difffuzz/README.md)</sub>

<a id="differential-fuzzer-for-the-v2-bundle-verifiers"></a>

# V2 bundle 验证器差分模糊测试工具

> 本文是[英文版本](../../../../tools/difffuzz/README.md)的参考译文，更新于 2026年11月05日。如有差异，以英文版本为准。标识符、命令和代码块保持原文。

`run.mjs` 在同一明确策略和验证时间下，将同一个经过变异的已签名 V2 bundle 送入四个 SDK 验证器：TypeScript 的 `verifySignedBundleV2`、Python 的 `verify_signed_bundle_v2`、Go 的 `VerifySignedBundleV2At` 和 Rust 的 `verify_signed_bundle_v2_at`。实现分歧、与共享向量声明相反的判定、改变判定的键重排，以及任何错误、崩溃或超时都属于发现项。v2.10.0 完成的安全修复几乎都涉及四个验证器之间的分歧；此工具用于在发布前发现这些问题。驱动模块为 `fuzz.mjs`，由 `run.mjs` 和自测共享。使用 `--sdks five` 时，编译为 WASM 的 Rust SDK 作为第五个验证器加入（[五个 SDK](#five-sdks-wasm)）。第二个工具 `run-mandates.mjs` 对 DCP-09 委托书链做同样的事（[委托书链](#mandate-chains)）。

<a id="setup"></a>

## 准备

所有 SDK 都从当前检出目录运行，不使用已发布的软件包：

```bash
(cd sdks/typescript && npm install && npm run build) # shims/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of shims/py (pynacl, pqcrypto>=1.0)
npm ci --ignore-scripts                               # root lock: tweetnacl and @noble/post-quantum for run-mandates.mjs
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
node --test tools/difffuzz/real-shims.test.mjs    # bounded diagnostic tests with all four SDKs
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
```

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `--iterations N` | `200` | 生成的变异输入数量（0～1,000,000） |
| `--seed S` | `1` | PRNG 种子；相同种子与测试数据产生相同变异 |
| `--modes a,b` | `default,hybrid_required` | 每个种子与变异输入使用的策略（见策略部分） |
| `--sdks four\|five` | `four` | 本次运行的 SDK 集合；`five` 加入 WASM 构建（见“五个 SDK”） |
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

开始构建前检查所有值：未知、重复、缺失或超范围参数退出 2。退出码：0 表示无发现项、无失败批次且基线完整；1 表示至少一个发现项、失败批次或不完整基线；2 表示使用错误；3 表示基础设施或运行器故障，包括构建失败、运行中输入改变、封装程序无法启动、在批次或单例中返回协议外或不支持的响应、重试预算耗尽，或需要迭代但第一模式下没有声明有效的种子。命令集合始终恰好是本次运行 SDK 集合的封装程序。

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

每项写入 `findings/<seed>-<iteration>-<mode>-<n>.json`（该目录除 `.gitkeep` 外被 Git 忽略），记录类别、种子、模式、明确策略及 `now_ms`、变异、每个 SDK 的结果和准确输入字节（`input_b64`、`input_sha256`）。发现项是线索，还不一定是缺陷。先使用 `--replay` 复现：记录的字节和缩减后的输入（如有）使用发现项自己的 `now_ms` 与策略，在发现项 SDK 集合的封装程序中运行，并在同一批次包含发现项记录的原始对照。该对照是未变异种子的原始字节、哈希、策略、声明预期和基线结果，绝不替换为当前同名测试数据。运行前会进行完整类型校验：发现项种类、与自身结果推导出的类别一致的已知类别集合、其集合中每个 SDK 一个类型明确的结果、哈希和对照。当前构建、驱动、测试数据和种子与记录逐一比较，所有差异均作为来源差异报告。复现退出码：0 表示记录的判定和对照基线均复现；1 表示未复现；3 表示发现项、对照或基础设施无法支持判定。

随后在预算内缩减变异输入的分歧、错误或崩溃；预期不符发现项本身已经是未变异种子。缩减只在具有正向对照时进行：未变异种子在该模式通过自身基线，且所选集合中的每个 SDK 都验证为 `true`。正确拒绝的种子不构成对照。在保持各 SDK 判定和并行测试的种子基线不变的前提下减少差异。`1e400` 等原始词元保留为字节，绝不重新解析文本。所得结果是该搜索与预算内的最小值，而非全局最小；键顺序发现项和超时不做缩减。

依据规范要求（`spec/VERIFICATION.md`、规范化配置文件）和共享测试数据（`tests/interop/v2/`）判断哪个 SDK 正确。如果它们无法解决该用例，应记录为规范开放问题，而不是默认采用预防性拒绝作为正确答案。先在错误 SDK 中加入单元测试，再修复它，绝不为达成一致而弱化验证器。

<a id="shims"></a>

## 封装程序

`--batch` 是驱动协议（`dcp-difffuzz/3`），通过外部一致性套件的 `runProcess`（位于 `tools/conformance/external.js`）为每批运行一个有限生命周期进程，具有截止时间、独立进程组、SIGTERM 后 SIGKILL、有界输出和清理。stdin 请求为 `{protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}`，使用随机 ID，不包含预期或种子名。stdout 响应为一个 JSON 文档 `{protocol, run_id, nonce, results}`，每个用例恰好一个结果，之后退出 0。畸形请求退出 2。Go 封装程序将 nil 的 `errors` 写为 `[]`；Rust 封装程序仅使用 `std` 解码 base64。

在此测试工具的内部协议中，批次判定诊断最多保留 8 条 `errors`，每条均为原文前缀，最多 256 个 Unicode 码点。列表或字符串被截短时，`truncated` 记录 `original_count`（原始条数）、`kept`（保留条数）、`original_code_points`（原始总码点数）和 `sha256`（原始列表的摘要）。范围内的普通诊断保持不变。诊断类型畸形仍是协议故障，绝不会被转换为有效拒绝。此变更不改变 DCP 传输格式或验证器判定。

摘要按顺序处理每条原始诊断：先写入以 4 字节大端整数表示的 UTF-8 字节长度，再写入 UTF-8 字节。TypeScript 和 Python 在计算此哈希时将孤立代理项替换为 U+FFFD，但不会规范化诊断前缀本身。Go 在计算哈希时将每个无效 UTF-8 字节替换为 U+FFFD；Rust 字符串为有效 UTF-8。不同 SDK 的诊断文字不同，因此这些摘要标识特定封装程序的诊断，不代表 SDK 间的等价性。

驱动检查上限和标记的一致性，包括确实有所省略的证据。标记随结果一起保存。但在没有原文时，它无法认证原文，也无法证明封装程序没有悄悄缩短一条形式上有效的短消息。`dcp-difffuzz/2` 的历史发现项仍可重放，包括其原来不受此上限约束的诊断；当前响应必须使用 `dcp-difffuzz/3` 并满足其限制。手动和循环输出保留原有行为。

`stats.truncated_diagnostic_observations` 按 SDK 统计诊断截短的观测次数，包括隔离重试和缩减期间的重复观测；它不是不同输入的数量。这些上限约束的是诊断传输，而非 SDK 计算或内部内存。现有输出限制仍然适用：将 `--stdout-bytes` 设置得更小可能合理地触发 `output_limit`，失败批次仍会阻止整次运行通过。

不带 `--batch` 时，四个原有封装程序各自保留原来的手动形式（WASM 封装程序只接受 `--batch` 或 `--bound-selftest`）：stdin 一个文档，或用 `--loop` 每行一个文档；每文档返回 `{"valid": bool, "errors": [string]}`，第一个参数可选模式，使用各 SDK 自身的默认策略和系统时钟。

<a id="five-sdks-wasm"></a>

## 五个 SDK：WASM

`--sdks five` 把编译为 WebAssembly 的 Rust SDK 作为第五个验证器加入（`shims/wasm/verify.mjs`）。

- **构建。** `wasm-pack build sdks/rust --target web -- --features wasm --locked` 在本次运行自己的目录中执行，受同一构建期限约束（`--offline`：`--mode no-install` 和 `--offline`）。共享的 `tools/conformance/wrappers/.build` 从不被改动。记录 `.wasm`、其 JavaScript 胶水代码和 wasm-pack 版本；不验证工具链能否重现这些字节。
- **运行。** 由 Node 承载的 WebAssembly，而不是浏览器。`wasm_verify_signed_bundle_v2` 读取宿主时钟：每次调用通过 `Date.now` 看到请求的 `now_ms`，并在 `finally` 中恢复。
- **字节。** 封装程序按收到的原样传递解码后的 UTF-8 文本，包括开头的字节顺序标记（用 `ignoreBOM` 解码），在 JavaScript 中从不解析或重新序列化。只有导出函数文档所述的 JSON 解析器拒绝（以 `JSON parse error: ` 开头的单个错误）才是 `parse_rejected`；不是 UTF-8 的字节与 TypeScript 封装程序一样是 `parse_rejected`；其他任何带内错误、无法读取的策略或陷阱都是 `error`。
- **TypeScript 封装程序的边界。** 原有的 TypeScript 封装程序用不带 `ignoreBOM` 的 `TextDecoder` 解码，会在 `JSON.parse` 之前去掉开头的字节顺序标记。此类输入上的判定差异是该封装程序解析器的边界，而不是 SDK 之间的差异；bundle 变异器不会加入字节顺序标记。
- **集合。** 每份报告和每个新的发现项都记录 `sdks`。没有集合的发现项（如在 five 出现之前写入的所有 `/2` 和 `/3` 文件）是 four，恰好用四个封装程序复现。复现始终使用发现项自己的集合；显式指定另一个集合的 `--sdks` 会被拒绝（退出码 3），结果不恰好是其 SDK 的集合也会被拒绝。任何省略都不会悄悄缩小集合。

<a id="mandate-chains"></a>

## 委托书链

`run-mandates.mjs` 通过外部套件的契约 `/4`（`verify_mandate_chain`）及其四个封装程序，把同一条已签名的 DCP-09 委托书链发送给 TypeScript、Python、Go 和 Rust 的链验证器；封装程序由套件的进程运行器执行（格式 `dcp-mandatefuzz/1`）。WASM 不导出任何委托书链函数；这一边界由套件（`tools/conformance/README.md`）记录并测试，此处不做探测。

```bash
node tools/difffuzz/run-mandates.mjs --iterations 120 --seed 1 --report /tmp/mandates.json
node tools/difffuzz/run-mandates.mjs --replay tools/difffuzz/findings/mandates/<file>.json
node tools/difffuzz/run-mandates.mjs --transport-probe --report /tmp/mandates-transport.json
node --test tools/difffuzz/mandate-fuzz.test.mjs  # self-tests of the harness (no SDK)
```

- **签名。** 工具不使用任何 SDK 对链签名：用 tweetnacl 和 `@noble/post-quantum` 对 `context || 0x00 || dcp-jcs-v1(mandate without its signature fields)` 签名，采用 `pq_over_classical`，ML-DSA-65 使用 `extraEntropy: false`（已用所安装的库确认其确定性）。密钥为 TEST-ONLY，由固定标签派生：一个人类、最深链中每个委托书一个代理，外加一个入侵者。运行前，工具用自己的消息构造验证 `mandate_chain_vectors.json` 的所有签名。其精确整数规范化器（最多 20 位）是该签名器的限制，而不是 `dcp-jcs-v1` 的规则。
- **用例。** 11 个类别中的 73 个变体：角色与上下文、链接、深度、权限收窄、原始数字、领域、时间、签名密钥有效性、最低层级、撤销和 JSON 编码。深度按边计数（0 到 2）。每次运行先执行覆盖扫描（每个变体在其适用的每个深度各执行一次：167 个用例），再执行 `--iterations` 个随机变异体。覆盖有保证，而非概率性的；覆盖扫描未完成的运行从不通过。
- **签名类别。** 语义变更会以规范的签名者和上下文重新签名，因此错误的签名从不掩盖被检验的规则。故意错误的签名者或上下文以及过期签名是单独的类别，各自按构造方式检查。
- **预期。** 只有在 DCP-09 §3.5.2（含其 05/11/2026 的澄清）、规范化配置文件或 RFC 8259 有规定时才写预期；否则该用例是观察。归因为 `isolated`、`masked_by_signature`（无法签名的值，如 `0.5`）或 `representation_dependent`（2^53 及以上：已精确签名，但各解析器能否重现签名字节取决于其数字表示）。观察或受限归因从不掩盖分歧或故障；报告把规则证据与无预期的一致、受限归因下的一致分开计数。
- **对照。** 每个批次都带有每个基础链的正向对照和过期签名对照。只有当其深度的对照在同一批次中通过时，变异体才计入。
- **上限。** 每批的用例数和字节数、每个用例的字节数、输出、期限（构建期限在每一步之前检查）、重试、写出的发现项和缩减步骤都有上限。超过 `--max-findings` 的发现项会计数，但不写出也不保留，运行仍然失败。隔离期间批次 ID 不变。
- **停止。** 运行在给出第一个发现项或失败的批次之后停止，保留以供审查，并明确说明。
- **缩减。** 只针对重新签名的语义变异体：每个候选都重新签名、用原语检查、保持四个判定，并与一个通过的正向对照一起运行。从不针对故意的或过期的签名；仅对该次搜索和预算而言是最小的。
- **复现。** 发现项记录其输入、正向对照和任何缩减后的输入，每一项都通过覆盖链字节、密钥字节、已撤销 ID 和时钟的哈希绑定，并记录其四个结果和构建来源。复现先检查所有这些内容（规范 base64、保留字节顺序标记的严格 UTF-8、RFC 3339 时钟、重新推导的判定和类别），再单独运行每个输入，要求对照与记录的基线完全一致，并报告来源差异。
- **封装程序。** TypeScript 和 Python 从检出目录运行；Go 和 Rust 在本次运行的目录中构建，或通过 `--go-wrapper` 和 `--rust-wrapper` 提供并仅按内容记录。退出码：0 表示无发现项、所有对照通过且覆盖扫描完成；1 表示其他情况；2 表示用法错误；3 表示基础设施故障。

**传输探测。** 契约 `/4` 并不会把每个输入都送达每个 SDK：每个封装程序先把链作为 UTF-8 JSON 读取，遇到无法读取的内容以退出码 2 退出。`--transport-probe` 把一个已签名的对照、一个 `NaN` 标记、开头的字节顺序标记和字面量 `1e400` 分别单独发送给每个封装程序，并记录各组件的行为。05/11/2026 的测量结果：所有封装程序都拒绝 `NaN` 和字节顺序标记；TypeScript 和 Python 的 SDK 收到 `1e400` 并拒绝该链，而 Go 和 Rust 的封装程序拒绝了它。这是有明确限制的观察，绝不是一致性结果；封装程序的拒绝从不算作 SDK 的拒绝，活动也从不发送这些输入。

## CI

`.github/workflows/difffuzz.yml` 先执行两个工具的自测和五个封装程序的有界诊断测试，然后在每个 pull request 中以四个 SDK 执行 300 次迭代、以五个 SDK 执行 60 次，并执行带 120 个随机变异体的委托书覆盖扫描；每晚分别执行 3000 次、1000 次和 600 个。它通过 `workflow_dispatch` 接受 `iterations` 和 `seed`。作业失败时，发现项和报告会作为 `difffuzz-findings` 制品上传。
