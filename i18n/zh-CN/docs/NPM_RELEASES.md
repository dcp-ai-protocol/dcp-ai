<a id="published-npm-packages"></a>

# 已发布的 npm 软件包

> [英文版](../../../docs/NPM_RELEASES.md)的参考译文，更新于 09/11/2026。如有差异，以英文版为准。

于 09/11/2026 核实：`@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0 和 `@dcp-ai/cli` 2.2.0 已以 `latest` 标签发布；下方其他十个包没有变化（[更新内容](#what-changed-on-09112026)）。05/11/2026 以 `latest` 标签发布了 `@dcp-ai/sdk` 2.3.0 和 `@dcp-ai/wasm` 2.1.3（[更新内容](#what-changed-on-05112026)），28/10/2026 发布了 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1 和 `@dcp-ai/cli` 2.1.1。包版本独立于 DCP 传输格式/规范版本和仓库标签。

2026 年 10 月 26 日，13 个版本使用 `latest` 标签发布：`@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` 2.1.0、`@dcp-ai/cli` 2.1.0 以及仍列在表中的十个软件包。注册表中的完整性值与经过测试的 tarball 一致，从 npm 全新安装后通过了 383 项检查。

| 软件包 | 版本 |
|---|---|
| [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) | 2.4.0 |
| [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.2.0 |
| [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.2.0 |
| [`@dcp-ai/anthropic-mcp`](https://www.npmjs.com/package/@dcp-ai/anthropic-mcp) | 2.1.0 |
| [`@dcp-ai/autogen`](https://www.npmjs.com/package/@dcp-ai/autogen) | 2.0.1 |
| [`@dcp-ai/express`](https://www.npmjs.com/package/@dcp-ai/express) | 2.1.0 |
| [`@dcp-ai/google-a2a`](https://www.npmjs.com/package/@dcp-ai/google-a2a) | 2.1.0 |
| [`@dcp-ai/openclaw`](https://www.npmjs.com/package/@dcp-ai/openclaw) | 2.1.0 |
| [`@dcp-ai/w3c-did`](https://www.npmjs.com/package/@dcp-ai/w3c-did) | 2.0.1 |
| [`@dcp-ai/create-crewai`](https://www.npmjs.com/package/@dcp-ai/create-crewai) | 2.0.1 |
| [`@dcp-ai/create-express`](https://www.npmjs.com/package/@dcp-ai/create-express) | 2.0.1 |
| [`@dcp-ai/create-langchain`](https://www.npmjs.com/package/@dcp-ai/create-langchain) | 2.0.1 |
| [`@dcp-ai/create-openai`](https://www.npmjs.com/package/@dcp-ai/create-openai) | 2.0.1 |

<a id="what-changed-on-28102026"></a>

## 2026 年 10 月 28 日的更新内容

`@dcp-ai/sdk` 2.2.1 和 `@dcp-ai/wasm` 2.1.1 会在 [VERIFICATION.md 的 V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的可选二级 SHA3-256 字段存在时验证它们：不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链；存在的字段如果是 `null`、不是字符串或不一致，则被拒绝。`@dcp-ai/cli` 2.1.1 需要 `@dcp-ai/sdk` `^2.2.1`，`--version` 显示 `2.1.1`。API、结果字段、`dcp-jcs-v1`、实验性且需显式启用的 `dcp-jcs-v2` API 以及 `hash_alg` 的处理均不变。 已发布的适配器 `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0 没有重新发布：它们依赖 `@dcp-ai/sdk` `^2.2.0`，当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时即获得二级检查。

注册表中的三个 tarball 与审核过的产物逐字节一致，`sha512` 完整性值相符。一个不使用本地覆盖、从 npm 全新安装的使用方通过了 411 项二级 SHA3-256 判定和 87 项对照、340 项回归检查以及 80 项 CLI 检查（`--version` 2.1.1）；注册表中的 `@dcp-ai/wasm` 软件包在真实浏览器中通过了 167 项检查。

