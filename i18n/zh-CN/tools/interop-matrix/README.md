<sub>[English](../../../../tools/interop-matrix/README.md) · **中文** · [Español](../../../es/tools/interop-matrix/README.md) · [日本語](../../../ja/tools/interop-matrix/README.md) · [Português](../../../pt-BR/tools/interop-matrix/README.md)</sub>

<a id="interop-matrix-live-agents-across-the-four-sdks"></a>

# 互操作矩阵：跨四个 SDK 的运行中代理

> 本文是[英文版](../../../../tools/interop-matrix/README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

`run.mjs` 为**每个 SDK 启动一个代理进程**（TypeScript、Python、Go、Rust），并让它们
相互协作：基于一个 SDK 构建的代理创建其身份、声明意图、执行操作并
签名其公民身份 bundle；基于另一个 SDK 构建的代理会像在信任对方之前那样
验证它们。这里的验证是指 bundle 内部一致，并由它自己列出的密钥签名；它不是
对对方的信任、准入或执行操作的授权（场景 2 涵盖准入，而准入同样不授权
任何操作）。这些进程除了编排器转发的消息外不共享任何东西，
因此每一对（四个 SDK 共 16 对，包括每个 SDK 与自身）都是真正的互操作，而不是
文件比较。第五个只做验证的代理 `ref` 运行参考验证器
`lib/verify.js`（即 `node bin/dcp.js verify-bundle` 和验证服务器所运行的）：它在 `@dcp-ai/sdk` 验证器
（在 2.2.0 发布到 npm 之前为工作区 SDK）之前，根据 `schemas/v2` 校验每个
工件，而 SDK 验证器不做这一步。

编排器也是中间的网络：它在传输中篡改 bundle，每个
验证器都必须以同样的方式拒绝每个被篡改的 bundle。任何意外的判定、崩溃或超时
都会使运行失败。

场景 1（`run.mjs`）在 SDK 之间演练 DCP-01（身份）、DCP-02（意图和策略）和 DCP-03（审计）的部分内容；
它不是这些规范的完整一致性测试。
场景 2（`admission.mjs`）涵盖四个 SDK 在 `strict-v1` 配置文件
（`spec/profiles/admission`）下的准入。DCP-04 的 A2A 握手需要先完成 SDK 方面的工作
（见末尾的路线图）。

<a id="run"></a>

## 运行

```bash
(cd sdks/typescript && npm install && npm run build) # agents/ts imports sdks/typescript/dist
npm install                                           # agents/ref: the reference verifier, on that SDK
pip install -e sdks/python                            # dependencies of agents/py
node tools/interop-matrix/run.mjs                     # all four SDKs and the reference verifier
node tools/interop-matrix/run.mjs --agents ts,py      # a subset
node tools/interop-matrix/admission.mjs               # scenario 2, the four SDKs, with its negative control
```

Go 和稳定版 Rust 工具链必须在 `PATH` 上；`run.mjs` 会构建 `agents/go` 和 `agents/rust`。
选项：`--agents a,b`（`ts`、`py`、`go`、`rust`、`ref` 中的任意几个）、`--python PATH`（默认 `$INTEROP_PYTHON` 或 `python3`）、`--timeout MS`
（每个请求，默认 60000）、`--out DIR`（默认 `tools/interop-matrix/out`，报告
以及每个产生意外判定的 bundle 都写在这里）。`admission.mjs` 接受相同的
选项，`ref` 除外（默认 `--out tools/interop-matrix/out/admission`），另外还有
`--skip-negative-control`、`--negative-control`、`--check-negative-control` 和 `--replay FILE`
（见下文）。

<a id="the-agent-protocol"></a>

## 代理协议

代理从 stdin 每行读取一个 JSON 请求，并按顺序为每个请求向 stdout 写入恰好一行 JSON
响应；其他任何内容都写到 stderr。

```json
{"id": 1, "cmd": "identity", "args": {"owner_name": "Interop Owner", "jurisdiction": "CL"}}
{"id": 1, "ok": true, "result": {"agent_id": "agent:…", "human_id": "rpr:…", "session_nonce": "…"}}
{"id": 2, "ok": false, "error": "message"}
```

代理在进程存续期间把自己的状态（密钥、身份、意图、审计轨迹）保存在内存中。
密钥从不离开它。下文中契约规定的每个值都必须严格按所写内容生成；
其他一切都由 SDK 自行决定，而这正是矩阵所测试的（SDK 自行添加的
可选字段，例如 Go 的 SHA3 `audit_merkle_root_secondary`，只要所有验证器都接受
就没有问题）。

### `identity` `{owner_name, jurisdiction}` → `{agent_id, human_id, session_nonce, principal_keys, agent_keys}`

生成两个复合密钥对（Ed25519 + ML-DSA-65）：一个给人类委托人，一个给
代理；一个新的会话 nonce（64 个十六进制字符）；`human_id` = `rpr:<uuid4>`，`agent_id` = `agent:<uuid4>`。
密钥条目：`{kid, alg, public_key_b64, created_at: <now RFC 3339>, expires_at: null, status: "active"}`。

- **RPR**（`schemas/v2/responsible_principal_record.schema.json`）：`dcp_version "2.0"`、`human_id`、
  `session_nonce`、`legal_name` = `owner_name`、`entity_type "natural_person"`、`jurisdiction`、
  `liability_mode "owner_responsible"`、`override_rights true`、`issued_at` 为当前时间、`expires_at null`、
  `contact null`、`binding_keys` = 两个人类密钥条目。在 `ResponsiblePrincipal` 上下文下由**人类**密钥
  复合签名（`pq_over_classical`）的 `SignedPayload`。
- **护照**（`agent_passport.schema.json`）：`dcp_version "2.0"`、`agent_id`、`session_nonce`、
  `keys` = 两个代理密钥条目、`principal_binding_reference` = `human_id`、
  `capabilities ["api_call", "payments"]`、`risk_tier "medium"`、`created_at` 为当前时间、
  `status "active"`。在 `AgentPassport` 下由**代理**密钥复合签名。

`principal_keys` 和 `agent_keys` 是公开的那一半，`[{kid, alg, public_key_b64}]`，经典密钥
在前。场景 2 以带外方式根据它们登记委托人。

第二次 `identity` 会替换第一次，连同与之相关的意图和轨迹。

### `intent` `{action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash}` → `{intent_id, decision, security_tier}`

- **意图**（`intent.schema.json`）：`dcp_version "2.0"`、`intent_id` = `intent:<uuid4>`、
  `session_nonce`、`agent_id`、`human_id`、`timestamp` 为当前时间、`action_type`、
  `target {channel, to: null}`、`data_classes`、`estimated_impact`、
  `requires_consent` = （`estimated_impact` 是否为 `"high"`）、`security_tier` = SDK 针对此意图和 `risk_score`
  的安全等级计算结果（DCP-AI v2.0 §14.2）。
- **策略决定**（`policy_decision.schema.json`）：`dcp_version "2.0"`、`intent_id`、
  `session_nonce`、`decision` = `risk_score` < 500 时为 `approve`，< 800 时为 `escalate`，否则为
  `block`；`risk_score`；`reasons ["interop-matrix: risk_score <n>"]`；`required_confirmation`
  在 approve 时为 `null`，否则为 `{"type": "human_approve", "fields": ["action_type"]}`；
  `applied_policy_hash` 取自参数；`timestamp` 为当前时间；`resolved_tier` = 意图的
  `security_tier`。

两者都由**代理**密钥复合签名（`Intent`、`PolicyDecision` 上下文）。

### `act` `{intent_id, outcome, tool, result_ref}` → `{audit_id, count}`

向该意图的轨迹追加一个审计条目（`audit_entry.schema.json`）：`dcp_version "2.0"`、
`audit_id` = `audit:<uuid4>`、`session_nonce`、`prev_hash` = 轨迹的第一个条目为 `"GENESIS"`，
否则为 `"sha256:" + hex(sha256(canonical(previous entry)))`；`hash_alg "sha256"`；
`timestamp` 为当前时间；`agent_id`；`human_id`；`intent_id`；
`intent_hash` = `"sha256:" + hex(sha256(canonical(intent payload)))`；
`policy_decision` = 根据决定为 `approved` / `escalated` / `blocked`；`outcome`；
`evidence {tool, result_ref, evidence_hash: "sha256:" + hex(sha256(utf8(result_ref)))}`；
`pq_checkpoint_ref null`。`count` 是轨迹长度。该条目是合成记录：`act` 不执行任何操作，
`outcome`、`tool` 和 `result_ref` 都是编排器发送的字符串。

### `bundle` `{intent_id, session_issued_at?, session_expires_at?, intended_verifier?}` → `{signed_bundle}`

该意图的公民身份 bundle（`signed_bundle.schema.json`）：已签名的 RPR、护照、
意图和策略决定，该意图的完整轨迹，以及清单：`session_nonce`、
`rpr_hash` / `passport_hash` / `intent_hash` / `policy_hash`（载荷哈希）、
`audit_merkle_root`（`"sha256:"` + SDK 的审计 Merkle 根）、`audit_count`、
`canonicalization_profile "dcp-jcs-v1"`。签名：`hash_alg "sha256"`、`created_at` 为当前时间、
`signer {type: "human", id: human_id, kids: [human classical kid, human pq kid]}`、
`manifest_hash`、在 `Bundle` 上下文下由**人类**密钥生成的 `composite_sig`。请使用 SDK 的
bundle 构建器和签名器。Go 和 Rust 的构建器还会写入 `audit_merkle_root_secondary`。
可选参数在签名之前按原样放入清单。

### `verify` `{signed_bundle, mode}` → `{valid, errors}`

SDK 的 V2 bundle 验证器。`mode` 为 `""` 时使用默认验证器策略；任何其他值都是
应用于 `default_mode` 和所有风险等级的验证模式，与互操作测试的做法相同。格式错误的
bundle 得到 `valid: false` 结果，绝不会是错误响应。

### `rotate_principal` `{}` → `{human_id, principal_keys}`

为委托人生成新的复合密钥对，以及一个新的 RPR，其 `human_id` 相同、`issued_at`
为当前时间、带有新的 `binding_keys`，并由新密钥签名。之后的 bundle 使用它们。

<a id="configure-tenant-trust_set-profile---or-config_error"></a>
<a id="configure-tenant-trust_set-profile-or-config_error"></a>

### `configure` `{tenant, trust_set, profile}` → `{}` 或 `{config_error}`

租户的运营方配置，用 SDK 自己的加载器加载：信任集
（`createPrincipalTrustStore` 及其对应项）和 `strict-v1` 配置文件
（`resolveStrictV1Profile`）。配置错误为 `{config_error: <CONFIG_* code>}`。

<a id="admit-tenant-signed_bundle-revocation-now_ms--the-admission-result"></a>
<a id="admit-tenant-signed_bundle-revocation-now_ms-the-admission-result"></a>

### `admit` `{tenant, signed_bundle, revocation, now_ms}` → 准入结果

使用租户的配置文件和信任集、吊销快照及时钟调用 SDK 的组合准入 API（`admitSignedBundleV2` 及其对应项）。
结果是 SDK 自己的 JSON 形式（spec §8），去掉 `verification`，再加上 `verification_errors`。

### `shutdown` `{}` → `{}`

代理在响应后退出。

<a id="scenario-1-dcp-01-to-dcp-03"></a>

## 场景 1：DCP-01 至 DCP-03

每个 SDK 作为**生产方**：`identity`；一个带三次 `act` 的常规意图（`api_call`、通道 `api`、
`["none"]`、影响 `low`、风险 100）；一个带一次 `act` 的支付意图（`initiate_payment`、
通道 `payments`、`["financial_data"]`、影响 `high`、风险 900，因此被阻止）
（拒绝同样是证据）；两者都执行 `bundle`。然后每个 SDK 作为**验证方**在默认策略和 `hybrid_required` 下
检查这两个 bundle：两者都必须通过验证。

接着编排器在传输中篡改常规 bundle，每个验证器都必须拒绝
每个副本，除另有说明外在两种模式下都是如此：

| 攻击 | 改变了什么 |
|---|---|
| `intent_changed` | 签名后 `intent.payload.estimated_impact` 变为 `high` |
| `audit_reordered` | 前两个审计条目交换位置 |
| `audit_entry_dropped` | 删除最后一个审计条目，保留清单 |
| `session_spliced` | 替换清单中的 `session_nonce` |
| `bundle_signature_swapped` | bundle 签名来自支付 bundle |
| `passport_swapped` | 护照属于另一个代理（下一个 SDK 的生产方） |
| `pq_stripped` | 删除 bundle 签名的 `pq` 位置（`classical_only`）；仅 `hybrid_required` |
| `intent_from_other_bundle` | 意图和策略决定来自支付 bundle（同一会话和签名者） |
| `trail_from_other_bundle` | 审计轨迹来自支付 bundle（同一会话和签名者） |

崩溃、超时或不按顺序作答的代理会被停止，之后对它的每个请求都会
立即失败，因此损坏的代理会表现为失败，而绝不会让运行挂起。

<a id="scenario-2-admission-under-strict-v1"></a>

## 场景 2：`strict-v1` 下的准入

每个 SDK 作为**生产方**：`identity`、一个带一次 `act` 的常规意图（风险 100，因此 `approve`），
以及三个 bundle，其清单签名的会话时间窗口为 `[T0, T0 + 300 s]`（配置文件的
最大值）：一个面向本验证器（`verifier:interop-admission`），一个面向另一个受众，以及
在 `rotate_principal` 之后用轮换后的委托人密钥签名的一个。

编排器就是运营方。它根据生产方报告的公钥登记每个委托人
（绝不根据正在准入的 bundle），构建信任集，并提供吊销
快照：生产方的代理和密钥，`checked_at` 比时钟早 10 秒。每次准入都在
固定时刻 `T0 + 120 s` 运行（过期用例在过期时间加 1 毫秒时运行）。租户 A 和 B 是
测试框架所做的运营方配置选择；不涉及任何集成或缓存。

每个 SDK 作为**消费方**，针对每个生产方按此顺序、在同一个
进程中运行下面的 13 个用例。预期的 `verified`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、
`action_authorized`（始终为 `false`）、`recorded_decision`、`trust_set_version` 和代码集合
来自规范，写在 `admission.mjs` 中，绝不来自某个 SDK。

| 用例 | 配置 | 预期 |
|---|---|---|
| `trusted_admitted` | 租户 A 信任所有已登记的委托人 | 准入 |
| `trust_withdrawn` | 去掉此委托人的租户 A，同一 bundle | `TRUST_PRINCIPAL_UNKNOWN` |
| `trust_restored` | 恢复如前的租户 A，同一 bundle | 准入 |
| `tenant_b_empty_trust` | 租户 B，空信任集 | `TRUST_PRINCIPAL_UNKNOWN` |
| `principal_key_revoked` | 新的快照吊销一个委托人密钥 | `REVOCATION_REVOKED` |
| `agent_key_revoked` | 新的快照吊销一个代理密钥 | `REVOCATION_REVOKED` |
| `other_audience` | 为另一个验证器签名的 bundle | `PROFILE_AUDIENCE_MISMATCH`, `VERIFICATION_FAILED` |
| `session_expired` | 时钟比签名的过期时间晚 1 毫秒 | `PROFILE_SESSION_EXPIRED`, `VERIFICATION_FAILED` |
| `rotation_new_keys_not_enrolled` | 轮换后的 bundle，信任集未更新 | `TRUST_KEY_NOT_ANCHORED` |
| `rotation_overlap_new_keys` | 新旧密钥均有效 | 准入 |
| `rotation_overlap_old_keys` | 同上，原始 bundle | 准入 |
| `rotation_old_keys_retired` | 旧密钥为 `revoked`，原始 bundle | `TRUST_KEY_REVOKED` |
| `rotation_new_keys_after_retirement` | 同上，轮换后的 bundle | 准入 |

出现不匹配时，会向输出目录写入一个最小复现：为那一次准入提供给消费方的全部内容，
包括租户的**生效**信任集和配置文件（最后加载的那些，即使是由更早的用例加载的，
也附带 `configuration_loaded_in`），以及它返回的内容。只有公开材料：没有私钥。

```bash
node tools/interop-matrix/admission.mjs --replay tools/interop-matrix/out/admission/<producer>-<consumer>-<case>.json
```

`--replay` 会启动所记录 SDK 的一个新消费方，配置所记录的租户，在所记录的时钟下对所记录的
bundle 执行准入，并要求输出与记录完全一致：双方的每个键
（规范化字段、代码、验证器错误，以及调用失败时的 `error`），只出现在一方的键也算差异，
因此两个不同的错误绝不会被算作复现。复现时退出码为 0，不同时为 1，记录不完整时为 2。

**阴性对照。** 矩阵运行之后，运行器会以 `--negative-control` 在 `ts` 组合上再次启动自身，
使用新的临时目录和新的运行 id，最多 120 秒。该次运行会反转 `trust_withdrawn` 的预期
`admitted`。只有当子进程以 1 退出，且其报告是它在本次运行中写出的（相同运行 id）、带有
`negative_control_run: true`、唯一的组合 `ts>ts` 为 13 中 12，并且恰好只有一个失败，即 `trust_withdrawn` 的
`admitted` 字段时，对照才通过。`--check-negative-control` 测试对照本身：它必须接受正确的运行，并拒绝
无法启动的子进程（没有报告，以及同一目录中留有早先运行的报告）和挂起的子进程
（在时间限制处被停止）。`--negative-control-case NAME` 改为反转另一个
用例，以便有意生成复现文件。

首次运行：16 个组合 × 13 个用例 = 208 个结果均符合预期，阴性对照也按要求
失败。

<a id="what-the-first-run-found"></a>

## 首次运行的发现

所有 16 个 SDK 组合和参考验证器在每个 bundle 和每种攻击上都一致。编写
代理的过程中暴露了以下 SDK 缺口，其中没有一个是 SDK 验证器之间的判定分歧：

- **Go 的 `SignBundleV2` 让 `signature.signer.id` 为空**：它不接收签名者 id。四个
  SDK 验证器接受这样的 bundle；参考验证器、CLI 和服务器则拒绝它
  （`signer/id must NOT have fewer than 6 characters`）。已修复：签名者现在是 bundle 的 RPR `human_id`，
  Go 代理直接使用 `SignBundleV2`。`signature.signer` 块（`id`、`kids`）、
  `created_at` 和 `manifest_hash` 是已签名清单之外的未经认证的元数据：没有
  验证器将它们与 RPR 比对，也不重新计算 `manifest_hash`（五者都接受全零）；
  只有 schema 约束它们的形式。
- **Go 的类型化载荷缺少等级字段**：`IntentV2` 没有 `security_tier`，
  `PolicyDecisionV2` 没有 `resolved_tier`。现在两者都已存在。（`contact` 和 `target.to` 在
  schema 中是可选的，因此 Go 代理的映射写入 `null` 只是为了符合契约。）
- **Rust 的原生 API 没有 bundle 构建器或签名器**，因此 Rust 代理从原语组装清单
  并签名。已修复：`build_bundle_v2` 和 `sign_bundle_v2`
  （`dcp_ai::v2::bundle`），代理现在使用它们。`wasm` 特性的 `wasm_build_bundle` 和
  `wasm_sign_bundle` 现在调用它们；此前 `wasm_sign_bundle` 写入 `created_at ""` 且没有
  `signer.id`，因此参考验证器会拒绝它签名的每个 bundle。
- **空的审计轨迹**：如 `spec/VERIFICATION.md` 所允许（根为 64 个零），每个验证器都接受
  没有审计条目、签名有效的 bundle；用于 PQ 检查点的 `auditEventsMerkleRoot` 辅助函数
  在四个 SDK 中同样都拒绝空列表。

> **说明（2026 年 10 月 25 日）。** 上述发现按首次运行时的记录保留。第一条在 `main` 上
> 已不再成立：四个 SDK 验证器现在会将未签名的 `signature` 块与已签名内容进行比对
> （`spec/VERIFICATION.md` V2-4）：`signer.id` 必须是 RPR 的 `human_id`，`signer.kids` 必须是复合签名的
> kid，`manifest_hash` 必须是规范清单的 SHA-256，`hash_alg` 必须是允许的值，因此全零会被
> 拒绝。`signature.created_at` 仍是没有任何验证器认证的未签名元数据。

<a id="roadmap"></a>

## 路线图

1. 场景 1（DCP-01 至 03）和场景 2（准入）纳入 CI。
2. DCP-04：如今每个 SDK 都会构建 `A2A_HELLO` 和 `A2A_WELCOME`，但没有一个实现
   `A2A_CONFIRM` / `A2A_ESTABLISHED` 或 DCP-04 §3.4 的会话密钥推导，只有 TypeScript
   具备消息所宣告的混合 X25519 + ML-KEM-768 KEM，Rust 也没有会话层。
   一旦它们实现，协议将增加 `hello`、`welcome`、`confirm`、`send` 和 `receive`，
   编排器会在两个代理之间重放、重排和拼接消息。
3. 由不同 SDK 上的代理逐跳构建的 DCP-09 授权链。
