<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-aiopenclaw--dcp-integration-for-openclaw"></a>
<a id="dcp-aiopenclaw-dcp-integration-for-openclaw"></a>

# @dcp-ai/openclaw — 面向 OpenClaw 的 DCP 集成

> 本文是[英文版](README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

为 AI 代理添加 **Digital Citizenship Protocol (DCP)** 工具的 [OpenClaw](https://github.com/openclaw/openclaw) 插件。当代理调用这些工具时，操作会被声明、进行风险评分，
并记录在与人类所有者绑定、以哈希链连接的审计轨迹中：插件不会
拦截代理的其他工具。要管控每个敏感操作，宿主必须自己拦截这些工具调用，
并在其前后调用 `dcp_declare_intent` / `dcp_log_action`。会话状态保存在内存中的 `Map` 里，
进程重启时会丢失。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，部分支持：下面的工具会创建采用这些规范形式的记录，
`dcp_verify_bundle` 会验证 bundle。它并未完整实现这些规范。

<a id="features"></a>

## 功能

- **身份（DCP-01）** — 生成 Ed25519 密钥对、Responsible Principal Record、Agent Passport
- **意图声明（DCP-02）** — 在敏感操作之前进行风险评分并给出策略决定，由宿主执行
- **审计轨迹（DCP-03）** — 带证据引用、以哈希链连接的操作记录：可发现篡改（被修改的条目会破坏链），并非不可变，且保存在内存中
- **生命周期（DCP-05）** — 启用代理、报告活力、停用代理
- **继承（DCP-06）** — 带继任者偏好和记忆分类的数字遗嘱
- **委托（DCP-09）** — 创建委托授权，将权限从人转移给代理
- **bundle 验证** — V2 Signed Bundle 由 SDK 的 `verifySignedBundleV2` 在运营方的验证器策略下验证（签名、哈希、会话绑定、审计链、密钥有效性）
- **bundle 签名** — 在会话结束时构建并签名 CitizenshipBundle：一个意图及其策略决定，加上会话的审计条目（见[风险评分](#risk-scoring)下的说明）
- **DCP-05 至 DCP-09 的记录** — 启用、活力、停用、遗嘱和授权的记录保存在会话状态中；`dcp_sign_bundle` 不会把它们加入 bundle，插件也不会把它们发送到任何地方
- **SKILL.md** — 教代理如何使用 DCP 工具的配套技能

<a id="installation"></a>

## 安装

**已发布到 npm（2026 年 10 月 26 日）。** `@dcp-ai/openclaw` 2.1.0 的标签为 `latest`，依赖 `@dcp-ai/sdk` `^2.2.0`。以下描述的功能已可从 npm 获取。

**请从 2.0.0 升级：** 该版本仅检查 V2 结构，不验证签名。请使用 2.1.0 获取修复后的验证器、准入和来源监管功能。见 [SECURITY.md](../../SECURITY.md)。

```bash
npm install @dcp-ai/openclaw@^2.1.0
```

所有软件包版本见 [npm 发布清单](../../docs/NPM_RELEASES.md)。

如需使用检出源码进行开发，请构建并安装本地软件包：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/openclaw
npm ci && npm run build
# then, in your project (or OpenClaw plugins directory):
npm install /path/to/dcp-ai/integrations/openclaw
```

加入 OpenClaw 配置：

```yaml
plugins:
  - "@dcp-ai/openclaw"
```

<a id="tools-registered"></a>

## 注册的工具

| 工具 | 说明 | DCP 规范 |
|------|-------------|----------|
| `dcp_identity_setup` | 生成密钥对 + RPR + AgentPassport | DCP-01 |
| `dcp_declare_intent` | 声明意图，获取策略决定（approve/escalate/block） | DCP-02 |
| `dcp_verify_bundle` | 用 SDK 验证器验证 Signed Bundle（签名 + 哈希 + 会话绑定） | VERIFICATION |
| `dcp_log_action` | 将操作记录为以哈希链连接的 AuditEntry | DCP-03 |
| `dcp_get_audit_trail` | 获取会话审计轨迹 | DCP-03 |
| `dcp_commission_agent` | 启用代理（生命周期 → commissioned） | DCP-05 |
| `dcp_report_vitality` | 报告活力指标，获取计算出的评分 | DCP-05 |
| `dcp_decommission_agent` | 停用代理（graceful/immediate/emergency） | DCP-05 |
| `dcp_create_testament` | 创建带继任者偏好的数字遗嘱 | DCP-06 |
| `dcp_create_mandate` | 创建从人到代理的委托授权 | DCP-09 |
| `dcp_sign_bundle` | 根据会话状态构建并签名 CitizenshipBundle | BUNDLE |

<a id="usage-flow"></a>

## 使用流程

```
┌─────────────────────────────────────────────────────┐
│                  Session Start                       │
│  dcp_identity_setup(owner, jurisdiction, caps)       │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼─────────────┐
          │   For each sensitive      │
          │   action:                 │
          │                           │
          │  1. dcp_declare_intent()  │
          │     → approve/escalate/   │
          │       block               │
          │                           │
          │  2. [perform action]      │
          │                           │
          │  3. dcp_log_action()      │
          └────────────┬─────────────┘
                       │ (repeat)
          ┌────────────▼─────────────┐
          │     Session End           │
          │  dcp_sign_bundle()        │
          │  → SignedBundle           │
          └───────────────────────────┘
```

<a id="architecture"></a>

## 架构

```
integrations/openclaw/
├── package.json               # Dependencies: @dcp-ai/sdk, @sinclair/typebox
├── tsconfig.json
├── SKILL.md                   # Companion skill with agent instructions
├── README.md                  # This file
└── src/
    ├── index.ts               # Plugin entry — registerTool() calls
    ├── tools/
    │   ├── identity.ts        # dcp_identity_setup
    │   ├── intent.ts          # dcp_declare_intent
    │   ├── verify.ts          # dcp_verify_bundle
    │   ├── audit.ts           # dcp_log_action + dcp_get_audit_trail
    │   ├── lifecycle.ts       # dcp_commission_agent + dcp_report_vitality + dcp_decommission_agent
    │   ├── succession.ts      # dcp_create_testament
    │   └── delegation.ts      # dcp_create_mandate
    └── state/
        └── agent-state.ts     # Per-session DCP state management
```

<a id="bundle-verification"></a>

## bundle 验证

<a id="policy-set-by-the-operator-tightened-by-the-model"></a>

### 策略：由运营方设置，由模型收紧

`dcp_verify_bundle` 的验证器策略属于运营方：除非宿主通过 `register(api, { verifierPolicy })` 或 `configureVerifier({ verifierPolicy })` 设置其他策略，否则就是 SDK 的 `DEFAULT_VERIFIER_POLICY`（在默认策略之上设置字段；不带 `risk_overrides` 的 `default_mode` 适用于所有风险等级；未知字段或错误类型会抛出异常）。

```typescript
import register, { configureVerifier } from '@dcp-ai/openclaw';

configureVerifier({ verifierPolicy: { default_mode: 'hybrid_required', require_audience_binding: true, verifier_id: 'my-service' } });
```

工具的 `verifier_policy` 参数由调用它的模型设置，因此只能让该策略更严格：`default_mode` 会将每个风险等级至少提升到该模式（`classical_only` < `hybrid_preferred` < `hybrid_required`；`pq_only` 与任何其他模式组合得到 `hybrid_required`，因为 `pq_only` 省去了其他模式要求的经典签名），`require_session_binding` 和 `require_composite_binding` 只能开启，`allow_v1_bundles` 只能关闭。任何其他字段都是错误。

<a id="what-is-checked"></a>

### 检查哪些内容

- **V2**：使用 `@dcp-ai/sdk` 的 `verifySignedBundleV2`，配合 Ed25519 / ML-DSA-65 / SLH-DSA-192f 注册表和上述策略。它检查工件载荷哈希和清单；会话绑定、到期和已签名的会话开始时间（`session_issued_at`）；委托人用 RPR 的 `binding_keys` 对清单所做的 bundle 签名，以及必须与之一致的未签名 `signature` 块；每个工件自己的签名；验证模式，即护照 `risk_tier` 的策略模式与意图和策略决定的安全等级模式两者中更严格的一个（spec §14.2）；PQ 检查点；工件间一致性（护照状态、RPR 到期、各工件和审计条目中只有一个代理、委托人和意图）；审计哈希链（使用 `@dcp-ai/sdk` 2.2.0 时只有 SHA-256；当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时，也会检查存在的 V2-11 二级 SHA3-256 字段）；以及密钥有效性、kid 推导和规范 base64 密钥（`spec/VERIFICATION.md` V2-1 至 V2-14）。
- **V1**（一个 Ed25519 签名）：仅当 VERIFICATION.md 的 V2-10 会接受纯经典 bundle 时，才用 `verifySignedBundle` 验证：`allow_v1_bundles` 为 true，并且 V1 护照 `risk_tier` 的策略模式与 V1 意图及策略决定的安全等级模式（V1 的 `risk_score` 在 0 到 1 之间，乘以 1000；缺失时按 `elevated` 处理）两者中更严格的一个是 `classical_only` 或 `hybrid_preferred`。在默认策略下，routine 或 standard 的 V1 意图可以通过；支付、敏感数据、高预估影响或不低于 0.5 的风险评分会被拒绝。
- 无法识别版本的 bundle 会被拒绝。

对 V1 bundle 只应用 `allow_v1_bundles`、模式和等级：受众绑定、会话到期和时长限制、不含 Ed25519 的
`accepted_classical_algs` 以及拒绝 Ed25519 的公告都是 V2 检查，通过模式检查的 V1 bundle 即使设置了它们也会被接受。
如果你需要这些控制，请设置
`allow_v1_bundles: false`，或使用受信任的委托人配合 strict-v1 配置文件。

结果包含验证器的 `errors` 和 `warnings`、`resolved_tier`（安全等级），对 V2 还有 `verification_mode`。`agent_id`、`human_id` 和 `session_nonce` 只对已验证的 bundle 返回。

<a id="what-verified-means"></a>

### “已验证”意味着什么

已验证的 bundle 在内部一致，并由它自己列出的密钥签名：bundle 签名用 RPR 的 `binding_keys`，代理的工件用护照密钥。它不能证明委托人是谁：任何人都可以生成密钥并创建一个声称任意 `human_id` 的 RPR。为此请配置受信任的委托人（下一节）。已验证的 bundle 也可能在会话过期前被重放；运营方策略中带 `verifier_id` 的 `require_audience_binding`（bundle 的 `manifest.intended_verifier` 必须指向它）以及 `require_session_expiry` / `max_session_duration_seconds` 会限制这一点，但不会使其只能使用一次。

<a id="trusted-principals-and-strict-v1"></a>

### 受信任的委托人与 strict-v1

```typescript
import { configureVerifier, denyListRevocationSource } from '@dcp-ai/openclaw';

configureVerifier({
  trustedPrincipals: trustSet,                     // or () => trust set, read on every call
  profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
});
```

使用 `trustedPrincipals` 时，结果会增加 `admitted`、`principal_trust`、`profile`、`profile_compliance`、`codes`、`recorded_decision`、`trust_set_version` 和 `action_authorized`（始终为 `false`），并且只对通过准入的 bundle 给出代理和委托人（`docs/ADMISSION.md`、`spec/profiles/admission`）。`verified` 保持其含义，即验证器的判定。在配置文件下，模型的 `verifier_policy` 参数会被拒绝，即使是更严格的也一样，工具未定义的参数（信任集、受众、吊销快照）会被忽略。遇到矛盾（带 `verifierPolicy` 的配置文件，或没有受信任的委托人或吊销来源的配置文件）时，`configureVerifier` 抛出 `AdmissionConfigError` 并保留之前的配置。抛出异常或返回 `undefined`、`null` 或无效信任集的 `trustedPrincipals` 函数会得到 `admitted: false`，原因在 `errors` 中；工具不会抛出异常。可运行示例：`examples/strict-v1.mjs`。

测试会运行 `tests/interop/v2/bundle_vectors.json` 中的每个用例，每个都在运营方策略及其 `verifier_policy_overrides` 下进行。

<a id="supervising-the-trust-source"></a>

### 监管信任来源

```typescript
import { configureVerifier, createSourceSupervisor } from '@dcp-ai/openclaw';

const supervisor = createSourceSupervisor({ maxInFlight: 16 });
configureVerifier({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
});
```

**期限、容量和范围。**

- 函数接收 `{ tenant, signal }`。在 `trustTimeoutMs`（1 到 2147483647 的整数）之后到达的信任集不会被使用，到达时以单调时钟测量。此时调用得到与失败来源相同的 `admitted: false`（`The trusted principals are unavailable (TRUST_SOURCE_FAILED)`）。
- 最多同时运行 `maxInFlight` 个调用，没有队列。**只有当函数真正完成时才会释放位置**：永不完成的来源会一直占用其位置，直到进程重启。
- 容量按监管器对象计算，可以共享由 `@dcp-ai/express` 创建的监管器，无论 ESM 还是 CJS。
- 没有其他待处理工作的 Node 进程会一直存活，直到期限给出答复。
- 在 strict-v1 配置文件下，`supervise: { revocation: true }` 会在同一监管器下运行 `revocationSource`，以 `revocationTimeoutMs` 为期限（此时为 1 到 2147483647 的整数）。`supervise` 接受 `trustTimeoutMs`、`revocation: true` 或两者，`revocation: true` 也适用于静态信任集。
  - 来源接收 `(subjects, { tenant, signal })`，每个答案给出的结果与不监管时相同。
  - `null`、失败、超时、没有空闲位置以及已关闭的监管器都会得到带 `codes: ["REVOCATION_UNAVAILABLE"]` 的 `admitted: false`。`REVOCATION_INVALID` 只在期限之前才算数。
  - 信任和吊销调用共享监管器的位置。
  - 当监管器的 `signal` 中止时，`denyListRevocationSource` 也会中止其 fetch。
  - 没有它时，吊销与以前一样使用 `revocationTimeoutMs`。

**重新配置。**

- `configureVerifier` 可以在使用新的信任集、配置文件、期限或来源选择时保留同一个监管器：其计数器保持不变，调用保留开始时的期限。
- 当它会替换或移除一个仍有进行中调用的监管器时（无论该监管器监管哪个来源），它会抛出 `AdmissionConfigError`（`CONFIG_PROFILE_CONTRADICTION`）并保留之前的配置。调用从 `executeVerifyBundle` 开始的那一刻起就算数，因此在它仍在验证 bundle、尚未调用来源时也算数，其位置一直算到来源完成为止。即使 `supervisor.close({ drainMs })` 在仍有调用进行中时已经返回，也是如此：关闭会拒绝新调用，但不会释放任何位置。请在 `supervisor.stats().inFlight` 为 0 时替换它，或重启进程。
- 模型的参数无法设置其中任何一项。

**取消。**

- 此版本的监管器还提供取消能力，由 `@dcp-ai/express` 的 `cancelOnDisconnect` 使用。
- `dcp_verify_bundle` 没有这样的选项：它的宿主不会给出调用方已离开的信号，`configureVerifier({ cancelOnDisconnect })` 会作为未知选项抛出异常。
- 为兼容旧软件包的监管器，`stats().cancelled` 在类型中是可选的：请按 `?? 0` 读取。

**它不做的事。** 与 `@dcp-ai/express` 中的限制相同：

- 它不会停止函数的工作，不限制函数自行启动的工作，也不隔离观察者或来源的 CPU；
- `onSourceEvent` 必须很快；一次只有一个调用，其余的会被丢弃并计数。它返回的 promise 或 thenable 会像 `Promise.resolve` 那样被同化，因此以待定 promise 完成的 thenable 会让它保持忙碌。thenable 启动但不返回的 promise 无法触及。
- 计数器在 `Number.MAX_SAFE_INTEGER` 处停止。

<a id="concept-mapping-openclaw--dcp"></a>
<a id="concept-mapping-openclaw-dcp"></a>

## 概念映射：OpenClaw → DCP

| OpenClaw 概念 | DCP 对应物 |
|---|---|
| 所有者（人） | `ResponsiblePrincipalRecord` |
| 代理会话 | `AgentPassport`（能力由允许的工具映射而来） |
| 工具调用 | `Intent`（action_type 由工具名推导） |
| 工具允许列表/拒绝列表 | `PolicyDecision` |
| DM 配对 | `HumanConfirmation` |
| 代理操作 | 以哈希链连接的 `AuditEntry` |

<a id="openclaw-tool--dcp-action-type-mapping"></a>
<a id="openclaw-tool-dcp-action-type-mapping"></a>

## OpenClaw 工具 → DCP 操作类型映射

| OpenClaw 工具 | DCP `action_type` | DCP `channel` |
|---|---|---|
| `browser.*` | `browse` | `web` |
| `exec`, `bash` | `execute_code` | `runtime` |
| `web.fetch`, `web.search` | `api_call` | `api` |
| `write`, `edit`, `apply_patch` | `write_file` | `filesystem` |
| `sessions_send` | `api_call` | `api` |
| `cron`, `webhook` | `api_call` | `api` |

<a id="risk-scoring"></a>

## 风险评分

意图声明工具根据以下内容计算风险评分：

- **操作类型** — 支付和代码执行的评分高于浏览
- **预估影响** — 低 / 中 / 高
- **数据类别** — 个人数据、凭据和财务数据会提高评分

策略决定：

- **approve**（风险 < 500）— 正常进行
- **escalate**（500 ≤ 风险 < 800）— 请人确认
- **block**（风险 ≥ 800）— 操作被拒绝，需要显式覆盖

评分是 0 到 1000 的千分风险整数（工具答复中为 `risk: 650/1000`）。决定只是给代理的建议：
插件中没有任何东西会阻止被升级或被阻止的操作，也不会阻止从未声明的操作。

`dcp_sign_bundle` 取一个意图（其 `intent_id`，或最近的一个）以及会话的**全部**审计条目。验证器要求每个审计条目都带有
bundle 的 `intent_id`，因此在多个意图下记录了操作的会话，会生成被 `verifySignedBundleV2` 拒绝的 bundle；该工具不会按
意图拆分 bundle。

<a id="programmatic-usage"></a>

## 以编程方式使用

这些工具也可以不经 OpenClaw 插件系统直接使用：

```typescript
import {
  executeIdentitySetup,
  executeDeclareIntent,
  executeLogAction,
  executeGetAuditTrail,
} from '@dcp-ai/openclaw';

// Set up identity
const identity = await executeIdentitySetup({
  session_id: 'my-session',
  owner_name: 'Alice',
  jurisdiction: 'US',
});

// Declare intent
const intent = await executeDeclareIntent({
  session_id: 'my-session',
  action_type: 'api_call',
  target_channel: 'api',
  estimated_impact: 'low',
});

// Log action
await executeLogAction({
  session_id: 'my-session',
  intent_id: intent.intent_id,
  outcome: 'API call succeeded',
  evidence_tool: 'web.fetch',
});

// Get audit trail
const trail = await executeGetAuditTrail({ session_id: 'my-session' });
console.log(trail.entries);
```

<a id="dependencies"></a>

## 依赖项

- [`@dcp-ai/sdk`](../../sdks/typescript/README.md) — DCP TypeScript SDK（类型、加密、构建器、签名器、验证器）
- [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) — JSON Schema 类型构建器（OpenClaw 用于工具参数）

<a id="license"></a>

## 许可证

Apache-2.0
