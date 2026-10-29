<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 一致性测试套件

> 本文是[英文版](README.md)的参考译文，更新于 29/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

`tools/conformance.js` 针对仓库中已提交的 fixture 和向量，运行 [`catalog.json`](catalog.json) 中声明的各个
测试集。目录带有版本（`kit_version`），并为每个测试集固定其必须产生的确切用例 ID。该套件只读取 fixture：
不会在检出目录中生成密钥或 fixture，也不会改动规范化、签名、配置文件、模式或向量。

<a id="commands"></a>

## 命令

```bash
npm run conformance                                    # every suite (same as node tools/conformance.js)
node tools/conformance.js --list                       # suites, pinned case counts and inventory
node tools/conformance.js --suite v1.integrity --suite v2.hashes
node tools/conformance.js --report /tmp/conformance.json
node --test tools/conformance/conformance.test.mjs     # runner self-tests (temporary copies only)
```

fixture、模式和目录的路径相对于脚本解析，而不是相对于当前目录。请在仓库根目录运行上述命令；在其他目录下，
请用绝对路径调用脚本（`node /path/to/dcp-ai/tools/conformance.js`）。`--root <dir>` 让套件使用另一份
fixture 副本（自测在临时副本上使用该选项）。

<a id="contract"></a>

## 约定

| 退出码 | 含义 |
|--------|------|
| 0 | 所选用例全部通过 |
| 1 | 至少一处不一致（某个值或判定与预期不同） |
| 2 | 用法错误：未知参数，未知、重复或为空的测试集 ID，`--list` 与 `--report` 同时使用 |
| 3 | 基础设施错误：fixture 缺失或格式错误、预期格式错误、未知的配置 `kind`、目录缺失或格式错误、异常、已固定的用例未产生或产生了未固定的用例，或没有执行任何检查 |

- 用例缺失或多出都算错误，因此从仍有其他向量的集合中删除一个向量，不会悄无声息地降低覆盖范围。抛出异常的
  测试集即使已经产生了全部固定用例，也判为失败。
- 使用 `--report` 时，运行前先写入 `incomplete` 占位内容，再由最终报告替换；用法错误或目录错误同样会替换该文件。
  这仅适用于套件能处理的错误且报告路径可写的情况：如果 Node 无法启动或文件无法写入，旧文件可能仍然存在，
  因此使用方应检查退出码以及报告中的 `run.id` 和 `status`，而不是信任已有的文件。
- 报告包含 `kit`（名称、版本、目录的 SHA-256）、`run`（uuid、时间戳、根目录、Node 版本）、`selection`、
  `status`、`totals`（`cases`、`executed`、`pass`、`fail`、`error`）、每个测试集及其声明、限制和用例
  （`status`，以及 `kind`：`discrepancy`、`fixture`、`expectation`、`exception` 或 `catalog`）、清单和
  全局限制。

<a id="suites"></a>

## 测试集

| 测试集 | 用例数 | 规范 | 模式 / 向量 | 通过能证明什么 |
|--------|--------|------|-------------|----------------|
| `v1.schema` | 7 | DCP-01、DCP-02、DCP-03、`BUNDLE.md` | `schemas/v1`、`tests/conformance/examples/*.json` | 仅模式有效性 |
| `v1.integrity` | 9 | `VERIFICATION.md`（V1）、DCP-03 | `citizenship_bundle.signed.json`、`keys/public_key.txt`、`golden_vectors.json#v1_bundle_verification` | 一个 fixture 的 Ed25519 签名、bundle 哈希、Merkle 根、意图哈希、条目哈希和 `prev_hash` 链，并与 golden 值比较；密钥元数据一致 |
| `v2.canonicalization` | 11 | `CANONICALIZATION_PROFILE.md` | `golden_vectors.json#canonicalization`、`#v2_canonicalization`、`interop_vectors.json#canonicalization` | 参考规范化器输出的 `dcp-jcs-v1` 字节 |
| `v2.hashes` | 9 | DCP-AI-v2.0 §2.3、§10.3 | `golden_vectors.json#hash_vectors`、`#dual_hash_vectors` | SHA-256 / SHA3-256 值、双哈希和双 Merkle 根 |
| `v2.signed_bundle` | 10 | `VERIFICATION.md`（V2） | `lib/verify.js`、在内存中构建的 bundle | 参考验证器对有效和被篡改 bundle 的判定；已验证不等于准入 |
| `v2.secondary_sha3` | 51 | `VERIFICATION.md` 的 V2-11 及其勘误 | `secondary_sha3_vectors.json`、`lib/verify.js` | 参考验证器对存在的二级 SHA3-256 字段的判定，每个被拒绝的用例都有对照；不代表完整的二级链 |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`、`*_v2.json` 示例 | 仅模式有效性 |
| `ext.dcp05_09.schema` | 18 | DCP-05 至 DCP-09 | `schemas/v2`、`<record>_v2.json` 示例 | 仅模式有效性 |
| `ext.dcp05_09.wire` | 28 | DCP-05、DCP-08、DCP-09、`V2-WIRE-COMPATIBILITY.md` | `schemas/v2`、在内存中签名的记录、`interop_vectors.json#domain_separation_all_contexts` | 将这些记录的表示、模式有效性和签名作为不同层次分别检查；不代表功能合规 |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | 预期的准入结果和错误码；`action_authorized` 始终为 false |

