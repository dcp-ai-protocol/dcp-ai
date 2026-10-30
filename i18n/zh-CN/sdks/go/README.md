<sub>[English](../../../../sdks/go/README.md) · **中文** · [Español](../../../es/sdks/go/README.md) · [日本語](../../../ja/sdks/go/README.md) · [Português](../../../pt-BR/sdks/go/README.md)</sub>

<a id="dcp-ai-go--go-sdk"></a>

# dcp-ai-go — Go SDK

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](../../../../docs/GO_RELEASE.md).

> 本文是[英文 README](../../../../sdks/go/README.md)的参考译文，更新于2026年10月30日。为保留经过验证的示例，标识符和代码块（包括注释）均保持原文。

Digital Citizenship Protocol（DCP）v1.0 和 v2.0 的官方 Go SDK。支持 Ed25519、ML-DSA-65、SLH-DSA-192f、ML-KEM-768、复合签名、双哈希链和 bundle 验证。

验证检查完整性和签名，不会建立对责任主体的信任、准入资格或行动授权。V2 验证器检查主审计链，自 v2.11.1 起还检查存在的可选 SHA3-256 次级链接、意图哈希和次级 Merkle 根（不存在的不作要求）；v2.11.0 不检查次级字段。请参阅[已记录的验证限制](../../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)；需要检查信任时，请使用下文的准入 API。

<a id="installation"></a>

## 安装

**要求：** Go 1.25+

