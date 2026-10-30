<sub>[English](../../CHANGELOG.md) · **中文** · [Español](../es/CHANGELOG.md) · [日本語](../ja/CHANGELOG.md) · [Português](../pt-BR/CHANGELOG.md)</sub>

<a id="changelog"></a>

# 变更日志

> 本文是[英文版](../../CHANGELOG.md)的参考译文，更新于 29/10/2026。每个条目（包括 `[Unreleased]` 下的条目）描述的是当时所作的变更，并不保证当前行为；已发布的各版本是**带日期的历史记录**。如有出入，以英文版为准。

**已发布版本（2026 年 10 月 26 日）。** npm（13 个软件包，包括 `@dcp-ai/sdk` 2.2.0）、Python `dcp-ai` 2.10.0、Go `v2.11.0` 和 Rust `dcp-ai` 2.11.0 均已发布，包含验证器修复、准入功能和实验性的选择启用 API；`dcp-jcs-v1` 仍是规范性默认值。见[已发布版本](../../docs/README.md#published-versions)。以下条目保留开发历史；`[Unreleased]` 不表示这些功能尚未发布。2026 年 10 月 28 日的六个修复版本见[单独的章节](#2026-10-28-sha3-patch-releases)。

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)。

> **参考性说明（2026 年 10 月 25 日）。** 每个条目都按变更当时的情况描述该变更，`[Unreleased]` 下陆续添加的条目也是
> 如此；其中较晚的条目可能细化或取代较早的条目。条目既不保证当前行为，也不保证某个包版本可在注册表中获取。关于
> 当前行为，请参阅 [README](../../README.md)、[文档](../../docs/README.md)、[规范](../../spec/README.md)和
> [API 参考](../../docs/API_REFERENCE.md)。

<a id="2026-10-28-sha3-patch-releases"></a>

## [2026-10-28] SHA3 修复版本