<a id="install-the-published-versions"></a>

## 安装已发布的版本

```bash
npm install @dcp-ai/sdk@^2.4.0
npm install @dcp-ai/wasm@^2.2.0
npm install @dcp-ai/express@^2.1.0 express
npx --package=@dcp-ai/cli@2.2.0 dcp-ai --help
```

每次 npm 发布仅涵盖 npm，不包括 PyPI 上的 Python 包、crates.io 上的 Rust crate、Go 模块标签或容器镜像。在这些生态中使用检出源码的示例前，请查看各 SDK 的发布状态。仓库根目录仍使用本地 SDK 测试检出的源码；这是开发上的选择，并非 npm 可用性限制。

自 2.2.0 起，`@dcp-ai/sdk` 包含委托人信任、`strict-v1`、验证器修复和候选方案的实验性 API。`@dcp-ai/express` 和 `@dcp-ai/openclaw` 2.1.0 包含修复后的 V2 签名验证和文档所述准入控制。其 2.0.0 版本仍受影响；见 [SECURITY.md](../../../SECURITY.md)。发布软件包并不会让已验证的 bundle 自动获得信任，也不会授权任何操作。

在 `@dcp-ai/sdk` 2.2.0 及更高版本和 `@dcp-ai/wasm` 2.1.0 及更高版本中，`dcp-jcs-v2` 仍是实验性、非规范性且需显式启用的功能。`dcp-jcs-v1` 仍是唯一的规范性默认配置。生成器和桥接辅助函数保留 README 中的限制；发布它们不会把演示流程变成生产验证器。

<a id="what-changed-on-05112026"></a>

## 2026 年 11 月 5 日的更新内容

`@dcp-ai/sdk` 2.3.0 和 `@dcp-ai/wasm` 2.1.3 于 05/11/2026 发布，使用的是发布前测试过的 tarball。它们取代了下面 30/10/2026 的 `@dcp-ai/wasm` 2.1.2 候选版本，该版本从未发布。

`@dcp-ai/sdk` 2.3.0 与 2.2.1 相比：

- **V2-2 模式校验（接受范围变化）。** `verifySignedBundleV2`、组合准入 API 和实验性候选验证器在任何哈希、密钥或签名检查之前，先按 `schemas/v2` 校验已签名 bundle 的信封和四个载荷。以前被接受的模式无效 bundle（例如封闭对象中的未知成员，或清单中为 `null` 的会话时间）现在会返回 `verified: false` 并附带 `schema: <pointer> <keyword>` 诊断。
- **授权书。** `verifyMandateValidity` 采用统一的约定，并接受可选的 `now`；以前被接受的缺失或格式错误的日期现在无效。`verifyMandateChain` 以同一方式读取所有时间，并拒绝重复某个领域的根授权书。
- **`VerificationCache`。** 新增显式启用的 `context` 和 `agentIds` 选项。无效选项会抛出异常；`set` 和 `get` 复制结果；条目在单调时钟上恰好到达其 TTL 时过期；`invalidateByAgent` 现在会删除条目。

`@dcp-ai/wasm` 2.1.3 与 2.1.1 相比：