**Go SDK。** 自 v2.11.0 起，此 SDK 包含验证器修复、责任主体信任与 `strict-v1`、委托链、A2A 接收窗口和实验性显式启用的 `dcp-jcs-v2` API。v2.11.0 的模块标签为 `sdks/go/v2.11.0`，导入路径仍保留 `/v2`。变更继续记录在[变更日志](../../../../CHANGELOG.md#unreleased)中。

**Go SDK v2.11.1。** 此版本还会在 [VERIFICATION.md 的 V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`、每个 `prev_hash_secondary` 和每个 `intent_hash_secondary`。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链；存在的字段如果是 `null`、不是字符串或不一致，则被拒绝。API、结果字段、`dcp-jcs-v1` 和 `hash_alg` 的处理均不变。v2.11.0 不检查这些字段。下面的安装命令指定的是此版本；它在注册表中的可用情况见[已发布版本](../../../../docs/README.md#published-versions)。

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

从 v2.10.0 升级后验证更严格，之前接受的格式错误或不一致证据可能被拒绝。V1 公钥长度无效时返回错误而非 panic。请保留历史证据。`dcp-jcs-v1` 仍是规范性默认值；候选 API 仍为实验性且须显式启用。准入仍需运营方配置信任，不授权任何操作。

仅用于源码开发：

```bash
go mod edit -replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2=/path/to/dcp-ai/sdks/go
```

<a id="features"></a>

## 功能

| 功能 | V1 | V2 |
|---------|----|----|
| Ed25519 签名 | 支持 | 支持 |
| ML-DSA-65（FIPS 204） | — | 支持 |
| SLH-DSA-192f（FIPS 205） | — | 支持 |
| ML-KEM-768（FIPS 203） | — | 支持 |
| 复合签名（对经典签名再作 PQ 签名） | — | 支持 |
| 域分离 | — | 支持 |
| 双哈希（SHA-256 + SHA3-256） | — | 支持 |
| Bundle 验证 | 支持 | 支持 |
| 准入：责任主体信任集合与 `strict-v1` 配置（spec/profiles/admission） | — | 支持 |
| Bundle 构建与签名 | — | 支持 |
| 安全等级计算 | — | 支持 |
| 持有证明 | — | 支持 |
| 密钥轮换 | — | 支持 |
| DCP-04 A2A 发现、握手与 AES-256-GCM 会话（标准库；支持安全并发使用，窗口内每条消息只接受一次） | — | 支持 |
| DCP-05 智能体生命周期（启用 / 活力 / 停用） | — | 支持 |
| DCP-06 数字继承（遗嘱、记忆转移、仪式） | — | 支持 |
| DCP-07 争议解决、仲裁与判例 | — | 支持 |
| DCP-08 权利、义务与合规 | — | 支持 |
| DCP-09 委托与可验证委托链（`CreateSubMandate`、`VerifyMandateChain`）、认知阈值与责任主体镜像 | — | 支持 |
| 会话 nonce 辅助函数、紧急撤销 | — | 支持 |
| 延迟 PQ 检查点与 `PQCheckpointManager` | — | 支持 |
| 盲化 RPR、多方授权、算法通告辅助函数 | — | 支持 |
| 通用错误码（所有 SDK 共享 38 个）与 `DetectWireFormat` | — | 支持 |
| OpenTelemetry / OTLP 导出器（构建标签 `otlp`） | — | 支持 |
| 规范化候选方案 `dcp-jcs-v2`（入口处理、路由器、字节验证器、生成器） | — | 实验性，须显式选择；非规范性 |

<a id="quickstart-v1"></a>

<a id="quickstart--v1"></a>

## 快速入门 — V1

```go
package main

import (
    "fmt"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"
)

func main() {
    keys, _ := dcp.GenerateKeypair()
    obj := map[string]interface{}{"agent_id": "agent-001", "action": "api_call"}
    sig, _ := dcp.SignObject(obj, keys.SecretKeyB64)
    ok, _ := dcp.VerifyObject(obj, sig, keys.PublicKeyB64)
    fmt.Println("Verified:", ok) // true
}
```

<a id="quickstart-v2"></a>

<a id="quickstart--v2"></a>

## 快速入门 — V2

```go
package main

import (
    "encoding/json"
    "fmt"

    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
)

func main() {
    // Set up algorithm registry
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    reg.RegisterKem(&providers.MlKem768Provider{})

    // Generate keypairs (here one pair signs for both the principal and the agent)
    edKeys, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pqKeys, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    classicalKey := v2.CompositeKeyInfo{Kid: edKeys.Kid, Alg: "ed25519", SecretKeyB64: edKeys.SecretKeyB64, PublicKeyB64: edKeys.PublicKeyB64}
    pqKey := v2.CompositeKeyInfo{Kid: pqKeys.Kid, Alg: "ml-dsa-65", SecretKeyB64: pqKeys.SecretKeyB64, PublicKeyB64: pqKeys.PublicKeyB64}
    keys := []interface{}{
        map[string]interface{}{"kid": edKeys.Kid, "alg": "ed25519", "public_key_b64": edKeys.PublicKeyB64, "status": "active"},
        map[string]interface{}{"kid": pqKeys.Kid, "alg": "ml-dsa-65", "public_key_b64": pqKeys.PublicKeyB64, "status": "active"},
    }

    // Sign each artifact under its own context (Ed25519 + ML-DSA-65)
    sign := func(context string, payload map[string]interface{}) v2.SignedPayload {
        sp, _ := v2.SignPayload(reg, context, payload, classicalKey, &pqKey)
        return sp
    }

    // Build a V2 bundle from the signed artifacts
    nonce := v2.GenerateSessionNonce()
    bundle, _ := v2.BuildBundleV2(v2.BundleBuildInput{
        RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "rpr:alice", "session_nonce": nonce, "binding_keys": keys}),
        Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": nonce, "keys": keys, "status": "active", "principal_binding_reference": "rpr:alice"}),
        Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "agent_id": "a-1", "human_id": "rpr:alice"}),
        Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200}),
        AuditEntries: []v2.AuditEventV2{},
        SessionNonce: nonce,
    })

    // Sign the manifest with a composite signature
    signed, _ := v2.SignBundleV2(reg, bundle, classicalKey, &pqKey)

    // Verify
    data, _ := json.Marshal(signed)
    result := v2.VerifySignedBundleV2(reg, data)
    fmt.Println("Verified:", result.Verified)
    fmt.Println("Classical:", result.ClassicalValid, "PQ:", result.PQValid)
}
```

<a id="security-tiers"></a>

### 安全等级

```go
// Fragment, inside a function: intentPayload and policyPayload are decoded V2 payloads.
tier := v2.ComputeSecurityTier(v2.SecurityTierInput{
    RiskScore:       600, // from the bundle's PolicyDecision, never the intent
    DataClasses:     []string{"financial_data"},
    ActionType:      "initiate_payment",
    EstimatedImpact: "high",
})
fmt.Println(tier.Tier)               // "elevated"
fmt.Println(tier.VerificationMode)   // "hybrid_required"
fmt.Println(tier.CheckpointInterval) // 1

