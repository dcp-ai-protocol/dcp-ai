<sub>[English](ADMISSION.md) · **中文** · [Español](ADMISSION.es.md) · [日本語](ADMISSION.ja.md) · [Português](ADMISSION.pt-BR.md)</sub>

<a id="admission-trusted-principals-and-the-strict-v1-profile"></a>

# 准入：受信任的委托人与 strict-v1 配置

> 本文是[英文版](ADMISSION.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

已验证的 bundle 证明其完整性，以及它是由其列出的密钥签署的。任何人都可以用任意 `human_id` 和自己的密钥创建责任委托人记录，因此仅凭验证无法知道委托人是**谁**。

准入补充了运营方只接受来自其已信任委托人的证据所需的内容：

- **受信任的委托人。** 运营方提供一个信任集合：每个委托人的 `human_id` 及其可以用来签名的公钥。只有当实际验证了委托人签名（RPR 和 bundle 清单，经典和后量子两部分）的密钥是该委托人的受信任密钥、处于有效状态且在有效期窗口内时，bundle 才会被准入。
- **strict-v1 配置。** 可选、有版本、由运营方固定：所有风险等级都要求混合签名、已签名的 `intended_verifier` 等于运营方的 `verifier_id`、已签名的会话窗口最长 300 秒，以及不超过 300 秒的吊销快照。

> **发布状态（2026 年 10 月 26 日）。** 准入与 `strict-v1` 已在 `@dcp-ai/sdk` 2.2.0 和 Express/OpenClaw 2.1.0 适配器中发布。见 [npm 版本](NPM_RELEASES.md)。Python、Go 和 Rust 的发布独立进行；在各自发布版本包含这些 API 前，请使用源码检出。参考服务器和根目录 CLI 仍从检出代码运行。

包含全部规则和错误码的规范性定义是 [`spec/profiles/admission`](../spec/profiles/admission/README.md)。共享的测试向量是 [`tests/interop/v2/admission_vectors.json`](../tests/interop/v2/admission_vectors.json)。

<a id="it-is-opt-in"></a>

## 需要显式选择加入

准入只适用于设置了信任集合或配置的代码，`verified` 的含义保持不变。验证器还新增了一个可选的时钟，并在同一次验证中报告所用的密钥。同一批改动在准入之外也改变了验证本身：参见[兼容性](#compatibility)。

<a id="the-trust-set"></a>

## 信任集合

由运营方编写；它绝不来自 bundle、请求、工具参数或 RPR 中的 URL。模式：[`schemas/v2/principal_trust_set.schema.json`](../schemas/v2/principal_trust_set.schema.json)。

```json
{
  "trust_set_version": "2026-11-02.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active", "expires_at": "2027-06-01T00:00:00Z" }
      ]
    }
  ]
}
```

如果某个 kid 不是由其密钥导出、某个密钥格式错误、某个标识符为空，或某个 `human_id` 或 kid 出现两次，信任集合会在加载时被拒绝。信任集合中的 `status`、`not_before` 和 `expires_at` 具有权威性：bundle 即使把某个密钥列为 `active`，也无法恢复运营方已吊销的密钥。

**轮换。** 添加新密钥（如有需要可带 `not_before`），在重叠期间保持旧密钥为 `active`，然后将其退役（`revoked`、`expired`、设置 `expires_at` 或删除），每次都使用新的 `trust_set_version`。bundle 不能轮换它自己的密钥。

**智能体密钥**不需要列出：委托人对清单的签名覆盖了护照的哈希，这就把智能体及其密钥绑定到了委托人。

<a id="the-strict-v1-profile"></a>

## strict-v1 配置

模式：[`schemas/v2/admission_profile.schema.json`](../schemas/v2/admission_profile.schema.json)。

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example" }
```

| 要求 | 取值 |
|---|---|
| bundle 版本 | 仅 V2 |
| 签名 | 所有风险等级都要求经典和 PQ 签名且二者均有效（`hybrid_required`；`pq_only` 不满足） |
| 委托人 | 受信任（见上文），签名的两个分量都已锚定 |
| 会话绑定 | 必需 |
| 会话窗口 | `session_issued_at` 和 `session_expires_at` 已在清单中签名；最长 `max_session_duration_seconds`（默认值和上限均为 300）；开始时间在 30 秒时钟偏差之内；未过期 |
| 受众 | 已签名的 `intended_verifier` 等于 `verifier_id` |
| 吊销 | 智能体和每个已验证签名密钥的快照，最旧 `max_revocation_age_seconds`（默认值和上限均为 300）；没有已吊销或未知的条目 |

配置规定的是要求，而不是默认值。`max_session_duration_seconds`、`max_revocation_age_seconds` 和可选的 `verifier_policy` 只能让它更严格；会放宽它的取值（`allow_v1_bundles: true`、`require_*: false`、经典或 `pq_only` 模式、更长的会话、另一个 `verifier_id`）属于配置错误。适配器也会拒绝自身那些会放宽它的选项。

<a id="revocation-sources"></a>

## 吊销信息源

吊销由运营方选择的信息源来解析；不需要任何中央服务。信息源接收主体（`agent_ids` 和 `kids`）并返回一个快照：

```json
{ "checked_at": "2026-11-02T10:00:30Z", "agents": { "agent:acme-bot": "not_revoked" }, "keys": { "<kid>": "not_revoked" } }
```

`checked_at` 是信息源确定这些状态的时间。信息源超时、失败或什么都不返回时，请求会以 `REVOCATION_UNAVAILABLE` 失败；任何东西都不会被默认视为未吊销。

`denyListRevocationSource`（TypeScript 集成、参考验证器）和 `deny_list_revocation_source`（Python）使用运营方的 URL 和请求头，在有超时、不跟随重定向、最多 16 MiB 的条件下，读取参考吊销服务 `/.well-known/dcp-revocations.json` 格式的完整拒绝列表。URL 必须是 `https`（普通 `http` 只能指向环回主机）。如果缺少 `revocations` 或 `kid_revocations` 中的任意一个字段，该列表就是无效的，而非空列表：它可能已被截断。

<a id="results"></a>

## 结果

| 字段 | 含义 |
|---|---|
| `verified` | 验证器的结论，保持不变 |
| `principal_trust` | `trusted`、`untrusted` 或 `not_evaluated`（没有信任集合，或未通过验证） |
| `profile` / `profile_compliance` | `strict-v1` 或 null / `compliant`、`non_compliant`、`not_evaluated` |
| `admitted` | 在此配置下的最终决定 |
| `action_authorized` | 始终为 `false`：准入不授权任何操作 |
| `recorded_decision` | bundle 记录的策略决定（`approve`、`escalate`、`block`） |
| `trust_set_version` | 所使用的信任集合 |
| `errors` | `{ code, message }`；错误码列在规范 § 5.3 中 |

记录了 `block` 或 `escalate` 决定的 bundle 也可以被准入：它是该决定的证据，而不是一项许可。

<a id="using-it"></a>

## 使用方法

<a id="typescript-dcp-aisdk"></a>

### TypeScript（`@dcp-ai/sdk`）

```ts
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson);           // throws AdmissionConfigError
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
if (!result.admitted) throw new Error(result.errors.map((e) => e.code).join(', '));
```

`evaluateAdmissionV2` 接受你已有的验证结果（不做密码学运算，也没有 I/O）并信任它：只传入在同一 `now`、按该配置的策略验证同一 bundle 所得到的结果。`revocationSubjects` 告诉信息源需要回答哪些对象。Python、Go 和 Rust 提供相同的函数；参见规范 § 8。

<a id="express-dcp-aiexpress"></a>

### Express（`@dcp-ai/express`）

```ts
import { dcpVerify, denyListRevocationSource } from '@dcp-ai/express';

app.use('/api/agents', dcpVerify({
  trustedPrincipals: trustSetJson,                               // or ({ tenant }) => trust set
  profile: { profile: 'strict-v1', verifier_id: 'api.acme.example' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
  tenant: (req) => req.auth.tenant,                              // from your own authentication
  cacheTtlSeconds: 60,
}));
```

只有 bundle 被准入时，请求才会到达路由；`req.dcpAgent.admission` 携带结果。信任函数如果抛出异常，或返回 `undefined`、`null` 或任何不是有效信任集合的东西（例如它没有条目的租户），请求会以 `503` 被拒绝：这绝不意味着“没有信任要求”。缓存只保存密码学验证，以 bundle、验证器策略和租户为键；信任、配置检查和吊销在每个请求上都会重新评估，因此删除委托人或吊销密钥会在下一个请求生效。可运行示例：[`integrations/express/examples/strict-v1.mjs`](../integrations/express/examples/strict-v1.mjs)。

<a id="fastapi-dcp_aifastapi"></a>

### FastAPI（`dcp_ai.fastapi`）

`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=deny_list_revocation_source(url), tenant=...)`，规则相同（在 FastAPI 中 `require_bundle` 默认为 `False`，使用受信任的委托人时必须为 `True`）；参见 [`integrations/fastapi/README.md`](../integrations/fastapi/README.md)。

<a id="openclaw-dcp-aiopenclaw"></a>

### OpenClaw（`@dcp-ai/openclaw`）

```ts
configureVerifier({ trustedPrincipals, profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' }, revocationSource });
```

此后 `dcp_verify_bundle` 会报告 `admitted`，并且只为已准入的 bundle 给出智能体名称。在配置之下，模型的 `verifier_policy` 参数会被拒绝，工具未定义的参数会被忽略。可运行示例：[`integrations/openclaw/examples/strict-v1.mjs`](../integrations/openclaw/examples/strict-v1.mjs)。

<a id="reference-server-and-cli"></a>

### 参考服务器和 CLI

当运营方设置 `DCP_TRUSTED_PRINCIPALS_FILE`（内容变化时会重新加载）时，验证服务器（`npm run server`）会公开 `POST /v2/admit`；对于 strict-v1，还需要 `DCP_ADMISSION_PROFILE_FILE` 和 `DCP_REVOCATION_LIST_URL`（以及可选的 `DCP_REVOCATION_LIST_AUTHORIZATION`）。配置自相矛盾，或某个准入变量已设置但为空时，服务器会拒绝启动。离线方式：

```bash
# the reference CLI of a checkout; it reads only files in the current directory
node /path/to/dcp-ai/bin/dcp.js admit-bundle bundle.signed.json --trust trust.json --profile profile.json --revocation snapshot.json
```

<a id="compatibility"></a>

## 兼容性

- **验证 API。** `verifySignedBundleV2` / `verify_signed_bundle_v2` / `VerifySignedBundleV2WithPolicy` / `verify_signed_bundle_v2_with_policy` 保持原有签名。签名密钥在 TypeScript 和 Python 中为 `details.signer_keys`，在 Go 中为新的 `SignerKeys` 字段。在 Rust 中，`V2VerificationResult` 保留其十个字段，因此完整构造它或不带 `..` 解构它的代码仍可编译；签名密钥来自新的 `verify_signed_bundle_v2_at`，它返回 `V2VerificationDetails`（`result` 和 `signer_keys`），准入接受的正是它。在准入 API 发布之前针对它编写的代码读取的是 `verification.result.verified`，而不是 `verification.verified`。
- **验证行为。** 同一批改动在准入之外也改变了验证行为。S >= L 的 Ed25519 签名现在会被拒绝。另外，Go 和 Rust 验证器现在会应用策略中的 `accepted_classical_algs` 和 `accepted_pq_algs`，而以前它们以“未强制执行”为由拒绝这些字段：在这样的策略下，列表之外的 bundle 会失败，列表之内的 bundle 现在可以通过验证。[CHANGELOG](../CHANGELOG.md) 列出了全部改动。
- **bundle。** 线上格式没有变化。strict-v1 需要在清单中带有 `session_issued_at`、`session_expires_at` 和 `intended_verifier` 并签名的 bundle；只要提供了过期时间和受众，每个 SDK 的签名器都会写入它们。
- **有信任集合时，V1 bundle 会被拒绝**：它们不带可供锚定的委托人签名。
- **集成选项。** 新增且可选。使用受信任的委托人时，`requireBundle: false`（Express）和 `require_bundle=False`（FastAPI）属于配置错误：没有 bundle 的请求会到达路由。在配置之下，`verifierPolicy`、`requireHybrid: false` 和 `checkRevocation` 选项（Express）、`verifier_policy`（FastAPI）以及 `verifierPolicy`（OpenClaw）同样如此。

<a id="limits"></a>

## 限制

- **重放。** 会话 nonce、受众和过期时间限定了 bundle 可以在何处、多长时间内被重放；它们并不使其成为一次性的。需要一次性使用的验证器应自行记录已消费的 nonce 或 bundle 哈希；准入不会消费它们。
- **授权。** `action_authorized` 始终为 `false`。把外部授权绑定到某个工具、其参数及其执行，是后续阶段的工作。
- **身份**的可靠程度取决于信任集合以及维护它的流程。
- **吊销**的新近程度取决于快照：`checked_at` 之后发生的吊销会在下一个快照中体现。