<a id="limits"></a>

## 限制

- 通过部分测试集，只证明这些检查在这些 fixture 上成立，不证明完整的 DCP 实现、其他 SDK 或某个部署。模式
  测试集只证明模式有效性；没有规范化、哈希和签名测试集，仅凭 V2 模式测试集不构成 V2 实现。
- `verified` 和 `admitted` 从不授权任何操作。
- 适配器（Express、FastAPI、OpenClaw、验证服务器）不属于该套件。
- 协议问题（依据 `spec/V2-WIRE-COMPATIBILITY.md`）：DCP-09 的到期字段（`valid_until`）以及 DCP-05、DCP-08 和
  DCP-09 的签名上下文已由勘误更正，并由 `ext.dcp05_09.wire` 测试。仍有待明确的、有版本的设计、套件不作裁定的有：
  DCP-05 `vitality_report` 的小数指标（在 `dcp-jcs-v1` 下只能表示 0 和 1）、DCP-08 §4.3 中以反向域名表示的权利
  （被 `right_type` 枚举拒绝），以及第二签名者或确认（DCP-05 §4.4、DCP-09 §3.3 和 §6.3）。DCP-04、DCP-06 和
  DCP-07 的示例不在这些勘误范围内。

<a id="inventory"></a>

## 清单

在 `--list` 和报告中列出，不计入总数：套件不执行这些内容，它们的存在也不等于测试通过。
`interop_vectors.json` 中的攻击向量、规范化边界用例和其他类别以及 bundle 与授权（mandate）向量在各 SDK
的测试套件中运行。`tests/nist-kat/` 包含已知答案向量和属性测试，各有其适用范围（见
[其 README](../../tests/nist-kat/README.zh-CN.md)）；它们同样在各 SDK 的测试套件中运行。`dcp-jcs-v2` 候选方案属于实验性质，不在 `dcp-jcs-v1` 范围内，有自己的测试集
（`tests/interop/candidate/`）。

<a id="external-implementations"></a>

## 外部实现

`tools/conformance-external.js` 针对你在 `--` 之后以 argv 指定的实现，运行一个单独的目录
[`external-catalog.json`](external-catalog.json)（契约 `dcp-ai-conformance-external/1`）。实现可以用任何语言编写：
它从 stdin 读取一个 JSON 请求，并向 stdout 写出一个 JSON 响应。运行器需要 Node 20 或更高版本，只使用内置模块。
上文的命令、目录和报告保持不变。

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --report /tmp/external.json -- node tools/conformance/wrappers/ts-sdk.mjs
node tools/conformance-external.js -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --suite external.digest -- ./my-implementation --its-own-flag
node --test tools/conformance/external.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 node --test tools/conformance/external.test.mjs
```

未设置 `DCP_EXTERNAL_PYTHON` 时，`node --test` 会跳过 Python 包装器并加以说明；设置
`DCP_EXTERNAL_REQUIRE_PYTHON=1` 时，缺少解释器会算作失败。最后一条命令运行全部测试。

| 套件 | 用例 | 向量 |
|------|------|------|
| `external.dcp-jcs-v1.canonicalize` | 30 | `golden_vectors.json#canonicalization`、`#v2_canonicalization`；`interop_vectors.json#canonicalization` 及其 19 个 `edge_cases`，其中 3 个必须被拒绝 |
| `external.digest` | 8 | `golden_vectors.json#hash_vectors`；`#dual_hash_vectors` 的 raw 与 intent，SHA-256 和 SHA3-256 |

一个最小的交互示例是零字节的 SHA-256，你可以针对 TypeScript 包装器运行它：

