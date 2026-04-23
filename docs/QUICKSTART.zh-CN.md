<sub>[English](QUICKSTART.md) · **中文** · [Español](QUICKSTART.es.md) · [日本語](QUICKSTART.ja.md) · [Português](QUICKSTART.pt-BR.md)</sub>

# DCP-AI 快速入门指南

在 5 分钟内上手数字公民身份协议。

---

## 先决条件

根据你使用的 SDK：

- **Node.js** 18+ — 适用于 TypeScript SDK、CLI、WASM 包以及任何 `@dcp-ai/*` 集成
- **Python** 3.10+ — 适用于 Python SDK
- **Go** 1.22+ — 适用于 Go SDK
- **Rust** stable — 适用于 Rust crate

你只需要你计划用来构建的语言。所有 SDK 说同一种协议，因此跨语言混合智能体/验证方可以开箱即用。

---

## 零安装捷径

想在不安装任何东西的情况下先看看 DCP 运行起来？

- **交互式 Playground：** https://dcp-ai.org/playground/ — 在浏览器中生成身份、构建凭证包、验证签名。
- **脚手架启动器：** 运行 `npm create @dcp-ai/langchain my-app`（或 `/crewai`、`/openai`、`/express`），大约 2 分钟就能得到可用项目。
- **Docker 一行命令：** `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest` 无需克隆任何内容即可启动参考验证服务器。

---

## 1. 安装 CLI

```bash
npm install -g @dcp-ai/cli
# or run directly with npx
npx @dcp-ai/cli init
```

## 2. 初始化你的智能体

```bash
npx @dcp-ai/cli init
```

这会在你的项目中创建以下文件：

| 文件 | 用途 |
|------|---------|
| `.dcp/config.json` | 智能体配置与元数据 |
| `.dcp/keys/` | Ed25519 + ML-DSA-65 密钥对 |
| `.dcp/identity.json` | 责任主体记录 (RPR) |
| `.dcp/passport.json` | 智能体护照 |

---

## 3. TypeScript SDK

```bash
npm install @dcp-ai/sdk
```

### 创建并签名凭证包 (V1 — Ed25519)

```typescript
import {
  generateKeypair,
  signObject,
  verifyObject,
  BundleBuilder,
  signBundle,
  verifySignedBundle,
} from '@dcp-ai/sdk';

// Generate an Ed25519 keypair
const keys = generateKeypair();

// Define artifacts
const hbr = {
  dcp_version: '1.0',
  human_id: 'human-001',
  legal_name: 'Alice Johnson',
  entity_type: 'natural_person',
  jurisdiction: 'US-CA',
  liability_mode: 'owner_responsible',
  override_rights: true,
  public_key: keys.publicKeyB64,
  issued_at: new Date().toISOString(),
  expires_at: null,
  contact: 'alice@example.com',
};

const passport = {
  dcp_version: '1.0',
  agent_id: 'agent-001',
  human_id: 'human-001',
  public_key: keys.publicKeyB64,
  capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  created_at: new Date().toISOString(),
  status: 'active',
};

const intent = {
  dcp_version: '1.0',
  intent_id: 'intent-001',
  agent_id: 'agent-001',
  human_id: 'human-001',
  timestamp: new Date().toISOString(),
  action_type: 'api_call',
  target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'],
  estimated_impact: 'low',
  requires_consent: false,
};

const policy = {
  dcp_version: '1.0',
  intent_id: 'intent-001',
  decision: 'approve',
  risk_score: 15,
  reasons: ['Low risk action'],
  required_confirmation: null,
  applied_policy_hash: 'sha256:abc123',
  timestamp: new Date().toISOString(),
};

const audit = {
  dcp_version: '1.0',
  audit_id: 'audit-001',
  prev_hash: '0'.repeat(64),
  timestamp: new Date().toISOString(),
  agent_id: 'agent-001',
  human_id: 'human-001',
  intent_id: 'intent-001',
  intent_hash: signObject(intent, keys.secretKeyB64),
  policy_decision: 'approved',
  outcome: 'API call completed successfully',
  evidence: { tool: 'fetch', result_ref: 'https://api.example.com/data' },
};

// Build the bundle
const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(hbr)
  .agentPassport(passport)
  .intent(intent)
  .policyDecision(policy)
  .addAuditEntry(audit)
  .build();

// Sign the bundle
const signed = signBundle(bundle, keys.secretKeyB64);

// Verify the bundle
const result = verifySignedBundle(signed);
console.log('Verified:', result.verified); // true
```

### 验证凭证包

```typescript
import { verifySignedBundle } from '@dcp-ai/sdk';

const result = verifySignedBundle(signedBundle);

if (result.verified) {
  console.log('Bundle is valid');
} else {
  console.error('Verification failed:', result.errors);
}
```

### V2 — 后量子混合签名

