<sub>[English](../../../../tools/conformance/README.md) · **中文** · [Español](../../../es/tools/conformance/README.md) · [日本語](../../../ja/tools/conformance/README.md) · [Português](../../../pt-BR/tools/conformance/README.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 一致性测试套件

> 本文是[英文版](../../../../tools/conformance/README.md)的参考译文，更新于 29/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

`tools/conformance.js` 针对仓库中已提交的 fixture 和向量，运行 [`catalog.json`](../../../../tools/conformance/catalog.json) 中声明的各个
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
[其 README](../../tests/nist-kat/README.md)）；它们同样在各 SDK 的测试套件中运行。`dcp-jcs-v2` 候选方案属于实验性质，不在 `dcp-jcs-v1` 范围内，有自己的测试集
（`tests/interop/candidate/`）。

<a id="external-implementations"></a>

## 外部实现

`tools/conformance-external.js` 针对你在 `--` 之后以 argv 指定的实现，运行一个单独的目录
[`external-catalog.json`](../../../../tools/conformance/external-catalog.json)（契约 `dcp-ai-conformance-external/1`）。实现可以用任何语言编写：
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
  以 2 退出；文档所述拒绝之外的任何错误都是 `error`。在 Rust 和 WASM 中，文档所述的数字拒绝通过一次线性扫描
  识别，不使用会回溯的正则表达式；UTF-8 长度超过 1 MiB 的消息是 `error`，绝不算拒绝（该上限只适用于这一判定，
  不适用于解析错误）。未设置 `DCP_EXTERNAL_REQUIRE_NATIVE=1` 时，`node --test`
  会跳过未构建的部分并加以说明；设置后，缺少工具或产物即为失败。CI 从检出副本构建这三个包装器，并用每个包装器
  运行 38 个用例，因此在 CI 中五个包装器都是必需的。
- **限制：** WASM 包装器在 Node 中调用 wasm-bindgen 的原始导出函数：它不覆盖 `@dcp-ai/wasm` 软件包的
  JavaScript API（例如 `DcpClient`），也不覆盖浏览器。由于 SDK 没有稳定的错误码，拒绝的判定依赖消息文本；通过 WASM 时，根为单键的 `{"error": …}` 输入只有在导出
  函数返回 `{"error": string}` 封装时才是有歧义的错误（`{"error":5}` 仍为 `ok`）。通过只表明这 38 个用例在每个包装器上通过，仅此而已。

<a id="evidence-catalog-merkle-and-signature-verification"></a>

### 证据目录：Merkle 与签名验证

`--catalog evidence` 选择一个可选目录 [`external-evidence-catalog.json`](../../../../tools/conformance/external-evidence-catalog.json)
（契约 `dcp-ai-conformance-external/2`，241 个用例），针对同类 argv 运行。默认目录、契约 `/1` 及其 38 个用例不变；
目录的 `contract` 决定其加载和判定方式。五个包装器都接受两种契约，并以请求的契约作答。
只使用已提交的公开 fixture：不生成任何密钥，也不签署任何内容。

```bash
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog evidence --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog evidence -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog evidence -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node tools/conformance-external.js --catalog evidence -- node tools/conformance/wrappers/wasm.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-evidence.test.mjs
```

| 套件 | 用例数 | 向量 |
|------|--------|------|
| `external.merkle.dual_root` | 6 | `tests/conformance/v2/merkle_vectors.json`：1、2、3、5 个叶子以及重新排序的叶子（`spec/VERIFICATION.md` V2-11），用 Python 标准库离线生成 |
| `external.signature.composite` | 24 | `interop_vectors.json`：复合签名和仅经典签名、已提交的攻击，以及对每个正例的确定性改动 |
| `external.v2.bundle_vectors` | 131 | `bundle_vectors.json`：已签名 bundle、其 38 个已提交的变异、9 个被接受的 bundle 和 79 个单独构建的被拒绝 bundle，以及 4 种模式下的仅经典例行 bundle |
| `external.v2.secondary_sha3` | 80 | `secondary_sha3_vectors.json`：被接受和被拒绝的用例，以及每个被拒绝用例已提交的对照 |

- **操作：** `dual_merkle_root` 接收 `leaves`（由小写 64 位十六进制字符串组成的 `{sha256, sha3_256}` 非空数组），
  以带 `sha256` 和 `sha3_256`（小写 64 位十六进制）的 `ok` 作答。
  `composite_verify` 接收 `context`、`payload_b64`（payload 的规范字节）、按原样提交的 `composite_sig`、
  `classical_public_key_b64` 和 `pq_public_key_b64`（或 `null`），以带 `valid` 和 `classical_valid`（布尔值）
  及 `pq_valid`（布尔值或 `null`）的 `ok` 作答。
  `verify_signed_bundle_v2` 接收 `bundle_b64`（已签名 bundle 的 JSON）、`policy`（验证器策略对象）和
  `verification_time`（带 `Z` 或偏移量的 RFC 3339），以带 `verified`（布尔值）和 `errors`（字符串数组）的 `ok` 作答。
  形状错误的请求（空叶子或大写叶子、不是字符串的叶子、没有时区的时间、未知字段）会使包装器以 2 退出。
- **判定：** 复合签名用例只比较 fixture 提交的字段；bundle 的结论必须一致，拒绝必须包含已提交的 `error_contains`
  （不区分大小写，针对拼接后的错误）。带错误的 `verified: true` 是 `contradictory_result` 错误。
  由于所有已提交的输入都能解析，`code` 为 `parse` 的 `rejected` 判为失败；`error` 和 `unsupported` 永远不算通过。
- **对照：** 反例只有在其对照通过时才计入，否则为 `control_failed`，属于错误。基准已签名 bundle 是其 38 个变异的对照；
  同一 payload 的正例是其改动和已提交攻击的对照；仅经典 bundle 的一个有效模式是其拒绝模式的对照；
  每个被拒绝的二级用例都有其已提交的对照。79 个 `must_reject_bundles` 没有逐用例对照：只有在基准和 9 个被接受的
  bundle 通过时才计入（套件级对照，保证较弱），并按其已提交的 `error_contains` 判定。
  报告给出每个用例的 `source`、`input_sha256` 和 `controls`。
- **缺少 PQ 签名：** 对没有 PQ 部分的 `pq_over_classical` 签名，Rust 的 `composite_verify` 返回错误，
  WASM 导出函数返回带内错误 `Signature error: pq_over_classical binding requires PQ signature`。
  这两个包装器只有在出现这一确切错误、且输入具有该绑定和 `pq: null` 时，才将其报告为 `code` 为
  `missing_pq_signature` 的 `rejected`。运行器只在 fixture 仅提交 `valid: false` 的位置（`stripping_pq_removal`）
  且其正例对照通过时接受它；对有效签名或任何其他反例给出同一代码都判为失败。
  TypeScript、Python 和 Go 对该用例以布尔值作答。
- **payload 改动**修改规范 payload 中第一个字符串值的最后一个字符，使 payload 仍是有效的规范 JSON
  （WASM 导出函数接收 payload 的 JSON），解析器错误永远不会被计为密码学失败。
- **时间：** 每个 bundle 用例都发送 `verification_time`：位于基准 bundle 及每个应通过验证的 bundle 有效期内的 2026-10-22T00:00:00Z（部分反例在该时刻有意处于已过期或尚未生效的状态），
  或二级向量已提交的时间。TypeScript 传入 `{ now }`，Python 传入 `now_ms`，Go 使用 `VerifySignedBundleV2At`，
  Rust 使用 `verify_signed_bundle_v2_at`。WASM 导出函数读取 `Date.now`，因此 WASM 包装器只在同步调用期间把
  `Date.now` 替换为该时刻，并在 `finally` 中恢复，调用抛出异常时也是如此；其 `runtime` 会说明这一点。
  自测表明每个包装器在 2020-01-01 拒绝基准 bundle、在 2026-10-22 接受、在 2100-01-01 拒绝，并表明异常之后的恢复。
- **经 WASM 的 Merkle：** 包装器使用从本 checkout 构建的 `wasm_dual_merkle_root`，它委托给 Rust 核心；
  `@dcp-ai/wasm` 2.1.1 及更早版本中发布的辅助函数在多叶子用例上失败（见 CHANGELOG）。
- **自测：** `external-evidence.test.mjs` 用五个包装器运行 241 个用例、时间证明、格式错误的请求，以及一个由
  TypeScript 包装器真实回答构建的伪实现：全部验证通过、全部拒绝、矛盾结果、错误的错误文本、忽略顺序或对十六进制文本
  做哈希的 Merkle 归约、失败的基准、在正确与错误位置出现的 `missing_pq_signature`，以及反例上的错误或 `unsupported`。
  被篡改的 fixture 和目录属于基础设施错误（退出码 3）。该目录的默认超时为 300 000 ms（`--timeout-ms`）。
  设置两个 `REQUIRE` 变量后，缺少包装器会判为失败而不是跳过；CI 运行全部五个。
- **局限：** 通过只表明所运行的 argv 通过这 241 个用例，仅此而已。策略为应用每个用例已提交的 `verifier_policy_overrides` 的
  `default_verifier_policy`，外加仅经典 bundle 的 4 种模式；不尝试其他策略。
  `composite_verify` 是给定绑定和密钥的原语，bundle 的结论不是准入、对委托人的信任或对行为的授权。
  `stripping_pq_with_downgrade` 按 `classical_valid` 和 `pq_valid` 判定；拒绝它属于 `hybrid_required` 策略。
  二级字段只在存在时检查，因此通过并不表明二级链完整。经 WASM 时，时间是被替换的宿主时钟。
  `error_contains` 字符串是 SDK 的诊断措辞，不具规范效力：`spec/VERIFICATION.md` 没有定义错误代码。
  这 146 个用例通过只表明与该措辞一致；判定相同但消息不同的验证器会在这些用例上失败，而仅凭该失败并不能说明判定错误。

<a id="admission-catalog-strict-v1-admission"></a>

### 准入目录：strict-v1 准入

`--catalog admission` 选择第二个选择性启用的目录 [`external-admission-catalog.json`](../../../../tools/conformance/external-admission-catalog.json)
（契约 `dcp-ai-conformance-external/3`，140 个用例），针对同类 argv 运行。它在已提交的
[`admission_vectors.json`](../../../../tests/interop/v2/admission_vectors.json) 上判定
[`spec/profiles/admission`](../../../../spec/profiles/admission/README.md) 的准入决定；目录用 SHA-256 固定该文件以及
`bundle_vectors.json`。契约 `/1` 和 `/2` 及其目录不变。TypeScript、Python、Go 和 Rust 包装器通过各自的 SDK 应答
`/3`；WASM 构建没有准入 API，因此其包装器拒绝 `/3`（exit 2），也没有任何东西模拟它。

```bash
node tools/conformance-external.js --catalog admission --list
node tools/conformance-external.js --catalog admission --report /tmp/admission-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog admission -- /path/to/python -I tools/conformance/wrappers/python_sdk.py
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/go-wrapper
node tools/conformance-external.js --catalog admission -- tools/conformance/wrappers/.build/rust-target/debug/dcp-ai-conformance-wrapper
node --test tools/conformance/external-admission.test.mjs
DCP_EXTERNAL_PYTHON=/path/to/python DCP_EXTERNAL_REQUIRE_PYTHON=1 DCP_EXTERNAL_REQUIRE_NATIVE=1 node --test tools/conformance/external-admission-wrappers.test.mjs
```

| 套件 | 用例 | 来源 |
|-------|-------|--------|
| `external.admission.outcomes` | 65 | `admission_vectors.json` 的结果向量 |
| `external.admission.config` | 71 | 其中 49 个被拒绝的配置、2 个带最大值的被接受配置文件，以及加载这些向量所用的 14 个信任集和 6 个配置文件 |
| `external.admission.composed` | 4 | 依据向量的输入写在目录中：没有信任集的配置文件、带调用方验证器策略的配置文件，以及两个按字母顺序会把代码排错位置的组合 |

- **操作：** `admit_signed_bundle_v2` 接收 `bundle_b64`、`now`、`profile`、`trust_set`、`verifier_policy` 和
  `revocation`，六个总是全部给出；`load_admission_config` 接收 `kind`（`trust_set` 或 `profile`）和 `config`。
  - `now` 必须正好是 `YYYY-MM-DDTHH:mm:ss.sssZ`，即 0001 年至 9999 年间真实存在的日期。这只是此传输的范围，不改变
    协议的任何时间戳。
  - `revocation` 在没有配置文件时为 `null`，否则为 `{"state": "unavailable"}`（没有快照，R1）或
    `{"state": "snapshot", "snapshot": {…}}`，其中是一个由 SDK 判定的对象，完整与否均可。它恰好在有配置文件时给出。
  - `profile`、`trust_set` 和 `verifier_policy` 是对象或 `null`。信任集和配置文件是运营方的配置，在请求中带外给出，
    绝不取自 bundle。没有配置文件时，请求携带完整的验证器策略：`default_verifier_policy` 的 14 个字段，加上
    `require_session_expiry: false`、`require_audience_binding: false` 和 `max_session_duration_seconds: 0`。有配置
    文件时不携带策略，只有检查其拒绝的那个用例例外。
  - 其他形式的请求会让包装器在调用 SDK 之前以 2 退出。
- **应答：** `ok` 正好包含 `verified`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、
  `action_authorized`、`recorded_decision`、`trust_set_version`、`codes`（`errors` 的代码，按发出顺序，保留重复）和
  `verification_verified`；对于配置为 `accepted: true`，对于配置文件还有它的两个最大值。`rejected` 只有在 SDK 抛出其
  带类型的配置错误时才携带 `CONFIG_*` 代码。`error` 和 `unsupported` 绝不算通过。
- **判定**，按以下顺序：
  - 字段类型（`malformed_result`）；
  - 由 spec/profiles/admission 推出的规则（`contradictory_result`）：`action_authorized` 为 `false`；`admitted` 恰在
    没有添加任何代码时成立；只有在有信任集且 bundle 通过验证时才评估委托人信任；
  - 精确的字段和代码集合；
  - 原始序列的顺序，按第 5.1 节和第 5.2 节的阶段，包括 P1、T1、R1 和 R2 的停止（`order`）；
  - 重复（`cardinality`）：只有适用于多个组件或主体的 P4、T2、R4 和 R5 可以重复其代码。

  被拒绝的配置以其 `allowed_codes` 之一通过：它自己的代码，或者对于有两个问题的三个信任集，两个适用代码中的任意一个
  （第 2.2 节）。配置文件按其有效最大值判定（第 4.1 节）。
- **对照：** 否定用例只有在其对照传递地通过时才计数；否则为 `control_failed`，即错误。
  - 29 个结果否定用例以同一 bundle 上的肯定用例为对照。
  - 19 个在其 bundle 上没有肯定用例，在套件层面对照，这是较弱的保证。
  - 配置拒绝以加载有效的信任集或配置文件为对照。
  - 组合用例以其组合的向量为对照。

  `--suite` 也会运行所选用例需要的对照，并报告它们（`controls_included`、`included_for_controls`）。
- **进程与错误：** 与 `/1` 和 `/2` 相同（run id、nonce、随机用例 id、进程组和限制）；此目录的默认超时为 300 000 ms。
  启动失败、非零 exit、信号、超时、过期的 id，或者格式错误、缺失、重复或多余的结果都是错误，绝不算拒绝或“未准入”。
  目录及其测试数据在加载时验证（固定的哈希、精确的键和类型、每个期望值与正文一致）；缺陷为 exit 3。
- **包装器：** 每个用例调用一次 SDK 的组合函数或加载函数，使用请求的 `now`，绝不使用系统时钟：
  `admitSignedBundleV2`、`createPrincipalTrustStore` 和 `resolveStrictV1Profile`（TypeScript）；
  `admit_signed_bundle_v2`、`create_principal_trust_store` 和 `resolve_strict_v1_profile`（Python）；
  `AdmitSignedBundleV2`、`NewPrincipalTrustStore` 和 `ResolveStrictV1Profile`（Go）；`admit_signed_bundle_v2`、
  `PrincipalTrustStore::from_json` 和 `resolve_strict_v1_profile`（Rust），使用 Ed25519 和 ML-DSA-65 提供者。只有带
  类型的错误才算拒绝：`AdmissionConfigError`（TypeScript、Python、Rust）或通过 `errors.As` 得到的
  `*AdmissionConfigError`（Go）。`DCP_CONFORMANCE_WRAPPER_FAULT` 仅供自测使用，只能把应答变成错误。
- **自测：**
  - `external-admission.test.mjs` 判定依据目录自身期望值构造的合成应答，不使用 SDK：错误的决定、顺序、基数、配置
    代码、基础设施失败，以及被篡改的目录和测试数据。
  - `external-admission-wrappers.test.mjs` 通过各自的 SDK 运行四个包装器：每个 140 个用例、请求的时钟（一个用例在
    三个时刻）、格式错误的请求、注入的失败、无法加载的实现、WASM 的拒绝，以及（通过 TypeScript）一个从 bundle 获取
    信任的 SDK。

  CI 运行这两者，四个包装器均为必需。
- **局限：**
  - **通过表明什么。** 所运行的 argv 通过这 140 个用例，仅此而已。准入绝不是授权：`action_authorized` 始终为
    `false`。
  - **一种投影。** 应答是准入结果的投影。其中内含的验证（其错误、警告、详情、`signer_keys`、模式和层级）不作判定；
    `verification_verified` 由实现自己报告。
  - **带类型的错误。** 拒绝按其代码判定。它是否来自 SDK 带类型的错误，由包装器而非运行器看到。
  - **较弱的保证。** 19 个套件层面的对照，以及写在目录而非向量中的 4 个组合期望值。
  - **此目录之外。** 适配器、信任与吊销来源、TLS、租户、缓存和一次性使用。语料是已提交的向量和这四个组合，而不是
    任意输入。
