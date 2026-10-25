<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="admission-profile-principal-trust-and-strict-v1"></a>

# 准入配置文件：委托人信任与 `strict-v1`

> 本文是[英文规范](README.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 草案，v1
**范围：** 在运营方固定的配置文件下，验证器是否把 V2 已签名 bundle 作为来自其已信任委托人的证据予以准入

---

<a id="1-purpose-and-layering"></a>

## 1. 目的与分层

[VERIFICATION.md](../../VERIFICATION.md)（V2-1 至 V2-14）决定 bundle 是否**通过验证**：其工件完好、一致，并由 bundle 自身列出的密钥签名。任何人都可以用任意 `human_id` 和自己的密钥创建 responsible principal record（RPR），因此通过验证的 bundle 证明的是完整性和签名，而不是委托人是谁。

准入在验证之上增加两个可选层，而不改变验证：

1. **委托人信任**（第 3 节）：为委托人签名的密钥属于运营方已经信任的委托人，依据是运营方提供的信任集。
2. **`strict-v1` 配置文件**（第 4 节）：由运营方选定的固定要求（混合签名、受众、简短的已签名会话时间窗口、新近的吊销状态），请求无法削弱这些要求。

两者都不启用的验证器的行为与以前完全相同。准入从不重新实现任何验证步骤：它读取验证器报告的内容（第 2.3 节）。

准入决定的是**证据**是否被准入。它并不授权任何操作：此版本绝不将外部授权与某个工具、其参数或其执行绑定（第 7 节）。

<a id="2-inputs"></a>

## 2. 输入

<a id="21-clock"></a>

### 2.1 时钟

验证和准入中的每次时间比较都使用同一个时刻 `now`，单位为自 Unix 纪元以来的毫秒数。实现将其作为参数接收，默认为系统时钟。时间戳是带 `Z` 或 `±hh:mm` 偏移的 RFC 3339，以毫秒精度比较，与 V2-4 相同。时钟偏差容限为 30 秒（`SKEW`），与 V2-4 和 DCP-04 相同。

<a id="22-trust-set"></a>

### 2.2 信任集

只由运营方提供：本地配置或运营方选定的来源。它不得（MUST NOT）从 bundle（其密钥、`legal_name`、`jurisdiction` 或任何其他自行声明的字段）、请求或工具参数，或 RPR 指明的 URL 推导得出。Schema：[`principal_trust_set.schema.json`](../../../schemas/v2/principal_trust_set.schema.json)。

```json
{
  "trust_set_version": "2026-11-01.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active",
          "not_before": null, "expires_at": "2027-06-01T00:00:00Z" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active" }
      ]
    }
  ]
}
```

信任集在加载时校验。在以下情况下会被拒绝，并给出方括号中的配置错误代码：

| 条件 | 代码 |
|---|---|
| 任何层级上 schema 之外的字段 | `CONFIG_UNKNOWN_FIELD` |
| `trust_set_version` 缺失或不是非空字符串；`principals` 不是数组；某个委托人的 `keys` 不是非空数组；`status` 不是 `active`、`revoked` 或 `expired`；`not_before` 或 `expires_at` 既不是 null 也不是 RFC 3339 | `CONFIG_INVALID_VALUE` |
| `human_id` 缺失、不是字符串或为空 | `CONFIG_TRUST_EMPTY_ID` |
| `alg` 不是 `ed25519`、`ml-dsa-65` 或 `slh-dsa-192f`；`public_key_b64` 不是规范的 base64（V2-5），或对该算法不是 32、1952 或 48 字节 | `CONFIG_TRUST_MALFORMED_KEY` |
| `kid` 不是由 `alg` 和密钥字节推导出的 kid（V2-13） | `CONFIG_TRUST_KID_NOT_DERIVED` |
| 某个 `human_id` 列出两次，或某个 `kid` 在整个集合中列出两次（在一个委托人下或两个委托人下） | `CONFIG_TRUST_DUPLICATE` |

任何重复项都会被拒绝，无论是否相同：合并多个来源的运营方要在加载前解决重复。没有委托人的信任集是有效的，它不信任任何人。

密钥以信任集中的状态为准。将某个密钥列为 `active` 的 bundle 不能恢复信任集标记为 `revoked` 或 `expired`、或其 `expires_at` 已过期的密钥。

**轮换**是对信任集的显式更新（新的 `trust_set_version`）：运营方加入新密钥，如有需要在重叠期内保持旧密钥为 `active`，然后将其退役（`revoked`、`expired`、设置 `expires_at` 或移除）。bundle 不能授权自己的轮换，因为它的密钥从来都不是信任来源。

代理密钥不登记在信任集中。代理通过委托人对清单的签名与委托人绑定，而清单覆盖了 `passport_hash`（V2-6、V2-7）。

<a id="23-signer-keys-reported-by-the-verifier"></a>

### 2.3 验证器报告的签名者密钥

对它检查的每个复合签名（bundle 对清单的签名、四个工件、每个 PQ 检查点），验证器按组件报告它解析出的密钥条目以及该组件是否通过验证：

```json
{ "signature": "bundle", "component": "classical", "kid": "…", "alg": "ed25519",
  "public_key_b64": "…", "verified": true }
```

`signature` 为 `bundle`、`responsible_principal_record`、`agent_passport`、`intent`、`policy_decision` 或 `pq_checkpoints[<checkpoint_id>]`；`component` 为 `classical` 或 `pq`。验证器未解析其密钥的组件（`pq_only` 下缺失的经典密钥）不会被报告。这些是实际验证了签名的密钥，按验证器解析的方式原样解析；准入绝不以第二种方式解析密钥。该列表是针对通过验证的 bundle 定义的；对于未通过验证的 bundle，实现可以在第一个失败处停止，也可以继续，准入不会使用它。

**委托人签名**是 `bundle` 和 `responsible_principal_record`。

<a id="24-revocation-snapshot"></a>

### 2.4 吊销快照

`strict-v1` 需要它。运营方的适配器从运营方配置的本地或远程来源（不需要任何中心服务）获取它，针对 bundle 的**吊销主体**：护照的 `agent_id`，以及每个已验证签名者密钥（第 2.3 节）的 kid，包括所有签名。Schema：[`revocation_snapshot.schema.json`](../../../schemas/v2/revocation_snapshot.schema.json)。

```json
{ "checked_at": "2026-11-01T00:00:20Z",
  "agents": { "agent:acme-bot": "not_revoked" },
  "keys": { "<kid>": "not_revoked", "<kid>": "not_revoked" } }
```

`checked_at` 是来源确定这些状态的时间，而不是适配器读取它们的时间。每个状态为 `revoked`、`not_revoked` 或 `unknown`。无法应答的来源（超时、错误、不可达）不产生快照；适配器不得（MUST NOT）把失败变成 `not_revoked`。

<a id="3-principal-trust"></a>

## 3. 委托人信任

只有在提供了信任集且 bundle 通过验证（V2-1 至 V2-14）时才评估；否则结果为 `not_evaluated`。设 `human_id` 为 RPR 载荷的 `human_id`：

- **T1.** `human_id` 不是信任集中的委托人：`TRUST_PRINCIPAL_UNKNOWN`。停止。
- **T2.** 对每个委托人签名（第 2.3 节）的每个已验证组件，查找该委托人在信任集中具有相同 `kid` 的条目，按以下第一个适用的情况判定：
  - 没有该条目，或 `alg` 不同或密钥字节不同：`TRUST_KEY_NOT_ANCHORED`；
  - `status` 为 `revoked`：`TRUST_KEY_REVOKED`；
  - `status` 为 `expired`，或 `expires_at` 早于 `now`：`TRUST_KEY_EXPIRED`；
  - `not_before` 晚于 `now`：`TRUST_KEY_NOT_YET_VALID`。

没有任何已验证委托人组件的已验证 bundle 也会得到 `TRUST_KEY_NOT_ANCHORED`。当 T1 和 T2 都没有添加代码时，委托人为 `trusted`，否则为 `untrusted`。每个已验证组件都计入：只信任委托人的 Ed25519 密钥并不会使其 PQ 密钥或 RPR 中的任何其他密钥受信任。

<a id="4-the-strict-v1-profile"></a>

## 4. `strict-v1` 配置文件

<a id="41-configuration"></a>

### 4.1 配置

Schema：[`admission_profile.schema.json`](../../../schemas/v2/admission_profile.schema.json)。

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example",
  "max_session_duration_seconds": 300, "max_revocation_age_seconds": 300,
  "verifier_policy": { "advisory_rejected_algs": ["slh-dsa-192f"] } }