```typescript
import {
  registerDefaultProviders,
  getDefaultRegistry,
  compositeSign,
  compositeVerify,
  BundleBuilderV2,
  computeSecurityTier,
  type CompositeKeyPair,
} from '@dcp-ai/sdk';

// Register Ed25519 + ML-DSA-65 providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate composite keypair
const ed = await registry.getSigner('ed25519').generateKeyPair();
const pq = await registry.getSigner('ml-dsa-65').generateKeyPair();

const keys: CompositeKeyPair = {
  classical: { kid: 'ed-01', alg: 'ed25519', ...ed },
  pq: { kid: 'pq-01', alg: 'ml-dsa-65', ...pq },
};

// Compute the security tier for your intent
const tier = computeSecurityTier(intentV2);
console.log('Security tier:', tier); // 'routine' | 'standard' | 'elevated' | 'maximum'

// Build a V2 bundle with the fluent builder
const bundle = new BundleBuilderV2(sessionNonce)
  .responsiblePrincipalRecord(signedHbr)
  .agentPassport(signedPassport)
  .intent(signedIntent)
  .policyDecision(signedPolicy)
  .addAuditEntries(auditEvents)
  .enableDualHash()
  .build();
```

---

## 4. Python SDK

```bash
pip install dcp-ai
```

### 创建并验证凭证包

```python
from dcp_ai import (
    generate_keypair,
    sign_object,
    verify_object,
    build_bundle,
    sign_bundle,
    verify_signed_bundle,
)

# Generate Ed25519 keypair
keys = generate_keypair()

# Define artifacts
hbr = {
    "dcp_version": "1.0",
    "human_id": "human-001",
    "legal_name": "Alice Johnson",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "public_key": keys["public_key_b64"],
    "issued_at": "2025-01-01T00:00:00Z",
    "expires_at": None,
    "contact": "alice@example.com",
}

passport = {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "public_key": keys["public_key_b64"],
    "capabilities": ["browse", "api_call"],
    "risk_tier": "low",
    "created_at": "2025-01-01T00:00:00Z",
    "status": "active",
}

# Sign and build
signed = sign_bundle(
    build_bundle(hbr, passport, intent, policy, [audit]),
    keys["secret_key_b64"],
)

# Verify
result = verify_signed_bundle(signed)
assert result["verified"] is True
```

---

## 5. 安全等级

DCP 会根据意图的风险特征自动选择密码学安全等级：

| 等级 | 名称 | 验证模式 | 后量子检查点间隔 | 触发条件 |
|------|------|------------------|----------------------|---------|
| 0 | **Routine** | 仅经典 (Ed25519) | 每 50 个事件 | 风险分数 < 200 |
| 1 | **Standard** | 优先混合 | 每 10 个事件 | 风险分数 200–499 |
| 2 | **Elevated** | 必须混合 | 每个事件 | 风险分数 500–799、PII、支付 |
| 3 | **Maximum** | 必须混合 + 即时验证 | 每个事件 | 风险分数 ≥ 800、凭据 |

```typescript
import { computeSecurityTier, tierToVerificationMode } from '@dcp-ai/sdk';

const tier = computeSecurityTier(intent);
const mode = tierToVerificationMode(tier);
// tier: 'elevated', mode: 'hybrid_required'
```

---

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

## 7. 智能体间 (A2A) 通信

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

## 其他 SDK

### Go

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0
```

```go
import dcp "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"

canonical, _ := dcp.Canonicalize(map[string]string{"b": "2", "a": "1"})
// produces {"a":"1","b":"2"}
```

### Rust

```bash
cargo add dcp-ai
```

ML-DSA-65、ML-KEM-768、SLH-DSA-192f、Ed25519 的 Provider 位于 `dcp_ai::providers::*` 下。完整接口请参阅 [docs.rs 上的 `dcp-ai` crate 文档](https://docs.rs/dcp-ai)。

### WebAssembly（浏览器）

```bash
npm install @dcp-ai/wasm
```

向任何浏览器 JS 环境暴露相同的 Rust 加密原语。[Playground](https://dcp-ai.org/playground/) 是该包的参考使用者。

---

## 运行参考服务

规范引用的所有四个服务（验证服务器、锚定、透明度日志、撤销注册表）都以 Docker 镜像发布。从一个空目录开始：

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
docker run -d -p 3001:3001 ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest
docker run -d -p 3002:3002 ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest
docker run -d -p 3003:3003 ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest
```

对于托管部署，请参见 [`deploy/fly/` 中的 Fly.io 配置](../deploy/)，以及 [部署指南](../deploy/README.md) 了解 Cloud Run / Railway / Compose 的替代方案。

---

## 下一步

- **[LangChain 集成](./QUICKSTART_LANGCHAIN.md)** — 将 DCP 添加到 LangChain 智能体
- **[CrewAI 集成](./QUICKSTART_CREWAI.md)** — 将 DCP 添加到 CrewAI 团队
- **[OpenAI 集成](./QUICKSTART_OPENAI.md)** — 将 DCP 添加到 OpenAI 函数调用
- **[Express 中间件](./QUICKSTART_EXPRESS.md)** — 在 Express API 中验证 DCP 凭证包
- **[API 参考](./API_REFERENCE.md)** — 完整 SDK 文档
- **[协议规范](../spec/)** — 完整 DCP v2.0 规范
- **[安全模型](./SECURITY_MODEL.md)** — 威胁模型与安全架构
- **[运营方指南](./OPERATOR_GUIDE.md)** — 在生产环境运行验证与锚定服务