```bash
printf '%s' '{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","cases":[{"id":"c1","op":"digest","alg":"sha256","input_b64":""}]}' | node tools/conformance/wrappers/ts-sdk.mjs
```

对该请求的一个有效响应（包装器还会加上 `resolved_from` 和 `runtime`）：

```json
{"contract":"dcp-ai-conformance-external/1","run_id":"00000000-0000-4000-8000-000000000000","nonce":"00000000000000000000000000000000","implementation":{"name":"example","version":"0.0.1"},"results":[{"id":"c1","status":"ok","hex":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]}
```

- **封装：** 请求和响应都是 UTF-8 的 JSON。响应是 stdout 上恰好一个 JSON 文档，进程以退出码 0 结束。
- **请求：** `contract`、`run_id`、`nonce` 和 `cases`，每个用例包含 `id`、`op`（`profile` 为 `dcp-jcs-v1` 的
  `canonicalize`，或 `alg` 为 `sha256` 或 `sha3-256` 的 `digest`）和 `input_b64`。ID 每次运行随机生成，不发送任何
  预期值。canonicalize 的输入是 JSON 文本：`input_json` 向量按提交时的原样发送，`input` 值按 `JSON.stringify`
  的输出发送。
- **响应：** 相同的 `contract`、`run_id` 和 `nonce`；`implementation`（`name`、`version`，以及可选的
  `resolved_from` 和 `runtime`，均由实现自行声明）；以及 `results`，这是一个数组，每个用例恰好一个对象，每个对象
  带有该用例的 `id` 和一个 `status`：带 `output_b64`（规范字节）或 `hex` 的 `ok`，`code` 为 `parse` 或
  `profile` 的 `rejected`，带 `message` 的 `error`，或 `unsupported`。不接受其他任何字段。
- **编码：** `input_b64` 和 `output_b64` 是使用标准字母表、带填充且不换行的 RFC 4648 base64 规范形式；`hex`
  恰好是 64 个小写十六进制字符。