```

| 字段 | 规则 |
|---|---|
| `profile` | 必需，`"strict-v1"` |
| `verifier_id` | 必需，非空字符串；bundle 已签名的 `intended_verifier` 必须等于它 |
| `max_session_duration_seconds` | 1 到 300 的整数，默认 300 |
| `max_revocation_age_seconds` | 1 到 300 的整数，默认 300 |
| `verifier_policy` | 可选的 VerifierPolicy 字段；每个字段只能保持或收紧配置文件的策略（第 4.2 节） |

配置文件设定的是要求，而不是默认值。它的验证器策略为：

| 字段 | 值 | `verifier_policy` 可以设置什么 |
|---|---|---|
| `default_mode`、每个 `risk_overrides` 等级 | `hybrid_required` | 只能是 `hybrid_required`。`pq_only` 省去了经典签名，因此不满足该配置文件 |
| `require_session_binding`、`require_composite_binding`、`require_session_expiry`、`require_audience_binding` | `true` | 只能是 `true` |
| `allow_v1_bundles`、`allow_classical_fallback_disable` | `false` | 只能是 `false` |
| `verifier_id` | 配置文件的值 | 只能是相同的值 |
| `max_session_duration_seconds` | 配置文件的值 | 从 1 到配置文件的值；取较小者 |
| `min_classical`、`min_pq` | `1` | 只能是 `1`：复合签名有一个经典组件和一个 PQ 组件 |
| `accepted_hash_algs` | `["sha256", "sha384"]` | 只能是这两个，顺序任意：验证器按 V2-4 检查 bundle 的 `hash_alg` |
| `max_key_age_days` | `365` | 只能是 `365`：验证器对密钥年龄只给出警告 |
| `accepted_classical_algs` | `["ed25519"]` | 非空子集 |
| `accepted_pq_algs` | `["ml-dsa-65", "slh-dsa-192f"]` | 非空子集 |
| `advisory_rejected_algs` | `[]` | 任意字符串列表 |
| `warn_classical_only_deprecated` | `false` | 任意布尔值（仅警告） |

`verifier_policy` 可以更改的每个字段都是所有验证器都以相同方式执行的字段，因此配置文件绝不会带着某个 SDK 会静默忽略或拒绝的要求被加载。

配置错误在加载配置文件时抛出：

| 条件 | 代码 |
|---|---|
| 顶层或 `verifier_policy` 中 schema 之外的字段 | `CONFIG_UNKNOWN_FIELD` |
| 类型错误的值；`profile` 不是 `"strict-v1"` | `CONFIG_INVALID_VALUE` |
| `verifier_id` 缺失或为空；某个最大值小于 1 或大于 300；上表不允许的 `verifier_policy` 值 | `CONFIG_PROFILE_CONTRADICTION` |

当一个配置有多个问题时，可以报告其中任何一个的代码。

启用该配置文件的适配器还会以 `CONFIG_PROFILE_CONTRADICTION` 拒绝：缺少信任集或吊销来源，以及其自身任何会削弱配置文件的选项（接受没有 bundle 的请求、自己的验证器策略、失败开放的吊销检查）。

<a id="42-profile-checks"></a>

### 4.2 配置文件检查

设 `max` 为有效的最长会话时长，`m` 为 bundle 的清单：

- **P1.** `bundle.dcp_bundle_version` 不是 `"2.0"`：`PROFILE_V2_REQUIRED`。停止：不再评估其他内容。
- **P2.** `m.intended_verifier` 缺失、为 null、不是字符串或为空：`PROFILE_AUDIENCE_MISSING`；任何其他不同于 `verifier_id` 的值：`PROFILE_AUDIENCE_MISMATCH`。
- **P3.** `m.session_issued_at` 缺失或为 null：`PROFILE_SESSION_START_MISSING`。`m.session_expires_at` 缺失或为 null：`PROFILE_SESSION_EXPIRY_MISSING`。其中任一存在但不是 RFC 3339，或开始时间晚于过期时间：`PROFILE_SESSION_TIME_INVALID`。否则：
  - 开始时间晚于 `now + SKEW`：`PROFILE_SESSION_NOT_STARTED`；
  - 过期时间早于 `now`：`PROFILE_SESSION_EXPIRED`；
  - 过期时间减去开始时间大于 `max` 秒：`PROFILE_SESSION_TOO_LONG`。
- **P4.** bundle 签名或 RPR 的 `composite_sig` 不是带 `pq` 组件的 `pq_over_classical`：`PROFILE_HYBRID_REQUIRED`。验证之后，当任一委托人签名缺少已验证的经典或 PQ 组件，或验证模式不是 `hybrid_required` 时，也是如此。

P2 和 P3 以代码的形式重复了配置文件策略让 V2-4 执行的内容，以便被拒绝的 bundle 说明哪项要求未满足。它们在清单通过认证之前读取清单；只有通过验证的 bundle 才会被准入。

<a id="43-revocation-checks"></a>

### 4.3 吊销检查

在 bundle 通过验证时，针对第 2.4 节的主体进行评估：

- **R1.** 没有快照：`REVOCATION_UNAVAILABLE`。停止。
- **R2.** 快照不符合 schema（缺少或多出字段、`checked_at` 不是 RFC 3339、状态不是三者之一），或 `checked_at` 晚于 `now + SKEW`：`REVOCATION_INVALID`。停止。
- **R3.** `now - checked_at` 大于 `max_revocation_age_seconds`：`REVOCATION_STALE`。
- **R4.** 某个主体为 `revoked`：`REVOCATION_REVOKED`。
- **R5.** 某个主体在快照中缺失或为 `unknown`：`REVOCATION_UNKNOWN`。

把某个主体标记为已吊销的过时快照会报告两个代码。这些结果都不算作 `not_revoked`。

<a id="5-admission"></a>

## 5. 准入

<a id="51-procedure"></a>

### 5.1 流程

给定已签名 bundle、可选的配置文件、可选的信任集（使用配置文件时必需）、吊销快照（只在配置文件下评估）以及 `now`：

1. 在配置文件下，先 P1；然后 P2、P3 以及 P4 的结构部分。
2. 在 `now` 时刻，按配置文件的策略（没有配置文件时按调用方的策略）验证 bundle（V2-1 至 V2-14）。未通过验证：`VERIFICATION_FAILED`。
3. 如果通过验证：提供了信任集时评估委托人信任（第 3 节）；在配置文件下，评估 P4 的已验证部分和吊销检查（第 4.3 节）。

实现可以单独公开第 3 步（`evaluateAdmissionV2` 及其对应项），以便调用方复用已有的验证结果。该函数信任它收到的验证结果，不重新验证：它必须是针对同一 bundle、在同一 `now`、有配置文件时按配置文件策略执行的第 2 步结果。伪造的结果、来自其他 bundle 的结果或在较弱策略下得到的结果都会给出错误答案；组合函数（`admitSignedBundleV2`）会执行两个步骤。

<a id="52-result"></a>

### 5.2 结果

| 字段 | 值 |
|---|---|
| `verified` | 验证器的判定，含义不变 |
| `verification` | 验证器的完整结果（错误、警告、详情、签名者密钥） |
| `principal_trust` | `trusted`、`untrusted` 或 `not_evaluated`（没有信任集，或未通过验证） |
| `profile` | `"strict-v1"` 或 null |
| `profile_compliance` | `compliant`、`non_compliant` 或 `not_evaluated`（没有配置文件） |
| `admitted` | `verified`，并且在提供了信任集时 `principal_trust` 为 `trusted`，在配置文件下 `profile_compliance` 为 `compliant` |
| `action_authorized` | 在此版本中始终为 `false`（第 7 节） |
| `recorded_decision` | 已验证 bundle 的策略决定的 `decision`（`approve`、`escalate`、`block`），否则为 null |
| `trust_set_version` | 信任集的版本，或 null |
| `errors` | 每个添加的代码对应一个 `{ code, message }`，按第 5.1 节的顺序 |

当 bundle 通过验证且没有添加任何 `PROFILE_*` 或 `REVOCATION_*` 代码时，`profile_compliance` 为 `compliant`。记录了 `block` 或 `escalate` 决定的 bundle 可以作为该决定的证据被准入；`action_authorized` 仍为 `false`。

来自未知委托人的自洽 bundle 仍然是通过验证的，但在提供了信任集时不会被准入。

<a id="53-codes"></a>

### 5.3 代码

| 代码 | 步骤 |
|---|---|
| `VERIFICATION_FAILED` | 第 5.1 节第 2 步 |
| `TRUST_PRINCIPAL_UNKNOWN`, `TRUST_KEY_NOT_ANCHORED`, `TRUST_KEY_REVOKED`, `TRUST_KEY_EXPIRED`, `TRUST_KEY_NOT_YET_VALID` | 第 3 节 |
| `PROFILE_V2_REQUIRED`, `PROFILE_AUDIENCE_MISSING`, `PROFILE_AUDIENCE_MISMATCH`, `PROFILE_SESSION_START_MISSING`, `PROFILE_SESSION_EXPIRY_MISSING`, `PROFILE_SESSION_TIME_INVALID`, `PROFILE_SESSION_NOT_STARTED`, `PROFILE_SESSION_EXPIRED`, `PROFILE_SESSION_TOO_LONG`, `PROFILE_HYBRID_REQUIRED` | 第 4.2 节 |
| `REVOCATION_UNAVAILABLE`, `REVOCATION_INVALID`, `REVOCATION_STALE`, `REVOCATION_REVOKED`, `REVOCATION_UNKNOWN` | 第 4.3 节 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_PROFILE_CONTRADICTION`, `CONFIG_TRUST_EMPTY_ID`, `CONFIG_TRUST_MALFORMED_KEY`, `CONFIG_TRUST_KID_NOT_DERIVED`, `CONFIG_TRUST_DUPLICATE` | 在加载信任集或配置文件时抛出 |

