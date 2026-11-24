<sub>[English](../../../../../spec/profiles/multi-party/README.md) · **中文** · [Español](../../../../es/spec/profiles/multi-party/README.md) · [日本語](../../../../ja/spec/profiles/multi-party/README.md) · [Português](../../../../pt-BR/spec/profiles/multi-party/README.md)</sub>

<a id="multi-party-authorization-profile-mpa-v1"></a>

# 多方授权配置文件：`mpa-v1`

> 本文是[英文规范](../../../../../spec/profiles/multi-party/README.md)的参考译文，更新于 24/11/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 草案，v1
**范围：** 在运营方固定的策略下，一份多方授权是否为某个验证器授权对一个目标执行一项操作

---

<a id="1-purpose-and-layering"></a>

## 1. 目的与分层

多方授权（[`multi_party_authorization.schema.json`](../../../../../schemas/v2/multi_party_authorization.schema.json)）列出若干参与方对一项操作的复合签名。它本身不作任何决定：其中的 `required_parties` 没有被签名，每个角色都由为它签名的参与方自己写入，而且其中没有任何内容说明哪些参与方可以代表该操作的对象、这份授权可以在哪里使用、可以用到什么时候。

`mpa-v1` 是一个选择性启用的配置文件，使它能够作出决定。它既不改变记录的 schema，也不改变参与方签名的内容。它增加：

1. `operation_payload` 内的**已签名请求**（第 2.2 节）：目标、受众和有效期窗口。它们是参与方本来就要签名的内容的一部分，因此每个参与方都为它们签名。
2. **运营方的策略**（第 2.3 节）：对每个目标，列出其参与方及角色；对每项操作，规定需要多少参与方、需要哪些角色。
3. **运营方持有的参与方密钥**（第 2.4 节）：[准入配置文件](../../../../../spec/profiles/admission/README.md)的委托人信任集。

三个问题分开处理，只有第三个给出 `authorized`：

| 层 | 问题 | 读取自 |
|---|---|---|
| 结构 | 记录的形式是否正确？ | 仅记录本身 |
| 验证 | 哪些参与方恰好为这个请求签了名？ | 运营方为每个参与方信任的密钥 |
| 授权 | 执行方现在是否可以对这个目标执行这项操作？ | 运营方的策略，以及执行方即将要做的事 |

仅对结构的检查（第 8 节）不验证任何签名，也不授权任何事情。

没有请求的记录仍然是有效的 v2.0 记录。它在本配置文件下永远不会被授权：没有旧版模式。

<a id="2-inputs"></a>

## 2. 输入

<a id="21-clock"></a>

### 2.1 时钟

一个时刻 `now`，单位为自 Unix 纪元以来的毫秒数，作为参数接收，默认为系统时钟。时间戳是带 `Z` 或 `±hh:mm` 偏移的 RFC 3339，以毫秒精度比较，与准入配置文件相同。时钟偏差容限为 30 秒，只适用于 `issued_at`。

<a id="22-the-request"></a>

### 2.2 请求

在 `mpa-v1` 下，`operation_payload` 恰好有两个成员。Schema：[`multi_party_request.schema.json`](../../../../../schemas/v2/multi_party_request.schema.json)。

```json
{
  "request": {
    "profile": "mpa-v1",
    "request_id": "mpa:6f1c0a52d3b84e7f9a1c2d3e4f506172",
    "target": "agent:acme-bot",
    "audience": "verifier:acme-gateway",
    "issued_at": "2026-11-18T00:00:00Z",
    "expires_at": "2026-11-18T00:30:00Z"
  },
  "parameters": { "reason": "key_compromise" }
}
```

- `request` 恰好有这六个成员。`request_id` 为 1 至 128 个字符；`target` 和 `audience` 为 1 至 256 个字符。长度按 Unicode 码点计算。
- `target` 按运营方策略中的名称指明操作的对象。`audience` 指明可以依据这份授权行事的验证器。
- `parameters` 是一个对象：操作自身的参数，没有参数时为空。
- `operation_payload` 中的每个数值，按最接近的 binary64 读取后，都是 -(2^53 - 1) 至 2^53 - 1 之间的整数，即 binary64 能精确保存的整数。`1.0` 和 `1e2` 是这样的整数，binary64 无法与这样的整数区分的字面量也是。超出这个范围时，把 JSON 数值读作 binary64 的实现与精确读取的实现会为同一份记录写出不同的 `dcp-jcs-v1` 文本，对一个整数的签名就会对相邻的整数同样有效。更大的值（例如 64 位标识符）放在字符串中。
- `operation_payload` 中的每个字符串（包括成员名）都是格式良好的 Unicode 文本：没有不成对的代理项（无论是否以转义形式书写），也没有不是 UTF-8 的字节。除此之外的内容，各实现的读取结果并不一致：有的在该位置放入 U+FFFD，有的则无法读取。
- `operation_payload` 最多嵌套 32 层，它自身是第 1 层，`parameters` 是第 2 层。