// From decoded intent and PolicyDecision payloads (map[string]interface{}):
tier = v2.ComputeSecurityTier(v2.SecurityTierInputFromPayloads(intentPayload, policyPayload))
```

<a id="ml-kem-768-key-encapsulation"></a>

### ML-KEM-768 密钥封装

```go
// Fragment, inside a function.
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

<a id="v2-api-reference"></a>

## V2 API 参考

<a id="bundle-building-signing"></a>

<a id="bundle-building--signing"></a>

### Bundle 构建与签名

| 函数 | 说明 |
|----------|-------------|
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | 对产物签名，生成 `SignedPayload`（复合签名；`pqKey` 为 nil 时仅使用经典签名） |
| `v2.PreparePayload(payload)` | 返回 `dcp-jcs-v1` 规范字节及其不带前缀的小写十六进制 SHA-256；`payload_hash` 字段是 `"sha256:"` 后接该摘要 |
| `v2.VerifyPayloadHash(signed)` | 只有当 `payload_hash` 恰好是 `"sha256:"` 后接规范 payload 的 SHA-256 时才为 `true`；其他任何值（包括不带前缀的摘要）都为 `false`。只检查哈希一致性，不检查签名、密钥、策略或准入。v2.12.0 已准备，尚未发布：v2.11.1 与不带前缀的摘要比较，因此会拒绝 `SignPayload` 的输出并接受不带前缀的形式 |
| `v2.BuildBundleV2(input)` | 从已签名产物组装 V2 bundle，包含清单哈希和双 Merkle 根 |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | 使用复合签名或仅经典签名对 bundle 签名；签名者为 bundle 的责任主体（`signer.id` = RPR 的 `human_id`） |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | 遵循 `DefaultVerifierPolicy` 验证 V2 bundle（结构、哈希、签名、主审计链），采用策略模式和安全等级模式中更严格的模式（规范 §14.3）；报告 `ResolvedTier` 和 `VerificationMode` |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | 使用自定义 `VerifierPolicy` 的相同操作；只有 `DefaultMode`、`RiskOverrides`、`AcceptedClassicalAlgs`、`AcceptedPQAlgs`、`AllowV1Bundles`（V1 bundle 在此始终无法通过验证）、`MaxSessionDurationSeconds`、`RequireSessionExpiry`、`RequireAudienceBinding`、`VerifierID` 以及阶段3字段（`AdvisoryRejectedAlgs`、`WarnClassicalOnlyDeprecated`、`AllowClassicalFallbackDisable`，与 TypeScript 一致）可以不同于 `DefaultVerifierPolicy()`；任何其他更改都会导致验证失败 |
| `v2.VerifySignedBundleV2At(reg, jsonBytes, policy, now)` | 在时刻 `now` 执行相同操作：会话窗口、RPR 到期时间和密钥到期时间均以毫秒精度与它比较。上面两个函数以 `time.Now()` 调用此函数 |

每个结果在 `SignerKeys`（JSON 为 `signer_keys`）中，按每个已检查的复合签名（`bundle`、四个产物以及每个 `pq_checkpoints[<id>]`）列出验证器为各组件（`classical`、`pq`）解析得到的密钥条目，以及该组件是否验证通过。

