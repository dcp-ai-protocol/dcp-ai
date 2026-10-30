<sub>[English](../../../../integrations/express/README.md) · **中文** · [Español](../../../es/integrations/express/README.md) · [日本語](../../../ja/integrations/express/README.md) · [Português](../../../pt-BR/integrations/express/README.md)</sub>

<a id="dcp-aiexpress--express-middleware"></a>
<a id="dcp-aiexpress-express-middleware"></a>

# @dcp-ai/express — Express 中间件

> 本文是[英文版](../../../../integrations/express/README.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

面向 Express.js 的 DCP 验证中间件。在每个请求上自动验证 Signed Bundle，并注入已验证的智能体数据。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，属于部分支持：下面描述的 bundle 验证和准入，以及 DCP-05 和 DCP-09 的少数字段（`requireActiveLifecycle`、`lifecycleState`、`mandateId`）；并非这些规范的完整实现。

<a id="installation"></a>

## 安装

**已发布到 npm（2026 年 10 月 26 日）。** `@dcp-ai/express` 2.1.0 的标签为 `latest`，依赖 `@dcp-ai/sdk` `^2.2.0`。以下描述的功能已可从 npm 获取。

**请从 2.0.0 升级：** 该版本仅检查 V2 结构，不验证签名。请使用 2.1.0 获取修复后的验证器、准入和来源监管功能。见 [SECURITY.md](../../../../SECURITY.md)。

```bash
npm install @dcp-ai/express@^2.1.0 express
```

**对等依赖：** Express 4.18+ 或 5.x

所有软件包版本见 [npm 发布清单](../../../../docs/NPM_RELEASES.md)。

如需使用检出源码进行开发，请构建并安装本地软件包：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/express
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/express express
```

<a id="quickstart"></a>

## 快速开始

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

// The middleware sets req.dcpAgent; the package does not augment Express's Request type
type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
// The bundle travels in the JSON body: give the parser a budget sized for your bundles.
app.use(express.json({ limit: "64kb" }));

// Verify DCP on all routes
app.use(dcpVerify());

app.post("/api/action", (req: DCPRequest, res) => {
  // The verified agent is available at req.dcpAgent
  const agent = req.dcpAgent!;
  console.log(`Agent ${agent.agentId} (human: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

<a id="sending-a-bundle-from-the-client"></a>

### 从客户端发送 bundle

请把 bundle 放在 JSON 请求体的 `signed_bundle` 中发送。这是混合 V2 bundle 推荐的方式，对于能放进请求头的 bundle，中间件也会
（优先）读取 `X-DCP-Bundle` 请求头。下面的第一个请求是模板：`{...}` 代表一个真实的已签名 bundle。

```bash
# Via body (recommended)
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'

# Via header: only for bundles that fit the header limits of the server and every proxy
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'
```

混合 bundle（Ed25519 + ML-DSA-65）约为 33 KB：准入向量中的基础 bundle 为 32,996 字节。Node 对所有请求头合计的默认上限是
16 KiB，因此放在 `X-DCP-Bundle` 中会在 Express 运行之前得到 `431`；不要为了放得下而调大上限。放在请求体中时，解析器的
`limit` 就是你的预算：更大的请求体会在中间件之前得到 `413`。预算是你为自己的部署所做的选择，而不是协议的限制：请测量你最大的
bundle（它会随审计轨迹和 PQ 检查点增长），留出余量，并让前面的代理至少同样宽松。`examples/strict-v1-body.mjs` 会通过真实的
HTTP 检查所有这些（参见 `examples/README.md`）。

<a id="api-reference"></a>

## API 参考

### `dcpVerify(options?)`

返回一个 Express 中间件的工厂函数。

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

<a id="options-dcpverifyoptions"></a>

### 选项（`DCPVerifyOptions`）

未知的选项、未知的 `verifierPolicy` 字段或类型错误的值（例如 `allow_v1_bundles: "false"`）会在创建中间件时抛出异常：拼错的选项不应关闭某项检查。

| 选项 | 类型 | 默认值 | 说明 |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | 要求每个请求都带 bundle。如果为 `false`，不带 bundle 的请求会不经验证直接通过。 |
| `checkRevocation` | `boolean` | `false` | 在每个请求上，无论是否有缓存的判定，都向撤销服务询问该智能体（`GET /check/<agent_id>`）是否被撤销，对于 V2 还会询问可能用于签署该 bundle 的任何密钥（对每个护照密钥、每个 RPR 绑定密钥以及 bundle 签名的经典和 PQ kid 调用 `GET /v2/check/kid/<kid>`）。带真值 `revoked` 的 JSON 应答会拒绝该请求。 |
| `revocationFailClosed` | `boolean` | `false` | 与 `checkRevocation` 一起使用：当查询没有得到应答时怎么办，即 `fetch` 抛出异常（服务不可达）、响应不是 2xx、响应体不是 JSON，或其 `revoked` 缺失或既非真值也不是 `false`。`false`（默认）放行请求（失败即放行）；`true` 以 `403` 拒绝请求。 |
| `revocationServiceUrl` | `string` | `"http://localhost:3003"` | 撤销服务的基础 URL。 |
| `cacheTtlSeconds` | `number` | `0` | 缓存验证结果的秒数。`0` 表示禁用缓存。 |
| `cacheMaxEntries` | `number` | `1000` | 缓存中保留的已验证 bundle 的最大数量；最久未使用的最先被逐出。 |
| `headerName` | `string` | `"x-dcp-bundle"` | 可用于发送 bundle 的 HTTP 请求头名称，先于 `req.body.signed_bundle` 读取。仅适用于在服务器和每个代理的请求头上限之内的 bundle（Node 的默认上限是所有请求头合计 16 KiB）：请把混合 bundle 放在请求体中发送。 |
| `onFailure` | `function` | `undefined` | 验证错误的自定义处理函数。接收 `(req, res, errors)`，对于被拒绝的准入，还会把准入结果作为第四个参数传入。 |
| `verifierPolicy` | `object` | `undefined` | 验证器策略字段（`@dcp-ai/sdk` 的 `VerifierPolicy`），合并到 SDK 的 `DEFAULT_VERIFIER_POLICY` 之上。没有 `risk_overrides` 的 `default_mode` 适用于所有风险等级；`risk_overrides` 中的条目会覆盖其他等级的设置。 |
| `requireHybrid` | `boolean` | `false` | 所有低于 `hybrid_required` 的模式都变为 `hybrid_required`，并拒绝 V1 bundle。 |
| `requireActiveLifecycle` | `boolean` | `false` | 拒绝护照 `status` 为 `decommissioned` 的智能体。它读取的是护照的状态，而不是 DCP-05 的投入使用证书或生命周期记录。仅限 V2。 |
| `trustedPrincipals` | `object` 或 `function` | `undefined` | 你信任的委托人及其密钥：一个信任集（`schemas/v2/principal_trust_set.schema.json`），或在每个请求上调用的 `({ tenant }) => trust set`。使用它时，只有被准入的 V2 bundle 才能到达路由（见下文）。抛出异常、或返回 `undefined`、`null` 或无效信任集的函数会以 `503` 拒绝请求。 |
| `profile` | `object` | `undefined` | strict-v1 配置（`schemas/v2/admission_profile.schema.json`）。需要 `trustedPrincipals` 和 `revocationSource`。 |
| `revocationSource` | `function` | `undefined` | `(subjects, { tenant }) => snapshot`，即该配置的撤销来源，例如 `denyListRevocationSource({ url, headers })`。 |
| `revocationTimeoutMs` | `number` | `5000` | 在拒绝请求之前，撤销来源可以花费的时间。在 `supervise.revocation` 下即受监管的截止时间：1 到 2147483647 之间的整数。 |
| `sourceSupervisor` | `object` | `undefined` | 来自 `createSourceSupervisor` 的监管器，与 `supervise` 一起提供（参见[监管信任来源](#supervising-the-trust-source)）。 |
| `supervise` | `object` | `undefined` | `{ trustTimeoutMs?, revocation? }`，至少一项：`trustTimeoutMs` 是 1 到 2147483647 之间的整数，即 `sourceSupervisor` 下 `trustedPrincipals` 函数的截止时间；`revocation: true` 让该配置的 `revocationSource` 在其监管下运行，截止时间为 `revocationTimeoutMs`（参见[监管撤销来源](#supervising-the-revocation-source)）。 |
| `cancelOnDisconnect` | `boolean` | `false` | 当客户端在准入过程中真正离开时，取消其受监管的来源调用（参见[离开的客户端](#a-client-that-leaves)）。 |
| `tenant` | `function` | 单一租户 | `(req) => string`，来自你自己的已认证上下文，绝不能来自客户端设置的请求头。用于选择信任集并区分缓存的判定。 |
| `clock` | `function` | `Date.now` | 用于测试。 |

### `req.dcpAgent`

验证成功后，`req.dcpAgent` 包含：

```typescript
interface DCPAgent {
  agentId: string;      // Agent ID
  humanId: string;      // ID of the responsible human
  publicKey: string;    // Ed25519 public key
  capabilities: string[];  // Declared capabilities
  riskTier: string;     // Risk level (low/medium/high)
  status: string;       // Status (active/suspended/revoked)
  dcpVersion: "1.0" | "2.0";
  kids?: string[];          // V2: key identifiers of the passport keys
  sessionNonce?: string;    // V2: session nonce of the bundle
  lifecycleState?: string;  // DCP-05 lifecycle state
  mandateId?: string;       // DCP-09 delegation mandate ID
  warnings?: string[];      // V2: warnings of the SDK verifier (e.g. classical-only signature)
  verificationMode?: string; // V2: the mode the bundle was verified in
  securityTier?: string;     // V2: security tier of its intent and policy decision (spec §14.2)
  admission?: {              // with trustedPrincipals
    admitted: true;
    principalTrust: "trusted";
    profile: "strict-v1" | null;
    profileCompliance: "compliant" | "not_evaluated";
    recordedDecision: string | null; // approve, escalate, block: evidence, not a permission
    trustSetVersion: string | null;
    actionAuthorized: false;         // always: admission does not authorize an action
  };
}
```

<a id="behavior"></a>

### 行为

1. 从 `X-DCP-Bundle` 请求头（JSON）或 `req.body.signed_bundle` 中取出已签名的 bundle
2. 验证它：
   - **V2**（`bundle.dcp_bundle_version: "2.0"`）：使用 `@dcp-ai/sdk` 的 `verifySignedBundleV2()`，配合 Ed25519 / ML-DSA-65 / SLH-DSA-192f 注册表和上面的策略。它检查各构件载荷的哈希和清单；会话绑定、过期和已签名的会话开始时间（`session_issued_at`）；由委托人用 RPR 的 `binding_keys` 对清单所作的 bundle 签名，以及必须与之一致的未签名 `signature` 块；每个构件自身的签名；验证模式，即护照 `risk_tier` 对应的策略模式与意图和策略决定的安全等级模式（规范 §14.2）中更严格的那个；PQ 检查点；构件之间的一致性（护照状态、RPR 过期、构件和审计条目中只有一个智能体、委托人和意图）；审计哈希链；以及密钥有效性、kid 派生和规范 base64 密钥（`spec/VERIFICATION.md` 的 V2-1 至 V2-14）。使用 `@dcp-ai/sdk` 2.2.0 时，它检查的审计链和 Merkle 根是 SHA-256 的：它不检查 V2-11 中次级的 SHA3-256 字段（当你的锁定文件解析到 `@dcp-ai/sdk` 2.2.1 或更高版本时，会检查存在的字段），因此引用 VERIFICATION.md 并不意味着其中的每一步都经过检查。格式错误的 bundle 会以 `403` 被拒绝，绝不会仅凭其结构被接受。
   - **V1**（`bundle.responsible_principal_record.dcp_version: "1.0"`）：由于 V1 bundle 没有后量子签名，只有在 VERIFICATION.md V2-10 会接受仅经典签名的 bundle 时才使用 `verifySignedBundle()`：即 `allow_v1_bundles` 为 `true`、`requireHybrid` 关闭，并且 V1 护照 `risk_tier` 对应的策略模式（没有时为 `default_mode`）与 V1 意图和策略决定的安全等级模式（V1 的 `risk_score` 为 0 到 1，乘以 1000；缺失时按 `elevated` 处理）中更严格的那个是 `classical_only` 或 `hybrid_preferred`。在默认策略下，routine 或 standard 的 V1 意图会通过，而支付、敏感数据、高预估影响或风险分数达到 0.5 及以上会被拒绝。对 V1 bundle 只适用 `allow_v1_bundles`、模式和等级：受众绑定、会话过期和时长限制、不含 Ed25519 的 `accepted_classical_algs` 以及拒绝 Ed25519 的通告都是 V2 检查，通过模式检查的 V1 bundle 即使设置了这些也会被接受。如果需要这些控制，请设置 `allow_v1_bundles: false` 或 `requireHybrid: true`，或者把 `trustedPrincipals` 与 strict-v1 配置一起使用。
   - 无法识别版本的 bundle 会以 `403` 被拒绝。
3. 如果有效：注入 `req.dcpAgent` 并调用 `next()`
4. 如果失败：以 `403` 以及验证器的 `errors` 和 `warnings` 响应（如已配置则使用 `onFailure`）
5. 如果发生内部错误：以 `500` 响应

<a id="what-verified-means"></a>

### “已验证”意味着什么

已验证的 bundle 在内部是一致的，并由它自己列出的密钥签名：bundle 签名用 RPR 的 `binding_keys`，智能体的构件用护照密钥。它不能证明委托人是谁：任何人都可以创建密钥和一个指名任意 `human_id` 的 RPR。要做到这一点，请设置 `trustedPrincipals`（下一节）。

持有已验证 bundle 的任何人都可以在其会话过期之前重放它。针对 V2 bundle 的重放（这些检查不适用于 V1 bundle，参见“行为”），请设置 `verifierPolicy.require_audience_binding: true` 并配上你的 `verifier_id`（bundle 的 `manifest.intended_verifier` 必须指向该验证器），以及 `require_session_expiry` / `max_session_duration_seconds` 来限制会话，或者使用 strict-v1 配置。这些都不能让 bundle 变成一次性的：如有需要，请自行记录已使用的 nonce。

<a id="trusted-principals-and-strict-v1"></a>

### 受信任的委托人与 strict-v1

使用 `trustedPrincipals` 时，只有当请求的 bundle **被准入**时，请求才会到达路由（`docs/ADMISSION.md`、`spec/profiles/admission`）：即这样一个 V2 bundle，其委托人签名（RPR 和 bundle 清单，经典和后量子）是用你的信任集为该 `human_id` 列出的、有效且在有效期内的密钥生成的。使用 `profile` 时，还适用 strict-v1 的要求：所有风险等级都要求混合签名、已签名的 `intended_verifier` 等于你的 `verifier_id`、已签名的会话最长 300 秒，以及一份新鲜的撤销快照。

```typescript
import { dcpVerify, denyListRevocationSource } from "@dcp-ai/express";

app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet,
  profile: { profile: "strict-v1", verifier_id: "api.acme.example" },
  revocationSource: denyListRevocationSource({ url: "https://revocation.acme.example/.well-known/dcp-revocations.json" }),
  tenant: (req) => req.auth.tenant,
  cacheTtlSeconds: 60,
}));
```

被拒绝的请求会得到 `403`，附带 `{ verified, admitted: false, principal_trust, profile, profile_compliance, codes, errors }`，并且永远不会到达路由。`denyListRevocationSource` 需要 `https` URL（明文 `http` 仅限回环主机），不跟随重定向，最多读取 16 MiB。失败、超时或什么也不返回的撤销来源会拒绝请求（`REVOCATION_UNAVAILABLE`）。使用受信任的委托人时，`requireBundle: false` 会在创建中间件时抛出 `AdmissionConfigError`：否则，不带 bundle 的请求就会到达路由。在该配置下，`verifierPolicy`、`requireHybrid: false` 和 `checkRevocation` 相关选项也会抛出异常。使用受信任的委托人时，V1 bundle 会被拒绝：它们没有可以锚定的委托人签名。可运行示例：`examples/strict-v1.mjs`，以及通过真实 HTTP、把 bundle 放在请求体中并设置请求体预算的 `examples/strict-v1-body.mjs`。

测试会运行 `tests/interop/v2/bundle_vectors.json` 中的每个用例，各自使用其 `verifier_policy_overrides`。

<a id="supervising-the-trust-source"></a>

### 监管信任来源

不使用这些选项时，`trustedPrincipals` 函数和以前一样没有截止时间。使用它们时，它会得到一个截止时间，以及一份容量配额：

```typescript
import { createSourceSupervisor, dcpVerify } from "@dcp-ai/express";

// One object per process, shared by every middleware (and by @dcp-ai/openclaw) that should share one capacity.
const supervisor = createSourceSupervisor({ maxInFlight: 64, maxInFlightPerTenant: 8 });

app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  tenant: (req) => req.auth.tenant,
}));
```

- **截止时间。** 该函数接收 `{ tenant, signal }`。在 `trustTimeoutMs` 之后到达的信任集不会被使用，即使事件循环太忙而没能运行定时器也是如此：截止时间是在结果到达时用单调时钟测量的。此时请求会得到与失败来源相同的 `503`（`TRUST_SOURCE_FAILED`），并且 `signal` 会被中止。
- **容量。** `maxInFlight` 统计中间件已发起但尚未完成的调用，跨所有租户计算；`maxInFlightPerTenant` 限制单个租户，没有它时单个租户可以占满全部容量。找不到空闲位置的调用会立即得到同样的 `503`；没有队列。**只有当函数真正完成时才会释放位置**，而不是在请求超时的时候：永远不完成的来源会一直占着它的位置，当所有位置都被占满时，中间件会拒绝所有请求，直到你重启进程或创建另一个监管器。
- **作用范围。** 容量按监管器对象计算。两个监管器就是两份容量，因此一个进程的上限是它创建的各监管器之和。由 `@dcp-ai/openclaw` 创建的监管器，无论来自其 ESM 还是 CJS 构建，在这里同样可用，反之亦然。
- **`supervisor.close({ drainMs })`** 拒绝新的调用，以 `503` 应答待处理的调用，中止所有 `signal`，并最多等待 `drainMs`（默认 0）让进行中的调用完成。它以仍在进行中的调用数完成；这些调用的位置仍被占用。
- **`supervisor.stats()`** 返回计数器：`open`、`inFlight`、`tenants`、`timeouts`、`saturated`、`closed`、`lateResults`、`lateErrors`、`droppedEvents`。`createSourceSupervisor` 中的 `onSourceEvent` 接收 `{ source, reason, inFlight }`，从不接收租户。它必须很快，因为它运行在同一个事件循环上：一次只有一个调用，在某个调用排队或其 promise 尚未完成时到达的事件会被丢弃并计数。返回的 promise 或 thenable 会像 `Promise.resolve` 那样被同化：以一个待定 promise 完成的 thenable 会让它保持忙碌，之后再次调用的解析函数不会释放任何东西。它的错误和拒绝会被忽略。计数器在 `Number.MAX_SAFE_INTEGER` 处停止。
- **它不做什么。** 它不会停止来源的工作：忽略 `signal` 的函数会运行到结束。它不限制函数自行启动但不返回的工作。它帮不了阻塞事件循环的函数，那会推迟所有截止时间。bundle 的验证仍在信任来源之前运行。没有 `supervise.revocation` 时，撤销仍像以前一样使用 `revocationTimeoutMs`。

<a id="supervising-the-revocation-source"></a>

#### 监管撤销来源

使用 strict-v1 配置时，`supervise: { revocation: true }` 会在同类监管器下运行 `revocationSource`，以 `revocationTimeoutMs` 作为其截止时间（此时为 1 到 2147483647 之间的整数）：

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet, // a static trust set, or a function supervised with trustTimeoutMs
  profile: { profile: "strict-v1", verifier_id: "verifier:acme-api" },
  revocationSource: denyListRevocationSource({ url: "https://revocations.example.com/.well-known/dcp-revocations.json" }),
  revocationTimeoutMs: 2000,
  sourceSupervisor: supervisor,
  supervise: { revocation: true }, // or { trustTimeoutMs: 2000, revocation: true }
}));
```

- **需显式启用。** `supervise` 接受 `trustTimeoutMs`、`revocation: true` 或两者。`revocation: true` 需要 `revocationSource`，并且可以与静态信任集一起使用。没有它时，撤销仍像以前一样使用 `revocationTimeoutMs`。
- **相同的应答。** 来源接收 `(subjects, { tenant, signal })`，每种结果给出的应答与未监管时相同。快照的评估方式与以前相同。`null`、失败、超时、找不到空闲位置的调用以及已关闭的监管器都会得到带 `codes: ["REVOCATION_UNAVAILABLE"]` 的 `403`，绝不会被当作未撤销。`code` 为 `REVOCATION_INVALID` 的错误只有在截止时间之前到达时才得到 `REVOCATION_INVALID`；之后到达则视为超时。
- **同一份容量。** 信任调用和撤销调用占用同一个监管器的位置，每个位置都保持到其来源真正完成为止。迟到的快照永远不会被使用，无论是对其所属请求还是其他请求，判定缓存也永远不会保存它。
- **`denyListRevocationSource`** 除了在其自身的 `timeoutMs` 时，还会在监管器的 `signal` 被中止时中止其 fetch 以及对响应体的读取。
- **遥测。** 其事件带有 `source: 'revocation'`。
- **限制。** 与信任来源相同。旧的 `checkRevocation` / `revocationServiceUrl` 路径不受监管。

<a id="a-client-that-leaves"></a>

#### 离开的客户端

使用 `cancelOnDisconnect: true` 时，在请求准入过程中真正离开的客户端会停止该请求的工作：

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  cancelOnDisconnect: true,
}));
```

- **什么算离开。** 响应在发送之前就关闭了，或者请求在其请求体完整之前就关闭了。请求体读取完成后请求自身的 `close`（健康的请求也会发生）不算。
- **它取消什么。**
  - 只取消该请求受监管的来源调用：其 `signal` 被中止，该调用计入 `stats().cancelled`，`onSourceEvent` 的原因为 `'cancelled'`。
  - 不取消监管器，也不取消任何其他请求。
  - 它的位置会一直被占用，直到来源真正完成，与截止时间之后的情况相同：忽略 `signal` 的来源会继续运行。
- **请求会怎样。** 不再发生任何事：
  - 不调用处理函数，也不调用 `next()`；
  - 不写入缓存，也不调用 `onFailure`；
  - 不写入任何响应。
  - bundle 的验证不会被中断；中间件在其之后进行检查。
- **要求。** 在创建中间件时检查：
  - 每个来源函数都必须受监管：`trustedPrincipals` 函数需要 `trustTimeoutMs`，`revocationSource` 需要 `revocation: true`。不允许使用 `checkRevocation`，也不允许在没有受监管来源的情况下使用 `cancelOnDisconnect`（`AdmissionConfigError`、`CONFIG_PROFILE_CONTRADICTION`）。
  - 监管器必须支持取消（否则为 `CONFIG_INVALID_VALUE`）。本版本 `@dcp-ai/express` 或 `@dcp-ai/openclaw` 的监管器，无论 ESM 还是 CJS，都支持；旧版包中的监管器不支持，在不使用该选项时它会照旧工作。
- **读取 `cancelled`。** `stats().cancelled` 在类型中是可选的，以便旧版包中的监管器仍能通过类型检查：请以 `stats().cancelled ?? 0` 的方式读取。

<a id="cache"></a>

### 缓存

当 `cacheTtlSeconds > 0` 时，每个中间件都维护自己的已验证 bundle 缓存，键由已签名 bundle 规范形式（`canonicalizeV2`）的 SHA-256、验证器策略的指纹和租户组成：缓存的判定只会在同一个 bundle、同一策略、同一租户下被复用；没有规范形式的 bundle（例如 `1e999` 这样的非整数，或嵌套过深）会被验证但不会被缓存。条目在 `cacheTtlSeconds` 后过期，或者在 bundle 的会话（`manifest.session_expires_at`）、RPR、某个护照密钥或某个 RPR 绑定密钥过期时更早过期；过期时间戳不符合 RFC 3339 的 bundle 不会被缓存。缓存最多保存 `cacheMaxEntries` 个 bundle，先逐出已过期的条目，再逐出最久未使用的条目。使用 `checkRevocation` 时，每次缓存命中都会重新检查撤销。使用 `trustedPrincipals` 时，缓存只保存密码学验证的结果：委托人信任、配置检查和撤销在每个请求上都会重新评估，因此从信任集中移除的委托人或已撤销的密钥会在下一个请求上被拒绝。

<a id="advanced-example--selectively-protected-routes"></a>
<a id="advanced-example-selectively-protected-routes"></a>

## 高级示例 — 有选择地保护路由

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
app.use(express.json());

// Public routes (no verification)
app.get("/health", (req, res) => res.json({ ok: true }));

// Protected routes (require DCP)
const protectedRoutes = express.Router();
protectedRoutes.use(dcpVerify({ cacheTtlSeconds: 60 }));

protectedRoutes.post("/agent/action", (req: DCPRequest, res) => {
  res.json({ agent: req.dcpAgent!.agentId });
});

protectedRoutes.get("/agent/profile", (req: DCPRequest, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protectedRoutes);
app.listen(3000);
```

<a id="development"></a>

## 开发

```bash
# Development build uses the published SDK from package-lock.json:
npm install

# Build (ESM + CJS + types)
npm run build

# Tests
npm test
```

<a id="dependencies"></a>

### 依赖

- `@dcp-ai/sdk` — DCP 验证 SDK
- `express`（对等） — HTTP 框架

<a id="license"></a>

## 许可证

Apache-2.0