消息长度有限，除了被比较的标识符之外，绝不包含私钥、令牌或运营方的配置。

<a id="6-adapters-and-caching"></a>

## 6. 适配器与缓存

核心函数是确定性的，不发起任何网络调用。适配器（中间件、工具、服务器）解析运营方的配置，调用信任和吊销来源，并执行决定：

- **A1.** 只有当 `admitted` 为真时，请求才会到达受保护的处理器。一旦配置了信任或配置文件，适配器绝不只凭 `verified` 继续，并在配置时以 `CONFIG_PROFILE_CONTRADICTION` 拒绝会让没有 bundle 的请求到达处理器的选项。当运营方配置了信任来源时，每个答复都作为信任集加载（第 2.2 节）：失败的来源，或什么都不答复（`undefined`、`null`）或答复的不是有效信任集的来源，都会拒绝请求。它绝不代表“没有信任集”，因为第 5.1 节的评估会把那种情况理解为不带委托人信任的准入。
- **A2.** 配置文件、信任集或其来源、吊销来源及其 URL 和凭据，以及租户，都来自运营方的代码和配置。请求的任何字段、请求头或工具参数都不能选择或更改它们。远程来源通过 TLS 获取（明文 HTTP 只用于回环主机），不跟随重定向，大小和时间都有限制。
- **A3.** 缓存可以（MAY）保存验证器的结果（第 5.1 节第 2 步），以规范已签名 bundle 的 SHA-256、规范有效验证器策略的 SHA-256 以及由运营方推导的租户为键，保存时间不超过其 TTL、`session_expires_at`、RPR 的 `expires_at` 以及每个密钥的 `expires_at` 中最早的那个。委托人信任、配置文件检查和吊销在每次准入时都在当前 `now`、用当前信任集和新的吊销快照进行评估。因此，缓存的接受结果绝不会在信任集变更、吊销、不同策略或不同租户之后仍然有效。