**类型化结构体与收到的 bundle。** `AuditEventV2`、`CitizenshipBundleV2` 和 `SignedBundleV2` 用于生成 bundle。在审计证据中，这些结构体会丢失显式为 `null` 的成员和无法识别的成员（`tool`、`result_ref`、`evidence_hash` 以外的成员）；可识别的字符串值成员和空的 `evidence` 对象会保留其值。在条目本身中，值为 `null` 或为空的 `prev_hash_secondary`、`intent_hash_secondary` 以及任何未知成员都会丢失，缺失的 `pq_checkpoint_ref` 会变成 `null`。这些成员的丢失会改变规范化后的证据，并可能使 `prev_hash` 链或审计 Merkle 根失效。这些结构体不是用于转发已签名证据的无损表示。要保留收到的审计条目，请使用 `v2.RawAuditEventV2`（v2.12.0 已准备，尚未发布）：它保存条目的原始字节，输入和输出时都会复制，直接调用 `Bytes()` 和 `MarshalJSON()` 时按原样返回（包裹它的 `json.Marshal` 可能会压缩空白并转义 `<`、`>`、`&`、U+2028 和 U+2029，但不改变解码后的值），因此每个成员（包括未知成员）都保留其存在与否和 `null`；它只拒绝不是恰好一个 JSON 对象的输入（包括 `null`），从不修复或重新签名，并按原样保留无效证据，使验证器以相同原因拒绝它。务必检查 `json.Unmarshal` 的错误：失败时，`RawAuditEventV2` 会保留之前的内容，而这些内容并不描述失败的输入。只有在没有 `UnmarshalJSON` 作用于它时，才可从多个 goroutine 读取它。零值不包含任何条目：`MarshalJSON()` 和 `Typed()` 返回错误，`Bytes()` 返回 `nil`；nil 的 `*RawAuditEventV2` 由 `encoding/json` 自身编码为 `null`，不会调用 `MarshalJSON`。`Typed()` 是用于读取字段的有损视图。要保留收到的 bundle，请保留收到的字节并验证这些字节：上面的验证函数接收字节。不要为了让收到的证据通过验证而自动修复、重新计算或重新签名；显式迁移应是保留原始数据的单独步骤。

<a id="admission-principal-trust-and-strict-v1-unreleased"></a>

<a id="admission-principal-trust-and-strict-v1"></a>

### 准入：责任主体信任与 strict-v1

已验证的 bundle 证明完整性和签名，而不是责任主体是谁。准入（[spec/profiles/admission](../../../../spec/profiles/admission/README.md)）在验证之上增加运营方的信任集合，用于固定每个责任主体的密钥，并使用运营方固定的 `strict-v1` 配置（所有等级均使用混合签名、已签名的接收方、最长300秒的已签名会话、最多300秒前的撤销快照）。它不执行网络 I/O，也绝不授权行动：`ActionAuthorized` 始终为 `false`。

| 函数 | 说明 |
|----------|-------------|
| `v2.NewPrincipalTrustStore(json)` | 验证信任集合（`schemas/v2/principal_trust_set.schema.json`） |
| `v2.ResolveStrictV1Profile(json)` | 验证 strict-v1 配置（`schemas/v2/admission_profile.schema.json`）；配置的 getter（`VerifierPolicy()`、`VerifierID()`、`MaxSessionDurationSeconds()`、`MaxRevocationAgeSeconds()`）返回副本 |
| `v2.RevocationSubjects(json, verification)` | 护照中的 `agent_id` 和每个已验证签名者密钥的 kid，按顺序排列；撤销快照必须覆盖这些主体 |
| `v2.EvaluateAdmissionV2(json, verification, v2.AdmissionOptions{...})` | 根据验证器的结果评估 `Now` 时刻的准入，不执行密码学运算 |
| `v2.AdmitSignedBundleV2(reg, json, v2.AdmitOptions{...})` | 遵循配置中的策略，或在无配置时使用 `Policy`，执行验证与评估 |

信任集合或配置无法加载、配置没有信任集合、配置与调用方 `Policy` 同时使用时，会返回 `*v2.AdmissionConfigError`，其 `Code` 为某个 `CONFIG_*` 错误码。`AdmissionResult` 包含 `Verified`、`Verification`、`PrincipalTrust`、`Profile`、`ProfileCompliance`、`Admitted`、`ActionAuthorized`、`RecordedDecision`、`TrustSetVersion` 和 `Errors`（`{Code, Message}`），JSON 形式使用规范中的字段名。仅当 `Admitted` 为 true 时才继续。

