<sub>[English](README.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [日本語](README.ja.md) · **中文**</sub>

# DCP-AI Playground

> 本文是[英文版本](README.md)的参考译文，更新于2026年10月25日。如有差异，以英文原文为准。标识符和代码块（包括注释）均保留原文。

Digital Citizenship Protocol（DCP-01 至 DCP-09）的浏览器交互式演示，托管于 [docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/)。

这是一个演示：其后量子签名为模拟实现，规范形式和 Merkle 根也经过简化，因此生成的内容不构成证据，也不一定能通过 SDK 验证器的验证（参见[限制](#limitations)）。

<a id="quick-start"></a>

## 快速开始

```bash
cd playground
python3 -m http.server 8080
# Open http://localhost:8080
```

ES 模块需要 HTTP 服务器，`file://` 无法使用。

<a id="architecture"></a>

## 架构

Playground 是使用 ES 模块（`<script type="module">`）的模块化应用，无需构建步骤。

```
playground/
  index.html                    # Shell: CDN scripts, CSS, navigation, containers
  js/
    core/
      crypto.js                 # Ed25519 keygen, signing, verification, kid
      hash.js                   # SHA-256 (Web Crypto), canonicalize (JCS), Merkle root
      state.js                  # Central state (keypairs, agents, session)
      signature.js              # Composite signature builder (classical + PQ simulated)
      utils.js                  # uuid, sessionNonce (64-char hex), isoNow, hex/b64 encode/decode
    ui/
      tabs.js                   # Two-level tab navigation (group bar + tab bar)
      json-render.js            # Syntax highlighting, JSON display, copy
      forms.js                  # Form helpers, cards, notifications
      visualizations.js         # State machine, escalation flow, delegation chain, rights matrix (SVG)
    tabs/
      identity.js               # Tab 1: Identity Generator (DCP-01)
      builder.js                # Tab 2: Bundle Builder (DCP-01/02/03)
      verifier.js               # Tab 3: Bundle Verifier
      tiers.js                  # Tab 4: Tier Comparison
      explorer.js               # Tab 5: Protocol Explorer (DCP-01 through DCP-09)
      lifecycle.js              # Tab 6: Lifecycle Management (DCP-05)
      succession.js             # Tab 7: Succession & Inheritance (DCP-06)
      disputes.js               # Tab 8: Dispute Resolution (DCP-07)
      rights.js                 # Tab 9: Rights & Obligations (DCP-08)
      delegation.js             # Tab 10: Delegation & Representation (DCP-09)
      workflows.js              # Tab 11: Cross-Spec Workflows
```

共20个 JS 模块（截至2026年10月25日约2700行）。

<a id="navigation"></a>

## 导航

两级导航：

| 分组 | 标签页 |
|-------|------|
| **核心协议** | 身份、bundle 构建器、验证器、等级、浏览器 |
| **生命周期** | 智能体生命周期（DCP-05）、继承（DCP-06） |
| **治理** | 争议（DCP-07）、权利（DCP-08）、委托（DCP-09） |
| **工作流** | 跨规范流程 |

<a id="spec-coverage"></a>

## 规范覆盖

| 规范 | 演示的功能 |
|------|----------------------|
| DCP-01 | RPR、智能体护照、Ed25519 密钥对生成 |
| DCP-02 | 意图声明、风险评分、安全等级选择 |
| DCP-03 | 策略决定、审计条目、哈希链审计轨迹、bundle 清单、Merkle 根 |
| DCP-05 | 状态机（commissioned/active/declining/decommissioned）、活力报告、启用证书、停用记录 |
| DCP-06 | 数字遗嘱、记忆分类、记忆转移清单、继承仪式 |
| DCP-07 | 争议记录、三级升级、仲裁决议、判例 bundle、异议记录 |
| DCP-08 | 权利声明、义务记录、违规报告、权利矩阵、自动提交争议 |
| DCP-09 | 委托授权、认知阈值、咨询声明、委托人镜像、委托链可视化 |

<a id="cross-spec-workflows"></a>

## 跨规范工作流

四个引导式工作流：

1. **智能体完整生命周期**（DCP-01 + 05 + 06）：从身份创建到继承
2. **带争议的委托操作**（DCP-01 + 09 + 02 + 07）：从委托到争议解决
3. **权利侵犯升级**（DCP-08 + 07 + 05）：从检测违规到影响生命周期
4. **委托人监督**（DCP-09 + 02 + 03）：从阈值配置到监督报告

<a id="how-it-works"></a>

## 工作原理

所有密码学操作均**完全在浏览器中**执行：

- **Ed25519 签名**：使用从 CDN 加载的 [tweetnacl](https://github.com/dchest/tweetnacl-js)
- **SHA-256 哈希**：使用 Web Crypto API（`crypto.subtle.digest`）
- **密钥 ID（kid）**：按规范派生：`hex(SHA-256(UTF8(alg) || 0x00 || pubkey_bytes))[0:32]`
- **域分离**：应用于所有签名：`UTF8(context_tag) || 0x00 || canonical_payload`
- **规范化**：对键排序以实现确定性哈希（简化形式，并非完整的 `dcp-jcs-v1` 配置）
- **复合签名**：采用 `composite_signature.schema.json` 规定的 `{ classical, pq, binding }` 格式
- **会话 nonce**：64字符十六进制（`crypto.getRandomValues(32)`）

<a id="key-corrections-from-previous-playground"></a>

## 相比旧版 playground 的主要修正

- `session_nonce`：从 UUID 改为64字符十六进制（符合模式 `^[0-9a-f]{64}$`）
- `composite_sig`：从 `{ entries[] }` 改为 `{ classical, pq, binding }`（v2 模式格式）
- 所有生成的构件均包含 `_spec_ref`，引用相应规范章节
- 协议浏览器扩展为覆盖 DCP-01 至 DCP-09

<a id="limitations"></a>

## 限制

- **后量子签名为模拟实现**：ML-DSA-65 使用基于 HMAC 的占位实现。Ed25519 是真实的。要使用真实的 PQ 签名，请使用 SDK（浏览器中使用 `sdks/wasm/` 下的 WASM SDK）。
- Merkle 根计算使用简化拼接
- 不支持 CBOR 传输格式（仅 JSON）
- 签名验证仅限于 bundle 护照中的 Ed25519 密钥
- 标签页之间的会话绑定使用共享状态（不会持久化到存储中）

<a id="dependencies"></a>

## 依赖

- `tweetnacl@1.0.3` + `tweetnacl-util@0.15.1`（CDN）
- Web Crypto API（原生）
- 无框架，无构建步骤