发布于 2026 年 10 月 28 日：npm 上的 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1 和 `@dcp-ai/cli` 2.1.1，PyPI 上的 `dcp-ai` 2.10.1，Go 模块 `v2.11.1`（标签 `sdks/go/v2.11.1`），以及 crates.io 上的 Rust `dcp-ai` 2.11.1。其他十个 npm 软件包不变。见[已发布版本](../../docs/README.md#published-versions)以及 [npm](../../docs/NPM_RELEASES.md)、[Python](../../docs/PYTHON_RELEASE.md)、[Go](../../docs/GO_RELEASE.md) 和 [Rust](../../docs/RUST_RELEASE.md) 的发布说明。

<a id="secondary-sha3-256-verification"></a>

### 二级 SHA3-256 验证

- **接受范围变更：存在的二级 SHA3-256 字段会被验证**（开发于 2026 年 10 月 27 日）。 TypeScript、Python、
  Go 和 Rust 的 V2 验证器，以及基于 Rust SDK 构建的 WASM，现在按 `spec/VERIFICATION.md` 的 V2-11 及其 2026 年 10 月
  27 日的勘误，检查 `audit_merkle_root_secondary`（按主树方式构建的 SHA3-256 树；空记录为 `sha3-256:` 后接 64 个零）、
  每个 `prev_hash_secondary`（第一个条目为 `"GENESIS"`，之后为 bundle 中原样的前一条目的 SHA3-256）以及每个
  `intent_hash_secondary`（意图载荷的 SHA3-256）。不存在的字段不作要求，因此已验证的 bundle 仍可能没有完整的二级链；
  存在的字段如果是 `null`、不是字符串或不正确，则被拒绝。准入和实验性候选路由复用这些检查；API、结果字段、规范化和
  `hash_alg` 的处理均不变。`prev_hash_secondary` 的模式也接受 OpenClaw 在第一个条目中写入的 `"GENESIS"`。共享向量：
  `tests/interop/v2/secondary_sha3_vectors.json`。更早的版本不检查这些字段。 已发布的适配器 `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a` 2.1.0 没有重新发布：它们依赖 `@dcp-ai/sdk` `^2.2.0`，当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时即获得二级检查。

<a id="package-metadata"></a>

### 软件包元数据

- `@dcp-ai/cli` 2.1.1 需要 `@dcp-ai/sdk` `^2.2.1`，`dcp-ai --version` 显示 `2.1.1`，而不再是过时的 `1.0.0`。
- 遥测报告新版本：Go 的 `SDKVersion` 为 `2.11.1`；TypeScript、Python 和 Rust SDK 读取各自软件包的版本。

## [Unreleased]

<a id="security"></a>

### 安全

- **TypeScript 的 `VerificationCache`（`main` 上的源代码，尚未发布；
  `@dcp-ai/sdk` 2.2.1 保持此前的行为）。** 对现有调用，缓存键仍是 bundle 哈希；
  由调用方选择的可选 `context` 用带标签的内部键分隔结果，旧式哈希无法与之冲突。
  原先不删除任何内容的 `invalidateByAgent`，现在会删除通过新的 `agentIds` 选项与该智能体关联存储的条目，以及所有未带该选项存储的条目。
  替换条目时不再把旧的 kid 留在索引中（在默认上限下，索引会无限增长），也不再驱逐其他条目；
  `result.details.signer_keys` 中的 kid 也会建立索引；
  以 `''` 为哈希不再使 `maxEntries` 失效。
  **接受范围变更：** 无效选项（`NaN`、`Infinity`、负数或非数字的 TTL，超过 `Number.MAX_SAFE_INTEGER` 的 TTL，不是 1 到 `Number.MAX_SAFE_INTEGER` 之间安全整数的 `maxEntries`）会抛出错误，而不再使过期或上限失效；
  `set` 复制结果，`get` 每次命中都返回新的副本；
  条目恰好在 TTL 到期时过期，除挂钟外还用单调时钟计时，因此时钟回拨不再延长其寿命；TTL 为 0 的条目从不存储；
  `set` 会校验参数（`signerKids` 或 `agentIds` 中的空位按 `undefined` 处理），抛出错误时不改变任何内容。
  命中仍不会重新验证证据或信任，也不是准入；不会自动使任何条目失效。
  见 [API_REFERENCE.md](../../docs/API_REFERENCE.md#verificationcache)。
- **接受范围变更：现在会拒绝 S >= L 的 Ed25519 签名。** 涉及 TypeScript SDK
  （`Ed25519Provider.verify`，因而包括所有 V2 签名和复合签名、`@dcp-ai/express` 和
  `@dcp-ai/openclaw`；以及 `verifyObject`，因而包括 `verifySignedBundle` V1）和参考验证方
  （`tools/crypto.js`，因而包括 `lib/verify.js` V1、`bin/dcp.js`、一致性测试和透明度日志的
  gossip）。RFC 8032 §5.1.7 要求 0 <= S < L，而 TweetNaCl 不检查这一点，因此它会接受 S + k·L，即有效签名的另一种
  编码（§8.4，可延展性）。Python、Go 和 Rust 早已拒绝这类签名。TweetNaCl 仍然是验证方：只对它接受的输入检查
  该范围，因此它对错误类型、大小和 base64 的报错不变，对密钥和 R 的解码以及对弱密钥的接受也不变。签名方产生的是
  S < L，因此任何新生成签名的判定都不会改变；早期版本接受过的 S >= L 的已存储签名不再验证通过。仓库清点只在
  有意构造的负向审查语料中发现了这类签名；清点不涵盖外部存储的证据。在此变更之前验证过的证据不会自动重新签名：
  请把它们连同哈希和验证它们的版本作为历史记录保存，或者重新签名。
- **同样的接受范围变更也适用于 `dcp-ai verify`（`@dcp-ai/cli`）和 playground**，它们之前直接调用
  TweetNaCl。`dcp-ai verify` 在其对 `signature.sig_b64` 的 V1 检查中自行检查 S < L，V2 bundle 则从其现在使用的
  `@dcp-ai/sdk` 验证方获得这项检查（见“变更”）。历史上的 `signature.classical.value` 路径在加入时也有这项检查；
  该路径后来已被删除，其格式会被拒绝。playground 在 `verifyDetached` 中进行检查。该检查来自 SDK，只对 TweetNaCl
  接受的输入进行，因此其报错不变。
- 四个 V2 验证方对有效签名的非规范编码判定不一：对于填充后的多余数据、多余的填充、中间的换行、置位的尾部比特或
  没有填充，TypeScript 接受所有变体，Python 和 Go 接受其中一部分，Rust 一个也不接受。现在每个 `sig_b64` 都必须是
  规范 base64（`spec/VERIFICATION.md` V2-5），因此一个签名只有一种编码，所有 SDK 解码出相同的字节；13 个新的
  `must_reject` 向量覆盖了这一点。
- 四个 SDK 的 V2 验证方接受了仅凭签名可以通过、但协议并不允许的 bundle。这由一次外部审查报告，并经我们自己的
  审查确认；在 2.2.0 发布到 npm 之前，参考验证方 `lib/verify.js` 通过工作区 SDK 运行已修复的验证方
  （见“变更”）。
  - **任何代理都能冒认任何主体。** bundle 签名除了用 RPR 的 `binding_keys` 外，也能用护照密钥验证，而代理会签署
    自己的护照。把一份已发布且已签名的 RPR 与新的护照和密钥配对，无需主体的私钥就能得到一个验证通过的 bundle。
    现在 bundle 签名只用 RPR 的 `binding_keys` 验证（`spec/VERIFICATION.md` V2-6），因此把代理绑定起来的是
    主体对清单的签名，而该清单承诺了 `passport_hash`。
  - **kid 没有与其密钥核对。** 一个密钥列表可以为自己的密钥冒用另一方的 kid。现在每个用于验证签名的 kid 都必须由
    其密钥派生，且密钥必须是规范 base64，使所有 SDK 解码出相同的字节（V2-13）。
  - **已签名但不一致的 bundle 能够验证通过。** 例如已撤销或已退役的护照、已过期的 RPR、针对另一个意图的策略决定，
    以及属于另一个意图、代理或主体、带有另一个 `intent_hash` 或未记录策略决定的审计条目。V1 的检查现在成为
    V2-14：护照为 `active` 或 `declining`，RPR 未过期，且每个工件都指向同一个主体、代理和意图。被升级或被阻止的
    行动仍然是有效证据。
  - **会话时长上限读取了未签名的字段。** `max_session_duration_seconds` 是从已签名清单之外的
    `signature.created_at` 开始计算的。清单有一个新的 `session_issued_at`，由 `signBundleV2` 和 `sign_bundle_v2`
    与 `session_expires_at` 一起写入；上限从该字段开始计算，设有上限时，没有该字段的 bundle 会被拒绝（V2-4）。
    它比验证方时钟超前的时间不得超过 30 秒，设有上限时，没有 `session_expires_at` 的 bundle 也会被拒绝。所有 SDK 都以
    毫秒精度比较时间戳。在没有最长会话时长的策略下，此变更之前签名的 bundle 仍像以前一样验证。
  - **未签名的签名块可能与签名相矛盾。** 现在 `signature.signer.id` 必须是 RPR 的 `human_id`，
    `signature.signer.kids` 必须是复合签名的 kid，`manifest_hash` 必须是清单的哈希，`hash_alg` 必须是 schema
    允许的两种之一。`signBundleV2` 和 `sign_bundle_v2` 会拒绝与 RPR 的 `human_id` 不同的签名者 id；Go 的
    `SignBundleV2` 和 Rust 的 `sign_bundle_v2` 本来就从 RPR 中获取它。
  - **PQ 检查点没有被验证。** Merkle 根或 PQ 签名被改动的检查点，或清单列出但缺失的检查点，都能验证通过。现在
    bundle 必须恰好携带所列出的检查点，每个都覆盖自己的审计条目，并由代理用两种算法签署（V2-12）。
  - Go 和 Rust 验证方接受了没有 `session_nonce` 的工件或审计条目；现在它们都必须携带清单的 nonce，与 TypeScript
    和 Python 一致。
  - `tests/interop/v2/bundle_vectors.json` 中的新向量，每个都针对单一缺陷签名：35 个 `must_reject_bundles`
    用例、4 个针对未签名签名块的 `must_reject` 变异，以及 8 个 `must_accept_bundles` 对照。用例可以带有
    `verifier_policy_overrides`。
  - `lib/verify.js` 在 RPR 的 `binding_keys` 中固定 `dcp verify-bundle` 的密钥，签名 kid 下的每个条目都必须带有
    该固定密钥，因此即使使用会先在护照中查找签名者的已发布 SDK 2.1.1，固定依然有效。
- `@dcp-ai/express`（`dcpVerify`）、`@dcp-ai/openclaw`（`dcp_verify_bundle`）和 Python 的 FastAPI 中间件
  （`dcp_ai.fastapi.DCPVerifyMiddleware`）在不验证任何签名的情况下接受 V2 已签名 bundle：它们只检查 bundle
  的结构和会话 nonce（FastAPI 中间件还会根据 `binding` 字段设置 `composite_sig_valid`），因此未签名或伪造的
  bundle，或签名后意图被修改的 bundle，都会被报告为已验证。现在三者都使用 SDK 验证方（`@dcp-ai/sdk` 的
  `verifySignedBundleV2`、`dcp_ai.v2` 的 `verify_signed_bundle_v2`）和 Ed25519 / ML-DSA-65 / SLH-DSA-192f
  注册表，在 `DEFAULT_VERIFIER_POLICY` 之上叠加所配置的策略来验证每个 V2 bundle（`verifierPolicy`；
  `verifier_policy`，即 `DCPVerifyMiddleware` 的新参数；以及下文所述 OpenClaw 的运营方策略）。`requireHybrid`
  会把低于 `hybrid_required` 的每个风险层级提升到该模式（运营方的 `pq_only` 仍为 `pq_only`），没有
  `risk_overrides` 的 `default_mode` 适用于所有层级。验证方的错误和警告会被返回，`composite_sig_valid` 也来自
  验证方。在 `@dcp-ai/sdk` 2.2.0 发布到 npm 之前，两个 TypeScript 包都依赖工作区 SDK
  （`"@dcp-ai/sdk": "file:../../sdks/typescript"`），其验证方包含上述修复；CI 在测试它们之前先构建该 SDK，
  三者都在各自的 `verifier_policy_overrides` 下通过了 `tests/interop/v2/bundle_vectors.json` 的所有用例。发布
  它们之前需要先把依赖提升到 `^2.2.0`：`publish-integrations.yml` 现在会拒绝依赖本地路径的包。
- 同样这三个验证方会把所有未被识别为 V2 的 bundle 交给 V1 验证方，而不管验证方策略如何：V1 bundle（一个
  Ed25519 签名，没有后量子签名）能够通过 `requireHybrid` 或 `hybrid_required` 策略，版本无法识别的 bundle 会被
  当作 V1 尝试。现在只有在 VERIFICATION.md V2-10 会接受仅经典签名 bundle 的情况下才接受 V1 bundle：
  `allow_v1_bundles` 为真，`requireHybrid` 关闭，并且 V1 护照 `risk_tier` 对应的策略模式与 V1 意图和策略决定的
  安全层级模式（V1 的 `risk_score` 取值 0 到 1，乘以 1000；缺失时按 `elevated` 计）中更严格者为
  `classical_only` 或 `hybrid_preferred`。在 `DEFAULT_VERIFIER_POLICY` 下，V1 一致性 bundle（standard 层级的
  `send_email`）通过，而把意图换成 `initiate_payment` 的同一 bundle 会被拒绝。版本无法识别的 bundle 会被拒绝。
- `@dcp-ai/openclaw`：`dcp_verify_bundle` 从调用它的模型所控制的工具参数 `verifier_policy` 中获取验证策略，
  并在失败结果中返回未验证 bundle 的 `agent_id` 和 `human_id`。现在策略由运营方决定（`register(api,
  { verifierPolicy })` 或新的 `configureVerifier`，叠加在 `DEFAULT_VERIFIER_POLICY` 之上）；该参数只能使策略
  更严格（每个层级只能换成更严格的模式，将 `pq_only` 与其他任一模式组合时，结果为 `hybrid_required`，使模型无法去掉
  运营方要求的经典签名；`require_*` 只能开启，`allow_v1_bundles` 只能关闭，其他任何字段都会报错）。结果会回显
  `verification_mode`，并且只有在 bundle 验证通过时才指明代理、主体和会话。
- `@dcp-ai/express`：判定缓存以 `signature.composite_sig` 为键，并由所有中间件共享，因此携带已缓存签名的另一个
  bundle，或策略更严格的中间件，会复用“已验证”的判定；缓存还会无限增长，并且在会话或某个密钥过期、或代理被
  撤销之后，仍在整个 TTL 内保留判定。现在每个中间件都有自己的缓存，键是 bundle 规范形式的 SHA-256
  （`canonicalizeV2`；没有规范形式的 bundle，例如包含 `1e999`、而 `JSON.stringify` 会把它输出成类似 `null` 的
  bundle，会被验证但不缓存），最多保存 `cacheMaxEntries`（新增，默认 1000）个 bundle，最久未使用的最先淘汰；
  条目在以下时间中最早的那个到期：TTL、清单的 `session_expires_at`、RPR 的 `expires_at`，以及每个护照密钥和
  每个 RPR 绑定密钥的 `expires_at`。深度嵌套的 bundle 不再导致 500。
- `@dcp-ai/express`：`checkRevocation` 只查询代理及其护照密钥，并且会悄无声息地失败开放。现在它在每个请求中
  （包括缓存命中）还会查询每个 RPR 绑定密钥以及 bundle 签名的经典 kid 和 PQ kid。查询得不到答案时（服务
  不可达、非 2xx 响应、响应体不是 JSON 或没有 `revoked`），默认仍放行请求；新的 `revocationFailClosed: true`
  会拒绝它。
- `@dcp-ai/express`：未知的选项或 `verifierPolicy` 字段（`defaultMode`）以及类型错误的值
  （`allow_v1_bundles: "false"`）会被忽略，默认值仍然生效。现在它们会在创建中间件时抛出异常。
- `dcp_ai.fastapi`：`X-DCP-Bundle` 头中包含超过 Python 4300 位数字限制的整数或嵌套过深，以及 bundle 对验证方
  而言过深时，会返回 500；现在返回 403。不是列表的 `pq_checkpoints` 会被拒绝（之前会被当作没有检查点）。
  `verifier_policy={"risk_overrides": None}` 现在会保留默认层级，而不是把 `default_mode` 应用于所有层级，未知的
  风险层级会抛出异常。文档注明 `dcp_version` 不会被强制检查。
- 三个 README 现在说明了“已验证”的含义：bundle 内部一致，并由它自己列出的密钥签名；除非验证方固定主体的密钥
  （目前还没有哪个中间件能做到），否则这并不能证明主体是谁；带有 `verifier_id` 的 `require_audience_binding`
  会把重放限制在预期的验证方。
- Go 和 Rust 验证方接受 `session_nonce` 与清单不同的审计条目（或 PQ 检查点），尽管清单已经对其作出承诺
  （`spec/VERIFICATION.md` V2-4：每个带有 nonce 的工件和审计条目都与清单共享同一个 nonce）。现在两者都像
  TypeScript 和 Python 一样检查轨迹和检查点，错误为 `Session nonce mismatch in
  audit_entries[i]`。共享向量为 `audit_entry_session_nonce_differs`。
- Rust 验证方完全不检查 `manifest.canonicalization_profile`，Go 验证方会忽略非字符串的值，因此 bundle 可以声称
  使用一个没有任何验证方实现的配置文件（`spec/CANONICALIZATION_PROFILE.md` § 4，V2-3）。现在两者都会拒绝
  `"dcp-jcs-v1"` 以外的任何值，与 TypeScript 和 Python 一致。共享向量为 `canonicalization_profile_unknown`
  和 `canonicalization_profile_not_a_string`。

<a id="added"></a>

### 新增

- 为外部一致性工具包新增性能基线工具 `tools/conformance-perf.js`（契约 `dcp-ai-perf/1`）：用相同的输入字节、策略和验证时刻，在六个已提交的工作负载（一个混合 bundle、一个无效的 Ed25519 签名和一个无效的 ML-DSA-65 签名，以及三个二级 SHA3-256 用例）上测量本检出代码中五个 SDK 的规范性 V2 验证器。
  每个 SDK 通过其公开入口使用一个进程内子进程，预热和计时轮流执行，每次调用都会检查；保留所有样本，并给出最近秩统计。
  它构建所测量的内容，并按 SDK 记录源码、清单和锁文件、制品哈希和工具版本（`--no-build` 拒绝任何差异或缺口）。没有速度阈值、排名或归因百分比；结果保留在本地。CI 在原生 job 中运行其自测和五个 SDK 的冒烟运行。
- 在 Rust（`dcp_ai::v2::types`）和 Go（`v2`）SDK 中新增 `RawAuditEventV2`：按解码时的样子保留一条收到的 V2 审计条目，任意深度的每个成员（包括未知成员）都保留其存在与否和 `null`，因此只要 dcp-jcs-v1 规范化器接受它，其规范化字节、`prev_hash` 和 Merkle 叶就与输入相同。
  Rust 保存解码得到的 `serde_json::Value`（非对象时返回 `RawAuditEventError`）；Go 保存原始字节，输入和输出时都会复制，并拒绝任何不是恰好一个 JSON 对象的输入。两者都不修复、不重新签名：无效证据仍以相同原因无效。
  现有的 `AuditEventV2` 和 `AuditEvidenceV2` 不变，现已注明其用于转发时有损（显式的 `null`、未知成员、缺失后变成 `null` 的 `pq_checkpoint_ref`）。
  新的共享向量 `tests/interop/v2/audit_entry_roundtrip_vectors.json` 提供 14 条附有手写 dcp-jcs-v1 文本的条目（TypeScript、Python、Go 和 Rust 的规范化器都能复现），以及一个签名 bundle，新类型会以相同错误继续拒绝其各项变更。Go 的 bundle 构建器、V1 类型和 Python 的 `AuditEventV2` 模型不变。
- 为外部一致性工具包的证据目录（契约 `/2`）新增 `--assessment verdict`：带有 `error_contains` 的 146 个拒绝用例只按 `verified: false` 评判，其他所有规则、对照和退出码不变，使判定正确且使用自有消息的实现能够证明这一点。
  措辞作为诊断报告：`matched`、`differs`、`no_message`，或带原因的 `not_evaluated`。每个这样的用例都标出其在 `spec/VERIFICATION.md` 中的步骤，运行器在运行前检查这些锚点，并检查每个对照都是简单的正向用例。
  报告声明独立于 `/2` wire 契约的 `dcp-ai-conformance-assessment/1`，并把目录的文字保留在 `catalog_claim` 和 `catalog_limits` 中。不加该选项或使用 `--assessment legacy` 时，评判和报告不变；`/1` 和 `/3` 目录拒绝该选项。
  目录、测试夹具和包装器都不变；CI 在五个包装器都必需的情况下运行该评估。
- 外部一致性工具包：选择性启用的准入目录 `--catalog admission`（契约 `dcp-ai-conformance-external/3`、
  `tools/conformance/external-admission-catalog.json`，140 个用例：`admission_vectors.json` 的 65 个结果向量、71 个配置用例，
  以及依据向量输入组合出的 4 个用例）。TypeScript、Python、Go 和 Rust 包装器通过各自 SDK 的组合准入函数和加载函数，使用请求的
  `now` 作答。判定检查字段类型、spec/profiles/admission 的规则（`action_authorized` 为 `false`；`admitted` 恰在未添加任何代码时
  成立）、精确的字段，以及按阶段的原始代码顺序及其重复；否定用例只有在其对照通过时才计数。应答是一种投影：内含的验证不作判定。
  WASM 构建没有准入 API，不作模拟。CI 运行判定器的自测（60）、包装器测试（26，四个包装器均为必需），并通过四个包装器各运行
  140 个用例。证据自测的伪实现现在通过异步 spawn 到达 TypeScript 包装器，带有截止时间并检查其退出：观察到用同步 spawn 传入
  9 MB 请求时会一直等待到截止时间。`/1` 和 `/2` 不变。
- **规范化候选：在 `dcp-jcs-v1` 一侧测量关卡 7。** 新的公开 fixture `tests/interop/candidate/gate7-v1-negatives.json` 在 18 个字节位置，把 8 个单元类别各自的缺陷注入两个冻结的 `dcp-jcs-v1` 基准：38 个用例，其中包括作为对照的 2 个基准。
  它为五个实现的 10 种配置记录了推理得出的预期：TypeScript、Python、Go 和 Rust SDK，以及在 Node 中运行的 WASM 软件包。
  各实现中的新测试运行这 380 次比较：实验性验证器必须在相同的字节、时钟和策略下给出同一实现当前路径的结果，两者都必须等于预期。
  三个封装用例（30 次检查）作为单独的边界，不主张等价。一个仅用标准库的严格检查器及其阴性对照在 CI 的一致性作业中运行。
  台账将关卡 7 标为在样本上达成。仅涉及测试和文档：SDK API、配置文件、默认值和 `dcp-jcs-v1` 都没有变化；候选仍是实验性的、需显式启用，不发布任何内容。
  见 [docs/proposals/canonicalization-candidate/README.md](docs/proposals/canonicalization-candidate/README.md#185-gate-7-on-the-dcp-jcs-v1-side-testsinteropcandidategate7-v1-negativesjson)。
- **外部符合性运行器的证据目录：Merkle 与签名验证。** `--catalog evidence` 针对已提交的公开 fixture 运行一个可选目录（`tools/conformance/external-evidence-catalog.json`，契约 `dcp-ai-conformance-external/2`，241 个用例）：
  1、2、3、5 个叶子的精确双 Merkle 根，含已提交攻击和确定性改动的复合签名与仅经典签名验证，在应用每个用例已提交覆盖项的 `default_verifier_policy` 下对 `bundle_vectors.json` 进行的规范 V2 已签名 bundle 验证，以及二级 SHA3-256 向量，全部使用固定的 `verification_time`。
  反例只有在其对照通过时才计入；带错误的 `verified: true`、`error` 和 `unsupported` 永远不算通过。
  五个包装器都接受两种契约；默认目录、契约 `/1` 及其 38 个用例不变。
  CI 用全部五个包装器运行这 241 个用例和自测。通过不代表准入、信任或授权。
  除“修复”中的 `wasm_dual_merkle_root` 修正外，SDK 没有变更；不发布任何包。
  见 [tools/conformance/README.md](../../tools/conformance/README.md#evidence-catalog-merkle-and-signature-verification)。
- **外部符合性运行器的 Go、Rust 和 WASM 包装器。** `tools/conformance/wrappers/build.mjs` 从本检出副本为 Go SDK、Rust SDK 和 Rust SDK 的 WASM 构建构建包装器（`-mod=readonly`、`--locked`；
  SDK 的清单和锁定文件不变），每个包装器都通过真实 API 运行同样的 38 个用例，只调用一次规范化函数，并且只把文档所述的拒绝归为拒绝。
  WASM 包装器在 Node 而不是浏览器中运行真实的 `.wasm`，并保守地处理导出函数在结果中返回 `{"error": …}` 所造成的冲突。
  CI 构建这三个包装器并作为必需任务运行。不发布任何软件包。
  见 [tools/conformance/README.md](../../tools/conformance/README.md#go-rust-and-wasm-wrappers)。
- **外部符合性运行器（`tools/conformance-external.js`）。** 它针对以 argv 指定的任意实现，运行一个单独的、带版本的目录（`tools/conformance/external-catalog.json`，契约 `dcp-ai-conformance-external/1`），通过 stdin 上的一个 JSON 请求和 stdout 上的一个 JSON 响应进行：
  30 个 `dcp-jcs-v1` 规范化用例（包括已提交的 19 个 `edge_cases`，其中 3 个必须被拒绝）和 8 个 SHA-256 / SHA3-256 摘要，全部使用已提交的预期值。
  随附 `@dcp-ai/sdk` 和 Python `dcp_ai` 的包装器，CI 会运行两者。
  现有的符合性命令、目录和报告保持不变。通过只表明这 38 个用例通过。
  见 [tools/conformance/README.md](../../tools/conformance/README.md#external-implementations)。
- FastAPI 中的 `cancel_on_disconnect` 现在在任何中间件顺序下都能工作。对已离开客户端的 ASGI 响应现在以一个空的
  `499` 结束（“client closed request”：不是已注册的状态码，也不是 DCP 状态），带有 `Content-Length: 0` 和
  `Cache-Control: no-store`，而不是没有任何消息。
  - 这是 DCP 响应中的两条 ASGI 消息，只在收到 `http.disconnect` 之后发送，绝不会发给仍然连接的客户端。DCP
    外层的 `BaseHTTPMiddleware` 需要 `http.response.start`，此前会以 “No response returned.” 失败；现在它会
    正常完成并记录一个 499。
  - 实际送达网络的内容取决于服务器：uvicorn（已测量，0.54 配合 h11）对已断开的连接不写入也不记录任何内容；
    在 ASGI 下，其他服务器可能抛出 `OSError` 的子类。
  - 准入的 `request.state.dcp_agent` 现在只在确认客户端仍在时才发布，因此已离开的客户端不会留下任何已准入的
    上下文。运营方自己的代码设置的值不受影响。
  - 在请求体中途离开的客户端也得到同样的结束方式（此前什么都没有）。
  - 任何一层的真正错误仍会传播。其他一切不变：选项、默认值、请求体预算、监督器和 `DenyListWorkers`。
- 客户端断开，需显式启用：`@dcp-ai/express` 中的 `cancelOnDisconnect`，
  `dcp_ai.fastapi.DCPVerifyMiddleware` 中的 `cancel_on_disconnect=True`。
  - **作用。** 当客户端在准入期间真正离开时，取消该请求、且仅该请求的受监督来源调用。在来源真正结束之前，它的
    位置一直被占用。不再为该请求做任何事或发送任何内容：不调用处理程序、`next`，不写缓存，不调用
    `onFailure`，也不发送响应。
  - **Express。** 离开是指响应在发送之前关闭，或请求在请求体不完整时关闭；健康请求自身的 `close` 不算。
    - 它要求所有来源函数都受监督、没有 `checkRevocation`，并且监督器支持取消：即本版本监督器新增的
      `runWithSignal` 能力（ESM 和 CJS，两个包都有）。
    - `run`、它的四个参数和 `version: 1` 不变，旧包中的监督器在不启用该选项时仍可工作。
    - 受监督调用的决定现在只在其信号被中止之前作出一次：重新进入 `close()` 的中止监听器不会改变任何结果。
    - 新增 `cancelled` 结果、计数器（`stats().cancelled`，类型中为可选）和遥测原因。
  - **FastAPI。** 它要求 `max_body_bytes`、所有来源 callable 都受监督，以及一个同步的 `tenant` callable。
    - 中间件在准入期间监视一个待处理的 `receive()`，并把它交给下一个读取方：不会重复读取或丢失任何内容，
      完整响应之后发送的 `http.disconnect` 也不会被当作客户端离开。
    - 启用该选项时，在请求体中途离开的客户端什么也收不到，而不是收到 400。
    - 在最初的形式中，该中间件必须包裹应用的其他 `BaseHTTPMiddleware` 层；这一要求已经取消（见上一条）。
    - `SourceSupervisor` 和 `DenyListWorkers` 不变。OpenClaw 没有这个选项。
  - 不启用该选项时一切不变。
- `dcp_ai.v2.DenyListWorkers` 和 `deny_list_revocation_source(..., workers=...)`，需显式启用：为 Python 拒绝
  列表辅助函数提供真实下载线程的预算（`max_workers` 为 1 到 64，`max_workers_per_tenant` 可选，按对象计）。每次
  下载都在自己的非守护线程中运行，在预留位置后启动，并且只有在下载真正结束时才释放位置，包括超时、调用被取消、
  C3 监督器的截止时间或事件循环已关闭之后；找不到空闲位置的调用会立即得到 `REVOCATION_UNAVAILABLE`，没有队列
  也不建立连接。下载、响应体检查、解析和错误都与不启用该选项时相同；在 `timeout` 之后到达或被使用的结果为
  `REVOCATION_UNAVAILABLE`。`close()` 拒绝新的下载，但不等待也不停止正在运行的下载；`stats()` 不包含 URL、
  租户或请求头。在 fork 出的进程中，它会拒绝而不触碰父进程的锁。进程退出时会等待仍在运行的下载，与
  `asyncio.to_thread` 的情况相同；没有任何机制能停止 DNS、TLS 或 urllib。不传 `workers` 时一切不变。`timeout`
  的文档已更正：它限制的是每次套接字操作和响应体的读取，而不是 DNS 解析或逐渐到达的状态行。
- 来源监督器（C3）下的撤销检查，需显式启用，适用于 `@dcp-ai/express`、`@dcp-ai/openclaw` 和
  `dcp_ai.fastapi.DCPVerifyMiddleware`：此前被拒绝的 `supervise: { revocation: true }` /
  `supervise={"revocation": True}` 会在监督器下运行 strict-v1 撤销来源，以 `revocationTimeoutMs` /
  `revocation_timeout` 作为截止时间，并将其限制在计时器范围内（1 到 2147483647 ms 的整数；最长
  2147483.647 s）。`supervise` 接受信任截止时间、`revocation` 或两者，因此即使使用静态信任集，也可以监督撤销
  检查；信任调用和撤销调用共享监督器的容量，只有当其来源真正结束时才释放位置。响应不变：超时、没有空闲位置或
  监督器已关闭时，会得到与来源失败相同的 `REVOCATION_UNAVAILABLE`（在 Express 和 FastAPI 中为 403），
  `REVOCATION_INVALID` 错误只在截止时间之前计入。TypeScript 来源会收到 `(subjects, { tenant, signal })`，
  `denyListRevocationSource` 也会在该信号上中止其 fetch，遥测报告 `source: 'revocation'`；无论监督的是哪种
  来源，OpenClaw 的 `configureVerifier` 都拒绝替换仍有调用在进行中的监督器。FastAPI 需要异步的
  `revocation_source`。仅在启用该选项时才有的行为变化：抑制自身取消的 FastAPI 来源会在截止时间得到
  `REVOCATION_UNAVAILABLE`，而不是采用其迟到的快照。不受限制的部分：来源自行启动的工作，例如
  `deny_list_revocation_source` 的 `asyncio.to_thread` 工作线程，其 I/O 不会被取消。不启用该选项时一切不变。
- `dcp_ai.fastapi.DCPVerifyMiddleware`：为异步 `trusted_principals` 提供截止时间和容量，需显式启用。
  `SourceSupervisor(max_in_flight=..., max_in_flight_per_tenant=None)` 只从 `dcp_ai.fastapi` 导出，与带有
  `supervise={"trust_timeout": seconds}` 的 `source_supervisor` 一起使用（两者同时使用）。来源作为监督器拥有的
  Task 运行。在截止时间之后到达的信任集（使用 `loop.time()`，在到达时和使用时检查）、没有空闲位置的调用（没有
  队列）、已关闭的监督器或绑定到另一个事件循环的监督器，都会得到与来源失败相同的 503。只有当 Task 真正结束时
  才释放位置。提供 `close(drain_timeout)` 和 `stats()`。在这些选项下使用静态或同步的 `trusted_principals` 会
  抛出 `AdmissionConfigError`；在这一最初步骤中 `{"revocation": True}` 也是如此，现在已被接受（见上面的撤销
  条目）。每个事件循环一个监督器；它不会停止忽略取消的来源，也不隔离 CPU。不启用这些选项时一切不变。
- `@dcp-ai/express` 和 `@dcp-ai/openclaw`：为 `trustedPrincipals` 函数提供截止时间和容量，需显式启用。
  `createSourceSupervisor({ maxInFlight, maxInFlightPerTenant?, onSourceEvent? })` 创建一个监督器，带有
  `supervise: { trustTimeoutMs }` 的 `sourceSupervisor` 应用它（两者同时使用，且 `trustedPrincipals` 为函数）。
  此时该函数会收到 `{ tenant, signal }`。在到达时按单调时钟测量、在截止时间之后到达的信任集不会被使用，找不到
  空闲位置的调用（没有队列）或已关闭的监督器也一样：结果与来源失败相同（`TRUST_SOURCE_FAILED`，在 Express 中
  为 503）。只有当函数真正结束时才释放位置。容量按监督器对象计算，可在两个包及其 ESM 和 CJS 构建之间共享。
  提供 `close({ drainMs })` 和 `stats()`；计数器在 `Number.MAX_SAFE_INTEGER` 处停止。当在某个监督器下启动的
  调用仍在进行中（包括调用其来源之前），或其来源仍在运行时，即使在 `close()` 之后，OpenClaw 的
  `configureVerifier` 也会拒绝替换或移除该监督器。它不会停止来源的工作，也不隔离 CPU。不启用这些选项时一切
  不变。在这一最初步骤中，`supervise.revocation: true` 会被拒绝，撤销检查仍使用 `revocationTimeoutMs`；现在
  它已被接受（见上面的撤销条目）。
- `dcp_ai.fastapi.DCPVerifyMiddleware(max_body_bytes=...)`：为请求体设置一个以字节计、需显式启用的预算
  （默认 `None`，与以前一样没有预算；必须为正整数，否则为 `AdmissionConfigError` `CONFIG_INVALID_VALUE`）。此时
  中间件会先读取请求体，bundle 在请求头中或 `require_bundle=False` 时也是如此：超过预算的 `Content-Length`，或
  收到的字节超过预算（没有 `Content-Length`、分块传输，或其值错误），会在不接收其余部分、不解析、不解析信任、
  不验证、也不到达路由的情况下得到 `413`；无效或重复的 `Content-Length`，或发送过程中断开，会得到 `400`。
  预算以内的请求体按以前的方式处理，仍会到达路由。它限制的是收到的字节，而不是解压、JSON 深度或时间，并且它是
  部署层面的限制，不是协议的一部分。该选项需要 Starlette 0.28.0 或更高版本，它会把中间件中读取的请求体传给
  路由；对于更旧或无法识别的 Starlette，构建中间件时会抛出 `AdmissionConfigError` `CONFIG_INVALID_VALUE`。该包
  的最低版本要求不变，不启用该选项时不做任何检查。
- 准入：受信任的主体和 `strict-v1` 配置文件（`spec/profiles/admission`、`docs/ADMISSION.md`）。经验证的
  bundle 证明的是完整性，以及由其所列密钥作出的签名；运营方的信任集
  （`schemas/v2/principal_trust_set.schema.json`）现在让验证方只在验证其主体签名（RPR 和清单，经典和 PQ）的
  密钥是该 `human_id` 受信任且有效的密钥时，才准入该 bundle。`strict-v1`
  （`schemas/v2/admission_profile.schema.json`）增加了由运营方固定的要求：仅限 V2、所有层级都使用混合签名、
  会话绑定、已签名且等于运营方 `verifier_id` 的 `intended_verifier`、最长 300 s 的已签名会话，以及覆盖代理和
  每个已验证签名者密钥、生成时间不超过 300 s 的撤销快照（`schemas/v2/revocation_snapshot.schema.json`）。其
  配置只能收紧它；削弱它的值属于 `CONFIG_PROFILE_CONTRADICTION`。结果保留 `verified`，并新增
  `principal_trust`、`profile_compliance`、`admitted`、`recorded_decision`、`trust_set_version`、带代码的
  `errors`，以及始终为 `false` 的 `action_authorized`：准入并不授权某项行动。
  - SDK：TypeScript（`admitSignedBundleV2`、`evaluateAdmissionV2`、`createPrincipalTrustStore`、
    `resolveStrictV1Profile`、`revocationSubjects`、`revocationSnapshotFromDenyList`），Python、Go 和 Rust 中
    有相同的函数。四个验证方都接受可选的时钟，并报告签名的每个组成部分是用哪个密钥验证的
    （`signer_keys`）。在 Rust 中，`V2VerificationResult` 保留其十个字段，`verify_signed_bundle_v2` /
    `verify_signed_bundle_v2_with_policy` 保留其类型，因此基于它们构建的代码仍可编译：密钥来自新的
    `verify_signed_bundle_v2_at`，它返回 `V2VerificationDetails`（`#[non_exhaustive]`；来自同一次验证的结果作为
    `result`，以及 `signer_keys`）。准入接收并返回它；其 JSON 是结果的各字段，后接 `signer_keys`。
  - 集成：`@dcp-ai/express` 的 `dcpVerify`、`dcp_ai.fastapi` 的 `DCPVerifyMiddleware` 和 `@dcp-ai/openclaw`
    的 `configureVerifier` 接受 `trustedPrincipals`、`profile`、`revocationSource`，中间件中还接受运营方的
    `tenant` 函数。请求只有在被准入时才会到达路由。抛出异常或没有返回有效信任集（`undefined`、`null`、无效的
    集合）的信任函数会拒绝请求：在中间件中为 `503`，在 OpenClaw 中为 `admitted: false`。Express 缓存只保留
    密码学验证结果，以 bundle、策略和租户为键；信任、配置文件和撤销在每个请求中都会重新评估。
    `denyListRevocationSource` 读取完整的拒绝列表；失败或超时的来源会拒绝请求。
  - 参考验证方、服务器和 CLI：`lib/verify.js` 中的 `admitSignedBundle`，由 `DCP_TRUSTED_PRINCIPALS_FILE`、
    `DCP_ADMISSION_PROFILE_FILE` 和 `DCP_REVOCATION_LIST_URL` 配置的 `POST /v2/admit`，以及
    `dcp admit-bundle`。
  - `tests/interop/v2/admission_vectors.json`：65 个带有手写预期结果及其所检查规则的用例，以及 49 个配置用例，
    由四个 SDK 和 `npm run
    conformance` 运行。
- Rust SDK：原生的 V2 bundle 构建和签名，`dcp_ai::v2::bundle`。`build_bundle_v2(&rpr,
  &passport, &intent, &policy, &audit_entries, session_nonce)` 检查每个 `payload_hash` 以及每个工件和审计条目的
  `session_nonce`，并写入带有两个审计 Merkle 根的清单（空轨迹得到 64 个零组成的根，与 Go 相同）；
  `sign_bundle_v2(bundle,
  &classical, &pq)` 对清单进行复合签名，`signer.id` 为 RPR 的 `human_id`，与 Go 的 `SignBundleV2` 相同。与 Go 的
  一样，该构建器目前还不接受 PQ 检查点。互操作矩阵中的 Rust 代理改用它们，而不再手工组装 bundle。
- `tools/interop-matrix`：四个 SDK 之间的实时互操作。每个 SDK（TypeScript、Python、Go、Rust）各有一个代理
  进程，负责创建身份、声明意图、执行行动并签署其公民身份 bundle（DCP-01 至 DCP-03）；其他每个代理以及参考
  验证方 `lib/verify.js` 都会在默认策略和 `hybrid_required` 下验证这些 bundle，包括原样的和传输中经过七种篡改
  之后的（意图被修改、审计条目被重排或删除、会话被拼接、bundle 签名或护照被替换、PQ 签名被剥离）。各代理只共享
  编排器转发的消息。`.github/workflows/interop-matrix.yml` 在每个拉取请求上以及每晚运行它。
- `@dcp-ai/google-a2a` 2.1.0：已签名的 DCP Agent Passport 随 A2A Agent Card 一起传递。
  `passportToAgentCard(signedPassport, url)`（或 `attachPassportToAgentCard(card, signedPassport)`）把
  `SignedPayload<AgentPassportV2>` 放进卡片的 `capabilities.extensions`，位于
  `https://dcp-ai.org/a2a/extensions/passport/v2` 之下，这是 A2A 自身的扩展机制；
  `verifyAgentCardPassport(card)` 离线验证它（载荷哈希、使用护照所列有效且未过期密钥、在 AgentPassport 上下文
  下的 `pq_over_classical` 复合签名、`status: active`，以及指向同一代理的 `metadata.dcp_agent_id`），遇到任何
  格式错误都失败关闭；当卡片携带护照时，`agentCardToPassport` 返回该护照而不是一个骨架。该包现在用 TypeScript
  编写（`dist/` 构建，CI 中运行 vitest 测试套件）。
- `@dcp-ai/anthropic-mcp` 2.1.0：MCP 工具调用的已签名回执。`withDcpReceipt(name, handler,
  { identity })` 包裹任意 MCP 工具处理程序：调用被归类为一个 Intent（DCP-02），并在工具运行之前进行复合签名，
  由策略作出决定（approve 运行工具；escalate 和 block 不运行工具而返回 `isError` 结果；抛出异常的处理程序产生
  `outcome:
  "failed"`），一条审计条目（DCP-03）记录参数和结果的 SHA-256。`_meta.dcp_receipt` 中的回执是一个普通的
  DCP v2.0 已签名 bundle，因此任何 DCP 验证方都可以离线检查它；`verifyDcpReceipt` 还会根据调用方看到的参数和
  结果重新计算证据哈希，并检查工具名称。`createReceiptIdentity` 为测试和首次运行签发会话身份（Ed25519 +
  ML-DSA-65 密钥、已签名的 RPR 和护照）。该包现在用 TypeScript 编写（`dist/` 构建，CI 中运行 vitest 测试
  套件），`dcp_verify_bundle` 运行真正的 `verifySignedBundleV2`，而不是结构检查；其未使用的 `security_tier`
  输入已被删除。
- `tests/interop/v2/bundle_vectors.json`：新增 28 个拒绝用例（5 个 `must_reject` 变异，23 个
  `must_reject_bundles`），对应 v2.10 轮次的每个漏洞各一个，四个 SDK 验证方（包括 Python）在每种验证模式下都
  会运行：没有任何 `composite_sig` 的工件（V2-8）；`dcp_bundle_version` 为 `1.0` 和 `3.0`（V2-1）；以非 UTC
  偏移过期的密钥、护照上格式错误的密钥 `expires_at` 值（不可能的日期、只有日期、没有偏移）以及 RPR 上不可能的
  日期（V2-13）；意图或策略决定意味着 `elevated`、而意图却声明 `security_tier: "routine"` 或
  `estimated_impact: "high"` 的仅经典签名 bundle（V2-10）；护照 `risk_tier` 中的原型键（`constructor`、
  `__proto__`、`toString`、`hasOwnProperty`），以及 `action_type`、`estimated_impact` 和 `security_tier` 中的
  `constructor`（V2-9）；未知或非字符串的 `canonicalization_profile`（V2-3）；带有另一个 `session_nonce` 的
  意图、审计条目或清单（V2-4）；不匹配的清单哈希、审计根或链哈希（V2-3）。
- `tools/difffuzz`：一个差分模糊测试工具，把同一个变异后的 V2 已签名 bundle 交给 TypeScript、Python、Go 和
  Rust 验证方（每个 SDK 一个适配层，从本 checkout 构建），一旦出现分歧、崩溃或超时即判定失败，并把每个发现
  保存到 `tools/difffuzz/findings/`。种子是 `tests/interop/v2/` 中的 V2 已签名 bundle；变异器覆盖删除和置空的
  字段、类型互换、同级互换、base64 字符翻转、原型键、未知键、重复的工件、数字和 RFC 3339 的变体、超长字符串、
  深度嵌套以及键的重排（键重排绝不能改变判定）。
- `.github/workflows/difffuzz.yml` 在每个拉取请求上（300 次迭代）、`workflow_dispatch` 时以及每晚（3000 次
  迭代）运行该模糊测试工具。
- 四个 SDK 都支持可验证的委托链（DCP-09 §3.5）。`schemas/v2/delegation_mandate.schema.json` 新增可选字段
  `parent_mandate_id`、`delegation_depth`、`sub_delegation`（`{ permitted, max_depth }`）、
  `minimum_security_tier` 和 `delegator_composite_sig`；根授权书保留 `human_composite_sig`，字节完全不变，子
  授权书则改为携带 `delegator_composite_sig`，由委托代理在新的域分离上下文 `DCP-AI.v2.SubMandate`
  （`domain-separation.{ts,py,go,rs}`、`interop_vectors.json`）下签署。`verifyMandateChain` /
  `verify_mandate_chain` / `VerifyMandateChain` 离线验证一条有序的链，一直追溯到人类：用人类的密钥验证根签名，
  用父代理的密钥验证每一跳的签名，检查父链接和深度、`sub_delegation.permitted` 以及祖先中最小的
  `max_depth`、相同的 `human_id`、按 RFC 3339 时刻比较的嵌套有效期窗口、收窄（`actions_permitted` 和
  `data_classes` 为子集，`limits` 绝不放宽，父授权书没有 `data_classes` 时子授权书不能增加，数值 `limits` 只能是
  ±(2^53 − 1) 范围内的整数：超出该范围时，把 JSON 数字读成双精度浮点数的验证方与保留全部位数的验证方会对
  授权书的内容产生分歧，因此这样的限制在任何深度都是 `not comparable`）、绝不低于父授权书的
  `minimum_security_tier`，以及撤销，被撤销的祖先会使其所有后代失效。结果带有链的实际层级（链上最大的
  `minimum_security_tier`）。任何未知的、按深度应有而缺失的或不可比较的内容都会失败关闭。签名密钥在验证时必须为
  `active` 且未过期，授权书签名必须为 `pq_over_classical`。
- 在根构建器旁边新增子授权书构建器：`createSubMandate` / `create_sub_mandate` / `CreateSubMandate`，以及根
  构建器上的 `sub_delegation` / `minimum_security_tier`（Rust 中为 `create_delegation_mandate_with_options` 和
  `MandateChainOptions`）。
- `computeSecurityTier` / `compute_security_tier` / `SecurityTierInput.MandateChainTier` /
  `compute_security_tier_with_floor`，以及根目录的副本 `lib/security-tier.js`（`computeSecurityTier(intent,
  policyDecision, mandateChainTier)`），把经验证链的实际层级作为一个只能提高层级的可选输入（规范 §14.2）；在 Go
  中，空的 `MandateChainTier` 表示没有链，其他任何不是层级名称的值都按 `elevated` 计。bundle 验证方目前还不会
  读取它：bundle 中没有携带其授权书链的字段。
- `tests/interop/v2/mandate_chain_vectors.json`（由
  `sdks/typescript/src/__tests__/generate-mandate-chain-vectors.ts` 生成）：每个 SDK 都必须接受并给出深度和
  实际层级的深度为 1 和 2 的链，每个 SDK 都必须拒绝的链（扩大的行动、增加的数据类别、放宽的限制、以双精度浮点数
  无法表示的传输整数写出的 2^53 或 2^53 + 1 的限制、超出父授权书的有效期、超过 `max_depth` 的深度、缺失或错误
  的 `parent_mandate_id`、降低的层级、被撤销的根或中间授权书、由错误代理签署的子授权书、两个签名同时存在、
  错误的 `delegation_depth` 等），以及层级下限用例。四个 SDK 的测试套件都会运行它。
- 用于规范化候选 `dcp-jcs-v2` 的实验性、需显式启用的 API（`docs/proposals/canonicalization-candidate`，
  §15–§18）。该候选既非规范性的，也未启用：`dcp-jcs-v1` 仍是唯一的规范性和默认规范化配置文件，任何默认值、
  构建器、签名方或验证方都没有改变。只有显式选择的调用方才会用到这些 API，涵盖 TypeScript、Python、Go、Rust 和
  WASM。
  - **入口：** 检查一个单元的原始字节（UTF-8、BOM、重复、±(2^53−1) 范围内的精确整数、深度 64），给出其规范
    字节，或给出类别和偏移量。
  - **路由器：** 从传输中提取该单元，读取配置文件并作出决定：拒绝、通过一个具名的历史解码器委托给
    `dcp-jcs-v1`，或选择候选。
  - **验证方：** 从原始字节出发，至多使用一个验证方进行验证：`dcp-jcs-v1` 使用当前的验证方，候选使用只接受
    `dcp-jcs-v2` 的当前验证方。经验证的 bundle 不授予任何信任或准入。
  - **生成方：** 从原始字节或经过严格检查的宿主值出发，签署工件（`experimentalCandidateSignPayload` 及其对应
    函数）以及清单指明 `dcp-jcs-v2` 的 bundle（`experimentalCandidateSignBundle`）。因输入的取值范围或形式而
    产生的拒绝会在调用任何签名方之前抛出；密钥、注册表或提供方错误仍可能在签名完成之后出现。
  - **测试：** 一个五个生成方 × 五个消费方的交叉矩阵（`tests/interop/candidate/phase4`，975 个结果，判定为
    全有或全无）及其成本测量，由新的 `canonicalization-candidate-matrix` 工作流运行，它不发布任何内容。向量位于
    `tests/interop/candidate/`。

<a id="changed"></a>

### 变更

- 翻译现位于 `i18n/<locale>/` 下，路径与其英文原文相同，英文原文不移动：对于 `es`、`pt-BR`、`ja` 和 `zh-CN`，
  `<dir>/<name>.<locale>.md` 现为 `i18n/<locale>/<dir>/<name>.md`（388 个文件）。此次迁移只改变了链接路径：
  即被移动文件中的链接，以及十份英文文档的语言链接。每个 SDK 的英文 README 以绝对 URL 链接其翻译，使其语言链接
  不依赖包外的路径。文档站点在全部五种语言中保持其 URL、锚点和语言选择器不变。旧路径在 `main` 上已不存在，也没有
  重定向文件；在更早的提交或标签中，各文件仍位于旧路径。今后从此代码树打包的 SDK 和集成的 npm 包版本不再包含翻译后的
  README；已发布的包不会被修改，其指向 GitHub 旧路径的链接可能会失效。文档检查
  （`scripts/docs_i18n.py`）还会拒绝 `i18n/` 下不是已登记翻译的文件、指向 `i18n/` 却未到达某份翻译的链接，以及
  未链接到确切英文原文的翻译说明，并像检查本地链接一样检查指向本仓库 `main` 分支的链接。
- `dcp-ai verify`（`@dcp-ai/cli`）使用规范性验证方验证 V2 bundle（`bundle.dcp_bundle_version` 为 "2.0" 或带有
  `bundle.manifest`）：先用 `schemas/v2`（其副本随包发布）验证信封和四个已签名载荷，再在
  `DEFAULT_VERIFIER_POLICY` 下，使用 Ed25519、ML-DSA-65 和 SLH-DSA-192f 提供方运行 `@dcp-ai/sdk` 的
  `verifySignedBundleV2`。规范前的信封（顶层 `dcp_version` 为 "2.0" 或带有 `bundle_manifest`，或
  `signature.binding: "composite"`）会在其他任何检查之前被拒绝，即使这些标记出现在 V1 或 V2 bundle 上也是如此；
  其 `signature.classical.value` 检查已被删除，不再回退到经典签名。当 `.dcp/keys/ed25519_public.key` 存在时，它会
  在 RPR 的 `binding_keys` 中固定主体的签名密钥（空文件会被拒绝）；不存在时使用 bundle 自身的密钥，这只检查签名，
  而不检查信任或准入。V1 验证不变。`dcp-ai sign` 也不变：它追加到 `signatures[]`，而 `verify` 不读取这种格式；
  V2 bundle 应使用 `signBundleV2` 或 `dcp sign-bundle --composite` 签名。该包现在要求 `@dcp-ai/sdk` `^2.2.0`，并
  声明 `ajv` 和 `ajv-formats`。
- `dcp-ai verify`（`@dcp-ai/cli`）只有在输出 VALID 时才以 0 退出。对于 V1 文件，在以下情况下它现在以 1 退出，而
  以前以 0 退出：Ed25519 签名为 INVALID；没有密钥或没有可用的签名（它输出 “No public key available”，在有密钥但
  签名缺失或为空时也是如此）；文件不是已签名 bundle（没有真值 `bundle` 的对象、数组或基本类型值）。这些消息不变，
  缺少参数或文件、无效 JSON、base64 或大小错误仍会带着各自的错误以 1 退出。把退出码 0 理解为“已运行”的脚本，
  现在必须在这些情况下预期 1。对于 V1 文件，退出码 0 只表示对规范化 bundle 的 Ed25519 签名验证通过；对于 V2
  bundle，它表示 schema 和规范性验证方都已通过（见上文）。两者都不是准入决定。
- Go 和 Rust 的 V2 验证方：收窄 `accepted_classical_algs` 或 `accepted_pq_algs` 的策略会被当作它们不执行的字段
  而拒绝，因此在这种策略下所有 bundle 都会失败；现在它们像 TypeScript 和 Python 一样执行这两个列表（经典列表在
  `pq_only` 下除外），使用列表之外算法的签名会因不被验证方策略接受而失败。它们也接受 strict-v1 所设置的
  `allow_v1_bundles: false`：它们只验证 V2 bundle，因此该字段对它们没有任何影响。以前验证通过的策略行为不变。
- 在 2.2.0 发布到 npm 之前，参考验证方（`lib/verify.js`、`dcp verify-bundle`、验证服务器及其 Docker 镜像）依赖
  工作区的 `@dcp-ai/sdk`（`file:sdks/typescript`，通过 `.npmrc` 中的 `install-links` 打包），因此运行的是本版本
  的验证方修复，而不是已发布的 2.1.1，后者会接受 79 个 `must_reject_bundles` 向量中的 39 个。在根目录执行
  `npm install` 之前，先构建 `sdks/typescript`；CI 和 `docker/Dockerfile` 都会这样做。发布时需要把该依赖改回
  `^2.2.0`。
- `lib/verify.js`：schema 验证现在为每个 schema 根构建一个 Ajv，并在首次使用时只编译每个 schema 一次，而不是在
  每次调用 `validateOne` 时（每个 V2 bundle 五次）加载并编译所有 schema。验证一个 V2 bundle 的 schema 从约
  34 ms 降到 0.14 ms（首次运行之后 20 次运行的中位数，首次运行仍需编译）。

<a id="fixed"></a>

### 修复

- **接受范围变更：Go 的 `v2.VerifyPayloadHash` 现在检查规范的 `payload_hash`**（`main` 上的源代码，尚未发布；Go v2.11.1 仍有该缺陷）。
  它原先把不带前缀的十六进制 SHA-256 与 `payload_hash` 比较，因此对 `SignPayload` 的输出和所有符合 schema 的值（`sha256:<hex>`）返回 `false`，对不带前缀的摘要返回 `true`。
  现在只有当 `payload_hash` 恰好是 `"sha256:"` 后接 `dcp-jcs-v1` 字节的小写十六进制 SHA-256 时才返回 `true`，这正是 `SignPayload`、`schemas/v2/signed_payload.schema.json` 以及 TypeScript、Python 和 Rust 辅助函数使用的值。
  不带前缀的摘要、大写十六进制、前后空格或任何其他形式现在都返回 `false, nil`。
  迁移：按收到的原样传入 `payload_hash`；若要从 `PreparePayload` 构造，写作 `"sha256:" + hash`。
  `PreparePayload` 仍返回不带前缀的摘要（其注释现已说明），`nil` 和规范化错误保持不变；从未使用该辅助函数的 bundle 验证器也不变。
  该辅助函数只检查哈希一致性，不检查签名、密钥、策略或准入。新增 `sdks/go/dcp/v2/signed_payload_test.go`。
  Go 的 README 和 `AuditEvidenceV2` 的注释现在还说明：把收到的 bundle 解码到类型化结构体会丢失 `evidence` 中的 `null` 成员和未知成员，因此应保留并验证收到的字节。
- **接受范围变更：WASM 的 `wasm_dual_merkle_root` 和 `@dcp-ai/wasm` 的 `dualMerkleRoot` 现在计算 V2-11 的双 Merkle 根**（`main` 上的源代码，尚未发布；
  `@dcp-ai/wasm` 2.1.1 及更早版本保留旧的辅助函数）。
  该辅助函数对两个摘要拼接后的十六进制文本做哈希，并把奇数节点直接上移，因此在 2 个或更多叶子时，其根既不符合 `spec/VERIFICATION.md` V2-11（拼接 32 字节的原始摘要，奇数层复制最后一个节点），也不同于 TypeScript、Python、Go 和 Rust SDK。
  现在它委托给 Rust 核心 `v2::dual_hash::dual_merkle_root`。
  变更不只涉及多叶子根：已发布的辅助函数产生的多叶子根会改变，因为它们与 V2-11 不兼容；不是 32 字节十六进制摘要的叶子现在是错误，而不再被当作文本做哈希；根始终是小写十六进制，因此以大写给出的单个叶子现在以小写返回。
  以小写给出的单个有效叶子、结果格式，以及空数组和非 JSON 输入的错误保持不变。
  bundle 验证（包括 WASM 验证器）本来就使用正确的归约，不会改变；由于变更仅限于该辅助函数，以前的 bundle 及其证据不会被重写或重新签名。
  新的公开向量 `tests/conformance/v2/merkle_vectors.json`（1、2、3、5 个叶子以及重新排序的叶子的精确根，用 Python 标准库离线生成，并以 2 个叶子的 golden 根为基准）由 `sdks/wasm/test/dual-merkle-root.mjs` 和 `sdks/rust/tests/dual_merkle_vectors.rs` 检查。
- `denyListRevocationSource`（`@dcp-ai/express`、`@dcp-ai/openclaw`）会让响应保持打开。非 2xx 的响应，或声明的
  `Content-Length` 超过 16 MiB 的响应，会在不读取也不关闭其响应体的情况下被拒绝：调用结束、其位置被释放之后，
  响应仍然打开，超时和调用方的信号都无法触及。此外，在 Node 22.15（undici 6.21.2）下，读取响应头之后的一次垃圾
  回收会使 fetch 的信号无法到达正在读取的响应体：它自己的超时和监督器的截止时间都无法再停止仍在到达的响应体，
  调用永远不会结束，并一直占用其位置。现在它在每个退出路径上都会中止 fetch 并取消响应体，在其信号上停止自己的
  读取，并释放读取器。错误码、默认值和容量不变；不会读完剩余内容，也不会等待远端关闭。
- 参考 CLI（`bin/dcp.js`）：路径是按书写形式而不是按其实际指向限制在工作目录中的，而且有几处读写跳过了检查。
  工作目录中的符号链接，或指向另一个目录的路径（`keys rotate --key-dir`、`governance sign-advisory
  --key-dir`、`governance verify-advisory --sigs`），会让命令读取目录之外的文件，包括私钥；输出路径上的符号链接或
  硬链接（`keygen`、`keys rotate`、`recovery-setup`、治理命令、V1 `sign-bundle` 的输出）会让它写到目录之外；已有的
  私钥文件会保留更宽的权限；`dcp validate`、`conformance` 和 V1 `sign-bundle` 会从工作目录运行 `tools/*.js`，因此
  被放置在那里的脚本会被执行。现在每个路径都会连同其符号链接一起解析（悬空的符号链接会被拒绝）并检查，对用户
  路径的每次读写都经过该检查，文件先写入一个新文件（`O_EXCL`，精确权限）再重命名覆盖目标，CLI 运行的是它自己的
  工具。CLI 假定在命令运行期间没有其他东西改变工作目录；在没有 `O_NOFOLLOW` 的 Windows 上，重命名仍会替换链接，
  而不是透过链接写入。
- `@dcp-ai/anthropic-mcp` 和 `@dcp-ai/google-a2a`：`"types"` 导出条件排在最前面，因此 CommonJS 使用方得到的是
  ESM 声明（`dist/index.d.ts`），TypeScript 在 `node16` 下以 TS1471 拒绝 `require()`。该条件已被删除，因此
  `require` 得到 `dist/index.d.cts`，`import` 得到 `dist/index.d.ts`。`@dcp-ai/sdk`、`@dcp-ai/express` 和
  `@dcp-ai/openclaw` 删除了同样的条件，它排在 `"import"` 和 `"require"` 之后，从未匹配，并让 tsup 在每次构建时
  发出警告。在导出中没有 `"require"` 的 `@dcp-ai/wasm` 中，它会在 `nodenext` 下为 Node 以
  `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝的 `require()` 向 CommonJS 使用方提供类型。现在 TypeScript 在那里也会报告
  TS2307。
- Go SDK：在设置了 `require_session_expiry`、`require_audience_binding` 或 `verifier_id` 的策略下，
  `VerifySignedBundleV2WithPolicy` 会让所有 bundle 失败，而这些字段是 `verifier_policy.schema.json` 所列出、
  TypeScript 和 Python 验证方会执行的字段。`VerifierPolicy` 现在有了它们（`RequireSessionExpiry`、
  `RequireAudienceBinding`、`VerifierID`，零值时关闭），验证方像 TypeScript 一样执行它们：没有
  `session_expires_at`、没有 `intended_verifier`，或预期验证方不是 `verifier_id` 的清单会被拒绝。
- Rust SDK 和 `@dcp-ai/wasm`：`VerifierPolicy` 会拒绝 `require_session_expiry`、`require_audience_binding` 和
  `verifier_id`，而这些字段是 `schemas/v2/verifier_policy.schema.json` 所列出、TypeScript 和 Python 验证方会执行
  的字段，因此设置了其中任何一个的策略会让所有验证失败。现在它们像在 TypeScript 中一样被执行：在
  `require_session_expiry` 下，没有 `session_expires_at` 的清单会被拒绝；在 `require_audience_binding` 下，没有
  `intended_verifier` 的清单，或在设置了 `verifier_id` 时带有其他值的清单会被拒绝。Rust 的 `BundleManifest`
  新增 `intended_verifier`。
- Python SDK 的 `dcp_ai.langchain`（`DCPTool.run`、`DCPTool.arun`）和 `dcp_ai.openai`
  （`handle_dcp_tool_call` 中的 `dcp_verify_bundle`）：两者都把每个 bundle 交给 V1 验证方，因此所有 V2 bundle
  都会被拒绝，而 V1 bundle 会在没有任何验证方策略的情况下被接受。现在它们使用 `verify_signed_bundle_v2` 和只构建
  一次的 Ed25519 / ML-DSA-65 / SLH-DSA-192f 注册表，在调用方设置的验证方策略下（`DCPTool(verifier_policy=...)`、
  `handle_dcp_tool_call(..., verifier_policy=...)`，叠加在 `DEFAULT_VERIFIER_POLICY` 之上）验证 V2 bundle，
  并返回验证方的错误：最多 20 个错误和 20 个警告，每个不超过 500 个字符，bundle 提供的文本（`agent_id`、无效的
  时间戳）中的控制字符和格式字符会被转义，因此 bundle 无法向模型上下文塞入数兆字节内容或换行。V1 bundle 只有在
  FastAPI 中间件的 V2-10 规则下才会被接受，该规则现在由三个入口共享（`dcp_ai._verify_any`），并扩展到整个策略：
  策略允许 V1 bundle、接受 ed25519（在 `accepted_classical_algs` 中，且不在 `advisory_rejected_algs` 中）、不要求
  受众绑定、会话到期或最长会话时长（V1 bundle 没有 `intended_verifier`，也没有会话窗口），并且对其风险层级和
  安全层级会接受仅经典签名的 bundle；FastAPI 中间件也执行新增的条件。工件不是对象，或 `audit_entries` 不是对象
  列表的 V1 bundle，在三个入口中都会被拒绝（FastAPI 中间件以前对不是对象的 `agent_passport` 返回 500，现在返回
  403），`dcp_ai.verify.verify_signed_bundle` 在签名块、密钥或审计轨迹格式错误时返回错误，而不是抛出异常。护照的
  `agent_id` 或 RPR 的 `human_id` 不是字符串（或护照的 `public_key`、`status` 或 `capabilities` 类型错误）的 V1
  bundle 也会被拒绝，而不会到达 FastAPI 的代理上下文。FastAPI 中间件的 403 响应及其上下文中的 `warnings` 也像
  桥接层的输出一样受到限制并转义。`VerifierPolicy` 实例会像 dict 一样被验证，因此用 `model_construct` 构建或
  通过赋值修改的实例也不能带有无效值；`risk_overrides` 中遗漏的风险层级会得到其 `default_mode`，与 V2 验证方和
  TypeScript SDK 的 `resolveMode` 的解析方式一致（该层级的 V1 bundle 以前会以 “is not low, medium or high” 被
  拒绝）。同步入口可以在正在运行的事件循环中工作（验证在工作线程上运行），并在私有循环上运行，保持线程当前的
  事件循环不变；`DCPTool.arun` 会 await 验证，新的 `averify_bundle_tool_call` 是 OpenAI 工具调用的异步形式。两者
  都通过了 `tests/interop/v2/bundle_vectors.json` 的所有用例。
- Go SDK：`BundleManifest` 没有 `intended_verifier`，因此解码到其中再重新编码的清单会丢失该字段，其签名也就
  不再验证通过。现在有了该字段（`IntendedVerifier`，为空时省略）；一个测试会对带有全部 schema 字段的清单做往返
  编解码。
- Python SDK 的 `dcp_ai.crewai`：`DCPCrew` 的代理从未共享 crew 的会话 nonce。`DCPCrewAgent` 总是生成自己的
  nonce，因此 crew 对没有 nonce 的代理所作的检查从未生效，每个代理的审计条目都带有不同的 `session_nonce`。现在
  crew 会把自己的 nonce 交给每个仍持有自己生成的 nonce 且尚未记录任何内容的代理；交给代理的 nonce，或之后在代理
  上设置的 nonce，保持不变。
- Rust 的 `wasm` 特性和 `@dcp-ai/wasm`：`wasm_sign_bundle`（`signBundle`）写入 `created_at ""` 且不写
  `signer.id`，因此参考验证方、CLI 和服务器会拒绝它签署的每个 bundle（`created_at must match format "date-time"`、
  `signer must have required
  property 'id'`）。`wasm_build_bundle`（`buildBundle`）与其他所有 SDK 不同，用 SHA-256 合并 SHA3-256 审计叶子，
  并跳过无法规范化的审计条目，却仍将其计入。现在两者都调用 `build_bundle_v2` 和 `sign_bundle_v2`，因此
  `buildBundle` 也会拒绝与其载荷不匹配的 `payload_hash`，以及来自另一个会话的工件或条目。没有 `sessionNonce` 时，
  `buildBundle` 会生成一个没有任何工件携带的 nonce，因此连 `verifyBundle` 都会拒绝该 bundle；现在它使用 RPR 的
  `session_nonce`。`example.html` 演示把原始载荷传给从不接受它们的 `wasm_build_bundle`；现在它会先签署每个工件。
  `SignedBundleV2` 类型声明了 `signer.id`。
- Rust SDK：`Ed25519Provider::sign` 在私钥短于 32 字节时会 panic（在 wasm 中是 trap 而不是 JSON 错误）；现在它返回
  `invalid secret key length`。
- 授权书链（全部四个 SDK）：父条目带有数据类别、而子授权书条目没有 `data_classes` 时，会通过收窄检查，
  尽管此时没有任何东西把它约束在父条目的数据类别之内。现在它会被拒绝（`data_classes for domain "<d>" missing`），
  与缺少 `limits` 键的情况一样；DCP-09 §3.5.2 第 5 条规则对此有明确规定。共享向量为 `dropped_data_classes`。
- Go SDK：从多个 goroutine 使用的 `A2ASession` 会使进程崩溃（`DecryptMessage` 中的 `fatal error:
  concurrent map writes`）。会话现在持有一个互斥锁，因此 `EncryptMessage`、`DecryptMessage` 和 `NeedsRekeying`
  可以并发运行；序列号仍然唯一，每条消息仍只被接受一次。`IntentV2` 新增 `SecurityTier`，`PolicyDecisionV2` 新增
  `ResolvedTier`（两者在 schema 中都是可选的，为空时省略），因此使用类型化载荷的 Go 集成方可以声明它们。
- `tools/difffuzz`：`prototype_key_as_key` 把 `__proto__` 当作普通属性赋值，这会设置原型而不是添加一个键，因此
  这些变异体从未带有它们声称的键（循环引用还可能让运行崩溃）；现在它定义一个自有键。无法启动或在两次判定之间
  退出的适配层会被报告为崩溃，而不是未处理的错误。`spec/VERIFICATION.md` 现在正确写出了 Rust 的 bundle 构建器
  名称（`wasm_build_bundle`，仅在 `wasm` 特性中）。
- Go SDK：`SignBundleV2` 把 `signature.signer.id` 留空，而 `signed_bundle.schema.json` 禁止这样做，因此四个
  SDK 验证方都接受它签署的 bundle，参考验证方、CLI 和服务器却都拒绝（由 `tools/interop-matrix` 发现）。现在签名者
  是 bundle 的负责主体（`signer.id` = RPR 的 `human_id`），RPR 没有 `human_id` 的 bundle 会在签名之前被拒绝。
- A2A 会话（TypeScript、Python、Go）：`decryptMessage` / `decrypt_message` / `DecryptMessage` 会保留在接收窗口内
  已接受的序列号，并且每个序列号只接受一次，乱序的也是如此；不是非负整数的序列号会被拒绝，而且只有在其认证标签
  验证通过后才记录该序列号。比接收计数器超前整整一个窗口或更多的序列号会被拒绝（DCP-04 §8.4）。在没有新字段的
  情况下恢复的会话（TypeScript 的 `undefined`、Go 的 `nil`、Python 的 `None`、构造函数的默认值）会把窗口内低于
  其接收计数器的所有序列号都视为已接收。`verifyResumeProof`
  （TypeScript）以常数时间进行比较，Python 和 Go 早已如此。文档注明 Go 会话不能安全地并发使用。

- Rust SDK：`serde_json` 现在启用了 `float_roundtrip`。它的快速浮点解析器在长十进制字面量上会差一个 ULP，因此
  `9007199254740991.0`（`dcp-jcs-v1` 把它读作整数 9007199254740991，其他所有 SDK 也是如此）变成了
  9007199254740990，`2251799813685247.0` 变成了非整数，Rust 验证方会拒绝 TypeScript、Python 和 Go 验证方接受的
  签名和限制。共享向量为 `limits_written_in_decimal_form`。
- `@dcp-ai/wasm`：npm 包现在包含 `pkg/`（`.wasm` 二进制文件及其胶水代码）。wasm-pack 会写入
  `pkg/.gitignore` = `*`，npm 会遵守嵌套的 `.gitignore` 文件，因此 `@dcp-ai/wasm@2.0.0` 发布时没有 `pkg/`，其
  运行时对 `../pkg/dcp_ai.js` 的导入会失败。构建过程会删除该文件，测试套件会检查 tarball。
- `@dcp-ai/sdk`：打包的遥测版本在构建时从 `package.json` 读取（`tsup.config.ts`），而不是使用构建脚本中的字面量；
  否则 2.2.0 会把自己报告为 2.1.2。
- Python 的 `verify_signed_bundle_v2` 把没有 `composite_sig` 的工件报告为
  `Malformed signed bundle: KeyError('composite_sig')`；现在错误会指明该工件（`intent: Missing composite signature`），
  与其他 SDK 一致。
- TypeScript 的 `verifySignedBundleV2` 对结构上格式错误的已签名 bundle 返回失败判定
  （`Malformed signed bundle: ...`），而不是抛出异常：缺失、为 `null` 或不是对象的 `bundle`、`signature`、
  `manifest` 或 `audit_entries`，为 `null` 的审计条目，或被规范化对象中的非整数数字（`0.5`、`1e400`）
  （`spec/VERIFICATION.md` V2-3、V2-5）。Python、Go 和 Rust 验证方早已拒绝这些情况；由 `tools/difffuzz` 发现。
- Go 的 V1 `VerifyObject` 在公钥解码后不是 32 字节时会 panic（`ed25519.Verify` 遇到其他长度都会 panic）。现在它
  会检查解码后的长度，并改为返回错误。`VerifySignedBundle` 在其外围的行为保持不变：公钥为空时回退到签名中内嵌的
  公钥，两者都缺失时返回 `missing public key`，`VerifyObject` 的错误被报告为 `SIGNATURE INVALID`。
- TypeScript 的 CBOR 解码器（`sdks/typescript/src/wire/cbor.ts`，可选）会拒绝重复的映射键、无效的 UTF-8，以及
  超出安全整数范围的整数和长度。它把 U+FEFF 作为文本数据保留，把 `__proto__` 键定义为自有属性而不是调用其
  setter，编码器会拒绝未配对的代理项而不是替换它们。这加强了解码器对输入的处理；它不是完整的规范 CBOR 解码器，
  也没有增加任何规范化配置文件。

<a id="documentation"></a>

### 文档

- `spec/profiles/admission/README.md`（准入配置文件）：编辑性澄清，不改变任何向量、schema 或 SDK 行为；四个 SDK 已经按这些内容运行。
  第 5.1 节第 2 步将 bundle 作为 V2 已签名 bundle 验证：不是 V2 的 bundle 无论 `allow_v1_bundles` 如何设置都不会通过验证，
  在配置文件下 P1 会在验证之前停止，并将 bundle 报告为未通过验证。配置文件需要信任集：组合函数和单独的第 3 步会以
  `CONFIG_PROFILE_CONTRADICTION` 拒绝没有信任集的配置文件，组合函数也会以同一代码拒绝同时给出配置文件和调用方验证器策略的调用；
  不规定这发生在验证之前还是之后。在第 4.1 节中，四种模式的枚举之外的模式与类型错误的值一样为 `CONFIG_INVALID_VALUE`，
  而该枚举中除 `hybrid_required` 以外的模式或允许子集之外的算法为 `CONFIG_PROFILE_CONTRADICTION`。第 2.2 节：信任集有多个问题时，
  可以报告其中任何一个的代码；无论报告哪个都会被拒绝，不规定优先顺序。第 5.2 节：`errors` 遵循第 5.1 节各阶段的顺序，
  检查可以为每个组件或主体各添加一次代码，阶段内不规定顺序。`tools/conformance/README.md`：证据目录判定的 `error_contains`
  字符串（其 241 个用例中的 146 个）是 SDK 的诊断措辞，不具规范效力。
- `docs/QUICKSTART_CREWAI.md`：两个示例都无法运行。V1 示例导入了 Python SDK 中并不存在的 `build_bundle`，并在
  `intent_hash` 和 `prev_hash` 应填哈希的位置写入了签名；V2 示例使用了一个从未发布的 API，并声称 Python SDK 没有
  V2 bundle 的构建器、签名方或验证方，而 `dcp_ai.v2` 实际上（从 2.9.0 起）就包含这些。现在两个示例都按 SDK 的
  实际情况使用它：在工具运行之前由策略关卡作出决定，搜索查询不进入记录，每次工具调用封存自己的 bundle，验证时
  固定运营方（V1：其公钥；V2：在 `hybrid_required` 下的其 RPR 哈希和 kid，以及每个 kid 都由其密钥派生，因为
  bundle 自身的密钥只能使其自洽）。这些 bundle 可以在 Python 中以及用 `dcp verify-bundle` 验证，V2 bundle 还可以
  用 TypeScript、Go 和 Rust SDK 验证。该指南按 CrewAI 文档的写法从 `crewai.tools` 导入 `tool`，并如实地把
  `npm create @dcp-ai/crewai` 脚手架描述为使用占位符的演练。
- `integrations/crewai/README.md`：示例使用了带有 schema 会拒绝的值（`liability_mode: "full"`、能力
  `write_file`）的 V1 载荷，并输出了审计条目并不具有的 `action_type` 字段。现在它们可以运行；README 说明了
  `DCPCrewAgent` 和 `DCPCrew` 保存的是未签名的记录、并不运行 CrewAI，并列出了 `session_nonce` 参数。
- 英文文档以及 es、zh-CN、ja 和 pt-BR 译文已更新到最新：每个 SDK README 中的委托链、A2A 接收窗口、
  Testing & Assurance（互操作矩阵、差分模糊测试、共享向量）、更正的事实（Go 1.25、Rust 的 FIPS crate、一个使用了
  schema 之外字段的 TypeScript DCP-09 示例），以及译文中遗漏的 README 行。
- `docs/EU_AI_ACT_MAPPING.md`：说明 DCP-AI 工件如何支持经第 (EU) 2026/1744 号条例修订的第 (EU) 2024/1689 号
  条例（欧盟 AI 法案）中关于日志记录、人工监督、记录保存、解释和事件证据的义务，包括适用时间表、实现者检查清单以及
  DCP 未涵盖的缺口。条文已于 2026 年 10 月 22 日在 EUR-Lex 上核实。
- `spec/DCP-09.md` §3.5 现在基于真实的传输字段规定了再委托，并给出了规范性的链验证规则；§2、§10.3 和 §10.6 列出了
  `DCP-AI.v2.SubMandate` 上下文。`spec/DCP-AI-v2.0.md` §4.1 列出了 `DCP-AI.v2.Delegation` 和
  `DCP-AI.v2.SubMandate` 上下文标签，§14.2 说明委托链的实际层级是一个只能提高层级的输入。


## [2.10.0] - 2026-10-22

<a id="package-versions"></a>

### 包版本

- `dcp-ai`（PyPI）2.8.2 → 2.9.0：pqcrypto 1.x、FIPS 205 SLH-DSA、ML-KEM-768、V2 bundle 和一个 V2 验证方；对
  `blind_rpr`（需要 `pii_salt`）和 `pqcrypto<1.0` 的安装而言是破坏性变更。
- `@dcp-ai/sdk`（npm）2.1.2 → 2.2.0：`verifySignedBundleV2` 中的安全修复、安全层级执行、盲化 RPR 导出；对
  `blindRpr`（需要 `pii_salt`）而言是破坏性变更。
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.9.0 → v2.10.0：V2 验证方加固和层级执行；对
  `BundleBuildInput`（已签名工件）和 `BlindRPR` 而言是破坏性变更。
- `dcp-ai`（crates.io）2.9.0 → 2.10.0：原生 V2 验证方、层级执行、RFC 3339 到期时间解析；对 `blind_rpr` 和
  `wasm` bundle 构建器而言是破坏性变更。
- `@dcp-ai/wasm` 2.0.0 → 2.1.0：`buildBundle` 接受已签名工件；`verifyBundle` 接受完整的验证方策略。
- `@dcp-ai/openclaw` 2.0.0 → 2.1.0：安全层级下限，以及已签名 RPR 上的 `pii_salt`。
- 未变更：`@dcp-ai/cli` 2.0.0 和其他集成包。

<a id="security-1"></a>
<a id="security_1"></a>

### 安全

- 四个 SDK 中的盲化 RPR 承诺都已加盐。`pii_hash` 原为 `sha256(canonical({ contact, legal_name }))`，因此任何
  猜中某个主体姓名和联系方式的人，都可以用已发布的盲化 RPR 确认这一猜测，而在不可变日志或锚定上，这一点永远
  成立。完整 RPR 现在带有 `pii_salt`（来自 CSPRNG 的 32 字节，小写十六进制），它与完整 RPR 一起签名且从不公开，
  `pii_hash` 为 `sha256(canonical({ contact, legal_name, pii_salt }))`。删除完整 RPR，连同其中的盐，会使已发布的
  承诺无法被打开（`spec/DCP-AI-v2.0.md` §12.1）。在所有 SDK 中，缺失的 `contact` 或 `legal_name` 都按 `null`
  计入哈希；TypeScript 以前会省略该键。`tests/interop/v2/interop_vectors.json` 中新的 `blinded_rpr` 类别（加盐的
  和旧式的 `pii_hash`，以及预期的盲化记录）在四个 SDK 的测试套件中运行，由 `generate-interop-vectors.ts` 生成。
- 盲化 RPR 验证（`verifyBlindedRpr`、`verify_blinded_rpr`、`VerifyBlindedRPR`）现在在四个 SDK 中还会比较
  `session_nonce` 和 `binding_keys`。以前，绑定密钥或会话 nonce 不同的完整 RPR 仍能与盲化记录匹配。在 Go 中，
  从 JSON 解码的列表字段不再与以 `[]string` 构建的相同列表匹配失败。
- 验证服务器：`POST /v2/passport/register` 会验证护照的复合自签名，并只登记其签名者密钥；重新登记某个
  `agent_id` 需要一份由其所有有效密钥签署的更新护照。以前任何人都可以用自己的密钥重新登记一个代理，植入自己的
  紧急令牌，然后对其执行紧急撤销。`POST /v2/keys/rotate` 会验证持有证明和旧密钥的授权
  （`verifyKeyRotation`），`POST /v2/multi-party/authorize` 会用各方已登记的密钥验证其签名，且每方只计一次。
- 验证服务器：`/v2/policy/mode`、`/v2/governance/register`、`/v2/advisory/publish` 和
  `/v2/advisory/auto-apply` 需要 `Authorization: Bearer $OPERATOR_TOKEN`（未设置时锁定）。建议会经过 schema
  验证，上限为 1000 条。速率限制以套接字地址为键，而不是客户端提供的 `X-Forwarded-For`（在代理之后使用
  `TRUST_PROXY=true`），`VERIFIER_MODE` / `ALLOW_V1_BUNDLES` 从环境变量读取；`allow_v1_bundles` 现在会被执行。
- 撤销服务：代理使用其已签名护照登记（`POST /v2/register`），记录 kid 归属、密钥到期时间和紧急令牌；重新登记
  需要一份由代理有效的经典密钥和 PQ 密钥签署的更新护照，`/revoke` 和 `/v2/revoke` 必须由其有效密钥签署。
  `GET /v2/check/kid/:kid` 无需 `?agent_id=` 即可报告已登记 kid 的紧急撤销。
- 锚定服务：不再生成随机的 `tx_hash`（记录带有 `tx_hash: null`、`onchain: false`），请求体上限为 1 MB，
  `POST /flush` 需要运营方令牌，格式错误的输入返回 400 而不是崩溃。透明度日志：树头使用 Ed25519 签名，而不是
  其他人无法验证的 HMAC；`OPERATOR_KEY` 必须是 64 个十六进制字符的种子（compose 中公开的占位值已被删除），
  Merkle 树使用 RFC 6962 的叶子和节点前缀，`POST /gossip/peers`（一个 SSRF 途径）需要运营方令牌。
- 验证服务器和撤销服务：过期的密钥不能再重新登记护照、授权密钥轮换，或为某一方或某次撤销签名；重新登记会保留
  已登记的密钥条目，因此新护照不能延长密钥的 `expires_at`。
- Fly 配置保持一台验证机器和一台撤销机器持续运行：缩容到零会在机器空闲时清空它们的内存注册表。
- TypeScript SDK：`verifySignedBundleV2` 实现了 `spec/VERIFICATION.md` 的 V2-7 和 V2-8 步骤。存在的 PQ 签名
  （`pq_over_classical`）在任何模式下都必须验证通过；`hybrid_preferred`（中等风险的默认模式）以前会带警告接受
  无效的 PQ 签名，`classical_only` 则会忽略它。现在只容许其缺失（`classical_only` 绑定），而且在
  `hybrid_required` 或 `pq_only` 下也不容许。每个工件自身的 `composite_sig` 现在也按相同规则、使用其上下文标签
  验证：RPR 用其 `binding_keys` 验证，护照、意图和策略决定用护照的 `keys` 验证。以前只检查 `payload_hash`，因此
  即使在 `hybrid_required` 下，意图上伪造的代理签名也能验证通过。参考验证方、`dcp verify-bundle` 和服务器会随
  下一个 `@dcp-ai/sdk` 版本获得这一改进。
- TypeScript SDK：`verifySignedBundleV2` 遇到无法识别的验证模式时失败关闭，并拒绝模式不是 `classical_only`、
  `hybrid_preferred`、`hybrid_required` 或 `pq_only` 的验证方策略。
- Go（`v2.VerifySignedBundleV2`）和 Rust SDK：每个工件的 `composite_sig` 都以同样方式验证（V2-8），签名者密钥
  按 `kid` 查找（V2-6），bundle 签名者在护照的 `keys` 和 RPR 的 `binding_keys` 中查找。以前它们按算法选取护照中的
  Ed25519 和 ML-DSA-65 密钥，因此会拒绝用主体密钥签署的 bundle，而对护照中没有任何 Ed25519 密钥的 bundle，会在
  不检查其签名的情况下带警告报告为已验证。
- TypeScript、Go 和 Rust SDK：在每个复合签名中、在每种验证模式下，经典位置必须是 Ed25519，PQ 位置必须是
  ML-DSA-65 或 SLH-DSA-192f，且来自 `alg` 相同的密钥。Go 还会拒绝 RPR、护照、意图或策略决定为 null 或不是对象的
  bundle（以前会跳过对该工件的所有检查），TypeScript 对这样的 bundle 返回 `verified: false`，而不是抛出异常。
- 安全层级（规范 §14.2）：Go SDK 和 `@dcp-ai/wasm` 绑定（`wasm_compute_security_tier`）匹配的是意图 schema
  不允许的 `payment`/`transfer`、`financial`、`health`、`legal` 和 `biometric`，因此符合 schema 的
  `initiate_payment`、`financial_data` 和 `health_data` 意图在那里是 `routine`，而在 TypeScript、Python 和 Rust
  SDK 中是 `elevated`。现在四个 SDK 和该绑定计算出相同的层级，并由 `tests/interop/v2/interop_vectors.json` 中新的
  `security_tier` 向量检查。
- 验证服务器：`POST /verify` 和 `POST /v2/bundle/verify` 中的 `resolved_tier`，以及 `/v2/bundle/verify` 的层级
  检查，都直接采用 `intent.security_tier`，因此声明 `routine` 的代理可以降低自己的层级，而且它们从意图中读取
  schema 并不允许的 `risk_score`。现在它们使用 §14.2 的规则（`lib/security-tier.js`）：`risk_score` 取自 bundle
  的策略决定，使用 `estimated_impact`，未知值按 `elevated` 处理，显式层级只能提高结果。`/v2/intent/declare` 也以
  同样方式计算 `resolved_tier`。
- OpenClaw 集成：`dcp_verify_bundle` 和 `dcp_log_action` 直接采用 `intent.security_tier`
  （`security_tier ?? computeSecurityTier(intent)`），因此声明的层级可以降低计算出的层级，而且它们没有传入策略
  决定。现在显式层级只能提高层级。策略决定也会被传入，因此一旦 `@dcp-ai/sdk` 读取它（2.1.2 之后的版本），
  `risk_score` 就会被计入。
- 参考服务中的拒绝服务问题，这些服务的状态保存在内存中，重启后不会保留：
  - 验证服务器：登记按客户端限速（`REGISTRATIONS_PER_HOUR`，默认每小时 20 次），轮换只保留代理最近 4 个已退役
    的密钥，已登记护照只存储 `created_at`。以前一个代理反复轮换，或大量登记，会填满 10,000 个密钥的注册表（重启
    之前一直返回 507），而每个存储的已签名护照最多可占 1 MB。被丢弃的密钥作为墓碑保持撤销状态，永远不能再登记，
    一个代理在其生命周期内最多可以登记 `MAX_KEYS_PER_AGENT` 个密钥（64 个）。轮换会在检查上限之前丢弃一个已退役
    的密钥，因此在注册表已满时仍可进行。重新登记时的密钥族检查不再以二次复杂度重新扫描注册表。
  - 透明度日志：`POST /gossip/exchange` 只接受由已固定对等方签署、格式正确的树头，请求体最多 16 KB，并保留最近
    100 条不同的警报，因此重放的树头无法把较早的警报挤出去。轮询得到的树头必须能用对等方已固定的密钥验证，一次
    轮询最多读取 16 KB，一个间隔后超时，并且绝不与上一次轮询重叠。以前任何人都可以用 1 MB 的字符串填满警报列表，
    对等方的树头从未被验证，挂起的对等方会让轮询不断堆积。
  - 撤销服务：`POST /v2/register` 按客户端限速，上限为 `MAX_AGENTS`（默认 10,000），存储的字段也有界，因此大量
    登记或超大的记录不再能耗尽其内存并清空所有撤销记录。
- 验证服务器和撤销服务：登记新的 `agent_id` 需要运营方令牌。护照只是自签名的，因此任何人都可以抢先用自己的
  密钥和令牌登记受害者的 `agent_id`，然后对其执行紧急撤销，或用 409 把真正的代理挡在外面。每次重启都会让所有
  `agent_id` 再次面临这一问题。对于从未登记过的 kid，`GET /v2/check/kid/:kid` 返回 404（`registered: false`），
  而不是调用方在 `?agent_id=` 中指定的任意代理的判定。
- 验证服务器和撤销服务：公钥和签名必须是恰好等于其算法大小的规范 base64，V2 schema 把 `public_key_b64` 和
  `sig_b64` 限制在 base64 字母表内并限制其长度。宽松的解码器会跳过空白，因此填充了 900 KB 空格的 ML-DSA 密钥
  会被登记并原样返回，填充过的签名会被存储并由 `/v2/list` 发布。
- TypeScript SDK 的 `verifySignedBundleV2` 执行安全层级（规范 §14.3）：它用策略模式与根据已签名意图和策略决定
  计算出的层级模式中更严格的一个进行验证，并在 `details.resolved_tier` 中报告。以前模式只取决于代理自己的
  `passport.risk_tier`，因此在 `DEFAULT_VERIFIER_POLICY` 下，声明 `risk_tier: "low"` 的护照即使对付款意图也会
  得到 `classical_only`。
- TypeScript SDK：`AdaptiveRateLimiter.check`、`generateSessionExpiry` 和 `VerificationCache.set` 把未知的
  层级名称或 `constructor` 这样的原型键按 `elevated` 计。以前速率限制器会为每个编造的名称单独建桶，
  `generateSessionExpiry` 遇到 `constructor` 会抛出异常，缓存也从不让这类条目过期。
- OpenClaw 集成：`dcp_declare_intent` 在为意图评分之前，就计算了它签入意图和策略决定的层级。现在它会传入风险
  分数，一旦 `@dcp-ai/sdk` 读取它（2.1.2 之后的版本），该分数就会被计入。
- Go（`v2.VerifySignedBundleV2`）、Rust（`v2::verify_bundle::verify_signed_bundle_v2`，以及 `@dcp-ai/wasm` 中
  `verifyBundle` 背后的绑定 `wasm_verify_signed_bundle_v2`）和 Python（`verify_signed_bundle_v2`）验证方像
  TypeScript 验证方一样执行安全层级：模式取策略模式与层级模式中更严格的一个，并应用于 bundle 签名和每个工件的
  签名；未知的策略模式失败关闭；结果报告层级和模式。Go 和 Rust 验证方以前没有验证方策略，对任何意图都接受
  `classical_only` 签名。
- Python SDK 的 `verify_signed_bundle_v2`：与 TypeScript、Go 和 Rust SDK 一样，在每个复合签名中、在每种模式下，
  经典位置必须是 Ed25519，PQ 位置必须是 ML-DSA-65 或 SLH-DSA-192f，且来自 `alg` 相同的密钥。以前在 `pq_only`
  下，它会接受经典位置上的 ML-DSA-65。
- Go 和 Rust SDK：复合签名必须带有其 `pq` 成员，`classical_only` 时为 `null`
  （`schemas/v2/composite_signature.schema.json`）。以前它们把缺失的 `pq` 当作 `null` 解码，并验证通过这样的
  `classical_only` 签名，而 TypeScript 和 Python 验证方会拒绝它。`bundle_vectors.json` 用
  `classical_only_bundle_signature_without_pq` 固定了这一点。
- Go 和 Rust 的 V2 验证方像 TypeScript 和 Python 验证方一样，把审计轨迹绑定到已签名的清单：重新计算
  `audit_merkle_root`，检查 `audit_count`，并要求链从 `GENESIS` 开始。以前任何人都可以把一个签名有效的 bundle 的
  审计条目替换为一条伪造的、自洽的链，而两者仍会报告为已验证。
- Go 和 Rust 的 V2 验证方在无法执行某项清单检查时失败关闭：缺少 `rpr_hash` 之类的工件哈希，或载荷缺失或无法
  规范化，都会成为错误，而不是被跳过的检查。
- Go 和 Rust 的 V2 验证方像 TypeScript 和 Python 验证方一样，用每个工件的载荷核对其 `payload_hash`；以前它们会
  忽略它。
- Go 和 Rust 的 V2 验证方会拒绝 `manifest.session_expires_at` 已过的 bundle，因此不能再对它们重放过期的会话。
  `@dcp-ai/wasm` 验证方从 JavaScript 读取时钟，因为 `SystemTime::now()` 在 `wasm32-unknown-unknown` 上会 panic。
- Rust SDK：`is_session_expired` 按字典序比较 RFC 3339 字符串和 UTC 时钟，因此对带偏移的时间戳最多会误判 14 个
  小时：一个一小时后结束、写作 `-05:00` 的会话被算作已过期，而一个一小时前已结束、写作 `+05:00` 的会话被算作
  仍然有效。现在它会解析时间戳（`parse_rfc3339_millis`）并比较时刻，用于会话和密钥到期以及建议辅助函数。
- 四个验证方中的到期时间戳：存在但不是带 `Z` 或 `±hh:mm` 偏移的 RFC 3339 时间戳的 `session_expires_at` 或密钥
  `expires_at` 会被拒绝；缺失或为 `null` 仍表示不过期。TypeScript 以前接受 `Date` 无法解析（`"n/a"`）或宽松解析
  （`"2099-12-31"`）的任何内容，并跳过空的 `session_expires_at`；Rust 接受 `"n/a"`；Go 跳过非字符串的密钥
  `expires_at`；Python 会抛出异常。`isSessionExpired` 和 `is_session_expired` 把格式错误的值视为已过期。
- 密钥有效性检查覆盖所有能够签名的密钥。四个验证方都会拒绝主体 RPR 的 `binding_keys` 中已撤销或已过期的密钥，
  这些密钥签署 RPR，也可能签署 bundle；TypeScript 和 Python 以前只检查护照密钥。Go 和 Rust 验证方以前完全不检查
  密钥状态，现在也会拒绝已撤销或已过期的护照密钥。
- 四个验证方都会像对待 `revoked` 一样拒绝 `status` 为 `expired` 的密钥。密钥条目 schema 允许 `expired`，但以前只
  检查 `revoked`，因此一个标记为已过期且没有 `expires_at` 的密钥仍能签名。
- 空审计轨迹的 Merkle 根必须是 `sha256:` 后接 64 个零，Go 和 Rust 构建器本来就是这样写的。以前当 bundle 没有审计
  条目时，四个验证方都会跳过 `audit_merkle_root`，因此它可以是任意值。

<a id="changed-breaking"></a>

### 变更（破坏性）

- 验证服务器（`POST /v2/passport/register`）和撤销服务（`POST /v2/register`）：新的 `agent_id` 需要
  `Authorization: Bearer $OPERATOR_TOKEN`（否则返回 401）；重新登记仍可自助完成。撤销服务的
  `GET /v2/check/kid/:kid` 会忽略 `?agent_id=`，对未登记的 kid 返回 404。
- 验证服务器：一个代理在其生命周期内最多可以登记 `MAX_KEYS_PER_AGENT` 个密钥（默认 64 个）；之后的轮换会得到
  409，代理必须登记一个新的 `agent_id`。
- Schema：`key_entry.public_key_b64` 和 `composite_signature` 的 `sig_b64` 必须匹配 `^[A-Za-z0-9+/]+={0,2}$`，
  长度上限分别为 3,456 和 66,476 个字符。
- 透明度日志：每个 `GOSSIP_PEERS` 条目的格式为 `<url>#<base64 Ed25519 public key>`。来自未固定密钥对等方的树头
  会被忽略，`/gossip/exchange` 会拒绝它们（403）；Docker Compose 中的日志只有在设置好密钥之后才会进行 gossip
  （见 `docker/README.md`）。
- Go SDK：`BundleBuildInput` 接受已签名工件（`SignedPayload`，见 `v2.SignPayload`）和 `[]AuditEventV2` 审计
  条目。`BuildBundleV2` 以前包裹的是未签名的载荷，而验证方现在会拒绝它们（V2-8），并且它会用空的审计条目填充
  bundle。
- WASM（`wasm_build_bundle`，以及 `@dcp-ai/wasm` 中的 `buildBundle`）：每个工件都是来自 `wasm_sign_payload` /
  `signPayload` 的 `SignedPayload`，而不是原始载荷。用原始载荷构建的 bundle 不带工件签名，不再能验证通过。
- 撤销服务：删除了 `POST /v2/register-emergency-token` 和 `POST /v2/register-key-expiry`，统一改用
  `POST /v2/register`。V1 的 `/revoke` 需要一个在那里登记的代理，而登记需要混合签名（Ed25519 + ML-DSA-65 或
  SLH-DSA-192f）的护照，因此仅使用 Ed25519 的（V1）代理不能再发布撤销。已撤销的代理不能再次被撤销（409）。
- 验证服务器和撤销服务：重新登记某个 `agent_id`（例如为了替换紧急撤销令牌）需要一份 `created_at` 比已登记
  护照更新、并由该代理所有有效密钥签署的护照；不带令牌的护照会保留已登记的令牌。丢失了某一族（经典或 PQ）全部
  有效密钥的代理无法重新登记：只能通过紧急撤销令牌或运营方恢复。
- 透明度日志：叶子哈希、根和包含证明随 RFC 6962 前缀而改变，STH 的 `signature` / `public_key` 现在是 base64
  编码的 Ed25519。`/add` 只接受 `sha256:<64 hex>` 哈希，锚定服务的 `/anchor` 只接受带可选 `sha256:` 前缀的 64
  个十六进制字符。
- 验证服务器：`/v2/keys/rotate` 需要 `authorization_sig` 和 `timestamp`（`KeyRotationRecord`）。
  `dcp rotate-key` 和 `dcp keys certify` 仍发送模拟的持有证明，服务器现在会拒绝它。
- Python SDK：SLH-DSA-192f 现在实现 FIPS 205（纯 SLH-DSA，空上下文），与 TypeScript、Go 和 Rust SDK 一致。
  它以前基于 PQClean 标准化之前的 SPHINCS+，后者签署的是原始消息而不是 `0x00 || 0x00 || message`，因此
  SLH-DSA 签名在两个方向上都无法跨 SDK 验证。`dcp-ai` 2.8.2 及更早版本中 `SlhDsa192fProvider` 生成的签名不再能
  验证通过。
- Python SDK：要求 `pqcrypto>=1.0,<2`，现在用于 ML-DSA-65、SLH-DSA-192f 和 ML-KEM-768，取代 2.8.2 的 `<1.0`
  上限（`pqcrypto` 1.0 改变了其 API 并移除了 SPHINCS+）。`dcp_ai.providers` 不再吞掉 `ImportError`，缺少提供方时
  PQ 互操作测试也不再被跳过。
- Python SDK：`VerifierPolicy` 会拒绝未知字段而不是丢弃它们，并补上了之前缺少的字段
  （`allow_classical_fallback_disable`、`warn_classical_only_deprecated`、`advisory_rejected_algs`、
  `require_session_expiry`、`max_session_duration_seconds`、`require_audience_binding`、`verifier_id`）。以前
  `VerifierPolicy(require_audience_binding=True,
  verifier_id=...)` 会悄无声息地丢掉这两个字段。在 `verify_signed_bundle_v2` 中，dict 形式的策略会被当作
  `VerifierPolicy` 验证（未知键会抛出异常），其中省略的字段取模型的默认值（每个风险层级都是
  `hybrid_required`），而不是默认策略中 `low` → `classical_only` 的设置。只有 `risk_overrides=None` 才会让
  `default_mode` 适用于所有层级。
- 四个 SDK 中，盲化都需要 `pii_salt`。当完整 RPR 没有 `pii_salt`，或其值不是 64 个小写十六进制字符时，
  `blindRpr`（TypeScript）和 `blind_rpr`（Python，`ValueError`）会抛出异常，`BlindRPR`（Go）和 `blind_rpr`
  （Rust）会返回错误。请在签署 RPR 之前用新的辅助函数设置它：没有它而签署的 RPR 必须重新签名后才能盲化。
- 四个 SDK 中，盲化 RPR 验证都会拒绝 `pii_salt` 存在但不是由 64 个小写十六进制字符组成的字符串的完整 RPR。以前在别处用空的
  或过短的盐盲化的记录会在没有任何警告的情况下验证通过，而未加盐的记录反倒会被标记。
- 盲化 RPR 验证结果：`verify_blinded_rpr`（Python）返回新的 `warnings` 键，Go 的 `BlindedRprCheck` 新增
  `Warnings` 字段，因此比较整个结果，或用不带字段名的字面量构建 `BlindedRprCheck` 的代码必须修改。
- `schemas/v2/responsible_principal_record.schema.json` 接受 `pii_salt`。该 schema 设置了
  `additionalProperties: false`，因此用旧 schema 验证的验证方会拒绝带盐的 RPR：请在生成方开始设置它之前先更新
  验证方。
- Rust SDK：`ResponsiblePrincipalRecordV2` 新增公有字段 `pii_salt: Option<String>`，因此结构体字面量必须设置它。
- 安全层级计算（规范 §14.2），所有 SDK：`risk_score` 从 bundle 的策略决定中读取，绝不从意图中读取（意图 schema
  不允许它，因此对有效意图而言层级从来不会是 `standard`）。`estimated_impact` 为 `medium` 时把层级提高到
  `standard`，为 `high` 时提高到 `elevated`；`action_type`、`estimated_impact` 或 `data_classes` 的值缺失、类型
  错误或未知时，至少得到 `elevated`；显式的 `intent.security_tier` 只能提高结果。
  - TypeScript：`computeSecurityTier(intent, policyDecision?)`。
  - Python：`compute_security_tier(intent, policy_decision=None)`；`compute_security_tier({})` 现在为
    `elevated`。LangChain 和 CrewAI 集成改用它，不再使用各自的副本。
  - Go：`SecurityTierInput` 新增 `EstimatedImpact` 和 `SecurityTier`，其零值（或 nil 的 `DataClasses`）现在为
    `elevated`。`v2.SecurityTierInputFromPayloads(intent, policyDecision)` 根据解码后的载荷构建输入。
  - Rust：`compute_security_tier(intent, policy_decision: Option<&Value>)`。`wasm_compute_security_tier` 和
    `@dcp-ai/wasm` 中的 `computeSecurityTier` 接受一个可选的策略决定。
- 安全层级计算，所有 SDK 和参考服务器：策略决定中缺失或不是 0 到 1000 之间整数的 `risk_score` 视为未知，因此
  层级至少为 `elevated`，与意图中的未知值相同。以前非数值会被当作 0，其他数字按原样比较，因此 `-1` 会得到
  `routine`，`1e30` 会得到 `maximum`（现在为 `elevated`，模式同为 `hybrid_required`）。没有策略决定时分数仍为
  0。在 Go 中，`SecurityTierInputFromPayloads` 对这样的值把 `RiskScore` 设为 -1，`ComputeSecurityTier` 把
  0..1000 之外的任何 `RiskScore` 视为未知。
- TypeScript SDK 的 `verifySignedBundleV2`：如今凭 `classical_only` 签名可以通过的 bundle，在其意图敏感时会被
  拒绝：`initiate_payment`、`pii`、`financial_data`、`health_data`、`credentials` 或 `children_data`，
  `estimated_impact: "high"`，策略决定的 `risk_score` 为 500 或以上，或意图 schema 之外的值。请用混合签名
  （`pq_over_classical`）签署它们。根目录验证方（`lib/verify.js`、`dcp verify-bundle`、服务器）会随下一个
  `@dcp-ai/sdk` 版本获得这一变更。
- Go、Rust 和 Python 验证方会拒绝同样的 `classical_only` bundle。Go 的 `VerifySignedBundleV2` 和 Rust 的
  `verify_signed_bundle_v2` 改为应用 TypeScript 的 `DEFAULT_VERIFIER_POLICY`，而不再是没有策略；
  `wasm_verify_signed_bundle_v2` 接受一个可选的策略 JSON（一个 `VerifierPolicy`），提供时会拒绝 V1 bundle。它们的
  策略只能在 `default_mode`、`risk_overrides` 和第 3 阶段字段（`advisory_rejected_algs`、
  `warn_classical_only_deprecated`、`allow_classical_fallback_disable`，按 TypeScript 的方式执行）上与默认策略
  不同：任何其他变更，或 Rust `VerifierPolicy` JSON 中的未知字段，都会使验证失败，而不会被忽略。
- Python SDK 的 `verify_signed_bundle_v2`：与 TypeScript 一样，关于 bundle 签名的错误和警告以 `bundle: ` 开头，
  为 null 或不是对象的工件会被报告为 `<name>: not a SignedPayload object`，未知的策略模式会在检查任何签名之前以
  `Unknown verification mode in verifier policy` 失败。

<a id="added-1"></a>
<a id="added_1"></a>

### 新增

- `generatePiiSalt`（TypeScript）、`generate_pii_salt`（Python、Rust）和 `GeneratePIISalt`（Go）。四个 SDK 的
  RPR 类型、`schemas/v2/responsible_principal_record.schema.json` 和 `api/proto/dcp.proto` 都带有 `pii_salt`。
  Python 的 `ResponsiblePrincipalRecordV2` 在序列化时会省略未设置的 `pii_salt`，因为 schema 中它没有 null 取值。
- 旧式的未加盐盲化 RPR 仍能验证通过，但会带有弃用警告：`verifyBlindedRpr`（TypeScript）、`verify_blinded_rpr`
  （Python）和 `VerifyBlindedRPR`（Go）的结果带有 `warnings` 列表。Rust 的 `BlindedRprCheck` 保留其两个字段，
  因为新增公有字段会破坏构建或解构它的调用方；在 Rust 中，完整 RPR 中缺失或为 null 的 `pii_salt` 即表示旧式记录。
- `@dcp-ai/openclaw`：`dcp_identity_setup` 在签署其 RPR 时带上 `pii_salt`，因此该记录以后无需重新签名即可盲化。
- 撤销服务：`REVOCATION_STATE_PATH` 把登记和撤销保存在文件中（默认：仅在内存中）。写入以经过 fsync 的 JSON 行
  追加，启动时会重放文件并通过原子重命名进行整理重写；如果路径不可写或文件超过 512 MB，服务会拒绝启动。Docker
  Compose 栈会在一个卷上设置它。
- 验证服务器：`MAX_REGISTERED_KEYS` 和 `MAX_KEYS_PER_AGENT` 决定密钥注册表的大小。
- `effectiveVerificationMode`（TS）、`effective_verification_mode`（Python、Rust）和
  `EffectiveVerificationMode`（Go）：策略模式与层级模式中更严格的一个，`pq_only` 保持不变（规范 §14.3）。共享
  向量位于 `security_tier.effective_mode`。
- Go SDK：`v2.VerifySignedBundleV2WithPolicy(registry, json, policy)` 和 `v2.DefaultVerifierPolicy()`。Rust SDK：
  `verify_signed_bundle_v2_with_policy` 和 `impl Default for VerifierPolicy`（即 TypeScript 的默认策略）。Go 和
  Rust 的 `VerifierPolicy` 新增 `schemas/v2/verifier_policy.schema.json` 中的第 3 阶段字段，因此 TypeScript 的
  `DEFAULT_VERIFIER_POLICY` 可以原样解码到其中。`@dcp-ai/wasm`：`verifyBundle(signedBundle, policy?)` 和
  `VerifierPolicy` 类型。Python 结果的 `details` 新增 `resolved_tier`。
- `tests/interop/v2/bundle_vectors.json`：`must_reject_bundles`，即来自低风险护照、带有敏感意图的仅经典签名
  bundle，每个验证方在每种模式下都必须拒绝；以及一个仅经典签名的 routine 对照，附有每种模式下的预期判定。
  TS、Go、Rust 和 Python 测试都会运行它们，Python 现在运行整个文件。`default_verifier_policy` 带有 TypeScript 的
  `DEFAULT_VERIFIER_POLICY`，每个 SDK 都必须把它作为策略接受。
- `tests/interop/v2/bundle_vectors.json`：针对错误的 `payload_hash`、被替换或截断的审计条目、不从 `GENESIS`
  开始的审计链、没有 `rpr_hash` 的清单、已过期的会话，以及已撤销或已过期的护照密钥和绑定密钥的拒绝用例。
- `@dcp-ai/wasm`：`npm test` 在 Node 中用构建好的包对 `tests/interop/v2/bundle_vectors.json` 运行
  `verifyBundle`，CI 会运行它。以前它只做类型检查，而 Rust 的 wasm32 测试只会被编译，因此 wasm 验证方从未在 CI
  中运行过。
- `tests/interop/v2/interop_vectors.json` 的 `rfc3339`：带偏移和小数部分的 RFC 3339 时间戳所表示的时刻，以及
  每个验证方都会拒绝的格式错误的值。`bundle_vectors.json` 增加了格式错误和带偏移的到期时间，其已签名 bundle 带有
  用偏移写出的遥远未来的到期时间。TypeScript 的 `parseRfc3339`、Python 的 `parse_rfc3339` 和 Rust 的
  `parse_rfc3339_millis` 就是验证方使用的解析器。
- TypeScript SDK：`blindRpr`、`verifyBlindedRpr`、`isBlindedRpr` 和 `computePiiHash` 从包入口导出。它们早已实现，
  但在 `@dcp-ai/sdk` 2.1.2 及更早版本中无法从包中访问；Python、Go 和 Rust 早已导出它们。
- `lib/verify.js` 导出 `verifyCompositeSig`（对载荷的复合签名，签名者密钥按派生的 kid 查找）及其 `v2Registry`；
  `lib/http.js` 包含 `server/` 和 `services/` 共享的请求体解析、客户端 IP 和运营方令牌辅助函数。锚定服务和
  透明度日志服务有 `node:test` 测试套件，在 CI 中与已有的测试一起运行。
- Rust SDK：V2 bundle 验证方从 `wasm` 特性移到了 `dcp_ai::v2::verify_bundle::verify_signed_bundle_v2`，因此原生
  构建和 `cargo test` 都会运行它；`wasm_verify_signed_bundle_v2` 委托给它。
- `tests/interop/v2/bundle_vectors.json`：一个每个 V2 验证方都必须接受的已签名 bundle，以及若干变异（伪造的
  bundle PQ 签名、伪造或错误归属的工件签名、放错位置的算法、为 null 或不是对象的工件），变异之后验证方必须以
  指明 bundle 或工件的错误拒绝它，由 TypeScript、Go 和 Rust 测试套件检查。用
  `sdks/typescript/src/__tests__/generate-bundle-vectors.ts` 重新生成。
- Go SDK：`v2.SignPayload` 把一个工件签署为 `SignedPayload`：复合签名，或在未提供 PQ 密钥时为仅经典签名。
- Python SDK：`MlKem768Provider`（FIPS 203），即其他 SDK 早已具备的 ML-KEM-768 原语。Python 的 DCP-04 握手
  目前还不会执行 X25519 + ML-KEM-768 混合密钥交换。
- Python SDK：V2 bundle。`BundleBuilderV2`、`sign_bundle_v2`、`sign_bundle_v2_classical_only`、
  `verify_signed_bundle_v2`、`DEFAULT_VERIFIER_POLICY` 和 `PQ_ONLY_VERIFIER_POLICY` 移植自 TypeScript 的
  `builder-v2.ts`、`signer-v2.ts` 和 `verify-v2.ts`。该验证方也会检查每个工件的复合签名（VERIFICATION.md V2-8），
  在每种模式下拒绝存在但无效的 PQ 签名（V2-7），并在遇到未知验证模式时失败关闭。与 TypeScript 验证方不同，它会
  把 bundle 的 PQ 检查点绑定到清单的 `pq_checkpoints` ID，并在 `max_session_duration_seconds` 检查中把未签名的
  `signature.created_at` 限制在验证时间之内：被改写的值最多能把这项检查缩短到会话的剩余时长，而不能缩短到零。
  要彻底解决，需要一个已签名的会话开始时间，而清单中没有。检查点内容（V2-12）和
  `audit_merkle_root_secondary` 仍未被验证。
- `tests/nist-kat/ml-kem-768` 和 `tests/nist-kat/slh-dsa-192f`：NIST ACVP 向量（ML-KEM-768 解封装和密钥检查，
  SLH-DSA-SHA2-192f 签名验证）。
- `tests/interop/v2/cross_sdk_vectors.json`：由 TypeScript 和 Python SDK 生成、并由对方验证的 SLH-DSA-192f、
  ML-KEM-768 和已签名 V2 bundle 向量。

<a id="fixed-1"></a>
<a id="fixed_1"></a>

### 修复

- V2 一致性示例（`scripts/generate-v2-examples.js`）使用不透明的 `human_id`，而不是由法定名称派生的
  标识（§12.1 现在禁止这样做），其 RPR 带有 `pii_salt`。
- Python SDK：`BundleManifest.pq_checkpoints` 保存检查点 ID，与 `schemas/v2/bundle_manifest.schema.json` 一致，
  该模型新增 `session_expires_at` 和 `intended_verifier`。

<a id="documentation-1"></a>
<a id="documentation_1"></a>

### 文档

- `spec/DCP-AI-v2.0.md` §12.1 规定了加盐承诺、只与完整 RPR 一起披露的私有盐、通过删除完整 RPR 实现的删除、
  不得（MUST NOT）包含个人信息或由个人信息派生的不透明 `human_id`，以及对未加盐承诺的弃用。
- `spec/CANONICALIZATION_PROFILE.md`、`spec/DCP-AI-v2.0.md`、WASM SDK README（所有语言）、
  `docs/NIST_CONFORMITY.md` 以及 TypeScript、Python 和 Rust 规范化器的注释把 `dcp-jcs-v1` 描述为基于
  RFC 8785，而不是它的严格子集或纯粹的 RFC 8785：规则 1 按码点排序键，RFC 8785 按 UTF-16 码元排序。配置文件
  本身没有改变。
- TypeScript SDK README（所有语言）和 `docs/API_REFERENCE.md` 列出了复合签名、bundle、呈现、PQ 检查点、A2A、
  错误、紧急撤销、密钥恢复、哈希和 CBOR 函数的真实签名。
- `docs/API_REFERENCE.md`：V2 验证流水线列出了逐工件的签名检查，关于 V2-7 和 V2-8 的已知限制说明现在只适用于
  `@dcp-ai/sdk` 2.1.2 及更早版本。
- Go 和 WASM SDK README（所有语言）以及 `docs/MIGRATION_V1_V2.md` 在构建 bundle 之前签署每个工件，并在护照和
  RPR 中列出签名密钥。
- `spec/DCP-AI-v2.0.md` §14.2 描述了上述层级计算，§14.3 和 §14.4 把 `resolved_tier` 描述为仅供参考（§14.2 不读取
  它），`spec/VERIFICATION.md` 按 §14.2 的方式计算层级。SDK README（所有语言）、`docs/API_REFERENCE.md`、快速
  入门、迁移和代理创建指南以及 `sdks/wasm/example.html` 都把策略决定传给层级函数，并使用意图 schema 中的取值。
- `spec/VERIFICATION.md` V2-7 和 `spec/DCP-AI-v2.0.md` §7.1 规定，存在的 PQ 签名在任何模式下都必须验证通过，
  验证方也早已如此。`docs/API_REFERENCE.md` 记录了 `details.resolved_tier` 和 `verifySignedBundleV2` 考虑层级的
  模式，TypeScript SDK README（所有语言）对其作了描述。
- `docs/MIGRATION_V1_V2.md` §6.3 不再展示 CLI 并不具备的 `dcp migrate-check` 命令，也不再在意图上展示
  `risk_score`；它用 `dcp verify-bundle --policy hybrid_required` 验证迁移后的 bundle。
- `spec/DCP-AI-v2.0.md` §14.3 把层级执行定为 V2 验证方的 MUST（§20.1）：模式取策略模式与层级模式中更严格的一个。
  `spec/VERIFICATION.md` 在 V2-9 步骤中计算层级和实际模式，并在 V2-10 步骤中用它执行策略，而以前那里的层级检查
  是可选的。`docs/OPERATOR_GUIDE.md` 和 `docs/SECURITY_MODEL.md` 描述了考虑层级的模式，Go、Python、Rust 和 WASM
  SDK README（所有语言）描述了验证方策略。
- 规范 §18（验证流水线）、`docs/OPERATOR_GUIDE.md` 和迁移指南的第 8 步按验证方的实际实现描述层级执行。运营方
  指南不再声称最高层级会验证 PQ 检查点（目前还没有任何验证方这样做，V2-12），并说明在其 `@dcp-ai/sdk` 依赖升级
  之前参考服务器会执行什么。
- `spec/VERIFICATION.md` V2-3、V2-4 和 V2-13 详细说明了这些检查：`payload_hash`、失败关闭的清单哈希、与清单绑定
  的审计轨迹、会话到期，以及 RPR `binding_keys` 的有效性。`docs/API_REFERENCE.md` 在密钥有效性步骤中列出了绑定
  密钥。

## [2.9.0] - 2026-10-21

<a id="package-versions-1"></a>
<a id="package-versions_1"></a>

### 包版本

- `dcp-ai`（PyPI）2.8.1 → 2.8.2：仅包含修复。
- `@dcp-ai/sdk`（npm）2.1.1 → 2.1.2：仅包含修复。
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.1 → v2.9.0：新增 `v2.MarshalCanonical`。
- `dcp-ai`（crates.io）2.8.1 → 2.9.0：OpenTelemetry 0.32，对可选的 `otlp` 特性而言是破坏性变更（见“变更
  （破坏性）”）。
- 未变更：`@dcp-ai/wasm` 2.0.0、`@dcp-ai/cli` 2.0.0 以及各集成包。

<a id="security-2"></a>
<a id="security_2"></a>

### 安全

- 参考验证方（`lib/verify.js`）、`dcp verify-bundle` 和验证服务器现在会在 JSON Schema 验证之后，委托
  `@dcp-ai/sdk` 的 `verifySignedBundleV2` 验证规范性的 V2 bundle（`schemas/v2/signed_bundle.schema.json`）。以前，
  任何 SDK 生成的 bundle 都会被以 “Invalid signed bundle format” 拒绝，`dcp verify-bundle` 会对伪造的 bundle
  输出 `V2 BUNDLE STRUCTURE VALID`（退出码 0），服务器只检查结构。规范前的信封（顶层的 `dcp_version` /
  `bundle_manifest`）会被拒绝。服务器按其公布的 `VERIFIER_POLICY`（模式、接受的算法以及被建议拒绝的算法）进行
  验证，在会跳过经典签名者的 `pq_only` 模式下，会拒绝公钥固定。
- `dcp sign-bundle --composite` 输出规范性的 `SignedBundleV2`；以前 ML-DSA-65 的 kid 是从私钥的哈希派生的。
  已删除 `tools/bundle_sign.js --v2`。
- 撤销服务：一次紧急撤销不再把所有代理的所有 kid 都报告为已撤销（`GET /v2/check/kid/:kid` 现在接受
  `?agent_id=`），格式错误的百分号编码会返回 400，而不是让进程崩溃。
<a id="changed-breaking-1"></a>
<a id="changed-breaking_1"></a>

### 变更（破坏性）

- `lib/verify.js`（根包的 `main`）：`verifySignedBundle` 现在是 `async`，并接受第四个参数 `options`
  （`{ policy, mode }`）；结果始终带有 `errors` 数组。已更新复合 GitHub Action `verify-bundle`、`bin/dcp.js`、
  `server/` 和 `tools/bundle_verify.js`。`tools/bundle_verify.js` 不再接受 PQ 公钥参数。
- Rust SDK 的可选 `otlp` 特性：OpenTelemetry 0.24 → 0.32。
  - 随上游的重命名，`OtlpHandles.tracer_provider` 现在是 `SdkTracerProvider`，`OtlpHandles.tracer` 是
    `SdkTracer`。
  - 该特性不再引入 `tokio`：桥接层通过阻塞式 `reqwest` 客户端从 SDK 的后台线程导出。
  - 以 `tracer install:` 为前缀的错误现在显示为 `trace exporter:`。

<a id="added-2"></a>
<a id="added_2"></a>

### 新增

- Go SDK：`v2.MarshalCanonical(obj)`，即去掉仅限整数规则的 `dcp-jcs-v1` 编码器。V1 的 `Canonicalize` 和持有
  证明编码器现在都使用它。

<a id="fixed-2"></a>
<a id="fixed_2"></a>

### 修复

- Go SDK：在 V2、持有证明和 V1 路径中，规范化不再转义 `<`、`>`、`&` 或 U+2028/U+2029，并把 `-0` 输出为 `0`
  （`dcp-jcs-v1` 规则 3 和 4）。
- TypeScript SDK：对象键按 Unicode 码点排序（规则 1），而不是按 UTF-16 码元排序。
- Python SDK：`pqcrypto` 被限制在 1.0 以下。1.0 版本删除了 `pqcrypto.sign.ml_dsa_*` 模块，因此全新安装的
  `dcp-ai` 2.8.1 无法导入 ML-DSA-65 提供方。
- `tests/interop/v2/interop_vectors.json`：针对负零、HTML 字符、U+2028/U+2029、控制字符转义以及Unicode 补充平面字符键
  排序的边界情况向量。
- `tools/conformance.js`：`edge_cases` 条目不再在什么都没检查的情况下通过，删除了从未执行过的域分离代码块，
  V2 已签名 bundle（有效的、被篡改的、伪造的、剥离 PQ 签名的、固定密钥的、旧式的）会用参考验证方检查。

<a id="dependencies"></a>

### 依赖

- 所有 95 个未关闭的 Dependabot 警报均已关闭（11 个严重，54 个高危）。#22 取代了 15 个 Dependabot PR
  （#5–#21）；#24 升级了 grpc。
- TypeScript SDK、`@dcp-ai/express`、`@dcp-ai/openclaw`（开发依赖）：
  - vitest 和 `@vitest/coverage-v8` 4.1.12，一起升级。
  - vite 7.3.7，通过 `overrides` 固定。
  - postcss 8.5.31、nanoid 3.3.20、source-map-js 1.2.2、esbuild 0.28.2、fast-uri 3.1.9。
  - Express 运行时 lockfile：proxy-addr 2.0.8、qs 6.16.1、body-parser 2.3.0。
- 根测试框架：fast-uri 3.1.9，以及新的 `@dcp-ai/sdk` 依赖。
- Go SDK：`golang.org/x/crypto` v0.55.0、`golang.org/x/net` v0.58.0、`google.golang.org/grpc`
  v1.83.2、`go.opentelemetry.io/otel/*` v1.46.0。
- Rust SDK：opentelemetry、opentelemetry_sdk 和 opentelemetry-otlp 0.32。`opentelemetry_sdk` 0.32.1 修复了 W3C
  Baggage 传播中无界的内存分配。
- CI：
  - 为 express 和 openclaw 新增集成测试作业。
  - Rust 作业构建并测试 `--features otlp`。
  - Go 作业从 `go.mod` 读取其版本。
  - 生成的 V2 bundle 会用 CLI 验证。
  - 会运行服务器和撤销测试。

<a id="documentation-2"></a>
<a id="documentation_2"></a>

### 文档

- `spec/VERIFICATION.md`：
  - V2 检查清单现在指向 `schemas/v2/signed_bundle.schema.json`（之前引用的 `*_v2` schema 从未存在过）。
  - 删除了不存在的 `independent` 绑定。
  - 写明了参考实现。
- `spec/CANONICALIZATION_PROFILE.md` §3 新增了字符串转义和按码点排序键的行。这澄清了规则 1 和 3；配置文件本身没有改变。
- 服务器、运营方、迁移、API 参考、CI 和 bundle 文档现在描述的是真实的 V2 验证、实际的 CLI 语法以及确实存在的 SDK API：
  - 迁移指南的 API 表列出了若干并不存在的函数。
  - 服务器 README 展示的是规范前的信封。
- Python SDK README（所有语言）不再声称支持 ML-KEM-768 或 V2 bundle，CrewAI 快速入门把其 V2 代码片段标注为计划中的 API。
- 译文和项目文档：
  - 包括 Agno 在内的 11 个集成；规范化配置文件和 Agno 快速入门的链接。
  - 本版本的 Rust 安装代码片段和 Go 的 `@latest` 固定。
  - `SECURITY.md` 中按包列出的受支持版本，以及 `ROADMAP.md` 中的 v2.8.x 和 v2.9.0 版本。
  - `CITATION.cff` 中的 Zenodo 概念 DOI。

## [2.8.1] - 2026-04-26

<a id="wired-the-canonicalization_profile-field-across-the-four-sdks"></a>

### 在四个 SDK 中接通 `canonicalization_profile` 字段

`v2.8.0` 在 `schemas/v2/bundle_manifest.schema.json` 中声明了 `canonicalization_profile` 字段，并在
`spec/CANONICALIZATION_PROFILE.md` § 4 中作了描述，但没有任何 SDK 真正写入或读取该字段：类型化的
`BundleManifest` 结构发布时没有它，验证方也会忽略它。`v2.8.1` 从头到尾补上了这一缺口。

- **TypeScript（`@dcp-ai/sdk` 2.1.0 → 2.1.1）**：`sdks/typescript/src/types/v2.ts` 中的 `BundleManifest` 接口
  新增 `canonicalization_profile?: 'dcp-jcs-v1'`。`sdks/typescript/src/bundle/builder-v2.ts` 中的
  `BundleBuilderV2.build()` 现在在生成的每个清单上输出 `canonicalization_profile: "dcp-jcs-v1"`。
  `sdks/typescript/src/core/verify-v2.ts` 中的 `verifyV2Bundle` 接受缺失该字段（视为 `dcp-jcs-v1`），显式接受
  `"dcp-jcs-v1"`，并以 `"Unknown canonicalization_profile: <value>"` 拒绝任何其他值。
- **Python（`dcp-ai` 2.8.0 → 2.8.1）**：`sdks/python/dcp_ai/v2/models.py` 中的 `BundleManifest` 新增
  `canonicalization_profile: Literal["dcp-jcs-v1"] | None = "dcp-jcs-v1"`。Pydantic 在解析时强制拒绝未知值；
  缺失时使用默认值。由于验证在模型中进行，验证方无需单独修改。
- **Go（`sdks/go/v2.8.0` → `v2.8.1`）**：`sdks/go/dcp/v2/types.go` 中的 `BundleManifest` 结构体新增带有
  `json:"canonicalization_profile,omitempty"` 的 `CanonicalizationProfile string`。
  `sdks/go/dcp/v2/bundle_builder.go` 中的 `BuildBundleV2` 在生成的每个清单上把它设为 `"dcp-jcs-v1"`。
  `sdks/go/dcp/v2/verify_bundle.go` 中的 `VerifySignedBundleV2` 现在会拒绝清单中 `canonicalization_profile` 值
  不是 `"dcp-jcs-v1"` 的 bundle。
- **Rust（crates.io 上的 `dcp-ai` 2.8.0 → 2.8.1）**：`sdks/rust/src/v2/types.rs` 中的 `BundleManifest` 新增带有
  `#[serde(skip_serializing_if = "Option::is_none")]` 的 `pub canonicalization_profile: Option<String>`。
  `sdks/rust/src/lib.rs` 中的 `wasm_build_bundle` 在其输出的清单上设置 `"canonicalization_profile":
  "dcp-jcs-v1"`。

<a id="spec--profile-document"></a>
<a id="spec-profile-document"></a>

### 规范和配置文件文档

- `spec/DCP-AI-v2.0.md` § 9（Bundle 清单）现在把 `canonicalization_profile` 与其他清单字段一并列出，并附有一条
  行内说明：缺失该字段时必须（MUST）视为等同于 `"dcp-jcs-v1"`。
- `spec/CANONICALIZATION_PROFILE.md` § 2：规则 6（undefined / null 的处理）被改写为一张跨语言表格，明确列出
  TypeScript、Python、Go 和 Rust 的宿主值在对象位置和数组位置上如何映射到 JSON 传输格式。
- `spec/CANONICALIZATION_PROFILE.md` § 2：新的规则 9 明确把 Unicode 规范化（NFC、NFD、NFKC、NFKD）排除在范围之外：
  规范化器按宿主解析器交付的样子逐字节输出字符串，将来的配置文件（`dcp-jcs-v2` 或更高版本）可以（MAY）固定一种
  规范化形式。RFC 8259 § 8.1 被引用为应用层规范化的常规选择（NFC）。
- `spec/CANONICALIZATION_PROFILE.md` 的规则 9 还写明了不提供 `NaN` / `±Infinity` 互操作 fixtures 的理由：这些值不属于
  RFC 8259 传输格式，因此大多数解析器在到达规范化器之前就会拒绝它们。拒绝行为由各 SDK 的单元测试而不是共享
  fixtures 验证。

<a id="behavioural-compatibility"></a>

### 行为兼容性

新字段是**增量的，并且在序列化中是可选的**：

- `v2.8.1` 生成的 bundle 在其清单上带有 `canonicalization_profile:
  "dcp-jcs-v1"`。不认识该字段的旧验证方会把它当作未知属性，这没有问题，因为 JSON Schema 把该字段声明为与
  `additionalProperties` 兼容（它位于 `properties` 之中，且为 `optional`）。
- `v2.8.0` 或更早版本生成的 bundle 没有 `canonicalization_profile` 字段。`v2.8.1` 验证方会接受它：根据
  `spec/CANONICALIZATION_PROFILE.md` § 4，缺失该字段时必须（MUST）视为等同于 `"dcp-jcs-v1"`。
- 带有未知值（例如 `"dcp-jcs-v2"`）的 `canonicalization_profile` 的 bundle 会被每个 `v2.8.1` SDK 拒绝。这是为将来
  配置文件预留的前向兼容机制：尚未更新到新配置文件的验证方必须（MUST）拒绝它，而不是悄悄接受一个它无法验证的
  清单。

bundle 级签名覆盖 `canonical(manifest)`，因此加入该字段会使任何新生成 bundle 的清单哈希不同于在 `v2.8.0` 下生成的
结果。`v2.8.0` 及更早版本生成的 bundle 及其已存储的签名，在 `v2.8.1` 验证方下仍然有效。

<a id="versions-bumped"></a>

### 升级的版本

- `dcp-ai`（PyPI）2.8.0 → 2.8.1
- `dcp-ai`（crates.io）2.8.0 → 2.8.1
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.0 → v2.8.1
- `@dcp-ai/sdk`（npm）2.1.0 → 2.1.1：自 2.1.0 以来第一次修改 TypeScript 代码
  （2.8.0 版本只编辑了 docstring）

## [2.8.0] - 2026-04-26

<a id="added--canonicalization-profile-dcp-jcs-v1"></a>
<a id="added-canonicalization-profile-dcp-jcs-v1"></a>

### 新增 — 规范化配置文件 `dcp-jcs-v1`

一次与另一协议的公开对照，暴露出四个 SDK 在规范化 JSON 方面的三处真实不对称：`1.0`/`1.00` 被 Python 和 Rust
拒绝，却被 TypeScript 和 Go 接受；`1e2` 只被 Rust 拒绝；`undefined` 在规范中没有正式的处理方式。
`spec/DCP-AI-v2.0.md` § 15 中“RFC 8785 + 仅限整数”的概括在其覆盖范围内是正确的，但没有固定 JCS 留给实现自行决定的
情形。本版本把它们全部解决。

- **新的规范性文档**：[`spec/CANONICALIZATION_PROFILE.md`](../../spec/CANONICALIZATION_PROFILE.md) 用八条编号规则、
  一张覆盖 22 个输入的边界情况接受表、一份记录 TypeScript 特有不对称（在对象中省略，在数组中序列化为 `null`）的
  undefined 处理约定，以及一项面向将来配置文件的版本策略，正式定义了配置文件 `dcp-jcs-v1`。
- **Bundle 清单字段**：`canonicalization_profile: "dcp-jcs-v1"` 作为可选字段加入
  `schemas/v2/bundle_manifest.schema.json`。遇到没有该字段的 bundle 时，验证方必须（MUST）假定为 `dcp-jcs-v1`。
  将来的配置文件会使该字段成为必需。
- **Python（`dcp-ai` 2.7.1 → 2.8.0）**：`assert_no_floats` 现在接受值为有限整数的浮点数（`1.0`、`1e2`、`1.00`）；
  它们会在 `json.dumps` 之前被规范为整数形式。非整数的浮点数（`0.1`）、`NaN` 和无穷大仍会被拒绝。
- **Rust（`dcp-ai` 2.7.0 → 2.8.0）**：`assert_no_floats` 现在接受 `fract()` 为零的 `Number(f64)`。
  `canonical_recurse` 中新的辅助函数 `format_number` 输出整数值浮点数时不带小数点和指数，与其他 SDK 逐字节一致。
- **Go（`sdks/go/v2.7.0` → `v2.8.0`）**：行为早已一致（`v != math.Trunc(v)` 检查）。仅升级版本。
- **TypeScript（`@dcp-ai/sdk` 仍为 2.1.0）**：行为早已一致。`sdks/typescript/src/core/canonicalize.ts` 中的
  docstring 正式说明了 undefined 与 null 的不对称。

<a id="added--interop-edge-case-fixtures"></a>
<a id="added-interop-edge-case-fixtures"></a>

### 新增 — 互操作边界情况 fixtures

`tests/interop/v2/interop_vectors.json` 现在包含 `canonicalization.edge_cases`，其中 14 个向量覆盖：null 的保留
（带键、在数组中）、整数值浮点数、尾随零、科学记数法、拒绝小数、拒绝非有限值、按码点排序键（包括 `é`）、嵌套的
null、空容器、深度嵌套的对象以及含 null 的数组。每个 SDK 的互操作测试都加载同一个块，并对每个向量断言逐字节相同的
输出（或相同的错误）。CI 在每个 PR 上并行运行这四个测试；出现分歧即阻止发布。

<a id="versions-bumped-1"></a>
<a id="versions-bumped_1"></a>

### 升级的版本

- `dcp-ai`（PyPI）2.7.1 → 2.8.0
- `dcp-ai`（crates.io）2.7.0 → 2.8.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` → v2.8.0
- `@dcp-ai/sdk`（npm）仍为 2.1.0：TypeScript 早已实现该配置文件；本版本只增加了 docstring 中的正式说明。

<a id="behavioural-compatibility-1"></a>
<a id="behavioural-compatibility_1"></a>

### 行为兼容性

以前版本生成的 bundle 仍然有效。对于此前拒绝 `1.0`/`1.00`/`1e2` 的 SDK，这一变更是**增量的**：以前会抛出
`TypeError`/`Err` 的输入现在会成功，并产生其他 SDK 早已产生的相同规范输出。以前能成功规范化的任何输入，在 2.8.0 中
都不会被规范化成不同的结果。

<a id="271---2026-04-23-python-only"></a>
<a id="271-2026-04-23-python-only"></a>

## [2.7.1] - 2026-04-23（仅 Python）

<a id="fixed-3"></a>
<a id="fixed_3"></a>

### 修复

- `dcp-ai`（PyPI）2.7.0 缺少作为必需依赖的 `cryptography`。2.5.0 引入的 DCP-04 A2A 会话层需要这个包来进行
  AES-256-GCM 加密。用 `pip install dcp-ai==2.7.0` 全新安装时不会拉取 `cryptography`，因此在干净的环境中有三个 A2A
  会话测试失败（`test_encrypt_decrypt_round_trip`、`test_tamper_ciphertext_rejected`、
  `test_session_id_mismatch`）。2.7.1 把 `cryptography>=41.0` 加入了 wheel 的必需依赖。

Rust（crates.io 上的 `dcp-ai`）和 Go（`sdks/go/v2`）不受影响，仍为 2.7.0：Python 的 `cryptography` 包只与 Python
wheel 有关。

## [2.7.0] - 2026-04-23

<a id="added--canonical-error-codes--wire-format-detection-in-py--go--rs"></a>
<a id="added-canonical-error-codes-wire-format-detection-in-py-go-rs"></a>

### 新增 — PY / GO / RS 中的规范错误码和传输格式检测

把 `DcpErrorCode` 枚举以及配套的 `DcpError` / `DcpProtocolError` 机制从 TS 移植到 Python、Rust 和 Go，并移植了
轻量的辅助函数 `detect_wire_format`，它根据第一个字节把传入的字节流分流到 "json" 或 "cbor"。

**每个 SDK 现在都使用同样的 38 个规范错误码**，涵盖：schema 错误（E001-E099）、签名错误（E100-E199）、哈希/链
错误（E200-E299）、身份错误（E300-E399）、策略错误（E400-E499）、会话错误（E500-E599）、A2A 错误
（E600-E699）、速率限制（E700-E799）以及内部错误（E900-E999）。每个错误码都带有规范消息和 `retryable` 标志，
使客户端能够在各 SDK 之间一致地实现与策略相符的重试逻辑。

**Python（`dcp-ai` 2.6.0 -> 2.7.0）**：新的 `dcp_ai.v2.error_codes` 模块，包含 `DcpErrorCode`（str 枚举）、
`DcpError` 数据类、`DcpProtocolError` 异常、`create_dcp_error`、`is_dcp_error`、`detect_wire_format` 以及
`ERROR_DESCRIPTIONS` 映射。

**Rust（`dcp-ai` 2.6.0 -> 2.7.0）**：`dcp_ai::v2::error_codes`，包含 `DcpErrorCode` 枚举（`Display` → 稳定的
`DCP-E###` 标识符）、`DcpError` 结构体、`create_dcp_error` 和 `detect_wire_format`。

**Go（`sdks/go/v2.6.0 -> v2.7.0`）**：带有 37 个 `Err*` 常量的类型化字符串 `v2.DcpErrorCode`、实现 `error` 接口
的 `v2.DcpError` 结构体、`CreateDcpError`、`IsDcpError`、`DetectWireFormat`。

<a id="cbor-encoderdecoder-scope-decision"></a>

### CBOR 编码器/解码器范围的决定

在 2.x 中，完整的 CBOR 编码器/解码器仍只存在于 TypeScript。把确定性的 RFC 8949 实现移植到另外三个 SDK 是一个
相当大的项目，值得作为单独的里程碑；`detect_wire_format` 是每个 SDK 当前唯一需要的辅助函数，用于把 CBOR 载荷交给
现有的生态库（例如 Python 中的 `cbor2`、Go 中的 `github.com/fxamacker/cbor/v2`、Rust 中的 `ciborium`）。一个专门
的 v3.x 版本会加入规范的移植实现。

<a id="test-counts"></a>

### 测试数量

- Python：231/231 通过（不变；已验证导入接口）
- Rust：152/152 通过（新增 5 个）
- Go：115/115 通过（新增 8 个）

<a id="versions-bumped-2"></a>
<a id="versions-bumped_2"></a>

### 升级的版本

- `dcp-ai`（PyPI）2.6.0 -> 2.7.0
- `dcp-ai`（crates.io）2.6.0 -> 2.7.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.7.0

## [2.6.0] - 2026-04-23

<a id="added--blinded-rpr-multi-party-auth-advisory-helpers-in-rust--go"></a>
<a id="added-blinded-rpr-multi-party-auth-advisory-helpers-in-rust-go"></a>

### 新增 — Rust 和 Go 中的盲化 RPR、多方授权和建议辅助函数

把三项原本只有 Python 才有的功能移植到 Rust 和 Go，补上对照中指出的差距：在非 TS 的 SDK 中，Python 领先于其他
SDK。

- **盲化 RPR（Gap #2）**：`compute_pii_hash`、`blind_rpr`、
  `verify_blinded_rpr`、`is_blinded_rpr`。
- **多方授权（Gap #5）**：`verify_multi_party_authorization`
  + 带有四个默认操作策略（`revoke_agent`、`rotate_org_key`、`change_jurisdiction`、
  `modify_recovery_config`）的 `MultiPartyPolicy`。
- **算法建议辅助函数（Gap #4）**：`check_advisory`、
  `evaluate_advisories`、`apply_advisories_to_policy`、
  `build_algorithm_advisory`。

这三个模块都与 Python 的语义一致：个人信息的 SHA-256 承诺、M-of-N 结构验证（密码学验证仍在网关进行），以及按动作
（`revoke` / `deprecate` / `warn`）分流并处理宽限期。

Python（`dcp-ai` 2.5.0 -> 2.6.0）：没有代码变更，仅升级版本以保持各 SDK 同步。

<a id="test-counts-1"></a>
<a id="test-counts_1"></a>

### 测试数量

- Rust：147/147（新增 14 个）
- Go：106/106（新增 12 个）
- Python：231/231（不变）

## [2.5.0] - 2026-04-23

<a id="added--dcp-04-agent-to-agent-protocol-parity"></a>
<a id="added-dcp-04-agent-to-agent-protocol-parity"></a>

### 新增 — DCP-04 代理间协议的对等实现

把 DCP-04（代理间通信）的基础结构移植到其余 SDK。

**Python（`dcp-ai` 2.4.0 -> 2.5.0）**：与 TS 完全对等，包括对称会话层（通过 `cryptography` 包实现
AES-256-GCM）。

- 发现：`create_agent_directory`、`find_agent_by_capability`、
  `find_agent_by_id`、`validate_directory_entry`。
- 握手：`generate_nonce`、`create_hello`、`create_welcome`、
  `derive_session_id`、`create_close_message`。
- 会话：`A2ASession`、`create_session`、`encrypt_message`、
  `decrypt_message`、`needs_rekeying`、`generate_resume_proof`、
  `verify_resume_proof`、`derive_rekeyed_session_key`。

**Go（`sdks/go/v2.4.0 -> v2.5.0`）**：与 TS 完全对等，使用 Go 标准库的 `crypto/aes` + `crypto/cipher` 实现
AES-256-GCM（没有新的依赖）。

**Rust（`dcp-ai` 2.4.0 -> 2.5.0）**：发现 + 握手的基础结构。AES-256-GCM 会话层计划在后续版本中提供；Rust 用户仍
可以构建目录、HELLO/WELCOME 消息，并派生会话 ID。

测试数量：Python 231/231，Rust 133/133，Go 94/94。

## [2.4.0] - 2026-04-23

<a id="added--production-hardening-primitives-in-python-rust-go"></a>
<a id="added-production-hardening-primitives-in-python-rust-go"></a>

### 新增 — Python、Rust、Go 中的生产加固原语

从 TS 核心移植四个对协议至关重要的加固原语：

- **会话 nonce** 辅助函数：`generate_session_nonce`、`is_valid_session_nonce`、
  `verify_session_binding`、`generate_session_expiry`、`is_session_expired`。
- **自适应安全层级**：`compute_security_tier`、`max_tier`、
  `tier_to_verification_mode`、`tier_to_checkpoint_interval`（Go 早已有
  `ComputeSecurityTier`；v2.4 增加了这三个辅助函数）。
- **紧急撤销**（Gap #13）：`generate_emergency_revocation_token`、
  `verify_emergency_revocation_secret`、`build_emergency_revocation`。
- **惰性 PQ 检查点**：`audit_events_merkle_root`、`create_pq_checkpoint`，
  以及按层级选择间隔、并能自动刷新的 `PQCheckpointManager` 类。

这四个模块都与 TS 的语义完全一致：紧急撤销中以常数时间验证秘密值、按层级决定的检查点间隔、会话 nonce 校验正则
表达式，以及在 `DCP-AI.v2.AuditEvent` 域分离上下文下签署的检查点载荷。

<a id="whats-not-in-v24"></a>

### v2.4 未包含的内容

有意排除在范围之外（如有需求会在后续版本中提供）：

- Shamir 秘密共享（Gap #1）：需要仔细的密码学审查；仅 TS。
- 验证缓存：属于应用层面的问题，而不是协议问题。
- 速率限制 / 断路器 / 重试：最好交给现有生态库处理的应用层模式。

<a id="test-counts-2"></a>
<a id="test-counts_2"></a>

### 测试数量

- Python：214/214 通过（新增 24 个）
- Rust：126/126 通过（新增 10 个）
- Go：81/81 通过（新增 9 个）

<a id="versions-bumped-3"></a>
<a id="versions-bumped_3"></a>

### 升级的版本

- `dcp-ai`（PyPI）2.3.0 -> 2.4.0
- `dcp-ai`（crates.io）2.3.0 -> 2.4.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.4.0

## [2.3.0] - 2026-04-23

<a id="added--dispute--rights--delegation-parity-across-sdks"></a>
<a id="added-dispute-rights-delegation-parity-across-sdks"></a>

### 新增 — 各 SDK 之间争议、权利和委托的对等实现

Python、Rust 和 Go 现在实现了 DCP-07（争议解决 + 仲裁）、DCP-08（权利与义务）和 DCP-09（委托、认知阈值、主体
镜像）的行为，与 TypeScript 的功能集一致。

**新的函数组（PY/RS/GO 语义相同，与 TS 一致）：**

DCP-07 冲突解决：

- `create_dispute` · `escalate_dispute` · `resolve_dispute` · `create_objection`
- 仲裁：`create_arbitration_panel` · `submit_resolution` ·
  `build_jurisprudence_bundle` · `lookup_precedent`

DCP-08 权利与义务：

- `declare_rights` · `record_obligation` · `report_violation` ·
  `check_rights_compliance`

DCP-09 委托与代表：

- 委托：`create_delegation_mandate` · `verify_mandate_validity` ·
  `revoke_delegation` · `generate_interaction_record`
- 认知阈值：`evaluate_significance` · `should_notify_human` ·
  `create_awareness_threshold` · `create_advisory_declaration`
- 主体镜像：`generate_mirror`

所有新的工厂函数都在 `DCP-AI.v2.Dispute`、`DCP-AI.v2.Rights`、`DCP-AI.v2.Delegation` 和 `DCP-AI.v2.Awareness`
域分离上下文下使用现有的复合签名路径。委托授权书工件在 `human_composite_sig` 字段中携带人类主体的签名，与 TS 的
传输格式一致。

<a id="test-counts-3"></a>
<a id="test-counts_3"></a>

### 测试数量

- Python：190/190 通过（新增 21 个）
- Rust：116/116 通过（新增 12 个）
- Go：72/72 通过（在外层 `dcp_test` 包中新增 12 个）
- TypeScript：460/460 通过（无变化）

<a id="versions-bumped-4"></a>
<a id="versions-bumped_4"></a>

### 升级的版本

- `dcp-ai`（PyPI）2.2.0 -> 2.3.0
- `dcp-ai`（crates.io）2.2.0 -> 2.3.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.3.0
- `@dcp-ai/sdk`（npm）仍为 2.1.0

## [2.2.0] - 2026-04-23

<a id="added--lifecycle--succession-parity-across-sdks"></a>
<a id="added-lifecycle-succession-parity-across-sdks"></a>

### 新增 — 各 SDK 之间生命周期和继任的对等实现

Python、Rust 和 Go SDK 现在实现了 DCP-05（代理生命周期）和 DCP-06（数字继任）的行为。TypeScript 早在 2.0.x 中
就已提供；2.2.0 版本补上了跨 SDK 对照中发现的第一个行为对等差距。

**新函数（Python/Rust/Go 语义相同，与 TS 一致）：**

DCP-05 代理生命周期：

- `validate_state_transition` / `ValidateStateTransition`
- `compute_vitality_score` / `ComputeVitalityScore`
- `create_commissioning_certificate` / `CreateCommissioningCertificate`
- `create_vitality_report` / `CreateVitalityReport`
- `hash_vitality_report` / `HashVitalityReport`
- `create_decommissioning_record` / `CreateDecommissioningRecord`

DCP-06 数字继任：

- `create_digital_testament` / `CreateDigitalTestament`
- `update_digital_testament` / `UpdateDigitalTestament`
- `classify_memory` / `ClassifyMemory`
- `create_memory_transfer_manifest` / `CreateMemoryTransferManifest`
- `execute_succession` / `ExecuteSuccession`

所有新的工厂函数都在 `DCP-AI.v2.Lifecycle` 和 `DCP-AI.v2.Succession` 域分离上下文下使用现有的复合签名路径，因此
任何 SDK 生成的工件在传输格式上都兼容，并且可以交叉验证。

<a id="test-counts-after-this-release"></a>

### 本版本之后的测试数量

- Python：169/169 通过（新增 24 个）
- Rust：104/104 通过（新增 10 个）
- Go：60/60 通过（在外层 `dcp` 包中新增 13 个；v2 包不变）
- TypeScript：460/460 通过（无变化）

<a id="known-protocol-level-note"></a>

### 已知的协议层面说明

为了跨 SDK 的确定性，DCP v2.0 规范化禁止浮点数，但活力报告 schema 把每个指标的值表示为 `number`（0.0..1.0）。现在
四个 SDK 的工厂函数在 API 边界上都接受这些指标，但签名方要求在传输格式中使用整数表示。这一点已记录在各 SDK 的测试
中。将来的版本可能会把 schema 收紧为整数（或基点），以彻底消除这一差距。

<a id="versions-bumped-5"></a>
<a id="versions-bumped_5"></a>

### 升级的版本

- `dcp-ai`（PyPI）2.1.0 -> 2.2.0
- `dcp-ai`（crates.io）2.1.0 -> 2.2.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.2.0
- `@dcp-ai/sdk`（npm）仍为 2.1.0（TS 早已具备这些函数）

<a id="210---2026-04-22"></a>

## [2.1.0] - 2026-04-22

<a id="added-3"></a>
<a id="added_3"></a>

### 新增

**为全部四个核心 SDK 提供 OpenTelemetry（OTLP）导出器**：TypeScript、Python、**Rust 和 Go**。采用者现在无需手工编写桥接层，就能把 DCP 的可观测性数据送到任何兼容 OTel 的后端（Grafana、Jaeger、Honeycomb、Datadog、New Relic、自托管 Collector）。每个执行 DCP 密码学操作的 SDK 现在都报告相同的指标名称、计数器和 span 结构。

- **Rust（`dcp-ai` 2.0.0 → 2.1.0）**
    - 新的 `dcp_ai::observability` 模块，包含线程安全的 `DcpTelemetry` 单例、记录方法、span 生命周期、`on_event` 监听总线，以及带 p50/p95/p99 的 `MetricsSummary`。
    - 可选的 Cargo 特性 `otlp`（`cargo add dcp-ai --features otlp`）会引入 `opentelemetry`、`opentelemetry_sdk`、`opentelemetry-otlp` 和 `tokio`。没有该特性时，请求 `ExporterType::Otlp` 会发出一个清晰的错误事件，而不是 panic。
    - 已插桩的热路径：`crypto::sign_object` 和 `crypto::verify_object` 在启用时发出延迟和错误遥测。禁用时（默认）没有开销。
    - 10 个单元测试，覆盖默认禁用的行为、百分位数、span 生命周期、层级分布、缓存命中率以及监听器 panic 隔离。

- **Go（`sdks/go/v2.0.0 → v2.1.0`）**
    - 新的 `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability` 包，包含受互斥锁保护的 `Telemetry` 类型、`Default()` 单例、记录方法、带 panic 恢复的订阅者，以及与其他 SDK 一致的百分位数计算。
    - OTLP 桥接层受构建标签 `otlp`（`go build -tags otlp`）控制。没有该标签时，请求 `ExporterOTLP` 会通过监听总线发出一个清晰的 `otlp_init` 错误事件。`go.opentelemetry.io/otel` 依赖列在 `go.mod` 中，但默认构建在运行时并不需要它们。
    - 已插桩的热路径：`dcp.SignObject` 和 `dcp.VerifyObject` 在启用时发出延迟和错误遥测。禁用时（默认）没有开销。
    - 可观测性包的 10 个单元测试 + 针对 `dcp.SignObject` 的 2 个集成测试，覆盖启用和禁用路径。

- **TypeScript（`@dcp-ai/sdk` 2.0.0 → 2.1.0）**
    - `dcpTelemetry.init({ exporterType: 'otlp' })` 现在真正可用了（该配置字段在 2.0.x 中已声明，但没有接通）。
    - OTel SDK 采用**惰性**导入——默认安装不变。`@opentelemetry/*` 包被声明为可选的 peer 依赖；缺失时，`init()` 会通过监听总线发出一个清晰的错误事件，应用继续运行。
    - 新增 `dcpTelemetry.shutdown()`，用于刷新待处理的导出。
    - 端点解析：配置 `otlpEndpoint` → 环境变量 `OTEL_EXPORTER_OTLP_ENDPOINT` → `http://localhost:4318`。
    - 自动填充 `service.name` + `service.version` 资源属性。
    - 指标映射：DCP 记录器映射到 OTel 直方图（`dcp.sign.latency_ms`、`dcp.verify.latency_ms`、`dcp.kem.latency_ms`、`dcp.checkpoint.latency_ms`、`dcp.bundle_verify.latency_ms`）和计数器（`dcp.signatures.created`、`dcp.signatures.verified`、`dcp.bundles.verified`、`dcp.a2a.sessions`、`dcp.errors`）。
    - 新增 2 个 vitest 用例；460/460 测试通过。

- **Python（`dcp-ai` 2.0.2 → 2.1.0）**
    - 新的 `dcp_ai.observability` 模块提供 `dcp_telemetry` 单例，其 API 与 TypeScript 版本相同：span、指标记录器（`record_sign_latency`、`record_verify_latency`、`record_kem_latency`、`record_checkpoint_latency`、`record_bundle_verify`、`record_cache_hit/miss`、`record_a2a_*`、`record_error`）、`on_event` 监听总线，以及带 p50/p95/p99 的 `get_metrics_summary`。
    - 导出器模式：`none`（默认）/ `console` / `otlp`。
    - 新的安装 extra：`pip install 'dcp-ai[otlp]'` 会引入 `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-http`。没有该 extra 时，`init(exporter_type="otlp")` 会给出清晰的安装提示而不会崩溃。
    - 已插桩的热路径：`sign_object` 和 `verify_object` 现在在启用时发出延迟和错误遥测。禁用时（默认）没有开销。
    - 公开导出：`from dcp_ai import dcp_telemetry` 可以使用。
    - 新增 15 个 pytest 用例；145/145 测试通过。

<a id="documentation-3"></a>
<a id="documentation_3"></a>

### 文档

- 新的 `docs/OBSERVABILITY.md`，提供三种可直接复制使用的后端方案（通过 Docker 运行本地 Jaeger、Grafana Cloud OTLP 端点、Honeycomb）。

<a id="backward-compatibility"></a>

### 向后兼容

- 四个 SDK 完全向后兼容。默认值不变——遥测默认禁用，记录器不执行任何操作。不需要可观测性的采用者无需修改代码。
- 同步的语义化版本：`@dcp-ai/sdk`（npm）、`dcp-ai`（PyPI）、`dcp-ai`（crates.io）和 `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` 都升到 2.1.0。其他可发布的包（CLI、WASM、集成、create-* 脚手架）保持当前版本。
- WASM SDK 的可观测性推迟到将来的次要版本；浏览器遥测有不同的传输要求。

<a id="template-packages---2026-04-21"></a>
<a id="template-packages-2026-04-21"></a>

## 模板包 - 2026-04-21

首次发布四个 `npm create @dcp-ai/*` 脚手架，版本均为 `v2.0.0`：

- `@dcp-ai/create-langchain`
- `@dcp-ai/create-crewai`
- `@dcp-ai/create-openai`
- `@dcp-ai/create-express`

用法：`npm create @dcp-ai/langchain my-app`（或四者中的任意一个）。每个脚手架都包含一个自成一体的入门模板（内容与仓库中现有的 `templates/<name>/` 相同），外加一个 35 行、没有运行时依赖的小型 `bin.js`。

<a id="infrastructure"></a>

## 基础设施

- **JSON-LD 上下文**现在在 [`https://dcp-ai.org/credentials/v2`](https://dcp-ai.org/credentials/v2) 提供（Content-Type `application/ld+json`，CORS `*`，缓存 24 h）。`@dcp-ai/w3c-did` 需要它，以便严格的 JSON-LD 处理器（Veramo、SpruceID、Trinsic）能够解引用其签发的每个 Verifiable Credential/Presentation。
- 汇总了四个 SDK（TypeScript、Python、Go、Rust）的 **Codecov 覆盖率报告**，并按 SDK 设置标记。README 中的徽章已上线。
- **加固了发布工作流**：每个作业（npm / PyPI / crates.io）现在都会先检查注册表，如果清单中的版本已经发布，就带着跳过提示以成功状态结束。常规发布不再出现红色作业。

## Go SDK v2.0.0 - 2026-04-19

Go SDK 首个可通过 `go get` 安装的版本。之前的模块路径（`github.com/dcp-ai/dcp-ai-go`）指向一个并不存在的仓库，因此外部使用方无法安装它。该模块现在作为子目录模块位于本单体仓库中：

- **新的模块路径**：`github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`（对于 ≥ 2 的主版本，Go 要求使用 `/v2` 后缀）
- **标签格式**：`sdks/go/v2.0.0`（带子目录前缀，这是 Go 模块代理对多模块仓库的要求）
- **安装**：`go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0`

代码没有改变——只改写了模块路径和内部导入。所有测试仍然通过。

## [2.0.2] - 2026-04-18

### Python SDK

- **已修复**：`dcp_ai.__version__` 现在通过 `importlib.metadata` 动态反映已安装的版本，而不是使用硬编码的字符串。在 2.0.1 中，即使 wheel 是 `2.0.1`，该属性仍报告 `"1.0.0"`。

<a id="ci--publish-workflows"></a>
<a id="ci-publish-workflows"></a>

### CI / 发布工作流

- 每个发布作业（`publish.yml`、`publish-pypi.yml`、`publish-integrations.yml`）现在都会先检查清单中的版本是否已在注册表上，如果已存在，就带着跳过提示以成功状态结束。以前，每次由发布触发的运行都会重新尝试发布已发布的版本，并在 Actions 标签页中留下四个红色作业。常规发布不再出现这种只是外观上的红色幽灵。
- 修正了 README 集成表中两个过时的包名：`@dcp-ai/a2a` → `@dcp-ai/google-a2a`，`@dcp-ai/mcp` → `@dcp-ai/anthropic-mcp`。
- 在集成表的每一行中添加了实时的 npm / PyPI 版本徽章。

## [2.0.1] - 2026-04-18

### Python SDK

框架桥接层现在随包一起发布。在 2.0.1 之前，它们位于仓库的 `integrations/<name>/` 下，只能通过一个 pytest 技巧加载；
执行 `pip install dcp-ai[fastapi]` 的人得到的是上游的 `fastapi` 库，却得不到 `dcp_ai.fastapi` 中间件。2.0.1 修复了
这一点：四个模块现在位于 `dcp_ai/` 之下，并包含在已发布的 wheel 中。

- **新增**：`dcp_ai.fastapi`（中间件、依赖注入、V2 结构检查）
- **新增**：`dcp_ai.langchain`（代理包装器、回调、风险评分）
- **新增**：`dcp_ai.openai`（客户端、工具 schema、审计轨迹构建器）
- **新增**：`dcp_ai.crewai`（crew 代理、合并的审计轨迹、会话一致性检查）
- **删除**：`tests/conftest.py` 中的动态模块加载器（不再需要）

<a id="installation"></a>

### 安装

```bash
pip install dcp-ai[fastapi]     # brings fastapi + uvicorn
pip install dcp-ai[langchain]   # brings langchain + langchain-core
pip install dcp-ai[openai]      # brings openai
pip install dcp-ai[crewai]      # brings crewai
```

<a id="backward-compatibility-1"></a>
<a id="backward-compatibility_1"></a>

### 向后兼容

与 2.0.0 的导入完全兼容。新模块只增加 API；现有的 `from dcp_ai import ...` 调用不受影响。

## [npm integrations] - 2026-04-18

首次把六个框架桥接层作为独立的 npm 包发布，版本均为 `v2.0.0`：

- `@dcp-ai/anthropic-mcp` — Anthropic MCP 桥接
- `@dcp-ai/autogen` — Microsoft AutoGen 桥接
- `@dcp-ai/google-a2a` — Google Agent-to-Agent 桥接
- `@dcp-ai/w3c-did` — W3C DID/VC 桥接
- `@dcp-ai/express` — Express 中间件
- `@dcp-ai/openclaw` — OpenClaw 插件

`@dcp-ai/express` 和 `@dcp-ai/openclaw` 依赖 `@dcp-ai/sdk ^2.0.0`。

## [2.0.0] - 2026-04-18

首个公开的包版本。同时发布到 npm（`@dcp-ai/sdk`、`@dcp-ai/cli`、`@dcp-ai/wasm`）、PyPI（`dcp-ai`）和 crates.io（`dcp-ai`）。

<a id="added-4"></a>
<a id="added_4"></a>

### 新增

**协议栈（DCP-01 至 DCP-09）**

- **DCP-01** 身份与人类绑定——代理身份、运营方证明、密钥绑定
- **DCP-02** 意图声明与策略管控——已声明的意图、层级执行、策略评估
- **DCP-03** 审计链与透明度——以哈希链接的审计条目、Merkle 证明、透明度日志
- **DCP-04** 代理间通信——发现、握手、加密会话
- **DCP-05** 代理生命周期——投入运行、活力报告、退役记录、带四种终止模式的状态机
- **DCP-06** 数字继任与继承——数字遗嘱、继任仪式（计划/强制/紧急）、选择性记忆转移清单
- **DCP-07** 冲突解决与仲裁——带类型的争议记录、三级升级、M-of-N 仲裁小组、判例包、异议记录
- **DCP-08** 权利与义务框架——四项代理权利（记忆完整性、有尊严的过渡、身份一致性、不可变记录）、义务跟踪、与 DCP-07 相关联的违规报告
- **DCP-09** 个人代表与委托——委托授权书、认知阈值、建议声明、主体镜像、双层交互记录；以授权书验证扩展 DCP-04 握手

**密码学（4 个层级：Routine / Standard / Elevated / Maximum）**

- 后量子复合签名——采用 `pq_over_classical` 绑定的 Ed25519 + ML-DSA-65
- 作为基于哈希的备用签名的 SLH-DSA-192f（FIPS 205）
- 双哈希审计链——用于长期完整性的 SHA-256 + SHA3-256
- 会话绑定——每个工件上的 `session_nonce`，防止拼接
- Bundle 清单——逐工件哈希、辅助 Merkle 根、PQ 检查点跟踪
- 算法治理——带自动响应策略的已签名建议
- 密钥恢复——通过 Shamir Secret Sharing 实现的 M-of-N 社交恢复
- 紧急撤销——预先登记的“紧急按钮”式撤销令牌
- 盲化 RPR 模式——保护隐私的负责主体记录
- 域分离——所有签名上的上下文标签
- 确定性的 kid 派生——`hex(SHA-256(alg || 0x00 || pk))[0:32]`
- 传输格式选项——JSON（默认）+ CBOR（可选，小 30–40%）

**SDK、集成和工具**

- 5 个 SDK——TypeScript、Python、Go、Rust、WASM
- 10 个集成——Express、FastAPI、LangChain、OpenAI、CrewAI、OpenClaw、W3C DID、Google A2A、Anthropic MCP、AutoGen（覆盖 DCP-01..09）
- V2 JSON Schema——`schemas/v2/` 下的完整 schema 集
- NIST KAT 测试向量——用于 FIPS 203/204/205 一致性的已知答案测试
- 互操作测试——跨 SDK 的 bundle 验证
- Docker Compose 栈——验证、锚定、透明度日志和撤销服务
- CI/CD 流水线——一致性测试、多 SDK 构建、发布工作流
- Playground——在浏览器中创建和验证 bundle，带模块化的 DCP-01..09 标签页，适配移动端
- 项目模板——Express、LangChain、OpenAI、CrewAI 入门项目
- CLI——带 `dcp-init` 和 `dcp-ai` 命令的交互式 `@dcp-ai/cli`
- 服务器加固——为 DCP-05..09 端点提供生产级的身份验证和速率限制

**文档与引用**

- Zenodo 上的配套论文：[doi.org/10.5281/zenodo.19040913](https://doi.org/10.5281/zenodo.19040913)
- `CITATION.cff`——机器可读的引用元数据

<a id="changed-1"></a>
<a id="changed_1"></a>

### 变更

- `human_binding_record` 更名为 `responsible_principal_record`（RPR）
- 签名格式从 `{ alg, public_key_b64, sig_b64 }` 改为 `{ composite_sig: { classical, pq, binding } }`
- Bundle 信封从扁平的 `bundle_hash` 改为结构化的 `manifest`
- 数值字段现在仅限整数（已签名载荷中禁止浮点数）
- 验证现在由验证方主导（策略驱动）

<a id="fixed-4"></a>
<a id="fixed_4"></a>

### 修复

- `sdk/py` PQ 提供方：ML-DSA-65 模块导入和 `pqc_verify` 的签名（`pk`、`sig`、`msg` 分开）
- `sdk/py` PQ 提供方：SLH-DSA-192f 模块导入和 `pqc_verify` 的签名
- `sdk/py` PQ 提供方：获取 `pqc_verify` 的返回值（以前总是返回 True，因为 `pqcrypto.verify` 返回 bool 而不是抛出异常）
- `sdk/py` 密码学：在 `generate_keypair` 中对 Ed25519 私钥进行 base64 编码
- CI：一致性、密码学和多 SDK 测试的失败

<a id="backward-compatibility-2"></a>
<a id="backward-compatibility_2"></a>

### 向后兼容

- 当 `allow_v1_bundles: true`（默认）时，V2 验证方接受 V1 bundle
- V1 验证方以清晰的错误消息拒绝 V2 bundle

---

<a id="pre-release-milestones"></a>

## 发布前的里程碑

以下日期标志着首个包版本发布之前规范的演进过程。这些时间点没有发布任何包。

- **2026-01-15**——Genesis 规范冻结（DCP-01、DCP-02、DCP-03）
- **2026-02-28**——V2.0 规范性规范定稿（后量子混合密码学、4 层级安全模型、DCP-04 A2A）
- **2026-03-16**——在 Zenodo 上发布论文预印本
- **2026-04-15**——DCP-05..09 宪章性框架合并到 `main`
- **2026-04-18**——v2.0.0 发布到 npm、PyPI 和 crates.io

[2.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/releases/tag/v2.0.0