- **`dualMerkleRoot` 遵循 V2-11（接受范围变化）。** 它和直接导出的 `wasm_dual_merkle_root` 使用 `verifyBundle` 已在使用的 [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 归约（原始 32 字节摘要，奇数层复制最后一个节点）计算双 Merkle 根。2.1.1 及更早版本对十六进制文本做哈希，并把奇数层的最后一个节点原样上移，因此两个或更多叶节点时的根不同。不是 32 字节十六进制摘要的叶节点现在会报错，根以小写形式返回。
- **V2-2 模式校验（接受范围变化）。** `verifyBundle` 和 `wasm_verify_signed_bundle_v2` 在任何哈希、密钥或签名检查之前，先按 `schemas/v2` 校验信封和四个载荷。
- **不新增 JavaScript API。** WebAssembly 来自同样于 05/11/2026 发布的 Rust `dcp-ai` 2.13.0 源代码（见 [Rust](../../../docs/RUST_RELEASE.md)）。

两个包都保持传输格式、签名、配置文件、作为规范默认值的 `dcp-jcs-v1` 以及实验性显式启用的 `dcp-jcs-v2` API 不变，并且都包含 Apache-2.0 `LICENSE`。每个已发布 tarball 中的 README 是发布前准备的版本：写着“prepared, not published”，而且 WASM README 中哈希操作表里 `dualMerkleRoot` 那一行仍写着“Prepared for 2.1.2”。已发布的 tarball 无法更改；本页和仓库中的 README 描述已发布的版本。

注册表中 `@dcp-ai/sdk` 2.3.0 和 `@dcp-ai/wasm` 2.1.3 的 tarball 与测试过的制品逐字节相同，`sha512` 完整性也相同。一个全新的使用方在不使用 override 的情况下从 npm 安装它们，通过了外部一致性套件（SDK 为七个目录中的 697 个用例，`@dcp-ai/wasm` 为其支持的五个目录中的 460 个用例），由该安装提供的 WASM 包在浏览器中通过了 14 项检查。

<a id="migrating-dualmerkleroot-results"></a>

### 迁移 `dualMerkleRoot` 的结果

这项修正改变的是该函数计算出的根，而不是你已经持有的证据：

- **按原样保留历史证据。** 用 `@dcp-ai/wasm` 2.1.1 或更早版本计算的根，以及携带这些根的任何 bundle、签名、锚定或日志条目，都按记录保留。不要用 2.1.3 重新计算并替换已存储的值以使其一致：那会改写已签名或已锚定的证据，并使其签名失效。
- **记录每个根是由哪个版本计算的。** 2.1.1 或更早版本对两个或更多叶节点得出的根，不是相同叶节点的 V2-11 根。要检查它，请用生成它的版本重新计算，或在它旁边计算 V2-11 根并保留两个值。
- **新的根**由 2.1.3 或其他已遵循 V2-11 的 SDK 计算。bundle 验证使用的 Merkle 归约没有变化；`verifyBundle` 本来就使用 V2-11。上面所述的新 V2-2 模式检查则确实改变了接受范围。

<a id="cli-and-adapters"></a>

### CLI 和适配器

`@dcp-ai/cli` 和 npm 适配器没有新版本。它们已发布的版本范围（CLI 为 `^2.2.1`，适配器为 `^2.2.0`）接受 `@dcp-ai/sdk` 2.3.0。它们经过两次检查：发布之前，从 npm 安装，并通过 override 将 `@dcp-ai/sdk` 解析为候选版本；发布之后，从 npm 安装且不使用任何 override，它们自己的版本范围从注册表解析出唯一的 `@dcp-ai/sdk` 2.3.0，其完整性与测试时相同。两次检查的内容都是：

- **做了功能检查：** `@dcp-ai/cli` 2.1.1（`--version`、一个有效的 V2 bundle，以及一个模式无效的 bundle，后者在 SDK 运行之前就被 CLI 自己的模式检查拒绝），以及 `@dcp-ai/express` 和 `@dcp-ai/openclaw` 2.1.0（针对其准入和验证修复的回归检查）。
- **只检查了安装：** `@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a`（只解析出一个 `@dcp-ai/sdk` 2.3.0、接受的版本范围以及入口点的导入），以及不依赖 SDK 的包（入口点可以解析）。这不是集成测试。

<a id="prepared-not-published-dcp-aiwasm-212"></a>

## 已准备、尚未发布：`@dcp-ai/wasm` 2.1.2

`@dcp-ai/wasm` 2.1.2 已于 30/10/2026 在仓库中准备好，但尚未在 npm 发布。准备时，表格和安装命令仍为当时注册表中的版本；当前的版本见上文。

它修正了 `dualMerkleRoot` 和原始导出 `wasm_dual_merkle_root`：它们现在按 `verifyBundle` 早已使用的 [VERIFICATION.md 的 V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 归约计算双 Merkle 根（使用 32 字节原始摘要，奇数层复制最后一个节点）。2.1.1 及更早版本对十六进制文本做哈希，并把奇数层的最后一个节点原样上移，因此两个或更多叶节点的根与 V2-11 不同。2.1.1 及更早版本接受的格式错误的叶节点现在会返回错误：每个叶节点都必须是 32 字节十六进制摘要。接受大写十六进制，根以小写返回。空数组给出与之前相同的错误（`dualMerkleRoot` 抛出异常），结果仍保留 `sha256` 和 `sha3_256` 两个字段。

`verifyBundle`、其他 API、`dcp-jcs-v1` 以及实验性且需显式启用的 `dcp-jcs-v2` API 均不变，也没有新增 JavaScript API。tarball 不再包含翻译版 README，它们现在位于仓库的 `i18n/` 目录树中。其中的 WebAssembly 来自 Rust `dcp-ai` 2.12.0，同样已准备、尚未发布（见 [Rust](../../../docs/RUST_RELEASE.md)）。

> **说明（05/11/2026）。** 上面几段写于 30/10/2026，针对已准备的 2.1.2，该版本从未发布。自 #116（02/11/2026）起，`main` 上的 `verifyBundle` 在其封装的 Rust 核心中执行 V2-2 模式校验；2.1.2 不包含这一更改，上面的 2.1.3 包含。2.1.3 取代 2.1.2，`main` 上的清单文件带有 2.1.3。提到 2.1.2 的文字和表格（包括 WASM README 中 `dualMerkleRoot` 那一行）属于历史记录。见[审计资料](../../../docs/conformance/AUDIT_DOSSIER.md#artifacts)。

<a id="what-changed-on-09112026"></a>

## 2026 年 11 月 9 日的更新内容

`@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0 和 `@dcp-ai/cli` 2.2.0 于 09/11/2026 发布，使用的是发布前测试过、从 `main`（`cdb7099b`）构建的 tarball；它们在注册表中的 `sha512` 完整性与测试时相同。一个新的使用方按名称和版本从 npm 安装这三个包，并安装 `@dcp-ai/express` 2.1.0，没有使用 `file:` 或 overrides，为 CLI 和适配器解析到同一个 `@dcp-ai/sdk` 2.4.0，其 API、CLI 和 WASM 结果与测试过的 tarball 相同。

- **`@dcp-ai/sdk` 2.4.0：** 显式启用的委托准入、从字节准入和委托书确认；Ed25519 接受范围变化 P-ED-1（[变更日志](../../../CHANGELOG.md#unreleased)）。
- **`@dcp-ai/wasm` 2.2.0：** 区分错误与值（`canonicalize`、`hashObject`、`deriveKid`）、Rust 提供方中的 P-ED-1，以及不含构建者本地路径的二进制文件；没有准入或委托书链 API。
- **`@dcp-ai/cli` 2.2.0：** `dcp-ai verify` 中的 P-ED-1、`@dcp-ai/sdk` `^2.4.0`、包中的 `LICENSE`，以及从 `package.json` 读取的版本；参见[CLI 指南](../cli/README.md)。
- 适配器没有新版本；新安装时它们的 `^2.2.0` 范围会解析到 `@dcp-ai/sdk` 2.4.0，并随之应用 P-ED-1。`@dcp-ai/express` 2.1.0 保留其已发布的文件，其中不含 `LICENSE`；添加到 `integrations/express` 的文件仅存在于仓库中。

<a id="related-releases"></a>

## 相关发布

各注册表中的当前版本见[已发布版本](../../../docs/README.md#published-versions)。其他发布说明：[Python 2.11.0](../../../docs/PYTHON_RELEASE.md)、[Go v2.14.0](../../../docs/GO_RELEASE.md)、[Rust 2.14.0](../../../docs/RUST_RELEASE.md)。