<a id="7-guarantees-and-limits"></a>

## 7. 保证与局限

在 `strict-v1` 下，被准入的 bundle：

- 按 V2-1 至 V2-14 通过验证，且每个签名的两个签名组件都有效；
- 用运营方信任集为该 `human_id` 列出的、在 `now` 时有效且处于有效期内的密钥为委托人签名（RPR 和清单，两个组件）；
- 在其已签名的 `intended_verifier` 中指明本验证器；
- 具有最长 `max_session_duration_seconds` 的已签名会话时间窗口，在 `now` 时已开始（在 `SKEW` 范围内）且未过期；
- 其代理和已验证签名者密钥被一份不早于 `max_revocation_age_seconds` 之前的吊销快照报告为未吊销。

它**不**保证：

- **一次性使用。** 共享的会话 nonce、受众和过期时间限制了 bundle 在何处、多长时间内可被重放；它们并不使其只能使用一次。需要一次性使用的验证器应自己记录已消费的 nonce 或 bundle 哈希；验证和准入不会消费它们。
- **对操作的授权。** `action_authorized` 始终为 `false`。准入表明证据真实且来自受信任的委托人；某个工具能否以给定参数运行是之后的阶段。
- **超出信任集的身份。** 信任的可靠程度恰好等于运营方的信任集及其来源。
- **比快照更新的吊销。** 在 `checked_at` 之后发生的吊销，要到下一份快照才能看到。