```go
// Fragment, inside a function: trustSetJSON, signedBundleJSON, reg (the algorithm registry) and lookupRevocation come from your application.
trust, err := v2.NewPrincipalTrustStore(trustSetJSON) // operator configuration, never the bundle
if err != nil {
    log.Fatal(err) // *v2.AdmissionConfigError
}
profile, err := v2.ResolveStrictV1Profile([]byte(`{"profile":"strict-v1","verifier_id":"api.acme.example"}`))
if err != nil {
    log.Fatal(err)
}

now := time.Now()
verification := v2.VerifySignedBundleV2At(reg, signedBundleJSON, profile.VerifierPolicy(), now)
subjects := v2.RevocationSubjects(signedBundleJSON, verification)
snapshot := lookupRevocation(subjects) // your source: a JSON snapshot, or nil when it cannot answer

result, err := v2.EvaluateAdmissionV2(signedBundleJSON, verification, v2.AdmissionOptions{
    Profile: profile, Trust: trust, Revocation: snapshot, Now: now,
})
if err != nil {
    log.Fatal(err)
}
if !result.Admitted {
    for _, e := range result.Errors {
        fmt.Println(e.Code, e.Message) // e.g. TRUST_PRINCIPAL_UNKNOWN, REVOCATION_STALE
    }
}
```

<a id="security-tiers_1"></a>

<a id="security-tiers-1"></a>

### 安全等级

| 函数 | 说明 |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | 计算自适应安全等级（routine/standard/elevated/maximum）、验证模式与检查点间隔（规范 §14.2）；未知值采用保守的 `elevated` 等级 |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | 从解码后的意图和 PolicyDecision payload 构建等级输入（`risk_score` 来自 PolicyDecision；若缺失或不是0至1000的整数，则转为表示未知值的 `RiskScore: -1`） |
| `v2.EffectiveVerificationMode(policyMode, tier)` | 策略模式与等级模式中更严格的模式；`pq_only` 保持为 `pq_only` |

<a id="delegation-chains-dcp-09-35-unreleased"></a>

<a id="delegation-chains-dcp-09-35"></a>

### 委托链（DCP-09 §3.5）

| 函数 | 说明 |
|----------|-------------|
| `v2.CreateDelegationMandate(reg, humanClassical, humanPQ, params)` | 由人类签署的根委托；`SubDelegation` 和 `MinimumSecurityTier` 可选 |
| `v2.CreateSubMandate(reg, delegatorClassical, delegatorPQ, parent, v2.SubMandateParams{...})` | 由父委托的智能体在 `DCP-AI.v2.SubMandate` 域下签署的子委托 |
| `v2.VerifyMandateChain(reg, chain, revokedIDs, v2.MandateChainKeys{HumanKeys, AgentKeys}, now)` | 从根开始离线验证委托链（追溯至人类的签名、链接与深度、`sub_delegation`、嵌套有效期、行动及 `data_classes` 和 `limits` 的权限收窄、最低等级、撤销状态）；返回 `MandateChainResult{Valid, Errors, Depth, EffectiveTier}` |

`SecurityTierInput.MandateChainTier` 将委托链的 `EffectiveTier` 作为下限，只能提高等级。

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>

### 实验性功能：规范化候选方案 `dcp-jcs-v2`（须显式选择）