参与方签名的内容不变：`UTF8("DCP-AI.v2.MultiPartyAuth") || 0x00 || dcp-jcs-v1({operation, operation_payload, party_id, role})`。经典签名覆盖这些字节，后量子签名覆盖这些字节后接经典签名。

<a id="23-policy-set"></a>

### 2.3 策略集

只由运营方提供：本地配置或运营方选定的来源。它不得（MUST NOT）从记录、请求或工具参数，或请求可以写入的注册表推导得出。Schema：[`multi_party_policy_set.schema.json`](../../../../../schemas/v2/multi_party_policy_set.schema.json)。

```json
{
  "policy_set_version": "2026-11-18.1",
  "profile": "mpa-v1",
  "audience": "verifier:acme-gateway",
  "max_validity_seconds": 1800,
  "subjects": [
    {
      "target": "agent:acme-bot",
      "parties": [
        { "party_id": "human:alice", "role": "owner" },
        { "party_id": "human:bob", "role": "org_admin" },
        { "party_id": "human:carol", "role": "recovery_contact" }
      ],
      "operations": {
        "revoke_agent": {
          "required_parties": 2,
          "allowed_roles": ["owner", "org_admin", "recovery_contact"],
          "required_roles": ["owner"]
        }
      }
    }
  ]
}
```

策略集在加载时验证。出现下列情况时，以表中的配置代码拒绝：

| 条件 | 代码 |
|---|---|
| 任一层级出现 schema 之外的字段 | `CONFIG_UNKNOWN_FIELD` |
| `policy_set_version` 缺失或为空；`profile` 不是 `mpa-v1`；`audience` 不是 1 至 256 个字符的字符串；`max_validity_seconds` 不是 1 至 86400 的整数；角色或操作不在列表之内；`parties` 为空；`allowed_roles` 为空或有重复的角色；`required_parties` 小于 2；`required_roles` 不在 `allowed_roles` 之中 | `CONFIG_INVALID_VALUE` |
| 同一个目标列出两次，或同一个目标下同一个参与方列出两次 | `CONFIG_MPA_DUPLICATE` |
| `required_parties` 大于具有允许角色的参与方数量，或大于 16（一份记录最多容纳的授权数）；或某个必需角色没有任何这样的参与方持有 | `CONFIG_MPA_UNSATISFIABLE` |

当一个策略集存在其中多个问题时，可以报告其中任意一个的代码。

没有默认值。运营方没有为某个目标列出的操作不会被授权；没有主体的策略集是有效的，但不授权任何事情。一个参与方在每个目标上只有一个角色。

<a id="24-trust-set"></a>

### 2.4 信任集