<a id="8-api-correspondence"></a>

## 8. API 对应关系

| 概念 | TypeScript（`@dcp-ai/sdk`） | Python（`dcp_ai.v2`） | Go（`dcp/v2`） | Rust（`dcp_ai::v2`） |
|---|---|---|---|---|
| 在 `now` 验证 | `verifySignedBundleV2(b, registry, policy, { now })` | `verify_signed_bundle_v2(b, registry, policy, now_ms=…)` | `VerifySignedBundleV2At(registry, json, policy, now)` | `verify_signed_bundle_v2_at(&b, &policy, now_ms)` |
| 签名者密钥（第 2.3 节） | `details.signer_keys` | `details["signer_keys"]` | `SignerKeys` | `V2VerificationDetails.signer_keys` |
| 加载信任集 | `createPrincipalTrustStore(json)` | `create_principal_trust_store(json)` | `NewPrincipalTrustStore(json)` | `PrincipalTrustStore::from_json(&json)` |
| 加载配置文件 | `resolveStrictV1Profile(json)` | `resolve_strict_v1_profile(json)` | `ResolveStrictV1Profile(json)` | `resolve_strict_v1_profile(&json)` |
| 吊销主体 | `revocationSubjects(b, verification)` | `revocation_subjects(b, verification)` | `RevocationSubjects(b, verification)` | `revocation_subjects(&b, &verification)` |
| 评估（不含密码学） | `evaluateAdmissionV2(input)` | `evaluate_admission_v2(…)` | `EvaluateAdmissionV2(…)` | `evaluate_admission_v2(…)` |
| 验证并评估 | `admitSignedBundleV2(b, registry, options)` | `admit_signed_bundle_v2(b, registry, …)` | `AdmitSignedBundleV2(registry, json, options)` | `admit_signed_bundle_v2(&b, &options)` |
| 配置错误 | `AdmissionConfigError`（`code`） | `AdmissionConfigError`（`code`） | `*AdmissionConfigError`（`Code`） | `AdmissionConfigError`（`code`） |

