<sub>[English](QUICKSTART.md) · **中文** · [Español](QUICKSTART.es.md) · [日本語](QUICKSTART.ja.md) · [Português](QUICKSTART.pt-BR.md)</sub>

<a id="dcp-ai-quick-start-guide"></a>

# DCP-AI 快速开始指南

**Rust 发布 (26/10/2026).** Rust `dcp-ai` 2.11.0 已在 crates.io 发布，包含验证器修复、准入和实验性显式启用 API。`dcp-jcs-v1` 仍是规范性默认配置。见 [Rust 2.11.0](RUST_RELEASE.md).

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](GO_RELEASE.md).

> 本文是[英文版](QUICKSTART.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

在 5 分钟内开始使用 Digital Citizenship Protocol。

---

<a id="prerequisites"></a>

## 前提条件

取决于你使用的 SDK：

- **Node.js** 18+ — 用于 TypeScript SDK、CLI、WASM 软件包和 `@dcp-ai/*` 集成；[QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) 中当前的 LangChain.js（v1）需要 Node.js 22+
- **Python** 3.10+ — 用于 Python SDK；[QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) 中单独的 `agno-dcp` 软件包需要 3.11+
- **Go** 1.25+ — 用于 Go SDK
- **Rust** 稳定版 — 用于 Rust crate

你只需要打算使用的那种语言。所有 SDK 都使用同一协议，因此在智能体和验证器之间混用语言可以直接工作。

---

<a id="published-packages-and-this-guide"></a>

## 已发布的软件包与本指南

TypeScript 示例使用已发布的 `@dcp-ai/sdk` 2.2.0，npm CLI 为 `@dcp-ai/cli` 2.1.0，Python 为 PyPI 上的 `dcp-ai` 2.10.0。见 [npm](NPM_RELEASES.md)、[Python](PYTHON_RELEASE.md) 与 [SECURITY.md](../SECURITY.md#supported-versions)。Go 和 Rust 独立发布。源码开发请使用：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build                  # TypeScript SDK of main
cd ../../cli && npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
pip install -e /path/to/dcp-ai/sdks/python                                  # Python SDK of main
```

本指南中的注册表命令安装的是已发布的版本。

---

<a id="zero-install-shortcuts"></a>

## 免安装的捷径

想在安装任何东西之前先看看 DCP 的运行效果？以下方式使用的是已发布的软件包和镜像，而不是 `main`：

- **交互式 playground：** https://docs.dcp-ai.org/playground/ — 在浏览器中生成身份、构建 bundle、验证签名。
- **脚手架起步项目：** 运行 `npm create @dcp-ai/langchain my-app`（或 `/crewai`、`/openai`、`/express`），约 2 分钟即可得到一个可运行的项目。
- **Docker 一行命令：** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` 无需克隆任何内容即可启动参考验证服务器。

[playground](../playground/README.md) 仅为演示：其 PQ 签名是模拟的，规范化和 Merkle 处理也经过简化，因此其 bundle 不能作为供 SDK 验证的证据。[起步模板](../templates/README.md) 也有限制：LangChain、CrewAI 和 OpenAI 使用占位密钥和签名；Express 只检查结构。要生成可验证的 bundle，请使用下面的 SDK 示例。

---

<a id="1-install-the-cli"></a>

## 1. 安装 CLI

CLI 向导只是用来四处看看的演示：它的“ML-DSA-65”密钥是模拟的（随机字节），它写出的 RPR 和护照没有签名，也不符合 V2 模式。要创建可以通过验证的身份和 bundle，请跳到 [§3](#3-typescript-sdk) 或 [§4](#4-python-sdk)；限制列在[智能体创建](AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)中。

已发布的版本，可以安装或直接运行：

```bash
npm install -g @dcp-ai/cli
```

```bash
npx @dcp-ai/cli init
```

使用检出副本（见上文）时，请在你的项目目录中运行仓库自带的向导：`node /path/to/dcp-ai/cli/bin/dcp-ai.js init`。

<a id="2-initialize-your-agent"></a>

## 2. 初始化你的智能体

```bash
npx @dcp-ai/cli init   # or: node /path/to/dcp-ai/cli/bin/dcp-ai.js init
```

这会在你的项目中创建以下演示文件：

| 文件 | 用途 |
|------|---------|
| `.dcp/config.json` | 智能体配置和元数据 |
| `.dcp/keys/ed25519_public.key`、`.dcp/keys/ed25519_secret.key` | Ed25519 密钥对 |
| `.dcp/keys/ml_dsa_65_public.key`、`.dcp/keys/ml_dsa_65_secret.key` | 选择后量子密钥时生成的模拟“ML-DSA-65”密钥对（随机字节） |
| `.dcp/identity.json` | 类似 RPR 的记录（未签名，不符合模式） |
| `.dcp/passport.json` | 类似护照的记录（未签名，不符合模式） |

私钥文件以默认权限写出（在常见的 umask `022` 下为 `0644`）：请运行 `chmod 600 .dcp/keys/*_secret.key`，并将 `.dcp/keys/` 加入 `.gitignore`，使其不进入版本控制。

---

## 3. TypeScript SDK

下面的 TypeScript 示例适用于 npm SDK 2.2.0 或开发检出代码（参见[已发布的软件包与本指南](#published-packages-and-this-guide)）。

二选一安装：

- 用于源码开发、从检出代码构建的 `main` SDK：

  ```bash
  npm install /path/to/dcp-ai/sdks/typescript
  ```

- 或已发布的 SDK 2.2.0，其中包含这些修复和功能：

  ```bash
  npm install @dcp-ai/sdk@^2.2.0
  ```

<a id="create-and-sign-a-bundle-v1--ed25519"></a>
<a id="create-and-sign-a-bundle-v1-ed25519"></a>

### 创建并签署 bundle（V1 — Ed25519）

RPR 和护照分别针对去掉 `signature` 字段后的对象签名。`verifySignedBundle` 检查 bundle 签名、其哈希和链；内部签名需另外检查。

```typescript
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, ResponsiblePrincipalRecord } from '@dcp-ai/sdk';

const now = new Date().toISOString();
const principalKeys = generateKeypair();
const agentKeys = generateKeypair();

// Each artifact is signed over the object without its `signature` field.
const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: 'human:example-001', legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible',
  override_rights: true, issued_at: now, expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, principalKeys.secretKeyB64) };

const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: 'agent:example-001', public_key: agentKeys.publicKeyB64,
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'],
  risk_tier: 'low', created_at: now, status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(rpr)
  .agentPassport(passport)
  .intent({
    dcp_version: '1.0', intent_id: 'intent:example-001', agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  })
  .policyDecision({
    dcp_version: '1.0', intent_id: 'intent:example-001', decision: 'approve', risk_score: 0.05,
    reasons: ['low-impact call'], required_confirmation: null,
  })
  .createAuditEntry({
    dcp_version: '1.0', audit_id: 'audit:example-001', timestamp: now, agent_id: passport.agent_id,
    human_id: rpr.human_id, intent_id: 'intent:example-001', policy_decision: 'approved',
    outcome: 'call_completed', evidence: { tool: 'http', result_ref: null },
  })
  .build();

const signed = signBundle(bundle, { secretKeyB64: principalKeys.secretKeyB64, signerType: 'human', signerId: rpr.human_id });
console.log(verifySignedBundle(signed, principalKeys.publicKeyB64)); // { verified: true }

// The inner signatures, over the same objects without `signature`
console.log(verifyObject(rprBody, rpr.signature, principalKeys.publicKeyB64)); // true
console.log(verifyObject(passportBody, passport.signature, agentKeys.publicKeyB64)); // true
```

<a id="verify-a-bundle"></a>

### 验证 bundle

```typescript
import { readFileSync } from 'node:fs';
import { getDefaultRegistry, registerDefaultProviders, verifySignedBundleV2 } from '@dcp-ai/sdk';

registerDefaultProviders();
const signedBundle = JSON.parse(readFileSync('bundle.signed.json', 'utf8'));
const result = await verifySignedBundleV2(signedBundle, getDefaultRegistry());
console.log(result.verified, result.errors);
```

<a id="v2--post-quantum-hybrid-signatures"></a>
<a id="v2-post-quantum-hybrid-signatures"></a>

### V2 — 后量子混合签名

每个构件都是在其域分离上下文下用 Ed25519 + ML-DSA-65 签名的 `SignedPayload`；委托人签署 RPR 和清单，智能体签署护照、意图和策略决定。

```typescript
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign,
  generateSessionNonce, preparePayload, sha256Hex, canonicalizeV2, signBundleV2, verifySignedBundleV2,
} from '@dcp-ai/sdk';
import type {
  AgentPassportV2, AuditEventV2, CompositeKeyPair, DcpContext, IntentV2, KeyEntry, PolicyDecisionV2,
  ResponsiblePrincipalRecordV2, SignedPayload,
} from '@dcp-ai/sdk';

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function hybridKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (keys: CompositeKeyPair): KeyEntry[] => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sha256Of = (value: unknown) => `sha256:${sha256Hex(new TextEncoder().encode(canonicalizeV2(value)))}`;
async function signed<T>(payload: T, context: DcpContext, keys: CompositeKeyPair): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const principal = await hybridKeys();
const agent = await hybridKeys();
const nonce = generateSessionNonce();
const now = new Date().toISOString();

const rpr: ResponsiblePrincipalRecordV2 = {
  dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
};
const passport: AgentPassportV2 = {
  dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'low',
  created_at: now, status: 'active',
};
const intent: IntentV2 = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: passport.agent_id,
  human_id: rpr.human_id, timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};
const policy: PolicyDecisionV2 = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
  reasons: ['low-impact call'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }), timestamp: now,
};
const audit: AuditEventV2 = {
  dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: now, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
  intent_hash: sha256Of(intent), policy_decision: 'approved', outcome: 'call_completed',
  evidence: { tool: 'http', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
};

const bundle = new BundleBuilderV2(nonce)
  .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
  .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport, agent))
  .intent(await signed(intent, DCP_CONTEXTS.Intent, agent))
  .policyDecision(await signed(policy, DCP_CONTEXTS.PolicyDecision, agent))
  .addAuditEntry(audit)
  .build();

const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
const result = await verifySignedBundleV2(signedBundle, registry);
console.log(result.verified, result.errors); // true []
```

---

## 4. Python SDK

二选一安装：

- 用于 SDK 开发的检出代码：

  ```bash
  pip install -e /path/to/dcp-ai/sdks/python
  ```

- 或已发布的 2.10.0，包含本文描述的修复和 API：

  ```bash
  pip install "dcp-ai>=2.10.0,<3"
  ```

<a id="create-and-verify-a-bundle"></a>

### 创建并验证 bundle

```python
from datetime import datetime, timezone

from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)

now = datetime.now(timezone.utc).isoformat()
principal_keys = generate_keypair()
agent_keys = generate_keypair()

# 1. The responsible principal, signed with the principal's key (the object without "signature")
rpr_body = {
    "dcp_version": "1.0", "human_id": "human:example-001", "legal_name": "Example Principal",
    "entity_type": "natural_person", "jurisdiction": "ES", "liability_mode": "owner_responsible",
    "override_rights": True, "issued_at": now, "expires_at": None, "contact": None,
}
rpr = {**rpr_body, "signature": sign_object(rpr_body, principal_keys["secret_key_b64"])}

# 2. The agent passport, signed with the agent's key (the object without "signature")
passport_body = {
    "dcp_version": "1.0", "agent_id": "agent:example-001", "public_key": agent_keys["public_key_b64"],
    "principal_binding_reference": "human:example-001", "capabilities": ["browse", "api_call"],
    "risk_tier": "low", "created_at": now, "status": "active",
}
passport = {**passport_body, "signature": sign_object(passport_body, agent_keys["secret_key_b64"])}

# 3. Intent, policy decision and one audit entry
intent = Intent(
    intent_id="intent:example-001", agent_id="agent:example-001", human_id="human:example-001",
    timestamp=now, action_type="api_call", target={"channel": "api", "domain": "api.example.com"},
    data_classes=["none"], estimated_impact="low", requires_consent=False,
)
policy = PolicyDecision(
    intent_id="intent:example-001", decision="approve", risk_score=0.05, reasons=["low-impact call"],
)
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(**rpr))
    .agent_passport(AgentPassport(**passport))
    .intent(intent)
    .policy_decision(policy)
    .create_audit_entry(
        audit_id="audit:example-001", timestamp=now, agent_id="agent:example-001",
        human_id="human:example-001", intent_id="intent:example-001", policy_decision="approved",
        outcome="call_completed", evidence=AuditEvidence(tool="http", result_ref=None),
    )
    .build()
)

# 4. Sign with the principal's key and verify against the principal's public key
signed = sign_bundle(bundle, principal_keys["secret_key_b64"])
print(verify_signed_bundle(signed, principal_keys["public_key_b64"]))  # {'verified': True}

# 5. The inner signatures, over the same objects without "signature"
print(verify_object(rpr_body, rpr["signature"], principal_keys["public_key_b64"]))  # True
print(verify_object(passport_body, passport["signature"], agent_keys["public_key_b64"]))  # True
```

关于 Python 中的 V2 bundle，参见 [V2 Bundles](../sdks/python/README.md#v2-bundles)。

---

<a id="5-security-tiers"></a>

## 5. 安全等级

DCP 根据意图的风险概况自动选择密码学安全等级：

| 等级 | 名称 | 验证模式 | PQ 检查点间隔 | 触发条件 |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | 仅经典（Ed25519） | 每 50 个事件 | 不满足下面任何触发条件 |
| 1 | **Standard** | 首选混合 | 每 10 个事件 | 风险分数 200–499，`estimated_impact: medium` |
| 2 | **Elevated** | 必须混合 | 每个事件 | 风险分数 500–799、个人信息、金融或健康数据、支付、`estimated_impact: high`、未知值 |
| 3 | **Maximum** | 必须混合 | 每个事件 | 风险分数 ≥ 800、凭据、儿童数据 |

风险分数即策略决定中的 `risk_score`（规范 §14.2）。

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent, policyDecision);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

<a id="6-telemetry--observability"></a>
<a id="6-telemetry-observability"></a>

## 6. 遥测与可观测性

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({
  serviceName: 'my-agent',
  enabled: true,
  exporterType: 'console', // or 'otlp'
});

// Automatic span tracking
const spanId = dcpTelemetry.startSpan('sign_bundle', { tier: 'elevated' });
// ... perform operation ...
dcpTelemetry.endSpan(spanId);

// Record metrics
dcpTelemetry.recordSignLatency(12.5, 'ed25519');

// Get summary
const summary = dcpTelemetry.getMetricsSummary();
console.log(summary.sign.p95); // p95 sign latency in ms
```

---

<a id="7-agent-to-agent-a2a-communication"></a>

## 7. 智能体间（A2A）通信

```typescript
import { createHello, createWelcome, createSession, encryptMessage } from '@dcp-ai/sdk';

// Agent A initiates
const hello = createHello(bundleA, kemPublicKeyB64, ['api_call'], 'standard');

// Agent B responds
const welcome = createWelcome(bundleB, kemPubB, kemCiphertextB64, 'standard');

// Establish encrypted session
const session = createSession(sessionId, sessionKey, 'agent-a', 'agent-b', 'standard');

// Send encrypted messages
const encrypted = encryptMessage(session, { action: 'transfer', amount: 100 });
```

---

<a id="other-sdks"></a>

## 其他 SDK

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai@2.11.0
```

ML-DSA-65、ML-KEM-768、SLH-DSA-192f、Ed25519 的提供者位于 `dcp_ai::providers::*`。完整接口参见 [docs.rs 上的 `dcp-ai` crate 文档](https://docs.rs/dcp-ai)。

<a id="webassembly-browser"></a>

### WebAssembly（浏览器）

```bash
npm install @dcp-ai/wasm@^2.1.0   # the published version; for main, see the WASM SDK's Release status
```

将 Rust SDK 的基础功能提供给浏览器和 Node.js。在 Node.js 中，`initDcp()` 需要以 `data:` URL 的形式提供 `.wasm` 文件：参见[初始化](../sdks/wasm/README.md#initialization-browser-and-nodejs)。

---

<a id="run-the-reference-services"></a>

## 运行参考服务

规范引用的全部四个服务（验证服务器、anchor、透明度日志、吊销注册表）都以 Docker 镜像发布。在一个空目录中：

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

关于托管部署，参见 [`deploy/fly/` 中的 Fly.io 配置](../deploy/)，以及介绍 Cloud Run / Railway / Compose 等替代方案的[部署指南](../deploy/README.md)。

---

<a id="next-steps"></a>

## 后续步骤

- **[LangChain 集成](./QUICKSTART_LANGCHAIN.md)** — 为 LangChain 智能体添加 DCP
- **[CrewAI 集成](./QUICKSTART_CREWAI.md)** — 为 CrewAI 团队添加 DCP
- **[OpenAI 集成](./QUICKSTART_OPENAI.md)** — 为 OpenAI 函数调用添加 DCP
- **[Express 中间件](./QUICKSTART_EXPRESS.md)** — 在 Express API 中验证 DCP bundle
- **[API 参考](./API_REFERENCE.md)** — 完整的 SDK 文档
- **[协议规范](../spec/)** — 完整的 DCP v2.0 规范
- **[安全模型](./SECURITY_MODEL.md)** — 威胁模型和安全架构
- **[运营方指南](./OPERATOR_GUIDE.md)** — 在生产中运行验证和锚定服务