非规范性且未激活：`dcp-jcs-v1` 仍是唯一的规范化配置，默认设置、构建器、签名器和验证器均不改变。这些函数在 v2.11.0 中仅供显式启用的调用方使用。验证通过的候选 bundle 也不赋予信任或准入资格。设计与契约：[`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md)（§15 入口处理、§16 路由器、§17 验证器、§18 生成器）。

| 函数 | 说明 |
|----------|-------------|
| `ExperimentalCandidateIngress(input []byte)` | `Accepted`、`Canonical`、`CanonicalSHA256`，或拒绝结果的 `Class` 和 `Offset` |
| `NewExperimentalCandidateRouter(config)` | 对字节进行路由：`reject`、`v1_path` 或 `candidate`；历史解码器使用固定标识名 `encoding_json` 指定 |
| `NewExperimentalCandidateVerifier(config)` 和 `VerifyAt(registry, input, policy, now)` | 从原始字节开始验证，最多使用一个验证器 |
| `ExperimentalCandidateSignPayload(registry, context, input, keys)` | 从 `ExperimentalCandidateBytes(b)` 或 `ExperimentalCandidateHostValue(v)` 签署单个产物（要求确切类型；保留 `json.Number`） |
| `ExperimentalCandidateSignBundle(registry, parts, signer, options)` | 组装并签署一个清单中指定 `dcp-jcs-v2` 的 bundle |
| `*ExperimentalCandidateProduceError`、`ErrExperimentalCandidateUsage` | 在调用任何签名器之前，因输入的域或形式而拒绝；或 API 使用错误 |

```go
package main

import (
    "fmt"

    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func main() {
    // The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
    ok, _ := v2.ExperimentalCandidateIngress([]byte(`{"b":1.0,"a":[]}`))
    fmt.Println(string(ok.Canonical)) // {"a":[],"b":1}
    bad, _ := v2.ExperimentalCandidateIngress([]byte(`{"a":1,"a":2}`))
    fmt.Println(bad.Class, bad.Offset) // DUPLICATE_KEY 7

    // A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    ed, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pq, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    keys := v2.ExperimentalCandidateKeys{
        Classical: v2.CompositeKeyInfo{Kid: ed.Kid, Alg: "ed25519", SecretKeyB64: ed.SecretKeyB64, PublicKeyB64: ed.PublicKeyB64},
        PQ:        &v2.CompositeKeyInfo{Kid: pq.Kid, Alg: "ml-dsa-65", SecretKeyB64: pq.SecretKeyB64, PublicKeyB64: pq.PublicKeyB64},
    }
    artifact, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateBytes([]byte(`{"intent_id":"intent:1","risk":1.0}`)), keys)
    if err != nil {
        panic(err)
    }
    fmt.Println(artifact.SignedPayload["payload_hash"]) // sha256:... of {"intent_id":"intent:1","risk":1}
}
```

<a id="composite-signatures"></a>

### 复合签名

| 函数 | 说明 |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | 对经典签名再作 PQ 签名的复合签名 |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | 仅经典签名的过渡模式 |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | 验证复合签名 |

<a id="crypto-providers"></a>

### 密码学提供程序

| 提供程序 | 算法 | 类型 | 标准 |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | 签名 | — |
| `MlDsa65Provider` | ml-dsa-65 | 签名 | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | 签名 | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

<a id="v1-api-unchanged"></a>

### V1 API（不变）

| 函数 | 说明 |
|----------|-------------|
| `dcp.GenerateKeypair()` | Ed25519 密钥对 |
| `dcp.SignObject(obj, sk)` | 对对象签名 |
| `dcp.VerifyObject(obj, sig, pk)` | 验证签名 |
| `dcp.Canonicalize(obj)` | 确定性 JSON |
| `dcp.HashObject(obj)` | 规范化 JSON 的 SHA-256 |
| `dcp.VerifySignedBundle(sb, pk)` | V1 bundle 验证 |

<a id="dcp-0509-types"></a>

### DCP-05–09 类型

V2 为 DCP-05 至 DCP-09 的所有产物提供 Go 结构体：

| 规范 | 类型 |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

域分离上下文：`CtxLifecycle`、`CtxSuccession`、`CtxDispute`、`CtxRights`、`CtxDelegation`、`CtxAwareness`

所有结构体都包含用于序列化与反序列化的 JSON 标签，并遵循 Go 命名约定（可选字段使用 `json:"field_name,omitempty"`）。

<a id="development"></a>

## 开发

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

<a id="dependencies"></a>

### 依赖

- `github.com/cloudflare/circl` — ML-DSA-65、SLH-DSA-192f、ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

<a id="license"></a>

## 许可证

Apache-2.0