- **判定：** 字节按完全相等比较；必须被拒绝的向量只有被拒绝时才通过。`error` 或 `unsupported` 结果，格式错误、
  缺失、重复或多余的结果，过时的 `run_id` 或 `nonce`，无效输出，非零退出码或信号，超时，以及超过 4 MiB 的 stdout
  都是错误，绝不算通过。退出码与[契约](#contract)相同。
- **进程：** 不经 shell 启动，在 POSIX 上放入独立的进程组。只有一个期限（`--timeout-ms`，默认 30 000），用单调
  时钟计时；之后发送 SIGTERM，2 秒后发送 SIGKILL，并最多等待 2 秒让管道关闭（否则标记 `cleanup_incomplete`）。
  stderr 最多保留 64 KiB，且从不解析。
- **目录和测试数据** 会先经过校验：ID 唯一、指针存在、预期值与向量一致，并且每个集合的每个成员按操作和算法
  各固定一次。存在缺陷时退出码为 3。报告记录目录、测试数据和请求的哈希，并把实现自行声明的身份与运行器观察到的
  内容分开记录。
- **报告：** `--report` 的值缺失、看起来像选项或重复出现时，属于用法错误（退出码 2），并且由于路径不明确，不会写入
  任何报告。与上文的命令一样，如果 Node 无法启动、无法写入报告或运行器被终止，旧报告也可能保留。请始终先检查
  退出码，再检查报告中的 `run.id` 和 `status`。
- **包装器：** `wrappers/ts-sdk.mjs`（`@dcp-ai/sdk`；`--sdk <path>` 可选）和 `wrappers/python_sdk.py`（已安装的
  `dcp_ai`；请用 `-I` 运行）。二者都只调用一次真正的规范化函数，并且只对 SDK 文档所述的非整数拒绝返回
  `rejected`/`profile`。SDK 没有稳定的错误码，因此按类型和消息识别：如果它们变化，正确的拒绝会显示为错误，绝不会
  算作通过。CI 会运行这两个包装器。
- **限制：** 通过表明所运行的 argv 经由其使用的解析器通过了这 38 个用例；它不代表完整的 `dcp-jcs-v1` 实现或
  DCP 符合性，身份也只是自行声明。这不是沙箱：实现以你的权限和环境运行，离开进程组的后代进程（`setsid`）无法
  看到，在 Windows 上只会终止直接子进程。

<a id="go-rust-and-wasm-wrappers"></a>

### Go、Rust 和 WASM 包装器

另外三个包装器针对本检出副本中的 Go SDK、Rust SDK 以及 Rust SDK 的 WASM 构建，运行同样的 38 个用例和
同样的契约。`build.mjs` 把它们编译到 `tools/conformance/wrappers/.build/`（被 Git 忽略）；需要 Go 1.25 或更高
版本、Cargo，以及带 `wasm32-unknown-unknown` 目标的 `wasm-pack`，它不安装也不发布任何 DCP 软件包，也不改变 SDK 的清单或锁定
文件。不带 `--offline` 时，Cargo 和 `wasm-pack` 可能会把构建工具和固定的依赖下载到各自的缓存中；`--offline` 使用
`GOPROXY=off`、Cargo `--offline` 和 `wasm-pack --mode no-install`，并要求这些缓存已经准备好。

```bash
node tools/conformance/wrappers/build.mjs all
node tools/conformance/wrappers/build.mjs --offline go rust wasm
node tools/conformance-external.js -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-native.test.mjs
```

- **构建：** Go 以 `-mod=readonly` 针对包装器的 `go.mod` 和 `go.sum` 构建，其版本是 SDK 自身版本的子集；Cargo
  以 `--locked` 构建，原生包装器使用它自己的 `Cargo.lock`（SDK 锁定文件的副本，离线解析，固定的版本相同），WASM
  产物使用 SDK 的 `Cargo.lock`。`--offline` 只使用本地缓存。SDK 的清单和锁定文件不会改变。
- **Go**（`wrappers/go`）：输入必须是 UTF-8（先检查，因为 `encoding/json` 会替换无效字节），然后像 SDK 自己的
  interop 测试那样 `json.Unmarshal` 到 `interface{}`，再调用一次 `v2.CanonicalizeV2`；只有文档所述的拒绝
  （`non-integer float at`、`non-finite float at`）才是 `rejected`/`profile`。摘要：`v2.SHA256Hex`、
  `v2.SHA3256Hex`。版本报告为本地检出副本。
- **Rust**（`wrappers/rust`）：严格的 UTF-8 解码、`serde_json::from_str`，然后调用一次
  `dcp_ai::v2::canonicalize::canonicalize_v2`；只有文档所述的拒绝（路径前缀之后的 `Non-integer number in V2 canonical form:`、`Non-finite number in V2 canonical form:`）才是 `rejected`/`profile`。摘要：`sha256_hex`、
  `sha3_256_hex`。版本为 `DCP_SDK_VERSION`。
- **WASM**（`wrappers/wasm.mjs`）：加载 `wasm-pack` 以 `wasm` 特性（`--target web`）从 `sdks/rust` 编译出的真实
  `.wasm`，并报告其 SHA-256。原始 JSON 文本直接传给一次 `wasm_canonicalize_v2` 调用，JavaScript 中不使用
  `JSON.parse` 或 `JSON.stringify`（调用之前）；调用之后只检查输入和输出以标记歧义，不会重新计算
  字节。该导出函数在结果中以 `{"error": "…"}` 报告错误，而有效输入也可能产生同样的
  结果，因此当输入本身是唯一键为 `error` 的根对象（无论其值是什么类型）时，单键的 `{"error": string}` 结果是一个有歧义的 `error`；其他情况下，
  只有文档所述的消息才算拒绝。摘要导出函数接收文本：8 个摘要输入都是文本，不是 UTF-8 的字节是 `error`，绝不会
  被替换。
- **错误：** 在三者中，类型错误的请求（例如 `input_b64` 为数字或 `null`，或 `cases` 不是数组）都是无效的，包装器
  以 2 退出；文档所述拒绝之外的任何错误都是 `error`。未设置 `DCP_EXTERNAL_REQUIRE_NATIVE=1` 时，`node --test`
  会跳过未构建的部分并加以说明；设置后，缺少工具或产物即为失败。CI 从检出副本构建这三个包装器，并用每个包装器
  运行 38 个用例，因此在 CI 中五个包装器都是必需的。
- **限制：** WASM 包装器在 Node 中调用 wasm-bindgen 的原始导出函数：它不覆盖 `@dcp-ai/wasm` 软件包的
  JavaScript API（例如 `DcpClient`），也不覆盖浏览器。由于 SDK 没有稳定的错误码，拒绝的判定依赖消息文本；通过 WASM 时，根为单键的 `{"error": …}` 输入只有在导出
  函数返回 `{"error": string}` 封装时才是有歧义的错误（`{"error":5}` 仍为 `ok`）。通过只表明这 38 个用例在每个包装器上通过，仅此而已。