参与方的密钥来自运营方的委托人信任集（[准入配置文件第 2.2 节](../../../../../spec/profiles/admission/README.md#22-trust-set)），由同一个验证程序加载：参与方就是该信任集中的一个 `human_id`。kid 由其密钥推导得出，列出两次的 kid 会在信任集加载时被拒绝（`CONFIG_TRUST_DUPLICATE`）。因此，一个密钥不能归属于两个参与方，一个签名者也不能被计数两次。评估只接受已经加载成功的信任集。

两者分别加载。策略中有而信任集中没有的参与方不属于配置错误：其签名会得到 `MPA_KEY_NOT_ANCHORED`。

<a id="3-what-the-executor-states"></a>

## 3. 执行方声明的内容

执行方给出它即将执行的操作、目标和参数。它们必须是列表中的一项操作、1 至 256 个字符且为格式良好文本的目标，以及属于 §2.2 所述数据的对象：数值在其范围内，文本格式良好，并且由于 `parameters` 是 `operation_payload` 的第 2 层，最多嵌套 31 层。否则，调用会作为配置错误（`CONFIG_INVALID_VALUE`）被拒绝，不给出任何结果。授权必须恰好针对这些内容。

<a id="4-evaluation"></a>

## 4. 评估

共五个阶段。某个阶段添加了代码，后面的阶段就不再进行，因此形式错误、针对别处或已过期的请求，其签名一个也不会被验证。第一阶段按下面的顺序在第一个失败处停止；其余阶段添加所有适用的代码。评估是严格的：只要有一个授权失败，记录就会被拒绝，即使其余授权已经达到阈值。

| 阶段 | 检查 | 代码 |
|---|---|---|
| 1. 结构 | 记录符合其 schema | `MPA_SCHEMA_INVALID` |
| | `operation_payload` 有 `request` 成员 | `MPA_REQUEST_MISSING` |
| | `operation_payload` 符合第 2.2 节，时刻为 RFC 3339 | `MPA_REQUEST_INVALID` |
| | `operation_payload` 是 §2.2 所述的数据（数值在其范围内，文本格式良好，最多嵌套 32 层），并且可以用 `dcp-jcs-v1` 表示 | `MPA_NOT_REPRESENTABLE` |
| | 最多 16 个授权 | `MPA_TOO_MANY_AUTHORIZATIONS` |
| 2. 绑定 | `operation` 是执行方声明的操作 | `MPA_OPERATION_MISMATCH` |
| | `request.target` 是执行方声明的目标 | `MPA_TARGET_MISMATCH` |
| | `parameters` 是执行方声明的参数，以规范形式比较 | `MPA_PARAMETERS_MISMATCH` |
| | `request.audience` 是策略集的 `audience` | `MPA_AUDIENCE_MISMATCH` |
| | `issued_at` 不晚于 `now` 加上容限 | `MPA_NOT_YET_VALID` |
| | `expires_at` 晚于 `now` | `MPA_EXPIRED` |
| | `expires_at` 晚于 `issued_at`，且相差不超过 `max_validity_seconds` | `MPA_VALIDITY_INVALID` |
| | 策略集有针对 `request.target` 的主体 | `MPA_TARGET_UNKNOWN` |
| | 该主体列出了这项操作 | `MPA_OPERATION_NOT_ALLOWED` |
| 3. 参与方 | 每个 `party_id` 都是该主体的参与方 | `MPA_PARTY_UNKNOWN` |
| | 每个 `party_id` 只出现一次 | `MPA_PARTY_DUPLICATE` |
| | 已签名的角色就是运营方赋予该参与方的角色 | `MPA_ROLE_MISMATCH` |
| | 该角色被允许用于这项操作 | `MPA_ROLE_NOT_ALLOWED` |
| 4. 验证 | 绑定为 `pq_over_classical`，经典槽位中是经典算法，另一个槽位中是后量子算法 | `MPA_HYBRID_REQUIRED` |
| | 每个 kid 都是信任集中该参与方采用该算法的密钥 | `MPA_KEY_NOT_ANCHORED` |
| | 该密钥在 `now` 时未被吊销、未过期且已经生效 | `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID` |
| | 两个签名都是规范 base64，并且对第 2.2 节的字节验证通过 | `MPA_SIGNATURE_INVALID` |
| 5. 决定 | 至少有策略规定的 `required_parties` 个参与方作出了授权 | `MPA_THRESHOLD_NOT_MET` |
| | `required_roles` 中的每个角色都由某个作出授权的参与方持有 | `MPA_REQUIRED_ROLE_MISSING` |

- 记录中的 `required_parties` 没有被签名，永远不会被读取。
- 在第 3 阶段，起作用的角色是运营方给出的角色：已签名的角色与之不同时为 `MPA_ROLE_MISMATCH`，运营方给出的角色不被允许用于这项操作时为 `MPA_ROLE_NOT_ALLOWED`。两者可以同时适用。未知的参与方只得到 `MPA_PARTY_UNKNOWN`，不再有其他代码。
- 在第 4 阶段，每个密钥得到下列情况中第一个适用的：未锚定、已吊销、已过期（`status` 为 `expired`，或 `expires_at` 早于 `now`）以及尚未生效（`not_before` 晚于 `now`）。只有两个密钥都可以计数时，才验证签名。
- 第 4 阶段的算法是本配置文件自己的：经典组件为 `ed25519`，另一个组件为 `ml-dsa-65` 或 `slh-dsa-192f`。它们不从可能变化的验证策略中读取。
- 时间点以毫秒比较：小数部分第三位之后的数字被舍弃，分辨率更高的 `now` 被截断。

<a id="5-result"></a>

## 5. 结果

<a id="51-verdicts"></a>

### 5.1 结论

`structure` 为 `valid` 或 `invalid`。`verification` 为 `verified`、`failed`，或在没有到达第 4 阶段时为 `not_evaluated`。只有在没有任何阶段添加代码时，`authorized` 才为真。

<a id="52-fields"></a>

### 5.2 字段

| 字段 | 值 |
|---|---|
| `profile` | `"mpa-v1"` |
| `structure`, `verification`, `authorized` | 第 5.1 节 |
| `operation`, `target`, `request_id`, `expires_at` | 形式正确的记录中已签名的值，否则为 null |
| `parties` | 每个授权一项：`party_id`、`role`（已签名的角色）和 `verified`（没有到达第 4 阶段时为 null） |
| `parties_counted` | 在第 4 阶段没有任何代码的授权数；没有到达该阶段时为 null |
| `required_parties` | 运营方的阈值；没有找到针对该目标上该操作的规则时为 null |
| `policy_set_version`, `trust_set_version` | 所用配置的版本 |
| `errors` | 按阶段顺序排列的 `{ code, message }`；同一阶段内不规定顺序 |

<a id="53-codes"></a>

### 5.3 代码

| 代码 | 阶段 |
|---|---|
| `MPA_SCHEMA_INVALID`, `MPA_REQUEST_MISSING`, `MPA_REQUEST_INVALID`, `MPA_NOT_REPRESENTABLE`, `MPA_TOO_MANY_AUTHORIZATIONS` | 1 |
| `MPA_OPERATION_MISMATCH`, `MPA_TARGET_MISMATCH`, `MPA_PARAMETERS_MISMATCH`, `MPA_AUDIENCE_MISMATCH`, `MPA_NOT_YET_VALID`, `MPA_EXPIRED`, `MPA_VALIDITY_INVALID`, `MPA_TARGET_UNKNOWN`, `MPA_OPERATION_NOT_ALLOWED` | 2 |
| `MPA_PARTY_UNKNOWN`, `MPA_PARTY_DUPLICATE`, `MPA_ROLE_MISMATCH`, `MPA_ROLE_NOT_ALLOWED` | 3 |
| `MPA_HYBRID_REQUIRED`, `MPA_KEY_NOT_ANCHORED`, `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID`, `MPA_SIGNATURE_INVALID` | 4 |
| `MPA_THRESHOLD_NOT_MET`, `MPA_REQUIRED_ROLE_MISSING` | 5 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_MPA_DUPLICATE`, `CONFIG_MPA_UNSATISFIABLE` | 在加载策略集时抛出，或针对执行方声明的内容（第 3 节）抛出 |
| `CONFIG_TRUST_*` | 在加载信任集时抛出（准入配置文件第 2.2 节） |

消息最长 300 个字符，绝不包含私钥或令牌。但代码、消息和 `required_parties` 确实会说明运营方策略的要求（阈值、角色、最长有效期）：见第 6 节的 A4。

<a id="6-adapters"></a>

## 6. 适配器

核心函数是确定性的，不发起任何网络调用，也不保存状态。适配器（服务器、工具、中间件）解析运营方的配置，并执行决定：

- **A1.** 只有当 `authorized` 为真时才执行操作，而且执行的就是交给评估的那项操作、那个目标和那些参数。
- **A2.** 策略集、信任集、它们的来源、受众以及租户，都来自运营方的代码和配置。请求的任何字段、请求头或工具参数都不能选择或更改它们。
- **A3.** 非幂等的操作只能使用一次，这一点由适配器负责保证（第 7 节）。
- **A4.** 结果会说明运营方策略的要求。适配器只把结果返回给运营方允许了解这些内容的调用方；对其他调用方，至多返回操作是否已获授权。

<a id="7-guarantees-and-limits"></a>

## 7. 保证与局限

当 `authorized` 为真时：

- 每个授权都由不同的参与方签名，两个组件俱全，所用密钥是运营方信任集为该参与方列出的、在 `now` 时可用的密钥；
- 每个参与方在该目标上持有它所签名的角色，并且运营方允许该角色用于这项操作；
- 作出授权的参与方数量不少于运营方对该目标上这项操作的要求，并且必需角色在其中；
- 它们全都在运营方接受的时间窗口内，为本验证器，对执行方声明的操作、目标和参数签了名。

它**不**保证：

- **一次性使用。** 评估不保存状态，也不消费 `request_id`：对同一请求的两次评估，包括同时进行的评估，都会给出 `authorized`。操作不是幂等的执行方应记录已消费的 `request_id`，直到 `expires_at`，并以原子方式完成消费和执行：在同一个事务中进行，或者在执行之前预留该标识符，预留已经存在时不执行。先检查、后记录的做法会让两次并发的执行都通过。
- **被授权的就是被执行的。** 执行方声明它即将要做的事；恰好只做这件事是执行方自己的责任。
- **超出配置的身份。** 决定的可靠程度恰好等于运营方的信任集、策略集及其来源。
- **参与方的能力或独立性。** 两个密钥不等于两个人，一个签名也不能说明有任何内容被审查过。
- **比已加载的信任集更新的吊销。**

<a id="8-api-correspondence"></a>

## 8. API 对应关系

| 概念 | TypeScript（`@dcp-ai/sdk`） | Python（`dcp_ai.v2`） | Go（`dcp/v2`） | Rust（`dcp_ai::v2::multi_party_auth`） |
|---|---|---|---|---|
| 检查结构 | `checkMultiPartyAuthorizationStructure(record, policy?)` | `check_multi_party_authorization_structure(record, policy=None)` | `CheckMultiPartyAuthorizationStructure(record, policy)` | `check_multi_party_authorization_structure(&record, policy)` |
| 加载策略集 | `createMultiPartyPolicyStore(json)` | `create_multi_party_policy_store(json)` | `NewMultiPartyPolicyStore(json)` | `MultiPartyPolicyStore::from_json(&json)` |
| 评估 | `evaluateMultiPartyAuthorization(record, registry, { policy, trust, expected, now? })` | `evaluate_multi_party_authorization(record, registry, policy=…, trust=…, expected=…, now_ms=…)` | `EvaluateMultiPartyAuthorization(registry, json, options)` | `evaluate_multi_party_authorization(&record, &options)` |
| 构建请求 | `createMultiPartyRequest(input)` | `create_multi_party_request(…)` | `NewMultiPartyRequest(input)` | `create_multi_party_request(&input)` |
| 作为参与方签名 | `createPartyAuthorization(…)` | `create_party_authorization(…)` | `CreatePartyAuthorization(…)` | `create_party_authorization(…)` |
| 配置错误 | `MultiPartyConfigError`（`code`） | `MultiPartyConfigError`（`code`） | `*MultiPartyConfigError`（`Code`） | `MultiPartyConfigError`（`code`） |

结果字段在每个 SDK 的 JSON 形式中都保持第 5.2 节的名称。

结构检查对照它自己的形式策略，查看授权的数量、它们的角色以及是否存在 `composite_sig`。它不验证任何签名，不认识任何参与方，也不读取运营方的任何策略。在 Python、Go 和 Rust 中，它曾以 `verify_multi_party_authorization` / `VerifyMultiPartyAuthorization` 的名称发布；该名称已弃用，结果相同。

<a id="9-test-vectors"></a>

## 9. 测试向量

[`tests/interop/v2/multi_party_vectors.json`](../../../../../tests/interop/v2/multi_party_vectors.json) 保存共享的用例：记录、信任集、一个策略集、执行方声明的内容、`now`，以及每个用例预期的 `authorized`、`structure`、`verification`、`parties_counted`、`required_parties` 和代码集合，并附有它所检查的规则。配置用例给出一个策略集或一个信任集，以及预期的代码。每个 SDK 都运行这些用例；判断标准不是各 SDK 之间一致，而是预期值。[`generate-multi-party-vectors.mjs`](../../../../../tests/interop/v2/generate-multi-party-vectors.mjs) 写出该文件，并用它自己的、不使用 SDK 代码编写的评估器检查每一项预期。

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 11 月 18 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- **在哪里实现。** `main` 上的四个 SDK 实现了本配置文件。已发布的版本都不包含它：已发布的 TypeScript SDK 只导出记录的类型，已发布的 Python、Go 和 Rust SDK 只有结构检查，并且使用原来的名称。
- **参考服务器。** `POST /v2/multi-party/authorize` 在运营方的策略集（`DCP_MULTI_PARTY_POLICY_FILE`）下应用本配置文件，没有策略集时不存在。它只应答运营方令牌，并且不执行任何操作：参见 [server/README.md](../../../../../server/README.md)。
- **没有任何操作会消费授权。** 本仓库中没有任何代码依据多方授权执行 `revoke_agent`、`rotate_org_key`、`change_jurisdiction` 或 `modify_recovery_config`。配置文件作出决定，适配器负责执行。
- **谁审查了向量。** 生成器的评估器和四个实现出自同一作者。它们相互一致并不构成独立审查。