结果字段在每个 SDK 的 JSON 形式中都保留第 5.2 节的名称。

<a id="9-test-vectors"></a>

## 9. 测试向量

[`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json) 包含共享用例：已签名 bundle、信任集、配置文件、吊销快照、`now`，并为每个用例给出预期的 `verified`、`principal_trust`、`profile_compliance`、`admitted` 以及代码集合，同时注明所检查的规则。配置用例给出配置和预期的错误代码。每个 SDK 都会运行它们；标准不是 SDK 之间是否一致，而是预期值。

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 对 V2-1 至 V2-14 的引用指向 [VERIFICATION.md](../../VERIFICATION.md) 的规范性清单。在
  `main` 上，SDK 验证器不重新计算 V2-11 的二级 SHA3-256 链或根，因此“按 V2-1 至
  V2-14 通过验证”（第 7 节）在这一局限下成立：对于带有二级链的 bundle，所执行的审计链哈希检查
  是 SHA-256 链和根。其他所有验证检查、委托人信任以及所有 `strict-v1` 检查仍然
  适用；仅凭 SHA-256 链绝不会准入任何 bundle。
- 第 2.2、2.3、2.4 和 4.1 节中的 JSON 用于说明形式，其中的密钥和标识符使用占位符（`…`、`<kid>`）；
  它不是测试数据，也不能原样加载。第 2.4 节中的两个 `<kid>` 条目代表两个不同的真实
  kid：调整后的快照中没有重复的 JSON 键。共享的可运行用例见
  [`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json)（第 9 节）。
- 第 8 节的 API 位于 `main` 的 SDK 中，尚未包含在任何已发布的版本中。
